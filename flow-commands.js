// ============================================================
// flow-commands.js
// ALJESAT BOT — أوامر التسجيل التفاعلي (Multi-Bot)
//
//   .جديد @user      → ينشئ جلسة + يرسل النص + البطاقة (يحتاج .سماح 2)
//   .عيد @user       → يمسح التسجيل والجلسة (يحتاج .سماح 1)
//
// يعتمد على flow-server.js (نفس العملية).
// ============================================================

"use strict";

const flowServer = require("./flow-server");

// ============================================================
// إعدادات
// ============================================================

const CFG = {
    // المستويات التي تستطيع استخدام .جديد (فقط .سماح 2 والمالك)
    REGISTER_LEVELS: ["2"],

    // المستويات التي تستطيع استخدام .عيد
    RESET_LEVELS: ["1", "5"],

    // اسم الأمر (للعرض)
    REGISTER_PERM_NAME: ".سماح 2",
    RESET_PERM_NAME: ".سماح 1",

    // موقع GitHub Pages (ثابت)
    GITHUB_PAGES_URL: "https://katabump8000-beep.github.io/BOT"
};

// ============================================================
// أدوات
// ============================================================

const log = (...a) => { try { console.log("[flow-cmd]", ...a); } catch (_) {} };
const logErr = (...a) => { try { console.error("[flow-cmd]", ...a); } catch (_) {} };

function cleanNumber(v) {
    return String(v || "").replace(/\D/g, "");
}

function safeSend(sock, jid, content, options) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch((e) => {
        logErr("sendMessage:", e?.message || e);
        return null;
    });
}

function getMentionedJids(msg) {
    try {
        const m = msg?.message || {};
        const inner =
            m.extendedTextMessage ||
            m.imageMessage ||
            m.videoMessage ||
            m.documentMessage ||
            {};
        const ctx = inner.contextInfo || m.contextInfo || {};
        if (Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length) {
            return ctx.mentionedJid;
        }
        if (ctx.participant && ctx.quotedMessage) {
            return [ctx.participant];
        }
    } catch (_) {}
    return [];
}

function jnum(jid) {
    if (!jid) return "";
    const s = String(jid);
    const at = s.indexOf("@");
    const user = (at === -1 ? s : s.slice(0, at)).split(":")[0];
    return user.replace(/\D/g, "");
}

function hasPermission(db, userNumber, levels, isOwner) {
    if (isOwner) return true;
    if (!db || !db.permissions) return false;

    const n = cleanNumber(userNumber);
    if (!n) return false;

    let aliases = [n];
    try {
        const jf = require("./jidfix");
        aliases = jf.aliasesOf(n);
    } catch (_) {}

    for (const level of levels) {
        const list = db.permissions[level];
        if (Array.isArray(list) && aliases.some(a => list.includes(a))) {
            return true;
        }
    }
    return false;
}

// ============================================================
// إرسال البطاقة التفاعلية
// ============================================================

async function sendFlowCard(sock, jid, url, mentionedJid, quoted) {
    try {
        let sendInteractiveMessage = null;
        try {
            const qbtns = require("@qadeerxtech/qadeer-btns");
            sendInteractiveMessage = qbtns?.sendInteractiveMessage;
        } catch (_) {}

        if (typeof sendInteractiveMessage === "function") {
            await sendInteractiveMessage(sock, jid, {
                text:
                    "🔥 *𝑭. 𝑰. 𝑹* 🔥\n" +
                    "━━━━━━━━━━━━━━━\n\n" +
                    "📝 *نموذج التسجيل*\n\n" +
                    "اضغط على الزر بالأسفل\n" +
                    "لملء بياناتك والانضمام للمملكة\n\n" +
                    "⚠️ الرابط مخصص لك وحدك.\n" +
                    "━━━━━━━━━━━━━━━",
                footer: "𝑭. 𝑰. 𝑹 🔥",
                interactiveButtons: [
                    {
                        name: "cta_url",
                        buttonParamsJson: JSON.stringify({
                            display_text: "🔥 التسجيل",
                            url: url,
                            merchant_url: url
                        })
                    }
                ]
            });
            return true;
        }

        const { generateWAMessageFromContent } = require("@whiskeysockets/baileys");

        const interactiveMessage = {
            body: {
                text:
                    "🔥 *𝑭. 𝑰. 𝑹* 🔥\n" +
                    "━━━━━━━━━━━━━━━\n\n" +
                    "📝 *نموذج التسجيل*\n\n" +
                    "اضغط على الزر بالأسفل\n" +
                    "لملء بياناتك والانضمام للمملكة\n\n" +
                    "⚠️ الرابط مخصص لك وحدك.\n" +
                    "━━━━━━━━━━━━━━━"
            },
            footer: { text: "𝑭. 𝑰. 𝑹 🔥" },
            header: { hasMediaAttachment: false },
            nativeFlowMessage: {
                buttons: [
                    {
                        name: "cta_url",
                        buttonParamsJson: JSON.stringify({
                            display_text: "🔥 التسجيل",
                            url: url,
                            merchant_url: url
                        })
                    }
                ]
            },
            contextInfo: mentionedJid ? { mentionedJid } : {}
        };

        const msg = generateWAMessageFromContent(
            jid,
            { interactiveMessage },
            { userJid: sock.user.id, quoted }
        );

        await sock.relayMessage(jid, msg.message, {
            messageId: msg.key.id
        });

        return true;

    } catch (e) {
        logErr("sendFlowCard:", e?.message || e);
        return false;
    }
}

