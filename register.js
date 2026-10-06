// ============================================================
// register.js — شاشة التسجيل (صفحة ويب) لمملكة النار 🔥
//
//  .جديد @user      → يرسل البوت رابط صفحة التسجيل (للممنشن فقط) — يحتاج صلاحية .سماح 2
//  .تصفير @user     → يسمح للعضو بالتسجيل من جديد
//  .رابط اساسي URL  → رابط القروب الأساسي (زر «الدخول»)
//
// واتساب لا يعرض HTML ولا حقول كتابة داخل الرسالة (هذا ممنوع على الحسابات العادية)،
// لذلك يرسل البوت رابطاً يفتح صفحة حقيقية بالتصميم المطلوب، وتحقق الهوية يتم عبر رمز يُرسل في القروب.
//
// لا يحتاج أي مكتبة إضافية (http المدمجة فقط).
// ============================================================

"use strict";

const http = require("http");
const crypto = require("crypto");
const jf = require("./jidfix");

let commandsMod = null;
try { commandsMod = require("./commands"); } catch (_) {}

// ------------------------------------------------------------
// إعدادات
// ------------------------------------------------------------

const SESSION_TTL_MS = 60 * 60 * 1000;      // صلاحية رابط التسجيل: ساعة
const ATTEMPT_TTL_MS = 15 * 60 * 1000;      // صلاحية رمز التأكيد: 15 دقيقة
const MAX_ATTEMPTS_PER_SESSION = 6;
const MAX_SESSIONS = 500;
const MAX_BODY = 4096;

const ctx = { getDb: null, saveDb: null, getOwnerNumbers: null };
let server = null;

const sessions = new Map();     // token → session
const byTarget = new Map();     // رقم العضو → token
const codeIndex = new Map();    // رمز → { token, attemptId }

// ------------------------------------------------------------
// أدوات
// ------------------------------------------------------------

const rnd = (n = 18) => crypto.randomBytes(n).toString("base64url");

function getDb() {
    try { return (ctx.getDb && ctx.getDb()) || global.db || null; } catch (_) { return global.db || null; }
}

function save() {
    try { if (ctx.saveDb) ctx.saveDb(); else if (typeof global.saveDb === "function") global.saveDb(); } catch (_) {}
}

function baseUrl() {
    let u = String(process.env.PUBLIC_URL || "").trim();
    if (!u && process.env.RAILWAY_PUBLIC_DOMAIN) u = "https://" + String(process.env.RAILWAY_PUBLIC_DOMAIN).trim();
    return u.replace(/\/+$/, "");
}

