// ============================================================
// shop.js   (ملف جديد)
// ALJESAT BOT
//   • .متجر               قائمة الأسعار (في قروب البنك فقط)
//   • .بيع 🏺              بيع قطعة من المخزون بسعر عشوائي من 3 أسعار
//   • .تعديل متجر [نص]     الرسالة المخصصة (ثالث رسالة في المتجر)
//   • .شراء [رسالة]        إرسال طلب شراء إلى قروب الطلبات
//   • .طلبات on/off        تحديد قروب استقبال الطلبات
// ============================================================

"use strict";

const jf = require("./jidfix");

// ============================================================
// قائمة أسعار المتجر (كما كُتبت بالضبط: سعر / سعر / سعر)
// القطعتان 📖 و 💀 بدون نقطتين كما في القائمة الأصلية
// ============================================================

const SHOP_ITEMS_TEXT = `🏺 أمفورة رومانية:
2500/3800/1500
⚱️ جرة فخارية قديمة:
900/1500/600
🗿 تمثال حجري:
2600/3800/1600
🪨 حجر منقوش:
1500/2400/800
📜 مخطوطة قديمة:
3000/4500/1800
📖 كتاب جلدي قديم
2000/3200/1200
🧿 تميمة أثرية:
2200/3500/120
🔱 رمح ثلاثي قديم:
3000/4500/1800
🗝️ مفتاح أثري:
2600/4000/1500
🔒 قفل حديدي قديم:
1400/2200/700
⚔️ سيف أثري:
3500/5000/2200
🗡️ خنجر قديم:
3000/4500/1800
🛡️ درع أثري:
3200/4800/2000
🏹 قوس قديم:
2300/3500/1200
🪓 فأس قديم:
1200/1900/600
🔔 جرس أثري:
1200/2000/600
🕯️ شمعدان قديم:
1800/2800/900
⏳ ساعة رملية أثرية:
1800/2800/900
🕰️ ساعة جيب قديمة:
3200/5000/1800
🧭 بوصلة أثرية:
2500/3800/1400
🔭 منظار قديم:
2300/3500/1200
⚖️ ميزان نحاسي قديم:
2200/3400/1100
🪙 عملة فضية أثرية:
3000/4500/1800
💍 خاتم أثري:
3500/5200/2200
👑 تاج أثري:
4000/6400/2000
💎 جوهرة قديمة:
3800/5800/2200
🔮 كرة بلورية قديمة:
2500/4000/1200
🪞 مرآة أثرية:
2600/4000/1400
🪶 ريشة كتابة قديمة:
1000/1600/500
✒️ قلم حبر أثري:
1800/2800/900
🖋️ قلم ملكي قديم:
2300/3500/1200
🧰 صندوق أثري:
2600/4000/1400
📦 صندوق خشبي قديم:
1000/1600/500
🗃️ صندوق وثائق قديم:
2200/3400/1000
🧳 حقيبة جلدية عتيقة:
2200/3400/1000
🪵 لوح خشبي منقوش:
1400/2200/700
🪧 لوحة حجرية:
1800/2800/900
🏛️ قطعة من معبد قديم:
3200/5000/1800
🧱 حجر بناء أثري:
700/1200/400
☀️ قرص شمسي أثري:
3000/4500/1600
🌙 هلال أثري:
2300/3500/1200
🦅 تمثال نسر أثري:
3000/4500/1700
🦁 تمثال أسد حجري:
3200/4800/1800
🐍 تمثال أفعى أثري:
2600/4000/1400
🐉 تمثال تنين قديم:
3500/5200/2000
🦂 تميمة عقرب:
2200/3400/1000
👁️ عين أثرية:
2600/4000/1200
💀 قناع عظمي أثري
2600/4000/1300
🎭 قناع مسرحي قديم:
1800/2800/800
👺 قناع حجري:
1900/3000/900
🪬 تعويذة قديمة:
2500/3800/1200
🏅 وسام أثري:
2300/3500/1100
🎖️ وسام حربي قديم:
2600/4000/1300
📯 بوق ملكي:
2800/4200/1500
🎺 بوق نحاسي قديم:
1800/2800/800
🥁 طبلة أثرية:
1200/1900/600
🎻 آلة موسيقية قديمة:
2500/3800/1200
🧵 نسيج أثري:
1700/2600/800
🧺 سلة أثرية:
800/1200/400
🪢 حبل قديم:
500/800/250
🧴 قارورة زجاجية أثرية:
2000/3200/1000
🧪 قارورة كيميائية قديمة:
1400/2200/700
⚗️ أداة كيميائية أثرية:
1800/2800/900
🍶 إبريق خزفي قديم:
1100/1800/600
🥣 وعاء حجري أثري:
800/1300/400
🍷 كأس ملكي قديم:
2800/4200/1500
🥄 ملعقة فضية أثرية:
1400/2200/700
🔪 سكين أثري:
1800/2800/900
🔐 صندوق كنز أثري:
3500/5200/2000
💰 كيس نقود قديم:
2600/4000/1400
🗺️ خريطة كنز قديمة:
3000/4600/1600
✉️ خطاب ملكي قديم:
3000/4500/1500
🔴 ختم شمعي ملكي:
4000/6000/2200
🏰 قلعة قديمة:
3800/5800/2000`;

