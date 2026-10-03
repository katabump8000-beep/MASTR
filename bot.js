// ============================================================
// bot.js
// ALJESAT BOT
// Core / Database / WhatsApp Connection
// (معدّل: jidfix + حقول قاعدة بيانات جديدة + صلاحية 5)
// ============================================================

"use strict";

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const fs = require("fs");
const path = require("path");
const pino = require("pino");

const settings = require("./settings");

// ============================================================
// Paths
// ============================================================

// 📁 مجلد البيانات: على Railway ضع Volume (مثلاً /data) فتبقى الجلسة وقاعدة البيانات بعد كل إعادة تشغيل.
// الأولوية: DATA_DIR ← RAILWAY_VOLUME_MOUNT_PATH (يضعه Railway تلقائياً مع الـ Volume) ← مجلد المشروع
const DATA_DIR = String(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname).trim() || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}

const DB_FILE = path.join(DATA_DIR, "database.json");
global.DB_FILE = DB_FILE;

// أول تشغيل على Volume فارغ: ننسخ database.json الموجود مع المشروع (إن وُجد) كبداية
try {
    const seed = path.join(__dirname, "database.json");
    if (DATA_DIR !== __dirname && !fs.existsSync(DB_FILE) && fs.existsSync(seed)) {
        fs.copyFileSync(seed, DB_FILE);
        console.log("📦 تم نسخ database.json الأولي إلى مجلد البيانات.");
    }
} catch (_) {}
const DB_BAK = DB_FILE + ".bak";
const SESSION_FOLDER = path.join(DATA_DIR, settings.sessionFolder || "session");

// ============================================================
// Runtime
// ============================================================

let db = null;
let currentSocket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

// 🔑 رمز اقتران واحد فقط: لا يُطلب رمز ثانٍ في نفس التشغيل، ولا قبل مرور مدة الانتظار (حماية الرقم من الحظر)
let pairingRequestedThisRun = false;
const PAIRING_COOLDOWN_MS = (Number(process.env.PAIRING_COOLDOWN_MINUTES) || 10) * 60 * 1000;
const PAIRING_STATE_FILE = path.join(DATA_DIR, "pairing_state.json");

function readPairingState() {
    try { return JSON.parse(fs.readFileSync(PAIRING_STATE_FILE, "utf8")) || {}; } catch (_) { return {}; }
}
function writePairingState(number) {
    try { fs.writeFileSync(PAIRING_STATE_FILE, JSON.stringify({ at: Date.now(), number }), "utf8"); } catch (_) {}
}
function clearPairingState() {
    try { fs.unlinkSync(PAIRING_STATE_FILE); } catch (_) {}
}
let shuttingDown = false;
let startPromise = null;
let isReconnecting = false;

// ============================================================
// Handlers
// ============================================================

let handlers = {
    onMessage: null,
    onGroupUpdate: null,
    onConnectionOpen: null,
    onConnectionClose: null
};

const MAX_RECONNECT_DELAY = 30000;

// ============================================================
// Database
// ============================================================