// ============================================================
// أمر .جديد
// ============================================================

async function handleNewCommand(sock, jid, msg, db, saveDb, cleanSender, isOwner) {
    // 1) فحص الصلاحية (فقط .سماح 2)
    if (!hasPermission(db, cleanSender, CFG.REGISTER_LEVELS, isOwner)) {
        await safeSend(sock, jid, {
            text: `⛔ ليس لديك صلاحية لاستخدام أمر .جديد (يحتاج ${CFG.REGISTER_PERM_NAME}).`
        }, { quoted: msg });
        return true;
    }

    // 2) فحص المنشن
    const mentions = getMentionedJids(msg);
    if (!mentions.length) {
        await safeSend(sock, jid, {
            text: "⚠️ يرجى عمل Mention للعضو الجديد.\nمثال: .جديد @user"
        }, { quoted: msg });
        return true;
    }

    const targetJid = mentions[0];
    const targetNumber = jnum(targetJid);

    if (!targetNumber || targetNumber.length < 6) {
        await safeSend(sock, jid, {
            text: "⚠️ رقم العضو غير صالح."
        }, { quoted: msg });
        return true;
    }

    // 3) تسجيل JID في jidfix
    try {
        const jf = require("./jidfix");
        jf.rememberJid(targetNumber, targetJid, true);
    } catch (_) {}

    // 4) فحص التسجيل المسبق
    if (db && db.users) {
        const aliases = (() => {
            try { return require("./jidfix").aliasesOf(targetNumber); }
            catch (_) { return [targetNumber]; }
        })();

        for (const a of aliases) {
            const u = db.users[a];
            if (u && String(u.nickname || "").trim()) {
                await safeSend(sock, jid, {
                    text: `❌ العضو @${targetNumber} مسجل في مملكة النار بالفعل.\n\nإذا أردت إعادة تسجيله، استعمل:\n.عيد @`,
                    mentions: [targetJid]
                }, { quoted: msg });
                return true;
            }
        }
    }

    // 5) قراءة PUBLIC_URL (رابط البوت الحالي)
    const publicUrl = String(process.env.PUBLIC_URL || "").trim().replace(/\/$/, "");
    if (!publicUrl) {
        await safeSend(sock, jid, {
            text: "⚠️ خطأ في الإعداد: PUBLIC_URL غير محدد في Railway Variables.\nأبلغ المشرف."
        }, { quoted: msg });
        return true;
    }

    // 6) قراءة GROUP_URL
    const groupUrl = String(process.env.GROUP_URL || "").trim();

    // 7) إنشاء الجلسة
    const session = flowServer.createSession({
        targetUserId: targetNumber,
        targetJid: targetJid,
        chatJid: jid,
        createdBy: cleanSender,
        groupUrl
    });

    // 8) بناء رابط التسجيل (Multi-Bot: مع api parameter)
    const registerUrl = `${CFG.GITHUB_PAGES_URL}/?token=${session.token}&api=${encodeURIComponent(publicUrl)}`;

    // 9) الرسالة الأولى: النص مع المنشن
    await safeSend(sock, jid, {
        text:
            "🔥 *𝑭. 𝑰. 𝑹* 🔥\n" +
            "━━━━━━━━━━━━━━━\n\n" +
            `العضو @${targetNumber}\n` +
            "رجاءاً قم بتسجيل بياناتك:\n" +
            "━━━━━━━━━━━━━━━",
        mentions: [targetJid]
    }, { quoted: msg });

    // 10) الرسالة الثانية: البطاقة التفاعلية
    const ok = await sendFlowCard(sock, jid, registerUrl, [targetJid]);

    if (!ok) {
        await safeSend(sock, jid, {
            text:
                "⚠️ تعذّر إرسال البطاقة التفاعلية.\n\n" +
                `🔗 افتح رابط التسجيل:\n${registerUrl}`,
            mentions: [targetJid]
        });
    }

    log(`📨 جلسة جديدة: ${targetNumber} (api=${publicUrl})`);
    return true;
}

// ============================================================
// أمر .عيد  (بدل .تصفير)
// ============================================================

