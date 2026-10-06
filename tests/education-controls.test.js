import test from 'node:test';
import assert from 'node:assert/strict';
import { domFixture } from './dom-fixture.js';
import { normalizeProfile, profileSources, selectedSources, localMatchPairs, validateMatches } from '../shared/profile.js';

function dateFirstRecords(section = '教育经历', flat = false) {
  const f = domFixture(), group = f.section(section);
  for (let index = 0; index < 2; index++) {
    const root = flat ? group.list : f.node('div', { class: 'resumeEntry___hash' });
    if (!flat) group.list.append(root);
    const range = f.node('div', { class: 'range___hash' }); range.append(f.node('span', {}, '* 起止时间:'));
    range.append(f.node('input', { type: 'date' }), f.node('input', { type: 'date' })); root.append(range);
    const row = f.node('div'); row.append(f.node('span', {}, section === '教育经历' ? '学校名称' : '项目名称'), f.node('input', { placeholder: '请输入' })); root.append(row);
  }
  return { ...f, group };
}

test('诊断中的第二组教育/项目日期在名称前面，无显式记录标记也属于第二条', async () => {
  for (const title of ['教育经历', '项目经历']) for (const flat of [false, true]) {
    const f = dateFirstRecords(title, flat); await f.start(); const { fields } = await f.prepare();
    assert.deepEqual(fields.map(field => [field.label, field.recordIndex]),
      [['开始时间', 0], ['结束时间', 0], [title === '教育经历' ? '学校名称' : '项目名称', 0],
        ['开始时间', 1], ['结束时间', 1], [title === '教育经历' ? '学校名称' : '项目名称', 1]]);
  }
});

test('两校完整日期分别取各自资料，不会复制第一段的起止时间', async () => {
  const f = dateFirstRecords();
  const profile = normalizeProfile({ education: [
    { school: '演示研究生学校', startDate: '2024-09-13', endDate: '2027-06-22' },
    { school: '演示本科学校', startDate: '2020-09-07', endDate: '2024-06-18' }
  ] });
  await f.start(); const { fields } = await f.prepare();
  const sources = selectedSources(profileSources(profile), profileSources(profile).map(source => source.id));
  const mappings = validateMatches(JSON.stringify({ mappings: localMatchPairs(fields, sources) }), fields, sources);
  const result = await f.send({ type: 'APPLY_FIELDS', mappings, auditFieldIds: fields.map(field => field.id) });
  assert.equal(result.filled, 6);
  assert.deepEqual(result.readback.map(item => item.value), ['2024-09-13', '2027-06-22', '演示研究生学校', '2020-09-07', '2024-06-18', '演示本科学校']);
});

test('教育布尔单选扫描整组，true/false 明确填写，协议选项保持不动', async () => {
  const f = domFixture(), edu = f.section('教育经历');
  const record = f.record(edu, [['学校名称']]);
  for (const [caption, name] of [['是否最高学历', 'highest'], ['是否双学位', 'double']]) {
    const row = f.node('div'); row.append(f.node('span', {}, caption + ':'));
    for (const label of ['是', '否']) {
      const option = f.node('label', {}, label); option.append(f.node('input', { type: 'radio', name, value: label === '是' ? '1' : '0' })); row.append(option);
    }
    record.append(row);
  }
  const consent = f.node('input', { type: 'checkbox', 'aria-label': '同意协议' }); record.append(consent);
  await f.start(); const { fields } = await f.prepare();
  assert.equal(fields.length, 3);
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: fields.filter(field => field.componentType === 'native-radio').map(field => ({ ...field, fieldId: field.id, value: field.label === '是否最高学历' ? 'true' : 'false' })) });
  assert.equal(result.filled, 2);
  assert.deepEqual(record.querySelectorAll('input[type="radio"]').map(input => Boolean(input.checked)), [true, false, false, true]);
  assert.equal(Boolean(consent.checked), false);
});

test('框架透明单选输入仍可通过可见标签检测，隐藏整组仍不可检测', async () => {
  const f = domFixture(), group = f.section('基本信息');
  const row = f.node('div'); row.append(f.node('span', {}, '性别'));
  for (const label of ['男', '女']) { const option = f.node('label', {}, label); const input = f.node('input', { name: 'gender', type: 'radio' }); input.transparent = true; option.append(input); row.append(option); }
  group.list.append(row);
  f.context.window.getComputedStyle = el => ({ display: el.hidden ? 'none' : 'block', visibility: 'visible', opacity: el.transparent ? '0' : '1' });
  await f.start(); assert.equal((await f.prepare()).fields.length, 1);
  row.hidden = true; assert.equal((await f.prepare()).fields.length, 0);
});

function autocompleteFixture({ missing = false, commit = true } = {}) {
  const f = domFixture(), group = f.section('教育经历');
  const root = f.record(group, [['学校名称', { role: 'combobox', 'aria-autocomplete': 'list', 'aria-controls': 'school-options' }]]);
  const input = root.querySelector('input');
  const panel = f.node('div', { role: 'listbox', id: 'school-options' }); panel.hidden = true; f.doc.body.append(panel);
  let selected = '';
  input.onEvent = event => {
    if (event.type !== 'input') return;
    f.context.setTimeout(() => {
      panel.hidden = false;
      for (const label of missing ? ['演示大学分校'] : ['演示大学分校', '演示大学']) {
        const choice = f.node('div', { role: 'option' }, label);
        choice.onClick = () => { if (commit) { selected = label; input.value = label; panel.hidden = true; } };
        panel.append(choice);
      }
    }, 200);
  };
  return { ...f, input, panel, get selected() { return selected; } };
}