function createDefaultDatabase() {
    return {
        // الإعدادات العامة
        groupSettings: {},
        adsGroups: {},
        bankGroups: {},
        workGroups: {},
        receiveGroups: {},

        // 🆕 القروب الأساسي
        mainGroup: {},

        // المستخدمون
        cooldowns: {},
        users: {},
        admins: {},

        // الصلاحيات
        permissions: { "1": [], "2": [], "3": [], "4": [], "5": [] },
        gamePermissions: [],
        gameCooldown: {},

        // المراقبة
        monitoredUsers: {},

        // المكافآت اليومية
        dailyData: {},
        dailyCooldown: {},
        chainPermissions: [],

        // الكازينو
        rouletteCooldown: {},
        crystalCooldown: {},
        crystalPlayerCooldown: {},

        // المزاد
        pendingSend: {},
        mazadCreator: null,
        inventory: {},

        // 🆕 نظام الصور
        userPhotos: {},

        // 🆕 الأباطرة
        emperors: {},

        // 🆕 روابط الترحيب
        welcomeLinks: {
            link1: "",
            link2: ""
        },

        // 🆕 حماية البطاقات
        protectCards: {},

        // 🆕 التفاعل التلقائي
        reactEnabled: {},

        // 🆕 عدّاد الرسائل
        hisbaEnabled: {},

        // 🆕 تصحيح الأخطاء
        typoEnabled: {},

        // 🆕 بيانات نتائج الفعاليات
        resultsData: {},

        // 🆕 تفعيل الردود
        repliesEnabled: {},
        ahaEnabled: {},
        quietEnabled: {},
        organizedGroups: {},

        // 🆕 توقيت الحفظ
        autoSaveEnabled: false,
        autoSaveGroupJid: null,

        // 🆕 المنشن والمعرّفات (LID)
        jidMap: {},
        numAliases: {},

        // 🆕 الحظر
        bans: {},

        // 🆕 المتجر والطلبات
        orderGroups: {},
        shopMessage: "",

        // 🆕 المراقب والمخالفات
        violationMonitors: {},
        violationSeen: [],

        // 🆕 نتائج قروب ADS
        adsResults: {},

        // 🆕 النقابات والتعدد والمؤبد
        guildNames: { "🩸": "نوفا", "❄": "فورتكس", "☘": "سولار" },
        guildBots: {},
        guildSelf: null,
        multiGuild: {},
        guildMembers: {},
        lifeBan: {},

        // 🆕 هدية الترحيب
        welcomeGift: {},

        // 🆕 قفل المزاد
        mazadLocked: false,
        mazadAllowed: {}
    };
}

function ensureDatabaseShape() {
    if (!db || typeof db !== "object" || Array.isArray(db)) {
        db = createDefaultDatabase();
    }

    // الحقول التي يجب أن تكون objects
    const objectFields = [
        "groupSettings", "adsGroups", "bankGroups", "workGroups", "receiveGroups",
        "cooldowns", "users", "admins", "gameCooldown", "monitoredUsers",
        "dailyData", "dailyCooldown", "chainPermissions", "rouletteCooldown",
        "crystalCooldown", "crystalPlayerCooldown", "pendingSend", "inventory",
        "mainGroup", "userPhotos", "emperors", "protectCards",
        "reactEnabled", "hisbaEnabled", "typoEnabled", "resultsData",
        "repliesEnabled", "ahaEnabled", "quietEnabled", "organizedGroups",
        "jidMap", "numAliases", "bans", "orderGroups", "violationMonitors",
        "adsResults", "guildNames", "guildBots", "multiGuild", "guildMembers",
        "lifeBan", "welcomeGift", "mazadAllowed"
    ];

    for (const field of objectFields) {
        if (!db[field] || typeof db[field] !== "object" || Array.isArray(db[field])) {
            db[field] = {};
        }
    }

    // welcomeLinks
    if (!db.welcomeLinks || typeof db.welcomeLinks !== "object" || Array.isArray(db.welcomeLinks)) {
        db.welcomeLinks = { link1: "", link2: "" };
    } else {
        if (typeof db.welcomeLinks.link1 !== "string") db.welcomeLinks.link1 = "";
        if (typeof db.welcomeLinks.link2 !== "string") db.welcomeLinks.link2 = "";
    }

    // permissions
    if (!db.permissions || typeof db.permissions !== "object" || Array.isArray(db.permissions)) {
        db.permissions = {};
    }
    for (const level of ["1", "2", "3", "4", "5"]) {
        if (!Array.isArray(db.permissions[level])) {
            db.permissions[level] = [];
        }
    }

    if (!Array.isArray(db.violationSeen)) db.violationSeen = [];
    if (typeof db.shopMessage !== "string") db.shopMessage = "";
    if (typeof db.mazadLocked !== "boolean") db.mazadLocked = false;
    if (db.guildSelf !== null && (typeof db.guildSelf !== "object" || Array.isArray(db.guildSelf))) db.guildSelf = null;
    if (!db.guildNames || Object.keys(db.guildNames).length === 0) {
        db.guildNames = { "🩸": "نوفا", "❄": "فورتكس", "☘": "سولار" };
    }

    if (!Array.isArray(db.gamePermissions)) db.gamePermissions = [];
    if (!Array.isArray(db.chainPermissions)) db.chainPermissions = [];
    if (typeof db.mazadCreator !== "string" && db.mazadCreator !== null) db.mazadCreator = null;

    return db;
}

