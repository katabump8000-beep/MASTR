// ============================================================
// hads.js   (ملف جديد)
// ALJESAT BOT
// فعالية:  .اتبع حدسك
//
//   .اتبع حدسك          إنشاء الفعالية
//   .مشاركة 50 / .اشارك 50   المشاركة برهان
//   .بدأ / .ابدا         بدء الفعالية (المنشئ، بشرط 3 مشاركين فأكثر)
//   .وقف                إيقاف الفعالية (المنشئ / الإمبراطور)
// ============================================================

"use strict";

const jf = require("./jidfix");

// ============================================================
// إعدادات
// ============================================================

const ALL_BALLS = ["🟢", "🟡", "🔵", "🟣", "🔴", "🟤", "🟠"];
const MAX_PLAYERS = 7;
const MIN_PLAYERS = 3;

const LOBBY_NO_THIRD_MS = 3 * 60 * 1000;   // بعد 3 دقائق بدون مشارك ثالث → تنبيه
const LOBBY_STOP_AFTER_WARN_MS = 75 * 1000; // ثم إيقاف بعد 75 ثانية
const LOBBY_MAX_MS = 10 * 60 * 1000;        // حد أقصى للانتظار
const CHAT_OPEN_DELAY_MS = 20 * 1000;
const WARN_AFTER_OPEN_MS = 30 * 1000;
const DEADLINE_AFTER_OPEN_MS = 60 * 1000;
const RESULT_DELAY_MS = 5 * 1000;

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

const activeHads = Object.create(null);

// ============================================================
// أدوات
// ============================================================

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function safeSend(sock, jid, content, options) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

