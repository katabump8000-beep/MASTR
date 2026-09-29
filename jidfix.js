// ============================================================
// jidfix.js   (ملف جديد)
// ALJESAT BOT
// الحل الجذري لمشكلة المنشن / الرقم الخاطئ (+1 31469804621891)
//
// السبب: واتساب صار يعطي كثير من الأعضاء معرّف من نوع @lid (أرقام طويلة
// ليست أرقام هواتف)، بينما البوت كان يبني المنشن دائماً بالشكل:
//        رقم@s.whatsapp.net   ← وهذا خطأ مع أصحاب الـ LID.
//
// الحل (مركزي، لا يحتاج تعديل كل ملف):
//   1) نتعلم الـ JID الحقيقي لكل عضو (من رسائله + المنشن + قوائم القروبات)
//   2) نربط الأرقام المتكافئة (LID ↔ رقم الهاتف) ببعضها
//   3) نعترض sock.sendMessage: كل mentions + كل @رقم في النص
//      يتم تصحيحها تلقائياً حسب الشكل الصحيح لذلك القروب
//   4) نعترض groupParticipantsUpdate بنفس الطريقة (طرد/ترقية...)
//   5) نفلتر رسائل المحظورين عن مستمعي الفعاليات (ev.on)
// ============================================================

"use strict";

const META_TTL_MS = 2 * 60 * 1000;
const MAX_MAP_SIZE = 20000;
const metaCache = new Map(); // groupJid -> { t, p }

// ============================================================
// أدوات أساسية
// ============================================================

function digits(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/\D/g, "");
}

/** رقم/معرّف المستخدم (أرقام فقط) من JID مع تجاهل لاحقة الجهاز :12 */
function jnum(value) {
    if (!value) return "";
    const s = String(value);
    const at = s.indexOf("@");
    const user = (at === -1 ? s : s.slice(0, at)).split(":")[0];
    return digits(user);
}

/** يزيل لاحقة الجهاز من JID */
function normalizeJid(jid) {
    if (!jid || typeof jid !== "string") return "";
    const at = jid.indexOf("@");
    if (at === -1) return "";
    const user = jid.slice(0, at).split(":")[0];
    const server = jid.slice(at + 1);
    if (!user || !server) return "";
    return `${user}@${server}`;
}

function jidOf(p) {
    if (!p) return "";
    if (typeof p === "string") return normalizeJid(p);
    return normalizeJid(p.id || p.jid || p.lid || p.phoneNumber || "");
}

/** كل الأرقام الممكنة لعضو (id + lid + phoneNumber) */
function participantNumbers(p) {
    const out = new Set();
    if (!p) return out;
    if (typeof p === "string") {
        const d = jnum(p);
        if (d) out.add(d);
        return out;
    }
    for (const f of [p.id, p.lid, p.phoneNumber, p.jid]) {
        const d = jnum(f);
        if (d) out.add(d);
    }
    return out;
}

function getDb() {
    return global.db || null;
}

function isGroupJid(jid) {
    return typeof jid === "string" && jid.endsWith("@g.us");
}

// ============================================================
// السجلات: jidMap (رقم → JID) و numAliases (رقم ↔ أرقام مكافئة)
// ============================================================

function jidMap() {
    const db = getDb();
    if (!db) return null;
    if (!db.jidMap || typeof db.jidMap !== "object" || Array.isArray(db.jidMap)) db.jidMap = {};
    return db.jidMap;
}

function aliasMap() {
    const db = getDb();
    if (!db) return null;
    if (!db.numAliases || typeof db.numAliases !== "object" || Array.isArray(db.numAliases)) db.numAliases = {};
    return db.numAliases;
}

function rememberJid(number, jid, force = false) {
    try {
        const map = jidMap();
        const n = jnum(number);
        const j = normalizeJid(jid);
        if (!map || !n || !j) return;
        if (j.endsWith("@g.us") || j.endsWith("@broadcast") || j.startsWith("status@")) return;
        if (map[n] === j) return;
        if (!map[n] && Object.keys(map).length > MAX_MAP_SIZE) return;
        if (!map[n] || force) map[n] = j;
    } catch (_) {}
}

