import { send, element, status, onClick, downloadJSON } from '../shared/ui.js';
import { PROFILE_SCHEMA, selectedSources, recordTargets, diagnosticReason } from '../shared/profile.js';
const requestId = new URL(location.href).searchParams.get('requestId');
let polling = null;
let state = '';
let currentData = {};
let savedSelection = null;
function checked(root) { return [...document.querySelectorAll(`#${root} input:checked`)].map(input => input.value); }
function summary() {
  const targets = recordTargets(selectedSources(currentData.sources || [], checked('sources')));
  const text = Object.entries(targets).filter(([key]) => key !== 'employment')
    .map(([key, count]) => `${PROFILE_SCHEMA[key].title} ${count} 条`).join('；');
  document.getElementById('record-summary').textContent = text
    ? `本次所选条目：${text}。同类条目按设置页列表顺序对应网页；合并的实习 / 工作区块先工作、后实习。`
    : '本次只选择了非经历类资料。';
}
function checkRow(id, title, value, selected, sensitive = false) {
  const row = element('label', 'check-row');
  const checkbox = element('input');
  checkbox.type = 'checkbox'; checkbox.value = id; checkbox.checked = selected;
  checkbox.dataset.sensitive = String(sensitive);
  const text = element('span', sensitive ? 'sensitive' : '');
  text.append(element('strong', '', title + (sensitive ? '（敏感，默认不选）' : '')), element('small', 'value', value));
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
  details.append(element('summary', '', entry.section === 'unknown' ? '区块不明确，请手动指定对应资料' : '调整对应资料（仅本区块和本条目）'));
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
      onChanged(mapping);
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
  const row = checkRow(mapping.fieldId, `${mapping.fieldLabel} ← ${mapping.sourceLabel}${protectedValue ? '（已有内容，本次保留）' : ''}`,
    mapping.value, !protectedValue && !(currentData.aiAssist && currentData.reviewError)
      && !['warning', 'uncertain'].includes(review?.status));
  row.querySelector('input').disabled = protectedValue;
  const text = row.querySelector('span');
  const note = element('small', 'review-note ' + (review?.status || ''), reviewText(review)); text.append(note);
  const wrap = element('div', 'mapping-row'); wrap.append(row);
  sourceChooser(mapping.fieldId, wrap, updated => {
    text.querySelector('strong').textContent = `${updated.fieldLabel} ← ${updated.sourceLabel}${protectedValue ? '（已有内容，本次保留）' : ''}`;
    text.querySelector('.value').textContent = updated.value;
    note.textContent = '已手动修改对应关系，请自行核对。';
  });
  return wrap;
}
function preview(data) {
  clearTimeout(polling);
  currentData = data; state = 'preview';
  document.getElementById('selection').hidden = true;
  document.getElementById('preview').hidden = false;
  const root = document.getElementById('mappings'); root.replaceChildren();
  for (const mapping of data.mappings) root.append(mappingRow(mapping));
  const report = document.getElementById('preparation-report'); report.replaceChildren();
  for (const item of data.addReports || []) report.append(element('p', item.message ? 'review-note warning' : 'muted',
    `${item.title}：新增 ${item.added} 条。${item.message}`));
  if (data.aiAssist) report.append(element('p', 'notice', data.reviewError
    ? `AI 校对未完成：${data.reviewError}。请人工核对后决定是否填写。`
    : '有疑点或不确定的字段默认不选；已有内容默认保留。确认后还会校对实际填写结果。'));
  const unmatched = document.getElementById('unmatched'); unmatched.replaceChildren();
  document.getElementById('unmatched-panel').hidden = !data.unmatched?.length;
  for (const field of data.unmatched || []) {
    const row = element('div', 'mapping-row');
    row.append(element('p', '', `${field.sectionLabel || field.section} / ${field.label || field.placeholder || field.name}：未匹配`));
    sourceChooser(field.id, row, mapping => { root.append(mappingRow(mapping)); row.remove(); });
    unmatched.append(row);
  }
  document.getElementById('apply').textContent = data.aiAssist ? '确认填写所选字段并校对结果' : '确认填写所选字段';
  status(`匹配到 ${data.mappings.length} 个字段，另有 ${data.unmatched?.length || 0} 个未匹配。请检查后确认。`);
}
async function refresh() {
  const data = await send({ type: 'GET_CONFIRMATION', requestId });
  document.getElementById('target-site').textContent = data.url;
  const diagnostic = data.diagnostic;
  document.getElementById('diagnostic-panel').hidden = !diagnostic;
  if (diagnostic) document.getElementById('diagnostic-summary').textContent = diagnostic.rejection
    ? diagnosticReason(diagnostic.rejection)
    : `已识别 ${diagnostic.counts.fields} 个字段，匹配 ${diagnostic.counts.matched} 个。${diagnostic.status === 'failed' ? '本次匹配失败，诊断中没有保存模型回复或错误正文。' : ''}`;
  if (data.status === 'preview' && state !== 'preview') preview(data);
  else if (data.status === 'detected' && state !== 'detected') {
    state = 'detected'; currentData = data;
    document.getElementById('selection').hidden = false;
    document.getElementById('preview').hidden = true;
    const root = document.getElementById('sources'); root.replaceChildren();
    const groups = new Map();
    for (const source of data.sources) {
      if (!groups.has(source.section)) {
        const group = element('details', 'source-group'); group.open = source.section === 'basic';
        group.append(element('summary', '', PROFILE_SCHEMA[source.section]?.title || '技能与其他信息'));
        root.append(group); groups.set(source.section, group);
      }
      groups.get(source.section).append(checkRow(source.id, source.label, source.value,
        savedSelection ? savedSelection.includes(source.id) : !source.sensitive, source.sensitive));
    }
    summary();
    status(data.flowError || '默认不开启 AI 内容上传。请核对资料范围与自动添加选项后继续。', Boolean(data.flowError));
  } else if (['matching', 'applying', 'auditing'].includes(data.status)) {
    state = data.status;
    document.getElementById('selection').hidden = true;
    document.getElementById('preview').hidden = true;
    const stages = { adding: '正在补足空的经历条目，尚未写入个人资料…', matching: '正在按区块和条目匹配字段…',
      reviewing: '正在校对预览与已有内容，尚未写入个人资料…', auditing: '已经写入网页，正在校对实际填写结果…' };
    status(data.status === 'applying' ? '正在填写网页…' : (stages[data.progress?.stage] || '正在匹配字段…')
      + (data.progress?.total ? ` ${data.progress.done} / ${data.progress.total}` : ''));
    clearTimeout(polling);
    polling = setTimeout(() => refresh().catch(error => status(error.message, true)), 1000);
  } else if (data.status === 'completed') finish(data.result);
  else if (data.status === 'error') { clearTimeout(polling); status(data.flowError, true); }
}
function finish(result) {
  clearTimeout(polling); state = 'completed';
  document.getElementById('selection').hidden = true;
  document.getElementById('preview').hidden = true;
  document.getElementById('cancel').textContent = '关闭';
  const reviews = document.getElementById('review-results'); reviews.replaceChildren();
  document.getElementById('after-review').hidden = !result.reviews && !result.reviewError;
  if (result.reviewError) reviews.append(element('p', 'review-note warning', `写入已经完成，但 AI 校对未完成：${result.reviewError}`));
  for (const review of result.reviews || []) {
    const mapping = currentData.mappings?.find(mapping => mapping.fieldId === review.fieldId);
    reviews.append(element('p', 'review-note ' + review.status, `${mapping?.fieldLabel || review.fieldId}：${reviewText(review)}`));
  }
  status(`已填写 ${result.filled} 个字段，跳过 ${result.skipped} 个。请回到网页检查并自行提交。`);
}
onClick('select-common', () => { document.querySelectorAll('#sources input').forEach(input => { input.checked = input.dataset.sensitive !== 'true'; }); summary(); });
onClick('select-none', () => { document.querySelectorAll('#sources input').forEach(input => { input.checked = false; }); summary(); });
document.getElementById('sources').addEventListener('change', event => { if (event.isTrusted) summary(); });
onClick('match', async () => {
  const sourceIds = checked('sources');
  if (!sourceIds.length) throw new Error('请先选择资料项');
  savedSelection = sourceIds; state = 'matching';
  document.getElementById('selection').hidden = true;
  status('正在准备表单，尚未写入个人资料…');
  polling = setTimeout(() => refresh().catch(error => status(error.message, true)), 500);
  try {
    await send({ type: 'MATCH_FIELDS', requestId, sourceIds, overwrite: document.getElementById('overwrite').checked,
      autoAdd: document.getElementById('auto-add').checked, aiAssist: document.getElementById('ai-assist').checked });
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
  if (!fieldIds.length && !currentData.aiAssist) throw new Error('请选择需要填写的字段');
  state = 'applying'; document.getElementById('preview').hidden = true;
  status(fieldIds.length ? '正在填写网页…' : '只校对已有内容，不写入字段…');
  polling = setTimeout(() => refresh().catch(error => status(error.message, true)), 500);
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
