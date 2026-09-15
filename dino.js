// ============================================================
// dino.js
// ALJESAT BOT
// لعبة Dino Runner - HTML WebView + سيرفر
// ============================================================

"use strict";

// استيراد دالة sendInlineWebUI من المكتبة الجديدة
const { sendInlineWebUI } = require("@rennzsync/baileys");

// ============================================================
// الحالة النشطة للعبة
// ============================================================

const activeDino = Object.create(null);

// ============================================================
// إعدادات اللعبة
// ============================================================

const DINO_CONFIG = {
    cooldownMs: 5 * 60 * 1000,
    pointsPerDollar: 100,
    maxEarn: 1000,
    minEarn: 1,
    gameTimeoutMs: 3 * 60 * 1000
};

// ============================================================
// أدوات مساعدة
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/\D/g, "");
}

function getUser(db, jid) {
    if (!db || !db.users) return null;
    return db.users[jid] || null;
}

function hasNickname(db, jid) {
    const user = getUser(db, jid);
    return Boolean(user && String(user.nickname || "").trim());
}

function getUserNickname(db, jid) {
    const user = getUser(db, jid);
    return (user && String(user.nickname || "").trim()) || "مجهول";
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

function formatDate(date) {
    const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    return `${days[date.getDay()]} | ${date.getDate()} | ${months[date.getMonth()]}`;
}

function getServerUrl() {
    try {
        const settings = require("./settings");
        if (settings.dinoServerUrl && String(settings.dinoServerUrl).trim()) {
            return String(settings.dinoServerUrl).trim().replace(/\/$/, "");
        }
    } catch (_) {}

    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    }
    if (process.env.RENDER_EXTERNAL_URL) {
        return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
    }

    const port = Number(process.env.PORT) || 3001;
    return `http://localhost:${port}`;
}

// ============================================================
// HTML للعبة Dino Runner
// ============================================================