function readDbFile(file) {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("الملف لا يحتوي على بيانات صحيحة.");
    }
    return parsed;
}

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        db = createDefaultDatabase();
        ensureDatabaseShape();
        return db;
    }

    let parsed = null;
    try {
        parsed = readDbFile(DB_FILE);
    } catch (error) {
        console.error("❌ تعذر تحميل database.json:", error?.message || error);

        // 🛡️ لا نمسح البيانات أبداً: نحفظ نسخة من الملف التالف ثم نجرّب النسخة الاحتياطية
        try {
            const keep = path.join(DATA_DIR, `database.corrupt-${Date.now()}.json`);
            fs.copyFileSync(DB_FILE, keep);
            console.error(`📦 حُفظت نسخة من الملف التالف: ${path.basename(keep)}`);
        } catch (_) {}

        try {
            if (fs.existsSync(DB_BAK)) {
                parsed = readDbFile(DB_BAK);
                console.warn("♻️ تم استرجاع البيانات من database.json.bak");
            }
        } catch (e2) {
            console.error("❌ النسخة الاحتياطية تالفة أيضاً:", e2?.message || e2);
        }
    }

    db = { ...createDefaultDatabase(), ...(parsed || {}) };
    ensureDatabaseShape();
    return db;
}

let saveTimer = null;
let dbDirty = false;
let lastSaveAt = 0;
let lastBakAt = 0;
const SAVE_MIN_GAP_MS = 1500;     // لا نكتب الملف أكثر من مرة كل 1.5 ثانية (الكتابة المتزامنة تجمّد البوت)
const BAK_EVERY_MS = 10 * 60 * 1000;

function saveDbNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
        ensureDatabaseShape();

        const tempFile = `${DB_FILE}.tmp`;
        const json = JSON.stringify(db, null, 2);

        // نسخة احتياطية للملف السليم الحالي كل 10 دقائق
        const now = Date.now();
        if (now - lastBakAt > BAK_EVERY_MS && fs.existsSync(DB_FILE)) {
            try { fs.copyFileSync(DB_FILE, DB_BAK); lastBakAt = now; } catch (_) {}
        }

        fs.writeFileSync(tempFile, json, "utf8");
        fs.renameSync(tempFile, DB_FILE);

        dbDirty = false;
        lastSaveAt = Date.now();
        return true;

    } catch (error) {
        console.error("❌ خطأ أثناء حفظ database.json:");
        console.error(error?.message || error);

        try {
            const tempFile = `${DB_FILE}.tmp`;
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (_) {}

        return false;
    }
}

/** نفس الاسم القديم: يطلب الحفظ (مؤجل ثوانٍ قليلة) — لا يحتاج تعديل بقية الملفات */
function saveDb() {
    dbDirty = true;
    if (saveTimer) return true;
    const wait = Math.max(250, SAVE_MIN_GAP_MS - (Date.now() - lastSaveAt));
    saveTimer = setTimeout(() => { saveTimer = null; saveDbNow(); }, wait);
    saveTimer.unref?.();
    return true;
}

process.on("exit", () => { if (dbDirty) saveDbNow(); });

loadDatabase();

global.db = db;
global.saveDb = saveDb;
global.saveDbNow = saveDbNow;

// ============================================================
// Utilities
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/[^0-9]/g, "");
}

function cleanJid(value) {
    if (!value) return "";
    return String(value).split(":")[0];
}

function jidToNumber(value) {
    return cleanNumber(cleanJid(value));
}

function isGroupJid(jid) {
    return typeof jid === "string" && jid.endsWith("@g.us");
}

function formatMention(number) {
    const clean = cleanNumber(number);
    if (!clean) return "";
    return `${clean}@s.whatsapp.net`;
}

