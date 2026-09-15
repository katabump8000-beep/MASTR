// ============================================================
// dino.js
// ALJESAT BOT
// لعبة Dino Runner - HTML Canvas + سيرفر
// ============================================================

"use strict";

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

/**
 * بناء رابط السيرفر.
 * Railway يوفّر RAILWAY_PUBLIC_DOMAIN تلقائياً.
 */
function getServerUrl() {
    try {
        const settings = require("./settings");
        if (settings.dinoServerUrl && String(settings.dinoServerUrl).trim()) {
            return String(settings.dinoServerUrl).trim().replace(/\/$/, "");
        }
    } catch (_) {}

    // Railway
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    }

    // Render
    if (process.env.RENDER_EXTERNAL_URL) {
        return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
    }

    // Heroku
    if (process.env.HEROKU_APP_NAME) {
        return `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
    }

    // fallback: localhost (للتطوير فقط)
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
x.ellipse(cl.x+14*cl.s,cl.y+3*cl.s,12*cl.s,7*cl.s,0,0,7);
x.fill()
}
function drawObstacle(o){
x.save();
x.shadowColor='#ff5252';x.shadowBlur=8;
x.fillStyle='#ff5252';
if(o.type==='cactus'||o.type==='cactus_big'){
x.fillRect(o.x+o.w*.3,o.y,o.w*.4,o.h);
x.fillRect(o.x,o.y+o.h*.3,o.w*.3,o.h*.15);
x.fillRect(o.x+o.w*.7,o.y+o.h*.4,o.w*.3,o.h*.15);
}else{
x.beginPath();
x.moveTo(o.x,o.y+o.h);
x.lineTo(o.x+o.w*.3,o.y);
x.lineTo(o.x+o.w*.7,o.y);
x.lineTo(o.x+o.w,o.y+o.h);
x.closePath();x.fill();
}
x.restore()
}
function drawDino(){
const dx=dino.x,dy=dino.y;
x.save();
x.shadowColor='#00ff64';x.shadowBlur=10;
x.fillStyle='#00ff64';
x.fillRect(dx+15,dy,20,15);
x.fillStyle='#0a0e27';
x.fillRect(dx+28,dy+4,4,4);
x.fillStyle='#00ff64';
x.fillRect(dx+30,dy+12,8,3);
x.fillStyle='#00c853';
x.fillRect(dx+5,dy+12,25,18);
x.fillRect(dx-5,dy+15,15,8);
x.fillStyle='#00ff64';
const legOffset=dino.jumping?0:Math.sin(dino.legFrame)*3;
if(dino.jumping){
x.fillRect(dx+8,dy+30,8,8);
x.fillRect(dx+20,dy+30,8,5);
}else{
x.fillRect(dx+8,dy+30+legOffset,8,5-legOffset);
x.fillRect(dx+20,dy+30-legOffset,8,5+legOffset);
}
x.fillRect(dx+22,dy+18,8,4);
x.restore()
}
function drawGround(){
x.strokeStyle='#00ff64';x.lineWidth=2;
x.beginPath();x.moveTo(0,GROUND);x.lineTo(W,GROUND);x.stroke();
x.strokeStyle='rgba(0,255,100,.3)';x.lineWidth=1;
for(let i=0;i<12;i++){
const gx=(i*50+groundOffset)%(W+50)-25;
x.beginPath();x.moveTo(gx,GROUND+5);x.lineTo(gx+20,GROUND+5);x.stroke()
}
}
function drawParticles(){particles.forEach(p=>{x.fillStyle='rgba('+p.col+','+Math.max(p.life,0)+')';x.fillRect(p.x,p.y,p.size,p.size)})}
function draw(){
const g=x.createLinearGradient(0,0,0,H);
g.addColorStop(0,'#0a0e27');g.addColorStop(1,'#0d2818');
x.fillStyle=g;x.fillRect(0,0,W,H);
clouds.forEach(drawCloud);
x.save();
if(shake>0)x.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
obstacles.forEach(drawObstacle);
drawGround();
drawDino();
drawParticles();
x.restore();
if(!started&&!gameOver){
x.fillStyle='rgba(255,255,255,.9)';x.textAlign='center';
x.font='bold 14px Arial';x.fillText('دوس باش تبدا 🦖',W/2,H/2);
x.textAlign='left'
}
}
function update(){
frame++;
if(shake>0)shake=Math.max(0,shake-.6);
clouds.forEach(cl=>{cl.x-=cl.sp;if(cl.x<-30)cl.x=W+30});
if(started&&!gameOver&&!cashedOut){
dino.legFrame+=.3;
groundOffset-=speed;
if(dino.jumping){
dino.vy+=GRAV;
dino.y+=dino.vy;
if(dino.y>=GROUND-dino.h){dino.y=GROUND-dino.h;dino.vy=0;dino.jumping=false}
}
if(frame%Math.max(40,70-Math.floor(speed*3))===0)spawnObstacle();
speed=4+Math.min(8,score*.02);
for(let i=obstacles.length-1;i>=0;i--){
const o=obstacles[i];
o.x-=speed;
if(!o.passed&&o.x+o.w<dino.x){o.passed=true;score+=10;
scoreEl.style.transform='scale(1.3)';
setTimeout(()=>scoreEl.style.transform='scale(1)',120)
}
if(dino.x+dino.w>o.x&&dino.x<o.x+o.w&&dino.y+dino.h>o.y&&dino.y<o.y+o.h){
if(!gameOver){gameOver=true;shake=14;burst(dino.x+dino.w/2,dino.y+dino.h/2,20,'255,82,82',6)}
}
if(o.x+o.w<0)obstacles.splice(i,1)
}
}
particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=p.grav;p.life-=.025});
particles=particles.filter(p=>p.life>0);
scoreEl.textContent=Math.floor(score);
if(score>best){best=Math.floor(score);saveBest(best)}
bestEl.textContent='BEST '+best;
if(gameOver){
statusEl.textContent='خسرت!';
overlayTitle.textContent='💀 GAME OVER';
overlayTitle.style.color='#ff5252';
overlayMsg.textContent='النقاط: '+Math.floor(score)+' | اضغط ⬆️ اقفز لإعادة اللعب';
overlay.classList.add('show');
}else{
statusEl.textContent=started?'النقاط '+Math.floor(score):'دوس على الشاشة باش تقفز';
}
}
function loop(){update();draw();requestAnimationFrame(loop)}
function pointerDown(e){e.preventDefault();jump()}
c.addEventListener('touchstart',pointerDown,{passive:false});
c.addEventListener('mousedown',pointerDown);
jumpBtn.addEventListener('click',e=>{e.preventDefault();jump()});
jumpBtn.addEventListener('touchstart',e=>{e.preventDefault();jump()},{passive:false});
document.addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='ArrowUp'){e.preventDefault();jump()}});

// ============================================================
// زر السحب — يُرسل النقاط للسيرفر
// ============================================================
cashBtn.addEventListener('click',async(e)=>{
e.preventDefault();
if(cashedOut)return;
if(gameOver){overlayTitle.textContent='⚠️ خسرت';overlayMsg.textContent='لا يمكن السحب بعد الخسارة. اضغط اقفز لإعادة اللعب';return}
if(score<POINTS_PER_DOLLAR){overlayTitle.textContent='⚠️ نقاط غير كافية';overlayMsg.textContent='تحتاج على الأقل '+POINTS_PER_DOLLAR+' نقطة للسحب';overlay.classList.add('show');setTimeout(()=>overlay.classList.remove('show'),2500);return}
cashedOut=true;
cashBtn.disabled=true;
jumpBtn.disabled=true;

const rawScore=Math.floor(score);
const earn=Math.min(Math.floor(rawScore/POINTS_PER_DOLLAR),MAX_EARN);

overlayTitle.textContent='⏳ جار السحب...';
overlayTitle.style.color='#ffd700';
overlayMsg.textContent='النقاط: '+rawScore+' | الربح: '+earn+'$';
overlay.classList.add('show');

try{
const res=await fetch(SERVER_URL+'/api/dino/cashout',{
method:'POST',
headers:{'Content-Type':'application/json'},
body:JSON.stringify({
playerNumber:PLAYER_NUMBER,
chatId:CHAT_ID,
gameId:GAME_ID,
token:TOKEN,
score:rawScore
})
});
const data=await res.json();
if(res.ok&&data.ok){
overlayTitle.textContent='✅ تم السحب!';
overlayTitle.style.color='#00ff64';
overlayMsg.textContent='النقاط: '+data.score+' | الربح: '+data.earn+'$';
} else {
overlayTitle.textContent='❌ فشل السحب';
overlayTitle.style.color='#ff5252';
overlayMsg.textContent='خطأ: '+(data.error||'unknown');
cashBtn.disabled=false;
cashedOut=false;
}
}catch(err){
overlayTitle.textContent='❌ فشل الاتصال';
overlayTitle.style.color='#ff5252';
overlayMsg.textContent='تحقق من اتصالك وحاول مرة أخرى';
cashBtn.disabled=false;
cashedOut=false;
}
});

reset();
requestAnimationFrame(loop);
})();
</script>
</body>
</html>`;
}

