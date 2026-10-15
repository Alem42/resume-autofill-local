export const expected = { startDate: '2024-09-13', endDate: '2027-06', degree: 'master', school: '演示海川大学(Demo Haichuan University)', proficiency: 'expert' };
export function setup(name) {
  document.body.innerHTML = '';
  const title = document.createElement('h1'); title.textContent = `${name} · 真实组件验收`; document.body.append(title);
  const note = document.createElement('p'); note.textContent = '虚构资料；下面记录的是组件 change/select 回调接受的值。'; document.body.append(note);
  const values = {}, events = [];
  const accept = key => value => { values[key] = value; events.push({ key, value, at: performance.now() });
    document.getElementById('accepted').textContent = JSON.stringify(values, null, 2); };
  const sections = {};
  for (const [section, caption] of [['education', '教育经历'], ['languageCertificates', '语言考试']]) {
    const root = document.createElement('section'); const heading = document.createElement('h2'); heading.textContent = caption; root.append(heading);
    const record = document.createElement('div'); record.className = 'bili-form-multiple'; root.append(record); document.body.append(root); sections[section] = record;
  }
  const fields = {};
  for (const [key, label] of Object.entries({ school: '学校名称', startDate: '开始时间', endDate: '结束时间', degree: '学历', proficiency: '熟练程度' })) {
    const row = document.createElement('div'); row.className = 'form-item'; row.dataset.testField = key;
    const caption = document.createElement('label'); caption.textContent = label; row.append(caption);
    const mount = document.createElement('div'); row.append(mount); sections[key === 'proficiency' ? 'languageCertificates' : 'education'].append(row); fields[key] = mount;
  }
  const output = document.createElement('pre'); output.id = 'accepted'; document.body.append(output);
  window.componentTest = { name, snapshot: () => ({ values: { ...values }, events: [...events] }) };
  return { accept, fields, ready() { window.componentTest.ready = true; } };
}
export const schools = [{ label: expected.school, value: expected.school }, { label: '演示星河学院', value: '演示星河学院' }];
export const degrees = [{ label: '本科', value: 'bachelor' }, { label: '硕士研究生', value: 'master' }];
export const levels = [{ label: '一般', value: 'basic' }, { label: '熟练', value: 'good' }, { label: '精通', value: 'expert' }];
export function day(value, month = false) { if (!value) return ''; const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}${month ? '' : '-' + String(date.getDate()).padStart(2, '0')}`; }