async function handleResetCommand(sock, jid, msg, db, saveDb, cleanSender, isOwner) {
    if (!hasPermission(db, cleanSender, CFG.RESET_LEVELS, isOwner)) {
        await safeSend(sock, jid, {
            text: `⛔ ليس لديك صلاحية لاستخدام أمر .عيد (يحتاج ${CFG.RESET_PERM_NAME}).`
        }, { quoted: msg });
        return true;
    }

    const mentions = getMentionedJids(msg);
    if (!mentions.length) {
        await safeSend(sock, jid, {
            text: "⚠️ يرجى عمل Mention للعضو.\nمثال: .عيد @user"
        }, { quoted: msg });
        return true;
    }

    const targetJid = mentions[0];
    const targetNumber = jnum(targetJid);

    if (!targetNumber) {
        await safeSend(sock, jid, {
            text: "⚠️ رقم العضو غير صالح."
        }, { quoted: msg });
        return true;
    }

    // حماية: عدم تصفير الجهات العليا
    if (!isOwner) {
        const protectedLevels = ["1", "3", "4", "5"];
        const perms = db?.permissions || {};
        const aliases = (() => {
            try { return require("./jidfix").aliasesOf(targetNumber); }
            catch (_) { return [targetNumber]; }
        })();

        for (const lvl of protectedLevels) {
            const list = perms[lvl];
            if (Array.isArray(list) && aliases.some(a => list.includes(a))) {
                await safeSend(sock, jid, {
                    text:
                        "❆━━━━━═⏣⊰⛔⊱⏣═━━━━━❆\n" +
                        "*لا يمكنك تصفير تسجيل* `الجهات العليا`\n" +
                        "❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆"
                }, { quoted: msg });
                return true;
            }
        }
    }

    if (!db) db = {};
    if (!db.users) db.users = {};

    let removedNickname = "";
    const aliases = (() => {
        try { return require("./jidfix").aliasesOf(targetNumber); }
        catch (_) { return [targetNumber]; }
    })();

    for (const a of aliases) {
        const u = db.users[a];
        if (u && String(u.nickname || "").trim()) {
            if (!removedNickname) removedNickname = u.nickname;
            u.nickname = "";
            delete u.gender;
            delete u.age;
            delete u.referredBy;
            delete u.registeredAt;
            delete u.registrationDate;
        }
    }

    // حذف الجلسات النشطة
    try {
        const internals = flowServer._internals;
        if (internals && internals.sessionsByUser) {
            const token = internals.sessionsByUser.get(targetNumber);
            if (token) {
                internals.sessions.delete(token);
                internals.sessionsByUser.delete(targetNumber);
            }
        }
    } catch (_) {}

    try {
        if (typeof saveDb === "function") saveDb();
    } catch (_) {}

    await safeSend(sock, jid, {
        text:
            "♻️◈══════════════◈♻️\n" +
            `✅ تم تصفير تسجيل @${targetNumber}\n` +
            (removedNickname ? `🏷️ اللقب السابق: [${removedNickname}]\n` : "") +
            "\nيمكنه التسجيل من جديد عبر:\n" +
            ".جديد @\n" +
            "(رصيده ورتبته محفوظان)\n" +
            "♻️◈══════════════◈♻️",
        mentions: [targetJid]
    }, { quoted: msg });

    log(`♻️ تم تصفير ${targetNumber}`);
    return true;
}

// ============================================================
// المعالج الرئيسي
// ============================================================

async function handleFlowCommand(sock, jid, msg, text, db, saveDb, cleanSender, isOwner) {
    if (typeof text !== "string" || !text.startsWith(".")) return false;

    const m = text.trim().match(/^\.\s*(\S+)/);
    if (!m) return false;

    const cmd = m[1];

    if (cmd === "جديد") {
        try {
            return await handleNewCommand(sock, jid, msg, db, saveDb, cleanSender, isOwner);
        } catch (e) {
            logErr("handleNewCommand:", e?.message || e);
            await safeSend(sock, jid, {
                text: "⚠️ حدث خطأ أثناء إنشاء جلسة التسجيل."
            }, { quoted: msg });
            return true;
        }
    }

    if (cmd === "عيد") {
        try {
            return await handleResetCommand(sock, jid, msg, db, saveDb, cleanSender, isOwner);
        } catch (e) {
            logErr("handleResetCommand:", e?.message || e);
            await safeSend(sock, jid, {
                text: "⚠️ حدث خطأ أثناء تصفير التسجيل."
            }, { quoted: msg });
            return true;
        }
    }

    return false;
}

// ============================================================
// التصدير
// ============================================================

module.exports = {
    handleFlowCommand,
    handleNewCommand,
    handleResetCommand,
    _sendFlowCard: sendFlowCard
};
