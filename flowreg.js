// ============================================================
// flowreg.js  (ملف جديد)
// ALJESAT BOT — نظام التسجيل التفاعلي  (.جديد / .تصفير / .رابط اساسي)
//
// المبدأ: Event-driven + Sessions (بدون أي loop انتظار):
//   .جديد @user  →  إنشاء Session  →  إرسال الواجهة  →  البوت يعود فوراً
//   المستخدم يضغط/يرسل  →  حدث جديد  →  قراءة Session  →  تحقق  →  إكمال
//
// واجهتان (تُختاران تلقائياً):
//   1) WhatsApp Flow حقيقي (حقول إدخال + قائمة + Checkbox) عند وجود FLOW_ID في Variables
//   2) واجهة أزرار native داخل المحادثة (خطوة بخطوة) تعمل بدون Flow وعلى كل الإصدارات
//
// الأمان: كل Session لها Token عشوائي ومرتبطة بالعضو المذكور فقط،
//        ويُتحقق من هوية المرسل (من مفتاح رسالة واتساب نفسها) عند كل ضغط/Submit.
//        لا نثق بأي userId يأتي داخل بيانات الواجهة إطلاقاً.
// ============================================================

"use strict";

const crypto = require("crypto");
const jf = require("./jidfix");

// ============================================================
// الإعدادات
// ============================================================

const CFG = {
    get sessionMs() { return (Number(process.env.FLOW_SESSION_MINUTES) || 15) * 60 * 1000; },
    extendMs: 10 * 60 * 1000,          // كل خطوة تمدّد الجلسة 10 دقائق
    maxLifeMs: 45 * 60 * 1000,         // حد أقصى لعمر الجلسة
    maxAttempts: 8,                    // أخطاء متتالية قبل إغلاق الجلسة
    get sendTimeoutMs() { return Number(process.env.FLOW_SEND_TIMEOUT_MS) || 20000; },
    cleanupEveryMs: 60 * 1000,
    deniedCooldownMs: 15 * 1000,       // لا نكرر رسالة "ليست مخصصة لك" لنفس الشخص
    get flowId() { return String(process.env.FLOW_ID || "").trim(); },
    get flowMode() { return String(process.env.FLOW_MODE || "").trim(); }, // "draft" للتجربة
    get sendDm() { return String(process.env.FLOW_SEND_DM || "").toLowerCase() === "true"; },
    // صلاحيات (نفس مستويات .سماح الموجودة)
    registerLevels: ["2", "1"],        // .جديد  (سماح 2 أو أعلى)
    resetLevels: ["1", "5"],           // .تصفير (نفس "الصلاحية الكاملة" المستعملة في .سجل)
    urlLevels: ["1"]                   // .رابط اساسي (والمالك دائماً)
};

const FOOTER = "𝑭. 𝑰. 𝑹 🔥";

const GENDERS = { male: "ذكر", female: "أنثى", custom: "مخصص" };

// ============================================================
// الرسائل
// ============================================================

const MSG = {
    TAKEN: "❌ عذراً هذا اللقب مأخوذ!\n\nيرجى اختيار لقب آخر ثم إعادة المحاولة.",
    ALREADY: "❌ أنت مسجل لدى مملكة النار بالفعل.",
    NOT_YOURS: "⛔ صفحة التسجيل هذه ليست مخصصة لك.\n\nهذه الصفحة مخصصة فقط للعضو الذي تم عمل Mention\nله في أمر .جديد",
    NO_PERM: "⛔ هذا الأمر يحتاج صلاحية (.سماح 2).",
    NO_PERM_RESET: "⛔ هذا الأمر يحتاج صلاحية أعلى (.سماح 1).",
    NO_PERM_URL: "⛔ هذا الأمر للمطور فقط.",
    NEED_MENTION: "⚠️ يرجى عمل Mention للعضو.\nمثال: .جديد @user",
    EXPIRED: "⌛ انتهت صلاحية جلسة التسجيل أو لم تعد موجودة.\nاطلب من المسؤول إعادة كتابة .جديد @user",
    NOTE: "ملاحظة: عندما تدخل بياناتك بشكل خاطئ أو مزيف\nلن تتمكن من تعديلها لاحقًا!",
    ACK_REQUIRED: "⚠️ يجب تحديد الملاحظة (☑) قبل المتابعة.",
    MISSING: "⚠️ بيانات ناقصة: يرجى ملء اللقب ومن طرف من دخلت والجنس.",
    TOO_MANY: "⛔ تجاوزت عدد المحاولات المسموح. أغلقت جلسة التسجيل، اطلب من المسؤول .جديد من جديد."
};

function header() {
    return "╔══════════════════════╗\n   🔥 𝑭. 𝑰. 𝑹 🔥\n╚══════════════════════╝\n🔥 نورت مملكة النار الخاصة بالجيسي 🔥";
}

// ============================================================
// أدوات
// ============================================================

const now = () => Date.now();

function randHex(bytes) { return crypto.randomBytes(bytes).toString("hex"); }

function safeEqual(a, b) {
    try {
        const x = Buffer.from(String(a));
        const y = Buffer.from(String(b));
        return x.length === y.length && crypto.timingSafeEqual(x, y);
    } catch (_) { return false; }
}

