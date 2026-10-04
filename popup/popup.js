import { send, status, onClick } from '../shared/ui.js';
const toggle = document.getElementById('detection');
const labels = { off: '本页检测未开启', watching: '正在检测本页，等待简历表单…',
  detected: '等待你在确认窗口选择资料', matching: '正在匹配字段，尚未填写',
  preview: '等待你检查填写预览', applying: '正在填写网页', completed: '本次填写已结束，检测已关闭', error: '本次填写已中断，请检查网页后重新检测' };
async function refresh() {
  const data = await send({ type: 'GET_STATUS' });
  toggle.checked = data.active;
  toggle.disabled = false;
  try { document.getElementById('page-host').textContent = new URL(data.url).hostname || '本地页面'; }
  catch { document.getElementById('page-host').textContent = '请打开要填写的网页'; }
  status(!data.hasProfile || !data.hasKey ? '请先保存个人信息和 DeepSeek API Key' : labels[data.status] || '本页检测未开启');
}
toggle.addEventListener('change', async event => {
  if (!event.isTrusted) return;
  toggle.disabled = true;
  try {
    await send({ type: toggle.checked ? 'START_DETECTION' : 'STOP_DETECTION' });
    await refresh();
  } catch (error) {
    toggle.checked = false;
    status(error.message, true);
  } finally { toggle.disabled = false; }
});
onClick('open-options', () => chrome.runtime.openOptionsPage());
refresh().catch(error => status(error.message, true));
