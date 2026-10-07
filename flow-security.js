// ============================================================
// flow-security.js
// ALJESAT BOT — ربط جلسة التسجيل بهوية العضو (منع التسجيل باسم غيره)
// ============================================================

"use strict";

const crypto = require("crypto");

// المفتاح السري: يُقرأ من Variables أو يُولّد مؤقتاً (يفضل ثابت على Railway)
const SECRET = String(process.env.FLOW_SECRET || "").trim()
    || crypto.randomBytes(32).toString("hex");

if (!process.env.FLOW_SECRET) {
    console.warn("[flow-security] ⚠️ FLOW_SECRET غير محدد — سيُولّد مؤقتاً.");
    console.warn("[flow-security] 💡 أضفه في Railway Variables لضمان ثبات التوكنات.");
}

/**
 * توليد توكن مرتبط بالجلسة والعضو
 * الصيغة: sessionId.userNumber.signature
 */
function signBinding(sessionId, userNumber) {
    const sid = String(sessionId || "").trim();
    const num = String(userNumber || "").replace(/\D/g, "");
    if (!sid || !num) return "";

    const sig = crypto
        .createHmac("sha256", SECRET)
        .update(`${sid}:${num}`)
        .digest("hex")
        .slice(0, 24);

    return `${sid}.${num}.${sig}`;
}

/**
 * التحقق من التوكن المُرتجع
 * @returns {Object|null} { sessionId, userNumber } أو null
 */
function verifyBinding(token) {
    const s = String(token || "").trim();
    const parts = s.split(".");
    if (parts.length !== 3) return null;

    const [sid, num, sig] = parts;
    if (!sid || !num || !sig) return null;

    const expected = crypto
        .createHmac("sha256", SECRET)
        .update(`${sid}:${num}`)
        .digest("hex")
        .slice(0, 24);

    // مقارنة زمنية ثابتة (timing-safe)
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;

    return { sessionId: sid, userNumber: num };
}

module.exports = { signBinding, verifyBinding };