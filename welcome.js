// ============================================================
// welcome.js
// ALJESAT BOT
// نظام رسالة الترحيب مع الصورة والروابط
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");

// ============================================================
// أدوات مساعدة
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/[^0-9]/g, "");
}

function safeNumber(num) {
    const clean = cleanNumber(num);
    if (!clean) return "";
    return `@${clean}`;
}

function getWelcomeMessage(nickname, userNumber, db) {
    // جلب الروابط من قاعدة البيانات
    let link1 = "الرابط 1";
    let link2 = "الرابط 2";

    try {
        if (db && db.welcomeLinks) {
            if (db.welcomeLinks.link1 && String(db.welcomeLinks.link1).trim()) {
                link1 = String(db.welcomeLinks.link1).trim();
            }
            if (db.welcomeLinks.link2 && String(db.welcomeLinks.link2).trim()) {
                link2 = String(db.welcomeLinks.link2).trim();
            }
        }
    } catch (_) {}

    const safeNickname = nickname && String(nickname).trim() ? nickname : "غير مسجل";
    const mention = safeNumber(userNumber);

    return `╮─❖『 👑 ترحيب 』❖─╭

 أضــاءت مملكة *آلنـ🔥ــآر* بانضمامك إلينا! 
أهلًا وسهلًا بك في المكان الذي لا يعرف الملل، ولا يتوقف فيه الحماس. 🌟
لقد أنرت المملكة بحضورك، ويسعدنا جدًا انضمامك إلى عائلتنا. 🤍

_*آلَــلـقــــــب:*_    ┊ ${safeNickname} ┊

_*آلَمِــــنـــــشــــن:*_  ┊ ${mention} ┊

\`الدخول اجباري لهنا:\`
╮──────────────╭
📢 \`الإعــلانــات:\` ${link1}】

🛒 \`الــمــتــجــر:\` ${link2} 】
╯──────────────╰
🌸 نتمنى لك قضاء أجمل الأوقات معنا، وندعوك للمشاركة والتفاعل باستمرار.

╮──────────────╭
                     ꧁ تــوقــيــع ꧂ 
                𝑭. 𝑰. 𝑹
╯──────────────╰`;
}

/**
 * إرسال رسالة الترحيب مع الصورة
 * @param {Object} sock - Socket
 * @param {String} jid - معرف القروب الأساسي
 * @param {String} userNumber - رقم العضو
 * @param {Object} photoEntry - كائن الصورة من db.userPhotos
 * @param {Object} db - قاعدة البيانات
 */
async function sendWelcome(sock, jid, userNumber, photoEntry, db) {
    try {
        if (!sock || !jid || !userNumber || !photoEntry) {
            console.warn("⚠️ sendWelcome: بيانات ناقصة");
            return false;
        }

        const cleanNum = cleanNumber(userNumber);
        const mentionJid = `${cleanNum}@s.whatsapp.net`;

        // جلب اللقب من الصورة أو من db.users
        let nickname = photoEntry.nickname;
        if (!nickname || !String(nickname).trim()) {
            const user = db && db.users ? db.users[cleanNum] : null;
            nickname = user?.nickname || "";
        }

        const welcomeText = getWelcomeMessage(nickname, cleanNum, db);

        // التحقق من وجود ملف الصورة
        const filePath = photoEntry.filePath;
        const fileExists = filePath && fs.existsSync(filePath);

        if (fileExists) {
            try {
                const imageBuffer = fs.readFileSync(filePath);
                await sock.sendMessage(jid, {
                    image: imageBuffer,
                    caption: welcomeText,
                    mentions: [mentionJid]
                });
                console.log(`✅ تم إرسال ترحيب بالصورة للعضو ${cleanNum}`);
                return true;
            } catch (err) {
                console.error("❌ فشل إرسال الصورة في الترحيب:", err?.message);
                // fallback: إرسال النص فقط
                await sock.sendMessage(jid, {
                    text: welcomeText,
                    mentions: [mentionJid]
                }).catch(() => {});
                return true;
            }
        }

        // لا توجد صورة: إرسال النص فقط
        await sock.sendMessage(jid, {
            text: welcomeText,
            mentions: [mentionJid]
        }).catch(() => {});

        console.log(`✅ تم إرسال ترحيب نصي للعضو ${cleanNum}`);
        return true;

    } catch (error) {
        console.error("❌ خطأ في sendWelcome:", error?.message || error);
        return false;
    }
}

/**
 * إرسال رسالة الترحيب النصية فقط (بدون صورة)
 */
async function sendWelcomeTextOnly(sock, jid, userNumber, nickname, db) {
    try {
        const cleanNum = cleanNumber(userNumber);
        const mentionJid = `${cleanNum}@s.whatsapp.net`;
        const welcomeText = getWelcomeMessage(nickname, cleanNum, db);

        await sock.sendMessage(jid, {
            text: welcomeText,
            mentions: [mentionJid]
        }).catch(() => {});

        return true;

    } catch (error) {
        console.error("❌ خطأ في sendWelcomeTextOnly:", error?.message || error);
        return false;
    }
}

/**
 * جلب نص الترحيب فقط (للاختبار)
 */
function getWelcomeText(nickname, userNumber, db) {
    return getWelcomeMessage(nickname, userNumber, db);
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    sendWelcome,
    sendWelcomeTextOnly,
    getWelcomeText,
    getWelcomeMessage
};