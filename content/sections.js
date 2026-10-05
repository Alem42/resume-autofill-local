// DOM-only section and record discovery. No storage, network or personal values.
(() => {
  if (globalThis.__resumeSections) return;
  const rules = globalThis.__resumeSemantics;
  const HEADINGS = 'h1,h2,h3,h4,h5,h6,legend,header,[role="heading"],[class*="section-title"],[class*="card-title"],[class*="card-header"],[class*="form-title"]';
  const RECORDS = '[data-record],fieldset,[class*="form-multiple"],[class*="experience-item"],[class*="record-item"],[class*="education-item"],[class*="project-item"],[class*="experience-card"]';
  const CONTROLS = 'button,[role="button"],[onclick],[class*="add"],a';
  const textOf = (node, hooks) => hooks.text(node).replace(/\s+/g, ' ').trim().slice(0, 100);
  function scope(el, hooks) {
    for (let node = el.parentElement, depth = 0; node && node !== document.body && depth < 14; node = node.parentElement, depth++) {
      const explicit = node.getAttribute('data-section');
      if (explicit && rules.titles[explicit] && explicit !== 'unknown') return { root: node, section: explicit, label: rules.titles[explicit] };
      const headings = [...node.querySelectorAll(HEADINGS)].filter(heading => hooks.visible(heading));
      const known = headings.map(heading => ({ heading, section: rules.section(textOf(heading, hooks)) })).filter(item => item.section !== 'unknown');
      const kinds = new Set(known.map(item => item.section));
      if (kinds.size === 1) return { root: node, section: known[0].section, label: textOf(known[0].heading, hooks) };
      // Do not turn an ancestor containing several sections into a single category.
      if (kinds.size > 1) continue;
      const named = rules.section(`${node.id || ''} ${typeof node.className === 'string' ? node.className : ''}`);
      if (named !== 'unknown' && node.querySelectorAll('input,select,textarea,[contenteditable]').length > 1) {
        return { root: node, section: named, label: rules.titles[named] };
      }
    }
    return { root: document.body, section: rules.inferSection(hooks.label(el) || el.name || ''), label: '' };
  }
  function recordRoot(el, root) {
    const record = el.closest(RECORDS);
    return record && record !== root && root.contains(record) ? record : null;
  }
  function ordered(elements) {
    return [...elements].sort((a, b) => {
      if (!a.compareDocumentPosition) return 0;
      const position = a.compareDocumentPosition(b);
      return position & 2 ? 1 : position & 4 ? -1 : 0;
    });
  }
  function inspect(elements, hooks) {
    const result = new Map();
    const roots = new Map();
    for (const el of ordered(elements)) {
      const context = scope(el, hooks);
      const inferred = rules.inferSection(hooks.label(el) || el.name || '');
      if (context.section === 'basic' && ['other', 'jobIntention'].includes(inferred)) {
        context.section = inferred; context.label = rules.titles[inferred];
      }
      if (!roots.has(context.root)) roots.set(context.root, new Map());
      const groups = roots.get(context.root);
      if (!groups.has(context.section)) groups.set(context.section, { ...context, elements: [] });
      groups.get(context.section).elements.push(el);
    }
    const offsets = new Map();
    for (const groups of roots.values()) for (const group of groups.values()) {
      const repeated = rules.repeated.includes(group.section);
      const records = repeated ? [...group.root.querySelectorAll(RECORDS)].filter(node => node !== group.root
        && hooks.visible(node) && scope(node, hooks).root === group.root) : [];
      // Nested record wrappers describe the same entry; keep the innermost wrapper containing fields.
      const distinct = records.filter(node => !records.some(other => other !== node && node.contains(other)));
      for (const el of group.elements) {
        const record = recordRoot(el, group.root);
        if (record && !distinct.includes(record)) distinct.push(record);
      }
      const recordIndices = new Map(ordered(distinct).map((node, index) => [node, index]));
      let index = 0, anchors = 0;
      const firstLabel = hooks.label(group.elements[0]) || group.elements[0]?.name || '';
      const anchorExists = group.elements.some(el => rules.isAnchor(group.section, hooks.label(el) || el.name));
      for (const el of group.elements) {
        const record = recordRoot(el, group.root);
        if (!recordIndices.size && repeated) {
          const label = hooks.label(el) || el.name || '';
          const starts = anchorExists ? rules.isAnchor(group.section, label) : label && label === firstLabel;
          if (starts) { if (anchors) index++; anchors++; }
        }
        const localIndex = !repeated ? null : recordIndices.size ? recordIndices.get(record) ?? null : index;
        result.set(el, { section: group.section, sectionLabel: group.label,
          recordIndex: localIndex === null ? null : localIndex + (offsets.get(group.section) || 0),
          sectionRoot: group.root, recordRoot: record });
      }
      group.count = repeated ? recordIndices.size || (group.elements.length ? index + 1 : 0) : 0;
      offsets.set(group.section, (offsets.get(group.section) || 0) + group.count);
    }
    return { fields: result, counts: Object.fromEntries(offsets) };
  }
  function addControl(el, hooks) {
    if (!el?.isConnected || el.ownerDocument !== document || el.disabled || !hooks.visible(el)
      || el.closest('[inert],[aria-hidden="true"]') || el.getAttribute('aria-disabled') === 'true') return null;
    if (el.tagName === 'INPUT') return null;
    if (el.tagName === 'A' && el.getAttribute('href')) return null;
    if (el.tagName === 'BUTTON' && (el.type === 'submit' || el.type === 'reset'
      || (!el.getAttribute('type') && el.closest('form')))) return null;
    const label = textOf(el, hooks);
    if (!label || label.length > 60 || /删除|移除|保存|提交|上传|投递|申请|登录|验证码|支付|delete|remove|save|submit|upload|apply|login|send|pay/i.test(label)) return null;
    const plain = label.replace(/^[+＋✚\s]+/, '');
    if (!/^(添加|新增|增加|新建|add\b)/i.test(plain)) return null;
    const explicit = rules.section(plain);
    const context = scope(el, hooks);
    const section = explicit === 'unknown' ? context.section : explicit;
    if (!rules.repeated.includes(section) || context.root === document.body || context.section !== section) return null;
    return { element: el, label, section, root: context.root };
  }
  function controls(hooks) {
    const candidates = [...document.querySelectorAll(CONTROLS)].map(el => addControl(el, hooks)).filter(Boolean);
    return candidates.filter(candidate => !candidates.some(other => other !== candidate && other.section === candidate.section
      && other.root === candidate.root && other.element.contains(candidate.element)));
  }
  async function ensureRecords(targets, hooks) {
    const reports = [];
    let clicks = 0;
    const initial = controls(hooks);
    const sections = new Set(initial.map(control => control.section));
    for (const section of sections) {
      const desired = targets[section] || 0;
      if (!desired) continue;
      const candidates = initial.filter(control => control.section === section);
      const roots = new Set(candidates.map(control => control.root));
      let before = inspect(hooks.elements(), hooks).counts[section] || 0;
      // For an empty section, inspect() has no elements yet.
      const report = { section, title: rules.titles[section], requested: desired, existing: before, added: 0, message: '' };
      reports.push(report);
      if (before >= desired) continue;
      if (candidates.length !== 1 || roots.size !== 1) { report.message = '存在多个添加入口，未自动点击，请手动补足。'; continue; }
      const bound = candidates[0];
      while (before < desired && clicks < 40) {
        hooks.check();
        if (!bound.root.isConnected) { report.message = '经历区块已被替换，请重新检测。'; break; }
        const current = controls(hooks).filter(control => control.section === section && control.root === bound.root);
        if (current.length !== 1) { report.message = '添加入口发生变化，请手动补足。'; break; }
        const button = current[0];
        if (button.label !== bound.label) { report.message = '添加按钮文字发生变化，已停止。'; break; }
        hooks.check();
        button.element.click();
        clicks++;
        let after = before;
        for (let wait = 0; wait < 20 && after <= before; wait++) {
          await hooks.sleep(100);
          after = inspect(hooks.elements(), hooks).counts[section] || 0;
        }
        if (after <= before) { report.message = '点击后未检测到新增条目，已停止重复点击。'; break; }
        report.added += after - before;
        before = after;
        if (after > desired) { report.message = '网站一次创建了多个条目，请检查页面。'; break; }
      }
      if (before < desired && !report.message) report.message = '已达到本次添加上限，请手动补足或重新确认。';
    }
    for (const [section, desired] of Object.entries(targets)) {
      if (section === 'employment' || !desired || sections.has(section)
        || (['work', 'internships'].includes(section) && sections.has('employment'))) continue;
      const existing = inspect(hooks.elements(), hooks).counts[section] || 0;
      if (existing < desired) reports.push({ section, title: rules.titles[section], requested: desired, existing, added: 0,
        message: '未发现明确且安全的添加按钮，请手动补足。' });
    }
    return reports;
  }
  globalThis.__resumeSections = Object.freeze({ inspect, scope, ensureRecords,
    detectable: hooks => controls(hooks).map(control => control.section) });
})();