function stripEmoji(e) {
    return String(e || "").replace(/[\uFE0E\uFE0F\u200d\s]/g, "");
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function getText(msg) {
    const m = msg?.message;
    if (!m) return "";
    return String(m.conversation || m.extendedTextMessage?.text || "").trim();
}

function findUser(db, number) {
    const f = jf.pickByAlias(db.users, number);
    return f ? { key: f.key, user: f.value } : null;
}

function hasNickname(entry) {
    return Boolean(entry && String(entry.user.nickname || "").trim());
}

function formatDate(date) {
    const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    return `${days[date.getDay()]} | ${date.getDate()} | ${months[date.getMonth()]}`;
}

async function lockChat(sock, jid) {
    try { await sock.groupSettingUpdate(jid, "announcement"); return true; } catch (_) { return false; }
}

async function unlockChat(sock, jid) {
    try { await sock.groupSettingUpdate(jid, "not_announcement"); return true; } catch (_) { return false; }
}

function anotherGameActive(jid) {
    try {
        if (require("./menu").activeGames[jid]) return true;
        if (require("./duel").activeCasinos[jid]) return true;
        if (require("./colors").activeColors[jid]) return true;
        if (require("./animals").activeAnimals[jid]) return true;
        if (require("./saraha").activeSaraha[jid]) return true;
        const t = require("./tahmin");
        if (t.activeTahmin && t.activeTahmin[jid]) return true;
    } catch (_) {}
    return false;
}

// ============================================================
// الرسائل
// ============================================================

function explainMessage() {
    return `╗🔵══════شرح═══════🟣╔
بكل بساطة البوت يرسل كرات ملونة
ويجب على كل عضو ان يرسل لون كرة
يشك بأنها الكرة الفائزة... لو ارسل
كرة ولم تكن هي الفائزة سيتم خصم
الرهان الذي يضعه من رصيده....
للمشاركة اكتب:.مشاركة او .اشارك
مثلا:  .مشاركة 50
ملاحظة:  هناك كرة واحد رابحة من بين الكرات التي عددها على نفس
عدد المشاركين...
╝🟡════════════════🟢╚`;
}

function ballsMessage(balls) {
    return `ايها المشاركين الحقو حدسكم:
◆━─━─━─⊱⊰─━─━─━◆
${balls.join(" ")}
◆━─━─━─⊱⊰─━─━─━◆

✧سيتم فتح الشات بعد 20ث... يرجى
ارسال لون الكرة التي تعتقد انها الفائزة
وعندما تصيب سيتم إضافة رهان
الجميع الى رصيدك✧`;
}

function openChatMessage() {
    return `◆━─━─━─⊱⚫⊰─━─━─━◆\nتفضلو وارسلو كرات حدسكم:\n◆━─━─━─⊱⚪⊰─━─━─━◆`;
}

function noThirdMessage(number) {
    return `◆━─━─━─⊱⊰─━─━─━◆
ايها المنشئ @${number}
ارجوك قم بالغاء الفعالية
لانه لم يتم العثور على مشارك
ثالث..  ارسل:  .وقف
لإيقاف هذه الفعالية او يجب
على مشارك ثالث المشاركة وان
لم تغلقها او تكملوها سيتم ايقافها
بعد 75 ثانية وشكرا لكم 🔥
◆━─━─━─⊱⊰─━─━─━◆`;
}

function warnMessage(numbers) {
    return `◆━─━─━─⊱⊰─━─━─━◆
العضو  : ${numbers.map(n => "@" + n).join(" ")}
رجاءا حدد كرة والا سيتم
استبعادك وخصم
رصيدك.  امامك 30 ثانية
◆━─━─━─⊱⊰─━─━─━◆`;
}

function excludedMessage(numbers) {
    return `◆━─━─━─⊱⊰─━─━─━◆\nتم استبعاد ${numbers.map(n => "@" + n).join(" ")}\n◆━─━─━─⊱⊰─━─━─━◆`;
}

function correctBallMessage(ball) {
    return `⚪⫘⫘⫘⫘⫘⫘⫘⫘⚫\nالكرة الصحيحة هي:\n\n*☜ ${ball} ☞*\n\n⚪⫘⫘⫘⫘⫘⫘⫘⫘⚫`;
}

function noWinnerMessage() {
    return `🏆┈┈┈┈┈┈┈┈┈┈┈┈┈🪙
الشخص الذي اصاب حدسه:
جدي...  ههه امزح ولا واحد
منكم = كلكم مخطئين 🙂😂
🪙┈┈┈┈┈┈┈┈┈┈┈┈┈🏆`;
}

function winnersMessage(winners, share) {
    if (winners.length === 1) {
        const w = winners[0];
        return `🏆┈┈┈┈┈┈┈┈┈┈┈┈┈🪙
الشخص الذي اصاب حدسه:
${w.nickname} او: @${w.number}
تم إضافة الرصيد: ${share}
🪙┈┈┈┈┈┈┈┈┈┈┈┈┈🏆`;
    }
    let text = `🏆┈┈┈┈┈┈┈┈┈┈┈┈┈🪙\nالشخص الذي اصاب حدسه:\n`;
    winners.forEach((w, i) => { text += `${i + 1} ${w.nickname} او: @${w.number}\n`; });
    text += `تم إضافة الرصيد: ${share}\n`;
    winners.forEach(w => { text += `${w.nickname}: ${share}\n`; });
    text += `🪙┈┈┈┈┈┈┈┈┈┈┈┈┈🏆`;
    return text;
}

function adMessage(nickname, prize, startTime) {
    return `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{اتبع حدسك}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${prize}$ }*

◇🎖️ آلَفــــــآئــز:
*${nickname}*

◇⏰ بّـــــــدأت:
*{${formatDate(new Date(startTime))}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;
}

// ============================================================
// إنشاء الفعالية
// ============================================================

async function showLoading(sock, jid, msg) {
    const loadingMsg = await safeSend(sock, jid, { text: LOADING_STAGES[0] }, { quoted: msg });
    if (!loadingMsg) return null;
    for (let i = 1; i < LOADING_STAGES.length; i++) {
        await sleep(1000);
        await safeSend(sock, jid, { text: LOADING_STAGES[i], edit: loadingMsg.key });
    }
    return loadingMsg;
}

async function startHads(sock, jid, msg, db, saveDb, cleanSender, senderJid) {
    if (activeHads[jid]) {
        await safeSend(sock, jid, { text: "⚠️ هناك فعالية «اتبع حدسك» قائمة بالفعل في هذه المجموعة!" }, { quoted: msg });
        return true;
    }
    if (anotherGameActive(jid)) {
        await safeSend(sock, jid, { text: "⚠️ هناك فعالية أخرى جارية في هذه المجموعة، انتظر انتهاءها." }, { quoted: msg });
        return true;
    }

    const entry = findUser(db, cleanSender);
    if (!hasNickname(entry)) {
        await safeSend(sock, jid, { text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل لتتمكن من إنشاء الفعالية." }, { quoted: msg });
        return true;
    }

    // نحجز الفعالية قبل التحميل لمنع الإنشاء المتكرر
    const state = {
        type: "hads",
        jid,
        phase: "lobby",
        creator: entry.key,
        creatorNumber: jf.jnum(cleanSender),
        creatorJid: senderJid,
        creatorNickname: entry.user.nickname,
        participants: {},
        balls: [],
        winBall: null,
        escrowed: false,
        settled: false,
        chatLocked: false,
        startTime: Date.now(),
        lastActivity: Date.now(),
        timers: {},
        listener: null,
        isActive: true
    };

    state.stopGame = function (refund = true) {
        if (!activeHads[jid] || activeHads[jid] !== state) return;
        state.isActive = false;
        for (const t of Object.values(state.timers)) clearTimeout(t);
        state.timers = {};
        if (state.listener) {
            try { sock.ev.off("messages.upsert", state.listener); } catch (_) {}
            state.listener = null;
        }
        if (refund && state.escrowed && !state.settled) {
            for (const p of Object.values(state.participants)) {
                const e = findUser(db, p.key);
                if (e) e.user.balance = (Number(e.user.balance) || 0) + p.bet;
            }
            state.settled = true;
            try { saveDb(); } catch (_) {}
        }
        if (state.chatLocked) {
            state.chatLocked = false;
            unlockChat(sock, jid);
        }
        delete activeHads[jid];
    };

    activeHads[jid] = state;

    await showLoading(sock, jid, msg);
    if (!state.isActive) return true;

    await safeSend(sock, jid, { text: explainMessage() });

    // مؤقتات الانتظار
    state.timers.noThird = setTimeout(async () => {
        if (!state.isActive || state.phase !== "lobby") return;
        if (Object.keys(state.participants).length >= MIN_PLAYERS) return;
        await safeSend(sock, jid, {
            text: noThirdMessage(state.creatorNumber),
            mentions: [state.creatorJid]
        });
        state.timers.noThirdStop = setTimeout(async () => {
            if (!state.isActive || state.phase !== "lobby") return;
            if (Object.keys(state.participants).length >= MIN_PLAYERS) return;
            state.stopGame(false);
            await safeSend(sock, jid, { text: "🛑 تم إيقاف فعالية «اتبع حدسك» لعدم اكتمال العدد." });
        }, LOBBY_STOP_AFTER_WARN_MS);
    }, LOBBY_NO_THIRD_MS);

    state.timers.lobbyMax = setTimeout(async () => {
        if (!state.isActive || state.phase !== "lobby") return;
        state.stopGame(false);
        await safeSend(sock, jid, { text: "🛑 تم إيقاف فعالية «اتبع حدسك» بسبب عدم البدء." });
    }, LOBBY_MAX_MS);

    return true;
}

// ============================================================
// المشاركة
// ============================================================

async function joinHads(sock, jid, msg, parts, db, saveDb, cleanSender, senderJid) {
    const state = activeHads[jid];
    if (!state || state.phase !== "lobby") {
        await safeSend(sock, jid, { text: "⚠️ لا توجد فعالية «اتبع حدسك» مفتوحة للمشاركة الآن." }, { quoted: msg });
        return true;
    }

    const entry = findUser(db, cleanSender);
    if (!hasNickname(entry)) {
        await safeSend(sock, jid, { text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل لتتمكن من المشاركة." }, { quoted: msg });
        return true;
    }

    if (state.participants[entry.key]) {
        await safeSend(sock, jid, { text: "⚠️ أنت مشارك بالفعل في هذه الفعالية." }, { quoted: msg });
        return true;
    }

    if (Object.keys(state.participants).length >= MAX_PLAYERS) {
        await safeSend(sock, jid, { text: `⚠️ اكتمل العدد الأقصى (${MAX_PLAYERS} مشاركين).` }, { quoted: msg });
        return true;
    }

    const raw = String(parts[0] || "").replace(/[,$]/g, "").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const bet = parseInt(raw, 10);
    if (!Number.isSafeInteger(bet) || bet <= 0) {
        await safeSend(sock, jid, { text: "⚠️ اكتب مبلغ الرهان، مثال: .مشاركة 50" }, { quoted: msg });
        return true;
    }

    const balance = Number(entry.user.balance) || 0;
    if (balance < bet) {
        await safeSend(sock, jid, {
            text: `╗════════⛔════════╔\n     لا تملك رصيد كافي للرهان\n\n   رصيدك الحالي: \`${balance}$\`\n\n╝════════🚫════╚`
        }, { quoted: msg });
        return true;
    }

    state.participants[entry.key] = {
        key: entry.key,
        number: jf.jnum(cleanSender),
        jid: senderJid,
        nickname: entry.user.nickname,
        bet,
        choice: null,
        lastAction: Date.now()
    };
    state.lastActivity = Date.now();

    const count = Object.keys(state.participants).length;
    await safeSend(sock, jid, {
        text: `✅ تم تسجيل مشاركة [${entry.user.nickname}] برهان ${bet}$\n👥 المشاركون: ${count}/${MAX_PLAYERS}`
    }, { quoted: msg });

    // وصل ثالث مشارك → نلغي مؤقت الإيقاف بسبب النقص
    if (count >= MIN_PLAYERS && state.timers.noThirdStop) {
        clearTimeout(state.timers.noThirdStop);
        state.timers.noThirdStop = null;
    }
    return true;
}

