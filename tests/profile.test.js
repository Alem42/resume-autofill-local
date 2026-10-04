import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { normalizeProfile, profileSources, normalizeFields, validateMatches, API_URL } from '../shared/profile.js';

test('个人信息导入拒绝接口、密钥、未知字段与原型污染', () => {
  for (const data of [{ llm: { baseUrl: 'https://evil.invalid', apiKey: 'SECRET' } },
    { settings: {} }, { secret: 'SECRET' }, { basic: { apiKey: 'SECRET' } },
    JSON.parse('{"__proto__":{"polluted":true}}'), JSON.parse('{"basic":{"constructor":"bad"}}')]) {
    assert.throws(() => normalizeProfile(data));
  }
  assert.equal({}.polluted, undefined);
});
test('完整保留长经历，过长输入报错而非截断', () => {
  const text = '真实经历'.repeat(1500);
  assert.equal(normalizeProfile({ work: [{ description: text }] }).work[0].description, text);
  assert.throws(() => normalizeProfile({ basic: { name: 123 } }));
  assert.throws(() => normalizeProfile({ work: Array.from({ length: 21 }, () => ({})) }));
  assert.throws(() => normalizeProfile({ skills: 'a'.repeat(20001) }));
});
test('资料项描述不包含资料值，敏感资料明确标记', () => {
  const sources = profileSources(normalizeProfile({ basic: { name: 'PRIVATE_NAME', idCard: 'PRIVATE_ID' }, work: [{ company: 'PRIVATE_COMPANY' }] }));
  assert.equal(sources.find(source => source.key === 'basic.idCard').sensitive, true);
  assert.equal(sources.find(source => source.key === 'basic.name').sensitive, false);
  assert.equal(JSON.stringify(sources.map(({ id, label }) => ({ id, label }))).includes('PRIVATE_'), false);
});
test('只从授权资料取值，拒绝任意 selector、value、未知编号与重复映射', () => {
  const fields = normalizeFields([{ id: 'F0', label: '姓名', componentType: 'native-input' }]);
  const sources = profileSources(normalizeProfile({ basic: { name: 'LOCAL_VALUE' } }));
  const valid = validateMatches('{"mappings":[{"fieldId":"F0","sourceId":"S0"}]}', fields, sources);
  assert.equal(valid[0].value, 'LOCAL_VALUE');
  for (const mappings of [
    [{ fieldId: 'F0', sourceId: 'S0', selector: '#password' }],
    [{ fieldId: 'F0', sourceId: 'S0', value: 'injected' }],
    [{ fieldId: 'F1', sourceId: 'S0' }], [{ fieldId: 'F0', sourceId: 'S9' }],
    [{ fieldId: 'F0', sourceId: 'S0' }, { fieldId: 'F0', sourceId: 'S0' }]
  ]) assert.throws(() => validateMatches(JSON.stringify({ mappings }), fields, sources));
  assert.throws(() => validateMatches('```json\n{}\n```', fields, sources));
});
test('网页字段元数据剥离 selector、已有值和任意内容', () => {
  const fields = normalizeFields([{ id: 'F0', label: '姓名', value: 'PRIVATE_VALUE', contextText: 'PRIVATE_CONTEXT', selector: '#target', componentType: 'native-input' }]);
  assert.equal(JSON.stringify(fields).includes('PRIVATE'), false);
  assert.equal(fields[0].selector, undefined);
  assert.throws(() => normalizeFields([{ id: 'F0', componentType: 'script' }]));
});
test('安装包只授权 DeepSeek 和手动当前页，所有 UI 资源存在且不包含 PDF', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.host_permissions, ['https://api.deepseek.com/*']);
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'scripting']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(existsSync(new URL('../lib/pdf.min.js', import.meta.url)), false);
  assert.equal(API_URL, 'https://api.deepseek.com/chat/completions');
  for (const page of ['popup/popup.html', 'options/options.html', 'confirm/confirm.html']) {
    const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8');
    for (const [, src] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert.equal(/^https?:/.test(src), false);
      assert.equal(existsSync(new URL(src, new URL('../' + page, import.meta.url))), true);
    }
  }
});
