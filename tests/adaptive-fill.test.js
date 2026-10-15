import test from 'node:test';
import assert from 'node:assert/strict';
import { domFixture } from './dom-fixture.js';
import { normalizeProfile, profileSources, selectedSources, normalizeFields, localMatchPairs, validateMatches, sourceAllowed } from '../shared/profile.js';

function allSources(profile) { const sources = profileSources(normalizeProfile(profile)); return selectedSources(sources, sources.map(source => source.id)); }
function pairAll(fields, sources) { return validateMatches(JSON.stringify({ mappings: localMatchPairs(fields, sources) }), fields, sources); }
function simulatedClock(f) {
  let elapsed = 0;
  f.context.Date = class extends Date { static now() { return elapsed; } };
  const schedule = f.context.setTimeout;
  f.context.setTimeout = (fn, ms) => schedule(() => { elapsed += ms; fn(); }, ms);
  return () => elapsed;
}

test('综合 IELTS 描述派生语种、熟练度、考试、分数和合并说明，精通与成绩不会串填', () => {
  const sources = allSources({ languages: 'IELTS 6.5' });
  const captions = ['语种', '熟练程度', '考试名称', '考试成绩', '语言证书'];
  const fields = normalizeFields(captions.map((label, index) => ({ id: `F${index}`, label, section: 'languageCertificates', recordIndex: 0, componentType: 'native-input' })));
  const mappings = pairAll(fields, sources);
  assert.deepEqual(mappings.map(mapping => mapping.value), ['英语', '精通', 'IELTS', '6.5', 'IELTS 6.5']);
  const combined = sources.find(source => source.fieldKey === 'certificateSummary');
  for (const field of fields.slice(0, 4)) assert.equal(sourceAllowed(field, combined, { relaxed: true }), false);
  const wrong = validateMatches(JSON.stringify({ mappings: [{ fieldId: 'F0', sourceId: combined.id }] }), fields, sources, { relaxed: true });
  assert.deepEqual(wrong, []);
  assert.equal(allSources({}).some(source => /IELTS/.test(source.value)), false);
});

test('母语/精通/熟练/一般等熟练度候选按最高等级选择，语种可中英互认', async () => {
  const f = domFixture(), section = f.section('语言能力');
  const record = f.record(section, [['语种', { tag: 'select' }], ['熟练程度', { tag: 'select' }]]);
  const [language, level] = record.querySelectorAll('select');
  for (const text of ['请选择', 'English', 'Japanese']) language.append(f.node('option', { value: text === '请选择' ? '' : text }, text));
  for (const text of ['请选择', '一般', '流利', '精通', '熟练']) level.append(f.node('option', { value: text === '请选择' ? '' : text }, text));
  await f.start(); const { fields } = await f.prepare();
  const sources = allSources({ languageCertificates: [{ language: '英语', exam: 'IELTS', score: '6.5' }] });
  const mappings = pairAll(normalizeFields(fields), sources);
  assert.equal(mappings.length, 2);
  const result = await f.send({ type: 'APPLY_FIELDS', mappings });
  assert.equal(result.filled, 2); assert.equal(language.value, 'English'); assert.equal(level.value, '精通');
  assert.equal(result.outcomes[1].optionMatch, 'preference');
});

test('日期拆成独立年/月/日下拉时，从同一条资料提取正确部分并兼容前导零和单位', async () => {
  const f = domFixture(), section = f.section('教育经历');
  const record = f.record(section, [['学校']]);
  const row = f.node('div', { class: 'form-item' }); row.append(f.node('label', {}, '入学时间'));
  const parts = ['year', 'month', 'day'].map(name => f.node('select', { name }));
  const choices = [['2023年', '2024年'], ['08月', '09月', '10月'], ['12日', '13日', '14日']];
  parts.forEach((part, index) => { part.append(f.node('option', { value: '' }, '请选择')); for (const text of choices[index]) part.append(f.node('option', { value: text }, text)); });
  row.append(...parts); record.append(row);
  await f.start(); const { fields } = await f.prepare();
  assert.deepEqual(fields.filter(field => field.datePart).map(field => field.datePart), ['year', 'month', 'day']);
  const sources = allSources({ education: [{ school: '演示学校', startDate: '2024-09-13' }] });
  const mappings = pairAll(normalizeFields(fields), sources);
  assert.equal(mappings.length, 4);
  const result = await f.send({ type: 'APPLY_FIELDS', mappings });
  assert.equal(result.filled, 4); assert.deepEqual(parts.map(part => part.value), ['2024年', '09月', '13日']);
});

