// ============================================================
// Ai.js   (ملف جديد)
// ALJESAT BOT
// إحضار صور الشخصيات من Pinterest (تم حذف أمر الإنشاء)
//
//   .احضر <اسم>      → يبحث في Pinterest عن صورة الشخصية، يحسّن دقتها،
//                       ويكتب اسمها + "نورت/ي نقابة <اسم النقابة>" أسفلها
//   .تعديل           → (الإمبراطور) البوت يطلب اسم النقابة، ثم يحفظه
//
// الشروط:
//   • يعمل فقط في قروب الاستقبال (الذي أُرسل فيه أمر .استقبال)
//   • فقط لمن يملك صلاحية .سماح 5 (أو الإمبراطور/المالك)
//   • ⏳ على الأمر أثناء العمل، ثم ✅ ويرد البوت بالصورة
//
// المتطلبات: Node 20+ و sharp (موجود في package.json)
// لا يحتاج أي مفتاح API.
// ============================================================

"use strict";

// يحمّل settings.js حتى تُقرأ مفاتيح الرؤية (GEMINI_API_KEY / ANTHROPIC_API_KEY) منه
try { require("./settings"); } catch (_) {}

const fs = require("fs");
const path = require("path");

// ============================================================
// تحميل sharp (اختياري - إن لم يوجد نرسل الصورة بدون معالجة)
// ============================================================

let sharp = null;
try {
    sharp = require("sharp");
    try { sharp.cache(false); } catch (_) {}
} catch (_) {
    console.warn("⚠️ Ai.js: مكتبة sharp غير مثبتة — لن تُكتب الأسماء على الصورة.");
}

// ============================================================
// إعدادات
// ============================================================

const CACHE_DIR = path.join(__dirname, "ai_cache");
const EMOJI_DIR = path.join(CACHE_DIR, "emoji");
const FONT_DIR = path.join(__dirname, "fonts");

try { fs.mkdirSync(EMOJI_DIR, { recursive: true }); } catch (_) {}
try { fs.mkdirSync(FONT_DIR, { recursive: true }); } catch (_) {}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const JOB_TIMEOUT_MS = 130 * 1000;      // أقصى مدة لكل طلب
const FETCH_BUDGET_MS = 105 * 1000;     // ميزانية البحث عن صورة الشخصية
const USER_COOLDOWN_MS = 6 * 1000;     // فاصل بين طلبات نفس العضو
const SLOW_NOTICE_MS = 11 * 1000;      // بعدها نرسل رسالة «الصورة صعبة، انتظر»
const MAX_PARALLEL = 3;                // أقصى عدد طلبات متزامنة
const EDIT_WAIT_MS = 3 * 60 * 1000;    // مهلة إرسال اسم النقابة بعد .تعديل
const OUT_WIDTH = 1080;                // عرض الصورة النهائية لـ .احضر

// ============================================================
// أدوات عامة
// ============================================================

let jf = null;
try { jf = require("./jidfix"); } catch (_) {}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isGroupJid(jid) {
    return typeof jid === "string" && jid.endsWith("@g.us");
}

function normArabic(s) {
    return String(s || "")
        .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .trim()
        .toLowerCase();
}

function hasArabic(s) {
    return /[\u0600-\u06FF]/.test(String(s || ""));
}

function escXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function safeSend(sock, jid, content, options) {
    try {
        return await sock.sendMessage(jid, content, options);
    } catch (e) {
        console.error("❌ Ai.safeSend:", e?.message || e);
        return null;
    }
}

async function react(sock, jid, key, emoji) {
    if (!key) return;
    try {
        await sock.sendMessage(jid, { react: { text: emoji, key } });
    } catch (_) {}
}

