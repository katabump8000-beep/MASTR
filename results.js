// ============================================================
// results.js
// ALJESAT BOT
// نظام النتائج - عرض إحصائيات الفعاليات
// ============================================================

"use strict";

// ============================================================
// أدوات مساعدة
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/[^0-9]/g, "");
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

/**
 * فحص هل القروب هو قروب ADS
 */
function isAdsGroup(db, jid) {
    return Boolean(db.adsGroups && db.adsGroups[jid] === true);
}

/**
 * فحص هل المستخدم لديه صلاحيات (سماح 1 أو أعلى)
 */
function hasAdminPerm(db, cleanSender, isBotOwner) {
    if (isBotOwner) return true;

    const permissions = db.permissions || {};
    for (const level of ["1", "2", "3", "4"]) {
        if (Array.isArray(permissions[level]) && permissions[level].includes(cleanSender)) {
            return true;
        }
    }
    return false;
}

// ============================================================
// 🆕 حفظ نتيجة فعالية (تُستدعى من ملفات الألعاب)
// ============================================================

/**
 * حفظ نتيجة فعالية في قاعدة البيانات
 * @param {Object} db - قاعدة البيانات
 * @param {Function} saveDb - دالة الحفظ
 * @param {Object} entry - بيانات النتيجة
 *   entry = {
 *     playerNumber: "1234...",
 *     nickname: "ساسكي",
 *     gameType: "الحيوانات" | "الألوان" | "التخمين" | "الروليت" | "الكريستال" | ...
 *     prize: 30,
 *     result: "win" | "lose",
 *     timestamp: Date.now()
 *   }
 */
function recordResult(db, saveDb, entry) {
    try {
        if (!db || !entry || !entry.playerNumber) return false;

        db.resultsData = db.resultsData && typeof db.resultsData === "object" ? db.resultsData : {};
        
        const playerNumber = cleanNumber(entry.playerNumber);
        if (!playerNumber) return false;

        if (!db.resultsData[playerNumber]) {
            db.resultsData[playerNumber] = {
                nickname: entry.nickname || "",
                wins: 0,
                losses: 0,
                totalPrize: 0,
                lastGame: entry.gameType || "",
                firstSeen: Date.now(),
                games: []
            };
        }

        const data = db.resultsData[playerNumber];

        // تحديث اللقب إذا موجود
        if (entry.nickname && String(entry.nickname).trim()) {
            data.nickname = String(entry.nickname).trim();
        }

        if (entry.result === "win") {
            data.wins = (data.wins || 0) + 1;
            data.totalPrize = (data.totalPrize || 0) + (Number(entry.prize) || 0);
        } else if (entry.result === "lose") {
            data.losses = (data.losses || 0) + 1;
            data.totalPrize = (data.totalPrize || 0) - (Number(entry.prize) || 0);
        }

        data.lastGame = entry.gameType || data.lastGame;

        // حفظ آخر 50 لعبة فقط (لتقليل حجم الملف)
        if (!Array.isArray(data.games)) data.games = [];
        data.games.push({
            type: entry.gameType || "",
            result: entry.result || "",
            prize: Number(entry.prize) || 0,
            timestamp: entry.timestamp || Date.now()
        });
        if (data.games.length > 50) {
            data.games = data.games.slice(-50);
        }

        if (typeof saveDb === "function") saveDb();

        return true;

    } catch (error) {
        console.error("❌ خطأ في recordResult:", error?.message || error);
        return false;
    }
}

// ============================================================
// بناء قائمة النتائج
// ============================================================

function buildResultsList(db) {
    try {
        const resultsData = db.resultsData || {};
        const entries = [];

        for (const playerNumber of Object.keys(resultsData)) {
            const data = resultsData[playerNumber];
            if (!data) continue;

            entries.push({
                playerNumber,
                nickname: data.nickname || playerNumber,
                wins: Number(data.wins) || 0,
                losses: Number(data.losses) || 0,
                totalPrize: Number(data.totalPrize) || 0
            });
        }

        // ترتيب حسب مجموع الربح تنازلياً
        entries.sort((a, b) => b.totalPrize - a.totalPrize);

        if (entries.length === 0) {
            return "⚠️ لا توجد نتائج مسجلة حتى الآن.";
        }

        let text = `❆━━━━━═⏣⊰🎮⊱⏣═━━━━━❆\n`;
        text += `\`اللقب\`     \`انتصار\` \`خسارة\` \`مجموع الربح\`\n`;
        text += `─────────────────────\n`;

        let index = 1;
        for (const entry of entries) {
            text += `${index}. \`${entry.nickname}\`     ${entry.wins}    ${entry.losses}    ${entry.totalPrize}$\n`;
            index++;
        }

        text += `❆━━━━━═⏣⊰🎮⊱⏣═━━━━━❆`;

        return text;

    } catch (error) {
        console.error("❌ خطأ في buildResultsList:", error?.message || error);
        return "❌ حدث خطأ أثناء بناء النتائج.";
    }
}

// ============================================================
// المعالجة الرئيسية لأمر .نتائج
// ============================================================

async function handleResults(sock, jid, msg, text, db, saveDb, cleanSender, isBotOwner) {
    try {
        // ============================================
        // 1) التحقق من الصلاحيات
        // ============================================
        if (!hasAdminPerm(db, cleanSender, isBotOwner)) {
            await safeSend(sock, jid, {
                text: "⛔ هذا الأمر يحتاج صلاحيات إدارية (.سماح)."
            }, { quoted: msg });
            return true;
        }

        // ============================================
        // 2) التحقق من أن القروب هو قروب ADS (أو أي قروب عليه ads)
        // ============================================
        if (!isAdsGroup(db, jid)) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  *هذا الأمر يعمل فقط في*
  *قروب الإعلانات (ADS)*
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // ============================================
        // 3) التحقق من الأمر: .نتائج 0 (تصفير)
        // ============================================
        const parts = text.split(/\s+/);
        const subCommand = parts[1] || "";

        if (subCommand === "0") {
            // تصفير كامل
            db.resultsData = {};
            if (typeof saveDb === "function") saveDb();

            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰✅⊱⏣═━━━━━❆
  *تم تصفير جميع النتائج*
  *وسيتم بدء المراقبة من جديد*
❆━━━━━═⏣⊰✅⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // ============================================
        // 4) عرض النتائج
        // ============================================
        const resultsText = buildResultsList(db);

        await safeSend(sock, jid, {
            text: resultsText
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleResults:", error?.message || error);
        return false;
    }
}

// ============================================================
// إضافة سجل يدوي (اختباري)
// ============================================================

function clearResults(db, saveDb) {
    try {
        db.resultsData = {};
        if (typeof saveDb === "function") saveDb();
        return true;
    } catch {
        return false;
    }
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    handleResults,
    recordResult,
    clearResults,
    buildResultsList,
    isAdsGroup,
    hasAdminPerm
};