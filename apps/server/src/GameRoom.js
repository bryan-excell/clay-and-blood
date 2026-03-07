import {
    MSG,
    STATIC_EXIT_CONNECTIONS,
    getStageData,
    resolveExitTransition,
    resolveExitSpawnPosition,
    TILE_SIZE,
    STAGE_WIDTH,
    STAGE_HEIGHT,
    PLAYER_RADIUS,
    dashStateFromInput,
    resolvePlayerCollisions,
    PLAYER_HEALTH_MAX,
    BULLET_DAMAGE,
    BULLET_MAX_RANGE,
    ARROW_MIN_DAMAGE,
    ARROW_MAX_DAMAGE,
    ARROW_MAX_RANGE,
} from '@clay-and-blood/shared';
import {
    phaseInputIntent,
    phaseLocomotionDash,
    phasePhysicsTransform,
    phaseBuildSnapshotPlayers,
    phaseBuildHistoryPositions,
} from '@clay-and-blood/shared/server-tick';

const TICK_MS = 50; // 20 Hz server tick
const LAG_COMP_HISTORY_SIZE = 20; // 1 second of history at 20 Hz
const POSSESSION_DURATION_MS = 8000;
const DEBUG_WORLD_SYNC = false;
const PRACTICE_GOLEM_KEY = 'world:golem';
const PRACTICE_GOLEM_STAGE = 'town-square';
const PRACTICE_GOLEM_TILE_X = 24;
const PRACTICE_GOLEM_TILE_Y = 20;
const EQUIP_ID_PATTERN = /^[a-z0-9_-]{1,32}$/i;
const ENTITY_KEY_PATTERN = /^(player:[a-z0-9-]{1,64}|world:[a-z0-9_-]{1,64})$/i;

function sanitizeEquipId(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!EQUIP_ID_PATTERN.test(trimmed)) return null;
    return trimmed;
}

function sanitizeEquippedPayload(equipped) {
    if (!equipped || typeof equipped !== 'object') return null;
    return {
        weaponId: sanitizeEquipId(equipped.weaponId),
        spellId: sanitizeEquipId(equipped.spellId),
        armorSetId: sanitizeEquipId(equipped.armorSetId),
        accessoryId: sanitizeEquipId(equipped.accessoryId),
    };
}

function sanitizeEntityKey(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!ENTITY_KEY_PATTERN.test(trimmed)) return null;
    return trimmed;
}

