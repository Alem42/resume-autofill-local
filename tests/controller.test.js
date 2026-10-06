import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../shared/controller.js';
import { normalizeProfile, profileSources, DEFAULT_MODEL } from '../shared/profile.js';
import { domFixture } from './dom-fixture.js';

const ID = 'testextensionid';
const extensionURL = path => `chrome-extension://${ID}/${path.replace(/^\//, '')}`;
const options = { id: ID, url: extensionURL('options/options.html') };
const popup = { id: ID, url: extensionURL('popup/popup.html') };
const page = { id: ID, url: 'https://jobs.example/apply', tab: { id: 1 }, frameId: 0, documentId: 'doc-1' };
const defaultProfile = normalizeProfile({ basic: { name: 'PRIVATE_NAME_876', phone: 'PRIVATE_PHONE_876', idCard: 'PRIVATE_ID_876' }, work: [{ description: 'PRIVATE_DESCRIPTION_876'.repeat(100) }] });
function storage(initial = {}) {
  const data = structuredClone(initial);
  let access;
  return { data, get access() { return access; }, async setAccessLevel(value) { access = value.accessLevel; },
    async get(keys) {
      if (keys === null) return structuredClone(data);
      const result = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) if (key in data) result[key] = structuredClone(data[key]);
      return result;
    }, async set(values) { Object.assign(data, structuredClone(values)); }, async remove(keys) { for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key]; } };
}
function fixture({ legacy, fetcher, fields, profile = defaultProfile, pageHandler } = {}) {
  const listeners = {};
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  const outgoing = [];
  const requests = [];
  const target = { id: 1, url: page.url, status: 'complete' };
  const api = {
    runtime: { id: ID, getURL: extensionURL, onMessage: event('message') },
    storage: { local: storage(legacy || { schemaVersion: 2, profile, settings: { model: DEFAULT_MODEL, rememberKey: false } }), session: storage({ secret: 'DUMMY_DEEPSEEK_KEY' }) },
    tabs: { async query() { return [target]; }, async get(id) { if (id !== 1) throw new Error('missing tab'); return { ...target }; },
      async sendMessage(tabId, message, route) {
        outgoing.push({ tabId, message: structuredClone(message), route });
        if (pageHandler) return pageHandler(message);
        if (message.type === 'PREPARE_FIELDS') return { fields: fields || [{ id: 'F0', label: '姓名', componentType: 'native-input' }] };
        if (message.type === 'APPLY_FIELDS') return { filled: message.mappings.length, skipped: 0 };
        return { ok: true };
      }, onUpdated: event('updated'), onRemoved: event('tabRemoved') },
    scripting: { async executeScript(args) { outgoing.push({ injection: args }); return [{ frameId: 0, documentId: 'doc-1' }]; } },
    windows: { async create(args) { outgoing.push({ window: args }); return { id: 9, tabs: [{ id: 90 }] }; }, async remove() {}, onRemoved: event('windowRemoved') }
  };
  const controller = createController(api, async (url, init) => {
    requests.push({ url, init });
    if (fetcher) return fetcher(url, init);
    return { ok: true, async text() { return JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"mappings":[{"fieldId":"F0","sourceId":"S0"}]}' } }] }); } };
  });
  controller.install();
  async function detect() {
    await controller.handle({ type: 'START_DETECTION' }, popup);
    const flow = api.storage.session.data.flow_1;
    await controller.handle({ type: 'FORM_DETECTED', scanToken: flow.scanToken }, page);
    return { ...flow, sender: { id: ID, url: extensionURL(`confirm/confirm.html?requestId=${flow.requestId}`), tab: { id: 90 } } };
  }
  return { api, controller, requests, outgoing, detect, target, listeners };
}

test('网页及伪装本地页面不能读取资料、设置接口、启动检测、调用 API 或确认', async () => {
  const f = fixture();
  for (const sender of [page, { ...options, id: 'other' }, { ...page, url: 'file:///options/options.html' }, { ...page, url: 'https://jobs.example/options/options.html' }]) {
    for (const type of ['GET_OPTIONS', 'SAVE_OPTIONS', 'START_DETECTION', 'TEST_CONNECTION', 'MATCH_FIELDS', 'APPLY_FIELDS']) {
      await assert.rejects(f.controller.handle({ type }, sender));
    }
  }
  await assert.rejects(f.controller.handle({ type: 'FILL_FORM', fields: [], profile: defaultProfile }, page));
  await assert.rejects(f.controller.handle({ type: 'PARSE_PDF', text: 'private' }, page));
  assert.equal(f.requests.length, 0);
  assert.equal(f.outgoing.length, 0);
});
test('检测通知必须有手动授权、匹配文档、URL、令牌和主框架', async () => {
  const f = fixture();
  await assert.rejects(f.controller.handle({ type: 'FORM_DETECTED', scanToken: 'fake' }, page));
  await f.controller.handle({ type: 'START_DETECTION' }, popup);
  const flow = f.api.storage.session.data.flow_1;
  for (const sender of [{ ...page, frameId: 2 }, { ...page, documentId: 'new-doc' }, { ...page, url: 'https://evil.invalid/' }]) {
    await assert.rejects(f.controller.handle({ type: 'FORM_DETECTED', scanToken: flow.scanToken }, sender));
  }
  await assert.rejects(f.controller.handle({ type: 'FORM_DETECTED', scanToken: 'fake' }, page));
  assert.equal(f.requests.length, 0);
});
test('必须两次确认；API 不发送任何资料值，实际填写只使用本地值', async () => {
  const f = fixture();
  const flow = await f.detect();
  assert.equal(f.requests.length, 0);
  assert.equal(f.outgoing.filter(item => item.message?.type === 'APPLY_FIELDS').length, 0);
  await assert.rejects(f.controller.handle({ type: 'APPLY_FIELDS', requestId: flow.requestId, fieldIds: ['F0'] }, flow.sender));
  const matched = await f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], overwrite: false }, flow.sender);
  assert.equal(matched.mappings[0].value, defaultProfile.basic.name);
  assert.equal(f.outgoing.filter(item => item.message?.type === 'APPLY_FIELDS').length, 0);
  const request = f.requests[0];
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.body.includes('PRIVATE_'), false);
  assert.equal(request.init.body.includes(page.url), false);
  assert.equal(request.init.body.includes('DUMMY_DEEPSEEK_KEY'), false);
  await assert.rejects(f.controller.handle({ type: 'APPLY_FIELDS', requestId: flow.requestId, fieldIds: ['F99'] }, flow.sender));
  const result = await f.controller.handle({ type: 'APPLY_FIELDS', requestId: flow.requestId, fieldIds: ['F0'] }, flow.sender);
  assert.equal(result.filled, 1);
  const applied = f.outgoing.find(item => item.message?.type === 'APPLY_FIELDS');
  assert.deepEqual(applied.route, { documentId: 'doc-1' });
  assert.equal(applied.message.mappings[0].value, defaultProfile.basic.name);
  assert.equal(applied.message.apiKey, undefined);
  assert.equal((await f.controller.handle({ type: 'GET_STATUS' }, popup)).active, false);
  await assert.rejects(f.controller.handle({ type: 'APPLY_FIELDS', requestId: flow.requestId, fieldIds: ['F0'] }, flow.sender));
});
test('其他扩展窗口不能代替原确认窗口', async () => {
  const f = fixture();
  const flow = await f.detect();
  await assert.rejects(f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], overwrite: false }, { ...flow.sender, tab: { id: 99 } }));
  assert.equal(f.requests.length, 0);
});
test('取消检测、刷新、改变 URL 或确认过期后不能继续匹配', async () => {
  for (const action of ['cancel', 'navigate', 'expire', 'reload']) {
    const f = fixture();
    const flow = await f.detect();
    if (action === 'cancel') await f.controller.handle({ type: 'CANCEL_CONFIRMATION', requestId: flow.requestId }, flow.sender);
    if (action === 'navigate') f.target.url = 'https://jobs.example/other';
    if (action === 'expire') f.api.storage.session.data.flow_1.createdAt -= 11 * 60 * 1000;
    if (action === 'reload') { f.listeners.updated(1, { status: 'loading' }); await new Promise(resolve => setImmediate(resolve)); }
    await assert.rejects(f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], overwrite: false }, flow.sender));
    assert.equal(f.requests.length, 0);
  }
});
test('AI 注入 selector/value 或选择未授权资料时不写入网页', async () => {
  for (const mapping of [{ fieldId: 'F0', sourceId: 'S0', selector: '#password' }, { fieldId: 'F0', sourceId: 'S0', value: 'evil' }, { fieldId: 'F0', sourceId: 'S2' }]) {
    const f = fixture({ fetcher: async () => ({ ok: true, async text() { return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ mappings: [mapping] }) } }] }); } }) });
    const flow = await f.detect();
    await assert.rejects(f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], overwrite: false }, flow.sender));
    assert.equal(f.outgoing.some(item => item.message?.type === 'APPLY_FIELDS'), false);
  }
});
test('默认密钥只保存在会话；明确勾选才持久保存，读取设置不回显', async () => {
  const f = fixture();
  await f.controller.handle({ type: 'SAVE_OPTIONS', profile: defaultProfile, model: DEFAULT_MODEL, apiKey: 'NEW_KEY', rememberKey: false }, options);
  assert.equal(f.api.storage.session.data.secret, 'NEW_KEY');
  assert.equal(f.api.storage.local.data.secret, undefined);
  assert.equal(f.api.storage.local.access, 'TRUSTED_CONTEXTS');
  assert.equal(f.api.storage.session.access, 'TRUSTED_CONTEXTS');
  assert.equal(JSON.stringify(await f.controller.handle({ type: 'GET_OPTIONS' }, options)).includes('NEW_KEY'), false);
  await f.controller.handle({ type: 'SAVE_OPTIONS', profile: defaultProfile, model: DEFAULT_MODEL, apiKey: '', rememberKey: true }, options);
  assert.equal(f.api.storage.local.data.secret, 'NEW_KEY');
  assert.equal(f.api.storage.session.data.secret, undefined);
  await f.controller.handle({ type: 'CLEAR_KEY' }, options);
  assert.equal(f.api.storage.local.data.secret, undefined);
});
test('旧版资料迁移，但不沿用任意服务商密钥或 PDF 结果', async () => {
  const f = fixture({ legacy: { basic: { name: 'OLD_NAME' }, education: [], llm: { baseUrl: 'https://evil.invalid', apiKey: 'OLD_KEY' }, pendingPdfProfile: { basic: { name: 'PDF_NAME' } } } });
  await f.controller.ready;
  assert.equal(f.api.storage.local.data.profile.basic.name, 'OLD_NAME');
  assert.equal(f.api.storage.local.data.basic, undefined);
  assert.equal(f.api.storage.local.data.llm, undefined);
  assert.equal(f.api.storage.local.data.pendingPdfProfile, undefined);
});
test('关闭确认窗口会中止请求且不产生填写预览或写入', async () => {
  let started;
  const begin = new Promise(resolve => { started = resolve; });
  const f = fixture({ fetcher: async (url, init) => {
    started();
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  } });
  const flow = await f.detect();
  const matching = f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], overwrite: false }, flow.sender);
  const rejected = assert.rejects(matching, /取消|停止/);
  await begin;
  f.listeners.windowRemoved(9);
  await rejected;
  assert.equal(f.outgoing.some(item => item.message?.type === 'APPLY_FIELDS'), false);
});
test('失败 API 不自动重试，不回显可能含密钥的响应正文', async () => {
  const f = fixture({ fetcher: async () => ({ ok: false, status: 401, async text() { return 'DUMMY_DEEPSEEK_KEY'; } }) });
  const flow = await f.detect();
  await assert.rejects(f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], overwrite: false }, flow.sender), error => !error.message.includes('DUMMY_DEEPSEEK_KEY') && error.message.includes('401'));
  assert.equal(f.requests.length, 1);
});

