// Popup Script - 用户信息管理与 PDF 导入

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  applyPendingPdfProfile();
  bindEvents();
});

// ===== 数据加载 =====
function loadData() {
  chrome.storage.local.get(null, result => {
    // LLM 配置
    const llm = result.llm || {};
    document.getElementById('llm-baseUrl').value = llm.baseUrl || '';
    document.getElementById('llm-apiKey').value = llm.apiKey || '';
    document.getElementById('llm-model').value = llm.model || '';

    // 基本信息
    const basic = result.basic || {};
    setVal('basic-name', basic.name);
    setVal('basic-gender', basic.gender);
    setVal('basic-birthday', basic.birthday);
    setVal('basic-phone', basic.phone);
    setVal('basic-email', basic.email);
    setVal('basic-location', basic.location);
    setVal('basic-hukou', basic.hukou);
    setVal('basic-nativePlace', basic.nativePlace);
    setVal('basic-ethnicity', basic.ethnicity);
    setVal('basic-political', basic.political);
    setVal('basic-marital', basic.marital);
    setVal('basic-workYears', basic.workYears);
    setVal('basic-availableDate', basic.availableDate);
    setVal('basic-jobStatus', basic.jobStatus);
    setVal('basic-currentSalary', basic.currentSalary);
    setVal('basic-address', basic.address);
    setVal('basic-website', basic.website);
    setVal('basic-github', basic.github);
    setVal('basic-wechat', basic.wechat);
    setVal('basic-idCard', basic.idCard);
    setVal('basic-height', basic.height);
    setVal('basic-weight', basic.weight);
    setVal('basic-emergencyName', basic.emergencyName);
    setVal('basic-emergencyPhone', basic.emergencyPhone);

    // 教育经历
    renderEducationList(result.education || []);

    // 工作经历
    renderWorkList(result.work || []);

    // 项目经历
    renderProjectList(result.projects || []);

    // 资格证书与语言
    setVal('languages', result.languages);
    setVal('certificates', result.certificates);

    // 求职意向
    const intention = result.jobIntention || {};
    setVal('intention-position', intention.position);
    setVal('intention-salary', intention.salary);
    setVal('intention-city', intention.city);
    setVal('intention-type', intention.type);
    setVal('intention-industry', intention.industry);
    setVal('intention-currentAnnual', intention.currentAnnual);

    // 专业技能
    setVal('skills', result.skills);

    // 自我评价
    setVal('self-evaluation', result.selfEvaluation);
  });
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

// ===== 教育经历列表 =====
function renderEducationList(list) {
  const container = document.getElementById('education-list');
  container.innerHTML = '';
  if (list.length === 0) list = [{}];

  list.forEach((edu, index) => {
    container.appendChild(createEducationCard(edu, index));
  });
}

function createEducationCard(data, index) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.index = index;
  card.innerHTML = `
    <div class="entry-header">
      <span class="entry-title">教育经历 ${index + 1}</span>
      <button class="btn-remove" title="删除">×</button>
    </div>
    <div class="field-row">
      <div class="field"><label>学校</label><input type="text" data-key="school" value="${esc(data.school)}"></div>
      <div class="field"><label>专业</label><input type="text" data-key="major" value="${esc(data.major)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>学历</label>
        <select data-key="degree">
          <option value="">请选择</option>
          ${['大专', '本科', '硕士', '博士', 'MBA', '其他'].map(d =>
    `<option value="${d}" ${data.degree === d ? 'selected' : ''}>${d}</option>`
  ).join('')}
        </select>
      </div>
      <div class="field"><label>学制</label><input type="text" data-key="duration" value="${esc(data.duration)}" placeholder="如：4年"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>是否统招</label>
        <select data-key="isRegular">
          <option value="">请选择</option>
          <option value="统招" ${data.isRegular === '统招' ? 'selected' : ''}>统招</option>
          <option value="自考" ${data.isRegular === '自考' ? 'selected' : ''}>自考</option>
          <option value="成考" ${data.isRegular === '成考' ? 'selected' : ''}>成考</option>
          <option value="网教" ${data.isRegular === '网教' ? 'selected' : ''}>网教</option>
        </select>
      </div>
      <div class="field"><label>GPA/排名</label><input type="text" data-key="gpa" value="${esc(data.gpa)}" placeholder="如：3.8/4.0 或 Top 10%"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>开始时间</label><input type="month" data-key="startDate" value="${esc(data.startDate)}"></div>
      <div class="field"><label>结束时间</label>
        <div class="date-with-present">
          <input type="month" data-key="endDate" value="${esc(data.endDate)}" ${data.endDate === '至今' ? 'disabled' : ''}>
          <label class="present-label"><input type="checkbox" data-key="isPresent" ${data.endDate === '至今' ? 'checked' : ''}> 至今</label>
        </div>
      </div>
    </div>
    <div class="field"><label>在校经历</label><textarea data-key="description" rows="2">${esc(data.description)}</textarea></div>
    <div class="field"><label>获奖/荣誉</label><textarea data-key="awards" rows="2" placeholder="奖学金、竞赛获奖等...">${esc(data.awards)}</textarea></div>
    <div class="field"><label>论文/专利</label><textarea data-key="publications" rows="1" placeholder="论文标题、专利号...">${esc(data.publications)}</textarea></div>
  `;

  card.querySelector('.btn-remove').addEventListener('click', () => {
    card.remove();
    reindexCards('education-list', '教育经历');
    scheduleSave();
  });

  return card;
}

