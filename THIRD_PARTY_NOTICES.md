# 第三方来源说明

本项目自身新增和修改代码采用根目录的 MIT 许可；该许可不替代第三方各自的版权与许可。

## 原项目

基于 [h0110wbit/resume-autofill](https://github.com/h0110wbit/resume-autofill)，原始基线和版权归属说明保留在 [README](README.md#来源与许可证) 中。

## 仅用于开发测试的北森公开包

`@beisen-phoenix/select`、`@beisen-phoenix/select-list`、`@beisen-phoenix/date-picker` 均锁定为 3.3.55。其发布包 `package.json` 的许可元数据声明为 ISC。依赖的名称、版本、完整性与传递关系记录于 `package-lock.json`，安装后的包保留各自元数据及随包提供的声明。

这些包只运行在本机虚构测试网页，未把其源码或构建后的 bundle 复制进生产扩展。测试 bundle 位于 Git 忽略的 `.preview/`，不作为项目源码发布。生产适配代码根据 DOM、事件和公开组件行为独立实现，不在招聘网页加载远程组件代码。若以后另行分发测试 bundle，应检查并一并保留全部适用的第三方许可与声明。

React、Vue、Ant Design、Arco、Element UI / Element Plus、TDesign、Naive UI、rc-calendar、moment、esbuild 等其他开发依赖同样保留各自许可；根项目的 MIT 许可不重新授予或覆盖这些包的权利。

## 公开目录

学校及本科专业的数据来源为教育部 2026 年公开目录，原始网址、范围和整理方法见 [data/README.md](data/README.md)。不使用调研中缺少明确许可的第三方学校或专业仓库。目录整理工具依赖的 pypdf、xlrd 也仅在开发时使用，不进入扩展运行路径。
