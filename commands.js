"use strict";

const {
    getDb, saveDb, cleanNumber, jidToNumber, getMentionedJid, isGroupJid,
    isOwner, hasPermission, sendText, getDailyReward, getNextReward,
    getDailyMessage, getCooldownMessage, getNoNicknameMessage
} = require("./bot");

const { activeGames, handleGameCommand } = require("./menu");
const {
    activeCasinos, startRoulette, startCrystal, handleRouletteStart,
    removeCasino, isSarahaActive
} = require("./duel");
const { handleAdminCommand } = require("./admin");
const {
    activeSaraha, handleSarahaCommand, checkSarahaActive, stopSarahaGame
} = require("./saraha");
const {
    activeColors, handleColorsCommand, checkColorsActive, stopColorsGame
} = require("./colors");
const {
    activeAnimals, handleAnimalsCommand, checkAnimalsActive, stopAnimalsGame
} = require("./animals");
const {
    activeMazads, checkMazadActive, handleMazadCommand, handleMazadBid,
    handleMazadInventory, handleMazadSend, handleMazadCancelSend
} = require("./mzad");

let globalGameBlockUntil = 0;
const pendingGamesMenu = global.pendingGamesMenu || (global.pendingGamesMenu = Object.create(null));

// ============================================================
// 🎮 تحويل النصوص الكاملة إلى أوامر فعاليات
// ============================================================
function normalizeGameCommand(text) {
    if (!text) return null;

    const cleanText = String(text).trim();

    const gameMap = [
        { pattern: /روليت/, cmd: "روليت" },
        { pattern: /إيمـــ?😀ــوجي|ايمـــ?😀ــوجي|إيموجي|ايموجي/, cmd: "ايموجي" },
        { pattern: /أعـــ?🚩ــلام|اعـــ?🚩ــلام|أعلام|اعلام/, cmd: "اعلام" },
        { pattern: /صــ?🫣ــراحة|صراحة/, cmd: "صراحة" },
        { pattern: /تفكـ?🧩ـــ?يك|تفكيك/, cmd: "تفكيك" },
        { pattern: /الـ?حـ?🦊ـ?يوانات|الحيوانات/, cmd: "الحيوانات" },
        { pattern: /ألـــ?🎨ـــ?وان|الوان/, cmd: "الوان" },
        { pattern: /كــ?تــ?✍️ــ?ابـ?ة|كتابة/, cmd: "كتابة" },
        { pattern: /كريستال/, cmd: "كريستال" }
    ];

    for (const item of gameMap) {
        if (item.pattern.test(cleanText)) return item.cmd;
    }

    return null;
}

function getMessageText(msg) {
    const m = msg?.message;
    if (!m) return "";
    return (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption ||
        m.videoMessage?.caption || m.documentMessage?.caption ||
        m.buttonsResponseMessage?.selectedButtonId ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        m.templateButtonReplyMessage?.selectedId || "").trim();
}

function getCommand(text) {
    if (typeof text !== "string" || !text.startsWith(".")) return null;
    const body = text.slice(1).trim();
    if (!body) return null;
    const tokens = body.split(/\s+/);
    const command = String(tokens.shift() || "").toLowerCase();
    return { command, parts: tokens, raw: body };
}

function getNormalizedCommand(text) {
    if (!text) return null;
    const lower = text.toLowerCase().trim();
    if (text.startsWith(".")) return text;
    const map = {
        "القاب": ".القاب", "تفاصيل": ".تفاصيلي", "تفاصيلي": ".تفاصيلي",
        "تسجيل": ".سجل", "تحويل الي": ".تحويل", "تحويل": ".تحويل", "تنظيم": ".تنظيم"
    };
    for (const [k, v] of Object.entries(map)) {
        if (lower === k || lower.startsWith(k + " ")) return v + lower.slice(k.length);
    }
    return null;
}

