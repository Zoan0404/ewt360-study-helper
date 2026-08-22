// ==UserScript==
// @name         升学e网通 试卷及习题助手
// @namespace    ewt360-study-helper-opt
// @version      1.0.7
// @author       风月同天🌸 & 志成🍥 (optimized by ⚡Zoan)
// @description  采用志成🍥 的答案获取与风月同天🌸 的脚本参考及UI页面，由⚡Zoan进行整合并支持子母题型 混合题型 并且提供扫描功能，支持检测完成状态，完成禁止再次刷，优化提交功能，进一步优化速度
// @license      ISC
// @match        https://web.ewt360.com/*
// @match        https://teacher.ewt360.com/*
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      gateway.ewt360.com
// @connect      web.ewt360.com
// @connect      teacher.ewt360.com
// @run-at       document-end
// @downloadURL none
// ==/UserScript==

(function() {
    "use strict";

    const BASE = "https://gateway.ewt360.com";
    const UA = "Mozilla/5.0";
    const BIZ = { EXERCISE: "204", PAPER: "205", VIEW: "201" };
    const HOMEWORK_STATUSES = [1, 2, 3];
    const REQUEST_TIMEOUT = 10000;              // 优化：降低超时
    const RETRY_COUNT = 2;
    const CONCURRENCY = { BRUSH: Infinity, ANSWER: 15, SCAN: 3 };

    function getToken() {
        const m = document.cookie.match(/(?:^|;\s*)token=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : null;
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function formatDate(ts) {
        const d = new Date(ts);
        return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    function escapeHtml(s) {
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    async function mapLimit(items, limit, fn, stopCheck) {
        const results = new Array(items.length);
        let next = 0;
        const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                if (stopCheck && stopCheck()) break;
                const i = next++;
                results[i] = await fn(items[i], i);
            }
        });
        await Promise.all(workers);
        return results;
    }

    function extractArray(resp, ...keys) {
        if (Array.isArray(resp)) return resp;
        for (const k of keys) {
            if (resp && Array.isArray(resp[k])) return resp[k];
        }
        return [];
    }

    function inferPaperType(task) {
        const name = (task?.contentTypeName || "").toLowerCase();
        const code = Number(task?.contentTypeCode);
        if (task?.contentType === 2 || name.includes("试卷") || code === 205) {
            return { type: "试卷", bizCode: BIZ.PAPER };
        }
        return { type: "习题", bizCode: BIZ.EXERCISE };
    }

    class TokenExpiredError extends Error {
        constructor(msg) { super(msg || "登录已过期"); this.name = "TokenExpiredError"; }
    }

    const COMMON_HEADERS = {
        Origin: "https://web.ewt360.com",
        Referer: "https://web.ewt360.com/mystudy/",
        "Ewt-Requestsource": "web",
        "Ewt-Contentstyle": "CamelCase",
        accept: "application/json, text/plain, */*",
        "content-type": "application/json; charset=UTF-8"
    };

    const COURSE_HEADERS = {
        Origin: "https://teacher.ewt360.com",
        Referer: "https://teacher.ewt360.com/",
        "Ewt-Requestsource": "web",
        "Ewt-Contentstyle": "CamelCase",
        accept: "application/json, text/plain, */*",
        "content-type": "application/json; charset=UTF-8"
    };

    function buildHeaders(headerSet = "common") {
        const base = headerSet === "course" ? { ...COURSE_HEADERS } : { ...COMMON_HEADERS };
        const token = getToken();
        if (token) base["token"] = token;
        return base;
    }

    function gmFetch(method, url, headers, data) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            // 合并公共请求头（调用方显式传入的 header 优先），确保 content-type / Origin / Ewt-* 等
            // 网关必备头存在，否则服务器返回 415「不支持此种类型的请求」
            const finalHeaders = { ...COMMON_HEADERS, ...(headers || {}) };
            GM_xmlhttpRequest({
                method, url,
                headers: finalHeaders,
                data: data ? JSON.stringify(data) : void 0,
                responseType: "json",
                timeout: REQUEST_TIMEOUT,
                onload(res) {
                    const elapsed = Date.now() - startTime;
                    const body = res.response;
                    if (res.status === 401) {
                        reject(new TokenExpiredError(`登录已过期 (${elapsed}ms)`));
                    } else if (res.status >= 200 && res.status < 300) {
                        if (body && body.success === false) {
                            const msg = body.msg || "API error";
                            console.warn(`[API ${method}] ${url} 业务失败 (${elapsed}ms):`, msg);
                            if (/登录|token|未授权/i.test(msg)) {
                                reject(new TokenExpiredError(msg));
                            } else {
                                reject(new Error(msg));
                            }
                        } else {
                            console.log(`[API ${method}] ${url} 成功 (${elapsed}ms) 长度:`, JSON.stringify(body?.data || body).length);
                            resolve(body?.data ?? body);
                        }
                    } else if (res.status >= 500) {
                        console.warn(`[API ${method}] ${url} 服务器错误 ${res.status} (${elapsed}ms)`);
                        reject(new Error(`HTTP ${res.status}`));
                    } else {
                        console.error(`[API ${method}] ${url} HTTP错误 ${res.status} (${elapsed}ms)`);
                        reject(new Error(`HTTP ${res.status}`));
                    }
                },
                ontimeout() {
                    console.warn(`[API ${method}] ${url} 超时 (${REQUEST_TIMEOUT}ms)`);
                    reject(new Error("请求超时"));
                },
                onerror(err) {
                    console.error(`[API ${method}] ${url} 网络错误:`, err);
                    reject(new Error("网络错误"));
                }
            });
        });
    }

    async function gmRequest(method, url, data = null, headerSet = "common") {
        const headers = { ...buildHeaders(headerSet), "user-agent": UA };
        const logPrefix = `[API ${method}] ${url}`;
        const logHeaders = { ...headers, token: headers.token ? "***" : undefined, "user-agent": "***" };
        console.log(`${logPrefix} 请求头:`, logHeaders);
        if (data) console.log(`${logPrefix} 请求体:`, data);

        let lastErr;
        for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
            try {
                return await gmFetch(method, url, headers, data);
            } catch (e) {
                lastErr = e;
                if (e instanceof TokenExpiredError) throw e;
                if (attempt >= RETRY_COUNT) break;
                console.warn(`${logPrefix} 第 ${attempt + 1} 次失败，${1000 * Math.pow(2, attempt)}ms 后重试:`, e.message);
                await sleep(1000 * Math.pow(2, attempt));
            }
        }
        throw lastErr;
    }

    const getApi = (url, headerSet) => gmRequest("GET", url, null, headerSet);
    const postApi = (url, data, headerSet) => gmRequest("POST", url, data, headerSet);
    const coursePost = (url, data) => postApi(url, data, "course");

    async function getUserInfo() {
        console.group("[用户信息] 获取中...");
        try {
            const [uinfo, sinfo] = await Promise.all([
                getApi("https://web.ewt360.com/api/usercenter/user/baseinfo"),
                getApi(`${BASE}/api/eteacherproduct/school/getSchoolUserInfo`, null, "course")
            ]);
            const result = { userId: uinfo.userId, schoolId: String(sinfo.schoolId), realName: uinfo.realName };
            console.log("[用户信息] 获取成功:", result);
            console.groupEnd();
            return result;
        } catch (e) {
            console.error("[用户信息] 获取失败:", e);
            console.groupEnd();
            throw e;
        }
    }

    function getCurrentPageTask() {
        const params = new URLSearchParams(window.location.search);
        const paperId = params.get("paperId");
        if (!paperId) return null;
        const homeworkId = params.get("homeworkId") || params.get("extId") || "0";
        const reportId = params.get("reportId") || "0";
        let bizCode = BIZ.PAPER;
        if (params.has("bizCode")) bizCode = params.get("bizCode");
        // v1.0.7fix：URL 上的 bizCode=201（VIEW 浏览码）不是真实作答类型，
        // 置 null 交给 loadPapers 探测（204 习题 / 205 试卷），避免用错类型
        if (bizCode === BIZ.VIEW) {
            console.warn("[直接识别] URL bizCode=201（VIEW浏览码），忽略并在 loadPapers 中探测真实作答类型");
            bizCode = null;
        }
        console.log("[直接识别] paperId:", paperId, "bizCode:", bizCode, "reportId:", reportId);
        return { paperId, homeworkId, reportId, bizCode };
    }

    function getCurrentHomeworkId() {
        const m = location.href.match(/homeworkId[=:](\d+)/);
        return m ? Number(m[1]) : null;
    }

    function getHomeworkTitleFromUrl() {
        const el = document.querySelector(".homework-title, .task-title, .page-title, .main-title, .subject-title");
        if (el) {
            const text = el.textContent?.trim();
            if (text) return text;
        }
        const headings = document.querySelectorAll("h1, h2");
        for (const e of headings) {
            if (!e.closest("#eph-panel")) {
                const text = e.textContent?.trim();
                if (text) return text;
            }
        }
        const params = new URLSearchParams(window.location.search);
        return params.get("homeworkTitle") || params.get("title") || null;
    }

    async function getHomeworkList(schoolId) {
        console.group(`[获取作业列表] schoolId=${schoolId}`);
        const seen = new Set();
        const all = [];
        const results = await Promise.allSettled(HOMEWORK_STATUSES.map(status =>
            coursePost(`${BASE}/api/homeworkprod/homework/student/getStudentHomeworkInfo`, {
                schoolId: Number(schoolId), subject: null, type: null, status,
                pageIndex: 1, pageSize: 100, notClassSetting: 0
            })
        ));
        HOMEWORK_STATUSES.forEach((status, idx) => {
            const r = results[idx];
            if (r.status !== "fulfilled") {
                console.warn(`[getHomeworkList] status=${status} 失败:`, r.reason?.message);
                return;
            }
            const list = extractArray(r.value, "data", "list", "records", "items");
            if (!list.length) { console.warn(`状态 ${status} 返回非数组:`, r.value); return; }
            console.log(`状态 ${status} 获取到 ${list.length} 个作业`);
            for (const hw of list) {
                const title = hw.homeworkTitle || hw.title || '';
                if (!seen.has(hw.homeworkId)) {
                    seen.add(hw.homeworkId);
                    all.push({ ...hw, title, homeworkTitle: title });
                }
            }
        });
        all.sort((a, b) => (b.endTime ?? a.startTime ?? 0) - (a.endTime ?? a.startTime ?? 0));
        console.log(`总共获取到 ${all.length} 个作业`, all.map(h => h.homeworkTitle));
        console.groupEnd();
        return all;
    }

    const SUBJECT_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    function fmtDayLabel(date) {
        if (!date) return "";
        const d = new Date(date);
        return `${d.getMonth() + 1}月${d.getDate()}日`;
    }

    async function scanTasks(schoolId, homework) {
        const hid = homework.homeworkId;
        console.group(`[扫描作业] ${homework.homeworkTitle || homework.title || hid}`);

        let dayList = [];
        try {
            const statResp = await coursePost(`${BASE}/api/homeworkprod/student/homework/task/getStudentHomeworkDaySubjectStat`, {
                schoolId: Number(schoolId), homeworkId: hid,
                mustLearnSubjectList: SUBJECT_IDS, queryMustLearn: 1
            });
            dayList = extractArray(statResp, "dateStat", "dayStat", "days", "list");
            dayList.sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
            console.log(`共 ${dayList.length} 天`, dayList.map(d => `${d.month}月${d.day}日(${d.taskCount}个任务)`));
        } catch (e) {
            console.warn(`[扫描] 获取日期列表失败:`, e);
        }
        if (!dayList.length) {
            console.warn(`[扫描] 未获取到日期列表，回退为按学科扫描`);
            dayList = SUBJECT_IDS.map(sid => ({ subjectId: sid }));
        }

        const dayResults = await mapLimit(dayList, CONCURRENCY.SCAN, async (day) => {
            const dayId = day.dateId;
            const dayLabel = (day.month && day.day) ? `${day.month}月${day.day}日` : fmtDayLabel(day.date);
            console.log(`处理日期 ${dayLabel || dayId}`);
            try {
                const body = {
                    schoolId: Number(schoolId), homeworkId: hid,
                    mustLearnSubjectList: SUBJECT_IDS, queryMustLearn: 1,
                    pageIndex: 1, pageSize: 1000
                };
                if (dayId) body.dayId = dayId;
                else body.subjectId = day.subjectId;
                const rawTasks = await coursePost(`${BASE}/api/homeworkprod/student/homework/task/pageHomeworkTasks`, body);
                const tasks = extractArray(rawTasks, "data", "tasks", "list", "records", "items");
                console.log(`日期 ${dayLabel || dayId} 共有 ${tasks.length} 个任务`);
                if (tasks.length === 0) return [];

                const result = [];
                const lessonIdList = [];
                const taskIds = [];
                const taskMap = {};

                for (const task of tasks) {
                    const { type } = inferPaperType(task);
                    if (type === "试卷") {
                        const paperId = String(task.contentId);
                        if (!paperId || paperId === "0") continue;
                        const done = task.finished === true;
                        result.push({
                            homeworkId: hid,
                            homeworkTitle: homework.homeworkTitle || homework.title || `作业 #${hid}`,
                            paperId, bizCode: BIZ.PAPER,
                            title: task.title || `试卷 ${paperId}`,
                            questionCount: task.questionCount || task.itemCount || "?",
                            subjectName: task.subjectName || "未知学科",
                            dayLabel, dayDate: day.date || null,
                            type, done, brushing: false
                        });
                        console.log(`  [${dayLabel}] 独立试卷: ${task.title} (${task.questionCount}题, 已${done ? '完成' : '未完成'})`);
                    } else {
                        const contentId = String(task.contentId);
                        if (contentId && contentId !== "0" && contentId !== "null") {
                            lessonIdList.push(contentId);
                            taskIds.push(String(task.taskId));
                            taskMap[contentId] = task;
                        }
                    }
                }

                if (lessonIdList.length > 0) {
                    console.log(`查询 ${lessonIdList.length} 个课程的练习...`);
                    let studyData = [];
                    try {
                        const resp = await coursePost(
                            `${BASE}/api/homeworkprod/student/homework/task/queryStudentLessonStudyGuideAndPractice`,
                            { schoolId: Number(schoolId), lessonIdList, taskIds, homeworkId: Number(hid) }
                        );
                        studyData = extractArray(resp, "data");
                        console.log(`获取到 ${studyData.length} 个课程的练习数据`);
                    } catch (e) {
                        console.warn(`[扫描] 日期 ${dayLabel || dayId} 获取练习信息失败:`, e);
                    }

                    for (const item of studyData) {
                        const lessonId = String(item.lessonId);
                        const studyTest = item.studyTest;
                        if (!studyTest || !studyTest.paperId) {
                            console.log(`  课程 ${lessonId} 无练习，跳过`);
                            continue;
                        }
                        const task = taskMap[lessonId];
                        const done = studyTest.finishStatus === 1;
                        let type = "习题";
                        let bizCode = BIZ.EXERCISE;
                        if (studyTest.bizCode) {
                            bizCode = String(studyTest.bizCode);
                            type = (bizCode === BIZ.EXERCISE) ? "习题" : "试卷";
                        } else if (task) {
                            const t = inferPaperType(task);
                            type = t.type; bizCode = t.bizCode;
                        }
                        result.push({
                            homeworkId: hid,
                            homeworkTitle: homework.homeworkTitle || homework.title || `作业 #${hid}`,
                            paperId: String(studyTest.paperId), bizCode,
                            title: task?.title || `课程 ${lessonId} 练习`,
                            questionCount: studyTest.questionCount ?? "?",
                            subjectName: task?.subjectName || "未知学科",
                            dayLabel, dayDate: day.date || null,
                            type, done, brushing: false
                        });
                        console.log(`  [${dayLabel}] 课程练习: ${task?.title} (${studyTest.questionCount}题, 已${done ? '完成' : '未完成'})`);
                    }
                }
                console.log(`日期 ${dayLabel || dayId} 共获取 ${result.length} 个可刷练习`);
                return result;
            } catch (e) {
                console.warn(`[扫描] 日期 ${dayLabel || dayId} 处理失败:`, e);
                return [];
            }
        });

        const papers = [];
        for (const r of dayResults) papers.push(...r);
        console.log(`作业 ${hid} 共汇总 ${papers.length} 个练习（按天排序）`);
        console.groupEnd();
        return papers;
    }

    // ---------- 脚本辅助函数 ----------
    const cleanHtmlKeepImg = (text) => {
        if (!text) return '';
        // XSS 加固：剥离所有 on* 事件属性（onclick/onerror/onload 等）
        text = text.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        // XSS 加固：剥离 javascript: 协议链接
        text = text.replace(/(href|src)\s*=\s*("|')javascript:[^"']*("|')/gi, '$1=$2$3');
        text = text.replace(/<img[^>]*Wirisformula[^>]*src="([^"]*)"[^>]*>/g, '<img src="$1" />');
        text = text.replace(/<br[^>]*>/g, '\n');
        text = text.replace(/<(?!img\b|\/img\b|b\b|\/b\b|u\b|\/u\b|i\b|\/i\b|strong\b|\/strong\b|em\b|\/em\b)[^>]+>/g, '');
        text = text.replace(/&ldquo;/g, '\u201c').replace(/&rdquo;/g, '\u201d');
        text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
        text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        text = text.replace(/\n{3,}/g, '\n\n');
        return text.trim();
    };

    const extractOpts = (rightAnswer) => {
        if (!rightAnswer || !Array.isArray(rightAnswer)) return [];
        return rightAnswer.filter(x => /^[A-Z]+$/.test(x.trim())).map(x => x.trim());
    };

    const fixGroupAnswers = (results) => {
        const groups = new Map();
        results.forEach((r, idx) => {
            if (!groups.has(r.group)) groups.set(r.group, []);
            groups.get(r.group).push({ ...r, index: idx });
        });

        for (const [groupName, items] of groups.entries()) {
            if (items.length < 2) continue;
            const firstRaw = items[0].rawRightAnswer;
            if (!firstRaw || !Array.isArray(firstRaw)) continue;
            const allSame = items.every(item => {
                const raw = item.rawRightAnswer;
                return raw && Array.isArray(raw) &&
                       raw.length === firstRaw.length &&
                       raw.every((v, i) => v === firstRaw[i]);
            });
            if (!allSame) continue;
            if (firstRaw.length !== items.length) continue;
            const isSingleChar = firstRaw.every(v => typeof v === 'string' && v.length === 1);
            if (!isSingleChar) continue;
            items.sort((a, b) => a.num - b.num);
            items.forEach((item, idx) => {
                const char = firstRaw[idx];
                results[item.index].answer = char;
            });
        }
    };

    // ---------- 脚本 API ----------
    async function getReportId(paperId, bizCode, token) {
        const url = `${BASE}/api/answerprod/web/answer/report?paperId=${paperId}&platform=1&bizCode=${bizCode}`;
        const data = await gmRequest("GET", url, null);
        const reportId = data?.reportId;
        if (!reportId) throw new Error(`获取报告ID失败: reportId为空 (paperId=${paperId}, bizCode=${bizCode})`);
        return reportId;
    }

    async function getReportStatus(paperId, reportId, bizCode, token) {
        try {
            const url = `${BASE}/api/answerprod/web/answer/report?paperId=${paperId}&platform=1&bizCode=${bizCode}&reportId=${reportId}&isRepeat=1`;
            const data = await gmRequest("GET", url, null);
            return data || {};
        } catch (e) {
            console.warn('[报告状态] 获取异常:', e.message);
            return null;   // null 表示「未知」，调用方需区分「未完成」与「未知」
        }
    }

    // v1.0.7fix：模块级缓存——刷一套卷 userId 只请求 1 次（webreport / getQuestions 降级共用），不再重复 3-5 次
    let cachedUserId = null;
    async function getUserId(force) {
        if (cachedUserId && !force) return cachedUserId;
        const url = `${BASE}/api/usercenter/user/baseinfo`;
        const data = await gmRequest("GET", url, null);
        if (!data || !data.userId) throw new Error("获取用户ID失败");
        cachedUserId = data.userId;
        return cachedUserId;
    }

    async function getQuestions(paperId, reportId, platform, bizCode, token) {
        const url = `${BASE}/api/answerprod/common/answer/sheet/getAnswerSheetSubGroup`;
        const body = { paperId, reportId, platform, bizCode, homeworkId: '0', client: 4 };
        const data = await gmRequest("POST", url, body);
        const questions = [];
        if (!data || !Array.isArray(data.groupQuestionList)) {
            // 降级：answerSheetInfo
            const userId = await getUserId();
            const url2 = `${BASE}/api/answerprod/common/answer/answerSheetInfo`;
            const body2 = { paperId, reportId, platform, bizCode, userId, client: 1 };
            const data2 = await gmRequest("POST", url2, body2);
            if (!data2 || !Array.isArray(data2.questionInfoList)) {
                throw new Error("获取题目失败（主接口与降级接口均异常）");
            }
            for (const q of data2.questionInfoList) {
                questions.push({
                    questionId: q.questionId,
                    questionNumber: q.questionNumber,
                    cateId: q.cateId || 1,
                    subjective: q.subjective || false,
                    groupName: '',
                });
            }
            return questions;
        } else {
            for (const group of data.groupQuestionList) {
                for (const q of group.questionList) {
                    questions.push({
                        questionId: q.questionId,
                        questionNumber: q.questionNumber,
                        cateId: q.cateId || 1,
                        subjective: q.subjective || false,
                        groupName: group.groupName || '',
                    });
                }
            }
            return questions;
        }
    }

    async function updateReport(paperId, reportId, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/submitpaper`;
        const body = { paperId, reportId, bizCode, platform, totalSeconds: 600, homeworkId: '0' };
        await gmRequest("POST", url, body);
    }

    // ---------- v1.0.4：官方「重新作答」接口（reAnswerPaper） ----------
    // 实测结论：
    //   - 仅 bizCode=204（课后习题）可用：POST body={reportId:旧报告} → 返回新报告ID，
    //     重刷后任务入口（如「练」按钮）会自动绑定最新报告（用户实机观察并验证）。
    //   - bizCode=205（试卷）返回 7771522「该场景不支持再次作答」，任务绑定固化无法改写。
    // 用法：对「已完成报告」调用，返回「未完成」的新报告，用于提交满分答案。
    async function reAnswerPaper(reportId, token) {
        const url = `${BASE}/api/answerprod/web/answer/reAnswerPaper`;
        const data = await gmRequest("POST", url, { reportId });
        const newReportId = data?.reportId;
        if (!newReportId) throw new Error('reAnswerPaper 返回 reportId 为空');
        return newReportId;
    }

    async function getAnswer(paperId, reportId, questionId, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/simple/question/analysis`;
        const body = { paperId, reportId, platform, questionId, bizCode, homeworkId: '0', client: 4 };
        try {
            return await gmRequest("POST", url, body);
        } catch (e) {
            console.warn(`[答案] 题目 ${questionId} 获取失败:`, e.message);
            return null;
        }
    }

    async function getPaperInfo(paperId, reportId, platform, bizCode, token) {
        const url = `${BASE}/api/answerprod/web/answer/paper?paperId=${paperId}&platform=${platform}&reportId=${reportId}&bizCode=${bizCode}`;
        return await gmRequest("GET", url, null);
    }

    // ---------- v1.0.7fix：webreport 全量答案接口（1 次 GET 拿全卷答案+解析，替代逐题 analysis） ----------
    // 实测（用户抓包验证）：
    //   - bizCode=204（课后习题）：GET /api/answerprod/web/answer/webreport?platform=1&reportId=xxx&userId=xxx&bizCode=204
    //     → data.questions[] 平铺数组，每题含 rightAnswer/analyse/myAnswer/rightStatus/knowledges/childQuestions；
    //       questions.length 即卷面题数（复合题计 1 题，实测含 5 子题的复合题 + 1 简答 = 2）
    //   - bizCode=205（试卷）：GET /api/answerprod/web/answer/webreport/questionGroup?paperId=xxx&reportId=xxx&platform=1&bizCode=205&homeworkId=xxx&userId=xxx
    //     → data.groups[] 题组嵌套，展开 groups 后每题同样全量（含子题答案/解析）；groups 展开前计数即卷面题数
    //   - data.title 即试题名称；复合题父题 rightAnswer=[]/analyse=""，答案全部在 childQuestions 子题中
    // 说明：仅报告已完成（finish=true）才返回完整答案；任何异常/空数据返回 null，由调用方回退 getQuestions+getAnswer 逐题方案
    async function getWebReportAnswers(paper, reportId, bizCode, token) {
        try {
            const userId = await getUserId();
            let raw = null;
            if (bizCode === BIZ.PAPER) {
                // 205 试卷：题组嵌套结构（URL 带 paperId + homeworkId）
                const url = `${BASE}/api/answerprod/web/answer/webreport/questionGroup?paperId=${paper.paperId}&reportId=${reportId}&platform=1&bizCode=${bizCode}&homeworkId=${paper.homeworkId || '0'}&userId=${userId}`;
                raw = await gmRequest("GET", url, null);
                const questions = [];
                for (const g of (raw?.groups || [])) {
                    for (const q of (g.questions || [])) {
                        if (!q.groupName) q.groupName = g.groupName || '';
                        questions.push(q);
                    }
                }
                raw = { ...(raw || {}), questions };
            } else {
                // 204 习题：平铺结构（URL 不带 paperId/homeworkId）
                const url = `${BASE}/api/answerprod/web/answer/webreport?platform=1&reportId=${reportId}&userId=${userId}&bizCode=${bizCode}`;
                raw = await gmRequest("GET", url, null);
            }
            const questions = raw?.questions || [];
            if (!questions.length) {
                console.warn('[webreport] 返回题目为空，回退逐题 analysis');
                return null;
            }
            // 归一化：webreport 用 id 字段，现有组装循环用 questionId（子题同理）；cate 复制到 cateId
            const normalize = (q) => {
                if (q.id != null && q.questionId == null) q.questionId = q.id;
                if (q.cate != null && q.cateId == null) q.cateId = q.cate;
                if (Array.isArray(q.childQuestions)) q.childQuestions.forEach(normalize);
                return q;
            };
            questions.forEach(normalize);
            // v1.0.7fix：webreport 附带试题名称（data.title）与卷面题数（questions.length，复合题计 1 题），
            // 可作 getPaperInfo 失败时的兜底数据源
            const title = raw?.title || '';
            const questionCount = questions.length;
            console.log(`[webreport] ✅ 1 次请求获取全卷答案成功：${questionCount} 题${title ? `，名称「${title}」` : ''}`);
            return { questions, title, questionCount };
        } catch (e) {
            console.warn('[webreport] 全量答案获取失败，回退逐题 analysis:', e.message);
            return null;
        }
    }

    // ---------- 脚本提交核心 ----------
    async function initReport(paperId, homeworkId, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/report?paperId=${paperId}&platform=${platform}&bizCode=${bizCode}&reportId=0&isRepeat=0&homeworkId=${homeworkId}`;
        let data;
        try {
            data = await gmRequest("GET", url, null);
        } catch (e) {
            if (e.message && e.message.includes('已做过')) {
                const retryUrl = url.replace('isRepeat=0', 'isRepeat=1');
                data = await gmRequest("GET", retryUrl, null);
            } else {
                throw e;
            }
        }
        const reportId = data?.reportId;
        if (!reportId) throw new Error('初始化报告失败: reportId为空');
        return reportId;
    }

    async function submitAnswersBatch(paperId, reportId, homeworkId, answers, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/submitanswer`;
        if (answers && answers.length) {
            const body = { answers: answers, assignPoints: true, bizCode, paperId, platform, reportId, homeworkId };
            await gmRequest("POST", url, body);
        }
    }

    async function submitPaper(paperId, reportId, homeworkId, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/submitpaper`;
        const body = { paperId, platform, reportId, totalSeconds: 60 + Math.random() * 120, bizCode, homeworkId };
        await gmRequest("POST", url, body);
    }

    async function submitCorrected(paperId, reportId, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/submitCorrected`;
        const body = { reportId, paperId, platform, bizCode, paperPackageId: null };
        await gmRequest("POST", url, body);
    }

    async function submitAllAndCorrect(paperId, platform, bizCode, questions, results, homeworkId, token, submitReportId) {
        // 修改：不再内部调用 initReport，直接使用传入的 submitReportId
        const answers = [];
        for (const q of questions) {
            const result = results.find(r => r.questionId === q.questionId);
            if (!result) continue;
            const item = {
                questionId: q.questionId,
                questionNo: q.questionNumber,
                totalSeconds: 50 + Math.floor(Math.random() * 100),
                cateId: q.cateId,
            };
            const isChoice = !q.subjective && result.rawRightAnswer && result.rawRightAnswer.length > 0 &&
                              result.rawRightAnswer.every(opt => /^[A-Z]+$/.test(opt.trim()));
            if (isChoice) {
                const opts = result.rawRightAnswer.filter(opt => /^[A-Z]+$/.test(opt.trim()));
                item.answers = opts.length ? opts : ['A'];
                item.revision = false;
            } else {
                const score = q.score || q.fullScore || 0;
                item.answers = [1];
                item.attachmentImages = [];
                item.score = score;
                item.revision = true;
            }
            answers.push(item);
        }

        // 禁止空卷提交：没有任何有效答案时直接中止，不再执行交卷/自批
        if (!answers.length) {
            throw new Error("未获取到任何有效答案，已禁止提交空卷（请检查试卷或稍后重试）");
        }

        await submitAnswersBatch(paperId, submitReportId, homeworkId, answers, bizCode, platform, token);
        await submitPaper(paperId, submitReportId, homeworkId, bizCode, platform, token);
        await submitCorrected(paperId, submitReportId, bizCode, platform, token);
    }

    // ==================== UI（完全对标风月同天脚本样式） ====================
    const STYLE_ID = "ewt-paper-helper-style";
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
#eph-toggle {
  position: fixed;
  right: 16px;
  bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  z-index: 999999;
  width: 52px;
  height: 52px;
  border: none;
  border-radius: 50%;
  background: linear-gradient(135deg, #f9a8d4 0%, #a78bfa 100%);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(167, 139, 250, 0.4);
  transition: all 0.25s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "Microsoft YaHei", sans-serif;
}
@media (hover: hover) {
  #eph-toggle:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 24px rgba(167, 139, 250, 0.55);
  }
}
#eph-toggle:active {
  transform: scale(0.95);
}
@media (max-width: 480px) {
  #eph-toggle {
    right: 12px;
    bottom: calc(24px + env(safe-area-inset-bottom, 0px));
    width: 48px;
    height: 48px;
    font-size: 18px;
  }
}

