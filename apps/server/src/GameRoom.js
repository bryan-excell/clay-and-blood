import {
    MSG,
    getStageData,
    TILE_SIZE,
    STAGE_WIDTH,
    STAGE_HEIGHT,
    PLAYER_RADIUS,
    PLAYER_SPEED,
    PLAYER_SPRINT_MULTIPLIER,
    PLAYER_DASH_SPEED,
    PLAYER_DASH_DURATION,
} from '@clay-and-blood/shared';

const TICK_MS = 50; // 20 Hz server tick

/**
 * Resolve a player circle against the wall grid.
 * Pushes the player out of any wall cell it overlaps.
 */
function resolveCollisions(x, y, grid) {
    const r = PLAYER_RADIUS;
    const gridH = grid.length;
    const gridW = gridH > 0 ? grid[0].length : 0;
    const cellX = Math.floor(x / TILE_SIZE);
    const cellY = Math.floor(y / TILE_SIZE);

    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const nx = cellX + dx;
            const ny = cellY + dy;
            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
            if (grid[ny][nx] !== 1) continue; // not a wall

            const rLeft  = nx * TILE_SIZE;
            const rTop   = ny * TILE_SIZE;
            const rRight = rLeft + TILE_SIZE;
            const rBot   = rTop  + TILE_SIZE;

            const nearX  = Math.max(rLeft, Math.min(x, rRight));
            const nearY  = Math.max(rTop,  Math.min(y, rBot));
            const distX  = x - nearX;
            const distY  = y - nearY;
            const dist   = Math.sqrt(distX * distX + distY * distY);

            if (dist < r) {
                if (dist === 0) {
                    y -= r; // stuck inside wall, eject upward
                } else {
                    const overlap = r - dist;
                    x += (distX / dist) * overlap;
                    y += (distY / dist) * overlap;
                }
            }
        }
    }

    // Clamp to world bounds using actual grid dimensions
    x = Math.max(r, Math.min(gridW * TILE_SIZE - r, x));
    y = Math.max(r, Math.min(gridH * TILE_SIZE - r, y));
    return { x, y };
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
                    lastInput: { up: false, down: false, left: false, right: false, sprint: false, dashVx: 0, dashVy: 0, dashTicksLeft: 0 },
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
                let { dashVx, dashVy, dashTicksLeft } = player.lastInput;

                if (data.dash && dashTicksLeft === 0) {
                    // Compute dash direction from the held movement keys
                    let dvx = 0, dvy = 0;
                    if (data.left)  dvx -= 1;
                    if (data.right) dvx += 1;
                    if (data.up)    dvy -= 1;
                    if (data.down)  dvy += 1;
                    if (dvx !== 0 && dvy !== 0) {
                        const len = Math.sqrt(dvx * dvx + dvy * dvy);
                        dvx /= len;
                        dvy /= len;
                    }
                    if (dvx !== 0 || dvy !== 0) {
                        dashVx = dvx * PLAYER_DASH_SPEED;
                        dashVy = dvy * PLAYER_DASH_SPEED;
                        dashTicksLeft = Math.ceil(PLAYER_DASH_DURATION / TICK_MS);
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
                        dashTicksLeft,
                    },
                    lastSeq: data.seq ?? player.lastSeq,
                });
                break;
            }

            case MSG.BULLET_FIRED: {
                // Relay bullet to all other clients in the same level
                this.#broadcast({
                    type:      MSG.BULLET_FIRED,
                    sessionId,
                    x:         data.x,
                    y:         data.y,
                    velocityX: data.velocityX,
                    velocityY: data.velocityY,
                    levelId:   data.levelId,
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
                    lastInput: { up: false, down: false, left: false, right: false, sprint: false, dashVx: 0, dashVy: 0, dashTicksLeft: 0 },
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
        const dt = TICK_MS / 1000; // seconds per tick

        for (const [sessionId, player] of this.players.entries()) {
            const { lastInput } = player;

            let vx = 0, vy = 0;
            let newDashTicksLeft = lastInput.dashTicksLeft;

            if (lastInput.dashTicksLeft > 0) {
                // Currently dashing – use stored dash velocity
                vx = lastInput.dashVx;
                vy = lastInput.dashVy;
                newDashTicksLeft--;
            } else {
                // Normal movement
                if (lastInput.left)  vx -= 1;
                if (lastInput.right) vx += 1;
                if (lastInput.up)    vy -= 1;
                if (lastInput.down)  vy += 1;

                if (vx !== 0 && vy !== 0) {
                    const len = Math.sqrt(vx * vx + vy * vy);
                    vx /= len;
                    vy /= len;
                }

                const speed = lastInput.sprint
                    ? PLAYER_SPEED * PLAYER_SPRINT_MULTIPLIER
                    : PLAYER_SPEED;
                vx *= speed;
                vy *= speed;
            }

            let newX = player.x + vx * dt;
            let newY = player.y + vy * dt;

            const grid = this._getGrid(player.levelId);
            if (grid) ({ x: newX, y: newY } = resolveCollisions(newX, newY, grid));

            this.players.set(sessionId, {
                ...player,
                x: newX,
                y: newY,
                lastInput: { ...lastInput, dashTicksLeft: newDashTicksLeft },
            });
        }

        // Build and broadcast the authoritative snapshot
        const players = [];
        for (const [sessionId, p] of this.players.entries()) {
            players.push({
                sessionId,
                x:       p.x,
                y:       p.y,
                levelId: p.levelId,
                seq:     p.lastSeq,
            });
        }

        this.#broadcastAll({
            type:    MSG.STATE_SNAPSHOT,
            tick:    this.tickCount++,
            players,
        });
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
