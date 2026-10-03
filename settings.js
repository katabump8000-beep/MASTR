// settings.js - إعدادات البوت الأساسية

// ينظّف القيمة: يحذف المسافات والأسطر والرموز الخفية وعلامات الاقتباس وكلمة Bearer إن لُصقت مع المفتاح
const cleanValue = (v) => {
    let x = String(v || "").replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "").trim();
    for (let i = 0; i < 3; i++) {
        x = x.replace(/^["'`]+|["'`]+$/g, "").trim();
        x = x.replace(/^authorization\s*:\s*/i, "").replace(/^bearer\s+/i, "").trim();
    }
    return x;
};

for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CX"]) {
    if (process.env[k] !== undefined) process.env[k] = cleanValue(process.env[k]);
}

const env = (name) => cleanValue(process.env[name]);

const settings = {
    // ┌────────────────────────────────────────────────────────────┐
    // │ رقم البوت: يُقرأ من Variables باسم BOT_NUMBER (الأفضل على Railway) │
    // │ أو غيّر الرقم الاحتياطي بين علامتي الاقتباس هنا.                   │
    // │ بصيغة دولية بدون + وبدون صفر. مثال: 48459074937                    │
    // │ عند تغيير الرقم يمسح البوت الجلسة القديمة ويعطيك رمز اقتران جديد   │
    // └────────────────────────────────────────────────────────────┘
    botNumber: env("BOT_NUMBER") || "48459194702",

    // مالكون إضافيون (اختياري): من Variables باسم OWNERS مفصولة بفاصلة، مثال: 212600000001,962790000000
    // رقم البوت نفسه مالك دائماً.
    owners: env("OWNERS").split(",").map(x => x.trim()).filter(Boolean),

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
    if (!digits(settings.botNumber)) console.error("❌ رقم البوت فارغ: أضف BOT_NUMBER في Variables.");
    else console.log(`⚙️ رقم البوت المقروء من الإعدادات: +${digits(settings.botNumber)}`);
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
