// ============================================================
// ban.js   (ملف جديد)
// ALJESAT BOT
//   • .حظر @منشن مدة        (صلاحية .سماح 1)   مثال: .حظر @x 40د
//   • .فك حظر @منشن         (صلاحية .سماح 1)
//   • نظام الكسر (الرصيد السالب) + الحظر التلقائي 8 ساعات عند -3000
//   • .مراقب @منشن           (الإمبراطور) + خصم ضريبة المخالفات
// ============================================================

"use strict";

const jf = require("./jidfix");

// ============================================================
// إعدادات
// ============================================================

const KASR_LIMIT = 3000;          // عند الوصول له → حظر
const KASR_RESTORE = 2500;        // يصبح الكسر هذا بعد الحظر
const KASR_BAN_MS = 8 * 60 * 60 * 1000;
const VIOLATION_FEE = 100;
const NOTICE_COOLDOWN_MS = 10 * 1000;

const noticeCooldown = new Map();

// ============================================================
// أدوات
// ============================================================

function getMessageText(msg) {
    const m = msg?.message;
    if (!m) return "";
    return String(
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        ""
    ).trim();
}

function getMentionedList(msg) {
    try {
        const m = msg?.message || {};
        const inner = m.extendedTextMessage || m.imageMessage || m.videoMessage || m.documentMessage || {};
        const ctx = inner.contextInfo || m.contextInfo || {};
        return Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
    } catch (_) {
        return [];
    }
}

/** تنظيف النص من التطويل والتشكيل ورموز الاتجاه */
function cleanArabic(text) {
    return String(text || "")
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
        .replace(/\u0640/g, "")
        .replace(/[\u064B-\u065F\u0670]/g, "")
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه");
}

async function send(sock, jid, text, quoted = null, extra = {}) {
    if (!sock || !jid) return null;
    try {
        return await sock.sendMessage(jid, { text: String(text), ...extra }, quoted ? { quoted } : undefined);
    } catch (e) {
        console.error("❌ ban.send:", e?.message || e);
        return null;
    }
}

function hasLevel(db, number, level, owner) {
    if (owner) return true;
    const list = db.permissions && db.permissions[String(level)];
    if (!Array.isArray(list)) return false;
    return jf.aliasesOf(number).some(a => list.includes(a));
}

function isEmperorNumber(db, number) {
    const em = db.emperors || {};
    return jf.aliasesOf(number).some(a => em[a] === true);
}

function ensureUser(db, number) {
    db.users = db.users || {};
    if (!db.users[number] || typeof db.users[number] !== "object") {
        db.users[number] = { balance: 0, nickname: "", rank: "", maxInteraction: 0, friend: "" };
    }
    const u = db.users[number];
    if (typeof u.balance !== "number" || !Number.isFinite(u.balance)) u.balance = 0;
    if (typeof u.nickname !== "string") u.nickname = "";
    return u;
}

/** يجد مفتاح العضو في db.users بأي رقم مكافئ */
function userKeyFor(db, number) {
    const found = jf.pickByAlias(db.users, number);
    return found ? found.key : jf.jnum(number);
}

// ============================================================
// المدة
// ============================================================