function link(a, b) {
    try {
        const al = aliasMap();
        const x = jnum(a);
        const y = jnum(b);
        if (!al || !x || !y || x === y) return;
        const add = (k, v) => {
            if (!Array.isArray(al[k])) al[k] = [];
            if (!al[k].includes(v)) al[k].push(v);
        };
        add(x, y);
        add(y, x);
    } catch (_) {}
}

/** كل الأرقام المكافئة لنفس الشخص (بما فيها الرقم نفسه) */
function aliasesOf(number) {
    const n = jnum(number);
    if (!n) return [];
    const out = new Set([n]);
    const al = aliasMap();
    if (!al) return [n];
    const queue = [n];
    while (queue.length) {
        const x = queue.pop();
        for (const y of al[x] || []) {
            if (!out.has(y)) {
                out.add(y);
                queue.push(y);
            }
        }
    }
    return [...out];
}

function sameUser(a, b) {
    const x = jnum(a);
    const y = jnum(b);
    if (!x || !y) return false;
    if (x === y) return true;
    return aliasesOf(x).includes(y);
}

/** بحث في كائن (مثل db.users) بأي رقم مكافئ */
function pickByAlias(obj, number) {
    if (!obj || typeof obj !== "object") return null;
    for (const a of aliasesOf(number)) {
        if (obj[a] !== undefined) return { key: a, value: obj[a] };
    }
    return null;
}

/** الرقم المعتمد للعضو: المفتاح الموجود فعلاً في db.users (لقب أولاً) */
function canonical(db, number) {
    const n = jnum(number);
    if (!n || !db || !db.users) return n;
    const all = aliasesOf(n);
    let withNick = null;
    let anyUser = null;
    for (const a of all) {
        const u = db.users[a];
        if (!u) continue;
        if (!anyUser) anyUser = a;
        if (!withNick && String(u.nickname || "").trim()) withNick = a;
    }
    return withNick || anyUser || n;
}

function registerParticipants(list) {
    try {
        if (!Array.isArray(list)) return;
        for (const p of list) {
            if (!p) continue;
            const primary = jidOf(p);
            const nums = [...participantNumbers(p)];
            for (const n of nums) rememberJid(n, primary, true);
            for (let i = 1; i < nums.length; i++) link(nums[0], nums[i]);
        }
    } catch (_) {}
}

/** تعلّم JIDs من رسالة واردة */
function learnFromMessage(msg) {
    try {
        if (!msg || !msg.key) return;
        const k = msg.key;
        const remote = k.remoteJid || "";

        const part = k.participant || (!isGroupJid(remote) ? remote : "");
        const alt = k.participantAlt || k.participantPn || k.senderPn || k.remoteJidAlt || "";

        if (part && !k.fromMe) {
            rememberJid(part, part);
            if (alt) {
                rememberJid(alt, part);
                link(part, alt);
            }
        }

        const m = msg.message || {};
        const inner = m.extendedTextMessage || m.imageMessage || m.videoMessage ||
            m.documentMessage || m.buttonsResponseMessage || m.listResponseMessage || {};
        const ctx = inner.contextInfo || m.contextInfo || null;
        if (ctx) {
            if (Array.isArray(ctx.mentionedJid)) {
                for (const mj of ctx.mentionedJid) rememberJid(mj, mj);
            }
            if (ctx.participant) rememberJid(ctx.participant, ctx.participant);
        }
    } catch (_) {}
}

// ============================================================
// بيانات القروبات
// ============================================================

