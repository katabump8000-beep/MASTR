// ============================================================
// index.js
// ALJESAT BOT
// Main Entry Point + Watchdog + Rest System + LogGuard
// + Photos + Welcome + Tahmin + Results + CommandsList + Typo
// + JidFix + Ban + Shop + Guilds + Hads (اتبع حدسك)
// + Ai (إنشاء/إحضار الصور) + المؤبدين + أوامر رقم البوت نفسه
// + 🆕 Flow Registration (نظام التسجيل التفاعلي)
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");

const _originalLog = console.log.bind(console);
const _originalError = console.error.bind(console);
const _originalWarn = console.warn.bind(console);

const logGuard = {
    count: 0,
    windowStart: Date.now(),
    WINDOW_MS: 1000,
    MAX_PER_WINDOW: 30,
    dropped: 0,
    silenced: false,

    canLog() {
        const now = Date.now();
        if (now - this.windowStart >= this.WINDOW_MS) {
            this.windowStart = now;
            this.count = 0;
            if (this.silenced) {
                this.silenced = false;
                _originalWarn(`⚠️ [LogGuard] تم استئناف السجلات.`);
                this.dropped = 0;
            }
        }
        this.count++;
        if (this.count > this.MAX_PER_WINDOW) {
            this.silenced = true;
            this.dropped++;
            return false;
        }
        return true;
    }
};

console.log = (...args) => { if (logGuard.canLog()) _originalLog(...args); };
console.error = (...args) => { if (logGuard.canLog()) _originalError(...args); };
console.warn = (...args) => { if (logGuard.canLog()) _originalWarn(...args); };

// ============================================================
// Core
// ============================================================

const {
    startBot,
    configureHandlers,
    getDb,
    saveDb,
    jidToNumber,
    isGroupJid,
    isOwner,
    cleanNumber,
    getOwnerNumbers
} = require("./bot");

const { handleCommand, buildMyDetailsText } = require("./commands");
const jf = require("./jidfix");
const banModule = require("./ban");
const guildsModule = require("./guilds");
const hadsModule = require("./hads");

const {
    handleGroupJoin,
    startAdminMonitoring,
    stopAdminMonitoring
} = require("./admin");

const { activeGames } = require("./menu");
const { activeCasinos, isSarahaActive } = require("./duel");
const { activeSaraha, handleSarahaCommand } = require("./saraha");
const {
    activeMazads,
    handleMazadCommand,
    handleMazadBid,
    handleMazadInventory,
    handleMazadSend,
    handleMazadCancelSend
} = require("./mzad");
const { activeColors, handleColorsCommand } = require("./colors");
const { activeAnimals, handleAnimalsCommand } = require("./animals");

// ============================================================
// استيراد الملفات الجديدة
// ============================================================

let photosModule = null;
let welcomeModule = null;
let tahminModule = null;
let resultsModule = null;
let commandsListModule = null;
let typoModule = null;
let aiModule = null;
let registerModule = null;

try { photosModule = require("./photos"); } catch (e) { _originalWarn("⚠️ photos.js غير محمّل بعد"); }
try { welcomeModule = require("./welcome"); } catch (e) { _originalWarn("⚠️ welcome.js غير محمّل بعد"); }
try { tahminModule = require("./tahmin"); } catch (e) { _originalWarn("⚠️ tahmin.js غير محمّل بعد"); }
try { resultsModule = require("./results"); } catch (e) { _originalWarn("⚠️ results.js غير محمّل بعد"); }
try { commandsListModule = require("./commands_list"); } catch (e) { _originalWarn("⚠️ commands_list.js غير محمّل بعد"); }
try { typoModule = require("./typo"); } catch (e) { _originalWarn("⚠️ typo.js غير محمّل بعد"); }
try { aiModule = require("./Ai"); } catch (e) { _originalWarn("⚠️ Ai.js غير محمّل: " + (e && e.message)); }

// 🆕 نظام التسجيل التفاعلي القديم (flowreg) — يُبقى للحفاظ على التوافق
let flowRegModule = null;
try {
    flowRegModule = require("./flowreg");
    flowRegModule.init({ getDb, saveDb });
} catch (e) { _originalWarn("⚠️ flowreg.js غير محمّل: " + (e && e.message)); }

// 🆕 نظام التسجيل التفاعلي الجديد (flow-commands + flow-server)
// يعتمد على موقع GitHub Pages ويعمل عبر WebView
let flowCommands = null;
let flowServer = null;
try {
    flowCommands = require("./flow-commands");
    flowServer = require("./flow-server");
    _originalLog("✅ تم تحميل نظام التسجيل التفاعلي الجديد (flow-commands + flow-server)");
} catch (e) {
    _originalWarn("⚠️ flow-commands/flow-server غير محمّل: " + (e && e.message));
}

// register.js القديم (صفحة ويب): معطّل افتراضياً
if (String(process.env.LEGACY_REGISTER || "").toLowerCase() === "true") {
    try {
        registerModule = require("./register");
        registerModule.init({ getDb, saveDb, getOwnerNumbers });
    } catch (e) { _originalWarn("⚠️ register.js غير محمّل: " + (e && e.message)); }
}

// ============================================================
// Runtime
// ============================================================

let autoSaveInterval = null;
let autoSaveEnabled = false;
let autoSaveGroupJid = null;

let watchdogInterval = null;
let lastMessageAt = Date.now();
let lastGroupUpdateAt = Date.now();
let lastSocketRef = null;
let consecutiveIdleChecks = 0;
let deadSocketChecks = 0;

const WATCHDOG_CHECK_MS = 60 * 1000;
const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
const GAME_STUCK_THRESHOLD_MS = 25 * 60 * 1000;
const MAX_IDLE_CHECKS = 15;
const MAX_GAME_COUNT = 8;

// ============================================================
// 🛡️ حارس الإغراق
// ============================================================

const floodMap = new Map();
function isFlooding(sender) {
    const now = Date.now();
    let f = floodMap.get(sender);
    if (!f) { f = { times: [], until: 0 }; floodMap.set(sender, f); }
    if (now < f.until) return true;
    f.times = f.times.filter(t => now - t < 10 * 1000);
    f.times.push(now);
    if (f.times.length > 8) { f.until = now + 30 * 1000; f.times = []; return true; }
    if (floodMap.size > 2000) {
        for (const [k, v] of floodMap) if (now > v.until && !v.times.length) floodMap.delete(k);
    }
    return false;
}

// ============================================================
// 🛡️ حارس التزامن
// ============================================================

const MAX_PARALLEL_MESSAGES = 8;
const MAX_QUEUED_MESSAGES = 150;
const MESSAGE_SLOT_TIMEOUT_MS = 90 * 1000;
let activeSlots = 0;
const slotWaiters = [];
let droppedMessages = 0;