test('平铺标题与通用加号、带aria标签图标能补足教育和项目，不把不同区块混在一起', async () => {
  const f = domFixture(), root = f.node('main'); f.doc.body.append(root);
  const groups = [];
  for (const [title, label] of [['教育经历（0）', '学校'], ['项目经历', '项目名称']]) {
    root.append(f.node('h2', {}, title));
    const list = f.node('div'); root.append(list);
    const button = f.node('button', { type: 'button', 'aria-label': '添加一条' }, '+'); root.append(button);
    const group = { list, button }; groups.push(group);
    button.onClick = () => { f.record(group, [[label], ['开始时间']]); };
  }
  await f.start(); const expanded = await f.send({ type: 'ENSURE_RECORDS', targets: { education: 2, projects: 3 } });
  assert.deepEqual(expanded.reports.map(report => report.added), [2, 3]);
  const { fields } = await f.prepare();
  assert.deepEqual(fields.filter(field => field.label === '学校').map(field => [field.section, field.recordIndex]), [['education', 0], ['education', 1]]);
  assert.equal(groups[1].list.children.length, 3);
});

test('一个日期控件超时后停止该字段的所有方案，继续下一个字段且无延迟写入', async () => {
  const f = domFixture(), group = f.section('项目经历');
  const record = f.record(group, [['项目名称'], ['开始日期', { placeholder: '请选择日期' }], ['结束日期', { placeholder: '请选择日期' }]]);
  const [name, bad, good] = record.querySelectorAll('input'); bad.readOnly = true; good.attrs['data-format'] = 'YYYY-MM-DD';
  const clock = simulatedClock(f);
  let badStarted, nextStarted;
  good.onEvent = event => { if (event.type === 'input' && nextStarted === undefined) nextStarted = clock(); };
  // Non-progressing calendar forces the old adapters to use the shared deadline.
  const panel = f.node('div', { class: 'ant-calendar' }); panel.hidden = true; f.doc.body.append(panel);
  const year = f.node('button', { type: 'button', class: 'ant-calendar-year-select' }, '2026'); panel.append(year);
  const cell = f.node('div', {}, '2026年'), previous = f.node('button', { type: 'button', class: 'ant-calendar-year-panel-prev-decade-btn' }, '上一页');
  panel.append(cell, previous); bad.onClick = () => { if (badStarted === undefined) badStarted = clock(); panel.hidden = false; };
  await f.start(); const { fields } = await f.prepare();
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: fields.map(field => ({ fieldId: field.id, componentType: field.componentType,
    value: field.label === '项目名称' ? '演示项目' : field.label === '开始日期' ? '2000-01-01' : '1999-01-01' })) });
  assert.equal(result.outcomes.find(outcome => outcome.fieldId === fields.find(field => field.label === '开始日期').id).reason, 'field_timeout');
  assert.equal(name.value, '演示项目'); assert.equal(good.value, '1999-01-01'); assert.equal(result.filled, 2);
  assert.ok(nextStarted - badStarted <= 5200, String(nextStarted - badStarted));
  const count = f.events.length; await new Promise(resolve => setImmediate(resolve)); assert.equal(f.events.length, count);
});

