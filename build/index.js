"use strict";
var moduleName = "tic_tac_toe";
var Mark = {
    UNDEFINED: 0,
    X: 1,
    O: 2,
    DRAW: 3
};
var OpCodes = {
    UPDATE_STATE: 1,
    MOVE: 2,
    GAME_OVER: 3,
    REJECT_MOVE: 4,
    REFRESH_STATE: 5
};
var TURN_TIMEOUT_SEC = 30;
function matchInit(ctx, logger, nk, params) {
    logger.info('TIC-TAC-TOE: Match initialized');
    var state = {
        presences: {},
        emptyTicks: 0,
        board: new Array(9).fill(Mark.UNDEFINED),
        marks: {},
        activePlayer: Mark.UNDEFINED,
        turnDeadline: 0,
        winner: Mark.UNDEFINED
    };
    return {
        state: state,
        tickRate: 1,
        label: moduleName
    };
}
function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
    logger.info('TIC-TAC-TOE: Match join attempt: %s', presence.userId);
    var s = state;
    if (Object.keys(s.presences).length >= 2 && !s.presences[presence.userId]) {
        logger.info('TIC-TAC-TOE: Match full, rejecting %s', presence.userId);
        return { state: state, accept: false, rejectMessage: 'Match is full' };
    }
    return { state: state, accept: true };
}
function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
    var s = state;
    for (var _i = 0, presences_1 = presences; _i < presences_1.length; _i++) {
        var presence = presences_1[_i];
        if (!s.presences[presence.userId]) {
            var currentCount = Object.keys(s.presences).length;
            s.presences[presence.userId] = presence;
            if (currentCount === 0)
                s.marks[presence.userId] = Mark.X;
            else if (currentCount === 1)
                s.marks[presence.userId] = Mark.O;
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
function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
    var s = state;
    for (var _i = 0, presences_2 = presences; _i < presences_2.length; _i++) {
        var presence = presences_2[_i];
        logger.info('TIC-TAC-TOE: Player left: %s', presence.userId);
        delete s.presences[presence.userId];
    }
    if (s.winner === Mark.UNDEFINED && Object.keys(s.presences).length < 2) {
        var remainingUserId = Object.keys(s.presences)[0];
        if (remainingUserId && s.marks[remainingUserId]) {
            s.winner = s.marks[remainingUserId];
            logger.info('TIC-TAC-TOE: Opponent left, winner by default: %s', remainingUserId);
            dispatcher.broadcastMessage(OpCodes.GAME_OVER, JSON.stringify({ board: s.board, winner: s.winner, reason: 'opponent_left' }));
            updateLeaderboard(nk, logger, remainingUserId, true);
        }
    }
    return { state: s };
}
function checkWin(board) {
    var lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];
    for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
        var line = lines_1[_i];
        var a = line[0], b = line[1], c = line[2];
        if (board[a] !== Mark.UNDEFINED && board[a] === board[b] && board[a] === board[c])
            return board[a];
    }
    if (board.every(function (cell) { return cell !== Mark.UNDEFINED; }))
        return 3; // DRAW
    return Mark.UNDEFINED;
}
function updateLeaderboard(nk, logger, userId, win) {
    try {
        nk.leaderboardRecordWrite("tictactoe_wins", userId, userId, win ? 1 : 0);
    }
    catch (error) {
        logger.error('TIC-TAC-TOE: Leaderboard error: %s', error);
    }
}
function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
    var s = state;
    if (Object.keys(s.presences).length === 0) {
        s.emptyTicks++;
        if (s.emptyTicks > 20)
            return null;
    }
    else
        s.emptyTicks = 0;
    var _loop_1 = function (message) {
        if (message.opCode === OpCodes.REFRESH_STATE) {
            logger.info('TIC-TAC-TOE: Received REFRESH_STATE from %s', message.sender.userId);
            dispatcher.broadcastMessage(OpCodes.UPDATE_STATE, JSON.stringify({
                board: s.board,
                marks: s.marks,
                activePlayer: s.activePlayer,
                turnDeadline: s.turnDeadline
            }), [message.sender]);
            return "continue";
        }
        if (s.winner !== Mark.UNDEFINED)
            return "continue";
        if (message.opCode === OpCodes.MOVE) {
            var senderMark = s.marks[message.sender.userId];
            if (s.activePlayer !== senderMark) {
                logger.info('TIC-TAC-TOE: Move rejected (not turn): %s', message.sender.userId);
                dispatcher.broadcastMessage(OpCodes.REJECT_MOVE, JSON.stringify({ error: "Not your turn" }), [message.sender]);
                return "continue";
            }
            var data = JSON.parse(nk.binaryToString(message.data));
            var position = data.position;
            if (position < 0 || position > 8 || s.board[position] !== Mark.UNDEFINED) {
                logger.info('TIC-TAC-TOE: Move rejected (invalid position): %v', position);
                dispatcher.broadcastMessage(OpCodes.REJECT_MOVE, JSON.stringify({ error: "Invalid move" }), [message.sender]);
                return "continue";
            }
            s.board[position] = senderMark;
            var winner_1 = checkWin(s.board);
            if (winner_1 !== Mark.UNDEFINED) {
                s.winner = winner_1;
                logger.info('TIC-TAC-TOE: Game over! Winner: %v', winner_1);
                dispatcher.broadcastMessage(OpCodes.GAME_OVER, JSON.stringify({ board: s.board, winner: s.winner, reason: 'win' }));
                var winnerPlayer = Object.values(s.presences).find(function (p) { return s.marks[p.userId] === winner_1; });
                if (winnerPlayer && winner_1 !== 3) {
                    updateLeaderboard(nk, logger, winnerPlayer.userId, true);
                }
            }
            else {
                s.activePlayer = s.activePlayer === Mark.X ? Mark.O : Mark.X;
                s.turnDeadline = Date.now() + (TURN_TIMEOUT_SEC * 1000);
                logger.info('TIC-TAC-TOE: Turn advanced to mark: %v', s.activePlayer);
                dispatcher.broadcastMessage(OpCodes.UPDATE_STATE, JSON.stringify({ board: s.board, activePlayer: s.activePlayer, turnDeadline: s.turnDeadline }));
            }
        }
    };
    for (var _i = 0, messages_1 = messages; _i < messages_1.length; _i++) {
        var message = messages_1[_i];
        _loop_1(message);
    }
    if (s.winner === Mark.UNDEFINED && s.activePlayer !== Mark.UNDEFINED) {
        if (Date.now() > s.turnDeadline) {
            s.winner = s.activePlayer === Mark.X ? Mark.O : Mark.X;
            logger.info('TIC-TAC-TOE: Timeout! Winner by default: %v', s.winner);
            dispatcher.broadcastMessage(OpCodes.GAME_OVER, JSON.stringify({ board: s.board, winner: s.winner, reason: 'timeout' }));
            var winnerPlayer = Object.values(s.presences).find(function (p) { return s.marks[p.userId] === s.winner; });
            if (winnerPlayer) {
                updateLeaderboard(nk, logger, winnerPlayer.userId, true);
            }
        }
    }
    return { state: s };
}
function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
    return { state: state };
}
function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
    return { state: state, data: "" };
}
function matchmakerMatched(ctx, logger, nk, matches) {
    try {
        var matchId = nk.matchCreate(moduleName, {});
        return matchId;
    }
    catch (e) {
        logger.error('TIC-TAC-TOE: Error creating match: %s', e);
        return "";
    }
}
function InitModule(ctx, logger, nk, initializer) {
    logger.info("TIC-TAC-TOE: Module loaded.");
    initializer.registerMatch(moduleName, {
        matchInit: matchInit,
        matchJoinAttempt: matchJoinAttempt,
        matchJoin: matchJoin,
        matchLeave: matchLeave,
        matchLoop: matchLoop,
        matchTerminate: matchTerminate,
        matchSignal: matchSignal
    });
    initializer.registerMatchmakerMatched(matchmakerMatched);
    try {
        nk.leaderboardCreate("tictactoe_wins", true, "descending" /* nkruntime.SortOrder.DESCENDING */, "increment" /* nkruntime.Operator.INCREMENTAL */, "0 0 * * 1", {});
        logger.info("TIC-TAC-TOE: Leaderboard created.");
    }
    catch (err) {
        logger.error('TIC-TAC-TOE: Leaderboard error: %s', err);
    }
}