function isSimilarNickname(existing, newName) {
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

function getSender(msg, sock) {
    if (msg?.key?.fromMe) return sock?.user?.id || "";
    return msg?.key?.participant || msg?.key?.remoteJid || "";
}

function getUser(db, n) {
    if (!db.users) db.users = {};
    return db.users[n] || null;
}

function ensureUser(db, n) {
    db.users = db.users || {};
    if (!db.users[n] || typeof db.users[n] !== "object") {
        db.users[n] = { balance: 0, nickname: "", rank: "", maxInteraction: 0, friend: "" };
    }
    const u = db.users[n];
    if (typeof u.balance !== "number" || !Number.isFinite(u.balance)) u.balance = 0;
    if (typeof u.nickname !== "string") u.nickname = "";
    if (typeof u.rank !== "string") u.rank = "";
    if (typeof u.maxInteraction !== "number" || !Number.isFinite(u.maxInteraction)) u.maxInteraction = 0;
    if (typeof u.friend !== "string") u.friend = "";
    return u;
}

function parsePositiveInteger(v) {
    const a = Number.parseInt(String(v || "").replace(/[,$]/g, ""), 10);
    return Number.isSafeInteger(a) && a > 0 ? a : 0;
}

function findUserByNickname(db, nick) {
    const w = String(nick || "").trim();
    if (!w) return null;
    for (const n of Object.keys(db.users || {})) {
        const u = db.users[n];
        if (u && String(u.nickname || "").trim() === w) return { number: n, user: u };
    }
    return null;
}

function findUserByNicknameForFriend(db, nick) { return findUserByNickname(db, nick); }

function userMention(n) {
    const c = cleanNumber(n);
    return c ? c + "@s.whatsapp.net" : "";
}

const GAME_COMMANDS = new Set([
    "العاب","كازينو","رهان","بدأ","بدأ_الرهان","بدل_الرهان","تفكيك","كتابة",
    "اعلام","ايموجي","روليت","كريستال","الكرستال","صراحة","الوان","الحيوانات","مزاد","وقف"
]);

function isGameCommand(c) { return GAME_COMMANDS.has(c); }

async function checkGameContext(sock, jid, msg, isGroup) {
    if (!isGroup) {
        await sendText(sock, jid, "يرجى مشاركة الفعالية في مملكة الجاسات ولا يسمح لك باستخدام أو إنشاء فعالية في هذا الشات.", msg);
        return false;
    }
    if (Date.now() < globalGameBlockUntil) {
        const left = Math.max(1, Math.ceil((globalGameBlockUntil - Date.now()) / 60000));
        await sendText(sock, jid, "⚠️ الفعاليات متوقفة حالياً. يرجى الانتظار " + left + " دقيقة.", msg);
        return false;
    }
    return true;
}

function stopAllGames() {
    for (const j of Object.keys(activeGames || {})) {
        try {
            const g = activeGames[j];
            if (g && typeof g.stopGame === "function") g.stopGame();
            else delete activeGames[j];
        } catch (e) { delete activeGames[j]; }
    }
}

function stopAllCasinos() {
    for (const j of Object.keys(activeCasinos || {})) {
        try { removeCasino(j); } catch (e) { delete activeCasinos[j]; }
    }
}

async function handleEmergencyStop(sock, jid, msg, owner) {
    if (!owner) return true;
    try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}
    globalGameBlockUntil = Date.now() + 15 * 60 * 1000;
    stopAllGames(); stopAllCasinos();
    for (const j of Object.keys(activeSaraha || {})) { try { stopSarahaGame(j); } catch (e) {} }
    for (const j of Object.keys(activeColors || {})) { try { stopColorsGame(j); } catch (e) {} }
    for (const j of Object.keys(activeAnimals || {})) { try { stopAnimalsGame(j); } catch (e) {} }
    for (const j of Object.keys(activeMazads || {})) {
        try { activeMazads[j]?.stopMazad?.(); } catch (e) {}
    }
    return true;
}

// ============================================================
// 🎮 .العاب - List Message بالنصوص الكاملة
// ============================================================
async function handleGamesList(sock, jid, msg, senderNumber) {
    pendingGamesMenu[jid] = { sender: senderNumber, timestamp: Date.now() };
    setTimeout(() => {
        if (pendingGamesMenu[jid] && pendingGamesMenu[jid].sender === senderNumber) delete pendingGamesMenu[jid];
    }, 5 * 60 * 1000);

    const headerText = "_*❆━━═⏣⊰🎮⊱⏣═━━❆*_\n  `رجاءاً قم بتحديد الفعالية:`\n_*❆━━═⏣⊰🎰⊱⏣═━━❆*_";

    const rows = [
        { id: "⏣⊰ تفكـ🧩ـــيك ⊱⏣\nلعبة تفكيك الكلمات", title: "⏣⊰ تفكـ🧩ـــيك ⊱⏣", description: "لعبة تفكيك الكلمات" },
        { id: "⏣⊰ كــتــ✍️ــابـة ⊱⏣\nلعبة كتابة الكلمة", title: "⏣⊰ كــتــ✍️ــابـة ⊱⏣", description: "لعبة كتابة الكلمة" },
        { id: "⏣⊰ ألــــ🎨ـــوان ⊱⏣\nلعبة الألوان", title: "⏣⊰ ألــــ🎨ـــوان ⊱⏣", description: "لعبة الألوان" },
        { id: "⏣⊰ صــ🫣ــراحة ⊱⏣\nلعبة الصراحة", title: "⏣⊰ صــ🫣ــراحة ⊱⏣", description: "لعبة الصراحة" },
        { id: "⏣⊰ الـحـ🦊ـيوانات ⊱⏣\nلعبة الحيوانات", title: "⏣⊰ الـحـ🦊ـيوانات ⊱⏣", description: "لعبة الحيوانات" },
        { id: "⏣⊰ أعـــ🚩ــلام ⊱⏣\nلعبة الأعلام", title: "⏣⊰ أعـــ🚩ــلام ⊱⏣", description: "لعبة الأعلام" },
        { id: "⏣⊰ إيمـــ😀ــوجي ⊱⏣\nلعبة الإيموجي", title: "⏣⊰ إيمـــ😀ــوجي ⊱⏣", description: "لعبة الإيموجي" },
        { id: "❆━═🎲 روليت 🎰═━❆\nلعبة الروليت", title: "❆━═🎲 روليت 🎰═━❆", description: "لعبة الروليت" },
        { id: "❆━═🎲 كريستال 🎰═━❆\nلعبة الكريستال", title: "❆━═🎲 كريستال 🎰═━❆", description: "لعبة الكريستال" }
    ];

    try {
        const { sendInteractiveMessage } = require("@qadeerxtech/qadeer-btns");
        await sendInteractiveMessage(sock, jid, {
            text: headerText,
            footer: "Aljesat Bot",
            interactiveButtons: [
                {
                    name: "single_select",
                    buttonParamsJson: JSON.stringify({
                        title: "👈 تحديد 👉",
                        sections: [
                            { title: "🎮 الفعاليات المتاحة", rows: rows }
                        ]
                    })
                }
            ]
        });
        return true;
    } catch (e1) {
        console.error("❌ qadeer-btns failed:", e1?.message);
    }

    try {
        await sock.sendMessage(jid, {
            text: headerText,
            footer: "Aljesat Bot",
            buttonText: "👈 تحديد 👉",
            sections: [
                {
                    title: "🎮 الفعاليات المتاحة",
                    rows: rows.map(r => ({ title: r.title, rowId: r.id, description: r.description }))
                }
            ]
        }, { quoted: msg });
        return true;
    } catch (e2) {
        console.error("❌ List Message failed:", e2?.message);
    }

    const fallback = headerText + "\n\n⏣⊰ تفكـ🧩ـــيك ⊱⏣ .تفكيك\n⏣⊰ كــتــ✍️ــابـة ⊱⏣ .كتابة\n⏣⊰ ألــــ🎨ـــوان ⊱⏣ .الوان\n⏣⊰ صــ🫣ــراحة ⊱⏣ .صراحة\n⏣⊰ الـحـ🦊ـيوانات ⊱⏣ .الحيوانات\n⏣⊰ أعـــ🚩ــلام ⊱⏣ .اعلام\n⏣⊰ إيمـــ😀ــوجي ⊱⏣ .ايموجي\n❆━═🎲 روليت 🎰═━❆ .روليت\n❆━═🎲 كريستال 🎰═━❆ .كريستال";
    await sendText(sock, jid, fallback, msg);

    return true;
}