function getOwnerNumbers() {
    const list = [];
    const add = (v) => { const n = cleanNumber(v); if (n && !list.includes(n)) list.push(n); };

    // رقم البوت يُعتبر مالكاً دائماً، ثم أي مالكين إضافيين من settings.owners
    add(settings.botNumber);
    const extra = Array.isArray(settings.owners) ? settings.owners : settings.owners ? [settings.owners] : [];
    extra.forEach(add);

    return list;
}

function getBotNumber(sock = currentSocket) {
    return jidToNumber(sock?.user?.id);
}

/**
 * 🆕 فحص هل المستخدم مالك أو امبراطور
 */
function isOwner(senderNumber, sock = currentSocket, msg = null) {
    const sender = cleanNumber(senderNumber);
    if (!sender) return false;

    if (msg?.key?.fromMe) return true;

    const owners = getOwnerNumbers();
    if (owners.includes(sender)) return true;

    const botNumber = getBotNumber(sock);
    if (botNumber && sender === botNumber) return true;

    // 🆕 فحص الأباطرة (مع الأرقام المكافئة LID ↔ هاتف)
    try {
        const jf = require("./jidfix");
        const aliases = jf.aliasesOf(sender);
        if (db && db.emperors && aliases.some(a => db.emperors[a] === true)) return true;
        if (owners.some(o => aliases.includes(o))) return true;
        if (jf.isMe(sock, sender)) return true;
    } catch (_) {}

    return false;
}

function ensureUser(userNumber) {
    const number = cleanNumber(userNumber);
    if (!number) return null;

    ensureDatabaseShape();

    if (!db.users[number] || typeof db.users[number] !== "object" || Array.isArray(db.users[number])) {
        db.users[number] = {
            balance: 0,
            nickname: "",
            rank: "",
            maxInteraction: 0,
            friend: ""
        };
    }

    const user = db.users[number];

    if (typeof user.balance !== "number" || !Number.isFinite(user.balance)) user.balance = 0;
    if (typeof user.nickname !== "string") user.nickname = "";
    if (typeof user.rank !== "string") user.rank = "";
    if (typeof user.maxInteraction !== "number" || !Number.isFinite(user.maxInteraction)) user.maxInteraction = 0;
    if (typeof user.friend !== "string") user.friend = "";

    return user;
}

function hasPermission(userNumber, level, owner = false) {
    if (owner) return true;

    ensureDatabaseShape();

    const number = cleanNumber(userNumber);
    const permissionLevel = String(level);
    const list = db.permissions[permissionLevel];
    if (!Array.isArray(list)) return false;

    let candidates = [number];
    try { candidates = require("./jidfix").aliasesOf(number); } catch (_) {}
    return candidates.some(n => list.includes(n));
}

function getMessageText(message) {
    if (!message) return "";

    const text =
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.templateButtonReplyMessage?.selectedId;

    if (!text && message.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quoted = message.extendedTextMessage.contextInfo.quotedMessage;
        return quoted.conversation || quoted.extendedTextMessage?.text || "";
    }

    return typeof text === "string" ? text.trim() : "";
}

function getMentionedJid(msg) {
    try {
        return msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
            msg?.message?.contextInfo?.mentionedJid?.[0] ||
            null;
    } catch {
        return null;
    }
}

async function sendText(sock, jid, text, msg = null, extra = {}) {
    if (!sock || !jid) return null;

    try {
        const messageText = String(text ?? "").trim();
        if (!messageText) return null;

        const options = {
            text: messageText,
            ...extra
        };

        const sendOptions = msg ? { quoted: msg } : undefined;

        return await sock.sendMessage(jid, options, sendOptions);

    } catch (error) {
        console.error(`❌ فشل إرسال الرسالة إلى ${jid}:`, error?.message || error);
        return null;
    }
}

// ============================================================
// Daily Rewards
// ============================================================

function getDailyReward(day) {
    const rewards = {
        1: 10, 2: 20, 3: 30, 4: 40, 5: 50,
        6: 60, 7: 70, 8: 80, 9: 90, 10: 100,
        11: 110, 12: 120, 13: 130, 14: 140, 15: 150,
        16: 160, 17: 170, 18: 180, 19: 190, 20: 200,
        21: 210, 22: 220, 23: 230, 24: 240, 25: 250,
        26: 260, 27: 270, 28: 280, 29: 290, 30: 1000
    };
    return rewards[day] || 10;
}

