import { send, element, status, onClick, downloadJSON } from '../shared/ui.js';
import { PROFILE_SCHEMA, selectedSources, recordTargets, diagnosticReason, isDateSource } from '../shared/profile.js';
const UI_VERSION = '2.7.0';
const requestId = new URL(location.href).searchParams.get('requestId');
let polling = null;
let state = '';
let currentData = {};
let savedSelection = null;
let dateSelection = null;
let elapsedTimer = null;
let activityKey = '', activityStartedAt = 0;
let viewEpoch = 0, refreshSerial = 0, renderedSerial = 0;
const byId = id => document.getElementById(id);
function checked(root) { return [...document.querySelectorAll(`#${root} input:checked`)].filter(input => !input.disabled).map(input => input.value); }
function showView(next) {
  const busy = ['matching', 'applying', 'auditing'].includes(next);
  for (const id of ['selection', 'preview', 'completion']) byId(id).hidden = id !== ({ detected: 'selection', preview: 'preview', completed: 'completion' }[next]);
  byId('activity-panel').hidden = !busy;
  byId('match').hidden = next !== 'detected'; byId('apply').hidden = next !== 'preview';
  const step = { detected: 0, matching: 1, preview: 1, applying: 2, auditing: 2, completed: 3 }[next] ?? 0;
  for (let index = 0; index < 4; index++) byId(`step-${index + 1}`).className = `step ${index < step ? 'done' : index === step ? 'current' : ''}`;
  const titles = { detected: '选择本次填写内容', matching: '正在准备填写预览', preview: '确认要写入的内容', applying: '正在填写网页', auditing: '正在检查填写结果', completed: '本次处理已结束' };
  byId('flow-title').textContent = titles[next] || '简历填写助手';
  byId('cancel').textContent = next === 'completed' ? '关闭窗口' : busy ? '停止并关闭' : '取消';
  if (!busy) { clearTimeout(elapsedTimer); activityKey = ''; }
}
function schedulePoll() {
  clearTimeout(polling); const epoch = viewEpoch;
  polling = setTimeout(() => refresh().catch(error => { if (epoch === viewEpoch) status(error.message, true); }), 800);
}
function activity(data) {
  const progress = data.progress || {};
  const stage = progress.stage || (data.status === 'applying' ? 'applying' : data.status === 'auditing' ? 'auditing' : 'collecting');
  const stages = {
    adding: ['正在补足空的经历栏', '等待网页创建表单；这一步尚未写入个人资料。'],
    collecting: ['正在识别网页字段', data.includeDates === false ? '日期填写已关闭，正在识别其他可填写内容。' : '正在区分区块、经历条目和控件类型。'],
    matching: ['正在匹配资料与字段', '等待模型返回对应关系，完成后会先显示预览。'],
    reviewing: ['正在校对预览内容', '这是可选的额外校对，尚未写入个人资料。'],
    applying: ['正在逐项填写网页', progress.currentField ? `当前字段：${progress.currentField}` : '正在等待当前控件返回结果。'],
    auditing: ['正在校对实际填写结果', '网页写入阶段已结束，正在进行你开启的额外校对。']
  };
  const [title, detail] = stages[stage] || stages.collecting;
  byId('activity-title').textContent = title; byId('activity-detail').textContent = detail;
  const total = Number.isInteger(progress.total) && progress.total > 0 ? progress.total : 0;
  const done = Math.max(0, Math.min(total, Number.isInteger(progress.done) ? progress.done : 0));
  byId('activity-progress').hidden = !total; byId('activity-indeterminate').hidden = Boolean(total);
  if (total) { byId('activity-progress').max = total; byId('activity-progress').value = done; }
  byId('activity-counter').textContent = total ? `已处理 ${done} / ${total} 项` : '正在等待网页响应';
  byId('activity-counts').textContent = Number.isInteger(progress.filled) && Number.isInteger(progress.skipped)
    ? `已填写 ${progress.filled} · 已跳过 ${progress.skipped}` : stage === 'matching' ? '匹配进度不代表填写数量' : '';
  byId('action-hint').textContent = data.status === 'matching' ? '尚未写入个人资料' : data.status === 'auditing' ? '网页已写入，可回到网页检查' : '仅处理你已确认的字段';
  const key = `${data.status}:${stage}`;
  if (activityKey !== key) { activityKey = key; activityStartedAt = progress.startedAt || Date.now(); }
  clearTimeout(elapsedTimer);
  const tick = () => { byId('activity-time').textContent = `已用 ${Math.max(0, Math.floor((Date.now() - activityStartedAt) / 1000))} 秒`; elapsedTimer = setTimeout(tick, 1000); };
  tick(); status('');
}
function applyDateOption() {
  const enabled = byId('include-dates').checked;
  const sources = currentData.sources || [];
  const boxes = [...byId('sources').querySelectorAll('input')].filter(input => isDateSource(sources.find(source => source.id === input.value) || {}));
  if (!enabled) dateSelection = new Set(boxes.filter(input => input.checked).map(input => input.value));
  for (const input of boxes) {
    input.disabled = !enabled;
    input.checked = enabled ? (dateSelection ? dateSelection.has(input.value) : input.checked) : false;
    input.closest('label').className = enabled ? 'check-row' : 'check-row excluded';
  }
  summary();
}
function summary() {
  const targets = recordTargets(selectedSources(currentData.sources || [], checked('sources')));
  const text = Object.entries(targets).filter(([key]) => !['employment', 'qualifications'].includes(key))
    .map(([key, count]) => `${PROFILE_SCHEMA[key].title} ${count} 条`).join('；');
  document.getElementById('record-summary').textContent = text
    ? `所选经历：${text}。按个人资料中的列表顺序对应网页。`
    : '本次只选择了非经历类资料。';
  const count = checked('sources').length;
  byId('source-count').textContent = `已选 ${count} 项`;
  byId('match').disabled = !count;
  byId('action-hint').textContent = `${byId('include-dates').checked ? '日期填写开启' : '日期填写关闭'} · 已选 ${count} 项资料`;
}
function previewSelection() {
  const count = checked('mappings').length, total = currentData.mappings?.length || 0;
  byId('preview-summary').textContent = `匹配 ${total} 项 · 当前勾选 ${count} 项 · 未匹配 ${currentData.unmatched?.length || 0} 项`;
  byId('apply').textContent = count ? `确认填写 ${count} 项` : currentData.aiReview ? '仅校对已有内容' : '请先勾选字段';
  byId('apply').disabled = !count && !currentData.aiReview;
  byId('action-hint').textContent = currentData.includeDates === false ? '日期已排除，只写入勾选的其他字段' : '只写入勾选项，请核对具体内容';
}
function checkRow(id, title, value, selected) {
  const row = element('label', 'check-row');
  const checkbox = element('input');
  checkbox.type = 'checkbox'; checkbox.value = id; checkbox.checked = selected;
  const text = element('span', '');
  text.append(element('strong', '', title), element('small', 'value', value));
  row.append(checkbox, text);
  return row;
}
function reviewText(review) {
  const labels = { ok: 'AI：语义一致', warning: 'AI：发现疑点', uncertain: 'AI：需要人工判断' };
  return review ? `${labels[review.status]}。${review.reason}` : '';
}
function sourceChooser(fieldId, parent, onChanged) {
  const entry = currentData.choices?.find(item => item.fieldId === fieldId);
  const choices = entry?.sources || [];
  if (!choices.length) return;
  const details = element('details', 'mapping-adjust');
  details.append(element('summary', '', currentData.relaxed ? '调整对应资料（可从本次授权资料中选择）' : entry.section === 'unknown' ? '区块不明确，请手动指定对应资料' : '调整对应资料（仅本区块和本条目）'));
  const select = element('select');
  const empty = element('option', '', '选择对应资料'); empty.value = ''; select.append(empty);
  for (const source of choices) { const option = element('option', '', source.label); option.value = source.id; select.append(option); }
  select.value = currentData.mappings?.find(mapping => mapping.fieldId === fieldId)?.sourceId || '';
  select.addEventListener('change', async event => {
    if (!event.isTrusted || !select.value) return;
    const apply = document.getElementById('apply'); apply.disabled = true; select.disabled = true;
    try {
      const { mapping } = await send({ type: 'CHANGE_MAPPING', requestId, fieldId, sourceId: select.value });
      const index = currentData.mappings.findIndex(item => item.fieldId === fieldId);
      if (index < 0) currentData.mappings.push(mapping); else currentData.mappings[index] = mapping;
      currentData.unmatched = (currentData.unmatched || []).filter(field => field.id !== fieldId);
      byId('unmatched-count').textContent = String(currentData.unmatched.length);
      byId('unmatched-panel').hidden = !currentData.unmatched.length;
      onChanged(mapping);
      previewSelection();
      status('对应关系已按你的选择更新，请核对具体内容。');
    } catch (error) {
      select.value = currentData.mappings?.find(mapping => mapping.fieldId === fieldId)?.sourceId || '';
      status(error.message, true);
    }
    finally { apply.disabled = false; select.disabled = false; }
  });
  details.append(select); parent.append(details);
}
function mappingRow(mapping) {
  const review = currentData.reviews?.find(item => item.fieldId === mapping.fieldId);
  const protectedValue = mapping.hasValue && !currentData.overwrite;
  const row = checkRow(mapping.fieldId, `${mapping.fieldLabel}${protectedValue ? '（保留已有内容）' : ''}`,
    mapping.value, !protectedValue && (currentData.relaxed || (!(currentData.aiAssist && currentData.reviewError)
      && !['warning', 'uncertain'].includes(review?.status))));
  row.querySelector('input').disabled = protectedValue;
  const text = row.querySelector('span');
  text.append(element('small', 'mapping-origin', `来自 ${mapping.sourceLabel}`));
  const note = element('small', 'review-note ' + (mapping.needsReview ? 'warning' : review?.status || ''),
    [mapping.matchedBy === 'local' && '本机规则补齐', mapping.warning && `待审核：${mapping.warning}`, reviewText(review)].filter(Boolean).join('；')); text.append(note);
  const wrap = element('div', 'mapping-row'); wrap.append(row);
  sourceChooser(mapping.fieldId, wrap, updated => {
    text.querySelector('strong').textContent = `${updated.fieldLabel}${protectedValue ? '（保留已有内容）' : ''}`;
    text.querySelector('.value').textContent = updated.value;
    text.querySelector('.mapping-origin').textContent = `来自 ${updated.sourceLabel}`;
    note.textContent = [updated.warning, '已手动修改对应关系，请自行核对。'].filter(Boolean).join('；');
  });
  return wrap;
}
function preview(data) {
  clearTimeout(polling);
  viewEpoch++;
  currentData = data; state = 'preview';
  showView('preview');
  const root = document.getElementById('mappings'); root.replaceChildren();
  const groups = new Map();
  for (const mapping of data.mappings) {
    const key = `${mapping.section}:${mapping.recordIndex ?? ''}`;
    if (!groups.has(key)) {
      const group = element('section', 'mapping-group');
      group.append(element('h3', '', `${PROFILE_SCHEMA[mapping.section]?.title || '其他字段'}${mapping.recordIndex == null ? '' : ` · 第 ${mapping.recordIndex + 1} 条`}`));
      root.append(group); groups.set(key, group);
    }
    groups.get(key).append(mappingRow(mapping));
  }
  const report = document.getElementById('preparation-report'); report.replaceChildren();
  for (const item of data.addReports || []) report.append(element('p', item.message ? 'review-note warning' : 'muted',
    `${item.title}：新增 ${item.added} 条。${item.message}`));
  if (data.includeDates === false) report.append(element('p', 'notice', `日期填写已关闭，已排除 ${data.excludedDates || 0} 个日期字段。`));
  if (data.relaxed) report.append(element('p', 'muted', '模糊匹配已开启：待核对候选默认勾选，可取消或调整对应资料。'));
  if (data.aiAssist) report.append(element('p', 'muted', 'AI 选项辅助已开启。学校搜索最多等待 10 秒，普通字段最多 5 秒。'));
  if (data.aiReview) report.append(element('p', 'notice', data.reviewError
    ? `AI 校对未完成：${data.reviewError}。请人工核对后决定是否填写。`
    : data.relaxed ? 'AI 校对意见供你审核，不会取消候选。确认后还会校对实际填写结果。' : '有疑点或不确定的字段默认不选；已有内容默认保留。确认后还会校对实际填写结果。'));
  const unmatched = document.getElementById('unmatched'); unmatched.replaceChildren();
  document.getElementById('unmatched-panel').hidden = !data.unmatched?.length;
  byId('unmatched-count').textContent = String(data.unmatched?.length || 0);
  for (const field of data.unmatched || []) {
    const row = element('div', 'mapping-row');
    row.append(element('p', '', `${field.sectionLabel || field.section} / ${field.label || field.placeholder || field.name}：未匹配`));
    sourceChooser(field.id, row, mapping => { root.append(mappingRow(mapping)); row.remove(); });
    unmatched.append(row);
  }
  previewSelection();
  status(`匹配到 ${data.mappings.length} 个字段，另有 ${data.unmatched?.length || 0} 个未匹配。请检查后确认。`);
}
async function refresh() {
  const epoch = viewEpoch, serial = ++refreshSerial;
  const data = await send({ type: 'GET_CONFIRMATION', requestId });
  if (epoch !== viewEpoch || serial < renderedSerial) return;
  renderedSerial = serial;
  const installed = chrome.runtime.getManifest?.().version;
  if (installed && installed !== UI_VERSION) {
    showView('error');
    status(`当前扩展为 ${installed}，页面文件为 ${UI_VERSION}。请先在扩展管理页重新加载扩展，再刷新招聘网页。`, true);
    byId('action-hint').textContent = '版本不一致，填写尚未开始'; return;
  }
  document.getElementById('target-site').textContent = data.url;
  try { byId('target-host').textContent = new URL(data.url).hostname || '本地测试页'; }
  catch { byId('target-host').textContent = '请检查目标地址'; }
  const diagnostic = data.diagnostic;
  document.getElementById('diagnostic-panel').hidden = !diagnostic;
  if (diagnostic) document.getElementById('diagnostic-summary').textContent = diagnostic.rejection
    ? diagnosticReason(diagnostic.rejection)
    : `已识别 ${diagnostic.counts.fields} 个字段，匹配 ${diagnostic.counts.matched} 个。${diagnostic.status === 'failed' ? '本次匹配失败，诊断中没有保存模型回复或错误正文。' : ''}`;
  if (data.status === 'preview' && state !== 'preview') preview(data);
  else if (data.status === 'detected' && state !== 'detected') {
    state = 'detected'; currentData = data;
    showView('detected');
    byId('include-dates').checked = data.includeDates !== false;
    const root = document.getElementById('sources'); root.replaceChildren();
    const groups = new Map();
    for (const source of data.sources) {
      if (!groups.has(source.section)) {
        const group = element('details', 'source-group');
        const caption = element('summary', '', PROFILE_SCHEMA[source.section]?.title || '技能与其他信息');
        caption.append(element('span', 'badge', `${data.sources.filter(item => item.section === source.section).length} 项`)); group.append(caption);
        root.append(group); groups.set(source.section, group);
      }
      groups.get(source.section).append(checkRow(source.id, source.label, source.value,
        savedSelection ? savedSelection.includes(source.id) : true));
    }
    applyDateOption();
    status(data.flowError || '', Boolean(data.flowError));
  } else if (['matching', 'applying', 'auditing'].includes(data.status)) {
    state = data.status;
    showView(data.status); activity(data); schedulePoll();
  } else if (data.status === 'completed') { currentData = data; finish(data.result); }
  else if (data.status === 'error') { clearTimeout(polling); showView('error'); status(data.flowError, true); byId('action-hint').textContent = '已停止，请检查网页上已经填写的内容'; }
}
function finish(result) {
  viewEpoch++;
  clearTimeout(polling); state = 'completed';
  showView('completed');
  const manual = (result.outcomes || []).filter(item => item.reason === 'manual_edit').length;
  const skipped = Math.max(0, (result.skipped || 0) - manual);
  byId('completion-title').textContent = skipped ? '处理结束，部分内容需要你检查' : '所选字段已处理';
  byId('completion-description').textContent = `${manual ? `已保留你手动填写的 ${manual} 项，不再自动修改。` : ''}${skipped ? '未完成的字段不会继续重试，可根据下面的原因手动补充。' : '请在招聘网页核对与保存。'}`;
  byId('result-filled').textContent = String(result.filled || 0);
  byId('result-skipped').textContent = String(skipped);
  byId('result-dates').textContent = String(currentData.excludedDates || 0);
  byId('action-hint').textContent = '网页处理已结束，尚未替你提交';
  const reviews = document.getElementById('review-results'); reviews.replaceChildren();
  const labelOf = fieldId => {
    const mapping = currentData.mappings?.find(item => item.fieldId === fieldId);
    const field = currentData.fieldLabels?.find(item => item.fieldId === fieldId);
    const section = mapping?.section || field?.section, recordIndex = mapping?.recordIndex ?? field?.recordIndex;
    const caption = PROFILE_SCHEMA[section]?.title;
    return `${caption ? `${caption}${recordIndex == null ? '' : ` · 第 ${recordIndex + 1} 条`} / ` : ''}${mapping?.fieldLabel || field?.label || fieldId}`;
  };
  document.getElementById('after-review').hidden = !result.reviews && !result.reviewError;
  if (result.reviewError) reviews.append(element('p', 'review-note warning', `写入已经完成，但 AI 校对未完成：${result.reviewError}`));
  for (const review of result.reviews || []) {
    reviews.append(element('p', 'review-note ' + review.status, `${labelOf(review.fieldId)}：${reviewText(review)}`));
  }
  const skipReasons = { existing_value: '已有内容，本次保留', field_changed: '字段结构已变化，请重新检测',
    selection_not_committed: '组件未确认选中，请检查下拉候选或日期', component_refused: '组件未接受填写事件',
    range_requires_both: '共享日期范围需要同时确认开始和结束两个字段', field_timeout: '控件等待超时，已跳过，请手动填写（普通字段 5 秒、学校 10 秒）',
    date_disabled: '日期填写已关闭', empty_value: '没有可填写内容', manual_edit: '已保留你的手动填写，不再自动修改' };
  for (const item of result.outcomes || []) if (item.status === 'skipped') {
    reviews.append(element('p', 'review-note ' + (item.reason === 'manual_edit' ? 'ok' : 'warning'), `${labelOf(item.fieldId)}：${skipReasons[item.reason] || '未完成填写，请检查网页'}`));
    document.getElementById('after-review').hidden = false;
  }
  for (const item of result.outcomes || []) if (item.status === 'filled' && ['alias', 'similar', 'ai', 'preference'].includes(item.optionMatch)) {
    const methods = { alias: '名称变体', similar: '近似', ai: 'AI 判断的', preference: '最高熟练等级' };
    reviews.append(element('p', 'review-note warning', `${labelOf(item.fieldId)}：已选择${methods[item.optionMatch]}候选，请核对网页实际选项。`));
    document.getElementById('after-review').hidden = false;
  }
  status('');
}
onClick('select-all', () => { document.querySelectorAll('#sources input').forEach(input => { if (!input.disabled) input.checked = true; }); summary(); });
onClick('select-none', () => { document.querySelectorAll('#sources input').forEach(input => { input.checked = false; }); summary(); });
onClick('preview-select-all', () => { byId('mappings').querySelectorAll('input').forEach(input => { if (!input.disabled) input.checked = true; }); previewSelection(); });
onClick('preview-select-none', () => { byId('mappings').querySelectorAll('input').forEach(input => { input.checked = false; }); previewSelection(); });
byId('include-dates').addEventListener('change', event => { if (event.isTrusted) applyDateOption(); });
byId('mappings').addEventListener('change', event => { if (event.isTrusted) previewSelection(); });
document.getElementById('sources').addEventListener('change', event => { if (event.isTrusted) summary(); });
onClick('match', async () => {
  const sourceIds = checked('sources');
  if (!sourceIds.length) throw new Error('请先选择资料项');
  viewEpoch++;
  savedSelection = sourceIds; state = 'matching';
  showView('matching'); activity({ status: 'matching', progress: { stage: byId('auto-add').checked ? 'adding' : 'collecting' } });
  schedulePoll();
  try {
    await send({ type: 'MATCH_FIELDS', requestId, sourceIds, overwrite: document.getElementById('overwrite').checked,
      autoAdd: document.getElementById('auto-add').checked, aiAssist: document.getElementById('ai-assist').checked,
      aiReview: document.getElementById('ai-review').checked,
      includeDates: byId('include-dates').checked,
      relaxed: document.getElementById('relaxed').checked });
    clearTimeout(polling);
    if (state !== 'preview') { state = ''; await refresh(); }
  } catch (error) {
    clearTimeout(polling); state = '';
    try { await refresh(); } catch { /* cancelled or changed page */ }
    throw error;
  }
});
onClick('apply', async () => {
  const fieldIds = checked('mappings');
  if (!fieldIds.length && !currentData.aiReview) throw new Error('请选择需要填写的字段');
  viewEpoch++; state = 'applying'; showView('applying');
  activity({ status: 'applying', progress: { stage: 'applying', done: 0, total: fieldIds.length, filled: 0, skipped: 0 } });
  schedulePoll();
  try { finish(await send({ type: 'APPLY_FIELDS', requestId, fieldIds })); }
  catch (error) { clearTimeout(polling); state = ''; try { await refresh(); } catch {} throw error; }
});
onClick('cancel', async () => {
  clearTimeout(polling);
  try { await send({ type: 'CANCEL_CONFIRMATION', requestId }); }
  finally { window.close(); }
});
onClick('export-diagnostic', async () => {
  const { diagnostic } = await send({ type: 'GET_DIAGNOSTICS', requestId });
  if (!diagnostic) throw new Error('暂无诊断，请先进行一次字段匹配');
  downloadJSON(diagnostic, 'resume-autofill-diagnostic.json');
});
refresh().catch(error => status(error.message, true));