#eph-panel {
  position: fixed;
  right: -400px;
  top: 0;
  width: 380px;
  max-width: 90vw;
  height: 100dvh;
  height: 100vh;
  z-index: 999998;
  background: linear-gradient(180deg, #fef9ff 0%, #fff5f7 100%);
  box-shadow: -6px 0 30px rgba(167, 139, 250, 0.15);
  transition: right 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  display: flex;
  flex-direction: column;
  font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
  font-size: 14px;
  color: #4a4a6a;
}
#eph-panel.open { right: 0; }
@media (max-width: 480px) {
  #eph-panel {
    width: 100vw;
    right: -100vw;
    border-radius: 0;
  }
}

.eph-view {
  display: none;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.eph-view.active {
  display: flex;
}

#eph-panel .eph-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(20px + env(safe-area-inset-top, 0px)) 20px 16px;
  background: linear-gradient(135deg, #f9a8d4 0%, #a78bfa 50%, #818cf8 100%);
  color: #fff;
  border-radius: 0 0 20px 20px;
  position: relative;
}
#eph-panel .eph-header::after {
  content: "🌸";
  position: absolute;
  right: 56px;
  top: 12px;
  font-size: 16px;
  opacity: 0.6;
}
#eph-panel .eph-header h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 1px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.1);
}
#eph-panel .eph-close {
  background: rgba(255,255,255,0.2);
  border: none;
  border-radius: 50%;
  color: #fff;
  width: 28px;
  height: 28px;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