async function handleCasinoMenu(sock, jid, msg) {
    if (isSarahaActive(jid)) {
        await sendText(sock, jid, "⚠️ لا يمكن فتح الكازينو أثناء وجود لعبة صراحة نشطة.", msg);
        return true;
    }
    const text = "╮─❖『 الكازينو 』❖─╭\n\n🎰 مرحباً بك في الكازينو!\n\n📋 *اختر نوع اللعبة:*\n\n• .روليت - لعبة الدبوس والبالونات 🎈\n• .الكرستال - لعبة الكريستال 💎\n\n╰─❖『 اختر ما يناسبك 』❖─╯";
    await sendText(sock, jid, text, msg);
    return true;
}

async function handleTitles(sock, jid, msg, db) {
    const users = db.users || {};
    const titles = [];
    const mentions = [];
    for (const n of Object.keys(users)) {
        const u = users[n];
        if (u && String(u.nickname || "").trim()) {
            titles.push({ nickname: u.nickname, user: n });
            mentions.push(n + "@s.whatsapp.net");
        }
    }
    if (titles.length === 0) {
        await sendText(sock, jid, "⚠️ لا توجد ألقاب مسجلة حالياً.", msg);
        return true;
    }
    let text = "◆━─━─━─⊱🪪⊰─━─━─━◆\n";
    titles.forEach((it, i) => { text += (i + 1) + " *☜* " + it.nickname + "\n"; });
    text += "◆━─━─━─⊱📜⊰─━─━─━◆";
    await sendText(sock, jid, text, msg, { mentions });
    return true;
}

async function handleRegister(sock, jid, msg, parts, senderNumber, owner, db) {
    if (!hasPermission(senderNumber, "2", owner)) {
        await sendText(sock, jid, "❌ ليس لديك صلاحية لاستخدام أمر .سجل.", msg);
        return true;
    }
    const mentioned = getMentionedJid(msg);
    if (!mentioned) {
        await sendText(sock, jid, "⚠️ يرجى منشن الشخص وكتابة اللقب.", msg);
        return true;
    }
    const target = cleanNumber(mentioned);
    const nickname = parts.slice(1).join(" ").trim();
    if (!nickname) {
        await sendText(sock, jid, "⚠️ يرجى كتابة اللقب بعد المنشن.", msg);
        return true;
    }
    for (const n of Object.keys(db.users || {})) {
        const eu = db.users[n];
        if (!eu || !eu.nickname) continue;
        if (isSimilarNickname(eu.nickname, nickname)) {
            await sendText(sock, jid, "⚠️ اللقب `" + nickname + "` مشابه لـ `" + eu.nickname + "`\n❌ اختر لقباً مختلفاً.", msg);
            return true;
        }
    }
    const u = ensureUser(db, target);
    u.nickname = nickname;
    saveDb();
    const successMsg = "👑◈══════════════◈👑\n✅ تم تسجيل لقب العضو بنجاح\n🏷️ اللقب الجديد: [" + nickname + "]\n\nبالتوفيق ان شاء الله 💼\n👑◈══════════════◈👑";
    await sendText(sock, jid, successMsg, msg);
    return true;
}

async function handleDeleteTitle(sock, jid, msg, parts, senderNumber, owner, db) {
    if (!hasPermission(senderNumber, "2", owner)) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية.", msg);
        return true;
    }
    const nickname = parts.join(" ").trim();
    if (!nickname) { await sendText(sock, jid, "⚠️ اكتب اللقب المراد حذفه.", msg); return true; }
    const found = findUserByNickname(db, nickname);
    if (!found) { await sendText(sock, jid, "❌ لم يتم العثور على اللقب: [" + nickname + "]", msg); return true; }
    found.user.nickname = "";
    saveDb();
    const delMsg = "🚫◈═══『 إزالة لقب 』═══◈🚫\n⚠️ تم حذف اللقب بنجاح ✅\n🏷️ اللقب المحذوف: [" + nickname + "]\n\nبواسطة: @" + senderNumber + "\n⛔◈══════════════◈⛔";
    await sendText(sock, jid, delMsg, msg, { mentions: [userMention(senderNumber)] });
    return true;
}