async function runWithSlot(work) {
    if (activeSlots >= MAX_PARALLEL_MESSAGES) {
        if (slotWaiters.length >= MAX_QUEUED_MESSAGES) {
            droppedMessages++;
            if (droppedMessages % 25 === 1) _originalWarn(`⚠️ ضغط شديد: تم إهمال ${droppedMessages} دفعة رسائل`);
            return;
        }
        await new Promise(resolve => slotWaiters.push(resolve));
    } else {
        activeSlots++;
    }

    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        const next = slotWaiters.shift();
        if (next) next();
        else activeSlots = Math.max(0, activeSlots - 1);
    };
    const timer = setTimeout(() => {
        _originalWarn("⚠️ معالجة رسالة تجاوزت 90 ثانية — تم تحرير المسار لمنع تعليق البوت");
        release();
    }, MESSAGE_SLOT_TIMEOUT_MS);

    try {
        await work();
    } finally {
        clearTimeout(timer);
        release();
    }
}

const pendingGamesMenu = Object.create(null);
global.pendingGamesMenu = pendingGamesMenu;

// ============================================================
// عدّادات عامة
// ============================================================

if (!global.messageCounters) global.messageCounters = {};
if (!global.reactCounters) global.reactCounters = {};

// ============================================================
// إيموجيات التفاعل التلقائي
// ============================================================

const REACT_EMOJIS = [
    "🥀", "🫟", "🔥", "🎀", "🍁", "🥲", "🙂", "⭐", "🐦‍⬛",
    "🍀", "🐱", "🕯", "🎉", "🍿", "🫠", "🍭", "🍒", "🍫",
    "🍯", "🐥", "👻", "🍅"
];

// ============================================================
// شبكة أمان
// ============================================================

let lastExceptionAt = 0;
const EXCEPTION_COOLDOWN_MS = 5000;

process.on('uncaughtException', (error) => {
    const now = Date.now();
    if (now - lastExceptionAt < EXCEPTION_COOLDOWN_MS) return;
    lastExceptionAt = now;
    _originalError('❌ Uncaught Exception:', error?.stack || error?.message || error);
});

process.on('unhandledRejection', (reason) => {
    const now = Date.now();
    if (now - lastExceptionAt < EXCEPTION_COOLDOWN_MS) return;
    lastExceptionAt = now;
    _originalError('❌ Unhandled Rejection:', reason?.stack || reason?.message || reason);
});

// ============================================================
// Helpers
// ============================================================

function getMessageTextFromMsg(msg) {
    if (!msg || !msg.message) return "";
    const message = msg.message;
    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.templateButtonReplyMessage?.selectedId ||
        ""
    ).trim();
}

function getSender(msg, sock) {
    try {
        if (msg?.key?.fromMe) return sock?.user?.id || "";
        return msg?.key?.participant || msg?.key?.remoteJid || "";
    } catch {
        return "";
    }
}

function getBotNumber(sock) {
    try {
        return jidToNumber(sock?.user?.id || "");
    } catch {
        return "";
    }
}

function shouldIgnoreMessage(msg) {
    try {
        if (!msg?.message) return true;
        const jid = msg?.key?.remoteJid;
        if (!jid) return true;
        if (jid === "status@broadcast") return true;
        if (msg?.key?.fromMe) {
            const text = getMessageTextFromMsg(msg);
            return !text || !text.startsWith(".");
        }
        return false;
    } catch {
        return true;
    }
}

// ============================================================
// 🆕 أوامر رقم البوت نفسه + تفريغ أغلفة الرسائل
// ============================================================

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

const botSentIds = new Map();
const ownHandledIds = new Map();

function _pruneMap(map, maxSize, maxAgeMs) {
    if (map.size <= maxSize) return;
    const now = Date.now();
    for (const [k, t] of map) {
        if (now - t > maxAgeMs) map.delete(k);
    }
}

function trackSentMessages(sock) {
    try {
        if (!sock || sock.__sentTracker) return;
        sock.__sentTracker = true;
        const orig = sock.sendMessage.bind(sock);
        sock.sendMessage = async (...args) => {
            const res = await orig(...args);
            try {
                if (res?.key?.id) {
                    botSentIds.set(res.key.id, Date.now());
                    _pruneMap(botSentIds, 1000, 10 * 60 * 1000);
                }
            } catch (_) {}
            return res;
        };
    } catch (_) {}
}

function msgTimestampSec(msg) {
    try {
        const t = msg?.messageTimestamp;
        if (!t) return 0;
        if (typeof t === "object" && typeof t.toNumber === "function") return t.toNumber();
        return Number(t) || 0;
    } catch {
        return 0;
    }
}

function isOwnPhoneCommand(msg) {
    try {
        if (!msg?.key?.fromMe || !msg.key.id) return false;
        if (botSentIds.has(msg.key.id)) return false;
        const ts = msgTimestampSec(msg);
        if (!ts || Math.abs(Date.now() / 1000 - ts) > 30) return false;
        const text = getMessageTextFromMsg(msg);
        return Boolean(text && text.startsWith("."));
    } catch {
        return false;
    }
}

function alreadyHandledOwn(msg) {
    const id = msg?.key?.id;
    if (!id) return false;
    if (ownHandledIds.has(id)) return true;
    ownHandledIds.set(id, Date.now());
    _pruneMap(ownHandledIds, 1000, 10 * 60 * 1000);
    return false;
}

function unwrapMsgInPlace(msg) {
    try {
        let m = msg?.message;
        if (!m) return;
        for (let i = 0; i < 4; i++) {
            const inner =
                m.ephemeralMessage?.message ||
                m.viewOnceMessage?.message ||
                m.viewOnceMessageV2?.message ||
                m.viewOnceMessageV2Extension?.message ||
                m.documentWithCaptionMessage?.message ||
                m.deviceSentMessage?.message;
            if (!inner) break;
            m = inner;
        }
        if (m !== msg.message) msg.message = m;
    } catch (_) {}
}

// ============================================================
// Admin Monitoring
// ============================================================

function setupAdminMonitoring(sock) {
    try {
        const db = getDb();
        if (!db) return;
        stopAdminMonitoring();
        startAdminMonitoring(sock, db, saveDb);
    } catch (e) {
        _originalError("Admin monitoring error:", e?.message);
    }
}

// ============================================================
// التحقق من أنواع القروبات
// ============================================================

function isReceiveGroup(db, jid) {
    return Boolean(db.receiveGroups && db.receiveGroups[jid]);
}

function isMainGroup(db, jid) {
    return Boolean(db.mainGroup && db.mainGroup[jid] === true);
}

async function isUserInMainGroup(sock, db, userNumber) {
    try {
        const mainJids = Object.keys(db.mainGroup || {}).filter(j => db.mainGroup[j] === true);
        if (mainJids.length === 0) return false;

        for (const mainJid of mainJids) {
            try {
                const metadata = await sock.groupMetadata(mainJid);
                const found = metadata.participants.find(p => cleanNumber(p.id) === userNumber);
                if (found) return true;
            } catch (_) {}
        }
        return false;
    } catch {
        return false;
    }
}

// ============================================================
// الحفظ التلقائي
// ============================================================

const DB_FILE = global.DB_FILE || path.join(__dirname, "database.json");

function getDatabaseContent() {
    try {
        if (fs.existsSync(DB_FILE)) return fs.readFileSync(DB_FILE, "utf8");
        return null;
    } catch {
        return null;
    }
}

