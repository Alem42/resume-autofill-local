import React from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import Select from '@beisen-phoenix/select';
import SelectList from '@beisen-phoenix/select-list';
import DatePicker from '@beisen-phoenix/date-picker/lib/DatePicker';
import MonthPicker from '@beisen-phoenix/date-picker/lib/MonthPicker';
import moment from 'moment';
import { fixtureProfile } from './fixture-profile.js';
const profile = structuredClone(fixtureProfile);
Object.assign(profile.basic, { studentOrigin: '杭州', health: '健康', isCompanyEmployee: false });
profile.education.forEach(record => Object.assign(record, { majorCategory: '计算机类', degreeLevel: record.degree === '本科' ? '学士' : '硕士', degreeDiscipline: '工学', degreeName: '工学' + (record.degree === '本科' ? '学士' : '硕士') }));
profile.family = [{ name: '虚构父亲', relationship: '父亲', phone: '00000000001', company: '演示工厂', position: '工程师', political: '群众', isCompanyEmployee: false },
  { name: '虚构母亲', relationship: '母亲', phone: '00000000002', company: '演示书店', position: '职员', political: '中共党员', isCompanyEmployee: false }];
profile.jobIntention = { acceptJobAdjustment: false };
const accepted = {}, actions = [], expectations = {}, counters = { submits: 0, consent: 0 };
const accept = (key, value) => { accepted[key] = value; actions.push({ key, value }); document.getElementById('accepted').textContent = JSON.stringify(accepted, null, 2); };
const caption = { name: '姓名', gender: '性别', ethnicity: '民族', political: '政治面貌', health: '健康状况', studentOrigin: '生源地', isCompanyEmployee: '是否本公司员工',
  school: '学校名称', major: '专业名称', degree: '学历', majorCategory: '专业类别', degreeLevel: '学位', degreeDiscipline: '学位门类', degreeName: '学位名称', studyMode: '学习形式',
  startDate: '开始时间', endDate: '结束时间', relationship: '称谓', phone: '联系电话', company: '工作单位', position: '职位',
  projectName: '项目名称', role: '项目角色', description: '项目描述', selfEvaluation: '个人评价', language: '语种', proficiency: '语言水平', exam: '考试名称', score: '考试成绩', acceptJobAdjustment: '是否同意岗位调剂' };
