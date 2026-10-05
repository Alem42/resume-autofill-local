import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { domFixture } from './dom-fixture.js';
import { PROFILE_SCHEMA, selectedSources, recordTargets, profileSources, normalizeProfile } from '../shared/profile.js';

// Exercise the real confirmation UI against a small DOM adapter and a mock worker.
async function confirmation(data, handler) {
  const f = domFixture(), requests = [], nodes = new Map();
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
  f.context.URL = URL;
  f.context.location.href = 'chrome-extension://testextensionid/confirm/confirm.html?requestId=request-1';
  Object.assign(f.context, { PROFILE_SCHEMA, selectedSources, recordTargets });
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
  return { ...f, nodes, requests, fire };
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
    f.nodes.get('ai-assist').checked = assisted;
    await f.fire(f.nodes.get('match'), 'click');
    const message = f.requests.find(request => request.type === 'MATCH_FIELDS');
    assert.equal(message.aiAssist, assisted); assert.equal(message.autoAdd, true); assert.equal(message.overwrite, false);
    assert.deepEqual(message.sourceIds, ['S0']);
  }
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