test('并发点击确认只允许一份匹配请求', async () => {
  let complete;
  const f = fixture({ fetcher: async () => new Promise(resolve => {
    complete = () => resolve({ ok: true, async text() { return JSON.stringify({ choices: [{ message: { content: '{"mappings":[{"fieldId":"F0","sourceId":"S0"}]}' } }] }); } });
  }) });
  const flow = await f.detect();
  const message = { type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], overwrite: false };
  const first = f.controller.handle(message, flow.sender);
  const second = f.controller.handle(message, flow.sender);
  const outcomes = Promise.allSettled([first, second]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
  complete();
  const results = await outcomes;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
});

test('后台意外重启后不自动重试匹配或继续填写', async () => {
  for (const state of ['matching', 'applying']) {
    const f = fixture();
    const flow = await f.detect();
    f.api.storage.session.data.flow_1.status = state;
    const restarted = createController(f.api, () => { throw new Error('must not call API'); });
    const confirmation = await restarted.handle({ type: 'GET_CONFIRMATION', requestId: flow.requestId }, flow.sender);
    assert.equal(confirmation.status, state === 'matching' ? 'detected' : 'error');
    assert.ok(confirmation.flowError.includes('重新启动'));
    assert.equal(f.requests.length, 0);
    assert.equal(f.outgoing.some(item => item.message?.type === 'APPLY_FIELDS'), false);
  }
});

