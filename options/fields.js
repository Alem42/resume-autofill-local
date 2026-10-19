import { CHOICES, loadDirectories } from '../shared/catalogs.js';
import { element } from '../shared/ui.js';
let nextList = 0;
export function enhanceChoice(input, section, key) {
  const choices = CHOICES[key];
  if (!choices && !['school', 'discipline', 'majorCategory', 'major'].includes(key)) return;
  const list = element('datalist'); list.id = `profile-choice-${++nextList}`;
  input.setAttribute('list', list.id);
  input.placeholder = '选择或输入自定义内容';
  const populate = values => {
    list.replaceChildren();
    for (const value of values) { const option = element('option'); option.value = value; list.append(option); }
  };
  if (choices) populate(choices);
  input.after(list);
  if (['school', 'discipline', 'majorCategory', 'major'].includes(key)) {
    // Load only packaged data; personal search terms never leave this page.
    loadDirectories().then(({ schools, categories, majors }) => {
      const values = key === 'school' ? schools.map(item => item.name)
        : key === 'major' ? majors.map(item => item.name)
        : categories.filter(item => item.code.length === (key === 'discipline' ? 2 : 4)).map(item => item.name);
      populate([...new Set(values)]);
    }).catch(() => { input.placeholder = '目录暂不可用，可直接输入'; });
  }
}

export function dateFields(input, key) {
  input.type = 'hidden';
  const group = element('span', 'date-parts');
  group.setAttribute('role', 'group'); group.setAttribute('aria-label', '年、月、日');
  const values = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(input.value);
  const parts = [];
  for (const [index, caption, count] of [[1, '年', 0], [2, '月', 12], ...(key === 'expectedGraduationDate' ? [] : [[3, '日', 31]])]) {
    const select = element('select'); select.setAttribute('aria-label', caption); select.dataset.datePart = caption;
    const empty = element('option', '', caption); empty.value = ''; select.append(empty);
    const numbers = count ? Array.from({ length: count }, (_, i) => i + 1)
      : Array.from({ length: new Date().getFullYear() + 21 - 1930 }, (_, i) => new Date().getFullYear() + 20 - i);
    if (!count && values && !numbers.includes(+values[1])) numbers.unshift(+values[1]);
    for (const number of numbers) { const option = element('option', '', `${number}${caption}`); option.value = count ? String(number).padStart(2, '0') : String(number); select.append(option); }
    select.value = values?.[index] || ''; parts.push(select); group.append(select);
  }
  const present = key === 'endDate' || key === 'expiryDate' ? element('label', 'date-present') : null;
  let ongoing;
  if (present) {
    ongoing = element('input'); ongoing.type = 'checkbox'; ongoing.checked = /^(至今|现在|present|current)$/i.test(input.value);
    present.append(ongoing, element('span', '', '至今')); group.append(present);
  }
  if (!values && input.value && !ongoing?.checked) group.append(element('small', 'muted', `保留的旧值：${input.value}。重新选择年月日后替换。`));
  const sync = () => {
    // Preserve partial precision. A month-only fact must not acquire an invented day.
    if (!parts[1].value && parts[2]) parts[2].value = '';
    if (parts[2] && parts[0].value && parts[1].value) {
      const last = new Date(Date.UTC(+parts[0].value, +parts[1].value, 0)).getUTCDate();
      for (const option of parts[2].options) option.disabled = +option.value > last;
      if (+parts[2].value > last) parts[2].value = '';
    }
    input.value = ongoing?.checked ? '至今' : parts[0].value ? [parts[0].value, ...parts.slice(1).map(part => part.value)].filter(Boolean).join('-') : '';
    parts.forEach((part, index) => { part.disabled = Boolean(ongoing?.checked) || index > 0 && !parts[index - 1].value; });
  };
  parts.forEach(part => part.addEventListener('change', event => { if (event.isTrusted) sync(); }));
  ongoing?.addEventListener('change', event => { if (event.isTrusted) sync(); });
  parts.forEach((part, index) => { part.disabled = Boolean(ongoing?.checked) || index > 0 && !parts[index - 1].value; });
  input.after(group);
  return group;
}
