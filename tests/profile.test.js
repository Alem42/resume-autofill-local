import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { normalizeProfile, profileSources, selectedSources, recordTargets, normalizeFields, validateMatches, validateReviews, API_URL } from '../shared/profile.js';

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

test('预计毕业时间严格精确到月，新增奖项及独立实习资料可以往返保存', () => {
  const profile = normalizeProfile({ basic: { expectedGraduationDate: '2027-06' }, education: [{ majorCategory: '工学' }],
    internships: [{ company: '虚构实习单位' }], awards: [{ name: '虚构竞赛', level: '省级', rank: '一等奖', description: '演示事迹' }] });
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(profile))), profile);
  assert.equal(profile.awards[0].rank, '一等奖');
  for (const date of ['2027', '2027-13', '2027-6', '2027-06-01']) assert.throws(() => normalizeProfile({ basic: { expectedGraduationDate: date } }));
});

test('本地拒绝教育映射到工作、跨条目及起止颠倒，即使模型判断错误', () => {
  const sources = profileSources(normalizeProfile({ education: [{ school: '学校一', startDate: '2020-09', endDate: '2024-06' }, { school: '学校二' }], work: [{ company: '公司一' }] }));
  const education = normalizeFields([{ id: 'F0', section: 'education', recordIndex: 0, label: '学校名称', componentType: 'native-input' }]);
  const start = normalizeFields([{ id: 'F1', section: 'education', recordIndex: 0, label: '开始时间', componentType: 'native-input' }]);
  const reply = (fieldId, key) => JSON.stringify({ mappings: [{ fieldId, sourceId: sources.find(source => source.key === key).id }] });
  assert.equal(validateMatches(reply('F0', 'education.0.school'), education, sources)[0].value, '学校一');
  for (const key of ['work.0.company', 'education.1.school']) assert.throws(() => validateMatches(reply('F0', key), education, sources));
  assert.throws(() => validateMatches(reply('F1', 'education.0.endDate'), start, sources));
  assert.throws(() => validateMatches(reply('F0', 'education.1.school'), education, sources, { manualUnknown: true }));
});

test('选择第二条经历时从网页第一条开始，合并的工作与实习具有独立且明确的连续序号', () => {
  const all = profileSources(normalizeProfile({ education: [{ school: '跳过的学校' }, { school: '选择的学校', major: '选择的专业' }], work: [{ company: '工作单位' }], internships: [{ company: '实习单位' }] }));
  const selected = selectedSources(all, all.filter(source => !source.key.startsWith('education.0.')).map(source => source.id));
  assert.equal(selected.find(source => source.key === 'education.1.school').slotIndex, 0);
  assert.deepEqual(recordTargets(selected), { education: 1, work: 1, internships: 1, employment: 2 });
  const fields = normalizeFields([{ id: 'F0', section: 'employment', recordIndex: 1, label: '公司名称', componentType: 'native-input' }]);
  const work = selected.find(source => source.key === 'work.0.company'), internship = selected.find(source => source.key === 'internships.0.company');
  assert.throws(() => validateMatches(JSON.stringify({ mappings: [{ fieldId: 'F0', sourceId: work.id }] }), fields, selected));
  assert.equal(validateMatches(JSON.stringify({ mappings: [{ fieldId: 'F0', sourceId: internship.id }] }), fields, selected)[0].value, '实习单位');
});

test('未知重复经历区块仅允许用户手动指定授权资料，模型不得猜测', () => {
  const sources = profileSources(normalizeProfile({ projects: [{ description: '演示项目内容' }] }));
  const fields = normalizeFields([{ id: 'F0', label: '详细内容', section: 'unknown', componentType: 'native-input' }]);
  const reply = '{"mappings":[{"fieldId":"F0","sourceId":"S0"}]}';
  assert.throws(() => validateMatches(reply, fields, sources));
  assert.equal(validateMatches(reply, fields, sources, { manualUnknown: true })[0].value, '演示项目内容');
});

test('AI 校对只能给授权字段状态和理由，缺失项强制待人工判断，禁止自动改值', () => {
  const fields = [{ id: 'F0' }, { id: 'F1' }];
  const reviews = validateReviews('{"reviews":[{"fieldId":"F0","status":"ok","reason":"语义一致"}]}', fields);
  assert.equal(reviews.find(review => review.fieldId === 'F1').status, 'uncertain');
  for (const review of [{ fieldId: 'F9', status: 'ok', reason: '' }, { fieldId: 'F0', status: 'ok', reason: '', value: 'MODEL_INVENTED' }, { fieldId: 'F0', status: 'fill', reason: '' }]) {
    assert.throws(() => validateReviews(JSON.stringify({ reviews: [review] }), fields));
  }
});

test('基本信息的毕业年月和教育结束时间分别取值，奖项级别和等级不能串填', () => {
  const sources = profileSources(normalizeProfile({ basic: { expectedGraduationDate: '2027-06' }, education: [{ endDate: '2024-06' }], awards: [{ level: '国家级', rank: '一等奖' }] }));
  const fields = normalizeFields([{ id: 'F0', label: '毕业年月', section: 'basic', componentType: 'native-input' }, { id: 'F1', label: '奖项级别', section: 'awards', recordIndex: 0, componentType: 'native-input' }]);
  const graduation = sources.find(source => source.key === 'basic.expectedGraduationDate');
  assert.equal(validateMatches(JSON.stringify({ mappings: [{ fieldId: 'F0', sourceId: graduation.id }] }), fields, sources)[0].value, '2027-06');
  const rank = sources.find(source => source.key === 'awards.0.rank');
  assert.throws(() => validateMatches(JSON.stringify({ mappings: [{ fieldId: 'F1', sourceId: rank.id }] }), fields, sources));
});

test('公开演示资料可按白名单导入且没有真实联系方式或密钥', () => {
  const raw = readFileSync(new URL('../examples/profile.example.json', import.meta.url), 'utf8');
  const profile = normalizeProfile(JSON.parse(raw));
  assert.equal(profile.education.length, 2); assert.equal(profile.projects.length, 3);
  assert.ok(profile.basic.email.endsWith('@example.invalid')); assert.equal(profile.basic.idCard, '');
  assert.equal(/apiKey|secret|sk-[A-Za-z0-9]/.test(raw), false);
});