function withTimeout(promise, ms, label = "send") {
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timeout`)), ms); });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(t));
}

function cleanText(s) {
    return String(s ?? "")
        .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function toLatinDigits(s) {
    return String(s ?? "").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
        .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

function log(...a) { try { console.log("[flowreg]", ...a); } catch (_) {} }
function logErr(...a) { try { console.error("[flowreg]", ...a); } catch (_) {} }

// ============================================================
// قاعدة البيانات (داخل db نفسها: تبقى بعد إعادة التشغيل)
// ============================================================

function sessionsOf(db) {
    if (!db.regSessions || typeof db.regSessions !== "object" || Array.isArray(db.regSessions)) db.regSessions = {};
    return db.regSessions;
}

function usersOf(db) {
    if (!db.users || typeof db.users !== "object" || Array.isArray(db.users)) db.users = {};
    return db.users;
}

function ensureUserObj(db, key) {
    const users = usersOf(db);
    if (!users[key] || typeof users[key] !== "object" || Array.isArray(users[key])) {
        users[key] = { balance: 0, nickname: "", rank: "", maxInteraction: 0, friend: "" };
    }
    const u = users[key];
    if (typeof u.balance !== "number" || !Number.isFinite(u.balance)) u.balance = 0;
    if (typeof u.nickname !== "string") u.nickname = "";
    if (typeof u.rank !== "string") u.rank = "";
    if (typeof u.maxInteraction !== "number" || !Number.isFinite(u.maxInteraction)) u.maxInteraction = 0;
    if (typeof u.friend !== "string") u.friend = "";
    return u;
}

/** نفس منطق التشابه المستعمل في .سجل (commands.js) — نستعمل الأصل إن توفّر */
function localSimilar(existing, newName) {
    const norm = (s) => String(s).replace(/[أإآ]/g, "ا").replace(/ى/g, "ي")
        .replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();
    const a = norm(existing), b = norm(newName);
    if (a === b) return true;
    const clean = (s) => s.replace(/\s*\d+$/, "").trim();
    const ca = clean(a), cb = clean(b);
    if (ca === cb) return true;
    const min = Math.min(ca.length, cb.length);
    if (min < 3) return false;
    let m = 0;
    for (let i = 0; i < min; i++) if (ca[i] === cb[i]) m++;
    return (m / min) > 0.85;
}

function similarFn() {
    try {
        const c = require("./commands");
        if (c && typeof c.isSimilarNickname === "function") return c.isSimilarNickname;
    } catch (_) {}
    return localSimilar;
}

/** هل اللقب مأخوذ من عضو آخر؟ (نتجاهل أرقام العضو المستهدف نفسه) */
function findNicknameTaken(db, nickname, targetNumber) {
    const similar = similarFn();
    const mine = new Set(jf.aliasesOf(targetNumber));
    const users = usersOf(db);
    for (const n of Object.keys(users)) {
        const u = users[n];
        if (!u || !String(u.nickname || "").trim()) continue;
        if (mine.has(n)) continue;
        if (similar(u.nickname, nickname)) return { number: n, nickname: u.nickname };
    }
    return null;
}

function isRegistered(db, number) {
    const users = usersOf(db);
    for (const a of jf.aliasesOf(number)) {
        const u = users[a];
        if (u && (u.registered === true || String(u.nickname || "").trim())) return true;
    }
    return false;
}

// ============================================================
// الصلاحيات (نفس نظام db.permissions الحالي)
// ============================================================

function hasLevel(db, number, levels) {
    const p = db.permissions || {};
    const aliases = jf.aliasesOf(number);
    return levels.some(l => Array.isArray(p[l]) && aliases.some(a => p[l].includes(a)));
}

const canRegister = (db, n, owner) => Boolean(owner) || hasLevel(db, n, CFG.registerLevels);
const canReset = (db, n, owner) => Boolean(owner) || hasLevel(db, n, CFG.resetLevels);
const canSetUrl = (db, n, owner) => Boolean(owner) || hasLevel(db, n, CFG.urlLevels);

// ============================================================
// الرابط الأساسي
// ============================================================

function validUrl(u) {
    try {
        const x = new URL(String(u).trim());
        return (x.protocol === "https:" || x.protocol === "http:") ? x.toString() : "";
    } catch (_) { return ""; }
}

function envPublicUrl() {
    const raw = String(process.env.PUBLIC_URL || "")
        .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "").trim().replace(/^["'`]+|["'`]+$/g, "");
    return validUrl(raw);
}

function getPublicUrl(db) {
    return validUrl(db && db.publicUrl) || envPublicUrl() || "";
}

/** عند التشغيل: نحفظ PUBLIC_URL في قاعدة البيانات (إلا إذا غُيّر يدوياً بـ .رابط اساسي) */
function syncPublicUrlFromEnv(db) {
    const env = envPublicUrl();
    if (!env) return false;
    if (!db.publicUrl || db.publicUrlSource === "env") {
        if (db.publicUrl !== env) { db.publicUrl = env; db.publicUrlSource = "env"; return true; }
        db.publicUrlSource = "env";
    }
    return false;
}

// ============================================================
// الجلسات
// ============================================================

const locks = new Set();           // sid قيد المعالجة (يمنع الضغط المتكرر السريع)
const deniedAt = new Map();        // مفتاح "sid|sender" → وقت آخر رفض

function newToken(sid, token) { return `reg.${sid}.${token}`; }

function findActiveSessionFor(db, number) {
    const t = now();
    for (const s of Object.values(sessionsOf(db))) {
        if (s && s.status === "open" && s.expiresAt > t && jf.sameUser(s.target, number)) return s;
    }
    return null;
}

