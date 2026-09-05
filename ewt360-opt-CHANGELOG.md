# 📋 更新日志 · 升学e网通 学习助手opt

> 🏷️ 一键刷卷 · 自动满分 · 答案速查 · 子母题通吃 · 粉紫梦幻UI
>
> 🛠 Tampermonkey / Violentmonkey ｜ 📌 **最新版本 v1.1.0** ｜ 🔒 ISC License
>
> 本项目所有值得记录的变更均记录在此文件中。
> - 格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.3/)
> - 版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)
> - 脚本主页：[Greasy Fork #591258](https://greasyfork.org/zh-CN/scripts/591258)

---

## 📑 版本对照速查

| 版本 | 说明 | 状态 |
| --- | --- | --- |
| [1.1.0](#110--校本试卷总任务页刷取锁卷安全升级重大更新) | 🎉 校本试卷(207)总任务页刷取 · 锁卷 201 通道 + 归属复核 · 排序修复（重大） | **🆕 最新** |
| [1.0.9](#109---答案获取增强多字段兜底--图片归一化--201查看态候选) | 答案获取增强（多字段兜底 / 图片归一化 / 201查看态候选） | ✅ 已发布 |
| [1.0.8](#108---锁卷安全机制升级原报告答题--归属检测--杜绝成绩污染) | 锁卷安全机制升级（原报告答题 / 归属检测）/ 杜绝成绩污染 | ✅ 已发布 |
| [1.0.7](#107---稳定性大修关于页-html-修复--userid-模块级缓存--核心-api-全面重试) | 关于页 HTML 修复 / userId 模块级缓存 / 核心 API 全面重试 | ✅ 已发布 |
| [1.0.6](#106---全量答案接口webreport-1-次请求拿全卷答案--速度大幅提升--名称题数兜底) | webreport 全量答案（1次GET替代逐题并发）/ 试题名称与卷面题数兜底 | ✅ 已发布 |
| [1.0.5](#105---答案弹窗全面修复题数按卷面统计--复合题子题分组--多选并列显示--浏览页自动识别) | 答案弹窗全面修复（卷面题数/子题分组/多选并列/公式图https）/ bizCode=201自动探测 | ✅ 已发布 |
| [1.0.4](#104---重刷机制大揭秘204习题可重做--205成绩固化--刷题与查看答案双保险) | 集成官方 reAnswerPaper / 锁卷专用报告 / 查看答案安全修复 / 205固化提示 / 速度档位 / 强制重刷 | ✅ 已发布 |
| [1.0.3](#103---稳定性与安全性全面修复) | 稳定性与安全性修复：请求封装统一 / 415 修复 / 安全加固 | ✅ 已发布 |
| [1.0.2](#102---2026-08-15-修复独立试卷刷题失败) | 修复独立试卷（bizCode=205）刷题失败：报告接口改用 paper.bizCode | ✅ 已发布 |
| [1.0.1](#101---速度全面优化) | 速度优化：无限并发 / 10s 超时 / 10 路答案并发 / 300ms 重试 | ✅ 已发布 |
| [1.0.0](#100---首发版本) | 首发：全自动流水线、子母题、一键扫描、答案查看 | ✅ 已发布 |

---

## [1.1.0] - 校本试卷总任务页刷取 · 锁卷安全升级（重大更新）

> 承接此前内部未单独发版的 v1.0.10（锁卷安全/排序/归属复核），本次以 **v1.1.0** 发布，并新增重磅能力——**校本试卷（bizCode=207）总任务页刷取**（与「试卷及习题助手」同步升级）。

### 🎯 新增（重大）

- **校本试卷（207）总任务页刷取**：`BIZ` 新增 `CUSTOM=207`。校本试卷 / 作业提交入口此前在总任务页无法刷（被并入 205 空间，服务器不识别），现在总任务页即可一键刷取并**自动满分**（实机验证数学/化学/生物等可达 100）
- **题型识别修正**：contentTypeName「校本试卷」、标题/卡片含「作业提交入口」、或 contentTypeCode / bizCode 为 207 的任务，正确归为校本试卷（CUSTOM/207）
- **答案/报告读取对齐**：205 与 207 统一走 `/webreport/questionGroup?paperId=…&reportId=…&bizCode=&homeworkId=` 题组嵌套读取

### 🔐 优化（承接内部 v1.0.10）

- **锁卷载体迁移至 201 查看态报告**：`刷题` 与 `获取答案` 两条路径同步升级，锁卷报告与任务成绩报告空间完全隔离，杜绝「时好时坏」污染
- **提交满分前归属复核**：`initReport` 复用任务原报告时立即中止，双重防护真实成绩不被改写

### 🧹 修复与体验

- **任务列表排序修复**：课程/试卷按服务器真实顺序占位回填展示
- **关于页优化**：作者区域增加分隔线、清理冗余中文注释，界面更清晰

---

## [1.0.9] - 答案获取增强：多字段兜底 · 图片归一化 · 201查看态候选

> 基于 v1.0.8。借鉴开源 Android 应用「Fuck Ewt」（ewttest）的答案获取逻辑，全面增强答案提取兼容性与成功率。

### 🔍 优化

- **答案多字段兜底**：rightAnswer / rightAnswers / answers / answer / standardAnswer / correctAnswer / answerContent / trueAnswer / myAnswer / answerList 共 9 种字段逐一尝试（逐题 analysis + webreport 全量双路径，含子题）
- **解析多字段兜底**：analyse / analysis / analysisContent / analyseContent / answerAnalysis / parse / parseContent / explanation 共 8 种字段逐一尝试
- **附件图片归一化**：attachmentImages 统一 http→https，公式图/插图稳定加载
- **报告ID多字段提取**：getReportId / initReport 支持 reportId / report / id 三字段兼容
- **答案源候选扩展**：增加 bizCode=201 查看态报告兜底候选，无已完成报告时取答案成功率更高

### ✅ 修复效果

- 个别试卷答案/解析字段命名不同不再丢失
- 附件图片显示更稳定（https 混合内容拦截不再发生）
- 特殊试卷取答案成功率提升

---

<details>
<summary><b>[1.0.8]</b> - 锁卷安全机制升级：原报告答题 · 归属检测 · 杜绝成绩污染</summary>


> 基于 v1.0.7。针对「部分试卷锁卷机制无效、获取答案后已生成真实作答报告」的问题全面加固，三层防线彻底杜绝污染任务成绩。

### 🩹 修复

- **锁卷生成真实作答报告（污染成绩）**：部分试卷服务器忽略 homeworkId='0'，锁卷报告被绑定真实作业——已通过三层防线修复

### 🔒 优化

- **原报告答题**：提交答案优先使用「任务已绑定报告」（锁卷前记录，锁卷后 getReportId 返回最新报告无法再用）；锁卷报告仅作答案源用完即弃
- **锁卷前归属检测**：创建锁卷报告后查询详情，服务器回显 homeworkId≠'0' → 放弃锁卷（未完成空报告不产生成绩）
- **initReport 回显检测**：创建响应回显 homeworkId 与请求不符 → 立即抛错

### ✅ 修复效果

- 部分试卷锁卷不再生成真实作答报告
- 205 试卷 / 特殊作业卷成绩归属永远正确
- 刷题安全性大幅提升
</details>
<details>
<summary><b>[1.0.7]</b> - 稳定性大修：关于页 HTML 修复 · userId 模块级缓存 · 核心 API 全面重试</summary>


> 基于 v1.0.6。聚焦稳定性与细节修复：修复关于页 HTML 结构错误、userId 重复请求、核心 API 无重试三大问题，并补充 Zoan 油叉地址。

### 🩹 修复

- **关于页 HTML 结构**：v1.0.6 升级时插入的更新内容 section 双嵌套，导致 CSS 边框显示异常——已重构为独立 section，div 配对正确
- **userId 模块级缓存**：`getUserId` 增加模块级缓存，刷一套卷只请求 1 次（原 getWebReportAnswers / getQuestions 降级等多处重复请求 3-5 次）

### 🔁 优化

- **核心 API 全面接入指数退避重试**：getReportId / getReportStatus / getQuestions / getAnswer / getPaperInfo / getWebReportAnswers / initReport / updateReport / reAnswerPaper / submitAnswersBatch / submitPaper / submitCorrected / getUserId 全部由直接 `gmFetch` 改为带重试的 `gmRequest`（失败 1s / 2s 自动重试），网络抖动不再直接失败

### 🔗 其他

- 关于页相关链接补充 Zoan 的 Greasy Fork 安装地址

### ✅ 修复效果

- 弱网 / 抖动场景刷题不再中断
- 请求量进一步下降（userId 去重）
- 关于页显示正常

</details>

<details>
<summary><b>[1.0.6]</b> - 全量答案接口（webreport 1次请求替代逐题并发）</summary>

> 基于 v1.0.5。新增 webreport 报告接口全量答案获取——**1 次 GET 替代「逐题列表 + 逐题并发」两步方案**，答案获取速度大幅提升（204 习题与 205 试卷均已实机抓包验证）。

### 🚀 新增

- **webreport 全量答案接口**（双脚本同步）
  - 204 课后习题：`webreport` 接口 1 次 GET 返回全卷 `rightAnswer / analyse / knowledges / childQuestions / myAnswer`（`data.questions` 平铺，`questions.length` 即卷面题数）
  - 205 独立试卷：`webreport/questionGroup` 接口 1 次 GET 返回题组结构（`data.groups`），展开后每题同样全量（含子题答案/解析）
  - 请求数从「1 + N」（题目列表 + 逐题答案）降到 **2 次**（用户信息 + webreport），速度大幅提升
- **刷题/查看答案双路径接入**：brushPaper 刷题与 fetchAndShowAnswers 查看答案**均优先 webreport**，opt 与「试卷及习题助手」刷题能力对齐（请求量一致，不再慢 5-10 倍）
- **试题名称与卷面题数兜底**：webreport 附带 `data.title` 与卷面题数，getPaperInfo 失败时弹窗标题/题数不丢
- **弹窗题数三级兜底**：任务口径 `paperInfo.questionCount` → webreport 卷面题数 → 展开条数

### 🔧 兼容性

- 复合题父题 `rightAnswer=[]/analyse=""`（答案全在子题）自动走子题分组显示，无需逐题请求
- webreport 异常 / 空数据自动回退原「getQuestions + getAnswer 逐题并发」方案，不影响使用

### ✅ 修复效果

- 答案获取请求量大幅下降（N 次 → 2 次），速度更快、接口更稳
- 含复合题习题（5 子题）实测：题数 = 2（卷面口径）、子题分组显示完整

---

</details>
<details>
<summary><b>[1.0.5]</b> - 答案弹窗全面修复：题数按卷面统计 · 复合题子题分组 · 多选并列显示 · 浏览页自动识别</summary>

> 基于 v1.0.4。针对实机反馈的「答案弹窗显示」系列问题全面修复，并补全 bizCode=201 浏览页入口识别。

### 🖥️ 答案弹窗显示修复（opt 专属）

- **题数统计修正**：标题题数改用任务页面口径（`paperInfo.questionCount` 卷面题数，复合题计 1 题），不再把复合题子题拆开计数（如「共 8 题」→「共 5 题」）
- **复合题子题分组显示**：同一大题的 (1)(2)(3)(4) 归属父题展示，不再拆成独立题目；子题自动标注题型（填空/单选），编号取自卷面（`questionNoShow`）
- **题型显示修正**：父题题型用 analysis 返回的 `subjectQuestionTypeName`（如「通用复合题」），不再误用题组名（整卷一组都叫「单选题」的场景）
- **多选题/不定项并列显示**：答案 C、D 并列展示，不再误用多空格式（1、C; 2、D;）；复合题子题同理（用子题 cateName 判断）
- **公式图片 https 升级**：`file.ewt360.com` 图片 http → https，修复 https 页面混合内容拦截导致公式图空白

### 🔧 bizCode 识别修复（双脚本同步）

- **bizCode 自动探测**：浏览页（URL bizCode=201）不再直接使用 201 浏览码，自动探测真实作答类型——**204 习题优先、205 试卷兜底**
- **三级兜底策略**：204 / 205 均探测失败时**回退 201**（浏览页报告真实存在，analysis 兼容 201 可继续取答案），不再中断加载
- **类型标签三态**：习题（204）/ 试卷（205）/ 浏览（201），面板状态栏不再误标类型

### ✅ 修复效果

- 答案弹窗的题数、结构、题型、公式图全部与任务页面一致
- 任意入口（任务页 / 浏览页 / 报告分享链接）打开脚本，bizCode 均与任务绑定一致

</details>
<details>
<summary><b>[1.0.4]</b> - 重刷机制大揭秘：204习题可重做 · 205成绩固化 · 刷题与查看答案双保险</summary>

> 基于 v1.0.3。本轮实机验证并集成官方「重新作答」接口（reAnswerPaper），彻底解开「答案获取与满分提交」的机制死结；同时修复「查看答案」误锁主报告的重大隐患。

### 🚀 新增

- **集成官方 reAnswerPaper「重新作答」接口**（`POST /web/answer/reAnswerPaper`，body=`{reportId}`）
  - **仅课后习题（bizCode=204）有效**：重刷后任务入口（「练」按钮）**自动绑定最新报告**（实机验证，连续重刷生成全新报告）
  - **试卷（bizCode=205）服务器返回 `7771522「该场景不支持再次作答」`** → 自动降级 initReport，不影响刷题
- **强制重刷开关**：面板新增独立开关（标注「仅对习题有效」），勾选后已完成任务按钮变「重做」可点，一键刷取带上已完成任务
- **速度档位设置**：🟢 快（全速/30/8）· 🟡 中（20/15/5）· 🐢 稳（10/10/4），切换即时生效 + localStorage 记忆
- 关于页显示版本号 v1.0.4

### 🔧 修复

- **锁卷取答案机制（重大）**
  - 实机确认：analysis 接口仅在报告「已完成」（finish=true）时返回正确答案，未完成报告返回 `rightAnswer:[] / analyse:""`
  - 锁卷（submitPaper, homeworkId='0'）后报告立即 finish=true → **解锁正确答案**
  - 锁卷改用**专用 homeworkId=0 报告**（不归属作业、不参与任务绑定），**杜绝污染任务成绩**（实测：锁卷后任务绑定 reportId/score 不变）
  - 答案源三层选择：URL 报告 → getReportId() 最新报告 → 锁卷专用报告兜底；无答案源时**中止刷取**，避免空卷提交
- **查看答案安全修复（opt 专属）**
  - 修复「获取答案」误锁主报告的隐患：v1.0.3 直接锁最新报告——若该报告是任务进行中/未完成报告，会被锁成 0 分完成报告，可能成为任务第一份完成报告导致绑定 0 分
  - v1.0.4 改为：已完成报告直接取答案（无需锁卷）+ 锁卷专用报告兜底，**绝不碰主报告**
  - 新任务（无任何报告）查看答案同样可用：自动新建锁卷专用报告换取答案
- **提交顺序修正**：提交报告改为**取完答案后**创建——reAnswerPaper 会「转移旧报告作答权」，先调用会使答案源旧报告失效（实测题2答案变空）
- **205 已完成试卷固化提示**：刷完后明确提示「任务成绩固化（服务器限制），不会更新」

### ✅ 修复效果

- 新任务无需任何历史报告也能获取答案并满分提交（锁卷兜底）
- 已完成的 204 习题可一键重刷并自动更新任务成绩
- 「查看答案」不再把任务锁成 0 分，刷题与查看答案均不污染任务成绩

</details>
<details>
<summary><b>[1.0.3]</b> - 稳定性与安全性全面修复</summary>

> 基于 v1.0.2。本次更新聚焦**请求链路稳定性**与**安全性加固**，修复了「获取答案失败」问题并统一了核心请求封装。

### 🔧 修复

- **修复「获取答案失败：不支持此种类型的请求」**
  - 原因：核心接口统一为 `gmFetch` 后仅透传 `{ token, 'User-Agent' }`，缺少 `content-type: application/json`、`Origin`、`Referer`、`Ewt-Requestsource`、`Ewt-Contentstyle` 等网关必备请求头，服务器无法解析 JSON 请求体（HTTP 415）
  - 修复：`gmFetch` 内部自动合并公共请求头（`COMMON_HEADERS`），调用方显式传入的 header 优先；**一处修改，9 个核心接口与扫描模块全部生效**
- **补全 v1.0.2 修复遗漏**：`loadPapers` 中 `getPaperInfo` 仍硬编码 `BIZ.VIEW`（201），现全部改用 `paper.bizCode`
- **核心 9 接口统一请求封装**：getReportId / getUserId / getQuestions / getAnswer / getPaperInfo / initReport / submitAnswersBatch / submitPaper / submitCorrected
  - 原生 `fetch` → `GM_xmlhttpRequest` 封装：10s 超时、2 次指数退避重试、401 登录失效识别、HTTP / 业务错误归类
- **分值映射修复**：`traverseQuestions` 两处 key 由 `q.id` 改为 `q.id ?? q.questionId`，避免主观题分值映射失败得 0 分
- **空卷保护**：未获取到任何题目/答案时中止提交，避免提交空卷
- **报告状态区分**：`getReportStatus` 失败时返回并区分「未完成」与「未知」，避免误判

### 🛡️ 安全

- **XSS 防御加固**
  - `cleanHtmlKeepImg` 剥离 `on*` 事件属性与 `javascript:` 协议
  - 答案弹窗中知识点字段转义、解析字段走清洗函数
- **Token 防泄露**
  - `getReportId` 的 token 由 URL 参数改为请求头传递
  - `gmRequest` / `gmFetch` 请求日志 token 与 UA 脱敏显示 `***`
- **补充 `@connect` 声明**：gateway.ewt360.com / web.ewt360.com / teacher.ewt360.com，消除 GM_xmlhttpRequest 跨域拦截

### 💡 体验

- 未登录时右下角显示粉紫提示气泡（8 秒），不再静默退出

### ✅ 修复效果

- 「获取答案」功能恢复正常，不再报「不支持此种类型的请求」
- 独立试卷（bizCode=205）与习题练习（bizCode=204）刷题 / 查看答案全链路稳定
- 请求日志不再泄露 token 与 UA，弹窗内容更安全

</details>
<details>
<summary><b>[1.0.2]</b> - 2026-08-15 修复独立试卷刷题失败</summary>

> 基于 v1.0.1，修改范围：仅对 `brushPaper` 函数进行局部调整，**UI 及其他逻辑保持不变**。

### 🔧 修复

- **修复独立试卷（bizCode=205）刷题失败的问题**
  - 原因：原脚本在 `brushPaper` 中固定使用 `BIZ.VIEW`（码值 201）获取报告信息，导致独立试卷查询返回 `reportId=null`，引发 `NumberFormatException` 并中断刷题流程
  - 修复：所有涉及报告查询的接口均改用**试卷自身的 `paper.bizCode`**，确保正确获取报告

### 📝 具体改动（均位于 brushPaper 函数内）

| 函数/接口 | 原代码（v1.0.1） | 修改后（v1.0.2） |
| --- | --- | --- |
| getReportId | BIZ.VIEW | paper.bizCode |
| getPaperInfo | BIZ.VIEW | paper.bizCode |
| updateReport | BIZ.VIEW | paper.bizCode |
| getQuestions | BIZ.VIEW | paper.bizCode |
| getAnswer | BIZ.VIEW | paper.bizCode |

> 其他函数（如 `loadPapers`、`fetchAndShowAnswers` 等）未受影响。

### ✅ 修复效果

- 独立试卷（如 bizCode=205）现在能够正常获取报告、题目及答案，提交后状态正确
- 习题练习（bizCode=204）保持原有功能，不受影响
- 一键刷取和单个刷题均适用

</details>
<details>
<summary><b>[1.0.1]</b> - 速度全面优化</summary>

> 本次更新聚焦「更快」：更高的并发、更短的超时与等待，让一键刷取整体提速。

### 🚀 新增

- **BRUSH: Infinity** —— 一键刷取时所有任务同时并发，不再限制数量（原 2 路）
- **双 reportId 并行初始化** —— 刷题启动时 `getReportId(VIEW)` 与 `initReport` 通过 `Promise.all` 并发执行，减少串行等待

### ⚡ 优化

- **答案获取 10 路并发**（`ANSWER: 10`）—— 刷题与查看答案双双提速
- **请求超时缩短**：`REQUEST_TIMEOUT: 15000 → 10000`，超时更快，避免长时间等待
- **失败等待缩短**：`sleep(1000) → sleep(300)`，整体流程更流畅
- 重构 `submitAllAndCorrect`：不再内部重复调用 `initReport`，改为直接接收外部传入的 `submitReportId`，职责更清晰、减少冗余请求

### 🐛 修复

- （无功能性修复项，本次为纯性能优化版本）

### ⚠️ 已知问题

- 部分试卷无法获取答案提交（时间较靠前的试卷不受影响）→ **v1.0.2 已针对独立试卷修复**，如仍有问题请反馈

</details>
<details>
<summary><b>[1.0.0]</b> - 首发版本</summary>

> 由 ⚡Zoan 整合 风月同天🌸（脚本参考 & UI 设计）与 志成🍥（答案获取核心）双作者方案而成。

### ✨ 新增

- **全自动刷题流水线**：扫描任务 → 初始化报告 → 拉取题目 → 获取答案 → 批量提交 → 交卷 → 自批满分，全程无人值守
- **一键扫描功能**：集成 `getStudentHomeworkDaySubjectStat` + `pageHomeworkTasks` + `queryStudentLessonStudyGuideAndPractice` 三接口，三种状态并发拉取 + 去重 + 按截止时间排序
- **完成状态检测**：自动检测 `finished` / `finishStatus===1`，已完成任务自动跳过、按钮锁定，禁止重复刷
- **答案独立查看**：任务旁「📄 获取答案」按钮，弹窗展示 答案（多选自动编号）+ 知识点 + 解析（保留 Wiris 公式图）

### 🧩 功能

- **子母题型支持**：递归解析题目树（`childQuestions`），父子题分值/题型元数据自动透传；父题无答案自动展开子题作答
- **混合题型支持**：选择题（`revision=false` 直接填选项）与主观题（`revision=true` 满分自批）自动分流
- **组答案修复**：组内多题共享答案数组场景自动修复（`fixGroupAnswers`）
- **随机拟真**：交卷时长 60~180s、单题耗时 50~150s 随机，更贴近真实作答

### 🛡️ 稳定性

- token 过期自动检测（`TokenExpiredError`）+ GM 桌面通知提示重新登录
- 指数退避重试（失败后 1s / 2s，最多 2 次）
- 15s 请求超时 + 401 状态识别；并发控制（刷卷 2 / 作答 5 / 扫描 3）
- 一键停止：完成当前任务即停，不留半截

### 🎨 UI

- 52px 粉紫渐变浮动按钮（#f9a8d4 → #a78bfa），悬停放大 1.1x
- 380px 右侧滑入侧边栏（cubic-bezier 动画），移动端全屏
- 任务 / 答案 / 关于 三视图切换，右下角悬浮进度卡片

</details>
