# 简历自动填充 Chrome 扩展

AI 智能识别页面表单，一键自动填充简历信息的浏览器扩展。支持 Chrome 和 Edge。

## ✨ 功能特性

- 🤖 **AI 智能识别**：借助大模型理解表单字段含义，无需硬编码关键词
- 📄 **PDF 导入**：上传 PDF 简历，自动解析为结构化数据
- 🎯 **一键填充**：点击浮动按钮，自动填充所有匹配的表单字段
- ↩️ **撤回功能**：填充错误？一键撤回重新填充
- 💾 **数据管理**：支持导入/导出 JSON 数据
- 🌐 **跨浏览器**：同时支持 Google Chrome 和 Microsoft Edge

## 📦 安装方法

### Chrome 浏览器

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `resume-autofill` 文件夹
5. 扩展安装完成，图标会出现在浏览器工具栏

### Edge 浏览器

1. 打开 Edge，访问 `edge://extensions/`
2. 开启「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择 `resume-autofill` 文件夹
5. 扩展安装完成

## 🚀 使用方法

### 1. 配置 AI 模型

首次使用需要配置大模型 API：

1. 点击浏览器工具栏的扩展图标
2. 在「AI 模型设置」区域填写：
   - **API Base URL**：如 `https://api.openai.com/v1`
   - **API Key**：你的 API 密钥
   - **模型名称**：如 `gpt-4o-mini`
3. 点击「保存所有信息」

### 2. 填写简历信息

**方式一：手动填写**

在扩展弹窗中逐个填写：
- 基本信息（姓名、电话、邮箱等）
- 教育经历（支持多条）
- 工作经历（支持多条）
- 求职意向
- 自我评价

**方式二：PDF 导入**

1. 点击「从 PDF 简历导入」按钮
2. 选择你的 PDF 简历文件
3. AI 会自动解析并填充表单
4. 检查并修正后点击保存

### 3. 自动填充表单

1. 打开任意招聘网站的简历填写页面
2. 页面右下角会出现「自动填充」浮动按钮
3. 点击按钮，等待 AI 识别（约 2-5 秒）
4. 字段会自动填充并高亮显示
5. 如需撤回，再次点击按钮即可

## 📁 项目结构

```
resume-autofill/
├── manifest.json              # 扩展配置
├── icons/                     # 扩展图标
├── lib/                       # PDF.js 库
├── popup/                     # 弹出页面（用户信息管理）
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/                   # 内容脚本（字段识别+填充）
│   ├── content.js
│   └── content.css
├── background/                # 后台脚本（AI API 调用）
│   └── background.js
└── test.html                  # 测试页面
```

## 🧪 测试

项目包含一个测试页面 `test.html`，可用于验证功能：

1. 在 Chrome/Edge 中打开 `test.html`
2. 确保已配置 AI 模型和简历信息
3. 点击右下角「自动填充」按钮
4. 观察表单字段是否被正确填充

## 🔧 技术栈

- **Manifest V3**：最新的 Chrome 扩展规范
- **PDF.js**：Mozilla 开源的 PDF 解析库
- **OpenAI-compatible API**：支持任何兼容 OpenAI 接口的大模型服务

## 📝 支持的 LLM 服务

任何兼容 OpenAI Chat Completions API 的服务均可使用：

- OpenAI (GPT-4, GPT-4o, GPT-4o-mini)
- Claude (通过 API 转换)
- 国产大模型（通义千问、文心一言等，需使用兼容接口）
- 本地部署的模型（Ollama、LM Studio 等）

## 🐛 常见问题

**Q: 点击填充按钮没反应？**  
A: 检查是否已配置 AI 模型的 Base URL、API Key 和模型名称。

**Q: 某些字段没有被填充？**  
A: AI 可能无法匹配到对应的简历信息，可以手动补充这些字段。

**Q: PDF 导入失败？**  
A: 确保 PDF 是文本格式（非扫描件），且 AI 模型配置正确。

**Q: 支持哪些浏览器？**  
A: Chrome 88+ 和 Edge 88+（基于 Chromium 的版本）。

## 📄 许可证

MIT License