test('AI 看到实际候选后可在点选前判定同义表达，取消后迟到的回答不再点击', async () => {
  for (const cancel of [false, true]) {
    const f = domFixture(), section = f.section('教育经历');
    const record = f.record(section, [['专业类别', { placeholder: '请选择' }]]), input = record.querySelector('input'); input.readOnly = true;
    const menu = f.node('div', { role: 'listbox' }); menu.hidden = true; f.doc.body.append(menu);
    input.onClick = () => { menu.hidden = false; };
    const option = f.node('div', { role: 'option' }, 'Engineering'); menu.append(option);
    option.onClick = () => { input.value = 'Engineering'; menu.hidden = true; };
    const seen = [];
    f.context.chrome.runtime.sendMessage = async message => {
      seen.push(structuredClone(message));
      if (message.type !== 'RESOLVE_OPTION') return {};
      if (cancel) await f.send({ type: 'STOP_SCAN' });
      return { index: 0 };
    };
    await f.start(); const { fields } = await f.prepare();
    const result = await f.send({ type: 'APPLY_FIELDS', aiAssist: true, mappings: [{ fieldId: fields[0].id, componentType: fields[0].componentType, value: '工学' }] });
    assert.deepEqual(seen.find(message => message.type === 'RESOLVE_OPTION').options, ['Engineering']);
    assert.equal(result.filled, cancel ? undefined : 1);
    assert.equal(input.value, cancel ? '' : 'Engineering');
    if (!cancel) assert.equal(result.outcomes[0].optionMatch, 'ai');
  }
});

test('可编辑日期遵从格式并支持年份精度，日期解析拒绝不存在的日期', async () => {
  for (const [format, expected] of [['YYYY/MM/DD', '2024/09/13'], ['DD/MM/YYYY', '13/09/2024'], ['DD.MM.YYYY', '13.09.2024'], ['MM/YYYY', '09/2024'], ['YYYY-MM', '2024-09'], ['YYYY年', '2024年']]) {
    const f = domFixture(), group = f.section('教育经历');
    const record = f.record(group, [['开始日期', { 'data-format': format }]]), input = record.querySelector('input');
    await f.start(); const { fields } = await f.prepare();
    const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, componentType: fields[0].componentType, value: '2024-09-13' }] });
    assert.equal(result.filled, 1); assert.equal(input.value, expected);
  }
  const rules = domFixture().context.__resumeControls;
  assert.equal(rules.dateParts('2025-02-29'), null); assert.ok(rules.dateParts('2024-02-29'));
});

test('英文月份标题的 React 日历可翻到目标月并选日，不要求先出现年份列表', async () => {
  const f = domFixture(), group = f.section('教育经历');
  const record = f.record(group, [['开始日期', { placeholder: '请选择日期', 'data-format': 'YYYY-MM-DD' }]]), input = record.querySelector('input'); input.readOnly = true;
  const panel = f.node('div', { class: 'react-datepicker' }); panel.hidden = true; f.doc.body.append(panel);
  const header = f.node('div', { class: 'react-datepicker__current-month' }, 'September 2024');
  const next = f.node('button', { type: 'button', class: 'react-datepicker__navigation--next' }, 'Next');
  panel.append(header, next);
  next.onClick = () => { header.textContent = 'October 2024'; };
  for (let day = 1; day <= 31; day++) {
    const cell = f.node('div', { class: 'react-datepicker__day' }, String(day));
    cell.onClick = () => { input.value = `2024-${header.textContent.startsWith('October') ? '10' : '09'}-${String(day).padStart(2, '0')}`; panel.hidden = true; };
    panel.append(cell);
  }
  input.onClick = () => { panel.hidden = false; };
  await f.start(); const { fields } = await f.prepare();
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, componentType: fields[0].componentType, value: '2024-10-13' }] });
  assert.equal(result.filled, 1); assert.equal(input.value, '2024-10-13');
  assert.equal(f.events.filter(event => event.target === next && event.type === 'click').length, 1);
});

