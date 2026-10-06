import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');
const semantics = readFileSync(new URL('../shared/semantics-core.js', import.meta.url), 'utf8');
const sections = readFileSync(new URL('../content/sections.js', import.meta.url), 'utf8');
const extensionId = 'testextensionid';
const worker = { id: extensionId, url: `chrome-extension://${extensionId}/background/background.js` };
function fixture(fields = []) {
  let doc;
  const domEvents = [];
  const messages = [];
  const timers = new Map();
  let timerId = 0;
  let listener;
  let observerCount = 0;
  class Element {
    constructor(tag = 'INPUT', attrs = {}) {
      this.tagName = tag; this.attrs = { ...attrs }; this.type = attrs.type || 'text'; this.name = attrs.name || '';
      this.id = attrs.id || ''; this.placeholder = attrs.placeholder || ''; this.className = '';
      this.style = {}; this.children = []; this.isConnected = true; this.disabled = false; this.readOnly = false;
      this.parentElement = null; this.textContent = ''; this.isContentEditable = false; this._value = attrs.value || '';
    }
    get ownerDocument() { return doc; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest(selector) {
      if (this.attrs.inert && selector.includes('[inert]')) return this;
      if (this.attrs['aria-hidden'] === 'true' && selector.includes('[aria-hidden')) return this;
      return null;
    }
    getBoundingClientRect() { return { width: this.hidden ? 0 : 180, height: this.hidden ? 0 : 30, left: 0, top: 0, right: 180, bottom: 30 }; }
    dispatchEvent(event) { domEvents.push({ target: this, type: event.type }); this.onEvent?.(event); }
    focus() { doc.activeElement = this; }
    blur() { doc.activeElement = doc.body; }
    click() { domEvents.push({ target: this, type: 'click' }); }
  }
  class Input extends Element {
    get value() { return this._value; }
    set value(value) { this._value = String(value); }
  }
  class Textarea extends Element {
    constructor(attrs) { super('TEXTAREA', attrs); }
    get value() { return this._value; }
    set value(value) { this._value = String(value); }
  }
  const inputs = fields.map(attrs => attrs.tag === 'TEXTAREA' ? new Textarea(attrs) : new Input('INPUT', attrs));
  const body = new Element('BODY');
  doc = {
    body, activeElement: body, documentElement: body, title: '简历',
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === 'input, select, textarea') return inputs;
      if (selector.includes('[data-field]')) return inputs.filter(input => input.attrs['data-field']);
      if (selector === 'input[type="password"]') return inputs.filter(input => input.type === 'password');
      return [];
    }, dispatchEvent(event) { domEvents.push({ target: doc, type: event.type }); }
  };
  const context = vm.createContext({ document: doc, location: { href: 'https://jobs.example/apply' },
    window: { getComputedStyle: el => ({ display: el.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }) },
    CSS: { escape: value => value }, Event: class { constructor(type) { this.type = type; } }, KeyboardEvent: class { constructor(type) { this.type = type; } },
    HTMLInputElement: Input, HTMLTextAreaElement: Textarea,
    MutationObserver: class { constructor(callback) { observerCount++; this.callback = callback; } observe() {} disconnect() {} },
    setTimeout(fn, ms) { const id = ++timerId; if (ms < 500) queueMicrotask(fn); else timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    chrome: { runtime: { id: extensionId, getURL: path => `chrome-extension://${extensionId}/${path}`,
      onMessage: { addListener(fn) { listener = fn; } }, async sendMessage(message) { messages.push(message); return { pending: true }; } },
      get storage() { throw new Error('Content scripts must not access storage'); } }
  });
  vm.runInContext(semantics, context);
  vm.runInContext(sections, context);
  vm.runInContext(source, context);
  async function send(message, sender = worker) {
    return new Promise((resolve, reject) => {
      let replied = false;
      try {
        const pending = listener(message, sender, result => { replied = true; resolve(structuredClone(result)); });
        if (!pending && !replied) resolve(undefined);
      } catch (error) { reject(error); }
    });
  }
  const start = () => send({ type: 'START_SCAN', scanToken: 'test-token' });
  const prepare = overwrite => send({ type: 'PREPARE_FIELDS', scanToken: 'test-token', overwrite: Boolean(overwrite) });
  const apply = mappings => send({ type: 'APPLY_FIELDS', scanToken: 'test-token', mappings, overwrite: false });
  return { context, doc, inputs, domEvents, messages, start, prepare, apply, send, timers, get observerCount() { return observerCount; } };
}
test('注入脚本不会自动检测、读存储、添加按钮或绑定网页鼠标事件', async () => {
  const f = fixture([{ name: 'name', 'data-label': '姓名' }]);
  assert.equal(f.observerCount, 0);
  assert.equal(f.messages.length, 0);
  assert.equal(f.domEvents.length, 0);
  assert.equal(source.includes('chrome.storage'), false);
  assert.equal(source.includes("addEventListener('mousedown'"), false);
  assert.equal(source.includes('resume-autofill-btn'), false);
  assert.equal((await f.prepare()).error.includes('未开启'), true);
});
test('网页消息或错误令牌不能开启检测或执行填写', async () => {
  const f = fixture([{ name: 'name', 'data-label': '姓名' }]);
  assert.equal(await f.send({ type: 'START_SCAN', scanToken: 'test-token' }, { ...worker, url: 'https://jobs.example/apply', tab: { id: 1 } }), undefined);
  await f.start();
  const result = await f.send({ type: 'PREPARE_FIELDS', scanToken: 'other-token' });
  assert.ok(result.error);
  assert.equal(f.inputs[0].value, '');
});
test('手动检测只发送检测通知；准备字段也不写入任何值', async () => {
  const f = fixture([{ name: 'name', 'data-label': '姓名' }]);
  await f.start();
  assert.equal(f.messages[0].type, 'FORM_DETECTED');
  const prepared = await f.prepare();
  assert.equal(prepared.fields.length, 1);
  assert.equal(prepared.fields[0].id, 'F0');
  assert.equal(prepared.fields[0].selector, undefined);
  assert.equal(prepared.fields[0].value, undefined);
  assert.equal(f.inputs[0].value, '');
  assert.equal(f.domEvents.length, 0);
});
test('密码、文件、隐藏、验证码、禁用和已有值字段都不参与默认填写', async () => {
  const f = fixture([
    { name: 'name', 'data-label': '姓名' }, { type: 'password', name: 'password', 'data-field': 'password' },
    { type: 'hidden', name: 'csrf' }, { type: 'file', name: 'resume' }, { name: 'captcha', 'data-label': '验证码' },
    { name: 'existing', value: 'KEEP', 'data-label': '邮箱' }, { name: 'disabled', 'data-label': '手机' }
  ]);
  f.inputs[6].disabled = true;
  await f.start();
  const prepared = await f.prepare();
  assert.deepEqual(prepared.fields.map(field => field.name), ['name']);
});
test('填写按扫描元素引用执行；原生事件兼容受控输入，结果计数真实', async () => {
  const f = fixture([{ name: 'name', 'data-label': '姓名' }]);
  await f.start(); await f.prepare();
  const result = await f.apply([{ fieldId: 'F0', value: 'LOCAL_NAME', componentType: 'native-input' }]);
  assert.equal(f.inputs[0].value, 'LOCAL_NAME');
  assert.deepEqual(result, { filled: 1, skipped: 0, outcomes: [{ fieldId: 'F0', status: 'filled' }] });
  assert.ok(f.domEvents.some(event => event.type === 'input'));
  assert.equal(f.domEvents.some(event => event.type === 'click'), false);
  assert.equal(f.domEvents.some(event => event.target === f.doc), false);
});
test('预览后字段变成密码框、失联、隐藏、标签变化或出现已有值时跳过', async () => {
  for (const change of ['password', 'removed', 'hidden', 'label', 'existing']) {
    const f = fixture([{ name: 'name', 'data-label': '姓名' }]);
    await f.start(); await f.prepare();
    if (change === 'password') f.inputs[0].type = 'password';
    if (change === 'removed') f.inputs[0].isConnected = false;
    if (change === 'hidden') f.inputs[0].hidden = true;
    if (change === 'label') f.inputs[0].attrs['data-label'] = '别的字段';
    if (change === 'existing') f.inputs[0].value = 'USER_TYPED';
    const result = await f.apply([{ fieldId: 'F0', value: 'LOCAL_NAME', componentType: 'native-input' }]);
    assert.equal(result.filled, 0, change);
    assert.notEqual(f.inputs[0].value, 'LOCAL_NAME');
  }
});
test('取消后不能再执行预览；未知字段 ID 不会寻找 DOM selector', async () => {
  const f = fixture([{ name: 'name', 'data-label': '姓名' }]);
  await f.start(); await f.prepare();
  assert.ok((await f.apply([{ fieldId: '#password', value: 'LOCAL_NAME', componentType: 'native-input' }])).error);
  await f.send({ type: 'STOP_SCAN', scanToken: 'test-token' });
  assert.ok((await f.apply([{ fieldId: 'F0', value: 'LOCAL_NAME', componentType: 'native-input' }])).error);
  assert.equal(f.inputs[0].value, '');
});
test('无法被页面接受的赋值不会误计为成功', async () => {
  const f = fixture([{ name: 'name', 'data-label': '姓名' }]);
  f.inputs[0].onEvent = event => { if (event.type === 'change') f.inputs[0].value = ''; };
  await f.start(); await f.prepare();
  const result = await f.apply([{ fieldId: 'F0', value: 'LOCAL_NAME', componentType: 'native-input' }]);
  assert.equal(result.filled, 0);
});

test('标签提取剥离包裹的可编辑内容，不把已有值当作标签发送', async () => {
  const f = fixture([{ id: 'name-control', name: 'name' }]);
  f.doc.querySelector = selector => selector.startsWith('label[for=') ? {
    textContent: '姓名 PRIVATE_EXISTING',
    cloneNode() {
      let removed = false;
      return {
        get textContent() { return removed ? '姓名' : '姓名 PRIVATE_EXISTING'; },
        querySelectorAll(selector) { return selector.includes('[contenteditable]') ? [{ remove() { removed = true; } }] : []; }
      };
    }
  } : null;
  await f.start();
  const prepared = await f.prepare();
  assert.equal(prepared.fields[0].label, '姓名');
  assert.equal(JSON.stringify(prepared).includes('PRIVATE_EXISTING'), false);
});