function getNextReward(day) {
    const nextDay = day + 1;
    if (nextDay > 30) return 10;
    return getDailyReward(nextDay);
}

function getDailyMessage(day, reward, nextReward) {
    if (day >= 30) {
        return `🔥▬▬▬▬🎀▬▬▬▬🔥
الهدية الاخيرة: ${reward}$
انت اصبحت عضو من الدرجة:
{الأسطورية}
لقد اكملت سلسلة 30 يوم
وقد حصلت على انجاز وسيسجل
في وصف المملكة بالكامل 🔥
🎁▬▬▬▬🎊▬▬▬▬🎁`;
    }

    return `🎁▬▬▬▬🎀▬▬▬▬🎁
هديتك اليوم: ${reward}$
سلسلة تسجيل دخولك: ${day} أيام
الجائزة القادمة: {${nextReward}$}
🎁▬▬▬▬🎊▬▬▬▬🎁`;
}

function getCooldownMessage(timeLeft, nextReward) {
    const hours = Math.floor(timeLeft / 3600000);
    const minutes = Math.floor((timeLeft % 3600000) / 60000);
    const timeStr = hours > 0 ? `${hours} ساعة و ${minutes} دقيقة` : `${minutes} دقيقة`;

    return `⚠️▬▬▬▬🎁▬▬▬▬⚠️
عذرا يرجى الانتظار {${timeStr}}
حتى تستطيع الحصول على الجائزة
التالية.. والتي ستكون: {${nextReward}$}
🎁▬▬▬▬⚠️▬▬▬▬🎁`;
}

function getNoNicknameMessage() {
    return `⚠️▬▬▬▬🎁▬▬▬▬⚠️
عذرا انت لم تسجل في قائمة
الالقاب 📜 يرجى من أحد الرتب
ان يقوم بتسجيل لقبك لتتمكن من
الحصول على هدايا بشكل متتالي
⛔▬▬▬▬⚠️▬▬▬▬⛔`;
}

// ============================================================
// Socket Management
// ============================================================

