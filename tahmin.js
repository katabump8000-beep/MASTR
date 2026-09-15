// ============================================================
// tahmin.js
// ALJESAT BOT
// لعبة التخمين - إرسال صورة شخصية ويجب كتابة اسمه
// ============================================================

"use strict";

const path = require("path");
const fs = require("fs");

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
// مسار مجلد الصور
// ============================================================

const TAHMIN_FOLDER = path.join(__dirname, "tahmin_photo");

if (!fs.existsSync(TAHMIN_FOLDER)) {
    fs.mkdirSync(TAHMIN_FOLDER, { recursive: true });
}

// ============================================================
// قائمة الشخصيات مع id و المرادفات
// ============================================================

const TAHMIN_LIST = [
    // ============ ناروتو ============
    { id: "iii", name: "توبيراما", aliases: ["توبيراما", "هاشيراما"] },
    { id: "tan", name: "تانجيرو", aliases: ["تانجيرو", "كامادو"] },
    { id: "mee", name: "ميغومي", aliases: ["ميغومي", "فوشيغورو"] },
    { id: "kay", name: "كايدو", aliases: ["كايدو"] },
    { id: "hen", name: "هيناتا", aliases: ["هيناتا", "هيوجا"] },
    { id: "jer", name: "جيرايا", aliases: ["جيرايا"] },
    { id: "aya", name: "اياناكوجي", aliases: ["اياناكوجي", "ايانوكوجي"] },
    { id: "alo", name: "الوكا", aliases: ["الوكا", "ألوكا"] },
    { id: "medo", name: "ميدوريا", aliases: ["ميدوريا", "ايزوكو"] },
    { id: "bek", name: "بيكولو", aliases: ["بيكولو"] },
    { id: "ayzn", name: "آيزن", aliases: ["آيزن", "ايزن", "سوسكي"] },
    { id: "ber", name: "بيروس", aliases: ["بيروس", "فيروس", "بيرُوس"] },
    { id: "joh", name: "جوهان", aliases: ["جوهان", "يوهان"] },
    { id: "gon", name: "غون", aliases: ["غون", "جون"] },
    { id: "eren", name: "إيرين", aliases: ["إيرين", "ايرين", "ييغر"] },
    { id: "koo", name: "كوموغي", aliases: ["كوموغي", "كوموجي"] },
    { id: "gam", name: "غابيمارو", aliases: ["غابيمارو", "غابي"] },
    { id: "mad", name: "مادارا", aliases: ["مادارا", "اوتشيها"] },
    { id: "ita", name: "إيتاتشي", aliases: ["إيتاتشي", "ايتاتشي", "ايتاشي"] },
    { id: "han", name: "هانجي", aliases: ["هانجي"] },
    { id: "shi", name: "شيكامارو", aliases: ["شيكامارو"] },
    { id: "bof", name: "بوف", aliases: ["بوف", "بوف"] },
    { id: "tran", name: "ترانكس", aliases: ["ترانكس"] },
    { id: "car", name: "غارا", aliases: ["غارا", "قارا", "كارا"] },
    { id: "goj", name: "غوجو", aliases: ["غوجو", "ساتورو"] },
    { id: "shar", name: "شارلناك", aliases: ["شارلناك", "شارلوت"] },
    { id: "kop", name: "كوبي", aliases: ["كوبي", "كوبي"] },
    { id: "roj", name: "روجر", aliases: ["روجر", "غول دي روجر"] },
    { id: "top", name: "توبيراما", aliases: ["توبيراما", "توبي"] },
    { id: "nam", name: "نامي", aliases: ["نامي", "نـامي"] },
    { id: "iny", name: "اينيوشا", aliases: ["اينيوشا", "إنيوشا", "اينيوشا"] },
    { id: "mer", name: "ميرويم", aliases: ["ميرويم", "ميروم"] },
    { id: "mor", name: "موراو", aliases: ["موراو", "موراو"] },
    { id: "day", name: "دايشنكان", aliases: ["دايشنكان", "داي"] },
    { id: "ker", name: "كيرا", aliases: ["كيرا", "لايت", "ياغامي"] },
    { id: "zoro", name: "زورو", aliases: ["زورو", "رورونوا"] },
    { id: "ani", name: "آني", aliases: ["آني", "اني"] },
    { id: "nop", name: "نوبارا", aliases: ["نوبارا", "كوجيساكي"] },
    { id: "hes", name: "هيستوريا", aliases: ["هيستوريا", "كريستا"] },
    { id: "meca", name: "ميكاسا", aliases: ["ميكاسا", "أكرمان", "اكرمان"] },
    { id: "gojo", name: "غوجو", aliases: ["غوجو", "ساتورو"] },
    { id: "heso", name: "هيسوكا", aliases: ["هيسوكا", "مورو"] },
    { id: "tsho", name: "تشوجي", aliases: ["تشوجي", "تشووجي"] },
    { id: "tso", name: "تسونادي", aliases: ["تسونادي", "تسونادِ"] },
    { id: "ben", name: "باين", aliases: ["باين", "بين", "بين"] },
    { id: "kora", name: "كورابيكا", aliases: ["كورابيكا", "كورابكا"] },
    { id: "min", name: "ميناتو", aliases: ["ميناتو", "ناميكازي"] },
    { id: "tfo", name: "توبيراما", aliases: ["توبيراما", "توبي"] },
    { id: "zoroo", name: "زورو", aliases: ["زورو", "رورونوا"] },
    { id: "beto", name: "نيفير بيتو", aliases: ["بيتو", "نيفير بيتو", "نيفر بيتو"] },
    { id: "sas", name: "ساسكي", aliases: ["ساسكي", "اوتشيها"] },
    { id: "gone", name: "دراغون", aliases: ["دراغون", "دراجون"] },
    { id: "ffff", name: "غون", aliases: ["غون", "جون"] },
    { id: "aka", name: "اكاينو", aliases: ["اكاينو", "أكاينو"] },
    { id: "kabo", name: "كابوتو", aliases: ["كابوتو", "كابوتو"] },
    { id: "balck", name: "غوكو بلاك", aliases: ["غوكو بلاك", "بلاك", "غوكو الاسود"] },
    { id: "smo", name: "سموكر", aliases: ["سموكر", "سموك"] },
    { id: "koko", name: "غوكو", aliases: ["غوكو", "كوكو", "غوكو"] },
    { id: "boma", name: "غينثورو", aliases: ["غينثورو", "المفجر بوما", "بوما"] },
    { id: "ise", name: "ايس", aliases: ["ايس", "أيس", "ايس"] },
    { id: "sok", name: "سوكونا", aliases: ["سوكونا", "سكونا", "سوكونا"] },
    { id: "kro", name: "كروكودايل", aliases: ["كروكودايل", "كروكو"] },
    { id: "sai", name: "ساي", aliases: ["ساي", "ايتوشي ساي"] },
    { id: "dra", name: "ايندرا", aliases: ["ايندرا", "آينادرا"] },
    { id: "kit", name: "كايتو كيد", aliases: ["كايدو", "كايتو كيد", "كيد", "كايدو كيد"] },
    { id: "song", name: "سونغ جين وو", aliases: ["سونغ جين وو", "سونغ", "سونج", "سونغ جين"] },
    { id: "nag", name: "ناغي", aliases: ["ناغي", "ناجي"] },
    { id: "doma", name: "دوما", aliases: ["دوما", "دومه", "دومة"] },
    { id: "wing", name: "وينغ", aliases: ["وينغ", "وينج"] },
    { id: "meet", name: "ميتسوكي", aliases: ["ميتسوكي", "ميتسكي"] },
    { id: "sat", name: "ساتوتز", aliases: ["ساتوتز", "ساتورو"] }
];