function createSession(db, { chatJid, target, targetJid, createdBy, mode }) {
    const t = now();
    const s = {
        sessionId: randHex(4),
        token: randHex(12),
        targetUserId: jf.canonical(db, target),
        target: jf.canonical(db, target),
        targetJid: targetJid || "",
        createdBy: String(createdBy || ""),
        chatJid,
        mode: mode === "flow" ? "flow" : "chat",
        status: "open",
        currentStep: mode === "flow" ? "flow" : "nickname",
        step: mode === "flow" ? "flow" : "nickname",
        data: {},
        attempts: 0,
        createdAt: t,
        expiresAt: t + CFG.sessionMs
    };
    sessionsOf(db)[s.sessionId] = s;
    return s;
}

function touch(session) {
    const t = now();
    session.expiresAt = Math.min(t + CFG.extendMs, session.createdAt + CFG.maxLifeMs);
}

function dropSession(db, session) {
    if (session && session.sessionId) delete sessionsOf(db)[session.sessionId];
}

/** تنظيف الجلسات المنتهية (يُستدعى بمؤقت + عند كل أمر) */
function cleanupSessions(db) {
    if (!db) return 0;
    const sess = sessionsOf(db);
    const t = now();
    let removed = 0;
    for (const id of Object.keys(sess)) {
        const s = sess[id];
        if (!s || typeof s !== "object" || s.status !== "open" || s.expiresAt <= t || t - s.createdAt > CFG.maxLifeMs + 60000) {
            delete sess[id];
            locks.delete(id);
            removed++;
        }
    }
    for (const [k, v] of deniedAt) if (t - v > 5 * 60 * 1000) deniedAt.delete(k);
    return removed;
}

function authorize(db, session, token, senderNumber) {
    if (!session || session.status !== "open" || session.expiresAt <= now()) return { ok: false, reason: "expired" };
    if (!safeEqual(session.token, token)) return { ok: false, reason: "token" };
    if (!senderNumber || !jf.sameUser(session.target, senderNumber)) return { ok: false, reason: "not_target" };
    return { ok: true };
}

// ============================================================
// التحقق من البيانات (منطق نقي — قابل للاختبار)
// ============================================================

function validateNickname(db, session, raw) {
    const v = cleanText(raw);
    if (!v) return { error: "⚠️ يرجى كتابة لقبك." };
    if (v.length < 2) return { error: "⚠️ اللقب قصير جداً (حرفان على الأقل)." };
    if (v.length > 30) return { error: "⚠️ اللقب طويل جداً (30 حرفاً كحد أقصى)." };
    if (/^[.@]/.test(v)) return { error: "⚠️ لا يمكن أن يبدأ اللقب بنقطة أو @." };
    if (findNicknameTaken(db, v, session.target)) return { error: MSG.TAKEN, taken: true };
    return { value: v };
}

function validateReferrer(raw) {
    const v = cleanText(raw);
    if (!v) return { error: "⚠️ يرجى كتابة من طرف مين دخلت." };
    if (v.length > 40) return { error: "⚠️ الاسم طويل جداً (40 حرفاً كحد أقصى)." };
    return { value: v };
}

function normGender(v) {
    const s = cleanText(v).toLowerCase();
    if (GENDERS[s]) return GENDERS[s];
    if (s === "ذكر") return "ذكر";
    if (s === "انثى" || s === "أنثى") return "أنثى";
    if (s === "مخصص") return "مخصص";
    return null;
}

/** العمر اختياري: فارغ → null */
function validateAge(raw) {
    const v = toLatinDigits(cleanText(raw));
    if (!v || v === "-" || v === "تخطي") return { value: null };
    if (!/^\d{1,3}$/.test(v)) return { error: "⚠️ العمر يجب أن يكون رقماً (أو اتركه فارغاً)." };
    const n = parseInt(v, 10);
    if (n < 5 || n > 99) return { error: "⚠️ العمر يجب أن يكون بين 5 و 99 (أو اتركه فارغاً)." };
    return { value: n };
}

function truthyAck(v) {
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "string") return ["true", "1", "yes", "ack", "agree", "on", "موافق"].includes(v.trim().toLowerCase());
    return v === true;
}

/**
 * الإكمال النهائي: ذرّي (متزامن بالكامل — جافاسكربت أحادي الخيط)،
 * يعيد فحص التسجيل المسبق واللقب لحظة الكتابة فلا يمكن لشخصين أخذ نفس اللقب.
 */
function commit(db, session, data) {
    if (isRegistered(db, session.target)) {
        dropSession(db, session);
        return { ok: false, code: "already", message: MSG.ALREADY };
    }
    if (findNicknameTaken(db, data.nickname, session.target)) {
        return { ok: false, code: "taken", message: MSG.TAKEN };
    }
    const key = jf.canonical(db, session.target);
    const u = ensureUserObj(db, key);
    u.nickname = data.nickname;
    u.gender = data.gender;
    u.age = data.age === undefined ? null : data.age;
    u.referredBy = data.referredBy;
    u.registered = true;
    u.registrationDate = new Date().toISOString();
    session.status = "done";
    dropSession(db, session);
    return { ok: true, key, user: u };
}

