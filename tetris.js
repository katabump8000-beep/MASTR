'use strict';

/*
 * ============================================
 *              ALJESAT BOT - TETRIS
 * ============================================
 *
 * ملف مستقل للعبة Tetris.
 *
 * لا يعتمد على data.js أو commands.js أو index.js
 * بشكل مباشر، حتى يتم ربطه لاحقًا بنظام البوت
 * ونظام الرصيد الموجود في المشروع.
 *
 * القواعد:
 * - المستوى يبدأ من 1.
 * - كل سطر مكتمل = 15 رصيد.
 * - عدد الأسطر المكتملة يرفع المستوى بنفس العدد.
 * - لا يوجد Score.
 * - لا يوجد High Score.
 * - سرعة السقوط تزداد مع المستوى.
 * - كل لعبة لها gameId مستقل.
 * - اللاعب الذي بدأ اللعبة فقط يستطيع التحكم.
 * - الأرباح لا تتم تسويتها أكثر من مرة.
 */

const crypto = require('crypto');

/* ============================================
 *                 CONSTANTS
 * ============================================ */

const WIDTH = 10;
const HEIGHT = 20;

const REWARD_PER_LINE = 15;

const START_LEVEL = 1;

/*
 * سرعة السقوط بالملي ثانية.
 * كلما ارتفع المستوى تقل المدة.
 */
const START_DROP_SPEED = 900;
const MIN_DROP_SPEED = 100;

const LEVEL_SPEED_STEP = 70;

/*
 * أنواع القطع السبعة الأساسية في Tetris.
 *
 * كل قطعة عبارة عن مصفوفة.
 */
const PIECES = {
    I: [
        [
            [1, 1, 1, 1]
        ],
        [
            [1],
            [1],
            [1],
            [1]
        ]
    ],

    O: [
        [
            [1, 1],
            [1, 1]
        ]
    ],

    T: [
        [
            [0, 1, 0],
            [1, 1, 1]
        ],
        [
            [1, 0],
            [1, 1],
            [1, 0]
        ],
        [
            [1, 1, 1],
            [0, 1, 0]
        ],
        [
            [0, 1],
            [1, 1],
            [0, 1]
        ]
    ],

    S: [
        [
            [0, 1, 1],
            [1, 1, 0]
        ],
        [
            [1, 0],
            [1, 1],
            [0, 1]
        ]
    ],

    Z: [
        [
            [1, 1, 0],
            [0, 1, 1]
        ],
        [
            [0, 1],
            [1, 1],
            [1, 0]
        ]
    ],

    J: [
        [
            [1, 0, 0],
            [1, 1, 1]
        ],
        [
            [1, 1],
            [1, 0],
            [1, 0]
        ],
        [
            [1, 1, 1],
            [0, 0, 1]
        ],
        [
            [0, 1],
            [0, 1],
            [1, 1]
        ]
    ],

    L: [
        [
            [0, 0, 1],
            [1, 1, 1]
        ],
        [
            [1, 0],
            [1, 0],
            [1, 1]
        ],
        [
            [1, 1, 1],
            [1, 0, 0]
        ],
        [
            [1, 1],
            [0, 1],
            [0, 1]
        ]
    ]
};


/* ============================================
 *              UTILITY FUNCTIONS
 * ============================================ */

function createEmptyBoard() {
    return Array.from(
        { length: HEIGHT },
        () => Array(WIDTH).fill(0)
    );
}


function cloneMatrix(matrix) {
    return matrix.map(row => [...row]);
}


function randomPieceType() {
    const types = Object.keys(PIECES);
    return types[Math.floor(Math.random() * types.length)];
}


function createPiece(type = randomPieceType()) {
    const rotations = PIECES[type];

    return {
        type,
        rotation: 0,
        matrix: cloneMatrix(rotations[0]),
        x: Math.floor((WIDTH - rotations[0][0].length) / 2),
        y: 0
    };
}


function getSpeed(level) {
    const speed =
        START_DROP_SPEED -
        ((level - START_LEVEL) * LEVEL_SPEED_STEP);

    return Math.max(MIN_DROP_SPEED, speed);
}


/* ============================================
 *             PIECE ROTATION
 * ============================================ */