// ===== 工作经历列表 =====
function renderWorkList(list) {
  const container = document.getElementById('work-list');
  container.innerHTML = '';
  if (list.length === 0) list = [{}];

  list.forEach((work, index) => {
    container.appendChild(createWorkCard(work, index));
  });
}

function createWorkCard(data, index) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.index = index;
  card.innerHTML = `
    <div class="entry-header">
      <span class="entry-title">工作经历 ${index + 1}</span>
      <button class="btn-remove" title="删除">×</button>
    </div>
    <div class="field-row field-row-3">
      <div class="field"><label>公司</label><input type="text" data-key="company" value="${esc(data.company)}"></div>
      <div class="field"><label>部门</label><input type="text" data-key="department" value="${esc(data.department)}"></div>
      <div class="field"><label>职位</label><input type="text" data-key="position" value="${esc(data.position)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>工作类型</label>
        <select data-key="type">
          <option value="">请选择</option>
          <option value="全职" ${data.type === '全职' ? 'selected' : ''}>全职</option>
          <option value="实习" ${data.type === '实习' ? 'selected' : ''}>实习</option>
          <option value="兼职" ${data.type === '兼职' ? 'selected' : ''}>兼职</option>
        </select>
      </div>
      <div class="field"><label>工作城市</label><input type="text" data-key="city" value="${esc(data.city)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>开始时间</label><input type="month" data-key="startDate" value="${esc(data.startDate)}"></div>
      <div class="field"><label>结束时间</label>
        <div class="date-with-present">
          <input type="month" data-key="endDate" value="${esc(data.endDate)}" ${data.endDate === '至今' ? 'disabled' : ''}>
          <label class="present-label"><input type="checkbox" data-key="isPresent" ${data.endDate === '至今' ? 'checked' : ''}> 至今</label>
        </div>
      </div>
    </div>
    <div class="field"><label>工作描述</label><textarea data-key="description" rows="3">${esc(data.description)}</textarea></div>
  `;

  card.querySelector('.btn-remove').addEventListener('click', () => {
    card.remove();
    reindexCards('work-list', '工作经历');
    scheduleSave();
  });

  return card;
}

// ===== 项目经历列表 =====
function renderProjectList(list) {
  const container = document.getElementById('project-list');
  container.innerHTML = '';
  if (list.length === 0) list = [{}];

  list.forEach((proj, index) => {
    container.appendChild(createProjectCard(proj, index));
  });
}

function createProjectCard(data, index) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.index = index;
  card.innerHTML = `
    <div class="entry-header">
      <span class="entry-title">项目经历 ${index + 1}</span>
      <button class="btn-remove" title="删除">×</button>
    </div>
    <div class="field-row">
      <div class="field"><label>项目名称</label><input type="text" data-key="projectName" value="${esc(data.projectName)}"></div>
      <div class="field"><label>担任角色</label><input type="text" data-key="role" value="${esc(data.role)}"></div>
    </div>
    <div class="field"><label>技术栈</label><input type="text" data-key="techStack" value="${esc(data.techStack)}" placeholder="React, Node.js, MySQL"></div>
    <div class="field-row">
      <div class="field"><label>开始时间</label><input type="month" data-key="startDate" value="${esc(data.startDate)}"></div>
      <div class="field"><label>结束时间</label>
        <div class="date-with-present">
          <input type="month" data-key="endDate" value="${esc(data.endDate)}" ${data.endDate === '至今' ? 'disabled' : ''}>
          <label class="present-label"><input type="checkbox" data-key="isPresent" ${data.endDate === '至今' ? 'checked' : ''}> 至今</label>
        </div>
      </div>
    </div>
    <div class="field"><label>项目描述</label><textarea data-key="description" rows="3">${esc(data.description)}</textarea></div>
  `;

  card.querySelector('.btn-remove').addEventListener('click', () => {
    card.remove();
    reindexCards('project-list', '项目经历');
    scheduleSave();
  });

  return card;
}