/** Submit قادم من WhatsApp Flow (كل الحقول دفعة واحدة) */
function submitFlow(db, session, payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    const nick = cleanText(p.nickname);
    const ref = cleanText(p.referrer ?? p.referredBy);
    const gender = normGender(p.gender);

    if (!nick || !ref || !gender) return { ok: false, code: "missing", message: MSG.MISSING };

    if (!truthyAck(p.ack ?? p.agree ?? p.note)) return { ok: false, code: "ack", message: MSG.ACK_REQUIRED };

    const nv = validateNickname(db, session, nick);
    if (nv.error) return { ok: false, code: nv.taken ? "taken" : "nickname", message: nv.error };
    const rv = validateReferrer(ref);
    if (rv.error) return { ok: false, code: "referrer", message: rv.error };
    const av = validateAge(p.age);
    if (av.error) return { ok: false, code: "age", message: av.error };

    return commit(db, session, { nickname: nv.value, referredBy: rv.value, gender, age: av.value });
}

/**
 * إدخال في الواجهة النصية/الأزرار (خطوة بخطوة).
 * input: { action?, value?, text? }
 * يعيد: {kind:"step"|"done"|"cancel"|"noop"|"closed", error?, user?}
 */
function chatInput(db, session, input) {
    const act = input.action || "";
    const text = input.text;

    if (act === "cancel" || (!act && ["الغاء", "إلغاء", "cancel"].includes(cleanText(text).toLowerCase()))) {
        dropSession(db, session);
        return { kind: "cancel" };
    }
    if (act === "restart") {
        session.data = {};
        session.step = session.currentStep = "nickname";
        touch(session);
        return { kind: "step" };
    }

    const fail = (error) => {
        session.attempts = (session.attempts || 0) + 1;
        if (session.attempts >= CFG.maxAttempts) {
            dropSession(db, session);
            return { kind: "closed", error: MSG.TOO_MANY };
        }
        return { kind: "step", error };
    };
    const go = (step) => { session.step = session.currentStep = step; session.attempts = 0; touch(session); return { kind: "step" }; };

    const d = session.data || (session.data = {});

    switch (session.step) {
        case "nickname": {
            if (act) return { kind: "noop" };
            const v = validateNickname(db, session, text);
            if (v.error) return fail(v.error);
            d.nickname = v.value;
            return go("referrer");
        }
        case "referrer": {
            if (act) return { kind: "noop" };
            const v = validateReferrer(text);
            if (v.error) return fail(v.error);
            d.referredBy = v.value;
            return go("gender");
        }
        case "gender": {
            let g = null;
            if (act === "gender") g = normGender(input.value);
            else if (!act) g = normGender(text);
            else return { kind: "noop" };
            if (!g) return fail("⚠️ اختر: ذكر / أنثى / مخصص.");
            d.gender = g;
            return go("age");
        }
        case "age": {
            if (act && act !== "skipage") return { kind: "noop" };
            const v = act === "skipage" ? { value: null } : validateAge(text);
            if (v.error) return fail(v.error);
            d.age = v.value;
            return go("confirm");
        }
        case "confirm": {
            const typedAck = !act && ["موافق", "اوافق", "أوافق", "تم"].includes(cleanText(text));
            if (act !== "ack" && !typedAck) {
                if (act) return { kind: "noop" };
                return fail(MSG.ACK_REQUIRED);
            }
            const r = commit(db, session, {
                nickname: d.nickname, referredBy: d.referredBy, gender: d.gender, age: d.age
            });
            if (r.ok) return { kind: "done", user: r.user, key: r.key };
            if (r.code === "taken") {
                // اللقب أُخذ أثناء التسجيل → نعود لخطوة اللقب
                session.step = session.currentStep = "nickname";
                delete d.nickname;
                return { kind: "step", error: MSG.TAKEN };
            }
            return { kind: "closed", error: r.message };
        }
        default:
            return { kind: "noop" };
    }
}

// ============================================================
// الإرسال (آمن: try/catch + مهلة، لا يُعلّق البوت)
// ============================================================

const quick = (display_text, id) => ({ name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text, id }) });
const btnId = (s, action, value = "") => `reg|${s.sessionId}|${s.token}|${action}|${value}`;

/** الإرسال الافتراضي: نفس مكتبة الأزرار المستعملة في .العاب */
async function defaultSendInteractive(sock, jid, { text, footer, buttons }) {
    const { sendInteractiveMessage } = require("@qadeerxtech/qadeer-btns");
    return sendInteractiveMessage(sock, jid, { text, footer: footer || FOOTER, interactiveButtons: buttons });
}
let sendInteractiveImpl = defaultSendInteractive;

async function safeText(sock, jid, text, quoted, mentions) {
    try {
        const content = { text };
        if (mentions && mentions.length) content.mentions = mentions;
        return await withTimeout(sock.sendMessage(jid, content, quoted ? { quoted } : undefined), CFG.sendTimeoutMs);
    } catch (e) {
        logErr("sendText failed:", e && e.message);
        return null;
    }
}

/** يرسل واجهة تفاعلية؛ عند الفشل يرسل نصاً بديلاً (إن وُجد) ويعيد { ok, mode } */
async function sendUi(sock, jid, { text, buttons, fallbackText }) {
    try {
        await withTimeout(sendInteractiveImpl(sock, jid, { text, footer: FOOTER, buttons }), CFG.sendTimeoutMs, "interactive");
        return { ok: true, mode: "native" };
    } catch (e) {
        logErr("interactive failed:", e && e.message);
    }
    if (fallbackText) {
        const r = await safeText(sock, jid, fallbackText);
        return { ok: Boolean(r), mode: "text" };
    }
    return { ok: false, mode: "none" };
}