/** تنزيل ملف مع مهلة وحد أقصى للحجم */
async function fetchBuf(url, { timeout = 10000, headers = {}, maxBytes = 15 * 1024 * 1024, method = "GET", body = null } = {}) {
    const res = await fetch(url, {
        method,
        body,
        headers: { "User-Agent": UA, ...headers },
        redirect: "follow",
        signal: AbortSignal.timeout(Math.max(1000, timeout))
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const len = Number(res.headers.get("content-length") || 0);
    if (len && len > maxBytes) throw new Error("too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("too large");
    return buf;
}

function imageKind(buf) {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
    if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
    if (buf.toString("ascii", 0, 3) === "GIF") return "gif";
    return null;
}

function decodeHtml(s) {
    return String(s)
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

// ============================================================
// الصلاحيات
// ============================================================

/** هل العضو يستطيع استعمال الذكاء الاصطناعي؟ (صلاحية 5 أو الإمبراطور/المالك) */
function canUse(db, cleanSender, owner) {
    if (owner) return true;
    try {
        const list = db && db.permissions && db.permissions["5"];
        if (!Array.isArray(list) || !list.length) return false;
        const candidates = jf ? jf.aliasesOf(cleanSender) : [String(cleanSender)];
        return candidates.some(n => list.includes(n));
    } catch (_) {
        return false;
    }
}

function isReceiveGroup(db, jid) {
    return Boolean(db && db.receiveGroups && db.receiveGroups[jid]);
}

// ============================================================
// الخطوط (عربي) — الأفضل Tajawal، وإلا DejaVu المرفق
// ============================================================

const FONT_CANDIDATES = [
    { file: path.join(FONT_DIR, "Tajawal-Bold.ttf"), family: "Tajawal Bold" },
    { file: path.join(CACHE_DIR, "Tajawal-Bold.ttf"), family: "Tajawal Bold" },
    { file: path.join(FONT_DIR, "DejaVuSans-Bold.ttf"), family: "DejaVu Sans Bold" },
    { file: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", family: "DejaVu Sans Bold" }
];

function isFontBuffer(buf) {
    if (!buf || buf.length < 20000) return false;
    const tag = buf.toString("ascii", 0, 4);
    return (buf[0] === 0 && buf[1] === 1 && buf[2] === 0 && buf[3] === 0) || tag === "true" || tag === "OTTO";
}

function pickFont() {
    for (const f of FONT_CANDIDATES) {
        try {
            if (fs.existsSync(f.file) && fs.statSync(f.file).size > 20000) return f;
        } catch (_) {}
    }
    return { file: undefined, family: "sans bold" };
}

// تنزيل خط Tajawal مرة واحدة في الخلفية (اختياري، لا يؤثر إن فشل)
async function ensureNiceFont() {
    try {
        const target = path.join(CACHE_DIR, "Tajawal-Bold.ttf");
        if (fs.existsSync(target) || fs.existsSync(path.join(FONT_DIR, "Tajawal-Bold.ttf"))) return;
        const urls = [
            "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tajawal/Tajawal-Bold.ttf",
            "https://raw.githubusercontent.com/google/fonts/main/ofl/tajawal/Tajawal-Bold.ttf"
        ];
        for (const u of urls) {
            try {
                const buf = await fetchBuf(u, { timeout: 15000, maxBytes: 5 * 1024 * 1024 });
                if (isFontBuffer(buf)) {
                    fs.writeFileSync(target, buf);
                    return;
                }
            } catch (_) {}
        }
    } catch (_) {}
}
setTimeout(() => { ensureNiceFont().catch(() => {}); }, 8000).unref?.();

// ============================================================
// الإيموجي الملوّن (Twemoji) — يحافظ على ألوان الإيموجي الأصلية
// ============================================================

function emojiCodes(seq) {
    const cps = [...seq].map(c => c.codePointAt(0));
    const hasZwj = cps.includes(0x200d);
    const stripped = (hasZwj ? cps : cps.filter(c => c !== 0xfe0f)).map(c => c.toString(16)).join("-");
    const full = cps.map(c => c.toString(16)).join("-");
    return stripped === full ? [stripped] : [stripped, full];
}

async function getEmojiPng(seq) {
    const codes = emojiCodes(seq);
    for (const code of codes) {
        const file = path.join(EMOJI_DIR, code + ".png");
        try {
            if (fs.existsSync(file)) return fs.readFileSync(file);
        } catch (_) {}
    }
    for (const code of codes) {
        const urls = [
            `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${code}.png`,
            `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`
        ];
        for (const u of urls) {
            try {
                const buf = await fetchBuf(u, { timeout: 7000, maxBytes: 2 * 1024 * 1024 });
                if (imageKind(buf) === "png") {
                    try { fs.writeFileSync(path.join(EMOJI_DIR, code + ".png"), buf); } catch (_) {}
                    return buf;
                }
            } catch (_) {}
        }
    }
    return null;
}

// ============================================================
// تنظيف اسم النقابة: نص + إيموجي فقط (بدون الزخرفة)
// ============================================================

function emojiRegex() {
    return /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?![0-9#*])\p{Emoji}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D(?![0-9#*])\p{Emoji}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;
}

/** يحوّل نصاً مزخرفاً إلى مقاطع: {type:"text"|"emoji", value} */
function toTokens(raw) {
    let s = String(raw || "");
    s = s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u200b\ufeff\u0640]/g, "");
    s = s.replace(/@\d{5,}/g, " ");
    try { s = s.normalize("NFKC"); } catch (_) {}

    const tokens = [];
    const pushText = (t) => {
        const cleaned = String(t)
            .replace(/[\uFE0E\uFE0F\u200D]/g, "")
            .replace(/[^\p{L}\p{M}\p{N}\s.'&!\-]/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (!cleaned) return;
        const last = tokens[tokens.length - 1];
        if (last && last.type === "text") last.value += " " + cleaned;
        else tokens.push({ type: "text", value: cleaned });
    };

    let idx = 0;
    for (const m of s.matchAll(emojiRegex())) {
        pushText(s.slice(idx, m.index));
        tokens.push({ type: "emoji", value: m[0] });
        idx = m.index + m[0].length;
    }
    pushText(s.slice(idx));
    return tokens;
}

function tokensToPlain(tokens) {
    return tokens.map(t => t.value).join(" ").trim();
}

// ============================================================
// رسم النص والإيموجي بـ sharp
// ============================================================

async function renderText(text, size, color, rtl) {
    const font = pickFont();
    const t = (rtl ? "\u200F" : "") + text;
    const opts = {
        text: `<span foreground="${color}" size="${Math.max(1, Math.round(size * 1024))}">${escXml(t)}</span>`,
        font: font.family,
        rgba: true,
        dpi: 72
    };
    if (font.file) opts.fontfile = font.file;
    const { data, info } = await sharp({ text: opts }).png().toBuffer({ resolveWithObject: true });
    return { input: data, width: info.width, height: info.height };
}

/** يرسم سطراً كاملاً (نص + إيموجي) ويصغّره تلقائياً ليتسع في العرض */
async function renderLine(tokens, size, color, maxWidth, rtl) {
    let scale = 1;

    for (let attempt = 0; attempt < 2; attempt++) {
        const s = Math.max(10, Math.round(size * scale));
        const emojiSize = Math.round(s * 1.08);
        const pieces = [];

        for (const tk of tokens) {
            if (tk.type === "text") {
                pieces.push(await renderText(tk.value, s, color, rtl));
            } else {
                const png = await getEmojiPng(tk.value);
                if (!png) continue;
                const input = await sharp(png)
                    .resize(emojiSize, emojiSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .png()
                    .toBuffer();
                pieces.push({ input, width: emojiSize, height: emojiSize });
            }
        }
        if (!pieces.length) return null;

        const gap = Math.round(s * 0.28);
        const total = pieces.reduce((a, p) => a + p.width, 0) + gap * (pieces.length - 1);

        if (total > maxWidth && attempt === 0) {
            scale = (maxWidth / total) * 0.97;
            continue;
        }

        const height = Math.max(...pieces.map(p => p.height));
        const layers = [];
        let x = rtl ? total : 0;
        for (const p of pieces) {
            const top = Math.round((height - p.height) / 2);
            if (rtl) {
                x -= p.width;
                layers.push({ input: p.input, left: Math.max(0, x), top });
                x -= gap;
            } else {
                layers.push({ input: p.input, left: x, top });
                x += p.width + gap;
            }
        }

        let line = await sharp({
            create: { width: Math.max(1, total), height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
        }).composite(layers).png().toBuffer();

        let width = total;
        let h = height;
        if (width > maxWidth) {
            const r = await sharp(line).resize({ width: maxWidth }).png().toBuffer({ resolveWithObject: true });
            line = r.data; width = r.info.width; h = r.info.height;
        }
        return { input: line, width, height: h };
    }
    return null;
}

// ============================================================
// تحسين الصورة + كتابة الاسم والنقابة أسفلها
// ============================================================

async function enhanceImage(buf, W) {
    const base = await sharp(buf, { failOn: "none" })
        .rotate()
        .flatten({ background: "#ffffff" })
        .toColourspace("srgb")
        .png()
        .toBuffer({ resolveWithObject: true });

    const w = base.info.width;
    const h = base.info.height;
    const scale = Math.min(W / w, 1500 / h);
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    let working = base.data;

    // تكبير كبير على خطوتين لتقليل التشوّش
    if (scale > 2.2) {
        working = await sharp(working)
            .resize({ width: Math.round(w * 2), kernel: "lanczos3" })
            .sharpen({ sigma: 0.7 })
            .png()
            .toBuffer();
    }

    const out = await sharp(working)
        .resize(tw, th, { fit: "fill", kernel: "lanczos3" })
        .sharpen({ sigma: scale > 1 ? 1.2 : 0.6, m1: 0.8, m2: 2.0 })
        .png()
        .toBuffer();

    return { buffer: out, width: tw, height: th };
}

async function buildCaptionedImage(imageBuf, nameRaw, guildRaw) {
    const W = OUT_WIDTH;
    const PAD = 36;

    const enhanced = await enhanceImage(imageBuf, W);

    let nameTokens = toTokens(nameRaw);
    if (!nameTokens.length) nameTokens = [{ type: "text", value: String(nameRaw || "").trim() || "—" }];

    const line1 = await renderLine(nameTokens, 70, "#FFFFFF", W - PAD * 2, hasArabic(nameRaw));

    let line2 = null;
    const guildTokens = guildRaw ? toTokens(guildRaw) : [];
    if (guildTokens.length) {
        line2 = await renderLine(
            [{ type: "text", value: "نورت/ي نقابة" }, ...guildTokens],
            46, "#FFD76A", W - PAD * 2, true
        );
    }

    if (!line1 && !line2) throw new Error("caption render failed");

    const gap = 16;
    const bandH = PAD + (line1 ? line1.height : 0) + (line1 && line2 ? gap : 0) + (line2 ? line2.height : 0) + PAD;
    const totalH = enhanced.height + bandH;

    // خلفية: نفس الصورة مموّهة وداكنة (تملأ الجوانب إن كانت الصورة أضيق)
    const bg = await sharp(enhanced.buffer)
        .resize(W, totalH, { fit: "cover" })
        .blur(32)
        .modulate({ brightness: 0.4 })
        .png()
        .toBuffer();

    const layers = [];
    layers.push({ input: enhanced.buffer, left: Math.round((W - enhanced.width) / 2), top: 0 });

    // شريط الاسم
    const band = await sharp({
        create: { width: W, height: bandH, channels: 4, background: { r: 8, g: 8, b: 14, alpha: 0.86 } }
    }).png().toBuffer();
    layers.push({ input: band, left: 0, top: enhanced.height });

    // خط ذهبي رفيع
    const accent = await sharp({
        create: { width: W, height: 4, channels: 4, background: { r: 255, g: 215, b: 106, alpha: 1 } }
    }).png().toBuffer();
    layers.push({ input: accent, left: 0, top: enhanced.height });

    let y = enhanced.height + PAD;
    if (line1) {
        layers.push({ input: line1.input, left: Math.max(0, Math.round((W - line1.width) / 2)), top: y });
        y += line1.height + gap;
    }
    if (line2) {
        layers.push({ input: line2.input, left: Math.max(0, Math.round((W - line2.width) / 2)), top: y });
    }

    return await sharp(bg)
        .composite(layers)
        .jpeg({ quality: 93, chromaSubsampling: "4:4:4" })
        .toBuffer();
}

// ============================================================
// الترجمة للإنجليزية (تحسّن نتائج الإنشاء والبحث)
// ============================================================

async function toEnglish(text) {
    if (!hasArabic(text)) return text;
    try {
        const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=ar&tl=en&dt=t&q=" + encodeURIComponent(text);
        const buf = await fetchBuf(url, { timeout: 6000, maxBytes: 200000 });
        const j = JSON.parse(buf.toString("utf8"));
        const out = (Array.isArray(j[0]) ? j[0] : []).map(x => x && x[0]).filter(Boolean).join("").trim();
        return out || text;
    } catch (_) {
        return text;
    }
}

// ============================================================
// فلتر محتوى بسيط (حماية القروب)
// ============================================================

const BLOCK_AR = /(عاري|عارية|عاريه|عري|سكس|اباحي|إباحي|جنس|ثدي|طيز|نيك|قضيب|اغتصاب|بورن)/;
const BLOCK_EN = /\b(nude|naked|nsfw|porn|porno|sex|sexy|xxx|erotic|hentai|boobs|nipples|genitals|rape|topless)\b/i;

function isBlockedPrompt(...texts) {
    return texts.some(t => BLOCK_AR.test(String(t || "")) || BLOCK_EN.test(String(t || "")));
}

// ============================================================
// .احضر — جلب صورة الشخصية من Pinterest (ثم مصادر احتياطية)
// ============================================================

// أسماء عربية شائعة → الاسم الإنجليزي الصحيح (الترجمة الآلية تخطئ كثيراً في أسماء الأنمي)
const NAME_ALIASES = {
    "كاكاشي": "Kakashi Hatake", "ناروتو": "Naruto Uzumaki", "ساسكي": "Sasuke Uchiha",
    "هيناتا": "Hinata Hyuga", "ايتاتشي": "Itachi Uchiha", "مادارا": "Madara Uchiha",
    "يوريتشي": "Yoriichi Tsugikuni", "الوكا": "Alluka Zoldyck", "كيلوا": "Killua Zoldyck", "كيلوة": "Killua Zoldyck", "غون": "Gon Freecss",
    "ليفاي": "Levi Ackerman", "ايرين": "Eren Yeager", "ميكاسا": "Mikasa Ackerman",
    "غوكو": "Goku", "لوفي": "Monkey D Luffy", "زورو": "Roronoa Zoro",
    "غوجو": "Satoru Gojo", "ساتورو غوجو": "Satoru Gojo", "ايتادوري": "Yuji Itadori",
    "نيزوكو": "Nezuko Kamado", "تانجيرو": "Tanjiro Kamado", "زينيتسو": "Zenitsu Agatsuma",
    "اينوسكي": "Inosuke Hashibira",
    "ساي ايتوشي": "Sae Itoshi", "ساي ايتوشى": "Sae Itoshi", "رين ايتوشي": "Rin Itoshi",
    "ايساغي": "Yoichi Isagi", "ايساجي": "Yoichi Isagi", "يويتشي ايساغي": "Yoichi Isagi",
    "باتشيرا": "Meguru Bachira", "ناغي": "Seishiro Nagi", "ريو ميكاغي": "Reo Mikage",
    "ايتاشي": "Itachi Uchiha", "ايتاتشي": "Itachi Uchiha", "رينغوكو": "Kyojuro Rengoku", "ساكورا": "Sakura Haruno"
};

// يُستبعد فقط ما لا يمثل الشخصية (مجسمات/منتجات). أعمال المعجبين مقبولة لأن Pinterest أغلبه كذلك
// أسماء الأنميات الشائعة (الترجمة الآلية تخطئ فيها)
const SERIES_ALIASES = {
    "بلو لوك": "Blue Lock", "ناروتو": "Naruto", "ون بيس": "One Piece", "بليتش": "Bleach",
    "اتاك اون تايتن": "Attack on Titan", "هجوم العمالقة": "Attack on Titan",
    "ديمون سلاير": "Demon Slayer", "قاتل الشياطين": "Demon Slayer", "كيميتسو نو يايبا": "Demon Slayer",
    "جوجوتسو كايسن": "Jujutsu Kaisen", "جوجتسو كايسن": "Jujutsu Kaisen",
    "هنتر x هنتر": "Hunter x Hunter", "هنتر في هنتر": "Hunter x Hunter", "هانتر": "Hunter x Hunter",
    "دراغون بول": "Dragon Ball", "ديث نوت": "Death Note", "طوكيو غول": "Tokyo Ghoul",
    "ماي هيرو اكاديميا": "My Hero Academia", "بوكو نو هيرو": "My Hero Academia",
    "تشينسو مان": "Chainsaw Man", "سباي فاميلي": "Spy x Family", "سولو ليفلينغ": "Solo Leveling",
    "فيري تيل": "Fairy Tail", "هايكيو": "Haikyuu", "اوفرلورد": "Overlord", "فاير فورس": "Fire Force"
};

const BAD_TITLE = /(cosplay|figure|funko|lego|keychain|plush|toy|sticker|t-?shirt|merch|poster sale)/i;
const BAD_HOST = /(shutterstock|alamy|dreamstime|istockphoto|123rf|depositphotos|gettyimages|stock\.adobe|facebook|fbsbx|instagram|tiktok|lookaside)/i;

const PIN_HEADERS = {
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "X-Pinterest-AppState": "active",
    "X-Pinterest-PWS-Handler": "www/search/[scope].js"
};

/** إلى رابط الصورة الأصلية الكبيرة */
function pinOriginal(u) {
    return String(u || "").replace(/\/(?:\d+x(?:\d+)?|236x|474x|564x|736x)\//, "/originals/");
}

/** بحث Pinterest الرسمي الداخلي (JSON) — الأدق */
async function searchPinterestApi(q) {
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(q)}&rs=typed`;
    const data = {
        options: { query: q, scope: "pins", rs: "typed", source_url: sourceUrl, page_size: 40, redux_normalize_feed: true },
        context: {}
    };
    const url = "https://www.pinterest.com/resource/BaseSearchResource/get/" +
        `?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify(data))}&_=${Date.now()}`;
    const j = JSON.parse((await fetchBuf(url, {
        timeout: 10000, maxBytes: 4 * 1024 * 1024,
        headers: { ...PIN_HEADERS, Referer: "https://www.pinterest.com" + sourceUrl }
    })).toString("utf8"));

    const results = j?.resource_response?.data?.results || [];
    const out = [];
    for (const p of results) {
        const im = p?.images;
        if (!im) continue;
        const best = im.orig?.url || im["736x"]?.url || im["564x"]?.url;
        if (!best) continue;
        const alts = [im["736x"]?.url, im["564x"]?.url].filter(Boolean);
        out.push({
            url: best, alt: alts, source: "pinterest",
            title: [p.grid_title, p.title, p.description].filter(Boolean).join(" ")
        });
    }
    return out;
}

/** احتياطي: قراءة صفحة البحث نفسها واستخراج روابط pinimg بالترتيب */
async function searchPinterestHtml(q) {
    const html = (await fetchBuf(`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}&rs=typed`, {
        timeout: 10000, maxBytes: 6 * 1024 * 1024,
        headers: { "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" }
    })).toString("utf8");

    const seen = new Set();
    const out = [];
    for (const m of html.matchAll(/https:\\?\/\\?\/i\.pinimg\.com\\?\/(?:originals|736x|564x|474x)\\?\/[a-f0-9\\?\/]+\.(?:jpg|jpeg|png|webp)/gi)) {
        const clean = m[0].replace(/\\/g, "");
        const key = clean.split("/").slice(-3).join("/");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ url: pinOriginal(clean), alt: [clean], source: "pinterest", title: "" });
        if (out.length >= 30) break;
    }
    return out;
}

async function searchPinterest(q) {
    try {
        const r = await searchPinterestApi(q);
        if (r.length) return r;
    } catch (_) {}
    return searchPinterestHtml(q);
}

/** يحدد الاسم الكامل الصحيح + الأنمي عبر AniList (يفضّل الشخصية من الأنمي المذكور) */
async function resolveCharacter(nameEn, seriesEn = "") {
    try {
        const body = JSON.stringify({
            query: "query($s:String){Page(perPage:10){characters(search:$s,sort:SEARCH_MATCH){name{full} media(perPage:4,sort:POPULARITY_DESC){nodes{title{romaji english}}}}}}",
            variables: { s: nameEn }
        });
        const j = JSON.parse((await fetchBuf("https://graphql.anilist.co", {
            method: "POST", body, timeout: 6000, maxBytes: 1024 * 1024,
            headers: { "Content-Type": "application/json", Accept: "application/json" }
        })).toString("utf8"));
        const list = j?.data?.Page?.characters || [];
        if (!list.length) return null;

        const toks = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length >= 3);
        let pick = list[0];
        if (seriesEn) {
            const want = toks(seriesEn);
            const hit = list.find(c => (c.media?.nodes || []).some(n => {
                const have = toks((n.title?.english || "") + " " + (n.title?.romaji || ""));
                return want.some(w => have.includes(w));
            }));
            if (hit) pick = hit;
        }
        const nodes = pick.media?.nodes || [];
        let t = nodes[0]?.title;
        if (seriesEn) {
            const want = toks(seriesEn);
            const n = nodes.find(n => toks((n.title?.english || "") + " " + (n.title?.romaji || "")).some(w => want.includes(w)));
            if (n) t = n.title;
        }
        return { name: pick.name.full, series: (t && (t.english || t.romaji)) || "" };
    } catch (_) {
        return null;
    }
}

async function searchBing(q) {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&qft=+filterui:imagesize-large&form=IRFLTR&first=1&adlt=strict`;
    const html = (await fetchBuf(url, {
        timeout: 9000,
        maxBytes: 4 * 1024 * 1024,
        headers: { "Accept-Language": "en-US,en;q=0.9", Cookie: "SRCHHPGUSR=ADLT=STRICT" }
    })).toString("utf8");

    const out = [];
    for (const m of html.matchAll(/class="iusc"[^>]*\sm="([^"]+)"/g)) {
        try {
            const j = JSON.parse(decodeHtml(m[1]));
            if (j && j.murl) out.push({ url: j.murl, title: j.t || j.desc || "", source: "bing" });
        } catch (_) {}
    }
    if (!out.length) {
        for (const m of html.matchAll(/murl&quot;:&quot;(.*?)&quot;/g)) {
            out.push({ url: decodeHtml(m[1]), title: "", source: "bing" });
        }
    }
    return out;
}

async function searchAniList(q) {
    const body = JSON.stringify({
        query: "query($s:String){Page(perPage:4){characters(search:$s,sort:SEARCH_MATCH){name{full} image{large}}}}",
        variables: { s: q }
    });
    const j = JSON.parse((await fetchBuf("https://graphql.anilist.co", {
        method: "POST", body, timeout: 8000, maxBytes: 1024 * 1024,
        headers: { "Content-Type": "application/json", Accept: "application/json" }
    })).toString("utf8"));
    return (j?.data?.Page?.characters || [])
        .filter(c => c?.image?.large)
        .map(c => ({ url: c.image.large, title: c.name?.full || "", source: "anilist" }));
}

async function probeImage(buf) {
    if (!sharp) {
        return imageKind(buf) ? { w: 1000, h: 1000, format: imageKind(buf) } : null;
    }
    try {
        const m = await sharp(buf, { failOn: "none" }).metadata();
        if (!m.width || !m.height) return null;
        if ((m.pages || 1) > 1) return null; // GIF/WebP متحرك
        const swap = m.orientation && m.orientation >= 5;
        return { w: swap ? m.height : m.width, h: swap ? m.width : m.height, format: m.format };
    } catch (_) {
        return null;
    }
}

// المقاس المفضّل: شبه مربع (عرض:طول ≈ 1 : 1.1)
const TARGET_AR = 0.91;

async function colorfulness(buf) {
    if (!sharp) return 0.3;
    try {
        const { data } = await sharp(buf, { failOn: "none" })
            .resize(48, 48, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let sum = 0, n = 0;
        for (let i = 0; i + 2 < data.length; i += 3) {
            const mx = Math.max(data[i], data[i + 1], data[i + 2]);
            const mn = Math.min(data[i], data[i + 1], data[i + 2]);
            sum += mx ? (mx - mn) / mx : 0;
            n++;
        }
        return n ? sum / n : 0.3;
    } catch (_) { return 0.3; }
}

/** تقييم 0..100: دقة + قرب المقاس من المطلوب + حيوية الألوان */
function qualityScore(p, color) {
    const res = Math.min(Math.min(p.w, p.h), 1200) / 1200;
    const ar = p.w / p.h;
    const arPen = Math.min(1, Math.abs(ar - TARGET_AR) / 0.6);
    return res * 40 + (1 - arPen) * 40 + (Math.min(color, 0.6) / 0.6) * 20;
}

async function downloadCandidate(c) {
    if (!c || !c.url || !/^https?:\/\//i.test(c.url)) return null;
    if (BAD_HOST.test(c.url) || BAD_TITLE.test(c.title || "")) return null;
    const urls = [c.url, ...(c.alt || [])];
    for (const u of urls) {
        let referer = "";
        try { referer = new URL(u).origin + "/"; } catch (_) {}
        try {
            const buf = await fetchBuf(u, { timeout: 9000, maxBytes: 12 * 1024 * 1024, headers: referer ? { Referer: referer } : {} });
            if (!imageKind(buf)) continue;
            const p = await probeImage(buf);
            if (!p) continue;
            return { buf, probe: p, source: c.source, title: c.title || "" };
        } catch (_) {}
    }
    return null;
}

// ============================================================
// فحص الصورة بالذكاء الاصطناعي (رؤية) — يتأكد أنها الشخصية المطلوبة فعلاً
// يحتاج مفتاحاً واحداً في متغيرات البيئة: ANTHROPIC_API_KEY أو GEMINI_API_KEY (مجاني)
// ============================================================

const ANTHROPIC_VISION_MODEL = process.env.AI_VISION_MODEL || "claude-haiku-4-5-20251001";
// ملاحظة: gemini-2.0-flash أُوقف نهائياً (يونيو 2026). نستعمل الاسم المستعار الذي يشير دائماً لأحدث Flash،
// وإن لم يوجد يجرّب البوت البدائل تلقائياً ويتذكر أول واحد يعمل.
const GEMINI_MODELS = [...new Set([process.env.GEMINI_VISION_MODEL, "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"].filter(Boolean))];
let geminiModelIdx = 0;

function visionAvailable() {
    return Boolean(sharp && (process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY));
}

let warnedNoVision = false;

setTimeout(() => {
    if (visionAvailable()) {
        console.log(`[Ai] ✅ فحص الصور مفعّل (${process.env.ANTHROPIC_API_KEY ? "Claude " + ANTHROPIC_VISION_MODEL : "Gemini"})`);
    } else {
        console.error("[Ai] ❌ فحص الصور غير مفعّل: ضع geminiApiKey في settings.js (أو ANTHROPIC_API_KEY). بدونه لن يعمل .احضر.");
    }
}, 1500);

async function askModelOnce(jpgBuf, prompt) {
    const b64 = jpgBuf ? jpgBuf.toString("base64") : null;
    if (process.env.ANTHROPIC_API_KEY) {
        const content = [];
        if (b64) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
        content.push({ type: "text", text: prompt });
        const body = JSON.stringify({ model: ANTHROPIC_VISION_MODEL, max_tokens: 300, messages: [{ role: "user", content }] });
        const j = JSON.parse((await fetchBuf("https://api.anthropic.com/v1/messages", {
            method: "POST", body, timeout: 25000, maxBytes: 1024 * 1024,
            headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }
        })).toString("utf8"));
        return (j?.content || []).map(c => c.text || "").join("");
    }
    const parts = [{ text: prompt }];
    if (b64) parts.push({ inline_data: { mime_type: "image/jpeg", data: b64 } });
    const body = JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, responseMimeType: "application/json" } });

    for (;;) {
        const model = GEMINI_MODELS[geminiModelIdx];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        try {
            const j = JSON.parse((await fetchBuf(url, {
                method: "POST", body, timeout: 25000, maxBytes: 1024 * 1024,
                headers: { "content-type": "application/json" }
            })).toString("utf8"));
            return (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
        } catch (e) {
            // النموذج غير موجود/متوقف → ننتقل للتالي
            if (/HTTP (404|400)/.test(String(e?.message)) && geminiModelIdx < GEMINI_MODELS.length - 1) {
                console.warn(`⚠️ Ai: النموذج ${model} لا يعمل (${e.message})، سنجرب ${GEMINI_MODELS[geminiModelIdx + 1]}`);
                geminiModelIdx++;
                continue;
            }
            throw e;
        }
    }
}

async function askModel(jpgBuf, prompt) {
    try { return await askModelOnce(jpgBuf, prompt); }
    catch (_) { await sleep(1500); return await askModelOnce(jpgBuf, prompt); }   // محاولة ثانية (ضغط/حد معدل)
}

// ------------------------------------------------------------
// الخطوة 2: «من في الصورة؟» — تحليل مفتوح بدون إخبار النموذج بالاسم المطلوب (لتجنب التحيّز)
// ------------------------------------------------------------
async function identifyImage(buf) {
    try {
        const jpg = await sharp(buf, { failOn: "none" })
            .resize({ width: 768, height: 768, fit: "inside" })
            .flatten({ background: "#ffffff" })
            .jpeg({ quality: 82 }).toBuffer();

        const prompt =
            `Look at this image from an anime-character picture search. Identify who/what is shown.\n` +
            `Reply with ONLY one JSON object, no other text:\n` +
            `{"character":"the main character's full name in English, or \\"unknown\\"",` +
            `"series":"the anime/manga title, or \\"unknown\\"",` +
            `"count":number of distinct characters clearly visible,` +
            `"is_anime":true if it is anime/manga art (not a real person, cosplay, figure or toy),` +
            `"has_text":true if the picture has OVERLAID text or graphics added on top of the art: captions, name labels, titles, logos, watermarks, big numbers (ignore small lettering that is naturally part of the drawn scene, such as writing on clothing),` +
            `"collage":true if it is a collage, grid, split panels or several pictures in one,` +
            `"framing":"head" | "bust" | "waist" | "full" | "other"  (head = face/head only; bust = head and shoulders/chest; waist = down to the waist; full = whole body),` +
            `"head_cropped":true if the head or face is cut off by the frame,` +
            `"quality":0-10 for sharpness, clean lines and pleasing vivid colours}`;

        const txt = await askModel(jpg, prompt);
        const m = String(txt).match(/\{[\s\S]*\}/);
        if (!m) return null;
        const j = JSON.parse(m[0]);
        return {
            character: String(j.character || "unknown"),
            series: String(j.series || "unknown"),
            count: Number(j.count) || 1,
            is_anime: j.is_anime !== false,
            has_text: j.has_text === true,
            collage: j.collage === true,
            framing: String(j.framing || "other").toLowerCase(),
            head_cropped: j.head_cropped === true,
            quality: Number(j.quality) || 0
        };
    } catch (e) {
        console.error("⚠️ Ai vision:", e?.message || e);
        return null;
    }
}

// ------------------------------------------------------------
// الخطوة 3: هل الشخصية التي اكتُشفت هي نفسها المطلوبة؟ (الإخوة/الأقارب = شخصية مختلفة)
// ------------------------------------------------------------
function nameTokens(x) {
    return String(x || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length >= 3);
}

async function sameCharacter(target, ident) {
    const idToks = nameTokens(ident.character);
    if (!idToks.length || /unknown/i.test(ident.character)) return false;

    const want = nameTokens(target.fullName);
    if (!want.length) return false;

    const common = want.filter(w => idToks.includes(w));
    if (common.length === 0) return false;
    if (common.length === want.length) return true;            // كل الأجزاء موجودة

    // تطابق جزئي (مثل الإخوة بنفس اللقب) → نسأل النموذج صراحةً
    try {
        const prompt =
            `Request: "${target.fullName}"${target.series ? ` from "${target.series}"` : ""}.\n` +
            `Image shows: "${ident.character}" from "${ident.series}".\n` +
            `Are these the SAME character? Siblings, relatives, namesakes or other characters sharing a surname are DIFFERENT.\n` +
            `Reply ONLY with JSON: {"same":true|false}`;
        const txt = await askModel(null, prompt);
        const m = String(txt).match(/\{[\s\S]*\}/);
        return m ? JSON.parse(m[0]).same === true : false;
    } catch (_) {
        return false;
    }
}

// ============================================================
// تفكيك الطلب: "كاكاشي من ناروتو" → الاسم (للكتابة على الصورة) + الشرح (للبحث فقط)
// ============================================================

function parseTarget(arg) {
    const s = String(arg || "").trim().replace(/\s+/g, " ");
    const m = s.match(/^(.+?)(?:\s+(?:من|from)\s+|\s*[:：،|]\s*)(.+)$/i);
    if (m) return { name: m[1].trim(), hint: m[2].trim() };
    return { name: s, hint: "" };
}

function interleave(lists, limit) {
    const out = [];
    const seen = new Set();
    for (let i = 0; out.length < limit; i++) {
        let any = false;
        for (const l of lists) {
            if (i < l.length) {
                any = true;
                const c = l[i];
                if (c && c.url && !seen.has(c.url)) { seen.add(c.url); out.push(c); }
            }
        }
        if (!any) break;
    }
    return out;
}

const COLLAGE_TITLE = /(collage|all characters|characters|squad|group|duo|trio|team|vs\b|ships?|comparison|tier list|\bx\b)/i;

/** مطابقة عنوان البن لاسم الشخصية (تعمل حتى بدون مفتاح رؤية) */
function titleBoost(title, target) {
    const t = String(title || "").toLowerCase();
    if (!t) return 0;
    const want = nameTokens(target.fullName);
    let b = 0;
    if (want.length) {
        const hit = want.filter(w => t.includes(w)).length;
        b += (hit / want.length) * 30;
    }
    if (COLLAGE_TITLE.test(t)) b -= 25;
    return b;
}

/** تنزيل + قياس + تقييم (6 بالتوازي) */
async function loadCandidates(list, deadline, target) {
    const loaded = [];
    for (let i = 0; i < list.length; i += 6) {
        if (Date.now() > deadline) break;
        const batch = await Promise.all(list.slice(i, i + 6).map(downloadCandidate));
        for (const r of batch) {
            if (!r) continue;
            const ar = r.probe.w / r.probe.h;
            const minSide = Math.min(r.probe.w, r.probe.h);
            if (minSide < 400 || ar < 0.6 || ar > 1.35) continue;
            r.color = await colorfulness(r.buf);
            r.score = qualityScore(r.probe, r.color) + titleBoost(r.title, target);
            loaded.push(r);
        }
    }
    return loaded.sort((a, b) => b.score - a.score);
}

// ============================================================
// الدالة الرئيسية — ثلاث خطوات تتكرر حتى النجاح أو انتهاء الوقت:
//   1) بحث عميق في Pinterest وجمع صور
//   2) تحليل كل صورة: من فيها؟ (بدون إخباره بالمطلوب)
//   3) مقارنة المكتشف بالمطلوب — إن لم يتطابق نعيد البحث بصيغة جديدة
// ============================================================
async function fetchCharacterImage(nameRaw, hintRaw = "") {
    const fail = (code) => { const e = new Error(code); e.code = code; return e; };

    // بدون نموذج رؤية لا يمكن التأكد من الشخصية → لا نرسل صورة عشوائية
    if (!visionAvailable()) {
        console.error("[Ai] ❌ لا يوجد مفتاح لفحص الصور (GEMINI_API_KEY / ANTHROPIC_API_KEY)");
        throw fail("NO_VISION");
    }

    // --- الاسم والأنمي بالإنجليزية (للمقارنة فقط) ---
    const key = normArabic(nameRaw);
    const english = NAME_ALIASES[key] || (await toEnglish(nameRaw)).replace(/\s+/g, " ").trim() || nameRaw;

    let seriesEn = "";
    if (hintRaw) {
        const hk = normArabic(hintRaw);
        seriesEn = SERIES_ALIASES[hk] || SERIES_ALIASES[hintRaw.trim()] || (await toEnglish(hintRaw)).replace(/\s+/g, " ").trim();
    }
    const info = await resolveCharacter(english, seriesEn);
    const target = { fullName: info?.name || english, series: seriesEn || info?.series || "", hint: hintRaw || "" };

    // ===== الخطوة 1: بحث واحد، وأول 10 صور فقط =====
    const query = `شخصية انمي ${nameRaw}${hintRaw ? " " + hintRaw : ""}`.replace(/\s+/g, " ").trim();
    let pins = [];
    try { pins = await searchPinterest(query); } catch (_) {}
    pins = pins.slice(0, 10);
    console.log(`[Ai] بحث: "${query}" | المطلوب: ${target.fullName}${target.series ? " (" + target.series + ")" : ""} | نفحص ${pins.length} صور`);
    if (!pins.length) throw fail("NOT_FOUND");

    const downloaded = await Promise.all(pins.map(async (p, i) => {
        const r = await downloadCandidate(p);
        if (!r) { console.log(`[Ai] #${i + 1} تعذّر التنزيل`); return null; }
        r.rank = i + 1;
        return r;
    }));

    const cands = [];
    for (const r of downloaded) {
        if (!r) continue;
        const ar = r.probe.w / r.probe.h;
        if (Math.min(r.probe.w, r.probe.h) < 300 || ar < 0.5 || ar > 1.6) { console.log(`[Ai] #${r.rank} مقاس غير مناسب ${r.probe.w}x${r.probe.h}`); continue; }
        r.color = await colorfulness(r.buf);
        r.score = qualityScore(r.probe, r.color);
        cands.push(r);
    }
    if (!cands.length) throw fail("NOT_FOUND");

    // ===== الخطوتان 2 و3: من في الصورة؟ ثم هل هي المطلوبة؟ =====
    let best = null, failed = 0, analysed = 0;

    for (let i = 0; i < cands.length; i += 5) {
        const group = cands.slice(i, i + 5);
        const idents = await Promise.all(group.map(r => identifyImage(r.buf)));

        for (let k = 0; k < group.length; k++) {
            const r = group[k], id = idents[k];
            if (!id) { failed++; console.log(`[Ai] #${r.rank} فشل التحليل`); continue; }
            analysed++;

            const tag = `[Ai] #${r.rank} → ${id.character} / ${id.series} | شخصيات:${id.count} نص:${id.has_text} كولاج:${id.collage} لقطة:${id.framing} جودة:${id.quality}`;

            if (!id.is_anime) { console.log(tag + " ✗ ليست أنمي"); continue; }
            if (id.has_text) { console.log(tag + " ✗ فيها نص"); continue; }
            if (id.collage || id.count !== 1) { console.log(tag + " ✗ ليست شخصية واحدة"); continue; }
            if (id.head_cropped) { console.log(tag + " ✗ الرأس مقطوع"); continue; }
            if (!["head", "bust", "waist", "full"].includes(id.framing)) { console.log(tag + " ✗ لقطة غير مناسبة"); continue; }

            if (!(await sameCharacter(target, id))) { console.log(tag + " ✗ ليست الشخصية المطلوبة"); continue; }

            const frameBonus = id.framing === "bust" ? 8 : id.framing === "waist" ? 5 : id.framing === "head" ? 4 : -30; // الجسم الكامل آخر خيار
            const total = id.quality * 10 + r.score * 0.4 + frameBonus;
            console.log(tag + ` ✓ مقبولة (${total.toFixed(0)})`);
            if (!best || total > best.total) best = { buf: r.buf, total };
        }
    }

    if (best) return best.buf;

    if (analysed === 0 && failed > 0) {
        console.error("[Ai] ❌ فشلت كل طلبات التحليل (تحقق من المفتاح/الحصة/اسم النموذج)");
        throw fail("VISION_DOWN");
    }
    throw fail("NOT_FOUND");
}

// ============================================================
// تحليل الأمر
// ============================================================

function parseAiCommand(text) {
    const m = String(text || "").trim().match(/^\.\s*(\S+)(?:\s+([\s\S]*))?$/);
    if (!m) return null;
    const cmd = normArabic(m[1]);
    if (cmd !== "احضر") return null;
    return { cmd, arg: String(m[2] || "").trim() };
}

/** فحص سريع (متزامن) هل النص أمر ذكاء اصطناعي؟ */
function isAiCommand(text) {
    return Boolean(parseAiCommand(text));
}

// ============================================================
// تشغيل الطلبات (حدود التزامن)
// ============================================================

const activeJobs = new Map();   // sender → startTime
const lastUse = new Map();      // sender → time
const seenMsgs = new Map();     // msgId → time
let runningJobs = 0;

function seenBefore(id) {
    if (!id) return false;
    const now = Date.now();
    if (seenMsgs.size > 500) {
        for (const [k, t] of seenMsgs) if (now - t > 10 * 60 * 1000) seenMsgs.delete(k);
    }
    if (seenMsgs.has(id)) return true;
    seenMsgs.set(id, now);
    return false;
}

function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("TIMEOUT")), ms); })
    ]).finally(() => clearTimeout(timer));
}