function cleanText(v, max) {
    return String(v ?? "")
        .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

function isSameUser(a, b) {
    try { return jf.sameUser(a, b); } catch (_) { return String(a) === String(b); }
}

function levelList(db, level) {
    const l = db && db.permissions && db.permissions[level];
    return Array.isArray(l) ? l : [];
}

function hasPerm(db, number, owner, levels = ["2", "5"]) {
    if (owner) return true;
    const cands = jf.aliasesOf(number);
    return levels.some(l => levelList(db, l).some(x => cands.includes(x)));
}

function isOwnerNumber(number) {
    try {
        const owners = (ctx.getOwnerNumbers && ctx.getOwnerNumbers()) || [];
        return owners.some(o => isSameUser(o, number));
    } catch (_) { return false; }
}

function getMentioned(msg) {
    try {
        const m = msg?.message || {};
        const inner = m.extendedTextMessage || m.imageMessage || m.videoMessage || m.documentMessage || {};
        const c = inner.contextInfo || m.contextInfo || {};
        if (Array.isArray(c.mentionedJid) && c.mentionedJid.length) return c.mentionedJid[0];
        if (c.participant && c.quotedMessage) return c.participant;
    } catch (_) {}
    return "";
}

function isRegistered(db, number) {
    const f = jf.pickByAlias(db && db.users, number);
    return Boolean(f && f.value && String(f.value.nickname || "").trim());
}

function similarNick(existing, newName) {
    if (commandsMod && typeof commandsMod.isSimilarNickname === "function") return commandsMod.isSimilarNickname(existing, newName);
    const norm = (s) => String(s).replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();
    const a = norm(existing), b = norm(newName);
    if (a === b) return true;
    const clean = (x) => x.replace(/\s*\d+$/, "").trim();
    const ca = clean(a), cb = clean(b);
    if (ca === cb) return true;
    const min = Math.min(ca.length, cb.length);
    if (min < 3) return false;
    let m = 0;
    for (let i = 0; i < min; i++) if (ca[i] === cb[i]) m++;
    return (m / min) > 0.85;
}

function nickTaken(db, nick, targetNumber) {
    for (const key of Object.keys((db && db.users) || {})) {
        const u = db.users[key];
        if (!u || !String(u.nickname || "").trim()) continue;
        if (isSameUser(key, targetNumber)) continue;
        if (similarNick(u.nickname, nick)) return true;
    }
    return false;
}

async function reply(sock, jid, msg, text, mentions) {
    try {
        const content = { text };
        if (mentions && mentions.length) content.mentions = mentions;
        await sock.sendMessage(jid, content, msg ? { quoted: msg } : undefined);
    } catch (e) {
        console.error("register reply error:", e?.message || e);
    }
}

// ------------------------------------------------------------
// تحديد المعدل (حماية الصفحة من الإغراق)
// ------------------------------------------------------------

function makeLimiter(max, windowMs) {
    const hits = new Map();
    return {
        hit(key) {
            const now = Date.now();
            let arr = hits.get(key);
            if (!arr) { arr = []; hits.set(key, arr); }
            while (arr.length && now - arr[0] > windowMs) arr.shift();
            if (arr.length >= max) return false;
            arr.push(now);
            if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
            return true;
        }
    };
}

const generalLimit = makeLimiter(120, 60 * 1000);
const submitLimit = makeLimiter(8, 10 * 60 * 1000);
const globalSubmitLimit = makeLimiter(150, 10 * 60 * 1000);
const checkLimit = makeLimiter(60, 60 * 1000);

function clientIp(req) {
    const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return xf || req.socket?.remoteAddress || "?";
}

// ------------------------------------------------------------
// الجلسات
// ------------------------------------------------------------

function cleanup() {
    const now = Date.now();
    for (const [token, s] of sessions) {
        for (const [id, at] of s.attempts) {
            if (now > at.expiresAt) {
                if (at.status === "waiting") at.status = "expired";
                codeIndex.delete(at.code);
                if (now > at.expiresAt + 5 * 60 * 1000) s.attempts.delete(id);
            }
        }
        if (now > s.expiresAt + 5 * 60 * 1000) {
            for (const at of s.attempts.values()) codeIndex.delete(at.code);
            sessions.delete(token);
            if (byTarget.get(s.targetNumber) === token) byTarget.delete(s.targetNumber);
        }
    }
}

function dropSessionsOf(targetNumber) {
    for (const a of jf.aliasesOf(targetNumber)) {
        const t = byTarget.get(a);
        if (!t) continue;
        const s = sessions.get(t);
        if (s) for (const at of s.attempts.values()) codeIndex.delete(at.code);
        sessions.delete(t);
        byTarget.delete(a);
    }
}

function createSession(targetNumber, targetJid, chatJid, createdBy) {
    cleanup();
    dropSessionsOf(targetNumber);
    if (sessions.size >= MAX_SESSIONS) {
        const oldest = sessions.keys().next().value;
        const s = sessions.get(oldest);
        if (s) { for (const at of s.attempts.values()) codeIndex.delete(at.code); byTarget.delete(s.targetNumber); }
        sessions.delete(oldest);
    }
    const token = rnd(18);
    const s = {
        token, targetNumber, targetJid, chatJid, createdBy,
        createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS,
        attempts: new Map()
    };
    sessions.set(token, s);
    byTarget.set(targetNumber, token);
    return s;
}

function getSession(token) {
    const s = sessions.get(String(token || ""));
    if (!s || Date.now() > s.expiresAt) return null;
    return s;
}

function newCode() {
    for (let i = 0; i < 50; i++) {
        const c = String(crypto.randomInt(10000, 100000));
        if (!codeIndex.has(c)) return c;
    }
    return null;
}

// ------------------------------------------------------------
// التحقق من مدخلات النموذج
// ------------------------------------------------------------

function validateForm(body, db, session) {
    const errors = {};
    const nick = cleanText(body.nick, 30);
    const sponsor = cleanText(body.sponsor, 40);
    const genderChoice = cleanText(body.gender, 10);
    const genderCustom = cleanText(body.genderCustom, 20);
    const ageRaw = cleanText(body.age, 3);

    if (nick.length < 2) errors.nick = "اكتب لقباً من حرفين على الأقل";
    else if (nickTaken(db, nick, session.targetNumber)) errors.nick = "عذرا هذا اللقب مأخود!";

    if (sponsor.length < 2) errors.sponsor = "هذا الحقل مطلوب";

    let gender = "";
    if (genderChoice === "ذكر" || genderChoice === "أنثى") gender = genderChoice;
    else if (genderChoice === "مخصص") {
        if (genderCustom.length < 1) errors.gender = "اكتب جنسك المخصص";
        else gender = genderCustom;
    } else errors.gender = "اختر جنسك";

    let age = "";
    if (ageRaw) {
        if (!/^\d{1,2}$/.test(ageRaw) || Number(ageRaw) < 5 || Number(ageRaw) > 99) errors.age = "العمر غير صحيح";
        else age = Number(ageRaw);
    }

    if (body.agree !== true) errors.agree = "يجب الموافقة على الملاحظة";

    return { errors, data: { nick, sponsor, gender, age } };
}

// ------------------------------------------------------------
// صفحة الويب
// ------------------------------------------------------------

function pageHtml(state, nonce) {
    const json = JSON.stringify(state).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#2a0800">
<meta property="og:title" content="🔥 مملكة النار — التسجيل">
<meta property="og:description" content="املأ بياناتك وانضم إلى مملكة النار">
<title>🔥 𝑭. 𝑰. 𝑹 — التسجيل</title>
<style nonce="${nonce}">
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0}
body{min-height:100vh;font-family:Tahoma,"Segoe UI",Arial,sans-serif;color:#fff;
  background:radial-gradient(ellipse at 50% 0%,#7a1d00 0%,#3a0d00 38%,#150300 100%);background-attachment:fixed}
.wrap{max-width:460px;margin:0 auto;padding:18px 14px 40px}
.brand{text-align:center;font-size:26px;font-weight:800;letter-spacing:2px;margin:6px 0 14px;
  background:linear-gradient(90deg,#ffd34d,#ff7a00,#ff2e00,#ff7a00,#ffd34d);background-size:200% auto;
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:flow 3s linear infinite;
  filter:drop-shadow(0 0 8px rgba(255,106,0,.8))}
@keyframes flow{to{background-position:200% center}}
.welcome{text-align:center;font-size:21px;font-weight:800;line-height:1.7;margin:4px 0 16px;
  background:linear-gradient(180deg,#fff3a8,#ffb300 45%,#ff5a00);-webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent;filter:drop-shadow(0 0 10px rgba(255,90,0,.85))}
.neon{text-align:center;font-size:19px;font-weight:800;color:#b6ff3b;margin:0 0 12px;
  text-shadow:0 0 6px #b6ff3b,0 0 14px #7dff00,0 0 26px #4cff00;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{50%{text-shadow:0 0 3px #b6ff3b,0 0 8px #7dff00,0 0 14px #4cff00}}
.card{background:#ffe3c4;color:#4a1d00;border-radius:18px;padding:16px;box-shadow:0 0 0 2px #ff9a3c,0 8px 30px rgba(255,90,0,.45)}
.field{margin-bottom:14px}
.field label{display:block;font-weight:700;font-size:15px;margin-bottom:6px;line-height:1.6}
.field .opt{font-weight:400;font-size:13px;color:#8a4a1a}
input[type=text],input[type=number]{width:100%;font:inherit;font-size:16px;padding:12px;border-radius:12px;
  border:2px solid #ff9a3c;background:#fff1de;color:#3b1500;outline:none}
input[type=text]:focus,input[type=number]:focus{border-color:#ff5a00;box-shadow:0 0 0 3px rgba(255,90,0,.25)}
.err{color:#c1121f;font-weight:700;font-size:14px;margin-top:6px;min-height:0}
.hide{display:none!important}
.seg{display:flex;gap:8px}
.seg button{flex:1;font:inherit;font-weight:700;font-size:15px;padding:11px 4px;border-radius:12px;border:2px solid #ff9a3c;
  background:#fff1de;color:#4a1d00;cursor:pointer}
.seg button.on{background:linear-gradient(180deg,#ffb347,#ff6a00);color:#fff;border-color:#e64a00;box-shadow:0 0 12px rgba(255,106,0,.7)}
.agree{display:flex;gap:10px;align-items:flex-start;background:#ffd2a1;border-radius:12px;padding:12px;margin:4px 0 12px}
.agree input{width:24px;height:24px;flex:none;accent-color:#ff5a00;margin:2px 0 0}
.agree span{font-size:14px;font-weight:700;line-height:1.7}
.btn{display:block;width:100%;font:inherit;font-size:19px;font-weight:800;color:#fff;border:0;border-radius:14px;padding:14px;cursor:pointer;
  background:linear-gradient(180deg,#ff9a1f,#ff4d00);box-shadow:0 0 18px rgba(255,90,0,.8);text-align:center;text-decoration:none}
.btn:disabled{opacity:.6}
.btn.green{background:linear-gradient(180deg,#4dff7a,#00b34a);box-shadow:0 0 22px rgba(0,255,120,.9),0 0 44px rgba(0,255,120,.45);color:#02290f;animation:glow 1.6s ease-in-out infinite}
@keyframes glow{50%{box-shadow:0 0 12px rgba(0,255,120,.7),0 0 26px rgba(0,255,120,.3)}}
.btn.ghost{background:#fff1de;color:#4a1d00;box-shadow:none;border:2px solid #ff9a3c;font-size:16px;margin-top:10px}
.code{font-size:44px;font-weight:900;letter-spacing:8px;text-align:center;direction:ltr;margin:10px 0;color:#c53a00;text-shadow:0 0 12px rgba(255,120,0,.6)}
.small{font-size:14px;line-height:1.8;white-space:pre-line}
.center{text-align:center}
.wait{margin-top:12px;text-align:center;font-weight:700;color:#7a3a00;animation:pulse2 1.4s ease-in-out infinite}
@keyframes pulse2{50%{opacity:.45}}
.ok{background:linear-gradient(180deg,#0f5a2a,#0a3a1b);color:#eafff1;border-radius:18px;padding:20px;text-align:center;
  box-shadow:0 0 0 2px #38e07a,0 0 34px rgba(56,224,122,.6)}
.ok h2{margin:0 0 10px;font-size:24px;color:#9dffbf;text-shadow:0 0 10px rgba(80,255,150,.8)}
.ok p{line-height:1.9;font-size:16px;margin:8px 0 16px}
.bad{white-space:pre-line;background:linear-gradient(180deg,#5a0a0a,#2e0505);color:#ffe3e3;border-radius:18px;padding:22px;text-align:center;font-size:20px;font-weight:800;line-height:1.9;
  box-shadow:0 0 0 2px #ff4d4d,0 0 30px rgba(255,60,60,.5)}
.foot{margin-top:18px;text-align:center;font-size:12px;color:#c98a5a}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">🔥 𝑭. 𝑰. 𝑹 🔥</div>
  <div id="app"></div>
  <div class="foot">🔥 مملكة النار الخاصة بالجيسي 🔥</div>
</div>
<script nonce="${nonce}">
(function(){
"use strict";
var STATE=${json};
var app=document.getElementById("app");
var token=STATE.token||"";
var gender="";
var attempt=null, pollTimer=null;

function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function clear(){while(app.firstChild)app.removeChild(app.firstChild);if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}}
function post(url,body){return fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{}),cache:"no-store"}).then(function(r){return r.json().catch(function(){return{ok:false,error:"خطأ غير متوقع"};});});}

function showBad(text){clear();app.appendChild(el("div","bad",text));}

function showWelcome(){
  app.appendChild(el("div","welcome","🔥 نورت مملكة النار الخاصة بالجيسي 🔥"));
  app.appendChild(el("div","neon","رجاءا املأ هذه البيانات:"));
}

function showForm(prefill){
  clear(); showWelcome();
  prefill=prefill||{};
  var card=el("div","card");
  function field(label,opt){var f=el("div","field");var l=el("label");l.appendChild(document.createTextNode(label));if(opt){l.appendChild(document.createTextNode(" "));l.appendChild(el("span","opt",opt));}f.appendChild(l);return f;}

  var f1=field("لقبك او اسم شخصية انمي تفضل ان نناديك فيه:");
  var nick=el("input");nick.type="text";nick.maxLength=30;nick.autocomplete="off";nick.value=prefill.nick||"";f1.appendChild(nick);
  var e1=el("div","err hide");f1.appendChild(e1);

  var f2=field("من طرف مين دخلت؟");
  var sp=el("input");sp.type="text";sp.maxLength=40;sp.autocomplete="off";sp.value=prefill.sponsor||"";f2.appendChild(sp);
  var e2=el("div","err hide");f2.appendChild(e2);

  var f3=field("ماجنسك؟ ذكر او انثى؟ او مخصص؟");
  var seg=el("div","seg");var btns={};
  ["ذكر","أنثى","مخصص"].forEach(function(g){var b=el("button",null,g);b.type="button";b.addEventListener("click",function(){gender=g;paint();});btns[g]=b;seg.appendChild(b);});
  f3.appendChild(seg);
  var custom=el("input");custom.type="text";custom.maxLength=20;custom.placeholder="اكتب جنسك";custom.className="hide";custom.autocomplete="off";
  f3.appendChild(el("div","err hide")); // placeholder to keep structure
  var e3=f3.lastChild; f3.insertBefore(custom,e3);
  function paint(){for(var k in btns){btns[k].className=(k===gender)?"on":"";}if(gender==="مخصص")custom.classList.remove("hide");else custom.classList.add("hide");}
  paint();

  var f4=field("عمرك؟","(الاجابة اختيارية)");
  var age=el("input");age.type="number";age.inputMode="numeric";age.min="5";age.max="99";age.value=prefill.age||"";f4.appendChild(age);
  var e4=el("div","err hide");f4.appendChild(e4);

  var ag=el("label","agree");var cb=el("input");cb.type="checkbox";ag.appendChild(cb);
  ag.appendChild(el("span",null,"ملاحظة: عندما تدخل بياناتك بشكل خاطئ او مزيف لن تتمكن من تعديلها لاحقا!"));
  var e5=el("div","err hide");

  var go=el("button","btn","التالي");go.type="button";

  [f1,f2,f3,f4].forEach(function(f){card.appendChild(f);});
  card.appendChild(ag);card.appendChild(e5);card.appendChild(go);
  app.appendChild(card);

  function setErr(box,msg){if(msg){box.textContent=msg;box.classList.remove("hide");}else{box.textContent="";box.classList.add("hide");}}

  var t=null;
  nick.addEventListener("input",function(){
    setErr(e1,"");clearTimeout(t);
    var v=nick.value.trim();if(v.length<2)return;
    t=setTimeout(function(){post("/api/check/"+token,{nick:v}).then(function(r){if(r&&r.taken&&nick.value.trim()===v)setErr(e1,"عذرا هذا اللقب مأخود!");});},450);
  });

  if(prefill.nickError)setErr(e1,prefill.nickError);

  go.addEventListener("click",function(){
    setErr(e1,"");setErr(e2,"");setErr(e4,"");setErr(e5,"");setErr(e3,"");
    go.disabled=true;go.textContent="...جاري الفحص";
    post("/api/submit/"+token,{nick:nick.value,sponsor:sp.value,gender:gender,genderCustom:custom.value,age:age.value,agree:cb.checked}).then(function(r){
      go.disabled=false;go.textContent="التالي";
      if(r&&r.ok){attempt={id:r.attempt,code:r.code,share:r.share};try{sessionStorage.setItem("att_"+token,JSON.stringify(attempt));}catch(e){}showCode();return;}
      if(r&&r.mode==="registered"){showBad("❌ انت نسجل لدى مملكة النار ❌");return;}
      if(r&&r.mode==="invalid"){showInvalid();return;}
      var er=(r&&r.errors)||{};
      if(er.nick)setErr(e1,er.nick);if(er.sponsor)setErr(e2,er.sponsor);if(er.gender)setErr(e3,er.gender);if(er.age)setErr(e4,er.age);if(er.agree)setErr(e5,er.agree);
      if(r&&r.error)setErr(e5,r.error);
    }).catch(function(){go.disabled=false;go.textContent="التالي";setErr(e5,"تعذّر الاتصال، حاول مرة أخرى");});
  });
}

function showInvalid(){showBad("⌛ انتهت صلاحية هذا الرابط.\\nاطلب من المشرف ارسال .جديد من جديد");}

function showCode(){
  clear(); showWelcome();
  var card=el("div","card");
  card.appendChild(el("div","small center","خطوة اخيرة ✅ لنتأكد انك انت صاحب الدعوة:\\nارسل هذا الرمز في القروب من رقمك"));
  card.appendChild(el("div","code",attempt.code));
  var a=el("a","btn","ارسال الرمز في الواتساب");a.href=attempt.share;a.rel="noopener";card.appendChild(a);
  var c=el("button","btn ghost","نسخ الرمز");c.type="button";
  c.addEventListener("click",function(){try{navigator.clipboard.writeText(attempt.code);c.textContent="تم النسخ ✅";}catch(e){c.textContent=attempt.code;}});
  card.appendChild(c);
  card.appendChild(el("div","wait","⏳ بانتظار التأكيد من القروب..."));
  app.appendChild(card);
  poll();
}

function poll(){
  fetch("/api/status/"+token+"/"+attempt.id,{cache:"no-store"}).then(function(r){return r.json();}).then(function(r){
    var s=r&&r.status;
    if(s==="done"){showDone(r.link);return;}
    if(s==="wrong"){try{sessionStorage.removeItem("att_"+token);}catch(e){}showBad("صفحة التسجيل هذه ليس مخصصة لك ⛔");return;}
    if(s==="registered"){showBad("❌ انت نسجل لدى مملكة النار ❌");return;}
    if(s==="retry"){showForm({nickError:"عذرا هذا اللقب مأخود!"});return;}
    if(s==="expired"||s==="gone"){try{sessionStorage.removeItem("att_"+token);}catch(e){}showForm({});return;}
    pollTimer=setTimeout(poll,2500);
  }).catch(function(){pollTimer=setTimeout(poll,4000);});
}

function showDone(link){
  clear();
  var ok=el("div","ok");
  ok.appendChild(el("h2",null,"✅ تم تسجيلك! ✅"));
  ok.appendChild(el("p",null,"تم تسجيلك!  انت الان في قروب الاستقبال... "));
  ok.appendChild(el("p",null,"رجاءا اضغط هذا الزر لتنتقل الى قروب الاساسي:"));
  if(link){var a=el("a","btn green","الدخول");a.href=link;a.rel="noopener";ok.appendChild(a);}
  else ok.appendChild(el("p",null,"سيرسل لك المشرف رابط القروب الاساسي قريباً."));
  app.appendChild(ok);
  try{sessionStorage.removeItem("att_"+token);}catch(e){}
}

if(STATE.mode==="registered"){showBad("❌ انت نسجل لدى مملكة النار ❌");}
else if(STATE.mode!=="form"){showInvalid();}
else{
  var saved=null;try{saved=JSON.parse(sessionStorage.getItem("att_"+token)||"null");}catch(e){}
  if(saved&&saved.id&&saved.code&&saved.share){attempt=saved;showCode();}else{showForm({});}
}
})();
</script>
</body>
</html>`;
}

// ------------------------------------------------------------
// خادم HTTP
// ------------------------------------------------------------

function send(res, status, body, type = "application/json; charset=utf-8", extra = {}) {
    const headers = Object.assign({
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY"
    }, extra);
    res.writeHead(status, headers);
    res.end(body);
}

const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj));

function readJson(req) {
    return new Promise((resolve, reject) => {
        const ct = String(req.headers["content-type"] || "");
        if (!ct.includes("application/json")) return reject(Object.assign(new Error("type"), { status: 415 }));
        let size = 0;
        let dead = false;
        const chunks = [];
        req.on("data", (c) => {
            if (dead) return;
            size += c.length;
            if (size > MAX_BODY) { dead = true; chunks.length = 0; reject(Object.assign(new Error("big"), { status: 413 })); return; }
            chunks.push(c);
        });
        req.on("end", () => {
            if (dead) return;
            try {
                const obj = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
                if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("shape");
                resolve(obj);
            } catch (_) { reject(Object.assign(new Error("json"), { status: 400 })); }
        });
        req.on("error", () => reject(Object.assign(new Error("io"), { status: 400 })));
    });
}

async function handleHttp(req, res) {
    try {
        const ip = clientIp(req);
        if (!generalLimit.hit(ip)) return sendJson(res, 429, { ok: false, error: "طلبات كثيرة، انتظر قليلاً" });

        const url = new URL(req.url, "http://localhost");
        const path = url.pathname;
        const db = getDb();

        if (req.method === "GET" && (path === "/health" || path === "/")) return send(res, 200, "ok", "text/plain; charset=utf-8");

        let m;

        // ---- الصفحة ----
        if (req.method === "GET" && (m = path.match(/^\/join\/([A-Za-z0-9_-]{10,64})$/))) {
            const s = getSession(m[1]);
            let state;
            if (!s) state = { mode: "invalid" };
            else if (db && isRegistered(db, s.targetNumber)) state = { mode: "registered" };
            else state = { mode: "form", token: s.token };

            const nonce = crypto.randomBytes(12).toString("base64");
            const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`;
            return send(res, 200, pageHtml(state, nonce), "text/html; charset=utf-8", { "Content-Security-Policy": csp });
        }

        // ---- فحص اللقب ----
        if (req.method === "POST" && (m = path.match(/^\/api\/check\/([A-Za-z0-9_-]{10,64})$/))) {
            if (!checkLimit.hit(ip)) return sendJson(res, 429, { ok: false });
            const body = await readJson(req);
            const s = getSession(m[1]);
            if (!s || !db) return sendJson(res, 200, { ok: false, mode: "invalid" });
            const nick = cleanText(body.nick, 30);
            if (nick.length < 2) return sendJson(res, 200, { ok: true, taken: false });
            return sendJson(res, 200, { ok: true, taken: nickTaken(db, nick, s.targetNumber) });
        }

        // ---- إرسال النموذج ----
        if (req.method === "POST" && (m = path.match(/^\/api\/submit\/([A-Za-z0-9_-]{10,64})$/))) {
            if (!submitLimit.hit(ip) || !globalSubmitLimit.hit("all")) return sendJson(res, 429, { ok: false, error: "محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة" });
            const body = await readJson(req);
            const s = getSession(m[1]);
            if (!s || !db) return sendJson(res, 200, { ok: false, mode: "invalid" });
            if (isRegistered(db, s.targetNumber)) return sendJson(res, 200, { ok: false, mode: "registered" });

            const { errors, data } = validateForm(body, db, s);
            if (Object.keys(errors).length) return sendJson(res, 200, { ok: false, errors });

            cleanup();
            let live = 0;
            for (const at of s.attempts.values()) if (at.status === "waiting" && Date.now() < at.expiresAt) live++;
            if (live >= MAX_ATTEMPTS_PER_SESSION) return sendJson(res, 200, { ok: false, error: "محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة" });

            const code = newCode();
            if (!code) return sendJson(res, 200, { ok: false, error: "حاول مرة أخرى" });

            const id = rnd(12);
            s.attempts.set(id, { id, code, data, status: "waiting", createdAt: Date.now(), expiresAt: Date.now() + ATTEMPT_TTL_MS });
            codeIndex.set(code, { token: s.token, attemptId: id });
            return sendJson(res, 200, { ok: true, attempt: id, code, share: "https://wa.me/?text=" + encodeURIComponent(code) });
        }

        // ---- حالة المحاولة ----
        if (req.method === "GET" && (m = path.match(/^\/api\/status\/([A-Za-z0-9_-]{10,64})\/([A-Za-z0-9_-]{6,40})$/))) {
            const s = sessions.get(m[1]);
            const at = s && s.attempts.get(m[2]);
            if (!s || !at) return sendJson(res, 200, { ok: true, status: "gone" });
            if (at.status === "waiting" && Date.now() > at.expiresAt) at.status = "expired";
            const out = { ok: true, status: at.status };
            if (at.status === "done") {
                const link = db && db.welcomeLinks && db.welcomeLinks.link3;
                if (link && LINK_RE.test(link)) out.link = link;
            }
            return sendJson(res, 200, out);
        }

        return send(res, 404, "Not found", "text/plain; charset=utf-8");
    } catch (e) {
        const status = e && e.status ? e.status : 500;
        try {
            if (status === 413) {
                send(res, 413, JSON.stringify({ ok: false }), "application/json; charset=utf-8", { Connection: "close" });
                setTimeout(() => { try { req.destroy(); } catch (_) {} }, 100).unref?.();
            } else sendJson(res, status, { ok: false });
        } catch (_) {}
    }
}

function startServer() {
    if (server) return;
    const port = Number(process.env.PORT) || 3000;
    server = http.createServer((req, res) => { handleHttp(req, res); });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
    server.maxHeadersCount = 50;
    server.on("clientError", (err, socket) => { try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch (_) {} });
    server.on("error", (e) => console.error("❌ خادم صفحة التسجيل:", e?.message || e));
    server.listen(port, "0.0.0.0", () => console.log(`🌐 صفحة التسجيل تعمل على المنفذ ${port}${baseUrl() ? " — " + baseUrl() : " (لا يوجد رابط عام بعد: فعّل Domain في Railway)"}`));
    const t = setInterval(cleanup, 5 * 60 * 1000);
    t.unref && t.unref();
}

function init(options = {}) {
    ctx.getDb = options.getDb || ctx.getDb;
    ctx.saveDb = options.saveDb || ctx.saveDb;
    ctx.getOwnerNumbers = options.getOwnerNumbers || ctx.getOwnerNumbers;
    startServer();
}

// ------------------------------------------------------------
// أوامر البوت
// ------------------------------------------------------------

const LINK_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}(\?[A-Za-z0-9=&_.-]{0,80})?$/;

async function cmdNew(sock, jid, msg, db, cleanSender, owner) {
    if (!jf.isGroupJid(jid)) return true;
    if (!hasPerm(db, cleanSender, owner)) {
        await reply(sock, jid, msg, "❌ ليس لديك صلاحية لاستخدام أمر .جديد (يحتاج .سماح 2).");
        return true;
    }
    const mentioned = getMentioned(msg);
    if (!mentioned) {
        await reply(sock, jid, msg, "⚠️ يرجى منشن العضو الجديد.\nمثال: .جديد @العضو");
        return true;
    }
    const base = baseUrl();
    if (!base) {
        await reply(sock, jid, msg, "⚠️ لا يوجد رابط عام لصفحة التسجيل.\nفي Railway: Settings ← Networking ← Generate Domain، أو ضع Variable باسم PUBLIC_URL.");
        return true;
    }

    const num = jf.jnum(mentioned);
    if (!num) return true;
    try { jf.rememberJid(num, mentioned); } catch (_) {}
    const target = jf.canonical(db, num);

    const s = createSession(target, mentioned, jid, cleanSender);
    const link = `${base}/join/${s.token}`;

    await reply(sock, jid, msg,
        `🔥 𝑭. 𝑰. 𝑹 🔥\n` +
        `━━━━━━━━━━━━━━━\n` +
        `🔥 نورت يا @${num} مملكة النار الخاصة بالجيسي 🔥\n\n` +
        `📝 رجاءا املأ بياناتك من هنا:\n${link}\n\n` +
        `⚠️ الرابط مخصص لك فقط.\n` +
        `━━━━━━━━━━━━━━━`,
        [mentioned]);
    return true;
}

async function cmdReset(sock, jid, msg, db, saveDb, cleanSender, owner) {
    if (!jf.isGroupJid(jid)) return true;
    if (!hasPerm(db, cleanSender, owner)) {
        await reply(sock, jid, msg, "❌ ليس لديك صلاحية لاستخدام أمر .تصفير (يحتاج .سماح 2).");
        return true;
    }
    const mentioned = getMentioned(msg);
    if (!mentioned) {
        await reply(sock, jid, msg, "⚠️ يرجى منشن العضو.\nمثال: .تصفير @العضو");
        return true;
    }
    const num = jf.jnum(mentioned);
    const target = jf.canonical(db, num);

    // حماية الجهات العليا من غير المالك
    if (!owner) {
        const cands = jf.aliasesOf(target);
        const higher = isOwnerNumber(target) || ["1", "3", "4", "5"].some(l => levelList(db, l).some(x => cands.includes(x)));
        if (higher) {
            await reply(sock, jid, msg, "❆━━━━━═⏣⊰⛔⊱⏣═━━━━━❆\n*لا يمكنك تصفير تسجيل* \\`الجهات العليا\\`\n❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆");
            return true;
        }
    }

    dropSessionsOf(target);
    const f = jf.pickByAlias(db.users, target);
    if (!f || !f.value || !String(f.value.nickname || "").trim()) {
        await reply(sock, jid, msg, "ℹ️ هذا العضو غير مسجل أصلاً، يمكنه التسجيل مباشرة عبر .جديد @", [mentioned]);
        return true;
    }
    const u = f.value;
    const old = String(u.nickname).trim();
    u.nickname = "";
    delete u.sponsor; delete u.gender; delete u.age; delete u.registeredAt; delete u.registeredVia;
    (saveDb || save)();

    await reply(sock, jid, msg,
        `♻️◈══════════════◈♻️\n✅ تم تصفير تسجيل @${jf.jnum(mentioned)}\n🏷️ اللقب السابق: [${old}]\n\nيمكنه الآن التسجيل من جديد عبر: .جديد @\n(رصيده ورتبته محفوظان)\n♻️◈══════════════◈♻️`,
        [mentioned]);
    return true;
}

async function cmdMainLink(sock, jid, msg, db, saveDb, owner, rest) {
    if (!owner) {
        await reply(sock, jid, msg, "⛔ هذا الأمر للمطور فقط.");
        return true;
    }
    const url = String(rest || "").trim().split(/\s+/)[0] || "";
    if (!url) {
        await reply(sock, jid, msg, "⚠️ يرجى كتابة الرابط بعد الأمر.\nمثال: .رابط اساسي https://chat.whatsapp.com/xxxx");
        return true;
    }
    if (!LINK_RE.test(url)) {
        await reply(sock, jid, msg, "❌ الرابط غير صالح. يجب أن يكون رابط قروب واتساب يبدأ بـ:\nhttps://chat.whatsapp.com/");
        return true;
    }
    db.welcomeLinks = db.welcomeLinks || { link1: "", link2: "" };
    db.welcomeLinks.link3 = url;
    (saveDb || save)();
    await reply(sock, jid, msg, "✅ تم حفظ رابط القروب الأساسي (زر «الدخول» في صفحة التسجيل).");
    return true;
}

/** يعالج: .جديد  .تصفير  .رابط اساسي — يرجع true إن عالج الأمر */
async function handleCommand(sock, jid, msg, text, db, saveDb, cleanSender, owner) {
    const t = String(text || "").trim();
    if (!t.startsWith(".")) return false;
    const m = t.match(/^\.(\S+)(?:\s+([\s\S]*))?$/);
    if (!m) return false;
    const cmd = m[1];
    const rest = m[2] || "";

    if (cmd === "جديد") return cmdNew(sock, jid, msg, db, cleanSender, owner);
    if (cmd === "تصفير") return cmdReset(sock, jid, msg, db, saveDb, cleanSender, owner);
    if (cmd === "رابط" && /^(ال)?[اأإ]ساسي(\s|$)/.test(rest.trim())) {
        return cmdMainLink(sock, jid, msg, db, saveDb, owner, rest.trim().replace(/^(ال)?[اأإ]ساسي\s*/, ""));
    }
    return false;
}

/** رسالة عادية: إن كانت رمز تأكيد (5 أرقام) لمحاولة تسجيل قائمة */
async function handleMessageHook(sock, jid, msg, text, db, saveDb, cleanSender, owner) {
    const t = String(text || "").trim();
    if (!/^\d{5}$/.test(t)) return false;
    if (msg?.key?.fromMe) return false;

    const entry = codeIndex.get(t);
    if (!entry) return false;
    const s = sessions.get(entry.token);
    const at = s && s.attempts.get(entry.attemptId);
    if (!s || !at || at.status !== "waiting" || Date.now() > at.expiresAt || Date.now() > s.expiresAt) {
        codeIndex.delete(t);
        return false;
    }
    if (jid !== s.chatJid) return false;   // يُقبل فقط في نفس القروب الذي أُرسل فيه الرابط

    // ⛔ ليس هو الممنشن
    if (!isSameUser(cleanSender, s.targetNumber)) {
        at.status = "wrong";
        codeIndex.delete(t);
        await reply(sock, jid, msg, "صفحة التسجيل هذه ليس مخصصة لك ⛔");
        return true;
    }

    // ✅ هو الممنشن: نكمل التسجيل
    codeIndex.delete(t);
    if (isRegistered(db, s.targetNumber)) { at.status = "registered"; return true; }
    if (nickTaken(db, at.data.nick, s.targetNumber)) { at.status = "retry"; await reply(sock, jid, msg, "⚠️ اللقب أصبح مأخوذاً، ارجع للصفحة واختر لقباً آخر."); return true; }

    const key = jf.canonical(db, s.targetNumber);
    db.users = db.users || {};
    let u = db.users[key];
    if (!u || typeof u !== "object") u = db.users[key] = { balance: 0, nickname: "", rank: "", maxInteraction: 0, friend: "" };
    u.nickname = at.data.nick;
    u.sponsor = at.data.sponsor;
    u.gender = at.data.gender;
    u.age = at.data.age;
    u.registeredAt = Date.now();
    u.registeredVia = "web";
    (saveDb || save)();

    at.status = "done";
    s.attempts.forEach((a) => { if (a !== at && a.status === "waiting") { a.status = "registered"; codeIndex.delete(a.code); } });

    await reply(sock, jid, msg,
        `✅◈══════════════◈✅\n🔥 تم تسجيل @${jf.jnum(s.targetJid)} بنجاح\n🏷️ اللقب: [${at.data.nick}]\n\nارجع للصفحة واضغط زر «الدخول» للانتقال للقروب الأساسي.\n✅◈══════════════◈✅`,
        [s.targetJid]);
    return true;
}

function stop() {
    try { if (server) server.close(); } catch (_) {}
    server = null;
}

module.exports = {
    init,
    stop,
    handleCommand,
    handleMessageHook,
    // للاختبار
    _internals: { sessions, codeIndex, createSession, baseUrl, LINK_RE }
};
