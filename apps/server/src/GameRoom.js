import {
    MSG,
    getStageData,
    TILE_SIZE,
    STAGE_WIDTH,
    STAGE_HEIGHT,
    PLAYER_RADIUS,
    dashStateFromInput,
    stepPlayerKinematics,
    resolvePlayerCollisions,
    PLAYER_HEALTH_MAX,
    BULLET_DAMAGE,
    BULLET_MAX_RANGE,
    ARROW_MIN_DAMAGE,
    ARROW_MAX_DAMAGE,
    ARROW_MAX_RANGE,
} from '@clay-and-blood/shared';

const TICK_MS = 50; // 20 Hz server tick
const LAG_COMP_HISTORY_SIZE = 20; // 1 second of history at 20 Hz

/**
 * Returns the distance along the ray to the first intersection with a circle,
 * or null if there is no intersection within [0, maxRange].
 *
 * @param {number} ox,oy  - Ray origin
 * @param {number} vx,vy  - Ray velocity (not required to be unit-length)
 * @param {number} cx,cy  - Circle centre
 * @param {number} r      - Circle radius
 * @param {number} maxRange
 * @returns {number|null}
 */
function rayHitDistance(ox, oy, vx, vy, cx, cy, r, maxRange) {
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < 0.001) return null;
    const dx = vx / speed;
    const dy = vy / speed;

    // Vector from ray origin to circle centre
    const fx = cx - ox;
    const fy = cy - oy;

    // Scalar projection of that vector onto the ray direction
    const t = fx * dx + fy * dy;
    if (t < 0 || t > maxRange) return null;

    // Closest point on the ray to the circle centre
    const distSq = (fx - t * dx) ** 2 + (fy - t * dy) ** 2;
    if (distSq > r * r) return null;

    return t;
}

/**
 * Resolve a player circle against the wall grid.
 * Pushes the player out of any wall cell it overlaps.
 */
function resolveCollisions(x, y, grid) {
    return resolvePlayerCollisions(x, y, grid);
}

/**
 * GameRoom – Cloudflare Durable Object
 *
 * Authoritative game server. Clients send PLAYER_INPUT; the server runs the
 * physics simulation on a 20 Hz fixed tick (DO alarm) and broadcasts
 * STATE_SNAPSHOT to all clients each tick.
 *
 * Player state is in-memory. The DO stays alive while WebSocket sessions are
 * open (Hibernatable WS API). If the DO is evicted after the last player
 * disconnects the alarm loop stops naturally.
 */
export class GameRoom {
    constructor(state, env) {
        this.state  = state;
        this.env    = env;
        // sessionId -> { x, y, levelId, lastInput, lastSeq }
        this.players = new Map();
        // levelId -> grid (2-D number array, cached)
        this.grids   = new Map();
        this.tickCount = 0;
        // Lag-compensation history: array of { tick, positions: Map<sessionId,{x,y,levelId}> }

    // Capped at LAG_COMP_HISTORY_SIZE entries (sliding window ~1 second).
        this.positionHistory = [];
    }

    // ── Durable Object entry ──────────────────────────────────────────────

