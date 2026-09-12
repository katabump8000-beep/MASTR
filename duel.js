// duel.js
// ============================================================
// أنظمة الكازينو: الروليت + الكريستال (معدل)
// ============================================================

"use strict";

// ============================================================
// الحالة النشطة للكازينو
// ============================================================

const activeCasinos = Object.create(null);

// ============================================================
// إعدادات عامة
// ============================================================

const CRYSTAL_PLAYER_COOLDOWN = 5 * 60 * 1000; // 5 دقائق للاعب نفسه
const CRYSTAL_GROUP_COOLDOWN = 30 * 1000; // 30 ثانية للمجموعة
const MIN_BET = 1;
const MAX_BET = 500;
const MAX_ROULETTE_PLAYERS = 20;
const ROULETTE_COOLDOWN = 10 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/\D/g, "");
}

function getUser(db, jid) {
    if (!db || !db.users) return null;
    return db.users[jid] || null;
}

function getBalance(db, jid) {
    const user = getUser(db, jid);
    const balance = Number(user?.balance);
    return Number.isFinite(balance) && balance >= 0 ? balance : 0;
}

function hasNickname(db, jid) {
    const user = getUser(db, jid);
    return Boolean(user && String(user.nickname || "").trim());
}

function ensureUser(db, jid) {
    db.users = db.users || {};

    if (!db.users[jid] || typeof db.users[jid] !== "object") {
        db.users[jid] = {
            nickname: "",
            balance: 0,
            rank: "",
            maxInteraction: 0
        };
    }

    if (!Number.isFinite(Number(db.users[jid].balance))) {
        db.users[jid].balance = 0;
    }

    if (typeof db.users[jid].nickname !== "string") {
        db.users[jid].nickname = "";
    }

    return db.users[jid];
}

function parseBet(parts) {
    if (!Array.isArray(parts) || !parts.length) return 0;

    const raw = String(parts[0]).replace(/[,$]/g, "").trim();
    const amount = Number(raw);

    if (!Number.isFinite(amount) || amount <= 0) return 0;

    return Math.floor(amount);
}

// ============================================================
// التحقق من وجود لعبة صراحة نشطة
// ============================================================

function isSarahaActive(jid) {
    try {
        const { activeSaraha } = require("./saraha");
        return Boolean(activeSaraha[jid] && activeSaraha[jid].isActive);
    } catch {
        return false;
    }
}

// ============================================================
// الرموز العشوائية للتعديل في الروليت
// ============================================================

const RANDOM_EMOJIS = ["🔴", "🔵", "🟠", "🟡", "🟤", "🟣", "🟢", "⚫"];

function getRandomEmoji() {
    return RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)];
}

// ============================================================
// الكريستال - الأنماط والنسب
// ============================================================

const CRYSTAL_PATTERNS = [
    // أرباح
    { pattern: ["♦️","♦️","♦️","♦️"], result: "win", multiplier: 2, weight: 5 },
    { pattern: ["⭐","⭐","⭐","⭐"], result: "win", multiplier: 1.3, weight: 9 },
    { pattern: ["💎","💎","💎","♦️"], result: "win", multiplier: 2.3, weight: 3 },
    { pattern: ["♦️","⭐","⭐","⭐"], result: "win", multiplier: 1.5, weight: 8 },
    { pattern: ["💎","♦️","💎","⭐"], result: "win", multiplier: 2, weight: 4 },
    // أرباح نادرة
    { pattern: ["💎","💎","💎","💎"], result: "win", multiplier: 3, weight: 5 },
    // جائزة كبرى
    { pattern: ["💠","💠","💠","💠"], result: "win", multiplier: 5, weight: 0.8 },
    // خسائر (39%)
    { pattern: ["💣","💣","💣","💣"], result: "lose", weight: 6.5 },
    { pattern: ["⭐","💣","💣","💣"], result: "lose", weight: 6.5 },
    { pattern: ["💣","♦️","⭐","💣"], result: "lose", weight: 6.5 },
    { pattern: ["💣","♦️","💣","💣"], result: "lose", weight: 6.5 },
    { pattern: ["💣","💣","💎","💣"], result: "lose", weight: 6.5 },
    { pattern: ["♦️","⭐","💣","💣"], result: "lose", weight: 6.5 },
    // إعادة (المتبقي)
    { pattern: ["♦️","⭐","💎","💣"], result: "retry", weight: 5 },
    { pattern: ["💠","♦️","⭐","💣"], result: "retry", weight: 5 }
];

