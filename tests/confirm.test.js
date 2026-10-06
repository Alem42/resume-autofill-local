import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { domFixture } from './dom-fixture.js';
import { PROFILE_SCHEMA, selectedSources, recordTargets, profileSources, normalizeProfile, diagnosticReason } from '../shared/profile.js';

// Exercise the real confirmation UI against a small DOM adapter and a mock worker.
async function confirmation(data, handler) {
  const f = domFixture(), requests = [], nodes = new Map(), downloads = [];
  const proto = Object.getPrototypeOf(f.node('div'));
  for (const [key, attribute] of [['className', 'class'], ['type', 'type']]) {
    const getter = Object.getOwnPropertyDescriptor(proto, key).get;
    Object.defineProperty(proto, key, { get: getter, set(value) { this.attrs[attribute] = value; }, configurable: true });
  }
  proto.replaceChildren = function (...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); };
  proto.addEventListener = function (type, fn) { (this.listeners ||= {})[type] ||= []; this.listeners[type].push(fn); };
  f.doc.createElement = tag => { const node = f.node(tag); node.dataset = {}; return node; };
  f.doc.getElementById = id => nodes.get(id);
  const query = f.doc.querySelectorAll;
  f.doc.querySelectorAll = selector => {
    const scoped = /^#([\w-]+) input(:checked)?$/.exec(selector);
    if (scoped) return nodes.get(scoped[1]).querySelectorAll('input').filter(input => !scoped[2] || input.checked);
    return query(selector);
  };
  const html = readFileSync(new URL('../confirm/confirm.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<([a-z]+)([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = f.doc.createElement(match[1]); node.attrs.id = match[3];
    node.type = /\btype="([^"]+)"/.exec(match[2])?.[1] || 'text';
    node.checked = /\bchecked\b/.test(match[2]); node.hidden = /\bhidden\b/.test(match[2]);
    nodes.set(match[3], node); f.doc.body.append(node);
  }
  let current = structuredClone(data);
  f.context.Blob = class { constructor(parts) { this.text = parts.join(''); } };
  f.context.URL = class extends URL { static createObjectURL(blob) { downloads.push(JSON.parse(blob.text)); return 'blob:diagnostic'; } static revokeObjectURL() {} };
  f.context.location.href = 'chrome-extension://testextensionid/confirm/confirm.html?requestId=request-1';
  Object.assign(f.context, { PROFILE_SCHEMA, selectedSources, recordTargets, diagnosticReason });
  f.context.chrome.runtime.sendMessage = async message => {
    requests.push(structuredClone(message));
    if (message.type === 'GET_CONFIRMATION') return structuredClone(current);
    const reply = await handler?.(message);
    if (message.type === 'MATCH_FIELDS') current = { ...current, status: 'preview', mappings: [], unmatched: [] };
    return reply || { ok: true };
  };
  vm.runInContext(readFileSync(new URL('../shared/ui.js', import.meta.url), 'utf8').replaceAll('export ', ''), f.context);
  vm.runInContext(readFileSync(new URL('../confirm/confirm.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm, ''), f.context);
  await new Promise(resolve => setImmediate(resolve));
  async function fire(node, type, trusted = true) {
    for (const listener of node.listeners?.[type] || []) await listener({ isTrusted: trusted, target: node, currentTarget: node });
  }
  return { ...f, nodes, requests, downloads, fire };
}
const mapping = (fieldId, extra = {}) => ({ fieldId, sourceId: 'S0', fieldLabel: '姓名', sourceLabel: '基本信息 / 姓名', value: 'LOCAL_DEMO', componentType: 'native-input', ...extra });

test('确认预览默认不选疑点、未知结果和已有内容，并可展示手动调整入口', async () => {
  const f = await confirmation({ status: 'preview', url: 'https://jobs.example/resume', mappings: [mapping('F0'), mapping('F1'), mapping('F2'), mapping('F3', { hasValue: true })],
    reviews: [{ fieldId: 'F1', status: 'warning', reason: '<img src=x>' }, { fieldId: 'F2', status: 'uncertain', reason: '不确定' }],
    aiAssist: true, overwrite: false, choices: [{ fieldId: 'F0', section: 'basic', sources: [{ id: 'S0', label: '姓名' }] }] });
  const boxes = f.nodes.get('mappings').querySelectorAll('input');
  assert.deepEqual(boxes.map(box => Boolean(box.checked)), [true, false, false, false]);
  assert.equal(boxes[3].disabled, true);
  assert.ok(f.nodes.get('mappings').querySelector('select'));
  assert.ok(f.nodes.get('mappings').textContent.includes('<img src=x>'));
  assert.equal(f.nodes.get('mappings').querySelector('img'), null);
  await f.fire(f.nodes.get('apply'), 'click', false);
  assert.equal(f.requests.some(request => request.type === 'APPLY_FIELDS'), false);
});

test('校对失败时所有预览项默认不选，需要人工选择或明确只校对已有内容', async () => {
  const f = await confirmation({ status: 'preview', mappings: [mapping('F0')], aiAssist: true, overwrite: false, reviewError: '接口超时' });
  assert.equal(f.nodes.get('mappings').querySelector('input').checked, false);
  assert.ok(f.nodes.get('preparation-report').textContent.includes('接口超时'));
});

test('AI 上传默认关闭，第一次确认只传递用户实际选择的布尔开关', async () => {
  for (const assisted of [false, true]) {
    const f = await confirmation({ status: 'detected', sources: profileSources(normalizeProfile({ basic: { name: 'LOCAL_DEMO' } })) });
    assert.equal(f.nodes.get('ai-assist').checked, false); assert.equal(f.nodes.get('auto-add').checked, true);
    assert.equal(f.nodes.get('relaxed').checked, true);
    f.nodes.get('ai-assist').checked = assisted;
    await f.fire(f.nodes.get('match'), 'click');
    const message = f.requests.find(request => request.type === 'MATCH_FIELDS');
    assert.equal(message.aiAssist, assisted); assert.equal(message.autoAdd, true); assert.equal(message.overwrite, false);
    assert.equal(message.relaxed, true);
    assert.deepEqual(message.sourceIds, ['S0']);
  }
});

test('姓名证件地址等本地资料默认全部勾选，仍可取消并只授权剩余资料', async () => {
  const sources = profileSources(normalizeProfile({ basic: { name: 'DEMO_NAME', idCard: 'DEMO_ID', address: 'DEMO_ADDRESS' } }));
  const f = await confirmation({ status: 'detected', sources });
  const boxes = f.nodes.get('sources').querySelectorAll('input');
  assert.ok(boxes.every(box => box.checked));
  assert.equal(f.nodes.get('sources').textContent.includes('敏感'), false);
  boxes[1].checked = false;
  await f.fire(f.nodes.get('match'), 'click');
  assert.deepEqual(f.requests.find(request => request.type === 'MATCH_FIELDS').sourceIds, boxes.filter(box => box.checked).map(box => box.value));
  assert.equal(f.requests.find(request => request.type === 'MATCH_FIELDS').aiAssist, false);
});

test('未识别区块可通过可信操作手动绑定授权资料，并更新预览实际值', async () => {
  const updated = mapping('F0', { section: 'unknown', value: 'MANUAL_LOCAL_CONTENT' });
  const f = await confirmation({ status: 'preview', mappings: [], unmatched: [{ id: 'F0', section: 'unknown', label: '详细内容' }],
    choices: [{ fieldId: 'F0', section: 'unknown', sources: [{ id: 'S0', label: '第一条项目 / 描述' }] }], aiAssist: false },
  message => message.type === 'CHANGE_MAPPING' ? { mapping: updated } : { ok: true });
  const select = f.nodes.get('unmatched').querySelector('select'); select.value = 'S0';
  await f.fire(select, 'change');
  assert.ok(f.nodes.get('mappings').textContent.includes('MANUAL_LOCAL_CONTENT'));
  assert.equal(f.nodes.get('unmatched').children.length, 0);
  const request = f.requests.find(request => request.type === 'CHANGE_MAPPING');
  assert.equal(request.fieldId, 'F0'); assert.equal(request.sourceId, 'S0');
});

test('匹配失败时可见诊断并只导出后台返回的诊断数据，不导出确认页里的私人资料', async () => {
  const diagnostic = { schemaVersion: 1, status: 'failed', counts: { fields: 2, matched: 0 },
    rejection: { reason: 'record_mismatch', field: { id: 'F0', section: 'education', recordIndex: 0 },
      source: { id: 'S2', section: 'education', recordIndex: 1 } } };
  const f = await confirmation({ status: 'detected', url: 'https://jobs.example/private-path', sources: profileSources(normalizeProfile({ basic: { name: 'PRIVATE_NAME' } })),
    flowError: '匹配失败', diagnostic }, message => message.type === 'GET_DIAGNOSTICS' ? { diagnostic } : { ok: true });
  assert.equal(f.nodes.get('diagnostic-panel').hidden, false);
  assert.ok(f.nodes.get('diagnostic-summary').textContent.includes('第 1 条'));
  assert.ok(f.nodes.get('diagnostic-summary').textContent.includes('第 2 条'));
  await f.fire(f.nodes.get('export-diagnostic'), 'click', false);
  assert.equal(f.downloads.length, 0);
  await f.fire(f.nodes.get('export-diagnostic'), 'click');
  assert.deepEqual(f.downloads, [diagnostic]);
  const request = f.requests.find(request => request.type === 'GET_DIAGNOSTICS');
  assert.equal(request.requestId, 'request-1');
  assert.equal(/PRIVATE_|private-path/.test(JSON.stringify(f.downloads)), false);
});

test('模糊模式默认选中候选及AI疑点，但保护已有内容并显示待审核原因', async () => {
  const f = await confirmation({ status: 'preview', mappings: [mapping('F0', { needsReview: true, warning: '网页区块不明确' }), mapping('F1'), mapping('F2', { hasValue: true })],
    reviews: [{ fieldId: 'F0', status: 'warning', reason: '可能不匹配' }, { fieldId: 'F1', status: 'uncertain', reason: '不能确定' }],
    relaxed: true, aiAssist: true, reviewError: '接口超时', overwrite: false });
  const inputs = f.nodes.get('mappings').querySelectorAll('input');
  assert.deepEqual(inputs.map(input => Boolean(input.checked)), [true, true, false]);
  assert.equal(inputs[2].disabled, true); assert.ok(f.nodes.get('mappings').textContent.includes('网页区块不明确'));
  assert.ok(f.nodes.get('preparation-report').textContent.includes('模糊匹配已开启'));
});
