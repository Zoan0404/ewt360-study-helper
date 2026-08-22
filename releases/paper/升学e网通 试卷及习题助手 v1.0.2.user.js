// ==UserScript==
// @name         升学e网通 试卷及习题助手
// @namespace    ewt360-study-helper-opt
// @version      1.0.2
// @author       风月同天🌸 & 志成🍥 (optimized by ⚡Zoan)
// @description  采用志成🍥 的答案获取与风月同天🌸 的脚本参考及UI页面，由⚡Zoan进行整合并支持子母题型 混合题型 并且提供扫描功能，支持检测完成状态，完成禁止再次刷，优化提交功能，进一步优化速度；修复刷题时使用试卷自身bizCode避免reportId为null的问题。
// @license      ISC
// @match        https://web.ewt360.com/*
// @match        https://teacher.ewt360.com/*
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
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
    const CONCURRENCY = { BRUSH: Infinity, ANSWER: 10, SCAN: 3 };

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
            GM_xmlhttpRequest({
                method, url, headers,
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
        console.log(`${logPrefix} 请求头:`, headers);
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
        const url = `${BASE}/api/answerprod/web/answer/report?paperId=${paperId}&platform=1&bizCode=${bizCode}&token=${token}`;
        const resp = await fetch(url, { headers: { 'User-Agent': UA } });
        const data = await resp.json();
        if (!data.success) throw new Error(JSON.stringify(data));
        return data.data.reportId;
    }

    async function getReportStatus(paperId, reportId, bizCode, token) {
        try {
            const url = `${BASE}/api/answerprod/web/answer/report?paperId=${paperId}&platform=1&bizCode=${bizCode}&reportId=${reportId}&isRepeat=1`;
            const resp = await fetch(url, { headers: { 'User-Agent': UA, token } });
            const data = await resp.json();
            if (!data.success) { console.warn('[报告状态] 获取失败:', data.msg || 'unknown'); return {}; }
            return data.data || {};
        } catch (e) {
            console.warn('[报告状态] 获取异常:', e.message);
            return {};
        }
    }

    async function getUserId() {
        const url = `${BASE}/api/usercenter/user/baseinfo`;
        const resp = await fetch(url, { headers: { 'Content-Type': 'application/json', token: getToken(), 'User-Agent': UA } });
        const data = await resp.json();
        if (!data.success) throw new Error(JSON.stringify(data));
        return data.data.userId;
    }

    async function getQuestions(paperId, reportId, platform, bizCode, token) {
        const url = `${BASE}/api/answerprod/common/answer/sheet/getAnswerSheetSubGroup`;
        const body = { paperId, reportId, platform, bizCode, homeworkId: '0', client: 4 };
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', token, 'User-Agent': UA }, body: JSON.stringify(body) });
        const data = await resp.json();
        const questions = [];
        if (!data.success) {
            const userId = await getUserId();
            const url = `${BASE}/api/answerprod/common/answer/answerSheetInfo`;
            const body = { paperId, reportId, platform, bizCode, userId, client: 1 };
            const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', token, 'User-Agent': UA }, body: JSON.stringify(body) });
            const data = await resp.json();
            for (const q of data.data.questionInfoList) {
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
            for (const group of data.data.groupQuestionList) {
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
        throw new Error(JSON.stringify(data));
    }

    async function updateReport(paperId, reportId, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/submitpaper`;
        const body = { paperId, reportId, bizCode, platform, totalSeconds: 600, homeworkId: '0' };
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', token, 'User-Agent': UA }, body: JSON.stringify(body) });
        const data = await resp.json();
        if (!data.success) throw new Error(JSON.stringify(data));
    }

    async function getAnswer(paperId, reportId, questionId, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/simple/question/analysis`;
        const body = { paperId, reportId, platform, questionId, bizCode, homeworkId: '0', client: 4 };
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', token, 'User-Agent': UA }, body: JSON.stringify(body) });
        const data = await resp.json();
        return data.success ? data.data : null;
    }

    async function getPaperInfo(paperId, reportId, platform, bizCode, token) {
        const url = `${BASE}/api/answerprod/web/answer/paper?paperId=${paperId}&platform=${platform}&reportId=${reportId}&bizCode=${bizCode}`;
        const resp = await fetch(url, { headers: { 'User-Agent': UA, 'token': token } });
        const data = await resp.json();
        if (!data.success) throw new Error(data.msg || '获取试卷信息失败');
        return data.data;
    }

    // ---------- 脚本提交核心 ----------
    async function initReport(paperId, homeworkId, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/report?paperId=${paperId}&platform=${platform}&bizCode=${bizCode}&reportId=0&isRepeat=0&homeworkId=${homeworkId}`;
        let resp = await fetch(url, { headers: { token, 'User-Agent': UA } });
        let data = await resp.json();
        if (!data.success && data.msg && data.msg.includes('已做过')) {
            const retryUrl = url.replace('isRepeat=0', 'isRepeat=1');
            resp = await fetch(retryUrl, { headers: { token, 'User-Agent': UA } });
            data = await resp.json();
        }
        if (!data.success) throw new Error(data.msg || '初始化报告失败');
        return data.data.reportId;
    }

    async function submitAnswersBatch(paperId, reportId, homeworkId, answers, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/submitanswer`;
        const headers = { 'Content-Type': 'application/json', token, 'User-Agent': UA };
        if (answers && answers.length) {
            const body = { answers: answers, assignPoints: true, bizCode, paperId, platform, reportId, homeworkId };
            const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
            const data = await resp.json();
            if (!data.success) throw new Error(data.msg || '提交答案失败');
        }
    }

    async function submitPaper(paperId, reportId, homeworkId, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/submitpaper`;
        const body = { paperId, platform, reportId, totalSeconds: 60 + Math.random() * 120, bizCode, homeworkId };
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', token, 'User-Agent': UA }, body: JSON.stringify(body) });
        const data = await resp.json();
        if (!data.success) throw new Error(data.msg || '交卷失败');
    }

    async function submitCorrected(paperId, reportId, bizCode, platform, token) {
        const url = `${BASE}/api/answerprod/web/answer/submitCorrected`;
        const body = { reportId, paperId, platform, bizCode, paperPackageId: null };
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', token, 'User-Agent': UA }, body: JSON.stringify(body) });
        const data = await resp.json();
        if (!data.success) throw new Error(data.msg || '自批失败');
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
          <div class="eph-about-name">升学e网通 试卷及习题助手</div>
          <div class="eph-about-desc">支持一键获取E网通试卷及习题答案并自动填写提交<br/>全部免费 🆓</div>

          <div class="eph-about-section">
            <h3>📢 使用须知</h3>
            <div class="eph-about-rate-item"><span class="dot"></span> 支持一键提交，提交后自动批改，满分完成</div>
            <div class="eph-about-rate-item"><span class="dot"></span> 支持独立试卷与课程任务</div>
            <div class="eph-about-rate-item"><span class="dot"></span> 使用本工具即代表同意合理使用</div>
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
                btn.textContent = paper.done ? "✅" : paper.brushing ? "⏳" : "刷";
                btn.disabled = !!paper.brushing || !!paper.done;
                btn.onclick = () => {
                    if (!paper.brushing && !paper.done) {
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

    async function brushAll() {
        if (isBrushingAll) {
            console.warn("一键刷取正在运行，请勿重复点击");
            return;
        }
        const todo = [];
        for (const group of groupsCache) {
            for (const paper of group.papers) {
                if (!paper.done && !paper.brushing) todo.push(paper);
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
                const bizCode = currentTask.bizCode || BIZ.EXERCISE;
                const homeworkId = currentTask.homeworkId || "0";
                let reportId = currentTask.reportId;
                if (!reportId || reportId === "0") {
                    const token = getToken();
                    reportId = await getReportId(paperId, bizCode, token);
                }
                const token = getToken();
                const paperInfo = await getPaperInfo(paperId, reportId, '1', BIZ.VIEW, token);
                const reportInfo = await getReportStatus(paperId, reportId, bizCode, token);
                const title = paperInfo.title || "当前任务";
                const questionCount = paperInfo.questionCount ?? "?";
                const done = reportInfo.finish === true;
                const type = (bizCode === BIZ.EXERCISE) ? "习题" : "试卷";

                const paper = { ...currentTask, title, questionCount, done, type, brushing: false };
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
            // 修改：使用 paper.bizCode 获取 viewReportId
            const [viewReportId, submitReportId] = await Promise.all([
                getReportId(paper.paperId, paper.bizCode, token),
                initReport(paper.paperId, paper.homeworkId, paper.bizCode, '1', token)
            ]);

            // 获取试卷信息（用于 fullScoreMap / metaMap）
            // 修改：使用 paper.bizCode
            const paperInfo = await getPaperInfo(paper.paperId, viewReportId, '1', paper.bizCode, token);
            const fullScoreMap = new Map();
            const metaMap = new Map();
            const traverseQuestions = (list) => {
                for (const q of list) {
                    const fullScore = q.fullScore !== undefined ? q.fullScore : (q.score !== undefined ? q.score : 0);
                    fullScoreMap.set(q.id, fullScore);
                    metaMap.set(q.id, { cate: q.cate ?? q.cateId ?? 1, subjective: q.subjective ?? false });
                    if (q.childQuestions && q.childQuestions.length) {
                        traverseQuestions(q.childQuestions);
                    }
                }
            };
            if (paperInfo && paperInfo.questions) {
                traverseQuestions(paperInfo.questions);
            }

            // 更新报告（保持原有逻辑，但使用 paper.bizCode）
            await updateReport(paper.paperId, viewReportId, paper.bizCode, '1', token);

            // 获取题目列表，使用 paper.bizCode
            const questions = await getQuestions(paper.paperId, viewReportId, '1', paper.bizCode, token);

            // 优化：并发获取每道题的答案，使用 paper.bizCode
            const allAnswers = await mapLimit(
                questions,
                CONCURRENCY.ANSWER,
                async (q) => {
                    const ans = await getAnswer(paper.paperId, viewReportId, q.questionId, paper.bizCode, '1', token);
                    return ans ? { question: q, answer: ans } : null;
                }
            );

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

            // 提交时传入 submitReportId
            await submitAllAndCorrect(paper.paperId, '1', paper.bizCode, expandedQuestions, expandedResults, paper.homeworkId, token, submitReportId);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[刷题] ✅ 提交完成 (耗时 ${elapsed}s): ${paper.title}`);
            showProgress(panel.progress, "✅ 完成", `《${paper.title}》已提交 (${elapsed}s)`);
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
        console.log("[EWT Helper] 未登录，退出");
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
        console.log("[EWT Helper] 已启动，版本 v1.0.2");
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
