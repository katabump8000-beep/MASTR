// ============================================================
// mzad.js
// ALJESAT BOT
// نظام المزاد - بيع وشراء القطع الأثرية (معدل)
// ============================================================

"use strict";

// ============================================================
// قائمة القطع الأثرية مع الإيموجي والشرح
// ============================================================

const MAZAD_ITEMS = [
    { emoji: "🏺", name: "أمفورة رومانية", description: "يُقال إنها تعود إلى العصر الروماني، وكانت تُستخدم لحفظ الزيت والنبيذ، ويُعتقد أن نقشها صُنع على يد خزّاف مجهول." },
    { emoji: "⚱️", name: "جرة فخارية قديمة", description: "قطعة عُثر عليها في أنقاض مستوطنة قديمة، وكانت تُستخدم لحفظ الحبوب والأعشاب، ويُعتقد أنها صنعت قبل أكثر من ألف عام." },
    { emoji: "🗿", name: "تمثال حجري", description: "تمثال لشخصية مجهولة، نُحت من حجر صلب على يد نحات لم يُعرف اسمه حتى اليوم." },
    { emoji: "🪨", name: "حجر منقوش", description: "قطعة حجرية تحمل رموزًا قديمة، ويُعتقد أنها كانت تستخدم لتوثيق حدث مهم في إحدى المدن القديمة." },
    { emoji: "📜", name: "مخطوطة قديمة", description: "لفافة تحتوي على كتابات باهتة، ويُقال إنها كانت محفوظة داخل مكتبة أحد الحكام." },
    { emoji: "📖", name: "كتاب جلدي قديم", description: "كتاب مغلف بالجلد، يُقال إنه كان ملكًا لكاتب رحّال جمع فيه أسرار وأساطير عصره." },
    { emoji: "🧿", name: "تميمة أثرية", description: "تميمة صغيرة كان يُعتقد قديمًا أنها رمز للحماية، وصُنعت من حجر أزرق مصقول." },
    { emoji: "🔱", name: "رمح ثلاثي قديم", description: "رمز حربي قديم يُقال إنه كان يحمل في احتفالات الملوك والمحاربين." },
    { emoji: "🗝️", name: "مفتاح أثري", description: "مفتاح حديدي ضخم يُقال إنه كان يفتح باب غرفة سرية داخل قصر قديم." },
    { emoji: "🔒", name: "قفل حديدي قديم", description: "قفل مصنوع يدويًا، ويُعتقد أنه كان يحمي صندوقًا ملكيًا مليئًا بالمقتنيات الثمينة." },
    { emoji: "⚔️", name: "سيف أثري", description: "سيف لمحارب مجهول، يحمل على مقبضه نقشًا يرمز إلى الشجاعة والانتصار." },
    { emoji: "🗡️", name: "خنجر قديم", description: "خنجر قصير مزخرف، يُقال إنه كان جزءًا من معدات أحد قادة الحرس الملكي." },
    { emoji: "🛡️", name: "درع أثري", description: "درع حربي عليه آثار استخدام قديمة، ويُعتقد أنه كان يعود إلى أحد فرسان المملكة." },
    { emoji: "🏹", name: "قوس قديم", description: "قوس مصنوع من الخشب المقوى، ويُقال إنه كان يستخدمه أحد صيادي القصر." },
    { emoji: "🪓", name: "فأس قديم", description: "أداة حديدية قديمة كانت تستخدم في الحروب والعمل، ويظهر عليها أثر الزمن بوضوح." },
    { emoji: "🔔", name: "جرس أثري", description: "جرس نحاسي قديم يُقال إنه كان معلقًا عند بوابة مدينة قديمة." },
    { emoji: "🕯️", name: "شمعدان قديم", description: "قطعة نحاسية كانت تستخدم لإضاءة قاعات أحد القصور في العصور القديمة." },
    { emoji: "⏳", name: "ساعة رملية أثرية", description: "أداة قديمة لقياس الوقت، مصنوعة من الزجاج والرمل الناعم." },
    { emoji: "🕰️", name: "ساعة جيب قديمة", description: "ساعة صغيرة مزخرفة يُقال إنها كانت ملكًا لتاجر ثري كثير السفر." },
    { emoji: "🧭", name: "بوصلة أثرية", description: "أداة ملاحة قديمة، ويُقال إنها ساعدت أحد الرحالة في عبور أراضٍ مجهولة." },
    { emoji: "🔭", name: "منظار قديم", description: "أداة استكشاف بدائية كان يستخدمها الرحالة لمراقبة المناطق البعيدة." },
    { emoji: "⚖️", name: "ميزان نحاسي قديم", description: "ميزان كان يستخدمه التجار لوزن العملات والمعادن والبضائع الثمينة." },
    { emoji: "🪙", name: "عملة فضية أثرية", description: "قطعة فضية صغيرة تحمل رموزًا قديمة، ويُعتقد أنها كانت من عملة إحدى الممالك القديمة." },
    { emoji: "💍", name: "خاتم أثري", description: "خاتم معدني يحمل حجرًا صغيرًا، ويُقال إنه كان خاتم ختم لأحد النبلاء." },
    { emoji: "👑", name: "تاج أثري", description: "تاج ملكي قديم مزين بأحجار صغيرة، ويُعتقد أنه كان رمزًا لسلطة أحد الحكام." },
    { emoji: "💎", name: "جوهرة قديمة", description: "حجر كريم مصقول بعناية، ويُقال إنه كان جزءًا من تاج ملكي مفقود." },
    { emoji: "🔮", name: "كرة بلورية قديمة", description: "قطعة غامضة استخدمت في الطقوس والأساطير القديمة، ولم يُعرف الغرض الحقيقي منها." },
    { emoji: "🪞", name: "مرآة أثرية", description: "مرآة معدنية قديمة ذات إطار مزخرف، ويُقال إنها كانت داخل غرفة أحد القصور." },
    { emoji: "🪶", name: "ريشة كتابة قديمة", description: "ريشة كان يستخدمها الكتبة لكتابة الوثائق والرسائل المهمة." },
    { emoji: "✒️", name: "قلم حبر أثري", description: "قلم قديم كان يُستخدم لتسجيل المعاهدات والوثائق الرسمية." },
    { emoji: "🖋️", name: "قلم ملكي قديم", description: "قلم مزخرف يُقال إنه كان مخصصًا لكاتب البلاط الملكي." },
    { emoji: "🧰", name: "صندوق أثري", description: "صندوق خشبي صغير مزود بأجزاء معدنية، ويُعتقد أنه كان لحفظ أدوات ثمينة." },
    { emoji: "📦", name: "صندوق خشبي قديم", description: "صندوق مجهول المحتوى عُثر عليه في مخزن قديم، وما بداخله لا يزال لغزًا." },
    { emoji: "🗃️", name: "صندوق وثائق قديم", description: "صندوق كان يُستخدم لحفظ الأوراق والرسائل والوثائق المهمة." },
    { emoji: "🧳", name: "حقيبة جلدية عتيقة", description: "حقيبة سفر قديمة يُقال إنها كانت تخص تاجرًا كثير الترحال." },
    { emoji: "🪵", name: "لوح خشبي منقوش", description: "لوح يحمل رموزًا غير مكتملة، ويُعتقد أنه كان جزءًا من باب قديم." },
    { emoji: "🪧", name: "لوحة حجرية", description: "قطعة حجرية تحمل كتابة قديمة، ويُقال إنها كانت معلقة عند مدخل مدينة." },
    { emoji: "🏛️", name: "قطعة من معبد قديم", description: "قطعة حجرية مزخرفة يُقال إنها كانت جزءًا من أحد أعمدة معبد قديم." },
    { emoji: "🧱", name: "حجر بناء أثري", description: "حجر منحوت بعناية، ويُعتقد أنه كان جزءًا من بناء ملكي قديم." },
    { emoji: "☀️", name: "قرص شمسي أثري", description: "قطعة دائرية تحمل رمز الشمس، ويُعتقد أنها كانت تستخدم كرمز ديني قديم." },
    { emoji: "🌙", name: "هلال أثري", description: "زينة معدنية على شكل هلال، ويُقال إنها كانت جزءًا من تاج أو بوابة قديمة." },
    { emoji: "🦅", name: "تمثال نسر أثري", description: "تمثال صغير لنسر، وكان يُعتقد أنه رمز للقوة والحراسة." },
    { emoji: "🦁", name: "تمثال أسد حجري", description: "أسد منحوت من الحجر، ويُقال إنه كان يحرس مدخل قصر قديم." },
    { emoji: "🐍", name: "تمثال أفعى أثري", description: "تمثال صغير على شكل أفعى، ارتبط في الأساطير القديمة بالحماية والحكمة." },
    { emoji: "🐉", name: "تمثال تنين قديم", description: "قطعة أسطورية منحوتة، ويُقال إنها كانت رمزًا للقوة في حضارة مجهولة." },
    { emoji: "🦂", name: "تميمة عقرب", description: "تميمة صغيرة على شكل عقرب، كانت تُرتدى كرمز للحماية." },
    { emoji: "👁️", name: "عين أثرية", description: "رمز حجري على شكل عين، ارتبط قديمًا بالحماية والمراقبة." },
    { emoji: "💀", name: "قناع عظمي أثري", description: "قناع احتفالي قديم، ويُقال إنه كان يستخدم في طقوس غامضة." },
    { emoji: "🎭", name: "قناع مسرحي قديم", description: "قناع مزخرف يُعتقد أنه كان يستخدم في عروض مسرحية قديمة." },
    { emoji: "👺", name: "قناع حجري", description: "قناع منحوت من الحجر، وربما كان جزءًا من احتفال أو طقس قديم." },
    { emoji: "🪬", name: "تعويذة قديمة", description: "قطعة صغيرة تحمل رموزًا غامضة، وكان أصحابها يعتقدون أنها تحمي حاملها." },
    { emoji: "🏅", name: "وسام أثري", description: "وسام قديم يُقال إنه كان يُمنح للمحاربين الذين يحققون إنجازات كبيرة." },
    { emoji: "🎖️", name: "وسام حربي قديم", description: "قطعة معدنية كانت تُمنح تقديرًا للخدمة والشجاعة في الحروب القديمة." },
    { emoji: "📯", name: "بوق ملكي", description: "آلة نحاسية يُقال إنها كانت تستخدم للإعلان عن وصول الملك." },
    { emoji: "🎺", name: "بوق نحاسي قديم", description: "بوق احتفالي قديم كان يُستخدم في المناسبات الملكية." },
    { emoji: "🥁", name: "طبلة أثرية", description: "آلة موسيقية قديمة كانت تستخدم في الاحتفالات والمواكب." },
    { emoji: "🎻", name: "آلة موسيقية قديمة", description: "آلة وترية عتيقة يُقال إنها كانت تعزف في قصور النبلاء." },
    { emoji: "🧵", name: "نسيج أثري", description: "قطعة قماش قديمة تحمل نقوشًا يدوية، ويُعتقد أنها كانت جزءًا من لباس ملكي." },
    { emoji: "🧺", name: "سلة أثرية", description: "سلة منسوجة يدويًا كانت تستخدم لحفظ الطعام والأعشاب." },
    { emoji: "🪢", name: "حبل قديم", description: "حبل مصنوع من ألياف طبيعية، ويُقال إنه كان يستخدم في السفن والمخازن القديمة." },
    { emoji: "🧴", name: "قارورة زجاجية أثرية", description: "قارورة صغيرة كانت تستخدم لحفظ العطور والزيوت النادرة." },
    { emoji: "🧪", name: "قارورة كيميائية قديمة", description: "وعاء زجاجي من مختبر قديم، ويُقال إنه كان يستخدم لحفظ مواد مجهولة." },
    { emoji: "⚗️", name: "أداة كيميائية أثرية", description: "أداة غريبة عُثر عليها في غرفة تجارب قديمة، ولم يُعرف استخدامها بدقة." },
    { emoji: "🍶", name: "إبريق خزفي قديم", description: "إبريق مزخرف كان يستخدم لتقديم السوائل في الولائم القديمة." },
    { emoji: "🥣", name: "وعاء حجري أثري", description: "وعاء منحوت من الحجر، ويُعتقد أنه كان يستخدم في إعداد الطعام." },
    { emoji: "🍷", name: "كأس ملكي قديم", description: "كأس مزخرف يُقال إنه كان يستخدم في الولائم داخل القصر." },
    { emoji: "🥄", name: "ملعقة فضية أثرية", description: "قطعة فضية قديمة تحمل زخارف دقيقة على مقبضها." },
    { emoji: "🔪", name: "سكين أثري", description: "أداة قديمة ذات مقبض مزخرف، ويُعتقد أنها كانت من أدوات مطبخ قصر قديم." },
    { emoji: "🔐", name: "صندوق كنز أثري", description: "صندوق حديدي قديم يُقال إنه كان يخفي مقتنيات ثمينة لأحد التجار." },
    { emoji: "💰", name: "كيس نقود قديم", description: "كيس جلدي عُثر عليه وبداخله عدد من العملات القديمة." },
    { emoji: "🗺️", name: "خريطة كنز قديمة", description: "خريطة ممزقة تحمل علامات غامضة، ويُقال إنها تقود إلى كنز مفقود." },
    { emoji: "✉️", name: "خطاب ملكي قديم", description: "رسالة مختومة يُقال إنها كانت موجهة إلى أحد قادة المملكة." },
    { emoji: "🔴", name: "ختم شمعي ملكي", description: "ختم شمعي يحمل رمزًا ملكيًا، وكان يستخدم لإثبات أصالة الرسائل." },
    { emoji: "🏰", name: "قلعة قديمة", description: "قلعة أثرية شامخة يعود تاريخها إلى عصور قديمة، وكانت تضم حامية من الجنود وحكام الإقليم." }
];

