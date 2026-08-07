// Background Script - LLM API 调用与消息中转

// 处理来自 content script 和 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FILL_FORM') {
    console.log('[简历填充] 收到请求，字段数:', message.fields?.length);
    handleFillForm(message.fields, message.profile)
      .then(result => {
        console.log('[简历填充] 成功，映射数:', result.mappings?.length);
        sendResponse(result);
      })
      .catch(err => {
        console.error('[简历填充] 失败:', err.message);
        sendResponse({ error: err.message });
      });
    return true; // 保持消息通道异步
  }

  if (message.type === 'PARSE_PDF') {
    handleParsePDF(message.text)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[简历填充] PDF解析失败:', err.message);
        sendResponse({ error: err.message });
      });
    return true;
  }

  if (message.type === 'TEST_LLM') {
    testLLMConnection(message.config)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// 获取 LLM 配置
async function getLLMConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(['llm'], result => {
      resolve(result.llm || {});
    });
  });
}

// 找到从 start 开始、括号配对的结束位置；找不到返回 -1
function matchBracket(text, start, openChar, closeChar) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === openChar) depth++;
    if (ch === closeChar) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// 从文本中提取完整 JSON（通过括号配对）
function extractJSON(text, openChar, closeChar) {
  const start = text.indexOf(openChar);
  if (start === -1) return null;
  const end = matchBracket(text, start, openChar, closeChar);
  return end === -1 ? null : text.slice(start, end + 1);
}

// 候选数组是否"长得像"填充映射：元素是含 value/fieldId/selector 的对象（排除正文里的 [1] 这类数字数组）
function looksLikeMappings(arr) {
  if (arr.length === 0) return true;
  return arr.every(el =>
    el && typeof el === 'object' && !Array.isArray(el) &&
    ('value' in el || 'fieldId' in el || 'selector' in el)
  );
}

