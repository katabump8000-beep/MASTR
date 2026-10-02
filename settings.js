// settings.js - إعدادات البوت الأساسية

const env = (name) => String(process.env[name] || "").trim();

const settings = {
    botNumber: "48459074937",
    owners: ["48459074937"],
    sessionFolder: "session",
    botName: "BOT PATHIRA",

    // ===== مفاتيح فحص الصور بالذكاء الاصطناعي (لأمر .احضر) =====
    // يُجرَّب بالترتيب، وإن فشل أحدها ينتقل البوت للتالي تلقائياً
    anthropicApiKey: env("ANTHROPIC_API_KEY") || "",
    geminiApiKey: env("GEMINI_API_KEY") || "",
    mistralApiKey: env("MISTRAL_API_KEY") || "",
    openrouterApiKey: env("OPENROUTER_API_KEY") || "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",

    // ===== موديلات الرؤية (اتركها فارغة = الافتراضي الجاهز) =====
    visionModels: {
        anthropic: "",
        gemini: "",
        mistral: "",
        openrouter: ""
    },

    // ===== (اختياري) بحث Google الرسمي =====
    googleApiKey: env("GOOGLE_API_KEY") || "",
    googleCx: env("GOOGLE_CX") || ""
};

(function validate() {
    const digits = (v) => String(v || "").replace(/\D/g, "");
    if (!digits(settings.botNumber)) console.error("❌ settings.botNumber فارغ أو غير صالح.");
    if (!Array.isArray(settings.owners) || !settings.owners.map(digits).filter(Boolean).length) {
        console.error("⚠️ settings.owners فارغ — سيُعتبر رقم البوت هو المالك الوحيد.");
    }
})();

// يُمرَّر لملف Ai.js (لا تغيّر هذه الأسطر)
const pass = (envName, val) => { if (val && !process.env[envName]) process.env[envName] = val; };
pass("ANTHROPIC_API_KEY", settings.anthropicApiKey);
pass("GEMINI_API_KEY", settings.geminiApiKey);
pass("MISTRAL_API_KEY", settings.mistralApiKey);
pass("OPENROUTER_API_KEY", settings.openrouterApiKey);
pass("AI_VISION_MODEL", settings.visionModels.anthropic);
pass("GEMINI_VISION_MODEL", settings.visionModels.gemini);
pass("AI_VISION_MODEL_MISTRAL", settings.visionModels.mistral);
pass("AI_VISION_MODEL_OPENROUTER", settings.visionModels.openrouter);
pass("GOOGLE_API_KEY", settings.googleApiKey);
pass("GOOGLE_CX", settings.googleCx);

module.exports = settings;