// ============================================================
// الحالة النشطة للمزاد
// ============================================================

const activeMazads = Object.create(null);

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
    return user && String(user.nickname || "").trim() || "مجهول";
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function getRandomMazadItem() {
    const shuffled = shuffleArray([...MAZAD_ITEMS]);
    return shuffled[0];
}

// ============================================================
// رسائل المزاد
// ============================================================

function getMazadStartMessage(item) {
    return `╗──🎤── *مزاد اليوم:* ──🎤──╔
  قطعة اليوم:   *█☜ ${item.emoji} ☞█*
  *تفاصيل:* \`${item.name}\`
${item.description}
╝─────────⚖️─────────╚`;
}

function getMazadInstructions() {
    return `*🎤▬▬▬▬▬▬▬▬▬▬▬▬🎤*
  ارسل سعرك عبر امر: 
  .ادفع عدد
  مثلا:  *.ادفع 500*
  المزاد يبقى نشطا 30د دقيقة
  وعندما ينتهي الوقت سأعطي القطعة لمن *كتب اعلا سعر*
  بعد الحصول على اي قطعة يمكنك تفقد مخزونك عبر امر: 
  *.مخزوني*
  وبعدها مباشر سترى ماذا 
  تملك في جيبك ويمكنك ان تبيع القطع بالمتجر عندما يطلبونها بأسعار معينة ويمكن ان يحالفك الحظ وتكسب مالاً يعادل حجم 
  الذي وضعته
*🎤▬▬▬▬▬▬▬▬▬▬▬▬🎤*`;
}