async function mentionOf(sock, session) {
    try {
        const j = await withTimeout(jf.resolveJid(sock, session.chatJid, session.targetJid || session.target), 8000, "resolve");
        return j || session.targetJid || `${session.target}@s.whatsapp.net`;
    } catch (_) { return session.targetJid || `${session.target}@s.whatsapp.net`; }
}

// ============================================================
// عرض الواجهات
// ============================================================

function flowButton(session) {
    const params = {
        flow_message_version: "3",
        flow_token: newToken(session.sessionId, session.token),
        flow_id: CFG.flowId,
        flow_cta: "📝 افتح نموذج التسجيل",
        flow_action: "navigate",
        flow_action_payload: { screen: "REGISTER", data: { token: newToken(session.sessionId, session.token) } },
        icon: "DEFAULT"
    };
    if (CFG.flowMode) params.mode = CFG.flowMode;
    return { name: "galaxy_message", buttonParamsJson: JSON.stringify(params) };
}

async function sendFlowInvite(sock, session, errorText) {
    const text = [
        header(), "",
        errorText ? errorText + "\n" : "",
        "رجاءً املأ هذه البيانات:",
        "اضغط الزر بالأسفل لفتح النموذج 👇"
    ].filter(x => x !== "").join("\n");
    return sendUi(sock, session.chatJid, { text, buttons: [flowButton(session)] });
}

function stepView(session, errorText) {
    const d = session.data || {};
    const err = errorText ? errorText + "\n\n" : "";
    switch (session.step) {
        case "nickname":
            return {
                text: `${header()}\n\nرجاءً املأ هذه البيانات:\n\n${err}🪪 *(1/4) لقبك*\nلقبك أو اسم شخصية أنمي تفضل أن نناديك فيه\n\n✍️ اكتب لقبك الآن في رسالة.\n_(للإلغاء اكتب: الغاء)_`,
                buttons: [quick("❌ إلغاء", btnId(session, "cancel"))]
            };
        case "referrer":
            return {
                text: `${err}🔰 *(2/4) من طرف مين دخلت؟*\n\n✍️ اكتب اسم الشخص الذي دعاك.`,
                buttons: [quick("❌ إلغاء", btnId(session, "cancel"))]
            };
        case "gender":
            return {
                text: `${err}⚧️ *(3/4) ما جنسك؟*\nاختر من الأزرار 👇`,
                buttons: [
                    quick("ذكر", btnId(session, "gender", "male")),
                    quick("أنثى", btnId(session, "gender", "female")),
                    quick("مخصص", btnId(session, "gender", "custom"))
                ],
                fallbackText: `${err}⚧️ *(3/4) ما جنسك؟*\nاكتب: ذكر / أنثى / مخصص`
            };
        case "age":
            return {
                text: `${err}🎂 *(4/4) عمرك؟*\nالإجابة اختيارية — اكتب رقماً أو اضغط تخطي 👇`,
                buttons: [quick("⏭️ تخطي", btnId(session, "skipage"))],
                fallbackText: `${err}🎂 *(4/4) عمرك؟* (اختياري)\nاكتب رقماً أو اكتب: تخطي`
            };
        case "confirm":
            return {
                text:
                    `${err}📋 *مراجعة بياناتك*\n\n` +
                    `🪪 اللقب: ${d.nickname}\n🔰 من طرف: ${d.referredBy}\n⚧️ الجنس: ${d.gender}\n🎂 العمر: ${d.age == null ? "—" : d.age}\n\n` +
                    `☑️ ${MSG.NOTE}`,
                buttons: [
                    quick("☑️ أقرّ بالملاحظة وأتابع", btnId(session, "ack")),
                    quick("✏️ تعديل", btnId(session, "restart")),
                    quick("❌ إلغاء", btnId(session, "cancel"))
                ],
                fallbackText: `${err}📋 *مراجعة بياناتك*\n\n🪪 ${d.nickname}\n🔰 ${d.referredBy}\n⚧️ ${d.gender}\n🎂 ${d.age == null ? "—" : d.age}\n\n☑️ ${MSG.NOTE}\n\nللمتابعة اكتب: موافق`
            };
        default:
            return null;
    }
}

async function sendStep(sock, session, errorText) {
    const v = stepView(session, errorText);
    if (!v) return { ok: false };
    if (!v.buttons) return sendUi(sock, session.chatJid, { text: v.text, buttons: [], fallbackText: v.text });
    return sendUi(sock, session.chatJid, {
        text: v.text,
        buttons: v.buttons,
        fallbackText: v.fallbackText || v.text
    });
}