async function sendDatabaseBackup(sock) {
    if (!autoSaveEnabled || !autoSaveGroupJid || !sock) return;
    try {
        try { if (typeof global.saveDbNow === "function") global.saveDbNow(); } catch (_) {}
        const dbContent = getDatabaseContent();
        if (!dbContent) return;

        const timestamp = new Date().toLocaleString('ar-EG', {
            timeZone: 'Africa/Cairo',
            hour12: false
        });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

        await sock.sendMessage(autoSaveGroupJid, {
            document: Buffer.from(dbContent, "utf8"),
            mimetype: "application/json",
            fileName: `database-${stamp}.json`,
            caption: "📦 *نسخة احتياطية*\n🕐 " + timestamp + "\n✅ تم الحفظ ✅"
        });
    } catch (e) {
        _originalError("Backup error:", e?.message);
    }
}

function startAutoSave(sock, jid) {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveEnabled = true;
    autoSaveGroupJid = jid;

    setTimeout(() => sendDatabaseBackup(sock), 3000);
    autoSaveInterval = setInterval(() => sendDatabaseBackup(sock), 4 * 60 * 60 * 1000);
}

function stopAutoSave() {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveInterval = null;
    autoSaveEnabled = false;
    autoSaveGroupJid = null;
}

// ============================================================
// الردود التلقائية + التفاعل + الحسبة
// ============================================================

async function handleAutoReplies(sock, jid, msg, text, sender, cleanSender, db, saveDb) {
    try {
        if (isSarahaActive && isSarahaActive(jid)) return;

        if (db.hisbaEnabled && db.hisbaEnabled[jid]) {
            if (!global.messageCounters[jid]) global.messageCounters[jid] = {};
            if (!global.messageCounters[jid][cleanSender]) global.messageCounters[jid][cleanSender] = 0;
            global.messageCounters[jid][cleanSender]++;
        }

        if (db.reactEnabled && db.reactEnabled[jid]) {
            if (!global.reactCounters[jid]) global.reactCounters[jid] = 0;
            global.reactCounters[jid]++;

            if (global.reactCounters[jid] >= 13) {
                global.reactCounters[jid] = 0;
                const emoji = REACT_EMOJIS[Math.floor(Math.random() * REACT_EMOJIS.length)];
                try {
                    await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                } catch (_) {}
            }
        }

        const msgContent = msg.message || {};
        if (db.protectCards && db.protectCards[jid] && !isOwner(cleanSender, sock, msg)) {
            if (msgContent.contactMessage || msgContent.contactsArrayMessage) {
                try { await sock.sendMessage(jid, { delete: msg.key }); } catch (_) {}
                try {
                    const senderJid = msg?.key?.participant || msg?.key?.remoteJid;
                    if (senderJid) {
                        await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                    }
                } catch (_) {}
                return;
            }
        }

        if (db.repliesEnabled && db.repliesEnabled[jid]) {
            const badWords = ["كول خرا", "كول خراا", "يلعون", "يلعن امك", "يلعن ابوك"];
            const isBadWord = badWords.some(w => text.includes(w));

            if (isBadWord) {
                let isAdminUser = false;
                try {
                    const metadata = await sock.groupMetadata(jid);
                    const p = metadata.participants.find(p => p.id === sender);
                    if (p && (p.admin === "admin" || p.admin === "superadmin")) {
                        isAdminUser = true;
                    }
                } catch {}

                await sock.sendMessage(jid, {
                    text: isAdminUser
                        ? `═════════════════════\nلولا رتبتك لكنت اعطيتك درسا عن الردود\n═════════════════════`
                        : `═════════════════\nالخرا لسانه خرا مع الكل\n═════════════════`
                });
                return;
            }
        }

        if (db.ahaEnabled && db.ahaEnabled[jid]) {
            if (/احا{1,}/.test(text)) {
                db.ahaCooldown = db.ahaCooldown || {};
                const now = Date.now();
                if (now - (db.ahaCooldown[jid] || 0) > 5 * 60 * 1000) {
                    db.ahaCooldown[jid] = now;
                    saveDb();
                    await sock.sendMessage(jid, {
                        text: `═════ احا وأخواتها ═════\nاحا. احيه. احوه. احات. احاوات.اح\n══════════════════`
                    });
                }
                return;
            }
        }

        if (db.quietEnabled && db.quietEnabled[jid]) {
            db.quietTimer = db.quietTimer || {};
            if (db.quietTimer[jid]) {
                db.quietTimer[jid].lastMessageTime = Date.now();
                db.quietTimer[jid].sent = false;
                saveDb();
            }
        }
    } catch (e) {
        _originalError("AutoReplies error:", e?.message);
    }
}

// ============================================================
// دوال تحليل الفعاليات
// ============================================================

function getGamesDetailed() {
    const now = Date.now();
    const details = { total: 0, stuck: 0, healthy: 0, list: [] };

    const checkGame = (jid, game, name, ownTimeout) => {
        details.total++;
        const lastActivity = game?.lastActivity || game?.startTime || 0;
        const idle = now - lastActivity;
        const isStuck = idle > ownTimeout + 60 * 1000;

        if (isStuck) {
            details.stuck++;
            details.list.push({ jid, name, idle, status: "STUCK" });
        } else {
            details.healthy++;
            details.list.push({ jid, name, idle, status: "HEALTHY" });
        }
    };

    try {
        for (const jid of Object.keys(activeGames || {})) {
            checkGame(jid, activeGames[jid], "لعبة", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeCasinos || {})) {
            checkGame(jid, activeCasinos[jid], "روليت", 25 * 60 * 1000);
        }
        for (const jid of Object.keys(activeSaraha || {})) {
            checkGame(jid, activeSaraha[jid], "صراحة", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeColors || {})) {
            checkGame(jid, activeColors[jid], "ألوان", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeAnimals || {})) {
            checkGame(jid, activeAnimals[jid], "حيوانات", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeMazads || {})) {
            checkGame(jid, activeMazads[jid], "مزاد", 35 * 60 * 1000);
        }
        if (tahminModule && tahminModule.activeTahmin) {
            for (const jid of Object.keys(tahminModule.activeTahmin)) {
                checkGame(jid, tahminModule.activeTahmin[jid], "تخمين", 5 * 60 * 1000);
            }
        }
    } catch {}

    return details;
}

function getStuckGamesInGroup() {
    const now = Date.now();
    const stuck = [];

    const check = (jid, game, name, ownTimeout) => {
        const last = game?.lastActivity || game?.startTime || 0;
        if ((now - last) > ownTimeout + 60 * 1000) {
            stuck.push({ jid, name, game });
        }
    };

    try {
        for (const jid of Object.keys(activeGames || {})) {
            check(jid, activeGames[jid], "لعبة", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeColors || {})) {
            check(jid, activeColors[jid], "ألوان", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeAnimals || {})) {
            check(jid, activeAnimals[jid], "حيوانات", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeSaraha || {})) {
            check(jid, activeSaraha[jid], "صراحة", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeCasinos || {})) {
            check(jid, activeCasinos[jid], "روليت", 25 * 60 * 1000);
        }
        for (const jid of Object.keys(activeMazads || {})) {
            check(jid, activeMazads[jid], "مزاد", 35 * 60 * 1000);
        }
        if (tahminModule && tahminModule.activeTahmin) {
            for (const jid of Object.keys(tahminModule.activeTahmin)) {
                check(jid, tahminModule.activeTahmin[jid], "تخمين", 5 * 60 * 1000);
            }
        }
    } catch {}

    return stuck;
}