async function handleFriendRelation(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    if (!hasPermission(senderNumber, "1", owner)) {
        await sendText(sock, jid, "❌ ليس لديك صلاحية.", msg);
        return true;
    }
    const text = getMessageText(msg);
    const match = text.match(/\.علاقة\s+([^\s]+)\s+مع\s+([^\s]+)/);
    if (!match) { await sendText(sock, jid, "⚠️ الاستخدام: .علاقة لقب1 مع لقب2", msg); return true; }
    const n1 = match[1].trim(), n2 = match[2].trim();
    if (!n1 || !n2) { await sendText(sock, jid, "⚠️ يرجى تحديد لقبين صحيحين.", msg); return true; }
    const u1 = findUserByNicknameForFriend(db, n1);
    const u2 = findUserByNicknameForFriend(db, n2);
    if (!u1) { await sendText(sock, jid, "❌ لم يتم العثور على اللقب: [" + n1 + "]", msg); return true; }
    if (!u2) { await sendText(sock, jid, "❌ لم يتم العثور على اللقب: [" + n2 + "]", msg); return true; }
    if (u1.number === u2.number) { await sendText(sock, jid, "⚠️ لا يمكن ربط الشخص بنفسه.", msg); return true; }
    const uu1 = ensureUser(db, u1.number), uu2 = ensureUser(db, u2.number);
    uu1.friend = n2; uu2.friend = n1;
    saveDb();
    try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}
    await sendText(sock, jid, "✅ تم تحديث العلاقة بنجاح.", msg);
    return true;
}

async function handleMyDetails(sock, jid, msg, senderNumber, db) {
    const user = getUser(db, senderNumber);
    const dn = (user && String(user.nickname || "").trim()) || "غير مسجل";
    const fn = (user && String(user.friend || "").trim()) || "لا يوجد";
    const text = "╗═════『   بياناتك  』═════╔\n\n💰 رصـــيـــــــدك:     `{" + (user?.balance || 0) + "}`\n\n🏷️ لقبك:    `{" + dn + "}`\n\n🎖️ رتبتك:   `{" + (user?.rank || "عضو") + "}`\n\n📈 أعلى تفاعل لك: `{" + (user?.maxInteraction || 0) + "}`\n\n🫂 صـــديق:  `{" + fn + "}`\n╝════════════════════╚";
    await sendText(sock, jid, text, msg);
    return true;
}

async function handleUserDetails(sock, jid, msg, db) {
    const mentioned = getMentionedJid(msg);
    if (!mentioned) { await sendText(sock, jid, "⚠️ يرجى منشن الشخص.", msg); return true; }
    const target = cleanNumber(mentioned);
    const user = getUser(db, target);
    if (!user) { await sendText(sock, jid, "❌ العضو ليس لديه ملف.", msg); return true; }
    const dn = String(user.nickname || "").trim() || "غير مسجل";
    const fn = String(user.friend || "").trim() || "لا يوجد";
    const text = "╗═════『 بيانات العضو 』═════╔\n\n👤 العضو: @" + target + "\n💰 رصـــيـــــــده:     `{" + (user.balance || 0) + "}`\n\n🏷️ لقبه:    `{" + dn + "}`\n\n🎖️ رتبته:   `{" + (user.rank || "عضو") + "}`\n\n📈 أعلى تفاعل له: `{" + (user.maxInteraction || 0) + "}`\n\n🫂 صـــديق:  `{" + fn + "}`\n╝════════════════════╚";
    await sendText(sock, jid, text, msg, { mentions: [mentioned] });
    return true;
}

async function handleRank(sock, jid, msg, parts, senderNumber, owner, db) {
    if (!hasPermission(senderNumber, "3", owner)) { await sendText(sock, jid, "❌ ليس لديك صلاحية.", msg); return true; }
    const mentioned = getMentionedJid(msg);
    if (!mentioned) { await sendText(sock, jid, "⚠️ يرجى منشن الشخص وكتابة الرتبة.", msg); return true; }
    const target = cleanNumber(mentioned);
    const rank = parts.slice(1).join(" ").trim();
    if (!rank) { await sendText(sock, jid, "⚠️ اكتب الرتبة.", msg); return true; }
    const user = ensureUser(db, target);
    user.rank = rank;
    saveDb();
    await sendText(sock, jid, "✅ تم تحديث رتبة العضو إلى: [" + rank + "]", msg);
    return true;
}

async function handleInteraction(sock, jid, msg, parts, senderNumber, owner, db) {
    if (!hasPermission(senderNumber, "4", owner)) { await sendText(sock, jid, "❌ ليس لديك صلاحية.", msg); return true; }
    const mentioned = getMentionedJid(msg);
    if (!mentioned) { await sendText(sock, jid, "⚠️ يرجى منشن الشخص وكتابة الرقم.", msg); return true; }
    const target = cleanNumber(mentioned);
    const amount = parsePositiveInteger(parts[parts.length - 1]);
    if (!amount) { await sendText(sock, jid, "⚠️ رقم تفاعل غير صحيح.", msg); return true; }
    const user = ensureUser(db, target);
    user.maxInteraction = amount;
    saveDb();
    await sendText(sock, jid, "✅ تم تحديث أعلى تفاعل للعضو إلى: [" + amount + "]", msg);
    return true;
}

async function handleDeposit(sock, jid, msg, parts, senderNumber, owner, db) {
    if (!hasPermission(senderNumber, "1", owner)) { await sendText(sock, jid, "❌ ليس لديك صلاحية.", msg); return true; }
    const mentioned = getMentionedJid(msg);
    if (!mentioned) { await sendText(sock, jid, "⚠️ يرجى منشن الشخص والمبلغ.", msg); return true; }
    const target = cleanNumber(mentioned);
    const amount = parsePositiveInteger(parts[parts.length - 1]);
    if (!amount) { await sendText(sock, jid, "⚠️ مبلغ غير صحيح.", msg); return true; }
    const user = getUser(db, target);
    if (!user || !String(user.nickname || "").trim()) { await sendText(sock, jid, "❌ اللقب غير مسجل.", msg); return true; }
    user.balance = Number(user.balance || 0) + amount;
    saveDb();
    await sendText(sock, jid, "✅ 『 تم الإيداع 』✅\n\nتم إيداع: `" + amount + "` عملة في البنك للعضو الملقب بـ: [" + user.nickname + "]", msg);
    const bankMessage = "┓━━━✦❘💰❘✦━━━┏\n*💰{  " + user.nickname + "   }   : رصيدك:* ┊ `" + user.balance + "$`┊\n┗━━━✦❘💰❘✦━━━┛";
    for (const bj of Object.keys(db.bankGroups || {})) {
        if (!db.bankGroups[bj]) continue;
        await sock.sendMessage(bj, { text: bankMessage }).catch(() => {});
    }
    return true;
}

