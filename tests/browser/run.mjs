// Dependency-free Chromium DOM integration tests. No real user profile, API or recruiting site.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createController } from '../../shared/controller.js';
import { normalizeProfile, profileSources, localMatchPairs, DEFAULT_MODEL } from '../../shared/profile.js';
import { fixtureProfile } from './fixture-profile.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), output = resolve(root, '.preview');
await mkdir(output, { recursive: true });
let uiState = {}, browser, ws, server, timer, userData;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const id = 'laboratoryextension', extensionURL = path => `chrome-extension://${id}/${path}`;
function storage(initial = {}) {
  const data = structuredClone(initial);
  return { async setAccessLevel() {}, async get(keys) { return keys === null ? structuredClone(data) : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter(key => key in data).map(key => [key, structuredClone(data[key])])); },
    async set(value) { Object.assign(data, structuredClone(value)); }, async remove(keys) { for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key]; } };
}
let nextId = 0; const pending = new Map();
function command(method, params = {}, sessionId) {
  return new Promise((resolveCall, reject) => {
    const callId = ++nextId, timeout = setTimeout(() => { pending.delete(callId); reject(new Error(`CDP timeout: ${method}`)); }, 180000);
    pending.set(callId, { resolve(value) { clearTimeout(timeout); resolveCall(value); }, reject(error) { clearTimeout(timeout); reject(error); } });
    ws.send(JSON.stringify({ id: callId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(sessionId, expression, contextId) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function newPage(url) {
  const { targetId } = await command('Target.createTarget', { url });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  await command('Runtime.enable', {}, sessionId); await command('Page.enable', {}, sessionId);
  return { targetId, sessionId };
}
async function until(fn, description, timeout = 12000) {
  const start = Date.now(); while (Date.now() - start < timeout) { if (await fn()) return; await sleep(100); }
  throw new Error(`Timed out waiting for ${description}`);
}
async function screenshot(page, name, width = 1100, height = 850) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, page.sessionId);
  await sleep(150); const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId);
  await writeFile(resolve(output, name), Buffer.from(data, 'base64'));
}
async function runCase(variant, includeDates) {
  console.log(`\n[${variant} / dates ${includeDates ? 'on' : 'off'}] Opening real browser page`);
  const url = `${origin}/test-lab.html?variant=${variant}`, page = await newPage(url);
  try { await until(() => evaluate(page.sessionId, 'Boolean(window.lab?.ready)'), 'lab ready'); }
  catch (error) { console.error(await evaluate(page.sessionId, '({url:location.href,text:document.body?.innerText.slice(0,1500),scripts:[...document.scripts].map(s=>s.src)})')); throw error; }
  const { frameTree } = await command('Page.getFrameTree', {}, page.sessionId);
  const { executionContextId: contextId } = await command('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'resume-autofill-laboratory' }, page.sessionId);
  const run = expression => evaluate(page.sessionId, expression, contextId);
  await run(`globalThis.__labMessages=[]; globalThis.chrome={runtime:{id:${JSON.stringify(id)},getURL:path=>${JSON.stringify(extensionURL(''))}+path,onMessage:{addListener:fn=>globalThis.__labListener=fn},sendMessage:async message=>{__labMessages.push(message);return {index:null};}}};
    globalThis.__labSend=message=>new Promise(resolve=>{const pending=__labListener(message,{id:chrome.runtime.id,url:chrome.runtime.getURL('background/background.js')},resolve);if(!pending&&message.type==='STOP_SCAN')resolve({ok:true});});`);
  let profile = normalizeProfile(fixtureProfile);
  if (variant === 'stress') profile = normalizeProfile({ basic: { ...fixtureProfile.basic, availableDate: '2027-07-01' },
    education: [{ school: '演示拒绝学校' }], interests: '阅读', selfEvaluation: fixtureProfile.selfEvaluation });
  const readState = () => controller.handle({ type: 'GET_CONFIRMATION', requestId: flow.requestId }, confirmSender);
  const api = { runtime: { id, getURL: extensionURL, getManifest: () => ({ version: '2.7.0' }) },
    storage: { local: storage({ schemaVersion: 2, profile, settings: { model: DEFAULT_MODEL, rememberKey: false } }), session: storage({ secret: 'FICTIONAL_TEST_KEY' }) },
    tabs: { query: async () => [{ id: 1, url, status: 'complete' }], get: async () => ({ id: 1, url, status: 'complete' }),
      sendMessage: async (_, message) => run(`__labSend(${JSON.stringify(message)})`) },
    scripting: { async executeScript({ files }) { for (const file of files) await run(await readFile(resolve(root, file), 'utf8')); return [{ frameId: 0, documentId: 'lab-document' }]; } },
    windows: { create: async () => ({ id: 9, tabs: [{ id: 90 }] }), async remove() {} } };
  let requests = 0;
  const controller = createController(api, async (_, init) => {
    requests++; const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    const mappings = localMatchPairs(payload.fields, profileSources(profile));
    return { ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ mappings }) } }] }) };
  });
  await controller.handle({ type: 'START_DETECTION' }, { id, url: extensionURL('popup/popup.html') });
  const flow = (await api.storage.session.get('flow_1')).flow_1;
  const pageSender = { id, url, tab: { id: 1 }, frameId: 0, documentId: 'lab-document' };
  await controller.handle({ type: 'FORM_DETECTED', scanToken: flow.scanToken }, pageSender);
  const confirmSender = { id, url: extensionURL(`confirm/confirm.html?requestId=${flow.requestId}`), tab: { id: 90 } };
  uiState = await readState(); await uiScreens('selection', uiState);
  console.log(`[${variant}] Adding records and matching with the production controller; API mocked`);
  await controller.handle({ type: 'MATCH_FIELDS', requestId: flow.requestId, sourceIds: profileSources(profile).map(source => source.id),
    overwrite: false, autoAdd: variant !== 'stress', aiAssist: false, aiReview: false, relaxed: true, includeDates }, confirmSender);
  uiState = await readState();
  console.log(`[${variant}] Recognized ${uiState.diagnostic.counts.fields}, matched ${uiState.mappings.length}, date fields excluded ${uiState.excludedDates}`);
  await uiScreens('preview', uiState);
  let last = -1, pollError, sampleProgress, polling = false, currentPoll = Promise.resolve();
  const relayProgress = async () => {
    const messages = await run('__labMessages.splice(0)');
    for (const message of messages) if (message.type === 'FILL_PROGRESS') {
      try { await controller.handle(message, pageSender); }
      catch (error) {
        // This bridge batches messages every 400 ms. A queued progress packet may
        // arrive after APPLY completed; production also rejects and ignores it.
        if (error.message === '填写已停止' && (await readState()).status === 'completed') continue;
        throw error;
      }
      if (!sampleProgress && message.done > 0) sampleProgress = { ...message, stage: 'applying', currentField: uiState.mappings.find(mapping => mapping.fieldId === message.currentFieldId)?.fieldLabel || '' };
      if (message.done >= last + 8) { last = message.done; console.log(`[${variant}] processed ${message.done}/${message.total}, filled ${message.filled}, skipped ${message.skipped}`); }
    }
  };
  timer = setInterval(() => {
    if (polling) return;
    polling = true; currentPoll = relayProgress().catch(error => { pollError = error; }).finally(() => { polling = false; });
  }, 400);
  const result = await controller.handle({ type: 'APPLY_FIELDS', requestId: flow.requestId, fieldIds: uiState.mappings.map(mapping => mapping.fieldId) }, confirmSender);
  clearInterval(timer); timer = null;
  await currentPoll;
  const snapshot = await evaluate(page.sessionId, 'lab.snapshot()');
  await sleep(500);
  assert.deepEqual(await evaluate(page.sessionId, 'lab.snapshot()'), snapshot, 'Late browser writes continued after completion');
  const diagnostic = (await api.storage.session.get('lastDiagnostic')).lastDiagnostic;
  const report = { variant, includeDates, requests, result, diagnostic, snapshot, failures: [] };
  const aliases = new Map([['汉族', '汉'], ['硕士研究生', '硕士'], ['工学类', '工学'], ['全日制普通高等教育', '全日制'], ['English', '英语'], ['雅思', 'IELTS'], ['团员', '共青团员']]);
  for (const field of snapshot.fields) {
    if (variant === 'stress' && ['availableDate', 'interests', 'school'].includes(field.key)) continue;
    let expected = field.expected;
    if (field.date && !includeDates) expected = '';
    else if (field.date && field.precision === 'month') expected = expected.slice(0, 7);
    else if (field.date && field.format === 'format') expected = expected.split('-').reverse().join('/');
    if ((aliases.get(field.actual) || field.actual) !== expected) report.failures.push({ ...field, expected });
  }
  assert.deepEqual(snapshot.danger, { upload: 0, submit: 0, agreement: false });
  if (variant === 'stress') {
    for (const key of ['availableDate', 'interests', 'school']) assert.equal(snapshot.fields.find(field => field.key === key).actual, '', `Rejected ${key} was committed`);
    assert.ok(result.outcomes.some(outcome => outcome.reason === 'field_timeout'), 'Stuck date did not exercise the timeout');
  }
  if (variant !== 'stress') assert.deepEqual(snapshot.counts, { education: 2, projects: 3, internships: 1, campus: 1, awards: 1, languageCertificates: 1 });
  if (pollError) report.failures.push({ error: pollError.message });
  const name = `${variant}-${includeDates ? 'dates' : 'no-dates'}`;
  await writeFile(resolve(output, `${name}.json`), JSON.stringify(report, null, 2));
  await screenshot(page, `${name}.png`);
  if (sampleProgress) await uiScreens('progress', { ...uiState, status: 'applying', progress: sampleProgress });
  uiState = await readState(); await uiScreens('completed', uiState);
  console.log(`[${variant}] filled ${result.filled}, skipped ${result.skipped}; independently checked ${snapshot.fields.length} actual accepted values, failures ${report.failures.length}`);
  for (const failure of report.failures) console.log('  FAIL', JSON.stringify(failure));
  await command('Target.closeTarget', { targetId: page.targetId });
  return report;
}
async function uiScreens(state, data) {
  // Screenshot the actual confirmation HTML/CSS/JS with fictional worker responses.
  if (!['selection', 'preview', 'completed', 'progress'].includes(state)) return;
  uiState = data;
  const page = await newPage(`${origin}/confirm/confirm.html?requestId=lab-preview`);
  const panel = JSON.stringify({ selection: 'selection', preview: 'preview', completed: 'completion', progress: 'activity-panel' }[state]);
  await until(() => evaluate(page.sessionId, `Boolean(document.getElementById(${panel}) && !document.getElementById(${panel}).hidden)`), 'confirmation view');
  await screenshot(page, `ui-${state}.png`, 960, 820);
  if (state === 'selection') await screenshot(page, 'ui-mobile.png', 560, 820);
  const overflow = await evaluate(page.sessionId, 'document.documentElement.scrollWidth>innerWidth');
  assert.equal(overflow, false, `confirmation ${state} overflows`);
  await command('Target.closeTarget', { targetId: page.targetId });
}
let origin;
try {
  server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path === '/__lab-worker.js') {
        res.setHeader('Content-Type', 'text/javascript'); res.end(`globalThis.chrome={runtime:{getManifest:()=>({version:'2.7.0'}),sendMessage:async()=>(${JSON.stringify(uiState)})}};`); return;
      }
      const file = resolve(root, '.' + path); if (!file.startsWith(root + sep)) throw new Error('Invalid path');
      let body = await readFile(file);
      if (path === '/confirm/confirm.html') body = body.toString().replace('<head>', '<head><script src="/__lab-worker.js"></script>');
      res.setHeader('Content-Type', `${mime[extname(file)] || 'application/octet-stream'}; charset=utf-8`); res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen)); origin = `http://127.0.0.1:${server.address().port}`;
  const candidates = [process.env.BROWSER_BIN, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
  let binary; for (const candidate of candidates) { try { await access(candidate); binary = candidate; break; } catch {} }
  if (!binary) throw new Error('Chromium not found; set BROWSER_BIN to your Edge/Chrome executable');
  userData = await mkdtemp(resolve(output, 'browser-'));
  browser = spawn(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${userData}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socketURL;
  await until(async () => { try { const [port, path] = (await readFile(resolve(userData, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); socketURL = `ws://127.0.0.1:${port}${path}`; return true; } catch { return false; } }, 'browser debugger');
  ws = new WebSocket(socketURL); await new Promise((resolveOpen, reject) => { ws.addEventListener('open', resolveOpen, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => { const reply = JSON.parse(event.data);
    if (reply.method === 'Runtime.exceptionThrown') console.error('Browser JavaScript error:', reply.params.exceptionDetails.exception?.description || reply.params.exceptionDetails.text);
    const task = pending.get(reply.id); if (!task) return; pending.delete(reply.id); if (reply.error) task.reject(new Error(reply.error.message)); else task.resolve(reply.result); });
  const requested = process.argv.slice(2), cases = requested.length ? requested.map(value => ({ variant: value.replace(/-no-dates$/, ''), includeDates: !value.endsWith('-no-dates') }))
    : [{ variant: 'enterprise', includeDates: true }, { variant: 'public', includeDates: true }, { variant: 'enterprise', includeDates: false }, { variant: 'stress', includeDates: true }];
  const reports = []; for (const item of cases) reports.push(await runCase(item.variant, item.includeDates));
  await writeFile(resolve(output, 'browser-summary.json'), JSON.stringify(reports.map(({ variant, includeDates, result, failures }) => ({ variant, includeDates, filled: result.filled, skipped: result.skipped, failures: failures.length })), null, 2));
  assert.ok(reports.every(report => !report.failures.length), 'Browser acceptance checks failed; see .preview/*.json');
  console.log('\nAll real-browser acceptance checks passed. Reports/screenshots: .preview/');
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  clearInterval(timer);
  if (ws?.readyState === WebSocket.OPEN) { try { await command('Browser.close'); } catch {} ws.close(); }
  browser?.kill(); server?.close();
}