function modelResponse(result) {
  return { ok: true, async text() { return JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }); } };
}

test('完整流程按所选数量添加两段教育、三段项目和奖项，二次确认前不写个人值', async () => {
  const dom = domFixture();
  const basic = dom.section('基本信息'); dom.record(basic, [['姓名'], ['预计毕业时间', { type: 'month' }]]);
  const edu = dom.section('教育经历'), projects = dom.section('项目经验', { label: '+ 添加项目经验', tag: 'div' }), awards = dom.section('获奖信息');
  const eduFields = [['学校名称'], ['开始时间'], ['结束时间']];
  dom.record(edu, eduFields);
  edu.button.onClick = () => dom.record(edu, eduFields);
  projects.button.onClick = () => dom.record(projects, [['项目名称'], ['开始时间'], ['结束时间']]);
  awards.button.onClick = () => dom.record(awards, [['奖项名称'], ['获奖内容', { tag: 'textarea' }]]);
  const profile = normalizeProfile({ basic: { name: 'PRIVATE_DEMO', expectedGraduationDate: '2027-06', idCard: 'NEVER_SEND_ID' },
    education: [{ school: '演示本科大学', startDate: '2020-09', endDate: '2024-06' }, { school: '演示研究生大学', startDate: '2024-09', endDate: '2027-06' }],
    projects: Array.from({ length: 3 }, (_, i) => ({ projectName: `演示项目${i + 1}`, startDate: `202${i + 1}-01`, endDate: `202${i + 1}-06` })),
    awards: [{ name: '演示奖项', description: '演示获奖内容' }] });
  const keys = { '姓名': 'name', '预计毕业时间': 'expectedGraduationDate', '学校名称': 'school', '开始时间': 'startDate', '结束时间': 'endDate', '项目名称': 'projectName', '奖项名称': 'name', '获奖内容': 'description' };
  const f = fixture({ profile, pageHandler: dom.send, fetcher: async (url, init) => {
    const { fields, sources } = JSON.parse(JSON.parse(init.body).messages[1].content);
    return modelResponse({ mappings: fields.map(field => {
      const source = sources.find(source => source.section === field.section && source.fieldKey === keys[field.label]
        && (field.recordIndex === null || source.recordIndex === field.recordIndex));
      return { fieldId: field.id, sourceId: source.id };
    }) });
  } });
  const flow = await f.detect();
  assert.equal(dom.events.length, 0);
  const sourceIds = profileSources(profile).map(source => source.id);
  await f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds, autoAdd: true, aiAssist: false, overwrite: false }, flow.sender);
  assert.equal(edu.list.children.length, 2); assert.equal(projects.list.children.length, 3); assert.equal(awards.list.children.length, 1);
  assert.ok(dom.doc.querySelectorAll('input,textarea').every(input => input.value === ''));
  assert.ok(f.requests.every(request => !request.init.body.includes('PRIVATE_DEMO') && !request.init.body.includes('演示本科大学')));
  const preview = await f.controller.handle({ type: 'GET_CONFIRMATION', requestId: flow.requestId }, flow.sender);
  const result = await f.controller.handle({ type: 'APPLY_FIELDS', requestId: flow.requestId, fieldIds: preview.mappings.map(mapping => mapping.fieldId) }, flow.sender);
  assert.equal(result.filled, 19);
  assert.deepEqual(edu.list.children.map(record => record.querySelectorAll('input').map(input => input.value)),
    [['演示本科大学', '2020-09', '2024-06'], ['演示研究生大学', '2024-09', '2027-06']]);
  assert.deepEqual(projects.list.children.map(record => record.querySelector('input').value), ['演示项目1', '演示项目2', '演示项目3']);
  assert.equal(basic.list.querySelectorAll('input')[1].value, '2027-06');
});

