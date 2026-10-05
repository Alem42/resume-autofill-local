import test from 'node:test';
import assert from 'node:assert/strict';
import { domFixture } from './dom-fixture.js';

test('重复的起止时间属于各自教育、工作、项目区块及条目，已有第一条也计入索引', async () => {
  const f = domFixture();
  const edu = f.section('教育经历'), work = f.section('工作经历'), projects = f.section('项目经历');
  f.record(edu, [['学校名称', { value: 'EXISTING_SCHOOL' }], ['开始时间', { value: '2020-09' }], ['结束时间', { value: '2024-06' }]]);
  f.record(edu, [['学校名称'], ['开始时间'], ['结束时间']]);
  f.record(work, [['公司名称'], ['开始时间'], ['结束时间']]);
  f.record(projects, [['项目名称'], ['开始时间'], ['结束时间']]);
  await f.start();
  const { fields } = await f.prepare();
  assert.deepEqual(fields.filter(field => field.label === '开始时间').map(field => [field.section, field.recordIndex]),
    [['education', 1], ['work', 0], ['projects', 0]]);
  assert.equal(JSON.stringify(fields).includes('EXISTING_SCHOOL'), false);
});

test('按缺额添加两段教育和三段项目，不添加无资料的工作，不反复多点', async () => {
  const f = domFixture();
  const edu = f.section('教育经历', { tag: 'div' }), projects = f.section('项目经历', { label: '+ 添加项目经验' }), work = f.section('工作经历');
  edu.button.onClick = () => f.record(edu, [['学校名称'], ['学历']]);
  projects.button.onClick = () => f.record(projects, [['项目名称'], ['项目描述', { tag: 'textarea' }]]);
  work.button.onClick = () => f.record(work, [['公司名称'], ['职位']]);
  f.record(edu, [['学校名称', { value: 'EXISTING_SCHOOL' }], ['学历']]);
  await f.start();
  assert.equal(f.messages[0].type, 'FORM_DETECTED');
  const result = await f.send({ type: 'ENSURE_RECORDS', targets: { education: 2, projects: 3 } });
  assert.equal(result.error, undefined);
  assert.equal(edu.list.children.length, 2);
  assert.equal(projects.list.children.length, 3);
  assert.equal(work.list.children.length, 0);
  const again = await f.send({ type: 'ENSURE_RECORDS', targets: { education: 2, projects: 3 } });
  assert.equal(again.reports.reduce((sum, report) => sum + report.added, 0), 0);
  assert.equal(f.events.filter(event => event.type === 'click').length, 4);
});

test('提交型、上传型按钮以及同类多个添加入口不能自动点击', async () => {
  const f = domFixture();
  f.section('教育经历', { type: 'submit' });
  const projects = f.section('项目经历', { label: '添加项目经历并上传' });
  f.section('获奖信息'); f.section('获奖信息');
  await f.start();
  const result = await f.send({ type: 'ENSURE_RECORDS', targets: { education: 2, projects: 3, awards: 2 } });
  assert.ok(result.reports.some(report => report.message.includes('多个')));
  assert.equal(f.events.filter(event => event.type === 'click').length, 0);
  assert.equal(projects.list.children.length, 0);
});

test('按钮点击后没有新增结构时停止，不重复发起点击', async () => {
  const f = domFixture(); f.section('教育经历'); await f.start();
  const result = await f.send({ type: 'ENSURE_RECORDS', targets: { education: 3 } });
  assert.equal(f.events.filter(event => event.type === 'click').length, 1);
  assert.ok(result.reports[0].message.includes('未检测到'));
});

test('取消会中止添加，未经授权的添加请求不点击网页', async () => {
  const f = domFixture(); const edu = f.section('教育经历');
  assert.ok((await f.send({ type: 'ENSURE_RECORDS', targets: { education: 2 } })).error);
  await f.start();
  edu.button.onClick = () => { f.record(edu, [['学校名称'], ['学历']]); void f.send({ type: 'STOP_SCAN' }); };
  const result = await f.send({ type: 'ENSURE_RECORDS', targets: { education: 3 } });
  assert.ok(result.error);
  assert.equal(f.events.filter(event => event.type === 'click').length, 1);
});

