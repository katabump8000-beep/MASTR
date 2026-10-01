// settings.js - إعدادات البوت الأساسية

const settings = {
    botNumber: "48699554086", // ضع رقمك هنا
    owners: ["48699554086"],
    sessionFolder: "session",
    botName: "BOT PATHIRA",

    // ===== مفاتيح فحص الصور بالذكاء الاصطناعي (لأمر .احضر) =====
    // اختر واحداً فقط وضع مفتاحك بين علامتي التنصيص، واترك الآخر فارغاً
    geminiApiKey: "",     // مجاني من https://aistudio.google.com/apikey
    anthropicApiKey: ""   // اختياري (مدفوع)
};

// يُمرَّر لملف Ai.js (لا تغيّر هذين السطرين)
if (settings.geminiApiKey && !process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = settings.geminiApiKey;
if (settings.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = settings.anthropicApiKey;

module.exports = settings;
