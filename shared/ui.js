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
