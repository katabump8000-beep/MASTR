// ============================================================
// index.js
// ALJESAT BOT
// Main Entry Point + Watchdog + Rest System
// ============================================================

"use strict";

console.log("🚀🚀🚀 STARTING BOT...");

const fs = require("fs");
const path = require("path");

// ⭐ عطّلنا LogGuard مؤقتاً لنرى السجلات
const _originalLog = console.log.bind(console);
const _originalError = console.error.bind(console);
const _originalWarn = console.warn.bind(console);

console.log = (...args) => _originalLog(...args);
console.error = (...args) => _originalError(...args);
console.warn = (...args) => _originalWarn(...args);

console.log("✅ LogGuard معطّل - كل السجلات ستظهر");

// ============================================================
// Core
// ============================================================

console.log("📦 تحميل bot.js...");
const {
    startBot,
    configureHandlers,
    getDb,
    saveDb,
    jidToNumber,
    isGroupJid,
    isOwner,
    cleanNumber
} = require("./bot");
console.log("✅ bot.js تم تحميله");

console.log("📦 تحميل commands.js...");
const { handleCommand } = require("./commands");
console.log("✅ commands.js تم تحميله");

console.log("📦 تحميل admin.js...");
const {
    handleGroupJoin,
    startAdminMonitoring,
    stopAdminMonitoring
} = require("./admin");
console.log("✅ admin.js تم تحميله");

console.log("📦 تحميل menu.js...");
const { activeGames } = require("./menu");
console.log("✅ menu.js تم تحميله");

console.log("📦 تحميل duel.js...");
const { activeCasinos, isSarahaActive } = require("./duel");
console.log("✅ duel.js تم تحميله");

console.log("📦 تحميل saraha.js...");
const { activeSaraha, handleSarahaCommand } = require("./saraha");
console.log("✅ saraha.js تم تحميله");

console.log("📦 تحميل mzad.js...");
const {
    activeMazads,
    handleMazadCommand,
    handleMazadBid,
    handleMazadInventory,
    handleMazadSend,
    handleMazadCancelSend
} = require("./mzad");
console.log("✅ mzad.js تم تحميله");

console.log("📦 تحميل colors.js...");
const { activeColors, handleColorsCommand } = require("./colors");
console.log("✅ colors.js تم تحميله");

console.log("📦 تحميل animals.js...");
const { activeAnimals, handleAnimalsCommand } = require("./animals");
console.log("✅ animals.js تم تحميله");

// ⭐ تحميل dino.js (قد يفشل إذا لم يُنشأ بعد)
let activeDinoGames = {};
let handleDinoCommand = async () => false;
let finalizeDino = async () => false;
let receiveDinoResult = () => {};

