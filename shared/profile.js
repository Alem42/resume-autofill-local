// All personal values stay local. The model only sees fixed labels and opaque IDs.
export const API_URL = 'https://api.deepseek.com/chat/completions';
export const MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
export const DEFAULT_MODEL = MODELS[0];
export const MAX_FIELDS = 120;
export const MAX_ENTRIES = 20;
export const PROFILE_SCHEMA = {
  basic: {
    title: '基本信息', fields: {
      name: '姓名', gender: '性别', birthday: '出生日期', phone: '手机号', email: '邮箱',
      location: '现居城市', hukou: '户籍所在地', nativePlace: '籍贯', ethnicity: '民族',
      political: '政治面貌', marital: '婚姻状况', workYears: '工作年限',
      availableDate: '到岗时间', jobStatus: '求职状态', currentSalary: '当前薪资',
      website: '个人网站', github: 'GitHub 地址', wechat: '微信号',
      address: '详细地址', idCard: '身份证号', height: '身高', weight: '体重',
      emergencyName: '紧急联系人姓名', emergencyPhone: '紧急联系人电话'
    }
  },
  education: {
    title: '教育经历', multiple: true, fields: {
      school: '学校', major: '专业', degree: '学历', duration: '学制', isRegular: '是否统招',
      gpa: 'GPA / 排名', startDate: '开始时间', endDate: '结束时间',
      description: '在校经历', awards: '获奖 / 荣誉', publications: '论文 / 专利'
    }
  },
  work: {
    title: '工作经历', multiple: true, fields: {
      company: '公司', department: '部门', position: '职位', type: '工作类型', city: '工作城市',
      startDate: '开始时间', endDate: '结束时间', description: '工作描述'
    }
  },
  projects: {
    title: '项目经历', multiple: true, fields: {
      projectName: '项目名称', role: '担任角色', techStack: '技术栈',
      startDate: '开始时间', endDate: '结束时间', description: '项目描述'
    }
  },
  jobIntention: {
    title: '求职意向', fields: {
      position: '期望职位', salary: '期望薪资', city: '期望城市', type: '工作类型',
      industry: '期望行业', currentAnnual: '目前年薪'
    }
  }
};
export const TEXT_FIELDS = {
  languages: '语言能力', certificates: '资格证书', skills: '专业技能', selfEvaluation: '自我评价'
};
export const SENSITIVE_KEYS = new Set([
  'basic.idCard', 'basic.address', 'basic.emergencyName', 'basic.emergencyPhone',
  'basic.currentSalary', 'jobIntention.currentAnnual'
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
    if (value) sources.push({ id: `S${sources.length}`, key, label, value, sensitive: SENSITIVE_KEYS.has(key) });
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

const TYPES = new Set(['native-input', 'native-select', 'contenteditable', 'wrapper-input', 'custom-dropdown', 'custom-datepicker', 'custom-interactive']);
export function normalizeFields(fields) {
  if (!Array.isArray(fields) || fields.length > MAX_FIELDS) throw new Error(`一次最多检测 ${MAX_FIELDS} 个字段`);
  const seen = new Set();
  return fields.map(field => {
    if (!field || !/^F\d{1,3}$/.test(field.id) || seen.has(field.id) || !TYPES.has(field.componentType)) throw new Error('页面字段数据异常，请重新检测');
    seen.add(field.id);
    const text = (key, limit) => typeof field[key] === 'string' ? field[key].slice(0, limit) : '';
    return { id: field.id, label: text('label', 80), placeholder: text('placeholder', 100), name: text('name', 80), componentType: field.componentType };
  });
}

export function validateMatches(reply, fields, sources) {
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
    seen.add(field.id);
    return { fieldId: field.id, sourceId: source.id, fieldLabel: field.label || field.placeholder || field.name || field.id,
      sourceLabel: source.label, value: source.value, componentType: field.componentType };
  });
}