/** "40د" → ms  |  "1س" | "3ي" | "30ث" | (الإنجليزية s/m/h/d) */
function parseDuration(token) {
    const t = String(token || "").trim().replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const m = t.match(/^(\d+)\s*(ثانية|ثواني|ث|دقيقة|دقائق|د|ساعة|ساعات|س|يوم|ايام|أيام|ي|s|m|h|d)$/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    const u = m[2].toLowerCase();
    let unit;
    if (["ث", "ثانية", "ثواني", "s"].includes(u)) unit = 1000;
    else if (["د", "دقيقة", "دقائق", "m"].includes(u)) unit = 60 * 1000;
    else if (["س", "ساعة", "ساعات", "h"].includes(u)) unit = 60 * 60 * 1000;
    else unit = 24 * 60 * 60 * 1000;
    return n * unit;
}

function plural(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return `${n} ${few}`;
    return `${n} ${many}`;
}

function formatDuration(ms) {
    let s = Math.max(1, Math.ceil(ms / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const parts = [];
    if (d) parts.push(plural(d, "يوم", "يومين", "أيام", "يوم"));
    if (h) parts.push(plural(h, "ساعة", "ساعتين", "ساعات", "ساعة"));
    if (m) parts.push(plural(m, "دقيقة", "دقيقتين", "دقائق", "دقيقة"));
    if (s && parts.length < 2 && !d) parts.push(plural(s, "ثانية", "ثانيتين", "ثوانٍ", "ثانية"));
    return parts.slice(0, 2).join(" و ") || "لحظات";
}

// ============================================================
// الحظر
// ============================================================

function bansObj(db) {
    if (!db.bans || typeof db.bans !== "object" || Array.isArray(db.bans)) db.bans = {};
    return db.bans;
}

/** يرجع سجل الحظر الفعّال أو null (ويحذف المنتهي) */
function getBan(db, number) {
    if (!db) return null;
    const bans = bansObj(db);
    const now = Date.now();
    let active = null;
    for (const a of jf.aliasesOf(number)) {
        const b = bans[a];
        if (!b) continue;
        if (Number(b.until) > now) {
            if (!active || b.until > active.until) active = b;
        } else {
            delete bans[a];
        }
    }
    return active;
}

function isBanned(db, number) {
    try {
        if (!db || !number) return false;
        if (isEmperorNumber(db, number)) return false;
        return Boolean(getBan(db, number));
    } catch (_) {
        return false;
    }
}

function banUser(db, saveDb, number, ms, by = "", reason = "") {
    const bans = bansObj(db);
    const until = Date.now() + ms;
    for (const a of jf.aliasesOf(number)) {
        bans[a] = { until, by, reason, at: Date.now() };
    }
    if (typeof saveDb === "function") saveDb();
    return until;
}

function unbanUser(db, saveDb, number) {
    const bans = bansObj(db);
    let had = false;
    for (const a of jf.aliasesOf(number)) {
        if (bans[a]) { delete bans[a]; had = true; }
    }
    if (typeof saveDb === "function") saveDb();
    return had;
}

function isOwnerLike(db, sock, number, ownerNumbers) {
    if (isEmperorNumber(db, number)) return true;
    if (jf.isMe(sock, number)) return true;
    return (ownerNumbers || []).some(o => jf.sameUser(o, number));
}

/** .حظر @منشن 40د */
async function handleBanCommand(sock, jid, msg, parts, db, saveDb, cleanSender, owner) {
    if (!hasLevel(db, cleanSender, "1", owner)) {
        await send(sock, jid, "⛔ هذا الأمر يحتاج صلاحية .سماح 1", msg);
        return true;
    }

    const mentions = getMentionedList(msg);
    const durationToken = (parts || []).find(x => parseDuration(x)) || "";
    const ms = parseDuration(durationToken);

    if (!mentions.length || !ms) {
        await send(sock, jid,
            "⚠️ الاستخدام: .حظر @منشن المدة\nأمثلة:\n.حظر @user 40د  (40 دقيقة)\n.حظر @user 1س  (ساعة)\n.حظر @user 3ي  (3 أيام)\n.حظر @user 30ث (30 ثانية)", msg);
        return true;
    }

    const target = jf.jnum(mentions[0]);
    let ownerNumbers = [];
    try { ownerNumbers = require("./bot").getOwnerNumbers(); } catch (_) {}

    if (isOwnerLike(db, sock, target, ownerNumbers)) {
        await send(sock, jid, "⛔ لا يمكن حظر الإمبراطور أو البوت.", msg);
        return true;
    }

    banUser(db, saveDb, target, ms, cleanSender, "manual");

    await send(sock, jid,
        `━━━━━═⏣⊰⛔⊱⏣═━━━━━\nتم حظر @${target} لمدة ${formatDuration(ms)}\n━━━━━═⏣⊰🛑⊱⏣═━━━━━`,
        msg, { mentions: [mentions[0]] });
    return true;
}

/** .فك حظر @منشن  |  .رفع حظر @منشن */
async function handleUnbanCommand(sock, jid, msg, db, saveDb, cleanSender, owner) {
    if (!hasLevel(db, cleanSender, "1", owner)) {
        await send(sock, jid, "⛔ هذا الأمر يحتاج صلاحية .سماح 1", msg);
        return true;
    }
    const mentions = getMentionedList(msg);
    if (!mentions.length) {
        await send(sock, jid, "⚠️ الاستخدام: .فك حظر @منشن", msg);
        return true;
    }
    const target = jf.jnum(mentions[0]);
    const had = unbanUser(db, saveDb, target);
    await send(sock, jid,
        had ? `✅ تم فك الحظر عن @${target}` : `⚠️ العضو @${target} ليس محظوراً.`,
        msg, { mentions: [mentions[0]] });
    return true;
}

/** رد على محظور حاول استعمال البوت (مع تحديد سرعة الرد) */
async function sendBannedNotice(sock, jid, msg, db, number) {
    try {
        const key = jf.jnum(number);
        const last = noticeCooldown.get(key) || 0;
        if (Date.now() - last < NOTICE_COOLDOWN_MS) return;
        noticeCooldown.set(key, Date.now());

        const ban = getBan(db, number);
        if (!ban) return;
        const sender = msg?.key?.participant || msg?.key?.remoteJid || `${key}@s.whatsapp.net`;

        await send(sock, jid,
            `━━━━━═⏣⊰⛔⊱⏣═━━━━━\n@${key} انت محظور لمدة ${formatDuration(ban.until - Date.now())}\n━━━━━═⏣⊰🛑⊱⏣═━━━━━`,
            msg, { mentions: [sender] });
    } catch (_) {}
}

// ============================================================
// الكسر (الرصيد السالب)
// ============================================================

function kasrLoanMessage(number, kasr) {
    return `━━━━━═⏣⊰📛⊱⏣═━━━━━
العضو @${number}
نود اعلامك بأن عليك دفع سلفة في رصيدك لانه قد اصبح عليك كسر
بقيمة: -${kasr}
═════════════════`;
}

function kasrBanMessage(number, kasr) {
    return `-$ ══════♨️══════ -$
العضو @${number}
لقد اصبح عليك:
كسر رصيد ${kasr}- تم حظرك من
استعمال البوت حتى 8س
عند انتهاء الوقت سيكون الكسر عليك
فقط ${KASR_RESTORE}- يرجى محاولة استعادة
المال وعدم تراكم الكسر وتجاوز      ${KASR_LIMIT}-  والا ستحظر مجددا
═════════════════`;
}

/**
 * خصم رصيد مع دعم الكسر.
 * opts.sendNotice = false → لا يرسل الإشعار ويرجعه في النتيجة (notice)
 * @returns {{before:number, after:number, event:null|"loan"|"limit", notice:string|null, key:string}}
 */
async function debit(sock, db, saveDb, chatJid, number, amount, opts = {}) {
    const amt = Math.max(0, Math.floor(Number(amount) || 0));
    const key = userKeyFor(db, number);
    const user = ensureUser(db, key);

    const before = Number(user.balance) || 0;
    let after = before - amt;
    let event = null;
    let notice = null;

    if (after < 0 && -after >= KASR_LIMIT) {
        const kasr = -after;
        after = -KASR_RESTORE;
        event = "limit";
        banUser(db, null, key, KASR_BAN_MS, "system", "kasr");
        notice = kasrBanMessage(key, kasr);
    } else if (before >= 0 && after < 0) {
        event = "loan";
        notice = kasrLoanMessage(key, -after);
    }

    user.balance = after;
    if (typeof saveDb === "function") saveDb();

    if (notice && opts.sendNotice !== false && chatJid) {
        const mentionJid = await jf.resolveJid(sock, chatJid, key);
        await send(sock, chatJid, notice, opts.quoted || null, { mentions: [mentionJid] });
    }

    return { before, after, event, notice, key };
}

// ============================================================
// المراقب والمخالفات
// ============================================================

function monitorsObj(db) {
    if (!db.violationMonitors || typeof db.violationMonitors !== "object" || Array.isArray(db.violationMonitors)) {
        db.violationMonitors = {};
    }
    return db.violationMonitors;
}

function isMonitor(db, number) {
    const mons = monitorsObj(db);
    return jf.aliasesOf(number).some(a => mons[a] === true);
}

/** .مراقب @منشن  (تفعيل/إلغاء) */
async function handleMonitorCommand(sock, jid, msg, db, saveDb, owner) {
    if (!owner) {
        await send(sock, jid, "⛔ هذا الأمر للإمبراطور فقط.", msg);
        return true;
    }
    const mentions = getMentionedList(msg);
    if (!mentions.length) {
        await send(sock, jid, "⚠️ الاستخدام: .مراقب @منشن\n(الرقم الذي يرسل رسائل المخالفات)", msg);
        return true;
    }
    const target = jf.jnum(mentions[0]);
    const mons = monitorsObj(db);
    if (isMonitor(db, target)) {
        for (const a of jf.aliasesOf(target)) delete mons[a];
        saveDb();
        await send(sock, jid, `❌ تم إلغاء @${target} من قائمة مراقبي المخالفات.`, msg, { mentions: [mentions[0]] });
    } else {
        for (const a of jf.aliasesOf(target)) mons[a] = true;
        saveDb();
        await send(sock, jid, `✅ تم تعيين @${target} كمراقب للمخالفات.\nأي رسالة مخالفة منه سيُخصم منها ${VIOLATION_FEE}$ من العضو المذكور.`, msg, { mentions: [mentions[0]] });
    }
    return true;
}

/** يعالج رسالة مخالفة من رقم المراقب. يرجع true إذا كانت مخالفة */
async function processViolation(sock, msg, db, saveDb) {
    try {
        const raw = getMessageText(msg);
        if (!raw) return false;

        const text = cleanArabic(raw);
        if (!text.includes("مخالفه")) return false;
        if (!(text.includes("السبب") || text.includes("عدد المخالفات"))) return false;

        const jid = msg.key.remoteJid;
        if (!jf.isGroupJid(jid)) return false;

        const senderJid = msg.key.fromMe ? sock?.user?.id : (msg.key.participant || "");
        const senderNum = jf.jnum(senderJid);
        if (!senderNum || !isMonitor(db, senderNum)) return false;

        // منع المعالجة المكررة
        db.violationSeen = Array.isArray(db.violationSeen) ? db.violationSeen : [];
        const id = msg.key.id;
        if (id) {
            if (db.violationSeen.includes(id)) return true;
            db.violationSeen.push(id);
            if (db.violationSeen.length > 300) db.violationSeen = db.violationSeen.slice(-300);
        }

        // استخراج العضو: السطر الذي فيه "العضو"
        const lines = text.split("\n");
        const memberLine = lines.find(l => l.includes("العضو")) || "";
        const mentions = getMentionedList(msg);
        let memberNum = "";
        const m = memberLine.match(/@(\d{6,})/);
        if (m) memberNum = m[1];
        else if (mentions.length) memberNum = jf.jnum(mentions[0]);
        if (!memberNum) return true;

        const key = userKeyFor(db, memberNum);
        const user = db.users && db.users[key];
        const nickname = (user && String(user.nickname || "").trim()) || "غير مسجل";

        const result = await debit(sock, db, saveDb, jid, key, VIOLATION_FEE, { sendNotice: false });

        await send(sock, jid,
            `•┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈•\nتم خصم رصيد من العضو:\n[ ${nickname} ]  قيمة الضريبة:  ${VIOLATION_FEE}\nالسبب:  ارتكاب مخالفة\n•┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈•`,
            msg);

        if (result.notice) {
            const mentionJid = await jf.resolveJid(sock, jid, result.key);
            await send(sock, jid, result.notice, null, { mentions: [mentionJid] });
        }
        return true;
    } catch (e) {
        console.error("❌ processViolation:", e?.message || e);
        return false;
    }
}

module.exports = {
    KASR_LIMIT,
    KASR_RESTORE,
    VIOLATION_FEE,
    parseDuration,
    formatDuration,
    isBanned,
    getBan,
    banUser,
    unbanUser,
    handleBanCommand,
    handleUnbanCommand,
    sendBannedNotice,
    debit,
    handleMonitorCommand,
    processViolation,
    isMonitor,
    cleanArabic,
    getMessageText,
    getMentionedList,
    userKeyFor
};
