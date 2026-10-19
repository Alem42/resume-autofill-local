# 组件兼容性与官网检查记录

当前补充验证：2026-10-20，版本 2.8.0。使用 Node.js 24 和本机 Edge 的独立配置，资料全部虚构，API 通过本机桥接模拟。

2.8.0 已将 Phoenix 的 3 项下拉 DOM 重建替换为公开 npm 包 3.3.55，重新运行 7 组组件，35 项全部通过；另外验证实际 DateRangePicker 的两端日期。北森虚构整页 62 项全部匹配并填写，独立 agent 也从界面逐步操作并通过。左右待选确认仍明确标注为基于公开招聘结构的夹具；没有将结果等同于中国人保登录后的官网验收。详细来源、交互和复现见 [2.8.0 北森适配记录](beisen-adaptation.md)及[独立操作记录](beisen-manual-qa.md)。

下文保留 2026-10-16、2.7.0 的历史测试与官网检查范围。

## 日期为什么需要改变交互方式

本次诊断中的生日、开始时间及结束时间被识别为 `custom-dropdown`，没有日期精度信息。三一页面公开脚本中的 Phoenix 日历与截图一致：外框只读，弹层另有输入框和年月视图。把日期当成普通候选文字，或只改变外框显示，都不能让组件确认日期。

修复采用组件交互与读回验证：按标签识别日期；读取网页格式和当前可见面板决定年 / 月 / 日精度；尝试弹层独立编辑框；否则通过年份跳转、年月标题、网格或滚动年份 / 月份列表选择。选中后检查外框实际值。只对表单之外的独立弹层编辑框发送确认 Enter，不向外框发送 Enter。5 秒预算仍然生效，超时后该字段不再执行后续方案。

学校等控件在点选后通常清空搜索词，把已选文字放在另一个节点。现在读取已选标签，并忽略透明的辅助选项、装饰节点、隐藏视图和整个选项容器；不会把“搜索到了”当成“选中了”。有单输入框的 ARIA combobox 外壳作为稳定字段，内部搜索框隐藏后仍能读回和识别已有选择。Phoenix 菜单项类名也包含 `select-list`，需要先排除单个菜单项，才能找到真正的候选列表。

## 实际组件浏览器验收

测试页面运行锁定版本的组件代码，生产内容脚本在隔离上下文中扫描、匹配、填写。页面以组件的 `change` / `select` 回调记录接受值，测试逐一核对，独立于扩展返回的成功计数。

| 测试组 | 版本 / 来源 | 到日日期 | 到月日期 | 学校 / 学历 / 熟练度 |
| --- | --- | --- | --- | --- |
| Phoenix 日历上游 | rc-calendar 9.15.11，使用 `phoenix-calendar` 前缀 | 通过 | 通过 | 3 项公开 DOM 结构重建测试通过 |
| Element UI | 2.15.14 / Vue 2.7.16 | 通过 | 通过 | 3 项通过 |
| Element Plus | 2.14.7 / Vue 3.5.44 | 通过 | 通过 | 3 项通过 |
| Ant Design | 6.6.6 / React 18.3.1 | 通过 | 通过 | 3 项通过 |
| Arco Design React | 2.66.18 | 通过 | 通过 | 3 项通过 |
| TDesign Vue Next | 1.20.10 | 通过 | 通过 | 3 项通过 |
| Naive UI | 2.45.3 | 通过 | 通过 | 3 项通过 |

共核验 35 项，其中 32 项运行真实上游组件，3 项为 Phoenix 专有下拉的 DOM 重建。同时检查学校与日期读回值、再次扫描时已有值标记，以及关闭覆盖后的二次填写全部跳过。不能据此推断这些库的所有版本、范围选择器、时分秒、地区级联或企业自行改写的控件都已通过。