// حساب المجموع الكلي للأوزان
const TOTAL_WEIGHT = CRYSTAL_PATTERNS.reduce((sum, p) => sum + p.weight, 0);

function getWeightedCrystalPattern() {
    const rand = Math.random() * TOTAL_WEIGHT;
    let cumulative = 0;
    
    for (const pattern of CRYSTAL_PATTERNS) {
        cumulative += pattern.weight;
        if (rand <= cumulative) {
            return pattern;
        }
    }
    
    return CRYSTAL_PATTERNS[0];
}

function generateCrystalCombo() {
    const patternObj = getWeightedCrystalPattern();
    return {
        combo: [...patternObj.pattern],
        result: patternObj.result,
        multiplier: patternObj.multiplier || 0
    };
}

function checkCrystalResult(combo) {
    if (!Array.isArray(combo) || combo.length !== 4) {
        return { result: "retry" };
    }

    for (const pattern of CRYSTAL_PATTERNS) {
        if (combo.every((val, idx) => val === pattern.pattern[idx])) {
            return { result: pattern.result, multiplier: pattern.multiplier || 0 };
        }
    }

    return { result: "retry" };
}

// ============================================================
// تنسيق شاشة الكريستال
// ============================================================

function crystalDisplay(combo, betAmount = null) {
    if (!Array.isArray(combo) || combo.length !== 4) {
        return `*❉▬▬▬▬🎰▬▬▬▬❉*
  💎    💎    💎    💎
*✥▬▬▬▬🎰▬▬▬▬✥*`;
    }
    
    let header = betAmount ? `*الرهان:* \`${betAmount}$\`\n` : "";
    header += `*❉▬▬▬▬🎰▬▬▬▬❉*`;
    
    return `${header}
  ${combo[0]}    ${combo[1]}    ${combo[2]}    ${combo[3]}
*✥▬▬▬▬🎰▬▬▬▬✥*`;
}

function crystalGameBlocked() {
    return `*❉▬▬▬▬▬⚠️▬▬▬▬▬❉*
   *عذرا هناك العاب أخرى تجري*
*✥▬▬▬▬▬⛔▬▬▬▬▬✥*`;
}

// ============================================================
// إرسال إعلان الفوز (استخدام اللقب بدلاً من المنشن)
// ============================================================

