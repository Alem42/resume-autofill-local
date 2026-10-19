import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beisenServer } from './beisen-server.mjs';
import { chromium, until, sleep } from './chromium.mjs';
const { server, output, origin } = await beisenServer(); let browser;
try {
  for (const pathname of ['/.git/config', '/package.json', '/.preview/beisen-lab/result.json']) {
    assert.equal((await fetch(origin + pathname)).status, 404, 'Test server must not expose private workspace files');
  }
  browser = await chromium(output); const page = await browser.page(origin + '/test-beisen.html');
  try { await until(() => browser.evaluate(page, 'Boolean(window.beisenLab?.harnessReady)'), 'test harness ready', 30000); }
  catch (error) { console.error('Mount failed', browser.errors, await browser.evaluate(page, 'document.body.innerText')); throw error; }
  await browser.click(page, '#run');
  await until(() => browser.evaluate(page, 'Boolean(beisenLab.done)'), 'complete fictional form', 150000);
  const report = await browser.evaluate(page, 'beisenLab.report || {error:beisenLab.error}');
  await writeFile(resolve(output, 'result.json'), JSON.stringify(report, null, 2)); await browser.screenshot(page, 'filled.png');
  console.log(JSON.stringify(report, null, 2));
  assert.ok(!report.error, report.error); assert.deepEqual(report.failures, []); assert.equal(report.result.skipped, 0);
  assert.deepEqual(report.snapshot.counters, { submits: 0, consent: 0 });
  const before = await browser.evaluate(page, 'beisenLab.snapshot()'); await sleep(700); assert.deepEqual(await browser.evaluate(page, 'beisenLab.snapshot()'), before);
  assert.deepEqual(browser.errors, []);
} finally { if (browser) await browser.close(); server.close(); }