function getGuildRaw(db) {
    return String((db && db.aiGuildName) || "").trim();
}

async function runFetch(arg, db) {
    const { name, hint } = parseTarget(arg);
    if (isBlockedPrompt(arg)) {
        const err = new Error("BLOCKED");
        err.code = "BLOCKED";
        throw err;
    }
    const raw = await fetchCharacterImage(name, hint);
    const guildRaw = getGuildRaw(db);

    if (sharp) {
        try {
            const buffer = await buildCaptionedImage(raw, name, guildRaw);
            return { buffer, caption: "" };
        } catch (e) {
            console.error("⚠️ Ai: فشل رسم الاسم على الصورة، سيُرسل كتعليق:", e?.message || e);
            // نحاول على الأقل تحسين الصورة
            try {
                const enh = await enhanceImage(raw, OUT_WIDTH);
                const buffer = await sharp(enh.buffer).jpeg({ quality: 93 }).toBuffer();
                return { buffer, caption: buildPlainCaption(name, guildRaw) };
            } catch (_) {}
        }
    }
    return { buffer: raw, caption: buildPlainCaption(name, guildRaw) };
}

function buildPlainCaption(name, guildRaw) {
    const nm = tokensToPlain(toTokens(name)) || String(name).trim();
    const g = guildRaw ? tokensToPlain(toTokens(guildRaw)) : "";
    return g ? `${nm}\nنورت/ي نقابة ${g}` : nm;
}

