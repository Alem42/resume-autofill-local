import test from 'node:test';
import assert from 'node:assert/strict';
import { domFixture } from './dom-fixture.js';
import { createController } from '../shared/controller.js';
import { normalizeProfile, profileSources, DEFAULT_MODEL } from '../shared/profile.js';

// Reconstructed from the user's screenshots, not a copy of a logged-in JD page.
function screenshotLayout() {
  const f = domFixture();
  const nav = f.node('nav');
  for (const title of ['基本信息', '教育经历', '实习经历', '校园经历', '项目经历', '荣誉奖励', '论文/期刊', '发明成果专利']) nav.append(f.node('a', { href: '#section' }, title));
  f.doc.body.append(nav);
  function card(title) {
    const root = f.node('div', { class: 'resumeRow___abc' });
    const aside = f.node('div', { class: 'leftColumn___abc' });
    aside.append(f.node('div', { class: 'blockTitle___xyz' }, title));
    const list = f.node('div', { class: 'rightColumn___abc' }); root.append(aside, list); f.doc.body.append(root);
    return { root, list };
  }
  function row(root, label, attrs = {}) {
    const wrap = f.node('div', { class: 'gridCell___xyz' });
    wrap.append(f.node('div', { class: 'caption___xyz' }, '* ' + label + ':'), f.node('input', { placeholder: '请输入', ...attrs }));
    root.append(wrap); return wrap;
  }
  const basic = card('基本信息*');
  for (const title of ['姓名', '手机号码', '电子邮箱', '民族', '所在城市', '出生日期', '微信号']) row(basic.list, title);
  const gender = f.node('div', { class: 'gridCell___xyz' }); gender.append(f.node('span', {}, '* 性别:'));
  for (const label of ['男', '女']) { const wrap = f.node('label', {}, label); wrap.append(f.node('input', { type: 'radio', name: 'gender', value: label === '男' ? '1' : '2' })); gender.append(wrap); }
  basic.list.append(gender);
  const groups = {};
  for (const [key, title, labels] of [
    ['education', '教育经历*', ['学校名称', '学历', '开始时间', '结束时间']],
    ['internships', '实习经历', ['公司名称', '岗位', '开始时间', '结束时间']],
    ['campus', '校园经历', ['活动名称', '担任职务', '活动内容']],
    ['projects', '项目经历', ['项目名称', '个人贡献', '项目成果']],
    ['awards', '荣誉奖励', ['奖项名称', '奖项级别']],
    ['publications', '论文/期刊', ['论文题目', '期刊名称']],
    ['patents', '发明成果专利', ['专利名称', '专利号']]
  ]) {
    const group = card(title), add = f.node('a', { href: 'javascript:void(0)', class: 'plainAction___xyz' }, '+ 添加');
    group.root.append(add); group.button = add; groups[key] = group;
    add.onClick = () => {
      const record = f.node('div', { 'data-record': '' });
      for (const label of labels) row(record, label);
      group.list.append(record);
    };
  }
  return { ...f, basic, groups, row };
}

test('截图布局的普通标题、无label输入框和通用添加按钮可识别教育/实习/校园等区块', async () => {
  const f = screenshotLayout(); await f.start();
  const result = await f.send({ type: 'ENSURE_RECORDS', targets: { education: 2, internships: 1, campus: 1, projects: 3, awards: 1, publications: 1, patents: 1 } });
  assert.equal(result.error, undefined);
  assert.ok(result.reports.every(report => !report.message), JSON.stringify(result.reports));
  assert.equal(f.groups.education.list.children.length, 2); assert.equal(f.groups.projects.list.children.length, 3);
  const { fields } = await f.prepare();
  assert.equal(fields.find(field => field.label === '姓名').section, 'basic');
  assert.equal(fields.find(field => field.label === '手机号码').section, 'basic');
  assert.equal(fields.find(field => field.label === '电子邮箱').section, 'basic');
  assert.deepEqual(fields.filter(field => field.label === '学校名称').map(field => field.recordIndex), [0, 1]);
  assert.deepEqual(fields.filter(field => field.label === '项目名称').map(field => field.recordIndex), [0, 1, 2]);
  assert.ok(fields.length > 30);
});

test('性别单选按组采集和填写，不把男女当成两条字段，不操作协议同意复选框', async () => {
  const f = screenshotLayout();
  const consent = f.row(f.basic.list, '我同意隐私协议', { type: 'checkbox', name: 'agreement' });
  await f.start(); const { fields } = await f.prepare();
  const gender = fields.filter(field => field.componentType === 'native-radio');
  assert.equal(gender.length, 1); assert.equal(gender[0].label, '性别');
  assert.equal(fields.some(field => /协议/.test(field.label)), false);
  const result = await f.send({ type: 'APPLY_FIELDS', mappings: [{ fieldId: gender[0].id, componentType: 'native-radio', value: 'female' }], auditFieldIds: [gender[0].id] });
  assert.equal(result.filled, 1); assert.equal(result.readback[0].value, '女');
  assert.equal(consent.querySelector('input').checked, undefined);
});

