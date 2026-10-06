import test from 'node:test';
import assert from 'node:assert/strict';
import { domFixture } from './dom-fixture.js';
import { normalizeFields, normalizeProfile, profileSources, validateMatches } from '../shared/profile.js';

function selectFixture({ caption = '学校', type = 'search', value = '演示大学', options = ['演示大学分校', '演示大学(Demo University)'], signal = true, commit = true } = {}) {
  const f = domFixture(), section = f.section('教育背景');
  const record = f.record(section, [[caption, { type, placeholder: '请输入' }]]);
  const input = record.querySelector('input');
  if (signal) input.parentElement.attrs.class += ' bili-select';
  const menu = f.node('div', { class: 'bili-select-dropdown' }); menu.hidden = true; f.doc.body.append(menu);
  let chosen = '';
  input.onEvent = event => {
    if (event.type !== 'input') return;
    f.context.setTimeout(() => {
      menu.hidden = false;
      if (!menu.children.length) for (const text of options) {
        const item = f.node('div', { class: 'bili-select-dropdown-item' }, text);
        item.onClick = () => { if (commit) { input.value = text; chosen = text; menu.hidden = true; } };
        menu.append(item);
      }
    }, 200);
  };
  return { ...f, input, menu, value, get chosen() { return chosen; } };
}
async function fillOne(f) {
  await f.start(); const prepared = await f.prepare();
  assert.equal(prepared.fields.length, 1, JSON.stringify(prepared));
  const field = prepared.fields[0];
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: field.id, value: f.value, componentType: field.componentType }], auditFieldIds: [field.id] });
  return { field, result };
}

test('截图中的搜索型学校 input 和非ARIA下拉菜单可扫描并点击中英文名称变体', async () => {
  const f = selectFixture(); const { field, result } = await fillOne(f);
  assert.equal(field.section, 'education'); assert.equal(field.componentType, 'school-autocomplete');
  assert.equal(result.filled, 1); assert.equal(f.chosen, '演示大学(Demo University)');
  assert.equal(result.outcomes[0].optionMatch, 'alias'); assert.equal(result.outcomes[0].dropdownDetected, true);
});

test('原本普通单行输入在输入后出现候选，也会点击专业候选而不是只留下搜索词', async () => {
  const f = selectFixture({ caption: '专业名称', type: 'text', signal: false, value: '计算机科学与技术', options: ['计算机科学与技术(工学)', '物理学'] });
  const { field, result } = await fillOne(f);
  assert.equal(field.componentType, 'native-input'); assert.equal(result.filled, 1);
  assert.equal(f.chosen, '计算机科学与技术(工学)');
});

test('没有内部input的学历下拉也能点选名称变体，并核对纯文字显示值', async () => {
  const f = domFixture(), group = f.section('教育经历');
  const field = f.node('div', { role: 'combobox', 'aria-label': '学历' });
  const selected = f.node('span', { class: 'placeholder' }, '请选择学历'); field.append(selected); group.list.append(field);
  const menu = f.node('div', { class: 'bili-select-dropdown' }); menu.hidden = true; f.doc.body.append(menu);
  field.onClick = () => { menu.hidden = false; };
  for (const value of ['本科', '硕士研究生', '博士研究生']) {
    const option = f.node('div', { class: 'bili-select-dropdown-item' }, value);
    option.onClick = () => { selected.attrs.class = 'plain-value'; selected.textContent = value; menu.hidden = true; };
    menu.append(option);
  }
  await f.start(); const { fields } = await f.prepare();
  assert.equal(fields.length, 1);
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, componentType: fields[0].componentType, value: '硕士' }] });
  assert.equal(result.filled, 1); assert.equal(selected.textContent, '硕士研究生');
  assert.equal(result.outcomes[0].optionMatch, 'alias');
});

test('唯一非常相近的单项候选可以选中并标记近似，两个同分候选不盲选', async () => {
  const f = selectFixture({ caption: '专业名称', type: 'text', signal: false, value: '计算机科学与应用技术', options: ['计算机科学与应用技朮', '物理学'] });
  const { result } = await fillOne(f);
  assert.equal(result.filled, 1); assert.equal(result.outcomes[0].optionMatch, 'similar');
  const rules = f.context.__resumeControls;
  const a = f.node('div', {}, '计算机科学与应用技朮'), b = f.node('div', {}, '计算机科学与应用术术');
  assert.equal(rules.rankOptions([a, b], '计算机科学与应用技术', 'major'), null);
});

test('学校主校和分校或校区不能仅靠去括号混为一个候选', () => {
  const f = domFixture(), rules = f.context.__resumeControls;
  assert.equal(rules.optionScore('演示大学(滨海校区)', '演示大学', 'school'), 0);
  assert.equal(rules.optionScore('演示大学分校', '演示大学', 'school'), 0);
  assert.equal(rules.optionScore('演示大学(Demo University)', '演示大学', 'school'), .98);
});