function reindexCards(containerId, prefix) {
  const cards = document.querySelectorAll(`#${containerId} .entry-card`);
  cards.forEach((card, i) => {
    card.dataset.index = i;
    card.querySelector('.entry-title').textContent = `${prefix} ${i + 1}`;
  });
}

// ===== 收集表单数据 =====
function collectFormData() {
  const data = {
    llm: {
      baseUrl: getVal('llm-baseUrl'),
      apiKey: getVal('llm-apiKey'),
      model: getVal('llm-model')
    },
    basic: {
      name: getVal('basic-name'),
      gender: getVal('basic-gender'),
      birthday: getVal('basic-birthday'),
      phone: getVal('basic-phone'),
      email: getVal('basic-email'),
      location: getVal('basic-location'),
      hukou: getVal('basic-hukou'),
      nativePlace: getVal('basic-nativePlace'),
      ethnicity: getVal('basic-ethnicity'),
      political: getVal('basic-political'),
      marital: getVal('basic-marital'),
      workYears: getVal('basic-workYears'),
      availableDate: getVal('basic-availableDate'),
      jobStatus: getVal('basic-jobStatus'),
      currentSalary: getVal('basic-currentSalary'),
      address: getVal('basic-address'),
      website: getVal('basic-website'),
      github: getVal('basic-github'),
      wechat: getVal('basic-wechat'),
      idCard: getVal('basic-idCard'),
      height: getVal('basic-height'),
      weight: getVal('basic-weight'),
      emergencyName: getVal('basic-emergencyName'),
      emergencyPhone: getVal('basic-emergencyPhone')
    },
    education: collectEntries('education-list', ['school', 'major', 'degree', 'duration', 'isRegular', 'gpa', 'startDate', 'endDate', 'description', 'awards', 'publications']),
    work: collectEntries('work-list', ['company', 'department', 'position', 'type', 'city', 'startDate', 'endDate', 'description']),
    projects: collectEntries('project-list', ['projectName', 'role', 'techStack', 'startDate', 'endDate', 'description']),
    languages: getVal('languages'),
    certificates: getVal('certificates'),
    skills: getVal('skills'),
    jobIntention: {
      position: getVal('intention-position'),
      salary: getVal('intention-salary'),
      city: getVal('intention-city'),
      type: getVal('intention-type'),
      industry: getVal('intention-industry'),
      currentAnnual: getVal('intention-currentAnnual')
    },
    selfEvaluation: getVal('self-evaluation')
  };

  return data;
}

function collectEntries(containerId, keys) {
  const cards = document.querySelectorAll(`#${containerId} .entry-card`);
  const entries = [];

  cards.forEach(card => {
    const entry = {};
    let hasValue = false;

    keys.forEach(key => {
      const el = card.querySelector(`[data-key="${key}"]`);
      if (el) {
        entry[key] = el.value.trim();
        if (entry[key]) hasValue = true;
      }
    });

    // 检查"至今"复选框
    const presentCheckbox = card.querySelector('[data-key="isPresent"]');
    if (presentCheckbox && presentCheckbox.checked) {
      entry.endDate = '至今';
      hasValue = true;
    }

    if (hasValue) entries.push(entry);
  });

  return entries;
}

// ===== 自动保存（防抖） =====
let saveTimer = null;
let statusTimer = null;

function saveData() {
  const data = collectFormData();
  chrome.storage.local.set(data, () => {
    showStatus('save-status', '已自动保存 ✓', 'success');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => showStatus('save-status', '', ''), 1500);
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveData, 800);
}

// 弹窗关闭/隐藏前兜底保存，避免防抖窗口内的数据丢失
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    clearTimeout(saveTimer);
    saveData();
  }
});

function showStatus(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `status ${type}`;
}

