import { spawn } from 'node:child_process';
import { readFile, mkdir, mkdtemp, access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(fn, message, timeout = 12000) {
  const start = Date.now(); while (Date.now() - start < timeout) { if (await fn()) return; await sleep(40); }
  throw new Error(`Timed out: ${message}`);
}
export async function chromium(output) {
  await mkdir(output, { recursive: true });
  const candidates = [process.env.BROWSER_BIN, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
  let binary; for (const path of candidates) { try { await access(path); binary = path; break; } catch {} }
  if (!binary) throw new Error('Set BROWSER_BIN to a Chromium executable');
  const profile = await mkdtemp(resolve(output, 'browser-components-'));
  const browser = spawn(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-background-timer-throttling', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let url; await until(async () => { try { const [port, path] = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); url = `ws://127.0.0.1:${port}${path}`; return true; } catch { return false; } }, 'browser debugger');
  const ws = new WebSocket(url); await new Promise((resolveOpen, reject) => { ws.addEventListener('open', resolveOpen, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let next = 0; const pending = new Map(), errors = [];
  ws.addEventListener('message', event => { const r = JSON.parse(event.data); if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails.exception?.description || r.params.exceptionDetails.text);
    if (r.method === 'Runtime.consoleAPICalled' && r.params.type === 'error') errors.push(r.params.args.map(arg => arg.value || arg.description).join(' '));
    const task = pending.get(r.id); if (!task) return; pending.delete(r.id); clearTimeout(task.timeout); r.error ? task.reject(new Error(r.error.message)) : task.resolve(r.result); });
  const command = (method, params = {}, sessionId) => new Promise((resolveCall, reject) => {
    const id = ++next; const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 90000);
    pending.set(id, { resolve: resolveCall, reject, timeout }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  async function evaluate(page, expression, contextId) {
    const r = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) }, page.sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value;
  }
  async function page(url) {
    const { targetId } = await command('Target.createTarget', { url }); const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    await command('Runtime.enable', {}, sessionId); await command('Page.enable', {}, sessionId);
    await command('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    return { targetId, sessionId };
  }
  async function screenshot(page, name) { const r = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId); await writeFile(resolve(output, name), Buffer.from(r.data, 'base64')); }
  async function type(page, selector, text) {
    await evaluate(page, `{const input=document.querySelector(${JSON.stringify(selector)});input.focus();input.select();}`);
    await command('Input.insertText', { text }, page.sessionId);
  }
  async function click(page, selector) {
    const point = await evaluate(page, `{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();({x:r.x+r.width/2,y:r.y+r.height/2})}`);
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, page.sessionId);
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, page.sessionId);
  }
  return { command, evaluate, page, screenshot, type, click, errors,
    async close() { try { await command('Browser.close'); } catch {} ws.close(); browser.kill(); } };
}