// 解析 LLM 返回的 JSON 数组：兼容 markdown 代码块、{mappings:[...]} 包裹对象、单个对象、正文夹带括号
function parseLLMArray(text) {
  let t = text.trim();
  const fence = t.match(/```[a-z]*\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  // 依次尝试每个 '[' 起始位置，返回第一个"能解析且像映射数组"的（避免正文里先出现 [1] 这类括号噪声）
  let start = t.indexOf('[');
  while (start !== -1) {
    const end = matchBracket(t, start, '[', ']');
    if (end !== -1) {
      try {
        const parsed = JSON.parse(t.slice(start, end + 1));
        if (looksLikeMappings(parsed)) return parsed;
      } catch {}
    }
    start = t.indexOf('[', start + 1);
  }
  // 文本完全没有 '[' → 可能是单个对象 {fieldId,value} 或包裹对象；包成数组返回。
  // 注意：截断的数组（有 '[' 但括号不配对）不走到这里，会报错让用户重试，避免静默只填第一项
  if (!t.includes('[')) {
    const obj = extractJSON(t, '{', '}');
    if (obj) {
      try {
        const parsed = JSON.parse(obj);
        if (Array.isArray(parsed)) return parsed;
        for (const k of Object.keys(parsed)) {
          if (Array.isArray(parsed[k])) return parsed[k];
        }
        return [parsed];
      } catch {}
    }
  }
  return null;
}

// 解析 LLM 返回的 JSON 对象（兼容 markdown 代码块）
function parseLLMObject(text) {
  let t = text.trim();
  const fence = t.match(/```[a-z]*\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const obj = extractJSON(t, '{', '}');
  if (obj) {
    try { return JSON.parse(obj); } catch {}
  }
  return null;
}

// 调用 LLM API（带超时 + 重试）
async function callLLM(systemPrompt, userPrompt) {
  const config = await getLLMConfig();
  console.log('[简历填充] LLM 配置:', { baseUrl: config.baseUrl, model: config.model, hasKey: !!config.apiKey });

  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new Error('请先在扩展设置中配置 LLM 的 Base URL、API Key 和模型名称');
  }

  const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const TIMEOUT_MS = 30000; // 30秒超时
  const MAX_RETRIES = 3;
  // 不设 max_tokens：推理模型（r1/o1/reason/think）思考链会占满输出上限导致正文为空；
  // 之前不设上限是能正常出结果的。推理模型也不传 temperature（多数推理接口不支持）
  const isReasoning = /r1|o1|reason|think|thinking/i.test(config.model || '');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[简历填充] 第 ${attempt}/${MAX_RETRIES} 次请求`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const requestBody = {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      };
      if (!isReasoning) requestBody.temperature = 0.1;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text();
        // 4xx 客户端错误不重试（认证失败、参数错误等）；429 限流除外，可退避重试
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`API 返回 ${response.status}: ${errText.slice(0, 150)}`);
        }
        // 5xx 服务端错误 / 429 限流可重试
        throw new Error(`API 返回 ${response.status}`);
      }

      // 检查响应类型
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`API 返回了非 JSON 响应 (Content-Type: ${contentType})`);
      }

      const data = await response.json();
      if (!data.choices || !data.choices[0]) {
        throw new Error(`API 响应格式异常，缺少 choices 字段`);
      }
      const choice = data.choices[0];
      let content = choice.message && choice.message.content;
      // 兼容 content 为内容分片数组的格式
      if (Array.isArray(content)) {
        content = content.map(p => (p && typeof p === 'object' && p.text != null ? String(p.text) : '')).join('').trim();
      }
      const finishReason = choice.finish_reason || 'unknown';
      // 空内容：多为推理模型思考耗尽输出，或被内容过滤拦截
      if (content == null || String(content).trim() === '') {
        console.warn(`[简历填充] 模型返回空内容，finish_reason: ${finishReason}`);
        throw new Error(`模型返回内容为空（finish_reason: ${finishReason}），请检查模型配置或重试`);
      }
      console.log(`[简历填充] 模型响应: finish_reason=${finishReason}, 内容 ${String(content).length} 字符`);
      return String(content);

    } catch (err) {
      clearTimeout(timer);

      // 超时
      if (err.name === 'AbortError') {
        console.warn(`[简历填充] 第 ${attempt} 次请求超时 (${TIMEOUT_MS/1000}s)`);
        if (attempt === MAX_RETRIES) {
          throw new Error(`请求超时 (${TIMEOUT_MS/1000}s)，已重试 ${MAX_RETRIES} 次`);
        }
        continue;
      }

      // 网络错误可重试
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        console.warn(`[简历填充] 第 ${attempt} 次网络错误: ${err.message}`);
        if (attempt === MAX_RETRIES) {
          throw new Error(`网络连接失败，已重试 ${MAX_RETRIES} 次: ${err.message}`);
        }
        continue;
      }

      // 服务端错误 (5xx) / 限流 (429) 可重试
      if (err.message.includes('API 返回 5') || err.message.includes('API 返回 429')) {
        console.warn(`[简历填充] 第 ${attempt} 次服务端错误/限流: ${err.message}`);
        if (attempt === MAX_RETRIES) {
          throw new Error(`服务端错误/限流，已重试 ${MAX_RETRIES} 次: ${err.message}`);
        }
        // 等待后重试（指数退避）
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }

      // 其他错误（4xx 客户端错误、格式错误等）直接抛出，不重试
      throw err;
    }
  }
}

// 深度过滤空值：避免空字段（空字符串/空数组/空对象）被 LLM 看到后编造填充值
function omitEmpty(obj) {
  if (Array.isArray(obj)) {
    return obj.map(omitEmpty).filter(v => v !== '' && v != null && !(typeof v === 'object' && Object.keys(v).length === 0));
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      const cleaned = omitEmpty(v);
      if (cleaned === '' || cleaned == null) continue;
      if (typeof cleaned === 'object' && Object.keys(cleaned).length === 0) continue;
      result[k] = cleaned;
    }
    return result;
  }
  return obj;
}

// 处理智能填充请求
async function handleFillForm(fields, profile) {
  const systemPrompt = `你是一个简历表单填充助手。你的任务是根据用户的简历信息，为页面上的每个表单字段选择最合适的填充值。

规则：
1. 仔细分析每个字段的上下文信息（标签、占位符、name等），判断它需要哪类信息
2. 从用户简历中选择最匹配的值
3. 返回一个 JSON 数组，每个元素包含 {fieldId, value}
   - fieldId: 字段的 ID（与输入数据中"字段ID"完全一致，如 F0、F12）
   - value: 要填充的值（字符串）
4. 只有当用户简历中确实存在对应信息时才填充该字段。用户简历中为空的信息（字段缺失、空字符串、空数组），对应页面字段一律跳过，禁止从可选项或上下文推断、编造填充值
5. 对于有可选项的下拉框，仅当用户简历中的信息能在可选项中匹配到最接近的值时才选择；否则跳过
6. 宁缺毋滥：即使页面字段是必填项，只要用户简历没有对应信息，也要跳过，不要为了填满而填
7. 只返回 JSON 数组，不要返回任何其他文字或解释`;

  // 用简短字段ID代替长 CSS 选择器：提示词与响应体量都大幅缩小，显著加快识别
  const fieldById = new Map();
  const fieldsDesc = fields.map((f, i) => {
    fieldById.set('F' + i, f);
    const parts = [`字段ID: F${i}`];
    if (f.label) parts.push(`标签: ${f.label}`);
    if (f.placeholder) parts.push(`占位符: ${f.placeholder}`);
    if (f.name) parts.push(`name: ${f.name}`);
    if (f.contextText) parts.push(`上下文文本: ${f.contextText}`);
    if (f.options && f.options.length > 0) parts.push(`可选项: ${f.options.slice(0, 40).join(', ')}`);
    parts.push(`组件类型: ${f.componentType || f.tag || 'unknown'}`);
    return `{${parts.join('; ')}}`;
  }).join('\n');

  const profileDesc = JSON.stringify(omitEmpty(profile), null, 2);

  const userPrompt = `表单字段列表：
${fieldsDesc}

用户简历信息：
${profileDesc}

请为每个字段匹配最合适的用户信息，返回 JSON 数组。`;

  const responseText = await callLLM(systemPrompt, userPrompt);

  // 解析 LLM 返回的 JSON 数组（兼容 markdown 围栏、包裹对象、单个对象）
  const parsed = parseLLMArray(responseText);
  if (!parsed) {
    throw new Error(`LLM 返回格式异常，无法解析填充映射：${responseText.slice(0, 120)}`);
  }

  // 将 fieldId 还原为真实 selector，并沿用采集时的组件类型（比 LLM 回显更可靠）
  const mappings = parsed
    .filter(m => m && m.value !== null && m.value !== undefined && m.value !== '')
    .map(m => {
      let field = null;
      if (m.fieldId != null) {
        const raw = String(m.fieldId);
        field = fieldById.get(raw) || fieldById.get('F' + raw);
      }
      if (field) {
        return { selector: field.selector, value: String(m.value), componentType: field.componentType };
      }
      // 兼容个别模型不遵守约定、直接返回 selector 的情况
      if (m.selector) {
        return { selector: m.selector, value: String(m.value), componentType: m.componentType || undefined };
      }
      return null;
    })
    .filter(Boolean);
  return { mappings };
}

// 处理 PDF 解析请求
async function handleParsePDF(pdfText) {
  const systemPrompt = `你是一个简历信息提取助手。请从提供的简历文本中提取结构化信息，返回严格的 JSON 格式。

返回格式：
{
  "basic": {
    "name": "姓名",
    "gender": "性别",
    "birthday": "出生日期",
    "phone": "手机号",
    "email": "邮箱",
    "location": "所在城市/现居住地",
    "hukou": "户籍所在地",
    "nativePlace": "籍贯",
    "ethnicity": "民族",
    "political": "政治面貌",
    "marital": "婚姻状况",
    "workYears": "工作年限",
    "availableDate": "到岗时间",
    "jobStatus": "求职状态",
    "currentSalary": "当前薪资",
    "address": "详细地址",
    "website": "个人网站",
    "github": "GitHub地址",
    "wechat": "微信号",
    "idCard": "身份证号",
    "height": "身高(cm)",
    "weight": "体重(kg)",
    "emergencyName": "紧急联系人姓名",
    "emergencyPhone": "紧急联系人电话"
  },
  "education": [
    {
      "school": "学校名",
      "major": "专业",
      "degree": "学历",
      "duration": "学制(如4年)",
      "isRegular": "是否统招(统招/自考/成考)",
      "gpa": "GPA或排名",
      "startDate": "开始时间",
      "endDate": "结束时间",
      "description": "在校经历",
      "awards": "获奖/荣誉",
      "publications": "论文/专利"
    }
  ],
  "work": [
    {
      "company": "公司名",
      "department": "部门",
      "position": "职位",
      "type": "工作类型(全职/实习/兼职)",
      "city": "工作城市",
      "startDate": "开始时间",
      "endDate": "结束时间",
      "description": "工作描述"
    }
  ],
  "projects": [
    {
      "projectName": "项目名称",
      "role": "担任角色",
      "techStack": "技术栈",
      "startDate": "开始时间",
      "endDate": "结束时间",
      "description": "项目描述"
    }
  ],
  "languages": "语言能力(换行分隔)",
  "certificates": "资格证书(换行分隔)",
  "skills": "技能列表(换行分隔)",
  "jobIntention": {
    "position": "期望职位",
    "salary": "期望薪资",
    "city": "期望城市",
    "type": "工作类型",
    "industry": "期望行业",
    "currentAnnual": "目前年薪"
  },
  "selfEvaluation": "自我评价"
}

规则：
1. 如果某字段在文本中找不到对应信息，值设为空字符串
2. education、work、projects 是数组，可能有多条记录
3. languages、certificates、skills 是字符串，每项用换行分隔
4. 日期格式统一为 "YYYY-MM" 或 "YYYY"
5. 只返回 JSON，不要其他文字`;

  const userPrompt = `请解析以下简历文本：\n\n${pdfText}`;

  const responseText = await callLLM(systemPrompt, userPrompt);

  // 解析 LLM 返回的 JSON 对象（兼容 markdown 围栏）
  const profile = parseLLMObject(responseText);
  if (!profile) {
    throw new Error(`LLM 返回格式异常，无法解析简历数据：${responseText.slice(0, 120)}`);
  }

  // 持久化解析结果：弹窗在解析期间被关闭时，下次打开可重新应用
  try {
    await chrome.storage.local.set({ pendingPdfProfile: profile });
  } catch (e) {
    console.warn('[简历填充] 保存 PDF 解析结果失败:', e.message);
  }

  return { profile };
}

// 测试 LLM 连接
async function testLLMConnection(config) {
  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new Error('请填写完整的 Base URL、API Key 和模型名称');
  }

  const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'user', content: '请回复"连接成功"四个字' }
      ],
      max_tokens: 20
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 返回 ${response.status}: ${errText.slice(0, 150)}`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || '';
  return { success: true, reply: reply.trim() };
}