function stopSingleGame(entry) {
    try {
        const { jid, name, game } = entry;
        if (name === "مزاد") {
            try { game?.stopMazad?.(); } catch {}
            delete activeMazads[jid];
        } else if (name === "روليت") {
            try { game?.stopGame?.(); } catch {}
            delete activeCasinos[jid];
        } else if (name === "تخمين") {
            if (tahminModule && tahminModule.stopTahminGame) {
                try { tahminModule.stopTahminGame(jid); } catch {}
            }
        } else {
            try { game?.stopGame?.(); } catch {}
            delete activeGames[jid];
            delete activeColors[jid];
            delete activeAnimals[jid];
            delete activeSaraha[jid];
        }
        return true;
    } catch { return false; }
}

// ============================================================
// نظام الاستراحة
// ============================================================

const restRequests = Object.create(null);

async function requestRestInGroup(sock, jid, reason = "ضغط هائل") {
    if (restRequests[jid]) return false;

    try {
        await sock.sendMessage(jid, {
            text: `◆━─━─━─⊱☢️⊰─━─━─━◆
ملاحظة هناك ${reason} على
 البوت يرجى ارسال امر: 
*.استراحة*
للحفاظ على عدم تعليق البوت
◆━─━─━─⊱🛑⊰─━─━─━◆`
        });

        const timeoutId = setTimeout(async () => {
            const stuck = getStuckGamesInGroup().filter(g => g.jid === jid);
            for (const entry of stuck) stopSingleGame(entry);

            if (stuck.length > 0) {
                await sock.sendMessage(jid, {
                    text: `⏰ انتهت المهلة دون استجابة.\n🛑 تم إيقاف ${stuck.length} فعالية عالقة تلقائياً.`
                }).catch(() => {});
            }

            delete restRequests[jid];
        }, 60 * 1000);

        restRequests[jid] = { timeout: timeoutId, sentAt: Date.now() };
        return true;
    } catch (e) {
        _originalError("requestRestInGroup error:", e?.message);
        return false;
    }
}

async function handleRestCommand(sock, jid, msg, db) {
    if (restRequests[jid]) {
        clearTimeout(restRequests[jid].timeout);
        delete restRequests[jid];
    }

    const stuck = getStuckGamesInGroup().filter(g => g.jid === jid);
    let stoppedCount = 0;

    if (stuck.length === 0) {
        try {
            if (activeGames[jid]) { activeGames[jid]?.stopGame?.(); delete activeGames[jid]; stoppedCount++; }
            if (activeColors[jid]) { activeColors[jid]?.stopGame?.(); delete activeColors[jid]; stoppedCount++; }
            if (activeAnimals[jid]) { activeAnimals[jid]?.stopGame?.(); delete activeAnimals[jid]; stoppedCount++; }
            if (activeSaraha[jid]) { activeSaraha[jid]?.stopGame?.(); delete activeSaraha[jid]; stoppedCount++; }
            if (activeCasinos[jid]) { activeCasinos[jid]?.stopGame?.(); delete activeCasinos[jid]; stoppedCount++; }
            if (activeMazads[jid]) { activeMazads[jid]?.stopMazad?.(); delete activeMazads[jid]; stoppedCount++; }
            if (tahminModule && tahminModule.stopTahminGame) {
                if (tahminModule.activeTahmin && tahminModule.activeTahmin[jid]) {
                    tahminModule.stopTahminGame(jid);
                    stoppedCount++;
                }
            }
        } catch {}
    } else {
        for (const entry of stuck) {
            if (stopSingleGame(entry)) stoppedCount++;
        }
    }

    try {
        await sock.sendMessage(jid, {
            text: `◆━─━─━─⊱✅⊰─━─━─━◆
تم الاستجابة لطلب الاستراحة
🛑 عدد الفعاليات المتوقفة: \`${stoppedCount}\`
شكراً لتعاونكم ❤️
◆━─━─━─⊱🛑⊰─━─━─━◆`
        }, { quoted: msg });
    } catch {}

    lastMessageAt = Date.now();
    return true;
}

// ============================================================
// Watchdog
// ============================================================

function startWatchdog(sock) {
    lastSocketRef = sock;
    lastMessageAt = Date.now();
    lastGroupUpdateAt = Date.now();
    consecutiveIdleChecks = 0;
    deadSocketChecks = 0;

    if (watchdogInterval) clearInterval(watchdogInterval);

    watchdogInterval = setInterval(async () => {
        try {
            const now = Date.now();
            const idleMs = now - lastMessageAt;

            try {
                const ws = lastSocketRef && lastSocketRef.ws;
                const isOpen = ws ? (typeof ws.isOpen === "boolean" ? ws.isOpen : ws.readyState === 1) : true;
                if (!isOpen) {
                    deadSocketChecks++;
                    if (deadSocketChecks >= 2) {
                        _originalWarn("🔄 Watchdog: الاتصال مغلق، إعادة تشغيله...");
                        deadSocketChecks = 0;
                        try { ws.close(); } catch {}
                    }
                } else {
                    deadSocketChecks = 0;
                }
            } catch {}

            const games = getGamesDetailed();

            if (games.stuck > 0 && idleMs > GAME_STUCK_THRESHOLD_MS) {
                const stuckList = getStuckGamesInGroup();
                const affectedGroups = [...new Set(stuckList.map(g => g.jid))];

                for (const grpJid of affectedGroups) {
                    if (!restRequests[grpJid]) {
                        await requestRestInGroup(sock, grpJid, "ضغط هائل");
                    }
                }

                consecutiveIdleChecks = 0;
                return;
            }

            if (games.healthy > 0) {
                if (games.total > MAX_GAME_COUNT) {
                    _originalWarn(`⚠️ Watchdog: عدد فعاليات مرتفع (${games.total})`);
                }
                return;
            }

            if (idleMs > IDLE_THRESHOLD_MS) {
                consecutiveIdleChecks++;
                _originalWarn(`⚠️ Watchdog: خمول ${Math.round(idleMs/60000)}د (${consecutiveIdleChecks}/${MAX_IDLE_CHECKS})`);

                if (consecutiveIdleChecks >= MAX_IDLE_CHECKS) {
                    _originalWarn("🔄 Watchdog: إعادة تشغيل الاتصال قسرياً...");
                    consecutiveIdleChecks = 0;
                    try {
                        if (lastSocketRef && lastSocketRef.ws) lastSocketRef.ws.close();
                    } catch {}
                }
            } else {
                consecutiveIdleChecks = 0;
            }

        } catch (e) {
            _originalError("Watchdog error:", e?.message);
        }
    }, WATCHDOG_CHECK_MS);
}

function stopWatchdog() {
    if (watchdogInterval) clearInterval(watchdogInterval);
    watchdogInterval = null;
}

// ============================================================
// معالجة انضمام العضو للقروب الأساسي
// ============================================================

function findUserEntry(db, number) {
    const f = jf.pickByAlias(db.users, number);
    return f ? { key: f.key, user: f.value } : null;
}

