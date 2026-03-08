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
    stepPlayerKinematics,
    dashStateFromInput,
    resolvePlayerCollisions,
    PLAYER_HEALTH_MAX,
    BULLET_DAMAGE,
    BULLET_MAX_RANGE,
    ARROW_MIN_DAMAGE,
    ARROW_MAX_DAMAGE,
    ARROW_MAX_RANGE,
    ARROW_BASE_PENETRATION,
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
const PRACTICE_BANDIT_KEY = 'world:bandit_1';
const PRACTICE_BANDIT_STAGE = 'west-gate';
const PRACTICE_BANDIT_TILE_X = 6;
const PRACTICE_BANDIT_TILE_Y = 4;
const BANDIT_AGGRO_RANGE = 420;
const BANDIT_LEASH_RANGE = 560;
const BANDIT_ATTACK_RANGE = 62;
const BANDIT_ATTACK_DAMAGE = 7;
const BANDIT_ATTACK_COOLDOWN_MS = 850;
const BANDIT_HIT_RADIUS = 18;
const BANDIT_HP_MAX = 75;
const EQUIP_ID_PATTERN = /^[a-z0-9_-]{1,32}$/i;
const ENTITY_KEY_PATTERN = /^(player:[a-z0-9-]{1,64}|world:[a-z0-9_-]{1,64})$/i;
const SOLID_PROJECTILE_TILES = new Set([1, 3]); // wall + void
const PROJECTILE_MIN_SPEED = 0.001;

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
 * Cast a segment through the tile grid and return distance to first solid tile.
 * @returns {number|null}
 */
function rayHitSolidTileDistance(grid, x1, y1, x2, y2) {
    if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) return null;
    const rows = grid.length;
    const cols = grid[0].length;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const rayLen = Math.sqrt(dx * dx + dy * dy);
    if (rayLen < PROJECTILE_MIN_SPEED) return null;

    const rdx = dx / rayLen;
    const rdy = dy / rayLen;

    let mapX = Math.floor(x1 / TILE_SIZE);
    let mapY = Math.floor(y1 / TILE_SIZE);
    const stepX = rdx >= 0 ? 1 : -1;
    const stepY = rdy >= 0 ? 1 : -1;

    const deltaDX = rdx !== 0 ? Math.abs(TILE_SIZE / rdx) : Infinity;
    const deltaDY = rdy !== 0 ? Math.abs(TILE_SIZE / rdy) : Infinity;

    let sideDistX;
    if (rdx > 0) {
        sideDistX = ((mapX + 1) * TILE_SIZE - x1) / rdx;
    } else if (rdx < 0) {
        sideDistX = (x1 - mapX * TILE_SIZE) / (-rdx);
    } else {
        sideDistX = Infinity;
    }

    let sideDistY;
    if (rdy > 0) {
        sideDistY = ((mapY + 1) * TILE_SIZE - y1) / rdy;
    } else if (rdy < 0) {
        sideDistY = (y1 - mapY * TILE_SIZE) / (-rdy);
    } else {
        sideDistY = Infinity;
    }

    let side = -1;
    let isFirstTile = true;

    while (true) {
        if (!(mapX >= 0) || mapX >= cols || !(mapY >= 0) || mapY >= rows) return null;

        if (!isFirstTile && SOLID_PROJECTILE_TILES.has(grid[mapY][mapX])) {
            const entryT = side === 0 ? sideDistX - deltaDX : sideDistY - deltaDY;
            if (entryT > rayLen) return null;
            return entryT;
        }

        isFirstTile = false;

        if (sideDistX < sideDistY) {
            if (sideDistX > rayLen) return null;
            side = 0;
            mapX += stepX;
            sideDistX += deltaDX;
        } else {
            if (sideDistY > rayLen) return null;
            side = 1;
            mapY += stepY;
            sideDistY += deltaDY;
        }
    }
}

/**
 * Resolve a player circle against the wall grid.
 * Pushes the player out of any wall cell it overlaps.
 */
function resolveCollisions(x, y, grid) {
    return resolvePlayerCollisions(x, y, grid);
}

function clampUnit(value) {
    return Math.max(-1, Math.min(1, value));
}

