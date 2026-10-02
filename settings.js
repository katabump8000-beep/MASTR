// settings.js - إعدادات البوت الأساسية
//
// ⚠️ مهم أمنياً:
//  • لا ترفع هذا الملف لأي مكان عام ولا ترسله لأحد وهو يحتوي مفاتيح.
//  • الأفضل وضع المفاتيح كمتغيرات بيئة في الاستضافة (ANTHROPIC_API_KEY ...) فتبقى خارج الملف.
//    القيمة في الملف تُستعمل فقط إذا لم يوجد متغير بيئة بنفس الاسم.

const env = (name) => String(process.env[name] || "").trim();

const settings = {
    botNumber: "48459074937",
    owners: ["48459074937"],
    sessionFolder: "session",
    botName: "BOT PATHIRA",

    // ===== مفاتيح فحص الصور بالذكاء الاصطناعي (لأمر .احضر) =====
    // ضع واحداً على الأقل. يُجرَّب بالترتيب، وإن فشل أحدها ينتقل البوت للتالي تلقائياً:
    // anthropic ← gemini ← mistral ← openrouter
    anthropicApiKey: env("ANTHROPIC_API_KEY") || "",     // الأدق — console.anthropic.com
    geminiApiKey: env("GEMINI_API_KEY") || "",           // مجاني — aistudio.google.com/apikey
    mistralApiKey: env("MISTRAL_API_KEY") || "",         // مجاني — console.mistral.ai/api-keys
    openrouterApiKey: env("OPENROUTER_API_KEY") || "4bcfca043eda751caa2d2ee32131b17550f1d2566c3b37c0c4e1725451457732",   // openrouter.ai/keys

    // ===== (اختياري، موصى به) بحث Google الرسمي =====
    // مجاني 100 بحث/يوم: console.cloud.google.com ← Custom Search API ← مفتاح،
    // ثم programmablesearchengine.google.com ← أنشئ محرك مع تفعيل «Image search» وابحث في كل الويب ← خذ cx
    // بدونها يحاول البوت قراءة صفحة Google مباشرة (Google يحجبها أحياناً) ثم Bing كبديل.
    // ===== موديلات الرؤية (اتركها فارغة = الافتراضي الجاهز، لا تغيّرها إلا إن تعطل موديل) =====
    visionModels: {
        anthropic: "",    // الافتراضي: claude-haiku-4-5-20251001
        gemini: "",       // الافتراضي: gemini-flash-latest (مع بدائل تلقائية)
        mistral: "",      // الافتراضي: mistral-medium-latest
        openrouter: ""    // الافتراضي: nvidia/nemotron-nano-12b-v2-vl:free ثم openrouter/free
    },

    googleApiKey: env("GOOGLE_API_KEY") || "",
    googleCx: env("GOOGLE_CX") || ""
};

// تحقق بسيط حتى لا يتعطل البوت بصمت بسبب خطأ في الإعدادات
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
