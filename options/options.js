import { PROFILE_SCHEMA, TEXT_FIELDS, SENSITIVE_KEYS, MAX_ENTRIES, normalizeProfile } from '../shared/profile.js';
import { send, element, status, onClick } from '../shared/ui.js';

const containers = new Map();
const longFields = new Set(['description', 'awards', 'publications', 'responsibilities', 'achievements', 'coreCourses', 'authors', 'leavingReason']);
function field(section, key, label, value = '') {
  const wrapper = element('label', 'field' + (longFields.has(key) ? ' wide' : ''));
  const sensitive = SENSITIVE_KEYS.has(`${section}.${key}`);
  wrapper.append(element('span', sensitive ? 'sensitive' : '', label + (sensitive ? '（敏感，可留空）' : '')));
  const input = element(longFields.has(key) ? 'textarea' : 'input');
  if (input.tagName === 'INPUT') input.type = key === 'expectedGraduationDate' ? 'month' : 'text';
  input.dataset.key = key;
  input.value = value;
  input.maxLength = 20000;
  input.autocomplete = 'off';
  if (/Date$|birthday/.test(key)) input.placeholder = '如：2024-06；结束时间可写“至今”';
  wrapper.append(input);
  return wrapper;
}
function record(section, schema, data = {}) {
  const node = element('div', 'entry');
  if (schema.multiple) {
    const header = element('div', 'entry-header');
    header.append(element('strong', '', schema.title));
    const remove = element('button', '', '删除本条');
    remove.type = 'button';
    remove.addEventListener('click', event => {
      if (!event.isTrusted) return;
      node.remove();
      updateOrder(section);
      status('有未保存的修改');
    });
    const actions = element('div', 'row');
    for (const [label, direction] of [['上移', -1], ['下移', 1]]) {
      const move = element('button', '', label); move.type = 'button';
      move.addEventListener('click', event => {
        if (!event.isTrusted) return;
        const sibling = direction < 0 ? node.previousElementSibling : node.nextElementSibling;
        if (!sibling) return;
        if (direction < 0) node.parentElement.insertBefore(node, sibling); else node.parentElement.insertBefore(sibling, node);
        updateOrder(section); status('顺序已调整，请保存。');
      });
      actions.append(move);
    }
    actions.append(remove); header.append(actions);
    node.append(header);
  }
  const grid = element('div', 'grid');
  for (const [key, label] of Object.entries(schema.fields)) grid.append(field(section, key, label, data[key] || ''));
  node.append(grid);
  return node;
}
function render(profile) {
  const root = document.getElementById('profile-sections');
  root.replaceChildren();
  containers.clear();
  for (const [section, schema] of Object.entries(PROFILE_SCHEMA)) {
    const details = element('details', 'card');
    details.open = section === 'basic';
    details.append(element('summary', '', schema.title));
    const entries = element('div');
    if (schema.multiple) {
      for (const data of profile[section]) entries.append(record(section, schema, data));
      const add = element('button', '', `添加${schema.title}`);
      add.type = 'button';
      add.addEventListener('click', event => {
        if (!event.isTrusted) return;
        if (entries.children.length >= MAX_ENTRIES) return status(`最多 ${MAX_ENTRIES} 条`, true);
        entries.append(record(section, schema));
        updateOrder(section);
        status('有未保存的修改');
      });
      details.append(entries, add);
    } else {
      entries.append(record(section, schema, profile[section]));
      details.append(entries);
    }
    containers.set(section, entries);
    root.append(details);
  }
  const textCard = element('section', 'card');
  textCard.append(element('h2', '', '技能、证书与自我评价'));
  const grid = element('div', 'grid');
  for (const [key, label] of Object.entries(TEXT_FIELDS)) {
    const wrapper = element('label', 'field wide');
    wrapper.append(element('span', '', label));
    const input = element('textarea');
    input.dataset.textKey = key;
    input.value = profile[key];
    input.maxLength = 20000;
    wrapper.append(input);
    grid.append(wrapper);
  }
  textCard.append(grid);
  root.append(textCard);
  for (const section of containers.keys()) updateOrder(section);
}
function updateOrder(section) {
  if (!PROFILE_SCHEMA[section].multiple) return;
  [...containers.get(section).children].forEach((node, index) => {
    node.querySelector('.entry-header strong').textContent = `第 ${index + 1} 条${PROFILE_SCHEMA[section].title}`;
  });
}
function collect() {
  const data = {};
  for (const [section, schema] of Object.entries(PROFILE_SCHEMA)) {
    const entries = [...containers.get(section).children].map(node => {
      const record = {};
      node.querySelectorAll('[data-key]').forEach(input => { record[input.dataset.key] = input.value; });
      return record;
    });
    data[section] = schema.multiple ? entries : entries[0];
  }
  document.querySelectorAll('[data-text-key]').forEach(input => { data[input.dataset.textKey] = input.value; });
  return normalizeProfile(data);
}
async function save() {
  const saved = await send({ type: 'SAVE_OPTIONS', profile: collect(), model: document.getElementById('model').value,
    apiKey: document.getElementById('api-key').value.trim(), rememberKey: document.getElementById('remember-key').checked });
  document.getElementById('api-key').value = '';
  document.getElementById('key-status').textContent = saved.hasKey ? '密钥已配置，无需重新输入。' : '尚未配置密钥。';
  status('已保存到本机');
}
async function initialize() {
  const data = await send({ type: 'GET_OPTIONS' });
  render(data.profile);
  document.getElementById('model').value = data.model;
  document.getElementById('remember-key').checked = data.rememberKey;
  document.getElementById('key-status').textContent = data.hasKey ? '密钥已配置，无需重新输入。' : '尚未配置密钥。';
  if (data.migrationNotice) status(data.migrationNotice, true);
}
document.getElementById('profile-form').addEventListener('submit', event => event.preventDefault());
document.addEventListener('input', event => { if (event.isTrusted) status('有未保存的修改'); });
onClick('save-options', save);
onClick('test-connection', async () => { await save(); status('正在测试连接…'); await send({ type: 'TEST_CONNECTION' }); status('DeepSeek 连接成功'); });
onClick('clear-key', async () => {
  await send({ type: 'CLEAR_KEY' });
  document.getElementById('api-key').value = '';
  document.getElementById('key-status').textContent = '尚未配置密钥。';
  status('已移除本机和会话中的密钥');
});
onClick('export-profile', () => {
  const blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = 'personal-profile.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
onClick('import-profile', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', async event => {
  if (!event.isTrusted) return;
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 262144) throw new Error('JSON 文件超过 256 KB');
    const data = normalizeProfile(JSON.parse(await file.text()));
    if (!window.confirm('用导入的个人信息替换当前表单？检查并保存后才会更新本机资料。')) return;
    render(data);
    status('个人信息已载入，请检查并保存');
  } catch (error) { status(`导入失败：${error.message}。只接受个人信息，不接受模型设置或密钥。`, true); }
  finally { event.target.value = ''; }
});
onClick('clear-profile', async () => {
  if (!window.confirm('清空本机保存的全部个人信息？此操作不会移除 API Key。')) return;
  await send({ type: 'CLEAR_PROFILE' });
  render(normalizeProfile());
  status('已清空个人信息');
});
initialize().catch(error => { status(error.message, true); document.getElementById('save-options').disabled = true; });