async function sendSuccess(sock, db, session, user) {
    const url = getPublicUrl(db);
    const mention = await mentionOf(sock, session);
    const num = jf.jnum(mention) || session.target;
    const text =
        "✅━━━━━━━━━━━━━━━━✅\n" +
        "        ✅ *تم تسجيلك!*\n\n" +
        `👤 @${num}\n🪪 اللقب: *${user.nickname}*\n\n` +
        "أنت الآن في قروب الاستقبال.\n\n" +
        "رجاءً اضغط الزر التالي\nللانتقال إلى القروب الأساسي:\n" +
        "✅━━━━━━━━━━━━━━━━✅";

    // رسالة منشن قصيرة (الواجهة التفاعلية لا تدعم المنشن دائماً)
    await safeText(sock, session.chatJid, `✅ تم تسجيل @${num} بنجاح 🔥`, null, [mention]);

    if (!url) {
        await safeText(sock, session.chatJid,
            text + "\n\n⚠️ لم يُحدَّد رابط الدخول بعد، اطلب من المسؤول: .رابط اساسي (الرابط)", null, [mention]);
        return { ok: true, mode: "text-nourl" };
    }
    const buttons = [{
        name: "cta_url",
        buttonParamsJson: JSON.stringify({ display_text: "🟢 الدخول", url, merchant_url: url })
    }];
    const r = await sendUi(sock, session.chatJid, { text, buttons, fallbackText: null });
    if (!r.ok) {
        // آخر حل: نص مع الرابط (فقط إذا فشل الزر تماماً)
        await safeText(sock, session.chatJid, `${text}\n\n🟢 الدخول: ${url}`, null, [mention]);
    }
    return r;
}

// ============================================================
// استخراج الأحداث من رسائل واتساب
// ============================================================

function senderJidOf(msg) {
    return msg?.key?.participant || msg?.key?.remoteJid || "";
}

function extractInteractive(msg) {
    const m = msg?.message || {};
    const nf = m.interactiveResponseMessage?.nativeFlowResponseMessage;
    if (nf) {
        let params = {};
        try { params = JSON.parse(nf.paramsJson || "{}") || {}; } catch (_) {}
        return { name: String(nf.name || ""), params };
    }
    if (m.buttonsResponseMessage?.selectedButtonId) return { name: "legacy", params: { id: m.buttonsResponseMessage.selectedButtonId } };
    if (m.listResponseMessage?.singleSelectReply?.selectedRowId) return { name: "legacy", params: { id: m.listResponseMessage.singleSelectReply.selectedRowId } };
    if (m.templateButtonReplyMessage?.selectedId) return { name: "legacy", params: { id: m.templateButtonReplyMessage.selectedId } };
    return null;
}

function parseBtnId(id) {
    const p = String(id || "").split("|");
    if (p[0] !== "reg" || p.length < 4) return null;
    return { sid: p[1], token: p[2], action: p[3], value: p[4] || "" };
}

function parseFlowToken(t) {
    const m = /^reg\.([0-9a-f]+)\.([0-9a-f]+)$/.exec(String(t || ""));
    return m ? { sid: m[1], token: m[2] } : null;
}

function mentionedJids(msg) {
    const m = msg?.message || {};
    const ctx = m.extendedTextMessage?.contextInfo || m.conversation?.contextInfo || m.contextInfo || null;
    const list = Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid : [];
    if (list.length) return list;
    if (ctx?.participant) return [ctx.participant];   // رد على رسالة العضو
    return [];
}

// ============================================================
// رفض الغير
// ============================================================

async function denyNotYours(sock, jid, msg, sid, senderNumber) {
    const key = `${sid}|${senderNumber}`;
    const t = now();
    if (t - (deniedAt.get(key) || 0) < CFG.deniedCooldownMs) return;
    deniedAt.set(key, t);
    await safeText(sock, jid, MSG.NOT_YOURS, msg);
}

// ============================================================
// معالجة الأحداث الواردة
// ============================================================

/** ضغطة زر أو Submit من Flow. يعيد true إن كان الحدث يخص التسجيل. */
async function handleInteractive(sock, jid, msg, db, saveDb, cleanSender, owner) {
    const ev = extractInteractive(msg);
    if (!ev) return false;

    let sid = "", token = "", action = "", value = "", flowPayload = null;

    const fromId = parseBtnId(ev.params.id);
    const fromFlow = parseFlowToken(ev.params.flow_token || ev.params.token);

    if (fromId) {
        ({ sid, token, action, value } = fromId);
    } else if (fromFlow) {
        sid = fromFlow.sid; token = fromFlow.token; action = "submit"; flowPayload = ev.params;
    } else {
        return false;   // ليس لنا
    }

    const sender = cleanSender || jf.jnum(senderJidOf(msg));

    try {
        cleanupSessions(db);
        const session = sessionsOf(db)[sid];

        if (!session) {
            if (isRegistered(db, sender)) await safeText(sock, jid, MSG.ALREADY, msg);
            else await safeText(sock, jid, MSG.EXPIRED, msg);
            return true;
        }

        const auth = authorize(db, session, token, sender);
        if (!auth.ok) {
            if (auth.reason === "not_target") await denyNotYours(sock, jid, msg, sid, sender);
            else if (auth.reason === "expired") await safeText(sock, jid, MSG.EXPIRED, msg);
            // token خاطئ: نتجاهل بصمت
            return true;
        }

        // ضغط متكرر سريع على نفس الجلسة → نتجاهل الزائد
        if (locks.has(sid)) return true;
        locks.add(sid);
        try {
            if (action === "submit") {
                if (session.mode !== "flow") return true;
                const r = submitFlow(db, session, flowPayload);
                if (r.ok) {
                    saveDb();
                    await sendSuccess(sock, db, session, r.user);
                    return true;
                }
                if (r.code === "already") { saveDb(); await safeText(sock, jid, r.message, msg); return true; }
                session.attempts = (session.attempts || 0) + 1;
                if (session.attempts >= CFG.maxAttempts) {
                    dropSession(db, session); saveDb();
                    await safeText(sock, jid, MSG.TOO_MANY, msg);
                    return true;
                }
                touch(session); saveDb();
                await sendFlowInvite(sock, session, r.message);   // الخطأ داخل نفس الواجهة + إعادة فتح النموذج
                return true;
            }

            if (session.mode !== "chat") return true;
            await applyChat(sock, db, saveDb, session, { action, value }, msg);
            return true;
        } finally {
            locks.delete(sid);
        }
    } catch (e) {
        logErr("handleInteractive error:", e && e.message);
        return true;
    }
}