test('导航目录里的标题与添加链接不污染区块识别或被自动点击', async () => {
  const f = screenshotLayout();
  const nav = f.doc.querySelector('nav');
  const fake = f.node('a', { href: '#education' }, '添加教育经历'); nav.append(fake);
  await f.start(); await f.send({ type: 'ENSURE_RECORDS', targets: { education: 2 } });
  assert.equal(f.events.some(event => event.target === fake), false);
  const fields = (await f.prepare()).fields;
  assert.equal(fields.find(field => field.label === '学校名称').section, 'education');
});

test('ARIA关联的字段标题可提取，不能发送被包裹的已有输入值', async () => {
  const f = domFixture(), group = f.section('基本信息');
  group.list.append(f.node('span', { id: 'phone-caption' }, '联系电话'));
  group.list.append(f.node('input', { 'aria-labelledby': 'phone-caption', value: 'PRIVATE_PHONE' }));
  await f.start(); const { fields } = await f.prepare({ includeExisting: true });
  assert.equal(fields[0].label, '联系电话'); assert.equal(JSON.stringify(fields).includes('PRIVATE_PHONE'), false);
});

test('截图布局完整流程：通用添加后模型漏配也可本机补齐，确认后分别写入两段教育和三段项目', async () => {
  const dom = screenshotLayout();
  const profile = normalizeProfile({ basic: { name: 'PRIVATE_DEMO_NAME', phone: 'PRIVATE_DEMO_PHONE', email: 'demo@example.invalid', gender: '女' },
    education: [{ school: '演示硕士学校', degree: '硕士', startDate: '2024-09', endDate: '2027-06' }, { school: '演示本科学校', degree: '本科', startDate: '2020-09', endDate: '2024-06' }],
    projects: Array.from({ length: 3 }, (_, index) => ({ projectName: `演示项目${index + 1}`, responsibilities: `贡献${index + 1}`, achievements: `成果${index + 1}` })) });
  const store = initial => {
    const data = structuredClone(initial);
    return { data, async setAccessLevel() {}, async get(keys) {
      if (keys === null) return structuredClone(data);
      return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter(key => key in data).map(key => [key, structuredClone(data[key])]));
    }, async set(value) { Object.assign(data, structuredClone(value)); }, async remove(keys) { for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key]; } };
  };
  const requests = [];
  const url = path => `chrome-extension://testextensionid/${path}`;
  const api = { runtime: { id: 'testextensionid', getURL: url },
    storage: { local: store({ schemaVersion: 2, profile, settings: { model: DEFAULT_MODEL, rememberKey: false } }), session: store({ secret: 'DUMMY_KEY' }) },
    tabs: { async query() { return [{ id: 1, url: 'https://jobs.example/resume', status: 'complete' }]; },
      async get() { return { id: 1, url: 'https://jobs.example/resume', status: 'complete' }; },
      async sendMessage(tabId, message) { return dom.send(message); } },
    scripting: { async executeScript() { return [{ frameId: 0, documentId: 'jd-doc' }]; } },
    windows: { async create() { return { id: 9, tabs: [{ id: 90 }] }; }, async remove() {} } };
  const controller = createController(api, async (url, init) => {
    requests.push(init.body);
    return { ok: true, async text() { return JSON.stringify({ choices: [{ message: { content: '{"mappings":[]}' } }] }); } };
  });
  await controller.handle({ type: 'START_DETECTION' }, { id: 'testextensionid', url: url('popup/popup.html') });
  const flow = api.storage.session.data.flow_1;
  await controller.handle({ type: 'FORM_DETECTED', scanToken: flow.scanToken }, { id: 'testextensionid', url: flow.url, tab: { id: 1 }, frameId: 0, documentId: 'jd-doc' });
  const sender = { id: 'testextensionid', url: url(`confirm/confirm.html?requestId=${flow.requestId}`), tab: { id: 90 } };
  const result = await controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId,
    sourceIds: profileSources(profile).map(source => source.id), autoAdd: true, relaxed: true, overwrite: false }, sender);
  assert.equal(result.mappings.length, 21); assert.ok(result.mappings.every(mapping => mapping.matchedBy === 'local'));
  assert.ok(dom.doc.querySelectorAll('input:not([type="radio"])').every(input => input.value === ''));
  assert.equal(requests.some(body => body.includes('PRIVATE_') || body.includes('演示硕士学校') || body.includes('DUMMY_KEY')), false);
  const filled = await controller.handle({ type: 'APPLY_FIELDS', requestId: flow.requestId, fieldIds: result.mappings.map(mapping => mapping.fieldId) }, sender);
  assert.equal(filled.filled, 21);
  assert.deepEqual(dom.groups.education.list.children.map(record => record.querySelector('input').value), ['演示硕士学校', '演示本科学校']);
  assert.deepEqual(dom.groups.projects.list.children.map(record => record.querySelector('input').value), ['演示项目1', '演示项目2', '演示项目3']);
});