test('明确开启 AI 辅助才上传所选资料和对应已有值，并校对真实读回结果', async () => {
  const dom = domFixture(); const basic = dom.section('基本信息'); dom.record(basic, [['姓名', { value: 'PRIVATE_OLD_NAME' }], ['手机号']]);
  const f = fixture({ pageHandler: dom.send, fetcher: async (url, init) => {
    const data = JSON.parse(JSON.parse(init.body).messages[1].content);
    if (!data.phase) return modelResponse({ mappings: [{ fieldId: 'F0', sourceId: 'S0' }, { fieldId: 'F1', sourceId: 'S1' }] });
    return modelResponse({ reviews: data.fields.map(field => ({ fieldId: field.id, status: field.id === 'F0' ? 'warning' : 'ok', reason: '演示校对结果' })) });
  } });
  const flow = await f.detect();
  const preview = await f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0', 'S1'], aiAssist: true, overwrite: false }, flow.sender);
  assert.equal(preview.reviews[0].status, 'warning'); assert.equal(f.requests.length, 2);
  assert.ok(f.requests[0].init.body.includes('PRIVATE_NAME_876'));
  assert.ok(f.requests[1].init.body.includes('PRIVATE_OLD_NAME'));
  assert.ok(f.requests.every(request => !request.init.body.includes('PRIVATE_ID_876') && !request.init.body.includes('PRIVATE_DESCRIPTION_876')));
  const result = await f.controller.handle({ type: 'APPLY_FIELDS', requestId: flow.requestId, fieldIds: ['F1'] }, flow.sender);
  assert.equal(result.filled, 1); assert.equal(result.reviews.length, 2);
  const audit = JSON.parse(JSON.parse(f.requests[2].init.body).messages[1].content);
  assert.equal(audit.phase, 'after');
  assert.equal(audit.fields.find(field => field.id === 'F1').observedValue, 'PRIVATE_PHONE_876');
  assert.equal(audit.fields.find(field => field.id === 'F0').observedValue, 'PRIVATE_OLD_NAME');
  assert.equal(result.readback, undefined);
});

