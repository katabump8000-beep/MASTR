// ============================================================
// results.js  (مُعاد كتابته)
// ALJESAT BOT
// نظام النتائج: كل بوت يراقب استمارات النصر والخسارة في قروب ADS
// ويسجّلها بصمت (بدون أي رد)، وعند .نتائج يعرض القائمة.
//
//   .نتائج     عرض القائمة (صلاحية .سماح 5) داخل قروب ADS
//   .نتائج 0   تصفير كل النتائج
// ============================================================

"use strict";

const jf = require("./jidfix");

// ============================================================
// أدوات
// ============================================================

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return null;
    return sock.sendMessage(jid, content, options).catch(() => null);
}

function isAdsGroup(db, jid) {
    return Boolean(db.adsGroups && db.adsGroups[jid] === true);
}

/** تنظيف النص: تشكيل + تطويل + رموز اتجاه + تطبيع الألف */
function clean(text) {
    return String(text || "")
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
        .replace(/\u0640/g, "")
        .replace(/[\u064B-\u065F\u0670]/g, "")
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه");
}

function stripDecor(s) {
    return String(s || "").replace(/[*_`~]/g, "").replace(/[\u200e\u200f]/g, "").trim();
}

function toNumber(str) {
    const norm = String(str || "").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[, ]/g, "");
    const m = norm.match(/-?\d+(\.\d+)?/);
    if (!m) return 0;
    const n = Math.floor(Number(m[0]));
    return Number.isFinite(n) ? n : 0;
}

/**
 * صلاحية عرض النتائج: .سماح 5  (أو المالك/الإمبراطور)
 * نقبل أيضاً من مُنح .سماح 5 قديماً (يملك 1+2+3+4 معاً)
 */
function canSeeResults(db, cleanSender, isBotOwner) {
    if (isBotOwner) return true;
    const perms = db.permissions || {};
    const has = (lvl) => Array.isArray(perms[lvl]) && jf.aliasesOf(cleanSender).some(a => perms[lvl].includes(a));
    if (has("5")) return true;
    return has("1") && has("2") && has("3") && has("4");
}

// ============================================================
// تسجيل النتائج (سلبي — بدون رد)
// ============================================================

function adsObj(db) {
    if (!db.adsResults || typeof db.adsResults !== "object" || Array.isArray(db.adsResults)) db.adsResults = {};
    return db.adsResults;
}

function addEntry(db, nickname, kind, amount) {
    const data = adsObj(db);
    const key = String(nickname).trim();
    if (!key) return false;
    if (!data[key]) data[key] = { wins: 0, losses: 0, profit: 0, loss: 0 };
    const d = data[key];
    if (kind === "win") {
        d.wins++;
        d.profit += amount;
    } else {
        d.losses++;
        d.loss += amount;
    }
    return true;
}

/**
 * يحلل نص رسالة في قروب ADS. يرجع {kind, nickname, amount} أو null
 */
function parseAdsText(rawText) {
    const t = clean(rawText);
    if (!t) return null;

    // ---------- خسارة ----------
    // اللاعب *نيك* خسر في ... ﴿ 100 ﴾
    if (t.includes("خسر") && t.includes("اللاعب")) {
        const m = t.match(/اللاعب\s+([\s\S]+?)\s+خسر/);
        const amt = t.match(/[﴿(\[{]\s*([0-9٠-٩][0-9٠-٩,\s]*)\s*[﴾)\]}]/);
        if (m) {
            const nickname = stripDecor(m[1]).replace(/^@/, "");
            return { kind: "loss", nickname, amount: amt ? toNumber(amt[1]) : 0 };
        }
    }

    // ---------- فوز (استمارة انتهت) ----------
    if (t.includes("انتهت") && t.includes("الفائز") && t.includes("نوع الفعاليه")) {
        const lines = t.split("\n").map(l => l.trim());
        const iType = lines.findIndex(l => l.includes("نوع الفعاليه"));
        const iPrize = lines.findIndex(l => l.includes("الجائزه"));
        const iWinner = lines.findIndex(l => l.includes("الفائز"));

        const nextValue = (i) => {
            if (i < 0) return "";
            // القيمة قد تكون بعد النقطتين في نفس السطر أو في السطر التالي
            const same = lines[i].split(":").slice(1).join(":").trim();
            if (same) return same;
            for (let k = i + 1; k < lines.length; k++) if (lines[k]) return lines[k];
            return "";
        };

        const typeText = stripDecor(nextValue(iType));
        if (typeText.includes("مزاد")) return null; // المزاد جائزته قطعة وليست مبلغاً

        const nickname = stripDecor(nextValue(iWinner)).replace(/^@/, "");
        if (!nickname) return null;

        const prizeText = nextValue(iPrize);
        const amount = /\d|[٠-٩]/.test(prizeText) ? toNumber(prizeText) : 0;
        return { kind: "win", nickname, amount };
    }

    return null;
}

/**
 * تُستدعى لكل نص يظهر في قروب ADS (وارد أو صادر من البوت نفسه)
 */
function processAdsText(db, saveDb, jid, rawText, messageId) {
    try {
        if (!db || !isAdsGroup(db, jid)) return false;
        const parsed = parseAdsText(rawText);
        if (!parsed) return false;

        // منع التسجيل المكرر لنفس الرسالة
        db.adsSeen = Array.isArray(db.adsSeen) ? db.adsSeen : [];
        const sig = messageId || `${parsed.kind}:${parsed.nickname}:${parsed.amount}:${Math.floor(Date.now() / 3000)}`;
        if (db.adsSeen.includes(sig)) return false;
        db.adsSeen.push(sig);
        if (db.adsSeen.length > 500) db.adsSeen = db.adsSeen.slice(-500);

        addEntry(db, parsed.nickname, parsed.kind, parsed.amount);
        if (typeof saveDb === "function") saveDb();
        return true;
    } catch (e) {
        console.error("❌ processAdsText:", e?.message || e);
        return false;
    }
}

/** توافق مع الملفات القديمة */
function recordResult(db, saveDb, entry) {
    try {
        if (!db || !entry) return false;
        const nickname = String(entry.nickname || "").trim();
        if (!nickname) return false;
        addEntry(db, nickname, entry.result === "win" ? "win" : "lose", Number(entry.prize) || 0);
        if (typeof saveDb === "function") saveDb();
        return true;
    } catch (_) {
        return false;
    }
}

// ============================================================
// بناء القائمة
// ============================================================

function buildResultsList(db) {
    const data = adsObj(db);
    const entries = Object.entries(data).map(([nickname, d]) => ({
        nickname,
        wins: Number(d.wins) || 0,
        losses: Number(d.losses) || 0,
        profit: Number(d.profit) || 0,
        loss: Number(d.loss) || 0
    }));

    if (entries.length === 0) return "⚠️ لا توجد نتائج مسجلة حتى الآن.";

    entries.sort((a, b) => (b.profit - b.loss) - (a.profit - a.loss));

    let text = "";
    entries.forEach((e, i) => {
        text += `═══════ ${i + 1} ═══════\n`;
        text += `• اللقب: ${e.nickname}\n`;
        text += `• عدد الانتصارات: ${e.wins}   \`•\` عدد الخسائر: ${e.losses}\n`;
        text += `• المرابح: ${e.profit}   \`•\` الخسائر: ${e.loss}\n`;
    });
    text += "════════════════";
    return text;
}

