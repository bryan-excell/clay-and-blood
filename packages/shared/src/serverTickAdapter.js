import { stepPlayerKinematics } from './index.js';

/**
 * Phase 1: capture input/intent entries from server player state.
 * @param {Map<string, object>} players
 * @param {(levelId: string) => number[][]} getGrid
 * @returns {Array<{sessionId:string, player:object, intent:object, motion:object, grid:number[][]}>}
 */
export function phaseInputIntent(players, getGrid) {
    const entries = [];
    for (const [sessionId, player] of players.entries()) {
        entries.push({
            sessionId,
            player,
            intent: player.intent,
            motion: player.motion,
            grid: getGrid(player.transform.levelId),
        });
    }
    return entries;
}

/**
 * Phase 2: run locomotion + dash simulation.
 * @param {Array<{sessionId:string, player:object, intent:object, motion:object, grid:number[][]}>} inputEntries
 * @param {number} tickMs
 * @returns {Array<{sessionId:string, player:object, stepped:object}>}
 */
export function phaseLocomotionDash(inputEntries, tickMs) {
    return inputEntries.map(({ sessionId, player, intent, motion, grid }) => {
        const stepped = stepPlayerKinematics(
            {
                x: player.transform.x,
                y: player.transform.y,
                dashVx: motion.dashVx,
                dashVy: motion.dashVy,
                dashTimeLeftMs: motion.dashTimeLeftMs,
            },
            intent,
            tickMs,
            grid
        );
        return { sessionId, player, stepped };
    });
}

/**
 * Phase 3/4: apply simulation result to transform + motion components.
 * @param {Map<string, object>} players
 * @param {Array<{sessionId:string, player:object, stepped:object}>} locomotionEntries
 */
export function phasePhysicsTransform(players, locomotionEntries) {
    for (const { sessionId, player, stepped } of locomotionEntries) {
        players.set(sessionId, {
            ...player,
            transform: {
                ...player.transform,
                x: stepped.x,
                y: stepped.y,
            },
            motion: {
                ...player.motion,
                dashVx: stepped.dashVx,
                dashVy: stepped.dashVy,
                dashTimeLeftMs: stepped.dashTimeLeftMs,
            },
        });
    }
}

/**
 * Phase 5: build snapshot payload from authoritative state.
 * @param {Map<string, object>} players
 * @returns {Array<{sessionId:string,x:number,y:number,levelId:string,seq:number,teamId:string|null,sightRadius:number|null}>}
 */
export function phaseBuildSnapshotPlayers(players) {
    const snapshotPlayers = [];
    for (const [sessionId, p] of players.entries()) {
        snapshotPlayers.push({
            sessionId,
            x: p.transform.x,
            y: p.transform.y,
            levelId: p.transform.levelId,
            seq: p.net.lastSeq,
            teamId: typeof p.teamId === 'string' ? p.teamId : null,
            sightRadius: Number.isFinite(p.sightRadius) ? p.sightRadius : null,
        });
    }
    return snapshotPlayers;
}

/**
 * Phase 6: build lag-compensation history map for current authoritative state.
 * @param {Map<string, object>} players
 * @returns {Map<string, {x:number,y:number,levelId:string}>}
 */
export function phaseBuildHistoryPositions(players) {
    const historyPositions = new Map();
    for (const [sessionId, p] of players.entries()) {
        historyPositions.set(sessionId, {
            x: p.transform.x,
            y: p.transform.y,
            levelId: p.transform.levelId,
        });
    }
    return historyPositions;
}