另用浏览器输入接口产生真实用户事件，分别在“覆盖关闭 / 开启”两种情况下验证：预览后手动填写邮箱和单选、执行中手动填写当前输入框、接管学校下拉、接管日期弹层。共 6 个场景通过，手动内容保留，后续自动字段继续填写，完成后没有迟到写入，高亮和提示清理。原生 `.click()` 会产生浏览器可信的 `change` 事件；自动单选操作用同步标记区分，避免被误认为用户接管。

基础测试共 137 项通过，包含手动接管的 AI 校对排除、结果计数及诊断隐私检查。完整多条经历流程另见 [浏览器回归记录](browser-test-results.md)。

## 9 家企业的公开网页检查

以下全部进行了无登录的公开 GET，均返回 HTTP 200。只有三一的公开资源足以确认本次截图所用的 Phoenix 组件结构；其余公开入口、帮助页与岗位页不足以证明登录后填写兼容性。没有向企业网站写入虚构简历、保存申请或提交投递。

| 企业 | 本次检查入口 | 能确认的范围 |
| --- | --- | --- |
| 三一 | [简历编辑入口](https://sanycampus.zhiye.com/form?fromPage=editMyResume) | 页面标题、公开加载器、Phoenix 分包及日历 / 下拉类名；登录后的实际表单未自动验收 |
| 京东 | [简历入口](https://campus.jd.com/web/resume/resume_index) | 重定向到京东登录页；未取得账户表单 |
| 华为 | [校园招聘帮助](https://career.huawei.com/reccampportal/next/mini/faq_h5.html) | 公开填写说明；学校搜索后需要点选标准候选 |
| 百度 | [校园招聘](https://talent.baidu.com/jobs/campus) | 公开岗位页及加载器含 Ant Design 资源；不能据此确认简历表单的组件版本 |
| 美团 | [校园招聘问答](https://zhaopin.meituan.com/web/question/campus) | 公开问答入口；完整表单未取得 |
| 小米 | [校园招聘](https://hr.xiaomi.com/website/campus.html) | 公开校园说明；完整表单未取得 |
| 腾讯 | [招聘官网](https://careers.tencent.com/) | 公开入口；动态账户表单未取得 |
| 联想 | [招聘官网](https://talent.lenovo.com.cn/) | 公开页面及资源入口；完整表单未取得 |
| 中国石化 | [招聘官网](https://job.sinopec.com/) | 公开入口；完整表单未取得 |

三一公开加载器为 `ux-recruitment-portal-2022-form-pc/release/dist/pcform-e1944db80b7bd4c43439.chunk.min.js`；其 Phoenix 分包 `beisen-phoenix-part1-b1e69e1c8b76b958d13b.chk.js`、`beisen-phoenix-part2-502f98f31630e64ee05b.chk.js` 中可观察到 `phoenix-calendar`、`phoenix-select__tipEle`、`phoenix-single-select-list__item` 等结构。资源由页面引用的 `feo.bstatics.com` 提供。这些哈希会随官网发布变化，扩展不依赖哈希或公司域名，不加载这些远程脚本。

## 复现

```sh
# 基础回归，无第三方依赖
node --test tests/*.test.js
node tests/browser/run.mjs

# 真实组件测试，依赖仅用于开发
npm ci --ignore-scripts --legacy-peer-deps
npm run test:components
# 可单独运行：node tests/browser/components-run.mjs phoenix manual manual-popup

# 只读取公开网页，不登录、不写入
npm run inspect:companies
```

浏览器不在默认路径时设置 `BROWSER_BIN`。报告、截图、打包产物和浏览器配置在 Git 忽略的 `.preview/` 中，依赖在忽略的 `node_modules/` 中。`inspect:companies` 记录状态、标题、跳转和公开资源地址，不包含私人资料或会话 Cookie。页面状态和资源版本可能随时间变化。

这些测试使用完整组件实现，比仅模拟点击回调更能暴露交互问题，但仍不能替代账户登录后官网验收。本次未验证真实 DeepSeek 响应质量、闭合 Shadow DOM、跨域 iframe 或官网保存接口。
