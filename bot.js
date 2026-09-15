// ============================================================
// bot.js
// ALJESAT BOT
// Core / Database / WhatsApp Connection
// ============================================================

"use strict";

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@renz/baileys");

const fs = require("fs");
const path = require("path");
const pino = require("pino");

const settings = require("./settings");

// ============================================================
// Paths
// ============================================================

const DB_FILE = path.join(__dirname, "database.json");
const SESSION_FOLDER = path.join(__dirname, settings.sessionFolder || "session");

// ============================================================
// Runtime
// ============================================================

let db = null;
let currentSocket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
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
        groupSettings: {},
        adsGroups: {},
        bankGroups: {},
        workGroups: {},
        receiveGroups: {},
        cooldowns: {},
        users: {},
        admins: {},
        permissions: { "1": [], "2": [], "3": [], "4": [] },
        gamePermissions: [],
        gameCooldown: {},
        monitoredUsers: {},
        dailyData: {},
        dailyCooldown: {},
        chainPermissions: [],
        rouletteCooldown: {},
        crystalCooldown: {},
        crystalPlayerCooldown: {},
        pendingSend: {},
        mazadCreator: null,
        inventory: {}
    };
}

function ensureDatabaseShape() {
    if (!db || typeof db !== "object" || Array.isArray(db)) {
        db = createDefaultDatabase();
    }

    const objectFields = [
        "groupSettings", "adsGroups", "bankGroups", "workGroups", "receiveGroups",
        "cooldowns", "users", "admins", "gameCooldown", "monitoredUsers",
        "dailyData", "dailyCooldown", "chainPermissions", "rouletteCooldown",
        "crystalCooldown", "crystalPlayerCooldown", "pendingSend", "inventory"
    ];

    for (const field of objectFields) {
        if (!db[field] || typeof db[field] !== "object" || Array.isArray(db[field])) {
            db[field] = {};
        }
    }

    if (!db.permissions || typeof db.permissions !== "object" || Array.isArray(db.permissions)) {
        db.permissions = {};
    }

    for (const level of ["1", "2", "3", "4"]) {
        if (!Array.isArray(db.permissions[level])) {
            db.permissions[level] = [];
        }
    }

    if (!Array.isArray(db.gamePermissions)) db.gamePermissions = [];
    if (!Array.isArray(db.chainPermissions)) db.chainPermissions = [];
    if (typeof db.mazadCreator !== "string" && db.mazadCreator !== null) db.mazadCreator = null;

    return db;
}

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        db = createDefaultDatabase();
        ensureDatabaseShape();
        return db;
    }

    try {
        const raw = fs.readFileSync(DB_FILE, "utf8").trim();

        if (!raw) {
            db = createDefaultDatabase();
        } else {
            const parsed = JSON.parse(raw);

            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("database.json لا يحتوي على بيانات صحيحة.");
            }

            db = { ...createDefaultDatabase(), ...parsed };
        }

        ensureDatabaseShape();
        return db;

    } catch (error) {
        console.error("❌ تعذر تحميل database.json:", error?.message || error);
        db = createDefaultDatabase();
        ensureDatabaseShape();
        return db;
    }
}

function saveDb() {
    try {
        ensureDatabaseShape();
        const tempFile = `${DB_FILE}.tmp`;
        const json = JSON.stringify(db, null, 2);
        fs.writeFileSync(tempFile, json, "utf8");
        fs.renameSync(tempFile, DB_FILE);
        return true;
    } catch (error) {
        console.error("❌ خطأ أثناء حفظ database.json:", error?.message || error);
        try {
            const tempFile = `${DB_FILE}.tmp`;
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (_) {}
        return false;
    }
}

loadDatabase();
global.db = db;
global.saveDb = saveDb;

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
    const configuredOwners = Array.isArray(settings.owners)
        ? settings.owners
        : settings.owners
            ? [settings.owners]
            : [];

    const owners = configuredOwners.map(cleanNumber).filter(Boolean);

    if (owners.length === 0 && settings.botNumber) {
        const botNumber = cleanNumber(settings.botNumber);
        if (botNumber) owners.push(botNumber);
    }

    return [...new Set(owners)];
}

function getBotNumber(sock = currentSocket) {
    return jidToNumber(sock?.user?.id);
}

function isOwner(senderNumber, sock = currentSocket, msg = null) {
    const sender = cleanNumber(senderNumber);
    if (!sender) return false;

    if (msg?.key?.fromMe) return true;

    const owners = getOwnerNumbers();
    if (owners.includes(sender)) return true;

    const botNumber = getBotNumber(sock);
    if (botNumber && sender === botNumber) return true;

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

    return Array.isArray(db.permissions[permissionLevel]) &&
        db.permissions[permissionLevel].includes(number);
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

        const options = { text: messageText, ...extra };
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
        handlers = { ...handlers, ...newHandlers };
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

                // ✅ رسالة نجاح الاتصال بالتنسيق المطلوب
                console.log("");
                console.log("◆━─━─━─⊱✅⊰─━─━─━◆");
                console.log("           نجح الاتصال");
                console.log("◆━─━─━─⊱✅⊰─━─━─━◆");
                console.log("");

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

                if (loggedOut) {
                    console.error("🚫 تم تسجيل خروج الجلسة. لن تتم إعادة الاتصال تلقائياً.");
                    currentSocket = null;
                    return;
                }

                reconnectAttempts++;
                const delay = getReconnectDelay();

                console.warn(`⚠️ انقطع الاتصال. إعادة المحاولة بعد ${Math.ceil(delay / 1000)} ثانية...`);

                clearReconnectTimer();

                reconnectTimer = setTimeout(async () => {
                    reconnectTimer = null;
                    if (!shuttingDown) await reconnect();
                }, delay);
            }

        } catch (error) {
            console.error("❌ خطأ في connection.update:", error?.message || error);
        }
    });

    sock.ev.on("messages.upsert", async event => {
        if (typeof handlers.onMessage !== "function") return;

        try {
            await handlers.onMessage(sock, event, { db, saveDb });
        } catch (error) {
            console.error("❌ خطأ في messages.upsert:", error?.message || error);
        }
    });

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
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);

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
            syncFullHistory: false
        };

        if (version) {
            socketOptions.version = version;
        }

        const sock = makeWASocket(socketOptions);

        const owners = getOwnerNumbers();
        const pairingNumber = owners[0] || cleanNumber(settings.botNumber);

        if (!sock.authState.creds.registered && pairingNumber) {
            // ❆ رسالة البدء
            console.log("");
            console.log("❆━━━━━══━━━━━❆");
            console.log("جار تجهيز كود الاقتران....");
            console.log("❆━━━━━══━━━━━❆");
            console.log("");

            setTimeout(async () => {
                try {
                    if (!currentSocket || currentSocket !== sock) return;

                    const formattedNumber = String(pairingNumber).replace(/[^0-9]/g, "");
                    let code = await sock.requestPairingCode(formattedNumber);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;

                    // 🔑 رسالة الكود بالتنسيق المطلوب
                    console.log("");
                    console.log("◆━─━─━─⊱🔑⊰─━─━─━◆");
                    console.log(` الكود:     ┊${code}┊`);
                    console.log("◆━─━─━─⊱🔑⊰─━─━─━◆");
                    console.log("");

                } catch (error) {
                    console.error("❌ خطأ في رمز الاقتران:", error?.message || error);
                }
            }, 5000);
        }

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

    saveDb();

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
