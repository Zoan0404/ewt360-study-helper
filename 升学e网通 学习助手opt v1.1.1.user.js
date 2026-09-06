// ==UserScript==
// @name         升学e网通 学习助手opt
// @namespace    ewt360-sdudy-helper-opt
// @version      1.1.1
// @author       风月同天🌸 & 志成🍥 (optimized by ⚡Zoan)
// @description  采用志成🍥 的答案获取与风月同天🌸 的脚本参考及UI页面,由⚡Zoan进行整合并支持子母题型 混合题型 并且提供扫描功能,支持检测完成状态,优化提交功能,支持查看答案,进一步优化速度 
// @license      ISC
// @match        https://web.ewt360.com/*
// @match        https://teacher.ewt360.com/*
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      gateway.ewt360.com
// @connect      web.ewt360.com
// @connect      teacher.ewt360.com
// @connect      raw.githubusercontent.com
// @connect      gh-proxy.com
// @run-at       document-end
// @downloadURL none
// ==/UserScript==

(function() {
    "use strict";

    const BASE = "https://gateway.ewt360.com";
    const UA = "Mozilla/5.0";
    const BIZ = {
        EXERCISE: "204",  // 课后习题（reAnswerPaper 可重做）
        PAPER:    "205",  // 独立试卷（成绩固化）
        PAPER2:   "206",  // 试卷 B端变体（与 205 同链路，实测可刷）
        VIEW:     "201",  // 查看态（锁卷专用）
        CUSTOM:   "207"   // 校本试卷（作业提交入口，空卷+自批）
    };
    const UNIFIED_SUBMIT_CODES = [BIZ.EXERCISE, BIZ.PAPER, BIZ.PAPER2, BIZ.CUSTOM];
    const RETRYABLE_CODES = [BIZ.EXERCISE];
    const URL_BIZ_CONTENT_TYPES = [2];
    const HOMEWORK_STATUSES = [1, 2, 3];
    const REQUEST_TIMEOUT = 10000;              // 优化：降低超时
    const RETRY_COUNT = 2;
    const CONCURRENCY = { BRUSH: Infinity, ANSWER: 15, SCAN: 3 };   // 优化：BRUSH 一次全部刷完

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
        const title = (task?.title || "").toLowerCase();
        const rawBiz = String(task?.bizCode ?? "");
        const isSchool = name.includes("校本") || name.includes("作业提交") || title.includes("作业提交入口") ||
                         code === 207 || rawBiz === "207";
        if (isSchool) {
            return { type: "校本", bizCode: BIZ.CUSTOM };
        }
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
                const lessonSlot = {};   // v1.1.0 排序修复：lessonId → result 占位下标

                for (const task of tasks) {
                    const inferred = inferPaperType(task);
                    const type = inferred.type;
                    if (type === "试卷" || type === "校本") {
                        const paperId = String(task.contentId);
                        if (!paperId || paperId === "0") continue;
                        const done = task.finished === true;
                        const urlBiz = (String(task.contentUrl || '').match(/bizCode=(\d+)/) || [])[1];
                        const bizCode = urlBiz || inferred.bizCode || BIZ.PAPER;
                        result.push({
                            homeworkId: hid,
                            homeworkTitle: homework.homeworkTitle || homework.title || `作业 #${hid}`,
                            paperId, bizCode,
                            title: task.title || `试卷 ${paperId}`,
                            questionCount: task.questionCount || task.itemCount || "?",
                            subjectName: task.subjectName || "未知学科",
                            dayLabel, dayDate: day.date || null,
                            type, done, brushing: false
                        });
                        console.log(`  [${dayLabel}] ${type === "校本" ? "校本任务" : "独立试卷"}: ${task.title} (${task.questionCount}题, bizCode=${bizCode}, 已${done ? '完成' : '未完成'})`);
                    } else {
                        const contentId = String(task.contentId);
                        if (contentId && contentId !== "0" && contentId !== "null") {
                            lessonIdList.push(contentId);
                            taskIds.push(String(task.taskId));
                            taskMap[contentId] = task;
                            lessonSlot[contentId] = result.length;
                            result.push(null);
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
                        let isSchoolType = String(studyTest.bizCode ?? "") === BIZ.CUSTOM;
                        if (!isSchoolType && task) isSchoolType = (inferPaperType(task).type === "校本");
                        if (isSchoolType) {
                            type = "校本"; bizCode = BIZ.CUSTOM;
                        } else if (studyTest.bizCode) {
                            bizCode = String(studyTest.bizCode);
                            type = (bizCode === BIZ.EXERCISE) ? "习题" : (bizCode === BIZ.CUSTOM ? "校本" : "试卷");
                        } else if (task) {
                            const t = inferPaperType(task);
                            type = t.type; bizCode = t.bizCode;
                        }
                        const entry = {
                            homeworkId: hid,
                            homeworkTitle: homework.homeworkTitle || homework.title || `作业 #${hid}`,
                            paperId: String(studyTest.paperId), bizCode,
                            title: task?.title || `课程 ${lessonId} 练习`,
                            questionCount: studyTest.questionCount ?? "?",
                            subjectName: task?.subjectName || "未知学科",
                            dayLabel, dayDate: day.date || null,
                            type, done, brushing: false
                        };
                        const slot = lessonSlot[lessonId];
                        if (slot !== undefined && result[slot] === null) result[slot] = entry;
                        else result.push(entry);
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
        for (const r of dayResults) papers.push(...r.filter(x => x !== null));   // v1.1.0 排序修复：清理无练习的占位
        console.log(`作业 ${hid} 共汇总 ${papers.length} 个练习（按天排序）`);
        console.groupEnd();
        return papers;
    }

    // ---------- 脚本辅助函数 ----------
    const cleanHtmlKeepImg = (text) => {
        if (!text) return '';
        text = text.replace(/src="http:\/\/file\.ewt360\.com\//g, 'src="https://file.ewt360.com/');
        text = text.replace(/<img[^>]*Wirisformula[^>]*src="([^"]*)"[^>]*>/g, '<img src="$1" />');
        text = text.replace(/<br[^>]*>/g, '\n');
        text = text.replace(/<(?!img\b|\/img\b|b\b|\/b\b|u\b|\/u\b|i\b|\/i\b|strong\b|\/strong\b|em\b|\/em\b)[^>]+>/g, '');
        text = text.replace(/<img[^>]*>/gi, (m) =>
            m.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
             .replace(/\s+src\s*=\s*"[^"]*javascript:[^"]*"/gi, ' src=""')
             .replace(/\s+src\s*=\s*'[^']*javascript:[^']*'/gi, " src=''")
             .replace(/\s+src\s*=\s*[^"'\s>]+javascript:[^"'\s>]*/gi, ' src=""')
        );
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

    const pickRightAnswer = (data) => {
        if (!data) return null;
        for (const k of ['rightAnswer', 'rightAnswers', 'answers', 'answerList']) {
            if (Array.isArray(data[k]) && data[k].length) return data[k];
        }
        for (const k of ['answer', 'standardAnswer', 'correctAnswer', 'answerContent', 'trueAnswer', 'myAnswer']) {
            const v = data[k];
            if (typeof v === 'string' && v.trim()) return [v];
            if (Array.isArray(v) && v.length) return v;
        }
        return null;
    };
    const pickAnalysis = (data) => {
        if (!data) return '';
        for (const k of ['analyse', 'analysis', 'analysisContent', 'analyseContent', 'answerAnalysis', 'parse', 'parseContent', 'explanation']) {
            const v = data[k];
            if (typeof v === 'string' && v.trim()) return v;
            if (v && typeof v === 'object' && (v.content || v.text)) return v.content || v.text;
        }
        return '';
    };
    const normalizeImgUrl = (u) => String(u || '').replace(/^http:\/\//, 'https://');

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
        const reportId = data?.reportId || data?.report || data?.id;
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
            return null;   // null 表示获取失败，调用方需区分"未完成"与"未知"
        }
    }

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

    // ---------- 官方「重新作答」接口（reAnswerPaper） ----------
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
            const ans = await gmRequest("POST", url, body);
            if (ans) {
                if (!ans.rightAnswer || !ans.rightAnswer.length) {
                    const alt = pickRightAnswer(ans);
                    if (alt) ans.rightAnswer = alt;
                }
                if (!ans.analyse) {
                    const alt = pickAnalysis(ans);
                    if (alt) ans.analyse = alt;
                }
                if (Array.isArray(ans.attachmentImages)) {
                    ans.attachmentImages = ans.attachmentImages.map(normalizeImgUrl);
                }
                if (ans.childQuestions && Array.isArray(ans.childQuestions)) {
                    ans.childQuestions.forEach(c => {
                        if (!c.rightAnswer || !c.rightAnswer.length) {
                            const alt = pickRightAnswer(c);
                            if (alt) c.rightAnswer = alt;
                        }
                        if (!c.analyse) {
                            const alt = pickAnalysis(c);
                            if (alt) c.analyse = alt;
                        }
                        if (Array.isArray(c.attachmentImages)) {
                            c.attachmentImages = c.attachmentImages.map(normalizeImgUrl);
                        }
                    });
                }
            }
            return ans;
        } catch (e) {
            console.warn(`[答案] 题目 ${questionId} 获取失败:`, e.message);
            return null;
        }
    }

    async function getPaperInfo(paperId, reportId, platform, bizCode, token) {
        const url = `${BASE}/api/answerprod/web/answer/paper?paperId=${paperId}&platform=${platform}&reportId=${reportId}&bizCode=${bizCode}`;
        return await gmRequest("GET", url, null);
    }

    // ---------- webreport 全量答案接口（1 次 GET 拿全卷答案+解析，替代逐题 analysis） ----------
    async function getWebReportAnswers(paper, reportId, bizCode, token) {
        try {
            const userId = await getUserId();
            let raw = null;
            if (UNIFIED_SUBMIT_CODES.includes(bizCode) && bizCode !== BIZ.EXERCISE) {
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
                const url = `${BASE}/api/answerprod/web/answer/webreport?platform=1&reportId=${reportId}&userId=${userId}&bizCode=${bizCode}`;
                raw = await gmRequest("GET", url, null);
            }
            const questions = raw?.questions || [];
            if (!questions.length) {
                console.warn('[webreport] 返回题目为空，回退逐题 analysis');
                return null;
            }
            const normalize = (q) => {
                if (q.id != null && q.questionId == null) q.questionId = q.id;
                if (q.cate != null && q.cateId == null) q.cateId = q.cate;
                if (!q.rightAnswer || !q.rightAnswer.length) {
                    const alt = pickRightAnswer(q);
                    if (alt) q.rightAnswer = alt;
                }
                if (!q.analyse) {
                    const alt = pickAnalysis(q);
                    if (alt) q.analyse = alt;
                }
                if (Array.isArray(q.attachmentImages)) {
                    q.attachmentImages = q.attachmentImages.map(normalizeImgUrl);
                }
                if (Array.isArray(q.childQuestions)) q.childQuestions.forEach(normalize);
                return q;
            };
            questions.forEach(normalize);
            const title = raw?.title || '';
            const questionCount = questions.length;
            console.log(`[webreport] ✅ 1 次请求获取全卷答案成功：${questionCount} 题${title ? `，名称「${title}」` : ''}（子题由渲染层分组显示）`);
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
        const initRid = data?.reportId || data?.report || data?.id;
        if (!initRid) throw new Error('初始化报告失败: reportId为空');
        if (data.homeworkId !== undefined && String(data.homeworkId) !== String(homeworkId)) {
            throw new Error(`报告归属异常：请求 homeworkId=${homeworkId}，服务器回显 ${data.homeworkId}（该试卷不支持锁卷，放弃避免污染成绩）`);
        }
        return initRid;
    }

    // ============ v1.1.0：201 通道锁卷（核心防污染升级） ============
    async function lockReport201(paperId, token) {
        const lockId = await getReportId(paperId, BIZ.VIEW, token);
        if (!lockId || lockId === '0') throw new Error('201通道取报告失败');
        const lockSt = await getReportStatus(paperId, lockId, BIZ.VIEW, token);
        if (lockSt && lockSt.homeworkId !== undefined && String(lockSt.homeworkId) !== '0') {
            throw new Error(`201报告归属异常 homeworkId=${lockSt.homeworkId}，放弃锁卷`);
        }
        if (lockSt && lockSt.finish === true) return lockId;
        await updateReport(paperId, lockId, BIZ.VIEW, '1', token);
        console.log(`[锁卷201] 已锁定查看态报告 ${lockId}（bizCode=201，不触碰任务原报告）`);
        return lockId;
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

        if (!answers.length) {
            throw new Error("未获取到任何有效答案，已禁止提交空卷（请检查试卷或稍后重试）");
        }

        await submitAnswersBatch(paperId, submitReportId, homeworkId, answers, bizCode, platform, token);
        await submitPaper(paperId, submitReportId, homeworkId, bizCode, platform, token);
        await submitCorrected(paperId, submitReportId, bizCode, platform, token);
    }

    // ==================== 仅获取答案功能 ====================
    function showAnswerModal(results, questions, paperId, platform, submitBizCode, homeworkId, paperTitle, totalCount) {
        document.querySelectorAll('.ewt-answer-overlay').forEach(el => el.remove());
        const overlay = document.createElement('div');
        overlay.className = 'ewt-answer-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.45); z-index: 99998;
            display: flex; align-items: center; justify-content: flex-start;
            padding-left: 20px; opacity: 0; pointer-events: none;
            transition: opacity 0.3s ease;
        `;
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: #ffffff; border-radius: 20px; width: 750px; max-width: 80vw;
            max-height: 90vh; display: flex; flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.25);
            transform: scale(0.95) translateY(20px);
            transition: transform 0.3s ease, opacity 0.3s ease;
            opacity: 0; overflow: hidden;
        `;
        // header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 18px 24px; border-bottom: 1px solid rgba(0,0,0,0.06);
            font-size: 18px; font-weight: 600; display: flex;
            justify-content: space-between; align-items: center;
            color: #2d3748; background: #f7fafc;
            border-radius: 20px 20px 0 0;
        `;
        const title = document.createElement('span');
        const displayTitle = paperTitle || '试题';
        const displayCount = (typeof totalCount === 'number' && totalCount > 0) ? totalCount : results.length;
        title.textContent = `📝 ${displayTitle} 答案 (共 ${displayCount} 题)`;
        title.style.cssText = `flex: 1; word-wrap: break-word; white-space: normal; padding-right: 12px;`;
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = `
            cursor: pointer; font-size: 24px; color: #a0aec0; line-height: 1;
            background: none; border: none; padding: 0 4px; flex-shrink: 0;
        `;
        closeBtn.textContent = '×';
        closeBtn.title = '关闭';
        header.appendChild(title);
        header.appendChild(closeBtn);
        modal.appendChild(header);
        // body
        const body = document.createElement('div');
        body.style.cssText = `
            padding: 20px 24px; overflow-y: auto; flex: 1;
            line-height: 1.7; font-size: 14px; color: #2d3748; background: #ffffff;
        `;
        results.forEach(r => {
            const qDiv = document.createElement('div');
            qDiv.style.cssText = `
                background: #f7fafc; margin: 12px 0; padding: 16px 18px;
                border-radius: 14px; border-left: 4px solid #667eea;
                transition: background 0.2s;
            `;
            const safeGroup = escapeHtml(r.group || '');
            const ansHtml = cleanHtmlKeepImg(String(r.answer ?? ''));
            const parseHtml = r.analysis ? cleanHtmlKeepImg(String(r.analysis)) : '';
            const knowledgeHtml = r.knowledge ? escapeHtml(String(r.knowledge)) : '';
            qDiv.innerHTML = `
                <div style="font-weight:700; color:#2d3748; margin-bottom:4px; font-size:15px;">[${r.num}] ${safeGroup}</div>
                <div style="color:#e53e3e; margin:4px 0 6px; font-weight:500;">答案: ${ansHtml || (r.subResults && r.subResults.length ? '(见子题答案)' : '')}</div>
                ${knowledgeHtml ? `<div style="color:#718096; font-size:12px; margin:2px 0;">🧠 知识点: ${knowledgeHtml}</div>` : ''}
                ${parseHtml ? `<div style="color:#4a5568; font-size:13px; white-space:pre-wrap; margin-top:6px; padding:8px 12px; background:#ffffff; border-radius:8px;">📖 解析: ${parseHtml}</div>` : ''}
            `;
            if (r.images && r.images.length) {
                r.images.forEach(src => {
                    if (/^https?:\/\/file\.ewt360\.com\//.test(src)) {
                        const img = document.createElement('img');
                        img.src = src.replace(/^http:\/\//, 'https://');
                        img.style.cssText = 'max-width:100%;margin-top:8px;border-radius:8px;';
                        qDiv.appendChild(img);
                    }
                });
            }
            if (r.subResults && r.subResults.length) {
                const subBox = document.createElement('div');
                subBox.style.cssText = 'margin-top:10px;border-top:1px dashed #cbd5e0;padding-top:6px;';
                r.subResults.forEach((sub, i) => {
                    const subAns = cleanHtmlKeepImg(String(sub.answer ?? ''));
                    const subParse = sub.analysis ? cleanHtmlKeepImg(String(sub.analysis)) : '';
                    const subKnow = sub.knowledge ? escapeHtml(String(sub.knowledge)) : '';
                    const subDiv = document.createElement('div');
                    subDiv.style.cssText = 'margin:8px 0;padding:10px 12px;background:#ffffff;border-radius:8px;border-left:3px solid #f59e0b;';
                    subDiv.innerHTML = `
                        <div style="font-weight:600;color:#b7791f;font-size:13px;margin-bottom:2px;">${escapeHtml(sub.num || `(${i + 1})`)}${sub.cateName ? ` <span style="color:#a0aec0;font-weight:400;font-size:12px;">${escapeHtml(sub.cateName)}</span>` : ''}</div>
                        <div style="color:#e53e3e;font-size:13px;">答案: ${subAns}</div>
                        ${subKnow ? `<div style="color:#718096;font-size:12px;margin-top:2px;">🧠 知识点: ${subKnow}</div>` : ''}
                        ${subParse ? `<div style="color:#4a5568;font-size:12px;white-space:pre-wrap;margin-top:4px;padding:6px 10px;background:#f7fafc;border-radius:6px;">📖 解析: ${subParse}</div>` : ''}
                    `;
                    if (sub.images && sub.images.length) {
                        sub.images.forEach(src => {
                            if (/^https?:\/\/file\.ewt360\.com\//.test(src)) {
                                const img = document.createElement('img');
                                img.src = src.replace(/^http:\/\//, 'https://');
                                img.style.cssText = 'max-width:100%;margin-top:6px;border-radius:6px;';
                                subDiv.appendChild(img);
                            }
                        });
                    }
                    subBox.appendChild(subDiv);
                });
                qDiv.appendChild(subBox);
            }
            body.appendChild(qDiv);
        });
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            overlay.style.pointerEvents = 'auto';
            modal.style.transform = 'scale(1) translateY(0)';
            modal.style.opacity = '1';
        });
        const closeModal = () => {
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
            modal.style.transform = 'scale(0.95) translateY(20px)';
            modal.style.opacity = '0';
            setTimeout(() => overlay.remove(), 300);
        };
        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape' && overlay.style.opacity === '1') {
                closeModal();
                document.removeEventListener('keydown', esc);
            }
        });
    }

    // ===== 修改：fetchAndShowAnswers 改用 paper.bizCode =====
    async function fetchAndShowAnswers(paper) {
        console.group(`[获取答案] ${paper.title}`);
        console.log(`paperId=${paper.paperId}, bizCode=${paper.bizCode}, homeworkId=${paper.homeworkId}`);
        const token = getToken();
        try {
            let boundReportId = null;
            try {
                const br = await getReportId(paper.paperId, paper.bizCode, token);
                if (br && br !== '0') boundReportId = br;
            } catch (e) { boundReportId = null; }
            if (boundReportId) console.log(`[获取答案] 任务已绑定报告 reportId=${boundReportId}`);

            let answerReportId = null;
            const candidates = [];
            if (paper.reportId && paper.reportId !== '0' && paper.reportId !== 'undefined') {
                candidates.push({ id: String(paper.reportId), src: 'URL' });
            }
            candidates.push({ id: 'LATEST', src: 'getReportId' });
            candidates.push({ id: 'VIEW', src: 'getReportId-201' });

            for (const cand of candidates) {
                try {
                    let rid = cand.id;
                    if (rid === 'LATEST') {
                        rid = await getReportId(paper.paperId, paper.bizCode, token);
                    }
                    if (rid === 'VIEW') {
                        rid = await getReportId(paper.paperId, BIZ.VIEW, token);
                    }
                    if (!rid) continue;
                    const st = await getReportStatus(paper.paperId, rid, paper.bizCode, token);
                    if (st && st.finish === true) {
                        answerReportId = rid;
                        console.log(`[获取答案] 取答案使用已完成报告 reportId=${rid} (来源: ${cand.src})`);
                        break;
                    }
                    console.log(`[获取答案] 候选报告 ${rid} (${cand.src}) 未完成，尝试下一个`);
                } catch (e) {
                    console.warn(`[获取答案] 候选报告检查失败 (${cand.src}):`, e.message);
                }
            }

            if (!answerReportId) {
                try {
                    answerReportId = await lockReport201(paper.paperId, token);
                    console.log(`[获取答案] 无已完成报告，201通道锁卷报告 ${answerReportId} 换取答案（不污染任务成绩）`);
                } catch (e) {
                    console.warn('[获取答案] 201通道锁卷失败:', e.message);
                }
                if (!answerReportId) {
                    try {
                        const lockId = await initReport(paper.paperId, '0', paper.bizCode, '1', token);
                        if (boundReportId && String(lockId) === String(boundReportId)) {
                            throw new Error('initReport复用任务原报告，锁卷即污染，放弃');
                        }
                        const lockSt = await getReportStatus(paper.paperId, lockId, paper.bizCode, token);
                        if (lockSt && lockSt.homeworkId !== undefined && String(lockSt.homeworkId) !== '0') {
                            throw new Error(`锁卷报告归属异常 homeworkId=${lockSt.homeworkId}，放弃`);
                        }
                        await updateReport(paper.paperId, lockId, paper.bizCode, '1', token);
                        answerReportId = lockId;
                        console.log(`[获取答案] 205空间锁卷报告 ${lockId}（归属复核通过）`);
                    } catch (e) {
                        console.warn('[获取答案] 锁卷兜底失败:', e.message);
                    }
                }
            }

            if (!answerReportId) {
                throw new Error("未获取到答案源报告（既无已完成报告，锁卷兜底也失败）");
            }

            const paperInfo = await getPaperInfo(paper.paperId, answerReportId, '1', paper.bizCode, token);
            const fullScoreMap = new Map();
            const metaMap = new Map();
            const childNoMap = new Map();
            const childCateMap = new Map();
            const collectChildNo = (list) => {
                for (const q of list) {
                    if (q.childQuestions && q.childQuestions.length) {
                        for (const c of q.childQuestions) {
                            const cKey = c.id ?? c.questionId;
                            if (cKey != null && c.questionNoShow) childNoMap.set(String(cKey), c.questionNoShow);
                            if (cKey != null && c.cateName) childCateMap.set(String(cKey), c.cateName);
                        }
                        collectChildNo(q.childQuestions);
                    }
                }
            };
            const traverseQuestions = (list) => {
                for (const q of list) {
                    const fullScore = q.fullScore !== undefined ? q.fullScore : (q.score !== undefined ? q.score : 0);
                    const qKey = q.id ?? q.questionId;   // 兼容 id / questionId 两种字段
                    if (qKey != null) {
                        fullScoreMap.set(qKey, fullScore);
                        metaMap.set(qKey, { cate: q.cate ?? q.cateId ?? 1, subjective: q.subjective ?? false });
                    }
                    if (q.childQuestions && q.childQuestions.length) {
                        traverseQuestions(q.childQuestions);
                    }
                }
            };
            if (paperInfo && paperInfo.questions) {
                traverseQuestions(paperInfo.questions);
                collectChildNo(paperInfo.questions);
            }
            let questions = null;
            let allAnswers = null;
            const webReport = await getWebReportAnswers(paper, answerReportId, paper.bizCode, token);
            if (webReport && webReport.questions && webReport.questions.length) {
                questions = webReport.questions;   // 已归一化 questionId，含全部答案/解析字段
                allAnswers = questions.map(q => ({ question: q, answer: q }));
            } else {
                questions = await getQuestions(paper.paperId, answerReportId, '1', paper.bizCode, token);
                if (!questions || !questions.length) {
                    throw new Error("未获取到题目列表（可能是新试卷或接口异常）");
                }
                allAnswers = await mapLimit(questions, CONCURRENCY.ANSWER, async (q) => {
                    const ans = await getAnswer(paper.paperId, answerReportId, q.questionId, paper.bizCode, '1', token);
                    return ans ? { question: q, answer: ans } : null;
                });
            }
            const validAnswers = allAnswers.filter(Boolean);
            const expandedQuestions = [];
            const expandedResults = [];
            for (const item of validAnswers) {
                const q = item.question;
                const ans = item.answer;
                const childQs = ans.childQuestions || [];
                const parentRight = ans.rightAnswer || [];
                if (childQs.length > 0 && parentRight.length === 0) {
                    const groupName = ans.subjectQuestionTypeName || q.groupName;
                    const subResults = childQs.map((child, childIdx) => {
                        const childId = child.questionId;
                        const fullScore = fullScoreMap.get(childId) || 0;
                        const childRight = child.rightAnswer || [];
                        const childAnalyse = child.analyse || '';
                        const childKnowledge = child.knowledgeTitle || ans.knowledgeTitle || '';
                        const childImages = child.attachmentImages || [];
                        const meta = metaMap.get(childId);
                        const cate = meta ? meta.cate : (q.cateId || 1);
                        const subjective = meta ? meta.subjective : (q.subjective || false);
                        const opts = extractOpts(childRight);
                        const childType = childCateMap.get(String(childId)) || '';
                        const isChildMulti = /多选|不定项/.test(childType);
                        let answerStr;
                        if (opts.length > 1 && isChildMulti) {
                            answerStr = opts.join('、');
                        } else if (opts.length) {
                            answerStr = opts.join(', ');
                        } else if (childRight.length) {
                            if (childRight.length > 1) {
                                const cleaned = childRight.map((item, idx) => (idx + 1) + '、' + cleanHtmlKeepImg(item) + ';');
                                answerStr = cleaned.join('<br>');
                            } else {
                                answerStr = cleanHtmlKeepImg(childRight[0]);
                            }
                        } else {
                            answerStr = '(主观题)';
                        }
                        return {
                            num: childNoMap.get(String(childId)) || ('(' + (childIdx + 1) + ')'),
                            cateName: childCateMap.get(String(childId)) || '',
                            questionId: childId, cateId: cate, subjective: subjective,
                            fullScore: fullScore, score: child.score || fullScore || 0,
                            answer: answerStr, knowledge: childKnowledge,
                            analysis: cleanHtmlKeepImg(childAnalyse),
                            images: childImages, rawRightAnswer: childRight,
                        };
                    });
                    expandedQuestions.push({
                        ...q, cateId: q.cateId || 1, subjective: q.subjective || false,
                        fullScore: fullScoreMap.get(q.questionId) || 0, score: ans.score || 0,
                    });
                    expandedResults.push({
                        num: '', group: groupName, answer: '',
                        knowledge: (ans.knowledges || []).map(k => k.title).join('、'),
                        analysis: cleanHtmlKeepImg(ans.analyse || ''),
                        images: ans.attachmentImages || [], rawRightAnswer: parentRight,
                        questionId: q.questionId, subjective: q.subjective || false,
                        subResults: subResults,
                    });
                } else {
                    const fullScore = fullScoreMap.get(q.questionId) || 0;
                    const opts = extractOpts(ans.rightAnswer || []);
                    const isMultiChoice = /多选|不定项/.test((ans.subjectQuestionTypeName || '') + ' ' + (q.groupName || ''));
                    let answerStr;
                    if (opts.length) {
                        if (opts.length > 1 && isMultiChoice) {
                            answerStr = opts.join('、');
                        } else if (opts.length > 1) {
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
                        ...q, cateId: q.cateId || 1, subjective: q.subjective || false,
                        fullScore: fullScore, score: ans.score || fullScore || 0,
                    });
                    expandedResults.push({
                        num: '', group: q.groupName, answer: answerStr,
                        knowledge: (ans.knowledges || []).map(k => k.title).join('、'),
                        analysis: cleanHtmlKeepImg(ans.analyse || ''),
                        images: ans.attachmentImages || [], rawRightAnswer: ans.rightAnswer || [],
                        questionId: q.questionId, subjective: q.subjective || false,
                    });
                }
            }
            expandedQuestions.forEach((q, idx) => { q.questionNumber = String(idx + 1); });
            expandedResults.forEach((r, idx) => { r.num = String(idx + 1); });
            fixGroupAnswers(expandedResults);
            const totalCount = (paperInfo && typeof paperInfo.questionCount === 'number' && paperInfo.questionCount > 0)
                ? paperInfo.questionCount
                : (webReport ? webReport.questionCount : undefined);
            showAnswerModal(expandedResults, expandedQuestions, paper.paperId, '1', paper.bizCode, paper.homeworkId, paper.title, totalCount);
            console.log(`[获取答案] ✅ 答案已展示`);
            console.groupEnd();
        } catch (e) {
            console.error(`[获取答案] ❌ 失败: ${paper.title}`, e);
            alert('获取答案失败: ' + e.message);
            console.groupEnd();
        }
    }

    // ==================== UI ====================
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
  word-wrap: break-word;
  white-space: normal;
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
  word-wrap: break-word;
  white-space: normal;
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
.eph-paper-item .eph-answer-btn {
  padding: 5px 12px;
  border: none;
  border-radius: 20px;
  font-size: 12px;
  cursor: pointer;
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
  color: #fff;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.2s;
  box-shadow: 0 2px 6px rgba(251, 191, 36, 0.3);
  margin-left: 4px;
}
.eph-paper-item .eph-answer-btn:disabled {
  background: #d1d5db;
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
}
.eph-paper-item .eph-answer-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(251, 191, 36, 0.45);
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

    // -------- 答案视图渲染函数 --------
    function renderAnswerView(container, groups) {
        container.innerHTML = "";
        if (!groups || groups.length === 0) {
            container.innerHTML = `<div class="eph-empty">暂无练习，请先在「任务」页刷新列表</div>`;
            return;
        }
        for (const group of groups) {
            const item = document.createElement("div");
            item.className = "eph-hw-item";
            const hd = document.createElement("div");
            hd.className = "eph-hw-header";
            hd.innerHTML = `<span class="eph-hw-title">📚 ${escapeHtml(group.title)}</span> <span class="eph-hw-count">${group.papers.length}个</span> <span class="eph-arrow">▶</span>`;
            const list = document.createElement("div");
            list.className = "eph-paper-list";
            for (const paper of group.papers) {
                const pi = document.createElement("div");
                pi.className = "eph-paper-item";
                const info = document.createElement("div");
                info.className = "eph-paper-info";
                const typeLabel = paper.type ? `[${paper.type}] ` : "";
                const qCount = paper.questionCount ?? "?";
                info.innerHTML = `<div class="eph-paper-title">${typeLabel}${escapeHtml(paper.title)}</div> <div class="eph-paper-meta">${qCount}题${paper.subjectName ? ` · ${escapeHtml(paper.subjectName)}` : ""}${paper.dayLabel ? ` · 📅 ${escapeHtml(paper.dayLabel)}` : ""}</div>`;
                pi.appendChild(info);
                const answerBtn = document.createElement("button");
                answerBtn.className = "eph-answer-btn";
                answerBtn.textContent = "📄 获取答案";
                answerBtn.onclick = () => {
                    answerBtn.disabled = true;
                    answerBtn.textContent = "⏳ 获取中...";
                    fetchAndShowAnswers(paper).finally(() => {
                        answerBtn.disabled = false;
                        answerBtn.textContent = "📄 获取答案";
                    });
                };
                pi.appendChild(answerBtn);
                list.appendChild(pi);
            }
            hd.onclick = () => { hd.classList.toggle("open"); list.classList.toggle("open"); };
            item.appendChild(hd);
            item.appendChild(list);
            container.appendChild(item);
        }
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
        const tabAnswer = document.createElement("button");
        tabAnswer.textContent = "📄 答案";
        const tabAbout = document.createElement("button");
        tabAbout.textContent = "ℹ️ 关于";
        tabs.appendChild(tabMain);
        tabs.appendChild(tabAnswer);
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

        const SPEEDS = {
            fast: { label: "🟢 快", conc: { BRUSH: Infinity, ANSWER: 30, SCAN: 8 } },
            mid:  { label: "🟡 中", conc: { BRUSH: 15, ANSWER: 15, SCAN: 5 } },
            slow: { label: "🐢 稳", conc: { BRUSH: 5, ANSWER: 5, SCAN: 4 } }
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

        const answerView = document.createElement("div");
        answerView.className = "eph-view";
        answerView.id = "eph-view-answer";
        const answerContainer = document.createElement("div");
        answerContainer.className = "eph-list";
        answerView.appendChild(answerContainer);
        panel.appendChild(answerView);

        const aboutView = document.createElement("div");
        aboutView.className = "eph-view";
        aboutView.id = "eph-view-about";
        const aboutContent = document.createElement("div");
        aboutContent.className = "eph-about";
        aboutContent.innerHTML = `
          <div class="eph-about-avatar">🌸</div>
          <div class="eph-about-name">升学e网通 学习助手opt <span style="font-size:12px;color:#a78bfa;font-weight:600;">v1.1.1</span></div>
          <div class="eph-about-desc">支持一键获取E网通试卷及习题答案并自动填写提交<br/>全部免费 🆓</div>
          <div class="eph-about-section">
            <h3>📢 使用须知</h3>
            <div class="eph-about-rate-item"><span class="dot"></span> 支持一键提交,提交后自动批改,满分完成</div>
            <div class="eph-about-rate-item"><span class="dot"></span> 支持独立试卷与课程任务,支持独立查看答案</div>
            <div class="eph-about-rate-item"><span class="dot"></span> 使用本工具即代表同意合理使用</div>

          </div>
          <div class="eph-about-section">
            <h3>✨ v1.1.1 更新内容</h3>
            <div class="eph-about-rate-item"><span class="dot"></span> <b>统一提交逻辑（重大）</b>：课后习题(204)、独立试卷(205)、试卷变体(206)、校本试卷(207) 统一走「自动填答 → 交卷 → 自批满分」标准三连，一套链路通刷，不再各写各的</div>
            <div class="eph-about-rate-item"><span class="dot"></span> <b>新增 206 试卷支持</b>：扫描时从任务 contentUrl 提取真实 bizCode，206 试卷不再被误判为 205 提交失败，现已自动识别并满分刷取</div>
            <div class="eph-about-rate-item"><span class="dot"></span> <b>修复校本试卷(207) 满分提交</b>：207 回归标准三连（主观题自批满分），废弃会判 0 分的空卷提交分支</div>
          </div>

<div class="eph-about-section">
            <h3>👨‍💻 作者团队</h3>
            <div class="eph-about-rate-item"><span class="dot"></span> <strong>🌸 风月同天</strong> — 原始脚本参考 &amp; UI设计</div>
            <div class="eph-about-rate-item"><span class="dot"></span> <strong>🍥 志成</strong> — 答案获取核心 &amp; 数据结构</div>
            <div class="eph-about-rate-item"><span class="dot"></span> <strong>⚡ Zoan</strong> — 整合优化 &amp; 混合题型支持</div>
          </div>

          <div class="eph-about-section">
            <h3>💝 赞赏支持</h3>
            <div class="eph-about-rate-item"><span class="dot"></span> 如果觉得好用，欢迎请作者喝杯咖啡 ☕ 你的支持是持续维护的最大动力！</div>
            <div id="eph-reward-box" style="text-align:center; margin-top:10px; min-height:40px;">
              <div id="eph-reward-loading" style="color:#a78bfa; font-size:12px;">🪄 赞赏码加载中…</div>
            </div>
          </div>
          <div class="eph-about-section">
            <h3>🔗 相关链接</h3>
            <!-- 风月同天 -->
            <div style="margin-bottom:18px; padding-bottom:14px; border-bottom:1px dashed #e9e0ff;">
              <div style="font-weight:600; font-size:13px; color:#4a4a6a;">🌸 风月同天</div>
              <div class="eph-about-link-item"><span>📝 博客</span><a href="https://www.zkzxgzb.com/news/blog/bdcd86c" target="_blank">前往访问</a></div>
              <div class="eph-about-link-item"><span>💬 TG 机器人</span><a href="https://t.me/ewtkillbot" target="_blank">EWT刷课机器人</a></div>
              <div class="eph-about-link-item"><span>📦 源码仓库</span><a href="https://github.com/ZZ0YY/EWT-TOOL" target="_blank">GitHub</a></div>
              <div class="eph-about-link-item"><span>📥 Greasy Fork</span><a href="https://greasyfork.org/zh-CN/scripts/587786" target="_blank">安装页面</a></div>
            </div>
            <!-- 志成 -->
            <div style="margin-bottom:18px; padding-bottom:14px; border-bottom:1px dashed #e9e0ff;">
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
              <div class="eph-about-link-item"><span>📦 源码仓库</span><a href="https://github.com/Zoan0404/ewt360-study-helper" target="_blank">GitHub</a></div>
              <div class="eph-about-link-item"><span>📥 Greasy Fork</span><a href="https://greasyfork.org/zh-CN/scripts/591258" target="_blank">安装页面</a></div>
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
            answerView.classList.toggle("active", id === "eph-view-answer");
            aboutView.classList.toggle("active", id === "eph-view-about");
            tabMain.classList.toggle("active", id === "eph-view-main");
            tabAnswer.classList.toggle("active", id === "eph-view-answer");
            tabAbout.classList.toggle("active", id === "eph-view-about");
        }
        tabMain.onclick = () => showView("eph-view-main");
        tabAnswer.onclick = () => showView("eph-view-answer");
        tabAbout.onclick = () => showView("eph-view-about");

        // ============ 赞赏码加载（gh-proxy 镜像优先 · raw 直链回退；GM_xmlhttpRequest 绕过页面 CSP） ============
        const REWARD_RAW = "https://raw.githubusercontent.com/Zoan0404/ewt360-study-helper/main/wechat_reward.png";
        const REWARD_PROXY = "https://gh-proxy.com/https://raw.githubusercontent.com/Zoan0404/ewt360-study-helper/main/wechat_reward.png";
        let rewardLoaded = false;
        function loadRewardQR() {
            if (rewardLoaded) return;
            rewardLoaded = true;   // 立即上锁，防止镜像/直链两路回调重复加载
            const box = document.getElementById("eph-reward-box");
            if (!box) return;
            const ensureImg = () => {
                let img = document.getElementById("eph-reward-img");
                if (!img) {
                    img = document.createElement("img");
                    img.id = "eph-reward-img";
                    img.alt = "微信赞赏码";
                    img.style.cssText = "width:100%; max-width:330px; height:auto; border-radius:12px; margin:8px auto; display:block; cursor:zoom-in;";
                    img.onclick = () => {
                        img.style.maxWidth = (img.style.maxWidth === "330px") ? "100%" : "330px";
                        img.style.width = (img.style.maxWidth === "100%") ? "100%" : String(window.getComputedStyle(box).width || "330px");
                    };
                    img.onerror = () => { box.innerHTML = '<div style="color:#b0a8d0;font-size:12px;">😴 赞赏码暂时无法加载</div>'; };
                    box.appendChild(img);
                }
                const loading = document.getElementById("eph-reward-loading");
                if (loading) loading.remove();
                return img;
            };
            const showSrc = (src) => { const el = ensureImg(); if (el) el.src = src; };
            const fetchQR = (url) => {
                if (typeof GM_xmlhttpRequest !== "function") return null;
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url,
                    responseType: "blob",
                    timeout: 8000,
                    onload: (res) => {
                        if (res.status === 200 && res.response && typeof res.response === "object") {
                            showSrc(URL.createObjectURL(res.response));
                        } else if (url !== REWARD_RAW) {
                            fetchQR(REWARD_RAW);
                        } else {
                            showSrc(REWARD_RAW);
                        }
                    },
                    onerror: () => { if (url !== REWARD_RAW) fetchQR(REWARD_RAW); else showSrc(REWARD_RAW); },
                    ontimeout: () => { if (url !== REWARD_RAW) fetchQR(REWARD_RAW); else showSrc(REWARD_RAW); }
                });
            };
            if (!fetchQR(REWARD_PROXY)) showSrc(REWARD_RAW);
        }
        tabAbout.addEventListener("click", loadRewardQR, { once: true });

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

        showView("eph-view-main");

        return {
            panel, listContainer, statusBar, progress, refreshBtn, brushAllBtn, stopBtn,
            answerContainer,
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
            hd.innerHTML = `<span class="eph-hw-title">${escapeHtml(group.title)}</span> <span class="eph-hw-count">${group.papers.length}个</span> <span class="eph-arrow">▶</span>`;
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
                info.innerHTML = `<div class="eph-paper-title">${typeLabel}${escapeHtml(paper.title)}${doneLabel}</div> <div class="eph-paper-meta">${qCount}题${paper.subjectName ? ` · ${escapeHtml(paper.subjectName)}` : ""}${paper.dayLabel ? ` · 📅 ${escapeHtml(paper.dayLabel)}` : ""}</div>`;
                pi.appendChild(info);
                const btn = document.createElement("button");
                btn.className = "eph-brush-btn";
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
    let forceRedo = false;   // 强制重刷开关（204习题走官方 reAnswerPaper 重做；205试卷仅生成满分报告，任务成绩固化）

    async function brushAll() {
        if (isBrushingAll) {
            console.warn("一键刷取正在运行，请勿重复点击");
            return;
        }
        const todo = [];
        for (const group of groupsCache) {
            for (const paper of group.papers) {
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
                const done = reportInfo ? reportInfo.finish === true : false;
                const type = (bizCode === BIZ.EXERCISE) ? "习题" : (bizCode === BIZ.CUSTOM ? "校本" : (UNIFIED_SUBMIT_CODES.includes(bizCode)) ? "试卷" : "浏览");

                const paper = { ...currentTask, bizCode, title, questionCount, done, type, brushing: false };
                const group = { homeworkId, title: "当前任务", papers: [paper] };
                groupsCache = [group];
                renderPaperList(panel.listContainer, [group], brushPaper);
                renderAnswerView(panel.answerContainer, groupsCache);
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
                renderAnswerView(panel.answerContainer, groups);
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
                renderAnswerView(panel.answerContainer, []);
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
        renderAnswerView(panel.answerContainer, groups);
        const total = groups.reduce((s, g) => s + g.papers.length, 0);
        panel.statusBar.textContent = `📄 共 ${total} 个练习`;
        console.log(`加载完成，共 ${total} 个练习`);
        console.groupEnd();
    }

    // ===== 修改：brushPaper 函数，统一使用 paper.bizCode =====
    async function brushPaper(paper) {
        console.group(`[刷题] ${paper.title}`);
        console.log(`paperId=${paper.paperId}, bizCode=${paper.bizCode}, homeworkId=${paper.homeworkId}`);
        showProgress(panel.progress, `正在刷: ${paper.title}`, "初始化报告中...");
        panel.statusBar.textContent = `⏳ ${paper.title} (bizCode=${paper.bizCode})`;
        const startTime = Date.now();
        const token = getToken();
        try {

            let boundReportId = null;
            try {
                const br = await getReportId(paper.paperId, paper.bizCode, token);
                if (br && br !== '0') boundReportId = br;
            } catch (e) { boundReportId = null; }
            if (boundReportId) console.log(`[刷题] 任务已绑定报告 reportId=${boundReportId}（将作为提交报告，锁卷报告仅作答案源）`);
            let answerReportId = null;
            const candidates = [];
            if (paper.reportId && paper.reportId !== '0' && paper.reportId !== 'undefined') {
                candidates.push({ id: String(paper.reportId), src: 'URL' });
            }
            candidates.push({ id: 'LATEST', src: 'getReportId' });
            candidates.push({ id: 'VIEW', src: 'getReportId-201' });

            for (const cand of candidates) {
                try {
                    let rid = cand.id;
                    if (rid === 'LATEST') {
                        rid = await getReportId(paper.paperId, paper.bizCode, token);
                    }
                    if (rid === 'VIEW') {
                        rid = await getReportId(paper.paperId, BIZ.VIEW, token);
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

            if (!answerReportId) {
                try {
                    answerReportId = await lockReport201(paper.paperId, token);
                    console.log(`[刷题] 无已完成报告，201通道锁卷报告 ${answerReportId} 换取答案（不污染任务成绩）`);
                } catch (e) {
                    console.warn('[刷题] 201通道锁卷失败:', e.message);
                }
                if (!answerReportId) {
                    try {
                        const lockId = await initReport(paper.paperId, '0', paper.bizCode, '1', token);
                        if (boundReportId && String(lockId) === String(boundReportId)) {
                            throw new Error('initReport复用任务原报告，锁卷即污染，放弃');
                        }
                        const lockSt = await getReportStatus(paper.paperId, lockId, paper.bizCode, token);
                        if (lockSt && lockSt.homeworkId !== undefined && String(lockSt.homeworkId) !== '0') {
                            throw new Error(`锁卷报告归属异常 homeworkId=${lockSt.homeworkId}，放弃`);
                        }
                        await updateReport(paper.paperId, lockId, paper.bizCode, '1', token);
                        answerReportId = lockId;
                        console.log(`[刷题] 205空间锁卷报告 ${lockId}（归属复核通过）`);
                    } catch (e) {
                        console.warn('[刷题] 锁卷兜底失败:', e.message);
                    }
                }
            }

            if (!answerReportId) {
                throw new Error("未获取到答案源报告（既无已完成报告，锁卷兜底也失败），已中止刷取");
            }

            const paperInfo = await getPaperInfo(paper.paperId, answerReportId, '1', paper.bizCode, token);
            const fullScoreMap = new Map();
            const metaMap = new Map();
            const traverseQuestions = (list) => {
                for (const q of list) {
                    const fullScore = q.fullScore !== undefined ? q.fullScore : (q.score !== undefined ? q.score : 0);
                    const qKey = q.id ?? q.questionId;   // 兼容 id / questionId 两种字段
                    if (qKey != null) {
                        fullScoreMap.set(qKey, fullScore);
                        metaMap.set(qKey, { cate: q.cate ?? q.cateId ?? 1, subjective: q.subjective ?? false });
                    }
                    if (q.childQuestions && q.childQuestions.length) {
                        traverseQuestions(q.childQuestions);
                    }
                }
            };
            if (paperInfo && paperInfo.questions) {
                traverseQuestions(paperInfo.questions);
            }

            let questions = null;
            let allAnswers = null;
            const webReport = await getWebReportAnswers(paper, answerReportId, paper.bizCode, token);
            if (webReport && webReport.questions && webReport.questions.length) {
                questions = webReport.questions;   // 已归一化 questionId，含全部答案/解析字段
                allAnswers = questions.map(q => ({ question: q, answer: q }));
            } else {
                questions = await getQuestions(paper.paperId, answerReportId, '1', paper.bizCode, token);

                if (!questions || !questions.length) {
                    throw new Error("未获取到题目列表，已禁止空卷提交（可能是新试卷或接口异常）");
                }

                allAnswers = await mapLimit(questions, CONCURRENCY.ANSWER, async (q) => {
                    const ans = await getAnswer(paper.paperId, answerReportId, q.questionId, paper.bizCode, '1', token);
                    return ans ? { question: q, answer: ans } : null;
                });
            }
            const validAnswers = allAnswers.filter(Boolean);

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

            if (!expandedQuestions.length || !expandedResults.length) {
                throw new Error("未获取到任何题目/答案，已中止提交（避免提交空卷）");
            }

            let submitReportId = null;
            if (boundReportId && String(boundReportId) !== String(answerReportId)) {
                submitReportId = boundReportId;
                console.log(`[刷题] 使用任务已绑定报告 ${submitReportId} 提交（原报告答题，锁卷报告仅作答案源）`);
            }
            if (!submitReportId && RETRYABLE_CODES.includes(paper.bizCode) && answerReportId) {
                try {
                    submitReportId = await reAnswerPaper(answerReportId, token);
                    console.log(`[刷题] 204习题走官方重做通道 reAnswerPaper，新报告 ${submitReportId}（绑定将自动更新）`);
                } catch (e) {
                    console.warn(`[刷题] reAnswerPaper 失败（${e.message}），降级 initReport 新建报告`);
                }
            }
            if (!submitReportId) {
                submitReportId = await initReport(paper.paperId, paper.homeworkId, paper.bizCode, '1', token);
                if (boundReportId && String(submitReportId) === String(boundReportId)) {
                    throw new Error(`initReport复用任务原报告 ${submitReportId}，禁止提交满分（避免污染真实成绩），已中止`);
                }
            }

            // ===== 统一提交链（204/205/206/207 完全共用） =====
            await submitAllAndCorrect(paper.paperId, '1', paper.bizCode, expandedQuestions, expandedResults, paper.homeworkId, token, submitReportId);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[刷题] ✅ 提交完成 (耗时 ${elapsed}s): ${paper.title}`);
            let doneMsg = `《${paper.title}》已提交 (${elapsed}s)`;
            if (paper.done && (paper.bizCode === BIZ.PAPER || paper.bizCode === BIZ.PAPER2)) {
                doneMsg = `《${paper.title}》已生成新满分报告，但已完成试卷任务成绩固化（服务器限制），任务成绩不会更新`;
                console.warn(`[刷题] ⚠️ ${doneMsg}`);
            }
            showProgress(panel.progress, "✅ 完成", doneMsg);
            panel.statusBar.textContent = `✅ ${paper.title} 完成`;
            markPaperDone(paper);
            renderAnswerView(panel.answerContainer, groupsCache);
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
        tip.textContent = "🔑 升学e网通学习助手：未检测到登录，请先登录后刷新页面";
        tip.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:999999;background:linear-gradient(135deg,#f9a8d4,#a78bfa);color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;box-shadow:0 6px 20px rgba(167,139,250,.5);font-family:'Microsoft YaHei',sans-serif;";
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
        console.log("[EWT Helper] 已启动，版本 v1.1.1");
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
