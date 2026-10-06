import './semantics-core.js';
// Personal values are uploaded only after per-operation AI-assistance consent.
const semantics = globalThis.__resumeSemantics;
export const API_URL = 'https://api.deepseek.com/chat/completions';
export const MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
export const DEFAULT_MODEL = MODELS[0];
export const MAX_FIELDS = 400;
export const FIELD_BATCH_SIZE = 60;
export const MAX_ENTRIES = 20;
export const PROFILE_SCHEMA = {
  basic: {
    title: '基本信息', fields: {
      name: '姓名', gender: '性别', birthday: '出生日期', phone: '手机号', email: '邮箱',
      location: '现居城市', hukou: '户籍所在地', nativePlace: '籍贯', ethnicity: '民族',
      political: '政治面貌', marital: '婚姻状况', workYears: '工作年限',
      availableDate: '到岗时间', expectedGraduationDate: '预计毕业时间（YYYY-MM）',
      englishName: '英文姓名', nationality: '国籍', highestDegree: '最高学历',
      preferredName: '常用名', alternatePhone: '备用联系电话', jobStatus: '求职状态', currentSalary: '当前薪资',
      website: '个人网站', github: 'GitHub 地址', wechat: '微信号',
      address: '详细地址', idCard: '身份证号', height: '身高', weight: '体重',
      emergencyName: '紧急联系人姓名', emergencyPhone: '紧急联系人电话'
    }
  },
  education: {
    title: '教育经历', multiple: true, fields: {
      school: '学校', major: '专业', degree: '学历', degreeName: '学位名称', college: '学院 / 院系',
      country: '学校所在国家 / 地区', city: '学校所在城市', studyMode: '学习形式（全日制等）',
      majorCategory: '专业大类', researchDirection: '研究方向', supervisor: '导师',
      duration: '学制', isRegular: '是否统招', isHighest: '是否最高学历',
      gpa: 'GPA / 排名', startDate: '开始时间', endDate: '结束时间',
      ranking: '专业排名', coreCourses: '主修课程', description: '在校经历', awards: '获奖 / 荣誉（历史兼容）', publications: '论文 / 专利（历史兼容）'
    }
  },
  work: {
    title: '工作经历', multiple: true, fields: {
      company: '公司', department: '部门', position: '职位', type: '工作类型', city: '工作城市',
      industry: '行业', employmentType: '用工形式', startDate: '开始时间', endDate: '结束时间',
      description: '工作描述', responsibilities: '职责', achievements: '工作成果', leavingReason: '离职原因'
    }
  },
  internships: {
    title: '实习经历', multiple: true, fields: {
      company: '实习公司', department: '部门', position: '实习岗位', city: '实习城市',
      startDate: '开始时间', endDate: '结束时间', daysPerWeek: '每周实习天数',
      description: '实习描述', responsibilities: '实习职责', achievements: '实习成果'
    }
  },
  projects: {
    title: '项目经历', multiple: true, fields: {
      projectName: '项目名称', role: '担任角色', techStack: '技术栈', type: '项目类型',
      organization: '所属单位 / 学校', teamSize: '团队人数', url: '项目链接',
      startDate: '开始时间', endDate: '结束时间', description: '项目描述',
      responsibilities: '个人职责 / 贡献', achievements: '项目成果'
    }
  },
  awards: { title: '获奖信息', multiple: true, fields: {
    name: '奖项 / 荣誉名称', category: '奖项类别', level: '奖项级别（国家级等）', rank: '奖项等级（一等奖等）',
    issuer: '颁发单位', date: '获奖时间', description: '获奖内容 / 事迹', school: '所属学校', url: '证明链接'
  } },
  campus: { title: '校园经历', multiple: true, fields: {
    name: '活动 / 社团名称', organization: '组织', type: '活动类型', role: '担任职务',
    startDate: '开始时间', endDate: '结束时间', description: '活动内容', achievements: '活动成果'
  } },
  research: { title: '科研经历', multiple: true, fields: {
    name: '课题名称', institution: '研究机构 / 实验室', supervisor: '指导老师', role: '担任角色',
    startDate: '开始时间', endDate: '结束时间', description: '研究内容', achievements: '研究成果', url: '成果链接'
  } },
  publications: { title: '论文发表', multiple: true, fields: {
    title: '论文题目', type: '论文类型', venue: '期刊 / 会议名称', authors: '作者及署名顺序',
    date: '发表时间', status: '发表状态', doi: 'DOI', url: '论文链接', description: '论文内容'
  } },
  patents: { title: '专利信息', multiple: true, fields: {
    name: '专利名称', type: '专利类型', number: '申请 / 专利号', status: '专利状态',
    inventors: '发明人及排序', date: '申请 / 授权时间', description: '专利内容', url: '专利链接'
  } },
  languageCertificates: { title: '语言考试', multiple: true, fields: {
    language: '语种', exam: '考试名称（CET / IELTS 等）', level: '语言等级', score: '考试成绩',
    date: '考试时间', expiryDate: '有效期至', description: '语言能力说明'
  } },
  professionalCertificates: { title: '资格证书', multiple: true, fields: {
    name: '证书名称', issuer: '颁发单位', level: '证书等级', number: '证书编号', date: '获得时间',
    expiryDate: '有效期至', description: '证书内容', url: '证书链接'
  } },
  training: { title: '培训经历', multiple: true, fields: {
    name: '培训 / 课程名称', institution: '培训机构', startDate: '开始时间', endDate: '结束时间',
    certificate: '获得证书', description: '培训内容'
  } },
  volunteer: { title: '志愿经历', multiple: true, fields: {
    name: '志愿活动名称', organization: '组织', role: '担任角色', startDate: '开始时间', endDate: '结束时间',
    hours: '服务时长', description: '服务内容', achievements: '服务成果'
  } },
  portfolio: { title: '作品集', multiple: true, fields: {
    name: '作品名称', type: '作品类型', url: '作品链接', date: '完成时间', description: '作品说明'
  } },
  jobIntention: {
    title: '求职意向', fields: {
      position: '期望职位', salary: '期望薪资', city: '期望城市', type: '工作类型',
      industry: '期望行业', currentAnnual: '目前年薪', business: '意向业务 / 部门',
      relocation: '是否接受调剂 / 异地', internshipDuration: '可实习时长', daysPerWeek: '每周可实习天数'
    }
  }
};
export const TEXT_FIELDS = {
  languages: '语言能力（综合描述）', certificates: '资格证书（综合描述）', skills: '专业技能',
  selfEvaluation: '自我评价', interests: '兴趣爱好', additionalInformation: '补充信息'
};
export const SENSITIVE_KEYS = new Set([
  'basic.idCard', 'basic.address', 'basic.emergencyName', 'basic.emergencyPhone',
  'basic.currentSalary', 'jobIntention.currentAnnual', 'professionalCertificates.number'
]);
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 必须是对象`);
}
function checkKeys(value, allowed, name, strict) {
  for (const key of Object.keys(value)) {
    if (forbidden.has(key) || (strict && !allowed.includes(key))) throw new Error(`${name} 含不允许的字段：${key}`);
  }
}
function cleanText(value, name) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error(`${name} 必须是文本`);
  if (value.length > 20000) throw new Error(`${name} 超过 20000 字符，请缩短`);
  return value.trim();
}
export function normalizeProfile(value = {}, { strict = true } = {}) {
  assertObject(value, '个人信息');
  checkKeys(value, [...Object.keys(PROFILE_SCHEMA), ...Object.keys(TEXT_FIELDS)], '个人信息', strict);
  const result = {};
  for (const [section, schema] of Object.entries(PROFILE_SCHEMA)) {
    const cleanRecord = record => {
      assertObject(record, schema.title);
      checkKeys(record, Object.keys(schema.fields), schema.title, strict);
      const clean = {};
      for (const key of Object.keys(schema.fields)) clean[key] = cleanText(record[key], `${schema.title}/${key}`);
      if (section === 'basic' && clean.expectedGraduationDate && !/^\d{4}-(0[1-9]|1[0-2])$/.test(clean.expectedGraduationDate)) {
        throw new Error('预计毕业时间请填写 YYYY-MM，如 2027-06');
      }
      return clean;
    };
    if (schema.multiple) {
      const entries = value[section] ?? [];
      if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error(`${schema.title} 最多 ${MAX_ENTRIES} 条`);
      result[section] = entries.map(cleanRecord).filter(record => Object.values(record).some(Boolean));
    } else result[section] = cleanRecord(value[section] ?? {});
  }
  for (const key of Object.keys(TEXT_FIELDS)) result[key] = cleanText(value[key], TEXT_FIELDS[key]);
  if (JSON.stringify(result).length > 200000) throw new Error('个人信息总量过大，请减少条目');
  return result;
}

export function profileSources(profile) {
  const sources = [];
  const add = (key, label, value) => {
    if (value) {
      const parts = key.split('.');
      sources.push({ id: `S${sources.length}`, key, label, value,
        section: PROFILE_SCHEMA[parts[0]] ? parts[0] : 'other', fieldKey: parts.at(-1),
        recordIndex: /^\d+$/.test(parts[1]) ? Number(parts[1]) : null,
        sensitive: SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(`${parts[0]}.${parts.at(-1)}`) });
    }
  };
  for (const [section, schema] of Object.entries(PROFILE_SCHEMA)) {
    if (schema.multiple) {
      profile[section].forEach((record, index) => {
        for (const [key, label] of Object.entries(schema.fields)) {
          add(`${section}.${index}.${key}`, `第 ${index + 1} 条${schema.title} / ${label}`, record[key]);
        }
      });
    } else {
      for (const [key, label] of Object.entries(schema.fields)) add(`${section}.${key}`, `${schema.title} / ${label}`, profile[section][key]);
    }
  }
  for (const [key, label] of Object.entries(TEXT_FIELDS)) add(key, label, profile[key]);
  return sources;
}

export function selectedSources(sources, ids) {
  const selected = sources.filter(source => ids.includes(source.id));
  const indices = new Map();
  for (const source of selected) if (source.recordIndex !== null) {
    if (!indices.has(source.section)) indices.set(source.section, []);
    if (!indices.get(source.section).includes(source.recordIndex)) indices.get(source.section).push(source.recordIndex);
  }
  const workCount = indices.get('work')?.length || 0, languageCount = indices.get('languageCertificates')?.length || 0;
  return selected.map(source => ({ ...source,
    slotIndex: source.recordIndex === null ? null : indices.get(source.section).indexOf(source.recordIndex),
    employmentIndex: source.section === 'work' ? indices.get('work').indexOf(source.recordIndex)
      : source.section === 'internships' ? workCount + indices.get('internships').indexOf(source.recordIndex) : null,
    qualificationsIndex: source.section === 'languageCertificates' ? indices.get('languageCertificates').indexOf(source.recordIndex)
      : source.section === 'professionalCertificates' ? languageCount + indices.get('professionalCertificates').indexOf(source.recordIndex) : null }));
}

export function recordTargets(sources) {
  const targets = {};
  for (const source of sources) if (source.recordIndex !== null) {
    targets[source.section] = Math.max(targets[source.section] || 0, (source.slotIndex ?? source.recordIndex) + 1);
  }
  if (targets.work || targets.internships) targets.employment = (targets.work || 0) + (targets.internships || 0);
  if (targets.languageCertificates || targets.professionalCertificates) targets.qualifications = (targets.languageCertificates || 0) + (targets.professionalCertificates || 0);
  return targets;
}

export function sourceConflict(field, source, { manualUnknown = false } = {}) {
  const section = field.section || semantics.inferSection([field.label, field.name, field.placeholder].join(' '));
  if (section === 'employment') {
    if (!['work', 'internships'].includes(source.section)) return 'section_mismatch';
  } else if (section === 'qualifications') {
    if (!['languageCertificates', 'professionalCertificates'].includes(source.section) && !['languages', 'certificates', 'skills'].includes(source.key)) return 'section_mismatch';
  } else if (section !== 'unknown' && section !== source.section && !(section === 'languageCertificates' && source.key === 'languages')
    && !(section === 'professionalCertificates' && source.key === 'certificates')) return 'section_mismatch';
  else if (section === 'unknown' && source.recordIndex !== null && !manualUnknown) return 'unknown_section';
  if (source.recordIndex !== null) {
    if (field.recordIndex == null && !(section === 'unknown' && manualUnknown)) return 'unknown_record';
    const index = section === 'employment' ? source.employmentIndex : section === 'qualifications' ? source.qualificationsIndex : source.slotIndex ?? source.recordIndex;
    if (field.recordIndex !== index && !(section === 'unknown' && manualUnknown)) return 'record_mismatch';
  }
  const kind = semantics.fieldKind(field.label || field.name || field.placeholder, section);
  if (kind === 'degree' && section === 'basic' && source.fieldKey === 'highestDegree') return null;
  if (kind === 'expectedGraduationDate' && source.section === 'education' && source.fieldKey === 'endDate') {
    return /^\d{4}[-/.]\d{1,2}$/.test(source.value) ? null : 'graduation_month_required';
  }
  return !kind || source.fieldKey === kind ? null : 'field_mismatch';
}
export function sourceAllowed(field, source, options) {
  if (options?.relaxed === true) return true;
  return sourceConflict(field, source, options) === null;
}

export function localMatchPairs(fields, sources) {
  const cleanLabel = value => String(value || '').replace(/（[^）]*）|\([^)]*\)/g, '').replace(/[\s*＊：:]/g, '')
    .replace(/^(?:请输入|请选择|请填写)/, '').toLowerCase();
  return fields.flatMap(field => {
    const kind = semantics.fieldKind(field.label || field.name || field.placeholder, field.section);
    const candidates = sources.filter(source => sourceAllowed(field, source) && (kind
      ? source.fieldKey === kind || (kind === 'degree' && field.section === 'basic' && source.fieldKey === 'highestDegree')
      : cleanLabel(field.label || field.placeholder || field.name) === cleanLabel(PROFILE_SCHEMA[source.section]?.fields[source.fieldKey] || TEXT_FIELDS[source.fieldKey])));
    return candidates.length === 1 ? [{ fieldId: field.id, sourceId: candidates[0].id }] : [];
  });
}

export function fieldDiagnostic(field) {
  return { id: field.id, section: field.section, recordIndex: field.recordIndex,
    componentType: field.componentType, hasValue: field.hasValue,
    kind: semantics.fieldKind(field.label || field.name || field.placeholder, field.section) };
}
export function sourceDiagnostic(source) {
  return { id: source.id, section: source.section, recordIndex: source.slotIndex ?? source.recordIndex,
    employmentIndex: source.employmentIndex ?? null, qualificationsIndex: source.qualificationsIndex ?? null, fieldKey: source.fieldKey };
}
export function diagnosticReason(detail) {
  const field = detail.field, source = detail.source;
  const title = (section, key) => PROFILE_SCHEMA[section]?.fields[key] || TEXT_FIELDS[key] || key;
  const slot = index => index == null ? '条目未知' : `第 ${index + 1} 条`;
  const from = `${semantics.titles[field.section]} / ${slot(field.recordIndex)}`;
  const to = `${semantics.titles[source.section]} / ${slot(field.section === 'employment' ? source.employmentIndex : field.section === 'qualifications' ? source.qualificationsIndex : source.recordIndex)}`;
  const reasons = {
    section_mismatch: `网页识别为${from}，模型选择了${to}`,
    record_mismatch: `网页是${from}，模型选择了${to}`,
    unknown_section: '网页经历区块未识别，不能自动选择多条经历资料',
    unknown_record: '网页经历条目编号未识别，不能自动对应个人经历',
    field_mismatch: `字段含义要求“${title(field.section, field.kind)}”，模型选择了“${title(source.section, source.fieldKey)}”`,
    graduation_month_required: '预计毕业时间需要明确的毕业年月'
  };
  return `${field.id}：${reasons[detail.reason] || '对应关系未通过校验'}`;
}
export class MappingValidationError extends Error {
  constructor(field, source, reason) {
    const diagnostic = { reason, field: fieldDiagnostic(field), source: sourceDiagnostic(source) };
    super(`模型把资料映射到了错误的经历区块、条目或字段；已阻止填写（${diagnosticReason(diagnostic)}）`);
    this.name = 'MappingValidationError';
    this.diagnostic = diagnostic;
  }
}

const TYPES = new Set(['native-input', 'native-select', 'native-radio', 'contenteditable', 'wrapper-input', 'custom-dropdown', 'custom-datepicker', 'custom-interactive']);
export function normalizeFields(fields) {
  if (!Array.isArray(fields) || fields.length > MAX_FIELDS) throw new Error(`一次最多检测 ${MAX_FIELDS} 个字段`);
  const seen = new Set();
  return fields.map(field => {
    if (!field || !/^F\d{1,3}$/.test(field.id) || seen.has(field.id) || !TYPES.has(field.componentType)) throw new Error('页面字段数据异常，请重新检测');
    seen.add(field.id);
    const text = (key, limit) => typeof field[key] === 'string' ? field[key].slice(0, limit) : '';
    const section = Object.hasOwn(semantics.titles, field.section) ? field.section : semantics.inferSection(text('label', 80) || text('name', 80));
    const recordIndex = Number.isInteger(field.recordIndex) && field.recordIndex >= 0 && field.recordIndex < MAX_ENTRIES * 2 ? field.recordIndex : null;
    return { id: field.id, label: text('label', 80), placeholder: text('placeholder', 100), name: text('name', 80), componentType: field.componentType,
      section, sectionLabel: text('sectionLabel', 100), recordIndex, hasValue: field.hasValue === true };
  });
}

export function validateMatches(reply, fields, sources, { manualUnknown = false, relaxed = false } = {}) {
  if (typeof reply !== 'string' || reply.length > 65536) throw new Error('模型返回内容异常');
  let data;
  try { data = JSON.parse(reply); } catch { throw new Error('模型没有返回有效 JSON，请重试'); }
  assertObject(data, '模型结果');
  checkKeys(data, ['mappings'], '模型结果', true);
  if (!Array.isArray(data.mappings) || data.mappings.length > fields.length) throw new Error('模型映射数量异常');
  const fieldMap = new Map(fields.map(field => [field.id, field]));
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const seen = new Set();
  return data.mappings.map(mapping => {
    assertObject(mapping, '模型映射');
    checkKeys(mapping, ['fieldId', 'sourceId'], '模型映射', true);
    const field = fieldMap.get(mapping.fieldId);
    const source = sourceMap.get(mapping.sourceId);
    if (!field || !source || seen.has(field.id)) throw new Error('模型引用了未授权或重复的资料项');
    const conflict = sourceConflict(field, source, { manualUnknown });
    if (conflict && !relaxed) throw new MappingValidationError(field, source, conflict);
    seen.add(field.id);
    return { fieldId: field.id, sourceId: source.id, fieldLabel: field.label || field.placeholder || field.name || field.id,
      section: field.section, recordIndex: field.recordIndex, hasValue: field.hasValue,
      ...(conflict ? { needsReview: true, warning: diagnosticReason({ reason: conflict, field: fieldDiagnostic(field), source: sourceDiagnostic(source) }), conflict } : {}),
      sourceLabel: source.label, value: source.value, componentType: field.componentType };
  });
}

export function validateReviews(reply, fields) {
  let data;
  try { data = JSON.parse(reply); } catch { throw new Error('AI 校对未返回有效 JSON'); }
  assertObject(data, '校对结果');
  checkKeys(data, ['reviews'], '校对结果', true);
  if (!Array.isArray(data.reviews) || data.reviews.length > fields.length) throw new Error('AI 校对数量异常');
  const seen = new Set();
  for (const review of data.reviews) {
    assertObject(review, '校对条目');
    checkKeys(review, ['fieldId', 'status', 'reason'], '校对条目', true);
    if (!fields.some(field => field.id === review.fieldId) || seen.has(review.fieldId)
      || !['ok', 'warning', 'uncertain'].includes(review.status) || typeof review.reason !== 'string' || review.reason.length > 500) throw new Error('AI 校对条目异常');
    seen.add(review.fieldId);
  }
  return fields.map(field => data.reviews.find(review => review.fieldId === field.id)
    || { fieldId: field.id, status: 'uncertain', reason: 'AI 未校对此字段，请人工检查。' });
}