test('只输入搜索词或点击后被页面清空，均不能误报为选择成功', async () => {
  const f = selectFixture({ commit: false }); const { result } = await fillOne(f);
  assert.equal(result.filled, 0); assert.equal(f.chosen, '');
  const g = selectFixture();
  g.input.blur = () => { g.input.value = ''; g.doc.activeElement = g.doc.body; };
  assert.equal((await fillOne(g)).result.filled, 0);
});

test('项目描述长文本不点击输入框或任何候选菜单', async () => {
  const f = selectFixture({ caption: '项目描述', type: 'text', signal: false, value: '演示项目说明', options: ['演示项目说明'] });
  const { result } = await fillOne(f);
  assert.equal(result.filled, 1);
  assert.equal(f.events.some(event => event.type === 'click'), false);
});

test('项目职责等短字段仍检查候选，不因字段名含职责就当成长描述', async () => {
  const f = selectFixture({ caption: '项目职责', type: 'text', signal: false, value: '独立项目', options: ['独立项目', '团队项目'] });
  const { result } = await fillOne(f);
  assert.equal(result.filled, 1); assert.equal(f.chosen, '独立项目');
  assert.equal(result.outcomes[0].dropdownDetected, true);
});

test('其他已打开的下拉菜单不作为当前字段的候选，取消后不再点击', async () => {
  const f = selectFixture({ options: ['没有对应的学校'], commit: true });
  const otherMenu = f.node('div', { class: 'bili-select-dropdown' }), other = f.node('div', { class: 'bili-select-dropdown-item' }, '演示大学');
  otherMenu.append(other); f.doc.body.append(otherMenu);
  assert.equal((await fillOne(f)).result.filled, 0);
  assert.equal(f.events.some(event => event.target === other && event.type === 'click'), false);
  const g = selectFixture();
  g.input.onEvent = event => { if (event.type === 'input') void g.send({ type: 'STOP_SCAN' }); };
  await g.start(); const { fields } = await g.prepare();
  await g.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, componentType: fields[0].componentType, value: g.value }] });
  assert.equal(g.chosen, '');
});

function calendarFixture({ format = null, day = false, source = '2024-09-13', yearFirst = false, confirm = false } = {}) {
  const f = domFixture(), group = f.section('项目经历');
  const attrs = { placeholder: '请选择开始日期', ...(format ? { 'data-format': format } : {}) };
  const record = f.record(group, [['项目名称'], ['开始日期', attrs]]), input = record.querySelectorAll('input')[1]; input.readOnly = true;
  const panel = f.node('div', { class: 'sd-Picker-popover' }); panel.hidden = true; f.doc.body.append(panel);
  input.onClick = () => { panel.hidden = false; };
  let chosenYear = 2026, chosenMonth = 1, pending = '';
  const years = f.node('div'), months = f.node('div'), dates = f.node('div'); panel.append(years, months, dates);
  months.hidden = yearFirst;
  for (let year = 2020; year <= 2027; year++) {
    const option = f.node('div', {}, year + '年'); option.onClick = () => { chosenYear = year; months.hidden = false; }; years.append(option);
  }
  for (let month = 1; month <= 12; month++) {
    const option = f.node('div', {}, month + '月'); option.onClick = () => {
      chosenMonth = month;
      if (!day) { pending = `${chosenYear}-${String(chosenMonth).padStart(2, '0')}`; if (!confirm) { input.value = pending; panel.hidden = true; } }
      else { dates.children.forEach(cell => { cell.attrs.title = `${chosenYear}-${String(chosenMonth).padStart(2, '0')}-${String(Number(cell.textContent)).padStart(2, '0')}`; }); }
    }; months.append(option);
  }
  if (day) for (let date = 1; date <= 30; date++) {
    const cell = f.node('td', { title: `2026-01-${String(date).padStart(2, '0')}` }, String(date));
    cell.onClick = () => { input.value = cell.getAttribute('title'); panel.hidden = true; }; dates.append(cell);
  }
  if (confirm) { const button = f.node('button', { type: 'button' }, '确定'); button.onClick = () => { input.value = pending; panel.hidden = true; }; panel.append(button); }
  return { ...f, input, panel, value: source, record };
}
async function fillCalendar(f) {
  await f.start(); const { fields } = await f.prepare();
  const field = fields.find(field => field.label === '开始日期');
  assert.equal(field.componentType, 'custom-datepicker');
  return { field, result: await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: field.id, componentType: field.componentType, value: f.value }], auditFieldIds: [field.id] }) };
}

