// ============================================================
// dino.js
// ALJESAT BOT
// لعبة الطائر - Dino Runner
// المطور: الجيسي
// ============================================================

"use strict";

const activeDinoGames = Object.create(null);

const DINO_COOLDOWN = 5 * 60 * 1000;
const MAX_EARN = 1000;
const SCORE_PER_COIN = 100;

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

// ============================================================
// HTML - واجهة اللعبة
// ============================================================

function buildDinoHTML() {
    return `<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
body{background:transparent;font-family:'Segoe UI',Roboto,sans-serif;color:#e2e8f0;touch-action:manipulation;overflow:hidden}
.wrap{width:100%;max-width:640px;margin:auto;padding:8px}
.game{border-radius:20px;padding:3px;background:linear-gradient(135deg,#0f766e,#064e3b,#1e3a8a,#0c4a6e);box-shadow:0 10px 40px rgba(16,185,129,.35),0 4px 12px rgba(0,0,0,.5)}
.card{position:relative;background:#0a1628;border-radius:17px;overflow:hidden}
canvas{display:block;width:100%;height:auto;background:#0a1628;touch-action:none}
.top-bar{position:absolute;top:10px;left:14px;right:14px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none;z-index:5;text-shadow:0 2px 6px rgba(0,0,0,.9)}
.title{font-size:9px;letter-spacing:2px;color:#5eead4;font-weight:600}
.name{font-size:15px;font-weight:800;color:#fff;margin-top:2px}
.score-box{text-align:right}
.score{font-size:20px;font-weight:900;color:#34d399;text-shadow:0 0 14px rgba(52,211,153,.6);transition:transform .15s}
.best{font-size:10px;color:#94a3b8;margin-top:2px}
.earn-box{display:inline-block;margin-top:4px;background:rgba(16,185,129,.15);border:1px solid rgba(52,211,153,.3);border-radius:8px;padding:3px 8px;font-size:11px;font-weight:700;color:#6ee7b7}
.status{position:absolute;bottom:60px;left:0;right:0;text-align:center;font-size:11px;color:#a7f3d0;pointer-events:none;text-shadow:0 2px 6px rgba(0,0,0,.9);z-index:5}
.ctrl{position:absolute;bottom:12px;left:0;right:0;display:flex;justify-content:center;gap:10px;z-index:6;padding:0 12px}
.btn{border:none;color:#fff;font-size:14px;font-weight:800;padding:11px 28px;border-radius:30px;cursor:pointer;letter-spacing:1px;transition:all .12s;text-shadow:0 1px 3px rgba(0,0,0,.4);touch-action:manipulation;flex:1;max-width:180px}
.jump-btn{background:linear-gradient(135deg,#059669,#047857);box-shadow:0 6px 20px rgba(5,150,105,.6),inset 0 1px 0 rgba(255,255,255,.15)}
.jump-btn:active{transform:scale(.93);box-shadow:0 3px 12px rgba(5,150,105,.4)}
.withdraw-btn{background:linear-gradient(135deg,#b91c1c,#7f1d1d);box-shadow:0 6px 20px rgba(185,28,28,.6),inset 0 1px 0 rgba(255,255,255,.15)}
.withdraw-btn:active{transform:scale(.93);box-shadow:0 3px 12px rgba(185,28,28,.4)}
.footer{text-align:center;margin-top:8px;font-size:10px;color:rgba(148,163,184,.7);letter-spacing:1.5px;font-weight:300}
.footer .dev{color:rgba(94,234,212,.85);font-weight:500}
</style>
<div class="wrap">
<div class="game">
<div class="card">
<canvas id="game" width="480" height="320"></canvas>
<div class="top-bar">
<div>
<div class="title">🦖 ALJESAT ARCADE</div>
<div class="name">DINO RUNNER</div>
</div>
<div class="score-box">
<div class="score" id="score">0</div>
<div class="best" id="best">BEST 0</div>
<div class="earn-box">💰 المربح: <span id="earn">0</span>$</div>
</div>
</div>
<div class="status" id="status">دوس اقفز باش تبدا</div>
<div class="ctrl">
<button class="btn jump-btn" id="jumpBtn">⬆️ اقفز</button>
<button class="btn withdraw-btn" id="withdrawBtn">💸 سحب</button>
</div>
</div>
</div>
<div class="footer">المطور: <span class="dev">الجيسي</span></div>
</div>
<script>
(function(){
const c=document.getElementById('game'),x=c.getContext('2d');
const scoreEl=document.getElementById('score'),bestEl=document.getElementById('best'),
      earnEl=document.getElementById('earn'),statusEl=document.getElementById('status'),
      jumpBtn=document.getElementById('jumpBtn'),withdrawBtn=document.getElementById('withdrawBtn');
const W=c.width,H=c.height;
const GROUND_Y=H-50;
const MAX_EARN=1000;
const SCORE_PER_COIN=100;

function loadBest(){let v=0;try{v=parseInt(localStorage.getItem('dino_best')||'0',10)}catch(e){};return isNaN(v)?0:v}
function saveBest(v){try{localStorage.setItem('dino_best',String(Math.floor(v)))}catch(e){}}
let best=loadBest();
bestEl.textContent='BEST '+best;

let dino,obstacles,particles,clouds,distance,gameOver,started,spawnTimer,runT,shake,legPhase,speed,earn,score,finalized;

function reset(){
  dino={x:80,y:GROUND_Y,vy:0,grounded:true};
  obstacles=[];particles=[];clouds=[];
  distance=0;gameOver=false;started=false;spawnTimer=60;runT=0;shake=0;legPhase=0;speed=3.5;earn=0;score=0;finalized=false;
  for(let i=0;i<4;i++)clouds.push({x:Math.random()*W,y:20+Math.random()*60,s:.5+Math.random()*.8,sp:.2+Math.random()*.2});
  scoreEl.textContent='0';earnEl.textContent='0';
  statusEl.textContent='دوس اقفز باش تبدا';
}
function burst(px,py,n,col,spd){for(let i=0;i<n;i++)particles.push({x:px,y:py,vx:(Math.random()-.5)*spd,vy:-Math.random()*spd*.8,life:1,col,size:2+Math.random()*3,grav:.2})}
function spawnObstacle(){const h=22+Math.random()*28;const w=14+Math.random()*12;obstacles.push({x:W+20,y:GROUND_Y-h,w,h})}

function drawClouds(){
  x.fillStyle='rgba(148,163,184,.15)';
  clouds.forEach(cl=>{x.beginPath();x.ellipse(cl.x,cl.y,20*cl.s,10*cl.s,0,0,7);x.ellipse(cl.x+16*cl.s,cl.y+3*cl.s,14*cl.s,8*cl.s,0,0,7);x.fill()});
}
function drawGround(){
  x.fillStyle='#0d2818';x.fillRect(0,GROUND_Y,W,H-GROUND_Y);
  x.fillStyle='rgba(52,211,153,.15)';
  const off=Math.floor(runT*speed)%40;
  for(let gx=-off;gx<W;gx+=40)x.fillRect(gx,GROUND_Y+4,20,2);
  x.fillStyle='#10b981';x.fillRect(0,GROUND_Y,W,2);
}
function drawDino(){
  x.save();x.translate(dino.x,dino.y);
  const bob=dino.grounded?Math.sin(legPhase)*1.2:0;
  x.fillStyle='#059669';
  x.beginPath();x.roundRect(-15,-32+bob,26,32,6);x.fill();
  x.beginPath();x.roundRect(3,-50+bob,22,20,5);x.fill();
  x.fillStyle='#fff';x.beginPath();x.arc(17,-43+bob,3,0,7);x.fill();
  x.fillStyle='#0a1628';x.beginPath();x.arc(17,-43+bob,1.5,0,7);x.fill();
  x.fillStyle='#064e3b';x.fillRect(15,-35+bob,9,2);
  x.fillStyle='#047857';
  x.beginPath();x.moveTo(-15,-28+bob);x.lineTo(-22,-32+bob);x.lineTo(-15,-22+bob);x.fill();
  x.beginPath();x.moveTo(-15,-20+bob);x.lineTo(-20,-22+bob);x.lineTo(-15,-16+bob);x.fill();
  x.fillStyle='#047857';
  if(dino.grounded){const lp=Math.sin(legPhase)*5;x.fillRect(-11,0,6,7+lp);x.fillRect(3,0,6,7-lp)}
  else{x.fillRect(-11,0,6,4);x.fillRect(3,0,6,4)}
  x.fillStyle='#059669';
  x.beginPath();x.moveTo(-15,-20+bob);x.lineTo(-28,-25+bob);x.lineTo(-15,-12+bob);x.fill();
  x.restore();
}
function drawObstacle(o){
  x.fillStyle='#065f46';
  x.fillRect(o.x+o.w/2-3,o.y,6,o.h);
  x.fillRect(o.x,o.y+o.h*.3,3,4);
  x.fillRect(o.x+o.w-3,o.y+o.h*.5,3,4);
  x.fillStyle='rgba(16,185,129,.4)';
  x.fillRect(o.x+o.w/2-2,o.y+2,2,o.h-4);
}
function drawParticles(){particles.forEach(p=>{x.fillStyle='rgba('+p.col+','+Math.max(p.life,0)+')';x.fillRect(p.x,p.y,p.size,p.size)})}
function draw(){
  const g=x.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#0a1628');g.addColorStop(.5,'#0f2942');g.addColorStop(1,'#134e4a');
  x.fillStyle=g;x.fillRect(0,0,W,H);
  drawClouds();
  x.save();
  if(shake>0)x.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
  drawGround();obstacles.forEach(drawObstacle);drawDino();drawParticles();
  x.restore();
  if(!started&&!gameOver){
    x.fillStyle='rgba(10,22,40,.7)';x.fillRect(0,0,W,H);
    x.fillStyle='#6ee7b7';x.textAlign='center';
    x.font='bold 18px Arial';x.fillText('🦖 DINO RUNNER',W/2,H/2-25);
    x.font='13px Arial';x.fillStyle='#94a3b8';x.fillText('دوس اقفز باش تبدا',W/2,H/2+5);
    x.font='11px Arial';x.fillStyle='#5eead4';x.fillText('كل 100 نقطة = 1$ | الحد الأقصى 1000$',W/2,H/2+30);
    x.textAlign='left';
  }
  if(gameOver){
    x.fillStyle='rgba(10,22,40,.85)';x.fillRect(0,0,W,H);
    x.textAlign='center';
    x.fillStyle='#ef4444';x.font='bold 22px Arial';x.fillText('GAME OVER',W/2,H/2-40);
    x.fillStyle='#f87171';x.font='13px Arial';x.fillText('النقاط: '+score,W/2,H/2-14);
    x.fillStyle='#34d399';x.font='bold 16px Arial';x.fillText('💰 ربحت: '+earn+'$',W/2,H/2+16);
    if(finalized){x.fillStyle='#a7f3d0';x.font='11px Arial';x.fillText('✅ تم إرسال النتيجة للبوت',W/2,H/2+42)}
    else{x.fillStyle='#94a3b8';x.font='11px Arial';x.fillText('⚠️ اضغط سحب لتحصيل رصيدك',W/2,H/2+42)}
    x.textAlign='left';
  }
}
function update(){
  runT++;
  if(shake>0)shake=Math.max(0,shake-.6);
  clouds.forEach(cl=>{cl.x-=cl.sp;if(cl.x<-30)cl.x=W+30});
  if(started&&!gameOver){
    speed=3.5+Math.min(4.5,distance*.002);
    distance+=speed;
    dino.vy+=.75;dino.y+=dino.vy;
    if(dino.y>=GROUND_Y){dino.y=GROUND_Y;dino.vy=0;dino.grounded=true;legPhase+=.42*speed*.3}
    else dino.grounded=false;
    spawnTimer--;
    if(spawnTimer<=0){spawnObstacle();spawnTimer=Math.max(50,95-Math.floor(distance*.02))}
    obstacles.forEach(o=>o.x-=speed);
    obstacles=obstacles.filter(o=>o.x>-40);
    const dx1=dino.x-13,dx2=dino.x+13,dy1=dino.y-32,dy2=dino.y;
    for(const o of obstacles){
      const hx=dx2>o.x&&dx1<o.x+o.w;
      const hy=dy2>o.y&&dy1<o.y+o.h;
      if(hx&&hy){
        gameOver=true;shake=14;
        burst(dino.x,dino.y-16,22,'16,185,129',6);
        score=Math.floor(distance/10);
        earn=Math.floor(score/SCORE_PER_COIN);
        if(earn>MAX_EARN)earn=MAX_EARN;
        scoreEl.textContent=score;earnEl.textContent=earn;
        if(score>best){best=score;saveBest(best);bestEl.textContent='BEST '+best}
        break;
      }
    }
    score=Math.floor(distance/10);
    const currentEarn=Math.floor(score/SCORE_PER_COIN);
    if(currentEarn>=MAX_EARN){
      gameOver=true;earn=MAX_EARN;earnEl.textContent=earn;scoreEl.textContent=score;
      statusEl.textContent='✅ وصلت الحد الأقصى! اضغط سحب';
      return;
    }
    scoreEl.textContent=score;earnEl.textContent=currentEarn;
    statusEl.textContent='السرعة: '+speed.toFixed(1)+'x | النقاط: '+score;
  }
  particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=p.grav;p.life-=.025});
  particles=particles.filter(p=>p.life>0);
}
function loop(){update();draw();requestAnimationFrame(loop)}

function jump(){
  if(gameOver)return;
  if(!started)started=true;
  if(dino.grounded){dino.vy=-12;dino.grounded=false}
}

function sendWithdraw(){
  if(!started){statusEl.textContent='⚠️ ابدأ اللعب أولاً';return}
  if(finalized){statusEl.textContent='✅ تم إرسال النتيجة بالفعل';return}

  score=Math.floor(distance/10);
  earn=Math.floor(score/SCORE_PER_COIN);
  if(earn>MAX_EARN)earn=MAX_EARN;
  scoreEl.textContent=score;earnEl.textContent=earn;
  finalized=true;
  gameOver=true;
  statusEl.textContent='✅ تم إرسال النتيجة للبوت';

  // نستخدم Web Share API لإرسال النتيجة للبوت
  const payload='dino_withdraw_SCORE_'+score+'_EARN_'+earn;
  try{
    if(navigator.share){
      navigator.share({title:'dino_result',text:payload}).catch(()=>{});
    } else {
      // fallback: نفتح واتساب
      try{window.location.href='whatsapp://send?text='+encodeURIComponent(payload)}catch(e){}
    }
  }catch(err){}
}

jumpBtn.addEventListener('click',e=>{e.preventDefault();jump()});
jumpBtn.addEventListener('touchstart',e=>{e.preventDefault();jump()},{passive:false});

withdrawBtn.addEventListener('click',e=>{e.preventDefault();sendWithdraw()});
withdrawBtn.addEventListener('touchstart',e=>{e.preventDefault();sendWithdraw()},{passive:false});

window.addEventListener('keydown',e=>{
  if(e.code==='Space'||e.code==='ArrowUp'){e.preventDefault();jump()}
});
reset();
requestAnimationFrame(loop);
})();
</script>`;
}