// ============================================================
// المعالج الرئيسي: .احضر
// (يُستدعى بدون await من index.js حتى لا يعطّل بقية البوت)
// ============================================================

async function handleAiCommand(sock, jid, msg, text, db, saveDb, cleanSender, owner) {
    const parsed = parseAiCommand(text);
    if (!parsed) return false;

    if (!isGroupJid(jid)) return true;
    if (!canUse(db, cleanSender, owner)) return true; // لا رد لغير أصحاب الصلاحية

    if (!isReceiveGroup(db, jid)) {
        await safeSend(sock, jid, {
            text: "❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆\n  *الذكاء الاصطناعي يعمل فقط داخل*\n  *قروب الاستقبال*\n❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆"
        }, { quoted: msg });
        return true;
    }

    if (seenBefore(msg?.key?.id)) return true;

    const key = msg?.key;

    if (!parsed.arg) {
        const usage = "⚠️ اكتب اسم الشخصية بعد الأمر.\nمثال: .احضر ناروتو\nأو مع شرح للبحث: .احضر كاكاشي من ناروتو";
        await safeSend(sock, jid, { text: usage }, { quoted: msg });
        return true;
    }

    const who = String(cleanSender || "");
    const now = Date.now();

    if (activeJobs.has(who)) {
        await safeSend(sock, jid, { text: "⏳ لديك طلب قيد التنفيذ، انتظر حتى ينتهي." }, { quoted: msg });
        return true;
    }
    if (now - (lastUse.get(who) || 0) < USER_COOLDOWN_MS) {
        await react(sock, jid, key, "⏳");
        await sleep(Math.max(0, USER_COOLDOWN_MS - (now - (lastUse.get(who) || 0))));
    }
    if (runningJobs >= MAX_PARALLEL) {
        await safeSend(sock, jid, { text: "⏳ البوت مشغول بطلبات أخرى، أعد المحاولة بعد لحظات." }, { quoted: msg });
        return true;
    }

    activeJobs.set(who, now);
    lastUse.set(who, Date.now());
    runningJobs++;

    await react(sock, jid, key, "⏳");

    // إن تأخر البحث نخبر العضو مرة واحدة ثم نكمل
    const slowTimer = setTimeout(() => {
        safeSend(sock, jid, { text: "⏳ إيجاد صورة صعب لهذه الشخصية، رجاءً انتظر قليلاً…" }, { quoted: msg }).catch(() => {});
    }, SLOW_NOTICE_MS);

    try {
        const result = await withTimeout(
            runFetch(parsed.arg, db),
            JOB_TIMEOUT_MS
        );

        await react(sock, jid, key, "✅");

        const content = { image: result.buffer };
        if (result.caption) content.caption = result.caption;
        const sent = await safeSend(sock, jid, content, { quoted: msg });
        if (!sent) throw new Error("send failed");
    } catch (e) {
        console.error("❌ Ai job error:", e?.message || e);
        await react(sock, jid, key, "❌");

        let reply;
        if (e && e.code === "BLOCKED") {
            reply = "⛔ لا يمكنني تنفيذ هذا الطلب.";
        } else if (e && (e.code === "NO_VISION" || e.code === "VISION_DOWN")) {
            reply = "⚠️ خدمة تحليل الصور غير متاحة حالياً، أبلغ المشرف.";
        } else if (e && e.code === "NOT_FOUND") {
            reply = `⚠️ لم يتم الحصول على هذه الشخصية: «${parsed.arg}».\nجرّب كتابة الاسم بوضوح مع اسم الأنمي، مثال: .احضر ساي ايتوشي من بلو لوك`;
        } else if (e && e.message === "TIMEOUT") {
            reply = "⌛ استغرق الطلب وقتاً طويلاً، أعد المحاولة.";
        } else {
            reply = "⚠️ تعذّر إنجاز الطلب الآن، حاول مرة أخرى بعد قليل.";
        }
        await safeSend(sock, jid, { text: reply }, { quoted: msg });
    } finally {
        clearTimeout(slowTimer);
        activeJobs.delete(who);
        runningJobs = Math.max(0, runningJobs - 1);
    }

    return true;
}

