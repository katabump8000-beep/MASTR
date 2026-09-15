// ============================================================
// server.js
// ALJESAT BOT
// سيرفر استقبال نتائج الألعاب التفاعلية (HTML)
// يحفظ التوكن تلقائياً في ملف — لا يحتاج تدخل يدوي
// ============================================================

"use strict";

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const settings = require("./settings");

// ============================================================
// الملفات
// ============================================================

const DINO_REWARDS_FILE = path.join(__dirname, "dino_rewards.json");
const DINO_USED_GAMES_FILE = path.join(__dirname, "dino_used_games.json");
const DINO_TOKEN_FILE = path.join(__dirname, ".dino_token");

const SERVER_START_TIME = Date.now();

const MAX_SCORE = Number(settings.dinoMaxScore) || 100000;
const MIN_SCORE = 0;

const PLAYER_COOLDOWN_MS = 10 * 1000;
const playerCooldowns = new Map();

const IP_WINDOW_MS = 60 * 1000;
const IP_MAX_REQUESTS = 30;
const ipBuckets = new Map();

const usedGameIds = new Set();
let usedGameIdsLoaded = false;

let activeRewardHandler = null;
let serverInstance = null;

// ============================================================
// التوكن — يُولّد ويُحفظ تلقائياً
// ============================================================

let cachedSecret = null;

/**
 * يُرجع التوكن السري.
 * - لو مُعرّف في settings → يستخدمه
 * - لو ملف .dino_token موجود → يقرأه
 * - وإلا → يولّد توكن عشوائي ويحفظه
 */
function getServerSecret() {
    // 1. cached في الذاكرة
    if (cachedSecret) return cachedSecret;

    // 2. settings
    if (settings.dinoServerSecret && String(settings.dinoServerSecret).trim().length > 8) {
        cachedSecret = String(settings.dinoServerSecret).trim();
        return cachedSecret;
    }

    // 3. من الملف
    try {
        if (fs.existsSync(DINO_TOKEN_FILE)) {
            const value = fs.readFileSync(DINO_TOKEN_FILE, "utf8").trim();
            if (value.length >= 16) {
                cachedSecret = value;
                return cachedSecret;
            }
        }
    } catch (error) {
        console.error("⚠️ فشل قراءة التوكن:", error?.message);
    }

    // 4. توليد توكن جديد
    const newSecret = crypto.randomBytes(24).toString("hex");
    cachedSecret = newSecret;

    try {
        fs.writeFileSync(DINO_TOKEN_FILE, newSecret, { encoding: "utf8", mode: 0o600 });

        console.log("");
        console.log("════════════════════════════════════════════════════");
        console.log("🔐 تم توليد توكن Dino السري وحفظه في:");
        console.log("   " + DINO_TOKEN_FILE);
        console.log("");
        console.log("   التوكن: " + newSecret.slice(0, 16) + "...");
        console.log("");
        console.log("   ملاحظة: لن يتغير في المرات القادمة.");
        console.log("   لحذف التوكن وتوليد جديد: احذف ملف .dino_token");
        console.log("════════════════════════════════════════════════════");
        console.log("");
    } catch (error) {
        console.error("❌ فشل حفظ التوكن:", error?.message);
        console.error("⚠️ سيُستخدم توكن مؤقت للجلسة الحالية فقط");
    }

    return newSecret;
}

// ============================================================
// أدوات
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/\D/g, "");
}

function loadUsedGameIds() {
    if (usedGameIdsLoaded) return;
    usedGameIdsLoaded = true;

    try {
        if (!fs.existsSync(DINO_USED_GAMES_FILE)) return;

        const raw = fs.readFileSync(DINO_USED_GAMES_FILE, "utf8").trim();
        if (!raw) return;

        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            for (const id of parsed) {
                if (typeof id === "string" && id) usedGameIds.add(id);
            }
        }
    } catch (_) {}
}

function persistUsedGameIds() {
    try {
        const arr = Array.from(usedGameIds).slice(-5000);
        usedGameIds.clear();
        for (const id of arr) usedGameIds.add(id);
        fs.writeFileSync(DINO_USED_GAMES_FILE, JSON.stringify(arr, null, 2), "utf8");
    } catch (_) {}
}