function configureHandlers(newHandlers = {}) {
    if (newHandlers && typeof newHandlers === "object") {
        handlers = {
            ...handlers,
            ...newHandlers
        };
    }
    return handlers;
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function getReconnectDelay() {
    const exponential = Math.min(
        1000 * Math.pow(2, Math.max(0, reconnectAttempts - 1)),
        MAX_RECONNECT_DELAY
    );

    const jitter = Math.floor(Math.random() * 1000);

    return Math.min(exponential + jitter, MAX_RECONNECT_DELAY);
}

function registerEvents(sock, saveCreds) {
    if (!sock || !sock.ev) {
        console.error("❌ لا يمكن تسجيل الأحداث: Socket غير صالح");
        return;
    }

    if (typeof saveCreds === "function") {
        sock.ev.on("creds.update", async (...args) => {
            try {
                await saveCreds(...args);
            } catch (error) {
                console.error("❌ خطأ أثناء حفظ بيانات الجلسة:", error?.message || error);
            }
        });
    }

    sock.ev.on("connection.update", async update => {
        try {
            const { connection, lastDisconnect } = update || {};

            if (connection === "open") {
                reconnectAttempts = 0;
                clearReconnectTimer();
                isReconnecting = false;

                console.log("✅ تم اتصال البوت بنجاح!");

                if (typeof handlers.onConnectionOpen === "function") {
                    await handlers.onConnectionOpen(sock, { db, saveDb });
                }

                return;
            }

            if (connection === "close") {
                if (typeof handlers.onConnectionClose === "function") {
                    try {
                        await handlers.onConnectionClose(sock, update);
                    } catch (error) {
                        console.error("❌ خطأ في onConnectionClose:", error?.message || error);
                    }
                }

                if (shuttingDown) return;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const loggedOut = statusCode === DisconnectReason.loggedOut;

                // 🔎 سبب الإغلاق دائماً في السجل (مهم لتشخيص فشل الاقتران)
                console.warn(`ℹ️ إغلاق الاتصال — الكود: ${statusCode ?? "غير معروف"} | مسجّل: ${Boolean(sock?.authState?.creds?.registered)}`);

                // أثناء الاقتران (غير مسجّل بعد): لا نمسح الجلسة ولا ندخل حلقة رموز جديدة كل 5 ثوانٍ
                if (loggedOut && !sock?.authState?.creds?.registered) {
                    console.error("🚫 رفض واتساب الاتصال قبل إتمام الربط (الكود 401). أوقف البوت، تأكد من الرقم، ثم أعد التشغيل مرة واحدة.");
                    try { if (currentSocket) cleanupSocket(currentSocket); } catch (_) {}
                    currentSocket = null;
                    return;
                }

                if (loggedOut) {
                    // جلسة كانت مربوطة ثم سُجّل خروجها: نحذفها ونطلب رمز اقتران جديد
                    console.error("🚫 تم تسجيل خروج الجلسة. سيتم مسح الجلسة وطلب رمز اقتران جديد خلال 5 ثوانٍ...");
                    try { if (currentSocket) cleanupSocket(currentSocket); } catch (_) {}
                    currentSocket = null;
                    try { fs.rmSync(SESSION_FOLDER, { recursive: true, force: true }); } catch (_) {}
                    clearReconnectTimer();
                    reconnectAttempts = 0;
                    reconnectTimer = setTimeout(async () => { reconnectTimer = null; if (!shuttingDown) await reconnect(); }, 5000);
                    return;
                }

                // 440 = الجلسة مفتوحة في مكان آخر؛ إعادة الاتصال السريع تسبب صراعاً لا ينتهي
                if (statusCode === DisconnectReason.connectionReplaced) {
                    console.error("⚠️ الجلسة مفتوحة في جهاز/تشغيل آخر (connectionReplaced). أغلق النسخة الأخرى من البوت.");
                    reconnectAttempts = Math.max(reconnectAttempts, 6);
                }

                // 🛑 قبل إتمام الربط: لا نستمر بالمحاولات للأبد (حتى لا يعيد Railway تشغيل البوت ويطلب رمزاً جديداً)
                if (!sock?.authState?.creds?.registered && pairingRequestedThisRun && reconnectAttempts >= 3) {
                    console.error("⏹️ انتهت مهلة الربط ولم يكتمل. لطلب رمز جديد أعد تشغيل البوت مرة واحدة (سيُطلب رمز واحد فقط).");
                    try { if (currentSocket) cleanupSocket(currentSocket); } catch (_) {}
                    currentSocket = null;
                    clearReconnectTimer();
                    if (!global.__pairingKeepAlive) global.__pairingKeepAlive = setInterval(() => {}, 60 * 60 * 1000);
                    return;
                }

                reconnectAttempts++;
                const delay = getReconnectDelay();

                console.warn(`⚠️ انقطع الاتصال. إعادة المحاولة بعد ${Math.ceil(delay / 1000)} ثانية...`);

                clearReconnectTimer();

                reconnectTimer = setTimeout(async () => {
                    reconnectTimer = null;

                    if (!shuttingDown) {
                        await reconnect();
                    }
                }, delay);
            }

        } catch (error) {
            console.error("❌ خطأ في connection.update:", error?.message || error);
        }
    });

    const mainUpsertHandler = async event => {
        if (typeof handlers.onMessage !== "function") return;

        try {
            // 🆕 تعلّم المعرّفات الحقيقية للأعضاء (LID / رقم)
            try {
                const jf = require("./jidfix");
                for (const m of event?.messages || []) jf.learnFromMessage(m);
            } catch (_) {}

            await handlers.onMessage(sock, event, { db, saveDb });
        } catch (error) {
            console.error("❌ خطأ في messages.upsert:", error?.message || error);
        }
    };
    mainUpsertHandler.__raw = true; // لا يمرّ عبر فلتر المحظورين (نحتاج الرد عليهم)
    sock.ev.on("messages.upsert", mainUpsertHandler);

    sock.ev.on("group-participants.update", async update => {
        if (typeof handlers.onGroupUpdate !== "function") return;

        try {
            await handlers.onGroupUpdate(sock, update, { db, saveDb });
        } catch (error) {
            console.error("❌ خطأ في group-participants.update:", error?.message || error);
        }
    });

    console.log("✅ تم تسجيل جميع Events على الـSocket الجديد");
}

function cleanupSocket(sock) {
    if (!sock || !sock.ev) return;

    try {
        sock.ev.removeAllListeners();
        try { if (sock.authState?.creds?.registered) sock.ws?.close(); } catch (_) {}   // لا نلمس الاتصال أثناء الاقتران
        console.log("🧹 تم تنظيف الـListeners من الـSocket القديم");
    } catch (error) {
        console.error("❌ خطأ في تنظيف الـSocket:", error?.message || error);
    }
}

async function reconnect() {
    if (isReconnecting || shuttingDown) return;

    isReconnecting = true;

    try {
        console.log("🔄 جارٍ إعادة الاتصال...");

        if (currentSocket) {
            cleanupSocket(currentSocket);
            currentSocket = null;
        }

        const sock = await createSocket();

        if (sock) {
            currentSocket = sock;
            console.log("✅ تم إعادة الاتصال بنجاح");
            isReconnecting = false;
        } else {
            console.error("❌ فشل إعادة الاتصال");
            isReconnecting = false;
        }

    } catch (error) {
        console.error("❌ خطأ في إعادة الاتصال:", error?.message || error);
        isReconnecting = false;

        if (!shuttingDown) {
            clearReconnectTimer();
            reconnectTimer = setTimeout(async () => {
                reconnectTimer = null;
                await reconnect();
            }, 5000);
        }
    }
}

async function createSocket() {
    try {
        console.log(`📁 مجلد البيانات: ${DATA_DIR}${DATA_DIR === __dirname ? "  ⚠️ (غير دائم على Railway — أضف Volume)" : "  ✅"}`);

        // 🔁 إذا غيّرت botNumber في settings.js: نمسح الجلسة القديمة تلقائياً ونطلب رمز اقتران جديداً
        try {
            const wanted = cleanNumber(settings.pairingNumber) || cleanNumber(settings.botNumber);
            const marker = path.join(SESSION_FOLDER, ".number");
            if (fs.existsSync(SESSION_FOLDER) && fs.existsSync(path.join(SESSION_FOLDER, "creds.json"))) {
                const saved = fs.existsSync(marker) ? String(fs.readFileSync(marker, "utf8")).trim() : "";
                if (saved && wanted && saved !== wanted) {
                    console.warn(`🔁 تم تغيير رقم البوت (${saved} ← ${wanted}). سيتم مسح الجلسة القديمة وطلب رمز اقتران جديد.`);
                    fs.rmSync(SESSION_FOLDER, { recursive: true, force: true });
                }
            }
        } catch (e) {
            console.error("⚠️ تعذر فحص رقم الجلسة:", e?.message || e);
        }

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);

        try {
            const wanted = cleanNumber(settings.pairingNumber) || cleanNumber(settings.botNumber);
            if (wanted) {
                fs.mkdirSync(SESSION_FOLDER, { recursive: true });
                fs.writeFileSync(path.join(SESSION_FOLDER, ".number"), wanted, "utf8");
            }
        } catch (_) {}

        let version;
        try {
            const latest = await fetchLatestBaileysVersion();
            version = latest?.version;
        } catch (error) {
            console.warn("⚠️ تعذر جلب إصدار Baileys الأخير، سيتم استخدام الإعداد الافتراضي.");
            version = undefined;
        }

        const socketOptions = {
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            markOnlineOnConnect: true,
            // مثل نسختك الأصلية (true) لدعم .تنظيف. إن ضاقت الذاكرة على Railway ضع Variable: SYNC_FULL_HISTORY=false
            syncFullHistory: String(process.env.SYNC_FULL_HISTORY || "true").toLowerCase() !== "false"
        };

        if (version) {
            socketOptions.version = version;
        }

        const sock = makeWASocket(socketOptions);

        // 🆕 إصلاح المنشن/الـ LID + فلتر المحظورين
        try {
            require("./jidfix").install(sock);
        } catch (error) {
            console.error("❌ تعذر تركيب jidfix:", error?.message || error);
        }

        const pairingNumber = cleanNumber(settings.pairingNumber) || cleanNumber(settings.botNumber) || getOwnerNumbers()[0] || "";

        if (!state.creds.registered && pairingNumber) {
            console.log(`\n🤖 جار تجهيز رمز الاقتران للرقم: ${pairingNumber}`);

            const prev = readPairingState();
            const sinceMs = Date.now() - (Number(prev.at) || 0);
            const forced = String(process.env.FORCE_PAIRING || "").toLowerCase() === "true";

            if (pairingRequestedThisRun) {
                console.log("ℹ️ سبق طلب رمز اقتران في هذا التشغيل، لن يُطلب رمز آخر. إن انتهت صلاحيته أعد تشغيل البوت.");
            } else if (!forced && prev.number === pairingNumber && sinceMs < PAIRING_COOLDOWN_MS) {
                const left = Math.ceil((PAIRING_COOLDOWN_MS - sinceMs) / 60000);
                console.log(`⏳ طُلب رمز لهذا الرقم قبل قليل. لحماية الرقم من الحظر لن يُطلب رمز جديد قبل ${left} دقيقة. (استعمل الرمز السابق أو انتظر)`);
            } else {
                pairingRequestedThisRun = true;   // نعلّمها قبل الطلب: مرة واحدة مهما حصل

                setTimeout(async () => {
                    try {
                        if (!currentSocket || currentSocket !== sock) return;

                        let code = await sock.requestPairingCode(pairingNumber);
                        writePairingState(pairingNumber);

                        if (code) {
                            code = String(code).match(/.{1,4}/g)?.join("-") || code;
                        }

                        console.log(`🔑 رمز الاقتران الخاص بك هو: [ ${code} ]\n`);
                        console.log("📱 هذا هو الرمز الوحيد الذي سيُطلب. أدخله من: واتساب ← الأجهزة المرتبطة ← ربط جهاز ← الربط برقم الهاتف.\n");

                    } catch (error) {
                        console.error("❌ خطأ في رمز الاقتران:", error?.message || error);
                    }
                }, 4000);
            }
        }

        if (state.creds.registered) clearPairingState();

        registerEvents(sock, saveCreds);

        return sock;

    } catch (error) {
        console.error("❌ فشل إنشاء Socket:", error?.message || error);
        throw error;
    }
}

