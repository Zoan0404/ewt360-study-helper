# 📖 升学e网通 试卷及习题助手

> **一键扫描 · 自动满分 · 子母题通吃 · 混合题型无缝切换**
>
> 🛠 Tampermonkey / Violentmonkey ｜ 📌 **v1.1.1** 最新 ｜ 📦 ~92 KB ｜ 🔒 ISC License

专为升学e网通（ewt360.com）打造的**自动化刷题辅助脚本**，支持**独立试卷（bizCode=205）**、**校本试卷/作业提交入口（bizCode=207）**与**课程习题（bizCode=204）**等多类题型，集成子母题/混合题智能处理、一键任务扫描、自动作答满分提交、完成状态检测防重复刷等能力，让刷题从"手动点题"升级为"全自动流水线"。**v1.1.0 起总任务页即可直接刷取校本试卷并自动满分；v1.1.1 起课后习题(204)/独立试卷(205)/试卷变体(206)/校本试卷(207) 四类任务统一提交逻辑，一套链路满分通刷。**

由 **⚡Zoan** 在 **风月同天🌸** 与 **志成🍥** 两位作者的思路基础上整合优化而成。

---

## 📑 目录

- [⬇️ 快速安装](#️-快速安装)
- [✨ 核心功能](#-核心功能)
- [🚀 版本亮点](#-v109-版本亮点)
- [📋 更新日志](#-更新日志)
- [🐛 已知问题与状态](#-已知问题与状态)
- [📦 安装教程](#-安装教程)
- [📖 使用指南](#-使用指南)
- [🏗️ 技术架构](#️-技术架构)
- [⚠️ 注意事项](#️-注意事项)
- [💬 关于 & 联系](#-关于--联系)

---

## ⬇️ 快速安装

[![安装此脚本](https://img.shields.io/badge/⬇️%20安装此脚本-v1.1.1-818cf8?style=for-the-badge)](https://update.greasyfork.org/scripts/591256/%E5%8D%87%E5%AD%A6e%E7%BD%91%E9%80%9A%20%E8%AF%95%E5%8D%B7%E5%8F%8A%E4%B9%A0%E9%A2%98%E5%8A%A9%E6%89%8B.user.js)
[![Greasy Fork](https://img.shields.io/badge/Greasy_Fork-脚本主页-a78bfa?style=flat-square)](https://greasyfork.org/zh-CN/scripts/591256)

> 💡 **两个脚本怎么选？**
> - **试卷及习题助手**（本脚本）：专注刷题，轻量高效
> - **学习助手opt**：刷题 + **独立答案查看**（弹窗展示答案/解析/知识点），功能更全
> - 👉 [点这里查看学习助手opt](https://greasyfork.org/zh-CN/scripts/591258)

---

## ✨ 核心功能

### 🚀 全自动刷题流水线

一键扫描全部必学任务，自动完成 **初始化报告 → 拉取题目 → 获取答案 → 批量提交 → 交卷 → 自批**，全流程无人值守。

```
扫描任务 → 初始化报告 → 拉取题目 → 获取答案 → 批量提交 → 交卷 → 自批满分
```

### 🧩 子母题型 & 混合题型

- 完整支持子母题（大题带小题）作答结构
- 自动修复组内多题共享答案数组的场景（`fixGroupAnswers`）
- 父子题分值自动透传，自批得分**不丢分、不漏分**
- 选择题直接填选项、主观题按满分自批，混合题型无缝切换

### 📡 一键扫描功能

集成 `getStudentHomeworkDaySubjectStat` + `pageHomeworkTasks` + `queryStudentLessonStudyGuideAndPractice` 三接口，自动汇总所有未完成任务，按天/按学科双视图展示。

### ✅ 完成状态检测

自动检测任务完成状态，已完成的任务自动跳过、**禁止再次刷**，杜绝重复提交，避免浪费刷卷次数。

### 🎯 提交功能优化

| 题型 | 提交方式 | 说明 |
|------|----------|------|
| 选择题 | `revision=false` | 直接填充选项快速提交 |
| 非选择题 | `revision=true` + 满分 score | 利用自批机制提交满分 |

- 题目获取双接口降级：优先 `getAnswerSheetSubGroup`，失败自动降级 `answerSheetInfo`

### 🛡️ 稳定可靠

- token 过期自动检测（`TokenExpiredError`），及时提示重新登录
- 内置重试机制（默认 2 次指数退避）与并发控制，防止接口风暴
- 题目清洗保留 Wiris 公式图片，**数学公式不丢失**
- 空卷保护：未获取到任何题目/答案时中止提交

### 🎨 精美 UI

粉紫渐变（`#f9a8d4 → #a78bfa → #818cf8`）浮动圆形按钮；右侧滑入 **380px 侧边栏面板**，任务/设置/关于多视图切换，移动端全屏适配。

---

## 🚀 v1.1.1 版本亮点

> **⚡ 统一提交逻辑：课后习题(204) / 独立试卷(205) / 试卷变体(206) / 校本试卷(207) 一套链路满分通刷**

v1.1.1 把四种可刷题型（204 课后习题、205 独立试卷、206 试卷变体、207 校本试卷）的提交逻辑统一为**一条标准三连链路**，新增 206 试卷变体支持，并修复 207 校本试卷在统一逻辑下的满分提交——提交体系自此「一套代码通刷」。

| 升级项 | 说明 |
|--------|------|
| 🔗 **统一提交逻辑（重大）** | 204/205/206/207 共用「自动填答 submitAnswersBatch → 交卷 submitPaper → 自批满分 submitCorrected」标准三连，主观题携带满分自批标记，不再各通道各写各的 |
| 🆕 **新增 206 试卷支持** | 官方 contentType=2(EXAM_PAPER) 内部按 bizCode 分流 205/206；扫描时从任务 contentUrl 提取真实 bizCode，206 试卷不再被误判 205 提交失败，现已可满分刷取 |
| 🔧 **修复 207 满分提交** | 校本试卷(207) 回归标准三连（v1.1.0 实测满分路径），废弃会被服务器判 0 分的空卷提交分支 |
| ✅ **已实机验证** | 204/205/206/207 四类任务均已实机满分通过 |

---

## 📋 更新日志

### v1.1.1 `最新` — ⚡ 统一提交逻辑：204/205/206/207 一套链路满分通刷

> **基于 v1.1.0**：四种可刷题型（课后习题/独立试卷/试卷变体/校本试卷）提交逻辑统一为一条标准三连链路；新增 206 试卷变体支持；修复 207 校本试卷满分提交。

- **🔗（重大）统一提交逻辑**：204/205/206/207 共用「自动填答 submitAnswersBatch → 交卷 submitPaper → 自批满分 submitCorrected」标准三连，主观题携带满分自批标记，不再各通道各写各的
- **🆕 新增 206 试卷支持**：扫描时从任务 contentUrl 提取真实 bizCode，206 试卷（contentType=2 分流）不再被硬判 205 提交到错误报告空间，自动识别并满分刷取
- **🔧 修复校本试卷(207) 满分提交**：207 回归标准三连（主观题自批满分），废弃空卷提交分支——空卷提交会被服务器判 0 分
- **🏷️ 类型标签扩展**：206 任务显示「试卷」类型

---

<details>
<summary><b>v1.1.0 — 🎉 校本试卷总任务页刷取 · 锁卷安全升级（重大更新）</b>（点击展开）</summary>

> **自 v1.0.8 锁卷安全升级以来最重磅版本**：新增「校本试卷（bizCode=207）」总任务页刷取通道并自动满分；承接内部 v1.0.10，将锁卷迁移到 201 查看态报告空间、提交满分前归属复核；同步排序修复与关于页/注释打磨。

- **🎯（重大）校本试卷（207）总任务页刷取**：新增独立 `bizCode=CUSTOM(207)` 通道，总任务页「作业提交入口 / 校本」任务可直接刷取并自动满分（此前只能进具体试卷页刷）
- **🔀 题型识别修正**：contentTypeName「校本试卷」/ 标题或卡片带「作业提交/校本」/ code=207 的任务，不再被硬判为 205 客观题试卷，正确归入 207 校本空间
- **📚 答案/报告读取对齐**：205 与 207 统一走 `/webreport/questionGroup?…&bizCode=&homeworkId=` 题组嵌套，校本答案/报告可正常获取
- **🔐 锁卷载体迁移到 201 查看态报告**：与任务成绩空间完全隔离，杜绝「时好时坏」污染真实成绩（承接 v1.0.10）
- **🛡️ 提交满分前归属复核**：服务器复用任务原报告时立即中止，双重防护真实成绩不被改写
- **🧹 任务列表排序修复**：课程/试卷按服务器真实顺序回填展示，不再试卷前置
- **✨ 关于页优化**：作者区增加分隔线、清理冗余中文注释，界面更清晰

---
</details>

<details>
<summary><b>v1.0.9 — 答案获取增强：多字段兜底 · 图片归一化 · 201查看态候选</b>（点击展开）</summary>

> **基于 v1.0.8**，借鉴开源 Android 应用「Fuck Ewt」（ewttest）的答案获取逻辑，全面增强答案提取兼容性与成功率。

**🔍 答案/解析多字段兜底（核心增强）：**
- **答案 9 字段兜底**：rightAnswer / rightAnswers / answers / answer / standardAnswer / correctAnswer / answerContent / trueAnswer / myAnswer / answerList 逐一尝试——服务器字段命名变化不再丢答案
- **解析 8 字段兜底**：analyse / analysis / analysisContent / analyseContent / answerAnalysis / parse / parseContent / explanation 逐一尝试——解析缺失率大幅下降
- 逐题 analysis 与 webreport 全量双路径同时生效（含子题 childQuestions）

**🖼️ 附件图片归一化：**
- attachmentImages 统一 http→https，公式图/插图稳定加载（https 页面不再被混合内容拦截）

**📇 报告ID多字段提取：**
- getReportId / initReport 均支持 reportId / report / id 三字段兼容

**🎯 答案源候选扩展：**
- 候选链：URL 报告 → getReportId 最新报告 → **201 查看态报告** → 锁卷兜底
- 无已完成报告时增加 201 查看态候选，取答案成功率更高

---

</details>

<details>
<summary><b>v1.0.8</b> — 锁卷安全机制升级：原报告答题 · 归属检测 · 杜绝成绩污染（点击展开）</summary>

> **基于 v1.0.7**，针对部分试卷锁卷生成真实作答报告的问题全面加固。

**🔒 原报告答题（核心修复）：**
- 锁卷前记录「任务已绑定报告」，提交答案优先使用该报告（原报告答题）——锁卷报告仅作答案源，用完即弃
- 即使部分试卷服务器忽略 homeworkId=0 并绑定锁卷报告，任务成绩仍由原报告决定，杜绝污染

**🛡️ 锁卷前归属检测：**
- 创建锁卷报告后查询报告详情：服务器回显 homeworkId≠0 → 已绑定真实作业 → 放弃锁卷
- initReport 响应回显检测：创建时发现归属异常立即抛错

**✅ 三层防线：**
- 创建回显检测 → 锁卷前归属检测 → 原报告答题，逐层拦截
</details>
<details>
<summary><b>v1.0.7</b> — 稳定性大修：关于页 HTML 修复 · userId 缓存 · 核心 API 全面重试（点击展开）</summary>

> **基于 v1.0.6**，聚焦稳定性与细节修复。

**🩹 关于页 HTML 修复：**
- 修复 v1.0.6 升级时插入的更新内容 section 双嵌套问题，各 section 独立成块，CSS 边框显示恢复正常

**⚡ userId 模块级缓存：**
- `getUserId` 增加模块级缓存，刷一套卷只请求 1 次（原 getWebReportAnswers / getQuestions 降级等多处重复请求 3-5 次）

**🔁 核心 API 全面接入重试：**
- getReportId / getReportStatus / getQuestions / getAnswer / getPaperInfo / getWebReportAnswers / initReport / updateReport / reAnswerPaper / submitAnswersBatch / submitPaper / submitCorrected / getUserId 全部改为带指数退避重试的 gmRequest
- 网络抖动 / 临时失败自动重试（1s / 2s），不再直接报错中断

**🔗 其他：**
- 关于页相关链接补充 Zoan 的 Greasy Fork 安装地址
</details>

<details>
<summary><b>v1.0.6</b> — 全量答案接口：webreport 1 次请求替代逐题 analysis（点击展开）</summary>

> **基于 v1.0.5**，刷题答案获取链路升级为 webreport 报告接口全量获取。

**🚀 核心升级：**
- **webreport 全量答案接口**：
  - 204 课后习题：`webreport` 1 次 GET 返回全卷答案 + 解析 + 子题
  - 205 独立试卷：`webreport/questionGroup` 1 次 GET 返回题组结构（含子题答案/解析）
  - 请求数 1 + N → 2，刷题速度大幅提升
- **试题名称与卷面题数兜底**：webreport 附带 data.title 与卷面题数，getPaperInfo 失败时数据不丢
- **失败自动回退**：webreport 异常/空数据自动回退逐题方案，不影响刷题

**✅ 修复效果：**
- 刷题/取答案请求量大幅下降，接口更稳
- 复合题子题答案随全量返回，不再逐题请求
</details>

<details>
<summary><b>v1.0.5</b> — 浏览页自动识别：bizCode=201 不再误用，探测真实作答类型（点击展开）</summary>

> **基于 v1.0.4**，修复从「浏览页」（答案解析/报告页，URL 带 bizCode=201）打开脚本时，直接使用 201 浏览码取答案导致**报告与任务绑定不一致**的问题。

**🔧 核心修复：**
- **bizCode 自动探测**：URL 上的 bizCode=201（VIEW 浏览码）不再直接使用，自动探测真实作答类型——**204 课后习题优先，205 独立试卷兜底**
- **三级兜底策略**：204 / 205 均探测失败时**回退 201**（浏览页报告真实存在，analysis 接口兼容 201 可继续取答案），不再中断加载
- **类型标签三态**：习题（204）/ 试卷（205）/ 浏览（201），面板状态栏不再误标类型

**✅ 修复效果：**
- 从任意入口（任务页/浏览页/报告分享链接）打开脚本，bizCode 均与任务绑定一致
</details>

<details>
<summary><b>v1.0.4</b> — 重刷机制大揭秘：204习题可重做 · 205成绩固化 · 锁卷取答案不再污染成绩（点击展开）</summary>

> **基于 v1.0.3**，本轮实机验证并集成官方「重新作答」接口，彻底解开「答案获取与满分提交」的机制死结。

**🚀 重磅新功能：**
- **集成官方 reAnswerPaper「重新作答」接口**（仅课后习题 bizCode=204 有效）
  - 重刷后任务入口（如「练」按钮）**自动绑定最新报告**（实机验证）
  - 试卷（bizCode=205）服务器返回 `7771522「该场景不支持再次作答」` → **自动降级 initReport**
- **强制重刷开关**：面板新增独立开关（标注「仅对习题有效」）

**🔓 锁卷取答案机制（重大修复）：**
- 实机确认：答案接口仅在报告「已完成」（finish=true）时返回正确答案
- **锁卷（submitPaper, homeworkId='0'）后报告立即变 finish=true → 解锁正确答案**
- 锁卷改用**专用 homeworkId=0 报告**（不归属作业、不参与任务绑定），**杜绝污染任务成绩**
- 答案源三层选择：URL 报告 → getReportId() 最新报告 → 锁卷专用报告兜底

**⏱️ 提交顺序修正：**
- 提交报告改为**取完答案后**创建（reAnswerPaper 会转移旧报告作答权，先调用会使答案源失效）

**📢 体验优化：**
- 205 已完成试卷固化提示
- **速度档位设置**：🟢 快（全速/30/8）· 🟡 中（20/15/5）· 🐢 稳（10/10/4），切换即时生效并记住选择
</details>

<details>
<summary><b>v1.0.3</b> — 稳定性与安全性全面修复（点击展开）</summary>

**🔧 核心修复：**
- **修复「获取答案失败：不支持此种类型的请求」**（HTTP 415）
  - 原因：核心接口未携带 `content-type`、`Origin`、`Ewt-Requestsource` 等网关必备请求头
  - 修复：`gmFetch` 内部自动合并公共请求头，**一处修复、11 个核心接口全部生效**
- **核心 11 接口统一请求封装**：GM_xmlhttpRequest，带 10s 超时、2 次指数退避重试、401 登录失效识别
- **分值映射修复**：`traverseQuestions` key 改为 `q.id ?? q.questionId`
- **空卷保护**：未获取到任何题目/答案时中止提交

**🛡️ 安全加固：**
- **XSS 防御**：HTML 清洗剥离 `on*` 事件属性与 `javascript:` 协议
- **Token 防泄露**：token 由 URL 参数改为请求头传递；请求日志 token/UA 脱敏
- **补充 `@connect` 声明**：消除跨域拦截
</details>

<details>
<summary><b>v1.0.2</b> — 修复独立试卷刷题失败（2026-08-15）（点击展开）</summary>

**🔧 主要修复：**
- **修复独立试卷（bizCode=205）刷题失败的问题**
  - 原因：`brushPaper` 中固定使用 `BIZ.VIEW`（201）获取报告信息，导致 `reportId=null`，引发 `NumberFormatException`
  - 修复：所有涉及报告查询的接口均改用**试卷自身的 `paper.bizCode`**

| 函数/接口 | 原代码（v1.0.1） | 修改后（v1.0.2） |
| --- | --- | --- |
| getReportId | BIZ.VIEW | paper.bizCode |
| getPaperInfo | BIZ.VIEW | paper.bizCode |
| updateReport | BIZ.VIEW | paper.bizCode |
| getQuestions | BIZ.VIEW | paper.bizCode |
| getAnswer | BIZ.VIEW | paper.bizCode |
</details>

<details>
<summary><b>v1.0.1</b> — 速度全面优化（点击展开）</summary>

- ⚡ **并发上限提升**：BRUSH 由 2 → `Infinity`，一键刷取时所有任务同时并发
- ⚡ **请求超时缩短**：15000 → **10000**
- ⚡ **答案获取 10 路并发**：ANSWER 由 5 → **10**
- ⚡ **双 reportId 并行初始化**：减少串行等待
- ⚡ **失败等待缩短**：重试间隔降至 **300ms**
</details>

<details>
<summary><b>v1.0.0</b> — 首发版本（点击展开）</summary>

- 整合 志成🍥 答案获取机制 + 风月同天🌸 脚本参考及 UI 设计
- 支持子母题/混合题型智能作答，父子题分值自动透传
- 一键扫描任务（三接口聚合），按天/按学科双视图
- 完成状态检测，已完成任务禁止再次刷
- 提交优化：选择题 `revision=false` 快速提交，非选择题自批满分
- 题目获取双接口降级，兼容性更强；token 过期自动检测
</details>

---


## 🐛 已知问题与状态

| 问题 | 状态 | 修复版本 |
|------|------|----------|
| 关于页更新内容 section 双嵌套导致边框异常 | ✅ 已修复 | v1.0.7（HTML 重构） |
| userId 重复请求（每套卷 3-5 次） | ✅ 已优化 | v1.0.7（模块级缓存） |
| 核心 API 无重试，网络抖动直接失败 | ✅ 已优化 | v1.0.7（gmRequest 指数退避） |
| 部分试卷锁卷生成真实作答报告（污染成绩） | ✅ 已修复 | v1.0.8（原报告答题 + 归属检测） |
| 个别试卷答案/解析字段命名不同导致丢失 | ✅ 已优化 | v1.0.9（多字段兜底 + 图片归一化） |
| 答案获取请求量大（逐题并发 N 次） | ✅ 已优化 | v1.0.6（webreport 全量接口） |
| getPaperInfo 失败时数据源单一 | ✅ 已优化 | v1.0.6（webreport 兜底） |
| 从浏览页（bizCode=201）打开时误用 201 浏览码 | ✅ 已修复 | v1.0.5（自动探测 204/205） |
| 独立试卷（bizCode=205）刷题失败 | ✅ 已修复 | v1.0.2（改用 paper.bizCode） |
| 「获取答案失败：不支持此种类型的请求」 | ✅ 已修复 | v1.0.3（请求头自动补全） |
| 新任务「没做过就没答案」的死结 | ✅ 已解决 | v1.0.4（锁卷专用报告兜底） |
| 已完成试卷任务成绩无法改写 | ✅ 已明确 | v1.0.4（服务器固化，提示用户） |

> 📌 若仍有「部分试卷无法获取答案」的情况，欢迎在 [Greasy Fork 评论区](https://greasyfork.org/zh-CN/scripts/591256) 反馈（附上报错截图与控制台日志更佳）。

---

## 📦 安装教程

1. **安装油猴扩展**：浏览器安装 `Tampermonkey`（Chrome / Edge / Firefox）或 `Violentmonkey`
2. **安装脚本**：点击上方「⬇️ 安装此脚本」按钮，或访问 Greasy Fork 脚本页点击「安装此脚本」
3. **登录平台**：打开 升学e网通（`web.ewt360.com` / `teacher.ewt360.com`）并登录账号
4. **验证安装**：页面右下角出现 **粉紫色圆形浮动按钮** 即安装成功 🎉

---

## 📖 使用指南

1. 登录升学e网通，进入 **「假期作业 / 必学任务」** 页面
2. 点击浮动按钮打开侧边栏面板，点击 **「🔄 刷新列表」** 扫描任务
3. 在任务列表中选择要刷的任务，点击 **「刷」** 按钮（或点击 **「🚀 一键刷取」** 全部自动刷）
4. 脚本自动完成：获取题目 → 获取答案 → 提交 → 交卷 → 自批
5. 可在面板调整**速度档位**（🟢快 / 🟡中 / 🐢稳），切换即时生效

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────┐
│         油猴脚本（Tampermonkey）              │
├─────────────────────────────────────────────┤
│  扫描模块 → 报告模块 → 题目模块 → 提交模块      │
│  (scan)   (initReport) (getQuestions)        │
│                                             │
│  答案模块 → 交卷模块 → 自批模块 → UI 面板       │
│  (webreport)(submitPaper)(submitCorrected)  │
└──────────────────┬──────────────────────────┘
                   │ HTTPS (GM_xmlhttpRequest)
                   ▼
┌─────────────────────────────────────────────┐
│            ewt360.com 官方 API               │
│  gateway.ewt360.com / web.ewt360.com         │
└─────────────────────────────────────────────┘
```

### 📁 项目结构

```
升学e网通-试卷及习题助手.user.js
├── 元信息（@name / @version / @match / @grant）
├── 配置区（并发数 / 重试次数 / 接口地址 / BIZ题型码）
├── 工具函数（请求封装 / token检测 / 题目清洗 cleanHtmlKeepImg）
├── 核心模块
│   ├── 扫描模块（任务列表获取，三接口聚合）
│   ├── 报告模块（initReport + isRepeat 重试 + reAnswerPaper）
│   ├── 题目模块（getAnswerSheetSubGroup / answerSheetInfo 双接口降级）
│   ├── 答案模块（webreport 全量获取 / question/analysis 逐题回退）
│   ├── 提交模块（submitAnswersBatch 按题型分流）
│   ├── 交卷模块（submitPaper 随机拟真时长）
│   └── 自批模块（submitCorrected + 分值回退）
└── UI 模块（粉紫渐变浮动按钮 + 380px 侧边栏面板）
```

---

## ⚠️ 注意事项

> ⚠️ **合理使用**：本脚本仅用于学习辅助，请合理使用；平台可能限制每日刷卷次数，请勿过度使用；建议仅在个人账号下使用。

> 🔒 **隐私说明**：本脚本**不上传任何数据**，所有请求仅发送至 ewt360.com 官方接口；不收集、不存储、不分享任何个人信息；脚本完全开源，可自行审查全部代码。

> 🔄 **常见问题**：若提示 token 过期（`TokenExpiredError`），重新登录即可继续使用。

> ⚖️ **免责声明**：本脚本仅供学习与技术交流使用，请勿用于任何违反平台规定的用途。因使用本脚本产生的一切后果由使用者自行承担，作者不承担任何责任。

---

## 💬 关于 & 联系

| 项目 | 信息 |
| --- | --- |
| 👨‍💻 作者 | ⚡Zoan（optimized by）· 风月同天🌸 & 志成🍥 |
| 💬 反馈 | [Greasy Fork 评论区](https://greasyfork.org/zh-CN/scripts/591256) |
| 📮 QQ | [1478359473](https://qm.qq.com/cgi-bin/qm/qr?k=Ok_Wy_7bW0yMS9MrXLOp8PW0Ci0Gcn9A) |
| 📧 Gmail | [zoan0404@gmail.com](mailto:zoan0404@gmail.com) |
| 📄 许可证 | ISC License |

### 作者团队

| 作者 | 角色 | 链接 |
| --- | --- | --- |
| 🌸 风月同天 | 脚本参考 & UI 设计 | [博客](https://www.zkzxgzb.com/news/blog/bdcd86c) · [TG机器人](https://t.me/ewtkillbot) · [GitHub](https://github.com/ZZ0YY/EWT-TOOL) · [Greasy Fork](https://greasyfork.org/zh-CN/scripts/587786) |
| 🍥 志成 | 答案获取核心 | [主页](https://zhicheng233.top) · [博客](https://blog.zhicheng233.top) · [GitHub](https://github.com/zhicheng233/GetEWTAnswers) · [Greasy Fork](https://greasyfork.org/zh-CN/scripts/524802) |
| ⚡ Zoan | 整合优化 & 混合题型 | [QQ](https://qm.qq.com/cgi-bin/qm/qr?k=Ok_Wy_7bW0yMS9MrXLOp8PW0Ci0Gcn9A) · [Gmail](mailto:zoan0404@gmail.com) ·  [GitHub](https://github.com/Zoan0404/ewt360-study-helper) · [Greay Fork](https://greasyfork.org/zh-CN/scripts/591256) |

---

## 💝 赞赏支持

如果觉得好用，欢迎请作者喝杯咖啡 ☕ 你的支持是持续维护的最大动力！

![微信赞赏码](https://raw.githubusercontent.com/Zoan0404/ewt360-study-helper/main/wechat_reward.png)

*© Zoan · ISC License · 本页面仅供学习与技术交流使用*