function getMazadWinner(user, item, amount) {
    return `◆━─━─━─⊱${item.emoji}⊰─━─━─━◆

◆━─━─━─⊱👑⊰─━─━─━◆
 العضو @${user} قد كسر جميع
ارقام المزاد وقد حصل على: 
اللذي دفعه:  \`{${amount}}\`
\`${item.name}\`
\`${item.description}\`
◆━─━─━─⊱👑⊰─━─━─━◆`;
}

function getMazadCancelled() {
    return `╗───────⛓️‍💥────────╔
  اوبس!  تم الغاء المزاد بسبب عدم 
  *النشاط* وعدم المشاركة فيه. ⚠️
╝───────⛓️‍💥────────╚`;
}

function getMazadTooMuch() {
    return `╗══════🙂══════╔
  *تبا للفقراء الذين يحلمون*
  *بأنهم يملكون اموالا كثيرى*
╝══════🥲══════╚`;
}

function getInventoryMessage(items, nickname) {
    if (!items || items.length === 0) {
        return `📤◆⫘⫘⫘⫘⫘⫘⫘⫘📥
  مخزونك او حقيبتك فارغة!
  شارك في المزادات للحصول على قطع ثمينة 🏺
🪎◆⫘⫘⫘⫘⫘⫘⫘⫘◆🪎`;
    }

    let text = `📤◆⫘⫘⫘⫘⫘⫘⫘⫘📥
  مخزون ${nickname}:\n\n`;
    
    items.forEach((item, index) => {
        text += `\`${index + 1}\` ${item.emoji} *${item.name}*\n`;
    });
    
    text += `🪎◆⫘⫘⫘⫘⫘⫘⫘⫘◆🪎`;
    return text;
}