// ============================================================
// البدء
// ============================================================

async function beginHads(sock, jid, msg, db, saveDb, cleanSender, owner) {
    const state = activeHads[jid];
    if (!state || state.phase !== "lobby") {
        await safeSend(sock, jid, { text: "⚠️ لا توجد فعالية «اتبع حدسك» جاهزة للبدء." }, { quoted: msg });
        return true;
    }

    const isCreator = jf.sameUser(state.creatorNumber, cleanSender);
    if (!isCreator && !owner) {
        await safeSend(sock, jid, { text: "⚠️ منشئ الفعالية فقط يمكنه بدء اللعبة." }, { quoted: msg });
        return true;
    }

    const players = Object.values(state.participants);
    if (players.length < MIN_PLAYERS) {
        await safeSend(sock, jid, {
            text: `⚠️ لا يمكن البدء قبل وجود ${MIN_PLAYERS} مشاركين على الأقل.\n👥 المشاركون الآن: ${players.length}`
        }, { quoted: msg });
        return true;
    }

    // التأكد من الأرصدة
    for (const p of players) {
        const e = findUser(db, p.key);
        if (!e || (Number(e.user.balance) || 0) < p.bet) {
            await safeSend(sock, jid, {
                text: `⚠️ لا يمكن البدء لأن رصيد أحد المشاركين لم يعد كافياً: [${p.nickname}]`
            }, { quoted: msg });
            return true;
        }
    }

    // نبدأ
    state.phase = "starting";
    for (const t of ["noThird", "noThirdStop", "lobbyMax"]) {
        if (state.timers[t]) { clearTimeout(state.timers[t]); state.timers[t] = null; }
    }

    // خصم الرهانات (تُحجز حتى انتهاء الجولة)
    for (const p of players) {
        const e = findUser(db, p.key);
        e.user.balance = (Number(e.user.balance) || 0) - p.bet;
    }
    state.escrowed = true;
    saveDb();

    // الكرات بعدد المشاركين
    state.balls = shuffle(ALL_BALLS).slice(0, players.length);
    state.winBall = state.balls[Math.floor(Math.random() * state.balls.length)];

    // قفل الشات + القائمة
    state.chatLocked = await lockChat(sock, jid);
    await safeSend(sock, jid, { text: ballsMessage(state.balls) });

    // مستمع الاختيارات
    const ballKeys = new Map(state.balls.map(b => [stripEmoji(b), b]));
    const listener = async (upsert) => {
        try {
            if (!state.isActive || state.phase !== "choosing") return;
            for (const m of upsert?.messages || []) {
                if (!m?.message || m.key?.fromMe) continue;
                if (m.key?.remoteJid !== jid) continue;

                const txt = stripEmoji(getText(m));
                if (!txt || !ballKeys.has(txt)) continue;

                const senderNum = jf.jnum(m.key.participant || "");
                const p = Object.values(state.participants).find(x => jf.sameUser(x.number, senderNum) || jf.sameUser(x.key, senderNum));
                if (!p || p.excluded) continue;
                if (p.choice) continue; // الاختيار الأول نهائي

                p.choice = ballKeys.get(txt);
                p.lastAction = Date.now();
                state.lastActivity = Date.now();

                await safeSend(sock, jid, { text: "√ تم تسجيل اختيارك √" }, { quoted: m });

                if (Object.values(state.participants).every(x => x.choice || x.excluded)) {
                    await finishHads(sock, jid, db, saveDb, state);
                    return;
                }
            }
        } catch (e) {
            console.error("❌ hads listener:", e?.message || e);
        }
    };
    state.listener = listener;
    sock.ev.on("messages.upsert", listener);

    // بعد 20 ثانية نفتح الشات
    state.timers.open = setTimeout(async () => {
        if (!state.isActive) return;
        state.phase = "choosing";
        if (state.chatLocked) {
            await unlockChat(sock, jid);
            state.chatLocked = false;
        }
        await safeSend(sock, jid, { text: openChatMessage() });
        state.lastActivity = Date.now();

        // تحذير عند 30 ثانية
        state.timers.warn = setTimeout(async () => {
            if (!state.isActive || state.phase !== "choosing") return;
            const lazy = Object.values(state.participants).filter(x => !x.choice && !x.excluded);
            if (!lazy.length) return;
            await safeSend(sock, jid, {
                text: warnMessage(lazy.map(x => x.number)),
                mentions: lazy.map(x => x.jid)
            });
        }, WARN_AFTER_OPEN_MS);

        // نهاية المهلة عند 60 ثانية
        state.timers.deadline = setTimeout(async () => {
            if (!state.isActive || state.phase !== "choosing") return;
            const lazy = Object.values(state.participants).filter(x => !x.choice && !x.excluded);
            if (lazy.length) {
                state.chatLocked = await lockChat(sock, jid);
                lazy.forEach(x => { x.excluded = true; });
                await safeSend(sock, jid, {
                    text: excludedMessage(lazy.map(x => x.number)),
                    mentions: lazy.map(x => x.jid)
                });
            }
            await finishHads(sock, jid, db, saveDb, state);
        }, DEADLINE_AFTER_OPEN_MS);
    }, CHAT_OPEN_DELAY_MS);

    state.phase = "choosing_wait";
    // الاستماع يبدأ عند فتح الشات: نضبط الحالة عند الفتح
    // (المستمع يتحقق من phase === "choosing")
    return true;
}