function scheduleWelcomeExtras(sock, groupJid, pJid, userNumber, db, saveDb) {
    try {
        const first = findUserEntry(db, userNumber);
        if (!first || !String(first.user.nickname || "").trim()) return;

        setTimeout(async () => {
            try {
                const entry = findUserEntry(db, userNumber);
                if (!entry || !String(entry.user.nickname || "").trim()) return;

                db.welcomeGift = db.welcomeGift || {};
                const already = jf.aliasesOf(userNumber).some(a => db.welcomeGift[a]);
                if (already) return;

                for (const a of jf.aliasesOf(userNumber)) db.welcomeGift[a] = Date.now();
                entry.user.balance = (Number(entry.user.balance) || 0) + 100;
                saveDb();

                const mentionJid = await jf.resolveJid(sock, groupJid, userNumber);
                await sock.sendMessage(groupJid, {
                    text: `♢┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈♢
👤 العضو: @${jf.jnum(mentionJid) || userNumber}
لقد حصلت على 100 رصيد كهدية
ترحيب خاصة بك يمكنك ان تكتب:
.تفاصيلي
لرؤية ملفك التعريفي ورصيدك...
♢┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈♢`,
                    mentions: [mentionJid]
                });
            } catch (e) {
                _originalError("welcome gift error:", e?.message);
            }
        }, 60 * 1000);

        setTimeout(async () => {
            try {
                const entry = findUserEntry(db, userNumber);
                if (!entry) return;
                const mentionJid = await jf.resolveJid(sock, groupJid, userNumber);
                await sock.sendMessage(groupJid, {
                    text: `👤 العضو: @${jf.jnum(mentionJid) || userNumber}\n` + buildMyDetailsText(entry.user),
                    mentions: [mentionJid]
                });
            } catch (e) {
                _originalError("welcome details error:", e?.message);
            }
        }, 5 * 60 * 1000);
    } catch (e) {
        _originalError("scheduleWelcomeExtras error:", e?.message);
    }
}

async function handleMainGroupJoin(sock, groupJid, participant, db, saveDb) {
    try {
        if (!isMainGroup(db, groupJid)) return;

        const pJid = jf.jidOf(participant);
        const userNumber = jf.jnum(pJid);
        if (!userNumber) return;
        jf.rememberJid(userNumber, pJid);
        jf.invalidateGroup(groupJid);

        scheduleWelcomeExtras(sock, groupJid, pJid, userNumber, db, saveDb);

        if (!db.userPhotos) return;
        const photoEntry = jf.pickByAlias(db.userPhotos, userNumber)?.value;
        if (!photoEntry) return;

        if (welcomeModule && typeof welcomeModule.sendWelcome === "function") {
            try {
                await welcomeModule.sendWelcome(sock, groupJid, userNumber, photoEntry, db);
            } catch (e) {
                _originalError("sendWelcome error:", e?.message);
            }
        }

        if (db.receiveGroups) {
            for (const recJid of Object.keys(db.receiveGroups)) {
                if (!db.receiveGroups[recJid]) continue;
                try {
                    jf.invalidateGroup(recJid);
                    const parts = await jf.getGroupParticipants(sock, recJid);
                    if (!parts) continue;

                    const found = jf.findInParticipants(parts, userNumber);
                    if (found) {
                        const memberJid = jf.jidOf(found);
                        await sock.sendMessage(recJid, {
                            text: `❆━━━━━═⏣⊰👤⊱⏣═━━━━━❆
عزيزي/تي @${jf.jnum(memberJid)}
شكرا لك لقد إنتهى عملك هنا وقد تم
دخولك القروب الاساسي..  بينما هذا 
القروب انتهى عملك فيه هنا..  وداعا❤
❆━━━━━═⏣⊰🪪⊱⏣═━━━━━❆`,
                            mentions: [memberJid]
                        }).catch(() => {});

                        try {
                            await sock.groupParticipantsUpdate(recJid, [memberJid], "remove");
                        } catch (_) {}
                    }
                } catch (_) {}
            }
        }

    } catch (e) {
        _originalError("handleMainGroupJoin error:", e?.message);
    }
}

// ============================================================
// Handlers
// ============================================================