function rotatePiece(piece) {
    const rotations = PIECES[piece.type];

    if (!rotations || rotations.length <= 1) {
        return;
    }

    const nextRotation =
        (piece.rotation + 1) % rotations.length;

    piece.rotation = nextRotation;
    piece.matrix = cloneMatrix(
        rotations[nextRotation]
    );
}


/* ============================================
 *             COLLISION DETECTION
 * ============================================ */

function collides(board, piece, offsetX = 0, offsetY = 0) {
    const matrix = piece.matrix;

    for (let y = 0; y < matrix.length; y++) {
        for (let x = 0; x < matrix[y].length; x++) {

            if (!matrix[y][x]) {
                continue;
            }

            const boardX = piece.x + x + offsetX;
            const boardY = piece.y + y + offsetY;

            /*
             * حدود الجوانب.
             */
            if (boardX < 0 || boardX >= WIDTH) {
                return true;
            }

            /*
             * الأرضية.
             */
            if (boardY >= HEIGHT) {
                return true;
            }

            /*
             * الجزء العلوي مسموح أثناء إنشاء القطعة.
             */
            if (boardY < 0) {
                continue;
            }

            /*
             * اصطدام بقطعة موجودة.
             */
            if (board[boardY][boardX]) {
                return true;
            }
        }
    }

    return false;
}


/* ============================================
 *                MERGE PIECE
 * ============================================ */

function mergePiece(board, piece) {

    for (let y = 0; y < piece.matrix.length; y++) {
        for (let x = 0; x < piece.matrix[y].length; x++) {

            if (!piece.matrix[y][x]) {
                continue;
            }

            const boardX = piece.x + x;
            const boardY = piece.y + y;

            if (
                boardX >= 0 &&
                boardX < WIDTH &&
                boardY >= 0 &&
                boardY < HEIGHT
            ) {
                board[boardY][boardX] = 1;
            }
        }
    }
}


/* ============================================
 *               CLEAR LINES
 * ============================================ */

function clearLines(board) {

    let cleared = 0;

    for (let y = HEIGHT - 1; y >= 0; y--) {

        const full = board[y].every(cell => cell === 1);

        if (!full) {
            continue;
        }

        board.splice(y, 1);

        board.unshift(
            Array(WIDTH).fill(0)
        );

        cleared++;

        /*
         * بعد الحذف، نفحص نفس index مرة أخرى.
         */
        y++;
    }

    return cleared;
}


/* ============================================
 *              GAME CLASS
 * ============================================ */

class TetrisGame {

    constructor({
        chatId,
        playerId,
        onUpdate = null,
        onReward = null,
        onEnd = null
    }) {

        if (!chatId) {
            throw new Error('TetrisGame: chatId مطلوب');
        }

        if (!playerId) {
            throw new Error('TetrisGame: playerId مطلوب');
        }

        this.gameId = crypto.randomUUID();

        this.chatId = chatId;
        this.playerId = playerId;

        this.board = createEmptyBoard();

        this.level = START_LEVEL;

        this.lines = 0;

        /*
         * المبلغ الذي جمعه اللاعب خلال هذه اللعبة.
         */
        this.earned = 0;

        /*
         * حماية من التسوية المزدوجة.
         */
        this.settled = false;

        /*
         * حماية من انتهاء اللعبة أكثر من مرة.
         */
        this.ended = false;

        this.started = false;

        this.currentPiece = null;

        this.nextPieceType = randomPieceType();

        this.timer = null;

        /*
         * Callbacks سيتم ربطها لاحقًا بالبوت.
         */
        this.onUpdate = onUpdate;
        this.onReward = onReward;
        this.onEnd = onEnd;
    }


    /* ========================================
     *                 START
     * ======================================== */

    start() {

        if (this.started || this.ended) {
            return false;
        }

        this.started = true;

        this.spawnPiece();

        this.startTimer();

        this.update();

        return true;
    }


    /* ========================================
     *              SPAWN PIECE
     * ======================================== */

    spawnPiece() {

        const type = this.nextPieceType;

        this.nextPieceType = randomPieceType();

        this.currentPiece = createPiece(type);

        /*
         * إذا كانت القطعة الجديدة تصطدم مباشرة
         * فهذا يعني أن اللعبة انتهت.
         */
        if (
            collides(
                this.board,
                this.currentPiece
            )
        ) {
            this.end('game_over');
        }
    }


