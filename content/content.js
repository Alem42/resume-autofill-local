// Content Script - 通用字段采集 + 智能填充 + 浮动按钮
// 策略：行为驱动检测，不依赖特定 UI 框架类名

(function () {
  'use strict';

  if (document.getElementById('resume-autofill-btn')) return;

  let running = false;               // 重入保护：填充异步期间忽略重复点击

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
        updateButtonText(btn, `已填充 ${count}/${fields.length} 个字段`, '');
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
        if (hasDropdownBehavior(el)) return 'custom-dropdown';
        // 只读但无任何行为信号：仍是自定义组件，标记为可交互类型，填充时打开面板探测
        return 'custom-interactive';
      }
      // 非只读 input 也可能是自定义组件（如 Moka sd-Select 内部 input 非 readonly）：
      // placecholder="请选择" 或容器含 select/dropdown 关键词 → 自定义下拉；
      // picker-addon 子元素或日期占位符 → 自定义日期选择器（日期优先判，避免被下拉的 picker 关键词劫持）
      if (hasDatepickerBehavior(el)) return 'custom-datepicker';
      if (hasDropdownBehavior(el)) return 'custom-dropdown';
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
    // 类名中的通用模式（匹配任何框架）—— 子串匹配，不用 \b 词边界：
    // CSS Modules / hash 类名用 _ 或 - 分隔（如 sd-Select-container、date_info），
    // \b 会把 _ 当单词字符 → \bselect\b 漏掉 sd_Select
    const cls = (typeof el.className === 'string') ? el.className : '';
    if (el.tagName.toLowerCase() !== 'select' && /select|dropdown|combo|picker|cascader/i.test(cls)) return true;
    // 自身不匹配时检查最近祖先容器（如 Moka input 在 sd-Select-container 内，自身类名不含 select）
    const anc = el.closest('[class*="select"], [class*="picker"], [class*="dropdown"], [class*="cascader"], [role="combobox"]');
    if (anc) return true;
    // placeholder 信号："请选择" 强烈暗示为下拉
    if ((el.placeholder || '').includes('请选择')) return true;
    // 有展开状态的元素
    if (el.getAttribute('aria-expanded') !== null) return true;
    return false;
  }

  // 通用日期选择器行为检测
  // 注：不用 \b 词边界，因为 date_info / sd-picker-addon 等 _ 和 - 都是 word 字符，
  // \b 会漏掉这些模式。用宽松子串匹配，但必须与 readonly / date 占位符 / picker-addon
  // 子元素联合使用，避免将普通输入框误判为日期选择器（detectComponentType 做最终裁决）
  function hasDatepickerBehavior(el) {
    const cls = (typeof el.className === 'string') ? el.className : '';
    // 自身类名含强日期信号（不用裸 date/picker，避免 candidate/updated/select 误判）
    if (/datepicker|date-picker|date_info|calendar|picker-addon|日历|时间选择/i.test(cls)) return true;
    // 子元素含 picker-addon / calendar / datepicker 图标（如 Moka sd-picker-addon）
    if (el.querySelector('[class*="picker-addon"], [class*="calendar"], [class*="datepicker"], [class*="date-picker"]')) return true;
    // placeholder 含强日期信号（只用出生/生日/birth/年月，不用裸"日期"/"时间"
    // 避免"更新日期""发布时间"等纯文本输入框误判）
    const ph = (el.placeholder || '').toLowerCase();
    if (/出生|生日|birth|年\s*月/.test(ph) && ph.length > 0) return true;
    // 容器类名含强日期模式（如 month-range-select date_info）
    const anc = el.closest('[class*="datepicker"], [class*="date-picker"], [class*="date_info"], [class*="calendar"], [class*="picker-addon"]');
    if (anc) return true;
    // 内含 input 且自身类名含 date/time（保留原有，放宽正则）
    if (el.querySelector('input') && /date|time/i.test(cls)) return true;
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

    // 弱字段过滤：只有 contextText 且无可选项的字段最弱（多为卡片标题/装饰 div 噪声），
    // 丢弃降噪；带 options 的 contextText-only 几乎必是真下拉/单选，保留。
    // 有 label/placeholder/name 的强信号字段一律保留。
    const hasStrong = field.label || field.placeholder || field.name;
    const hasOptions = field.options && field.options.length > 0;
    if (hasStrong || (field.contextText && hasOptions)) fields.push(field);
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
    // 兜底：从菜单容器内采集叶子文本节点（如 Moka sd-Select-menu 裸 span 无 role/class）
    const menuContainers = containerEl.querySelectorAll('[class*="menu"], [class*="select"] [class*="menu"], [class*="dropdown"]');
    for (const menu of menuContainers) {
      const leaves = menu.querySelectorAll('*');
      const texts = new Set();
      for (const leaf of leaves) {
        // 跳过装饰性元素（箭头/图标/空元素）和含子元素的容器
        if (leaf.children.length > 0) continue;
        if (/arrow|icon|caret|clear|close|remove/i.test((typeof leaf.className === 'string' ? leaf.className : '') || '')) continue;
        const text = (leaf.textContent || '').trim();
        if (text && text.length > 0 && text.length < 50) texts.add(text);
      }
      if (texts.size > 0) return Array.from(texts);
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

    // 单个可见字段（如语言/技能的 textarea）：不是多块结构，按行数补块会凭空新建输入框 → 标记不可扩容
    if (visible.length === 1) return -1;

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
      const existing = countBlocksInSection(section);
      if (existing < 0) continue;                                 // 单输入区块（textarea）不可扩容
      const toAdd = Math.max(0, want - existing);                 // 页面已有块数的差额
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

    // name 快捷路径仅在页面唯一匹配时使用：同名重复字段（多区块表单）会被
    // document.querySelector 统一命中第一个元素 → 后续条目的值写错位置。不唯一时
    // 回退到带 nth-of-type 的完整路径（nth-of-type 按位置定位，天然唯一）
    if (el.name) {
      const sel = `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
      try {
        if (document.querySelectorAll(sel).length <= 1) return sel;
      } catch {
        return sel;
      }
    }

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

  // 日期值 → 可比较数字（2026-06 → 202606），用于按值倒序排日期字段
  function dateSortKey(v) {
    const m = /^(\d{4})[-\/.](\d{1,2})?/.exec(String(v || '').trim());
    if (!m) return 0;
    return parseInt(m[1] + (m[2] ? String(+m[2]).padStart(2, '0') : '00'), 10);
  }

  // ===== 填充执行 =====
  async function executeFill(mappings, onProgress) {
    let count = 0;
    const total = mappings.length;

    // 日期对（起止时间）先填结束、后填开始：B 站校验"起始时间不能晚于结束时间"，
    // 页面上旧结束时间早于新开始时，先填开始会被拒、回退到旧值（实测 2026-06→2025-06）。
    // 日期字段按值倒序放到最后处理（不依赖 LLM 返回顺序）：每对结束在前、开始在后，
    // 且简历里 start ≤ end 保证都通过
    const rest = [];
    const dates = [];
    for (const m of mappings) {
      if (m.componentType === 'custom-datepicker') dates.push(m);
      else rest.push(m);
    }
    const ordered = rest.concat(dates.sort((a, b) => dateSortKey(b.value) - dateSortKey(a.value)));

    for (let i = 0; i < ordered.length; i++) {
      const mapping = ordered[i];
      // 防御：LLM 返回空值时跳过，避免填充空字段
      if (mapping.value === null || mapping.value === undefined || mapping.value === '') {
        if (onProgress) onProgress(i + 1, total);
        continue;
      }
      const el = findElement(mapping.selector);
      if (!el) {
        console.log('[简历填充] 未找到元素:', mapping.selector, mapping.componentType, '值:', mapping.value);
        if (onProgress) onProgress(i + 1, total);
        continue;
      }

      const value = String(mapping.value);
      const componentType = mapping.componentType || detectComponentType(el);

      try {
        await fillByType(el, value, componentType, mapping.selector);
        highlightField(el);
        count++;
      } catch (e) {
        console.warn('[简历填充] 填充失败:', mapping.selector, componentType, '值:', value, e);
      }
      if (onProgress) onProgress(i + 1, total);
      await sleep(150);
    }

    // 兜底清理：关闭可能残留的下拉/日期面板
    await closeAllPanels();
    return count;
  }

  async function fillByType(el, value, componentType, selector) {
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
      case 'custom-interactive':
        // 只读但无法预先判类型：先当自定义下拉尝试（最常见），失败则当日期
        await fillGenericDropdown(el, value);
        break;
      case 'custom-datepicker':
        await fillGenericDatepicker(el, value, selector);
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
    let v = String(value);
    // 原生 date 输入框只接受 YYYY-MM-DD：简历常见 YYYY-MM，补 "-01" 避免被浏览器置空
    if (el.tagName.toLowerCase() === 'input' && el.type === 'date' && /^\d{4}-\d{1,2}$/.test(v)) v += '-01';
    const proto = el.tagName.toLowerCase() === 'textarea'
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, v); else el.value = v;
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

  // 读取自定义下拉字段当前已选中的显示值（如 Moka .sd-Input-display-value-* span）
  function getDropdownDisplayValue(el) {
    if (el && el.closest) {
      const container = el.closest('label[class*="Select-container"], [class*="sd-Select-container"], label');
      if (container) {
        const dv = container.querySelector('[class*="display-value"], [class*="selection-item"], [class*="selected"], [class*="value"]');
        if (dv) {
          const t = dv.textContent.trim();
          if (t) return t;
        }
      }
    }
    return '';
  }

  // 安全点击选项：尝试目标→父→祖父，某些框架（如 Moka）点击处理器挂在
  // 选项的父元素上，直接点叶子 span 不生效。点击后等 250ms 验证值变化：
  // （1）input.value 变化（ant/B站/v-model 控件），或
  // （2）字段容器内显示值 span 文本变化（Moka 等自定义组件，input.value 不变）
  async function clickOptionWithRetryAsync(el, input, targetText) {
    const beforeValue = input ? String(input.value || '').trim() : '';
    const beforeDisplay = getDropdownDisplayValue(input);
    for (let target = el, i = 0; i < 4 && target && target !== document.body; i++, target = target.parentElement) {
      if (typeof target.click !== 'function') continue;
      target.click();
      await sleep(250);
      const afterValue = input ? String(input.value || '').trim() : '';
      if (afterValue !== beforeValue) return true;
      const afterDisplay = getDropdownDisplayValue(input);
      if (afterDisplay && afterDisplay !== beforeDisplay) return true;
    }
    return false;
  }

  // 全文档扫描：在面板打开后，收集所有"新出现"的可见文本叶子节点作为候选选项
  // 不依赖 option/role/class 名，适用于 CSS Modules / hash 类名的自定义组件库
  function collectVisibleOptionCandidates(excludeSet, triggerEl, fieldEl) {
    const candidates = [];
    const triggerRect = triggerEl ? triggerEl.getBoundingClientRect() : null;
    for (const el of document.querySelectorAll('*')) {
      if (excludeSet.has(el)) continue;
      if (!isVisible(el)) continue;
      if (el.contains(triggerEl)) continue;
      if (fieldEl && fieldEl.contains(el)) continue;
      if (el.closest('#resume-autofill-btn')) continue;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') continue;
      const cls = (typeof el.className === 'string') ? el.className : '';
      if (/arrow|icon|caret|suffix|prefix|clear|close|remove/.test(cls)) continue;
      const text = (el.textContent || '').trim();
      if (text.length < 1 || text.length > 30) continue;
      // leaf-ish: 无子元素，或所有子元素自身都无文本（只有图标/装饰等）
      if (el.children.length > 0) {
        const allEmpty = Array.from(el.children).every(c => !(c.textContent || '').trim());
        if (!allEmpty) continue;
      }
      // 就近过滤：候选必须离触发输入框不太远（~600px 纵向 / ~400px 横向），
      // 避免点到远距离的页面文本（lazy-load 内容、导航等非面板元素）
      if (triggerRect) {
        const cr = el.getBoundingClientRect();
        if (cr.width <= 0 || cr.height <= 0) continue;
        if (Math.abs(cr.top - (triggerRect.top + triggerRect.height / 2)) > 600) continue;
        if (Math.abs(cr.left - (triggerRect.left + triggerRect.width / 2)) > 400) continue;
      }
      candidates.push(el);
    }
    return candidates;
  }

  // 通用下拉框填充（Ant Design / Element / Arco / 任意自定义下拉；支持省/市级联逐级选择）
  async function fillGenericDropdown(el, value) {
    const v = String(value || '').trim();

    // 1. 记录打开前已可见的选项（属于其他已打开的面板），避免误点；
    //    只排除"打开前就可见"的，隐藏后由本次打开显示的面板选项不会被误排除
    const optionSelectors = [
      '[role="option"]', '[class*="option"]', '[class*="dropdown-item"]',
      '[class*="select-item"]', '[class*="menu-item"]', 'li[class*="item"]',
      // 菜单容器内叶子节点（泛用兜底：Moka sd-Select-menu 裸 span 无 role/class）
      '[class*="select"] [class*="menu"] > *:not([class*="arrow"]):not([class*="icon"])',
      '[class*="dropdown"] [class*="menu"] > *:not([class*="arrow"]):not([class*="icon"])',
      '[class*="menu"] > li', '[class*="menu"] > div[role="none"]'
    ].join(',');
    const visibleBefore = new Set(Array.from(document.querySelectorAll(optionSelectors)).filter(isVisible));

    // 2. 点击打开下拉：类名优先（ant 是 selection、arco 是 select-view），
    //    再用 elementFromPoint 命中中央真正可点的元素——点外层容器可能不触发内部处理器
    let trigger = el.querySelector('[class*="selector"], [class*="selection"], [class*="select-view"], [class*="input"], [class*="trigger"]') || centerOf(el) || el;
    if (!trigger || typeof trigger.click !== 'function') trigger = el;   // SVG/非标准元素没有 click → 退回外层
    // Moka 等 React 自定义下拉通过 onMouseDown 打开面板，仅 click() 不触发；
    // dispatch mousedown 在 click 之前，对 ant/B站 无害（额外事件会被忽略）
    if (trigger && typeof trigger.dispatchEvent === 'function') {
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
    // 部分框架的 mousedown handler 挂在 INPUT 自身而非外层容器，且 trigger 可能
    // 是 outer container 而非 INPUT → 若 el 是 INPUT 且与 trigger 不同，也对 el 派发 mousedown
    if (el !== trigger && el.tagName === 'INPUT' && typeof el.dispatchEvent === 'function') {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
    trigger.click();
    await sleep(350);

    // 显式聚焦输入框：程序化 click 不会聚焦，而部分框架（B 站）忽略文档级合成事件、
    // 只响应输入框自身的 blur/Escape 收面板 → 让 activeElement 落在输入框上，收起机制才能命中
    const focusInput = el.tagName === 'INPUT' ? el : (el.querySelector('input') || el);
    if (focusInput && typeof focusInput.focus === 'function') focusInput.focus();

    // 3. 搜索框：仅地点类值（含 省/市 等区划词）才用，且只搜第一段，避免整值搜空把选项过滤掉
    const searchInput = el.querySelector('input[class*="search"], input[class*="filter"]') ||
                        el.querySelector('input:not([type="hidden"]):not([readonly])');
    if (searchInput && searchInput.offsetParent !== null && /(省|市|自治区|特别行政区|自治州|地区|盟|县|区)/.test(v)) {
      const searchText = placeFirstSegment(v);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(searchInput, searchText); else searchInput.value = searchText;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(350);
    }

    // 4. 逐级匹配：整值/片段精确优先，省→市逐级消费（级联选择器）；最多 6 级防死循环
    let remaining = v;
    let clickedAny = false;
    for (let guard = 0; guard < 6 && remaining; guard++) {
      // 双源采集：类名选择器（传统） + 全文档树叶扫描（泛用，含 Moka 裸 span）
      const classOpts = Array.from(document.querySelectorAll(optionSelectors))
        .filter(o => !visibleBefore.has(o))
        .filter(isVisible)
        .filter(o => {
          const oc = (typeof o.className === 'string') ? o.className : '';
          if (/arrow|icon|caret|clear|close|remove/.test(oc)) return false;
          if ((o.textContent || '').trim().length === 0) return false;
          if (o.contains(el) || el.contains(o)) return false;
          return true;
        });
      const leafOpts = collectVisibleOptionCandidates(visibleBefore, trigger, el);
      // 去重合并（按元素引用）
      const seen = new Set(classOpts);
      for (const lo of leafOpts) { if (!seen.has(lo)) { classOpts.push(lo); seen.add(lo); } }
      const opts = classOpts;

      if (opts.length === 0) break;

      let best = null, bestLen = 0;
      for (const o of opts) {
        const len = matchDropdownOption(o.textContent, remaining);
        if (len === 0) continue;
        const t = (o.textContent || '').trim();
        const isExact = t === remaining;
        if (!best) { best = o; bestLen = len; continue; }
        if (len > bestLen) { best = o; bestLen = len; continue; }
        if (len === bestLen) {
          // 同分时：精确匹配优先；都是精确/都是包含时，文本短的优先（"男" < "男女"容器文本）
          const curIsExact = (best.textContent || '').trim() === remaining;
          if (isExact && !curIsExact) { best = o; continue; }
          if (isExact === curIsExact && t.length < (best.textContent || '').trim().length) { best = o; }
        }
      }
      if (!best || bestLen === 0) break;        // 本级无可匹配项

      // 收集候选点击链：裸叶子 → 逐级祖先（最多6层），优先含 option/item/label 关键字的中间层。
      // Moka 的 React 点击处理器挂在 option-label-*/item 类中间容器上，不在裸 span 也不在最近3层祖先上
      const clickChain = [best];
      for (let p = best.parentElement, i = 0; p && p !== document.body && i < 6; i++, p = p.parentElement) {
        const pc = (typeof p.className === 'string') ? p.className.trim() : '';
        const tag = p.tagName.toLowerCase();
        const isTarget = /option|item|label|cell|row|menu|common-item|select-item/.test(pc) ||
                         tag === 'li' || tag === 'button' || p.getAttribute('role') === 'option';
        if (isTarget) clickChain.push(p);
      }
      let clicked = false;
      for (const cand of clickChain) {
        clicked = await clickOptionWithRetryAsync(cand, el, remaining);
        if (clicked) break;
      }
      if (!clicked) break;        // 选项点击未生效（值未变化）
      clickedAny = true;

      if (bestLen >= remaining.length) break;   // 值已全部选中
      // 消费本级后，跳过残留的区划后缀/分隔符："湖南省长沙市" 消费"湖南"后剩"省长沙市" → 清成"长沙市"
      remaining = remaining.slice(bestLen).replace(/^[省市自治州盟县区\/、\s，,]+/, '');
      await sleep(200);                         // 等下一级渲染
    }

    // 收尾：主动收起面板。部分框架忽略合成事件导致面板残留（B 站实测不关），
    // 用多层机制（Escape/blur/文档 mousedown/body click）+ 检测重试，确认面板消失
    if (clickedAny) await sleep(120);   // 等框架处理完选中事件
    await closeOpenPanel(el, trigger);
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
    // 包含匹配兜底（最后一级）："硕士（统招）"↔"硕士"、"湖南长沙"↔"湖南省"
    if (remaining.length >= 2 && t.length >= 2) {
      // 先剥掉选项末尾的括号注解（（统招）/（全职）/...），避免干扰
      const cleanT = t.replace(/[（(][^）)]*[）)]$/, '').trim();
      if (cleanT && remaining.includes(cleanT)) return cleanT.length;
      if (cleanT && cleanT.includes(remaining)) return remaining.length;
      if (t.includes(remaining) && t.length <= remaining.length + 1) return remaining.length;
      if (remaining.includes(t)) return t.length;
    }
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
  async function fillGenericDatepicker(el, value, selector) {
    const input = el.tagName === 'INPUT' ? el : (el.querySelector('input') || el);
    // 优先：ant-design-vue 日历点选。readonly + controlled 的 DatePicker 直接 setter 赋值 + Enter
    // 不生效（实测：面板打开时赋值会被忽略，值回退为空），必须点日历格子真正选中
    const ok = await selectDateInCalendar(input, value, selector);
    if (ok) {
      // 已确认提交 → 用 Escape-first 可靠关闭面板（protect 的非破坏性关闭在 B 站不保证生效，
      // 残留面板会污染下一个日期字段的日历点选）
      await closeOpenPanel(el, el, false);
      return;
    }
    // 次要：泛用年月网格日期选择器（如 Moka 自研组件，面板含 "N年" + 月份网格）
    const genericOk = await selectDateInGenericPicker(input, value, selector);
    if (genericOk) {
      await closeOpenPanel(el, el, false);
      return;
    }
    // 兜底：先可靠关掉面板，再赋值 + Enter（ant readonly 上多不生效，但非 ant 控件可用）
    await closeOpenPanel(el, el, false);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(120);
    input.blur();
    await closeOpenPanel(el, el, true);
  }

  // ===== ant-design-vue DatePicker 日历点选 =====
  // 点击输入框打开日历面板 → 年份面板选年（跨 decade 自动翻页）→ 月份面板按月序号选月 →
  // 点目标日期格子（当前月、按天数匹配，与语言无关）。
  // 导航失败（面板找到但点选中途失败，多为过渡/时序）会清理现场后重试；
  // 根本没弹面板（非 ant 控件）不重试，直接走回退赋值。
  async function selectDateInCalendar(input, value, selector) {
    const m = /^(\d{4})[-\/.](\d{1,2})(?:[-\/.](\d{1,2}))?/.exec(String(value || '').trim());
    if (!m) return false;
    const year = +m[1], month = +m[2], day = m[3] ? +m[3] : 1;

    // ant 输入框（.ant-calendar-picker 内）首次打开面板可能较慢 → 无面板也重试；
    // 非 ant 控件（根本不是 ant 日历）返回 false 不重试，直接走回退赋值
    const isAnt = !!input.closest('.ant-calendar-picker');
    for (let attempt = 0; attempt < 3; attempt++) {
      // Vue 重渲染可能替换输入框节点（提交一次值后列表重排）→ 每次尝试前按 selector 重查，
      // 否则点的是 detached 旧引用，面板打不开（B 站 2026-06 实测卡在这）
      if (selector) {
        const fresh = findElement(selector);
        // selector 可能指向容器（采集时未解包）→ 重查后同样解包成内部 input
        if (fresh) input = fresh.tagName === 'INPUT' ? fresh : (fresh.querySelector('input') || fresh);
      }
      const r = await trySelectDate(input, year, month, day);
      if (r === true) {
        // 提交后校验：B 站 Vue 重渲染慢时月份点击会用旧年份提交（实测差一年），
        // 年份不符则当失败重试（第二次面板已热，通常能对上）
        const val = String(input.value || '').trim();
        if (/^\d{4}/.test(val) && parseInt(val.slice(0, 4), 10) === year) return true;
        console.warn('[简历填充] 日期年份不符，重试:', value, '→', input.value);
      } else if (r === false && !isAnt) {
        return false;   // 非 ant，重试无意义
      }
      // 清理现场后重试：必须用 Escape-on-input 可靠关掉残留面板
      // （B 站忽略 document 级合成事件，直接用 body mousedown/Escape 关不掉，
      //   下次 input.click() 会把还开着的面板 toggle 关掉 → 找不到面板）
      await closeOpenPanel(input, input, false);
      await sleep(200);
    }
    return false;
  }

  // 单次日历点选；返回 true / false（无面板）/ 'nav-failed'（面板在但导航中断）
  async function trySelectDate(input, year, month, day) {
    input.click();
    input.focus();
    await sleep(400);
    let panel = findOpenCalendarNear(input);
    if (!panel) return false;

    // 读当前显示年份：近距离（±6 年内且非同年）用"上一年/下一年"按钮直接跳——
    // 避免年份面板导航的竞态（B 站实测偶发选错年，如 2025-05 被选成 2026）；
    // 同年或远距离（如 2002）走年份面板（同年的面板流程已验证可用）
    const curYearEl = panel.querySelector('.ant-calendar-year-select');
    const curYear = curYearEl ? parseInt(curYearEl.textContent.trim(), 10) : NaN;
    const diff = isNaN(curYear) ? NaN : year - curYear;
    if (!isNaN(diff) && diff !== 0 && Math.abs(diff) <= 6) {
      const stepBtn = panel.querySelector(diff > 0 ? '.ant-calendar-next-year-btn' : '.ant-calendar-prev-year-btn');
      if (!stepBtn) return 'nav-failed';
      for (let i = 0; i < Math.abs(diff); i++) {
        stepBtn.click();
        await sleep(120);
      }
    } else {
      const yearBtn = panel.querySelector('.ant-calendar-year-select');
      if (!yearBtn) return 'nav-failed';
      yearBtn.click();
      await sleep(400);
      panel = findOpenCalendarNear(input);
      if (!panel) return 'nav-failed';
      let yCell = findYearCell(panel, year);
      for (let i = 0; i < 8 && !yCell; i++) {
        const years = Array.from(panel.querySelectorAll('.ant-calendar-year-panel-year'))
          .map(y => parseInt(y.textContent.trim(), 10)).filter(n => !isNaN(n));
        if (!years.length) return 'nav-failed';
        const first = Math.min(...years);
        const btn = panel.querySelector(year < first ? '.ant-calendar-year-panel-prev-decade-btn' : '.ant-calendar-year-panel-next-decade-btn');
        if (!btn) return 'nav-failed';
        btn.click();
        await sleep(300);
        panel = findOpenCalendarNear(input);
        if (!panel) return 'nav-failed';
        yCell = findYearCell(panel, year);
      }
      if (!yCell) return 'nav-failed';
      yCell.click();
      // B 站 Vue 重渲染较慢：选完年后等久一点，再切回月份网格，降低"用旧年份提交"的竞态
      await sleep(500);
    }

    // 月份面板（按月序号匹配，避免语言差异）。
    // 注意：月份选择器（mode=month / MonthPicker，B 站起止时间即是）选完年份后
    // 面板仍停在年份视图，必须再点 month-select 切回月份网格；普通日期选择器同理打开月份面板
    panel = findOpenCalendarNear(input);
    if (!panel) return 'nav-failed';
    const monthBtn = panel.querySelector('.ant-calendar-month-select');
    if (!monthBtn) return 'nav-failed';
    monthBtn.click();
    await sleep(500);
    panel = findOpenCalendarNear(input);
    if (!panel) return 'nav-failed';
    const mCell = Array.from(panel.querySelectorAll('.ant-calendar-month-panel-month'))[month - 1];
    if (!mCell) return 'nav-failed';
    mCell.click();
    await sleep(350);

    // 月份模式：点完月份即提交，无日期格子；日期模式：面板切到日视图，再点目标天
    panel = findOpenCalendarNear(input);
    if (panel && panel.querySelector('.ant-calendar-date-panel, .ant-calendar-date')) {
      const dCell = Array.from(panel.querySelectorAll('.ant-calendar-cell:not(.ant-calendar-last-month-cell):not(.ant-calendar-next-month-cell)'))
        .find(td => {
          const d = td.querySelector('.ant-calendar-date');
          return d && d.textContent.trim() === String(day);
        });
      if (!dCell) return 'nav-failed';
      dCell.querySelector('.ant-calendar-date').click();
      await sleep(150);
    }
    return true;
  }

  // 打开中的 ant 日历面板（portal 在 body 下）。
  // 优先取紧邻输入框的；找不到则退回任意可见面板——面板可能开在输入框上方
  // （字段在视口底部时朝上弹出），严格按位置找会漏。忽略 opacity（过渡中会为 0）。
  function findOpenCalendarNear(el) {
    const r = el.getBoundingClientRect();
    let anyVisible = null;
    for (const node of document.querySelectorAll('.ant-calendar-picker-panel, .ant-calendar')) {
      const s = getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const pr = node.getBoundingClientRect();
      if (pr.width <= 0 || pr.height <= 0) continue;
      if (!anyVisible) anyVisible = node;
      if (pr.left < r.right + 400 && pr.right > r.left - 400 &&
          pr.top >= r.top - 400 && pr.top <= r.bottom + 900) return node;
    }
    return anyVisible;
  }

  function findYearCell(panel, year) {
    const cells = panel.querySelectorAll('.ant-calendar-year-panel-year');
    for (const c of cells) if (c.textContent.trim() === String(year)) return c;
    return null;
  }

  // ===== 泛用年月网格日期选择器（非 ant 自定义组件，如 Moka） =====
  // 策略：打开面板 → 找到 "{year}年" 元素点选年份 → 找到中文月份（一月..十二月）点选 →
  // 验证输入值年份正确。最多重试 3 次。

  // 在输入框附近找任意可见面板（使用 PANEL_SELECTORS 泛用模式，不限于 ant calendar）
  function findOpenGenericPanelNear(el) {
    const r = el.getBoundingClientRect();
    let best = null;
    for (const node of document.querySelectorAll(PANEL_SELECTORS)) {
      if (!isVisible(node)) continue;
      if (node.contains(el)) continue;
      const pr = node.getBoundingClientRect();
      if (pr.width <= 0 || pr.height <= 0) continue;
      if (pr.left < r.right + 450 && pr.right > r.left - 450 &&
          pr.top >= r.top - 650 && pr.top <= r.bottom + 650) {
        const dist = Math.abs(pr.top - r.bottom) + Math.abs(pr.left - r.left);
        if (!best || dist < best._dist) { best = node; best._dist = dist; }
      }
    }
    return best;
  }

  // 在面板内找文本精确匹配的可点击叶子节点（优先精确匹配，兜底包含匹配）
  function findTextInPanel(panel, text) {
    const all = panel.querySelectorAll('*');
    let best = null;
    for (const el of all) {
      const t = (el.textContent || '').trim();
      if (!t || t.length > 20) continue;
      if (!isVisible(el)) continue;
      if (t === text) return el;
      if (!best && t.includes(text) && el.children.length === 0) best = el;
    }
    return best;
  }

  async function selectDateInGenericPicker(input, value, selector) {
    const m = /^(\d{4})[-\/.](\d{1,2})(?:[-\/.](\d{1,2}))?/.exec(String(value || '').trim());
    if (!m) return false;
    const year = +m[1], month = +m[2];
    const YEAR_MONTHS = ['', '一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

    for (let attempt = 0; attempt < 3; attempt++) {
      if (selector) {
        const fresh = findElement(selector);
        if (fresh) input = fresh.tagName === 'INPUT' ? fresh : (fresh.querySelector('input') || fresh);
      }

      // 打开面板：click + focus，也尝试点 addon/picker 图标
      input.click();
      input.focus();
      await sleep(400);
      let panel = findOpenGenericPanelNear(input);
      if (!panel) {
        const addon = input.parentElement && input.parentElement.querySelector('[class*="picker"], [class*="calendar"], [class*="addon"]');
        if (addon) { addon.click(); await sleep(400); }
        panel = findOpenGenericPanelNear(input);
      }
      if (!panel) return false;

      // 点选年份：找文本精确为 "{year}年" 的元素
      const yearEl = findTextInPanel(panel, year + '年');
      if (!yearEl) { await closeOpenPanel(input, input, false); await sleep(150); continue; }
      yearEl.click();
      await sleep(350);

      // 年份点击后重查面板（可能面板内容已切换）
      panel = findOpenGenericPanelNear(input);
      if (!panel) { await closeOpenPanel(input, input, false); await sleep(150); continue; }

      // 点选月份：先试中文名，再试数字
      const targetMonth = YEAR_MONTHS[month] || '';
      let monthEl = targetMonth ? findTextInPanel(panel, targetMonth) : null;
      if (!monthEl) monthEl = findTextInPanel(panel, month + '月');
      if (!monthEl) { await closeOpenPanel(input, input, false); await sleep(150); continue; }
      monthEl.click();
      await sleep(250);

      // 验证输入值年份正确（Moka 填充后 input.value 会更新为 "1990-01" 之类）
      const val = String(input.value || '').trim();
      if (/^\d{4}/.test(val) && parseInt(val.slice(0, 4), 10) === year) return true;

      // 失败则关面板重试
      await closeOpenPanel(input, input, false);
      await sleep(200);
    }
    return false;
  }

  // ===== 面板收起（下拉/级联/日期共用） =====
  // 部分框架（尤其 B 站 ant-design-vue / bili-date）忽略 isTrusted=false 的合成事件，
  // 只发 document 级 mousedown/click 关不掉面板。因此：多层机制 + 确认重试。
  const PANEL_SELECTORS = [
    '[role="listbox"]', '[role="dialog"]',
    '[class*="dropdown-menu"]', '[class*="dropdown-content"]', '[class*="dropdown-list"]',
    '[class*="dropdown"]',
    '[class*="menus"]', '[class*="menu-list"]', '[class*="menu"]',
    '[class*="popup"]', '[class*="select-menu"]',
    '[class*="picker-panel"]', '[class*="calendar-panel"]', '[class*="calendar"]', '[class*="picker"]',
    '[class*="panel"]', '[class*="cascader-menu"]', '[class*="option-list"]',
    '[class*="overlay"]', '[class*="layer"]',
    '[class*="select"] [class*="menu"]'
  ].join(',');

  // 字段附近是否仍有打开的面板（宽松判断，仅用于确认收起；误报无害）
  function isPanelOpenNear(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    for (const node of document.querySelectorAll(PANEL_SELECTORS)) {
      if (!isVisible(node)) continue;
      // 跳过包含触发元素自身的节点（避免把字段容器误判为打开的面板）
      if (node.contains(el)) continue;
      const pr = node.getBoundingClientRect();
      const hOverlap = pr.left < r.right + 150 && pr.right > r.left - 150;
      const vNear = pr.top >= r.top - 120 && pr.top <= r.bottom + 600;
      if (hOverlap && vNear) return true;
    }
    return false;
  }

  // 发一轮收起事件。
  // 关键：多数框架（ant Select/DatePicker、bili-date）把 Escape 监听挂在输入框上，
  // 对输入框本身派发 Escape 不受 isTrusted 限制、也无需元素在焦点上。
  // withEscape=false 用于日期选择器首轮：Escape 会取消"Enter 刚确认的日期"，
  // 所以先只发非破坏性关闭（blur + 文档 mousedown/click），面板仍开着才升级 Escape
  function fireCloseEvents(el, trigger, withEscape) {
    // el/trigger 本身就是输入框时（日期选择器字段），直接用其作为 Escape/blur 目标——
    // 否则 querySelector('input') 返回 null，Escape 打不到输入框，面板关不掉（B 站实测）
    const asInput = node => node && node.tagName === 'INPUT' ? node : null;
    const inner = asInput(trigger) ||
                  (trigger && trigger.querySelector ? trigger.querySelector('input') : null) ||
                  asInput(el) ||
                  (el && el.querySelector ? el.querySelector('input') : null);
    if (withEscape) {
      if (inner) inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      const act = document.activeElement;
      if (act && act !== document.body && typeof act.blur === 'function') {
        act.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    }
    const act = document.activeElement;
    if (act && act !== document.body && typeof act.blur === 'function') act.blur();
    if (inner && inner !== document.activeElement) inner.blur();
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.body.click();
  }

  // 主动收起：下拉/级联直接命中 Escape（B 站 ant 忽略文档级事件，实测有效）；
  // protect=true（日期选择器）首轮不带 Escape，避免取消刚确认的日期
  async function closeOpenPanel(el, trigger, protect) {
    fireCloseEvents(el, trigger, !protect);
    await sleep(protect ? 150 : 120);
    for (let i = 0; i < 3 && isPanelOpenNear(el); i++) {
      fireCloseEvents(el, trigger, true);
      await sleep(150);
    }
  }

  // 兜底：填充结束后清理任何残留面板
  async function closeAllPanels() {
    for (let i = 0; i < 2; i++) {
      fireCloseEvents(null, null, i > 0);
      await sleep(100);
    }
  }

  // ===== 高亮 =====
  function highlightField(el) {
    const target = el.closest('[class*="select"], [class*="input"], [class*="picker"], [class*="field"]') || el;
    const orig = target.style.boxShadow;
    target.style.boxShadow = '0 0 0 2px rgba(82, 196, 26, 0.5)';
    target.style.transition = 'box-shadow 0.3s';
    setTimeout(() => { target.style.boxShadow = orig; }, 2000);
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
    // 跳过极小 iframe（广告/跟踪/埋点），避免在无意义帧内创建按钮
    if (window.innerWidth < 200 || window.innerHeight < 200) return false;
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
    // 只监听子节点增删，不监听属性：React/Vue 频繁改 class/style 会触发大量属性变更，
    // 导致非表单页面在 60 秒内反复做全页字段扫描（布局读取开销大）
    observer.observe(document.documentElement, { childList: true, subtree: true });
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