test('学校先输入等待异步候选，再点击精确学校，不能误选同名分校', async () => {
  const f = autocompleteFixture(); await f.start(); const { fields } = await f.prepare();
  assert.equal(fields[0].componentType, 'school-autocomplete');
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, componentType: fields[0].componentType, value: '演示大学' }] });
  assert.equal(result.filled, 1); assert.equal(f.selected, '演示大学');
  assert.equal(f.events.filter(event => event.type === 'click' && event.target.textContent === '演示大学分校').length, 0);
});

test('学校没有精确候选或候选点击未提交，不把只输入文字误报为填写成功', async () => {
  for (const options of [{ missing: true }, { commit: false }]) {
    const f = autocompleteFixture(options); await f.start(); const { fields } = await f.prepare();
    const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, componentType: fields[0].componentType, value: '演示大学' }] });
    assert.equal(result.filled, 0); assert.equal(result.skipped, 1);
    assert.equal(result.outcomes[0].reason, 'selection_not_committed');
  }
});

test('基本字段标题和输入框在相邻网格单元，也能识别且不归到其他信息', async () => {
  const f = domFixture(), group = f.section('其他信息');
  const row = f.node('div', { class: 'grid___hash' });
  for (const label of ['姓名', '手机号码', '电子邮箱', '证件号码', '出生日期']) {
    row.append(f.node('span', {}, '* ' + label + ':'), f.node('input', { placeholder: '请输入' }));
  }
  group.list.append(row);
  await f.start(); const { fields } = await f.prepare();
  assert.deepEqual(fields.map(field => field.label), ['姓名', '手机号码', '电子邮箱', '证件号码', '出生日期']);
  assert.ok(fields.every(field => field.section === 'basic'));
});

test('自定义日期网格按 ISO 完整日期点击，保留具体日', async () => {
  const f = domFixture(), edu = f.section('教育经历');
  const record = f.record(edu, [['学校名称'], ['开始时间', { placeholder: '请选择日期' }]]);
  const input = record.querySelectorAll('input')[1]; input.readOnly = true;
  const panel = f.node('div', { class: 'ant-picker-dropdown' }); panel.hidden = true;
  const cell = f.node('td', { title: '2024-09-13' }, '13'); panel.append(cell); f.doc.body.append(panel);
  input.onClick = () => { panel.hidden = false; };
  cell.onClick = () => { input.value = '2024-09-13'; panel.hidden = true; };
  await f.start(); const { fields } = await f.prepare();
  const dateField = fields.find(field => field.label === '开始时间');
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: dateField.id, value: '2024-09-13', componentType: dateField.componentType }] });
  assert.equal(result.filled, 1); assert.equal(input.value, '2024-09-13');
  assert.equal(f.events.filter(event => event.target === cell && event.type === 'click').length, 1);
});

test('只读共享日期范围按开始、结束顺序完整提交，不把部分待选值当成成功', async () => {
  const f = domFixture(), edu = f.section('教育经历');
  const root = f.node('div'), range = f.node('div', { class: 'date-range' });
  range.append(f.node('span', {}, '起止时间'));
  const inputs = [f.node('input', { placeholder: '请选择日期' }), f.node('input', { placeholder: '请选择日期' })];
  inputs.forEach(input => { input.readOnly = true; range.append(input); }); root.append(range);
  const school = f.node('div'); school.append(f.node('span', {}, '学校名称'), f.node('input')); root.append(school); edu.list.append(root);
  const panel = f.node('div', { class: 'ant-picker-dropdown' }); panel.hidden = true; f.doc.body.append(panel);
  let pending = [];
  inputs.forEach(input => { input.onClick = () => { panel.hidden = false; }; });
  for (const value of ['2024-09-13', '2027-06-22']) {
    const cell = f.node('td', { title: value }, value.slice(-2));
    cell.onClick = () => {
      pending.push(value);
      if (pending.length === 2) { inputs[0].value = pending[0]; inputs[1].value = pending[1]; panel.hidden = true; }
    };
    panel.append(cell);
  }
  await f.start(); const { fields } = await f.prepare();
  const dates = fields.filter(field => field.componentType === 'custom-datepicker');
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: dates.map((field, index) => ({ fieldId: field.id, componentType: field.componentType, value: index ? '2027-06-22' : '2024-09-13' })) });
  assert.equal(result.filled, 2);
  assert.deepEqual(pending, ['2024-09-13', '2027-06-22']);
  assert.deepEqual(inputs.map(input => input.value), pending);
});

test('共享日期范围只批准一半时，不点击会修改另一个未批准字段的日历', async () => {
  const f = dateFirstRecords();
  const inputs = f.doc.querySelectorAll('input[type="date"]');
  inputs.forEach(input => { input.attrs.type = 'text'; input.attrs.placeholder = '请选择日期'; input.readOnly = true; });
  await f.start(); const { fields } = await f.prepare();
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, value: '2024-09-13', componentType: fields[0].componentType }] });
  assert.equal(result.filled, 0); assert.equal(result.outcomes[0].reason, 'range_requires_both');
  assert.equal(f.events.filter(event => event.type === 'click').length, 0);
});
