export async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result || result.error) throw new Error(result?.error || '扩展没有响应，请重新加载扩展');
  return result;
}
export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function status(text, error = false) {
  const node = document.getElementById('status');
  node.textContent = text;
  node.className = error ? 'status error' : 'status';
}
export function onClick(id, action) {
  document.getElementById(id).addEventListener('click', async event => {
    if (!event.isTrusted) return;
    const button = event.currentTarget;
    button.disabled = true;
    try { await action(); } catch (error) { status(error.message, true); }
    finally { button.disabled = false; }
  });
}
export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = element('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