function getSendMessage(toNickname, item) {
    return `╮───────📥───────╭
  جار إرسال القطعة الى مخزون: 
                  *꧁ ${toNickname} ꧂*
  القطعة:  ${item.emoji} ${item.name}
  ${item.description}
  ستصل القطعة بعد:  *3 دقائق*
  يمكنك الغاء اي طلب عبر: *.الغاء*
╯───────📥───────╰`;
}

function getSendSuccess(from, to, item) {
    return `✅ تم إرسال القطعة ${item.emoji} *${item.name}* من @${from} إلى @${to} بنجاح!`;
}

function getSendCancelled() {
    return `✅ تم إلغاء طلب الإرسال بنجاح.`;
}

function getSendNoItem() {
    return `⚠️ لا تملك هذه القطعة في مخزونك.`;
}

// ============================================================
// بدء المزاد
// ============================================================

async function handleMazadCommand(
    sock,
    jid,
    msg,
    db,
    saveDb,
    cleanSender,
    isBotOwner
) {
    try {
        const creator = db.mazadCreator;
        if (!creator || creator !== cleanSender) {
            await safeSend(sock, jid, {
                text: "⚠️ ليس لديك صلاحية لبدء المزاد. يجب أن تكون منشئ المزاد."
            }, { quoted: msg });
            return true;
        }

        if (activeMazads[jid]) {
            await safeSend(sock, jid, {
                text: "⚠️ هناك مزاد نشط بالفعل في هذه المجموعة!"
            }, { quoted: msg });
            return true;
        }

        const item = getRandomMazadItem();

        const mazadState = {
            item: item,
            highestBid: 0,
            highestBidder: null,
            startTime: Date.now(),
            isActive: true,
            endTime: Date.now() + 30 * 60 * 1000,
            lastActivity: Date.now(),
            bidders: [],
            timers: {
                end: null,
                inactivity: null
            },
            stopMazad: function() {
                this.isActive = false;
                if (this.timers.end) {
                    clearTimeout(this.timers.end);
                    this.timers.end = null;
                }
                if (this.timers.inactivity) {
                    clearTimeout(this.timers.inactivity);
                    this.timers.inactivity = null;
                }
                delete activeMazads[jid];
            }
        };

        activeMazads[jid] = mazadState;

        await safeSend(sock, jid, {
            text: getMazadStartMessage(item)
        }, { quoted: msg });

        setTimeout(async () => {
            if (!mazadState.isActive) return;
            await safeSend(sock, jid, {
                text: getMazadInstructions()
            });
        }, 2000);

        mazadState.timers.end = setTimeout(async () => {
            if (!mazadState.isActive) return;
            await endMazad(sock, jid, db, saveDb, mazadState);
        }, 30 * 60 * 1000);

        mazadState.timers.inactivity = setTimeout(async () => {
            if (!mazadState.isActive) return;
            
            const timeSinceLastActivity = Date.now() - mazadState.lastActivity;
            if (timeSinceLastActivity > 10 * 60 * 1000 && mazadState.bidders.length === 0) {
                mazadState.stopMazad();
                await safeSend(sock, jid, {
                    text: getMazadCancelled()
                });
            } else {
                mazadState.timers.inactivity = setTimeout(() => {}, 5 * 60 * 1000);
            }
        }, 10 * 60 * 1000);

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleMazadCommand:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة العروض
// ============================================================

async function handleMazadBid(
    sock,
    jid,
    msg,
    db,
    saveDb,
    cleanSender,
    amount
) {
    try {
        const mazad = activeMazads[jid];
        if (!mazad || !mazad.isActive) {
            await safeSend(sock, jid, {
                text: "⚠️ لا يوجد مزاد نشط حالياً."
            }, { quoted: msg });
            return true;
        }

        if (amount > 999999) {
            await safeSend(sock, jid, {
                text: getMazadTooMuch()
            }, { quoted: msg });
            return true;
        }

        const user = getUser(db, cleanSender);
        if (!user) {
            await safeSend(sock, jid, {
                text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل للمشاركة في المزاد."
            }, { quoted: msg });
            return true;
        }

        const balance = Number(user.balance) || 0;
        if (balance < amount) {
            await safeSend(sock, jid, {
                text: `⚠️ رصيدك غير كافي. رصيدك الحالي: ${balance}$`
            }, { quoted: msg });
            return true;
        }

        if (amount <= mazad.highestBid) {
            await safeSend(sock, jid, {
                text: `⚠️ يجب أن يكون العرض أعلى من أعلى عرض حالياً (${mazad.highestBid}$)`
            }, { quoted: msg });
            return true;
        }

        mazad.highestBid = amount;
        mazad.highestBidder = cleanSender;
        mazad.lastActivity = Date.now();
        
        if (!mazad.bidders.includes(cleanSender)) {
            mazad.bidders.push(cleanSender);
        }

        const nickname = getUserNickname(db, cleanSender);
        await safeSend(sock, jid, {
            text: `✅ تم تسجيل عرض ${amount}$ من [${nickname}] 🏆`,
            mentions: [msg?.key?.participant || msg?.key?.remoteJid]
        });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleMazadBid:", error?.message || error);
        return false;
    }
}

// ============================================================
// إنهاء المزاد (⭐ معدّل: استخدام اللقب في الإعلان)
// ============================================================

async function endMazad(sock, jid, db, saveDb, mazadState) {
    if (!mazadState.isActive) return;

    mazadState.isActive = false;

    if (mazadState.highestBidder) {
        const winner = mazadState.highestBidder;
        const amount = mazadState.highestBid;
        const item = mazadState.item;

        const user = getUser(db, winner);
        if (user) {
            user.balance = Number(user.balance) || 0;
            user.balance -= amount;
        }

        db.inventory = db.inventory || {};
        if (!db.inventory[winner]) {
            db.inventory[winner] = [];
        }
        db.inventory[winner].push({
            emoji: item.emoji,
            name: item.name,
            description: item.description,
            acquiredAt: Date.now()
        });

        if (typeof saveDb === "function") saveDb();

        // رسالة الفائز داخل القروب (تبقى بالمنشن)
        await safeSend(sock, jid, {
            text: getMazadWinner(winner, item, amount),
            mentions: [`${winner}@s.whatsapp.net`]
        });

        // ⭐ إعلان ADS باللقب
        const winnerUser = db.users?.[winner];
        const winnerNickname = (winnerUser && String(winnerUser.nickname || "").trim()) || winner;

        const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{مزاد}*

◇🪎 آلَــــجَــــآئـزَة:
*{${item.emoji} ${item.name}}*

◇🎖️ آلَفــــــآئــز:
*${winnerNickname}*

◇💰 سعر الشراء:
*{${amount}$}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

        if (db.adsGroups && typeof db.adsGroups === "object") {
            for (const adJid of Object.keys(db.adsGroups)) {
                if (!db.adsGroups[adJid]) continue;
                await safeSend(sock, adJid, {
                    text: adMessage
                    // ⭐ لا mentions
                });
            }
        }

    } else {
        await safeSend(sock, jid, {
            text: getMazadCancelled()
        });
    }

    delete activeMazads[jid];
}

// ============================================================
// عرض المخزون
// ============================================================

async function handleMazadInventory(
    sock,
    jid,
    msg,
    db,
    cleanSender
) {
    try {
        const nickname = getUserNickname(db, cleanSender);
        const inventory = db.inventory && db.inventory[cleanSender] || [];
        
        await safeSend(sock, jid, {
            text: getInventoryMessage(inventory, nickname)
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleMazadInventory:", error?.message || error);
        return false;
    }
}

// ============================================================
// إرسال قطعة إلى شخص آخر
// ============================================================

async function handleMazadSend(
    sock,
    jid,
    msg,
    text,
    db,
    saveDb,
    cleanSender
) {
    try {
        const parts = text.split(/\s+/);
        if (parts.length < 3) {
            await safeSend(sock, jid, {
                text: "⚠️ الاستخدام الصحيح: .ارسال 🏺 @user"
            }, { quoted: msg });
            return true;
        }

        const emoji = parts[1];
        const targetMention = parts[2];
        const targetNumber = cleanNumber(targetMention);

        if (!targetNumber) {
            await safeSend(sock, jid, {
                text: "⚠️ يرجى منشن الشخص المستلم بشكل صحيح."
            }, { quoted: msg });
            return true;
        }

        const inventory = db.inventory && db.inventory[cleanSender] || [];
        const itemIndex = inventory.findIndex(item => item.emoji === emoji);
        
        if (itemIndex === -1) {
            await safeSend(sock, jid, {
                text: getSendNoItem()
            }, { quoted: msg });
            return true;
        }

        const item = inventory[itemIndex];
        const targetNickname = getUserNickname(db, targetNumber);

        await safeSend(sock, jid, {
            text: getSendMessage(targetNickname, item)
        }, { quoted: msg });

        setTimeout(async () => {
            try {
                const targetUser = getUser(db, targetNumber);
                if (!targetUser) {
                    await safeSend(sock, jid, {
                        text: `⚠️ لا يمكن إرسال القطعة. المستلم غير موجود.`
                    });
                    return;
                }

                db.inventory[cleanSender] = db.inventory[cleanSender].filter((_, i) => i !== itemIndex);
                
                db.inventory = db.inventory || {};
                if (!db.inventory[targetNumber]) {
                    db.inventory[targetNumber] = [];
                }
                db.inventory[targetNumber].push({
                    emoji: item.emoji,
                    name: item.name,
                    description: item.description,
                    acquiredAt: Date.now(),
                    from: cleanSender
                });

                if (typeof saveDb === "function") saveDb();

                await safeSend(sock, jid, {
                    text: getSendSuccess(cleanSender, targetNumber, item),
                    mentions: [`${cleanSender}@s.whatsapp.net`, `${targetNumber}@s.whatsapp.net`]
                });

            } catch (error) {
                console.error("❌ خطأ في إرسال القطعة:", error?.message || error);
            }
        }, 3 * 60 * 1000);

        db.pendingSend = db.pendingSend || {};
        db.pendingSend[cleanSender] = {
            to: targetNumber,
            item: item,
            timestamp: Date.now()
        };
        if (typeof saveDb === "function") saveDb();

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleMazadSend:", error?.message || error);
        return false;
    }
}

// ============================================================
// إلغاء طلب الإرسال
// ============================================================

async function handleMazadCancelSend(
    sock,
    jid,
    msg,
    db,
    saveDb,
    cleanSender
) {
    try {
        const pending = db.pendingSend && db.pendingSend[cleanSender];
        if (!pending) {
            await safeSend(sock, jid, {
                text: "⚠️ لا يوجد طلب إرسال نشط لإلغائه."
            }, { quoted: msg });
            return true;
        }

        delete db.pendingSend[cleanSender];
        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, {
            text: getSendCancelled()
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleMazadCancelSend:", error?.message || error);
        return false;
    }
}

function checkMazadActive(jid) {
    return Boolean(activeMazads[jid] && activeMazads[jid].isActive);
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    activeMazads,
    handleMazadCommand,
    handleMazadBid,
    handleMazadInventory,
    handleMazadSend,
    handleMazadCancelSend,
    checkMazadActive,
    MAZAD_ITEMS
};