function writeRewardToFile(reward) {
    try {
        let data = { queue: [] };

        if (fs.existsSync(DINO_REWARDS_FILE)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(DINO_REWARDS_FILE, "utf8"));
                if (parsed && Array.isArray(parsed.queue)) data = parsed;
            } catch (_) {
                data = { queue: [] };
            }
        }

        data.queue.push(reward);
        if (data.queue.length > 1000) data.queue = data.queue.slice(-1000);

        fs.writeFileSync(DINO_REWARDS_FILE, JSON.stringify(data, null, 2), "utf8");
        return true;
    } catch (_) {
        return false;
    }
}

function checkIpRateLimit(ip) {
    const now = Date.now();
    let bucket = ipBuckets.get(ip);

    if (!bucket || now - bucket.windowStart >= IP_WINDOW_MS) {
        bucket = { count: 0, windowStart: now };
        ipBuckets.set(ip, bucket);
    }

    bucket.count++;
    return bucket.count <= IP_MAX_REQUESTS;
}

function checkPlayerCooldown(playerNumber) {
    const now = Date.now();
    const last = playerCooldowns.get(playerNumber) || 0;

    if (now - last < PLAYER_COOLDOWN_MS) return false;

    playerCooldowns.set(playerNumber, now);
    return true;
}

function startCleanupTimer() {
    const timer = setInterval(() => {
        const now = Date.now();

        for (const [ip, bucket] of ipBuckets.entries()) {
            if (now - bucket.windowStart > 5 * 60 * 1000) {
                ipBuckets.delete(ip);
            }
        }

        for (const [player, ts] of playerCooldowns.entries()) {
            if (now - ts > 5 * 60 * 1000) {
                playerCooldowns.delete(player);
            }
        }
    }, 60 * 1000);

    if (timer.unref) timer.unref();
}

// ============================================================
// Express
// ============================================================

function createExpressApp() {
    const app = express();

    app.use((req, res, next) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.header("Access-Control-Max-Age", "600");

        if (req.method === "OPTIONS") return res.sendStatus(204);
        next();
    });

    app.use(express.json({ limit: "32kb" }));
    app.use(express.urlencoded({ extended: false, limit: "32kb" }));

    // ---------- GET / ----------
    app.get("/", (req, res) => {
        res.json({
            ok: true,
            service: "Aljesat Dino Server",
            version: "1.0.0",
            uptime: Math.floor((Date.now() - SERVER_START_TIME) / 1000)
        });
    });

    // ---------- GET /health ----------
    app.get("/health", (req, res) => {
        res.json({
            ok: true,
            uptime: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
            usedGamesCount: usedGameIds.size
        });
    });

    // ---------- POST /api/dino/cashout ----------
    app.post("/api/dino/cashout", async (req, res) => {
        try {
            const ip = String(
                req.headers["x-forwarded-for"] ||
                req.ip ||
                req.socket?.remoteAddress ||
                "unknown"
            ).split(",")[0].trim();

            if (!checkIpRateLimit(ip)) {
                return res.status(429).json({ ok: false, error: "rate_limit_exceeded" });
            }

            const body = req.body || {};
            const playerNumber = cleanNumber(body.playerNumber);
            const chatId = String(body.chatId || "").trim();
            const gameId = String(body.gameId || "").trim();
            const token = String(body.token || "").trim();
            const rawScore = body.score;

            if (!playerNumber || playerNumber.length < 6) {
                return res.status(400).json({ ok: false, error: "invalid_player" });
            }

            if (!chatId || !chatId.endsWith("@g.us")) {
                return res.status(400).json({ ok: false, error: "invalid_chat" });
            }

            if (!gameId || gameId.length < 8) {
                return res.status(400).json({ ok: false, error: "invalid_game_id" });
            }

            const expectedToken = getServerSecret();
            if (token !== expectedToken) {
                console.warn(`⚠️ توكن خاطئ من IP=${ip}`);
                return res.status(403).json({ ok: false, error: "invalid_token" });
            }

            const score = parseInt(rawScore, 10);
            if (!Number.isFinite(score) || score < MIN_SCORE || score > MAX_SCORE) {
                return res.status(400).json({
                    ok: false,
                    error: "invalid_score",
                    max: MAX_SCORE
                });
            }

            loadUsedGameIds();

            if (usedGameIds.has(gameId)) {
                return res.status(409).json({ ok: false, error: "duplicate_game_id" });
            }

            usedGameIds.add(gameId);
            if (usedGameIds.size % 10 === 0) persistUsedGameIds();

            if (!checkPlayerCooldown(playerNumber)) {
                return res.status(429).json({ ok: false, error: "player_cooldown" });
            }

            const pointsPerDollar = Number(settings.dinoPointsPerDollar) || 100;
            const maxEarn = Number(settings.dinoMaxEarn) || 1000;

            const earn = Math.min(
                Math.max(Math.floor(score / pointsPerDollar), 0),
                maxEarn
            );

            const reward = {
                playerNumber,
                chatId,
                gameId,
                score,
                earn,
                ip,
                timestamp: Date.now()
            };

            if (typeof activeRewardHandler === "function") {
                try {
                    await activeRewardHandler(reward);
                } catch (error) {
                    console.error("❌ activeRewardHandler:", error?.message);
                    writeRewardToFile(reward);
                }
            } else {
                writeRewardToFile(reward);
            }

            console.log(
                `🎮 Dino Reward | ${playerNumber} | النقاط: ${score} | الربح: ${earn}$`
            );

            return res.json({ ok: true, score, earn });

        } catch (error) {
            console.error("❌ /api/dino/cashout:", error?.message);
            return res.status(500).json({ ok: false, error: "internal_error" });
        }
    });

    app.use((req, res) => {
        res.status(404).json({ ok: false, error: "not_found" });
    });

    app.use((err, req, res, next) => {
        console.error("❌ Server Error:", err?.message);
        if (res.headersSent) return next(err);
        res.status(500).json({ ok: false, error: "server_error" });
    });

    return app;
}

