// settings.js - إعدادات البوت الأساسية

const settings = {
    botNumber: "48699555838", // ضع رقمك هنا
    owners: ["48699555838"],
    sessionFolder: "session",
    botName: "BOT PATHIRA",

    // ========================================================
    // Dino Server (لعبة الطائر التفاعلية)
    // ========================================================
    dinoServerPort: 3001,
    dinoServerSecret: "",        // اتركه فارغاً وسيُولّد تلقائياً
    dinoPointsPerDollar: 100,    // كل 100 نقطة = 1$
    dinoMaxEarn: 1000,           // الحد الأقصى للربح
    dinoMaxScore: 100000,        // الحد الأقصى للنقاط المقبولة

    // رابط السيرفر (سيُضاف تلقائياً في HTML)
    // مثال: "https://your-app.up.railway.app"
    dinoServerUrl: ""            // اتركه فارغاً وسيُبنى من PORT
};

module.exports = settings;
