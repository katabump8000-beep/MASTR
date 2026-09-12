// ============================================================
// colors.js
// ALJESAT BOT
// لعبة الألوان - إرسال لون ويجب كتابة اسمه
// ============================================================

"use strict";

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
// قائمة الألوان
// ============================================================

const COLORS_LIST = [
    { emoji: "❤️", name: "احمر", aliases: ["أحمر", "حمراء"] },
    { emoji: "💙", name: "ازرق", aliases: ["أزرق", "زرقاء"] },
    { emoji: "💚", name: "اخضر", aliases: ["أخضر", "خضراء"] },
    { emoji: "💛", name: "اصفر", aliases: ["أصفر", "صفراء"] },
    { emoji: "🧡", name: "برتقالي", aliases: ["برتقال", "برتقالية"] },
    { emoji: "💜", name: "بنفسجي", aliases: ["بنفسج", "نيلي"] },
    { emoji: "🩶", name: "رمادي", aliases: ["رمادي", "فضي"] },
    { emoji: "🩷", name: "زهري", aliases: ["وردي", "زهري", "ورد"] },
    { emoji: "🩵", name: "ازرق فاتح", aliases: ["أزرق فاتح", "سماءي"] },
    { emoji: "🤎", name: "بني", aliases: ["بني", "أسمر"] },
    { emoji: "🤍", name: "ابيض", aliases: ["أبيض", "بيضاء"] },
    { emoji: "🖤", name: "اسود", aliases: ["أسود", "سوداء"] }
];

// ============================================================
// الحالة النشطة للعبة
// ============================================================

const activeColors = Object.create(null);

// ============================================================
// أدوات مساعدة
// ============================================================

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function normalizeText(text) {
    if (text === null || text === undefined) return "";
    return String(text)
        .trim()
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/\s+/g, " ");
}

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/\D/g, "");
}

function getUser(db, jid) {
    if (!db || !db.users) return null;
    return db.users[jid] || null;
}

function hasNickname(db, jid) {
    const user = getUser(db, jid);
    return Boolean(user && String(user.nickname || "").trim());
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

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
    ).trim();
}

// ============================================================
// عرض التحميل
// ============================================================

async function showLoading(sock, jid, msg) {
    let loadingMsg = await safeSend(sock, jid, { text: LOADING_STAGES[0] }, { quoted: msg });
    if (!loadingMsg) return null;

    for (let i = 1; i < LOADING_STAGES.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await safeSend(sock, jid, {
            text: LOADING_STAGES[i],
            edit: loadingMsg.key
        });
    }

    return loadingMsg;
}

// ============================================================
// رسائل اللعبة
// ============================================================

function getColorsStartMessage() {
    return `╗──────فعالية الالوان ─────╔ 
  بكل بساطة البوت يرسل قلب ملون
  ويجب على المشاركين ارسال اسم
  اللون الذي يرسله البوت وهذه الالوان: 
  🤎🤍🩶💜💙🩵💚❤️🩷🧡
╝──────────────────╚`;
}

function getColorsQuestion(color) {
    return `╗──────فعالية الالوان ─────╔ 
  ارسل اسم اللون التالي: ☜  ${color.emoji} ☞
╝──────────────────╚`;
}

function getColorsCorrect(score) {
    return `✅ إجابة صحيحة ✅
إجاباتك: { \`${score}\` }
الهدف حتى الفوز: { _*10*_ }.`;
}

function getColorsWinner(user) {
    return `━━━━━━✦❘༻🎓༺❘✦━━━━━━
مبروك للفائز 🥳  @${user}
━━━━━━✦❘༻👑༺❘✦━━━━━━`;
}

function getColorsDeposit(user, prize) {
    return `👑◈═══『 إيداع 』═══◈👑
@${user}
السبب: فاز بفعالية الالوان
💰 المبلغ: [${prize}]
تم إضافة رصيدك للبنك يمكنك الذهاب والتحقق✅

👑◈════════════◈👑`;
}

function getColorsInactiveStop() {
    return "⚠️ تم إيقاف فعالية الالوان تلقائياً بسبب الخمول وعدم التفاعل.";
}

function getColorsTimeout() {
    return "🕰 إنتهى الوقت المحدد 30ث ⌛";
}