function intentFromVector(dx, dy, sprint = false) {
    const normalizedX = clampUnit(dx);
    const normalizedY = clampUnit(dy);
    return {
        up: normalizedY < -0.1,
        down: normalizedY > 0.1,
        left: normalizedX < -0.1,
        right: normalizedX > 0.1,
        sprint: !!sprint,
    };
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
        this.projectiles = new Map(); // projectileId -> { id, shooterSessionId, projectileType, x, y, velocityX, velocityY, levelId, damage, remainingRange }
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
                this._ensurePracticeBandit();
                const startGrid = this._getGrid('town-square');
                const startW = startGrid ? startGrid[0].length : STAGE_WIDTH;
                const startH = startGrid ? startGrid.length   : STAGE_HEIGHT;
                const spawnX = Math.floor(startW / 2) * TILE_SIZE + TILE_SIZE / 2;
                const spawnY = Math.floor(startH / 2) * TILE_SIZE + TILE_SIZE / 2;

                this.players.set(sessionId, {
                    transform: { x: spawnX, y: spawnY, levelId: 'town-square' },
                    intent:    {
                        up: false, down: false, left: false, right: false, sprint: false,
                        moveSpeedMultiplier: 1, attackPushVx: 0, attackPushVy: 0,
                    },
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
                    entities: Array.from(this.worldEntities.values()).map((entry) => this._serializeWorldEntity(entry, Date.now())),
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
                        moveSpeedMultiplier: Number.isFinite(data.moveSpeedMultiplier)
                            ? Math.max(0, Math.min(1, data.moveSpeedMultiplier))
                            : 1,
                        attackPushVx: Number.isFinite(data.attackPushVx)
                            ? Math.max(-800, Math.min(800, data.attackPushVx))
                            : 0,
                        attackPushVy: Number.isFinite(data.attackPushVy)
                            ? Math.max(-800, Math.min(800, data.attackPushVy))
                            : 0,
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
                    ...(prev ?? {}),
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
                    ...this._serializeWorldEntity(next, Date.now()),
                }, ws);
                break;
            }

            case MSG.BULLET_FIRED: {
                const { x, y, velocityX, velocityY, levelId,
                        projectileType, chargeRatio, penetration } = data;

                const normalizedType = projectileType === 'arrow' ? 'arrow' : 'bullet';
                const ratio = Math.max(0, Math.min(1, chargeRatio ?? 0));
                const damage = normalizedType === 'arrow'
                    ? Math.round(ARROW_MIN_DAMAGE + (ARROW_MAX_DAMAGE - ARROW_MIN_DAMAGE) * ratio)
                    : BULLET_DAMAGE;
                const maxRange = normalizedType === 'arrow' ? ARROW_MAX_RANGE : BULLET_MAX_RANGE;

                if (normalizedType === 'arrow') {
                    const projectileId = this._spawnProjectile({
                        shooterSessionId: sessionId,
                        projectileType: normalizedType,
                        x,
                        y,
                        velocityX,
                        velocityY,
                        levelId,
                        damage,
                        maxRange,
                        penetration: Number.isFinite(penetration)
                            ? Math.max(0, Math.floor(penetration))
                            : ARROW_BASE_PENETRATION,
                    });
                    this.#broadcast({
                        type:      MSG.BULLET_FIRED,
                        sessionId,
                        x, y, velocityX, velocityY, levelId,
                        projectileId,
                        projectileType: normalizedType,
                        chargeRatio: ratio,
                        penetration: Number.isFinite(penetration)
                            ? Math.max(0, Math.floor(penetration))
                            : ARROW_BASE_PENETRATION,
                    }, ws);
                } else {
                    // Keep legacy bullet behavior hitscan against hostile world entities only.
                    // Players are allies and are never valid projectile targets.
                    let hitEntityKey = null;
                    let hitT = Infinity;

                    for (const [entityKey, entity] of this.worldEntities.entries()) {
                        if (entity?.kind !== 'bandit') continue;
                        if (entity.levelId !== levelId) continue;
                        const t = rayHitDistance(
                            x,
                            y,
                            velocityX,
                            velocityY,
                            entity.x,
                            entity.y,
                            BANDIT_HIT_RADIUS,
                            maxRange
                        );
                        if (t !== null && t < hitT) {
                            hitT = t;
                            hitEntityKey = entityKey;
                        }
                    }

                    if (hitEntityKey) {
                        this._applyDamageToWorldEntity(hitEntityKey, damage);
                    }
                    // Relay bullet visuals to other clients.
                    this.#broadcast({
                        type:      MSG.BULLET_FIRED,
                        sessionId,
                        x, y, velocityX, velocityY, levelId,
                        projectileId: null,
                        projectileType: normalizedType,
                        chargeRatio: ratio,
                        penetration: 0,
                    }, ws);
                }
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
                    .map((entry) => this._serializeWorldEntity(entry, Date.now()));
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
        this._phaseBanditAi();
        this._phaseBanditMovement();
        this._phaseProjectiles();

        const snapshotPlayers = this._phaseBuildSnapshotPlayers();
        this._phaseRecordLagCompHistory();
        this._phaseBroadcastSnapshot(snapshotPlayers);
    }

    _phaseExpirePossessions() {
        this._ensurePracticeGolem();
        this._ensurePracticeBandit();
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

    _phaseBanditAi() {
        const now = Date.now();
        for (const [entityKey, entity] of this.worldEntities.entries()) {
            if (entity?.kind !== 'bandit') continue;
            if (!entity.ai) {
                entity.ai = {
                    state: 'idle',
                    targetSessionId: null,
                    attackCooldownMs: 0,
                };
            }
            if (!entity.home) {
                entity.home = {
                    x: entity.x,
                    y: entity.y,
                    levelId: entity.levelId ?? PRACTICE_BANDIT_STAGE,
                };
            }

            entity.ai.attackCooldownMs = Math.max(0, (entity.ai.attackCooldownMs ?? 0) - TICK_MS);

            if (entity.controllerSessionId) {
                entity.ai.state = 'idle';
                entity.ai.targetSessionId = null;
                this.worldEntities.set(entityKey, entity);
                continue;
            }

            const target = this._findNearestPlayerInRange(entity, BANDIT_AGGRO_RANGE);
            const targetPlayer = target ? this.players.get(target.sessionId) : null;
            const targetDist = target ? Math.sqrt(target.distSq) : Infinity;
            const sameLevelAsHome = (entity.levelId ?? null) === (entity.home?.levelId ?? null);
            const homeDx = (entity.home?.x ?? entity.x) - entity.x;
            const homeDy = (entity.home?.y ?? entity.y) - entity.y;
            const homeDist = Math.sqrt(homeDx * homeDx + homeDy * homeDy);
            const beyondLeash = !sameLevelAsHome || homeDist > BANDIT_LEASH_RANGE;

            let nextState = entity.ai.state ?? 'idle';
            if (!targetPlayer && nextState !== 'return_home') {
                nextState = homeDist > 20 ? 'return_home' : 'idle';
            }
            if (targetPlayer) {
                if (beyondLeash) {
                    nextState = 'return_home';
                } else if (targetDist <= BANDIT_ATTACK_RANGE) {
                    nextState = 'attack';
                } else {
                    nextState = 'chase';
                }
            } else if (homeDist <= 20) {
                nextState = 'idle';
            }

            entity.ai.state = nextState;
            entity.ai.targetSessionId = targetPlayer ? target.sessionId : null;
            entity.intent = {
                up: false,
                down: false,
                left: false,
                right: false,
                sprint: false,
            };

            if (nextState === 'chase' && targetPlayer) {
                const dx = targetPlayer.transform.x - entity.x;
                const dy = targetPlayer.transform.y - entity.y;
                const len = Math.hypot(dx, dy) || 1;
                entity.intent = intentFromVector(dx / len, dy / len, targetDist > 200);
            } else if (nextState === 'return_home') {
                const dx = (entity.home?.x ?? entity.x) - entity.x;
                const dy = (entity.home?.y ?? entity.y) - entity.y;
                const len = Math.hypot(dx, dy) || 1;
                entity.intent = intentFromVector(dx / len, dy / len, homeDist > 160);
            } else if (nextState === 'attack' && targetPlayer && entity.ai.attackCooldownMs <= 0) {
                this._applyBanditMeleeHit(entityKey, target.sessionId, now);
                entity.ai.attackCooldownMs = BANDIT_ATTACK_COOLDOWN_MS;
            }

            this.worldEntities.set(entityKey, entity);
        }
    }

    _phaseBanditMovement() {
        for (const [entityKey, entity] of this.worldEntities.entries()) {
            if (entity?.kind !== 'bandit') continue;
            if (entity.controllerSessionId) continue;
            const grid = this._getGrid(entity.levelId ?? PRACTICE_BANDIT_STAGE);
            const stepped = stepPlayerKinematics(
                {
                    x: entity.x,
                    y: entity.y,
                    dashVx: entity.motion?.dashVx ?? 0,
                    dashVy: entity.motion?.dashVy ?? 0,
                    dashTimeLeftMs: entity.motion?.dashTimeLeftMs ?? 0,
                },
                entity.intent ?? { up: false, down: false, left: false, right: false, sprint: false },
                TICK_MS,
                grid
            );

            entity.x = stepped.x;
            entity.y = stepped.y;
            entity.motion = {
                dashVx: stepped.dashVx,
                dashVy: stepped.dashVy,
                dashTimeLeftMs: stepped.dashTimeLeftMs,
            };
            this.worldEntities.set(entityKey, entity);
        }
    }

    _spawnProjectile({
        shooterSessionId,
        projectileType,
        x,
        y,
        velocityX,
        velocityY,
        levelId,
        damage,
        maxRange,
        penetration = ARROW_BASE_PENETRATION,
    }) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (!Number.isFinite(velocityX) || !Number.isFinite(velocityY)) return null;
        if (!Number.isFinite(maxRange) || maxRange <= 0) return null;
        if (!Number.isFinite(damage) || damage <= 0) return null;

        const projectileId = crypto.randomUUID();
        this.projectiles.set(projectileId, {
            id: projectileId,
            shooterSessionId,
            projectileType: projectileType === 'arrow' ? 'arrow' : 'bullet',
            x,
            y,
            velocityX,
            velocityY,
            levelId: typeof levelId === 'string' ? levelId : null,
            damage,
            remainingRange: maxRange,
            penetrationRemaining: Math.max(0, Math.floor(penetration)),
            hitEntities: new Set(),
        });
        return projectileId;
    }

    _phaseProjectiles() {
        if (this.projectiles.size === 0) return;

        const dtSeconds = TICK_MS / 1000;
        const epsilon = 0.01;

        for (const [projectileId, projectile] of this.projectiles.entries()) {
            const speed = Math.sqrt(
                projectile.velocityX * projectile.velocityX +
                projectile.velocityY * projectile.velocityY
            );
            if (speed < PROJECTILE_MIN_SPEED) {
                this._despawnProjectile(projectileId, 'stopped');
                continue;
            }

            const dirX = projectile.velocityX / speed;
            const dirY = projectile.velocityY / speed;
            let stepRemaining = Math.min(projectile.remainingRange, speed * dtSeconds);

            let currX = projectile.x;
            let currY = projectile.y;
            let despawned = false;

            while (!despawned && stepRemaining > epsilon) {
                const endX = currX + dirX * stepRemaining;
                const endY = currY + dirY * stepRemaining;

                let nearestHitDistance = Infinity;
                let hitType = null;
                let hitEntityKey = null;

                const grid = projectile.levelId ? this._getGrid(projectile.levelId) : null;
                const wallHitDistance = rayHitSolidTileDistance(grid, currX, currY, endX, endY);
                if (wallHitDistance !== null && wallHitDistance < nearestHitDistance) {
                    nearestHitDistance = wallHitDistance;
                    hitType = 'wall';
                }

                for (const [entityKey, entity] of this.worldEntities.entries()) {
                    if (entity?.kind !== 'bandit') continue;
                    if (projectile.hitEntities.has(entityKey)) continue;
                    if ((entity.levelId ?? null) !== projectile.levelId) continue;
                    const t = rayHitDistance(
                        currX,
                        currY,
                        projectile.velocityX,
                        projectile.velocityY,
                        entity.x,
                        entity.y,
                        BANDIT_HIT_RADIUS,
                        stepRemaining
                    );
                    if (t !== null && t < nearestHitDistance) {
                        nearestHitDistance = t;
                        hitType = 'entity';
                        hitEntityKey = entityKey;
                    }
                }

                if (!hitType) {
                    currX = endX;
                    currY = endY;
                    projectile.remainingRange -= stepRemaining;
                    stepRemaining = 0;
                    break;
                }

                const traveled = Math.max(0, nearestHitDistance);
                currX += dirX * traveled;
                currY += dirY * traveled;
                projectile.remainingRange -= traveled;
                stepRemaining -= traveled;

                if (hitType === 'wall') {
                    this._despawnProjectile(projectileId, 'wall');
                    despawned = true;
                    break;
                }

                if (hitType === 'entity' && hitEntityKey) {
                    projectile.hitEntities.add(hitEntityKey);
                    this._applyDamageToWorldEntity(hitEntityKey, projectile.damage);
                }

                if (projectile.penetrationRemaining > 0) {
                    projectile.penetrationRemaining -= 1;
                    const nudge = Math.min(epsilon, stepRemaining);
                    currX += dirX * nudge;
                    currY += dirY * nudge;
                    projectile.remainingRange -= nudge;
                    stepRemaining -= nudge;
                    continue;
                }

                this._despawnProjectile(projectileId, 'hit');
                despawned = true;
                break;
            }

            if (despawned) continue;
            if (!this.projectiles.has(projectileId)) continue;

            projectile.x = currX;
            projectile.y = currY;
            if (projectile.remainingRange <= 0) {
                this._despawnProjectile(projectileId, 'range');
            } else {
                this.projectiles.set(projectileId, projectile);
            }
        }
    }

    _despawnProjectile(projectileId, reason = 'unknown') {
        const existed = this.projectiles.delete(projectileId);
        if (!existed) return;
        this.#broadcastAll({
            type: MSG.PROJECTILE_DESPAWN,
            projectileId,
            reason,
        });
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
                    ...this._serializeWorldEntity(entry, now),
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
            kind: 'golem',
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

    _ensurePracticeBandit() {
        if (this.worldEntities.has(PRACTICE_BANDIT_KEY)) return;
        const x = PRACTICE_BANDIT_TILE_X * TILE_SIZE + TILE_SIZE / 2;
        const y = PRACTICE_BANDIT_TILE_Y * TILE_SIZE + TILE_SIZE / 2;
        this.worldEntities.set(PRACTICE_BANDIT_KEY, {
            entityKey: PRACTICE_BANDIT_KEY,
            kind: 'bandit',
            x,
            y,
            levelId: PRACTICE_BANDIT_STAGE,
            controllerSessionId: null,
            possessionEndAtMs: null,
            intent: { up: false, down: false, left: false, right: false, sprint: false },
            motion: { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
            stats: { hp: BANDIT_HP_MAX, hpMax: BANDIT_HP_MAX },
            home: { x, y, levelId: PRACTICE_BANDIT_STAGE },
            ai: {
                state: 'idle',
                targetSessionId: null,
                attackCooldownMs: 0,
            },
        });
    }

    _findNearestPlayerInRange(entity, range) {
        const rangeSq = range * range;
        let best = null;
        for (const [sessionId, player] of this.players.entries()) {
            if ((player.transform?.levelId ?? null) !== (entity.levelId ?? null)) continue;
            const dx = player.transform.x - entity.x;
            const dy = player.transform.y - entity.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > rangeSq) continue;
            if (!best || distSq < best.distSq) {
                best = { sessionId, distSq };
            }
        }
        return best;
    }

    _applyBanditMeleeHit(attackerEntityKey, victimSessionId, nowMs) {
        this._applyDamageToPlayer(victimSessionId, BANDIT_ATTACK_DAMAGE, attackerEntityKey, nowMs);
    }

    _applyDamageToPlayer(victimSessionId, damage, attackerId, timestamp = null) {
        const victim = this.players.get(victimSessionId);
        if (!victim) return;

        const newHp = Math.max(0, victim.stats.hp - damage);
        const died = newHp === 0;
        const nextHp = died ? PLAYER_HEALTH_MAX : newHp;
        this.players.set(victimSessionId, {
            ...victim,
            stats: { ...victim.stats, hp: nextHp },
        });

        const payload = {
            type: MSG.PLAYER_DAMAGED,
            sessionId: victimSessionId,
            attackerId,
            damage,
            hp: nextHp,
            died,
        };
        if (Number.isFinite(timestamp)) {
            payload.timestamp = timestamp;
        }
        this.#broadcastAll(payload);
    }

    _applyDamageToWorldEntity(entityKey, damage) {
        const entity = this.worldEntities.get(entityKey);
        if (!entity) return;
        const hpMax = Number.isFinite(entity.stats?.hpMax) ? entity.stats.hpMax : BANDIT_HP_MAX;
        const hp = Number.isFinite(entity.stats?.hp) ? entity.stats.hp : hpMax;
        const nextHp = Math.max(0, hp - damage);
        if (nextHp <= 0) {
            this.worldEntities.delete(entityKey);
            return;
        }
        this.worldEntities.set(entityKey, {
            ...entity,
            stats: { hp: nextHp, hpMax },
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

    _serializeWorldEntity(entry, nowMs = Date.now()) {
        if (!entry) return null;
        return {
            entityKey: entry.entityKey,
            kind: entry.kind ?? null,
            x: entry.x,
            y: entry.y,
            levelId: entry.levelId ?? null,
            controllerSessionId: entry.controllerSessionId ?? null,
            possessionMsRemaining: Number.isFinite(entry.possessionEndAtMs)
                ? Math.max(0, entry.possessionEndAtMs - nowMs)
                : null,
        };
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