test('AI 填写后校对失败仍准确报告已填写数量，不把模型建议当成修改值', async () => {
  const dom = domFixture(); const basic = dom.section('基本信息'); dom.record(basic, [['姓名']]);
  let calls = 0;
  const f = fixture({ pageHandler: dom.send, fetcher: async () => {
    calls++;
    if (calls === 1) return modelResponse({ mappings: [{ fieldId: 'F0', sourceId: 'S0' }] });
    if (calls === 2) return modelResponse({ reviews: [{ fieldId: 'F0', status: 'ok', reason: '检查完成' }] });
    return modelResponse({ reviews: [{ fieldId: 'F0', status: 'warning', reason: '修改', value: 'MODEL_INVENTED' }] });
  } });
  const flow = await f.detect();
  await f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], aiAssist: true, overwrite: false }, flow.sender);
  const result = await f.controller.handle({ type: 'APPLY_FIELDS', requestId: flow.requestId, fieldIds: ['F0'] }, flow.sender);
  assert.equal(result.filled, 1); assert.ok(result.reviewError); assert.equal(result.readback, undefined);
  assert.equal(basic.list.querySelector('input').value, 'PRIVATE_NAME_876');
});

test('未经确认不能自动添加或读已有值，非布尔辅助开关被拒绝', async () => {
  const f = fixture();
  for (const type of ['ENSURE_RECORDS', 'READ_VALUES', 'CHANGE_MAPPING']) await assert.rejects(f.controller.handle({ type }, page));
  const flow = await f.detect();
  for (const flag of ['aiAssist', 'autoAdd', 'relaxed']) await assert.rejects(f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], overwrite: false, [flag]: 'true' }, flow.sender));
  assert.equal(f.requests.length, 0); assert.equal(f.outgoing.some(item => item.message?.type === 'ENSURE_RECORDS'), false);
});