async function handleTransfer(sock, jid, msg, parts, senderNumber, db) {
    if (parts[0] && (parts[0].toLowerCase() === "الى" || parts[0].toLowerCase() === "الي")) {
        const amount = parsePositiveInteger(parts[parts.length - 1]);
        const targetNickname = parts.slice(1, -1).join(" ").trim();
        if (!targetNickname || !amount) { await sendText(sock, jid, "⚠️ الاستخدام: .تحويل الى لقب العضو المبلغ", msg); return true; }
        const su = getUser(db, senderNumber);
        if (!su || !String(su.nickname || "").trim()) { await sendText(sock, jid, "❌ يجب تسجيل لقبك.", msg); return true; }
        const sb = Number(su.balance || 0);
        if (sb < amount) { await sendText(sock, jid, "╗════════⛔════════╔\n     لا تملك رصيد كافي للتحويل\n\n   رصيدك الحالي: `" + sb + "$`\n\n╝════════🚫════╚", msg); return true; }
        const found = findUserByNickname(db, targetNickname);
        if (!found) { await sendText(sock, jid, "❌ لم يتم العثور على اللقب: [" + targetNickname + "]", msg); return true; }
        if (found.number === senderNumber) { await sendText(sock, jid, "⚠️ لا يمكنك التحويل لنفسك.", msg); return true; }
        su.balance = sb - amount;
        found.user.balance = Number(found.user.balance || 0) + amount;
        saveDb();
        await sendText(sock, jid, "👑◈═══『 تحويل فلوس 』═══◈👑\nالمحول:[" + su.nickname + "]\n\nالمستلم: [" + targetNickname + "]\n\nالمبلغ: [" + amount + "$]\n\nجار تحويل المبلغ.......💱\n👑◈══════════════◈👑", msg);
        const rb = found.user.balance;
        setTimeout(async () => {
            const now = new Date().toLocaleString();
            const bankReceipt = "💰◈═══『 إشعار بنكي 』═══◈💰\n\n🏦 البنك:\n✅ تم تحويل رصيد ✅\n\n💰 المبلغ: [" + amount + "$]\n\n👤 من: [" + su.nickname + "]\n\n🪪 الى: [" + targetNickname + "]\n\n📅 التاريخ: [" + now + "]\n\n💳 الرصيد الحالي: [" + rb + "$]\n\n💰◈══════════◈🪙";
            for (const bj of Object.keys(db.bankGroups || {})) {
                if (!db.bankGroups[bj]) continue;
                await sock.sendMessage(bj, { text: bankReceipt }).catch(() => {});
            }
        }, 20000);
        return true;
    }
    return false;
}

async function handleDailyReward(sock, jid, msg, senderNumber, db, saveDb) {
    const user = getUser(db, senderNumber);
    if (!user || !String(user.nickname || "").trim()) { await sendText(sock, jid, getNoNicknameMessage(), msg); return true; }
    const now = Date.now();
    const cd = 12 * 60 * 60 * 1000;
    db.dailyData = db.dailyData || {};
    if (!db.dailyData[senderNumber]) db.dailyData[senderNumber] = { day: 0, lastClaim: 0 };
    const dd = db.dailyData[senderNumber];
    const last = Number(dd.lastClaim) || 0;
    const el = now - last;
    if (last > 0 && el < cd) {
        const nd = dd.day + 1;
        const nr = nd > 30 ? 10 : getNextReward(dd.day);
        await sendText(sock, jid, getCooldownMessage(cd - el, nr), msg);
        return true;
    }
    let cur = dd.day + 1;
    if (cur > 30) cur = 1;
    const reward = getDailyReward(cur);
    const next = getNextReward(cur);
    user.balance = Number(user.balance || 0) + reward;
    dd.day = cur; dd.lastClaim = now;
    db.dailyCooldown = db.dailyCooldown || {};
    db.dailyCooldown[senderNumber] = now;
    saveDb();
    await sendText(sock, jid, getDailyMessage(cur, reward, next), msg);
    return true;
}

async function handleGrantPermission(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    if (!owner) { await sendText(sock, jid, "⚠️ هذا الأمر للمطور فقط.", msg); return true; }
    const mentioned = getMentionedJid(msg);
    if (!mentioned) { await sendText(sock, jid, "⚠️ يرجى منشن الشخص.", msg); return true; }
    const target = cleanNumber(mentioned);
    db.chainPermissions = db.chainPermissions || [];
    if (!db.chainPermissions.includes(target)) {
        db.chainPermissions.push(target);
        saveDb();
        await sendText(sock, jid, "✅ تم منح صلاحية السلسلة للعضو @" + target, msg, { mentions: [mentioned] });
    } else {
        await sendText(sock, jid, "⚠️ العضو لديه الصلاحية بالفعل.", msg, { mentions: [mentioned] });
    }
    return true;
}