    /* ========================================
     *               TIMER
     * ======================================== */

    startTimer() {

        this.stopTimer();

        this.timer = setInterval(() => {

            if (this.ended) {
                return;
            }

            this.tick();

        }, getSpeed(this.level));
    }


    stopTimer() {

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }


    restartTimerIfNeeded() {

        if (!this.started || this.ended) {
            return;
        }

        this.startTimer();
    }


    /* ========================================
     *                 TICK
     * ======================================== */

    tick() {

        if (!this.currentPiece) {
            return;
        }

        if (
            !collides(
                this.board,
                this.currentPiece,
                0,
                1
            )
        ) {

            this.currentPiece.y++;

            this.update();

            return;
        }

        /*
         * لا يمكن النزول أكثر.
         * تثبيت القطعة.
         */
        this.lockPiece();
    }


    /* ========================================
     *             LOCK PIECE
     * ======================================== */

    lockPiece() {

        if (!this.currentPiece || this.ended) {
            return;
        }

        mergePiece(
            this.board,
            this.currentPiece
        );

        const cleared = clearLines(this.board);

        if (cleared > 0) {

            /*
             * كل سطر = 15 رصيد.
             */
            const reward =
                cleared * REWARD_PER_LINE;

            this.lines += cleared;

            this.earned += reward;

            /*
             * المستوى يرتفع بعدد الأسطر.
             */
            this.level += cleared;

            /*
             * إعادة ضبط سرعة اللعبة.
             */
            this.restartTimerIfNeeded();
        }

        this.currentPiece = null;

        this.spawnPiece();

        if (!this.ended) {
            this.update();
        }
    }


    /* ========================================
     *                 MOVE LEFT
     * ======================================== */

    moveLeft(playerId) {

        if (!this.authorized(playerId)) {
            return false;
        }

        if (!this.currentPiece) {
            return false;
        }

        if (
            !collides(
                this.board,
                this.currentPiece,
                -1,
                0
            )
        ) {

            this.currentPiece.x--;

            this.update();

            return true;
        }

        return false;
    }


    /* ========================================
     *                MOVE RIGHT
     * ======================================== */

    moveRight(playerId) {

        if (!this.authorized(playerId)) {
            return false;
        }

        if (!this.currentPiece) {
            return false;
        }

        if (
            !collides(
                this.board,
                this.currentPiece,
                1,
                0
            )
        ) {

            this.currentPiece.x++;

            this.update();

            return true;
        }

        return false;
    }


    /* ========================================
     *                  DOWN
     * ======================================== */

    moveDown(playerId) {

        if (!this.authorized(playerId)) {
            return false;
        }

        if (!this.currentPiece) {
            return false;
        }

        if (
            !collides(
                this.board,
                this.currentPiece,
                0,
                1
            )
        ) {

            this.currentPiece.y++;

            this.update();

            return true;
        }

        this.lockPiece();

        return true;
    }


    /* ========================================
     *                 HARD DROP
     * ======================================== */

    hardDrop(playerId) {

        if (!this.authorized(playerId)) {
            return false;
        }

        if (!this.currentPiece) {
            return false;
        }

        let moved = false;

        while (
            !collides(
                this.board,
                this.currentPiece,
                0,
                1
            )
        ) {

            this.currentPiece.y++;

            moved = true;
        }

        this.lockPiece();

        return moved;
    }


    /* ========================================
     *                  ROTATE
     * ======================================== */

    rotate(playerId) {

        if (!this.authorized(playerId)) {
            return false;
        }

        if (!this.currentPiece) {
            return false;
        }

        const oldRotation =
            this.currentPiece.rotation;

        const oldMatrix =
            cloneMatrix(
                this.currentPiece.matrix
            );

        const oldX = this.currentPiece.x;

        rotatePiece(this.currentPiece);

        /*
         * Wall kick بسيط:
         * نحاول تحريك القطعة إذا كانت
         * اصطدمت بالجدار.
         */
        const kicks = [0, -1, 1, -2, 2];

        let valid = false;

        for (const kick of kicks) {

            if (
                !collides(
                    this.board,
                    this.currentPiece,
                    kick,
                    0
                )
            ) {

                this.currentPiece.x += kick;

                valid = true;

                break;
            }
        }

        if (!valid) {

            this.currentPiece.rotation =
                oldRotation;

            this.currentPiece.matrix =
                oldMatrix;

            this.currentPiece.x =
                oldX;

            return false;
        }

        this.update();

        return true;
    }