async function getGroupParticipants(sock, groupJid) {
    if (!sock || !isGroupJid(groupJid)) return null;
    const c = metaCache.get(groupJid);
    if (c && Date.now() - c.t < META_TTL_MS) return c.p;
    try {
        const md = await sock.groupMetadata(groupJid);
        const p = Array.isArray(md?.participants) ? md.participants : [];
        metaCache.set(groupJid, { t: Date.now(), p });
        registerParticipants(p);
        return p;
    } catch (_) {
        return c ? c.p : null;
    }
}

function invalidateGroup(groupJid) {
    if (groupJid) metaCache.delete(groupJid);
}

function findInParticipants(participants, number) {
    if (!Array.isArray(participants)) return null;
    const wanted = new Set(aliasesOf(number));
    if (!wanted.size) return null;
    for (const p of participants) {
        for (const n of participantNumbers(p)) {
            if (wanted.has(n)) return p;
        }
    }
    return null;
}

/** هل هذا JID هو البوت نفسه؟ */
function isMe(sock, jid) {
    const n = jnum(jid);
    if (!n || !sock?.user) return false;
    const mine = [jnum(sock.user.id), jnum(sock.user.lid)].filter(Boolean);
    if (mine.includes(n)) return true;
    return mine.some(m => sameUser(m, n));
}

/**
 * رقم/JID → JID الصحيح للمنشن داخل chatJid
 */
async function resolveJid(sock, chatJid, numberOrJid) {
    const n = jnum(numberOrJid);
    if (!n) return typeof numberOrJid === "string" ? numberOrJid : "";

    if (isGroupJid(chatJid)) {
        const parts = await getGroupParticipants(sock, chatJid);
        if (parts) {
            const p = findInParticipants(parts, n);
            if (p) return jidOf(p);
        }
    }

    const map = jidMap();
    if (map) {
        for (const a of aliasesOf(n)) {
            if (map[a]) return map[a];
        }
    }

    if (typeof numberOrJid === "string" && numberOrJid.includes("@")) {
        return normalizeJid(numberOrJid) || numberOrJid;
    }
    return `${n}@s.whatsapp.net`;
}

// ============================================================
// إصلاح المنشن داخل محتوى الرسالة
// ============================================================

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fixMentions(sock, chatJid, content) {
    if (!content || typeof content !== "object") return content;

    const textKey = typeof content.text === "string"
        ? "text"
        : typeof content.caption === "string" ? "caption" : null;

    const hasMentions = Array.isArray(content.mentions) && content.mentions.length > 0;
    const text = textKey ? content[textKey] : "";
    const textNums = textKey ? [...text.matchAll(/@(\d{6,})/g)].map(m => m[1]) : [];

    if (!hasMentions && textNums.length === 0) return content;

    const resolved = new Map(); // الرقم القديم → JID الصحيح
    const finalMentions = [];

    if (hasMentions) {
        for (const m of content.mentions) {
            const n = jnum(m);
            if (!n) continue;
            let j = resolved.get(n);
            if (!j) {
                j = await resolveJid(sock, chatJid, m);
                resolved.set(n, j);
            }
            if (j && !finalMentions.includes(j)) finalMentions.push(j);
        }
    }

    // أرقام مكتوبة في النص بدون mentions (نضيفها فقط إذا كان صاحبها عضواً في القروب)
    if (textNums.length && isGroupJid(chatJid)) {
        const parts = await getGroupParticipants(sock, chatJid);
        if (parts) {
            for (const n of textNums) {
                if (resolved.has(n)) continue;
                const p = findInParticipants(parts, n);
                if (p) {
                    const j = jidOf(p);
                    resolved.set(n, j);
                    if (j && !finalMentions.includes(j)) finalMentions.push(j);
                }
            }
        }
    }

    let newText = text;
    if (textKey) {
        for (const [oldNum, j] of resolved) {
            const newNum = jnum(j);
            if (newNum && newNum !== oldNum) {
                newText = newText.replace(new RegExp(`@${escapeRegex(oldNum)}(?!\\d)`, "g"), `@${newNum}`);
            }
        }
    }

    const out = { ...content, mentions: finalMentions };
    if (textKey) out[textKey] = newText;
    return out;
}