    async fetch(request) {
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('Expected WebSocket upgrade', { status: 426 });
        }
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        const sessionId = crypto.randomUUID();
        this.state.acceptWebSocket(server, [sessionId]);
        return new Response(null, { status: 101, webSocket: client });
    }

    // ── Hibernatable WebSocket handlers ──────────────────────────────────

    async webSocketMessage(ws, message) {
        let data;
        try { data = JSON.parse(message); } catch { return; }

        const [sessionId] = this.state.getTags(ws);

        switch (data.type) {

            case MSG.PLAYER_JOIN: {
                const startGrid = this._getGrid('town-square');
                const startW = startGrid ? startGrid[0].length : STAGE_WIDTH;
                const startH = startGrid ? startGrid.length   : STAGE_HEIGHT;
                const spawnX = Math.floor(startW / 2) * TILE_SIZE + TILE_SIZE / 2;
                const spawnY = Math.floor(startH / 2) * TILE_SIZE + TILE_SIZE / 2;

                this.players.set(sessionId, {
                    x:         spawnX,
                    y:         spawnY,
                    levelId:   'town-square',
                    hp:        PLAYER_HEALTH_MAX,
                    lastInput: { up: false, down: false, left: false, right: false, sprint: false, dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
                    lastSeq:   0,
                });

                // Ack the join with the caller's session ID
                ws.send(JSON.stringify({ type: MSG.PLAYER_JOIN, sessionId }));

                // Send the current positions of all OTHER players
                const playerList = [];
                for (const [sid, p] of this.players.entries()) {
                    if (sid !== sessionId) {
                        playerList.push({ sessionId: sid, x: p.x, y: p.y, stageId: p.levelId });
                    }
                }
                ws.send(JSON.stringify({ type: MSG.GAME_STATE, players: playerList }));

                // Notify the others that someone new arrived
                this.#broadcast({ type: MSG.PLAYER_JOIN, sessionId }, ws);

                // Start the tick loop when the first player joins
                if (this.players.size === 1) {
                    await this.state.storage.setAlarm(Date.now() + TICK_MS);
                }
                break;
            }

            case MSG.PLAYER_INPUT: {
                const player = this.players.get(sessionId);
                if (!player) break;

                // Preserve existing dash state unless a new dash is requested
                let { dashVx, dashVy, dashTimeLeftMs } = player.lastInput;

                if (data.dash && dashTimeLeftMs <= 0) {
                    const dash = dashStateFromInput(data);
                    if (dash) {
                        dashVx = dash.dashVx;
                        dashVy = dash.dashVy;
                        dashTimeLeftMs = dash.dashTimeLeftMs;
                    }
                }

                this.players.set(sessionId, {
                    ...player,
                    lastInput: {
                        up:     !!data.up,
                        down:   !!data.down,
                        left:   !!data.left,
                        right:  !!data.right,
                        sprint: !!data.sprint,
                        dashVx,
                        dashVy,
                        dashTimeLeftMs,
                    },
                    lastSeq: data.seq ?? player.lastSeq,
                });
                break;
            }

            case MSG.BULLET_FIRED: {
                const { x, y, velocityX, velocityY, levelId,
                        projectileType, chargeRatio, lastKnownTick } = data;

                // ── Damage amount ────────────────────────────────────────────
                let damage;
                if (projectileType === 'arrow') {
                    const ratio = Math.max(0, Math.min(1, chargeRatio ?? 0));
                    damage = Math.round(ARROW_MIN_DAMAGE + (ARROW_MAX_DAMAGE - ARROW_MIN_DAMAGE) * ratio);
                } else {
                    damage = BULLET_DAMAGE;
                }
                const maxRange = projectileType === 'arrow' ? ARROW_MAX_RANGE : BULLET_MAX_RANGE;

                // ── Lag-compensated hit detection ────────────────────────────
                // Find the snapshot the shooter saw when they fired.
                const snapshot = this._findTickSnapshot(lastKnownTick);
                const posMap = snapshot
                    ? snapshot.positions
                    : new Map(Array.from(this.players.entries()).map(([sid, p]) => [sid, p]));

                let hitSessionId = null;
                let hitT = Infinity;

                for (const [sid, pos] of posMap.entries()) {
                    if (sid === sessionId) continue;      // don't self-hit
                    if (pos.levelId !== levelId) continue; // different level

                    const t = rayHitDistance(x, y, velocityX, velocityY, pos.x, pos.y, PLAYER_RADIUS, maxRange);
                    if (t !== null && t < hitT) {
                        hitT = t;
                        hitSessionId = sid;
                    }
                }

                if (hitSessionId) {
                    const victim = this.players.get(hitSessionId);
                    if (victim) {
                        const newHp  = Math.max(0, victim.hp - damage);
                        const died   = newHp === 0;
                        this.players.set(hitSessionId, {
                            ...victim,
                            hp: died ? PLAYER_HEALTH_MAX : newHp,
                        });
                        this.#broadcastAll({
                            type:       MSG.PLAYER_DAMAGED,
                            sessionId:  hitSessionId,
                            attackerId: sessionId,
                            damage,
                            hp:         died ? PLAYER_HEALTH_MAX : newHp,
                            died,
                        });
                    }
                }

    // ── Relay bullet visually to all other clients ───────────────
                this.#broadcast({
                    type:      MSG.BULLET_FIRED,
                    sessionId,
                    x, y, velocityX, velocityY, levelId,
                }, ws);
                break;
            }

            case MSG.LEVEL_CHANGE: {
                const player = this.players.get(sessionId);
                if (!player) break;

                const levelId = data.levelId;
                const grid    = this._getGrid(levelId);

                // Accept the client's requested spawn position (they ran the same
                // deterministic generator), then resolve against walls just in case.
                const fallbackW = grid ? grid[0].length : STAGE_WIDTH;
                const fallbackH = grid ? grid.length    : STAGE_HEIGHT;
                let x = typeof data.x === 'number' ? data.x : (Math.floor(fallbackW / 2) * TILE_SIZE + TILE_SIZE / 2);
                let y = typeof data.y === 'number' ? data.y : (Math.floor(fallbackH / 2) * TILE_SIZE + TILE_SIZE / 2);
                if (grid) ({ x, y } = resolveCollisions(x, y, grid));

                this.players.set(sessionId, {
                    ...player,
                    levelId,
                    x, y,
                    lastInput: { up: false, down: false, left: false, right: false, sprint: false, dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
                });

                this.#broadcast({ type: MSG.LEVEL_CHANGE, sessionId, levelId }, ws);
                break;
            }

            default:
                break;
        }
    }

    async webSocketClose(ws, code, reason) {
        const [sessionId] = this.state.getTags(ws);
        this.players.delete(sessionId);
        this.#broadcast({ type: MSG.PLAYER_LEAVE, sessionId }, ws);
        ws.close(code, reason);
    }

    async webSocketError(ws) {
        const [sessionId] = this.state.getTags(ws);
        this.players.delete(sessionId);
        this.#broadcast({ type: MSG.PLAYER_LEAVE, sessionId }, ws);
        ws.close(1011, 'WebSocket error');
    }

    // ── DO Alarm – physics tick ───────────────────────────────────────────

    async alarm() {
        if (this.players.size === 0) return; // no players – let loop die

        this._runTick();

        // Reschedule
        await this.state.storage.setAlarm(Date.now() + TICK_MS);
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    _runTick() {
        for (const [sessionId, player] of this.players.entries()) {
            const { lastInput } = player;
            const grid = this._getGrid(player.levelId);
            const stepped = stepPlayerKinematics(
                {
                    x: player.x,
                    y: player.y,
                    dashVx: lastInput.dashVx,
                    dashVy: lastInput.dashVy,
                    dashTimeLeftMs: lastInput.dashTimeLeftMs,
                },
                lastInput,
                TICK_MS,
                grid
            );

            this.players.set(sessionId, {
                ...player,
                x: stepped.x,
                y: stepped.y,
                lastInput: {
                    ...lastInput,
                    dashVx: stepped.dashVx,
                    dashVy: stepped.dashVy,
                    dashTimeLeftMs: stepped.dashTimeLeftMs,
                },
            });
        }

    // Build authoritative snapshot list and push lag-compensation history
        const players = [];
        const historyPositions = new Map();
        for (const [sessionId, p] of this.players.entries()) {
            players.push({
                sessionId,
                x:       p.x,
                y:       p.y,
                levelId: p.levelId,
                seq:     p.lastSeq,
            });
            historyPositions.set(sessionId, { x: p.x, y: p.y, levelId: p.levelId });
        }

        this.positionHistory.push({ tick: this.tickCount, positions: historyPositions });
        if (this.positionHistory.length > LAG_COMP_HISTORY_SIZE) {
            this.positionHistory.shift();
        }

        this.#broadcastAll({
            type:    MSG.STATE_SNAPSHOT,
            tick:    this.tickCount++,
            players,
        });
    }

    /**
     * Find the position-history snapshot for the given tick number.
     * Falls back to the most-recent snapshot if the tick is not in the buffer
     * (e.g. the client is slightly behind or the buffer has been trimmed).
     * @param {number|undefined} tick
     * @returns {{ tick: number, positions: Map }|null}
     */
    _findTickSnapshot(tick) {
        if (this.positionHistory.length === 0) return null;
        if (tick == null) return this.positionHistory[this.positionHistory.length - 1];

        for (let i = this.positionHistory.length - 1; i >= 0; i--) {
            if (this.positionHistory[i].tick === tick) return this.positionHistory[i];
        }

    // Tick not found – return the closest one by tick distance
        let best = this.positionHistory[0];
        let bestDiff = Math.abs(best.tick - tick);
        for (const snap of this.positionHistory) {
            const diff = Math.abs(snap.tick - tick);
            if (diff < bestDiff) { bestDiff = diff; best = snap; }
        }
        return best;
    }

    /** Return (and cache) the wall grid for a level. */
    _getGrid(levelId) {
        if (!this.grids.has(levelId)) {
            const { grid } = getStageData(levelId);
            this.grids.set(levelId, grid);
        }
        return this.grids.get(levelId);
    }

    /** Broadcast to all sessions except one optional exclusion. */
    #broadcast(data, exclude) {
        const message = JSON.stringify(data);
        for (const ws of this.state.getWebSockets()) {
            if (ws !== exclude) {
                try { ws.send(message); } catch { /* session closing */ }
            }
        }
    }

    /** Broadcast to every connected session. */
    #broadcastAll(data) {
        const message = JSON.stringify(data);
        for (const ws of this.state.getWebSockets()) {
            try { ws.send(message); } catch { /* session closing */ }
        }
    }
}
