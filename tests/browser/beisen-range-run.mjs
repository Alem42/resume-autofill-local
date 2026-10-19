import { beisenServer } from './beisen-server.mjs';
import { chromium, until } from './chromium.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const { server, origin, output } = await beisenServer(); const browser = await chromium(output);
try {
 const page = await browser.page(origin + '/range.html');
 await until(() => browser.evaluate(page, 'Boolean(window.rangeReady && document.querySelector("input"))'), 'real Phoenix range ready');
 const { frameTree } = await browser.command('Page.getFrameTree', {}, page.sessionId);
 const { executionContextId } = await browser.command('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'range-test' }, page.sessionId);
 const run = code => browser.evaluate(page, code, executionContextId);
 await run(`chrome={runtime:{id:'rangetest',getURL:p=>'chrome-extension://rangetest/'+p,onMessage:{addListener:f=>globalThis.listener=f},sendMessage:async()=>({})}};globalThis.send=m=>new Promise(r=>listener({scanToken:'range',...m},{id:'rangetest',url:chrome.runtime.getURL('background/background.js')},r));`);
 for (const file of ['shared/semantics-core.js','content/sections.js','content/controls.js','content/content.js']) await run(await readFile(resolve(file), 'utf8'));
 await run(`send({type:'START_SCAN'})`); const fields = (await run(`send({type:'PREPARE_FIELDS'})`)).fields;
 console.log(fields);
 const mappings = fields.map((field, index) => ({ fieldId: field.id, componentType: field.componentType, value: index ? '2027-06-22' : '2024-09-13' }));
 const result = await run(`send(${JSON.stringify({type:'APPLY_FIELDS',mappings,auditFieldIds:fields.map(f=>f.id)})})`);
 const accepted = await browser.evaluate(page,'window.rangeAccepted'); console.log(result, accepted);
 await writeFile(resolve(output, 'range-result.json'),JSON.stringify({ fields, result, accepted },null,2)); await browser.screenshot(page,'range.png');
 await writeFile(resolve(output,'range-dom.html'),await browser.evaluate(page,'document.documentElement.outerHTML'));
 assert.deepEqual(accepted,['2024-09-13','2027-06-22']); assert.equal(result.filled,2);
 assert.deepEqual(browser.errors,[]);
} finally { await browser.close(); server.close(); }
