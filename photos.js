// ============================================================
// photos.js
// ALJESAT BOT
// نظام حفظ الصور والألقاب لعضو قروب الاستقبال
// ============================================================

"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ============================================================
// مجلد حفظ الصور
// ============================================================

const PHOTOS_FOLDER = path.join(__dirname, "user_photos");

if (!fs.existsSync(PHOTOS_FOLDER)) {
    fs.mkdirSync(PHOTOS_FOLDER, { recursive: true });
}

// ============================================================
// أدوات مساعدة
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/[^0-9]/g, "");
}

function cleanJid(value) {
    if (!value) return "";
    return String(value).split(":")[0];
}

function jidToNumber(value) {
    return cleanNumber(cleanJid(value));
}

function normalizeText(text) {
    if (text === null || text === undefined) return "";
    return String(text)
        .trim()
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/\s+/g, " ");
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

/**
 * استخراج الصورة المقتبسة من الرسالة
 */
function getQuotedImage(msg) {
    try {
        const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo) return null;

        const quoted = contextInfo.quotedMessage;
        if (!quoted) return null;

        if (quoted.imageMessage) {
            return {
                imageMessage: quoted.imageMessage,
                quotedKey: {
                    remoteJid: msg.key.remoteJid,
                    fromMe: false,
                    id: contextInfo.stanzaId,
                    participant: contextInfo.participant || msg.key.participant || msg.key.remoteJid
                }
            };
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * استخراج نص الرسالة
 */
function getMessageText(msg) {
    if (!msg || !msg.message) return "";
    const m = msg.message;
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        ""
    ).trim();
}

/**
 * الحصول على جلسة القروب الاستقبالية
 */
function isReceiveGroup(db, jid) {
    return Boolean(db.receiveGroups && db.receiveGroups[jid]);
}

/**
 * الحصول على الجلسات الأساسية
 */
function getMainGroups(db) {
    if (!db.mainGroup) return [];
    return Object.keys(db.mainGroup).filter(jid => db.mainGroup[jid] === true);
}

/**
 * فحص هل العضو في أي قروب أساسي
 */
async function isUserInMainGroup(sock, db, userNumber) {
    try {
        const mainGroups = getMainGroups(db);
        if (mainGroups.length === 0) return false;

        for (const mainJid of mainGroups) {
            try {
                const metadata = await sock.groupMetadata(mainJid).catch(() => null);
                if (!metadata) continue;

                const found = metadata.participants.find(p => {
                    const pid = cleanNumber(p.id);
                    return pid === userNumber;
                });

                if (found) return true;
            } catch (_) {}
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * البحث عن عضو مسجل باللقب (من db.users)
 */
function findUserByNickname(db, nickname) {
    const norm = normalizeText(nickname);
    if (!norm) return null;

    for (const number of Object.keys(db.users || {})) {
        const user = db.users[number];
        if (!user) continue;

        const userNick = normalizeText(user.nickname);
        if (userNick && userNick === norm) {
            return { number, user };
        }
    }
    return null;
}

/**
 * فحص هل الصورة محفوظة سابقاً
 * نقارن بالحجم والنوع (لأن المقارنة بالبافر الكامل ثقيلة)
 */
function isImageAlreadySaved(db, imageMessage) {
    if (!imageMessage) return false;

    const newFileLength = Number(imageMessage.fileLength) || 0;
    const newSha256 = imageMessage.fileSha256 ? String(imageMessage.fileSha256) : "";

    if (!db.userPhotos) return false;

    for (const userNumber of Object.keys(db.userPhotos)) {
        const entry = db.userPhotos[userNumber];
        if (!entry) continue;

        // مقارنة بالـ fileSha256 إذا موجودة (أدق)
        if (newSha256 && entry.fileSha256) {
            if (entry.fileSha256 === newSha256) {
                return { userNumber, entry };
            }
        } else if (newFileLength > 0 && entry.fileLength === newFileLength) {
            // مقارنة بالحجم كحل بديل
            return { userNumber, entry };
        }
    }

    return false;
}

/**
 * تحميل الصورة من واتساب وحفظها محلياً
 */
async function downloadAndSaveImage(sock, imageMessage, userNumber) {
    try {
        const { downloadMediaMessage } = require("@whiskeysockets/baileys");

        // نبني رسالة وهمية لتحميل الصورة
        const fakeMsg = {
            key: {
                remoteJid: "x@s.whatsapp.net",
                fromMe: false,
                id: "x"
            },
            message: {
                imageMessage: imageMessage
            }
        };

        const buffer = await downloadMediaMessage(
            fakeMsg,
            "buffer",
            {},
            {
                logger: console,
                reuploadRequest: sock.updateMediaMessage
            }
        );

        if (!buffer || buffer.length === 0) {
            throw new Error("الصورة فارغة أو فشل التحميل");
        }

        // حفظ الصورة
        const ext = imageMessage.mimetype?.includes("png") ? "png" : "jpg";
        const filename = `${userNumber}_${Date.now()}.${ext}`;
        const filePath = path.join(PHOTOS_FOLDER, filename);

        fs.writeFileSync(filePath, buffer);

        return { filePath, filename, size: buffer.length };

    } catch (error) {
        console.error("❌ فشل تحميل وحفظ الصورة:", error?.message || error);
        return null;
    }
}

// ============================================================
// المعالجة الرئيسية لأمر .صورة
// ============================================================

async function handlePhotoCommand(
    sock,
    jid,
    msg,
    text,
    db,
    saveDb,
    cleanSender,
    isBotOwner
) {
    try {
        // ============================================
        // 1) التحقق من أن القروب قروب استقبال
        // ============================================
        if (!isReceiveGroup(db, jid)) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  *هذا الأمر يعمل فقط داخل*
  *قروب الاستقبال*
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // ============================================
        // 2) التحقق من الصلاحيات (مستعمل .سجل)
        // ============================================
        // من يستطيع: من لديه صلاحية 2 (سجل) أو المالك
        const permissions = db.permissions || {};
        const hasRegisterPerm = 
            isBotOwner || 
            (Array.isArray(permissions["2"]) && permissions["2"].includes(cleanSender)) ||
            (Array.isArray(permissions["5"]) && permissions["5"].includes(cleanSender));

        if (!hasRegisterPerm) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⛔⊱⏣═━━━━━❆
  *ليس لديك صلاحية لاستخدام*
  *هذا الأمر*
❆━━━━━═⏣⊰⛔⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // ============================================
        // 3) استخراج اللقب من الأمر
        // ============================================
        const parts = text.split(/\s+/);
        // parts[0] = ".صورة"
        const nickname = parts.slice(1).join(" ").trim();

        if (!nickname) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  *يرجى كتابة اللقب بعد الأمر*
  مثال: .صورة ساسكي
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // ============================================
        // 4) التحقق من وجود صورة مقتبسة
        // ============================================
        const quoted = getQuotedImage(msg);

        if (!quoted || !quoted.imageMessage) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
      رجاءا أعمل منشن للصورة 
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        const imageMessage = quoted.imageMessage;

        // ============================================
        // 5) البحث عن العضو صاحب اللقب
        // ============================================
        const foundUser = findUserByNickname(db, nickname);

        if (!foundUser) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  *لا يوجد عضو مسجل بهذا اللقب*
  *عبر أمر .سجل*
  
  اللقب: _*${nickname}*_
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        const targetNumber = foundUser.number;

        // ============================================
        // 6) التحقق هل الصورة محفوظة سابقاً
        // ============================================
        const alreadySaved = isImageAlreadySaved(db, imageMessage);

        if (alreadySaved) {
            const savedUser = db.users?.[alreadySaved.userNumber];
            const savedNickname = savedUser?.nickname || alreadySaved.userNumber;

            await safeSend(sock, jid, {
                text: `♢━━━━━═⏣⊰⚠️⊱⏣═━━━━━♤
  \`عذرا الصورة هذه محفوظة بالفعل\`
  
  لصاحب اللقب: _*${savedNickname}*_
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // ============================================
        // 7) التحقق هل العضو موجود في القروب الأساسي
        // ============================================
        const isInMain = await isUserInMainGroup(sock, db, targetNumber);

        if (isInMain) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  \`خطأ\` *هذا العضو موجود في قروب*
  _*الاساسي...*_ *تأكد بأنك تسجل لقب*
  *ليس مأخود او تأكد بأن العضو المحدد*
  *جديد*
❆━━━━━═⏣⊰❌⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // ============================================
        // 8) تحميل وحفظ الصورة
        // ============================================
        const saveResult = await downloadAndSaveImage(sock, imageMessage, targetNumber);

        if (!saveResult) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  *فشل تحميل الصورة*
  يرجى المحاولة مرة أخرى
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        // ============================================
        // 9) حفظ البيانات في قاعدة البيانات
        // ============================================
        db.userPhotos = db.userPhotos || {};
        db.userPhotos[targetNumber] = {
            nickname: foundUser.user.nickname,
            filePath: saveResult.filePath,
            filename: saveResult.filename,
            fileLength: Number(imageMessage.fileLength) || saveResult.size,
            fileSha256: imageMessage.fileSha256 ? String(imageMessage.fileSha256) : "",
            mimetype: imageMessage.mimetype || "image/jpeg",
            savedAt: Date.now(),
            savedBy: cleanSender,
            chatId: jid
        };

        if (typeof saveDb === "function") saveDb();

        // ============================================
        // 10) رسالة النجاح
        // ============================================
        await safeSend(sock, jid, {
            text: `◆━─⊱✅نجح✅⊰─━◆`
        }, { quoted: msg });

        console.log(`✅ تم حفظ صورة للعضو ${targetNumber} (${foundUser.user.nickname})`);

        return true;

    } catch (error) {
        console.error("❌ خطأ في handlePhotoCommand:", error?.message || error);
        return false;
    }
}

// ============================================================
// دوال مساعدة مُصدَّرة
// ============================================================

/**
 * الحصول على صورة عضو (من قاعدة البيانات)
 */
function getPhoto(db, userNumber) {
    if (!db || !db.userPhotos) return null;
    return db.userPhotos[userNumber] || null;
}

/**
 * فحص هل العضو لديه صورة محفوظة
 */
function hasPhoto(db, userNumber) {
    if (!db || !db.userPhotos) return false;
    return Boolean(db.userPhotos[userNumber]);
}

/**
 * حذف صورة عضو (عند خروجه من القروب الأساسي مثلاً)
 */
function removePhoto(db, userNumber, saveDb) {
    if (!db || !db.userPhotos || !db.userPhotos[userNumber]) return false;

    const entry = db.userPhotos[userNumber];

    // حذف الملف
    try {
        if (entry.filePath && fs.existsSync(entry.filePath)) {
            fs.unlinkSync(entry.filePath);
        }
    } catch (err) {
        console.warn("⚠️ فشل حذف ملف الصورة:", err?.message);
    }

    // حذف من قاعدة البيانات
    delete db.userPhotos[userNumber];

    if (typeof saveDb === "function") saveDb();

    return true;
}

/**
 * الحصول على مسار مجلد الصور
 */
function getPhotosFolder() {
    return PHOTOS_FOLDER;
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    handlePhotoCommand,
    getPhoto,
    hasPhoto,
    removePhoto,
    getPhotosFolder,
    isReceiveGroup,
    isUserInMainGroup,
    findUserByNickname,
    isImageAlreadySaved,
    PHOTOS_FOLDER
};