test('日历原生年份和月份选择器可直接切换，零基月份值按文字对应，不误选相邻月日期', async () => {
  const f = domFixture(), group = f.section('教育经历');
  const record = f.record(group, [['开始日期', { placeholder: '请选择日期', 'data-format': 'YYYY-MM-DD' }]]), input = record.querySelector('input'); input.readOnly = true;
  const panel = f.node('div', { class: 'flatpickr-calendar' }); panel.hidden = true; f.doc.body.append(panel);
  const year = f.node('select', { 'aria-label': 'Year' }), month = f.node('select', { 'aria-label': 'Month' });
  for (const value of ['2026', '2024']) year.append(f.node('option', { value }, value));
  for (const [value, text] of [['0', 'January'], ['8', 'September']]) month.append(f.node('option', { value }, text));
  const day = f.node('div', { 'data-date': '2026-01-13' }, '13'); panel.append(year, month, day);
  const update = event => { if (event.type === 'change') day.attrs['data-date'] = `${year.value}-${String(+month.value + 1).padStart(2, '0')}-13`; };
  year.onEvent = update; month.onEvent = update;
  day.onClick = () => { input.value = day.attrs['data-date']; panel.hidden = true; };
  input.onClick = () => { panel.hidden = false; };
  await f.start(); const { fields } = await f.prepare();
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, componentType: fields[0].componentType, value: '2024-09-13' }] });
  assert.equal(result.filled, 1); assert.equal(input.value, '2024-09-13'); assert.equal(month.value, '8');
});

test('学校搜索完整双语名称无结果时可改用中文名，仍点击完整候选才能算成功', async () => {
  const f = domFixture(), group = f.section('教育经历');
  const record = f.record(group, [['学校', { type: 'search', role: 'combobox' }]]), input = record.querySelector('input');
  const menu = f.node('div', { role: 'listbox' }); menu.hidden = true; f.doc.body.append(menu);
  const option = f.node('div', { role: 'option' }, '演示大学(Demo University)'); menu.append(option);
  input.onEvent = event => { if (event.type === 'input' && input.value === '演示大学') menu.hidden = false; };
  let selected = false; option.onClick = () => { selected = true; input.value = option.textContent; menu.hidden = true; };
  await f.start(); const { fields } = await f.prepare();
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, componentType: fields[0].componentType, value: '演示大学(Demo University)' }] });
  assert.equal(result.filled, 1); assert.equal(selected, true);
});

test('没有add类名或role的纯文字添加入口也能展开；submit按钮内的同名span不能绕过限制', async () => {
  const f = domFixture(), group = f.section('教育经历'); group.button.remove();
  const add = f.node('span', { class: 'buttonText_x7' }, '+ 添加教育经历'); group.root.append(add);
  add.onClick = () => f.record(group, [['学校'], ['学历']]);
  await f.start(); const expanded = await f.send({ type: 'ENSURE_RECORDS', targets: { education: 2 } });
  assert.equal(expanded.reports[0].added, 2);
  const g = domFixture(), section = g.section('教育经历', { type: 'submit', label: '' });
  const child = g.node('span', {}, '+ 添加教育经历'); section.button.append(child);
  await g.start(); const rejected = await g.send({ type: 'ENSURE_RECORDS', targets: { education: 2 } });
  assert.equal(rejected.reports[0].added, 0); assert.equal(g.events.some(event => event.type === 'click'), false);
});

test('短词模糊匹配不能把肯定含义匹配到否定选项，熟练度不把不熟练排在一般之前', () => {
  const f = domFixture(), rules = f.context.__resumeControls;
  assert.ok(rules.optionScore('工学类', '工学', 'majorCategory') > 0);
  assert.equal(rules.optionScore('非全日制', '全日制', 'studyMode'), 0);
  assert.equal(rules.optionScore('非统招', '统招', 'isRegular'), 0);
  assert.equal(rules.rankOptions([f.node('div', {}, '不熟练'), f.node('div', {}, '一般')], '精通', 'proficiency').element.textContent, '一般');
});

