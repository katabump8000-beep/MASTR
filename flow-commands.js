// ============================================================
// flow-commands.js
// ALJESAT BOT — أوامر التسجيل التفاعلي (Multi-Bot)
//
//   .جديد @user      → منشن + زر «التالي»؛ الضغط من العضو المقصود يرسل له زر التسجيل (يحتاج .سماح 2)
//   .عيد @user       → يمسح التسجيل والجلسة (يحتاج .سماح 1)
//
// يعتمد على flow-server.js (نفس العملية).
// 🔒 الهوية: تُؤخذ من واتساب نفسه عند ضغط الزر (لا كود يدوي)
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

    // موقع GitHub Pages (الافتراضي) — يمكن تغييره من Railway عبر REG_PAGE_URL
    GITHUB_PAGES_URL: "https://katabump8000-beep.github.io/BOT"
};

function pageBaseUrl() {
    const custom = String(process.env.REG_PAGE_URL || "").trim();
    return (custom || CFG.GITHUB_PAGES_URL).replace(/\/+$/, "");
}

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
    const body =
        "🔥 *𝑭. 𝑰. 𝑹* 🔥\n" +
        "━━━━━━━━━━━━━━━\n" +
        "رجاءً سجّل بياناتك هنا 👇\n" +
        "━━━━━━━━━━━━━━━";
    try {
        const { sendInteractiveMessage } = require("@qadeerxtech/qadeer-btns");
        await sendInteractiveMessage(sock, jid, {
            text: body,
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
    } catch (e) {
        logErr("sendFlowCard:", e?.message || e);
        return false;
    }
}

/** زر «التالي» (quick_reply) — الضغط عليه يصل للبوت مع هوية الضاغط الحقيقية */
async function sendNextButton(sock, jid, token) {
    try {
        const { sendInteractiveMessage } = require("@qadeerxtech/qadeer-btns");
        await sendInteractiveMessage(sock, jid, {
            text: "🔥 *𝑭. 𝑰. 𝑹* 🔥\nللتسجيل اضغط «التالي»",
            footer: "𝑭. 𝑰. 𝑹 🔥",
            interactiveButtons: [
                {
                    name: "quick_reply",
                    buttonParamsJson: JSON.stringify({
                        display_text: "التالي ➡️",
                        id: "flowgo|" + token
                    })
                }
            ]
        });
        return true;
    } catch (e) {
        logErr("sendNextButton:", e?.message || e);
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
    // 🛠️ نأخذ الـ origin فقط (يصلح الخطأ لو لُصق مسار مثل /api/flow/health داخل PUBLIC_URL)
    let publicUrl = String(process.env.PUBLIC_URL || "").trim();
    try { publicUrl = new URL(publicUrl).origin; } catch (_) { publicUrl = publicUrl.replace(/\/$/, ""); }
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

    // 8) الرسالة الأولى: منشن + «اضغط على الزر»
    await safeSend(sock, jid, {
        text: `@${targetNumber}\nاضغط على الزر 👇`,
        mentions: [targetJid]
    }, { quoted: msg });

    // 9) الرسالة الثانية: زر «التالي»
    const ok = await sendNextButton(sock, jid, session.token);
    if (!ok) {
        await safeSend(sock, jid, {
            text: `⚠️ تعذّر إظهار الزر.\n@${targetNumber} اكتب: *.التالي*`,
            mentions: [targetJid]
        });
    }

    log(`📨 جلسة جديدة: ${targetNumber} (api=${publicUrl})`);
    return true;
}

// ============================================================
// ضغط «التالي»: هوية الضاغط تأتي من واتساب نفسه (لا يمكن تزويرها)
// ============================================================

const lastPress = new Map();      // number -> time (منع الضغط السريع)
const rejectedOnce = new Set();   // "token|number" — الرفض يظهر مرة واحدة فقط

function registerOrigin() {
    let u = String(process.env.PUBLIC_URL || "").trim();
    try { u = new URL(u).origin; } catch (_) { u = u.replace(/\/$/, ""); }
    return u;
}

function bareJid(j) {
    // 966500000001:12@s.whatsapp.net → 966500000001@s.whatsapp.net
    const s = String(j || "");
    const at = s.indexOf("@");
    if (at === -1) return s;
    return s.slice(0, at).split(":")[0] + s.slice(at);
}

/** يرسل بطاقة التسجيل ويلتقط مفتاح الرسالة (لحذفها فور فتح الصفحة) */
async function sendCardCaptured(sock, dest, url, code) {
    let captured = null;
    const origRelay = sock.relayMessage;
    const origSend = sock.sendMessage;
    const has = (x) => { try { return JSON.stringify(x).includes(code); } catch (_) { return false; } };

    const wrapRelay = async function (j, m, opts) {
        if (!captured && j === dest && has(m) && opts && opts.messageId) captured = { jid: j, id: opts.messageId };
        return origRelay.apply(this, arguments);
    };
    const wrapSend = async function (j, c) {
        const r = await origSend.apply(this, arguments);
        if (!captured && j === dest && r && r.key && r.key.id && has(c)) captured = { jid: j, id: r.key.id };
        return r;
    };
    if (typeof origRelay === "function") sock.relayMessage = wrapRelay;
    sock.sendMessage = wrapSend;

    let ok = false;
    try {
        ok = await sendFlowCard(sock, dest, url, null);
    } finally {
        if (sock.relayMessage === wrapRelay) sock.relayMessage = origRelay;
        if (sock.sendMessage === wrapSend) sock.sendMessage = origSend;
    }
    return { ok, card: captured };
}

/** مرشحو الخاص: JID الضاغط كما وصل + صيغة الرقم الصريح */
function dmCandidates(presserJid, presser) {
    const out = [];
    if (presserJid) out.push(bareJid(presserJid));
    try {
        const al = require("./jidfix").aliasesOf(presser) || [];
        for (const a of al) {
            const n = cleanNumber(a);
            if (n.length >= 8 && n.length <= 15) out.push(n + "@s.whatsapp.net");
        }
    } catch (_) {}
    return [...new Set(out)];
}

async function processNext(sock, jid, msg, db, cleanSender, token) {
    const presser = cleanNumber(cleanSender);
    const presserJid = msg?.key?.participant || (presser ? presser + "@s.whatsapp.net" : "");

    const s = flowServer.getSession(token);
    if (!s) {
        await safeSend(sock, jid, {
            text: "⌛ انتهت صلاحية هذه الجلسة. اطلب من المشرف: .جديد @ من جديد."
        }, { quoted: msg });
        return true;
    }

    let jf = null;
    try { jf = require("./jidfix"); } catch (_) {}
    const isTarget =
        (s.targetJid && bareJid(s.targetJid) === bareJid(presserJid)) ||
        (jf ? jf.sameUser(s.targetUserId, presser) : cleanNumber(s.targetUserId) === presser);

    // ❌ غير المقصود: «تعذّر الضغط» مرة واحدة فقط، وبعدها يُتجاهل بصمت. ولا يُعطى أي رابط.
    if (!isTarget) {
        const rk = token + "|" + presser;
        if (rejectedOnce.has(rk)) return true;
        rejectedOnce.add(rk);
        if (rejectedOnce.size > 5000) rejectedOnce.clear();

        try { await sock.sendMessage(jid, { react: { text: "❌", key: msg.key } }); } catch (_) {}
        await safeSend(sock, jid, {
            text: `⛔ تعذّر الضغط @${presser}\nهذا الزر ليس لك، أنت لست العضو المقصود تسجيله.`,
            mentions: presserJid ? [presserJid] : []
        }, { quoted: msg });
        log(`🚫 ضغط من غير المقصود: ${presser} (الجلسة لـ ${s.targetUserId})`);
        return true;
    }

    // منع الضغط المتكرر السريع من المقصود
    const t = Date.now();
    if (t - (lastPress.get(presser) || 0) < 2500) return true;
    lastPress.set(presser, t);
    if (lastPress.size > 2000) lastPress.clear();

    // مسجل مسبقاً؟
    try {
        if (flowServer._internals.isRegistered(db, s.targetUserId)) {
            await safeSend(sock, jid, { text: "✅ أنت مسجل في مملكة النار بالفعل." }, { quoted: msg });
            return true;
        }
    } catch (_) {}

    // ✅ المقصود: كود جديد خاص به (يُبطل القديم)
    const claim = flowServer.issueClaim({ token, presserNumber: presser, isTarget: true });
    if (!claim) {
        await safeSend(sock, jid, { text: "⌛ انتهت صلاحية الجلسة." }, { quoted: msg });
        return true;
    }
    try { await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } }); } catch (_) {}

    const origin = registerOrigin();
    const url = `${pageBaseUrl()}/?c=${claim.code}&api=${encodeURIComponent(origin)}`;

    // 🔒 الافتراضي: البطاقة تصل للعضو في الخاص فقط، فلا يراها أحد غيره.
    //    REG_PRIVATE=0 → ترسل في القروب (مع حذفها فور فتح الصفحة).
    const wantPrivate = String(process.env.REG_PRIVATE || "1") !== "0";

    let delivered = false;
    if (wantPrivate) {
        for (const dm of dmCandidates(presserJid, presser)) {
            const r = await sendCardCaptured(sock, dm, url, claim.code);
            if (r.ok) {
                if (r.card) flowServer.setClaimCard(claim.code, r.card);
                delivered = true;
                await safeSend(sock, jid, {
                    text: `✅ @${presser} أرسلنا لك رابط التسجيل في الخاص 📩\n(إن لم يصلك اضغط «التالي» مرة أخرى)`,
                    mentions: presserJid ? [presserJid] : []
                }, { quoted: msg });
                break;
            }
            // الزر التفاعلي غير متاح → نص عادي في الخاص (يبقى سرياً)
            const plain = await safeSend(sock, dm, { text: "🔥 رجاءً سجّل بياناتك هنا 👇\n" + url });
            if (plain) {
                delivered = true;
                await safeSend(sock, jid, {
                    text: `✅ @${presser} أرسلنا لك رابط التسجيل في الخاص 📩\n(إن لم يصلك اضغط «التالي» مرة أخرى)`,
                    mentions: presserJid ? [presserJid] : []
                }, { quoted: msg });
                break;
            }
        }
    }

    if (!delivered) {
        // الخاص غير ممكن (أو REG_PRIVATE=0) → في القروب
        const r = await sendCardCaptured(sock, jid, url, claim.code);
        if (r.card) flowServer.setClaimCard(claim.code, r.card);
        if (!r.ok) await safeSend(sock, jid, { text: "🔗 رابط التسجيل:\n" + url });
    }

    log(`✅ ضغط صحيح من ${presser} → كود ${claim.code.slice(0, 6)}... (${delivered ? "خاص" : "قروب"})`);
    return true;
}