@media (hover: hover) {
  #eph-panel .eph-close:hover {
    background: rgba(255,255,255,0.35);
    transform: rotate(90deg);
  }
}

#eph-panel .eph-toolbar {
  padding: 12px 16px 8px;
  display: flex;
  gap: 8px;
  align-items: center;
}
#eph-panel .eph-toolbar button {
  padding: 7px 18px;
  border: none;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  background: linear-gradient(135deg, #f9a8d4 0%, #a78bfa 100%);
  color: #fff;
  transition: all 0.25s;
  font-weight: 600;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 8px rgba(167, 139, 250, 0.25);
}
@media (hover: hover) {
  #eph-panel .eph-toolbar button:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(167, 139, 250, 0.4);
  }
}
#eph-panel .eph-toolbar button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

#eph-panel .eph-status {
  padding: 8px 20px;
  font-size: 12px;
  color: #b8a9c9;
  min-height: 20px;
  border-bottom: 1px solid #f3e8ff;
}

#eph-panel .eph-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 4px 0 12px;
  scrollbar-width: thin;
  scrollbar-color: #e8dff5 #fef9ff;
}
#eph-panel .eph-list::-webkit-scrollbar { width: 4px; }
#eph-panel .eph-list::-webkit-scrollbar-track { background: #fef9ff; }
#eph-panel .eph-list::-webkit-scrollbar-thumb { background: #e8dff5; border-radius: 4px; }