test('年份改变后网站替换同一教育条目内的月份控件时，可唯一重新绑定并继续填写', async () => {
  const f = domFixture(), group = f.section('教育经历');
  const record = f.record(group, [['学校']]), row = f.node('div', { class: 'form-item' });
  row.append(f.node('label', {}, '入学时间'));
  const year = f.node('select', { name: 'startYear' });
  year.append(f.node('option', { value: '' }, '请选择'), f.node('option', { value: '2024' }, '2024年'));
  let month;
  const newMonth = () => { const node = f.node('select', { name: 'startMonth' }); node.append(f.node('option', { value: '' }, '请选择'), f.node('option', { value: '9' }, '9月')); return node; };
  month = newMonth(); row.append(year, month); record.append(row);
  year.onEvent = event => { if (event.type === 'change') { month.remove(); month = newMonth(); row.append(month); } };
  await f.start(); const { fields } = await f.prepare();
  const mappings = pairAll(normalizeFields(fields), allSources({ education: [{ school: '演示学校', startDate: '2024-09-13' }] }));
  const result = await f.send({ type: 'APPLY_FIELDS', mappings });
  assert.equal(result.filled, 3); assert.equal(year.value, '2024'); assert.equal(month.value, '9');
});

test('当前年份标题只是切换按钮；月份视图随后打开日网格时保留资料中的具体日', async () => {
  const f = domFixture(), group = f.section('教育经历');
  const record = f.record(group, [['开始日期', { placeholder: '请选择日期' }]]), input = record.querySelector('input'); input.readOnly = true;
  const panel = f.node('div', { class: 'ant-picker-dropdown' }); panel.hidden = true; f.doc.body.append(panel);
  const header = f.node('button', { type: 'button', class: 'ant-picker-year-btn' }, '2024');
  const years = f.node('div'), months = f.node('div', { class: 'ant-picker-month-panel' }), days = f.node('div', { class: 'ant-picker-date-panel' });
  years.hidden = true; days.hidden = true;
  const year = f.node('div', {}, '2024年'); years.append(year); panel.append(header, years, months, days);
  header.onClick = () => { years.hidden = false; months.hidden = true; };
  year.onClick = () => { years.hidden = true; months.hidden = false; };
  for (let month = 1; month <= 12; month++) {
    const item = f.node('div', {}, `${month}月`); item.onClick = () => { months.hidden = true; days.hidden = false; }; months.append(item);
  }
  for (let day = 1; day <= 30; day++) {
    const item = f.node('td', { 'data-date': `2024-09-${String(day).padStart(2, '0')}` }, String(day));
    item.onClick = () => { input.value = item.getAttribute('data-date'); panel.hidden = true; }; days.append(item);
  }
  input.onClick = () => { panel.hidden = false; };
  await f.start(); const { fields } = await f.prepare();
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, componentType: fields[0].componentType, value: '2024-09-13' }] });
  assert.equal(result.filled, 1); assert.equal(input.value, '2024-09-13'); assert.equal(result.outcomes[0].datePrecision, 'day');
  assert.ok(f.events.some(event => event.target === year && event.type === 'click'));
});

test('未知精度的年份优先组件在月选择后需要内部确认时，也能确定月精度并提交', async () => {
  const f = domFixture(), group = f.section('教育经历');
  const record = f.record(group, [['开始日期', { placeholder: '请选择日期' }]]), input = record.querySelector('input'); input.readOnly = true;
  const panel = f.node('div', { class: 'sd-Picker-popover' }); panel.hidden = true; f.doc.body.append(panel);
  const months = f.node('div'); months.hidden = true;
  const year = f.node('div', {}, '2024年'); year.onClick = () => { months.hidden = false; }; panel.append(year, months);
  let pending = '';
  for (let month = 1; month <= 12; month++) {
    const item = f.node('div', {}, `${month}月`); item.onClick = () => { pending = `2024-${String(month).padStart(2, '0')}`; }; months.append(item);
  }
  const confirm = f.node('button', { type: 'button' }, '确定'); confirm.onClick = () => { input.value = pending; panel.hidden = true; }; panel.append(confirm);
  input.onClick = () => { panel.hidden = false; };
  await f.start(); const { fields } = await f.prepare();
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, componentType: fields[0].componentType, value: '2024-09-13' }] });
  assert.equal(result.filled, 1); assert.equal(input.value, '2024-09'); assert.equal(result.outcomes[0].datePrecision, 'month');
});
