// ============================================================
// menu.js
// ALJESAT BOT
// Games: .تفكيك, .كتابة, .اعلام, .ايموجي, .الوان
// ============================================================

"use strict";

const {
    wordsList,
    writingList,
    flagsList,
    emojisList
} = require("./data");

// ============================================================
// Active Games
// ============================================================

const activeGames = Object.create(null);

// ============================================================
// مراحل التحميل (8 مراحل خلال 8 ثواني)
// ============================================================

const LOADING_STAGES = [
    "█░░░░░░░░░░░░░░  1%",
    "██░░░░░░░░░░░░░  3%",
    "███░░░░░░░░░░░░  7%",
    "█████░░░░░░░░░░ 16%",
    "█████████░░░░░░ 35%",
    "████████████░░░ 65%",
    "███████████████ 88%",
    "████████████████ 100%"
];

// ============================================================
// Text normalization
// ============================================================

function normalizeText(text) {
    if (text === null || text === undefined) return "";

    return String(text)
        .trim()
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .replace(/ئ/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/\s+/g, " ");
}

// ============================================================
// Extract message text
// ============================================================

function getMessageText(message) {
    if (!message) return "";

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
    );
}

// ============================================================
// قائمة الألوان
// ============================================================

const colorsList = [
    { emoji: "❤️", name: "أحمر" },
    { emoji: "💙", name: "أزرق" },
    { emoji: "💚", name: "أخضر" },
    { emoji: "💛", name: "أصفر" },
    { emoji: "🧡", name: "برتقالي" },
    { emoji: "💜", name: "بنفسجي" },
    { emoji: "🩶", name: "رمادي" },
    { emoji: "🩷", name: "زهري" },
    { emoji: "🩵", name: "أزرق فاتح" },
    { emoji: "🤎", name: "بني" },
    { emoji: "🤍", name: "أبيض" },
    { emoji: "🖤", name: "أسود" }
];

// ============================================================
// عرض التحميل (8 مراحل خلال 8 ثواني)
// ============================================================

async function showLoading(sock, jid, msg) {
    let loadingMsg = await sock.sendMessage(jid, { text: LOADING_STAGES[0] }, { quoted: msg });
    if (!loadingMsg) return null;

    for (let i = 1; i < LOADING_STAGES.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await sock.sendMessage(jid, {
            text: LOADING_STAGES[i],
            edit: loadingMsg.key
        }).catch(() => {});
    }

    return loadingMsg;
}

// ============================================================
// لعبة الألوان (مدمجة هنا)
// ============================================================

