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
 * يجلب صورة الشخصية عبر نفس خط أمر .احضر (مع كتابة اللقب على الصورة)
 * @returns {Promise<Buffer|null>}
 */
async function tryFetchImage(nickname, db) {
    if (!aiModule) return null;

    const job = async () => {
        if (typeof aiModule.runFetch === "function") {
            const r = await aiModule.runFetch(nickname, db);
            return r && r.buffer;
        }
        if (typeof aiModule.fetchCharacterImage === "function") {
            return await aiModule.fetchCharacterImage(nickname, "");
        }
        return null;
    };

    try {
        log(`🔍 البحث عن صورة للقب: "${nickname}"`);
        const imgBuf = await Promise.race([
            job(),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout-190s")), 190 * 1000))
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

// كاش: نبحث عن الصورة مرة واحدة فقط ونستعملها للورك وللترحيب معاً
const imageCache = new Map();   // number -> { promise, at }

function getImageCached(number, nickname, db) {
    const key = String(number || "").replace(/\D/g, "") || String(nickname || "");
    const t = Date.now();
    for (const [k, v] of imageCache) if (t - v.at > 30 * 60 * 1000) imageCache.delete(k);

    const hit = imageCache.get(key);
    if (hit) return hit.promise;

    const promise = tryFetchImage(nickname, db);
    imageCache.set(key, { promise, at: t });
    return promise;
}

/**
 * يرسل استمارة الورك + يحاول إرفاق صورة AI
 * @param {Object} sock
 * @param {Object} db
 * @param {Object} session - { targetUserId, nickname, referredBy }
 */
async function sendWorkFormAfterRegister(sock, db, session) {
    if (!sock || !db || !session) return false;

    const { targetUserId, nickname, referredBy, createdBy, chatJid } = session;
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
    const imageBuf = await getImageCached(targetUserId, nickname, db);

    // المسؤول الذي كتب .جديد (للخانة والمنشن)
    const adminNumber = String(createdBy || "").replace(/\D/g, "") || targetUserId;
    let adminJid = `${adminNumber}@s.whatsapp.net`;
    try { adminJid = await jf.resolveJid(sock, chatJid || mainJid, adminNumber); } catch (_) {}

    // 5) القالب الجاهز من data.js
    const { messages } = require("./data");
    const formText = messages.admin.work.form(
        nickname,
        referredBy || "—",
        adminNumber,
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
                    mentions: [adminJid, targetJid]
                });
            } else {
                await sock.sendMessage(wJid, {
                    text: formText,
                    mentions: [adminJid, targetJid]
                });
            }
            sent++;
            log(`✅ أُرسلت استمارة إلى ${wJid} (صورة: ${imageBuf ? "نعم" : "لا"})`);
        } catch (e) {
            logErr(`❌ فشل الإرسال لـ ${wJid}:`, e?.message);
        }
    }

    // ℹ️ الترحيب في القروب الأساسي يتولاه flow-join.js بعد قبول الطلب فقط (مرة واحدة)

    return sent > 0;
}

module.exports = {
    sendWorkFormAfterRegister,
    tryFetchImage,
    getImageCached
};