// ============================================================
// الحالة النشطة للعبة
// ============================================================

const activeTahmin = Object.create(null);

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
// الحصول على مسار صورة التخمين (يدعم jpg + png)
// ============================================================

function getTahminImagePath(id) {
    const jpgPath = path.join(TAHMIN_FOLDER, `${id}.jpg`);
    const jpegPath = path.join(TAHMIN_FOLDER, `${id}.jpeg`);
    const pngPath = path.join(TAHMIN_FOLDER, `${id}.png`);

    if (fs.existsSync(jpgPath)) return jpgPath;
    if (fs.existsSync(jpegPath)) return jpegPath;
    if (fs.existsSync(pngPath)) return pngPath;
    return null;
}

function tahminImageExists(id) {
    return getTahminImagePath(id) !== null;
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

function getTahminStartMessage() {
    return `~*‏«───────🎯───────»*~
  فعالية التخمين سهلة جدا 
  \`فقط ارسل أسم الشخصية\` التي 
  تظهر في الصورة 🖼️
  \`اولا سأبدأ بهذه الشخصية:\`
~*‏«───────🎯───────»*~`;
}

function getTahminQuestion() {
    return `~*‏«───────🎯───────»*~
  \`ما اسم هذه الشخصية؟\`
~*‏«───────🎯───────»*~`;
}

function getTahminCorrect(score) {
    return `✅ إجابة صحيحة ✅
إجاباتك: { \`${score}\` }
الهدف حتى الفوز: { _*10*_ }.`;
}

function getTahminWinner(user) {
    return `━━━━━━✦❘༻🎓༺❘✦━━━━━━
مبروك للفائز 🥳  @${user}
━━━━━━✦❘༻👑༺❘✦━━━━━━`;
}

function getTahminDeposit(user, prize) {
    return `👑◈═══『 إيداع 』═══◈👑
@${user}
السبب: فاز بفعالية التخمين
💰 المبلغ: [${prize}]
تم إضافة رصيدك للبنك يمكنك الذهاب والتحقق✅

👑◈════════════◈👑`;
}

function getTahminInactiveStop() {
    return "⚠️ تم إيقاف فعالية التخمين تلقائياً بسبب الخمول وعدم التفاعل.";
}

function getTahminTimeout() {
    return "🕰 إنتهى الوقت المحدد 30ث ⌛";
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
// بدء لعبة التخمين
// ============================================================

async function handleTahminCommand(
    sock,
    jid,
    msg,
    db,
    saveDb,
    cleanSender,
    isBotOwner
) {
    try {
        if (activeTahmin[jid]) {
            await safeSend(sock, jid, {
                text: "⚠️ هناك فعالية تخمين قائمة بالفعل في هذه المجموعة!"
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

        // فلترة الشخصيات التي لها صور موجودة فعلاً
        const availableCharacters = TAHMIN_LIST.filter(c => tahminImageExists(c.id));

        if (availableCharacters.length === 0) {
            await safeSend(sock, jid, {
                text: "❌ لا توجد صور شخصيات متوفرة. يرجى إضافة الصور إلى مجلد tahmin_photo/"
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

        const characters = shuffleArray([...availableCharacters]);
        const gameState = {
            characters: characters,
            currentIndex: 0,
            scores: {},
            isActive: true,
            isPaused: false,
            isWaitingNext: false,
            currentCharacter: null,
            lastActivity: Date.now(),
            totalQuestions: characters.length,
            prizeAmount: 50,  // 🆕 50$
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
                delete activeTahmin[jid];
            }
        };

        activeTahmin[jid] = gameState;

        await safeSend(sock, jid, {
            text: getTahminStartMessage()
        }, { quoted: msg });

        setTimeout(async () => {
            if (!gameState.isActive) return;
            await sendNextTahminQuestion(sock, jid, db, gameState);
        }, 2000);

        startTahminInactivityTimer(sock, jid, gameState);

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

                if (gameState.currentCharacter) {
                    const normalizedAnswer = normalizeText(txt);
                    const character = gameState.currentCharacter;

                    const isCorrect = 
                        normalizedAnswer === normalizeText(character.name) ||
                        character.aliases.some(alias => normalizedAnswer === normalizeText(alias));

                    if (isCorrect) {
                        gameState.isWaitingNext = true;
                        const senderNumber = cleanNumber(userSender);
                        gameState.scores[senderNumber] = (gameState.scores[senderNumber] || 0) + 1;
                        const currentScore = gameState.scores[senderNumber];

                        if (currentScore >= 10) {
                            const winnerClean = cleanNumber(userSender);

                            gameState.stopGame();

                            await safeSend(sock, jid, {
                                text: getTahminWinner(winnerClean),
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
                                text: getTahminDeposit(winnerClean, gameState.prizeAmount),
                                mentions: [userSender]
                            });

                            // إعلان باللقب
                            const winnerUser = db.users?.[winnerClean];
                            const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || winnerClean;

                            const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{التخمين}*

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
                                    await safeSend(sock, adJid, { text: adMessage });
                                }
                            }

                            return;
                        }

                        await safeSend(sock, jid, {
                            text: getTahminCorrect(currentScore)
                        }, { quoted: incomingMsg });

                        if (gameState.timers.next) {
                            clearTimeout(gameState.timers.next);
                        }

                        gameState.timers.next = setTimeout(async () => {
                            gameState.timers.next = null;
                            if (!gameState.isActive || gameState.isPaused) return;
                            gameState.isWaitingNext = false;
                            await sendNextTahminQuestion(sock, jid, db, gameState);
                        }, 4000);

                        return;
                    }
                }

            } catch (error) {
                console.error("❌ خطأ في مستمع التخمين:", error?.message || error);
            }
        };

        sock.ev.on("messages.upsert", listener);
        gameState.listeners.push(listener);

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleTahminCommand:", error?.message || error);
        return false;
    }
}

// ============================================================
// إرسال السؤال التالي
// ============================================================

async function sendNextTahminQuestion(sock, jid, db, gameState) {
    if (!gameState.isActive || gameState.isPaused) return;
    if (gameState.currentIndex >= gameState.totalQuestions) {
        gameState.characters = shuffleArray([...gameState.characters]);
        gameState.currentIndex = 0;
    }

    const character = gameState.characters[gameState.currentIndex];
    gameState.currentCharacter = character;
    gameState.currentIndex++;
    gameState.lastActivity = Date.now();

    const imagePath = getTahminImagePath(character.id);

    if (imagePath) {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            await safeSend(sock, jid, {
                image: imageBuffer,
                caption: getTahminQuestion()
            });
        } catch (error) {
            console.error("❌ خطأ في إرسال صورة التخمين:", error?.message);
            await safeSend(sock, jid, {
                text: `${getTahminQuestion()}\n\n⚠️ لم يتم تحميل الصورة. اكتب اسم الشخصية: ${character.name}`
            });
        }
    } else {
        await safeSend(sock, jid, {
            text: `${getTahminQuestion()}\n\n⚠️ الصورة غير متوفرة. اكتب اسم الشخصية: ${character.name}`
        });
    }

    if (gameState.timers.question) {
        clearTimeout(gameState.timers.question);
    }

    gameState.timers.question = setTimeout(async () => {
        if (!gameState.isActive || gameState.isPaused) return;
        gameState.isWaitingNext = false;
        await safeSend(sock, jid, {
            text: getTahminTimeout()
        });
        await sendNextTahminQuestion(sock, jid, db, gameState);
    }, 30000);
}

// ============================================================
// مؤقت النشاط
// ============================================================

function startTahminInactivityTimer(sock, jid, gameState) {
    if (gameState.timers.inactivity) {
        clearTimeout(gameState.timers.inactivity);
    }

    gameState.timers.inactivity = setTimeout(async () => {
        if (!gameState.isActive) return;

        const timeSinceLastActivity = Date.now() - gameState.lastActivity;

        if (timeSinceLastActivity > 3 * 60 * 1000) {
            gameState.stopGame();
            await safeSend(sock, jid, {
                text: getTahminInactiveStop()
            });
            return;
        }

        startTahminInactivityTimer(sock, jid, gameState);
    }, 60000);
}

// ============================================================
// إيقاف اللعبة
// ============================================================

function stopTahminGame(jid) {
    const game = activeTahmin[jid];
    if (game) {
        game.stopGame();
        return true;
    }
    return false;
}

function checkTahminActive(jid) {
    return Boolean(activeTahmin[jid] && activeTahmin[jid].isActive);
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    activeTahmin,
    handleTahminCommand,
    stopTahminGame,
    checkTahminActive,
    TAHMIN_LIST,
    getTahminImagePath,
    tahminImageExists,
    LOADING_STAGES,
    showLoading
};