async function startColorsGame(sock, jid, msg, cleanSender, sender, db, saveDb, isBotOwner) {
    // التحقق من الصلاحية
    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    const hasPermission = Boolean(isBotOwner) || db.gamePermissions.includes(cleanSender);

    if (!hasPermission) {
        await sock.sendMessage(jid, {
            text: "⚠️ ليس لديك صلاحية لاستخدام أوامر الفعاليات."
        }, { quoted: msg });
        return false;
    }

    // منع التكرار
    if (activeGames[jid] && !activeGames[jid].gameEnded) {
        await sock.sendMessage(jid, {
            text: "⚠️ هناك فعالية قائمة بالفعل."
        }, { quoted: msg });
        return false;
    }

    // Cooldown
    const now = Date.now();
    const cooldownTime = 5 * 60 * 1000;
    db.gameCooldown = db.gameCooldown || {};
    const previousTime = Number(db.gameCooldown[jid]) || 0;

    if (previousTime > 0 && (now - previousTime) < cooldownTime) {
        const remainingMin = Math.ceil((cooldownTime - (now - previousTime)) / 60000);
        await sock.sendMessage(jid, {
            text: `⏳ يرجى الانتظار ${remainingMin} دقائق.`
        }, { quoted: msg });
        return false;
    }

    db.gameCooldown[jid] = now;
    saveDb();

    // عرض التحميل
    await showLoading(sock, jid, msg);

    // ============================================================
    // حالة اللعبة
    // ============================================================

    const userScores = Object.create(null);
    let gameEnded = false;
    let isWaitingNext = false;
    let currentColorObj = null;
    let lastActivityTime = Date.now();
    let noAnswerSeconds = 0;
    let inactiveInterval = null;
    let noAnswerInterval = null;
    let nextTimer = null;
    let gameMessageListener = null;
    const prizeAmount = 30;

    // معلومات البداية
    const startDate = new Date();
    const daysNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const monthsNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    const startTimeFormatted = `${daysNames[startDate.getDay()]} | ${startDate.getDate()} | ${monthsNames[startDate.getMonth()]}`;

    function stopGame() {
        if (gameEnded) return;
        gameEnded = true;
        if (inactiveInterval) clearInterval(inactiveInterval);
        if (noAnswerInterval) clearInterval(noAnswerInterval);
        if (nextTimer) clearTimeout(nextTimer);
        if (gameMessageListener) {
            try { sock.ev.off("messages.upsert", gameMessageListener); } catch (_) {}
            gameMessageListener = null;
        }
        delete activeGames[jid];
    }

    async function sendNewColor() {
        if (gameEnded) return;
        if (activeGames[jid]?.isPaused) return;

        noAnswerSeconds = 0;
        const randomIndex = Math.floor(Math.random() * colorsList.length);
        const color = colorsList[randomIndex];

        currentColorObj = {
            emoji: color.emoji,
            name: normalizeText(color.name)
        };

        const display = `╗──────فعالية الالوان ─────╔
 ارسل اسم اللون التالي: ☜  ${color.emoji} ☞
╝──────────────────╚`;

        await sock.sendMessage(jid, { text: display });
        isWaitingNext = false;
        lastActivityTime = Date.now();
    }

    // مقدمة
    await sock.sendMessage(jid, {
        text: `╗──────فعالية الالوان ─────╔ 
 بكل بساطة البوت يرسل قلب ملون
ويجب على المشاركين ارسال اسم
اللون الذي يرسله البوت وهذه الالوان: 
🤎🤍🩶💜💙🩵💚❤️🩷🧡
╝──────────────────╚`
    });

    // تسجيل اللعبة
    activeGames[jid] = {
        gameEnded: false,
        isPaused: false,
        sendNewChallenge: sendNewColor,
        stopGame
    };

    // مستمع
    gameMessageListener = async (mObj) => {
        try {
            if (gameEnded || activeGames[jid]?.isPaused || isWaitingNext) return;
            if (!mObj?.messages?.length) return;

            const incomingMsg = mObj.messages[0];
            if (!incomingMsg?.message || incomingMsg.key?.remoteJid !== jid || incomingMsg.key?.fromMe) return;

            const txt = getMessageText(incomingMsg.message);
            if (!txt || txt.startsWith(".")) return;

            const userSender = incomingMsg.key?.participant || incomingMsg.key?.remoteJid;
            if (!userSender) return;

            lastActivityTime = Date.now();
            noAnswerSeconds = 0;

            if (currentColorObj && normalizeText(txt) === currentColorObj.name) {
                isWaitingNext = true;
                userScores[userSender] = (userScores[userSender] || 0) + 1;
                const currentScore = userScores[userSender];

                if (currentScore >= 10) {
                    const winnerCleanNum = String(userSender).replace(/[^0-9]/g, "");
                    const winnerTag = `@${winnerCleanNum}`;
                    stopGame();

                    await sock.sendMessage(jid, {
                        text: `━━━━━━✦❘༻🎓༺❘✦━━━━━━
مبروك للفائز 🥳 ${winnerTag}
━━━━━━✦❘༻👑༺❘✦━━━━━━`,
                        mentions: [userSender]
                    });

                    db.users = db.users || {};
                    if (db.users[winnerCleanNum]) {
                        db.users[winnerCleanNum].balance = (db.users[winnerCleanNum].balance || 0) + prizeAmount;
                        saveDb();
                    }

                    const depositMsg = `👑◈═══『 إيداع 』═══◈👑
@${winnerCleanNum}
السبب: فاز بفعالية الألوان
💰 المبلغ: [${prizeAmount}]
✅ تم الإيداع.
👑◈════════════◈👑`;
                    await sock.sendMessage(jid, { text: depositMsg, mentions: [userSender] });

                    // ⭐ إعلان باللقب
                    const winnerUser = db.users?.[winnerCleanNum];
                    const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || winnerCleanNum;

                    const adMessage = `_*█ إنــتــهــت █*_

◇🎮 نـــــــوع الفعالية:
*{الألوان}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${prizeAmount}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇⏰ بّـــــــدأت:
*{${startTimeFormatted}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

                    if (db.adsGroups) {
                        for (const adJid of Object.keys(db.adsGroups)) {
                            if (db.adsGroups[adJid]) {
                                await sock.sendMessage(adJid, { text: adMessage }).catch(() => {});
                            }
                        }
                    }
                    return;
                }

                await sock.sendMessage(jid, {
                    text: `✅ إجابة صحيحة ✅
إجاباتك: { \`${currentScore}\` }
الهدف: { _*10*_ }.`
                }, { quoted: incomingMsg });

                if (nextTimer) clearTimeout(nextTimer);
                nextTimer = setTimeout(async () => {
                    nextTimer = null;
                    if (!gameEnded && !activeGames[jid]?.isPaused) {
                        try { await sendNewColor(); } catch (_) { stopGame(); }
                    }
                }, 4000);
                return;
            }

            lastActivityTime = Date.now();
            noAnswerSeconds = 0;

        } catch (error) {
            console.error("❌ خطأ في Listener الألوان:", error);
        }
    };

    sock.ev.on("messages.upsert", gameMessageListener);

    // مؤقتات
    noAnswerInterval = setInterval(async () => {
        if (gameEnded || activeGames[jid]?.isPaused) return;
        noAnswerSeconds += 5;
        if (noAnswerSeconds === 30) {
            await sock.sendMessage(jid, { text: "🕰 إنتهى الوقت 30ث ⌛" });
            await sendNewColor();
        } else if (noAnswerSeconds >= 52) {
            stopGame();
            await sock.sendMessage(jid, { text: "⛔ تم إيقاف الفعالية لعدم النشاط." });
        }
    }, 5000);

    inactiveInterval = setInterval(() => {
        if (gameEnded) { clearInterval(inactiveInterval); return; }
        if (Date.now() - lastActivityTime > 3 * 60 * 1000) {
            stopGame();
            sock.sendMessage(jid, { text: "⚠️ تم إيقاف الفعالية بسبب الخمول." }).catch(() => {});
        }
    }, 60000);

    // أول لون
    try { await sendNewColor(); } catch (_) { stopGame(); return false; }
    return true;
}