// ============================================================
// فلتر المحظورين
// ============================================================

function filterBannedEvent(data) {
    try {
        if (!data || !Array.isArray(data.messages)) return data;
        let ban;
        try { ban = require("./ban"); } catch (_) { return data; }
        const db = getDb();
        if (!db || !ban || typeof ban.isBanned !== "function") return data;

        const kept = data.messages.filter(m => {
            try {
                if (!m?.key || m.key.fromMe) return true;
                const sender = m.key.participant || m.key.remoteJid;
                return !ban.isBanned(db, jnum(sender));
            } catch (_) {
                return true;
            }
        });
        if (kept.length === data.messages.length) return data;
        if (kept.length === 0) return null;
        return { ...data, messages: kept };
    } catch (_) {
        return data;
    }
}

// ============================================================
// التركيب على الـ socket
// ============================================================

function install(sock) {
    if (!sock || sock.__jidfixInstalled) return sock;
    sock.__jidfixInstalled = true;

    // 1) sendMessage
    const origSend = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
        let fixed = content;
        try {
            fixed = await fixMentions(sock, jid, content);
        } catch (_) {
            fixed = content;
        }
        const res = await origSend(jid, fixed, options);
        // 🆕 تسجيل نتائج الفعاليات التي يرسلها البوت نفسه في قروب ADS
        try {
            const db = getDb();
            if (db && db.adsGroups && db.adsGroups[jid] && fixed && typeof fixed.text === "string") {
                require("./results").processAdsText(db, global.saveDb, jid, fixed.text, res?.key?.id);
            }
        } catch (_) {}
        return res;
    };

    // 2) groupParticipantsUpdate
    if (typeof sock.groupParticipantsUpdate === "function") {
        const origUpdate = sock.groupParticipantsUpdate.bind(sock);
        sock.groupParticipantsUpdate = async (gjid, jids, action) => {
            let list = jids;
            try {
                if (action !== "add" && Array.isArray(jids)) {
                    const parts = await getGroupParticipants(sock, gjid);
                    if (parts) {
                        list = jids.map(j => {
                            const p = findInParticipants(parts, j);
                            return p ? jidOf(p) : j;
                        });
                    }
                }
            } catch (_) {
                list = jids;
            }
            const res = await origUpdate(gjid, list, action);
            invalidateGroup(gjid);
            return res;
        };
    }

    // 3) فلتر المحظورين لمستمعي messages.upsert (الفعاليات)
    try {
        const ev = sock.ev;
        const origOn = ev.on.bind(ev);
        const origOff = typeof ev.off === "function" ? ev.off.bind(ev) : null;
        const wrapped = new WeakMap();

        ev.on = (event, listener) => {
            if (event === "messages.upsert" && typeof listener === "function" && !listener.__raw) {
                const w = async (data) => {
                    const f = filterBannedEvent(data);
                    if (f) return listener(f);
                    return undefined;
                };
                wrapped.set(listener, w);
                return origOn(event, w);
            }
            return origOn(event, listener);
        };

        if (origOff) {
            ev.off = (event, listener) => origOff(event, wrapped.get(listener) || listener);
        }
    } catch (_) {}

    // 4) تحديث الكاش عند تغيّر الأعضاء
    try {
        sock.ev.on("group-participants.update", (u) => {
            if (u && u.id) invalidateGroup(u.id);
        });
    } catch (_) {}

    return sock;
}

module.exports = {
    install,
    digits,
    jnum,
    normalizeJid,
    jidOf,
    participantNumbers,
    isGroupJid,
    rememberJid,
    link,
    aliasesOf,
    sameUser,
    pickByAlias,
    canonical,
    registerParticipants,
    learnFromMessage,
    getGroupParticipants,
    invalidateGroup,
    findInParticipants,
    isMe,
    resolveJid,
    fixMentions,
    filterBannedEvent
};
