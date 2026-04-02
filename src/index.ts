const moduleName = "tic_tac_toe";

const Mark = {
    UNDEFINED: 0,
    X: 1,
    O: 2,
    DRAW: 3
} as const;

type MarkValue = typeof Mark[keyof typeof Mark];

const OpCodes = {
    UPDATE_STATE: 1,
    MOVE: 2,
    GAME_OVER: 3,
    REJECT_MOVE: 4,
    REFRESH_STATE: 5
};

const TURN_TIMEOUT_SEC = 30;

function matchInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: string }): { state: nkruntime.MatchState, tickRate: number, label: string } {
    logger.info('TIC-TAC-TOE: Match initialized');
    const state = {
        presences: {} as { [userId: string]: nkruntime.Presence },
        emptyTicks: 0,
        board: new Array(9).fill(Mark.UNDEFINED) as MarkValue[],
        marks: {} as { [userId: string]: MarkValue },
        activePlayer: Mark.UNDEFINED as MarkValue,
        turnDeadline: 0,
        winner: Mark.UNDEFINED as MarkValue
    };
    return {
        state,
        tickRate: 1,
        label: moduleName
    };
}

function matchJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presence: nkruntime.Presence, metadata: { [key: string]: any }): { state: nkruntime.MatchState, accept: boolean, rejectMessage?: string } {
    logger.info('TIC-TAC-TOE: Match join attempt: %s', presence.userId);
    const s = state as any;
    if (Object.keys(s.presences).length >= 2 && !s.presences[presence.userId]) {
        logger.info('TIC-TAC-TOE: Match full, rejecting %s', presence.userId);
        return { state, accept: false, rejectMessage: 'Match is full' };
    }
    return { state, accept: true };
}

function matchJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence[]): { state: nkruntime.MatchState } {
    const s = state as any;

    for (const presence of presences) {
        if (!s.presences[presence.userId]) {
            const currentCount = Object.keys(s.presences).length;
            s.presences[presence.userId] = presence;

            if (currentCount === 0) s.marks[presence.userId] = Mark.X;
            else if (currentCount === 1) s.marks[presence.userId] = Mark.O;

            logger.info('TIC-TAC-TOE: Player %s joined, mark assigned: %v', presence.userId, s.marks[presence.userId]);
        }

        // Immediate sync for new player
        logger.info('TIC-TAC-TOE: Sending initial state to joiner: %s', presence.userId);
        dispatcher.broadcastMessage(OpCodes.UPDATE_STATE, JSON.stringify({
            board: s.board,
            marks: s.marks,
            activePlayer: s.activePlayer,
            turnDeadline: s.turnDeadline
        }), [presence]);
    }

    if (Object.keys(s.presences).length === 2 && s.activePlayer === Mark.UNDEFINED) {
        s.activePlayer = Math.random() < 0.5 ? Mark.X : Mark.O;
        s.turnDeadline = Date.now() + (TURN_TIMEOUT_SEC * 1000);
        logger.info('TIC-TAC-TOE: Match starting! Active player: %v', s.activePlayer);

        dispatcher.broadcastMessage(OpCodes.UPDATE_STATE, JSON.stringify({
            board: s.board,
            marks: s.marks,
            activePlayer: s.activePlayer,
            turnDeadline: s.turnDeadline
        }));
    }

    return { state: s };
}

function matchLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence[]): { state: nkruntime.MatchState } {
    const s = state as any;
    for (const presence of presences) {
        logger.info('TIC-TAC-TOE: Player left: %s', presence.userId);
        delete s.presences[presence.userId];
    }

    if (s.winner === Mark.UNDEFINED && Object.keys(s.presences).length < 2) {
        const remainingUserId = Object.keys(s.presences)[0];
        if (remainingUserId && s.marks[remainingUserId]) {
            s.winner = s.marks[remainingUserId];
            logger.info('TIC-TAC-TOE: Opponent left, winner by default: %s', remainingUserId);
            dispatcher.broadcastMessage(OpCodes.GAME_OVER, JSON.stringify({ board: s.board, winner: s.winner, reason: 'opponent_left' }));
            updateLeaderboard(nk, logger, remainingUserId, true);
        }
    }
    return { state: s };
}