// ============================================================
// Handle game command (الألعاب القديمة)
// ============================================================

async function handleGameCommand(
    sock,
    jid,
    msg,
    command,
    cleanSender,
    sender,
    db,
    saveDb,
    isBotOwner
) {
    if (!sock || !jid) return false;

    // التحقق من الصلاحية
    db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
    const hasGamePermission = Boolean(isBotOwner) || db.gamePermissions.includes(cleanSender);

    if (!hasGamePermission) {
        await sock.sendMessage(jid, {
            text: "⚠️ ليس لديك صلاحية لاستخدام أوامر الفعاليات. يرجى التواصل مع المطور لمنحك الصلاحية."
        }, { quoted: msg });
        return false;
    }

    // التحقق من صحة الأمر
    const validGames = ["تفكيك", "كتابة", "اعلام", "ايموجي"];
    if (!validGames.includes(command)) return false;

    // منع تكرار اللعبة
    if (activeGames[jid] && !activeGames[jid].gameEnded) {
        await sock.sendMessage(jid, {
            text: "⚠️ هناك فعالية قائمة بالفعل في هذه المجموعة، انتظر حتى تنتهي أو اكتب .ايقاف"
        }, { quoted: msg });
        return false;
    }

    // Cooldown
    const now = Date.now();
    const cooldownTime = 5 * 60 * 1000;
    db.gameCooldown = db.gameCooldown && typeof db.gameCooldown === "object" ? db.gameCooldown : {};
    const previousTime = Number(db.gameCooldown[jid]) || 0;

    if (previousTime > 0) {
        const elapsed = now - previousTime;
        if (elapsed < cooldownTime) {
            const remainingMin = Math.ceil((cooldownTime - elapsed) / 60000);
            await sock.sendMessage(jid, {
                text: `⏳ يرجى الانتظار ${remainingMin} دقائق قبل بدء فعالية جديدة.`
            }, { quoted: msg });
            return false;
        }
    }

    db.gameCooldown[jid] = now;
    if (typeof saveDb === "function") saveDb();

    // --------------------------------------------------------
    // معلومات البداية
    // --------------------------------------------------------

    const startDate = new Date();
    const daysNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const monthsNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

    const startTimeFormatted = `${daysNames[startDate.getDay()]} | ${startDate.getDate()} | ${monthsNames[startDate.getMonth()]}`;

    // عرض التحميل
    await showLoading(sock, jid, msg);

    // --------------------------------------------------------
    // حالة اللعبة
    // --------------------------------------------------------

    const userScores = Object.create(null);
    let gameEnded = false;
    let isWaitingNextWord = false;
    let currentChallengeObj = null;
    let lastActivityTime = Date.now();
    let noAnswerSeconds = 0;
    let inactiveInterval = null;
    let noAnswerInterval = null;
    let nextChallengeTimer = null;
    let gameMessageListener = null;

    // --------------------------------------------------------
    // الجائزة
    // --------------------------------------------------------

    let prizeAmount = 30;
    if (command === "كتابة") prizeAmount = 20;
    if (command === "اعلام") prizeAmount = 35;

    // --------------------------------------------------------
    // إيقاف اللعبة
    // --------------------------------------------------------

    function stopGame() {
        if (gameEnded) return;
        gameEnded = true;

        if (inactiveInterval) {
            clearInterval(inactiveInterval);
            inactiveInterval = null;
        }

        if (noAnswerInterval) {
            clearInterval(noAnswerInterval);
            noAnswerInterval = null;
        }

        if (nextChallengeTimer) {
            clearTimeout(nextChallengeTimer);
            nextChallengeTimer = null;
        }

        if (gameMessageListener) {
            try {
                sock.ev.off("messages.upsert", gameMessageListener);
            } catch (_) {}
            gameMessageListener = null;
        }

        delete activeGames[jid];
    }

    // --------------------------------------------------------
    // إرسال تحدي جديد
    // --------------------------------------------------------

    async function sendNewChallenge() {
        if (gameEnded) return;
        if (activeGames[jid]?.isPaused) return;

        noAnswerSeconds = 0;

        if (command === "تفكيك") {
            if (!Array.isArray(wordsList) || wordsList.length === 0) {
                throw new Error("wordsList فارغة أو غير موجودة.");
            }

            const randomWord = wordsList[Math.floor(Math.random() * wordsList.length)];
            const target = String(randomWord).split("").join(" ");

            currentChallengeObj = {
                target: normalizeText(target),
                display: `╗════════✂️════════╔
  *قم بتفكيك الكلمة:*

   *(${randomWord})*

\`شرح: فقط ارسل تفكيك الكلمة\`
\`كهذا المثال: ناروتو = ن ا ر و ت و\`
╝═══════════════════╚`
            };
        }

        else if (command === "كتابة") {
            if (!Array.isArray(writingList) || writingList.length === 0) {
                throw new Error("writingList فارغة أو غير موجودة.");
            }

            const randomWord = writingList[Math.floor(Math.random() * writingList.length)];

            currentChallengeObj = {
                target: normalizeText(randomWord),
                display: `*فعالية الكتابة*
_*الشرح:*_
\`يقوم البوت بإرسال كلمة ويجب على أي شخص أن يرسل نفسها بالضبط\`

╮──────────────╭
       *${randomWord}*
‏╯──────────────╰`
            };
        }

        else if (command === "اعلام") {
            if (!Array.isArray(flagsList) || flagsList.length === 0) {
                throw new Error("flagsList فارغة أو غير موجودة.");
            }

            const randomFlag = flagsList[Math.floor(Math.random() * flagsList.length)];

            currentChallengeObj = {
                target: normalizeText(randomFlag.emoji),
                display: `🏳️*فعالية الاعلام*🏴
أرسل علم دولة: *${randomFlag.name}*`
            };
        }

        else if (command === "ايموجي") {
            if (!Array.isArray(emojisList) || emojisList.length === 0) {
                throw new Error("emojisList فارغة أو غير موجودة.");
            }

            const randomEmoji = emojisList[Math.floor(Math.random() * emojisList.length)];

            currentChallengeObj = {
                target: normalizeText(randomEmoji.emoji),
                display: `🍎_*فعالية الإيموجي*_🙂
يرسل البوت اسم ايموجي ويجب على أي مشارك أن يرسل الإيموجي الذي يتناسق مع الاسم الذي يرسله البوت
╮──────────────╭
      ${randomEmoji.name}
‏╯──────────────╰`
            };
        }

        if (!currentChallengeObj) return;

        await sock.sendMessage(jid, { text: currentChallengeObj.display });
        isWaitingNextWord = false;
        lastActivityTime = Date.now();
    }

    // ========================================================
    // مقدمة اللعبة
    // ========================================================

    if (command === "تفكيك") {
        await sock.sendMessage(jid, {
            text: `*┊ فعالية التفكيك ┊*

✂️═══════✂️
الشرح:
\`يقوم البوت بإرسال كلمة ويجب على أحد المشاركين أن يرسلها بشكل مفكك\`

\`مثال:\`
ناروتو = ن ا ر و ت و

آلَفــــــائـــز يــربــح: ┊*30 $*💰┊`
        });
    } else if (command === "كتابة") {
        await sock.sendMessage(jid, {
            text: `✍️*فعالية الكتابة*
_*الشرح:*_
\`يقوم البوت بإرسال كلمة ويجب على أي شخص ان يرسل نفسها بالضبط\`

آلَـــ💰ـــجَــآئــزة: 20$`
        });
    } else if (command === "اعلام") {
        await sock.sendMessage(jid, {
            text: `🏳️*فعالية الاعلام*🏴
\`يرسل البوت اسم علم دولة وأي شخص يرسل ايموجي علم لاسم الدولة المذكور\`

آلَـــ💰ـــجَــآئــزة: 35$`
        });
    } else if (command === "ايموجي") {
        await sock.sendMessage(jid, {
            text: `🍎_*فعالية الإيموجي*_🙂
يرسل البوت اسم ايموجي ويجب على أي مشارك أن يرسل الإيموجي الذي يتناسق مع الاسم الذي يرسله البوت

آلَـــ💰ـــجَــآئــزة: 30$`
        });
    }

    // ========================================================
    // تسجيل اللعبة
    // ========================================================

    activeGames[jid] = {
        gameEnded: false,
        isPaused: false,
        sendNewChallenge,
        stopGame
    };

    // ========================================================
    // مستمع الرسائل
    // ========================================================

    gameMessageListener = async (mObj) => {
        try {
            if (gameEnded || activeGames[jid]?.isPaused || isWaitingNextWord) return;

            if (!mObj || !Array.isArray(mObj.messages) || !mObj.messages.length) return;

            const incomingMsg = mObj.messages[0];
            if (!incomingMsg?.message) return;
            if (incomingMsg.key?.remoteJid !== jid) return;
            if (incomingMsg.key?.fromMe) return;

            const txt = getMessageText(incomingMsg.message);
            if (!txt) return;
            if (txt.startsWith(".")) return;

            const userSender = incomingMsg.key?.participant || incomingMsg.key?.remoteJid;
            if (!userSender) return;

            lastActivityTime = Date.now();
            noAnswerSeconds = 0;

            // =================================================
            // إجابة صحيحة
            // =================================================

            if (currentChallengeObj && normalizeText(txt) === currentChallengeObj.target) {
                isWaitingNextWord = true;
                userScores[userSender] = (userScores[userSender] || 0) + 1;
                const currentScore = userScores[userSender];

                // ---------------------------------------------
                // فائز
                // ---------------------------------------------

                if (currentScore >= 10) {
                    const winnerCleanNum = String(userSender).replace(/[^0-9]/g, "");
                    const winnerTag = `@${winnerCleanNum}`;

                    stopGame();

                    await sock.sendMessage(jid, {
                        text: `━━━━━━✦❘༻🎓༺❘✦━━━━━━
مبروك للفائز 🥳 ${winnerTag}
━━━━━━✦❘༻👑༺❘✦━━━━━━`,
                        mentions: [userSender]
                    });

                    // تحديث الرصيد
                    db.users = db.users && typeof db.users === "object" ? db.users : {};

                    if (db.users[winnerCleanNum]) {
                        const user = db.users[winnerCleanNum];
                        user.balance = Number(user.balance) || 0;
                        user.balance += prizeAmount;
                        if (typeof saveDb === "function") saveDb();
                    }

                    // رسالة الإيداع
                    const depositMsg = `👑◈═══『 إيداع 』═══◈👑
@${winnerCleanNum}
السبب: فاز بالفعالية
💰 المبلغ: [${prizeAmount}]
تم إضافة رصيدك للبنك يمكنك الذهاب والتحقق✅

👑◈════════════◈👑`;

                    await sock.sendMessage(jid, {
                        text: depositMsg,
                        mentions: [userSender]
                    });

                    // ⭐ إعلان باللقب
                    const winnerUser = db.users?.[winnerCleanNum];
                    const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || winnerCleanNum;

                    const adMessage = `_*█ إنــتــهــت █*_

◇🎮 نـــــــوع الفعالية:
*{${command}}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${prizeAmount}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇⏰ بّـــــــدأت:
*{${startTimeFormatted}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

                    if (db.adsGroups && typeof db.adsGroups === "object") {
                        for (const adJid of Object.keys(db.adsGroups)) {
                            if (!db.adsGroups[adJid]) continue;
                            try {
                                await sock.sendMessage(adJid, {
                                    text: adMessage
                                });
                            } catch (_) {}
                        }
                    }

                    return;
                }

                // ---------------------------------------------
                // إجابة صحيحة لكن ليس فائزاً بعد
                // ---------------------------------------------

                await sock.sendMessage(jid, {
                    text: `✅ إجابة صحيحة ✅
اجاباتك: { \`${currentScore}\` }
الهدف حتى الفوز: { _*10*_ }.`
                }, { quoted: incomingMsg });

                if (nextChallengeTimer) {
                    clearTimeout(nextChallengeTimer);
                }

                nextChallengeTimer = setTimeout(async () => {
                    nextChallengeTimer = null;
                    if (gameEnded || activeGames[jid]?.isPaused) return;

                    try {
                        await sendNewChallenge();
                    } catch (error) {
                        console.error("❌ فشل إرسال التحدي التالي:", error?.message || error);
                        stopGame();
                    }
                }, 4000);

                return;
            }

            // ------------------------------------------------
            // أي رسالة عادية = نشاط
            // ------------------------------------------------

            lastActivityTime = Date.now();
            noAnswerSeconds = 0;

        } catch (error) {
            console.error("❌ خطأ في Listener الفعالية:", error?.stack || error?.message || error);
        }
    };

    // ========================================================
    // تسجيل المستمع
    // ========================================================

    sock.ev.on("messages.upsert", gameMessageListener);

    // ========================================================
    // مؤقت عدم الإجابة
    // ========================================================

    noAnswerInterval = setInterval(async () => {
        try {
            if (gameEnded || activeGames[jid]?.isPaused) return;

            noAnswerSeconds += 5;

            if (noAnswerSeconds === 30) {
                await sock.sendMessage(jid, { text: "🕰 إنتهى الوقت المحدد 30ث ⌛" });
                await sendNewChallenge();
                return;
            }

            if (noAnswerSeconds >= 52) {
                stopGame();
                await sock.sendMessage(jid, {
                    text: `╗═══════❌══════╔
  إن لم يكن هناك نشاط ومشاركة
   ستتم عملية إيقاف الفعالية
╝═══════❌══════╝`
                });
            }

        } catch (error) {
            console.error("❌ خطأ في مؤقت الفعالية:", error?.message || error);
        }
    }, 5000);

    // ========================================================
    // مؤقت الخمول
    // ========================================================

    inactiveInterval = setInterval(async () => {
        try {
            if (gameEnded) {
                clearInterval(inactiveInterval);
                inactiveInterval = null;
                return;
            }

            if (Date.now() - lastActivityTime > 3 * 60 * 1000) {
                stopGame();
                await sock.sendMessage(jid, {
                    text: "⚠️ تم إيقاف الفعالية تلقائياً بسبب الخمول وعدم التفاعل."
                });
            }

        } catch (error) {
            console.error("❌ خطأ في مؤقت الخمول:", error?.message || error);
        }
    }, 60000);

    // ========================================================
    // التحدي الأول
    // ========================================================

    try {
        await sendNewChallenge();
    } catch (error) {
        console.error("❌ فشل بدء الفعالية:", error?.message || error);
        stopGame();
        return false;
    }

    return true;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    activeGames,
    handleGameCommand,
    normalizeText,
    showLoading,
    startColorsGame,
    colorsList,
    LOADING_STAGES
};