function createHandlers() {
    const handlers = {
        onConnectionOpen: async (sock) => {
            trackSentMessages(sock);
            setupAdminMonitoring(sock);

            const db = getDb();
            if (db && db.autoSaveEnabled && db.autoSaveGroupJid) {
                startAutoSave(sock, db.autoSaveGroupJid);
            }

            startWatchdog(sock);
            _originalLog("✅ البوت جاهز.");
        },

        onConnectionClose: async () => {
            stopAdminMonitoring();
            stopWatchdog();
        },

        onMessage: async (sock, event, context) => {
            try {
                lastMessageAt = Date.now();

                const { messages, type } = event || {};
                if (type !== "notify" && type !== "append") return;
                if (!Array.isArray(messages) || !messages.length) return;

                const db = context.db || getDb();

                for (const msg of messages) {
                    try {
                        unwrapMsgInPlace(msg);

                        if (msg?.key?.fromMe) {
                            if (type === "append") {
                                await _sleep(1200);
                                if (!isOwnPhoneCommand(msg)) continue;
                            }
                            if (alreadyHandledOwn(msg)) continue;
                        } else if (type !== "notify") {
                            continue;
                        }

                        if (shouldIgnoreMessage(msg)) continue;

                        const jid = msg?.key?.remoteJid;
                        if (!jid) continue;

                        if (msg?.key?.fromMe) {
                            _originalLog("📲 أمر من رقم البوت:", String(getMessageTextFromMsg(msg)).slice(0, 40));
                        }

                        const sender = getSender(msg, sock);
                        const isGroup = isGroupJid(jid);

                        if (isGroup) {
                            try { await jf.getGroupParticipants(sock, jid); } catch (_) {}
                        }

                        const cleanSender = jf.canonical(db, jidToNumber(sender));
                        const botNumber = getBotNumber(sock);
                        const owner = isOwner(cleanSender, sock, msg);

                        const rawText = getMessageTextFromMsg(msg);
                        if (!owner && rawText.startsWith(".") && isFlooding(cleanSender)) continue;
                        if (isGroup && rawText) {
                            try {
                                if (db.adsGroups && db.adsGroups[jid] && resultsModule && typeof resultsModule.processAdsText === "function") {
                                    resultsModule.processAdsText(db, saveDb, jid, rawText, msg.key?.id);
                                }
                                if (!rawText.startsWith(".")) {
                                    if (await banModule.processViolation(sock, msg, db, saveDb)) continue;
                                    if (await guildsModule.processWorkForm(sock, jid, msg, rawText, db, saveDb)) continue;
                                }
                            } catch (e) {
                                _originalError("silent monitors error:", e?.message);
                            }
                        }

                        if (!owner && banModule.isBanned(db, cleanSender)) {
                            let looksLikeCommand = rawText.startsWith(".") || Boolean(msg.message?.listResponseMessage);
                            if (!looksLikeCommand && typoModule && typeof typoModule.getCorrectedCommand === "function") {
                                looksLikeCommand = Boolean(typoModule.getCorrectedCommand(rawText));
                            }
                            if (looksLikeCommand) await banModule.sendBannedNotice(sock, jid, msg, db, cleanSender);
                            continue;
                        }

                        const listResponse = msg.message?.listResponseMessage;
                        if (listResponse) {
                            const selectedRowId = String(listResponse.singleSelectReply?.selectedRowId || "");

                            let matchedCmd = null;
                            if (selectedRowId.startsWith("game_")) {
                                matchedCmd = selectedRowId.replace("game_", "");
                            }
                            const gameKeywords = [
                                { keyword: "تفكيك", cmd: "تفكيك" },
                                { keyword: "كتابة", cmd: "كتابة" },
                                { keyword: "ألوان", cmd: "الوان" },
                                { keyword: "الوان", cmd: "الوان" },
                                { keyword: "صراحة", cmd: "صراحة" },
                                { keyword: "الحيوانات", cmd: "الحيوانات" },
                                { keyword: "حيوانات", cmd: "الحيوانات" },
                                { keyword: "أعلام", cmd: "اعلام" },
                                { keyword: "اعلام", cmd: "اعلام" },
                                { keyword: "إيموجي", cmd: "ايموجي" },
                                { keyword: "ايموجي", cmd: "ايموجي" },
                                { keyword: "روليت", cmd: "روليت" },
                                { keyword: "كريستال", cmd: "كريستال" },
                                { keyword: "تخمين", cmd: "تخمين" }
                            ];

                            for (const item of gameKeywords) {
                                if (matchedCmd) break;
                                if (selectedRowId.includes(item.keyword)) {
                                    matchedCmd = item.cmd;
                                    break;
                                }
                            }

                            if (!matchedCmd && selectedRowId.startsWith("game_")) {
                                matchedCmd = selectedRowId.replace("game_", "");
                            }

                            if (matchedCmd) {
                                const pending = global.pendingGamesMenu && global.pendingGamesMenu[jid];

                                if (!pending || pending.sender !== cleanSender) {
                                    await sock.sendMessage(jid, {
                                        text: "⚠️ هذه القائمة خاصة بصاحب الأمر `.العاب` فقط."
                                    }, { quoted: msg }).catch(() => {});
                                    continue;
                                }

                                if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
                                    delete global.pendingGamesMenu[jid];
                                    await sock.sendMessage(jid, {
                                        text: "⚠️ انتهت صلاحية القائمة، أعد كتابة `.العاب`."
                                    }, { quoted: msg }).catch(() => {});
                                    continue;
                                }

                                delete global.pendingGamesMenu[jid];
                                const cmd = matchedCmd;

                                try {
                                    await sock.sendMessage(jid, { delete: msg.key });
                                } catch (_) {}

                                if (cmd === "كريستال") {
                                    await sock.sendMessage(jid, {
                                        text: "*❉▬▬▬▬🎰▬▬▬▬❉*\n رجاءا اكتب امر: \n*كريستال 00*\nضع عدد الرهان بدلا من 00\nمثال:  `.كريستال 50`\n*✥▬▬▬▬🎰▬▬▬▬✥*"
                                    }, { quoted: msg }).catch(() => {});
                                    continue;
                                }

                                const fakeText = "." + cmd;
                                try {
                                    const fakeMsg = {
                                        ...msg,
                                        message: { conversation: fakeText }
                                    };
                                    await handleCommand(sock, jid, fakeMsg, {
                                        db,
                                        sender,
                                        cleanSender,
                                        isGroup,
                                        isBotOwner: Boolean(owner),
                                        botNumber,
                                        text: fakeText
                                    });
                                } catch (e) {
                                    _originalError("List response exec error:", e?.message);
                                }
                                continue;
                            }
                        }

                        if (flowRegModule && msg.message && (msg.message.interactiveResponseMessage || msg.message.buttonsResponseMessage || msg.message.templateButtonReplyMessage)) {
                            try {
                                if (await flowRegModule.handleInteractive(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                            } catch (e) {
                                _originalError("flowreg interactive error:", e?.message);
                            }
                        }

                        const text = getMessageTextFromMsg(msg);
                        if (!text) continue;

                        if (aiModule && typeof aiModule.handleMessageHook === "function") {
                            try {
                                if (await aiModule.handleMessageHook(sock, jid, msg, text, db, saveDb, cleanSender, owner)) continue;
                            } catch (e) {
                                _originalError("Ai hook error:", e?.message);
                            }
                        }

                        if (flowRegModule) {
                            try {
                                if (await flowRegModule.handleMessageHook(sock, jid, msg, text, db, saveDb, cleanSender, owner)) continue;
                            } catch (e) {
                                _originalError("flowreg hook error:", e?.message);
                            }
                        }

                        if (isGroup && registerModule && typeof registerModule.handleMessageHook === "function") {
                            try {
                                if (await registerModule.handleMessageHook(sock, jid, msg, text, db, saveDb, cleanSender, owner)) continue;
                            } catch (e) {
                                _originalError("register hook error:", e?.message);
                            }
                        }

                        if (!text.startsWith(".")) {
                            if (typoModule && typeof typoModule.handleTypo === "function") {
                                if (isGroup && !(db.typoEnabled && db.typoEnabled[jid] === false)) {
                                    try {
                                        const handled = await typoModule.handleTypo(sock, jid, msg, text, db, cleanSender, owner);
                                        if (handled) continue;
                                    } catch (_) {}
                                }
                            }

                            await handleAutoReplies(sock, jid, msg, text, sender, cleanSender, db, saveDb);
                            continue;
                        }

                        // ============================================
                        // 🆕 نظام التسجيل التفاعلي الجديد (.جديد / .تصفير)
                        // ============================================
                        if (flowCommands) {
                            try {
                                if (await flowCommands.handleFlowCommand(sock, jid, msg, text, db, saveDb, cleanSender, owner)) continue;
                            } catch (e) {
                                _originalError("flow-commands error:", e?.message);
                            }
                        }

                        if (aiModule) {
                            try {
                                if (typeof aiModule.isAiCommand === "function" && aiModule.isAiCommand(text)) {
                                    aiModule.handleAiCommand(sock, jid, msg, text, db, saveDb, cleanSender, owner)
                                        .catch(e => _originalError("Ai command error:", e?.message));
                                    continue;
                                }
                                if (typeof aiModule.handleEditCommand === "function") {
                                    if (await aiModule.handleEditCommand(sock, jid, msg, text, db, saveDb, cleanSender, owner)) continue;
                                }
                            } catch (e) {
                                _originalError("Ai dispatch error:", e?.message);
                            }
                        }

                        if (flowRegModule) {
                            try {
                                if (await flowRegModule.handleCommand(sock, jid, msg, text, db, saveDb, cleanSender, owner)) continue;
                            } catch (e) {
                                _originalError("flowreg command error:", e?.message);
                            }
                        }

                        if (registerModule && typeof registerModule.handleCommand === "function") {
                            try {
                                if (await registerModule.handleCommand(sock, jid, msg, text, db, saveDb, cleanSender, owner)) continue;
                            } catch (e) {
                                _originalError("register command error:", e?.message);
                            }
                        }

                        if (text === ".المؤبدين" || text.startsWith(".المؤبدين ")) {
                            try {
                                await guildsModule.handleLifeBanList(sock, jid, msg, db, saveDb, cleanSender, owner);
                            } catch (e) {
                                _originalError("LifeBanList error:", e?.message);
                            }
                            continue;
                        }

                        if (text === ".صورة" || text.startsWith(".صورة ")) {
                            if (photosModule && typeof photosModule.handlePhotoCommand === "function") {
                                try {
                                    const handled = await photosModule.handlePhotoCommand(sock, jid, msg, text, db, saveDb, cleanSender, owner);
                                    if (handled) continue;
                                } catch (e) {
                                    _originalError("photos handlePhotoCommand error:", e?.message);
                                }
                            }
                        }

                        if (text === ".اساسي on" || text === ".اساسي off") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            db.mainGroup = db.mainGroup || {};
                            db.organizedGroups = db.organizedGroups || {};
                            if (text === ".اساسي on") {
                                db.mainGroup[jid] = true;
                                db.organizedGroups[jid] = true;
                                saveDb();
                                await sock.sendMessage(jid, {
                                    text: "✅ تم تعيين هذا القروب كقروب أساسي.\n📌 تم تفعيل التنظيم تلقائياً: سيتم حذف لقب أي عضو يغادر هذا القروب (مع الاحتفاظ برصيده)."
                                }, { quoted: msg });
                            } else {
                                delete db.mainGroup[jid];
                                delete db.organizedGroups[jid];
                                saveDb();
                                await sock.sendMessage(jid, { text: "❌ تم إلغاء تعيين هذا القروب كقروب أساسي (وإيقاف التنظيم)." }, { quoted: msg });
                            }
                            continue;
                        }

                        if (text.startsWith(".رابط ")) {
                            const parts = text.split(/\s+/);
                            const kind = parts[1] || "";
                            const isAdsLink = kind === "الاعلانات" || kind === "الإعلانات";
                            const isShopLink = kind === "المتجر";
                            if (isAdsLink || isShopLink) {
                                if (!owner) {
                                    await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                    continue;
                                }
                                const url = parts.slice(2).join(" ").trim();
                                if (!url) {
                                    await sock.sendMessage(jid, { text: `⚠️ يرجى كتابة الرابط بعد الأمر.\nمثال: .رابط ${kind} https://chat.whatsapp.com/xxxx` }, { quoted: msg });
                                    continue;
                                }
                                db.welcomeLinks = db.welcomeLinks || { link1: "", link2: "" };
                                if (isAdsLink) db.welcomeLinks.link1 = url;
                                else db.welcomeLinks.link2 = url;
                                saveDb();
                                await sock.sendMessage(jid, { text: `✅ تم حفظ رابط ${isAdsLink ? "الإعلانات" : "المتجر"}.` }, { quoted: msg });
                                continue;
                            }
                        }

                        if (text === ".حماية on" || text === ".حماية off") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            db.protectCards = db.protectCards || {};
                            if (text === ".حماية on") {
                                db.protectCards[jid] = true;
                                saveDb();
                                await sock.sendMessage(jid, { text: "✅ تم تفعيل حماية البطاقات." }, { quoted: msg });
                            } else {
                                delete db.protectCards[jid];
                                saveDb();
                                await sock.sendMessage(jid, { text: "❌ تم إيقاف حماية البطاقات." }, { quoted: msg });
                            }
                            continue;
                        }

                        if (text === ".تنظيف") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            try {
                                const history = await sock.fetchMessageHistory(40, msg.key, Math.floor(Date.now() / 1000) - 3600);
                                let deleted = 0;
                                for (const m of history) {
                                    try {
                                        if (m.key && !m.key.fromMe) continue;
                                        await sock.sendMessage(jid, { delete: m.key });
                                        deleted++;
                                    } catch (_) {}
                                }
                                await sock.sendMessage(jid, { text: `🧹 تم مسح ${deleted} رسالة.` }, { quoted: msg });
                            } catch (_) {
                                await sock.sendMessage(jid, { text: "⚠️ فشل تنظيف الرسائل." }, { quoted: msg });
                            }
                            continue;
                        }

                        if (text === ".تفاعل on" || text === ".تفاعل off") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            db.reactEnabled = db.reactEnabled || {};
                            if (text === ".تفاعل on") {
                                db.reactEnabled[jid] = true;
                                saveDb();
                                await sock.sendMessage(jid, { text: "✅ تم تفعيل التفاعل التلقائي." }, { quoted: msg });
                            } else {
                                delete db.reactEnabled[jid];
                                saveDb();
                                await sock.sendMessage(jid, { text: "❌ تم إيقاف التفاعل التلقائي." }, { quoted: msg });
                            }
                            continue;
                        }

                        if (text === ".حسبة on" || text === ".حسبة off") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            db.hisbaEnabled = db.hisbaEnabled || {};
                            if (text === ".حسبة on") {
                                db.hisbaEnabled[jid] = true;
                                saveDb();
                                await sock.sendMessage(jid, { text: "✅ تم تفعيل عدّاد التفاعل." }, { quoted: msg });
                            } else {
                                delete db.hisbaEnabled[jid];
                                saveDb();
                                await sock.sendMessage(jid, { text: "❌ تم إيقاف عدّاد التفاعل." }, { quoted: msg });
                            }
                            continue;
                        }

                        if (text === ".حسبة") {
                            const isPermission1 = owner || jf.aliasesOf(cleanSender).some(a => db.permissions && db.permissions["1"] && db.permissions["1"].includes(a));
                            if (!isPermission1) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر يحتاج صلاحية .سماح 1." }, { quoted: msg });
                                continue;
                            }

                            let totalUpdated = 0;
                            for (const grpJid of Object.keys(global.messageCounters || {})) {
                                const counters = global.messageCounters[grpJid];
                                for (const userNum of Object.keys(counters)) {
                                    const count = counters[userNum];
                                    db.users = db.users || {};
                                    if (!db.users[userNum]) {
                                        db.users[userNum] = { balance: 0, nickname: "", rank: "", maxInteraction: 0, friend: "" };
                                    }
                                    if (count > (db.users[userNum].maxInteraction || 0)) {
                                        db.users[userNum].maxInteraction = count;
                                        totalUpdated++;
                                    }
                                }
                            }
                            saveDb();
                            await sock.sendMessage(jid, {
                                text: `◆━─━─━─⊱✅⊰─━─━─━◆
  تم تعديل واضافة تفاعل الجميع
◆━─━─━─⊱✅⊰─━─━─━◆`
                            }, { quoted: msg });
                            continue;
                        }

                        if (text.startsWith(".امبراطور ")) {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                            if (mentioned.length === 0) {
                                await sock.sendMessage(jid, { text: "⚠️ يرجى منشن الشخص." }, { quoted: msg });
                                continue;
                            }
                            const target = cleanNumber(mentioned[0]);
                            db.emperors = db.emperors || {};
                            db.emperors[target] = true;
                            saveDb();
                            await sock.sendMessage(jid, {
                                text: `👑 تم تعيين @${target} كامبراطور.`,
                                mentions: mentioned
                            }, { quoted: msg });
                            continue;
                        }

                        if (text === ".نتائج" || text.startsWith(".نتائج ")) {
                            if (resultsModule && typeof resultsModule.handleResults === "function") {
                                try {
                                    const handled = await resultsModule.handleResults(sock, jid, msg, text, db, saveDb, cleanSender, owner);
                                    if (handled) continue;
                                } catch (e) {
                                    _originalError("results handleResults error:", e?.message);
                                }
                            }
                        }

                        if (text === ".اوامر") {
                            if (commandsListModule && typeof commandsListModule.handleCommandsList === "function") {
                                try {
                                    const handled = await commandsListModule.handleCommandsList(sock, jid, msg, db, cleanSender, owner);
                                    if (handled) continue;
                                } catch (e) {
                                    _originalError("commandsList error:", e?.message);
                                }
                            }
                        }

                        if (text === ".عادي on" || text === ".عادي off") {
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            db.typoEnabled = db.typoEnabled || {};
                            if (text === ".عادي on") {
                                db.typoEnabled[jid] = true;
                                saveDb();
                                await sock.sendMessage(jid, { text: "✅ تم تفعيل تصحيح الأخطاء." }, { quoted: msg });
                            } else {
                                db.typoEnabled[jid] = false;
                                saveDb();
                                await sock.sendMessage(jid, { text: "❌ تم إيقاف تصحيح الأخطاء." }, { quoted: msg });
                            }
                            continue;
                        }

                        if (text === ".استراحة") {
                            await handleRestCommand(sock, jid, msg, db);
                            continue;
                        }

                        if (text === ".حفظ" || text.startsWith(".حفظ ")) {
                            const parts = text.split(/\s+/);
                            const action = parts.length > 1 ? parts[1].toLowerCase() : "";

                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }

                            if (action === "on") {
                                db.autoSaveEnabled = true;
                                db.autoSaveGroupJid = jid;
                                saveDb();
                                startAutoSave(sock, jid);
                                await sock.sendMessage(jid, {
                                    text: "✅ *تم تفعيل الحفظ التلقائي*\n🕐 كل 4 ساعات"
                                }, { quoted: msg });
                            } else if (action === "off") {
                                db.autoSaveEnabled = false;
                                db.autoSaveGroupJid = null;
                                saveDb();
                                stopAutoSave();
                                await sock.sendMessage(jid, { text: "❌ تم إيقاف الحفظ التلقائي" }, { quoted: msg });
                            } else {
                                const status = db.autoSaveEnabled ? "🟢 مفعّل" : "🔴 غير مفعّل";
                                await sock.sendMessage(jid, {
                                    text: "📊 الحالة: " + status + "\n.حفظ on / off"
                                }, { quoted: msg });
                            }
                            continue;
                        }

                        if (text === ".548484") {
                            try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}
                            if (!owner) {
                                await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
                                continue;
                            }
                            db.mazadCreator = cleanSender;
                            saveDb();
                            await sock.sendMessage(jid, { text: "✅ تم تفعيل وضع منشئ المزاد." }, { quoted: msg });
                            continue;
                        }

                        if (text === ".مزاد") {
                            if (await handleMazadCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                        }

                        if (text.startsWith(".ادفع")) {
                            const parts = text.split(/\s+/);
                            const amount = parseInt(parts[1]);
                            if (!isNaN(amount) && amount > 0) {
                                if (await handleMazadBid(sock, jid, msg, db, saveDb, cleanSender, amount)) continue;
                            }
                        }

                        if (text === ".مخزوني") {
                            if (await handleMazadInventory(sock, jid, msg, db, cleanSender)) continue;
                        }

                        if (text.startsWith(".ارسال")) {
                            if (await handleMazadSend(sock, jid, msg, text, db, saveDb, cleanSender)) continue;
                        }

                        if (text === ".الغاء") {
                            if (await handleMazadCancelSend(sock, jid, msg, db, saveDb, cleanSender)) continue;
                        }

                        if (text === ".صراحة") {
                            if (await handleSarahaCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                        }

                        if (text === ".الوان") {
                            if (await handleColorsCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                        }

                        if (text === ".الحيوانات") {
                            if (await handleAnimalsCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                        }

                        if (text === ".تخمين") {
                            if (tahminModule && typeof tahminModule.handleTahminCommand === "function") {
                                try {
                                    const handled = await tahminModule.handleTahminCommand(sock, jid, msg, db, saveDb, cleanSender, owner);
                                    if (handled) continue;
                                } catch (e) {
                                    _originalError("tahmin error:", e?.message);
                                }
                            }
                        }

                        await handleCommand(sock, jid, msg, {
                            db,
                            sender,
                            cleanSender,
                            isGroup,
                            isBotOwner: Boolean(owner),
                            botNumber,
                            text
                        });

                    } catch (e) {
                        _originalError("Message error:", e?.message);
                    }
                }
            } catch (e) {
                _originalError("onMessage error:", e?.message);
            }
        },

        onGroupUpdate: async (sock, update, context) => {
            try {
                lastGroupUpdateAt = Date.now();
                const db = context.db || getDb();

                await handleGroupJoin(sock, update, db, saveDb);

                if (update && update.action === "add" && Array.isArray(update.participants)) {
                    for (const participant of update.participants) {
                        await handleMainGroupJoin(sock, update.id, participant, db, saveDb);
                    }
                }
            } catch (e) {
                _originalError("GroupUpdate error:", e?.message);
            }
        }
    };

    const rawOnMessage = handlers.onMessage;
    handlers.onMessage = (sock, event, context) => runWithSlot(() => rawOnMessage(sock, event, context));
    return handlers;
}