test('诊断4里被误判下拉的请选择开始日期，现识别为日期组件', async () => {
  const f = calendarFixture({ format: 'YYYY-MM' }); f.input.parentElement.attrs.class += ' custom-select';
  const { field, result } = await fillCalendar(f);
  assert.equal(field.datePrecision, 'month'); assert.equal(result.filled, 1);
  assert.equal(f.input.value, '2024-09'); assert.equal(result.readback[0].datePrecision, 'month');
});

test('网页只有月份网格时，从面板识别月精度，即使个人资料保存到日也填写年月', async () => {
  const f = calendarFixture(); const { result } = await fillCalendar(f);
  assert.equal(result.filled, 1); assert.equal(f.input.value, '2024-09');
  assert.equal(result.outcomes[0].datePrecision, 'month');
});

test('网页是完整日历时按年月选择后再点具体日，不能用月选择代替日', async () => {
  const f = calendarFixture({ format: 'YYYY-MM-DD', day: true }); const { result } = await fillCalendar(f);
  assert.equal(result.filled, 1); assert.equal(f.input.value, '2024-09-13');
  assert.equal(result.outcomes[0].datePrecision, 'day');
  assert.ok(f.events.some(event => event.type === 'click' && event.target.tagName === 'TD' && event.target.textContent === '13'));
});

test('先出现年份列表的未知精度控件，月份提交后仍按网页实际精度核对', async () => {
  const f = calendarFixture({ yearFirst: true }); const { result } = await fillCalendar(f);
  assert.equal(result.filled, 1); assert.equal(f.input.value, '2024-09');
  assert.equal(result.outcomes[0].datePrecision, 'month');
});

test('日历有内部确定按钮时先确认选择，再关闭日历，不点击网页提交', async () => {
  const f = calendarFixture({ format: 'YYYY-MM', confirm: true }); const { result } = await fillCalendar(f);
  assert.equal(result.filled, 1); assert.equal(f.input.value, '2024-09');
  assert.ok(f.events.some(event => event.type === 'click' && event.target.textContent === '确定'));
});

test('月控件的预览也裁剪到月份，日控件保留个人资料的具体日期', () => {
  const sources = profileSources(normalizeProfile({ education: [{ startDate: '2024-09-13' }] }));
  const fields = normalizeFields([{ id: 'F0', label: '开始时间', section: 'education', recordIndex: 0, componentType: 'custom-datepicker', datePrecision: 'month' }]);
  const matches = validateMatches('{"mappings":[{"fieldId":"F0","sourceId":"S0"}]}', fields, sources);
  assert.equal(matches[0].value, '2024-09');
  assert.equal(validateMatches('{"mappings":[{"fieldId":"F0","sourceId":"S0"}]}', [{ ...fields[0], datePrecision: 'day' }], sources)[0].value, '2024-09-13');
});

test('共享的月份范围也按网页精度选择并提交两个月，不要求资料中的具体日', async () => {
  const f = domFixture(), section = f.section('教育经历');
  const record = f.node('div'), range = f.node('div', { class: 'date-range' });
  range.append(f.node('span', {}, '起止时间'));
  const inputs = [f.node('input', { placeholder: '请选择日期', 'data-format': 'YYYY-MM' }), f.node('input', { placeholder: '请选择日期', 'data-format': 'YYYY-MM' })];
  inputs.forEach(input => { input.readOnly = true; range.append(input); }); record.append(range);
  const school = f.node('div'); school.append(f.node('span', {}, '学校'), f.node('input')); record.append(school); section.list.append(record);
  const panel = f.node('div', { class: 'sd-Picker-popover' }); panel.hidden = true; f.doc.body.append(panel);
  inputs.forEach(input => { input.onClick = () => { panel.hidden = false; }; });
  let year = 2026, pending = [];
  for (const value of [2024, 2027]) { const item = f.node('div', {}, value + '年'); item.onClick = () => { year = value; }; panel.append(item); }
  for (let month = 1; month <= 12; month++) {
    const item = f.node('div', {}, month + '月'); item.onClick = () => {
      pending.push(`${year}-${String(month).padStart(2, '0')}`);
      if (pending.length === 2) { inputs[0].value = pending[0]; inputs[1].value = pending[1]; panel.hidden = true; }
    }; panel.append(item);
  }
  await f.start(); const { fields } = await f.prepare(); const dateFields = fields.filter(field => field.componentType === 'custom-datepicker');
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: dateFields.map((field, index) => ({ fieldId: field.id, componentType: field.componentType, value: index ? '2027-06-22' : '2024-09-13' })), auditFieldIds: dateFields.map(field => field.id) });
  assert.equal(result.filled, 2); assert.deepEqual(pending, ['2024-09', '2027-06']);
  assert.ok(result.outcomes.every(item => item.datePrecision === 'month'));
  assert.ok(result.readback.every(item => item.datePrecision === 'month'));
});