// ============================================================
// إرسال استمارة الانتهاء
// ============================================================

async function sendDinoEndForm(sock, db, jid, playerNumber, nickname, score, earn, startDate) {
    if (!db.adsGroups || typeof db.adsGroups !== "object") return;
    const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{الطائر - Dino Runner}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${earn}$ }*

◇🎖️ آلَفــــــآئــز:
*${nickname}*

◇📊 النقاط:
*{${score}}*

◇⏰ بّـــــــدأت:
*{${formatDate(startDate)}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;
    for (const adJid of Object.keys(db.adsGroups)) {
        if (!db.adsGroups[adJid]) continue;
        await safeSend(sock, adJid, { text: adMessage });
    }
}

// ============================================================
// بدء اللعبة
// ============================================================

async function handleDinoCommand(sock, jid, msg, db, saveDb, cleanSender, isBotOwner) {
    try {
        // الصلاحية
        db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
        const hasPermission = Boolean(isBotOwner) || db.gamePermissions.includes(cleanSender);
        if (!hasPermission) {
            await safeSend(sock, jid, { text: "⚠️ ليس لديك صلاحية لبدء اللعبة." }, { quoted: msg });
            return false;
        }
        // اللقب
        if (!hasNickname(db, cleanSender)) {
            await safeSend(sock, jid, { text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل." }, { quoted: msg });
            return false;
        }
        // لعبة نشطة
        if (activeDinoGames[jid]) {
            await safeSend(sock, jid, { text: "⚠️ هناك لعبة طائر نشطة بالفعل." }, { quoted: msg });
            return false;
        }
        // كولداون
        const now = Date.now();
        db.gameCooldown = db.gameCooldown && typeof db.gameCooldown === "object" ? db.gameCooldown : {};
        const previousTime = Number(db.gameCooldown[jid]) || 0;
        if (previousTime > 0 && (now - previousTime) < DINO_COOLDOWN) {
            const remainingMin = Math.ceil((DINO_COOLDOWN - (now - previousTime)) / 60000);
            await safeSend(sock, jid, { text: `⏳ يرجى الانتظار ${remainingMin} دقيقة قبل بدء لعبة جديدة.` }, { quoted: msg });
            return false;
        }
        db.gameCooldown[jid] = now;
        if (typeof saveDb === "function") saveDb();

        const nickname = getUserNickname(db, cleanSender);
        const startDate = new Date();

        activeDinoGames[jid] = {
            started: true,
            startedAt: startDate,
            sender: cleanSender,
            senderNickname: nickname,
            finalized: false,
            lastActivity: Date.now()
        };

        const html = buildDinoHTML();

        // إرسال الواجهة عبر AIRich
        if (typeof global.AIRich !== "function") {
            await safeSend(sock, jid, {
                text: "❌ AIRich غير متاح. تأكد من تحميل MessageBuilder.js"
            }, { quoted: msg });
            delete activeDinoGames[jid];
            return false;
        }

        try {
            const item = {
                __typename: "GenAIaeacdsnwHtmlPrimitive",
                payload: html,
                trusted_sources: ["aljesat.bot"]
            };

            await new global.AIRich(sock)
                .addSection(global.AIRich.newLayout('Single', item))
                .send(jid, { bypassDownload: false });

            console.log(`[DINO] ✅ تم إرسال اللعبة للاعب ${nickname}`);
        } catch (e) {
            console.error('[dino] AIRich error:', e.message);
            await safeSend(sock, jid, { text: `❌ خطأ في إرسال اللعبة: ${e.message}` }, { quoted: msg });
            delete activeDinoGames[jid];
            return false;
        }

        // تنظيف تلقائي بعد 15 دقيقة
        setTimeout(() => {
            if (activeDinoGames[jid] && !activeDinoGames[jid].finalized) {
                console.log(`[DINO] ⏰ انتهت مهلة اللعبة في ${jid}`);
                delete activeDinoGames[jid];
            }
        }, 15 * 60 * 1000);

        return true;
    } catch (e) {
        console.error("[dino.js] Error:", e);
        await safeSend(sock, jid, { text: "❌ خطأ: " + e.message }, { quoted: msg });
        delete activeDinoGames[jid];
        return false;
    }
}

// ============================================================
// استقبال النتيجة وتحديث الرصيد
// ============================================================

async function finalizeDino(sock, jid, db, saveDb, score, earn) {
    const state = activeDinoGames[jid];
    if (!state || state.finalized) {
        console.log(`[DINO] ⚠️ اللعبة غير نشطة أو انتهت مسبقاً في ${jid}`);
        return false;
    }

    state.finalized = true;

    if (earn < 0) earn = 0;
    if (earn > MAX_EARN) earn = MAX_EARN;

    const playerNumber = state.sender;
    const nickname = state.senderNickname || getUserNickname(db, playerNumber);

    db.users = db.users || {};
    if (!db.users[playerNumber]) {
        db.users[playerNumber] = { balance: 0, nickname: nickname, rank: "", maxInteraction: 0, friend: "" };
    }
    db.users[playerNumber].balance = Number(db.users[playerNumber].balance || 0) + earn;
    if (typeof saveDb === "function") saveDb();

    await safeSend(sock, jid, {
        text: `🎉 *مبروك لقد ربحت: ${earn}$*\n\n👤 اللاعب: *${nickname}*\n📊 النقاط: *${score}*\n💰 الجائزة: *${earn}$*\n\n_تم إضافة المبلغ إلى رصيدك ✅_`,
        mentions: [`${playerNumber}@s.whatsapp.net`]
    });

    await sendDinoEndForm(sock, db, jid, playerNumber, nickname, score, earn, state.startedAt);

    delete activeDinoGames[jid];
    console.log(`[DINO] ✅ تم إنهاء اللعبة. ربح: ${earn}$`);
    return true;
}

// ============================================================
// استقبال النتيجة من الزر
// ============================================================

function receiveDinoResult(jid, score, earn) {
    if (!global.__dinoResults) global.__dinoResults = {};
    global.__dinoResults[jid] = { score: Number(score) || 0, earn: Number(earn) || 0, timestamp: Date.now() };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    activeDinoGames,
    handleDinoCommand,
    finalizeDino,
    receiveDinoResult,
    buildDinoHTML,
    DINO_COOLDOWN,
    MAX_EARN,
    SCORE_PER_COIN
};