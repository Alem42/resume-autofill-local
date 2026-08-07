// Content Script - 通用字段采集 + 智能填充 + 浮动按钮
// 策略：行为驱动检测，不依赖特定 UI 框架类名

(function () {
  'use strict';

  if (document.getElementById('resume-autofill-btn')) return;

  let filledFields = [];
  let running = false;               // 重入保护：填充/撤回异步期间忽略重复点击

  // 获取字段当前值
  function getFieldValue(el) {
    if (el.isContentEditable) return el.textContent || '';
    // select 返回选中项文本（与 fillNativeSelect 的匹配依据一致），
    // 而非 selectedIndex——撤回时数字既匹配不上 opt.value 也没有 .includes
    if (el.tagName.toLowerCase() === 'select') {
      const opt = el.options[el.selectedIndex >= 0 ? el.selectedIndex : 0];
      return opt ? (opt.textContent.trim() || opt.value) : '';
    }
    return el.value || '';
  }

  // ===== 浮动按钮（可拖拽） =====
  function createFloatingButton() {
    const btn = document.createElement('div');
    btn.id = 'resume-autofill-btn';
    btn.textContent = '自动填充';
    document.body.appendChild(btn);

    let isDragging = false, startX, startY, startLeft, startTop, hasMoved;

    btn.addEventListener('mousedown', (e) => {
      isDragging = true; hasMoved = false;
      startX = e.clientX; startY = e.clientY;
      const rect = btn.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top;
      btn.style.transition = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      btn.style.right = 'auto'; btn.style.bottom = 'auto';
      btn.style.left = (startLeft + dx) + 'px';
      btn.style.top = (startTop + dy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (isDragging && !hasMoved) handleClick();
      isDragging = false;
      btn.style.transition = 'all 0.2s ease';
    });

    return btn;
  }

  function updateButtonText(btn, text, className) {
    btn.textContent = text;
    btn.className = className || '';
  }

  // ===== 点击处理 =====
  async function handleClick() {
    if (running) return;             // 上一轮尚未结束 → 忽略本次点击
    running = true;
    const btn = document.getElementById('resume-autofill-btn');
    let ticker = null;

    try {
      if (btn.classList.contains('result')) {
        await undoFill(btn);
        return;
      }

      // 阶段 1：读取简历数据（本地读取，很快）
      updateButtonText(btn, '读取简历中...', 'loading');
      const profile = await getProfile();

      // 阶段 2：展开初始为空的"添加"区块 + 采集表单字段
      updateButtonText(btn, '采集字段中...', 'loading');
      await expandAddBlocks(profile);
      const fields = collectFields();

      if (fields.length === 0) {
        updateButtonText(btn, '未找到表单', 'error');
        setTimeout(() => updateButtonText(btn, '自动填充', ''), 2000);
        return;
      }

      // 阶段 3：AI 识别（网络慢时显示已等待秒数，缓解等待焦虑）
      updateButtonText(btn, '识别中...', 'loading');
      let waitSec = 0;
      ticker = setInterval(() => {
        waitSec++;
        updateButtonText(btn, `识别中... ${waitSec}s`, 'loading');
      }, 1000);

      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'FILL_FORM', fields, profile }, resp => {
          if (chrome.runtime.lastError) {
            resolve({ __commError: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp);
        });
      });

      if (response && response.__commError) {
        updateButtonText(btn, '通信失败', 'error');
        console.error('[简历填充]', response.__commError);
        setTimeout(() => updateButtonText(btn, '自动填充', ''), 3000);
        return;
      }
      if (!response) {
        updateButtonText(btn, '无响应', 'error');
        setTimeout(() => updateButtonText(btn, '自动填充', ''), 3000);
        return;
      }
      if (response.error) {
        const errText = response.error.length > 30 ? response.error.slice(0, 28) + '...' : response.error;
        updateButtonText(btn, errText, 'error');
        console.error('[简历填充]', response.error);
        setTimeout(() => updateButtonText(btn, '自动填充', ''), 5000);
        return;
      }

      // 阶段 4：逐字段填充，显示进度
      const mappings = response.mappings || [];
      const count = await executeFill(mappings, (done, total) => {
        updateButtonText(btn, `填充中 ${done}/${total}`, 'loading');
      });
      if (count === 0) {
        updateButtonText(btn, '未匹配到可填充字段', 'error');
        setTimeout(() => updateButtonText(btn, '自动填充', ''), 3000);
      } else {
        updateButtonText(btn, `已填充 ${count}/${fields.length} 个字段（点击撤回）`, 'result');
      }
    } catch (err) {
      updateButtonText(btn, '出错了', 'error');
      console.error('[简历填充]', err);
      setTimeout(() => updateButtonText(btn, '自动填充', ''), 3000);
    } finally {
      if (ticker) clearInterval(ticker);
      running = false;
    }
  }

  // ===== 通用组件类型检测（行为驱动） =====
  function detectComponentType(el) {
    const tag = el.tagName.toLowerCase();

    // 1. contenteditable 元素
    if (el.isContentEditable && tag !== 'input' && tag !== 'textarea') return 'contenteditable';
    if (el.getAttribute('role') === 'textbox') return 'contenteditable';

    // 2. 原生元素优先
    if (tag === 'select') return 'native-select';
    if (tag === 'textarea') return 'native-input';
    if (tag === 'input') {
      // 只读输入框多为自定义下拉/级联/日期组件的展示层：原生 setter 填值不会触发框架更新，
      // 必须走组件交互。先判日期（如 B 站 bili-date），再判下拉。
      if (el.readOnly) {
        if (hasDatepickerBehavior(el)) return 'custom-datepicker';
        if (hasDropdownBehavior(el) || el.closest('[class*="select"], [class*="cascader"], [class*="picker"], [class*="dropdown"], [role="combobox"]')) return 'custom-dropdown';
      }
      return 'native-input';
    }

    // 3. 通用下拉框检测（不依赖框架名）
    if (hasDropdownBehavior(el)) return 'custom-dropdown';

    // 4. 日期选择器检测
    if (hasDatepickerBehavior(el)) return 'custom-datepicker';

    // 5. 内含 input 的容器（通用自定义输入框）
    const innerInput = el.querySelector('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
    if (innerInput) return 'wrapper-input';

    return 'unknown';
  }

  // 通用下拉行为检测
  function hasDropdownBehavior(el) {
    // ARIA 语义
    if (el.getAttribute('aria-haspopup') === 'listbox' ||
        el.getAttribute('aria-haspopup') === 'dialog' ||
        el.getAttribute('role') === 'combobox') return true;
    // 类名中的通用模式（匹配任何框架）
    const cls = (typeof el.className === 'string') ? el.className : '';
    if (/\b(select|dropdown|combo|picker|cascader)\b/i.test(cls) && el.tagName.toLowerCase() !== 'select') return true;
    // 有展开状态的元素
    if (el.getAttribute('aria-expanded') !== null) return true;
    return false;
  }

  // 通用日期选择器行为检测
  function hasDatepickerBehavior(el) {
    const cls = (typeof el.className === 'string') ? el.className : '';
    if (/\b(date|calendar|日历|时间)\b/i.test(cls)) return true;
    // 内含 input 且类名含 date
    if (el.querySelector('input') && /\b(date|time)\b/i.test(cls)) return true;
    return false;
  }

  // ===== 通用字段采集引擎（三轮扫描） =====
  function scanFieldElements() {
    const elements = [];
    const seen = new Set();

    function push(el) {
      if (seen.has(el)) return;
      seen.add(el);
      elements.push(el);
    }

    // 第一轮：原生表单元素
    document.querySelectorAll('input, select, textarea').forEach(el => {
      const type = (el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'file', 'password', 'checkbox', 'radio'].includes(type)) return;
      if (!isVisible(el)) return;
      if (el.closest('#resume-autofill-btn')) return;
      push(el);
    });

    // 第二轮：自定义组件（ARIA 语义 + 类名模式 + contenteditable）
    const customSelectors = [
      '[role="textbox"]', '[role="combobox"]', '[role="searchbox"]', '[role="spinbutton"]',
      '[contenteditable="true"]', '[contenteditable=""]',
      '[aria-haspopup="listbox"]', '[aria-haspopup="dialog"]',
      '[class*="select"]:not(select)', '[class*="dropdown"]:not([role="menu"])',
      '[class*="combobox"]', '[class*="picker"]', '[class*="cascader"]'
    ];
    document.querySelectorAll(customSelectors.join(',')).forEach(el => {
      if (!isVisible(el)) return;
      if (el.closest('#resume-autofill-btn')) return;
      // 如果内部的原生 input 已采集，跳过外层容器
      const innerInput = el.querySelector('input:not([type="hidden"]):not([type="submit"])');
      if (innerInput && seen.has(innerInput)) return;
      // 嵌套在更大下拉容器内的内部零件（ant 的箭头/图标/选区等），只保留最外层容器，
      // 避免 AI 把值映射到 .ant-select-arrow / .ant-select-arrow-icon 这类装饰元素上
      if (el.parentElement && el.parentElement.closest(customSelectors.join(','))) return;
      push(el);
    });

    // 第三轮：框架绑定的隐藏字段（Vue/React/Angular）
    document.querySelectorAll('[data-field], [formcontrolname], [v-model], [ng-model], [formControlName]').forEach(el => {
      if (!isVisible(el) || seen.has(el)) return;
      push(el);
    });

    return elements;
  }

  function collectFields() {
    const fields = [];
    const collected = new Set();
    for (const el of scanFieldElements()) {
      addField(el, collected, fields);
    }
    return fields;
  }

  function addField(el, collected, fields) {
    if (collected.has(el)) return;
    collected.add(el);

    const selector = generateSelector(el);
    if (!selector) return;

    const componentType = detectComponentType(el);
    const field = {
      selector, componentType,
      tag: el.tagName.toLowerCase(),
      label: getLabelText(el),
      placeholder: getPlaceholder(el),
      name: el.name || el.getAttribute('name') || el.getAttribute('formcontrolname') || '',
      id: el.id || '',
      contextText: getContextText(el),
      required: isRequired(el)
    };

    // 采集可选项
    if (el.tagName.toLowerCase() === 'select') {
      field.options = Array.from(el.options).map(o => o.textContent.trim()).filter(Boolean);
    }

    // 尝试从已渲染的下拉面板采集选项
    if (componentType === 'custom-dropdown' || componentType === 'native-select') {
      const opts = collectDropdownOptions(el);
      if (opts.length > 0) field.options = opts;
    }

    const hasContext = field.label || field.placeholder || field.name || field.contextText;
    if (hasContext) fields.push(field);
  }

  // 通用可选项采集（只从与当前字段关联的下拉面板采集）
  function collectDropdownOptions(containerEl) {
    // 优先从容器内部采集（原生 select 或自定义组件内的选项）
    const innerOpts = containerEl.querySelectorAll('option, [role="option"], [class*="option"]');
    if (innerOpts.length > 0) {
      const opts = new Set();
      innerOpts.forEach(opt => {
        const text = (opt.textContent || opt.value || '').trim();
        if (text && text.length < 50) opts.add(text);
      });
      if (opts.size > 0) return Array.from(opts);
    }
    return [];
  }

  // ===== 展开"添加"区块（工作/教育/项目等初始为空时） =====
  // 添加控件可能是裸 div（如 B 站的 .bili-form-add），必须用 [class*="add"] 兜底
  const ADD_WORDS = /添加|新增|增加|add|append|insert|\+/i;
  const SECTION_WORDS = /教育|工作|实习|项目|经历|语言|学校|公司/;

  function findAddButtons(max) {
    const candidates = document.querySelectorAll('button, [role="button"], a, [class*="add"], [class*="plus"]');
    const result = [];
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
      const combo = text + ' ' + aria;
      if (!ADD_WORDS.test(combo)) continue;
      // 区块词：按钮文本本身，或（长度受限的）父元素文本，避免误匹配大容器
      let ctx = combo;
      if (!SECTION_WORDS.test(ctx)) {
        const parentText = (el.parentElement ? el.parentElement.textContent : '') || '';
        if (parentText.length < 50) ctx += ' ' + parentText;
      }
      if (!SECTION_WORDS.test(ctx)) continue;
      if (!isVisible(el)) continue;    // 布局读取放到最后，只对已命中的少数候选执行
      result.push(el);
      if (max && result.length >= max) break;
    }
    return result;
  }

  // 最近"像区块"的祖先（真实页命中 .bili-form-card-body 的 card）
  function getSectionContainer(btn) {
    let el = btn.parentElement;
    for (let i = 0; i < 5 && el && el !== document.body; i++, el = el.parentElement) {
      const cls = (typeof el.className === 'string') ? el.className : '';
      if (/section|block|card|item|group/.test(cls)) return el;
      const text = (el.textContent || '');
      if (text.length < 200 && /教育经历|工作经历|项目经历|实习经历|语言能力|求职意向|自我描述/.test(text)) return el;
    }
    return btn.parentElement || btn;
  }

  // 简历某区块应有的条目数（数组取 length；语言等换行字符串按行计数）
  function profileEntryCount(profile, key) {
    if (!key || !profile) return 0;
    const v = profile[key];
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'string' && v.trim()) return v.split(/\r?\n/).map(s => s.trim()).filter(Boolean).length;
    return 0;
  }

  // 区块内已渲染的经历块数：结构信号优先（块容器 class），标签频次兜底
  function countBlocksInSection(section) {
    const fields = section.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="password"]), select, textarea');
    const visible = [];
    for (const el of fields) if (isVisible(el)) visible.push(el);
    if (visible.length === 0) return 0;

    // 1) 结构信号：字段归到最近的"块容器"，只认含 >=2 个可见字段的容器，去重容器数即块数
    const BLOCK_RE = /multiple|block|entry|record/i;
    const containerCounts = new Map();
    for (const el of visible) {
      let a = el.parentElement;
      for (let i = 0; i < 5 && a && a !== section && a !== document.body; i++, a = a.parentElement) {
        const cls = (typeof a.className === 'string') ? a.className : '';
        if (BLOCK_RE.test(cls)) {
          containerCounts.set(a, (containerCounts.get(a) || 0) + 1);
          break;
        }
      }
    }
    const multiFieldBlocks = Array.from(containerCounts.values()).filter(c => c >= 2);
    if (multiFieldBlocks.length > 0) return multiFieldBlocks.length;

    // 2) 兜底：重复条目复用同一套标签 → 出现最多的标签次数 ≈ 块数
    const freq = new Map();
    for (const el of visible) {
      const label = getLabelText(el);
      if (!label) continue;
      freq.set(label, (freq.get(label) || 0) + 1);
    }
    if (freq.size === 0) return 1;   // 标签不可读 → 保守认为已有 1 块
    return Math.max(...freq.values());
  }

  // 在区块内重新查找"添加"按钮（每轮点击前重查，防框架重渲染替换节点）
  function findAddButtonInSection(section) {
    const candidates = section.querySelectorAll('button, [role="button"], a, [class*="add"], [class*="plus"]');
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
      if (!ADD_WORDS.test(text + ' ' + aria)) continue;
      if (!isVisible(el)) continue;
      return el;
    }
    return null;
  }

  // 添加按钮 → 简历区块类型；只给简历里确实有数据的区块点"添加"
  function mapButtonToProfileKey(btn) {
    const text = (btn.textContent || '') + ' ' + (btn.getAttribute('aria-label') || '');
    if (/教育/.test(text)) return 'education';
    if (/工作|实习/.test(text)) return 'work';
    if (/项目/.test(text)) return 'projects';
    if (/语言/.test(text)) return 'languages';
    return null;
  }

  async function expandAddBlocks(profile) {
    const clicked = new WeakSet();
    let any = false;
    for (const btn of findAddButtons()) {
      const section = getSectionContainer(btn);
      if (clicked.has(section)) continue;          // 同一区块只处理一次
      const key = mapButtonToProfileKey(btn);
      const want = profileEntryCount(profile, key);               // 简历条数（数组 length / 字符串按行数）
      if (want <= 0) continue;                                    // 简历无此区块数据 → 不点
      clicked.add(section);
      const toAdd = Math.max(0, want - countBlocksInSection(section)); // 页面已有块数的差额
      if (toAdd === 0) continue;                                  // 已有块 ≥ 简历条数 → 不重复新建
      any = true;
      for (let i = 0; i < toAdd; i++) {
        const addBtn = findAddButtonInSection(section) || btn;    // 每轮重查，防重渲染替换节点
        if (!addBtn || !addBtn.isConnected || !isVisible(addBtn)) break;
        addBtn.click();                                           // Vue 等框架同步渲染新块
        await sleep(80);
      }
    }
    if (!any) return;
    // 等待新字段渲染（异步框架可能延迟），最多 ~3s
    const before = scanFieldElements().length;
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      if (scanFieldElements().length > before) return;
    }
  }

  // ===== 简历页面检测（按需显示按钮） =====
  const RESUME_STRONG = [
    // 中文：简历/求职特有
    '简历', '求职意向', '期望', '学历', '学位', '毕业院校', '工作经历', '实习经历',
    '教育经历', '项目经历', '工作经验', '自我评价', '招聘', '投递', '应聘', '求职',
    '职位', '岗位', '到岗时间', '政治面貌', '薪资',
    // 英文：词边界匹配
    'resume', 'apply', 'job', 'jobs', 'career', 'careers', 'recruit', 'candidate'
  ];
  const RESUME_MEDIUM = [
    '姓名', '手机', '电话', '邮箱', '性别', '出生日期', '籍贯', '户籍', '民族', '婚姻',
    '所在城市', '现居住', '学校', '专业', '技能', '证书', '语言',
    'name', 'phone', 'email', 'school', 'major', 'city', 'location'
  ];
  const NEGATIVE_KEYWORDS = [
    '登录', '注册', '密码', '验证码', '搜索', '评论', '记住我', '忘记密码',
    'login', 'password', 'captcha', 'register', 'search', 'comment'
  ];

  function keywordHitCount(text, keywords) {
    const lower = text.toLowerCase();
    let n = 0;
    for (const kw of keywords) {
      if (/[a-z]/.test(kw)) {
        if (new RegExp('\\b' + kw + '\\b').test(lower)) n++;
      } else if (lower.includes(kw)) {
        n++;
      }
    }
    return n;
  }

  // 搜索框类字段（最大的误判源：搜索页）
  function isSearchLikeField(el) {
    if (el.type === 'search') return true;
    if (el.getAttribute('role') === 'searchbox') return true;
    const text = ((el.name || '') + ' ' + getLabelText(el) + ' ' + getPlaceholder(el)).toLowerCase();
    return /search|query|keyword|搜索/.test(text);
  }

  // 轻量字段描述（不生成 selector/options，供检测用）
  function collectFieldsForDetection() {
    const descs = [];
    for (const el of scanFieldElements()) {
      const desc = {
        label: getLabelText(el),
        placeholder: getPlaceholder(el),
        name: el.name || el.getAttribute('name') || el.getAttribute('formcontrolname') || '',
        contextText: getContextText(el),
        isSearchLike: isSearchLikeField(el)
      };
      if (desc.label || desc.placeholder || desc.name || desc.contextText) descs.push(desc);
    }
    return descs;
  }

  function isResumePage() {
    const pageText = location.href + ' ' + (document.title || '');
    // 正信号只看 URL（标题太吵：一篇含 "career" 的博客文章也会命中）
    const urlStrong = keywordHitCount(location.href, RESUME_STRONG);
    const pageNeg = keywordHitCount(pageText, NEGATIVE_KEYWORDS);

    const usable = collectFieldsForDetection().filter(d => !d.isSearchLike);
    // 全是"添加"按钮的空表单（如初始为空的 B 站简历页）也是简历表单
    const addSignal = findAddButtons(1).length > 0;
    if (usable.length === 0 && !addSignal) return false;

    let fStrong = 0, fMedium = 0, fNeg = 0;
    for (const d of usable) {
      const combo = d.label + ' ' + d.placeholder + ' ' + d.name + ' ' + d.contextText;
      fStrong += keywordHitCount(combo, RESUME_STRONG);
      fMedium += keywordHitCount(combo, RESUME_MEDIUM);
      fNeg += keywordHitCount(combo, NEGATIVE_KEYWORDS);
    }

    // 纯登录/搜索/评论页：即使有"邮箱/姓名"等中等信号也拦掉；
    // 但字段丰富的表单（中等信号≥3，如校园招聘的"register"登记页）或有"添加"区块应放行
    if ((pageNeg > 0 || fNeg > 0) && urlStrong === 0 && fStrong === 0 && fMedium < 3 && !addSignal) return false;

    // 主规则：字段信号足够（强≥1 或 中等≥2）；
    // 或 URL 是招聘页（job/apply/简历…）且字段至少有一个个人信息信号，避免职业博客正文页误显示
    return addSignal || fStrong >= 1 || fMedium >= 2 || (urlStrong >= 1 && (fStrong >= 1 || fMedium >= 1));
  }

  // ===== 通用标签检测 =====
  function getLabelText(el) {
    // label for
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent.trim();
    }
    // 包裹的 label
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input, select, textarea').forEach(e => e.remove());
      const text = clone.textContent.trim();
      if (text) return text;
    }
    // 通用：form-item / form-group 中的 label。
    // ant 的 ant-form-item-children 也会命中 [class*="form-item"] 但里面没有 label，
    // label 在更上层的 ant-form-item，所以向上逐级找真正带 label 的那一级
    let formItem = el.closest('[class*="form-item"], [class*="form-group"], [class*="field-item"], [class*="form-row"]');
    while (formItem && formItem !== document.body) {
      const label = formItem.querySelector('[class*="label"], label');
      if (label) {
        const text = label.textContent.trim().replace(/[：:*：*\s?]+$/, '');
        if (text) return text;
      }
      formItem = formItem.parentElement && formItem.parentElement.closest('[class*="form-item"], [class*="form-group"], [class*="field-item"], [class*="form-row"]');
    }
    // 通用：data-label 属性
    if (el.getAttribute('data-label')) return el.getAttribute('data-label');
    return '';
  }

  function getPlaceholder(el) {
    if (el.placeholder) return el.placeholder;
    // 内部 input 的 placeholder
    const inner = el.querySelector('input[placeholder], textarea[placeholder]');
    if (inner) return inner.placeholder;
    // ARIA
    if (el.getAttribute('aria-placeholder')) return el.getAttribute('aria-placeholder');
    // 通用 placeholder 类名
    const ph = el.querySelector('[class*="placeholder"]');
    if (ph) return ph.textContent.trim();
    return '';
  }

  function isRequired(el) {
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    const formItem = el.closest('[class*="form-item"], [class*="form-group"], [class*="field"]');
    if (formItem) {
      if (formItem.querySelector('[class*="required"]')) return true;
      const label = formItem.querySelector('label, [class*="label"]');
      if (label && /[＊*⭐]/.test(label.textContent)) return true;
    }
    return false;
  }

  function getContextText(el) {
    let prev = el.previousElementSibling;
    if (prev && !['INPUT', 'SELECT', 'TEXTAREA'].includes(prev.tagName)) {
      const text = prev.textContent.trim();
      if (text && text.length < 100) return text;
    }
    const parent = el.parentElement;
    if (parent) {
      const clone = parent.cloneNode(true);
      clone.querySelectorAll('input, select, textarea, svg, style, script').forEach(e => e.remove());
      const text = clone.textContent.trim().replace(/\s+/g, ' ');
      if (text && text.length < 150) return text;
    }
    let ancestor = el.parentElement?.parentElement;
    if (ancestor) {
      const clone = ancestor.cloneNode(true);
      clone.querySelectorAll('input, select, textarea, svg, style, script').forEach(e => e.remove());
      const text = clone.textContent.trim().replace(/\s+/g, ' ');
      if (text && text.length < 150) return text;
    }
    return '';
  }

  // ===== 选择器生成 =====
  function generateSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;

    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let sel = current.tagName.toLowerCase();
      if (current.id) {
        path.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      // 用有意义的 class 辅助定位
      if (current.className && typeof current.className === 'string') {
        const useful = current.className.split(/\s+/).find(c =>
          c.startsWith('ant-') || c.startsWith('el-') || c.startsWith('arco-') ||
          c.startsWith('t-') || c.startsWith('is-') || c.startsWith('mui-')
        );
        if (useful) sel += `.${useful}`;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) sel += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      path.unshift(sel);
      current = current.parentElement;
    }
    return path.join(' > ');
  }

  // ===== 填充执行 =====
  async function executeFill(mappings, onProgress) {
    let count = 0;
    const undoData = [];
    const total = mappings.length;

    for (let i = 0; i < mappings.length; i++) {
      const mapping = mappings[i];
      // 防御：LLM 返回空值时跳过，避免填充空字段
      if (mapping.value === null || mapping.value === undefined || mapping.value === '') {
        if (onProgress) onProgress(i + 1, total);
        continue;
      }
      const el = findElement(mapping.selector);
      if (!el) {
        if (onProgress) onProgress(i + 1, total);
        continue;
      }

      const value = String(mapping.value);
      const componentType = mapping.componentType || detectComponentType(el);

      try {
        const originalValue = getFieldValue(el);
        undoData.push({ selector: mapping.selector, originalValue, componentType });

        await fillByType(el, value, componentType);
        highlightField(el);
        count++;
      } catch (e) {
        console.warn('[简历填充] 填充失败:', mapping.selector, componentType, e);
      }
      if (onProgress) onProgress(i + 1, total);
      await sleep(150);
    }

    filledFields = undoData;
    return count;
  }

  async function fillByType(el, value, componentType) {
    switch (componentType) {
      case 'native-input':
      case 'wrapper-input':
        fillNativeInput(el, value);
        break;
      case 'native-select':
        fillNativeSelect(el, value);
        break;
      case 'contenteditable':
        fillContentEditable(el, value);
        break;
      case 'custom-dropdown':
        await fillGenericDropdown(el, value);
        break;
      case 'custom-datepicker':
        await fillGenericDatepicker(el, value);
        break;
      default:
        // 兜底：尝试当原生 input 填充
        if (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea') {
          fillNativeInput(el, value);
        } else {
          // 最后尝试：找到内部 input 填充
          const inner = el.querySelector('input:not([type="hidden"])');
          if (inner) fillNativeInput(inner, value);
        }
    }
  }

  // ===== 各类型填充实现 =====

  function fillNativeInput(el, value) {
    const proto = el.tagName.toLowerCase() === 'textarea'
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function fillNativeSelect(el, value) {
    const v = String(value || '').trim();
    if (!v) return;
    // 1) 精确匹配
    for (const opt of el.options) {
      if (opt.textContent.trim() === v || opt.value === v) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
    // 2) 包含匹配（"北京" ↔ "北京市"）
    for (const opt of el.options) {
      const t = opt.textContent.trim();
      if (t && (t.includes(v) || v.includes(t))) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
    // 3) 地点模糊匹配（籍贯"湖南长沙" ↔ 选项"湖南省"，去省/市后缀取最接近）
    let best = null, bestLen = 0;
    for (const opt of el.options) {
      const len = matchDropdownOption(opt.textContent, v);
      if (len > bestLen) { bestLen = len; best = opt; }
    }
    if (best) {
      el.value = best.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function fillContentEditable(el, value) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  // 通用下拉框填充（Ant Design / Element / Arco / 任意自定义下拉；支持省/市级联逐级选择）
  async function fillGenericDropdown(el, value) {
    // 1. 记录打开前已可见的选项（属于其他已打开的面板），避免误点；
    //    只排除"打开前就可见"的，隐藏后由本次打开显示的面板选项不会被误排除
    const optionSelectors = '[role="option"], [class*="option"], [class*="dropdown-item"], [class*="select-item"], [class*="menu-item"], li[class*="item"]';
    const visibleBefore = new Set(Array.from(document.querySelectorAll(optionSelectors)).filter(isVisible));

    // 2. 点击打开下拉：类名优先（ant 是 selection、arco 是 select-view），
    //    再用 elementFromPoint 命中中央真正可点的元素——点外层容器可能不触发内部处理器
    let trigger = el.querySelector('[class*="selector"], [class*="selection"], [class*="select-view"], [class*="input"], [class*="trigger"]') || centerOf(el) || el;
    if (!trigger || typeof trigger.click !== 'function') trigger = el;   // SVG/非标准元素没有 click → 退回外层
    trigger.click();
    await sleep(350);

    // 3. 搜索框：仅地点类值（含 省/市 等区划词）才用，且只搜第一段，避免整值搜空把选项过滤掉
    const searchInput = el.querySelector('input[class*="search"], input[class*="filter"]') ||
                        el.querySelector('input:not([type="hidden"]):not([readonly])');
    if (searchInput && searchInput.offsetParent !== null && /(省|市|自治区|特别行政区|自治州|地区|盟|县|区)/.test(String(value || ''))) {
      const searchText = placeFirstSegment(value);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(searchInput, searchText); else searchInput.value = searchText;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(350);
    }

    // 4. 逐级匹配：整值/片段精确优先，省→市逐级消费（级联选择器）；最多 6 级防死循环
    let remaining = String(value || '').trim();
    let clickedAny = false;
    for (let guard = 0; guard < 6 && remaining; guard++) {
      const opts = Array.from(document.querySelectorAll(optionSelectors))
        .filter(o => !visibleBefore.has(o))
        .filter(isVisible);
      if (opts.length === 0) break;

      let best = null, bestLen = 0;
      for (const o of opts) {
        const len = matchDropdownOption(o.textContent, remaining);
        if (len > bestLen) { bestLen = len; best = o; }
      }
      if (!best || bestLen === 0) break;        // 本级无可匹配项

      best.click();
      clickedAny = true;
      await sleep(150);

      if (bestLen >= remaining.length) break;   // 值已全部选中
      // 消费本级后，跳过残留的区划后缀/分隔符："湖南省长沙市" 消费"湖南"后剩"省长沙市" → 清成"长沙市"
      remaining = remaining.slice(bestLen).replace(/^[省市自治州盟县区\/、\s，,]+/, '');
      await sleep(200);                         // 等下一级渲染
    }

    // 收尾：主动收起面板。选中后部分下拉/级联不会自动关闭（尤其只选"省"时级联停在市列表）；
    // ant 等框架靠 document 上的 mousedown / Escape 关闭弹层，所以三种机制都发一遍兜底
    if (clickedAny) await sleep(120);   // 等框架处理完选中事件
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    document.body.click();
  }

  // 地点类值只取"省"段用于搜索（"湖南长沙"/"湖南省" → "湖南"），其余值原样返回
  function placeFirstSegment(value) {
    const v = String(value || '').trim();
    if (v && /(省|市|自治区|特别行政区|自治州|地区|盟|县|区)/.test(v)) {
      const seg = v.split(/(?:省|市|自治区|特别行政区|自治州|地区|盟|县|区)/)[0];
      if (seg) return seg;
    }
    return v;
  }

  // 选项文本与待消费值的匹配：返回本次可消费的字符数，0 表示不匹配。
  // "湖南省"↔"湖南"、"长沙市"↔"长沙"、"湖南长沙" 先消费 "湖南省" 的 "湖南"
  function matchDropdownOption(optText, remaining) {
    const t = (optText || '').trim();
    if (!t || !remaining) return 0;
    if (t === remaining) return remaining.length;
    const base = t.replace(/(自治区|特别行政区|自治州|省|市|地区|盟|县|区)$/, '');
    if (base && base === remaining) return remaining.length;
    if (remaining.startsWith(base)) return base.length;
    if (base.startsWith(remaining)) return remaining.length;
    return 0;
  }

  // 取元素中心的真实可点元素（部分框架的点击处理器在内部子元素上，点外层容器不生效）
  function centerOf(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return t && (t === el || el.contains(t)) ? t : null;
  }

  // 通用日期选择器填充
  async function fillGenericDatepicker(el, value) {
    const input = el.querySelector('input') || el;
    input.click();
    input.focus();
    await sleep(250);

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(100);
    document.body.click();
  }

  // ===== 高亮 =====
  function highlightField(el) {
    const target = el.closest('[class*="select"], [class*="input"], [class*="picker"], [class*="field"]') || el;
    const orig = target.style.boxShadow;
    target.style.boxShadow = '0 0 0 2px rgba(82, 196, 26, 0.5)';
    target.style.transition = 'box-shadow 0.3s';
    setTimeout(() => { target.style.boxShadow = orig; }, 2000);
  }

  // ===== 撤回（恢复原值） =====
  async function undoFill(btn) {
    const total = filledFields.length;
    for (let i = 0; i < filledFields.length; i++) {
      const { selector, originalValue, componentType } = filledFields[i];
      const el = findElement(selector);
      if (el) {
        try { await fillByType(el, originalValue || '', componentType); } catch {}
      }
      if (btn) updateButtonText(btn, `撤回中 ${i + 1}/${total}`, 'loading');
    }
    filledFields = [];
    if (btn) updateButtonText(btn, '自动填充', '');
  }

  // ===== 工具函数 =====
  function findElement(selector) {
    try { return document.querySelector(selector); } catch { return null; }
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function isVisible(el) {
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function getProfile() {
    return new Promise(resolve => {
      chrome.storage.local.get(null, result => {
        resolve({
          basic: result.basic || {},
          education: result.education || [],
          work: result.work || [],
          projects: result.projects || [],
          languages: result.languages || '',
          certificates: result.certificates || '',
          skills: result.skills || '',
          jobIntention: result.jobIntention || {},
          selfEvaluation: result.selfEvaluation || ''
        });
      });
    });
  }

  // ===== 按需显示：检测 + SPA 复查 =====
  function debounce(fn, delay) {
    let timer = null;
    const wrapped = () => {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
  }

  let observer = null;
  let debouncedCheck = null;
  let giveUpTimer = null;

  function tryShow() {
    if (document.getElementById('resume-autofill-btn')) return true;
    if (isResumePage()) {
      createFloatingButton();
      teardown();
      return true;
    }
    return false;
  }

  function onMutations() { debouncedCheck(); }

  function onRouteChange() {
    debouncedCheck.cancel();
    tryShow();
  }

  function armObserver() {
    teardown();
    debouncedCheck = debounce(tryShow, 1200);
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('hashchange', onRouteChange);
    // 60 秒内未识别则停止观察，避免巨型页面无限扫描
    giveUpTimer = setTimeout(() => {
      if (observer) { observer.disconnect(); observer = null; }
    }, 60000);
  }

  function teardown() {
    if (observer) { observer.disconnect(); observer = null; }
    if (debouncedCheck) debouncedCheck.cancel();
    if (giveUpTimer) clearTimeout(giveUpTimer);
    window.removeEventListener('popstate', onRouteChange);
    window.removeEventListener('hashchange', onRouteChange);
  }

  function startDetection() {
    if (!tryShow()) armObserver();
  }

  // ===== 初始化 =====
  startDetection();
})();