// ===== PDF 导入 =====
async function handlePDFImport(file) {
  showStatus('pdf-status', '正在解析 PDF...', 'loading');

  try {
    // 读取 PDF 文件
    const arrayBuffer = await file.arrayBuffer();

    // 配置 PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../lib/pdf.worker.min.js';

    // 加载 PDF
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    if (!fullText.trim()) {
      showStatus('pdf-status', 'PDF 内容为空或无法提取文本', 'error');
      return;
    }

    showStatus('pdf-status', '正在调用 AI 解析简历...', 'loading');

    // 发送给 background 调用 LLM 解析
    const response = await chrome.runtime.sendMessage({
      type: 'PARSE_PDF',
      text: fullText
    });

    if (response.error) {
      showStatus('pdf-status', response.error, 'error');
      return;
    }

    // 填充表单
    fillFormFromProfile(response.profile);
    chrome.storage.local.remove('pendingPdfProfile');
    scheduleSave(); // 程序化赋值不触发 input/change，需手动触发自动保存
    showStatus('pdf-status', '解析成功！已自动保存', 'success');
    setTimeout(() => showStatus('pdf-status', '', ''), 4000);
  } catch (err) {
    showStatus('pdf-status', `解析失败: ${err.message}`, 'error');
    console.error('[PDF 解析]', err);
  }
}

// 弹窗重新打开时，应用上次解析期间被关闭的 PDF 结果
function applyPendingPdfProfile() {
  chrome.storage.local.get('pendingPdfProfile', result => {
    if (!result.pendingPdfProfile) return;
    chrome.storage.local.remove('pendingPdfProfile');
    if (!confirm('检测到上次未完成的 PDF 解析结果，是否应用到表单？')) {
      showStatus('save-status', '已放弃上次的解析结果', '');
      setTimeout(() => showStatus('save-status', '', ''), 3000);
      return;
    }
    fillFormFromProfile(result.pendingPdfProfile);
    scheduleSave();
    showStatus('save-status', '已应用上次未完成的 PDF 解析结果', 'success');
    setTimeout(() => showStatus('save-status', '', ''), 4000);
  });
}

function fillFormFromProfile(profile) {
  if (!profile) return;

  // 基本信息
  if (profile.basic) {
    setVal('basic-name', profile.basic.name);
    setVal('basic-gender', profile.basic.gender);
    setVal('basic-birthday', profile.basic.birthday);
    setVal('basic-phone', profile.basic.phone);
    setVal('basic-email', profile.basic.email);
    setVal('basic-location', profile.basic.location);
    setVal('basic-hukou', profile.basic.hukou);
    setVal('basic-nativePlace', profile.basic.nativePlace);
    setVal('basic-ethnicity', profile.basic.ethnicity);
    setVal('basic-political', profile.basic.political);
    setVal('basic-marital', profile.basic.marital);
    setVal('basic-workYears', profile.basic.workYears);
    setVal('basic-availableDate', profile.basic.availableDate);
    setVal('basic-jobStatus', profile.basic.jobStatus);
    setVal('basic-currentSalary', profile.basic.currentSalary);
    setVal('basic-address', profile.basic.address);
    setVal('basic-website', profile.basic.website);
    setVal('basic-github', profile.basic.github);
    setVal('basic-wechat', profile.basic.wechat);
    setVal('basic-idCard', profile.basic.idCard);
    setVal('basic-height', profile.basic.height);
    setVal('basic-weight', profile.basic.weight);
    setVal('basic-emergencyName', profile.basic.emergencyName);
    setVal('basic-emergencyPhone', profile.basic.emergencyPhone);
  }

  // 教育经历
  if (Array.isArray(profile.education) && profile.education.length > 0) {
    renderEducationList(profile.education);
  }

  // 工作经历
  if (Array.isArray(profile.work) && profile.work.length > 0) {
    renderWorkList(profile.work);
  }

  // 项目经历
  if (Array.isArray(profile.projects) && profile.projects.length > 0) {
    renderProjectList(profile.projects);
  }

  // 专业技能
  if (profile.skills) {
    const skillsText = Array.isArray(profile.skills) ? profile.skills.join('\n') : profile.skills;
    setVal('skills', skillsText);
  }

  // 资格证书与语言
  if (profile.languages) {
    const langText = Array.isArray(profile.languages) ? profile.languages.join('\n') : profile.languages;
    setVal('languages', langText);
  }
  if (profile.certificates) {
    const certText = Array.isArray(profile.certificates) ? profile.certificates.join('\n') : profile.certificates;
    setVal('certificates', certText);
  }

  // 求职意向
  if (profile.jobIntention) {
    setVal('intention-position', profile.jobIntention.position);
    setVal('intention-salary', profile.jobIntention.salary);
    setVal('intention-city', profile.jobIntention.city);
    setVal('intention-type', profile.jobIntention.type);
    setVal('intention-industry', profile.jobIntention.industry);
    setVal('intention-currentAnnual', profile.jobIntention.currentAnnual);
  }

  // 自我评价
  if (profile.selfEvaluation) {
    setVal('self-evaluation', profile.selfEvaluation);
  }
}

