// ============================================================
// flow-server.js
// ALJESAT BOT — نظام التسجيل التفاعلي (Multi-Bot / Multi-Port)
// 🔒 محدّث: ربط الجلسة بهوية العضو + إرسال استمارة الورك تلقائياً
// ============================================================

"use strict";

const express = require("express");
const crypto = require("crypto");
const { signBinding, verifyBinding } = require("./flow-security");

let workSender = null;
try { workSender = require("./flow-work-sender"); } catch (e) {
    console.warn("[flow-server] ⚠️ flow-work-sender غير محمّل:", e?.message);
}

// ============================================================
// الإعدادات
// ============================================================

const SESSION_TTL_MIN = Number(process.env.FLOW_SESSION_TTL_MIN) || 30;

const CONFIG = {
    SESSION_TTL_MS: SESSION_TTL_MIN * 60 * 1000,
    MAX_SESSIONS: Number(process.env.FLOW_MAX_SESSIONS) || 500,
    IP_RATE_LIMIT: Number(process.env.FLOW_IP_RATE_LIMIT) || 60,
    IP_RATE_WINDOW_MS: 60 * 1000,
    MAX_CONCURRENT_SUBMITS: Number(process.env.FLOW_MAX_SUBMITS) || 5,
    AUTO_CLEANUP_INTERVAL_MS: 60 * 1000
};

function resolvePort() {
    const fromFlowPort = Number(process.env.FLOW_PORT);
    if (Number.isFinite(fromFlowPort) && fromFlowPort > 0 && fromFlowPort < 65536) return fromFlowPort;
    const fromPort = Number(process.env.PORT);
    if (Number.isFinite(fromPort) && fromPort > 0 && fromPort < 65536) return fromPort;
    return 8080;
}

// ============================================================
// الحالة الداخلية
// ============================================================

const sessions = new Map();
const sessionsByUser = new Map();
const ipBuckets = new Map();

let activeSubmits = 0;
let serverInstance = null;
let cleanupTimer = null;

// ============================================================
// أدوات
// ============================================================

const log = (...a) => { try { console.log("[flow-server]", ...a); } catch (_) {} };
const logErr = (...a) => { try { console.error("[flow-server]", ...a); } catch (_) {} };

function now() { return Date.now(); }
function randomToken(bytes = 24) { return crypto.randomBytes(bytes).toString("hex"); }
function cleanNumber(v) { return String(v || "").replace(/\D/g, ""); }

