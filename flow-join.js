// ============================================================
// flow-join.js
// ALJESAT BOT — بعد التسجيل: نبحث عن صورة اللقب، ثم نقبل طلب الانضمام للقروب الأساسي
//               ونرسل استمارة الترحيب (صورة + منشن + لقب).
//
//  1) نبدأ البحث عن الصورة فوراً (مرة واحدة، مشتركة مع استمارة الورك).
//  2) نراقب القروب الأساسي كل 15 ثانية (حتى 60 دقيقة):
//       • العضو داخل القروب أصلاً  → نرسل الترحيب مباشرة.
//       • عنده طلب انضمام معلّق    → ننتظر الصورة ثم نقبله (الترحيب يُرسل عند دخوله).
//  3) لو فشل العثور على صورة بعد المهلة → نقبله ونرحّب بنص فقط (لا نُعلّقه للأبد).
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");
const jf = require("./jidfix");

let welcomeModule = null;
try { welcomeModule = require("./welcome"); } catch (_) {}

let workSender = null;
try { workSender = require("./flow-work-sender"); } catch (_) {}

const log = (...a) => { try { console.log("[flow-join]", ...a); } catch (_) {} };
const logErr = (...a) => { try { console.error("[flow-join]", ...a); } catch (_) {} };

const POLL_MS = 15 * 1000;
const MAX_WATCH_MS = 60 * 60 * 1000;          // نراقب ساعة كاملة
const IMAGE_WAIT_MS = 6 * 60 * 1000;          // أقصى انتظار للصورة قبل الترحيب النصي

const DATA_DIR = String(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname).trim() || __dirname;
const PHOTOS_DIR = path.join(DATA_DIR, "photos");
try { fs.mkdirSync(PHOTOS_DIR, { recursive: true }); } catch (_) {}

const active = new Map();   // number -> true (يمنع تكرار المراقبة)

function mainGroupJids(db) {
    return Object.keys((db && db.mainGroup) || {}).filter(j => db.mainGroup[j] === true);
}

function savePhoto(db, saveDb, number, nickname, buf) {
    try {
        const file = path.join(PHOTOS_DIR, `${number}.jpg`);
        fs.writeFileSync(file, buf);
        db.userPhotos = db.userPhotos || {};
        db.userPhotos[number] = { filePath: file, nickname, savedAt: Date.now() };
        if (typeof saveDb === "function") saveDb();
        return db.userPhotos[number];
    } catch (e) {
        logErr("savePhoto:", e?.message || e);
        return null;
    }
}

async function participantsOf(sock, gjid) {
    try { jf.invalidateGroup(gjid); } catch (_) {}
    try { return await jf.getGroupParticipants(sock, gjid); } catch (_) { return null; }
}

async function pendingRequestFor(sock, gjid, number) {
    try {
        if (typeof sock.groupRequestParticipantsList !== "function") return null;
        const list = await sock.groupRequestParticipantsList(gjid);
        if (!Array.isArray(list)) return null;
        const aliases = jf.aliasesOf(number);
        for (const r of list) {
            const rj = r?.jid || r?.phone_number || r?.id || "";
            const rn = jf.jnum(rj);
            const rp = jf.jnum(r?.phone_number || "");
            if (aliases.includes(rn) || (rp && aliases.includes(rp))) {
                return r.jid || r.phone_number || r.id;
            }
        }
    } catch (e) {
        logErr("pendingRequestFor:", e?.message || e);
    }
    return null;
}

async function sendTextWelcome(sock, gjid, number, nickname, db) {
    try {
        if (welcomeModule && typeof welcomeModule.sendWelcomeTextOnly === "function") {
            await welcomeModule.sendWelcomeTextOnly(sock, gjid, number, nickname, db);
        }
    } catch (e) { logErr("text welcome:", e?.message || e); }
}

/**
 * @param {Object} info { targetUserId, targetJid, nickname }
 */
function start(sock, db, saveDb, info) {
    const number = String(info?.targetUserId || "").replace(/\D/g, "");
    const nickname = String(info?.nickname || "").trim();
    if (!sock || !db || !number) return;
    if (active.has(number)) return;
    active.set(number, true);

    (async () => {
        const t0 = Date.now();
        let imageState = "pending";     // pending | ready | failed
        let photoEntry = null;

        // 1) الصورة (مشتركة مع استمارة الورك)
        const imgPromise = (workSender && workSender.getImageCached)
            ? workSender.getImageCached(number, nickname, db)
            : Promise.resolve(null);

        imgPromise.then((buf) => {
            if (buf && Buffer.isBuffer(buf)) {
                photoEntry = savePhoto(db, saveDb, number, nickname, buf);
                imageState = photoEntry ? "ready" : "failed";
            } else {
                imageState = "failed";
            }
            log(`🖼️ حالة الصورة لـ ${nickname}: ${imageState}`);
        }).catch(() => { imageState = "failed"; });

        // 2) المراقبة
        try {
            while (Date.now() - t0 < MAX_WATCH_MS) {
                await new Promise(r => setTimeout(r, POLL_MS));

                const groups = mainGroupJids(db);
                if (!groups.length) continue;

                const imageWaitedOut = Date.now() - t0 > IMAGE_WAIT_MS;
                const imageOk = imageState === "ready";
                const mayProceed = imageOk || imageState === "failed" || imageWaitedOut;

                for (const gjid of groups) {
                    // (أ) داخل القروب أصلاً؟
                    const parts = await participantsOf(sock, gjid);
                    if (parts && jf.findInParticipants(parts, number)) {
                        if (!mayProceed) continue;
                        if (imageOk && welcomeModule && photoEntry) {
                            await welcomeModule.sendWelcome(sock, gjid, number, photoEntry, db);
                        } else {
                            await sendTextWelcome(sock, gjid, number, nickname, db);
                        }
                        log(`👋 تم الترحيب بـ ${nickname} (داخل القروب)`);
                        return;
                    }

                    // (ب) طلب انضمام معلّق؟
                    if (!mayProceed) continue;
                    const reqJid = await pendingRequestFor(sock, gjid, number);
                    if (reqJid) {
                        await sock.groupRequestParticipantsUpdate(gjid, [reqJid], "approve");
                        log(`✅ قُبل طلب ${nickname} (${imageOk ? "مع صورة" : "بدون صورة"})`);

                        // الترحيب بالصورة يرسله معالج الانضمام في index.js (db.userPhotos).
                        // لو بلا صورة فهو لا يرسل شيئاً، فنرسل نحن الترحيب النصي.
                        if (!imageOk) {
                            await new Promise(r => setTimeout(r, 4000));
                            await sendTextWelcome(sock, gjid, number, nickname, db);
                        }
                        return;
                    }
                }
            }
            log(`⌛ انتهت مراقبة ${nickname} دون ظهور طلب انضمام`);
        } catch (e) {
            logErr("watch loop:", e?.message || e);
        } finally {
            active.delete(number);
        }
    })();
}

module.exports = { start };