// ============================================================
// API
// ============================================================

function startRewardServer(options = {}) {
    if (serverInstance) return serverInstance;

    if (typeof options.onReward === "function") {
        activeRewardHandler = options.onReward;
    }

    const port =
        Number(options.port) ||
        Number(settings.dinoServerPort) ||
        Number(process.env.PORT) ||
        3001;

    loadUsedGameIds();
    startCleanupTimer();

    // توليد/قراءة التوكن عند البدء (يطبع في logs عند أول تشغيل فقط)
    getServerSecret();

    const app = createExpressApp();

    serverInstance = app.listen(port, "0.0.0.0", () => {
        console.log(`🚀 Dino Server يعمل على المنفذ ${port}`);
    });

    serverInstance.on("error", (error) => {
        console.error("❌ Server Error:", error?.message);
    });

    const saveOnExit = () => {
        try { persistUsedGameIds(); } catch (_) {}
    };
    process.once("SIGINT", saveOnExit);
    process.once("SIGTERM", saveOnExit);

    return serverInstance;
}

function stopRewardServer() {
    if (serverInstance) {
        try { serverInstance.close(); } catch (_) {}
        serverInstance = null;
    }
}

function setRewardHandler(handler) {
    if (typeof handler === "function") activeRewardHandler = handler;
}

function consumeRewardsFile() {
    try {
        if (!fs.existsSync(DINO_REWARDS_FILE)) return [];

        const raw = fs.readFileSync(DINO_REWARDS_FILE, "utf8").trim();
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.queue) || parsed.queue.length === 0) return [];

        const queue = parsed.queue;
        parsed.queue = [];
        fs.writeFileSync(DINO_REWARDS_FILE, JSON.stringify(parsed, null, 2), "utf8");

        return queue;
    } catch (error) {
        console.error("❌ consumeRewardsFile:", error?.message);
        return [];
    }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    startRewardServer,
    stopRewardServer,
    setRewardHandler,
    consumeRewardsFile,
    getServerSecret,
    createExpressApp,
    MAX_SCORE,
    MIN_SCORE
};