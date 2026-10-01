// ============================================================
// guilds.js   (ملف جديد)
// ALJESAT BOT
// نظام كشف التعدد بين النقابات + المؤبد
//
//   .تعدد on/off          (داخل قروب الورك فقط)
//   .انا بوت 🩸            (بوت النقابة يعرّف نفسه للبوتات الأخرى)
//   .حذف نقابتك @بوت       (الإمبراطور فقط)
//   .نقابة 🔥 اسم          (الإمبراطور: إضافة اسم نقابة جديد لرمز)
//   .مؤبد   (بالرد على استمارة ورك)
//   .اعفاء  (بالرد على استمارة ورك)
//   .المؤبدين  (قائمة منشن بكل المحفوظين مؤبد)
// ============================================================

"use strict";

const jf = require("./jidfix");

// ============================================================
// أدوات
// ============================================================

async function send(sock, jid, text, quoted = null, extra = {}) {
    if (!sock || !jid) return null;
    try {
        return await sock.sendMessage(jid, { text: String(text), ...extra }, quoted ? { quoted } : undefined);
    } catch (e) {
        console.error("❌ guilds.send:", e?.message || e);
        return null;
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function cleanArabic(text) {
    return String(text || "")
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
        .replace(/\u0640/g, "")
        .replace(/[\u064B-\u065F\u0670]/g, "")
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه");
}

function stripEmoji(e) {
    return String(e || "").replace(/[\uFE0E\uFE0F\u200d\s]/g, "");
}

function hasLevel(db, number, level, owner) {
    if (owner) return true;
    const list = db.permissions && db.permissions[String(level)];
    if (!Array.isArray(list)) return false;
    return jf.aliasesOf(number).some(a => list.includes(a));
}

function getMentionedList(msg) {
    try {
        const m = msg?.message || {};
        const inner = m.extendedTextMessage || m.imageMessage || m.videoMessage || m.documentMessage || {};
        const ctx = inner.contextInfo || m.contextInfo || {};
        return Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
    } catch (_) {
        return [];
    }
}

function getQuotedText(msg) {
    try {
        const m = msg?.message || {};
        const inner = m.extendedTextMessage || m.imageMessage || m.videoMessage || {};
        const q = inner.contextInfo?.quotedMessage;
        if (!q) return "";
        return String(
            q.conversation ||
            q.extendedTextMessage?.text ||
            q.imageMessage?.caption ||
            ""
        );
    } catch (_) {
        return "";
    }
}

function guildNamesObj(db) {
    if (!db.guildNames || typeof db.guildNames !== "object" || Object.keys(db.guildNames).length === 0) {
        db.guildNames = { "🩸": "نوفا", "❄": "فورتكس", "☘": "سولار" };
    }
    return db.guildNames;
}

function lookupGuildName(db, emojiRaw) {
    const key = stripEmoji(emojiRaw);
    if (!key) return null;
    const names = guildNamesObj(db);
    for (const [emoji, name] of Object.entries(names)) {
        if (stripEmoji(emoji) === key) return { emoji: stripEmoji(emoji), name };
    }
    return null;
}

function guildBotsObj(db) {
    if (!db.guildBots || typeof db.guildBots !== "object" || Array.isArray(db.guildBots)) db.guildBots = {};
    return db.guildBots;
}

function findGuildBot(db, number) {
    const bots = guildBotsObj(db);
    for (const a of jf.aliasesOf(number)) {
        if (bots[a]) return { key: a, entry: bots[a] };
    }
    return null;
}

function isWorkGroup(db, jid) {
    return Boolean(db.workGroups && db.workGroups[jid] === true);
}

// ============================================================
// .انا بوت 🩸
// ============================================================

async function handleIAmBot(sock, jid, msg, text, db, saveDb, cleanSender, owner) {
    const rest = String(text || "").replace(/^\.\s*انا\s+بوت/, "").trim();
    if (!rest) {
        return false;
    }

    const found = lookupGuildName(db, rest.split(/\s+/)[0]) || lookupGuildName(db, rest);

    // ---------- البوت نفسه هو المرسل ----------
    if (msg?.key?.fromMe) {
        if (!found) return true; // البوتات الأخرى ستنبّه على الرمز غير المعروف
        if (!db.guildSelf) {
            db.guildSelf = { emoji: found.emoji, name: found.name, at: Date.now() };
            saveDb();
        }
        return true;
    }

    // ---------- بوت آخر هو المرسل ----------
    // نقبل من الإمبراطور / صاحب .سماح 5 / مشرف القروب (أرقام البوتات عادة مشرفة)
    let allowed = owner || hasLevel(db, cleanSender, "5", false);
    if (!allowed && jf.isGroupJid(jid)) {
        const parts = await jf.getGroupParticipants(sock, jid);
        const p = jf.findInParticipants(parts, cleanSender);
        allowed = Boolean(p && (p.admin === "admin" || p.admin === "superadmin"));
    }
    if (!allowed) return false;

    if (!found) {
        await send(sock, jid,
            `⚠️ الرمز غير معروف.\nيمكن للإمبراطور إضافته بالأمر:\n.نقابة ${rest.split(/\s+/)[0]} اسم_النقابة`, msg);
        return true;
    }

    const existing = findGuildBot(db, cleanSender);
    if (existing && existing.entry.name !== found.name) {
        await send(sock, jid,
            `⚠️ هذا البوت مسجل مسبقاً باسم: ${existing.entry.name}\nيجب على الإمبراطور حذف نقابته أولاً عبر:\n.حذف نقابتك @منشن`, msg);
        return true;
    }

    const bots = guildBotsObj(db);
    if (!existing) {
        bots[jf.jnum(cleanSender)] = { emoji: found.emoji, name: found.name, at: Date.now() };
        saveDb();
    }

    await send(sock, jid, `تم مراقبة استماراتك يا بوت ${found.name}`, msg);
    return true;
}

// ============================================================
// .حذف نقابتك @منشن   (الإمبراطور فقط)
// ============================================================

async function handleDeleteGuild(sock, jid, msg, db, saveDb, owner) {
    if (!owner) {
        await send(sock, jid, "⛔ هذا الأمر للإمبراطور فقط.", msg);
        return true;
    }
    const mentions = getMentionedList(msg);
    if (!mentions.length) {
        await send(sock, jid, "⚠️ الاستخدام: .حذف نقابتك @منشن_البوت", msg);
        return true;
    }

    for (const m of mentions) {
        if (jf.isMe(sock, m)) {
            // أنا البوت الممنشن
            const oldName = db.guildSelf?.name;
            db.guildSelf = null;
            saveDb();
            if (oldName) {
                await send(sock, jid,
                    `❆━━━━━═⏣⊰✅⊱⏣═━━━━━❆\nتم حذف اسم:  ${oldName}\n❆━━━━━═⏣⊰🛑⊱⏣═━━━━━❆`, msg);
            } else {
                await send(sock, jid, "⚠️ لا يوجد اسم نقابة مسجل لهذا البوت.", msg);
            }
        } else {
            // بوت آخر: نحذفه من سجل هذا البوت بصمت
            const f = findGuildBot(db, m);
            if (f) {
                for (const a of jf.aliasesOf(f.key)) delete guildBotsObj(db)[a];
                saveDb();
            }
        }
    }
    return true;
}

// ============================================================
// .نقابة 🔥 اسم   (الإمبراطور: إضافة اسم لرمز)
// ============================================================

async function handleAddGuildName(sock, jid, msg, parts, db, saveDb, owner) {
    if (!owner) {
        await send(sock, jid, "⛔ هذا الأمر للإمبراطور فقط.", msg);
        return true;
    }
    const emoji = stripEmoji(parts[0] || "");
    const name = parts.slice(1).join(" ").trim();
    if (!emoji || !name) {
        await send(sock, jid, "⚠️ الاستخدام: .نقابة 🔥 اسم_النقابة", msg);
        return true;
    }
    guildNamesObj(db)[emoji] = name;
    saveDb();
    await send(sock, jid, `✅ تم حفظ الرمز ${emoji} باسم النقابة: ${name}`, msg);
    return true;
}

// ============================================================
// .تعدد on/off   (داخل قروب الورك فقط)
// ============================================================

async function handleMultiToggle(sock, jid, msg, parts, db, saveDb, cleanSender, owner) {
    if (!(owner || hasLevel(db, cleanSender, "2", false))) {
        await send(sock, jid, "⛔ ليس لديك صلاحية.", msg);
        return true;
    }
    if (!isWorkGroup(db, jid)) {
        await send(sock, jid,
            `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆\n  *هذا الأمر يعمل فقط في*\n  *قروب الورك (WORK)*\n❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`, msg);
        return true;
    }
    const action = String(parts[0] || "").toLowerCase();
    db.multiGuild = db.multiGuild || {};
    if (action === "on") {
        db.multiGuild[jid] = true;
        saveDb();
        await send(sock, jid, "✅ تم تفعيل كشف التعدد بين النقابات في هذا القروب.", msg);
    } else if (action === "off") {
        delete db.multiGuild[jid];
        saveDb();
        await send(sock, jid, "❌ تم إيقاف كشف التعدد في هذا القروب.", msg);
    } else {
        await send(sock, jid, "⚠️ الاستخدام: .تعدد on/off", msg);
    }
    return true;
}

// ============================================================
// تحليل استمارة الورك
// ============================================================

function isWorkForm(rawText) {
    const t = cleanArabic(rawText);
    return t.includes("استماره") && (t.includes("الوورك") || t.includes("الورك"));
}

/** يرجع { members: [digits], nickname } من نص استمارة الورك */
function parseWorkForm(rawText) {
    const t = cleanArabic(rawText);
    const lines = t.split("\n");
    let mentionLine = "";
    let nickLine = "";
    for (const l of lines) {
        const line = l.replace(/[_*`]/g, "");
        if (/المنشن/.test(line) && /@\d{6,}/.test(line)) mentionLine = line;
        if (/اللقب/.test(line)) nickLine = line;
    }
    const members = [...mentionLine.matchAll(/@(\d{6,})/g)].map(m => m[1]);
    let nickname = "";
    const nm = nickLine.match(/┊\s*(.*?)\s*┊/);
    if (nm) nickname = nm[1].trim();
    return { members, nickname };
}

/**
 * مراقبة الاستمارات في قروب الورك (مع .تعدد on)
 * تحفظ العضو ونقابته فقط ولا ترد.
 */
async function processWorkForm(sock, jid, msg, rawText, db, saveDb) {
    try {
        if (msg?.key?.fromMe) return false;
        if (!isWorkGroup(db, jid)) return false;
        if (!(db.multiGuild && db.multiGuild[jid])) return false;
        if (!isWorkForm(rawText)) return false;

        const senderNum = jf.jnum(msg.key.participant || "");
        const bot = findGuildBot(db, senderNum);
        if (!bot) return false; // ليست من بوت نقابة معروف

        const { members, nickname } = parseWorkForm(rawText);
        if (!members.length) return false;

        db.guildMembers = db.guildMembers || {};
        for (const num of members) {
            const existingKey = jf.aliasesOf(num).find(a => db.guildMembers[a]);
            const key = existingKey || num;
            const rec = db.guildMembers[key] || { guilds: [], nickname: "" };
            if (!rec.guilds.includes(bot.entry.name)) rec.guilds.push(bot.entry.name);
            if (nickname) rec.nickname = nickname;
            rec.at = Date.now();
            db.guildMembers[key] = rec;
        }
        saveDb();
        return true;
    } catch (e) {
        console.error("❌ processWorkForm:", e?.message || e);
        return false;
    }
}

// ============================================================
// .مؤبد  /  .اعفاء   (بالرد على استمارة ورك)
// ============================================================

async function handleLifeBan(sock, jid, msg, db, saveDb, cleanSender, owner, mode) {
    if (!(owner || hasLevel(db, cleanSender, "2", false))) {
        await send(sock, jid, "⛔ ليس لديك صلاحية.", msg);
        return true;
    }
    if (!isWorkGroup(db, jid)) {
        await send(sock, jid,
            `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆\n  *هذا الأمر يعمل فقط في*\n  *قروب الورك (WORK)*\n❆━━━━━═⏣⊰⚠️⊱⏣═━━━━❆`, msg);
        return true;
    }

    const quotedText = getQuotedText(msg);
    if (!quotedText || !isWorkForm(quotedText)) {
        await send(sock, jid, `⚠️ يجب الرد على استمارة الورك بالأمر ${mode === "ban" ? ".مؤبد" : ".اعفاء"}`, msg);
        return true;
    }

    const { members, nickname } = parseWorkForm(quotedText);
    if (!members.length) {
        await send(sock, jid, "⚠️ لم أجد عضواً في خانة المنشن داخل الاستمارة.", msg);
        return true;
    }

    db.lifeBan = db.lifeBan || {};

    if (mode === "ban") {
        for (const num of members) {
            const existingKey = jf.aliasesOf(num).find(a => db.lifeBan[a]);
            db.lifeBan[existingKey || num] = { at: Date.now(), by: cleanSender, nickname };
        }
        saveDb();
        await send(sock, jid, `◆━─━─━─⊱⊰─━─━─━◆\n📍تم حفظ العضو مؤبد 🛑\n◆━─━─━─⊱⊰─━─━─━◆`, msg);
        return true;
    }

    // اعفاء
    let removed = 0;
    for (const num of members) {
        for (const a of jf.aliasesOf(num)) {
            if (db.lifeBan[a]) { delete db.lifeBan[a]; removed++; }
        }
    }
    if (removed > 0) {
        saveDb();
        await send(sock, jid, `◆━─━─━─⊱✅⊰─━─━─━◆\nتم فك حكم المؤبد عن هذا العضو\n◆━─━─━─⊱🟢⊰─━─━─━◆`, msg);
    }
    return true;
}

// ============================================================
// عند دخول عضو إلى قروب الاستقبال
// يرجع true إذا كان مؤبداً وتم طرده (فيُتخطى الترحيب العادي)
// ============================================================

function findLifeBan(db, number) {
    const lb = db.lifeBan || {};
    for (const a of jf.aliasesOf(number)) {
        if (lb[a]) return lb[a];
    }
    return null;
}

async function getStaffMentions(sock, groupJid, db) {
    const nums = new Set();
    const perm2 = (db.permissions && db.permissions["2"]) || [];
    perm2.forEach(n => nums.add(n));
    Object.keys(db.emperors || {}).forEach(n => { if (db.emperors[n]) nums.add(n); });
    try {
        require("./bot").getOwnerNumbers().forEach(n => nums.add(n));
    } catch (_) {}

    const parts = await jf.getGroupParticipants(sock, groupJid);
    const botNums = Object.keys(db.guildBots || {});
    const staff = [];
    const seen = new Set();

    if (Array.isArray(parts)) {
        for (const p of parts) {
            const pn = [...jf.participantNumbers(p)];
            if (pn.some(n => jf.isMe(sock, n) || botNums.some(b => jf.sameUser(b, n)))) continue;
            const isStaff = pn.some(n => [...nums].some(x => jf.sameUser(x, n)));
            if (isStaff) {
                const j = jf.jidOf(p);
                if (!seen.has(j)) { seen.add(j); staff.push(j); }
            }
        }
        if (staff.length === 0) {
            for (const p of parts) {
                if (p.admin === "admin" || p.admin === "superadmin") {
                    const pn = [...jf.participantNumbers(p)];
                    if (pn.some(n => jf.isMe(sock, n) || botNums.some(b => jf.sameUser(b, n)))) continue;
                    const j = jf.jidOf(p);
                    if (!seen.has(j)) { seen.add(j); staff.push(j); }
                }
            }
        }
    }
    return staff;
}

async function handleReceiveJoin(sock, groupJid, participant, db, saveDb) {
    try {
        const pJid = jf.jidOf(participant);
        const num = jf.jnum(pJid);
        if (!num) return false;

        // 1) مؤبد → رسالة + طرد
        if (findLifeBan(db, num)) {
            await send(sock, groupJid,
                `⌬━─⟐─ ⊱•♨️•⊰ ─⟐─━⌬\nانت محفوظ لدي مملكة النار\nبأنك مؤبد..  لهذا بص تحت:\n⌬━─⟐─ ⊱•♨️•⊰ ─⟐─━⌬`,
                null, { mentions: [pJid] });
            await sleep(1500);
            try { await sock.groupParticipantsUpdate(groupJid, [pJid], "remove"); } catch (_) {}
            return true;
        }

        // 2) تعدد → تنبيه للرتب
        const anyMulti = Object.values(db.multiGuild || {}).some(Boolean);
        if (anyMulti) {
            const key = jf.aliasesOf(num).find(a => db.guildMembers && db.guildMembers[a]);
            if (key) {
                const rec = db.guildMembers[key];
                const staff = await getStaffMentions(sock, groupJid, db);
                const staffText = staff.length ? staff.map(j => `@${jf.jnum(j)}`).join(" ") : "";
                const names = (rec.guilds || []).join(" / ");
                const text = `❆━━━━━═⏣⊰📡⊱⏣═━━━━━❆\n${staffText}\nايها الرتب هذا العضو :\n@${num}\nكان موجود في نقابة { ${names} } يرجى التحقق بشأنه\n❆━━━━━═⏣⊰📍⊱⏣═━━━━━❆`;
                await send(sock, groupJid, text, null, { mentions: [...staff, pJid] });
            }
        }
        return false;
    } catch (e) {
        console.error("❌ handleReceiveJoin:", e?.message || e);
        return false;
    }
}

// ============================================================
// .المؤبدين  → قائمة مزخرفة بمنشن لكل من حُفظ مؤبد
// ============================================================

async function handleLifeBanList(sock, jid, msg, db, saveDb, cleanSender, owner) {
    if (!(owner || hasLevel(db, cleanSender, "2", false) || hasLevel(db, cleanSender, "5", false))) {
        await send(sock, jid, "⛔ ليس لديك صلاحية.", msg);
        return true;
    }

    const lb = db.lifeBan || {};
    const seen = new Set();
    const nums = [];
    for (const key of Object.keys(lb)) {
        if (seen.has(key)) continue;
        for (const a of jf.aliasesOf(key)) seen.add(a); // نفس الشخص (LID ↔ رقم) يظهر مرة واحدة
        nums.push(key);
    }

    if (!nums.length) {
        await send(sock, jid,
            `◆━─━─━─⊱✅⊰─━─━─━◆\nلا يوجد أحد محفوظ مؤبد حالياً\n◆━─━─━─⊱🟢⊰─━─━─━◆`, msg);
        return true;
    }

    const jids = [];
    for (const n of nums) {
        try { jids.push(await jf.resolveJid(sock, jid, n)); }
        catch (_) { jids.push(`${jf.jnum(n)}@s.whatsapp.net`); }
    }

    const CHUNK = 40;
    for (let i = 0; i < nums.length; i += CHUNK) {
        const part = jids.slice(i, i + CHUNK);
        const first = i === 0;
        const last = i + CHUNK >= nums.length;

        let text = "";
        if (first) text += `◆━─━─━─⊱🛑⊰─━─━─━◆\n   قائمة المؤبدين\n◆━─━─━─⊱⛓️⊰─━─━─━◆\n`;
        text += part.map((j, k) => `${i + k + 1} ☜ @${jf.jnum(j)}`).join("\n");
        if (last) text += `\n◆━─━─━─⊱📍⊰─━─━─━◆\nالعدد: ${nums.length}\n◆━─━─━─⊱🛑⊰─━─━─━◆`;

        await send(sock, jid, text, first ? msg : null, { mentions: part });
        if (!last) await sleep(800);
    }
    return true;
}

module.exports = {
    handleIAmBot,
    handleDeleteGuild,
    handleAddGuildName,
    handleMultiToggle,
    processWorkForm,
    handleLifeBan,
    handleLifeBanList,
    handleReceiveJoin,
    isWorkForm,
    parseWorkForm,
    findLifeBan
};