// ============================================================
// بدء لعبة الألوان
// ============================================================

async function handleColorsCommand(
    sock,
    jid,
    msg,
    db,
    saveDb,
    cleanSender,
    isBotOwner
) {
    try {
        if (activeColors[jid]) {
            await safeSend(sock, jid, {
                text: "⚠️ هناك فعالية الوان قائمة بالفعل في هذه المجموعة!"
            }, { quoted: msg });
            return true;
        }

        db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
        const hasPermission = Boolean(isBotOwner) || db.gamePermissions.includes(cleanSender);

        if (!hasPermission) {
            await safeSend(sock, jid, {
                text: "⚠️ ليس لديك صلاحية لاستخدام هذا الأمر. يرجى التواصل مع المطور لمنحك الصلاحية."
            }, { quoted: msg });
            return true;
        }

        if (!hasNickname(db, cleanSender)) {
            await safeSend(sock, jid, {
                text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل لتتمكن من بدء الفعالية."
            }, { quoted: msg });
            return true;
        }

        const now = Date.now();
        const cooldownTime = 5 * 60 * 1000;
        db.gameCooldown = db.gameCooldown && typeof db.gameCooldown === "object" ? db.gameCooldown : {};
        const previousTime = Number(db.gameCooldown[jid]) || 0;

        if (previousTime > 0) {
            const elapsed = now - previousTime;
            if (elapsed < cooldownTime) {
                const remainingMin = Math.ceil((cooldownTime - elapsed) / 60000);
                await safeSend(sock, jid, {
                    text: `⏳ يرجى الانتظار ${remainingMin} دقائق قبل بدء فعالية جديدة.`
                }, { quoted: msg });
                return true;
            }
        }

        db.gameCooldown[jid] = now;
        if (typeof saveDb === "function") saveDb();

        await showLoading(sock, jid, msg);

        const colors = shuffleArray([...COLORS_LIST]);
        const gameState = {
            colors: colors,
            currentIndex: 0,
            scores: {},
            isActive: true,
            isPaused: false,
            isWaitingNext: false,
            currentColor: null,
            lastActivity: Date.now(),
            totalQuestions: colors.length,
            prizeAmount: 30,
            startTime: new Date(),
            timers: {
                inactivity: null,
                question: null,
                next: null
            },
            listeners: [],
            stopGame: function() {
                this.isActive = false;
                if (this.timers.inactivity) {
                    clearTimeout(this.timers.inactivity);
                    this.timers.inactivity = null;
                }
                if (this.timers.question) {
                    clearTimeout(this.timers.question);
                    this.timers.question = null;
                }
                if (this.timers.next) {
                    clearTimeout(this.timers.next);
                    this.timers.next = null;
                }
                delete activeColors[jid];
            }
        };

        activeColors[jid] = gameState;

        await safeSend(sock, jid, {
            text: getColorsStartMessage()
        }, { quoted: msg });

        setTimeout(async () => {
            if (!gameState.isActive) return;
            await sendNextColorQuestion(sock, jid, db, gameState);
        }, 2000);

        startColorsInactivityTimer(sock, jid, gameState);

        const listener = async (mObj) => {
            try {
                if (!gameState.isActive || gameState.isPaused || gameState.isWaitingNext) return;
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

                gameState.lastActivity = Date.now();

                if (gameState.currentColor) {
                    const normalizedAnswer = normalizeText(txt);
                    const color = gameState.currentColor;

                    const isCorrect = 
                        normalizedAnswer === normalizeText(color.name) ||
                        color.aliases.some(alias => normalizedAnswer === normalizeText(alias));

                    if (isCorrect) {
                        gameState.isWaitingNext = true;
                        const senderNumber = cleanNumber(userSender);
                        gameState.scores[senderNumber] = (gameState.scores[senderNumber] || 0) + 1;
                        const currentScore = gameState.scores[senderNumber];

                        if (currentScore >= 10) {
                            const winnerClean = cleanNumber(userSender);
                            const winnerTag = `@${winnerClean}`;

                            gameState.stopGame();

                            await safeSend(sock, jid, {
                                text: getColorsWinner(winnerClean),
                                mentions: [userSender]
                            });

                            db.users = db.users && typeof db.users === "object" ? db.users : {};
                            if (db.users[winnerClean]) {
                                const user = db.users[winnerClean];
                                user.balance = Number(user.balance) || 0;
                                user.balance += gameState.prizeAmount;
                                if (typeof saveDb === "function") saveDb();
                            }

                            await safeSend(sock, jid, {
                                text: getColorsDeposit(winnerClean, gameState.prizeAmount),
                                mentions: [userSender]
                            });

                            // ⭐ إعلان باللقب
                            const winnerUser = db.users?.[winnerClean];
                            const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || winnerClean;

                            const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{الالوان}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${gameState.prizeAmount}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇⏰ بّـــــــدأت:
*{${formatDate(gameState.startTime)}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

                            if (db.adsGroups && typeof db.adsGroups === "object") {
                                for (const adJid of Object.keys(db.adsGroups)) {
                                    if (!db.adsGroups[adJid]) continue;
                                    await safeSend(sock, adJid, {
                                        text: adMessage
                                    });
                                }
                            }

                            return;
                        }

                        await safeSend(sock, jid, {
                            text: getColorsCorrect(currentScore)
                        }, { quoted: incomingMsg });

                        if (gameState.timers.next) {
                            clearTimeout(gameState.timers.next);
                        }

                        gameState.timers.next = setTimeout(async () => {
                            gameState.timers.next = null;
                            if (!gameState.isActive || gameState.isPaused) return;
                            gameState.isWaitingNext = false;
                            await sendNextColorQuestion(sock, jid, db, gameState);
                        }, 4000);

                        return;
                    }
                }

            } catch (error) {
                console.error("❌ خطأ في مستمع الالوان:", error?.message || error);
            }
        };

        sock.ev.on("messages.upsert", listener);
        gameState.listeners.push(listener);

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleColorsCommand:", error?.message || error);
        return false;
    }
}

// ============================================================
// إرسال السؤال التالي
// ============================================================

async function sendNextColorQuestion(sock, jid, db, gameState) {
    if (!gameState.isActive || gameState.isPaused) return;
    if (gameState.currentIndex >= gameState.totalQuestions) {
        gameState.colors = shuffleArray([...COLORS_LIST]);
        gameState.currentIndex = 0;
    }

    const color = gameState.colors[gameState.currentIndex];
    gameState.currentColor = color;
    gameState.currentIndex++;
    gameState.lastActivity = Date.now();

    await safeSend(sock, jid, {
        text: getColorsQuestion(color)
    });

    if (gameState.timers.question) {
        clearTimeout(gameState.timers.question);
    }

    gameState.timers.question = setTimeout(async () => {
        if (!gameState.isActive || gameState.isPaused) return;
        gameState.isWaitingNext = false;
        await safeSend(sock, jid, {
            text: getColorsTimeout()
        });
        await sendNextColorQuestion(sock, jid, db, gameState);
    }, 30000);
}

// ============================================================
// مؤقت النشاط
// ============================================================

function startColorsInactivityTimer(sock, jid, gameState) {
    if (gameState.timers.inactivity) {
        clearTimeout(gameState.timers.inactivity);
    }

    gameState.timers.inactivity = setTimeout(async () => {
        if (!gameState.isActive) return;

        const timeSinceLastActivity = Date.now() - gameState.lastActivity;

        if (timeSinceLastActivity > 3 * 60 * 1000) {
            gameState.stopGame();
            await safeSend(sock, jid, {
                text: getColorsInactiveStop()
            });
            return;
        }

        startColorsInactivityTimer(sock, jid, gameState);
    }, 60000);
}

// ============================================================
// تنسيق التاريخ
// ============================================================

function formatDate(date) {
    const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    return `${days[date.getDay()]} | ${date.getDate()} | ${months[date.getMonth()]}`;
}

// ============================================================
// إيقاف اللعبة
// ============================================================

function stopColorsGame(jid) {
    const game = activeColors[jid];
    if (game) {
        game.stopGame();
        return true;
    }
    return false;
}

function checkColorsActive(jid) {
    return Boolean(activeColors[jid] && activeColors[jid].isActive);
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    activeColors,
    handleColorsCommand,
    stopColorsGame,
    checkColorsActive,
    COLORS_LIST,
    LOADING_STAGES,
    showLoading
};