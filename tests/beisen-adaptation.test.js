import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProfile, profileSources, selectedSources, normalizeFields, localMatchPairs, validateMatches } from '../shared/profile.js';
import { CHOICES } from '../shared/catalogs.js';
import { domFixture } from './dom-fixture.js';

test('官方离线目录保持原始代码、完整条目与来源，不把门类和专业类混成同一层', () => {
  const load = name => JSON.parse(readFileSync(new URL('../data/' + name, import.meta.url), 'utf8'));
  const categories = load('major-categories-cn.json'), schools = load('schools-cn.json'), majors = load('majors-cn.json');
  assert.equal(categories.items.filter(item => item.code.length === 2).length, 13);
  assert.equal(categories.items.filter(item => item.code.length === 4).length, 92);
  assert.equal(majors.items.length, 883); assert.equal(schools.items.length, 3196);
  assert.ok(categories.items.some(item => item.code === '0809' && item.name === '计算机类'));
  for (const catalog of [categories, schools, majors]) { assert.ok(catalog.source.startsWith('https://www.moe.gov.cn/')); assert.equal(new Set(catalog.items.map(item => item.code)).size, catalog.items.length); }
  assert.equal(new Set(CHOICES.ethnicity).size, 56);
});

test('两位家庭成员分别匹配电话政治面貌；模糊模式也不能跨成员或借用本人资料', async () => {
  const f = domFixture(), group = f.section('家庭情况');
  for (let i = 0; i < 2; i++) f.record(group, [['姓名'], ['联系电话'], ['政治面貌'], ['称谓']]);
  const profile = normalizeProfile({ basic: { phone: '00000000000', political: '共青团员' }, family: [
    { name: '虚构家长甲', phone: '00000000001', political: '群众', relationship: '父亲' },
    { name: '虚构家长乙', phone: '00000000002', political: '中共党员', relationship: '母亲' }
  ] });
  await f.start(); const fields = normalizeFields((await f.prepare()).fields), all = profileSources(profile), sources = selectedSources(all, all.map(source => source.id));
  const matches = validateMatches(JSON.stringify({ mappings: localMatchPairs(fields, sources) }), fields, sources);
  assert.equal(matches.length, 8);
  assert.deepEqual(matches.filter(item => /联系电话/.test(item.fieldLabel)).map(item => item.value), ['00000000001', '00000000002']);
  const fatherPhone = fields.find(field => field.recordIndex === 0 && field.label === '联系电话');
  for (const source of sources.filter(source => source.fieldKey === 'phone' && (source.section !== 'family' || source.recordIndex !== 0))) {
    assert.deepEqual(validateMatches(JSON.stringify({ mappings: [{ fieldId: fatherPhone.id, sourceId: source.id }] }), fields, sources, { relaxed: true }), []);
  }
  assert.equal(profile.family[0].isCompanyEmployee, false);
});

test('员工关系默认否不扩展成岗位调剂同意；学历、学位层次、门类及旧文本均独立保存', () => {
  const profile = normalizeProfile({ education: [{ degree: '硕士研究生', degreeLevel: '硕士', degreeDiscipline: '工学', degreeName: '旧自定义学位名称' }],
    basic: { studentOrigin: '演示生源地', nativePlace: '演示籍贯', health: '良好' }, selfEvaluation: '虚构评价' });
  assert.equal(profile.basic.isCompanyEmployee, false); assert.equal(profile.jobIntention.acceptJobAdjustment, '');
  assert.equal(profile.education[0].degreeName, '旧自定义学位名称'); assert.notEqual(profile.basic.studentOrigin, profile.basic.nativePlace);
  const sources = profileSources(profile), fields = normalizeFields(['学历', '学位', '学位门类', '学位名称'].map((label, index) => ({ id: 'F' + index, label, componentType: 'native-input', section: 'education', recordIndex: 0 })));
  const mappings = validateMatches(JSON.stringify({ mappings: localMatchPairs(fields, sources) }), fields, sources);
  assert.deepEqual(mappings.map(mapping => mapping.value), ['硕士研究生', '硕士', '工学', '旧自定义学位名称']);
  for (const label of ['个人评价', '个人简介', '自我介绍', '自述', '自我评价']) {
    assert.equal(localMatchPairs([{ id: 'E', label, section: 'basic', recordIndex: null }], sources)[0]?.sourceId, sources.find(source => source.key === 'selfEvaluation').id);
  }
});