function cleanText(v, max = 200) {
    return String(v == null ? "" : v)
        .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

function normalizeArabic(s) {
    return String(s || "")
        .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function isSimilarNickname(existing, newName) {
    const a = normalizeArabic(existing);
    const b = normalizeArabic(newName);
    if (a === b) return true;
    const clean = (s) => s.replace(/\s*\d+$/, "").trim();
    const ca = clean(a), cb = clean(b);
    if (ca === cb) return true;
    const min = Math.min(ca.length, cb.length);
    if (min < 3) return false;
    let matches = 0;
    for (let i = 0; i < min; i++) if (ca[i] === cb[i]) matches++;
    return (matches / min) > 0.85;
}

function getDb() { try { return global.db || null; } catch (_) { return null; } }
function saveDb() { try { if (typeof global.saveDb === "function") global.saveDb(); } catch (_) {} }

function findNicknameOwner(db, nickname, exceptUserNumbers = []) {
    if (!db || !db.users) return null;
    const exceptSet = new Set(exceptUserNumbers.map(cleanNumber));
    for (const key of Object.keys(db.users)) {
        const user = db.users[key];
        if (!user || !String(user.nickname || "").trim()) continue;
        if (exceptSet.has(cleanNumber(key))) continue;
        if (isSimilarNickname(user.nickname, nickname)) return { key, user };
    }
    return null;
}

function isRegistered(db, userNumber) {
    if (!db || !db.users) return false;
    const n = cleanNumber(userNumber);
    if (db.users[n] && String(db.users[n].nickname || "").trim()) return true;
    try {
        const jf = require("./jidfix");
        for (const a of jf.aliasesOf(n)) {
            if (db.users[a] && String(db.users[a].nickname || "").trim()) return true;
        }
    } catch (_) {}
    return false;
}

// ============================================================
// الجلسات
// ============================================================

function createSession({ targetUserId, targetJid, chatJid, createdBy, groupUrl }) {
    cleanupSessions();

    const token = randomToken(24);
    const n = cleanNumber(targetUserId);
    const t = now();

    // 🔒 توليد bindingToken مرتبط بالعضو
    const bindingToken = signBinding(token, n);

    const session = {
        token,
        bindingToken,          // 🆕
        targetUserId: n,
        targetJid: String(targetJid || ""),
        chatJid: String(chatJid || ""),
        createdBy: String(createdBy || ""),
        groupUrl: String(groupUrl || ""),
        createdAt: t,
        expiresAt: t + CONFIG.SESSION_TTL_MS,
        used: false,
        attempts: 0
    };

    const oldToken = sessionsByUser.get(n);
    if (oldToken) sessions.delete(oldToken);

    sessions.set(token, session);
    sessionsByUser.set(n, token);

    if (sessions.size > CONFIG.MAX_SESSIONS) {
        const sorted = [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt);
        while (sessions.size > CONFIG.MAX_SESSIONS && sorted.length) {
            const old = sorted.shift();
            sessions.delete(old.token);
            if (sessionsByUser.get(old.targetUserId) === old.token) {
                sessionsByUser.delete(old.targetUserId);
            }
        }
    }

    return session;
}

function getSession(token) {
    if (!token) return null;
    const s = sessions.get(String(token));
    if (!s) return null;
    if (now() > s.expiresAt) {
        sessions.delete(s.token);
        if (sessionsByUser.get(s.targetUserId) === s.token) {
            sessionsByUser.delete(s.targetUserId);
        }
        return null;
    }
    return s;
}

function cleanupSessions() {
    const t = now();
    let removed = 0;
    for (const [token, s] of sessions) {
        if (t > s.expiresAt) {
            sessions.delete(token);
            if (sessionsByUser.get(s.targetUserId) === token) {
                sessionsByUser.delete(s.targetUserId);
            }
            removed++;
        }
    }
    return removed;
}

// ============================================================
// حد الطلبات لكل IP
// ============================================================

function checkIpRate(ip) {
    const t = now();
    let b = ipBuckets.get(ip);
    if (!b || t - b.start > CONFIG.IP_RATE_WINDOW_MS) {
        b = { start: t, count: 0 };
        ipBuckets.set(ip, b);
    }
    b.count++;
    if (ipBuckets.size > 5000) {
        for (const [k, v] of ipBuckets) {
            if (t - v.start > CONFIG.IP_RATE_WINDOW_MS * 5) ipBuckets.delete(k);
        }
    }
    return b.count <= CONFIG.IP_RATE_LIMIT;
}

function getClientIp(req) {
    const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return xff || req.socket?.remoteAddress || "unknown";
}

// ============================================================
// Middleware
// ============================================================

function corsMiddleware(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Max-Age", "600");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
}

function rateMiddleware(req, res, next) {
    const ip = getClientIp(req);
    if (!checkIpRate(ip)) {
        return res.status(429).json({ ok: false, error: "rate_limit" });
    }
    next();
}

// ============================================================
// Routes
// ============================================================

function createApp() {
    const app = express();

    app.use(corsMiddleware);
    app.use(express.json({ limit: "32kb" }));
    app.use(express.urlencoded({ extended: false, limit: "32kb" }));

    // GET /api/flow/health
    app.get("/api/flow/health", (req, res) => {
        res.json({
            ok: true,
            service: "flow-server",
            port: resolvePort(),
            publicUrl: process.env.PUBLIC_URL || "",
            sessions: sessions.size,
            uptime: process.uptime(),
            bindingEnabled: true   // 🆕
        });
    });

    // POST /api/flow/create-session
    app.post("/api/flow/create-session", rateMiddleware, (req, res) => {
        try {
            const body = req.body || {};
            const targetUserId = cleanNumber(body.targetUserId);
            const targetJid = cleanText(body.targetJid, 60);
            const chatJid = cleanText(body.chatJid, 60);
            const createdBy = cleanText(body.createdBy, 40);
            const groupUrl = cleanText(body.groupUrl, 300);

            if (!targetUserId || targetUserId.length < 6) {
                return res.status(400).json({ ok: false, error: "invalid_target" });
            }

            const session = createSession({
                targetUserId, targetJid, chatJid, createdBy, groupUrl
            });

            log(`✅ جلسة جديدة: ${targetUserId} (${session.token.slice(0, 8)}...)`);

            res.json({
                ok: true,
                token: session.token,
                bindingToken: session.bindingToken,   // 🆕
                expiresAt: session.expiresAt,
                expiresIn: CONFIG.SESSION_TTL_MS
            });
        } catch (e) {
            logErr("create-session error:", e?.message || e);
            res.status(500).json({ ok: false, error: "internal_error" });
        }
    });

    // POST /api/flow/check-session
    app.post("/api/flow/check-session", rateMiddleware, (req, res) => {
        try {
            const { token, bindingToken } = req.body || {};

            const s = getSession(token);
            if (!s) return res.json({ ok: true, valid: false, reason: "expired" });

            // 🆕 تحقق من الـ binding (لمنع فتح الرابط من غير صاحبه)
            if (bindingToken) {
                const b = verifyBinding(bindingToken);
                if (!b || b.sessionId !== s.token || b.userNumber !== s.targetUserId) {
                    return res.status(403).json({
                        ok: false,
                        valid: false,
                        reason: "not_yours",
                        message: "⛔ هذا الرابط ليس مخصصاً لك"
                    });
                }
            }

            const db = getDb();
            if (db && isRegistered(db, s.targetUserId)) {
                return res.json({
                    ok: true,
                    valid: false,
                    reason: "registered",
                    enterLink: s.groupUrl || process.env.GROUP_URL || ""
                });
            }

            res.json({
                ok: true,
                valid: true,
                expiresAt: s.expiresAt
            });
        } catch (e) {
            logErr("check-session error:", e?.message || e);
            res.status(500).json({ ok: false, error: "internal_error" });
        }
    });

    // POST /api/flow/check-nickname
    app.post("/api/flow/check-nickname", rateMiddleware, (req, res) => {
        try {
            const { token, bindingToken, nickname } = req.body || {};
            const s = getSession(token);
            if (!s) return res.json({ ok: true, taken: false });

            // 🆕 تحقق من binding
            if (bindingToken) {
                const b = verifyBinding(bindingToken);
                if (!b || b.sessionId !== s.token || b.userNumber !== s.targetUserId) {
                    return res.status(403).json({ ok: false, taken: false, error: "not_yours" });
                }
            }

            const nick = cleanText(nickname, 30);
            if (nick.length < 2) return res.json({ ok: true, taken: false });

            const db = getDb();
            if (!db) return res.json({ ok: true, taken: false });

            const owner = findNicknameOwner(db, nick, [s.targetUserId]);
            res.json({ ok: true, taken: Boolean(owner) });
        } catch (e) {
            logErr("check-nickname error:", e?.message || e);
            res.json({ ok: true, taken: false });
        }
    });

    // --------------------------------------------------------
    // POST /api/flow/submit  🆕 النسخة المحمية بالكامل
    // --------------------------------------------------------
    app.post("/api/flow/submit", rateMiddleware, async (req, res) => {
        if (activeSubmits >= CONFIG.MAX_CONCURRENT_SUBMITS) {
            return res.status(429).json({
                ok: false,
                error: "البوت مشغول، حاول مرة أخرى بعد لحظات."
            });
        }
        activeSubmits++;

        try {
            const body = req.body || {};
            const token = cleanText(body.token, 80);
            const bindingToken = cleanText(body.bindingToken, 120);   // 🆕
            const nickname = cleanText(body.nickname, 30);
            const referrer = cleanText(body.referrer, 40);
            const gender = cleanText(body.gender, 20);
            const ageRaw = body.age;

            const s = getSession(token);
            if (!s) {
                return res.json({
                    ok: false,
                    error: "⌛ انتهت صلاحية الرابط، اطلب من المشرف رابطاً جديداً عبر .جديد"
                });
            }

            // 🆕 التحقق من الـ binding: الرابط خاص بالعضو الممانشن فقط
            const b = verifyBinding(bindingToken);
            if (!b || b.sessionId !== s.token || b.userNumber !== s.targetUserId) {
                log(`🚫 محاولة تسجيل من شخص آخر (sid=${s.token.slice(0,8)})`);
                return res.status(403).json({
                    ok: false,
                    error: "⛔ هذا الرابط مخصص لعضو آخر فقط. اطلب من المشرف رابطاً جديداً."
                });
            }

            const errors = {};

            if (nickname.length < 2) errors.nickname = "⚠️ يرجى كتابة لقب من حرفين على الأقل.";
            else if (nickname.length > 30) errors.nickname = "⚠️ اللقب طويل جداً (30 حرفاً كحد أقصى).";

            if (referrer.length < 2) errors.referrer = "⚠️ يرجى كتابة من طرف من دخلت.";
            else if (referrer.length > 40) errors.referrer = "⚠️ الاسم طويل جداً (40 حرفاً كحد أقصى).";

            if (!gender || gender.length < 1) errors.gender = "⚠️ يرجى اختيار جنسك.";

            let age = null;
            if (ageRaw !== undefined && ageRaw !== null && ageRaw !== "") {
                const n = parseInt(ageRaw, 10);
                if (!Number.isFinite(n) || n < 5 || n > 99) errors.age = "⚠️ العمر يجب أن يكون بين 5 و 99.";
                else age = n;
            }

            if (Object.keys(errors).length) {
                return res.json({ ok: false, errors });
            }

            const db = getDb();
            if (!db) return res.json({ ok: false, error: "⚠️ خطأ داخلي: قاعدة البيانات غير متاحة." });
            if (!db.users) db.users = {};

            if (isRegistered(db, s.targetUserId)) {
                return res.json({ ok: false, error: "❌ أنت مسجل في مملكة النار بالفعل." });
            }

            const owner = findNicknameOwner(db, nickname, [s.targetUserId]);
            if (owner) {
                return res.json({
                    ok: false,
                    errors: {
                        nickname: "❌ عذراً هذا اللقب مأخوذ!\n\nيرجى اختيار لقب آخر ثم إعادة المحاولة."
                    }
                });
            }

            const key = cleanNumber(s.targetUserId);
            const user = db.users[key] && typeof db.users[key] === "object"
                ? db.users[key]
                : { balance: 0, nickname: "", rank: "", maxInteraction: 0, friend: "" };

            user.nickname = nickname;
            user.gender = gender;
            user.age = age;
            user.referredBy = referrer;
            user.registeredAt = now();
            user.registrationDate = new Date().toISOString();

            db.users[key] = user;
            saveDb();

            s.used = true;
            s.nickname = nickname;

            log(`🎉 تسجيل ناجح: ${nickname} (${key}) | من طرف: ${referrer}`);

            const enterLink = s.groupUrl || process.env.GROUP_URL || "";

            // ✅ الرد للواجهة أولاً (سريع)
            res.json({ ok: true, nickname, enterLink });

            // 🆕 إرسال الاستمارة + الصورة **بعد** الرد (لا يعطّل الواجهة)
            setImmediate(async () => {
                try {
                    const sock = global.currentSocket;
                    if (!sock) {
                        logErr("⚠️ لا يوجد socket متاح — لم تُرسل الاستمارة");
                        return;
                    }
                    if (!workSender || typeof workSender.sendWorkFormAfterRegister !== "function") {
                        logErr("⚠️ flow-work-sender غير جاهز");
                        return;
                    }
                    await workSender.sendWorkFormAfterRegister(sock, db, {
                        targetUserId: key,
                        nickname,
                        referredBy: referrer
                    });
                } catch (e) {
                    logErr("work-form dispatch:", e?.message || e);
                }
            });

        } catch (e) {
            logErr("submit error:", e?.message || e);
            if (!res.headersSent) res.status(500).json({ ok: false, error: "internal_error" });
        } finally {
            activeSubmits--;
        }
    });

    app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));

    app.use((err, req, res, next) => {
        logErr("express error:", err?.message || err);
        if (res.headersSent) return next(err);
        res.status(500).json({ ok: false, error: "server_error" });
    });

    return app;
}