    /* ========================================
     *              AUTHORIZATION
     * ======================================== */

    authorized(playerId) {

        if (this.ended) {
            return false;
        }

        if (!playerId) {
            return false;
        }

        return String(playerId) ===
            String(this.playerId);
    }


    /* ========================================
     *                UPDATE
     * ======================================== */

    getRenderBoard() {

        const result =
            this.board.map(row => [...row]);

        if (!this.currentPiece) {
            return result;
        }

        for (
            let y = 0;
            y < this.currentPiece.matrix.length;
            y++
        ) {

            for (
                let x = 0;
                x < this.currentPiece.matrix[y].length;
                x++
            ) {

                if (!this.currentPiece.matrix[y][x]) {
                    continue;
                }

                const boardX =
                    this.currentPiece.x + x;

                const boardY =
                    this.currentPiece.y + y;

                if (
                    boardX >= 0 &&
                    boardX < WIDTH &&
                    boardY >= 0 &&
                    boardY < HEIGHT
                ) {
                    result[boardY][boardX] = 1;
                }
            }
        }

        return result;
    }


    getState() {

        return {
            gameId: this.gameId,

            chatId: this.chatId,

            playerId: this.playerId,

            board: this.getRenderBoard(),

            level: this.level,

            lines: this.lines,

            earned: this.earned,

            nextPiece: this.nextPieceType,

            dropSpeed: getSpeed(this.level),

            ended: this.ended,

            settled: this.settled
        };
    }


    update() {

        if (typeof this.onUpdate !== 'function') {
            return;
        }

        try {

            this.onUpdate(
                this.getState()
            );

        } catch (error) {

            /*
             * لا نسمح لخطأ في واجهة البوت
             * بإيقاف محرك اللعبة.
             */
            console.error(
                '[TETRIS] onUpdate error:',
                error
            );
        }
    }


    /* ========================================
     *               SETTLE REWARD
     * ======================================== */

    settleReward() {

        /*
         * حماية أساسية ضد التسوية المزدوجة.
         */
        if (this.settled) {
            return 0;
        }

        this.settled = true;

        const amount = this.earned;

        /*
         * لا يوجد نظام رصيد هنا.
         *
         * سيتم استدعاء onReward عند الربط
         * مع data.js.
         */
        if (
            amount > 0 &&
            typeof this.onReward === 'function'
        ) {

            try {

                this.onReward({
                    gameId: this.gameId,
                    chatId: this.chatId,
                    playerId: this.playerId,
                    amount
                });

            } catch (error) {

                /*
                 * إذا فشل callback، لا نعتبر الرصيد
                 * تمت تسويته فعليًا.
                 *
                 * لذلك نعيد settled إلى false
                 * حتى يستطيع نظام الدمج معالجة الخطأ.
                 */
                this.settled = false;

                throw error;
            }
        }

        return amount;
    }


    /* ========================================
     *                    END
     * ======================================== */

    end(reason = 'game_over') {

        if (this.ended) {
            return false;
        }

        this.ended = true;

        this.stopTimer();

        const earnedBeforeSettlement =
            this.earned;

        /*
         * تسوية الأرباح مرة واحدة.
         */
        let settledAmount = 0;

        try {

            settledAmount =
                this.settleReward();

        } catch (error) {

            console.error(
                '[TETRIS] Reward settlement failed:',
                error
            );

            /*
             * نترك settled=false إذا فشلت عملية
             * الإضافة، حتى يتمكن نظام الدمج
             * من التعامل معها.
             */
        }

        if (typeof this.onEnd === 'function') {

            try {

                this.onEnd({
                    gameId: this.gameId,

                    chatId: this.chatId,

                    playerId: this.playerId,

                    reason,

                    level: this.level,

                    lines: this.lines,

                    earned:
                        earnedBeforeSettlement,

                    settledAmount
                });

            } catch (error) {

                console.error(
                    '[TETRIS] onEnd error:',
                    error
                );
            }
        }

        return true;
    }