async function sendCrystalWinAd(sock, db, cleanSender, sender, amount) {
    if (!db.adsGroups || typeof db.adsGroups !== "object") return;

    const date = new Date();
    const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

    const startTimeFormatted = `${days[date.getDay()]} | ${date.getDate()} | ${months[date.getMonth()]}`;

    // ⭐ استخدام اللقب
    const winnerUser = db.users?.[cleanSender];
    const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || cleanSender;

    const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{كريستال}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${amount}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇⏰ بّـــــــدأت:
*{${startTimeFormatted}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

    for (const adJid of Object.keys(db.adsGroups)) {
        if (!db.adsGroups[adJid]) continue;
        await safeSend(sock, adJid, {
            text: adMessage
            // ⭐ لا mentions
        });
    }
}

// ============================================================
// إرسال إعلان الخسارة (استخدام اللقب)
// ============================================================

async function sendCrystalLossAd(sock, db, cleanSender, sender, amount) {
    if (!db.adsGroups || typeof db.adsGroups !== "object") return;

    // ⭐ استخدام اللقب
    const loserUser = db.users?.[cleanSender];
    const loserNickname = (loserUser && String(loserUser.nickname || "").trim()) || cleanSender;

    const lossMessage = `╗══════💔══════╔
اللاعب *${loserNickname}* خسر في
لعبة الكرستال بمبلغ يبلغ قيمته:
﴿ ${amount} ﴾
╝══════💔══════╚`;

    for (const adJid of Object.keys(db.adsGroups)) {
        if (!db.adsGroups[adJid]) continue;
        await safeSend(sock, adJid, {
            text: lossMessage
        });
    }
}

// ============================================================
// تشغيل دوران الكريستال
// ============================================================

async function spinCrystal(sock, jid, msgId, betAmount) {
    const rounds = 6;
    let finalCombo = null;
    let finalResult = null;

    for (let i = 0; i < rounds; i++) {
        await sleep(700);

        const patternObj = getWeightedCrystalPattern();
        const combo = patternObj.pattern;

        await safeSend(sock, jid, {
            text: crystalDisplay(combo, betAmount),
            edit: msgId
        });

        if (i === rounds - 1) {
            finalCombo = combo;
            finalResult = patternObj;
        }
    }

    return {
        combo: finalCombo,
        result: finalResult ? {
            result: finalResult.result,
            multiplier: finalResult.multiplier || 0
        } : { result: "retry" }
    };
}

// ============================================================
// بدء الكريستال
// ============================================================

async function startCrystal(
    sock,
    jid,
    msg,
    cleanSender,
    sender,
    db,
    saveDb,
    isBotOwner,
    parts
) {
    try {
        if (isSarahaActive(jid)) {
            await safeSend(sock, jid, {
                text: "⚠️ لا يمكن بدء الكريستال أثناء وجود لعبة صراحة نشطة."
            }, { quoted: msg });
            return false;
        }

        const senderNumber = cleanNumber(cleanSender);
        if (!senderNumber) {
            await safeSend(sock, jid, {
                text: "❌ حدث خطأ في التعرف على رقمك."
            }, { quoted: msg });
            return false;
        }

        db.users = db.users || {};
        db.crystalCooldown = db.crystalCooldown || {};
        db.crystalPlayerCooldown = db.crystalPlayerCooldown || {};

        if (activeCasinos[jid]) {
            await safeSend(sock, jid, {
                text: crystalGameBlocked()
            }, { quoted: msg });
            return false;
        }

        if (!hasNickname(db, senderNumber)) {
            await safeSend(sock, jid, {
                text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل لتتمكن من اللعب."
            }, { quoted: msg });
            return false;
        }

        const betAmount = parseBet(parts);
        if (betAmount < MIN_BET) {
            await safeSend(sock, jid, {
                text: `⚠️ يرجى تحديد مبلغ صحيح، مثل: .الكرستال 50 (الحد الأدنى: ${MIN_BET}$)`
            }, { quoted: msg });
            return false;
        }

        if (betAmount > MAX_BET) {
            await safeSend(sock, jid, {
                text: `⚠️ الحد الأقصى للرهان هو ${MAX_BET}$. يرجى تحديد مبلغ أقل.`
            }, { quoted: msg });
            return false;
        }

        const balance = getBalance(db, senderNumber);
        if (balance < betAmount) {
            await safeSend(sock, jid, {
                text: `⚠️ رصيدك غير كافي. رصيدك الحالي: ${balance}$`
            }, { quoted: msg });
            return false;
        }

        const now = Date.now();

        const lastPlayerGame = Number(db.crystalPlayerCooldown[senderNumber]) || 0;
        const playerElapsed = now - lastPlayerGame;

        if (lastPlayerGame > 0 && playerElapsed < CRYSTAL_PLAYER_COOLDOWN) {
            const remainingMin = Math.ceil((CRYSTAL_PLAYER_COOLDOWN - playerElapsed) / 60000);
            await safeSend(sock, jid, {
                text: `⏳ يرجى الانتظار ${remainingMin} دقائق قبل بدء فعالية جديدة (كوولدوان خاص بك).`
            }, { quoted: msg });
            return false;
        }

        const lastGroupGame = Number(db.crystalCooldown[jid]) || 0;
        const groupElapsed = now - lastGroupGame;

        if (lastGroupGame > 0 && groupElapsed < CRYSTAL_GROUP_COOLDOWN) {
            const remainingSec = Math.ceil((CRYSTAL_GROUP_COOLDOWN - groupElapsed) / 1000);
            await safeSend(sock, jid, {
                text: `⏳ يرجى الانتظار ${remainingSec} ثوانٍ قبل بدء فعالية جديدة (كوولدوان المجموعة).`
            }, { quoted: msg });
            return false;
        }

        const user = ensureUser(db, senderNumber);
        user.balance = Number(user.balance) || 0;

        if (user.balance < betAmount) {
            await safeSend(sock, jid, {
                text: `⚠️ رصيدك غير كافي. رصيدك الحالي: ${user.balance}$`
            }, { quoted: msg });
            return false;
        }

        user.balance -= betAmount;
        
        db.crystalPlayerCooldown[senderNumber] = now;
        db.crystalCooldown[jid] = now;
        saveDb();

        const firstPattern = getWeightedCrystalPattern();
        const firstCombo = firstPattern.pattern;
        const startMessage = crystalDisplay(firstCombo, betAmount);

        const sent = await sock.sendMessage(jid, { text: startMessage });

        if (!sent || !sent.key) {
            user.balance += betAmount;
            saveDb();
            await safeSend(sock, jid, {
                text: "❌ حدث خطأ في بدء اللعبة. تم إرجاع رهانك."
            }, { quoted: msg });
            return false;
        }

        const msgId = sent.key;

        const round = await spinCrystal(sock, jid, msgId, betAmount);
        const finalCombo = round.combo;
        const finalResult = round.result;

        if (finalResult.result === "win") {
            const multiplier = Number(finalResult.multiplier) || 1;
            const winAmount = Math.max(0, Math.round(betAmount * multiplier));

            user.balance += winAmount;
            saveDb();

            const resultMessage = `${crystalDisplay(finalCombo, betAmount)}

🎉 *ربحت!* 🎉
💰 المبلغ: ${winAmount}$ (×${multiplier})`;

            await safeSend(sock, jid, {
                text: resultMessage,
                edit: msgId
            });

            await sendCrystalWinAd(sock, db, senderNumber, sender, winAmount);

            return true;
        }

        if (finalResult.result === "lose") {
            saveDb();

            const resultMessage = `${crystalDisplay(finalCombo, betAmount)}

💔 *خسرت!* 💔
💰 تم خصم: ${betAmount}$`;

            await safeSend(sock, jid, {
                text: resultMessage,
                edit: msgId
            });

            await sendCrystalLossAd(sock, db, senderNumber, sender, betAmount);

            return true;
        }

        user.balance += betAmount;
        saveDb();

        const retryResult = `${crystalDisplay(finalCombo, betAmount)}

🔃 لا يوجد خسارة او ربح 🔃
💰 تم إرجاع المبلغ: ${betAmount}$`;

        await safeSend(sock, jid, {
            text: retryResult,
            edit: msgId
        });

        return true;

    } catch (error) {
        console.error("❌ خطأ في startCrystal:", error?.message || error);
        return false;
    }
}

// ============================================================
// الروليت - بدء
// ============================================================

async function startRoulette(sock, jid, msg, cleanSender, sender, db, saveDb, isBotOwner) {
    if (isSarahaActive(jid)) {
        await safeSend(sock, jid, {
            text: "⚠️ لا يمكن بدء الروليت أثناء وجود لعبة صراحة نشطة."
        }, { quoted: msg });
        return false;
    }

    const senderNumber = cleanNumber(cleanSender);
    if (!senderNumber) {
        await safeSend(sock, jid, {
            text: "❌ حدث خطأ في التعرف على رقمك."
        }, { quoted: msg });
        return false;
    }

    const now = Date.now();
    db.rouletteCooldown = db.rouletteCooldown || {};
    const lastRoulette = Number(db.rouletteCooldown[jid]) || 0;

    if (lastRoulette > 0 && (now - lastRoulette) < ROULETTE_COOLDOWN) {
        const remainingMin = Math.ceil((ROULETTE_COOLDOWN - (now - lastRoulette)) / 60000);
        await safeSend(sock, jid, {
            text: `⏳ يرجى الانتظار ${remainingMin} دقائق قبل بدء فعالية روليت جديدة.`
        }, { quoted: msg });
        return false;
    }

    if (activeCasinos[jid]) {
        await safeSend(sock, jid, {
            text: "⚠️ هناك فعالية كازينو قيد الإعداد أو قائمة بالفعل في هذه المجموعة!"
        }, { quoted: msg });
        return false;
    }

    db.users = db.users || {};

    if (!hasNickname(db, senderNumber)) {
        await safeSend(sock, jid, {
            text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل لتتمكن من إنشاء أو المشاركة في الكازينو."
        }, { quoted: msg });
        return false;
    }

    const user = getUser(db, senderNumber);
    activeCasinos[jid] = {
        creator: senderNumber,
        creatorJid: sender,
        creatorNickname: user?.nickname || "",
        bets: {},
        started: false,
        playersMsgId: null,
        gameMsgId: null,
        resultMsgId: null,
        type: "roulette",
        startTime: Date.now(),
        allowOthersToStart: false,
        maxPlayers: MAX_ROULETTE_PLAYERS,
        stopGame: null
    };

    const casinoIntro = `╮─❖『 الرهانات 』❖─╭

شرح الفعالية:

فعالية تعتمد على الحظ، إما تربح أو تخسر 🎲

يجب أن يمتلك المشارك رصيدًا ويضع رهانًا.

بعد وضع أول رهان، ينتظر صاحب رهان آخر بنفس القيمة أو أعلى بشرط ألا يتجاوز رصيد صاحب الفعالية.

كل شخص يملك 🎈🎈🎈 بالونات بحيث إذا وقع الحظ عليه ستفقع البالونة 💥 وعندما تفقع كل بالوناته يخسر رهانه، لكن إذا صمدت بالوناته يربح.

مثال:
ناغي كتب .رهان 100
يجب أن يضع شخص آخر 100 أو أكثر بدون تجاوز الحد.

بعد اكتمال الرهانات، يختار منشئ الفعالية:

.بدأ الرهان ➜ تبدأ اللعبة.

.انسحاب ➜ تلغى الفعالية.

يمكن مشاركة أكثر من ${MAX_ROULETTE_PLAYERS} أشخاص.

الفائز يحصل على مجموع كل الرهانات.

يفضل تجربة رهان 5$ أولًا لفهم اللعبة قبل الرهانات الكبيرة.

╰─❖『 بالتوفيق 🍀 』❖─╯`;

    await safeSend(sock, jid, {
        text: casinoIntro
    }, { quoted: msg });

    return true;
}

// ============================================================
// بناء قائمة المشاركين في الروليت (3 بالونات)
// ============================================================

function buildRoulettePlayersList(casino) {
    const players = Object.keys(casino.bets || {});
    let text = "╗══════المشاركون══════╔\n";

    const activePlayers = [];
    const eliminatedPlayers = [];

    for (const number of players) {
        const player = casino.bets[number];
        const lives = Number(player.lives) || 0;
        if (lives <= 0) {
            eliminatedPlayers.push({ number, player });
        } else {
            activePlayers.push({ number, player });
        }
    }

    let index = 0;
    
    for (const { number, player } of activePlayers) {
        const lives = Number(player.lives) || 3;
        // ⭐ 3 بالونات
        const display = lives >= 3 ? "🎈🎈🎈"
            : lives === 2 ? "🎈🎈💥"
            : lives === 1 ? "🎈💥💥"
            : "☠️☠️☠️";
        
        text += `${index + 1}. \`${player.nickname}\` ${display}\n`;
        index++;
    }

    for (const { number, player } of eliminatedPlayers) {
        text += `${index + 1}. \`${player.nickname}\` ☠️☠️☠️\n`;
        index++;
    }

    for (let i = index; i < 8; i++) {
        text += `${i + 1}. [مقعد فارغ]\n`;
    }

    text += "╝═════════════════╚";
    return text;
}

// ============================================================
// رسائل الدبوس
// ============================================================

function getRouletteDropMessage(nickname, emoji) {
    return `╗═════════🔪═════════╔
ًسًــــيــــنزل الدبــ📍ــوس على بالــ🎈ـون:
        ${emoji} \`${nickname}\` ${emoji}
╝═════════🎰═════════╚`;
}

function getRouletteResultMessage(nickname, emoji) {
    return `╗═════════🔪═════════╔
  نـــزل الدبــ📍ــوس على بالــ🎈ـون:
        ${emoji} \`${nickname}\` ${emoji}
╝═════════🎰═════════╚`;
}

function getRouletteDefaultMessage(emoji) {
    return `╗═════════🔪═════════╔
ًسًــــيــــنزل الدبــ📍ــوس على بالــ🎈ـون:
        ${emoji} \`لم يحدد بعد\` ${emoji}
╝═════════🎰═════════╚`;
}

// ============================================================
// تشغيل جولة الروليت
// ============================================================

function createRouletteRunner(sock, jid, casino, db) {
    const playersKeys = Object.keys(casino.bets || {});
    let activePlayers = [...playersKeys];
    let running = true;

    const stopRunner = () => {
        running = false;
    };

    const runRound = async () => {
        if (!running) return;

        if (activePlayers.length <= 1) {
            const winnerKey = activePlayers[0];
            if (!winnerKey) {
                delete activeCasinos[jid];
                return;
            }

            const winner = casino.bets[winnerKey];
            let pool = 0;

            for (const key of playersKeys) {
                pool += Number(casino.bets[key]?.amount) || 0;
            }

            const winnerUser = ensureUser(db, winnerKey);
            winnerUser.balance = Number(winnerUser.balance || 0) + pool;
            saveDb();

            try {
                await sock.groupSettingUpdate(jid, "not_announcement");
            } catch (_) {}

            const winnerEmoji = getRandomEmoji();
            if (casino.resultMsgId) {
                await sock.sendMessage(jid, {
                    text: getRouletteResultMessage(winner.nickname, winnerEmoji),
                    edit: casino.resultMsgId
                }).catch(() => {});
            }

            await safeSend(sock, jid, {
                text: `╗═════════════════╔
تم اضافة مجموع الرهان الكامل:
               [\`${pool}$\`]
الى رصيد [${winner.nickname}] بنجاح ✅
╝═════════════════╝`
            });

            const date = new Date();
            const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
            const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

            const dateText = `${days[date.getDay()]} | ${date.getDate()} | ${months[date.getMonth()]}`;

            // ⭐ إعلان فوز الروليت باللقب
            const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || winnerKey;

            const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{كازينو - روليت}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${pool}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇⏰ بّـــــــدأت:
*{${dateText}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

            for (const adJid of Object.keys(db.adsGroups || {})) {
                if (!db.adsGroups[adJid]) continue;
                await sock.sendMessage(adJid, {
                    text: adMessage
                    // ⭐ لا mentions
                }).catch(() => {});
            }

            db.rouletteCooldown = db.rouletteCooldown || {};
            db.rouletteCooldown[jid] = Date.now();
            saveDb();

            delete activeCasinos[jid];
            return;
        }

        const loserIndex = Math.floor(Math.random() * activePlayers.length);
        const loserKey = activePlayers[loserIndex];
        const loser = casino.bets[loserKey];

        if (!loser) {
            activePlayers = activePlayers.filter(key => key !== loserKey);
            setTimeout(runRound, 1000);
            return;
        }

        // ⭐ 8 دورات بدلاً من 12 + 900ms بدلاً من 500ms
        for (let i = 0; i < 8; i++) {
            if (!running) return;

            const randomKey = activePlayers[Math.floor(Math.random() * activePlayers.length)];
            const randomPlayer = casino.bets[randomKey];
            const randomEmoji = getRandomEmoji();

            if (casino.gameMsgId && randomPlayer) {
                await sock.sendMessage(jid, {
                    text: getRouletteDropMessage(randomPlayer.nickname, randomEmoji),
                    edit: casino.gameMsgId
                }).catch(() => {});
            }

            await sleep(900);
        }

        if (!running) return;

        const resultEmoji = getRandomEmoji();
        if (casino.resultMsgId) {
            await sock.sendMessage(jid, {
                text: getRouletteResultMessage(loser.nickname, resultEmoji),
                edit: casino.resultMsgId
            }).catch(() => {});
        }

        loser.lives = Math.max(0, Number(loser.lives || 0) - 1);

        await sock.sendMessage(jid, {
            text: buildRoulettePlayersList(casino),
            edit: casino.playersMsgId
        }).catch(() => {});

        if (loser.lives <= 0) {
            activePlayers = activePlayers.filter(key => key !== loserKey);
            await safeSend(sock, jid, {
                text: `تم استبعاد المدعو [${loser.nickname}] وسيتم خصم الرهان الذي وضعه من رصيده 🏳`
            });
        }

        const defaultEmoji = getRandomEmoji();
        if (casino.gameMsgId) {
            await sock.sendMessage(jid, {
                text: getRouletteDefaultMessage(defaultEmoji),
                edit: casino.gameMsgId
            }).catch(() => {});
        }

        if (!running) return;
        setTimeout(runRound, 4000);
    };

    return { runRound, stopRunner };
}

// ============================================================
// بدء الروليت
// ============================================================

async function handleRouletteStart(sock, jid, msg, senderNumber, owner, db) {
    const casino = activeCasinos[jid];

    if (!casino || casino.started || casino.type !== "roulette") {
        return true;
    }

    const players = Object.keys(casino.bets || {});
    if (players.length < 3) {
        await safeSend(sock, jid, {
            text: "⚠️ يجب أن يكون هناك 3 مشاركين على الأقل لبدء الفعالية."
        }, { quoted: msg });
        return true;
    }

    const canStart = casino.creator === senderNumber ||
        owner ||
        (Date.now() - Number(casino.startTime || 0)) > 5 * 60 * 1000;

    if (!canStart) {
        await safeSend(sock, jid, {
            text: "⚠️ منشئ الروليت فقط يمكنه بدء الرهان، أو انتظر 5 دقائق."
        }, { quoted: msg });
        return true;
    }

    for (const number of players) {
        const player = casino.bets[number];
        const user = getUser(db, number);

        if (!user || Number(user.balance || 0) < Number(player.amount || 0)) {
            await safeSend(
                sock,
                jid,
                `⚠️ لا يمكن بدء الروليت لأن رصيد أحد المشاركين لم يعد كافياً: [${player.nickname}]`,
                msg
            );
            return true;
        }
    }

    casino.started = true;

    try {
        await sock.groupSettingUpdate(jid, "announcement");
    } catch (_) {}

    for (const number of players) {
        const player = casino.bets[number];
        const user = ensureUser(db, number);
        user.balance -= Number(player.amount);
    }
    saveDb();

    const playersMsg = await sock.sendMessage(jid, {
        text: buildRoulettePlayersList(casino)
    });
    casino.playersMsgId = playersMsg?.key || null;

    const defaultEmoji = getRandomEmoji();
    const gameMsg = await sock.sendMessage(jid, {
        text: getRouletteDefaultMessage(defaultEmoji)
    });
    casino.gameMsgId = gameMsg?.key || null;

    const resultEmoji = getRandomEmoji();
    const resultMsg = await sock.sendMessage(jid, {
        text: getRouletteDefaultMessage(resultEmoji)
    });
    casino.resultMsgId = resultMsg?.key || null;

    const runner = createRouletteRunner(sock, jid, casino, db);
    casino.stopGame = runner.stopRunner;

    // ⭐ 3 ثواني بدلاً من 2
    setTimeout(runner.runRound, 3000);
    return true;
}

// ============================================================
// تنظيف جلسات الكازينو
// ============================================================

function removeCasino(jid) {
    if (!jid) return false;

    const casino = activeCasinos[jid];
    if (casino) {
        try {
            if (typeof casino.stopGame === "function") {
                casino.stopGame();
            }
        } catch (_) {}
    }

    delete activeCasinos[jid];
    return true;
}

// ============================================================
// التصدير
// ============================================================

module.exports = {
    activeCasinos,
    startRoulette,
    startCrystal,
    handleRouletteStart,
    generateCrystalCombo,
    checkCrystalResult,
    removeCasino,
    crystalDisplay,
    crystalGameBlocked,
    buildRoulettePlayersList,
    getRouletteDropMessage,
    getRouletteResultMessage,
    getRouletteDefaultMessage,
    getRandomEmoji,
    RANDOM_EMOJIS,
    CRYSTAL_PATTERNS,
    isSarahaActive
};