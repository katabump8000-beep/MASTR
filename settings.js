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
    botNumber: env("BOT_NUMBER") || "48699554086",
    owners: env("OWNERS").split(",").map(x => x.trim()).filter(Boolean),

    sessionFolder: "session",
    botName: "BOT PATHIRA",

    // ===== مفاتيح الذكاء الاصطناعي (كلها تُقرأ من Variables) =====
    anthropicApiKey: env("ANTHROPIC_API_KEY") || "",
    geminiApiKey: env("GEMINI_API_KEY") || "",
    mistralApiKey: env("MISTRAL_API_KEY") || "",
    openrouterApiKey: env("OPENROUTER_API_KEY") || "",

    visionModels: { anthropic: "", gemini: "", mistral: "", openrouter: "" },

    googleApiKey: env("GOOGLE_API_KEY") || "",
    googleCx: env("GOOGLE_CX") || ""
};

(function validate() {
    const digits = (v) => String(v || "").replace(/\D/g, "");
    if (!digits(settings.botNumber)) console.error("❌ رقم البوت فارغ: أضف BOT_NUMBER في Variables.");
    else console.log(`⚙️ رقم البوت المقروء من الإعدادات: +${digits(settings.botNumber)}`);
})();

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