    /* ========================================
     *                   STOP
     * ======================================== */

    stop() {

        return this.end('stopped');
    }
}


/* ============================================
 *             GAME REGISTRY
 * ============================================ */

/*
 * Registry منفصل للعبة Tetris.
 *
 * المفتاح:
 * chatId
 *
 * الهدف:
 * منع تشغيل لعبتين Tetris في نفس المجموعة
 * في نفس الوقت.
 */

const activeTetrisGames = new Map();


function getActiveGame(chatId) {

    if (!chatId) {
        return null;
    }

    const game =
        activeTetrisGames.get(String(chatId));

    if (!game) {
        return null;
    }

    if (game.ended) {

        activeTetrisGames.delete(
            String(chatId)
        );

        return null;
    }

    return game;
}


function startTetris({
    chatId,
    playerId,
    onUpdate = null,
    onReward = null,
    onEnd = null
}) {

    const key = String(chatId);

    const existing =
        getActiveGame(key);

    if (existing) {

        return {
            ok: false,
            reason: 'GAME_ALREADY_ACTIVE',
            game: existing
        };
    }

    const game =
        new TetrisGame({
            chatId: key,
            playerId,
            onUpdate,
            onReward,
            onEnd
        });

    activeTetrisGames.set(
        key,
        game
    );

    try {

        game.start();

    } catch (error) {

        activeTetrisGames.delete(key);

        throw error;
    }

    return {
        ok: true,
        game
    };
}


/* ============================================
 *              CONTROL FUNCTIONS
 * ============================================ */

function controlTetris(
    chatId,
    playerId,
    action
) {

    const game =
        getActiveGame(chatId);

    if (!game) {
        return {
            ok: false,
            reason: 'NO_ACTIVE_GAME'
        };
    }

    if (!game.authorized(playerId)) {
        return {
            ok: false,
            reason: 'NOT_GAME_OWNER'
        };
    }

    let changed = false;

    switch (action) {

        case 'left':
            changed = game.moveLeft(playerId);
            break;

        case 'right':
            changed = game.moveRight(playerId);
            break;

        case 'down':
            changed = game.moveDown(playerId);
            break;

        case 'drop':
            changed = game.hardDrop(playerId);
            break;

        case 'rotate':
            changed = game.rotate(playerId);
            break;

        default:
            return {
                ok: false,
                reason: 'UNKNOWN_ACTION'
            };
    }

    return {
        ok: changed,
        reason: changed
            ? null
            : 'ACTION_NOT_APPLIED',
        game
    };
}


/* ============================================
 *                   STOP GAME
 * ============================================ */

function stopTetris(chatId) {

    const key = String(chatId);

    const game =
        getActiveGame(key);

    if (!game) {
        return {
            ok: false,
            reason: 'NO_ACTIVE_GAME'
        };
    }

    /*
     * end() يحتوي على حماية settled.
     */
    game.stop();

    /*
     * نحذفها من registry بعد الإيقاف.
     */
    activeTetrisGames.delete(key);

    return {
        ok: true,

        gameId: game.gameId,

        playerId: game.playerId,

        amount: game.earned,

        settled: game.settled
    };
}


/* ============================================
 *             REMOVE FINISHED GAME
 * ============================================ */

function cleanupTetris(chatId) {

    const key = String(chatId);

    const game =
        activeTetrisGames.get(key);

    if (!game) {
        return false;
    }

    if (!game.ended) {
        return false;
    }

    activeTetrisGames.delete(key);

    return true;
}


/* ============================================
 *                 EXPORTS
 * ============================================ */

module.exports = {

    /*
     * Constants
     */
    WIDTH,
    HEIGHT,
    REWARD_PER_LINE,

    /*
     * Class
     */
    TetrisGame,

    /*
     * Registry
     */
    activeTetrisGames,

    /*
     * Start
     */
    startTetris,

    /*
     * Control
     */
    controlTetris,

    /*
     * Stop
     */
    stopTetris,

    /*
     * Get current game
     */
    getActiveGame,

    /*
     * Cleanup
     */
    cleanupTetris
};