test('模型跨教育工作映射被阻止，人工调整也不能跨已知区块或条目', async () => {
  const profile = normalizeProfile({ education: [{ school: '演示学校' }], work: [{ company: '演示公司' }] });
  const sources = profileSources(profile), school = sources.find(source => source.key === 'education.0.school'), company = sources.find(source => source.key === 'work.0.company');
  const fields = [{ id: 'F0', section: 'education', recordIndex: 0, label: '学校名称', componentType: 'native-input' }];
  const bad = fixture({ profile, fields, fetcher: async () => modelResponse({ mappings: [{ fieldId: 'F0', sourceId: company.id }] }) });
  let flow = await bad.detect();
  await assert.rejects(bad.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: sources.map(source => source.id), overwrite: false }, flow.sender), /错误的经历|未授权/);
  const good = fixture({ profile, fields, fetcher: async () => modelResponse({ mappings: [{ fieldId: 'F0', sourceId: school.id }] }) });
  flow = await good.detect();
  await good.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: sources.map(source => source.id), overwrite: false }, flow.sender);
  await assert.rejects(good.controller.handle({ type: 'CHANGE_MAPPING', requestId: flow.requestId, fieldId: 'F0', sourceId: company.id }, flow.sender), /不能跨/);
  const preview = await good.controller.handle({ type: 'GET_CONFIRMATION', requestId: flow.requestId }, flow.sender);
  assert.equal(preview.mappings[0].value, '演示学校');
});

test('大页面分批匹配且每个字段只出现一次，每批不超过60个字段', async () => {
  const fields = Array.from({ length: 121 }, (_, i) => ({ id: `F${i}`, label: '姓名', section: 'basic', componentType: 'native-input' }));
  const f = fixture({ fields, fetcher: async (url, init) => {
    const { fields } = JSON.parse(JSON.parse(init.body).messages[1].content);
    assert.ok(fields.length <= 60);
    return modelResponse({ mappings: fields.map(field => ({ fieldId: field.id, sourceId: 'S0' })) });
  } });
  const flow = await f.detect();
  const preview = await f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], overwrite: false }, flow.sender);
  assert.equal(f.requests.length, 3); assert.equal(preview.mappings.length, 121);
  assert.equal(new Set(preview.mappings.map(mapping => mapping.fieldId)).size, 121);
});

test('失败映射的诊断可在确认与设置页读取；网页和其他窗口不能读取，且不包含私人内容', async () => {
  const profile = normalizeProfile({ education: [{ school: 'PRIVATE_SCHOOL', startDate: '2020-09', endDate: '2024-06' }] });
  const sources = profileSources(profile), start = sources.find(source => source.fieldKey === 'startDate'), end = sources.find(source => source.fieldKey === 'endDate');
  const fields = [{ id: 'F0', section: 'education', recordIndex: 0, label: '开始时间', name: 'PRIVATE_WEB_NAME', sectionLabel: 'PRIVATE_HEADING', componentType: 'native-input' },
    { id: 'F1', section: 'education', recordIndex: 0, label: '结束时间', componentType: 'native-input' }];
  const f = fixture({ profile, fields, fetcher: async () => modelResponse({ mappings: [{ fieldId: 'F0', sourceId: end.id }] }) });
  const flow = await f.detect();
  await assert.rejects(f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: sources.map(source => source.id), aiAssist: true, overwrite: false }, flow.sender), /F0.*开始时间.*结束时间/);
  const { diagnostic } = await f.controller.handle({ type: 'GET_DIAGNOSTICS', requestId: flow.requestId }, flow.sender);
  assert.equal(diagnostic.rejection.reason, 'field_mismatch');
  assert.deepEqual(diagnostic.rejection.allowedSourceIds, [start.id]);
  assert.equal(diagnostic.options.aiAssist, true);
  const text = JSON.stringify(diagnostic);
  assert.equal(/PRIVATE_|DUMMY_DEEPSEEK_KEY|jobs.example|2020-09|2024-06|开始时间|结束时间/.test(text), false);
  assert.equal(f.outgoing.some(item => item.message?.type === 'APPLY_FIELDS'), false);
  const preview = await f.controller.handle({ type: 'GET_CONFIRMATION', requestId: flow.requestId }, flow.sender);
  assert.deepEqual(preview.diagnostic, diagnostic); assert.ok(preview.flowError.includes('F0')); assert.equal(preview.error, undefined);
  for (const sender of [page, popup, { ...flow.sender, tab: { id: 999 } }]) {
    await assert.rejects(f.controller.handle({ type: 'GET_DIAGNOSTICS', requestId: flow.requestId }, sender));
  }
  await f.controller.handle({ type: 'CANCEL_CONFIRMATION', requestId: flow.requestId }, flow.sender);
  assert.deepEqual((await f.controller.handle({ type: 'GET_DIAGNOSTICS' }, options)).diagnostic, diagnostic);
});