async function handleChainEdit(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    db.chainPermissions = db.chainPermissions || [];
    if (!(owner || db.chainPermissions.includes(senderNumber))) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية.", msg);
        return true;
    }
    const mentioned = getMentionedJid(msg);
    if (!mentioned) { await sendText(sock, jid, "⚠️ يرجى منشن الشخص وكتابة الأيام.", msg); return true; }
    const target = cleanNumber(mentioned);
    const dc = parsePositiveInteger(parts[parts.length - 1]);
    if (!dc || dc < 1 || dc > 30) { await sendText(sock, jid, "⚠️ عدد أيام غير صحيح (1-30).", msg); return true; }
    db.dailyData = db.dailyData || {};
    if (!db.dailyData[target]) db.dailyData[target] = { day: 0, lastClaim: 0 };
    db.dailyData[target].day = dc;
    saveDb();
    await sendText(sock, jid, "✅ تم تعديل سلسلة العضو @" + target + " إلى " + dc + " أيام.", msg, { mentions: [mentioned] });
    return true;
}

async function handleRouletteBet(sock, jid, msg, parts, senderNumber, db) {
    const casino = activeCasinos[jid];
    if (!casino || casino.started || casino.type !== "roulette") {
        await sendText(sock, jid, "⚠️ لا توجد فعالية روليت مفتوحة. اكتب .روليت لإنشائها.", msg);
        return true;
    }
    if (casino.bets && casino.bets[senderNumber]) {
        await sendText(sock, jid, "⚠️ لا يمكنك وضع رهان لأنك وضعت رهان بالفعل!", msg);
        return true;
    }
    const user = getUser(db, senderNumber);
    if (!user || !String(user.nickname || "").trim()) {
        await sendText(sock, jid, "❌ يجب تسجيل لقبك أولاً.", msg);
        return true;
    }
    const amount = parsePositiveInteger(parts[0]);
    if (!amount) { await sendText(sock, jid, "⚠️ مبلغ غير صحيح.", msg); return true; }
    const balance = Number(user.balance || 0);
    if (balance < amount) {
        await sendText(sock, jid, "╗════════⛔════════╔\n     لا تملك رصيد كافي للرهان\n\n   رصيدك الحالي: `" + balance + "$`\n\n╝════════🚫════╚", msg);
        return true;
    }
    const players = Object.keys(casino.bets || {});
    if (players.length >= 8) { await sendText(sock, jid, "⚠️ اكتمل العدد الأقصى (8 مقاعد).", msg); return true; }
    const fp = players[0];
    if (fp) {
        const fa = Number(casino.bets[fp]?.amount) || 0;
        if (amount < fa) { await sendText(sock, jid, "⚠️ يجب أن يكون الرهان ≥ " + fa + "$", msg); return true; }
    }
    casino.bets = casino.bets || {};
    casino.bets[senderNumber] = { nickname: user.nickname, amount, lives: 3, jid: userMention(senderNumber) };
    await sendText(sock, jid, "✅ تم وضع الرهان من قبل [" + user.nickname + "] ✅", msg);
    return true;
}

async function handleGamePause(sock, jid, msg, senderNumber, owner, db) {
    if (!(owner || hasPermission(senderNumber, "1", owner))) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية.", msg);
        return true;
    }
    const game = activeGames[jid];
    if (game && !game.gameEnded) {
        game.gameEnded = true;
        game.isPaused = true;
        try { game.stopGame?.(); } catch (e) {}
        await sendText(sock, jid, "⏸️ تم إيقاف الفعالية مؤقتاً.", msg);
        return true;
    }
    await sendText(sock, jid, "⚠️ لا توجد فعالية جارية.", msg);
    return true;
}

async function handleGameResume(sock, jid, msg, senderNumber, owner) {
    const game = activeGames[jid];
    if (game && game.isPaused) {
        game.isPaused = false;
        game.gameEnded = false;
        if (typeof game.sendNewChallenge === "function") {
            await sendText(sock, jid, "▶️ تم استئناف الفعالية!", msg);
            await game.sendNewChallenge();
        } else { await sendText(sock, jid, "⚠️ لا يمكن الاستئناف.", msg); }
        return true;
    }
    if (game && !game.gameEnded) { await sendText(sock, jid, "⚠️ الفعالية تعمل بالفعل.", msg); return true; }
    await sendText(sock, jid, "⚠️ لا توجد فعالية متوقفة.", msg);
    return true;
}

async function handleStopAllGames(sock, jid, msg, senderNumber, owner, db) {
    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    if (!(owner || db.gamePermissions.includes(senderNumber))) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية.", msg);
        return true;
    }
    stopAllGames(); stopAllCasinos();
    for (const j of Object.keys(activeSaraha || {})) { try { stopSarahaGame(j); } catch (e) {} }
    for (const j of Object.keys(activeColors || {})) { try { stopColorsGame(j); } catch (e) {} }
    for (const j of Object.keys(activeAnimals || {})) { try { stopAnimalsGame(j); } catch (e) {} }
    for (const j of Object.keys(activeMazads || {})) { try { activeMazads[j]?.stopMazad?.(); } catch (e) {} }
    try {
        for (const k of Object.keys(activeGames)) delete activeGames[k];
        for (const k of Object.keys(activeCasinos)) delete activeCasinos[k];
    } catch (e) {}
    await sendText(sock, jid, "◆⫘⫘⫘⫘🔑⫘⫘⫘⫘◆\n   تم ايقاف كل الالعاب والكازينو\n◆⫘⫘⫘⫘🔒⫘⫘⫘⫘◆", msg);
    return true;
}

async function handleReplies(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    if (!(owner || db.gamePermissions.includes(senderNumber))) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية.", msg);
        return true;
    }
    const action = String(parts[0] || "").toLowerCase();
    db.repliesEnabled = db.repliesEnabled || {};
    if (action === "on") {
        db.repliesEnabled[jid] = true; saveDb();
        try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}
        await sendText(sock, jid, "✅ تم تشغيل الردود.", msg);
    } else if (action === "off") {
        delete db.repliesEnabled[jid]; saveDb();
        try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}
        await sendText(sock, jid, "✅ تم إيقاف الردود.", msg);
    } else { await sendText(sock, jid, "⚠️ الاستخدام: .ردود on/off", msg); }
    return true;
}