try {
    console.log("📦 تحميل dino.js...");
    const dinoModule = require("./dino");
    activeDinoGames = dinoModule.activeDinoGames || {};
    handleDinoCommand = dinoModule.handleDinoCommand;
    finalizeDino = dinoModule.finalizeDino;
    receiveDinoResult = dinoModule.receiveDinoResult;
    console.log("✅ dino.js تم تحميله");
} catch (e) {
    console.warn("⚠️ dino.js غير موجود أو فيه خطأ:", e.message);
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

const WATCHDOG_CHECK_MS = 60 * 1000;
const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
const GAME_STUCK_THRESHOLD_MS = 25 * 60 * 1000;
const MAX_IDLE_CHECKS = 15;
const MAX_GAME_COUNT = 8;

// ============================================================
// 🎮 قائمة انتظار اختيار الفعالية
// ============================================================

const pendingGamesMenu = Object.create(null);
global.pendingGamesMenu = pendingGamesMenu;

// ============================================================
// 🛡️ شبكة أمان
// ============================================================

let lastExceptionAt = 0;
const EXCEPTION_COOLDOWN_MS = 5000;

process.on('uncaughtException', (error) => {
    const now = Date.now();
    if (now - lastExceptionAt < EXCEPTION_COOLDOWN_MS) return;
    lastExceptionAt = now;
    _originalError('❌ Uncaught Exception:', error?.message || error);
    console.error(error.stack);
});

process.on('unhandledRejection', (reason) => {
    const now = Date.now();
    if (now - lastExceptionAt < EXCEPTION_COOLDOWN_MS) return;
    lastExceptionAt = now;
    _originalError('❌ Unhandled Rejection:', reason?.message || reason);
    console.error(reason?.stack || reason);
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
// حذف اللقب عند المغادرة
// ============================================================

async function handleLeaveRemoveNickname(sock, update, db) {
    try {
        if (!update || typeof update !== "object") return false;
        const { id, participants, action } = update;

        if (action !== "remove" || !id || !Array.isArray(participants) || !participants.length) {
            return false;
        }
        if (!db.organizedGroups || !db.organizedGroups[id]) return false;

        let changed = false;
        for (const participant of participants) {
            const cleanNum = cleanNumber(participant);
            if (!cleanNum) continue;
            const user = db.users && db.users[cleanNum];
            if (!user) continue;
            if (user.nickname && String(user.nickname).trim()) {
                user.nickname = "";
                changed = true;
            }
        }

        if (changed && typeof saveDb === "function") saveDb();
        return changed;
    } catch {
        return false;
    }
}

// ============================================================
// 💾 الحفظ التلقائي
// ============================================================

const DB_FILE = path.join(__dirname, "database.json");

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
        const dbContent = getDatabaseContent();
        if (!dbContent) return;

        const maxLength = 65536;
        const parts = [];
        if (dbContent.length > maxLength) {
            for (let i = 0; i < dbContent.length; i += maxLength) {
                parts.push(dbContent.substring(i, i + maxLength));
            }
        } else {
            parts.push(dbContent);
        }

        const timestamp = new Date().toLocaleString('ar-EG', {
            timeZone: 'Africa/Cairo',
            hour12: false
        });

        for (let i = 0; i < parts.length; i++) {
            const isLast = i === parts.length - 1;
            const header = "📦 *نسخة احتياطية*\n🕐 " + timestamp + "\n📊 جزء " + (i + 1) + "/" + parts.length + "\n\n";
            const footer = isLast ? "\n\n✅ تم الحفظ ✅" : '';
            await sock.sendMessage(autoSaveGroupJid, {
                text: header + parts[i] + footer
            });
        }
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
// 💬 الردود التلقائية
// ============================================================

async function handleAutoReplies(sock, jid, msg, text, sender, cleanSender, db, saveDb) {
    try {
        if (isSarahaActive && isSarahaActive(jid)) return;

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
// 🎮 دوال تحليل الفعاليات
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
        for (const jid of Object.keys(activeDinoGames || {})) {
            checkGame(jid, activeDinoGames[jid], "طائر", 15 * 60 * 1000);
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
        for (const jid of Object.keys(activeDinoGames || {})) {
            check(jid, activeDinoGames[jid], "طائر", 15 * 60 * 1000);
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
        } else if (name === "طائر") {
            delete activeDinoGames[jid];
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
// 🆘 نظام الاستراحة
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
            if (activeDinoGames[jid]) { delete activeDinoGames[jid]; stoppedCount++; }
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
// 🐕 Watchdog
// ============================================================

function startWatchdog(sock) {
    lastSocketRef = sock;
    lastMessageAt = Date.now();
    lastGroupUpdateAt = Date.now();
    consecutiveIdleChecks = 0;

    if (watchdogInterval) clearInterval(watchdogInterval);

    watchdogInterval = setInterval(async () => {
        try {
            const now = Date.now();
            const idleMs = now - lastMessageAt;
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
// Handlers
// ============================================================

function createHandlers() {
    return {
        onConnectionOpen: async (sock) => {
            console.log("🎉 الاتصال فتح! بدء المراقبة...");
            setupAdminMonitoring(sock);

            const db = getDb();
            if (db && db.autoSaveEnabled && db.autoSaveGroupJid) {
                startAutoSave(sock, db.autoSaveGroupJid);
            }

            startWatchdog(sock);
            console.log("✅ البوت جاهز بالكامل!");
        },

        onConnectionClose: async () => {
            console.log("❌ الاتصال أُغلق");
            stopAdminMonitoring();
            stopWatchdog();
        },

        onMessage: async (sock, event, context) => {
            try {
                lastMessageAt = Date.now();

                const { messages, type } = event || {};
                if (type !== "notify") return;
                if (!Array.isArray(messages) || !messages.length) return;

                const db = context.db || getDb();

                for (const msg of messages) {
                    try {
                        if (shouldIgnoreMessage(msg)) continue;

                        const jid = msg?.key?.remoteJid;
                        if (!jid) continue;

                        const sender = getSender(msg, sock);
                        const cleanSender = jidToNumber(sender);
                        const isGroup = isGroupJid(jid);
                        const botNumber = getBotNumber(sock);
                        const owner = isOwner(cleanSender, sock, msg);

                        // ⭐ زر "سحب" من لعبة الطائر
                        const btnResponse = msg.message?.buttonsResponseMessage;
                        if (btnResponse) {
                            const buttonId = String(btnResponse.selectedButtonId || "");

                            if (buttonId.startsWith("dino_withdraw_")) {
                                try {
                                    const parts = buttonId.split("_");
                                    const scoreIdx = parts.indexOf("SCORE");
                                    const earnIdx = parts.indexOf("EARN");

                                    if (scoreIdx !== -1 && earnIdx !== -1) {
                                        const score = parseInt(parts[scoreIdx + 1], 10) || 0;
                                        const earn = parseInt(parts[earnIdx + 1], 10) || 0;

                                        receiveDinoResult(jid, score, earn);
                                        await finalizeDino(sock, jid, db, saveDb, score, earn);

                                        console.log(`✅ Dino withdraw: score=${score}, earn=${earn}`);
                                    }
                                } catch (e) {
                                    _originalError("Dino withdraw error:", e?.message);
                                }
                                continue;
                            }
                        }

                        // 🎮 List Message
                        const listResponse = msg.message?.listResponseMessage;
                        if (listResponse) {
                            const selectedRowId = String(listResponse.singleSelectReply?.selectedRowId || "");

                            if (selectedRowId.startsWith("dino_start_")) {
                                try {
                                    await handleDinoCommand(sock, jid, msg, db, saveDb, cleanSender, owner);
                                } catch (e) {
                                    _originalError("Dino start error:", e?.message);
                                }
                                continue;
                            }

                            let matchedCmd = null;
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
                                { keyword: "طائر", cmd: "طائر" }
                            ];

                            for (const item of gameKeywords) {
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

                                if (cmd === "طائر") {
                                    try {
                                        await handleDinoCommand(sock, jid, msg, db, saveDb, cleanSender, owner);
                                    } catch (e) {
                                        _originalError("Dino start (from menu) error:", e?.message);
                                    }
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

                        const text = getMessageTextFromMsg(msg);
                        if (!text) continue;

                        if (!text.startsWith(".")) {
                            await handleAutoReplies(sock, jid, msg, text, sender, cleanSender, db, saveDb);
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

                        if (text === ".طائر" || text === ".dino") {
                            if (await handleDinoCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
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
                await handleGroupJoin(sock, update, db);
                await handleLeaveRemoveNickname(sock, update, db);
            } catch (e) {
                _originalError("GroupUpdate error:", e?.message);
            }
        }
    };
}

// ============================================================
// Start
// ============================================================

async function main() {
    try {
        console.log("╔════════════════════════════════════╗");
        console.log("║        🤖 ALJESAT BOT START       ║");
        console.log("╚════════════════════════════════════╝");

        console.log("📦 تحميل AIRich...");
        try {
            const messageBuilder = await import("./MessageBuilder.js");
            global.AIRich = messageBuilder.AIRich;
            global.Button = messageBuilder.Button;
            global.ButtonV2 = messageBuilder.ButtonV2;
            global.Carousel = messageBuilder.Carousel;
            console.log("✅ AIRich محمّل");
        } catch (e) {
            console.warn("⚠️ MessageBuilder.js غير موجود:", e.message);
        }

        console.log("🔧 تكوين الـ handlers...");
        configureHandlers(createHandlers());

        console.log("🚀 بدء تشغيل البوت...");
        const sock = await startBot();

        if (!sock) throw new Error("فشل بدء البوت");
        console.log("✅ البوت يعمل!");
        return sock;
    } catch (e) {
        console.error("❌ فشل تشغيل البوت:", e?.message);
        console.error(e.stack);
        return null;
    }
}

main().catch(e => {
    console.error("❌ Fatal:", e?.message);
    console.error(e.stack);
});

process.once("SIGINT", () => {
    stopWatchdog();
    stopAutoSave();
    process.exit(0);
});

process.once("SIGTERM", () => {
    stopWatchdog();
    stopAutoSave();
    process.exit(0);
});

module.exports = { main };
