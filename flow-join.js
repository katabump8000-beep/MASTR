// ============================================================
// flow-join.js
// ALJESAT BOT — بعد التسجيل:
//   1) نبحث عن صورة اللقب (مرة واحدة، مشتركة مع استمارة الورك).
//   2) نراقب القروب الأساسي. عند ظهور طلب انضمام العضو:
//        ← نقبل الطلب أولاً
//        ← ثم يُرسل استمارة الترحيب (مرة واحدة فقط، وبعد القبول فقط).
//   3) لو لم نجد صورة خلال المهلة نقبله ونرحّب بنص فقط.
//
// الترحيب نفسه يرسله معالج الانضمام الأصلي في index.js (db.userPhotos)،
// وهنا نمنع التكرار: أي استدعاء ثانٍ لترحيب نفس العضو خلال 10 دقائق يُتجاهل.
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
const MAX_WATCH_MS = 60 * 60 * 1000;     // نراقب ساعة كاملة
const IMAGE_WAIT_MS = 6 * 60 * 1000;     // أقصى انتظار للصورة قبل الترحيب النصي
const WELCOME_DEDUPE_MS = 10 * 60 * 1000;
const WELCOME_WAIT_AFTER_APPROVE_MS = 60 * 1000;

const DATA_DIR = String(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname).trim() || __dirname;
const PHOTOS_DIR = path.join(DATA_DIR, "photos");
try { fs.mkdirSync(PHOTOS_DIR, { recursive: true }); } catch (_) {}

const active = new Map();           // number -> true (يمنع تكرار المراقبة)
const welcomedAt = new Map();       // numberKey -> time

function numKey(number) {
    const n = String(number || "").replace(/\D/g, "");
    try {
        const al = jf.aliasesOf(n);
        if (Array.isArray(al) && al.length) return al.slice().sort()[0];
    } catch (_) {}
    return n;
}

// ------------------------------------------------------------
// 🛡️ منع تكرار الترحيب: نلفّ دوال welcome.js مرة واحدة
// ------------------------------------------------------------
if (welcomeModule && !welcomeModule.__firDedupe) {
    const guard = (fn, name) => async function (sock, jid, number, ...rest) {
        const key = numKey(number);
        const last = welcomedAt.get(key) || 0;
        if (Date.now() - last < WELCOME_DEDUPE_MS) {
            log(`⏭️ تجاهل ترحيب مكرر (${name}) للعضو ${key}`);
            return true;
        }
        welcomedAt.set(key, Date.now());
        return fn.call(this, sock, jid, number, ...rest);
    };
    if (typeof welcomeModule.sendWelcome === "function") {
        welcomeModule.sendWelcome = guard(welcomeModule.sendWelcome, "sendWelcome");
    }
    if (typeof welcomeModule.sendWelcomeTextOnly === "function") {
        welcomeModule.sendWelcomeTextOnly = guard(welcomeModule.sendWelcomeTextOnly, "sendWelcomeTextOnly");
    }
    welcomeModule.__firDedupe = true;
}

function mainGroupJids(db) {
    return Object.keys((db && db.mainGroup) || {}).filter(j => db.mainGroup[j] === true);
}

/** يجهّز db.userPhotos (مطلوب ليعمل معالج الانضمام): بصورة، أو بدونها (ترحيب نصي) */
function preparePhotoEntry(db, saveDb, number, nickname, buf) {
    let filePath = "";
    if (buf && Buffer.isBuffer(buf)) {
        try {
            filePath = path.join(PHOTOS_DIR, `${number}.jpg`);
            fs.writeFileSync(filePath, buf);
        } catch (e) {
            logErr("حفظ الصورة:", e?.message || e);
            filePath = "";
        }
    }
    db.userPhotos = db.userPhotos || {};
    db.userPhotos[number] = { filePath, nickname, savedAt: Date.now(), textOnly: !filePath };
    try { if (typeof saveDb === "function") saveDb(); } catch (_) {}
    return db.userPhotos[number];
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
            const rn = jf.jnum(r?.jid || r?.id || "");
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
        let imageBuf = null;
        let prepared = null;

        const imgPromise = (workSender && workSender.getImageCached)
            ? workSender.getImageCached(number, nickname, db)
            : Promise.resolve(null);

        imgPromise.then((buf) => {
            if (buf && Buffer.isBuffer(buf)) { imageBuf = buf; imageState = "ready"; }
            else imageState = "failed";
            log(`🖼️ حالة الصورة لـ ${nickname}: ${imageState}`);
        }).catch(() => { imageState = "failed"; });

        try {
            while (Date.now() - t0 < MAX_WATCH_MS) {
                await new Promise(r => setTimeout(r, POLL_MS));

                const groups = mainGroupJids(db);
                if (!groups.length) continue;

                // لا نقبل أي شيء قبل أن تُحسم الصورة (أو تنتهي مهلتها)
                const waitedOut = Date.now() - t0 > IMAGE_WAIT_MS;
                if (imageState === "pending" && !waitedOut) continue;

                if (!prepared) prepared = preparePhotoEntry(db, saveDb, number, nickname, imageBuf);

                for (const gjid of groups) {
                    // (أ) داخل القروب أصلاً (دخل بالرابط المباشر)؟ → ترحيب مرة واحدة
                    const parts = await participantsOf(sock, gjid);
                    if (parts && jf.findInParticipants(parts, number)) {
                        if (welcomeModule && typeof welcomeModule.sendWelcome === "function") {
                            await welcomeModule.sendWelcome(sock, gjid, number, prepared, db);
                        }
                        log(`👋 ترحيب بـ ${nickname} (كان داخل القروب)`);
                        return;
                    }

                    // (ب) طلب انضمام معلّق؟ → نقبله أولاً، ثم يُرسل الترحيب
                    const reqJid = await pendingRequestFor(sock, gjid, number);
                    if (reqJid) {
                        await sock.groupRequestParticipantsUpdate(gjid, [reqJid], "approve");
                        log(`✅ قُبل طلب ${nickname} (${prepared.textOnly ? "بدون صورة" : "مع صورة"})`);

                        // معالج الانضمام في index.js يرسل الترحيب عند دخوله. ننتظره قليلاً،
                        // وإن لم يحدث (حدث انضمام لم يصل) نرسله نحن مرة واحدة.
                        const tw = Date.now();
                        while (Date.now() - tw < WELCOME_WAIT_AFTER_APPROVE_MS) {
                            await new Promise(r => setTimeout(r, 3000));
                            if (welcomedAt.get(numKey(number))) return;
                        }
                        if (welcomeModule && typeof welcomeModule.sendWelcome === "function") {
                            await welcomeModule.sendWelcome(sock, gjid, number, prepared, db);
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