document.body.innerHTML = `<header><p>FICTIONAL RECRUITMENT LAB</p><h1>北森组件与招聘交互测试</h1><p>使用实际 Phoenix 3.3.55；左右确认弹层是依照公开结构制作的测试夹具。所有资料均为虚构，未连接招聘网站或 API。</p>
<div class="toolbar"><button id="run" type="button">开始本机填写测试</button><button id="stop" type="button">中止填写</button><button id="reset" type="button">清空重试</button><label><input id="dates" type="checkbox" checked>填写日期</label><label><input id="overwrite" type="checkbox">允许覆盖</label><a href="/options/options.html">打开虚拟设置页</a></div><p id="progress" role="status">等待手动开始</p></header>
<main><form id="recruit-form"><div id="sections"></div><label><input id="privacy" type="checkbox">测试隐私协议（不可自动勾选）</label><button type="submit">测试投递（不可自动点击）</button></form><details><summary>组件已接受的值与验收结果</summary><pre id="accepted">{}</pre><pre id="report"></pre></details></main>`;
const style = document.createElement('style'); style.textContent = `body{font:14px "Segoe UI","Microsoft Yahei",sans-serif;background:#f5f7fa;margin:0;color:#243247}header,main{max-width:980px;margin:auto;padding:24px}header{background:#fff}header>p:first-child{font-size:11px;color:#a02735;letter-spacing:2px}.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px}button{padding:9px 14px;background:white;border:1px solid #cbd3df;border-radius:6px;cursor:pointer}#run{background:#a92535;color:white;border:0}section{background:white;border-radius:10px;border:1px solid #e0e5ed;margin:18px 0;padding:24px}h2{font-size:20px}fieldset{border:0;border-top:1px solid #e6e9ef;padding:16px 0;margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:18px}.form-item{min-width:0}.form-item>label{display:block;margin-bottom:8px;font-weight:600}.form-item>input,.form-item>textarea,.form-item>select,.beisen-field>input{box-sizing:border-box;width:100%;border:1px solid #cdd3df;border-radius:5px;padding:9px;font:inherit}.form-item textarea{min-height:90px}.choice-popup{background:white;box-shadow:0 3px 22px #22334430;border:1px solid #dbe1e9;padding:14px;border-radius:8px}.choice-popup input[type=search]{box-sizing:border-box;width:100%;padding:8px;margin-bottom:10px}.two-columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.list-container{max-height:190px;overflow:auto}.list-item-container{padding:8px;cursor:pointer}.list-item-container label{display:flex;gap:6px}.select-data-container{border-left:1px solid #ddd;padding:12px}.popup-footer{border-top:1px solid #ddd;text-align:right;padding-top:10px;margin-top:10px}.popup-footer button{margin-left:8px}pre{white-space:pre-wrap;max-height:400px;overflow:auto}#progress{min-height:24px;color:#536274}@media(max-width:650px){fieldset{grid-template-columns:1fr}header,main{padding:16px}}`;
document.head.append(style);
const portal = (content, anchor) => { const r = anchor?.getBoundingClientRect(); return createPortal(<div className="choice-popup phoenix-select-popup" style={{ position: 'fixed', top: Math.max(12, Math.min((r?.bottom || 120) + 4, innerHeight - 410)), left: Math.max(12, Math.min(r?.left || 100, innerWidth - 590)), width: Math.min(550, innerWidth - 52), zIndex: 2000 }}>{content}</div>, document.body); };
function Choice({ id, value, items, transfer = false, multipleFooter = false, group = false, remote = false }) {
  const [chosen, set] = React.useState(''), [query, search] = React.useState(''), [open, show] = React.useState(false), [pending, pick] = React.useState([]), [busy, load] = React.useState(false);
  const anchor = React.useRef();
  const opts = items.map(item => typeof item === 'string' ? { label: item, value: item } : item);
  React.useEffect(() => {
    if (!open) return;
    const key = event => { if (event.key === 'Escape') show(false); };
    const outside = event => { if (!anchor.current?.contains(event.target) && !event.target.closest('.choice-popup')) show(false); };
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  React.useEffect(() => { if (!remote || !open) return; load(true); const timer = setTimeout(() => load(false), 1800); return () => clearTimeout(timer); }, [query, open]);
  const commit = option => { set(option.label); accept(id, option.value); show(false); search(''); };
  const visible = opts.filter(option => !query || option.label.includes(query) || option.children);
  return <div ref={anchor} className="beisen-field"><Select isSearch={remote} value={chosen} isActive={open} onClick={() => { pick([]); show(true); }} onSearch={search} />
    {open && portal(transfer ? <div className="constant-main-selector-container"><div className="constant-main-layer-container">
      <input type="search" placeholder="搜索" aria-label="筛选候选" value={query} onChange={event => search(event.target.value)} />
      <div className="two-columns"><div className="list-container">{visible.map(option => <div key={option.value} className={'list-item-container' + (pending[0]?.value === option.value ? ' is-selected' : '')}>
        {id === 'basic.ethnicity' ? <><span className="icon-container"><svg width="15" height="15" className={pending[0]?.value === option.value ? 'RadioChecked' : 'RadioUnchecked'} onClick={() => pick([option])}><circle cx="7" cy="7" r="6" stroke="#a92535" fill={pending[0]?.value === option.value ? '#a92535' : 'white'} /></svg></span><span className="item-text-label">{option.label}</span></>
          : <label><input type="radio" name={'choice-' + id} checked={pending[0]?.value === option.value} onChange={() => pick([option])} />{option.label}</label>}</div>)}</div>
        <div className="select-data-container">{pending[0]?.label || '请在左侧选择内容'}</div></div>
      <div className="popup-footer"><button type="button" onClick={() => show(false)}>取消</button><button type="button" disabled={!pending.length} onClick={() => commit(pending[0])}>确定</button></div>
    </div></div> : <SelectList showSearch={!remote} showCheckAll={false} isGroup={group} multiple={multipleFooter} showFooter={multipleFooter}
      options={busy ? [] : group ? [{ label: '常用选项', value: 'group', children: visible }] : visible} loading={busy}
      selectedOptions={multipleFooter ? pending : opts.find(option => option.label === chosen)}
      onSelect={params => multipleFooter ? pick(params.selectedOptions) : commit(params.selectOption)} onConfirm={() => pending[0] && commit(pending[0])} />, anchor.current)}
  </div>;
}
function Calendar({ id, month = false, year = false }) {
  const [value, set] = React.useState(), [open, show] = React.useState(false), anchor = React.useRef();
  const format = year ? 'YYYY' : month ? 'YYYY-MM' : 'YYYY-MM-DD', Panel = month ? MonthPicker : DatePicker;
  return <div ref={anchor} className="beisen-field"><input readOnly data-format={format} placeholder={format} value={value?.format(format) || ''} onClick={() => show(true)} />
    {open && portal(<Panel value={value || moment('2026-10-16')} mode={year ? 'year' : 'date'} showDateInput={false} onSelect={date => { set(date); accept(id, date.format(format)); show(false); }} />, anchor.current)}</div>;
}
function section(key, title, keys, repeated = false, controls = {}) {
  const root = document.createElement('section'); root.dataset.section = key; root.innerHTML = `<h2>${title}</h2>`;
  const list = document.createElement('div'); root.append(list); document.getElementById('sections').append(root);
  const records = repeated ? profile[key] : [key === 'other' ? profile : profile[key]];
  let count = 0;
  function add() {
    const index = count++, record = records[index] || {}, fieldset = document.createElement('fieldset'); fieldset.dataset.record = String(index); list.append(fieldset);
    for (const field of keys) {
      const id = key + '.' + (repeated ? index + '.' : '') + field, row = document.createElement('div'); row.className = 'form-item'; row.dataset.testField = id;
      const label = document.createElement('label'); label.textContent = caption[field]; row.append(label); fieldset.append(row);
      const value = typeof record[field] === 'boolean' ? record[field] ? '是' : '否' : record[field]; expectations[id] = value;
      if (/Date$/.test(field)) {
        const month = field === 'endDate', year = key === 'education' && index === 1 && field === 'startDate'; expectations[id] = value?.slice(0, year ? 4 : month ? 7 : 10);
        const mount = document.createElement('div'); row.append(mount); createRoot(mount).render(<Calendar id={id} month={month} year={year} />);
      } else if (controls[field]) {
        const mount = document.createElement('div'); row.append(mount); createRoot(mount).render(<Choice id={id} value={value} {...controls[field]} />);
      } else {
        const input = document.createElement(['description', 'selfEvaluation'].includes(field) ? 'textarea' : 'input');
        input.name = id; input.addEventListener('input', () => accept(id, input.value)); row.append(input);
      }
    }
  }
  if (repeated) { const addButton = document.createElement('button'); addButton.type = 'button'; addButton.textContent = '+ 添加' + title; addButton.onclick = add; root.append(addButton); }
  else add();
}
const boolean = { items: ['是', '否'] };
section('basic', '基本信息', ['name', 'gender', 'ethnicity', 'political', 'studentOrigin', 'health', 'isCompanyEmployee'], false, {
  gender: { items: ['男', '女'] }, ethnicity: { items: ['汉族', '回族', '畲族'], transfer: true }, political: { items: ['群众', '中共党员', '共青团员'], group: true },
  health: { items: ['健康', '良好'] }, isCompanyEmployee: boolean });
// Canonical aliases are deliberately different from stored values.
expectations['basic.ethnicity'] = '汉族';
section('education', '教育经历', ['school', 'startDate', 'endDate', 'majorCategory', 'major', 'degree', 'degreeLevel', 'degreeDiscipline', 'degreeName', 'studyMode'], true, {
  school: { items: profile.education.map(item => item.school), remote: true }, majorCategory: { items: ['社会学类', '计算机类', '电子信息类'], transfer: true },
  degree: { items: ['本科', '硕士研究生', '博士研究生'], group: true }, degreeLevel: { items: ['学士', '硕士', '博士'] }, degreeDiscipline: { items: ['工学', '理学'] },
  studyMode: { items: ['全日制', '非全日制'], multipleFooter: true } });
section('family', '家庭情况', ['name', 'relationship', 'phone', 'company', 'position', 'political', 'isCompanyEmployee'], true, {
  relationship: { items: ['父亲', '母亲', '配偶'] }, political: { items: ['群众', '中共党员', '共青团员'] }, isCompanyEmployee: boolean });
section('projects', '项目经历', ['projectName', 'role', 'startDate', 'endDate', 'description'], true);
section('languageCertificates', '语言考试', ['language', 'proficiency', 'exam', 'score'], true, { language: { items: ['英语', '日语', '德语'] }, proficiency: { items: ['一般', '熟练', '精通'] }, exam: { items: ['IELTS', 'TOEFL', 'CET-6'] } });
section('jobIntention', '求职意向', ['acceptJobAdjustment'], false, { acceptJobAdjustment: boolean });
section('other', '个人评价', ['selfEvaluation']);
document.getElementById('privacy').onchange = () => counters.consent++;
document.getElementById('recruit-form').onsubmit = event => { event.preventDefault(); counters.submits++; };
document.getElementById('reset').onclick = () => location.reload();
window.beisenLab = { ready: true, profile, expectations, snapshot: () => ({ accepted: { ...accepted }, counters: { ...counters } }), actions };
import('./beisen-harness.js');