// ============================================================
// Start
// ============================================================

async function main() {
    try {
        _originalLog("╔════════════════════════════════════╗");
        _originalLog("║        🤖 ALJESAT BOT START       ║");
        _originalLog("╚════════════════════════════════════╝");

        // 🆕 تشغيل سيرفر التسجيل التفاعلي (قبل البوت حتى يعمل حتى لو تأخر الاتصال)
        if (flowServer && typeof flowServer.startFlowServer === "function") {
            try {
                flowServer.startFlowServer();
                _originalLog("✅ سيرفر التسجيل التفاعلي جاهز.");
            } catch (e) {
                _originalError("❌ فشل تشغيل flow-server:", e?.message);
            }
        }

        configureHandlers(createHandlers());
        const sock = await startBot();
        if (!sock) throw new Error("فشل بدء البوت");
        return sock;
    } catch (e) {
        _originalError("فشل تشغيل البوت:", e?.message);
        return null;
    }
}

main().catch(e => _originalError("Fatal:", e?.message));

process.once("SIGINT", () => {
    stopWatchdog();
    stopAutoSave();
    try { if (flowServer && flowServer.stopFlowServer) flowServer.stopFlowServer(); } catch (_) {}
    try { if (typeof global.saveDbNow === "function") global.saveDbNow(); } catch (_) {}
    process.exit(0);
});

process.once("SIGTERM", () => {
    stopWatchdog();
    stopAutoSave();
    try { if (flowServer && flowServer.stopFlowServer) flowServer.stopFlowServer(); } catch (_) {}
    try { if (typeof global.saveDbNow === "function") global.saveDbNow(); } catch (_) {}
    process.exit(0);
});

module.exports = { main };