async function startBot(customHandlers = null) {
    if (customHandlers && typeof customHandlers === "object") {
        configureHandlers(customHandlers);
    }

    if (shuttingDown) {
        throw new Error("البوت في وضع الإيقاف.");
    }

    if (startPromise) {
        return startPromise;
    }

    startPromise = (async () => {
        try {
            ensureDatabaseShape();

            if (currentSocket) {
                cleanupSocket(currentSocket);
                currentSocket = null;
            }

            const sock = await createSocket();
            currentSocket = sock;

            return sock;

        } finally {
            startPromise = null;
        }
    })();

    return startPromise;
}

async function shutdown() {
    shuttingDown = true;

    clearReconnectTimer();

    if (currentSocket) {
        cleanupSocket(currentSocket);
        currentSocket = null;
    }

    saveDbNow();

    console.log("🛑 تم إيقاف البوت.");
}

process.once("SIGINT", async () => {
    await shutdown();
    process.exit(0);
});

process.once("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
});

module.exports = {
    startBot,
    shutdown,
    reconnect,
    configureHandlers,

    getDb: () => db,
    saveDb,

    ensureDatabaseShape,
    ensureUser,

    cleanNumber,
    cleanJid,
    jidToNumber,
    isGroupJid,
    formatMention,

    getOwnerNumbers,
    getBotNumber,
    isOwner,

    hasPermission,

    getMessageText,
    getMentionedJid,

    sendText,

    getDailyReward,
    getNextReward,
    getDailyMessage,
    getCooldownMessage,
    getNoNicknameMessage
};