.eph-hw-item {
  margin: 0 10px 6px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 6px rgba(167, 139, 250, 0.08);
  overflow: hidden;
  border: 1px solid #f3edff;
}
.eph-hw-item:first-child { margin-top: 8px; }

.eph-hw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s;
  gap: 8px;
}
.eph-hw-header .eph-hw-title {
  flex: 1;
  font-weight: 600;
  font-size: 13px;
  color: #4a4a6a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eph-hw-header .eph-hw-count {
  font-size: 11px;
  background: #f3edff;
  color: #a78bfa;
  padding: 2px 10px;
  border-radius: 10px;
  font-weight: 600;
  white-space: nowrap;
}
.eph-hw-header .eph-arrow {
  font-size: 10px;
  color: #c4b5d9;
  transition: transform 0.25s;
}
.eph-hw-header.open .eph-arrow { transform: rotate(90deg); }

@media (hover: hover) {
  .eph-hw-header:hover { background: #fbf7ff; }
  .eph-paper-item:hover { background: #f4efff; transform: translateX(2px); }
  .eph-close:hover { background: rgba(255,255,255,0.35); transform: rotate(90deg); }
  .eph-tabs button:hover { color: #a78bfa; background: #faf8ff; }
  .eph-paper-item .eph-brush-btn:hover { transform: translateY(-1px); box-shadow: 0 3px 10px rgba(110, 231, 183, 0.45); }
  .eph-about .eph-about-section a:hover { text-decoration: underline; }
}

.eph-paper-list {
  display: none;
  padding: 0 10px 10px;
}
.eph-paper-list.open { display: block; }

.eph-paper-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  margin-bottom: 4px;
  border-radius: 12px;
  background: #faf8ff;
  transition: all 0.2s;
  gap: 8px;
}
.eph-paper-item:last-child { margin-bottom: 0; }
.eph-paper-item .eph-paper-info {
  flex: 1;
  min-width: 0;
}
.eph-paper-item .eph-paper-title {
  font-size: 13px;
  font-weight: 500;
  color: #4a4a6a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eph-paper-item .eph-paper-meta {
  font-size: 11px;
  color: #b8a9c9;
  margin-top: 2px;
}
.eph-paper-item .eph-brush-btn {
  padding: 5px 14px;
  border: none;
  border-radius: 20px;
  font-size: 12px;
  cursor: pointer;
  background: linear-gradient(135deg, #86efac 0%, #6ee7b7 100%);
  color: #fff;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.2s;
  box-shadow: 0 2px 6px rgba(110, 231, 183, 0.3);
}
.eph-paper-item .eph-brush-btn:disabled {
  background: #d1d5db;
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
}
.eph-paper-item .eph-brush-btn.brushing {
  background: linear-gradient(135deg, #fde68a 0%, #fbbf24 100%);
  box-shadow: 0 2px 8px rgba(251, 191, 36, 0.35);
  animation: pulse 1.2s ease-in-out infinite;
}
.eph-paper-item .eph-brush-btn.done {
  background: linear-gradient(135deg, #86efac 0%, #6ee7b7 100%);
  cursor: default;
  box-shadow: none;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.96); }
}

.eph-empty {
  padding: 50px 20px;
  text-align: center;
  color: #c4b5d9;
  font-size: 14px;
  line-height: 2;
}
.eph-empty::before {
  content: "📝";
  display: block;
  font-size: 32px;
  margin-bottom: 8px;
}

#eph-progress {
  position: fixed;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  right: max(400px, env(safe-area-inset-right, 0px));
  z-index: 999999;
  background: #fff;
  border-radius: 16px;
  padding: 14px 20px;
  box-shadow: 0 8px 32px rgba(167, 139, 250, 0.18);
  max-width: min(280px, 80vw);
  font-size: 13px;
  color: #4a4a6a;
  display: none;
  font-family: "Microsoft YaHei", sans-serif;
  border: 1px solid #f3edff;
}
#eph-progress.show { display: block; }
@media (max-width: 480px) {
  #eph-progress {
    right: 16px;
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    max-width: calc(100vw - 32px);
  }
}
#eph-progress .eph-prog-title {
  font-weight: 700;
  margin-bottom: 4px;
  color: #7c3aed;
}
#eph-progress .eph-prog-msg {
  color: #a78bfa;
  font-size: 12px;
}

.eph-about {
  flex: 1;
  overflow-y: auto;
  padding: 24px 20px;
  text-align: center;
  scrollbar-width: thin;
  scrollbar-color: #e8dff5 #fef9ff;
}
.eph-about::-webkit-scrollbar { width: 4px; }
.eph-about::-webkit-scrollbar-track { background: #fef9ff; }
.eph-about::-webkit-scrollbar-thumb { background: #e8dff5; border-radius: 4px; }

.eph-about .eph-about-avatar {
  font-size: 48px;
  margin-bottom: 8px;
}
.eph-about .eph-about-name {
  font-size: 18px;
  font-weight: 700;
  color: #4a4a6a;
  margin-bottom: 4px;
}
.eph-about .eph-about-desc {
  font-size: 13px;
  color: #b8a9c9;
  margin-bottom: 20px;
  line-height: 1.6;
}

.eph-about .eph-about-section {
  background: #fff;
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 12px;
  border: 1px solid #f3edff;
  text-align: left;
}
.eph-about .eph-about-section h3 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #a78bfa;
  font-weight: 700;
}
.eph-about .eph-about-section a {
  color: #818cf8;
  text-decoration: none;
  font-weight: 600;
}
.eph-about .eph-about-link-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f8f4ff;
  font-size: 13px;
}
.eph-about .eph-about-link-item:last-child {
  border-bottom: none;
}
.eph-about .eph-about-rate-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
}
.eph-about .eph-about-rate-item .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a78bfa;
  flex-shrink: 0;
}