function sanitizeDirection(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'north' || normalized === 'east' || normalized === 'south' || normalized === 'west') {
        return normalized;
    }
    return null;
}

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
        // sessionId -> component-like state:
        // {
        //   transform: { x, y, levelId },
        //   intent:    { up, down, left, right, sprint },
        //   motion:    { dashVx, dashVy, dashTimeLeftMs },
        //   stats:     { hp },
        //   net:       { lastSeq }
        // }
        this.players = new Map();
        this.entityEquips = new Map(); // entityKey -> { entityKey, levelId, equipped, ownerSessionId }
        this.worldEntities = new Map(); // entityKey -> { entityKey, x, y, levelId, controllerSessionId }
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
                this._ensurePracticeGolem();
                const startGrid = this._getGrid('town-square');
                const startW = startGrid ? startGrid[0].length : STAGE_WIDTH;
                const startH = startGrid ? startGrid.length   : STAGE_HEIGHT;
                const spawnX = Math.floor(startW / 2) * TILE_SIZE + TILE_SIZE / 2;
                const spawnY = Math.floor(startH / 2) * TILE_SIZE + TILE_SIZE / 2;

                this.players.set(sessionId, {
                    transform: { x: spawnX, y: spawnY, levelId: 'town-square' },
                    intent:    { up: false, down: false, left: false, right: false, sprint: false },
                    motion:    { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
                    stats:     { hp: PLAYER_HEALTH_MAX },
                    net:       { lastSeq: 0 },
                    equipped:  null, // populated on first PLAYER_EQUIP message
                    controlledEntityKey: `player:${sessionId}`,
                    returnEntityKey: `player:${sessionId}`,
                });

                // Ack the join with the caller's session ID
                ws.send(JSON.stringify({ type: MSG.PLAYER_JOIN, sessionId }));

                // Send the current positions of all OTHER players
                const playerList = [];
                for (const [sid, p] of this.players.entries()) {
                    if (sid !== sessionId) {
                        playerList.push({
                            sessionId: sid,
                            x: p.transform.x,
                            y: p.transform.y,
                            stageId: p.transform.levelId
                        });
                    }
                }
                ws.send(JSON.stringify({ type: MSG.GAME_STATE, players: playerList }));
                ws.send(JSON.stringify({
                    type: MSG.WORLD_STATE,
                    scope: 'all',
                    entities: Array.from(this.worldEntities.values()).map((entry) => ({
                        ...entry,
                        possessionMsRemaining: Number.isFinite(entry.possessionEndAtMs)
                            ? Math.max(0, entry.possessionEndAtMs - Date.now())
                            : null,
                    })),
                }));

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
                let { dashVx, dashVy, dashTimeLeftMs } = player.motion;

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
                    intent: {
                        up:     !!data.up,
                        down:   !!data.down,
                        left:   !!data.left,
                        right:  !!data.right,
                        sprint: !!data.sprint,
                    },
                    motion: {
                        dashVx,
                        dashVy,
                        dashTimeLeftMs,
                    },
                    net: { ...player.net, lastSeq: data.seq ?? player.net.lastSeq },
                });
                break;
            }

            case MSG.PLAYER_EQUIP: {
                const player = this.players.get(sessionId);
                const entityKey = sanitizeEntityKey(data.entityKey);
                const sanitized = sanitizeEquippedPayload(data.equipped);
                const levelId = typeof data.levelId === 'string' ? data.levelId : null;
                if (!player || !entityKey || !sanitized) break;
                const equipState = { entityKey, levelId, equipped: sanitized, ownerSessionId: sessionId };
                this.entityEquips.set(entityKey, equipState);
                this.players.set(sessionId, { ...player, equipped: sanitized });
                this.#broadcast({
                    type: MSG.PLAYER_EQUIP,
                    sessionId,
                    entityKey,
                    levelId,
                    equipped: sanitized,
                }, ws);
                break;
            }

            case MSG.POSSESS_REQUEST: {
                const player = this.players.get(sessionId);
                if (!player) break;

                const targetEntityKey = sanitizeEntityKey(data.targetEntityKey);
                if (!targetEntityKey || !targetEntityKey.startsWith('world:')) break;

                const x = Number.isFinite(data.x) ? data.x : 0;
                const y = Number.isFinite(data.y) ? data.y : 0;
                const levelId = typeof data.levelId === 'string'
                    ? data.levelId
                    : (player.transform?.levelId ?? 'town-square');

                let target = this.worldEntities.get(targetEntityKey);
                if (!target) {
                    target = {
                        entityKey: targetEntityKey,
                        x,
                        y,
                        levelId,
                        controllerSessionId: null,
                    };
                    if (DEBUG_WORLD_SYNC && targetEntityKey === PRACTICE_GOLEM_KEY) {
                        console.log('[WorldSync][Server] possess_request created missing golem from request', {
                            x,
                            y,
                            levelId,
                        });
                    }
                } else if (DEBUG_WORLD_SYNC && targetEntityKey === PRACTICE_GOLEM_KEY) {
                    console.log('[WorldSync][Server] possess_request existing golem keeps authoritative pose', {
                        requested: { x, y, levelId },
                        authoritative: { x: target.x, y: target.y, levelId: target.levelId },
                    });
                }
                if (DEBUG_WORLD_SYNC && targetEntityKey === 'world:golem') {
                    console.log('[WorldSync][Server] possess_request golem', {
                        sessionId,
                        targetEntityKey,
                        requested: { x, y, levelId },
                        existing: this.worldEntities.get(targetEntityKey) ?? null,
                    });
                }

                const previousControllerSessionId = target.controllerSessionId;
                const canSteal = this._canStealPossession({
                    requesterSessionId: sessionId,
                    previousControllerSessionId,
                    targetEntityKey,
                    levelId,
                });
                if (!canSteal) break;

                const requesterPreviousKey = player.controlledEntityKey ?? `player:${sessionId}`;
                const updatedRequester = {
                    ...player,
                    controlledEntityKey: targetEntityKey,
                    returnEntityKey: requesterPreviousKey,
                };
                this.players.set(sessionId, updatedRequester);

                // Do not snap an existing authoritative entity to requester-provided
                // coordinates. Request payload coordinates are only a hint for first
                // creation if the entity does not exist yet.
                if (!this.worldEntities.has(targetEntityKey)) {
                    target.x = x;
                    target.y = y;
                    target.levelId = levelId;
                }
                target.controllerSessionId = sessionId;
                target.possessionEndAtMs = Date.now() + POSSESSION_DURATION_MS;
                this.worldEntities.set(targetEntityKey, target);

                // Steal behavior: previous controller is kicked back to their last return key.
                if (previousControllerSessionId && previousControllerSessionId !== sessionId) {
                    this._releaseControllerToReturn(previousControllerSessionId, 'possess:stolen', {
                        winnerSessionId: sessionId,
                        previousControllerSessionId,
                    });
                }

                this.#sendToSession(sessionId, {
                    type: MSG.FORCE_CONTROL,
                    controlledEntityKey: targetEntityKey,
                    winnerSessionId: sessionId,
                    previousControllerSessionId,
                    possessionMsRemaining: POSSESSION_DURATION_MS,
                    reason: previousControllerSessionId && previousControllerSessionId !== sessionId
                        ? 'possess:stolen'
                        : 'possess:granted',
                });

                this.#broadcastAll({
                    type: MSG.ENTITY_CONTROL,
                    entityKey: targetEntityKey,
                    controllerSessionId: sessionId,
                    previousControllerSessionId: previousControllerSessionId ?? null,
                    winnerSessionId: sessionId,
                    possessionMsRemaining: POSSESSION_DURATION_MS,
                    reason: previousControllerSessionId && previousControllerSessionId !== sessionId
                        ? 'possess:stolen'
                        : 'possess:granted',
                });
                break;
            }

            case MSG.POSSESS_RELEASE: {
                const player = this.players.get(sessionId);
                if (!player) break;
                const targetEntityKey = sanitizeEntityKey(data.targetEntityKey);
                if (!targetEntityKey || !targetEntityKey.startsWith('world:')) break;
                if (player.controlledEntityKey !== targetEntityKey) break;
                this._releaseControllerToReturn(sessionId, 'possess:released');
                break;
            }

            case MSG.ENTITY_STATE: {
                const player = this.players.get(sessionId);
                const entityKey = sanitizeEntityKey(data.entityKey);
                if (!entityKey || !entityKey.startsWith('world:')) break;
                if (!player || player.controlledEntityKey !== entityKey) break;
                if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) break;

                const levelId = typeof data.levelId === 'string' ? data.levelId : null;
                const prev = this.worldEntities.get(entityKey);
                const next = {
                    entityKey,
                    x: data.x,
                    y: data.y,
                    levelId,
                    controllerSessionId: sessionId,
                    possessionEndAtMs: prev?.possessionEndAtMs ?? null,
                };
                this.worldEntities.set(entityKey, next);
                if (DEBUG_WORLD_SYNC && entityKey === 'world:golem') {
                    console.log('[WorldSync][Server] entity_state golem', {
                        sessionId,
                        entityKey,
                        x: next.x,
                        y: next.y,
                        levelId: next.levelId,
                    });
                }

                this.#broadcast({
                    type: MSG.ENTITY_STATE,
                    sessionId,
                    possessionMsRemaining: Number.isFinite(next.possessionEndAtMs)
                        ? Math.max(0, next.possessionEndAtMs - Date.now())
                        : null,
                    ...next,
                }, ws);
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
                    : new Map(Array.from(this.players.entries()).map(([sid, p]) => [sid, ({
                        x: p.transform.x,
                        y: p.transform.y,
                        levelId: p.transform.levelId,
                    })]));

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
                        const newHp  = Math.max(0, victim.stats.hp - damage);
                        const died   = newHp === 0;
                        this.players.set(hitSessionId, {
                            ...victim,
                            stats: { ...victim.stats, hp: died ? PLAYER_HEALTH_MAX : newHp },
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

                const requestedEntityKey = sanitizeEntityKey(data.entityKey);
                const controlledKey = player.controlledEntityKey ?? `player:${sessionId}`;
                const movingEntityKey = requestedEntityKey || controlledKey || `player:${sessionId}`;

                const movingWorldEntity = movingEntityKey.startsWith('world:')
                    ? this.worldEntities.get(movingEntityKey)
                    : null;
                const movingPlayer = movingEntityKey === `player:${sessionId}`;

                // Only allow level changes for the currently controlled entity.
                if (!movingPlayer && movingEntityKey !== controlledKey) break;
                if (movingWorldEntity && movingWorldEntity.controllerSessionId !== sessionId) break;

                const fromExitIndex = Number.isInteger(data.fromExitIndex) ? data.fromExitIndex : null;
                const fromLevelId = typeof data.fromLevelId === 'string'
                    ? data.fromLevelId
                    : (movingWorldEntity?.levelId ?? player.transform.levelId ?? null);

                let levelId = typeof data.levelId === 'string'
                    ? data.levelId
                    : (movingWorldEntity?.levelId ?? player.transform.levelId ?? 'town-square');
                let toExitIndex = Number.isInteger(data.toExitIndex) ? data.toExitIndex : null;
                let entryDirection = sanitizeDirection(data.entryDirection);

                const hasCanonicalStaticLink = !!(
                    fromLevelId &&
                    Number.isInteger(fromExitIndex) &&
                    STATIC_EXIT_CONNECTIONS[fromLevelId]?.[fromExitIndex]
                );

                // Only canonicalize deterministic/static links on the server.
                // For dynamic wild links, the client may have created a runtime
                // bidirectional connection that the server does not store.
                if (hasCanonicalStaticLink) {
                    const resolved = resolveExitTransition(fromLevelId, fromExitIndex);
                    levelId = resolved.toLevelId;
                    toExitIndex = resolved.toExitIndex;
                    if (!entryDirection) entryDirection = resolved.entryDirection;
                }

                const grid = this._getGrid(levelId);
                const fallbackW = grid ? grid[0].length : STAGE_WIDTH;
                const fallbackH = grid ? grid.length : STAGE_HEIGHT;
                let x = typeof data.x === 'number' ? data.x : (Math.floor(fallbackW / 2) * TILE_SIZE + TILE_SIZE / 2);
                let y = typeof data.y === 'number' ? data.y : (Math.floor(fallbackH / 2) * TILE_SIZE + TILE_SIZE / 2);

                if (Number.isInteger(toExitIndex)) {
                    const spawn = resolveExitSpawnPosition({
                        toLevelId: levelId,
                        toExitIndex,
                        entryDirection,
                    });
                    if (spawn) {
                        x = spawn.x;
                        y = spawn.y;
                    }
                }

                if (grid) ({ x, y } = resolveCollisions(x, y, grid));

                if (movingPlayer) {
                    this.players.set(sessionId, {
                        ...player,
                        transform: { ...player.transform, levelId, x, y },
                        intent: { up: false, down: false, left: false, right: false, sprint: false },
                        motion: { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
                    });
                    this.#broadcast({ type: MSG.LEVEL_CHANGE, sessionId, levelId }, ws);
                } else if (movingWorldEntity) {
                    this.worldEntities.set(movingEntityKey, {
                        ...movingWorldEntity,
                        levelId,
                        x,
                        y,
                    });

                    this.#broadcast({
                        type: MSG.ENTITY_STATE,
                        sessionId,
                        entityKey: movingEntityKey,
                        x,
                        y,
                        levelId,
                        controllerSessionId: sessionId,
                        possessionMsRemaining: Number.isFinite(movingWorldEntity.possessionEndAtMs)
                            ? Math.max(0, movingWorldEntity.possessionEndAtMs - Date.now())
                            : null,
                    }, ws);
                }

                // Send the destination level's current authoritative world entities
                // immediately so entrants do not render stale/default local positions.
                const destinationEntities = Array.from(this.worldEntities.values())
                    .filter((entry) => (entry.levelId ?? null) === levelId)
                    .map((entry) => ({
                        ...entry,
                        possessionMsRemaining: Number.isFinite(entry.possessionEndAtMs)
                            ? Math.max(0, entry.possessionEndAtMs - Date.now())
                            : null,
                    }));
                if (DEBUG_WORLD_SYNC) {
                    const golem = this.worldEntities.get('world:golem') ?? null;
                    console.log('[WorldSync][Server] level_change world_state push', {
                        sessionId,
                        movingEntityKey,
                        fromLevelId,
                        toLevelId: levelId,
                        destinationCount: destinationEntities.length,
                        golem,
                    });
                }
                this.#sendToSession(sessionId, {
                    type: MSG.WORLD_STATE,
                    scope: 'level',
                    levelId,
                    entities: destinationEntities,
                });
                break;
            }

            default:
                break;
        }
    }

    async webSocketClose(ws, code, reason) {
        const [sessionId] = this.state.getTags(ws);
        this.players.delete(sessionId);
        this.entityEquips.delete(`player:${sessionId}`);
        for (const entry of this.worldEntities.values()) {
            if (entry.controllerSessionId !== sessionId) continue;
            entry.controllerSessionId = null;
            this.worldEntities.set(entry.entityKey, entry);
        }
        this.#broadcast({ type: MSG.PLAYER_LEAVE, sessionId }, ws);
        ws.close(code, reason);
    }

    async webSocketError(ws) {
        const [sessionId] = this.state.getTags(ws);
        this.players.delete(sessionId);
        this.entityEquips.delete(`player:${sessionId}`);
        for (const entry of this.worldEntities.values()) {
            if (entry.controllerSessionId !== sessionId) continue;
            entry.controllerSessionId = null;
            this.worldEntities.set(entry.entityKey, entry);
        }
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
        this._phaseExpirePossessions();
        const inputPhase = this._phaseInputIntent();
        const locomotionPhase = this._phaseLocomotionDash(inputPhase);
        this._phasePhysicsTransform(locomotionPhase);

        const snapshotPlayers = this._phaseBuildSnapshotPlayers();
        this._phaseRecordLagCompHistory();
        this._phaseBroadcastSnapshot(snapshotPlayers);
    }

    _phaseExpirePossessions() {
        this._ensurePracticeGolem();
        const now = Date.now();
        for (const [sessionId, player] of this.players.entries()) {
            const controlledKey = player.controlledEntityKey;
            if (!controlledKey || !controlledKey.startsWith('world:')) continue;
            const target = this.worldEntities.get(controlledKey);
            if (!target) continue;
            if (target.controllerSessionId !== sessionId) continue;
            if (!Number.isFinite(target.possessionEndAtMs)) continue;
            if (target.possessionEndAtMs > now) continue;
            this._releaseControllerToReturn(sessionId, 'possess:expired');
        }
    }

    /**
     * Phase 1: capture the authoritative input/intent state for each player.
     * (Intent is represented by the stored per-player lastInput payload.)
     */
    _phaseInputIntent() {
        return phaseInputIntent(this.players, (levelId) => this._getGrid(levelId));
    }

    /**
     * Phase 2: run locomotion + dash simulation from input intent.
     */
    _phaseLocomotionDash(inputPhaseEntries) {
        return phaseLocomotionDash(inputPhaseEntries, TICK_MS);
    }

    /**
     * Phase 3/4: apply physics result to authoritative transform/state.
     * (Physics integration and transform write-back are a single operation here.)
     */
    _phasePhysicsTransform(locomotionPhaseEntries) {
        phasePhysicsTransform(this.players, locomotionPhaseEntries);
    }

    /**
     * Phase 5: build snapshot payload from authoritative state.
     */
    _phaseBuildSnapshotPlayers() {
        return phaseBuildSnapshotPlayers(this.players);
    }

    /**
     * Phase 6: record per-tick lag-compensation history.
     */
    _phaseRecordLagCompHistory() {
        const historyPositions = phaseBuildHistoryPositions(this.players);

        this.positionHistory.push({ tick: this.tickCount, positions: historyPositions });
        if (this.positionHistory.length > LAG_COMP_HISTORY_SIZE) {
            this.positionHistory.shift();
        }
    }

    /**
     * Phase 7: broadcast authoritative snapshot for this tick.
     */
    _phaseBroadcastSnapshot(players) {
        const tick = this.tickCount++;
        const now = Date.now();
        for (const ws of this.state.getWebSockets()) {
            const [sessionId] = this.state.getTags(ws);
            const selfPlayer = this.players.get(sessionId);
            const payload = {
                type: MSG.STATE_SNAPSHOT,
                tick,
                players,
                self: selfPlayer ? {
                    sessionId,
                    hp: selfPlayer.stats.hp,
                    hpMax: PLAYER_HEALTH_MAX,
                } : null,
                worldEntities: Array.from(this.worldEntities.values()).map((entry) => ({
                    ...entry,
                    possessionMsRemaining: Number.isFinite(entry.possessionEndAtMs)
                        ? Math.max(0, entry.possessionEndAtMs - now)
                        : null,
                })),
                entityEquips: Array.from(this.entityEquips.values()).map(({ entityKey, levelId, equipped, ownerSessionId }) => ({
                    entityKey,
                    levelId,
                    equipped,
                    ownerSessionId,
                })),
            };
            try { ws.send(JSON.stringify(payload)); } catch { /* session closing */ }
        }
    }

    _canStealPossession({ requesterSessionId, previousControllerSessionId }) {
        if (!previousControllerSessionId) return true;
        if (previousControllerSessionId === requesterSessionId) return true;
        // Groundwork hook for future spell-power contest rules.
        // Example future condition:
        // return requesterSpellPower >= Math.ceil(previousSpellPower * 1.5);
        return true;
    }

    _releaseControllerToReturn(sessionId, reason = 'possess:released', context = {}) {
        const player = this.players.get(sessionId);
        if (!player) return;

        const controlledKey = player.controlledEntityKey;
        const fallbackKey = player.returnEntityKey ?? `player:${sessionId}`;

        if (controlledKey && controlledKey.startsWith('world:')) {
            const target = this.worldEntities.get(controlledKey);
            if (target && target.controllerSessionId === sessionId) {
                target.controllerSessionId = null;
                target.possessionEndAtMs = null;
                this.worldEntities.set(controlledKey, target);
                this.#broadcastAll({
                    type: MSG.ENTITY_CONTROL,
                    entityKey: controlledKey,
                    controllerSessionId: null,
                    previousControllerSessionId: sessionId,
                    winnerSessionId: context.winnerSessionId ?? null,
                    possessionMsRemaining: 0,
                    reason,
                });
            }
        }

        // Player body remains where it was while possessing.
        const returnX = player.transform.x;
        const returnY = player.transform.y;
        const returnLevelId = player.transform.levelId;

        this.players.set(sessionId, {
            ...player,
            transform: {
                ...player.transform,
                x: returnX,
                y: returnY,
                levelId: returnLevelId,
            },
            controlledEntityKey: fallbackKey,
            returnEntityKey: fallbackKey,
        });
        this.#sendToSession(sessionId, {
            type: MSG.FORCE_CONTROL,
            controlledEntityKey: fallbackKey,
            levelId: returnLevelId ?? null,
            x: returnX ?? null,
            y: returnY ?? null,
            winnerSessionId: context.winnerSessionId ?? null,
            previousControllerSessionId: context.previousControllerSessionId ?? null,
            possessionMsRemaining: 0,
            reason,
        });
    }

    _ensurePracticeGolem() {
        if (this.worldEntities.has(PRACTICE_GOLEM_KEY)) return;
        const x = PRACTICE_GOLEM_TILE_X * TILE_SIZE + TILE_SIZE / 2;
        const y = PRACTICE_GOLEM_TILE_Y * TILE_SIZE + TILE_SIZE / 2;
        this.worldEntities.set(PRACTICE_GOLEM_KEY, {
            entityKey: PRACTICE_GOLEM_KEY,
            x,
            y,
            levelId: PRACTICE_GOLEM_STAGE,
            controllerSessionId: null,
            possessionEndAtMs: null,
        });
        if (DEBUG_WORLD_SYNC) {
            console.log('[WorldSync][Server] ensurePracticeGolem created', { x, y, levelId: PRACTICE_GOLEM_STAGE });
        }
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

    #sendToSession(sessionId, data) {
        const message = JSON.stringify(data);
        for (const ws of this.state.getWebSockets()) {
            const [sid] = this.state.getTags(ws);
            if (sid !== sessionId) continue;
            try { ws.send(message); } catch { /* session closing */ }
            return;
        }
    }
}