function generateDinoHTML(playerName, playerNumber, chatId, gameId, token, serverUrl) {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Dino Runner</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
body{background:transparent;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#eee;touch-action:manipulation;cursor:pointer;overflow:hidden}
.wrap{width:100%;max-width:620px;margin:auto;box-sizing:border-box}
.box{position:relative;width:100%;aspect-ratio:16/9;background:rgba(255,255,255,.06);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.15);border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.35)}
canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.hud-tl{position:absolute;top:8px;left:12px;pointer-events:none;text-shadow:0 1px 4px rgba(0,0,0,.9)}
.hud-tl .brand{font-size:9px;letter-spacing:1.5px;color:rgba(255,255,255,.65)}
.hud-tl .title{font-size:14px;font-weight:bold;color:#fff}
.hud-tr{position:absolute;top:8px;right:12px;text-align:right;pointer-events:none;text-shadow:0 1px 4px rgba(0,0,0,.9)}
.hud-tr .score{font-size:15px;font-weight:bold;color:#fff;transition:transform .15s}
.hud-tr .best{font-size:9px;color:rgba(255,255,255,.75);margin-top:1px}
.status{position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:9px;color:rgba(255,255,255,.75);pointer-events:none;text-shadow:0 1px 4px rgba(0,0,0,.9)}
.btn-row{position:absolute;bottom:10px;left:10px;right:10px;display:flex;gap:8px;justify-content:center;pointer-events:none}
.btn{pointer-events:auto;padding:8px 20px;font-size:11px;font-weight:bold;border-radius:18px;cursor:pointer;letter-spacing:.5px;border:2px solid transparent}
.btn-jump{background:linear-gradient(145deg,#00c853,#00ff64);color:#0a0e27;border-color:#00ff64;box-shadow:0 4px 15px rgba(0,255,100,.5)}
.btn-jump:active{transform:scale(.95);box-shadow:0 2px 8px rgba(0,255,100,.8)}
.btn-cash{background:linear-gradient(145deg,#d32f2f,#ff5252);color:#fff;border-color:#ff5252;box-shadow:0 4px 15px rgba(255,82,82,.5)}
.btn-cash:active{transform:scale(.95);box-shadow:0 2px 8px rgba(255,82,82,.8)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.overlay{position:absolute;inset:0;background:rgba(10,14,39,.9);display:none;flex-direction:column;align-items:center;justify-content:center;gap:8px;z-index:10}
.overlay.show{display:flex}
.overlay .big{font-size:22px;font-weight:bold}
.overlay .msg{font-size:12px;color:rgba(255,255,255,.8);text-align:center;padding:0 20px}
</style>
</head>
<body>
<div class="wrap">
<div class="box">
<canvas id="game" width="480" height="270"></canvas>
<div class="hud-tl">
<div class="brand">ALJESAT ARCADE</div>
<div class="title">🦖 Dino Runner</div>
</div>
<div class="hud-tr">
<div class="score" id="score">0</div>
<div class="best" id="best">BEST 0</div>
</div>
<div class="status" id="status">دوس على الشاشة باش تقفز</div>
<div class="btn-row">
<button class="btn btn-jump" id="jumpBtn">⬆️ اقفز</button>
<button class="btn btn-cash" id="cashBtn">💸 سحب</button>
</div>
<div class="overlay" id="overlay">
<div class="big" id="overlayTitle">انتهت</div>
<div class="msg" id="overlayMsg"></div>
</div>
</div>
</div>
<script>
(function(){
const c=document.getElementById('game'),x=c.getContext('2d');
const scoreEl=document.getElementById('score'),bestEl=document.getElementById('best'),statusEl=document.getElementById('status');
const jumpBtn=document.getElementById('jumpBtn'),cashBtn=document.getElementById('cashBtn');
const overlay=document.getElementById('overlay'),overlayTitle=document.getElementById('overlayTitle'),overlayMsg=document.getElementById('overlayMsg');
const W=c.width,H=c.height,GROUND=H-40;
const PLAYER_NUMBER="${playerNumber}";
const CHAT_ID="${chatId}";
const GAME_ID="${gameId}";
const TOKEN="${token}";
const SERVER_URL="${serverUrl}";
const POINTS_PER_DOLLAR=100;
const MAX_EARN=1000;

let dino,obstacles,clouds,groundOffset,score,best,gameOver,started,frame,speed,shake,particles;
let cashedOut=false;
const GRAV=.7,JUMP=-12;
let bestSaved=0;
try{const v=localStorage.getItem('dino_best');if(v)bestSaved=parseInt(v,10)||0}catch(e){}
best=bestSaved;
function saveBest(v){try{localStorage.setItem('dino_best',String(v))}catch(e){}}

function reset(){
dino={x:60,y:GROUND-38,w:38,h:38,vy:0,jumping:false,legFrame:0};
obstacles=[];particles=[];
clouds=[];
for(let i=0;i<3;i++)clouds.push({x:Math.random()*W,y:20+Math.random()*60,s:.5+Math.random()*.7,sp:.2+Math.random()*.2});
groundOffset=0;score=0;gameOver=false;started=false;frame=0;speed=4;shake=0;
cashedOut=false;
overlay.classList.remove('show');
cashBtn.disabled=false;
scoreEl.textContent='0';
bestEl.textContent='BEST '+best;
statusEl.textContent='دوس على الشاشة باش تقفز';
}
function jump(){
if(cashedOut)return;
if(gameOver){reset();started=true;return}
if(!started)started=true;
if(!dino.jumping){dino.vy=JUMP;dino.jumping=true}
}
function burst(px,py,n,col,spd){for(let i=0;i<n;i++)particles.push({x:px,y:py,vx:(Math.random()-.5)*spd,vy:-Math.random()*spd*.8,life:1,col,size:2+Math.random()*3,grav:.15})}
function spawnObstacle(){
const types=[
{w:22,h:38,type:'cactus'},
{w:28,h:52,type:'cactus_big'},
{w:44,h:26,type:'rock'}
];
const t=types[Math.floor(Math.random()*types.length)];
obstacles.push({x:W+10,y:GROUND-t.h,w:t.w,h:t.h,type:t.type,passed:false});
}
function drawCloud(cl){
x.fillStyle='rgba(100,150,255,.25)';
x.beginPath();
x.ellipse(cl.x,cl.y,18*cl.s,9*cl.s,0,0,7);
x.ellipse(cl.x+14*cl.s,cl.y+3*cl.s,12*cl.s,7*cl
