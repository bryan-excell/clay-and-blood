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
    FISTS_MELEE_DAMAGE,
    SWORD_MELEE_DAMAGE_1,
    SWORD_MELEE_DAMAGE_2,
    SWORD_MELEE_DAMAGE_3,
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
const GOLEM_HIT_RADIUS = 20;
const GOLEM_HP_MAX = 160;
const TEAM_PLAYERS = 'players';
const TEAM_BANDITS = 'bandits';
const TEAM_NEUTRAL = 'neutral';
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
                    teamId: TEAM_PLAYERS,
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

            case MSG.MELEE_ATTACK: {
                const player = this.players.get(sessionId);
                if (!player) break;
                const dirX = Number.isFinite(data.dirX) ? data.dirX : 1;
                const dirY = Number.isFinite(data.dirY) ? data.dirY : 0;
                const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
                if (dirLen < 0.001) break;

                const requestedWeaponId = data.weaponId === 'sword' ? 'sword' : 'unarmed';
                const equippedWeaponId = player.equipped?.weaponId === 'sword' ? 'sword' : 'unarmed';
                const weaponId = requestedWeaponId === equippedWeaponId ? requestedWeaponId : equippedWeaponId;
                const phaseIndex = Number.isInteger(data.phaseIndex) ? data.phaseIndex : Math.floor(data.phaseIndex ?? 0);

                const requestedLevelId = typeof data.levelId === 'string' ? data.levelId : null;
                const levelId = player.transform?.levelId ?? requestedLevelId;
                if (!levelId) break;

                this._applyPlayerMeleeAttack(sessionId, {
                    weaponId,
                    phaseIndex,
                    levelId,
                    dirX: dirX / dirLen,
                    dirY: dirY / dirLen,
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
                    const kind = this._inferWorldKindFromEntityKey(targetEntityKey);
                    target = {
                        entityKey: targetEntityKey,
                        kind,
                        x,
                        y,
                        levelId,
                        controllerSessionId: null,
                        teamId: this._defaultTeamForKind(kind),
                        hitRadius: this._defaultHitRadiusForKind(kind),
                        stats: this._defaultStatsForKind(kind),
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
                target.teamId = target.teamId ?? this._defaultTeamForKind(target.kind);
                target.hitRadius = Number.isFinite(target.hitRadius)
                    ? target.hitRadius
                    : this._defaultHitRadiusForKind(target.kind);
                if (!target.stats) {
                    target.stats = this._defaultStatsForKind(target.kind);
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
                const kind = prev?.kind ?? this._inferWorldKindFromEntityKey(entityKey);
                const next = {
                    ...(prev ?? {}),
                    entityKey,
                    kind,
                    x: data.x,
                    y: data.y,
                    levelId,
                    controllerSessionId: sessionId,
                    possessionEndAtMs: prev?.possessionEndAtMs ?? null,
                    teamId: prev?.teamId ?? this._defaultTeamForKind(kind),
                    hitRadius: Number.isFinite(prev?.hitRadius)
                        ? prev.hitRadius
                        : this._defaultHitRadiusForKind(kind),
                    stats: prev?.stats ?? this._defaultStatsForKind(kind),
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
                const source = this._resolveAttackSource(sessionId, levelId);
                const sourceTeamId = source?.teamId ?? TEAM_PLAYERS;
                const sourceEntityKey = source?.entityKey ?? `player:${sessionId}`;
                const projectileLevelId = typeof levelId === 'string'
                    ? levelId
                    : (source?.levelId ?? null);

                const normalizedType = projectileType === 'arrow' ? 'arrow' : 'bullet';
                const ratio = Math.max(0, Math.min(1, chargeRatio ?? 0));
                const damage = normalizedType === 'arrow'
                    ? Math.round(ARROW_MIN_DAMAGE + (ARROW_MAX_DAMAGE - ARROW_MIN_DAMAGE) * ratio)
                    : BULLET_DAMAGE;
                const maxRange = normalizedType === 'arrow' ? ARROW_MAX_RANGE : BULLET_MAX_RANGE;

                if (normalizedType === 'arrow') {
                    const projectileId = this._spawnProjectile({
                        shooterSessionId: sessionId,
                        shooterEntityKey: sourceEntityKey,
                        shooterTeamId: sourceTeamId,
                        projectileType: normalizedType,
                        x,
                        y,
                        velocityX,
                        velocityY,
                        levelId: projectileLevelId,
                        damage,
                        maxRange,
                        penetration: Number.isFinite(penetration)
                            ? Math.max(0, Math.floor(penetration))
                            : ARROW_BASE_PENETRATION,
                    });
                    this.#broadcast({
                        type:      MSG.BULLET_FIRED,
                        sessionId,
                        x, y, velocityX, velocityY, levelId: projectileLevelId,
                        projectileId,
                        projectileType: normalizedType,
                        chargeRatio: ratio,
                        penetration: Number.isFinite(penetration)
                            ? Math.max(0, Math.floor(penetration))
                            : ARROW_BASE_PENETRATION,
                    }, ws);
                } else {
                    // Keep legacy bullet behavior as hitscan; filtering is team-based.
                    let hitEntityKey = null;
                    let hitT = Infinity;

                    const candidates = this._listDamageableCombatantsInLevel(projectileLevelId);
                    for (const target of candidates) {
                        if (target.entityKey === sourceEntityKey) continue;
                        if (!this._canDamage(sourceTeamId, target.teamId)) continue;
                        const t = rayHitDistance(
                            x,
                            y,
                            velocityX,
                            velocityY,
                            target.x,
                            target.y,
                            target.hitRadius,
                            maxRange
                        );
                        if (t !== null && t < hitT) {
                            hitT = t;
                            hitEntityKey = target.entityKey;
                        }
                    }

                    if (hitEntityKey) {
                        this._applyDamageToEntity(hitEntityKey, damage, sourceEntityKey);
                    }
                    // Relay bullet visuals to other clients.
                    this.#broadcast({
                        type:      MSG.BULLET_FIRED,
                        sessionId,
                        x, y, velocityX, velocityY, levelId: projectileLevelId,
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
                    targetEntityKey: null,
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
                entity.ai.targetEntityKey = null;
                this.worldEntities.set(entityKey, entity);
                continue;
            }

            const target = this._findNearestHostileCombatantInRange(entityKey, BANDIT_AGGRO_RANGE);
            const targetCombatant = target ? this._getCombatantByEntityKey(target.entityKey) : null;
            const targetDist = target ? Math.sqrt(target.distSq) : Infinity;
            const sameLevelAsHome = (entity.levelId ?? null) === (entity.home?.levelId ?? null);
            const homeDx = (entity.home?.x ?? entity.x) - entity.x;
            const homeDy = (entity.home?.y ?? entity.y) - entity.y;
            const homeDist = Math.sqrt(homeDx * homeDx + homeDy * homeDy);
            const beyondLeash = !sameLevelAsHome || homeDist > BANDIT_LEASH_RANGE;

            let nextState = entity.ai.state ?? 'idle';
            if (!targetCombatant && nextState !== 'return_home') {
                nextState = homeDist > 20 ? 'return_home' : 'idle';
            }
            if (targetCombatant) {
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
            entity.ai.targetEntityKey = targetCombatant ? targetCombatant.entityKey : null;
            entity.intent = {
                up: false,
                down: false,
                left: false,
                right: false,
                sprint: false,
            };

            if (nextState === 'chase' && targetCombatant) {
                const dx = targetCombatant.x - entity.x;
                const dy = targetCombatant.y - entity.y;
                const len = Math.hypot(dx, dy) || 1;
                entity.intent = intentFromVector(dx / len, dy / len, targetDist > 200);
            } else if (nextState === 'return_home') {
                const dx = (entity.home?.x ?? entity.x) - entity.x;
                const dy = (entity.home?.y ?? entity.y) - entity.y;
                const len = Math.hypot(dx, dy) || 1;
                entity.intent = intentFromVector(dx / len, dy / len, homeDist > 160);
            } else if (nextState === 'attack' && targetCombatant && entity.ai.attackCooldownMs <= 0) {
                this._applyBanditMeleeHit(entityKey, targetCombatant.entityKey, now);
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
        shooterEntityKey = null,
        shooterTeamId = TEAM_PLAYERS,
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
            shooterEntityKey,
            shooterTeamId,
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

                const candidates = this._listDamageableCombatantsInLevel(projectile.levelId);
                for (const target of candidates) {
                    if (projectile.hitEntities.has(target.entityKey)) continue;
                    if (projectile.shooterEntityKey && target.entityKey === projectile.shooterEntityKey) continue;
                    if (!this._canDamage(projectile.shooterTeamId, target.teamId)) continue;
                    const t = rayHitDistance(
                        currX,
                        currY,
                        projectile.velocityX,
                        projectile.velocityY,
                        target.x,
                        target.y,
                        target.hitRadius,
                        stepRemaining
                    );
                    if (t !== null && t < nearestHitDistance) {
                        nearestHitDistance = t;
                        hitType = 'entity';
                        hitEntityKey = target.entityKey;
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
                    this._applyDamageToEntity(
                        hitEntityKey,
                        projectile.damage,
                        projectile.shooterEntityKey ?? `player:${projectile.shooterSessionId}`
                    );
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
        if (this.worldEntities.has(PRACTICE_GOLEM_KEY)) {
            const existing = this.worldEntities.get(PRACTICE_GOLEM_KEY);
            this.worldEntities.set(PRACTICE_GOLEM_KEY, {
                ...existing,
                kind: existing?.kind ?? 'golem',
                teamId: existing?.teamId ?? TEAM_PLAYERS,
                hitRadius: Number.isFinite(existing?.hitRadius) ? existing.hitRadius : GOLEM_HIT_RADIUS,
                stats: existing?.stats ?? { hp: GOLEM_HP_MAX, hpMax: GOLEM_HP_MAX },
            });
            return;
        }
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
            teamId: TEAM_PLAYERS,
            hitRadius: GOLEM_HIT_RADIUS,
            stats: { hp: GOLEM_HP_MAX, hpMax: GOLEM_HP_MAX },
        });
        if (DEBUG_WORLD_SYNC) {
            console.log('[WorldSync][Server] ensurePracticeGolem created', { x, y, levelId: PRACTICE_GOLEM_STAGE });
        }
    }

    _ensurePracticeBandit() {
        if (this.worldEntities.has(PRACTICE_BANDIT_KEY)) {
            const existing = this.worldEntities.get(PRACTICE_BANDIT_KEY);
            this.worldEntities.set(PRACTICE_BANDIT_KEY, {
                ...existing,
                kind: existing?.kind ?? 'bandit',
                teamId: existing?.teamId ?? TEAM_BANDITS,
                hitRadius: Number.isFinite(existing?.hitRadius) ? existing.hitRadius : BANDIT_HIT_RADIUS,
                stats: existing?.stats ?? { hp: BANDIT_HP_MAX, hpMax: BANDIT_HP_MAX },
            });
            return;
        }
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
            teamId: TEAM_BANDITS,
            hitRadius: BANDIT_HIT_RADIUS,
            intent: { up: false, down: false, left: false, right: false, sprint: false },
            motion: { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
            stats: { hp: BANDIT_HP_MAX, hpMax: BANDIT_HP_MAX },
            home: { x, y, levelId: PRACTICE_BANDIT_STAGE },
            ai: {
                state: 'idle',
                targetEntityKey: null,
                attackCooldownMs: 0,
            },
        });
    }

    _findNearestHostileCombatantInRange(sourceEntityKey, range) {
        const source = this._getCombatantByEntityKey(sourceEntityKey);
        if (!source) return null;

        const rangeSq = range * range;
        let best = null;
        for (const target of this._listDamageableCombatantsInLevel(source.levelId)) {
            if (target.entityKey === source.entityKey) continue;
            if (!this._canDamage(source.teamId, target.teamId)) continue;
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > rangeSq) continue;
            if (!best || distSq < best.distSq) {
                best = { entityKey: target.entityKey, distSq };
            }
        }
        return best;
    }

    _resolveMeleeProfile(weaponId, phaseIndex) {
        if (weaponId === 'sword') {
            const idx = Math.max(0, Math.min(2, Number.isFinite(phaseIndex) ? Math.floor(phaseIndex) : 0));
            const swordProfiles = [
                { damage: SWORD_MELEE_DAMAGE_1, radius: 58, arc: Math.PI * 0.62 },
                { damage: SWORD_MELEE_DAMAGE_2, radius: 74, arc: Math.PI * 0.72 },
                { damage: SWORD_MELEE_DAMAGE_3, radius: 102, arc: Math.PI * 0.88 },
            ];
            return swordProfiles[idx];
        }

        return { damage: FISTS_MELEE_DAMAGE, radius: 46, arc: Math.PI * 0.56 };
    }

    _applyPlayerMeleeAttack(sessionId, { weaponId, phaseIndex, levelId, dirX, dirY }) {
        const source = this._resolveAttackSource(sessionId, levelId);
        if (!source) return;
        const originX = source.x;
        const originY = source.y;
        const sourceTeamId = source.teamId;
        const sourceLevelId = source.levelId ?? levelId;
        if (!Number.isFinite(originX) || !Number.isFinite(originY)) return;

        this._broadcastMeleeAttack({
            sessionId,
            attackerEntityKey: source.entityKey,
            weaponId,
            phaseIndex,
            levelId: sourceLevelId,
            originX,
            originY,
            dirX,
            dirY,
        });

        const profile = this._resolveMeleeProfile(weaponId, phaseIndex);
        const radiusSq = profile.radius * profile.radius;
        const minDot = Math.cos(profile.arc / 2);

        const candidates = this._listDamageableCombatantsInLevel(sourceLevelId);
        for (const target of candidates) {
            if (target.entityKey === source.entityKey) continue;
            if (!this._canDamage(sourceTeamId, target.teamId)) continue;

            const dx = target.x - originX;
            const dy = target.y - originY;
            const distSq = dx * dx + dy * dy;
            if (distSq > radiusSq) continue;

            const dist = Math.sqrt(distSq);
            let dot = 1;
            if (dist > 0.001) {
                dot = ((dx / dist) * dirX) + ((dy / dist) * dirY);
            }
            if (dot < minDot) continue;

            this._applyDamageToEntity(target.entityKey, profile.damage, source.entityKey);
        }
    }

    _applyBanditMeleeHit(attackerEntityKey, victimEntityKey, nowMs) {
        const attacker = this._getCombatantByEntityKey(attackerEntityKey);
        const victim = this._getCombatantByEntityKey(victimEntityKey);
        if (attacker && victim) {
            const dx = victim.x - attacker.x;
            const dy = victim.y - attacker.y;
            const len = Math.hypot(dx, dy);
            const dirX = len > 0.001 ? dx / len : 1;
            const dirY = len > 0.001 ? dy / len : 0;
            this._broadcastMeleeAttack({
                sessionId: null,
                attackerEntityKey,
                weaponId: 'unarmed',
                phaseIndex: 0,
                levelId: attacker.levelId ?? null,
                originX: attacker.x,
                originY: attacker.y,
                dirX,
                dirY,
            });
        }
        this._applyDamageToEntity(victimEntityKey, BANDIT_ATTACK_DAMAGE, attackerEntityKey, nowMs);
    }

    _broadcastMeleeAttack({
        sessionId = null,
        attackerEntityKey = null,
        weaponId = 'unarmed',
        phaseIndex = 0,
        levelId = null,
        originX = null,
        originY = null,
        dirX = 1,
        dirY = 0,
    }) {
        this.#broadcastAll({
            type: MSG.MELEE_ATTACK,
            sessionId: typeof sessionId === 'string' ? sessionId : null,
            attackerEntityKey: typeof attackerEntityKey === 'string' ? attackerEntityKey : null,
            weaponId: weaponId === 'sword' ? 'sword' : 'unarmed',
            phaseIndex: Number.isFinite(phaseIndex) ? Math.max(0, Math.floor(phaseIndex)) : 0,
            levelId: typeof levelId === 'string' ? levelId : null,
            originX: Number.isFinite(originX) ? originX : null,
            originY: Number.isFinite(originY) ? originY : null,
            dirX: Number.isFinite(dirX) ? dirX : 1,
            dirY: Number.isFinite(dirY) ? dirY : 0,
        });
    }

    _applyDamageToPlayer(victimSessionId, damage, attackerId, timestamp = null, attackerTeamId = null) {
        const victim = this.players.get(victimSessionId);
        if (!victim) return;
        if (!this._canDamage(attackerTeamId, this._getPlayerTeamId(victimSessionId))) return;

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
        const defaultStats = this._defaultStatsForKind(entity.kind);
        const hpMax = Number.isFinite(entity.stats?.hpMax) ? entity.stats.hpMax : defaultStats.hpMax;
        const hp = Number.isFinite(entity.stats?.hp) ? entity.stats.hp : hpMax;
        const nextHp = Math.max(0, hp - damage);
        const died = nextHp <= 0;

        this.#broadcastAll({
            type: MSG.WORLD_ENTITY_DAMAGED,
            entityKey,
            damage,
            hp: died ? 0 : nextHp,
            died,
            x: Number.isFinite(entity.x) ? entity.x : null,
            y: Number.isFinite(entity.y) ? entity.y : null,
            levelId: entity.levelId ?? null,
        });
        if (died) {
            this.worldEntities.delete(entityKey);
            return;
        }
        this.worldEntities.set(entityKey, {
            ...entity,
            stats: { hp: nextHp, hpMax },
        });
    }

    _applyDamageToEntity(targetEntityKey, damage, attackerEntityKey = null, timestamp = null) {
        if (typeof targetEntityKey !== 'string') return;
        if (!Number.isFinite(damage) || damage <= 0) return;
        if (attackerEntityKey && targetEntityKey === attackerEntityKey) return;

        const attackerTeamId = this._getEntityTeamId(attackerEntityKey);
        const targetTeamId = this._getEntityTeamId(targetEntityKey);
        if (!this._canDamage(attackerTeamId, targetTeamId)) return;

        if (targetEntityKey.startsWith('player:')) {
            const victimSessionId = targetEntityKey.slice('player:'.length);
            this._applyDamageToPlayer(victimSessionId, damage, attackerEntityKey, timestamp, attackerTeamId);
            return;
        }
        if (targetEntityKey.startsWith('world:')) {
            this._applyDamageToWorldEntity(targetEntityKey, damage);
        }
    }

    _defaultTeamForKind(kind) {
        if (kind === 'bandit') return TEAM_BANDITS;
        if (kind === 'golem' || kind === 'player') return TEAM_PLAYERS;
        return TEAM_NEUTRAL;
    }

    _defaultHitRadiusForKind(kind) {
        if (kind === 'bandit') return BANDIT_HIT_RADIUS;
        if (kind === 'golem') return GOLEM_HIT_RADIUS;
        if (kind === 'player') return PLAYER_RADIUS;
        return PLAYER_RADIUS;
    }

    _defaultStatsForKind(kind) {
        if (kind === 'bandit') return { hp: BANDIT_HP_MAX, hpMax: BANDIT_HP_MAX };
        if (kind === 'golem') return { hp: GOLEM_HP_MAX, hpMax: GOLEM_HP_MAX };
        return { hp: 0, hpMax: 0 };
    }

    _inferWorldKindFromEntityKey(entityKey) {
        if (entityKey === PRACTICE_GOLEM_KEY) return 'golem';
        if (entityKey === PRACTICE_BANDIT_KEY) return 'bandit';
        return null;
    }

    _getPlayerTeamId(sessionId) {
        const player = this.players.get(sessionId);
        return player?.teamId ?? TEAM_PLAYERS;
    }

    _getWorldEntityTeamId(entity) {
        return entity?.teamId ?? this._defaultTeamForKind(entity?.kind ?? null);
    }

    _getEntityTeamId(entityKey) {
        if (typeof entityKey !== 'string') return TEAM_NEUTRAL;
        if (entityKey.startsWith('player:')) {
            return this._getPlayerTeamId(entityKey.slice('player:'.length));
        }
        if (entityKey.startsWith('world:')) {
            return this._getWorldEntityTeamId(this.worldEntities.get(entityKey));
        }
        return TEAM_NEUTRAL;
    }

    _canDamage(sourceTeamId, targetTeamId) {
        if (!sourceTeamId || !targetTeamId) return true;
        return sourceTeamId !== targetTeamId;
    }

    _getWorldEntityHitRadius(entity) {
        if (Number.isFinite(entity?.hitRadius) && entity.hitRadius > 0) return entity.hitRadius;
        return this._defaultHitRadiusForKind(entity?.kind ?? null);
    }

    _getCombatantByEntityKey(entityKey) {
        if (typeof entityKey !== 'string') return null;

        if (entityKey.startsWith('player:')) {
            const sessionId = entityKey.slice('player:'.length);
            const player = this.players.get(sessionId);
            if (!player) return null;
            const x = player?.transform?.x;
            const y = player?.transform?.y;
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return {
                entityKey,
                domain: 'player',
                kind: 'player',
                teamId: this._getPlayerTeamId(sessionId),
                levelId: player.transform?.levelId ?? null,
                x,
                y,
                hitRadius: PLAYER_RADIUS,
                hp: player?.stats?.hp ?? null,
                hpMax: PLAYER_HEALTH_MAX,
                controllerSessionId: sessionId,
            };
        }

        if (entityKey.startsWith('world:')) {
            const entity = this.worldEntities.get(entityKey);
            if (!entity) return null;
            if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return null;
            const defaultStats = this._defaultStatsForKind(entity.kind);
            return {
                entityKey,
                domain: 'world',
                kind: entity.kind ?? null,
                teamId: this._getWorldEntityTeamId(entity),
                levelId: entity.levelId ?? null,
                x: entity.x,
                y: entity.y,
                hitRadius: this._getWorldEntityHitRadius(entity),
                hp: Number.isFinite(entity?.stats?.hp) ? entity.stats.hp : defaultStats.hp,
                hpMax: Number.isFinite(entity?.stats?.hpMax) ? entity.stats.hpMax : defaultStats.hpMax,
                controllerSessionId: entity.controllerSessionId ?? null,
            };
        }

        return null;
    }

    _isCombatantDamageable(combatant) {
        if (!combatant) return false;
        if (combatant.domain === 'player') return Number.isFinite(combatant.hpMax) && combatant.hpMax > 0;
        return Number.isFinite(combatant.hpMax) && combatant.hpMax > 0;
    }

    _listDamageableCombatantsInLevel(levelId) {
        const candidates = [];

        for (const [sessionId, player] of this.players.entries()) {
            if ((player?.transform?.levelId ?? null) !== levelId) continue;
            const combatant = this._getCombatantByEntityKey(`player:${sessionId}`);
            if (!this._isCombatantDamageable(combatant)) continue;
            candidates.push(combatant);
        }

        for (const [entityKey, entity] of this.worldEntities.entries()) {
            if ((entity?.levelId ?? null) !== levelId) continue;
            const combatant = this._getCombatantByEntityKey(entityKey);
            if (!this._isCombatantDamageable(combatant)) continue;
            candidates.push(combatant);
        }

        return candidates;
    }

    _resolveAttackSource(sessionId, fallbackLevelId = null) {
        const player = this.players.get(sessionId);
        if (!player) return null;

        const controlledEntityKey = player.controlledEntityKey ?? `player:${sessionId}`;
        if (controlledEntityKey.startsWith('world:')) {
            const controlled = this.worldEntities.get(controlledEntityKey);
            if (controlled?.controllerSessionId === sessionId) {
                const combatant = this._getCombatantByEntityKey(controlledEntityKey);
                if (combatant) return combatant;
            }
        }

        const fallback = this._getCombatantByEntityKey(`player:${sessionId}`);
        if (fallback) return fallback;

        if (!Number.isFinite(player?.transform?.x) || !Number.isFinite(player?.transform?.y)) return null;
        return {
            entityKey: `player:${sessionId}`,
            domain: 'player',
            kind: 'player',
            teamId: this._getPlayerTeamId(sessionId),
            levelId: player.transform?.levelId ?? fallbackLevelId ?? null,
            x: player.transform.x,
            y: player.transform.y,
            hitRadius: PLAYER_RADIUS,
            hp: player?.stats?.hp ?? null,
            hpMax: PLAYER_HEALTH_MAX,
            controllerSessionId: sessionId,
        };
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
            teamId: this._getWorldEntityTeamId(entry),
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
