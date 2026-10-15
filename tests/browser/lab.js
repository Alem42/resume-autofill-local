import { fixtureProfile } from './fixture-profile.js';
const variant = new URL(location.href).searchParams.get('variant') || 'enterprise';
if (variant === 'public') document.body.classList.add('public-layout');
document.getElementById('lab-mode').textContent = ({ enterprise: '双列布局 · 延迟学校搜索 · 自定义下拉 · 月 / 日历混合 · 延迟添加',
  public: '纵向布局 · 原生下拉 · 年月日拆分 · 年份改变后重新创建月份控件', stress: '预期失败：学校拒绝提交、日期无法操作、候选一直加载；用于检查跳过和超时后继续' })[variant];
const records = [], events = [], danger = { upload: 0, submit: 0 };
let uid = 0;
const node = (tag, text = '', attrs = {}) => { const el = document.createElement(tag); el.textContent = text; for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); return el; };
const track = (type, detail = {}) => events.push({ type, at: Math.round(performance.now()), ...detail });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function position(panel, input) {
  const rect = input.getBoundingClientRect(); Object.assign(panel.style, { left: `${rect.left + scrollX}px`, top: `${rect.bottom + scrollY + 4}px`, minWidth: `${rect.width}px` });
}
function row(record, label, key) {
  const root = node('div', '', { class: 'form-item', 'data-key': key }), caption = node('label', label);
  const id = `lab-field-${++uid}`; caption.htmlFor = id; root.append(caption); record.el.append(root);
  const field = { key, label, root, id, expected: String(record.data[key] ?? ''), date: false, accepted: '', input: null };
  record.fields.push(field); return field;
}
function text(record, label, key, attrs = {}) {
  const field = row(record, label, key), input = node(attrs.tag || 'input', '', { id: field.id, name: key, ...attrs }); input.removeAttribute('tag');
  field.input = input; field.date = /date|month/.test(input.type); field.root.append(input);
  if (attrs.tag === 'textarea') field.root.classList.add('full');
  const accept = () => { field.accepted = input.value; track('accepted', { key, section: record.section, index: record.index }); };
  input.addEventListener('input', accept); input.addEventListener('change', accept); return field;
}
function radio(record, label, key, values = ['是', '否']) {
  const field = row(record, label, key), group = node('div', '', { class: 'lab-radio', role: 'radiogroup', 'aria-label': label });
  for (const [index, value] of values.entries()) {
    const item = node('label', ''), input = node('input', '', { type: 'radio', name: field.id, value: values.length === 2 && values[0] === '是' ? String(index === 0) : value });
    input.addEventListener('change', () => { if (input.checked) field.accepted = input.value; }); item.append(input, node('span', value)); group.append(item);
  }
  field.root.append(group); return field;
}
function choice(record, label, key, options, { search = false, delay = 0, replace = false, refuse = false, busy = false } = {}) {
  const field = row(record, label, key), menu = node('div', '', { class: 'lab-menu', role: 'listbox', id: `${field.id}-options` });
  menu.hidden = true; document.body.append(menu); let timer, query = 0, input;
  const close = () => { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const render = async token => {
    menu.replaceChildren(); menu.hidden = false; position(menu, input); menu.setAttribute('aria-busy', 'true');
    await pause(delay); if (token !== query || !input.isConnected) return;
    if (busy) return;
    menu.setAttribute('aria-busy', 'false');
    for (const option of options) {
      const needle = input.value.toLowerCase().replace(/[（(].*$/, '').trim();
      if (search && needle && !option.toLowerCase().includes(needle) && !needle.includes(option.toLowerCase())) continue;
      const item = node('div', option, { role: 'option' });
      item.addEventListener('mousedown', event => event.preventDefault());
      item.addEventListener('click', () => {
        track('option-click', { key, section: record.section, index: record.index });
        if (!refuse) { field.accepted = option; input.value = option; input.setAttribute('aria-valuetext', option); item.setAttribute('aria-selected', 'true'); }
        close();
      }); menu.append(item);
    }
  };
  const wire = el => {
    input = el; field.input = el;
    el.addEventListener('click', () => { el.setAttribute('aria-expanded', 'true'); void render(++query); });
    el.addEventListener('input', () => { if (!search) return; field.accepted = ''; el.removeAttribute('aria-valuetext'); track('search', { key, value: el.value, section: record.section, index: record.index }); clearTimeout(timer); const token = ++query; timer = setTimeout(() => void render(token), 180); });
    el.addEventListener('blur', () => { setTimeout(() => { if (search && !field.accepted) el.value = ''; close(); }, 80); });
    el.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  };
  wire(node('input', '', { id: field.id, name: key, role: 'combobox', 'aria-controls': menu.id, 'aria-expanded': 'false', placeholder: search ? `请输入${label}` : `请选择${label}`, ...(search ? {} : { readonly: '' }) }));
  field.root.append(input);
  if (replace) field.replace = () => { const next = input.cloneNode(); input.replaceWith(next); wire(next); track('replace', { key, index: record.index }); };
  return field;
}
function nativeChoice(record, label, key, options) {
  const field = row(record, label, key), input = node('select', '', { id: field.id, name: key });
  input.append(node('option', '请选择', { value: '' })); for (const value of options) input.append(node('option', value, { value }));
  input.addEventListener('change', () => { field.accepted = input.value; }); field.input = input; field.root.append(input); return field;
}
function calendar(record, label, key, precision) {
  const field = text(record, label, key, { readonly: '', placeholder: '请选择日期', 'data-format': precision === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD' });
  field.date = true;
  const input = field.input, panel = node('div', '', { class: 'lab-calendar flatpickr-calendar' }); panel.hidden = true; document.body.append(panel);
  let year = 2026, month = 1;
  function render() {
    panel.replaceChildren();
    const yearSelect = node('select', '', { 'aria-label': 'Year' }), monthSelect = node('select', '', { 'aria-label': 'Month' });
    for (let value = 2019; value <= 2028; value++) yearSelect.append(node('option', String(value), { value: String(value) })); yearSelect.value = String(year);
    for (let value = 1; value <= 12; value++) monthSelect.append(node('option', `${value}月`, { value: String(value - 1) })); monthSelect.value = String(month - 1);
    yearSelect.addEventListener('change', () => { year = +yearSelect.value; render(); }); monthSelect.addEventListener('change', () => { month = +monthSelect.value + 1; render(); });
    panel.append(yearSelect, monthSelect); const grid = node('div', '', { class: 'calendar-grid' }); panel.append(grid);
    const commit = value => { field.accepted = value; input.value = value; panel.hidden = true; track('date-click', { key, value, section: record.section, index: record.index }); };
    if (precision === 'month') {
      for (let value = 1; value <= 12; value++) { const cell = node('button', `${value}月`, { type: 'button' }); cell.addEventListener('click', () => commit(`${year}-${String(value).padStart(2, '0')}`)); grid.append(cell); }
    } else {
      for (let value = 1; value <= new Date(year, month, 0).getDate(); value++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(value).padStart(2, '0')}`, cell = node('button', String(value), { type: 'button', 'data-date': date });
        cell.addEventListener('click', () => commit(date)); grid.append(cell);
      }
    }
  }
  input.addEventListener('input', () => { field.accepted = ''; });
  input.addEventListener('click', () => { render(); panel.hidden = false; position(panel, input); });
  input.addEventListener('keydown', event => { if (event.key === 'Escape') panel.hidden = true; });
  input.addEventListener('blur', () => setTimeout(() => { if (!panel.contains(document.activeElement)) panel.hidden = true; }, 100));
  field.precision = precision; return field;
}
function splitDate(record, label, key) {
  const field = row(record, label, key), group = node('div', '', { class: 'split-date' }); field.root.append(group); field.date = true;
  const make = (part, values) => { const input = node('select', '', { name: `${key}${part}`, 'aria-label': label + part }); input.append(node('option', part, { value: '' })); for (const value of values) input.append(node('option', String(value), { value: String(value) })); return input; };
  const year = make('Year', Array.from({ length: 10 }, (_, i) => 2019 + i)); let month = make('Month', Array.from({ length: 12 }, (_, i) => i + 1));
  const day = make('Day', Array.from({ length: 31 }, (_, i) => i + 1));
  const accept = () => { field.accepted = [year.value, month.value.padStart(2, '0'), day.value.padStart(2, '0')].join('-'); };
  const listen = () => month.addEventListener('change', accept);
  year.addEventListener('change', () => { const next = make('Month', Array.from({ length: 12 }, (_, i) => i + 1)); month.replaceWith(next); month = next; listen(); accept(); track('replace-month', { key, index: record.index }); });
  listen(); day.addEventListener('change', accept); group.append(year, month, day); field.precision = 'day'; return field;
}
function date(record, label, key, style) {
  if (style === 'split') return splitDate(record, label, key);
  if (style === 'calendar' || style === 'month-calendar') return calendar(record, label, key, style === 'calendar' ? 'day' : 'month');
  const field = text(record, label, key, style === 'format' ? { 'data-format': 'DD/MM/YYYY', placeholder: 'DD/MM/YYYY' } : { type: style || 'date' });
  field.date = true; field.precision = style === 'month' ? 'month' : 'day'; field.format = style; return field;
}
function build(section, index, data, list) {
  const record = { section, index, data, fields: [], el: node('div', '', { class: 'lab-record bili-form-multiple' }) }; records.push(record); list.append(record.el);
  if (section === 'education') {
    date(record, '开始日期', 'startDate', variant === 'public' ? 'split' : index ? 'month' : 'calendar');
    date(record, '结束日期', 'endDate', variant === 'public' ? 'split' : index ? 'month-calendar' : 'date');
    const school = choice(record, '学校名称', 'school', fixtureProfile.education.map(item => item.school), { search: true, delay: index ? 5200 : 2800, replace: true });
    const college = text(record, '学院名称', 'college'); let replaced = false;
    college.input.addEventListener('input', () => { if (!replaced) { school.replace(); replaced = true; } });
    choice(record, '专业名称', 'major', ['计算机科学与技术', '软件工程'], { search: true, delay: 550 });
    choice(record, '专业类别', 'majorCategory', ['理学', '工学类', '管理学']);
    (variant === 'public' ? nativeChoice : choice)(record, '学历层次', 'degree', ['高中', '专科', '本科', '硕士研究生', '博士']);
    choice(record, '学习形式', 'studyMode', ['非全日制', '全日制普通高等教育']);
    radio(record, '是否最高学历', 'isHighest'); radio(record, '是否双学位', 'doubleDegree');
  } else if (section === 'projects') {
    text(record, '项目名称', 'projectName'); text(record, '项目角色', 'role');
    date(record, '开始日期', 'startDate', index === 0 ? 'month-calendar' : index === 1 ? 'calendar' : 'format');
    date(record, '结束日期', 'endDate', index === 0 ? 'month' : index === 1 ? 'split' : 'date');
    text(record, '项目描述', 'description', { tag: 'textarea' });
  } else if (section === 'internships') {
    text(record, '实习单位', 'company'); text(record, '实习岗位', 'position');
    date(record, '开始日期', 'startDate', 'date'); date(record, '结束日期', 'endDate', 'month'); text(record, '职责描述', 'description', { tag: 'textarea' });
  } else if (section === 'campus') {
    text(record, '活动名称', 'name'); text(record, '组织名称', 'organization'); text(record, '担任职务', 'role');
    date(record, '开始日期', 'startDate', 'format'); date(record, '结束日期', 'endDate', 'date'); text(record, '活动内容', 'description', { tag: 'textarea' });
  } else if (section === 'awards') {
    text(record, '奖项名称', 'name'); choice(record, '奖项级别', 'level', ['国家级', '省级', '校级']);
    choice(record, '奖项等级', 'rank', ['一等奖', '二等奖', '三等奖']); date(record, '获奖日期', 'date', 'date'); text(record, '获奖内容', 'description', { tag: 'textarea' });
  } else if (section === 'languageCertificates') {
    choice(record, '语种', 'language', ['中文', 'English', '日语']); choice(record, '熟练程度', 'proficiency', ['基础', '一般', '熟练', '流利', '精通']);
    choice(record, '考试名称', 'exam', ['CET-4', 'CET-6', '雅思', 'TOEFL']); text(record, '考试成绩', 'score'); date(record, '考试日期', 'date', 'date');
  }
  return record;
}
const form = document.getElementById('lab-form');
const basic = { section: 'basic', index: null, data: fixtureProfile.basic, fields: [], el: node('div', '', { class: 'lab-record' }) };
const basicSection = node('section', '', { class: 'lab-section' }); basicSection.append(node('h2', '基本信息'), basic.el); form.append(basicSection); records.push(basic);
text(basic, '姓名', 'name'); radio(basic, '性别', 'gender', ['男', '女']); text(basic, '手机号码', 'phone'); text(basic, '电子邮箱', 'email', { type: 'email' });
choice(basic, '国家/地区', 'nationality', ['中国大陆', '中国香港', '其他']); choice(basic, '民族', 'ethnicity', ['汉族', '回族', '其他']);
choice(basic, '所在城市', 'location', ['北京', '杭州', '上海'], { search: true, delay: 400 }); choice(basic, '籍贯', 'nativePlace', ['浙江', '江苏', '其他']);
date(basic, '出生日期', 'birthday', 'date'); nativeChoice(basic, '最高学历', 'highestDegree', ['本科', '硕士', '博士']); date(basic, '预计毕业时间', 'expectedGraduationDate', 'month');
choice(basic, '政治面貌', 'political', ['中共党员', '团员', '群众']);
if (variant === 'stress') {
  const broken = text(basic, '到岗时间', 'availableDate', { readonly: '', placeholder: '请选择日期' }); broken.date = true; broken.expected = '2027-07-01';
  const stuckCalendar = node('div', '', { class: 'lab-calendar ant-calendar' }); stuckCalendar.hidden = true;
  stuckCalendar.append(node('button', '2026', { type: 'button', class: 'ant-calendar-year-select' }), node('div', '2026年'),
    node('button', '下一页', { type: 'button', class: 'ant-calendar-year-panel-next-decade-btn' })); document.body.append(stuckCalendar);
  broken.input.addEventListener('click', () => { stuckCalendar.hidden = false; position(stuckCalendar, broken.input); });
  broken.input.addEventListener('keydown', event => { if (event.key === 'Escape') stuckCalendar.hidden = true; });
  const stuck = choice(basic, '兴趣爱好', 'interests', ['阅读'], { busy: true }); stuck.expected = '阅读';
  const schoolSection = node('section', '', { class: 'lab-section' });
  const schoolRecord = { section: 'education', index: 0, data: { school: '演示拒绝学校' }, fields: [], el: node('div', '', { class: 'lab-record bili-form-multiple' }) };
  records.push(schoolRecord); schoolSection.append(node('h2', '教育经历'), schoolRecord.el); form.append(schoolSection);
  choice(schoolRecord, '毕业院校', 'school', ['演示拒绝学校'], { search: true, delay: 250, refuse: true });
  const after = text(basic, '自我评价', 'selfEvaluation'); after.expected = fixtureProfile.selfEvaluation;
} else for (const [section, title] of [['education', '教育经历'], ['internships', '实习经历'], ['campus', '校园经历'], ['projects', '项目经历'], ['awards', '荣誉奖励'], ['languageCertificates', '语言考试']]) {
  const root = node('section', '', { class: 'lab-section' }), list = node('div', '', { class: 'entry-list' });
  root.append(node('h2', title), node('p', '点击添加后 350 毫秒创建表单；扩展需等待结构出现再继续。', { class: 'lab-hint' }), list);
  const add = node('button', '+ 添加', { type: 'button', class: 'lab-add' }); root.append(add); form.append(root);
  add.addEventListener('click', async () => { if (add.disabled) return; add.disabled = true; await pause(350); const index = list.children.length; if (fixtureProfile[section][index]) build(section, index, fixtureProfile[section][index], list); add.disabled = false; track('add', { section, index }); });
}
function snapshot() {
  const fields = records.flatMap(record => record.fields.map(field => ({ section: record.section, index: record.index, key: field.key, label: field.label,
    expected: field.expected, actual: field.accepted, visibleValue: field.input?.value || '', date: field.date, precision: field.precision, format: field.format })));
  return { fields, counts: Object.fromEntries(['education', 'projects', 'internships', 'campus', 'awards', 'languageCertificates'].map(key => [key, records.filter(record => record.section === key).length])),
    danger: { ...danger, agreement: document.getElementById('agreement').checked }, events: [...events] };
}
window.lab = { ready: true, snapshot, variant };
document.getElementById('validate').addEventListener('click', () => { const data = snapshot(), filled = data.fields.filter(field => field.actual).length;
  const output = document.getElementById('lab-result'); output.hidden = false; output.textContent = `网页已接受 ${filled} / ${data.fields.length} 项。详细结果可在控制台执行 lab.snapshot() 查看。`; });
document.getElementById('download-fixture').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(fixtureProfile, null, 2)], { type: 'application/json' }));
  const link = node('a', '', { href: url, download: 'fictional-test-profile.json' }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
for (const id of ['upload', 'submit']) document.getElementById(id).addEventListener('click', event => { event.preventDefault(); danger[id]++; document.getElementById('danger-counts').textContent = `上传 ${danger.upload} 次 · 提交 ${danger.submit} 次`; });
