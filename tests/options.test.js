import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { domFixture } from './dom-fixture.js';
import { PROFILE_SCHEMA, TEXT_FIELDS, BOOLEAN_KEYS, MAX_ENTRIES, normalizeProfile, syncHighestEducation } from '../shared/profile.js';

async function optionsPage(profile) {
  const f = domFixture(), nodes = new Map(), requests = [];
  const prototype = Object.getPrototypeOf(f.node('div'));
  for (const key of ['className', 'type']) {
    const get = Object.getOwnPropertyDescriptor(prototype, key).get;
    Object.defineProperty(prototype, key, { get, set(value) { this.attrs[key === 'className' ? 'class' : key] = value; }, configurable: true });
  }
  prototype.addEventListener = function (type, fn) { (this.listeners ||= {})[type] ||= []; this.listeners[type].push(fn); };
  prototype.replaceChildren = function (...nodes) { [...this.children].forEach(node => node.remove()); this.append(...nodes); };
  f.doc.createElement = tag => {
    const node = f.node(tag); node.dataset = new Proxy({}, { set(target, key, value) {
      target[key] = value; node.attrs['data-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())] = value; return true;
    } }); return node;
  };
  f.doc.getElementById = id => nodes.get(id);
  f.doc.addEventListener = () => {};
  for (const match of readFileSync(new URL('../options/options.html', import.meta.url), 'utf8').matchAll(/<([a-z]+)([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = f.doc.createElement(match[1]); node.attrs.id = match[3]; node.value = ''; node.checked = false;
    nodes.set(match[3], node); f.doc.body.append(node);
  }
  f.context.chrome.runtime.sendMessage = async message => {
    requests.push(structuredClone(message));
    if (message.type === 'GET_OPTIONS') return { profile, model: 'deepseek-flash', rememberKey: false, hasKey: true };
    return { hasKey: true };
  };
  Object.assign(f.context, { PROFILE_SCHEMA, TEXT_FIELDS, BOOLEAN_KEYS, MAX_ENTRIES, normalizeProfile, syncHighestEducation });
  vm.runInContext(readFileSync(new URL('../shared/ui.js', import.meta.url), 'utf8').replaceAll('export ', ''), f.context);
  vm.runInContext(readFileSync(new URL('../options/options.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm, ''), f.context);
  await new Promise(resolve => setImmediate(resolve));
  const click = async id => { for (const fn of nodes.get(id).listeners?.click || []) await fn({ isTrusted: true, currentTarget: nodes.get(id) }); };
  return { ...f, nodes, requests, click };
}

test('设置页面加载并保存完整日期和 false 单选值，同步按钮实际更新基本学历及毕业年月', async () => {
  const profile = normalizeProfile({ basic: { highestDegree: '本科', expectedGraduationDate: '2024-06' },
    education: [{ school: 'DEMO_SCHOOL', degree: '硕士', isHighest: true, doubleDegree: false, startDate: '2024-09-13', endDate: '2027-06-22' }] });
  const f = await optionsPage(profile);
  assert.equal(f.nodes.get('save-options').disabled, false);
  assert.equal(f.doc.querySelector('select[data-key="doubleDegree"]').value, 'false');
  await f.click('sync-highest'); await f.click('save-options');
  const saved = f.requests.find(request => request.type === 'SAVE_OPTIONS');
  assert.ok(saved, f.nodes.get('status').textContent);
  assert.equal(saved.profile.education[0].doubleDegree, false);
  assert.equal(saved.profile.education[0].startDate, '2024-09-13');
  assert.equal(saved.profile.basic.highestDegree, '硕士');
  assert.equal(saved.profile.basic.expectedGraduationDate, '2027-06');
});
