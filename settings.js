// settings.js - إعدادات البوت الأساسية

const settings = {
    botNumber: "48702194459", // ضع رقمك هنا
    owners: ["48702194459"],
    sessionFolder: "session",
    botName: "BOT PATHIRA",

    // ===== مفتاح فحص الصور بالذكاء الاصطناعي (لأمر .احضر) =====
    // ضع مفتاحاً واحداً فقط وأبقِ الباقي فارغاً. الترتيب إذا وضعت أكثر من واحد: anthropic ثم gemini ثم mistral ثم openrouter
    anthropicApiKey: "",   // الأدق (Claude) — مدفوع بسعر رخيص — console.anthropic.com
    geminiApiKey: "",      // مجاني — aistudio.google.com/apikey
    mistralApiKey: "",     // مجاني — console.mistral.ai/api-keys
    openrouterApiKey: "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"   // مجاني بدون بطاقة — openrouter.ai/keys
};

// يُمرَّر لملف Ai.js (لا تغيّر هذه الأسطر)
const pass = (envName, val) => { if (val && !process.env[envName]) process.env[envName] = val; };
pass("ANTHROPIC_API_KEY", settings.anthropicApiKey);
pass("GEMINI_API_KEY", settings.geminiApiKey);
pass("MISTRAL_API_KEY", settings.mistralApiKey);
pass("OPENROUTER_API_KEY", settings.openrouterApiKey);

module.exports = settings;