.eph-tabs {
  display: flex;
  border-bottom: 1px solid #f3edff;
  background: #fff;
}
.eph-tabs button {
  flex: 1;
  padding: 10px 0;
  border: none;
  background: transparent;
  font-size: 12px;
  color: #b8a9c9;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.eph-tabs button.active {
  color: #a78bfa;
  border-bottom: 2px solid #a78bfa;
}
`;
        document.head.appendChild(style);
    }

    function createPanel(cbs) {
        injectStyles();
        const toggle = document.createElement("button");
        toggle.id = "eph-toggle";
        toggle.textContent = "📋";
        const panel = document.createElement("div");
        panel.id = "eph-panel";
        const header = document.createElement("div");
        header.className = "eph-header";
        header.innerHTML = `<h2>升学e网通习题&试卷</h2>`;
        const closeBtn = document.createElement("button");
        closeBtn.className = "eph-close";
        closeBtn.textContent = "✕";
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // ========== 标签栏 ==========
        const tabs = document.createElement("div");
        tabs.className = "eph-tabs";
        const tabMain = document.createElement("button");
        tabMain.textContent = "📋 任务";
        tabMain.className = "active";
        const tabAbout = document.createElement("button");
        tabAbout.textContent = "ℹ️ 关于";
        tabs.appendChild(tabMain);
        tabs.appendChild(tabAbout);
        panel.appendChild(tabs);

        const mainView = document.createElement("div");
        mainView.className = "eph-view active";
        mainView.id = "eph-view-main";
        const toolbar = document.createElement("div");
        toolbar.className = "eph-toolbar";

        const refreshBtn = document.createElement("button");
        refreshBtn.textContent = "🔄 刷新列表";
        toolbar.appendChild(refreshBtn);

        const brushAllBtn = document.createElement("button");
        brushAllBtn.id = "eph-brush-all";
        brushAllBtn.textContent = "🚀 一键刷取";
        brushAllBtn.addEventListener("click", () => cbs.onBrushAll());
        toolbar.appendChild(brushAllBtn);

        const stopBtn = document.createElement("button");
        stopBtn.id = "eph-stop";
        stopBtn.textContent = "⏹ 停止";
        stopBtn.disabled = true;
        stopBtn.addEventListener("click", () => cbs.onStop());
        toolbar.appendChild(stopBtn);

        mainView.appendChild(toolbar);

        // v1.0.4：强制重刷独立一行（位于刷新/刷取/停止下方）
        // 仅对习题有效：204课后习题走官方 reAnswerPaper 重做（绑定自动更新）；
        // 205试卷任务成绩固化，重刷仅生成满分报告，无法改写任务成绩
        const redoBar = document.createElement("div");
        redoBar.className = "eph-toolbar";
        redoBar.style.cssText = "padding:6px 16px 10px;gap:6px;flex-wrap:wrap;";
        const redoLabel = document.createElement("label");
        redoLabel.className = "eph-redo-label";
        redoLabel.style.cssText = "display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#666;cursor:pointer;user-select:none;";
        redoLabel.title = "仅对204课后习题有效：重刷后任务入口自动绑定最新报告；205试卷任务成绩固化无法改写";
        const redoCheck = document.createElement("input");
        redoCheck.type = "checkbox";
        redoCheck.id = "eph-force-redo";
        redoCheck.style.cssText = "accent-color:#1677ff;width:14px;height:14px;";
        redoCheck.addEventListener("change", () => {
            forceRedo = redoCheck.checked;
            // 重新渲染当前列表，使已完成任务的按钮变为「重做」可点（用 createPanel 局部变量 listContainer）
            if (typeof groupsCache !== "undefined" && groupsCache.length) {
                renderPaperList(listContainer, groupsCache, cbs.onBrushPaper || brushPaper);
            }
            console.log(`[强制重刷] ${forceRedo ? "开启" : "关闭"}`);
        });
        redoLabel.appendChild(redoCheck);
        redoLabel.appendChild(document.createTextNode("强制重刷"));
        const redoNote = document.createElement("span");
        redoNote.style.cssText = "font-size:11px;color:#b8a9c9;";
        redoNote.textContent = "（仅对习题有效）";
        redoBar.appendChild(redoLabel);
        redoBar.appendChild(redoNote);
        mainView.appendChild(redoBar);

        // v1.0.4：速度设置（🟢快 / 🟡中 / 🐢稳），切换即时生效，选择持久化到 localStorage
        const SPEEDS = {
            fast: { label: "🟢 快", conc: { BRUSH: Infinity, ANSWER: 30, SCAN: 8 } },
            mid:  { label: "🟡 中", conc: { BRUSH: 20, ANSWER: 15, SCAN: 5 } },
            slow: { label: "🐢 稳", conc: { BRUSH: 10, ANSWER: 10, SCAN: 4 } }
        };
        const applySpeed = (key) => {
            const s = SPEEDS[key] || SPEEDS.mid;
            CONCURRENCY.BRUSH = s.conc.BRUSH;
            CONCURRENCY.ANSWER = s.conc.ANSWER;
            CONCURRENCY.SCAN = s.conc.SCAN;
            console.log(`[速度] ${s.label}：BRUSH=${CONCURRENCY.BRUSH}, ANSWER=${CONCURRENCY.ANSWER}, SCAN=${CONCURRENCY.SCAN}`);
        };
        const speedBar = document.createElement("div");
        speedBar.className = "eph-toolbar";
        speedBar.style.cssText = "padding:6px 16px 10px;gap:6px;align-items:center;";
        const speedLabel = document.createElement("span");
        speedLabel.style.cssText = "font-size:12px;color:#666;";
        speedLabel.textContent = "速度：";
        const speedSelect = document.createElement("select");
        speedSelect.id = "eph-speed";
        speedSelect.style.cssText = "font-size:12px;padding:3px 8px;border:1px solid #e8dff5;border-radius:8px;color:#4a4a6a;background:#fff;cursor:pointer;";
        for (const [key, s] of Object.entries(SPEEDS)) {
            const opt = document.createElement("option");
            opt.value = key;
            opt.textContent = s.label;
            speedSelect.appendChild(opt);
        }
        speedSelect.value = localStorage.getItem("eph-speed") || "mid";
        applySpeed(speedSelect.value);
        speedSelect.addEventListener("change", () => {
            applySpeed(speedSelect.value);
            localStorage.setItem("eph-speed", speedSelect.value);
        });
        const speedNote = document.createElement("span");
        speedNote.style.cssText = "font-size:11px;color:#b8a9c9;";
        speedNote.textContent = "快=全速并发 · 中=均衡 · 稳=低并发防风控";
        speedBar.appendChild(speedLabel);
        speedBar.appendChild(speedSelect);
        speedBar.appendChild(speedNote);
        mainView.appendChild(speedBar);

        const statusBar = document.createElement("div");
        statusBar.className = "eph-status";
        statusBar.textContent = "点击「刷新列表」获取任务";
        mainView.appendChild(statusBar);
        const listContainer = document.createElement("div");
        listContainer.className = "eph-list";
        mainView.appendChild(listContainer);
        panel.appendChild(mainView);

        // ========== 关于页面 ==========
        const aboutView = document.createElement("div");
        aboutView.className = "eph-view";
        aboutView.id = "eph-view-about";
        const aboutContent = document.createElement("div");
        aboutContent.className = "eph-about";
        aboutContent.innerHTML = `
          <div class="eph-about-avatar">🌸</div>
          <div class="eph-about-name">升学e网通 试卷及习题助手 <span style="font-size:12px;color:#a78bfa;font-weight:600;">v1.0.7</span></div>
          <div class="eph-about-desc">支持一键获取E网通试卷及习题答案并自动填写提交<br/>全部免费 🆓</div>

          <div class="eph-about-section">
            <h3>📢 使用须知</h3>
            <div class="eph-about-rate-item"><span class="dot"></span> 支持一键提交，提交后自动批改，满分完成</div>
            <div class="eph-about-rate-item"><span class="dot"></span> 支持独立试卷与课程任务</div>
            <div class="eph-about-rate-item"><span class="dot"></span> 使用本工具即代表同意合理使用</div>
          </div>

                    <div class="eph-about-section">
            <h3>✨ v1.0.7 更新内容</h3>
            <div class="eph-about-rate-item"><span class="dot"></span> 修复关于页 HTML 结构：更新内容 section 独立成块，边框显示正常</div>
            <div class="eph-about-rate-item"><span class="dot"></span> userId 模块级缓存：刷一套卷只请求 1 次（原 3-5 次），更快更稳</div>
            <div class="eph-about-rate-item"><span class="dot"></span> 核心 API 全面接入指数退避重试：报告/题目/答案/提交接口网络抖动自动重试</div>
            <div class="eph-about-rate-item"><span class="dot"></span> 相关链接补充 Zoan 的 Greasy Fork 安装地址</div>
          </div>
          <div class="eph-about-section">
            <h3>👨‍💻 作者团队</h3>
            <div class="eph-about-rate-item"><span class="dot"></span> <strong>🌸 风月同天</strong> — 原始脚本参考 &amp; UI设计</div>
            <div class="eph-about-rate-item"><span class="dot"></span> <strong>🍥 志成</strong> — 答案获取核心 &amp; 数据结构</div>
            <div class="eph-about-rate-item"><span class="dot"></span> <strong>⚡ Zoan</strong> — 整合优化 &amp; 混合题型支持</div>
          </div>

          <div class="eph-about-section">
            <h3>🔗 相关链接</h3>

            <!-- 风月同天 -->
            <div style="margin-bottom:10px;">
              <div style="font-weight:600; font-size:13px; color:#4a4a6a;">🌸 风月同天</div>
              <div class="eph-about-link-item"><span>📝 博客</span><a href="https://www.zkzxgzb.com/news/blog/bdcd86c" target="_blank">前往访问</a></div>
              <div class="eph-about-link-item"><span>💬 TG 机器人</span><a href="https://t.me/ewtkillbot" target="_blank">EWT刷课机器人</a></div>
              <div class="eph-about-link-item"><span>📦 源码仓库</span><a href="https://github.com/ZZ0YY/EWT-TOOL" target="_blank">GitHub</a></div>
              <div class="eph-about-link-item"><span>📥 Greasy Fork</span><a href="https://greasyfork.org/zh-CN/scripts/587786" target="_blank">安装页面</a></div>
            </div>

            <!-- 志成 -->
            <div style="margin-bottom:10px;">
              <div style="font-weight:600; font-size:13px; color:#4a4a6a;">🍥 志成</div>
              <div class="eph-about-link-item"><span>🏠 主页</span><a href="https://zhicheng233.top" target="_blank">前往访问</a></div>
              <div class="eph-about-link-item"><span>📝 博客</span><a href="https://blog.zhicheng233.top" target="_blank">前往访问</a></div>
              <div class="eph-about-link-item"><span>📦 源码仓库</span><a href="https://github.com/zhicheng233/GetEWTAnswers" target="_blank">GitHub</a></div>
              <div class="eph-about-link-item"><span>📥 Greasy Fork</span><a href="https://greasyfork.org/zh-CN/scripts/524802" target="_blank">安装页面</a></div>
            </div>

            <!-- Zoan -->
            <div>
              <div style="font-weight:600; font-size:13px; color:#4a4a6a;">⚡ Zoan</div>
              <div class="eph-about-link-item"><span>📧 QQ</span><a href="https://qm.qq.com/cgi-bin/qm/qr?k=Ok_Wy_7bW0yMS9MrXLOp8PW0Ci0Gcn9A" target="_blank">1478359473</a></div>
              <div class="eph-about-link-item"><span>📧 Gmail</span><a href="mailto:zoan0404@gmail.com">zoan0404@gmail.com</a></div>
              <div class="eph-about-link-item"><span>📥 Greasy Fork</span><a href="https://greasyfork.org/zh-CN/scripts/591256" target="_blank">安装页面</a></div>
            </div>
          </div>
        `;
        aboutView.appendChild(aboutContent);
        panel.appendChild(aboutView);

        const progress = document.createElement("div");
        progress.id = "eph-progress";
        progress.innerHTML = `<div class="eph-prog-title"></div><div class="eph-prog-msg"></div>`;
        document.body.appendChild(progress);

        function showView(id) {
            mainView.classList.toggle("active", id === "eph-view-main");
            aboutView.classList.toggle("active", id === "eph-view-about");
            tabMain.classList.toggle("active", id === "eph-view-main");
            tabAbout.classList.toggle("active", id === "eph-view-about");
        }
        tabMain.onclick = () => showView("eph-view-main");
        tabAbout.onclick = () => showView("eph-view-about");

        let isOpen = false;
        toggle.onclick = () => { isOpen = !isOpen; panel.classList.toggle("open", isOpen); };
        closeBtn.onclick = () => { isOpen = false; panel.classList.remove("open"); };
        refreshBtn.onclick = async () => {
            refreshBtn.disabled = true;
            refreshBtn.textContent = "⏳ 加载中...";
            statusBar.textContent = "正在重新扫描...";
            try {
                await cbs.onRefresh();
                statusBar.textContent = "✅ 已更新";
            } catch (e) {
                statusBar.textContent = `❌ ${e.message?.slice(0, 40) ?? "加载失败"}`;
                console.error("刷新失败:", e);
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.textContent = "🔄 刷新列表";
            }
        };

        document.body.appendChild(toggle);
        document.body.appendChild(panel);

        // 默认显示主视图
        showView("eph-view-main");

        return {
            panel, listContainer, statusBar, progress, refreshBtn, brushAllBtn, stopBtn,
            show() { isOpen = true; panel.classList.add("open"); },
            hide() { isOpen = false; panel.classList.remove("open"); }
        };
    }

    function renderPaperList(container, groups, onBrush) {
        container.innerHTML = "";
        if (!groups.length) {
            container.innerHTML = "<div class=\"eph-empty\">暂无课后练习</div>";
            return;
        }
        for (const group of groups) {
            const item = document.createElement("div");
            item.className = "eph-hw-item";
            const hd = document.createElement("div");
            hd.className = "eph-hw-header";
            hd.innerHTML = `<span class="eph-hw-title">${escapeHtml(group.title)}</span>
                            <span class="eph-hw-count">${group.papers.length}个</span>
                            <span class="eph-arrow">▶</span>`;
            const list = document.createElement("div");
            list.className = "eph-paper-list";
            for (const paper of group.papers) {
                const paperKey = `${paper.paperId}:${paper.bizCode}`;
                const pi = document.createElement("div");
                pi.className = "eph-paper-item";
                pi.dataset.paperKey = paperKey;
                const info = document.createElement("div");
                info.className = "eph-paper-info";
                const typeLabel = paper.type ? `[${paper.type}] ` : "";
                const doneLabel = paper.done ? " ✅" : "";
                const qCount = paper.questionCount ?? "?";
                info.innerHTML = `<div class="eph-paper-title">${typeLabel}${escapeHtml(paper.title)}${doneLabel}</div>
                                  <div class="eph-paper-meta">${qCount}题${paper.subjectName ? ` · ${escapeHtml(paper.subjectName)}` : ""}${paper.dayLabel ? ` · 📅 ${escapeHtml(paper.dayLabel)}` : ""}</div>`;
                pi.appendChild(info);
                const btn = document.createElement("button");
                btn.className = "eph-brush-btn";
                // v1.0.5：默认已完成禁用；开启「强制重刷」后显示「重做」并允许点击（试卷/习题均可 initReport 新建报告）
                btn.textContent = paper.brushing ? "⏳" : (paper.done ? (forceRedo ? "重做" : "✅") : "刷");
                btn.disabled = !!paper.brushing || (!!paper.done && !forceRedo);
                btn.onclick = () => {
                    if (!paper.brushing && (!paper.done || forceRedo)) {
                        paper.brushing = true;
                        btn.className = "eph-brush-btn brushing";
                        btn.textContent = "⏳";
                        btn.disabled = true;
                        onBrush(paper);
                    }
                };
                pi.appendChild(btn);
                list.appendChild(pi);
            }
            hd.onclick = () => { hd.classList.toggle("open"); list.classList.toggle("open"); };
            item.appendChild(hd);
            item.appendChild(list);
            container.appendChild(item);
        }
    }

    function showProgress(el, title, msg) {
        el.classList.add("show");
        el.querySelector(".eph-prog-title").textContent = title;
        el.querySelector(".eph-prog-msg").textContent = msg;
    }
    function hideProgress(el) { el.classList.remove("show"); }

    // ==================== 主程序 ====================
    let panel;
    let groupsCache = [];
    let isBrushingAll = false;
    let stopRequested = false;
    let forceRedo = false;   // v1.0.5：强制重刷开关（试卷/习题均可强制重做）

    async function brushAll() {
        if (isBrushingAll) {
            console.warn("一键刷取正在运行，请勿重复点击");
            return;
        }
        const todo = [];
        for (const group of groupsCache) {
            for (const paper of group.papers) {
                // v1.0.5：默认跳过已完成；开启「强制重刷」后所有任务都刷（试卷/习题均可 initReport 新建报告重做）
                if (!paper.brushing && (!paper.done || forceRedo)) todo.push(paper);
            }
        }
        if (todo.length === 0) {
            panel.statusBar.textContent = "🎉 所有任务已完成";
            console.log("[一键刷取] 所有任务已完成");
            return;
        }

        isBrushingAll = true;
        stopRequested = false;
        const brushAllBtn = panel.brushAllBtn;
        const stopBtn = panel.stopBtn;
        brushAllBtn.disabled = true;
        stopBtn.disabled = false;

        let successCount = 0, failCount = 0, skipCount = 0;
        console.log(`[一键刷取] 共 ${todo.length} 个待刷任务，并发=${CONCURRENCY.BRUSH}`);

        await mapLimit(todo, CONCURRENCY.BRUSH, async (paper, i) => {
            if (stopRequested) { skipCount++; return; }
            const indexMsg = `(${i + 1}/${todo.length})`;
            panel.statusBar.textContent = `🔄 正在刷取 ${indexMsg}: ${paper.title}`;
            showProgress(panel.progress, `总体进度 ${indexMsg}`, `正在刷: ${paper.title}`);
            console.log(`[一键刷取] 开始 ${indexMsg} ${paper.title} (paperId=${paper.paperId}, bizCode=${paper.bizCode})`);
            const startTime = Date.now();
            try {
                await brushPaper(paper);
                successCount++;
                console.log(`[一键刷取] ✅ ${indexMsg} 成功 (耗时 ${((Date.now() - startTime) / 1000).toFixed(1)}s): ${paper.title}`);
            } catch (e) {
                failCount++;
                console.error(`[一键刷取] ❌ ${indexMsg} 失败: ${paper.title}`, e);
                panel.statusBar.textContent = `❌ 失败 ${indexMsg}: ${paper.title}`;
                await sleep(300);   // 优化：缩短失败等待
            }
        }, () => stopRequested);

        const msg = stopRequested
            ? `⏹ 已停止，成功 ${successCount}，失败 ${failCount}，跳过 ${skipCount}`
            : `✅ 一键刷取完成，成功 ${successCount}，失败 ${failCount}`;
        panel.statusBar.textContent = msg;
        showProgress(panel.progress, stopRequested ? "⏹ 已停止" : "✅ 完成", `成功 ${successCount}，失败 ${failCount}${skipCount ? `，跳过 ${skipCount}` : ""}`);
        console.log(`[一键刷取] ${msg}`);
        setTimeout(() => hideProgress(panel.progress), 5000);

        isBrushingAll = false;
        brushAllBtn.disabled = false;
        stopBtn.disabled = true;
    }

    async function loadPapers() {
        console.group(`[加载列表]`);
        if (!getToken()) {
            console.error("未登录");
            console.groupEnd();
            throw new Error("未登录");
        }
        const currentTask = getCurrentPageTask();
        if (currentTask) {
            try {
                const paperId = currentTask.paperId;
                let bizCode = currentTask.bizCode || BIZ.EXERCISE;
                // v1.0.7fix：URL bizCode=201（VIEW）不可信 → 探测真实作答类型（204 习题优先，205 试卷兜底）
                // 204/205 均探测失败时回退 201（VIEW 浏览码）：该报告在浏览场景下存在，analysis 兼容 201，聊胜于无
                if (!currentTask.bizCode) {
                    const probeToken = getToken();
                    try {
                        await getReportId(paperId, BIZ.EXERCISE, probeToken);
                        bizCode = BIZ.EXERCISE;
                        console.log("[识别] URL bizCode=201 → 探测为课后习题(204)");
                    } catch (e) {
                        try {
                            await getReportId(paperId, BIZ.PAPER, probeToken);
                            bizCode = BIZ.PAPER;
                            console.log("[识别] URL bizCode=201 → 探测为试卷(205)");
                        } catch (e2) {
                            console.warn("[识别] 204/205 均无报告，回退 201（VIEW 浏览码，analysis 兼容可继续取答案）:", e2.message);
                            bizCode = BIZ.VIEW;
                        }
                    }
                }
                const homeworkId = currentTask.homeworkId || "0";
                let reportId = currentTask.reportId;
                if (!reportId || reportId === "0") {
                    const token = getToken();
                    reportId = await getReportId(paperId, bizCode, token);
                }
                const token = getToken();
                const paperInfo = await getPaperInfo(paperId, reportId, '1', bizCode, token);
                const reportInfo = await getReportStatus(paperId, reportId, bizCode, token);
                const title = paperInfo.title || "当前任务";
                const questionCount = paperInfo.questionCount ?? "?";
                const done = reportInfo?.finish === true;
                const type = (bizCode === BIZ.EXERCISE) ? "习题" : (bizCode === BIZ.PAPER ? "试卷" : "浏览");

                const paper = { ...currentTask, bizCode, title, questionCount, done, type, brushing: false };
                const group = { homeworkId, title: "当前任务", papers: [paper] };
                groupsCache = [group];
                renderPaperList(panel.listContainer, [group], brushPaper);
                panel.statusBar.textContent = `📄 ${type} ${title} (${questionCount}题，${done ? '已完成' : '未完成'})`;
                console.log(`当前任务详情: 标题=${title}, 题数=${questionCount}, 完成=${done}, 类型=${type}`);
                console.groupEnd();
                return;
            } catch (e) {
                console.error("获取当前任务详情失败，使用DOM降级:", e);
                const papers = [{ ...currentTask, type: (currentTask.bizCode === BIZ.EXERCISE) ? "习题" : "试卷" }];
                const groupTitle = papers[0].homeworkTitle || papers[0].title || "当前任务";
                const groups = [{ homeworkId: currentTask.homeworkId, title: groupTitle, papers }];
                groupsCache = groups;
                renderPaperList(panel.listContainer, groups, brushPaper);
                panel.statusBar.textContent = "已识别当前任务（降级）";
                console.log("当前页面任务（降级）");
                console.groupEnd();
                return;
            }
        }

        const user = await getUserInfo();
        const schoolId = user.schoolId;
        const currentHid = getCurrentHomeworkId();
        let groups = [];

        if (currentHid) {
            panel.statusBar.textContent = "正在扫描当前作业...";
            const homeworks = await getHomeworkList(schoolId);
            let hw = null;
            for (const item of homeworks) {
                if (item.homeworkId === currentHid) { hw = item; break; }
            }
            if (!hw) {
                const titleFromPage = getHomeworkTitleFromUrl();
                hw = { homeworkId: currentHid, title: titleFromPage || `作业 #${currentHid}`, homeworkTitle: titleFromPage || `作业 #${currentHid}` };
            }
            const papers = await scanTasks(schoolId, hw);
            if (papers.length) {
                const groupTitle = hw.homeworkTitle || hw.title || `作业 #${currentHid}`;
                groups.push({ homeworkId: currentHid, title: groupTitle, papers });
            }
        } else {
            panel.statusBar.textContent = `正在获取 ${user.realName} 的作业...`;
            const homeworks = await getHomeworkList(schoolId);
            if (!homeworks.length) {
                panel.statusBar.textContent = "没有找到作业";
                renderPaperList(panel.listContainer, [], () => {});
                groupsCache = [];
                console.log("没有找到任何作业");
                console.groupEnd();
                return;
            }
            panel.statusBar.textContent = `扫描 ${homeworks.length} 个作业...`;
            console.log(`开始扫描 ${homeworks.length} 个作业`);
            await mapLimit(homeworks, CONCURRENCY.SCAN, async (hw) => {
                const papers = await scanTasks(schoolId, hw);
                if (papers.length) {
                    const groupTitle = hw.homeworkTitle || hw.title || `作业 #${hw.homeworkId}`;
                    groups.push({ homeworkId: hw.homeworkId, title: groupTitle, papers });
                }
            });
        }

        groupsCache = groups;
        renderPaperList(panel.listContainer, groups, brushPaper);
        const total = groups.reduce((s, g) => s + g.papers.length, 0);
        panel.statusBar.textContent = `📄 共 ${total} 个练习`;
        console.log(`加载完成，共 ${total} 个练习`);
        console.groupEnd();
    }

    // ===== brushPaper 修改：将 BIZ.VIEW 替换为 paper.bizCode =====
    async function brushPaper(paper) {
        console.group(`[刷题] ${paper.title}`);
        console.log(`paperId=${paper.paperId}, bizCode=${paper.bizCode}, homeworkId=${paper.homeworkId}`);
        showProgress(panel.progress, `正在刷: ${paper.title}`, "初始化报告中...");
        panel.statusBar.textContent = `⏳ ${paper.title} (bizCode=${paper.bizCode})`;
        const startTime = Date.now();
        const token = getToken();
        try {
            // v1.0.4 修复：答案获取与答案提交必须使用不同的报告。
            // 实测根因（本轮实机验证）：
            //   1. getAnswerSheetSubGroup / analysis 仅在报告「已完成」(finish=true) 时才返回正确答案
            //      （新建未完成报告 analysis 返回 rightAnswer:[] / analyse:""）；
            //   2. 锁卷（submitPaper, homeworkId='0'）后报告 finish=true → analysis 立即返回正确答案，
            //      且锁卷报告不参与任务绑定（实测数学卷任务绑定 reportId/score 不变）；
            //   3. 提交报告若与答案源相同，锁卷后答案提交会被服务器丢弃 → 0分。
            // 方案：答案源与提交报告分离；锁卷兜底使用 homeworkId='0' 专用报告（不归属作业，杜绝污染任务成绩）；
            //       204 课后习题的提交报告优先走官方 reAnswerPaper（绑定自动更新），失败降级 initReport。

            // ① 选择答案源报告（已完成报告才支持取答案）
            let answerReportId = null;
            const candidates = [];
            // 优先：URL 上的 reportId（当前页面报告的答卷页，通常是已完成报告）
            if (paper.reportId && paper.reportId !== '0' && paper.reportId !== 'undefined') {
                candidates.push({ id: String(paper.reportId), src: 'URL' });
            }
            // 次选：getReportId() 无参查询返回的最新报告
            candidates.push({ id: 'LATEST', src: 'getReportId' });

            for (const cand of candidates) {
                try {
                    let rid = cand.id;
                    if (rid === 'LATEST') {
                        rid = await getReportId(paper.paperId, paper.bizCode, token);
                    }
                    if (!rid) continue;
                    const st = await getReportStatus(paper.paperId, rid, paper.bizCode, token);
                    if (st && st.finish === true) {
                        answerReportId = rid;
                        console.log(`[刷题] 取答案使用已完成报告 reportId=${rid} (来源: ${cand.src})`);
                        break;
                    }
                    console.log(`[刷题] 候选报告 ${rid} (${cand.src}) 未完成，尝试下一个`);
                } catch (e) {
                    console.warn(`[刷题] 候选报告检查失败 (${cand.src}):`, e.message);
                }
            }

            // 兜底：无已完成报告 → 新建「专用锁卷报告」(homeworkId='0'，不归属作业) 锁卷换取答案
            // 实测：锁卷后 finish=true，analysis 才会返回正确答案；homeworkId='0' 的报告不参与任务绑定
            if (!answerReportId) {
                try {
                    const lockId = await initReport(paper.paperId, '0', paper.bizCode, '1', token);
                    await updateReport(paper.paperId, lockId, paper.bizCode, '1', token);
                    answerReportId = lockId;
                    console.log(`[刷题] 无已完成报告，新建锁卷报告 ${lockId}(homeworkId=0) 换取答案（兜底）`);
                } catch (e) {
                    console.warn('[刷题] 锁卷兜底失败:', e.message);
                }
            }

            // v1.0.4：答案源报告必须存在（无报告则无法取答案），提前中止避免提交空卷
            if (!answerReportId) {
                throw new Error("未获取到答案源报告（既无已完成报告，锁卷兜底也失败），已中止刷取");
            }

            // 获取试卷信息（用于 fullScoreMap / metaMap）
            // 修改：使用 paper.bizCode
            const paperInfo = await getPaperInfo(paper.paperId, answerReportId, '1', paper.bizCode, token);
            const fullScoreMap = new Map();
            const metaMap = new Map();
            const traverseQuestions = (list) => {
                for (const q of list) {
                    const fullScore = q.fullScore !== undefined ? q.fullScore : (q.score !== undefined ? q.score : 0);
                    const qKey = q.id ?? q.questionId;   // 双 key 兼容：部分接口返回 questionId
                    fullScoreMap.set(qKey, fullScore);
                    metaMap.set(qKey, { cate: q.cate ?? q.cateId ?? 1, subjective: q.subjective ?? false });
                    if (q.childQuestions && q.childQuestions.length) {
                        traverseQuestions(q.childQuestions);
                    }
                }
            };
            if (paperInfo && paperInfo.questions) {
                traverseQuestions(paperInfo.questions);
            }

            // v1.0.7fix：优先走 webreport 全量答案（1 次 GET 拿全卷 rightAnswer/analyse/子题），
            // 失败或返回空自动回退 getQuestions + getAnswer 逐题并发方案
            let questions = null;
            let allAnswers = null;
            const webReport = await getWebReportAnswers(paper, answerReportId, paper.bizCode, token);
            if (webReport && webReport.questions && webReport.questions.length) {
                questions = webReport.questions;   // 已归一化 questionId，含全部答案/解析字段
                allAnswers = questions.map(q => ({ question: q, answer: q }));
            } else {
                // 获取题目列表，使用 paper.bizCode
                questions = await getQuestions(paper.paperId, answerReportId, '1', paper.bizCode, token);

                // 禁止空卷：题目列表为空时提前中止，避免无谓的答案请求与空卷提交
                if (!questions || !questions.length) {
                    throw new Error("未获取到题目列表，已禁止空卷提交（可能是新试卷或接口异常）");
                }

                // 优化：并发获取每道题的答案，使用 paper.bizCode
                allAnswers = await mapLimit(
                    questions,
                    CONCURRENCY.ANSWER,
                    async (q) => {
                        const ans = await getAnswer(paper.paperId, answerReportId, q.questionId, paper.bizCode, '1', token);
                        return ans ? { question: q, answer: ans } : null;
                    }
                );
            }

            // 过滤掉 null
            const validAnswers = allAnswers.filter(Boolean);

            // 展开子母题
            const expandedQuestions = [];
            const expandedResults = [];
            for (const item of validAnswers) {
                const q = item.question;
                const ans = item.answer;
                const childQs = ans.childQuestions || [];
                const parentRight = ans.rightAnswer || [];

                if (childQs.length > 0 && parentRight.length === 0) {
                    const groupName = q.groupName;
                    childQs.forEach((child) => {
                        const childId = child.questionId;
                        const fullScore = fullScoreMap.get(childId) || 0;
                        const childRight = child.rightAnswer || [];
                        const childAnalyse = child.analyse || '';
                        const childKnowledge = child.knowledgeTitle || ans.knowledgeTitle || '';
                        const childImages = child.attachmentImages || [];
                        const meta = metaMap.get(childId);
                        const cate = meta ? meta.cate : (q.cateId || 1);
                        const subjective = meta ? meta.subjective : (q.subjective || false);

                        const newQ = {
                            questionId: childId,
                            questionNumber: '',
                            cateId: cate,
                            subjective: subjective,
                            groupName: groupName,
                            fullScore: fullScore,
                            score: child.score || fullScore || 0,
                        };
                        expandedQuestions.push(newQ);

                        const opts = extractOpts(childRight);
                        let answerStr;
                        if (opts.length) {
                            answerStr = opts.join(', ');
                        } else if (childRight.length) {
                            if (childRight.length > 1) {
                                const cleaned = childRight.map((item, idx) => (idx+1) + '、' + cleanHtmlKeepImg(item) + ';');
                                answerStr = cleaned.join('<br>');
                            } else {
                                answerStr = cleanHtmlKeepImg(childRight[0]);
                            }
                        } else {
                            answerStr = '(主观题)';
                        }

                        expandedResults.push({
                            num: '',
                            group: groupName,
                            answer: answerStr,
                            knowledge: childKnowledge,
                            analysis: cleanHtmlKeepImg(childAnalyse),
                            images: childImages,
                            rawRightAnswer: childRight,
                            questionId: childId,
                            subjective: subjective,
                        });
                    });
                } else {
                    const fullScore = fullScoreMap.get(q.questionId) || 0;
                    const opts = extractOpts(ans.rightAnswer || []);
                    let answerStr;
                    if (opts.length) {
                        if (opts.length > 1) {
                            const allSingle = opts.every(o => /^[A-Z]$/.test(o));
                            if (allSingle) {
                                answerStr = opts.map((o, idx) => (idx+1) + '、' + o + ';').join('<br>');
                            } else {
                                answerStr = opts.join(', ');
                            }
                        } else {
                            answerStr = opts.join(', ');
                        }
                    } else if (ans.rightAnswer && ans.rightAnswer.length) {
                        const raw = ans.rightAnswer;
                        if (raw.length > 1) {
                            const cleaned = raw.map((item, idx) => (idx+1) + '、' + cleanHtmlKeepImg(item) + ';');
                            answerStr = cleaned.join('<br>');
                        } else {
                            answerStr = cleanHtmlKeepImg(raw[0]);
                        }
                    } else {
                        answerStr = '(主观题)';
                    }

                    expandedQuestions.push({
                        ...q,
                        cateId: q.cateId || 1,
                        subjective: q.subjective || false,
                        fullScore: fullScore,
                        score: ans.score || fullScore || 0,
                    });
                    expandedResults.push({
                        num: '',
                        group: q.groupName,
                        answer: answerStr,
                        knowledge: (ans.knowledges || []).map(k => k.title).join('、'),
                        analysis: cleanHtmlKeepImg(ans.analyse || ''),
                        images: ans.attachmentImages || [],
                        rawRightAnswer: ans.rightAnswer || [],
                        questionId: q.questionId,
                        subjective: q.subjective || false,
                    });
                }
            }

            expandedQuestions.forEach((q, idx) => {
                q.questionNumber = String(idx + 1);
            });
            expandedResults.forEach((r, idx) => {
                r.num = String(idx + 1);
            });

            fixGroupAnswers(expandedResults);

            // 空卷保护：未获取到任何题目/答案时中止提交，避免提交空卷
            if (!expandedQuestions.length || !expandedResults.length) {
                throw new Error("未获取到任何题目/答案，已中止提交（可能是新试卷或接口异常）");
            }

            // ② 创建提交报告（与答案来源分离；答案提交用独立新报告，避免锁卷后提交被丢弃）
            // v1.0.4 顺序修正：必须在「取完答案」之后创建提交报告——
            // reAnswerPaper 会转移旧报告「作答权」，若先调用可能使答案源旧报告失效（实测题2答案变空）
            let submitReportId = null;
            // v1.0.4：204（课后习题）优先走官方 reAnswerPaper 通道重做——
            // 实测：reAnswerPaper 生成新报告后，任务入口自动绑定最新报告（用户观察的核心机制）；
            // 205（试卷）服务器返回 7771522「该场景不支持再次作答」，自动降级 initReport
            if (paper.bizCode === BIZ.EXERCISE && answerReportId) {
                try {
                    submitReportId = await reAnswerPaper(answerReportId, token);
                    console.log(`[刷题] 204习题走官方重做通道 reAnswerPaper，新报告 ${submitReportId}（绑定将自动更新）`);
                } catch (e) {
                    console.warn(`[刷题] reAnswerPaper 失败（${e.message}），降级 initReport 新建报告`);
                }
            }
            if (!submitReportId) {
                submitReportId = await initReport(paper.paperId, paper.homeworkId, paper.bizCode, '1', token);
            }

            // 提交时传入 submitReportId
            await submitAllAndCorrect(paper.paperId, '1', paper.bizCode, expandedQuestions, expandedResults, paper.homeworkId, token, submitReportId);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[刷题] ✅ 提交完成 (耗时 ${elapsed}s): ${paper.title}`);
            // v1.0.4：205已完成试卷任务绑定固化提示（实测服务器拒绝重做 7771522，满分报告不更新任务成绩）
            let doneMsg = `《${paper.title}》已提交 (${elapsed}s)`;
            if (paper.done && paper.bizCode === BIZ.PAPER) {
                doneMsg = `《${paper.title}》已生成新满分报告，但已完成试卷任务成绩固化（服务器限制），任务成绩不会更新`;
                console.warn(`[刷题] ⚠️ ${doneMsg}`);
            }
            showProgress(panel.progress, "✅ 完成", doneMsg);
            panel.statusBar.textContent = `✅ ${paper.title} 完成`;
            markPaperDone(paper);
            setTimeout(() => hideProgress(panel.progress), 3000);
            console.groupEnd();
        } catch (e) {
            console.error(`[刷题] ❌ 失败: ${paper.title}`, e);
            showProgress(panel.progress, "❌ 失败", e.message);
            panel.statusBar.textContent = `❌ ${paper.title} 失败`;
            setTimeout(() => hideProgress(panel.progress), 5000);
            console.groupEnd();
            throw e;
        }
    }

    function markPaperDone(paper) {
        const paperKey = `${paper.paperId}:${paper.bizCode}`;
        const items = document.querySelectorAll(".eph-paper-item");
        items.forEach(item => {
            if (item.dataset.paperKey === paperKey) {
                const btn = item.querySelector(".eph-brush-btn");
                const titleEl = item.querySelector(".eph-paper-title");
                if (btn) {
                    btn.className = "eph-brush-btn done";
                    btn.textContent = "✅";
                    btn.disabled = true;
                }
                if (titleEl && !titleEl.textContent.includes("✅")) titleEl.textContent += " ✅";
                paper.done = true;
            }
        });
    }

    if (!getToken()) {
        console.warn("[EWT Helper] 未登录，脚本未启动");
        const tip = document.createElement("div");
        tip.style.cssText = "position:fixed;right:16px;bottom:calc(80px + env(safe-area-inset-bottom,0px));z-index:999999;background:linear-gradient(135deg,#f9a8d4,#a78bfa);color:#fff;padding:12px 18px;border-radius:14px;font-size:13px;font-weight:600;box-shadow:0 6px 24px rgba(167,139,250,.45);font-family:'Microsoft YaHei',sans-serif;";
        tip.textContent = "🔑 未登录升学e网通，脚本未启动";
        document.body.appendChild(tip);
        setTimeout(() => tip.remove(), 8000);
    } else {
        panel = createPanel({
            onRefresh: loadPapers,
            onBrushPaper: brushPaper,
            onBrushAll: brushAll,
            onStop: () => {
                stopRequested = true;
                panel.statusBar.textContent = "⏹ 正在停止...（完成当前任务后停止）";
                console.log("[一键刷取] 收到停止请求");
            }
        });
        panel.show();
        console.log("[EWT Helper] 已启动，版本 v1.0.7");
        loadPapers().catch(e => {
            if (e instanceof TokenExpiredError) {
                console.error("[登录过期]", e.message);
                panel.statusBar.textContent = "🔑 登录已过期，请刷新页面重新登录";
                if (typeof GM_notification === "function") {
                    GM_notification({ title: "升学e网通刷课助手", text: "登录已过期，请重新登录", timeout: 5000 });
                }
            } else {
                console.error("[初始化加载失败]", e);
                panel.statusBar.textContent = "❌ 加载失败，请点击刷新列表重试";
            }
        });
    }
})();
