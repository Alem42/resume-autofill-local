import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Small DOM adapter for exercising real content scripts against independent form layouts.
export function domFixture() {
  const events = [], messages = [];
  const timers = new Map();
  let listener, nextTimer = 0, doc;
  class Element {
    constructor(tag, attrs = {}, text = '') {
      this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = [];
      this.parentElement = null; this._text = text; this._value = attrs.value || ''; this.style = {};
      this.disabled = false; this.readOnly = false; this.hidden = false;
    }
    get ownerDocument() { return doc; }
    get isConnected() { return this === doc.body || Boolean(this.parentElement?.isConnected); }
    get id() { return this.attrs.id || ''; }
    get name() { return this.attrs.name || ''; }
    get className() { return this.attrs.class || ''; }
    get placeholder() { return this.attrs.placeholder || ''; }
    get type() { return this.attrs.type || (this.tagName === 'BUTTON' ? 'submit' : 'text'); }
    get isContentEditable() { return this.attrs.contenteditable === 'true'; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = value; this.children = []; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
    cloneNode(deep) { const clone = new Element(this.tagName, this.attrs, this._text); if (deep) clone.append(...this.children.map(child => child.cloneNode(true))); return clone; }
    matches(selector) {
      return selector.split(',').some(raw => {
        let value = raw.trim();
        const not = [...value.matchAll(/:not\(([^)]+)\)/g)];
        value = value.replace(/:not\([^)]+\)/g, '');
        if (not.some(match => this.matches(match[1]))) return false;
        const tag = /^[A-Za-z][A-Za-z0-9-]*/.exec(value)?.[0];
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        for (const match of value.matchAll(/\.([\w-]+)/g)) if (!this.className.split(' ').includes(match[1])) return false;
        for (const match of value.matchAll(/\[([\w-]+)(?:(\*=|=)"?([^\]"]*)"?)?\]/g)) {
          const actual = this.getAttribute(match[1]);
          if (actual === null) return false;
          if (match[2] === '=' && actual !== match[3]) return false;
          if (match[2] === '*=' && !actual.includes(match[3])) return false;
        }
        return Boolean(value === '*' || tag || value.startsWith('[') || value.startsWith('.'));
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) {
      const descendants = [];
      const visit = node => { for (const child of node.children) { descendants.push(child); visit(child); } };
      visit(this); return descendants.filter(node => node.matches(selector));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    compareDocumentPosition(other) {
      const visit = node => [node, ...node.children.flatMap(visit)];
      const nodes = visit(doc.body);
      return nodes.indexOf(this) < nodes.indexOf(other) ? 4 : 2;
    }
    getBoundingClientRect() { return { width: this.hidden ? 0 : 300, height: this.hidden ? 0 : 30, left: 0, top: 0, right: 300, bottom: 30 }; }
    dispatchEvent(event) { events.push({ target: this, type: event.type }); this.onEvent?.(event); }
    click() { events.push({ target: this, type: 'click' }); this.onClick?.(); }
    focus() { doc.activeElement = this; }
    blur() { doc.activeElement = doc.body; }
  }
  class Input extends Element {
    get value() { return this._value; }
    set value(value) {
      const text = String(value);
      this._value = this.type === 'month' && text && !/^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? '' : text;
    }
  }
  class Textarea extends Input {}
  doc = { title: '校招简历', querySelectorAll: selector => doc.body.querySelectorAll(selector),
    querySelector: selector => doc.body.querySelector(selector) };
  doc.body = new Element('body'); doc.documentElement = doc.body; doc.activeElement = doc.body;
  const node = (tag, attrs = {}, text = '') => ['input', 'textarea'].includes(tag)
    ? new (tag === 'textarea' ? Textarea : Input)(tag, attrs, text) : new Element(tag, attrs, text);
  const context = vm.createContext({ document: doc, location: { href: 'https://jobs.example/resume' },
    window: { getComputedStyle: el => ({ display: el.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }) },
    CSS: { escape: value => value }, Event: class { constructor(type) { this.type = type; } },
    KeyboardEvent: class { constructor(type) { this.type = type; } }, MouseEvent: class { constructor(type) { this.type = type; } }, HTMLInputElement: Input, HTMLTextAreaElement: Textarea,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout(fn, ms) { const id = ++nextTimer; if (ms < 500) queueMicrotask(fn); else timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    chrome: { runtime: { id: 'testextensionid', getURL: path => `chrome-extension://testextensionid/${path}`,
      onMessage: { addListener(fn) { listener = fn; } }, async sendMessage(message) { messages.push(message); } },
      get storage() { throw new Error('No content-script storage access'); } } });
  for (const path of ['shared/semantics-core.js', 'content/sections.js', 'content/content.js']) {
    vm.runInContext(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), context);
  }
  const send = message => new Promise((resolve, reject) => {
    let replied = false;
    try {
      const pending = listener({ scanToken: 'test-token', ...message },
        { id: 'testextensionid', url: 'chrome-extension://testextensionid/background/background.js' }, result => { replied = true; resolve(structuredClone(result)); });
      if (!pending && !replied) resolve(undefined);
    } catch (error) { reject(error); }
  });
  function section(title, { label = '添加' + title, tag = 'button', type = 'button' } = {}) {
    const root = node('section'); root.append(node('h2', {}, title));
    const list = node('div', { class: 'entry-list' }); root.append(list);
    const button = node(tag, tag === 'button' ? { type } : { class: 'bili-form-add', onclick: 'add()' }, label);
    root.append(button); doc.body.append(root);
    return { root, list, button };
  }
  function record(group, fields, { marker = true } = {}) {
    const root = node('div', marker ? { class: 'bili-form-multiple' } : {});
    for (const [label, attrs = {}] of fields) {
      const row = node('div', { class: 'form-item' });
      row.append(node('label', {}, label), node(attrs.tag || 'input', { name: label, ...attrs })); root.append(row);
    }
    group.list.append(root); return root;
  }
  return { node, doc, context, events, messages, send, section, record,
    start: () => send({ type: 'START_SCAN' }),
    prepare: options => send({ type: 'PREPARE_FIELDS', overwrite: false, ...options }) };
}