test('北森 SVG 单选行只点图标才选中，须在所属弹层确认并读回；不点页面确定', async () => {
  const f = domFixture(), basic = f.section('基本信息'), card = f.record(basic, [['民族', { placeholder: '请选择' }]]), input = card.querySelector('input'); input.readOnly = true;
  const menu = f.node('div', { class: 'constant-main-selector-container' }), layer = f.node('div', { class: 'constant-main-layer-container' }); menu.hidden = true; menu.append(layer); f.doc.body.append(menu);
  const item = f.node('div', { class: 'list-item-container' }), icon = f.node('svg', { class: 'RadioUnchecked' }), text = f.node('span', { class: 'item-text-label' }, '汉族'); item.append(icon, text); layer.append(item);
  const pending = f.node('div', { class: 'select-data-container' }); layer.append(pending);
  const button = f.node('button', { type: 'button' }, '确定'); menu.append(button); button.disabled = true;
  let confirmed = 0, unrelated = 0; const pageButton = f.node('button', { type: 'button' }, '确定'); pageButton.onClick = () => unrelated++; f.doc.body.append(pageButton);
  input.onClick = () => { menu.hidden = false; };
  icon.onClick = () => { icon.attrs.class = 'RadioChecked'; pending.textContent = '汉族'; button.disabled = false; };
  button.onClick = () => { confirmed++; input.value = '汉族'; menu.hidden = true; };
  await f.start(); const field = (await f.prepare()).fields[0];
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: field.id, componentType: field.componentType, value: '汉' }] });
  assert.equal(result.filled, 1); assert.equal(confirmed, 1); assert.equal(unrelated, 0); assert.equal(input.value, '汉族');
});

test('明确的经历存在门槛先选是，再按缺额添加；门槛不算一段经历', async () => {
  const f = domFixture(), group = f.section('项目经历'), row = f.node('div', { class: 'form-item' }), gate = f.node('select');
  row.append(f.node('label', {}, '是否有项目经历'), gate); group.root.append(row);
  for (const [value, label] of [['', '请选择'], ['yes', '是'], ['no', '否']]) { const option = f.node('option', { value }, label); gate.append(option); }
  gate.onEvent = event => { if (event.type === 'change' && gate.value === 'yes' && !group.list.children.length) f.record(group, [['项目名称']]); };
  group.button.onClick = () => f.record(group, [['项目名称']]);
  await f.start(); const result = await f.send({ type: 'ENSURE_RECORDS', targets: { projects: 2 } });
  assert.equal(group.list.children.length, 2); assert.equal(gate.value, 'yes'); assert.equal(result.reports[0].added, 2);
  assert.equal((await f.prepare()).fields.length, 2);
});

test('只有年月的事实不伪造日；完整年份日历优先于拆开的年下拉', async () => {
  const f = domFixture(), education = f.section('教育经历'); f.record(education, [['开始时间', { type: 'date' }]]);
  await f.start(); let field = (await f.prepare()).fields[0];
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: field.id, componentType: field.componentType, value: '2024-09' }] });
  assert.equal(result.filled, 0); assert.equal(result.outcomes[0].reason, 'missing_date_part');
  assert.equal(education.list.querySelector('input').value, '');
  const g = domFixture(), group = g.section('教育经历'); const card = g.record(group, [['开始时间', { placeholder: 'YYYY', 'data-format': 'YYYY' }]]); card.querySelector('input').readOnly = true;
  await g.start(); field = (await g.prepare()).fields[0]; assert.equal(field.componentType, 'custom-datepicker'); assert.equal(field.datePrecision, 'year'); assert.equal(field.datePart, undefined);
  const h = domFixture(), yearsGroup = h.section('教育经历'), row = h.record(yearsGroup, [['开始时间', { placeholder: '请选择日期' }]]), input = row.querySelector('input'); input.readOnly = true;
  const popup = h.node('div', { class: 'test-calendar' }), year = h.node('button', { type: 'button' }, '2024年'); popup.hidden = true; popup.append(year); h.doc.body.append(popup);
  let monthClicks = 0;
  input.onClick = () => { popup.hidden = false; };
  year.onClick = () => { year.remove(); for (let month = 1; month <= 12; month++) { const cell = h.node('button', { type: 'button' }, month + '月'); cell.onClick = () => { monthClicks++; input.value = '2024-' + String(month).padStart(2, '0'); }; popup.append(cell); } };
  await h.start(); field = (await h.prepare()).fields[0];
  const partial = await h.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: field.id, componentType: field.componentType, value: '2024' }] });
  assert.equal(partial.outcomes[0].reason, 'missing_date_part'); assert.equal(monthClicks, 0); assert.equal(input.value, '');
  const k = domFixture(), onlyYear = k.section('教育经历'), cardYear = k.record(onlyYear, [['开始时间', { placeholder: 'YYYY', 'data-format': 'YYYY' }]]), yearInput = cardYear.querySelector('input'); yearInput.readOnly = true;
  const yearPanel = k.node('div', { class: 'test-calendar' }), yearCell = k.node('button', { type: 'button', title: '2024' }, '2024年'); yearPanel.hidden = true; yearPanel.append(yearCell); k.doc.body.append(yearPanel);
  yearInput.onClick = () => { yearPanel.hidden = false; }; yearCell.onClick = () => { yearInput.value = '2024'; yearPanel.hidden = true; };
  await k.start(); field = (await k.prepare()).fields[0];
  const yearResult = await k.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: field.id, componentType: field.componentType, value: '2024' }] });
  assert.equal(yearResult.filled, 1); assert.equal(yearInput.value, '2024');
});