test('无显式重复容器也可按学校锚点计数，学校所在城市不能误算一条', async () => {
  const f = domFixture(); const edu = f.section('教育经历');
  for (let i = 0; i < 2; i++) f.record(edu, [['学校名称'], ['学校所在城市'], ['开始时间'], ['结束时间']], { marker: false });
  await f.start(); const { fields } = await f.prepare();
  assert.deepEqual(fields.filter(field => field.label === '开始时间').map(field => field.recordIndex), [0, 1]);
});

test('辅助校对才采集已有值；只读接口不触发 DOM 修改，密码不在读回范围', async () => {
  const f = domFixture(); const basic = f.section('基本信息');
  f.record(basic, [['姓名', { value: 'PRIVATE_EXISTING' }], ['密码', { type: 'password', value: 'PASSWORD' }]]);
  await f.start(); const { fields } = await f.prepare({ includeExisting: true });
  assert.equal(fields.length, 1); assert.equal(fields[0].hasValue, true);
  assert.equal(JSON.stringify(fields).includes('PRIVATE_EXISTING'), false);
  const values = await f.send({ type: 'READ_VALUES', fieldIds: [fields[0].id] });
  assert.equal(values.values[0].value, 'PRIVATE_EXISTING');
  assert.equal(f.events.length, 0);
});

test('原生 month 输入保存年月；填写后可读回实际值，拒绝未知校对字段', async () => {
  const f = domFixture(); const basic = f.section('基本信息');
  f.record(basic, [['预计毕业时间', { type: 'month' }]]);
  await f.start(); const { fields } = await f.prepare();
  assert.ok((await f.send({ type: 'READ_VALUES', fieldIds: ['F99'] })).error);
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: fields[0].id, value: '2027年6月', componentType: 'native-input' }], auditFieldIds: [fields[0].id] });
  assert.equal(result.filled, 1); assert.equal(result.readback[0].value, '2027-06');
});

test('预览后交换经历顺序，原有字段编号不能写到换位的条目', async () => {
  const f = domFixture(); const edu = f.section('教育经历');
  const first = f.record(edu, [['学校名称']]); const second = f.record(edu, [['学校名称']]);
  await f.start(); const { fields } = await f.prepare();
  first.remove(); edu.list.append(first);
  const values = await f.send({ type: 'READ_VALUES', fieldIds: fields.map(field => field.id) });
  assert.ok(values.values.every(item => item.unavailable));
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: fields.map(field => ({ fieldId: field.id, value: 'WRONG_SLOT', componentType: field.componentType })) });
  assert.equal(result.filled, 0); assert.equal(result.skipped, 2);
  assert.equal(second.querySelector('input').value, '');
});

test('基本信息区块内的技能与求职意向仍可用相同上下文校验填写', async () => {
  const f = domFixture(); const basic = f.section('基本信息');
  f.record(basic, [['专业技能'], ['期望职位']]);
  await f.start(); const { fields } = await f.prepare();
  assert.deepEqual(fields.map(field => field.section), ['other', 'jobIntention']);
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: fields.map(field => ({ fieldId: field.id, value: 'LOCAL_CONTENT', componentType: field.componentType })) });
  assert.equal(result.filled, 2);
});

test('异步插入条目完成后才进行下一次点击，总点击数始终受40次上限约束', async () => {
  const f = domFixture();
  const sections = ['教育经历', '项目经历', '获奖信息'].map(title => f.section(title));
  let pending = false;
  for (const group of sections) group.button.onClick = () => {
    assert.equal(pending, false); pending = true;
    f.context.setTimeout(() => { f.record(group, [['学校名称']]); pending = false; }, 350);
  };
  await f.start();
  const result = await f.send({ type: 'ENSURE_RECORDS', targets: { education: 20, projects: 20, awards: 20 } });
  assert.equal(result.error, undefined);
  assert.equal(f.events.filter(event => event.type === 'click').length, 40);
  assert.equal(sections[0].list.children.length, 20); assert.equal(sections[1].list.children.length, 20);
  assert.equal(sections[2].list.children.length, 0);
  assert.ok(result.reports.some(report => report.message.includes('上限')));
});