// ============================================================
// التنظيف التلقائي
// ============================================================

function startCleanupTimer() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
        try {
            const removed = cleanupSessions();
            if (removed > 0) log(`🧹 حذف ${removed} جلسة منتهية`);
        } catch (_) {}
    }, CONFIG.AUTO_CLEANUP_INTERVAL_MS);
    if (cleanupTimer.unref) cleanupTimer.unref();
}

function stopCleanupTimer() {
    if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}

// ============================================================
// التشغيل
// ============================================================

function startFlowServer() {
    if (serverInstance) { log("السيرفر يعمل بالفعل"); return serverInstance; }

    try { require.resolve("express"); }
    catch (_) { logErr("❌ مكتبة express غير مثبتة. شغّل: npm install express"); return null; }

    const app = createApp();
    const PORT = resolvePort();

    try {
        serverInstance = app.listen(PORT, "0.0.0.0", () => {
            log(`🚀 يعمل على المنفذ ${PORT}`);
            log(`🔗 PUBLIC_URL = ${process.env.PUBLIC_URL || "(غير محدد)"}`);
            log(`🌐 GROUP_URL = ${process.env.GROUP_URL ? "موجود" : "(غير محدد)"}`);
            log(`⏱️ مدة الجلسة: ${SESSION_TTL_MIN} دقيقة`);
            log(`🔒 نظام binding مُفعّل (منع التسجيل باسم الغير)`);
        });
        serverInstance.on("error", (err) => logErr("❌ خطأ في السيرفر:", err?.message || err));
        startCleanupTimer();
        return serverInstance;
    } catch (e) {
        logErr("❌ فشل تشغيل السيرفر:", e?.message || e);
        return null;
    }
}

function stopFlowServer() {
    stopCleanupTimer();
    if (serverInstance) { try { serverInstance.close(); } catch (_) {} serverInstance = null; }
}

module.exports = {
    startFlowServer,
    stopFlowServer,
    createSession,
    getSession,
    _internals: {
        sessions,
        sessionsByUser,
        findNicknameOwner,
        isRegistered,
        normalizeArabic,
        resolvePort,
        CONFIG
    }
};