/** يُستدعى من flowreg.handleInteractive عند وصول زر لا يخص نظام flowreg القديم */
async function handleFlowButton(sock, jid, msg, db, saveDb, cleanSender, id) {
    const sid = String(id || "");
    if (!sid.startsWith("flowgo|")) return false;
    try {
        await processNext(sock, jid, msg, db, cleanSender, sid.split("|")[1] || "");
    } catch (e) {
        logErr("handleFlowButton:", e?.message || e);
    }
    return true;
}

/** بديل نصي: .التالي (لو لم يظهر الزر عند العضو) */
async function handleNextText(sock, jid, msg, db, cleanSender) {
    let aliases = [cleanNumber(cleanSender)];
    try { aliases = require("./jidfix").aliasesOf(cleanNumber(cleanSender)); } catch (_) {}

    const internals = flowServer._internals;
    let token = "";
    for (const a of aliases) {
        const tk = internals.sessionsByUser.get(a);
        if (tk) { token = tk; break; }
    }
    if (!token) {
        await safeSend(sock, jid, { text: "⚠️ لا توجد جلسة تسجيل مخصصة لك. اطلب من المشرف: .جديد @" }, { quoted: msg });
        return true;
    }
    return processNext(sock, jid, msg, db, cleanSender, token);
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

    if (cmd === "التالي") {
        try {
            return await handleNextText(sock, jid, msg, db, cleanSender);
        } catch (e) {
            logErr("handleNextText:", e?.message || e);
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
    handleFlowButton,
    handleNewCommand,
    handleResetCommand,
    _sendFlowCard: sendFlowCard
};