/** إزالة محدد الإيموجي (FE0F) والمسافات للمقارنة */
function stripEmoji(e) {
    return String(e || "").replace(/[\uFE0E\uFE0F\u200d\s]/g, "");
}

/** تحليل القائمة إلى عناصر: { emoji, name, prices:[a,b,c], colon } */
function parseShopItems(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const items = [];
    for (let i = 0; i < lines.length; i += 2) {
        const head = lines[i];
        const priceLine = lines[i + 1] || "";
        const prices = priceLine.split("/").map(x => parseInt(x, 10)).filter(Number.isFinite);
        const firstSpace = head.indexOf(" ");
        if (firstSpace === -1 || prices.length !== 3) continue;
        const emoji = head.slice(0, firstSpace);
        const colon = head.endsWith(":");
        const name = head.slice(firstSpace + 1).replace(/:$/, "").trim();
        items.push({ emoji, key: stripEmoji(emoji), name, prices, colon });
    }
    return items;
}

const SHOP_ITEMS = parseShopItems(SHOP_ITEMS_TEXT);

// ============================================================
// أدوات
// ============================================================

async function send(sock, jid, text, quoted = null, extra = {}) {
    if (!sock || !jid) return null;
    try {
        return await sock.sendMessage(jid, { text: String(text), ...extra }, quoted ? { quoted } : undefined);
    } catch (e) {
        console.error("❌ shop.send:", e?.message || e);
        return null;
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function hasLevel(db, number, level, owner) {
    if (owner) return true;
    const list = db.permissions && db.permissions[String(level)];
    if (!Array.isArray(list)) return false;
    return jf.aliasesOf(number).some(a => list.includes(a));
}

function isBankGroup(db, jid) {
    return Boolean(db.bankGroups && db.bankGroups[jid]);
}

function isMainGroup(db, jid) {
    return Boolean(db.mainGroup && db.mainGroup[jid] === true);
}

function getUserEntry(db, number) {
    const found = jf.pickByAlias(db.users, number);
    return found ? { key: found.key, user: found.value } : null;
}

function buildShopList() {
    let text = "⌬━─⟐─ ⊱•┇المتجر┇•⊰ ─⟐─━⌬\n";
    for (const it of SHOP_ITEMS) {
        text += `${it.emoji} ${it.name}${it.colon ? ":" : ""}\n${it.prices.join("/")}\n`;
    }
    text += "\n⌬━─⟐─ ⊱•┇إنتهى┇•⊰ ─⟐─━⌬\n\n";
    text += "ملاحظة:\n";
    text += "◆━─━─━─⊱⊰─━─━─━◆\n";
    text += "اذا كنت تملك إحدى القطع\n";
    text += "يمكنك أن تبيعها عبر هذا الامر:\n";
    text += "مثال:\n";
    text += ".بيع 🏺\n";
    text += "وسيتم شراء القطعة منك بأحد الاسعار الثلاثة المذكورة في الأعلى\n";
    text += "◆━─━─━─⊱⊰─━─━─━◆\n";
    text += "هناك قطع لها اكثر من سعر...\n";
    text += "✧ الامر يعود على نسبة حظك ✿";
    return text;
}

/**
 * سعر عشوائي من 3 أسعار، مع تقليل احتمال أعلى سعر بنسبة 65%
 * (وزن الأعلى = 0.35 من وزن كل سعر آخر)
 */
function pickPrice(prices) {
    const max = Math.max(...prices);
    let maxUsed = false;
    const weights = prices.map(p => {
        if (p === max && !maxUsed) { maxUsed = true; return 0.35; }
        return 1;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < prices.length; i++) {
        r -= weights[i];
        if (r <= 0) return prices[i];
    }
    return prices[prices.length - 1];
}

// ============================================================
// .متجر
// ============================================================

async function handleShop(sock, jid, msg, db, cleanSender) {
    if (!isBankGroup(db, jid)) {
        await send(sock, jid,
            `◆━─━─━─⊱⚠️⊰─━─━─━◆\nالمتجر يعمل فقط في قروب البنك\n◆━─━─━─⊱⛔⊰─━─━─━◆`, msg);
        return true;
    }

    const sender = msg?.key?.participant || msg?.key?.remoteJid;

    // 1) رسالة المنشن
    await send(sock, jid,
        `◆━─━─━─⊱🏦⊰─━─━─━◆\nالمستخدم @${jf.jnum(sender)}\nلقد طلبت قائمة للمتجر تفضل:\n◆━─━─━─⊱🛒⊰─━─━─━◆`,
        msg, { mentions: [sender] });
    await sleep(800);

    // 2) قائمة الأسعار
    await send(sock, jid, buildShopList());
    await sleep(800);

    // 3) الرسالة المخصصة
    const custom = String(db.shopMessage || "").trim();
    if (custom) await send(sock, jid, custom);
    return true;
}

// ============================================================
// .تعديل متجر [الرسالة]
// ============================================================

async function handleEditShop(sock, jid, msg, text, db, saveDb, cleanSender, owner) {
    if (!(owner || hasLevel(db, cleanSender, "1", false))) {
        await send(sock, jid, "⛔ هذا الأمر يحتاج صلاحية .سماح 1", msg);
        return true;
    }
    // نأخذ كل النص بعد "تعديل متجر" مع الحفاظ على الأسطر
    const body = String(text || "").replace(/^\.\s*تعديل\s+متجر/, "").trim();
    if (!body) {
        await send(sock, jid, "⚠️ الاستخدام:\n.تعديل متجر\nالرسالة التي تريدها", msg);
        return true;
    }
    db.shopMessage = body;
    saveDb();
    await send(sock, jid, "✅ تم حفظ قائمة المتجر رقم 2", msg);
    return true;
}

// ============================================================
// .بيع 🏺
// ============================================================

async function handleSell(sock, jid, msg, parts, db, saveDb, cleanSender) {
    if (!(isBankGroup(db, jid) || isMainGroup(db, jid))) {
        await send(sock, jid,
            `◆━─━─━─⊱⚠️⊰─━─━─━◆\nالبيع يعمل فقط في قروب البنك أو القروب الأساسي\n◆━─━─━─⊱⛔⊰─━─━─━◆`, msg);
        return true;
    }

    const emojiArg = stripEmoji(parts.join(""));
    if (!emojiArg) {
        await send(sock, jid, "⚠️ الاستخدام: .بيع 🏺\n(ضع إيموجي القطعة التي تملكها)", msg);
        return true;
    }

    const entry = getUserEntry(db, cleanSender);
    if (!entry || !String(entry.user.nickname || "").trim()) {
        await send(sock, jid, "❌ يجب أن يكون لك لقب مسجل عبر .سجل لتتمكن من البيع.", msg);
        return true;
    }

    const shopItem = SHOP_ITEMS.find(it => it.key === emojiArg);
    if (!shopItem) {
        await send(sock, jid, "⚠️ هذه القطعة غير موجودة في قائمة المتجر.\nاكتب .متجر لرؤية القطع.", msg);
        return true;
    }

    db.inventory = db.inventory || {};
    const invKey = jf.aliasesOf(cleanSender).find(a => Array.isArray(db.inventory[a]) && db.inventory[a].length) || entry.key;
    const inv = Array.isArray(db.inventory[invKey]) ? db.inventory[invKey] : [];
    const idx = inv.findIndex(i => stripEmoji(i.emoji) === shopItem.key);

    if (idx === -1) {
        await send(sock, jid, "⚠️ لا تملك هذه القطعة في مخزونك.\nاكتب .مخزوني لرؤية ما تملك.", msg);
        return true;
    }

    const price = pickPrice(shopItem.prices);
    inv.splice(idx, 1);
    db.inventory[invKey] = inv;
    entry.user.balance = (Number(entry.user.balance) || 0) + price;
    saveDb();

    await send(sock, jid, `▬▬▬▬${shopItem.emoji}▬▬▬▬\nتم بيع القطعة بسعر:\n☜ ${price} ☞\n▬▬▬▬🛒▬▬▬▬`, msg);
    return true;
}

// ============================================================
// .طلبات on/off
// ============================================================

async function handleOrdersToggle(sock, jid, msg, parts, db, saveDb, cleanSender, owner) {
    if (!(owner || hasLevel(db, cleanSender, "1", false))) {
        await send(sock, jid, "⛔ هذا الأمر يحتاج صلاحية .سماح 1", msg);
        return true;
    }
    const action = String(parts[0] || "").toLowerCase();
    db.orderGroups = db.orderGroups || {};
    if (action === "on") {
        db.orderGroups[jid] = true;
        saveDb();
        await send(sock, jid, "✅ تم تعيين هذا القروب لاستقبال طلبات الشراء 🛒", msg);
    } else if (action === "off") {
        delete db.orderGroups[jid];
        saveDb();
        await send(sock, jid, "❌ تم إيقاف استقبال طلبات الشراء في هذا القروب.", msg);
    } else {
        await send(sock, jid, "⚠️ الاستخدام: .طلبات on/off", msg);
    }
    return true;
}

// ============================================================
// .شراء [رسالة]
// ============================================================

async function handleBuyRequest(sock, jid, msg, text, db, cleanSender) {
    const body = String(text || "").replace(/^\.\s*شراء/, "").trim();
    if (!body) {
        await send(sock, jid, "⚠️ الاستخدام: .شراء ما تريد شراءه\nمثال: .شراء بطاقة ترقية", msg);
        return true;
    }

    const entry = getUserEntry(db, cleanSender);
    const nickname = (entry && String(entry.user.nickname || "").trim()) || "";
    if (!nickname) {
        await send(sock, jid, "❌ يجب أن يكون لك لقب مسجل عبر .سجل لتتمكن من إرسال طلب شراء.", msg);
        return true;
    }

    const targets = Object.keys(db.orderGroups || {}).filter(g => db.orderGroups[g]);
    if (targets.length === 0) {
        await send(sock, jid, "⚠️ لم يتم تحديد قروب لاستقبال الطلبات بعد.\nيجب على المسؤول كتابة .طلبات on في القروب المخصص.", msg);
        return true;
    }

    const order = `❆━━━━━═⏣⊰🛒⊱⏣═━━━━━❆\nطَلَبَ ${nickname} شراء ${body}\n❆━━━━━═⏣⊰🏦⊱⏣═━━━━━❆`;
    let sent = 0;
    for (const g of targets) {
        const r = await send(sock, g, order);
        if (r) sent++;
    }

    await send(sock, jid,
        sent > 0 ? "✅ تم إرسال طلبك بنجاح، انتظر تواصل المسؤولين معك." : "⚠️ تعذر إرسال الطلب حالياً، حاول لاحقاً.",
        msg);
    return true;
}

module.exports = {
    SHOP_ITEMS,
    buildShopList,
    pickPrice,
    handleShop,
    handleEditShop,
    handleSell,
    handleOrdersToggle,
    handleBuyRequest
};
