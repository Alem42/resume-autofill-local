// Component interaction stays in the isolated page world. No storage, fetch or site-specific code execution.
(() => {
  if (globalThis.__resumeControls) return;
  const CHOICE_PANELS = '[role="listbox"],[role="tree"],[class*="dropdown"],[class*="Dropdown"],[class*="autocomplete"],[class*="AutoComplete"],[class*="suggestion"],[class*="select-menu"],[class*="Select-menu"],[class*="select-list"],[class*="Select-list"],[class*="select-panel"],[class*="Select-panel"],[class*="select-popup"],[class*="Select-popup"],[class*="popover"],[class*="Popover"]';
  const DATE_PANELS = '.ant-calendar,.ant-calendar-picker-panel,.ant-picker-dropdown,.el-picker-panel,.flatpickr-calendar,.react-datepicker,.MuiPickersPopper-root,[class*="DayPicker"],[class*="DateCalendar"],[class*="calendar"],[class*="Calendar"],[class*="date-picker"],[class*="DatePicker"],[class*="datepicker"],[class*="picker-panel"],[class*="Picker-panel"],[class*="picker-popup"],[class*="Picker-popup"],[class*="Picker-popover"],[class*="date-panel"],[class*="month-panel"]';
  const compact = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[\s\u200b\u00a0·•,，:：_\-]/g, '');
  const core = text => compact(text).replace(/\([^)]*\)|\[[^\]]*\]/g, '');
  const aliases = new Map([['大学本科', '本科'], ['本科毕业', '本科'], ['学士', '本科'], ['硕士研究生', '硕士'], ['博士研究生', '博士'], ['大专', '专科'], ['汉族', '汉'],
    ['english', '英语'], ['英文', '英语'], ['chinese', '中文'], ['汉语', '中文'], ['japanese', '日语'], ['雅思', 'ielts'], ['托福', 'toefl'],
    ['中华人民共和国居民身份证', '身份证'], ['居民身份证', '身份证'], ['全日制普通高等教育', '全日制'],
    ['bachelor', '本科'], ['bachelorsdegree', '本科'], ['master', '硕士'], ['mastersdegree', '硕士'], ['phd', '博士'],
    ['团员', '共青团员'], ['党员', '中共党员']]);
  function proficiencyScore(value) {
    const text = compact(value);
    if (/^(?:不|非|未|无|不会|不能|no\b|not\b)/.test(text)) return 5;
    if (/母语|native|精通|proficient|expert|excellent|mastery|c2/.test(text)) return 100;
    if (/流利|fluent|高级|advanced|c1/.test(text)) return 90;
    if (/熟练|良好|good|upperintermediate|b2/.test(text)) return 80;
    if (/熟悉/.test(text)) return 60;
    if (/一般|中等|intermediate|b1/.test(text)) return 50;
    if (/基础|初级|basic|beginner|a[12]/.test(text)) return 20;
    return 0;
  }
  function distance(a, b) {
    let row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length];
  }
  function optionScore(option, value, kind = '') {
    const a = compact(option), b = compact(value);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const negative = /^(?:非|不|未|无|否|non|not)/;
    if (negative.test(a) !== negative.test(b) && (a.includes(b) || b.includes(a))) return 0;
    if (['startDate', 'endDate', 'date', 'birthday', 'expectedGraduationDate'].includes(kind)
      && /^\d+(?:年|月|日)?$/.test(a) && /^\d+(?:年|月|日)?$/.test(b) && parseInt(a, 10) === parseInt(b, 10)) return .99;
    if (kind === 'school' && /分校|校区|附属|branch|campus/i.test(a.replace(b, ''))) return 0;
    const ca = core(a), cb = core(b);
    if (ca && ca === cb) return .98; // Bilingual labels and harmless parenthetical annotations.
    if (kind === 'school' && /学院|college/i.test(ca.replace(cb, ''))) return 0;
    if (aliases.get(ca) === cb || aliases.get(cb) === ca || (aliases.has(ca) && aliases.get(ca) === aliases.get(cb))) return .97;
    if (['location', 'city', 'nativePlace', 'hukou', 'country', 'nationality'].includes(kind)) {
      if (ca.replace(/省|市|自治区|特别行政区/g, '') === cb.replace(/省|市|自治区|特别行政区/g, '')) return .97;
    }
    if (kind !== 'school' && Math.min(ca.length, cb.length) >= 2 && Math.max(ca.length, cb.length) <= Math.min(ca.length, cb.length) * 1.7
      && (ca.includes(cb) || cb.includes(ca))) return .91;
    if (Math.min(ca.length, cb.length) >= 6 && Math.max(ca.length, cb.length) <= 100) {
      const edits = distance(ca, cb), similarity = 1 - edits / Math.max(ca.length, cb.length);
      if (edits <= 2 && similarity >= (kind === 'school' ? .93 : .88)) return similarity;
    }
    return 0;
  }
  function rankOptions(options, value, kind) {
    if (kind === 'proficiency') {
      const best = options.map(element => ({ element, score: proficiencyScore(element.textContent) }))
        .filter(item => item.score > 0).sort((a, b) => b.score - a.score)[0];
      if (best) return { ...best, score: 1, preference: true };
    }
    const ranked = options.map(element => ({ element, score: optionScore(element.textContent, value, kind) }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    if (!ranked.length) return null;
    const best = ranked[0];
    // Repeated descendants in an option describe one choice, but distinct similar choices remain ambiguous.
    const rival = ranked.find(item => item !== best && !best.element.contains(item.element) && !item.element.contains(best.element)
      && compact(item.element.textContent) !== compact(best.element.textContent));
    if (rival && best.score < 1 && best.score - rival.score < .04) return null;
    return best;
  }
  function dateParts(value, format = '') {
    let text = String(value).trim();
    const reversed = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
    if (reversed) text = /^d/i.test(format) ? `${reversed[3]}-${reversed[2]}-${reversed[1]}` : `${reversed[3]}-${reversed[1]}-${reversed[2]}`;
    const monthYear = /^(\d{1,2})[-/.](\d{4})$/.exec(text);
    if (monthYear) text = `${monthYear[2]}-${monthYear[1]}`;
    const match = /^(\d{4})(?:[-/.年](\d{1,2})(?:[-/.月](\d{1,2}))?月?日?)?年?$/.exec(text);
    if (!match) return null;
    const year = +match[1], month = +(match[2] || 1), day = +(match[3] || 1);
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
    return { year, month, day, hasMonth: Boolean(match[2]), hasDay: Boolean(match[3]) };
  }
  function formatDate(value, precision) {
    const date = dateParts(value);
    if (!date) return String(value);
    if (precision === 'year') return String(date.year);
    return `${date.year}-${String(date.month).padStart(2, '0')}${precision === 'month' ? '' : '-' + String(date.day).padStart(2, '0')}`;
  }
  function datePrecision(el, panel = null) {
    if (el.type === 'month') return 'month';
    if (el.type === 'date' || el.type === 'datetime-local') return 'day';
    for (let node = el, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
      const format = ['data-format', 'data-date-format', 'format', 'placeholder'].map(key => node.getAttribute(key) || '').join(' ');
      if (/y{2,4}[^a-z]*m{1,2}[^a-z]*d{1,2}|d{1,2}[^a-z]*m{1,2}[^a-z]*y{2,4}|m{1,2}[^a-z]*d{1,2}[^a-z]*y{2,4}/i.test(format) || /年.*月.*日/.test(format)) return 'day';
      if (/y{2,4}[^a-z]*m{1,2}(?![a-z])|m{1,2}[^a-z]*y{2,4}/i.test(format) || /年月|年.*月/.test(format)) return 'month';
      if (/yyyy|YYYY|年份|选择年/.test(format) && !/月|[mMdD]/.test(format.replace(/yyyy/ig, ''))) return 'year';
      if (node.getAttribute('data-picker') === 'year' || /year-picker|yearpicker/i.test(node.className || '')) return 'year';
      if (node.getAttribute('data-picker') === 'month' || /month-picker|monthpicker|month-range/i.test(node.className || '')) return 'month';
    }
    if (panel) {
      const shown = node => {
        for (let parent = node; parent; parent = parent.parentElement) {
          if (parent.hidden || parent.getAttribute('aria-hidden') === 'true') return false;
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return node.getBoundingClientRect().width > 0;
      };
      if ([...panel.querySelectorAll('.ant-picker-date-panel,.ant-calendar-date-panel,.el-date-table,.flatpickr-days,[data-date],td[title]')].some(shown)) return 'day';
      const days = new Set([...panel.querySelectorAll('span,div,td,button,li')].filter(shown).map(node => node.textContent.trim())
        .filter(text => /^\d{1,2}$/.test(text) && +text > 0 && +text <= 31));
      if (days.size >= 24) return 'day';
      if ([...panel.querySelectorAll('.ant-picker-month-panel,.ant-calendar-month-panel,.el-month-table,[data-month]')].some(shown)) return 'month';
      const months = [...panel.querySelectorAll('span,div,td,button,li')].filter(shown).filter(node => /^(?:\d{1,2}月|[一二三四五六七八九十]{1,3}月)$/.test(node.textContent.trim()));
      if (months.length >= 10) return 'month';
    }
    return 'unknown';
  }
  function create(hooks) {
    const { visible, sleep, label, write, close, check } = hooks;
    const datePanels = new WeakMap();
    const kindOf = el => globalThis.__resumeSemantics.fieldKind(label(el), 'education');
    const textInput = el => ['INPUT', 'TEXTAREA'].includes(el.tagName) ? el : el.querySelector('input:not([type="hidden"]),textarea');
    function formatHint(el) {
      for (let node = el, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
        const format = ['data-format', 'data-date-format', 'format', 'placeholder'].map(key => node.getAttribute(key) || '').find(text => /y{4}/i.test(text));
        if (format) return format;
      }
      return '';
    }
    function fieldRoot(el) {
      let best = el;
      for (let node = el.parentElement, depth = 0; node && node !== document.body && depth < 5; node = node.parentElement, depth++) {
        if (node.querySelectorAll('input:not([type="hidden"]),select,textarea').length > 1) break;
        if (/select|combo|autocomplete|auto-complete|picker|date/i.test(node.className || '') || ['combobox', 'searchbox'].includes(node.getAttribute('role'))) best = node;
      }
      return best;
    }
    function choiceSignals(el) {
      const root = fieldRoot(el);
      return el.getAttribute('aria-autocomplete') === 'list' || el.getAttribute('role') === 'combobox'
        || root.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('aria-expanded') !== null
        || /select|combo|autocomplete|auto-complete|suggest/i.test((el.className || '') + ' ' + (root.className || ''));
    }
    function panels(el, selectors, before = new Set()) {
      const root = fieldRoot(el), input = textInput(el), rect = el.getBoundingClientRect();
      const ids = [el, input, root].filter(Boolean).flatMap(node => [node.getAttribute('aria-controls'), node.getAttribute('aria-owns')])
        .filter(Boolean).flatMap(value => value.split(/\s+/));
      const all = [...document.querySelectorAll(selectors)].filter(panel => panel !== el && !panel.contains(el) && visible(panel)
        && !panel.closest('nav,[role="navigation"]') && panel.getAttribute('role') !== 'option'
        && !/icon|arrow|caret|dropdown-item|dropdown_item|select-item|select_item|(?:^|[-_])option$/i.test(panel.className || ''));
      const linked = all.filter(panel => ids.includes(panel.id) || ids.some(id => panel.querySelector(`[id="${CSS.escape(id)}"]`)));
      const candidates = linked.length ? linked : all.filter(panel => {
        if (before.has(panel) && !root.contains(panel)) return false;
        const r = panel.getBoundingClientRect();
        return r.left < rect.right + 160 && r.right > rect.left - 160 && Math.abs(r.top - rect.bottom) < 650;
      });
      // Keep specific inner menus instead of arbitrary outer overlays containing several controls.
      return candidates.filter(panel => !candidates.some(other => other !== panel
        && (selectors === DATE_PANELS ? other.contains(panel) : panel.contains(other))))
        .sort((a, b) => Math.abs(a.getBoundingClientRect().top - rect.bottom) - Math.abs(b.getBoundingClientRect().top - rect.bottom));
    }
    function optionElements(menu) {
      return [...menu.querySelectorAll('[role="option"],li,[class*="option"],[class*="Option"],[class*="item"],span,div,p')]
        .filter(node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
          && !/disabled|arrow|icon|clear|remove|placeholder|loading/i.test(node.className || '')
          && !node.closest('a[href],button[type="submit"],button[type="reset"]') && !node.querySelector('input,select,textarea,button,a[href]')
          && node.textContent.trim().length > 0 && node.textContent.trim().length <= 250);
    }
    function displayed(el) {
      const input = textInput(el), root = fieldRoot(el);
      const node = root.querySelector('[class*="display-value"],[class*="selection-item"],[class*="selected-value"],[class*="select-value"],[class*="dropdown-value"],[class*="SelectedValue"],[class*="selected-label"]');
      const direct = node?.textContent || el.getAttribute('aria-valuetext') || root.getAttribute('aria-valuetext') || input?.value;
      if (direct) return direct.trim();
      if (input) return '';
      const copy = root.cloneNode(true);
      copy.querySelectorAll('input,textarea,select,svg,button,[role="option"],[role="listbox"],[class*="menu"],[class*="placeholder"],[class*="icon"],[class*="arrow"]')
        .forEach(node => node.remove());
      return copy.textContent.trim().slice(0, 500);
    }
    async function open(el) {
      const root = fieldRoot(el), input = textInput(el);
      input?.focus();
      const trigger = root.querySelector('[class*="selector"],[class*="selection"],[class*="trigger"]') || el;
      if (trigger.closest('a[href],button[type="submit"],button[type="reset"]')
        || trigger.tagName === 'BUTTON' && ['submit', 'reset'].includes(trigger.type)) throw new Error('控件触发点不是可填写字段');
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); trigger.click();
      return { root, input, trigger };
    }
    async function choose(el, best, menus) {
      const input = textInput(el), candidate = best.element, menu = menus.find(menu => menu.contains(candidate));
      const before = displayed(el), selectedText = candidate.textContent.trim();
      const chain = [candidate];
      for (let node = candidate.parentElement; node && node !== menu && chain.length < 4; node = node.parentElement) {
        if (node.getAttribute('role') === 'option' || /option|item/i.test(node.className || '')) chain.push(node);
      }
      for (const node of chain) {
        check();
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); node.click();
        await sleep(180);
        const after = displayed(el), kind = kindOf(el);
        const matched = optionScore(after, selectedText, kind) > 0;
        const committed = after !== before || candidate.getAttribute('aria-selected') === 'true' || !candidate.isConnected
          || !visible(menu) || input?.getAttribute('aria-expanded') === 'false' || fieldRoot(el).getAttribute('aria-expanded') === 'false';
        if (matched && committed) {
          await close(el, input || el); await sleep(120);
          if (optionScore(displayed(el), selectedText, kind) > 0) return true;
          return false;
        }
      }
      return false;
    }
    async function fillChoice(el, value, { plain = false } = {}) {
      const input = textInput(el), kind = kindOf(el);
      const assist = Boolean(hooks.resolveOption && (!hooks.canResolve || hooks.canResolve()));
      const terms = kind === 'school' ? [...new Set([String(value), String(value).replace(/\([^)]*\)|（[^）]*）/g, '').trim(),
        /[（(]([^）)]+)[）)]/.exec(String(value))?.[1]].filter(Boolean))] : [String(value)];
      const before = new Set([...document.querySelectorAll(CHOICE_PANELS)].filter(visible));
      const signals = choiceSignals(el);
      await open(el);
      let detected = signals, searched = false, best = null, menus = [];
      let searchIndex = 0;
      // Do not write a readonly display field: it must select an actual option.
      if (input && !input.readOnly && plain && !signals) { write(input, value); searched = true; }
      const limit = signals || !plain || kind === 'school' ? 40 : 5;
      for (let i = 0; i < limit; i++) {
        await sleep(100); check();
        menus = panels(el, CHOICE_PANELS, before);
        const options = menus.flatMap(optionElements);
        if (options.length) detected = true;
        best = rankOptions(options, value, kind);
        if (best?.score >= .97 || best && !assist) break;
        if (!best && input && !input.readOnly && kind === 'school' && searched && i >= 4 * (searchIndex + 1) && searchIndex + 1 < terms.length) {
          write(input, terms[++searchIndex]);
          continue;
        }
        // Leave time inside the field's five-second budget for semantic option selection.
        if (options.length && assist && i >= Math.max(5, (terms.length - 1) * 4 + 2)) break;
        if (input && !input.readOnly && !searched && (signals || options.length || i >= 1)) {
          write(input, value); searched = true;
        }
      }
      if ((!best || best.score < .97) && assist) {
        const options = menus.flatMap(optionElements).filter((node, index, all) =>
          all.findIndex(other => compact(other.textContent) === compact(node.textContent)) === index).slice(0, 60);
        if (options.length) {
          const index = await hooks.resolveOption(el, options.map(node => node.textContent.trim()));
          check();
          if (Number.isInteger(index) && index >= 0 && index < options.length && visible(options[index])) {
            best = { element: options[index], score: .9, ai: true };
          }
        }
      }
      if (best) {
        const filled = await choose(el, best, menus);
        return { filled, dropdown: true, match: best.ai ? 'ai' : best.preference ? 'preference' : best.score === 1 ? 'exact' : best.score >= .97 ? 'alias' : 'similar' };
      }
      if (detected || !plain) await close(el, input || el); else input?.blur();
      await sleep(120);
      return { filled: Boolean(plain && !detected && input && displayed(el) === String(value)), dropdown: detected };
    }
    const safeCell = node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
      && !(node.tagName === 'BUTTON' && ['submit', 'reset'].includes(node.type))
      && !/disabled|prev-month|next-month|last-month|outside|prevMonth|nextMonth/i.test(node.className || '')
      && !node.closest('button[type="submit"],button[type="reset"]')
      && (!node.closest('a[href]') || /^(#|javascript:void\(0\);?)$/i.test(node.closest('a[href]').getAttribute('href') || ''));
    const safeNavigation = node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
      && !/disabled/i.test(node.className || '') && !node.closest('a[href],button[type="submit"],button[type="reset"]')
      && !(node.tagName === 'BUTTON' && ['submit', 'reset'].includes(node.type));
    function leaves(panel, pattern) {
      const nodes = [...panel.querySelectorAll('span,div,td,button,li,a')].filter(node => safeCell(node) && pattern.test(node.textContent.trim())
        && !node.querySelector('input,textarea,select'));
      return nodes.filter(node => !nodes.some(other => other !== node && node.contains(other)));
    }
    async function confirmCalendar(el) {
      const panel = datePanels.get(textInput(el) || el);
      if (!panel?.isConnected || !visible(panel)) return;
      const button = [...panel.querySelectorAll('button,[role="button"],[class*="confirm"],[class*="Confirm"],[class*="footer"]')]
        .find(node => safeCell(node) && /^(确定|确认|确认日期|完成|ok|done)$/i.test(node.textContent.trim()) && !node.querySelector('input,textarea,select'));
      if (button) { check(); button.click(); await sleep(160); }
    }
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    function monthNumber(text) {
      const value = compact(text).replace(/月$/, '');
      const chinese = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
      if (chinese.includes(value)) return chinese.indexOf(value) + 1;
      const english = monthNames.findIndex(name => name === value || name.slice(0, 3) === value.replace(/\.$/, ''));
      if (english >= 0) return english + 1;
      return /^\d{1,2}$/.test(value) && +value >= 1 && +value <= 12 ? +value : 0;
    }
    function panelMonth(panel) {
      const counts = new Map();
      for (const cell of panel.querySelectorAll('[title],[data-date],[aria-label]')) {
        if (!safeCell(cell)) continue;
        const date = dateParts(cell.getAttribute('data-date') || cell.getAttribute('title') || cell.getAttribute('aria-label') || '');
        if (date?.hasDay) { const key = `${date.year}-${date.month}`; counts.set(key, (counts.get(key) || 0) + 1); }
      }
      const best = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (best) { const [year, month] = best[0].split('-').map(Number); return { year, month }; }
    const header = panel.querySelector('.react-datepicker__current-month,.el-date-picker__header,.ant-picker-header-view,.ant-calendar-header,.flatpickr-current-month,.rdp-caption_label,.DayPicker-Caption,.MuiPickersCalendarHeader-label,[aria-live]');
      const text = header?.textContent || '';
      const numeric = /(\d{4})\s*[-/.年]\s*(\d{1,2})/.exec(text);
      if (numeric) return { year: +numeric[1], month: +numeric[2] };
      const year = /\b\d{4}\b/.exec(text)?.[0];
      const month = monthNames.findIndex(name => text.toLowerCase().includes(name));
      return year && month >= 0 ? { year: +year, month: month + 1 } : null;
    }
    function calendarDay(panel, date, target, allowNumber = false) {
      const exact = [...panel.querySelectorAll(`[title="${target}"],[data-date="${target}"],[aria-label="${target}"]`)].find(safeCell);
      if (exact) return exact;
      const timestamp = [...panel.querySelectorAll('[data-timestamp]')].find(node => {
        if (!safeCell(node)) return false;
        const value = Number(node.getAttribute('data-timestamp')), actual = new Date(value);
        return Number.isFinite(value) && actual.getFullYear() === date.year && actual.getMonth() + 1 === date.month && actual.getDate() === date.day;
      });
      if (timestamp) return timestamp;
      if (!allowNumber) return null;
      const cells = [...panel.querySelectorAll('.ant-calendar-cell,.ant-picker-cell,.react-datepicker__day,.MuiPickersDay-root,td,[role="gridcell"]')]
        .filter(safeCell).filter(node => node.textContent.trim() === String(date.day));
      return cells[0] || leaves(panel, /^\d{1,2}$/).find(node => node.textContent.trim() === String(date.day));
    }
    async function setHeaders(panel, date, requery) {
      for (const part of ['year', 'month']) {
        check();
        const node = [...panel.querySelectorAll('select,input')].find(node => safeCell(node)
          && new RegExp(part === 'year' ? 'year|年份|年' : 'month|月份|月', 'i').test(
            [node.className, node.name, node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('placeholder')].join(' ')));
        if (!node) continue;
        const desired = part === 'year' ? date.year : date.month;
        if (node.tagName === 'SELECT') {
          const option = [...(node.options || node.querySelectorAll('option'))].find(option => !option.disabled
            && (part === 'year' ? parseInt(option.textContent, 10) === desired : monthNumber(option.textContent) === desired));
          if (!option) continue;
          node.value = option.value || option.getAttribute('value') || option.textContent;
        } else {
          if (node.readOnly) continue;
          write(node, String(desired));
        }
        node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(80); panel = requery() || panel;
      }
      return panel;
    }
    async function navigateMonths(panel, date, requery) {
      let current = panelMonth(panel);
      if (!current || Math.abs((date.year - current.year) * 12 + date.month - current.month) > 18) return panel;
      for (let i = 0; i < 18 && current && (current.year !== date.year || current.month !== date.month); i++) {
        check();
        const previous = date.year * 12 + date.month < current.year * 12 + current.month;
        const button = panel.querySelector(previous
          ? '.ant-calendar-prev-month-btn,.ant-picker-header-prev-btn,.el-icon-arrow-left,.prev-month,.flatpickr-prev-month,.react-datepicker__navigation--previous,[aria-label="Previous Month"],[aria-label="Previous month"],[title="上个月"],[aria-label="上个月"]'
          : '.ant-calendar-next-month-btn,.ant-picker-header-next-btn,.el-icon-arrow-right,.next-month,.flatpickr-next-month,.react-datepicker__navigation--next,[aria-label="Next Month"],[aria-label="Next month"],[title="下个月"],[aria-label="下个月"]');
        if (!button || !safeNavigation(button)) break;
        const before = `${current.year}-${current.month}`;
        button.click(); await sleep(100); panel = requery() || panel; current = panelMonth(panel);
        if (current && before === `${current.year}-${current.month}`) break;
      }
      return panel;
    }
    async function fillCalendar(el, value, { pending = false, alreadyOpen = false } = {}) {
      const input = textInput(el) || el;
      check();
      // Editable pickers often accept their documented display format directly.
      const knownPrecision = datePrecision(input);
      if (!pending && !input.readOnly && ['year', 'month', 'day'].includes(knownPrecision)) {
        const target = formatDate(value, knownPrecision), parsed = dateParts(target);
        if (parsed) {
          const format = formatHint(input);
          const formatted = /y{4}/i.test(format) ? format.replace(/y{4}/i, String(parsed.year))
            .replace(/[Mm]{1,2}/g, token => token.length === 2 ? String(parsed.month).padStart(2, '0') : String(parsed.month))
            .replace(/D{1,2}|d{1,2}/g, token => token.length === 2 ? String(parsed.day).padStart(2, '0') : String(parsed.day)) : target;
          write(input, formatted); input.blur(); await sleep(150);
          const actual = dateParts(displayed(el), formatHint(input));
          if (actual && actual.year === parsed.year && (knownPrecision === 'year' || actual.month === parsed.month)
            && (knownPrecision !== 'day' || actual.hasDay && actual.day === parsed.day)) {
            await close(el, input, true); return { filled: true, precision: knownPrecision, target };
          }
        }
      }
      const before = alreadyOpen ? new Set() : new Set([...document.querySelectorAll(DATE_PANELS)].filter(visible));
      input.focus();
      if (!alreadyOpen || !panels(input, DATE_PANELS, before).length) input.click();
      await sleep(160);
      let panel = panels(input, DATE_PANELS, before)[0];
      if (!panel) {
        const addon = fieldRoot(input).querySelector('[class*="calendar"],[class*="addon"],[class*="suffix"]');
        if (addon && addon !== input && !addon.querySelector('input')) { addon.click(); await sleep(160); }
        panel = panels(input, DATE_PANELS, before)[0];
      }
      if (!panel) return { filled: false, precision: datePrecision(input) };
      let precision = datePrecision(input, panel), target = formatDate(value, ['year', 'month'].includes(precision) ? precision : 'day');
      const date = dateParts(value);
      if (!date) return { filled: false, precision };
      datePanels.set(input, panel);
      const requery = () => panels(input, DATE_PANELS, before)[0];
      const verify = async () => {
        if (pending) return true; // Shared ranges commit only after both approved dates have been selected.
        datePanels.set(input, requery() || panel); await confirmCalendar(input);
        await sleep(160); await close(el, input, true); await sleep(120);
        const actual = dateParts(displayed(el), formatHint(input));
        return Boolean(actual && actual.year === date.year && (precision === 'year' || actual.month === date.month)
          && (['year', 'month'].includes(precision) || actual.hasDay && actual.day === date.day));
      };
      if (precision !== 'month') {
        const exact = [...panel.querySelectorAll(`[title="${target}"],[data-date="${target}"],[aria-label="${target}"]`)].find(safeCell);
        if (exact) { exact.click(); return { filled: await verify(), precision: 'day', target }; }
      }
      panel = await setHeaders(panel, date, requery);
      if (precision === 'day' || precision === 'unknown') {
        panel = await navigateMonths(panel, date, requery);
        const current = panelMonth(panel);
        const exact = calendarDay(panel, date, target, current?.year === date.year && current.month === date.month);
        if (exact) { check(); exact.click(); return { filled: await verify(), precision: 'day', target }; }
      }
      // Year selection handles both standard picker headers and custom year/month lists.
      const yearSelector = '.ant-calendar-year-select,.ant-picker-year-btn,[class*="year-select"],[class*="year-btn"],[class*="year-label"]';
      const yearCells = () => leaves(panel, /^\d{4}年?$/).filter(node => !node.closest(yearSelector));
      let years = yearCells();
      let year = years.find(node => parseInt(node.textContent, 10) === date.year);
      const yearButton = panel.querySelector(yearSelector);
      if (yearButton && (!year || yearButton === year || yearButton.contains(year)) && safeCell(yearButton)) {
        yearButton.click(); await sleep(120); panel = requery() || panel;
        years = yearCells(); year = years.find(node => parseInt(node.textContent, 10) === date.year);
      }
      for (let guard = 0; guard < 20; guard++) {
        check(); years = yearCells(); year = years.find(node => parseInt(node.textContent, 10) === date.year);
        if (year) break;
        const yearValues = years.map(node => parseInt(node.textContent, 10));
        if (!yearValues.length) break;
        const previous = date.year < Math.min(...yearValues);
        const button = panel.querySelector(previous
          ? '.ant-calendar-year-panel-prev-decade-btn,.ant-picker-header-super-prev-btn,[class*="prev-decade"],[aria-label="上一年"],[title="上一年"]'
          : '.ant-calendar-year-panel-next-decade-btn,.ant-picker-header-super-next-btn,[class*="next-decade"],[aria-label="下一年"],[title="下一年"]');
        if (!button || !safeCell(button)) break;
        button.click(); await sleep(180); panel = requery() || panel;
      }
      if (!year) return { filled: false, precision, target };
      check(); year.click(); await sleep(120); panel = requery() || panel;
      if (precision === 'year') return { filled: await verify(), precision, target };
      const monthPattern = /^(?:\d{1,2}月?|[一二三四五六七八九十]{1,3}月|january|february|march|april|may|june|july|august|september|october|november|december|jan\.?|feb\.?|mar\.?|apr\.?|jun\.?|jul\.?|aug\.?|sep\.?|oct\.?|nov\.?|dec\.?)$/i;
      const monthButton = panel.querySelector('.ant-calendar-month-select,.ant-picker-month-btn,[class*="month-select"],[class*="month-btn"]');
      if (monthButton && safeCell(monthButton)) { check(); monthButton.click(); await sleep(100); panel = requery() || panel; }
      const monthGrid = precision === 'month' || panel.querySelector('.ant-picker-month-panel,.ant-calendar-month-panel,.el-month-table,[data-month]');
      let months = leaves(panel, monthPattern).filter(node => monthGrid || !/^\d{1,2}$/.test(node.textContent.trim()));
      if (!months.length) {
        const button = panel.querySelector('.ant-calendar-month-select,.ant-picker-month-btn,[class*="month-select"],[class*="month-btn"]');
        if (button && safeCell(button)) { button.click(); await sleep(120); panel = requery() || panel; months = leaves(panel, monthPattern); }
      }
      let month = months.find(node => monthNumber(node.textContent) === date.month);
      month ||= [...panel.querySelectorAll('.ant-calendar-month-panel-month,.ant-picker-month-panel td')].filter(safeCell)[date.month - 1];
      if (!month) return { filled: false, precision, target };
      month.click(); await sleep(180);
      let currentPanel = requery();
      if (knownPrecision === 'unknown' && currentPanel) {
        const openedPrecision = datePrecision(input, currentPanel);
        if (openedPrecision === 'day') { precision = 'day'; target = formatDate(value, 'day'); }
        else if (precision === 'unknown' && openedPrecision === 'month') {
          // A year-first month picker may require its own OK button to commit the month.
          datePanels.set(input, currentPanel); await confirmCalendar(input);
          const actual = dateParts(displayed(el), formatHint(input));
          if (actual && !actual.hasDay && actual.year === date.year && actual.month === date.month) {
            precision = 'month'; target = formatDate(value, 'month');
          }
          currentPanel = requery();
        }
      }
      if (precision === 'unknown' && !currentPanel) {
        const actual = dateParts(displayed(el));
        if (actual && !actual.hasDay && actual.year === date.year && actual.month === date.month) {
          precision = 'month'; target = formatDate(value, 'month');
        }
      }
      datePanels.set(input, currentPanel || panel);
      if (precision === 'month') return { filled: await verify(), precision, target };
      panel = currentPanel;
      if (!panel) return { filled: false, precision: 'day', target };
      const day = calendarDay(panel, date, target, true);
      if (!day) return { filled: false, precision: 'day', target };
      day.click(); return { filled: await verify(), precision: 'day', target };
    }
    return Object.freeze({ choiceSignals, fillChoice, fillCalendar, confirmCalendar, displayed, fieldRoot });
  }
  globalThis.__resumeControls = Object.freeze({ create, optionScore, rankOptions, datePrecision, dateParts, formatDate, CHOICE_PANELS, DATE_PANELS });
})();