// ============================================================
// إنهاء الجولة وإعلان النتيجة
// ============================================================

async function finishHads(sock, jid, db, saveDb, state) {
    if (!state.isActive || state.phase === "resolving") return;
    state.phase = "resolving";
    for (const t of ["open", "warn", "deadline"]) {
        if (state.timers[t]) { clearTimeout(state.timers[t]); state.timers[t] = null; }
    }
    if (state.listener) {
        try { sock.ev.off("messages.upsert", state.listener); } catch (_) {}
        state.listener = null;
    }

    try {
        // قفل الشات ثم انتظار 5 ثواني
        state.chatLocked = (await lockChat(sock, jid)) || state.chatLocked;
        await sleep(RESULT_DELAY_MS);

        await safeSend(sock, jid, { text: correctBallMessage(state.winBall) });
        await sleep(1500);

        const players = Object.values(state.participants);
        const pool = players.reduce((s, p) => s + p.bet, 0);
        const winners = players.filter(p => !p.excluded && p.choice === state.winBall);

        if (winners.length === 0) {
            await safeSend(sock, jid, { text: noWinnerMessage() });
        } else {
            const share = Math.floor(pool / winners.length);
            for (const w of winners) {
                const e = findUser(db, w.key);
                if (e) e.user.balance = (Number(e.user.balance) || 0) + share;
            }
            state.settled = true;
            saveDb();

            await safeSend(sock, jid, {
                text: winnersMessage(winners, share),
                mentions: winners.map(w => w.jid)
            });

            // استمارة فوز في قروب الإعلانات (استمارة لكل فائز)
            for (const adJid of Object.keys(db.adsGroups || {})) {
                if (!db.adsGroups[adJid]) continue;
                for (const w of winners) {
                    await safeSend(sock, adJid, { text: adMessage(w.nickname, share, state.startTime) });
                    await sleep(500);
                }
            }
        }
        state.settled = true;
        saveDb();
    } catch (e) {
        console.error("❌ finishHads:", e?.message || e);
    } finally {
        // فتح الشات دائماً في النهاية
        state.chatLocked = false;
        await unlockChat(sock, jid);
        // إذا حدث خطأ قبل التسوية نُرجع الرهانات لأصحابها
        state.stopGame(!state.settled);
    }
}