// ===== JSON 导入/导出 =====
function exportJSON() {
  const data = collectFormData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'resume-autofill-data.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    chrome.storage.local.set(data, () => {
      loadData(); // 重新加载表单
      showStatus('save-status', '导入成功！', 'success');
      setTimeout(() => showStatus('save-status', '', ''), 2000);
    });
  } catch (e) {
    showStatus('save-status', 'JSON 格式错误', 'error');
  }
}

// ===== 事件绑定 =====
function bindEvents() {
  // 输入/变更自动保存
  document.addEventListener('input', scheduleSave);
  document.addEventListener('change', scheduleSave);

  // 测试 LLM 连接
  document.getElementById('btn-test-llm').addEventListener('click', async () => {
    const btn = document.getElementById('btn-test-llm');
    const statusEl = document.getElementById('llm-test-status');

    const config = {
      baseUrl: getVal('llm-baseUrl'),
      apiKey: getVal('llm-apiKey'),
      model: getVal('llm-model')
    };

    if (!config.baseUrl || !config.apiKey || !config.model) {
      statusEl.textContent = '请先填写 Base URL、API Key 和模型名称';
      statusEl.className = 'status error';
      return;
    }

    btn.disabled = true;
    btn.textContent = '测试中...';
    statusEl.textContent = '';
    statusEl.className = 'status';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_LLM',
        config: config
      });

      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }

      if (response.error) {
        statusEl.textContent = `❌ ${response.error}`;
        statusEl.className = 'status error';
      } else {
        statusEl.textContent = `✅ 连接成功！模型回复: ${response.reply}`;
        statusEl.className = 'status success';
      }
    } catch (err) {
      statusEl.textContent = `❌ 请求失败: ${err.message}`;
      statusEl.className = 'status error';
    } finally {
      btn.disabled = false;
      btn.textContent = '🔗 测试连接';
    }
  });

  // PDF 导入
  document.getElementById('btn-pdf').addEventListener('click', () => {
    document.getElementById('pdf-input').click();
  });
  document.getElementById('pdf-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handlePDFImport(file);
    e.target.value = ''; // 允许重复选择同一文件
  });

  // 添加教育经历
  document.getElementById('btn-add-edu').addEventListener('click', () => {
    const container = document.getElementById('education-list');
    const index = container.children.length;
    container.appendChild(createEducationCard({}, index));
    scheduleSave();
  });

  // 添加工作经历
  document.getElementById('btn-add-work').addEventListener('click', () => {
    const container = document.getElementById('work-list');
    const index = container.children.length;
    container.appendChild(createWorkCard({}, index));
    scheduleSave();
  });

  // 添加项目经历
  document.getElementById('btn-add-project').addEventListener('click', () => {
    const container = document.getElementById('project-list');
    const index = container.children.length;
    container.appendChild(createProjectCard({}, index));
    scheduleSave();
  });

  // JSON 导出
  document.getElementById('btn-export-json').addEventListener('click', exportJSON);

  // JSON 导入弹窗
  document.getElementById('btn-import-json').addEventListener('click', () => {
    document.getElementById('json-modal').style.display = 'flex';
    document.getElementById('json-input').value = '';
  });
  document.getElementById('btn-json-cancel').addEventListener('click', () => {
    document.getElementById('json-modal').style.display = 'none';
  });
  document.getElementById('btn-json-confirm').addEventListener('click', () => {
    const json = document.getElementById('json-input').value.trim();
    if (json) {
      importJSON(json);
      document.getElementById('json-modal').style.display = 'none';
    }
  });

  // 「至今」复选框事件代理
  document.addEventListener('change', (e) => {
    if (e.target.dataset.key === 'isPresent') {
      const card = e.target.closest('.entry-card');
      const endDateInput = card.querySelector('[data-key="endDate"]');
      if (e.target.checked) {
        endDateInput.value = '';
        endDateInput.disabled = true;
      } else {
        endDateInput.disabled = false;
      }
    }
  });
}

// ===== 工具函数 =====
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
