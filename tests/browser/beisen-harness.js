import { normalizeProfile, profileSources, selectedSources, recordTargets, normalizeFields, localMatchPairs, validateMatches } from '../../shared/profile.js';
let listener;
globalThis.chrome = { runtime: { id: 'fictional-beisen-lab', getURL: path => 'chrome-extension://fictional-beisen-lab/' + path,
  onMessage: { addListener: fn => { listener = fn; } }, sendMessage: async message => {
    if (message.type === 'FILL_PROGRESS') document.getElementById('progress').textContent = `已处理 ${message.done}/${message.total} · 已填写 ${message.filled} · 跳过 ${message.skipped}`;
    return { index: null };
  } } };
const send = message => new Promise(resolve => listener({ scanToken: 'fictional-beisen', ...message }, { id: chrome.runtime.id, url: chrome.runtime.getURL('background/background.js') }, resolve));
for (const path of ['shared/semantics-core.js', 'content/sections.js', 'content/controls.js', 'content/content.js']) {
  await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/' + path; script.onload = resolve; script.onerror = reject; document.head.append(script); });
}
const lab = window.beisenLab;
async function run() {
  document.getElementById('run').disabled = true;
  lab.stopped = false; lab.done = false; delete lab.error; delete lab.report;
  try {
    const profile = normalizeProfile(lab.profile), all = profileSources(profile), sources = selectedSources(all, all.map(source => source.id));
    await send({ type: 'START_SCAN' });
    document.getElementById('progress').textContent = '正在按虚构资料数量展开教育、家庭和项目条目…';
    const additions = await send({ type: 'ENSURE_RECORDS', targets: recordTargets(sources) });
    const includeDates = document.getElementById('dates').checked, overwrite = document.getElementById('overwrite').checked;
    const scanned = await send({ type: 'PREPARE_FIELDS', includeDates, overwrite });
    if (scanned.error) throw new Error(scanned.error);
    const fields = normalizeFields(scanned.fields), mappings = validateMatches(JSON.stringify({ mappings: localMatchPairs(fields, sources) }), fields, sources);
    lab.beforeFill = { fields, mappings, additions, excludedDates: scanned.excludedDates };
    lab.result = await send({ type: 'APPLY_FIELDS', mappings, includeDates, overwrite, auditFieldIds: fields.map(field => field.id) });
    if (lab.stopped) {
      lab.report = { status: 'stopped', snapshot: lab.snapshot() };
      document.getElementById('report').textContent = JSON.stringify(lab.report, null, 2);
      document.getElementById('progress').textContent = '已中止填写，已填内容保留；可清空重试。';
      return;
    }
    if (lab.result.error) throw new Error(lab.result.error);
    const failures = Object.entries(lab.expectations).filter(([key, value]) => value != null && (includeDates || !/Date$/.test(key))
      && (lab.snapshot().accepted[key] !== value && __resumeControls.optionScore(lab.snapshot().accepted[key], value, key.split('.').at(-1)) < .97));
    lab.report = { fields: fields.length, mappings: mappings.length, additions, result: lab.result, failures, snapshot: lab.snapshot() };
    document.getElementById('report').textContent = JSON.stringify(lab.report, null, 2);
    document.getElementById('progress').textContent = `测试结束：匹配 ${mappings.length}/${fields.length}，填写 ${lab.result.filled}，跳过 ${lab.result.skipped}，验收差异 ${failures.length}`;
  } catch (error) { lab.error = error.message; document.getElementById('progress').textContent = lab.stopped ? '已中止填写，已填内容保留。' : '测试错误：' + error.message; }
  finally { document.getElementById('run').disabled = false; lab.done = true; }
}
document.getElementById('run').onclick = run;
document.getElementById('stop').onclick = () => { lab.stopped = true; document.getElementById('progress').textContent = '正在中止…'; return send({ type: 'STOP_SCAN' }); };
lab.run = run; lab.send = send; lab.harnessReady = true;