test('发送给模型的每字段候选编号已经通过本地校验，无法判断的字段候选为空', async () => {
  const profile = normalizeProfile({ basic: { name: 'PRIVATE_NAME' }, education: [{ school: 'PRIVATE_SCHOOL' }], work: [{ company: 'PRIVATE_COMPANY' }] });
  const sources = profileSources(profile);
  const fields = [{ id: 'F0', section: 'basic', label: '姓名', componentType: 'native-input' },
    { id: 'F1', section: 'education', recordIndex: 0, label: '学校名称', componentType: 'native-input' },
    { id: 'F2', section: 'work', recordIndex: 0, label: '公司名称', componentType: 'native-input' },
    { id: 'F3', section: 'unknown', label: '开始时间', componentType: 'native-input' }];
  const f = fixture({ profile, fields, fetcher: async (url, init) => {
    const input = JSON.parse(JSON.parse(init.body).messages[1].content);
    assert.deepEqual(input.fields.map(field => field.allowedSourceIds), [[sources[0].id], [sources[1].id], [sources[2].id], []]);
    assert.equal(init.body.includes('PRIVATE_'), false);
    return modelResponse({ mappings: input.fields.slice(0, 3).map(field => ({ fieldId: field.id, sourceId: field.allowedSourceIds[0] })) });
  } });
  const flow = await f.detect();
  await f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: sources.map(source => source.id), overwrite: false }, flow.sender);
  const { diagnostic } = await f.controller.handle({ type: 'GET_DIAGNOSTICS' }, options);
  assert.equal(diagnostic.status, 'preview'); assert.equal(diagnostic.counts.matched, 3);
});

test('格式异常和接口失败只记录固定诊断代码，不记录模型回复或错误正文', async () => {
  const f = fixture({ fetcher: async () => modelResponse({ mappings: [{ fieldId: 'F0', sourceId: 'S0', PRIVATE_REPLY: 'PRIVATE_RESPONSE' }] }) });
  assert.equal((await f.controller.handle({ type: 'GET_DIAGNOSTICS' }, options)).diagnostic, null);
  const flow = await f.detect();
  await assert.rejects(f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], overwrite: false }, flow.sender));
  const { diagnostic } = await f.controller.handle({ type: 'GET_DIAGNOSTICS' }, options);
  assert.equal(diagnostic.failureCode, 'MATCH_FAILED');
  assert.equal(/PRIVATE_|DUMMY_DEEPSEEK_KEY/.test(JSON.stringify(diagnostic)), false);
  assert.equal(diagnostic.rejection, undefined);
});

test('模糊模式允许未知经历进入预览，资料仍只从所选本地项取值且必须二次确认', async () => {
  const profile = normalizeProfile({ education: [{ school: 'PRIVATE_DEMO_SCHOOL' }], basic: { idCard: 'PRIVATE_UNSELECTED_ID' } });
  const source = profileSources(profile).find(source => source.fieldKey === 'school');
  const f = fixture({ profile, fields: [{ id: 'F0', section: 'unknown', label: '学习单位', componentType: 'native-input' }], fetcher: async (url, init) => {
    const input = JSON.parse(JSON.parse(init.body).messages[1].content);
    assert.equal(input.relaxed, true); assert.deepEqual(input.fields[0].allowedSourceIds, [source.id]);
    assert.equal(init.body.includes('PRIVATE_'), false);
    return modelResponse({ mappings: [{ fieldId: 'F0', sourceId: source.id }] });
  } });
  const flow = await f.detect();
  const result = await f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: [source.id], relaxed: true, overwrite: false }, flow.sender);
  assert.equal(result.mappings[0].value, 'PRIVATE_DEMO_SCHOOL'); assert.equal(result.mappings[0].needsReview, true);
  assert.equal(f.outgoing.some(item => item.message?.type === 'APPLY_FIELDS'), false);
  const preview = await f.controller.handle({ type: 'GET_CONFIRMATION', requestId: flow.requestId }, flow.sender);
  assert.equal(preview.relaxed, true); assert.equal(preview.choices[0].sources.length, 1);
  const { diagnostic } = await f.controller.handle({ type: 'GET_DIAGNOSTICS' }, options);
  assert.equal(diagnostic.warnings[0].reason, 'unknown_section'); assert.equal(JSON.stringify(diagnostic).includes('PRIVATE_'), false);
  await f.controller.handle({ type: 'APPLY_FIELDS', requestId: flow.requestId, fieldIds: ['F0'] }, flow.sender);
  assert.equal(f.outgoing.find(item => item.message?.type === 'APPLY_FIELDS').message.mappings[0].value, 'PRIVATE_DEMO_SCHOOL');
});