async function handleAha(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    if (!(owner || db.gamePermissions.includes(senderNumber))) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية.", msg);
        return true;
    }
    const action = String(parts[0] || "").toLowerCase();
    db.ahaEnabled = db.ahaEnabled || {};
    if (action === "on") {
        db.ahaEnabled[jid] = true; saveDb();
        try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}
        await sendText(sock, jid, "✅ تم تشغيل أمر احا.", msg);
    } else if (action === "off") {
        delete db.ahaEnabled[jid]; saveDb();
        try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}
        await sendText(sock, jid, "✅ تم إيقاف أمر احا.", msg);
    } else { await sendText(sock, jid, "⚠️ الاستخدام: .احا on/off", msg); }
    return true;
}

async function handleQuiet(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    if (!(owner || db.gamePermissions.includes(senderNumber))) {
        await sendText(sock, jid, "⚠️ ليس لديك صلاحية.", msg);
        return true;
    }
    const action = String(parts[0] || "").toLowerCase();
    db.quietEnabled = db.quietEnabled || {};
    if (action === "on") {
        db.quietEnabled[jid] = true;
        db.quietTimer = db.quietTimer || {};
        db.quietTimer[jid] = { lastMessageTime: Date.now(), sent: false, interval: null };
        if (db.quietTimer[jid].interval) clearInterval(db.quietTimer[jid].interval);
        db.quietTimer[jid].interval = setInterval(async () => {
            const timer = db.quietTimer[jid];
            if (!timer) return;
            const now = Date.now();
            const el = now - timer.lastMessageTime;
            if (el > 10 * 60 * 1000 && !timer.sent) {
                timer.sent = true;
                try { await sock.sendMessage(jid, { text: "😶‍🌫️══════════════😶‍🌫️\nعمّ الهدوء في قروب المغوليين\n😶‍🌫️══════════════😶‍🌫️" }); } catch (e) {}
            }
            const ce = now - timer.lastMessageTime;
            if (ce < 10 * 60 * 1000 && timer.sent) timer.sent = false;
        }, 60000);
        saveDb();
        try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}
        await sendText(sock, jid, "✅ تم تشغيل وضع الهدوء.", msg);
    } else if (action === "off") {
        delete db.quietEnabled[jid];
        if (db.quietTimer?.[jid]?.interval) clearInterval(db.quietTimer[jid].interval);
        delete db.quietTimer[jid];
        saveDb();
        try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}
        await sendText(sock, jid, "✅ تم إيقاف وضع الهدوء.", msg);
    } else { await sendText(sock, jid, "⚠️ الاستخدام: .هدوء on/off", msg); }
    return true;
}

async function handleOrganize(sock, jid, msg, parts, senderNumber, owner, db, saveDb) {
    if (!owner) { await sendText(sock, jid, "⚠️ هذا الأمر للمطور فقط.", msg); return true; }
    const action = String(parts[0] || "").toLowerCase();
    db.organizedGroups = db.organizedGroups || {};
    if (action === "on") {
        db.organizedGroups[jid] = true; saveDb();
        await sendText(sock, jid, "✅ تم تفعيل مراقبة المغادرين.", msg);
    } else if (action === "off") {
        delete db.organizedGroups[jid]; saveDb();
        await sendText(sock, jid, "❌ تم إيقاف مراقبة المغادرين.", msg);
    } else { await sendText(sock, jid, "⚠️ الاستخدام: .تنظيم on/off", msg); }
    return true;
}