function checkWin(board: MarkValue[]): MarkValue {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];
    for (const line of lines) {
        const [a, b, c] = line;
        if (board[a] !== Mark.UNDEFINED && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    if (board.every(cell => cell !== Mark.UNDEFINED)) return 3 as any; // DRAW
    return Mark.UNDEFINED;
}

function updateLeaderboard(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, win: boolean) {
    try {
        nk.leaderboardRecordWrite("tictactoe_wins", userId, userId, win ? 1 : 0);
    } catch (error) {
        logger.error('TIC-TAC-TOE: Leaderboard error: %s', error);
    }
}

function matchLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, messages: nkruntime.MatchMessage[]): { state: nkruntime.MatchState } | null {
    const s = state as any;
    if (Object.keys(s.presences).length === 0) {
        s.emptyTicks++;
        if (s.emptyTicks > 20) return null;
    } else s.emptyTicks = 0;

    for (const message of messages) {
        if (message.opCode === OpCodes.REFRESH_STATE) {
            logger.info('TIC-TAC-TOE: Received REFRESH_STATE from %s', message.sender.userId);
            dispatcher.broadcastMessage(OpCodes.UPDATE_STATE, JSON.stringify({
                board: s.board,
                marks: s.marks,
                activePlayer: s.activePlayer,
                turnDeadline: s.turnDeadline
            }), [message.sender]);
            continue;
        }

        if (s.winner !== Mark.UNDEFINED) continue;

        if (message.opCode === OpCodes.MOVE) {
            const senderMark = s.marks[message.sender.userId];
            if (s.activePlayer !== senderMark) {
                logger.info('TIC-TAC-TOE: Move rejected (not turn): %s', message.sender.userId);
                dispatcher.broadcastMessage(OpCodes.REJECT_MOVE, JSON.stringify({ error: "Not your turn" }), [message.sender]);
                continue;
            }

            const data = JSON.parse(nk.binaryToString(message.data));
            const position = data.position;
            if (position < 0 || position > 8 || s.board[position] !== Mark.UNDEFINED) {
                logger.info('TIC-TAC-TOE: Move rejected (invalid position): %v', position);
                dispatcher.broadcastMessage(OpCodes.REJECT_MOVE, JSON.stringify({ error: "Invalid move" }), [message.sender]);
                continue;
            }

            s.board[position] = senderMark;
            const winner = checkWin(s.board);
            if (winner !== Mark.UNDEFINED) {
                s.winner = winner;
                logger.info('TIC-TAC-TOE: Game over! Winner: %v', winner);
                dispatcher.broadcastMessage(OpCodes.GAME_OVER, JSON.stringify({ board: s.board, winner: s.winner, reason: 'win' }));

                const winnerPlayer = Object.values(s.presences).find(p => (s as any).marks[(p as any).userId] === winner) as any;
                if (winnerPlayer && winner !== 3) {
                    updateLeaderboard(nk, logger, winnerPlayer.userId, true);
                }
            } else {
                s.activePlayer = s.activePlayer === Mark.X ? Mark.O : Mark.X;
                s.turnDeadline = Date.now() + (TURN_TIMEOUT_SEC * 1000);
                logger.info('TIC-TAC-TOE: Turn advanced to mark: %v', s.activePlayer);
                dispatcher.broadcastMessage(OpCodes.UPDATE_STATE, JSON.stringify({ board: s.board, activePlayer: s.activePlayer, turnDeadline: s.turnDeadline }));
            }
        }
    }

    if (s.winner === Mark.UNDEFINED && s.activePlayer !== Mark.UNDEFINED) {
        if (Date.now() > s.turnDeadline) {
            s.winner = s.activePlayer === Mark.X ? Mark.O : Mark.X;
            logger.info('TIC-TAC-TOE: Timeout! Winner by default: %v', s.winner);
            dispatcher.broadcastMessage(OpCodes.GAME_OVER, JSON.stringify({ board: s.board, winner: s.winner, reason: 'timeout' }));

            const winnerPlayer = Object.values(s.presences).find(p => (s as any).marks[(p as any).userId] === s.winner) as any;
            if (winnerPlayer) {
                updateLeaderboard(nk, logger, winnerPlayer.userId, true);
            }
        }
    }

    return { state: s };
}

function matchTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, graceSeconds: number): { state: nkruntime.MatchState } {
    return { state };
}

function matchSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, data: string): { state: nkruntime.MatchState, data: string } {
    return { state, data: "" };
}

function matchmakerMatched(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]): string {
    try {
        const matchId = nk.matchCreate(moduleName, {});
        return matchId;
    } catch (e) {
        logger.error('TIC-TAC-TOE: Error creating match: %s', e);
        return "";
    }
}

function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
    logger.info("TIC-TAC-TOE: Module loaded.");
    initializer.registerMatch(moduleName, {
        matchInit,
        matchJoinAttempt,
        matchJoin,
        matchLeave,
        matchLoop,
        matchTerminate,
        matchSignal
    });

    initializer.registerMatchmakerMatched(matchmakerMatched);


    try {
        nk.leaderboardCreate("tictactoe_wins", true, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.INCREMENTAL, "0 0 * * 1", {});
        logger.info("TIC-TAC-TOE: Leaderboard created.");
    } catch (err) {
        logger.error('TIC-TAC-TOE: Leaderboard error: %s', err);
    }
}