// ============================================================
// إيقاف
// ============================================================

async function stopHads(sock, jid, msg, cleanSender, owner) {
    const state = activeHads[jid];
    if (!state) return false; // ليس لنا، ندع بقية الأوامر تتعامل مع .وقف

    const isCreator = jf.sameUser(state.creatorNumber, cleanSender);
    const gp = (global.db && Array.isArray(global.db.gamePermissions)) ? global.db.gamePermissions : [];
    const hasGamePerm = jf.aliasesOf(cleanSender).some(a => gp.includes(a));
    if (!isCreator && !owner && !hasGamePerm) {
        await safeSend(sock, jid, { text: "⚠️ منشئ الفعالية فقط يمكنه إيقافها." }, { quoted: msg });
        return true;
    }
    state.stopGame(true);
    await safeSend(sock, jid, { text: "🛑 تم إيقاف فعالية «اتبع حدسك»." + (state.escrowed ? "\n💰 تمت إعادة الرهانات لأصحابها." : "") }, { quoted: msg });
    return true;
}

// ============================================================
// المعالج الرئيسي للأوامر
// ============================================================

/**
 * @returns {Promise<boolean>} true إذا تمت المعالجة
 */
async function handleHadsCommand(sock, jid, msg, command, parts, db, saveDb, cleanSender, senderJid, owner) {
    const cmd = String(command || "").replace(/[أإآ]/g, "ا");

    if (cmd === "اتبع") {
        const sub = String(parts[0] || "").replace(/[أإآ]/g, "ا");
        if (sub !== "حدسك") return false;
        return startHads(sock, jid, msg, db, saveDb, cleanSender, senderJid);
    }

    // الأوامر الأخرى تعمل فقط إذا كانت هناك فعالية في القروب
    if (!activeHads[jid]) return false;

    if (cmd === "مشاركة" || cmd === "اشارك" || cmd === "شارك") {
        return joinHads(sock, jid, msg, parts, db, saveDb, cleanSender, senderJid);
    }
    if (cmd === "بدا" || cmd === "ابدا" || cmd === "ابدأ" || cmd === "بدأ") {
        // `.بدأ الرهان` تخص الروليت
        if (String(parts[0] || "") === "الرهان") return false;
        return beginHads(sock, jid, msg, db, saveDb, cleanSender, owner);
    }
    if (cmd === "وقف") {
        return stopHads(sock, jid, msg, cleanSender, owner);
    }
    return false;
}

function isHadsActive(jid) {
    return Boolean(activeHads[jid] && activeHads[jid].isActive);
}

function stopHadsGame(jid) {
    const g = activeHads[jid];
    if (g) { g.stopGame(true); return true; }
    return false;
}

module.exports = {
    activeHads,
    handleHadsCommand,
    isHadsActive,
    stopHadsGame,
    ALL_BALLS
};