async function handleCommand(sock, jid, msg, context = {}) {
    const db = context.db || getDb();
    const text = context.text || getMessageText(msg);

    // ⭐ تحويل النصوص الكاملة إلى أوامر فعاليات
    let effectiveText = text;
    const gameCmd = normalizeGameCommand(text);

    if (gameCmd) {
        if (!text.startsWith(".")) {
            effectiveText = "." + gameCmd;
        } else {
            const withoutDot = text.slice(1).trim();
            const innerCmd = normalizeGameCommand(withoutDot);
            if (innerCmd && innerCmd !== withoutDot) {
                effectiveText = "." + innerCmd;
            }
        }
    }

    const normalizedCommand = getNormalizedCommand(effectiveText);
    let finalText = effectiveText;
    if (normalizedCommand && normalizedCommand !== effectiveText) finalText = normalizedCommand;
    const parsed = getCommand(finalText);
    if (!parsed) return false;

    const { command, parts } = parsed;
    const sender = context.sender || getSender(msg, sock);
    const senderNumber = context.cleanSender || cleanNumber(jidToNumber(sender));
    const group = context.isGroup ?? isGroupJid(jid);
    const owner = context.isBotOwner ?? isOwner(senderNumber, sock, msg);

    if (finalText.trim().toLowerCase() === ".stop everything") return handleEmergencyStop(sock, jid, msg, owner);

    if (isGameCommand(command) || command === "بوت" || command === "اشرافه" || command === "اشراف" ||
        command === "استقبال" || command === "ورك" || command === "work" ||
        command === "طرف" || command === "سحب") {
        if (!group) {
            await sendText(sock, jid, "يرجى مشاركة الفعالية في مملكة الجاسات.", msg);
            return true;
        }
        if (isGameCommand(command) && !await checkGameContext(sock, jid, msg, group)) return true;
    }

    const adminCommands = new Set(["سماح", "صلاحيات", "بوت", "اشرافه", "اشراف", "استقبال", "ورك", "work", "طرف", "سحب"]);
    if (adminCommands.has(command)) {
        const handled = await handleAdminCommand(sock, jid, msg, command, parts, senderNumber, sender, db, saveDb, owner, group, (u, l) => hasPermission(u, l, owner));
        return handled !== false;
    }

    if (command === "ads") {
        if (!owner) return true;
        const action = String(parts[0] || "").toLowerCase();
        db.adsGroups = db.adsGroups || {};
        if (action === "on") { db.adsGroups[jid] = true; saveDb(); await sendText(sock, jid, "✅ تم تفعيل الإعلانات.", msg); }
        else if (action === "off") { delete db.adsGroups[jid]; saveDb(); await sendText(sock, jid, "❌ تم إيقاف الإعلانات.", msg); }
        else { await sendText(sock, jid, "⚠️ الاستخدام: .ads on/off", msg); }
        return true;
    }

    if (command === "البنك") {
        if (!owner) return true;
        const action = String(parts[0] || "").toLowerCase();
        db.bankGroups = db.bankGroups || {};
        if (action === "on") { db.bankGroups[jid] = true; saveDb(); await sendText(sock, jid, "╗════════✅════════╔\n  تم حفظ هذا القروب بأسم البنك \n╝════════✅════╚", msg); }
        else if (action === "off") { delete db.bankGroups[jid]; saveDb(); await sendText(sock, jid, "╗════════⛔════════╔\n  تم ايقاف حفظ هذا القروب بأسم البنك \n╝════════🚫════╚", msg); }
        else { await sendText(sock, jid, "⚠️ الاستخدام: .البنك on/off", msg); }
        return true;
    }

    if (command === "تنظيم") return handleOrganize(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    if (command === "العاب") return handleGamesList(sock, jid, msg, senderNumber);
    if (command === "تفكيك" || command === "كتابة" || command === "اعلام" || command === "ايموجي") {
        await handleGameCommand(sock, jid, msg, command, senderNumber, sender, db, saveDb, owner);
        return true;
    }
    if (command === "كازينو") return handleCasinoMenu(sock, jid, msg);
    if (command === "روليت") { await startRoulette(sock, jid, msg, senderNumber, sender, db, saveDb, owner); return true; }
    if (command === "الكرستال" || command === "كريستال") { await startCrystal(sock, jid, msg, senderNumber, sender, db, saveDb, owner, parts); return true; }
    if (command === "رهان") return handleRouletteBet(sock, jid, msg, parts, senderNumber, db);
    if (command === "بدأ" || command === "بدأ_الرهان" || command === "بدل_الرهان") {
        if (command === "بدأ" && parts[0]?.toLowerCase() !== "الرهان" && !activeCasinos[jid]) return false;
        return handleRouletteStart(sock, jid, msg, senderNumber, owner, db);
    }
    if (command === "انسحاب") {
        const casino = activeCasinos[jid];
        if (!casino) { await sendText(sock, jid, "⚠️ لا يوجد كازينو نشط.", msg); return true; }
        if (casino.creator !== senderNumber && !owner) { await sendText(sock, jid, "⚠️ منشئ الفعالية فقط.", msg); return true; }
        try { casino.stopGame?.(); } catch (e) {}
        delete activeCasinos[jid];
        await sendText(sock, jid, "🚫 تم إلغاء فعالية الكازينو.", msg);
        return true;
    }
    if (command === "ايقاف") return handleGamePause(sock, jid, msg, senderNumber, owner, db);
    if (command === "كمل") return handleGameResume(sock, jid, msg, senderNumber, owner);
    if (command === "وقف") return handleStopAllGames(sock, jid, msg, senderNumber, owner, db);
    if (command === "القاب") return handleTitles(sock, jid, msg, db);
    if (command === "سجل") return handleRegister(sock, jid, msg, parts, senderNumber, owner, db);
    if (command === "حذف") return handleDeleteTitle(sock, jid, msg, parts, senderNumber, owner, db);
    if (command === "علاقة") return handleFriendRelation(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    if (command === "رتبته") return handleRank(sock, jid, msg, parts, senderNumber, owner, db);
    if (command === "تفاعله") return handleInteraction(sock, jid, msg, parts, senderNumber, owner, db);
    if (command === "تفاصيلي") return handleMyDetails(sock, jid, msg, senderNumber, db);
    if (command === "تفاصيله") return handleUserDetails(sock, jid, msg, db);
    if (command === "رصيد") return handleDeposit(sock, jid, msg, parts, senderNumber, owner, db);
    if (command === "تحويل") return handleTransfer(sock, jid, msg, parts, senderNumber, db);
    if (command === "المطور") { await sendText(sock, jid, "👨‍💻 البوت يعمل بكامل نظامه!", msg); return true; }
    if (command === "هدية") return handleDailyReward(sock, jid, msg, senderNumber, db, saveDb);
    if (command === "اذن") return handleGrantPermission(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    if (command === "سلسلة") return handleChainEdit(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    if (command === "ردود") return handleReplies(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    if (command === "احا") return handleAha(sock, jid, msg, parts, senderNumber, owner, db, saveDb);
    if (command === "هدوء") return handleQuiet(sock, jid, msg, parts, senderNumber, owner, db, saveDb);

    return false;
}

function getGlobalGameBlockUntil() { return globalGameBlockUntil; }
function setGlobalGameBlockUntil(t) { globalGameBlockUntil = Number(t) || 0; }
function isGamesBlocked() { return Date.now() < globalGameBlockUntil; }

module.exports = {
    handleCommand,
    getMessageText,
    getCommand,
    isGameCommand,
    stopAllGames,
    stopAllCasinos,
    getGlobalGameBlockUntil,
    setGlobalGameBlockUntil,
    isGamesBlocked,
    findUserByNickname,
    findUserByNicknameForFriend,
    isSimilarNickname,
    getNormalizedCommand,
    normalizeGameCommand
};
