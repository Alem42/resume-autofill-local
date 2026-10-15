import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, until, sleep } from './chromium.mjs';
import { expected } from './component-kit.js';
import { normalizeProfile, profileSources, selectedSources, normalizeFields, localMatchPairs, validateMatches } from '../../shared/profile.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), output = resolve(root, '.preview/components');
const entries = { phoenix: 'components-phoenix.jsx', element2: 'components-element2.js', element: 'components-element.js', antd: 'components-react.jsx', arco: 'components-arco.jsx', tdesign: 'components-tdesign.js', naive: 'components-naive.js' };
await mkdir(output, { recursive: true });
console.log('Bundling pinned real UI components (test dependencies only)...');
for (const [key, file] of Object.entries(entries)) await build({ entryPoints: [resolve(root, 'tests/browser', file)], outfile: resolve(output, `${key}.js`), bundle: true,
  platform: 'browser', format: 'iife', minify: false, define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  ...(key === 'element2' ? { alias: { vue: 'vue2' } } : {}), loader: { '.woff': 'file', '.ttf': 'file', '.eot': 'file', '.svg': 'file' }, logLevel: 'error' });
const rcCSS = (await readFile(resolve(root, 'node_modules/rc-calendar/assets/index.css'), 'utf8')).replaceAll('rc-calendar', 'phoenix-calendar');
await writeFile(resolve(output, 'phoenix.css'), rcCSS + '\n.phoenix-calendar{position:fixed;top:110px;left:360px;z-index:3000}.phoenix-date-picker input{width:100%;padding:10px;border:1px solid #ccc}');
const css = 'body{font:14px "Segoe UI","Microsoft YaHei",sans-serif;background:#f7f9fc;padding:24px;max-width:850px;margin:auto}section{background:white;border:1px solid #dbe1eb;padding:20px;margin:20px 0;border-radius:12px}.form-item{display:grid;grid-template-columns:120px 1fr;align-items:center;margin:20px 0;min-height:40px}.form-item>label{font-weight:600}.form-item>div{min-width:0}.form-item input{font-size:14px}pre{white-space:pre-wrap}';
const server = createServer(async (req, res) => { try {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/component.html') {
    const lib = url.searchParams.get('lib'); if (!entries[lib]) throw new Error('Unknown library');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<html lang="zh-CN"><meta charset="utf-8"><title>${lib} 组件测试</title><style>${css}</style><link rel="stylesheet" href="/${lib}.css"><body><script src="/${lib}.js"></script></body></html>`); return;
  }
  if (url.pathname === '/manual.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<html><meta charset="utf-8"><title>手动填写优先测试</title><style>${css}</style><body><section><h2>基本信息</h2>
      <div class="form-item"><label>姓名</label><input name="name"></div><div class="form-item"><label>邮箱</label><input name="email"></div><div class="form-item"><label>手机号</label><input name="phone"></div>
      <div class="form-item"><label>性别</label><div><label><input type="radio" name="gender" value="男">男</label><label><input type="radio" name="gender" value="女">女</label></div></div>
      </section></body></html>`); return;
  }
  const file = resolve(output, '.' + decodeURIComponent(url.pathname)); if (!file.startsWith(output + sep)) throw new Error('Invalid path');
  res.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'application/octet-stream'); res.end(await readFile(file));
} catch { res.writeHead(404); res.end('Not found'); } });
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen)); const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
async function inject(page) {
  const { frameTree } = await browser.command('Page.getFrameTree', {}, page.sessionId);
  const { executionContextId } = await browser.command('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'resume-component-test' }, page.sessionId);
  const run = code => browser.evaluate(page, code, executionContextId);
  await run(`globalThis.__messages=[];globalThis.chrome={runtime:{id:'componenttest',getURL:p=>'chrome-extension://componenttest/'+p,onMessage:{addListener:f=>globalThis.__listener=f},sendMessage:async m=>{__messages.push(m);return {index:null}}}};
    globalThis.__send=m=>new Promise(resolve=>{const pending=__listener({scanToken:'components',...m},{id:'componenttest',url:chrome.runtime.getURL('background/background.js')},resolve);if(!pending&&m.type==='STOP_SCAN')resolve({ok:true})});`);
  for (const path of ['shared/semantics-core.js', 'content/sections.js', 'content/controls.js', 'content/content.js']) {
    await run(await readFile(resolve(root, path), 'utf8'));
    if (path === 'content/controls.js') await run(`{const original=globalThis.__resumeControls;globalThis.__componentTrace=[];globalThis.__resumeControls={...original,create:hooks=>original.create({...hooks,trace:t=>{hooks.trace?.(t);__componentTrace.push({...t,field:document.querySelector('[data-resume-autofill-indicator]')?.textContent,active:document.activeElement?.className})}})};}`);
  }
  const send = m => run(`__send(${JSON.stringify(m)})`); await send({ type: 'START_SCAN' }); return { run, send };
}
const profile = normalizeProfile({ education: [{ school: expected.school, startDate: expected.startDate, endDate: '2027-06-22', degree: '硕士' }], languageCertificates: [{ proficiency: '精通' }] });
const all = profileSources(profile), sources = selectedSources(all, all.map(s => s.id));
async function runLibrary(lib) {
  console.log(`[${lib}] Running production content script in real DOM...`);
  const page = await browser.page(`${origin}/component.html?lib=${lib}`); let data;
  try {
    await until(() => browser.evaluate(page, 'Boolean(window.componentTest?.ready && document.querySelector("input"))'), lib + ' mount', 20000); await sleep(200);
    const bridge = await inject(page), scanned = await bridge.send({ type: 'PREPARE_FIELDS', overwrite: false });
    if (scanned.error) throw new Error(scanned.error);
    const fields = normalizeFields(scanned.fields), mappings = validateMatches(JSON.stringify({ mappings: localMatchPairs(fields, sources) }), fields, sources);
    console.log(`[${lib}] ${fields.length} fields, ${mappings.length} local matches`, fields.map(f => `${f.label}:${f.componentType}`).join(', '));
    const result = await bridge.send({ type: 'APPLY_FIELDS', mappings, overwrite: false, auditFieldIds: fields.map(field => field.id) });
    const snapshot = await browser.evaluate(page, 'componentTest.snapshot()');
    const required = expected;
    const failures = Object.entries(required).filter(([key, value]) => snapshot.values[key] !== value).map(([key, value]) => ({ key, expected: value, actual: snapshot.values[key] ?? null }));
    for (const [caption, value] of [['学校名称', expected.school], ['开始时间', expected.startDate], ['结束时间', expected.endDate]]) {
      const field = fields.find(field => field.label === caption), actual = result.readback?.find(item => item.fieldId === field?.id);
      if (actual?.value !== value) failures.push({ readback: caption, expected: value, actual: actual?.value ?? null });
    }
    await bridge.send({ type: 'START_SCAN' });
    const rescanned = await bridge.send({ type: 'PREPARE_FIELDS', overwrite: false, includeExisting: true });
    if (rescanned.error) throw new Error(rescanned.error);
    for (const field of rescanned.fields) if (!field.hasValue) failures.push({ protection: field.label, hasValue: false });
    const protectedFill = await bridge.send({ type: 'APPLY_FIELDS', overwrite: false, mappings: rescanned.fields.map(field => ({ fieldId: field.id, componentType: field.componentType, value: 'SHOULD_NOT_OVERWRITE' })) });
    if (protectedFill.outcomes.some(item => item.reason !== 'existing_value')) failures.push({ protection: 'Existing selections were not all skipped' });
    assert.deepEqual(await browser.evaluate(page, 'componentTest.snapshot()'), snapshot, 'Preserve-existing check changed component values');
    data = { lib, fields, mappings, result, snapshot, failures, trace: await bridge.run('__componentTrace') };
    await writeFile(resolve(output, `${lib}-dom.html`), await browser.evaluate(page, 'document.documentElement.outerHTML'));
    await browser.screenshot(page, `${lib}.png`);
    if (failures.some(item => /Date$/.test(item.key))) {
      const key = failures.find(item => /Date$/.test(item.key)).key;
      await browser.evaluate(page, `{const input=document.querySelector('[data-test-field="${key}"] input');input.focus();input.click();}`); await sleep(400);
      await writeFile(resolve(output, `${lib}-probe.html`), await browser.evaluate(page, 'document.documentElement.outerHTML'));
    }
    console.log(`[${lib}] filled=${result.filled} skipped=${result.skipped} failures=${failures.length}`, JSON.stringify(failures));
  } catch (error) { data = { lib, error: error.message, failures: [{ error: error.message }] }; console.error(`[${lib}]`, error.message); }
  await writeFile(resolve(output, `${lib}-result.json`), JSON.stringify(data, null, 2));
  await browser.command('Target.closeTarget', { targetId: page.targetId }); return data;
}
async function manualCase(overwrite) {
  const page = await browser.page(`${origin}/manual.html`); await until(() => browser.evaluate(page, 'Boolean(document.querySelector("input[name=name]"))'), 'manual form');
  const bridge = await inject(page), scanned = await bridge.send({ type: 'PREPARE_FIELDS', overwrite });
  await browser.type(page, 'input[name=email]', 'manual@example.invalid');
  await browser.click(page, 'input[name=gender][value=男]');
  const values = { name: '自动姓名', email: 'automatic@example.invalid', phone: '00000000000', gender: '女' };
  const task = bridge.send({ type: 'APPLY_FIELDS', overwrite, mappings: scanned.fields.map(field => ({ fieldId: field.id, componentType: field.componentType, value: values[field.name] })) });
  await until(() => browser.evaluate(page, 'Boolean(document.querySelector("[data-resume-autofill-active]"))'), 'active highlight');
  await browser.type(page, 'input[name=name]', '手动测试姓名');
  const result = await task, valuesRead = await browser.evaluate(page, '[...document.querySelectorAll("input:not([type=radio])")].map(input=>input.value)');
  assert.deepEqual(valuesRead, ['手动测试姓名', 'manual@example.invalid', '00000000000']);
  assert.equal(result.outcomes.filter(item => item.reason === 'manual_edit').length, 3);
  await sleep(600); assert.deepEqual(await browser.evaluate(page, '[...document.querySelectorAll("input:not([type=radio])")].map(input=>input.value)'), valuesRead);
  assert.equal(await browser.evaluate(page, 'document.querySelector("input[name=gender][value=男]").checked'), true);
  assert.equal(await browser.evaluate(page, 'Boolean(document.querySelector("[data-resume-autofill-active],[data-resume-autofill-indicator]"))'), false);
  console.log(`[manual overwrite=${overwrite}] trusted user input preserved; remaining field filled`);
  await writeFile(resolve(output, `manual-${overwrite}.json`), JSON.stringify({ result, values: valuesRead }, null, 2));
  await browser.command('Target.closeTarget', { targetId: page.targetId });
}
async function manualPopupCase(kind, overwrite) {
  const date = kind === 'date', lib = date ? 'phoenix' : 'arco';
  const page = await browser.page(`${origin}/component.html?lib=${lib}`);
  await until(() => browser.evaluate(page, 'Boolean(window.componentTest?.ready && document.querySelector("input"))'), 'manual popup mount');
  const bridge = await inject(page), scanned = await bridge.send({ type: 'PREPARE_FIELDS', overwrite });
  const field = scanned.fields.find(field => field.label === (date ? '开始时间' : '学校名称'));
  assert.ok(field);
  const task = bridge.send({ type: 'APPLY_FIELDS', overwrite, mappings: [{ fieldId: field.id, componentType: field.componentType, value: date ? expected.startDate : expected.school }] });
  const manualValue = date ? '2001-02-03' : '演示星河学院';
  if (date) {
    await until(() => browser.evaluate(page, 'Boolean(document.querySelector(".phoenix-calendar-input"))'), 'popup date editor');
    await browser.type(page, '.phoenix-calendar-input', manualValue);
    await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, page.sessionId);
    await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, page.sessionId);
  } else {
    await until(() => browser.evaluate(page, 'Boolean(document.querySelector(".arco-select-popup"))'), 'school menu');
    await browser.type(page, '[data-test-field="school"] input', manualValue);
    await until(() => browser.evaluate(page, `{const node=[...document.querySelectorAll('.arco-select-option')].find(n=>n.textContent.trim()===${JSON.stringify(manualValue)}&&n.getBoundingClientRect().height>0);if(node)node.dataset.manualTarget='true';Boolean(node)}`), 'manual school option');
    await sleep(200);
    await browser.click(page, '[data-manual-target]');
  }
  const result = await task;
  assert.equal(result.outcomes[0].reason, 'manual_edit');
  await sleep(650);
  const snapshot = await browser.evaluate(page, 'componentTest.snapshot()');
  await writeFile(resolve(output, `manual-${kind}-${overwrite}.json`), JSON.stringify({ result, snapshot }, null, 2));
  await browser.screenshot(page, `manual-${kind}-${overwrite}.png`);
  await writeFile(resolve(output, `manual-${kind}-${overwrite}-dom.html`), await browser.evaluate(page, 'document.documentElement.outerHTML'));
  assert.equal(snapshot.values[date ? 'startDate' : 'school'], manualValue);
  assert.equal(result.filled, 0);
  console.log(`[manual ${kind} overwrite=${overwrite}] trusted popup interaction preserved`);
  await browser.command('Target.closeTarget', { targetId: page.targetId });
}
try {
  browser = await chromium(output); const requested = process.argv.slice(2), names = requested.length ? requested.filter(name => Object.hasOwn(entries, name)) : Object.keys(entries);
  for (const name of requested) assert.ok(Object.hasOwn(entries, name) || ['manual', 'manual-popup'].includes(name), `Unknown test: ${name}`);
  const reports = []; for (const name of names) reports.push(await runLibrary(name));
  if (!requested.length || requested.includes('manual')) { await manualCase(false); await manualCase(true); }
  if (!requested.length || requested.includes('manual-popup')) for (const kind of ['select', 'date']) for (const overwrite of [false, true]) await manualPopupCase(kind, overwrite);
  if (reports.length) await writeFile(resolve(output, 'summary.json'), JSON.stringify(reports.map(r => ({ library: r.lib, filled: r.result?.filled, skipped: r.result?.skipped, failures: r.failures.length })), null, 2));
  if (browser.errors.length) console.log('Browser errors:', browser.errors.slice(0, 4));
  assert.ok(reports.every(r => !r.failures.length), 'Real component acceptance failed; see .preview/components/*-result.json');
  console.log('All requested component checks passed.');
} finally { if (browser) await browser.close(); server.close(); }