// ============================================================
// .تعديل (الإمبراطور): البوت يطلب اسم النقابة ثم يحفظه
// ============================================================

const pendingEdit = new Map(); // "jid|sender" → expiresAt

function pendingKey(jid, sender) {
    return String(jid) + "|" + String(sender);
}

async function handleEditCommand(sock, jid, msg, text, db, saveDb, cleanSender, owner) {
    if (String(text || "").trim() !== ".تعديل") return false; // ".تعديل متجر" وغيره يمرّ كما هو
    if (!owner) return false;

    pendingEdit.set(pendingKey(jid, cleanSender), Date.now() + EDIT_WAIT_MS);

    await safeSend(sock, jid, {
        text: "◆━─━─━─⊱🛡️⊰─━─━─━◆\nارجوك ارسل اسم النقابة الآن\n◆━─━─━─⊱✍️⊰─━─━─━◆"
    }, { quoted: msg });
    return true;
}

/**
 * يلتقط رسالة الإمبراطور التالية (اسم النقابة) بعد .تعديل
 * يرجع true إذا استهلك الرسالة
 */
async function handleMessageHook(sock, jid, msg, text, db, saveDb, cleanSender, owner) {
    if (!pendingEdit.size) return false;

    const k = pendingKey(jid, cleanSender);
    const exp = pendingEdit.get(k);
    if (!exp) return false;

    if (Date.now() > exp) {
        pendingEdit.delete(k);
        return false;
    }
    if (!owner) return false;

    // أي أمر جديد يلغي الانتظار
    if (String(text || "").startsWith(".")) {
        pendingEdit.delete(k);
        return false;
    }

    const raw = String(text || "").trim().slice(0, 200);
    pendingEdit.delete(k);
    if (!raw) return false;

    const tokens = toTokens(raw);
    if (!tokens.length) {
        await safeSend(sock, jid, {
            text: "⚠️ لم أجد في الاسم أي نص أو إيموجي صالح. أرسل `.تعديل` وجرّب مرة أخرى."
        }, { quoted: msg });
        return true;
    }

    db.aiGuildName = raw;
    try { saveDb(); } catch (_) {}

    await safeSend(sock, jid, {
        text: `◆━─━─━─⊱✅⊰─━─━─━◆\nتم حفظ اسم النقابة\nسيظهر في الصور هكذا:\nنورت/ي نقابة ${tokensToPlain(tokens)}\n◆━─━─━─⊱🟢⊰─━─━─━◆`
    }, { quoted: msg });
    return true;
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    isAiCommand,
    handleAiCommand,
    handleEditCommand,
    handleMessageHook,
    // للاختبار
    parseTarget,
    toTokens,
    canUse
};