/** رسالة نصية من العضو أثناء جلسة (إدخال لقب/طرف/عمر...) أو id أزرار قديمة. */
async function handleMessageHook(sock, jid, msg, text, db, saveDb, cleanSender, owner) {
    try {
        const sess = db && db.regSessions;
        if (!sess) return false;
        const ids = Object.keys(sess);
        if (!ids.length) return false;          // مسار سريع: لا جلسات

        // أزرار/قوائم بصيغة قديمة تصل كنص
        if (typeof text === "string" && text.startsWith("reg|")) {
            const b = parseBtnId(text);
            if (!b) return false;
            return handleInteractive(sock, jid, {
                ...msg,
                message: { buttonsResponseMessage: { selectedButtonId: text } }
            }, db, saveDb, cleanSender, owner);
        }

        if (!text || text.startsWith(".")) return false;   // الأوامر تمرّ للبوت

        const sender = cleanSender || jf.jnum(senderJidOf(msg));
        const t = now();
        let mine = null;
        for (const id of ids) {
            const s = sess[id];
            if (s && s.status === "open" && s.mode === "chat" && s.expiresAt > t && s.chatJid === jid && jf.sameUser(s.target, sender)) { mine = s; break; }
        }
        if (!mine) return false;                  // رسالة عادية من شخص آخر → لا نلمسها

        if (locks.has(mine.sessionId)) return true;
        locks.add(mine.sessionId);
        try {
            await applyChat(sock, db, saveDb, mine, { text }, msg);
        } finally {
            locks.delete(mine.sessionId);
        }
        return true;
    } catch (e) {
        logErr("handleMessageHook error:", e && e.message);
        return false;
    }
}

async function applyChat(sock, db, saveDb, session, input, msg) {
    const r = chatInput(db, session, input);
    saveDb();
    switch (r.kind) {
        case "noop": return;
        case "cancel":
            await safeText(sock, session.chatJid, "🚫 تم إلغاء جلسة التسجيل. يمكن للمسؤول إعادة .جديد @user", msg);
            return;
        case "closed":
            await safeText(sock, session.chatJid, r.error || MSG.TOO_MANY, msg);
            return;
        case "done":
            await sendSuccess(sock, db, session, r.user);
            return;
        case "step":
            await sendStep(sock, session, r.error);
            return;
    }
}

// ============================================================
// الأوامر
// ============================================================

