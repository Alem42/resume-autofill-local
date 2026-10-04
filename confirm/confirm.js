import { send, element, status, onClick } from '../shared/ui.js';
const requestId = new URL(location.href).searchParams.get('requestId');
let polling = null;
let state = '';
function checked(root) { return [...document.querySelectorAll(`#${root} input:checked`)].map(input => input.value); }
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
function preview(mappings) {
  state = 'preview';
  document.getElementById('selection').hidden = true;
  document.getElementById('preview').hidden = false;
  const root = document.getElementById('mappings');
  root.replaceChildren();
  for (const mapping of mappings) root.append(checkRow(mapping.fieldId, `${mapping.fieldLabel} ← ${mapping.sourceLabel}`, mapping.value, true));
  status(`匹配到 ${mappings.length} 个字段，请检查后确认填写。`);
}
async function refresh() {
  const data = await send({ type: 'GET_CONFIRMATION', requestId });
  document.getElementById('target-site').textContent = data.url;
  if (data.status === 'preview' && state !== 'preview') preview(data.mappings);
  else if (data.status === 'detected' && state !== 'detected') {
    state = 'detected';
    document.getElementById('selection').hidden = false;
    const root = document.getElementById('sources');
    root.replaceChildren();
    for (const source of data.sources) root.append(checkRow(source.id, source.label, source.value, !source.sensitive, source.sensitive));
    status(data.error || '取消或直接关闭这个窗口，都不会开始填写。', Boolean(data.error));
  } else if (data.status === 'matching' || data.status === 'applying') {
    state = data.status;
    document.getElementById('selection').hidden = true;
    document.getElementById('preview').hidden = true;
    status(data.status === 'matching' ? '正在匹配字段，尚未填写网页…' : '正在填写网页…');
    polling = setTimeout(() => refresh().catch(error => status(error.message, true)), 1000);
  } else if (data.status === 'completed') finish(data.result);
  else if (data.status === 'error') status(data.error, true);
}
function finish(result) {
  clearTimeout(polling);
  state = 'completed';
  document.getElementById('selection').hidden = true;
  document.getElementById('preview').hidden = true;
  document.getElementById('cancel').textContent = '关闭';
  status(`已填写 ${result.filled} 个字段，跳过 ${result.skipped} 个。检测已关闭，请回到网页检查并自行提交。`);
}
onClick('select-common', () => document.querySelectorAll('#sources input').forEach(input => { input.checked = input.dataset.sensitive !== 'true'; }));
onClick('select-none', () => document.querySelectorAll('#sources input').forEach(input => { input.checked = false; }));
onClick('match', async () => {
  const sourceIds = checked('sources');
  if (!sourceIds.length) throw new Error('请先选择资料项');
  state = 'matching';
  document.getElementById('selection').hidden = true;
  status('正在匹配字段，尚未填写网页…');
  try {
    const result = await send({ type: 'MATCH_FIELDS', requestId, sourceIds, overwrite: document.getElementById('overwrite').checked });
    preview(result.mappings);
  } catch (error) {
    state = '';
    try { await refresh(); } catch { /* cancelled or changed page */ }
    throw error;
  }
});
onClick('apply', async () => {
  const fieldIds = checked('mappings');
  if (!fieldIds.length) throw new Error('请选择需要填写的字段');
  document.getElementById('preview').hidden = true;
  status('正在填写网页…');
  finish(await send({ type: 'APPLY_FIELDS', requestId, fieldIds }));
});
onClick('cancel', async () => {
  clearTimeout(polling);
  try { await send({ type: 'CANCEL_CONFIRMATION', requestId }); }
  finally { window.close(); }
});
refresh().catch(error => status(error.message, true));
