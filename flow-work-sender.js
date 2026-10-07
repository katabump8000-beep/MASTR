// ============================================================
// flow-work-sender.js
// ALJESAT BOT — إرسال استمارة الورك تلقائياً بعد التسجيل
// ============================================================

"use strict";

const jf = require("./jidfix");

let aiModule = null;
try { aiModule = require("./Ai"); } catch (e) {
    console.warn("[flow-work-sender] ⚠️ Ai.js غير محمّل:", e?.message);
}

const log = (...a) => { try { console.log("[flow-work-sender]", ...a); } catch (_) {} };
const logErr = (...a) => { try { console.error("[flow-work-sender]", ...a); } catch (_) {} };

/**
 * يحاول جلب صورة عبر أمر .احضر الموجود في Ai.js
 * @returns {Promise<Buffer|null>}
 */
async function tryFetchImage(nickname) {
    if (!aiModule) return null;
    if (typeof aiModule.fetchCharacterImage !== "function") return null;

    try {
        log(`🔍 البحث عن صورة للقب: "${nickname}"`);
        const imgBuf = await Promise.race([
            aiModule.fetchCharacterImage(nickname, ""),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout-90s")), 90 * 1000))
        ]);
        if (imgBuf && Buffer.isBuffer(imgBuf)) {
            log(`✅ وجد صورة (${imgBuf.length} bytes)`);
            return imgBuf;
        }
        return null;
    } catch (e) {
        log(`⚠️ لا صورة: ${e?.message || e}`);
        return null;
    }
}

/**
 * يرسل استمارة الورك + يحاول إرفاق صورة AI
 * @param {Object} sock
 * @param {Object} db
 * @param {Object} session - { targetUserId, nickname, referredBy }
 */
async function sendWorkFormAfterRegister(sock, db, session) {
    if (!sock || !db || !session) return false;

    const { targetUserId, nickname, referredBy } = session;
    if (!targetUserId || !nickname) return false;

    // 1) قروبات الورك
    const workJids = Object.keys(db.workGroups || {}).filter(j => db.workGroups[j] === true);
    if (!workJids.length) {
        logErr("⚠️ لا توجد قروبات ورك مفعّلة (.ورك on)");
        return false;
    }

    // 2) القروب الأساسي (لجلب المنشن الصحيح)
    const mainJids = Object.keys(db.mainGroup || {}).filter(j => db.mainGroup[j] === true);
    const mainJid = mainJids[0] || null;

    // 3) المنشن الصحيح (LID أو رقم)
    let targetJid = `${targetUserId}@s.whatsapp.net`;
    try {
        if (mainJid) targetJid = await jf.resolveJid(sock, mainJid, targetUserId);
    } catch (_) {}

    // 4) محاولة جلب الصورة (اختياري — مع timeout)
    const imageBuf = await tryFetchImage(nickname);

    // 5) القالب الجاهز من data.js
    const { messages } = require("./data");
    const formText = messages.admin.work.form(
        nickname,
        referredBy || "—",
        targetUserId,
        targetUserId
    );

    // 6) الإرسال لكل قروب ورك
    let sent = 0;
    for (const wJid of workJids) {
        try {
            if (imageBuf) {
                await sock.sendMessage(wJid, {
                    image: imageBuf,
                    caption: formText,
                    mentions: [targetJid]
                });
            } else {
                await sock.sendMessage(wJid, {
                    text: formText,
                    mentions: [targetJid]
                });
            }
            sent++;
            log(`✅ أُرسلت استمارة إلى ${wJid} (صورة: ${imageBuf ? "نعم" : "لا"})`);
        } catch (e) {
            logErr(`❌ فشل الإرسال لـ ${wJid}:`, e?.message);
        }
    }

    // 7) ترحيب للعضو في القروب الأساسي (إن كان عضواً بالفعل)
    if (mainJid) {
        try {
            const welcomeModule = require("./welcome");
            const photoEntry = jf.pickByAlias(db.userPhotos || {}, targetUserId)?.value;

            if (photoEntry) {
                await welcomeModule.sendWelcome(sock, mainJid, targetUserId, photoEntry, db);
            } else if (typeof welcomeModule.sendWelcomeTextOnly === "function") {
                await welcomeModule.sendWelcomeTextOnly(sock, mainJid, targetUserId, nickname, db);
            }
            log(`✅ أُرسل ترحيب إلى القروب الأساسي`);
        } catch (e) {
            logErr("welcome error:", e?.message);
        }
    }

    return sent > 0;
}

module.exports = { sendWorkFormAfterRegister, tryFetchImage };