function splitChunks(text, max = 3500) {
    const blocks = text.split(/(?=═══════ \d+ ═══════)/);
    const chunks = [];
    let cur = "";
    for (const b of blocks) {
        if ((cur + b).length > max && cur) { chunks.push(cur); cur = ""; }
        cur += b;
    }
    if (cur) chunks.push(cur);
    return chunks;
}

// ============================================================
// .نتائج
// ============================================================

async function handleResults(sock, jid, msg, text, db, saveDb, cleanSender, isBotOwner) {
    try {
        if (!canSeeResults(db, cleanSender, isBotOwner)) {
            await safeSend(sock, jid, { text: "⛔ هذا الأمر يحتاج صلاحية .سماح 5" }, { quoted: msg });
            return true;
        }

        if (!isAdsGroup(db, jid)) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆\n  *هذا الأمر يعمل فقط في*\n  *قروب الإعلانات (ADS)*\n❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        const parts = String(text).trim().split(/\s+/);
        if ((parts[1] || "") === "0") {
            db.adsResults = {};
            db.adsSeen = [];
            db.resultsData = {};
            if (typeof saveDb === "function") saveDb();
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰✅⊱⏣═━━━━━❆\n  *تم تصفير جميع النتائج*\n  *وسيتم بدء المراقبة من جديد*\n❆━━━━━═⏣⊰✅⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        const list = buildResultsList(db);
        const chunks = splitChunks(list);
        for (let i = 0; i < chunks.length; i++) {
            await safeSend(sock, jid, { text: chunks[i] }, i === 0 ? { quoted: msg } : {});
        }
        return true;
    } catch (error) {
        console.error("❌ خطأ في handleResults:", error?.message || error);
        return false;
    }
}

function clearResults(db, saveDb) {
    try {
        db.adsResults = {};
        if (typeof saveDb === "function") saveDb();
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    handleResults,
    recordResult,
    clearResults,
    buildResultsList,
    processAdsText,
    parseAdsText,
    isAdsGroup,
    canSeeResults
};