async function handleCommand(sock, jid, msg, text, db, saveDb, cleanSender, owner) {
    if (typeof text !== "string" || !text.startsWith(".")) return false;
    const body = text.slice(1).trim();
    const words = body.split(/\s+/);
    const cmd = words[0];

    // ---------------- .جديد @user ----------------
    if (cmd === "جديد") {
        try {
            cleanupSessions(db);
            if (!canRegister(db, cleanSender, owner)) { await safeText(sock, jid, MSG.NO_PERM, msg); return true; }

            const mentioned = mentionedJids(msg);
            if (!mentioned.length) { await safeText(sock, jid, MSG.NEED_MENTION, msg); return true; }

            const targetJid = mentioned[0];
            const target = jf.canonical(db, jf.jnum(targetJid));
            if (!target) { await safeText(sock, jid, MSG.NEED_MENTION, msg); return true; }
            jf.rememberJid(jf.jnum(targetJid), targetJid);

            const tm = await mentionOf(sock, { chatJid: jid, targetJid, target });

            if (isRegistered(db, target)) {
                await safeText(sock, jid, `@${jf.jnum(tm) || target}\n${MSG.ALREADY}`, msg, [tm]);
                return true;
            }

            const existing = findActiveSessionFor(db, target);
            if (existing) {
                const left = Math.max(1, Math.ceil((existing.expiresAt - now()) / 60000));
                await safeText(sock, jid,
                    `⏳ توجد جلسة تسجيل مفتوحة لهذا العضو (تنتهي بعد ~${left} دقيقة).\nلإعادتها من الصفر اكتب: .تصفير @user`, msg);
                return true;
            }

            let chatJid = jid;
            if (CFG.sendDm) {
                try { chatJid = await jf.resolveJid(sock, jid, targetJid) || jid; } catch (_) { chatJid = jid; }
            }

            const useFlow = Boolean(CFG.flowId);
            const session = createSession(db, { chatJid, target, targetJid: tm, createdBy: cleanSender, mode: useFlow ? "flow" : "chat" });
            saveDb();

            await safeText(sock, jid, `🔥 @${jf.jnum(tm) || target} تم فتح صفحة تسجيل خاصة بك، تابع الرسالة التالية 👇`, null, [tm]);

            let r;
            if (useFlow) {
                r = await sendFlowInvite(sock, session);
                if (!r.ok) {
                    // تعذر إرسال الـFlow → نتحول تلقائياً للواجهة الخطوية
                    log("flow send failed → falling back to chat UI");
                    session.mode = "chat"; session.step = session.currentStep = "nickname";
                    saveDb();
                    r = await sendStep(sock, session);
                }
            } else {
                r = await sendStep(sock, session);
            }
            if (!r || !r.ok) {
                dropSession(db, session); saveDb();
                await safeText(sock, jid, "⚠️ تعذر إرسال واجهة التسجيل الآن، حاول مرة أخرى بعد قليل.", msg);
            }
        } catch (e) {
            logErr(".جديد error:", e && e.message);
        }
        return true;
    }

    // ---------------- .تصفير @user ----------------
    if (cmd === "تصفير") {
        try {
            if (!canReset(db, cleanSender, owner)) { await safeText(sock, jid, MSG.NO_PERM_RESET, msg); return true; }
            const mentioned = mentionedJids(msg);
            if (!mentioned.length) { await safeText(sock, jid, "⚠️ يرجى عمل Mention للعضو.\nمثال: .تصفير @user", msg); return true; }
            const num = jf.jnum(mentioned[0]);
            const r = resetUser(db, num);
            saveDb();
            const tm = await mentionOf(sock, { chatJid: jid, targetJid: mentioned[0], target: num });
            await safeText(sock, jid,
                `✅ تم تصفير حالة التسجيل للعضو @${jf.jnum(tm) || num}\n` +
                (r.hadNickname ? `🗑️ اللقب المحذوف: [${r.hadNickname}] (الرصيد والرتبة محفوظان)\n` : "") +
                "يمكنه الآن التسجيل من جديد عبر: .جديد @user", msg, [tm]);
        } catch (e) {
            logErr(".تصفير error:", e && e.message);
        }
        return true;
    }

    // ---------------- .رابط اساسي [url] ----------------
    if (cmd === "رابط" && (words[1] === "اساسي" || words[1] === "أساسي")) {
        try {
            if (!canSetUrl(db, cleanSender, owner)) { await safeText(sock, jid, MSG.NO_PERM_URL, msg); return true; }
            const arg = words.slice(2).join(" ").trim();
            if (!arg) {
                const cur = getPublicUrl(db);
                await safeText(sock, jid, cur
                    ? `🔗 الرابط الأساسي الحالي:\n${cur}\n\nلتغييره: .رابط اساسي (الرابط الجديد)`
                    : "⚠️ لا يوجد رابط أساسي.\nاكتب: .رابط اساسي https://...\nأو ضع PUBLIC_URL في Variables.", msg);
                return true;
            }
            if (arg === "حذف") {
                db.publicUrl = ""; db.publicUrlSource = "cmd"; saveDb();
                await safeText(sock, jid, "🗑️ تم حذف الرابط الأساسي من الإعدادات.", msg);
                return true;
            }
            const url = validUrl(arg);
            if (!url) { await safeText(sock, jid, "❌ الرابط غير صالح. يجب أن يبدأ بـ https://", msg); return true; }
            db.publicUrl = url; db.publicUrlSource = "cmd"; saveDb();
            await safeText(sock, jid, `✅ تم حفظ الرابط الأساسي:\n${url}`, msg);
        } catch (e) {
            logErr(".رابط اساسي error:", e && e.message);
        }
        return true;
    }

    return false;
}

/** يمسح حالة التسجيل (اللقب + بيانات التسجيل + الجلسات) ويحتفظ بالرصيد والرتبة */
function resetUser(db, number) {
    const users = usersOf(db);
    let hadNickname = "";
    for (const a of jf.aliasesOf(number)) {
        const u = users[a];
        if (!u || typeof u !== "object") continue;
        if (!hadNickname && String(u.nickname || "").trim()) hadNickname = u.nickname;
        u.nickname = "";
        u.registered = false;
        delete u.gender; delete u.age; delete u.referredBy; delete u.registrationDate;
    }
    const sess = sessionsOf(db);
    for (const id of Object.keys(sess)) {
        if (sess[id] && jf.sameUser(sess[id].target, number)) { delete sess[id]; locks.delete(id); }
    }
    return { hadNickname };
}

// ============================================================
// التهيئة
// ============================================================

let cleanupTimer = null;

function init({ getDb, saveDb } = {}) {
    try {
        const db = typeof getDb === "function" ? getDb() : global.db;
        if (db) {
            if (syncPublicUrlFromEnv(db) && typeof saveDb === "function") saveDb();
            cleanupSessions(db);
        }
    } catch (e) { logErr("init error:", e && e.message); }

    if (!cleanupTimer) {
        cleanupTimer = setInterval(() => {
            try {
                const db = typeof getDb === "function" ? getDb() : global.db;
                if (db && cleanupSessions(db) > 0 && typeof saveDb === "function") saveDb();
            } catch (_) {}
        }, CFG.cleanupEveryMs);
        if (cleanupTimer.unref) cleanupTimer.unref();
    }
    log(`جاهز — الوضع: ${CFG.flowId ? "WhatsApp Flow (FLOW_ID)" : "أزرار native خطوة بخطوة"}`);
}

module.exports = {
    init,
    handleCommand,
    handleMessageHook,
    handleInteractive,
    // للاختبار
    _t: {
        CFG, MSG, createSession, chatInput, submitFlow, commit, resetUser, cleanupSessions,
        findNicknameTaken, isRegistered, getPublicUrl, syncPublicUrlFromEnv, authorize,
        sessionsOf, findActiveSessionFor, validateAge, normGender, locks,
        setSendInteractive(fn) { sendInteractiveImpl = fn || defaultSendInteractive; },
        newToken
    }
};