test('截图所示 F3 其他信息映射到基本信息：模糊模式应进入待审核预览，严格模式才拦截', async () => {
  for (const relaxed of [true, false]) {
    const profile = normalizeProfile({ basic: { nativePlace: '演示籍贯' } });
    const source = profileSources(profile)[0];
    const f = fixture({ profile, fields: [{ id: 'F3', section: 'other', recordIndex: null, placeholder: '请选择', componentType: 'custom-dropdown' },
      { id: 'F49', section: 'unknown', label: '备用字段', componentType: 'native-input' }],
      fetcher: async () => modelResponse({ mappings: [{ fieldId: 'F3', sourceId: source.id }] }) });
    const flow = await f.detect();
    const operation = f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: [source.id], relaxed, overwrite: true }, flow.sender);
    if (relaxed) {
      const preview = await operation;
      assert.equal(preview.mappings[0].fieldId, 'F3'); assert.equal(preview.mappings[0].needsReview, true);
      assert.equal(preview.mappings[0].conflict, 'section_mismatch');
      assert.equal((await f.controller.handle({ type: 'GET_CONFIRMATION', requestId: flow.requestId }, flow.sender)).status, 'preview');
    } else await assert.rejects(operation, /F3.*其他信息.*基本信息/);
    const { diagnostic } = await f.controller.handle({ type: 'GET_DIAGNOSTICS' }, options);
    assert.equal(diagnostic.options.relaxed, relaxed);
    assert.equal(diagnostic.status, relaxed ? 'preview' : 'failed');
    assert.equal(f.outgoing.some(item => item.message?.type === 'APPLY_FIELDS'), false);
  }
});

test('模型把第二段起止日期选成第一段时，明确的本机条目匹配优先纠正', async () => {
  const profile = normalizeProfile({ education: [
    { school: 'DEMO_SCHOOL_A', startDate: '2024-09-13', endDate: '2027-06-22' },
    { school: 'DEMO_SCHOOL_B', startDate: '2020-09-07', endDate: '2024-06-18' }
  ] });
  const allSources = profileSources(profile);
  const wrongSource = allSources.find(source => source.recordIndex === 0 && source.fieldKey === 'startDate');
  const f = fixture({ profile, fields: [{ id: 'F16', label: '开始时间', componentType: 'custom-datepicker', section: 'education', recordIndex: 1 }],
    fetcher: async () => ({ ok: true, async text() { return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ mappings: [{ fieldId: 'F16', sourceId: wrongSource.id }] }) } }] }); } }) });
  const flow = await f.detect();
  const result = await f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: allSources.map(source => source.id), relaxed: true, overwrite: false }, flow.sender);
  assert.equal(result.mappings[0].value, '2020-09-07');
  assert.equal(result.mappings[0].matchedBy, 'local');
  assert.equal(f.requests.some(request => /DEMO_SCHOOL|2020-09-07/.test(request.init.body)), false);
});

test('完成后的诊断记录对应关系和实际执行状态，不保存字段标签或私人值', async () => {
  const f = fixture({ pageHandler: message => {
    if (message.type === 'PREPARE_FIELDS') return { fields: [{ id: 'F0', label: '姓名', componentType: 'native-input' }] };
    if (message.type === 'APPLY_FIELDS') return { filled: 0, skipped: 1, outcomes: [{ fieldId: 'F0', status: 'skipped', reason: 'selection_not_committed', value: 'PRIVATE_BAD_VALUE' }] };
    return { ok: true };
  } });
  const flow = await f.detect();
  await f.controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: ['S0'], overwrite: false }, flow.sender);
  await f.controller.handle({ type: 'APPLY_FIELDS', requestId: flow.requestId, fieldIds: ['F0'] }, flow.sender);
  const diagnostic = (await f.controller.handle({ type: 'GET_DIAGNOSTICS' }, options)).diagnostic;
  assert.equal(diagnostic.status, 'completed');
  assert.deepEqual(diagnostic.outcomes, [{ fieldId: 'F0', status: 'skipped', reason: 'selection_not_committed' }]);
  assert.deepEqual(diagnostic.mappings, [{ fieldId: 'F0', sourceId: 'S0', matchedBy: 'local' }]);
  assert.equal(/PRIVATE_|姓名/.test(JSON.stringify(diagnostic)), false);
});