// ============================================================
// إرسال الإعلان
// ============================================================

async function sendDinoAd(sock, db, playerNumber, score, earn) {
    if (!db.adsGroups || typeof db.adsGroups !== "object") return;

    const now = new Date();
    const winnerNickname = getUserNickname(db, playerNumber);

    const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{Dino Runner - طائر}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${earn}$ }*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇📊 النقاط:
*{ ${score} }*

◇⏰ بّـــــــدأت:
*{${formatDate(now)}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

    for (const adJid of Object.keys(db.adsGroups)) {
        if (!db.adsGroups[adJid]) continue;
        await safeSend(sock, adJid, { text: adMessage });
    }
}

// ============================================================
// بدء لعبة Dino Runner
// ============================================================

async function handleDinoCommand(
    sock,
    jid,
    msg,
    db,
    saveDb,
    cleanSender,
    isBotOwner,
    sender
) {
    try {
        if (activeDino[jid]) {
            await safeSend(sock, jid, {
                text: "⚠️ هناك لعبة طائر قائمة بالفعل في هذه المجموعة!"
            }, { quoted: msg });
            return true;
        }

        db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
        const hasPermission = Boolean(isBotOwner) || db.gamePermissions.includes(cleanSender);

        if (!hasPermission) {
            await safeSend(sock, jid, {
                text: "⚠️ ليس لديك صلاحية لاستخدام هذا الأمر. يرجى التواصل مع المطور لمنحك الصلاحية."
            }, { quoted: msg });
            return true;
        }

        if (!hasNickname(db, cleanSender)) {
            await safeSend(sock, jid, {
                text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل لتتمكن من اللعب."
            }, { quoted: msg });
            return true;
        }

        const now = Date.now();
        db.gameCooldown = db.gameCooldown || {};
        const previousTime = Number(db.gameCooldown[jid]) || 0;

        if (previousTime > 0) {
            const elapsed = now - previousTime;
            if (elapsed < DINO_CONFIG.cooldownMs) {
                const remainingMin = Math.ceil((DINO_CONFIG.cooldownMs - elapsed) / 60000);
                await safeSend(sock, jid, {
                    text: `⏳ يرجى الانتظار ${remainingMin} دقائق قبل بدء لعبة جديدة.`
                }, { quoted: msg });
                return true;
            }
        }

        db.gameCooldown[jid] = now;
        if (typeof saveDb === "function") saveDb();

        const playerNickname = getUserNickname(db, cleanSender);

        // توليد gameId فريد
        const crypto = require("crypto");
        const gameId = crypto.randomBytes(12).toString("hex");

        // الحصول على التوكن ورابط السيرفر
        let token = "";
        let serverUrl = "";
        try {
            const { getServerSecret } = require("./server");
            token = getServerSecret();
        } catch (e) {
            console.error("❌ فشل الحصول على التوكن:", e?.message);
            await safeSend(sock, jid, {
                text: "❌ حدث خطأ في تشغيل اللعبة. حاول لاحقاً."
            }, { quoted: msg });
            return true;
        }
        serverUrl = getServerUrl();

        const gameState = {
            playerNumber: cleanSender,
            playerNickname: playerNickname,
            gameId: gameId,
            chatId: jid,
            startTime: new Date(),
            isActive: true,
            score: 0,
            earn: 0,
            cashedOut: false,
            timeoutId: null
        };

        activeDino[jid] = gameState;

        // إرسال HTML عبر AIRich
        try {
            const { AIRich } = require("./MessageBuilder");

            const html = generateDinoHTML(
                playerNickname,
                cleanSender,
                jid,
                gameId,
                token,
                serverUrl
            );

            const item = {
                __typename: "GenAIaeacdsnwHtmlPrimitive",
                payload: html,
                trusted_sources: ["nixel.dev"]
            };

            await new AIRich(sock)
                .addSection(AIRich.newLayout('Single', item))
                .send(jid, { bypassDownload: false });

        } catch (airichError) {
            console.error("❌ خطأ في AIRich:", airichError?.message || airichError);
            await safeSend(sock, jid, {
                text: `╗══════════════════════╔
  🦖 *لعبة Dino Runner* 🦖
  
  مرحباً ${playerNickname}!
  
  ⚠️ حدث خطأ في تحميل اللعبة التفاعلية.
  يرجى المحاولة مرة أخرى لاحقاً.
╝══════════════════════╚`
            }, { quoted: msg });
            delete activeDino[jid];
            return true;
        }

        gameState.timeoutId = setTimeout(async () => {
            if (activeDino[jid] && activeDino[jid].isActive && !activeDino[jid].cashedOut) {
                delete activeDino[jid];
                await safeSend(sock, jid, {
                    text: "⏰ انتهى وقت اللعبة تلقائياً بدون سحب."
                }).catch(() => {});
            }
        }, DINO_CONFIG.gameTimeoutMs);

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleDinoCommand:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة زر السحب أو إلغاء اللعبة
// ============================================================

async function handleDinoCashout(sock, jid, db, saveDb, cleanSender, msg) {
    const gameState = activeDino[jid];
    if (!gameState || !gameState.isActive) {
        await safeSend(sock, jid, {
            text: "⚠️ لا توجد لعبة طائر نشطة حالياً."
        }, { quoted: msg });
        return true;
    }

    if (gameState.playerNumber !== cleanSender) {
        await safeSend(sock, jid, {
            text: "⚠️ هذه اللعبة ليست لك."
        }, { quoted: msg });
        return true;
    }

    await safeSend(sock, jid, {
        text: `💸 *للسحب، اضغط على زر 💸 داخل اللعبة.*\n\nإذا لم يظهر الزر، يمكنك استخدام:\n\`.سحب_طائر\``
    }, { quoted: msg });

    return true;
}

async function handleDinoScore(sock, jid, db, saveDb, cleanSender, score, msg) {
    // لم نعد نستخدم هذا - السيرفر يعالج كل شيء
    return false;
}

async function handleDinoCancel(sock, jid, db, saveDb, cleanSender, msg) {
    const gameState = activeDino[jid];
    if (!gameState || !gameState.isActive) {
        await safeSend(sock, jid, {
            text: "⚠️ لا توجد لعبة طائر نشطة حالياً."
        }, { quoted: msg });
        return true;
    }

    if (gameState.playerNumber !== cleanSender) {
        await safeSend(sock, jid, {
            text: "⚠️ هذه اللعبة ليست لك."
        }, { quoted: msg });
        return true;
    }

    if (gameState.timeoutId) clearTimeout(gameState.timeoutId);
    delete activeDino[jid];

    await safeSend(sock, jid, {
        text: "🚫 تم إلغاء لعبة الطائر بنجاح."
    }, { quoted: msg });

    return true;
}

// ============================================================
// إيقاف اللعبة
// ============================================================

function stopDinoGame(jid) {
    const game = activeDino[jid];
    if (game) {
        game.isActive = false;
        if (game.timeoutId) clearTimeout(game.timeoutId);
        delete activeDino[jid];
        return true;
    }
    return false;
}

function checkDinoActive(jid) {
    return Boolean(activeDino[jid] && activeDino[jid].isActive);
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    activeDino,
    handleDinoCommand,
    handleDinoCashout,
    handleDinoScore,
    handleDinoCancel,
    stopDinoGame,
    checkDinoActive,
    sendDinoAd,
    DINO_CONFIG,
    generateDinoHTML
};