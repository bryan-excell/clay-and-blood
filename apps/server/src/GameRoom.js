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
    PLAYER_SPEED,
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
    ARCHETYPE_CONFIG,
    TEAM_IDS,
    REACTION_CONFIG,
    resolveArchetypeConfig,
    resolveMeleeAttackProfile,
    PROJECTILE_POISE_DAMAGE,
    resolveSpellConfig,
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
const PRACTICE_ZOMBIE_KEY = 'world:zombie_1';
const PRACTICE_ZOMBIE_STAGE = 'west-gate';
const PRACTICE_ZOMBIE_TILE_X = 6;
const PRACTICE_ZOMBIE_TILE_Y = 4;
const ZOMBIE_DETECTION_RANGE = ARCHETYPE_CONFIG.zombie.ai.detectionRange;
const ZOMBIE_LEASH_RANGE = ARCHETYPE_CONFIG.zombie.ai.leashRange;
const ZOMBIE_ATTACK_RANGE = ARCHETYPE_CONFIG.zombie.ai.attackRange;
const ZOMBIE_REEL_BACK_MS = ARCHETYPE_CONFIG.zombie.ai.reelBackMs;
const ZOMBIE_REEL_BACK_DISTANCE = ARCHETYPE_CONFIG.zombie.ai.reelBackDistance;
const ZOMBIE_WINDUP_MS = ARCHETYPE_CONFIG.zombie.ai.windupMs;
const ZOMBIE_WINDUP_DISTANCE = ARCHETYPE_CONFIG.zombie.ai.windupDistance;
const ZOMBIE_RECOVER_MS = ARCHETYPE_CONFIG.zombie.ai.recoverMs;
const ZOMBIE_SHAMBLE_SPEED = ARCHETYPE_CONFIG.zombie.ai.shambleSpeed;
const ZOMBIE_CHASE_SPEED = ARCHETYPE_CONFIG.zombie.ai.chaseSpeed;
const ZOMBIE_SHAMBLE_WALK_MIN_MS = ARCHETYPE_CONFIG.zombie.ai.shambleWalkMinMs;
const ZOMBIE_SHAMBLE_WALK_MAX_MS = ARCHETYPE_CONFIG.zombie.ai.shambleWalkMaxMs;
const ZOMBIE_SHAMBLE_PAUSE_MIN_MS = ARCHETYPE_CONFIG.zombie.ai.shamblePauseMinMs;
const ZOMBIE_SHAMBLE_PAUSE_MAX_MS = ARCHETYPE_CONFIG.zombie.ai.shamblePauseMaxMs;
const ZOMBIE_HIT_RADIUS = ARCHETYPE_CONFIG.zombie.hitRadius;
const ZOMBIE_HP_MAX = ARCHETYPE_CONFIG.zombie.hpMax;
const GOLEM_HIT_RADIUS = ARCHETYPE_CONFIG.golem.hitRadius;
const GOLEM_HP_MAX = ARCHETYPE_CONFIG.golem.hpMax;
const FLINCH_DURATION_MS = REACTION_CONFIG.flinchDurationMs;
const STAGGER_DURATION_MS = REACTION_CONFIG.staggerDurationMs;
const TEAM_PLAYERS = TEAM_IDS.players;
const TEAM_ZOMBIES = TEAM_IDS.zombies;
const TEAM_NEUTRAL = TEAM_IDS.neutral;
const IMPOSING_FLAME_SPELL_ID = 'imposing_flame';
const GELID_CRADLE_SPELL_ID = 'gelid_cradle';
const ARC_FLASH_SPELL_ID = 'arc_flash';
const ARC_FLASH_RAY_HIT_EPSILON = 0.5; // px tolerance to avoid endpoint precision misses
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
        this.pendingSpellEffects = new Map(); // effectId -> { id, spellId, sourceEntityKey, sourceTeamId, levelId, x, y, executeAtMs, damage, poiseDamage, radius }
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
                this._ensurePracticeZombie();
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
                    poise: this._defaultPoiseForKind('player'),
                    spellState: { pendingCast: null, cooldownUntilBySpellId: {} },
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
                const playerEntityKey = `player:${sessionId}`;
                const incapacitated = this._isEntityIncapacitated(playerEntityKey, Date.now());

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
                        up:     !incapacitated && !!data.up,
                        down:   !incapacitated && !!data.down,
                        left:   !incapacitated && !!data.left,
                        right:  !incapacitated && !!data.right,
                        sprint: !incapacitated && !!data.sprint,
                        moveSpeedMultiplier: (Number.isFinite(data.moveSpeedMultiplier)
                            ? Math.max(0, Math.min(1, data.moveSpeedMultiplier))
                            : 1) * this._resolveSpellWindupMoveMultiplier(player, Date.now()),
                        attackPushVx: !incapacitated && Number.isFinite(data.attackPushVx)
                            ? Math.max(-800, Math.min(800, data.attackPushVx))
                            : 0,
                        attackPushVy: !incapacitated && Number.isFinite(data.attackPushVy)
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
                if (this._isEntityIncapacitated(`player:${sessionId}`, Date.now())) break;
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
                        poise: this._defaultPoiseForKind(kind),
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
                    poise: prev?.poise ?? this._defaultPoiseForKind(kind),
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
                if (this._isEntityIncapacitated(`player:${sessionId}`, Date.now())) break;
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
                const poiseDamage = normalizedType === 'arrow'
                    ? (PROJECTILE_POISE_DAMAGE.arrow ?? 0)
                    : (PROJECTILE_POISE_DAMAGE.bullet ?? 0);
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
                        poiseDamage,
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
                        this._applyDamageToEntity(hitEntityKey, damage, sourceEntityKey, null, poiseDamage);
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
            case MSG.SPELL_CAST: {
                if (this._isEntityIncapacitated(`player:${sessionId}`, Date.now())) break;
                const spellId = sanitizeEquipId(data.spellId);
                if (!spellId) break;
                const targetX = Number.isFinite(data.targetX) ? data.targetX : 0;
                const targetY = Number.isFinite(data.targetY) ? data.targetY : 0;
                const targetEntityKey = sanitizeEntityKey(data.targetEntityKey);
                const levelId = typeof data.levelId === 'string' ? data.levelId : null;
                this._queueSpellCastForPlayer(sessionId, { spellId, targetX, targetY, targetEntityKey, levelId });
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
        this._phaseUpdatePoiseAndReactions();
        const inputPhase = this._phaseInputIntent();
        const locomotionPhase = this._phaseLocomotionDash(inputPhase);
        this._phasePhysicsTransform(locomotionPhase);
        this._phaseZombieAi();
        this._phaseZombieMovement();
        this._phaseSpellCasts();
        this._phaseSpellEffects();
        this._phaseProjectiles();

        const snapshotPlayers = this._phaseBuildSnapshotPlayers();
        this._phaseRecordLagCompHistory();
        this._phaseBroadcastSnapshot(snapshotPlayers);
    }

    _phaseExpirePossessions() {
        this._ensurePracticeGolem();
        this._ensurePracticeZombie();
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

    _phaseZombieAi() {
        for (const [entityKey, entity] of this.worldEntities.entries()) {
            if (entity?.kind !== 'zombie') continue;
            if (entity.controllerSessionId) {
                this.worldEntities.set(entityKey, entity);
                continue;
            }
            if (this._isEntityIncapacitated(entityKey, Date.now())) {
                entity.intent = this._zombieIdleIntent();
                this.worldEntities.set(entityKey, entity);
                continue;
            }

            if (!entity.home) {
                entity.home = {
                    x: entity.x,
                    y: entity.y,
                    levelId: entity.levelId ?? PRACTICE_ZOMBIE_STAGE,
                };
            }

            if (!entity.ai) {
                entity.ai = {
                    state: 'shamble_pause',
                    stateTimerMs: this._randZombiePauseMs(),
                    targetEntityKey: null,
                    shambleDirX: 1,
                    shambleDirY: 0,
                    attackDirX: 1,
                    attackDirY: 0,
                    distanceBudgetPx: 0,
                };
            }

            const ai = entity.ai;
            ai.stateTimerMs = Math.max(0, (ai.stateTimerMs ?? 0) - TICK_MS);
            const sameLevelAsHome = (entity.levelId ?? null) === (entity.home?.levelId ?? null);
            const homeDx = (entity.home?.x ?? entity.x) - entity.x;
            const homeDy = (entity.home?.y ?? entity.y) - entity.y;
            const homeDist = Math.hypot(homeDx, homeDy);
            const beyondLeash = !sameLevelAsHome || homeDist > ZOMBIE_LEASH_RANGE;

            const nearestHostile = this._findNearestHostileCombatantInRange(entityKey, ZOMBIE_DETECTION_RANGE);
            const targetCombatant = nearestHostile ? this._getCombatantByEntityKey(nearestHostile.entityKey) : null;
            ai.targetEntityKey = targetCombatant?.entityKey ?? null;

            let desiredState = ai.state ?? 'shamble_pause';
            if (desiredState === 'reel_back' || desiredState === 'windup_drive') {
                // Keep active attack phases until they finish.
                desiredState = ai.state;
            } else if (targetCombatant && !beyondLeash) {
                const dx = targetCombatant.x - entity.x;
                const dy = targetCombatant.y - entity.y;
                const dist = Math.hypot(dx, dy);
                if (dist <= ZOMBIE_ATTACK_RANGE) {
                    desiredState = 'reel_back';
                    const n = dist > 0.001 ? 1 / dist : 0;
                    ai.attackDirX = dist > 0.001 ? dx * n : 1;
                    ai.attackDirY = dist > 0.001 ? dy * n : 0;
                } else {
                    desiredState = 'chase';
                }
            } else if (homeDist > 12) {
                desiredState = 'shamble_walk';
            } else {
                desiredState = 'shamble_pause';
            }

            if (desiredState !== ai.state) {
                ai.state = desiredState;
                if (desiredState === 'shamble_pause') {
                    ai.stateTimerMs = this._randZombiePauseMs();
                } else if (desiredState === 'shamble_walk') {
                    ai.stateTimerMs = this._randZombieWalkMs();
                    if (homeDist > ZOMBIE_LEASH_RANGE * 0.8 && homeDist > 0.001) {
                        ai.shambleDirX = homeDx / homeDist;
                        ai.shambleDirY = homeDy / homeDist;
                    } else {
                        const angle = Math.random() * Math.PI * 2;
                        ai.shambleDirX = Math.cos(angle);
                        ai.shambleDirY = Math.sin(angle);
                    }
                } else if (desiredState === 'reel_back') {
                    ai.stateTimerMs = ZOMBIE_REEL_BACK_MS;
                    ai.distanceBudgetPx = ZOMBIE_REEL_BACK_DISTANCE;
                } else if (desiredState === 'windup_drive') {
                    ai.stateTimerMs = ZOMBIE_WINDUP_MS;
                    ai.distanceBudgetPx = ZOMBIE_WINDUP_DISTANCE;
                }
            }

            entity.intent = this._zombieIdleIntent();
            if (ai.state === 'shamble_pause') {
                if (ai.stateTimerMs <= 0) {
                    ai.state = 'shamble_walk';
                    ai.stateTimerMs = this._randZombieWalkMs();
                    if (homeDist > ZOMBIE_LEASH_RANGE * 0.8 && homeDist > 0.001) {
                        ai.shambleDirX = homeDx / homeDist;
                        ai.shambleDirY = homeDy / homeDist;
                    } else {
                        const angle = Math.random() * Math.PI * 2;
                        ai.shambleDirX = Math.cos(angle);
                        ai.shambleDirY = Math.sin(angle);
                    }
                }
            } else if (ai.state === 'shamble_walk') {
                const dirX = beyondLeash && homeDist > 0.001 ? homeDx / homeDist : ai.shambleDirX;
                const dirY = beyondLeash && homeDist > 0.001 ? homeDy / homeDist : ai.shambleDirY;
                entity.intent = this._zombieMoveIntent(dirX, dirY, ZOMBIE_SHAMBLE_SPEED);
                if (ai.stateTimerMs <= 0) {
                    ai.state = 'shamble_pause';
                    ai.stateTimerMs = this._randZombiePauseMs();
                }
            } else if (ai.state === 'chase') {
                if (targetCombatant) {
                    const dx = targetCombatant.x - entity.x;
                    const dy = targetCombatant.y - entity.y;
                    const dist = Math.hypot(dx, dy);
                    if (dist > 0.001) {
                        entity.intent = this._zombieMoveIntent(dx / dist, dy / dist, ZOMBIE_CHASE_SPEED);
                    }
                }
            } else if (ai.state === 'reel_back') {
                const durationMs = Math.max(TICK_MS, ai.stateTimerMs + TICK_MS);
                const speed = ai.distanceBudgetPx > 0 ? (ai.distanceBudgetPx * 1000) / durationMs : 0;
                entity.intent = this._zombieMoveIntent(-ai.attackDirX, -ai.attackDirY, speed);
                ai.distanceBudgetPx = Math.max(0, ai.distanceBudgetPx - (speed * TICK_MS / 1000));
                if (ai.stateTimerMs <= 0) {
                    ai.state = 'windup_drive';
                    ai.stateTimerMs = ZOMBIE_WINDUP_MS;
                    ai.distanceBudgetPx = ZOMBIE_WINDUP_DISTANCE;
                }
            } else if (ai.state === 'windup_drive') {
                const durationMs = Math.max(TICK_MS, ai.stateTimerMs + TICK_MS);
                const speed = ai.distanceBudgetPx > 0 ? (ai.distanceBudgetPx * 1000) / durationMs : 0;
                entity.intent = this._zombieMoveIntent(ai.attackDirX, ai.attackDirY, speed);
                ai.distanceBudgetPx = Math.max(0, ai.distanceBudgetPx - (speed * TICK_MS / 1000));
                if (ai.stateTimerMs <= 0) {
                    this._applyWorldEntityMeleeAttack(entityKey, {
                        weaponId: 'zombie_strike',
                        phaseIndex: 0,
                        levelId: entity.levelId ?? null,
                        dirX: ai.attackDirX,
                        dirY: ai.attackDirY,
                    });
                    ai.state = 'shamble_pause';
                    ai.stateTimerMs = ZOMBIE_RECOVER_MS;
                }
            }

            this.worldEntities.set(entityKey, entity);
        }
    }

    _phaseZombieMovement() {
        for (const [entityKey, entity] of this.worldEntities.entries()) {
            if (entity?.kind !== 'zombie') continue;
            if (entity.controllerSessionId) continue;
            const grid = this._getGrid(entity.levelId ?? PRACTICE_ZOMBIE_STAGE);
            const stepped = stepPlayerKinematics(
                {
                    x: entity.x,
                    y: entity.y,
                    dashVx: entity.motion?.dashVx ?? 0,
                    dashVy: entity.motion?.dashVy ?? 0,
                    dashTimeLeftMs: entity.motion?.dashTimeLeftMs ?? 0,
                },
                entity.intent ?? this._zombieIdleIntent(),
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

    _queueSpellCastForPlayer(sessionId, { spellId, targetX, targetY, targetEntityKey = null, levelId }) {
        const player = this.players.get(sessionId);
        if (!player) return;

        const spellCfg = resolveSpellConfig(spellId);
        if (!spellCfg) return;
        const equippedSpellId = player.equipped?.spellId ?? 'nothing';
        if (equippedSpellId !== spellId) return;

        const nowMs = Date.now();
        const spellState = player.spellState ?? { pendingCast: null, cooldownUntilBySpellId: {} };
        const cooldownUntil = Number.isFinite(spellState.cooldownUntilBySpellId?.[spellId])
            ? spellState.cooldownUntilBySpellId[spellId]
            : 0;
        if (nowMs < cooldownUntil) return;
        if (spellState.pendingCast) return;

        if (spellCfg.castMode === 'target_click') {
            if (!targetEntityKey) return;
            const source = this._resolveAttackSource(sessionId, levelId);
            if (!source) return;
            if (!this._isValidSpellTarget(source, targetEntityKey)) return;
        } else if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
            return;
        }

        const windupMs = Number.isFinite(spellCfg.windupMs) ? Math.max(0, spellCfg.windupMs) : 0;
        spellState.pendingCast = {
            spellId,
            targetX,
            targetY,
            targetEntityKey,
            requestedLevelId: levelId,
            windupStartAtMs: nowMs,
            executeAtMs: nowMs + windupMs,
        };

        this.players.set(sessionId, {
            ...player,
            spellState,
        });
    }

    _phaseSpellCasts() {
        const nowMs = Date.now();
        for (const [sessionId, player] of this.players.entries()) {
            const spellState = player.spellState ?? { pendingCast: null, cooldownUntilBySpellId: {} };
            const pending = spellState.pendingCast;
            if (!pending) continue;
            if (!Number.isFinite(pending.executeAtMs) || pending.executeAtMs > nowMs) continue;

            spellState.pendingCast = null;
            this.players.set(sessionId, { ...player, spellState });
            this._executeSpellCast(sessionId, pending, nowMs);
        }
    }

    _executeSpellCast(sessionId, pendingCast, nowMs = Date.now()) {
        if (!pendingCast?.spellId) return;
        if (this._isEntityIncapacitated(`player:${sessionId}`, nowMs)) return;
        const player = this.players.get(sessionId);
        if (!player) return;
        if ((player.equipped?.spellId ?? 'nothing') !== pendingCast.spellId) return;

        const spellCfg = resolveSpellConfig(pendingCast.spellId);
        if (!spellCfg) return;

        let didCast = false;
        if (pendingCast.spellId === IMPOSING_FLAME_SPELL_ID) {
            didCast = this._castImposingFlame(sessionId, pendingCast, spellCfg);
        } else if (pendingCast.spellId === GELID_CRADLE_SPELL_ID) {
            didCast = this._castGelidCradle(sessionId, pendingCast, spellCfg, nowMs);
        } else if (pendingCast.spellId === ARC_FLASH_SPELL_ID) {
            didCast = this._castArcFlash(sessionId, pendingCast, spellCfg, nowMs);
        }
        if (!didCast) return;

        if ((spellCfg.cooldownStartsAt ?? 'cast') === 'resolution') {
            return;
        }

        const nextPlayer = this.players.get(sessionId);
        if (!nextPlayer) return;
        const nextSpellState = nextPlayer.spellState ?? { pendingCast: null, cooldownUntilBySpellId: {} };
        nextSpellState.cooldownUntilBySpellId[pendingCast.spellId] = nowMs + Math.max(0, spellCfg.cooldownMs ?? 0);
        this.players.set(sessionId, { ...nextPlayer, spellState: nextSpellState });
    }

    _setPlayerSpellCooldown(sessionId, spellId, cooldownMs, nowMs = Date.now()) {
        const player = this.players.get(sessionId);
        if (!player || !spellId) return;
        const spellState = player.spellState ?? { pendingCast: null, cooldownUntilBySpellId: {} };
        spellState.cooldownUntilBySpellId[spellId] = nowMs + Math.max(0, cooldownMs ?? 0);
        this.players.set(sessionId, { ...player, spellState });
    }

    _castImposingFlame(sessionId, pendingCast, spellCfg) {
        const source = this._resolveAttackSource(sessionId, pendingCast.requestedLevelId ?? null);
        if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.y)) return false;

        const dxRaw = pendingCast.targetX - source.x;
        const dyRaw = pendingCast.targetY - source.y;
        const rawLen = Math.sqrt(dxRaw * dxRaw + dyRaw * dyRaw);
        if (rawLen < 0.001) return false;

        const projectileCfg = spellCfg.projectile ?? {};
        const speed = Number.isFinite(projectileCfg.speed) ? Math.max(1, projectileCfg.speed) : 200;
        const maxRange = Number.isFinite(projectileCfg.maxRange) ? Math.max(1, projectileCfg.maxRange) : 500;
        const maxLifetimeMs = Number.isFinite(projectileCfg.maxLifetimeMs) ? Math.max(1, projectileCfg.maxLifetimeMs) : 1500;
        const spawnOffset = Number.isFinite(projectileCfg.spawnOffset) ? Math.max(0, projectileCfg.spawnOffset) : 0;

        const dirX = dxRaw / rawLen;
        const dirY = dyRaw / rawLen;
        const spawnX = source.x + dirX * spawnOffset;
        const spawnY = source.y + dirY * spawnOffset;
        const distToTarget = Math.sqrt((pendingCast.targetX - spawnX) ** 2 + (pendingCast.targetY - spawnY) ** 2);
        const destinationDistance = Math.max(0, Math.min(distToTarget, maxRange));
        const destinationX = spawnX + dirX * destinationDistance;
        const destinationY = spawnY + dirY * destinationDistance;
        const levelId = source.levelId ?? pendingCast.requestedLevelId ?? null;
        const burstCfg = spellCfg.burst ?? {};

        const projectileId = this._spawnProjectile({
            shooterSessionId: sessionId,
            shooterEntityKey: source.entityKey ?? `player:${sessionId}`,
            shooterTeamId: source.teamId ?? TEAM_PLAYERS,
            projectileType: IMPOSING_FLAME_SPELL_ID,
            x: spawnX,
            y: spawnY,
            velocityX: dirX * speed,
            velocityY: dirY * speed,
            levelId,
            damage: Number.isFinite(burstCfg.damage) ? Math.max(0, burstCfg.damage) : 0,
            poiseDamage: Number.isFinite(burstCfg.poiseDamage) ? Math.max(0, burstCfg.poiseDamage) : 0,
            maxRange,
            maxLifetimeMs,
            destinationX,
            destinationY,
            burstRadius: Number.isFinite(burstCfg.radius) ? Math.max(1, burstCfg.radius) : 1,
            penetration: 0,
        });
        if (!projectileId) return false;

        this.#broadcastAll({
            type: MSG.BULLET_FIRED,
            sessionId,
            x: spawnX,
            y: spawnY,
            velocityX: dirX * speed,
            velocityY: dirY * speed,
            levelId,
            projectileId,
            projectileType: IMPOSING_FLAME_SPELL_ID,
            chargeRatio: 1,
            penetration: 0,
        });
        return true;
    }

    _castGelidCradle(sessionId, pendingCast, spellCfg, nowMs = Date.now()) {
        const source = this._resolveAttackSource(sessionId, pendingCast.requestedLevelId ?? null);
        if (!source) return false;

        const burstCfg = spellCfg.burst ?? {};
        const radius = Number.isFinite(burstCfg.radius) ? Math.max(1, burstCfg.radius) : 1;
        const damage = Number.isFinite(burstCfg.damage) ? Math.max(0, burstCfg.damage) : 0;
        const poiseDamage = Number.isFinite(burstCfg.poiseDamage) ? Math.max(0, burstCfg.poiseDamage) : 0;
        if (damage <= 0) return false;

        const delayMs = Number.isFinite(spellCfg.manifestDelayMs) ? Math.max(0, spellCfg.manifestDelayMs) : 0;
        const effectId = crypto.randomUUID();
        this.pendingSpellEffects.set(effectId, {
            id: effectId,
            spellId: GELID_CRADLE_SPELL_ID,
            ownerSessionId: sessionId,
            sourceEntityKey: source.entityKey ?? `player:${sessionId}`,
            sourceTeamId: source.teamId ?? TEAM_PLAYERS,
            levelId: source.levelId ?? pendingCast.requestedLevelId ?? null,
            x: pendingCast.targetX,
            y: pendingCast.targetY,
            executeAtMs: nowMs + delayMs,
            damage,
            poiseDamage,
            radius,
        });
        return true;
    }

    _castArcFlash(sessionId, pendingCast, spellCfg, nowMs = Date.now()) {
        const source = this._resolveAttackSource(sessionId, pendingCast.requestedLevelId ?? null);
        if (!source) return false;
        if (!pendingCast.targetEntityKey) return false;
        if (!this._isValidSpellTarget(source, pendingCast.targetEntityKey)) return false;
        const strike = spellCfg.strike ?? {};
        const damage = Number.isFinite(strike.damage) ? Math.max(0, strike.damage) : 0;
        const poiseDamage = Number.isFinite(strike.poiseDamage) ? Math.max(0, strike.poiseDamage) : 0;
        if (damage <= 0) return false;
        const delayMs = Number.isFinite(spellCfg.manifestDelayMs) ? Math.max(0, spellCfg.manifestDelayMs) : 0;
        const effectId = crypto.randomUUID();
        this.pendingSpellEffects.set(effectId, {
            id: effectId,
            spellId: ARC_FLASH_SPELL_ID,
            ownerSessionId: sessionId,
            sourceEntityKey: source.entityKey ?? `player:${sessionId}`,
            targetEntityKey: pendingCast.targetEntityKey,
            sourceTeamId: source.teamId ?? TEAM_PLAYERS,
            levelId: source.levelId ?? pendingCast.requestedLevelId ?? null,
            executeAtMs: nowMs + delayMs,
            damage,
            poiseDamage,
            cooldownMs: Math.max(0, spellCfg.cooldownMs ?? 0),
        });
        return true;
    }

    _phaseSpellEffects(nowMs = Date.now()) {
        if (this.pendingSpellEffects.size === 0) return;
        for (const [effectId, effect] of this.pendingSpellEffects.entries()) {
            if (!effect || !Number.isFinite(effect.executeAtMs) || effect.executeAtMs > nowMs) continue;
            this.pendingSpellEffects.delete(effectId);
            if (effect.spellId === ARC_FLASH_SPELL_ID) {
                this._resolveArcFlashEffect(effect, nowMs);
                continue;
            }
            this.#broadcastAll({
                type: MSG.SPELL_EFFECT,
                spellId: effect.spellId ?? null,
                phase: 'manifest',
                x: Number.isFinite(effect.x) ? effect.x : null,
                y: Number.isFinite(effect.y) ? effect.y : null,
                levelId: effect.levelId ?? null,
            });
            this._applyAreaSpellDamage({
                levelId: effect.levelId ?? null,
                centerX: effect.x,
                centerY: effect.y,
                radius: effect.radius,
                damage: effect.damage,
                poiseDamage: effect.poiseDamage,
                sourceEntityKey: effect.sourceEntityKey,
                sourceTeamId: effect.sourceTeamId ?? TEAM_PLAYERS,
            });
        }
    }

    _resolveArcFlashEffect(effect, nowMs = Date.now()) {
        const source = this._getCombatantByEntityKey(effect.sourceEntityKey);
        const target = this._getCombatantByEntityKey(effect.targetEntityKey);
        if (!source || !target) return;
        if (!this._isCombatantDamageable(source) || !this._isCombatantDamageable(target)) return;
        if ((source.levelId ?? null) !== (target.levelId ?? null)) return;
        if (!this._canDamage(effect.sourceTeamId ?? source.teamId ?? TEAM_PLAYERS, target.teamId)) return;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const maxRange = Math.sqrt(dx * dx + dy * dy);
        if (maxRange < 0.001) return;

        const rayHit = this._resolveFirstDamageableEntityOnRay({
            levelId: source.levelId ?? null,
            sourceX: source.x,
            sourceY: source.y,
            rayVx: dx,
            rayVy: dy,
            maxRange,
            sourceEntityKey: source.entityKey,
            sourceTeamId: effect.sourceTeamId ?? source.teamId ?? TEAM_PLAYERS,
        });
        const hitEntityKey = rayHit?.entityKey ?? null;
        const hitT = Number.isFinite(rayHit?.distance) ? rayHit.distance : null;
        const hitX = Number.isFinite(hitT) ? source.x + (dx / maxRange) * hitT : target.x;
        const hitY = Number.isFinite(hitT) ? source.y + (dy / maxRange) * hitT : target.y;
        this.#broadcastAll({
            type: MSG.SPELL_EFFECT,
            spellId: ARC_FLASH_SPELL_ID,
            phase: 'flash',
            levelId: source.levelId ?? null,
            sourceX: source.x,
            sourceY: source.y,
            targetX: target.x,
            targetY: target.y,
            hitX: Number.isFinite(hitX) ? hitX : null,
            hitY: Number.isFinite(hitY) ? hitY : null,
        });

        if (hitEntityKey) {
            this._applyDamageToEntity(
                hitEntityKey,
                effect.damage,
                effect.sourceEntityKey ?? null,
                null,
                effect.poiseDamage ?? 0
            );
        }

        this._setPlayerSpellCooldown(effect.ownerSessionId, ARC_FLASH_SPELL_ID, effect.cooldownMs ?? 0, nowMs);
    }

    _resolveFirstDamageableEntityOnRay({
        levelId = null,
        sourceX,
        sourceY,
        rayVx,
        rayVy,
        maxRange,
        sourceEntityKey = null,
        sourceTeamId = TEAM_PLAYERS,
    }) {
        if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) return null;
        if (!Number.isFinite(rayVx) || !Number.isFinite(rayVy)) return null;
        if (!Number.isFinite(maxRange) || maxRange <= 0) return null;
        const tolerantMaxRange = maxRange + ARC_FLASH_RAY_HIT_EPSILON;

        let nearest = null;
        const candidates = this._listDamageableCombatantsInLevel(levelId);
        for (const candidate of candidates) {
            if (candidate.entityKey === sourceEntityKey) continue;
            if (!this._canDamage(sourceTeamId, candidate.teamId)) continue;
            const t = rayHitDistance(
                sourceX,
                sourceY,
                rayVx,
                rayVy,
                candidate.x,
                candidate.y,
                candidate.hitRadius,
                tolerantMaxRange
            );
            if (t === null) continue;
            if (!nearest || t < nearest.distance) {
                nearest = { entityKey: candidate.entityKey, distance: t };
            }
        }
        return nearest;
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
        poiseDamage = 1,
        maxRange,
        maxLifetimeMs = null,
        destinationX = null,
        destinationY = null,
        burstRadius = null,
        penetration = ARROW_BASE_PENETRATION,
    }) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (!Number.isFinite(velocityX) || !Number.isFinite(velocityY)) return null;
        if (!Number.isFinite(maxRange) || maxRange <= 0) return null;
        if (!Number.isFinite(damage) || damage <= 0) return null;

        const projectileId = crypto.randomUUID();
        const normalizedType = projectileType === 'arrow' ? 'arrow'
            : projectileType === IMPOSING_FLAME_SPELL_ID ? IMPOSING_FLAME_SPELL_ID
                : 'bullet';
        const destinationDistance = Number.isFinite(destinationX) && Number.isFinite(destinationY)
            ? Math.sqrt((destinationX - x) ** 2 + (destinationY - y) ** 2)
            : null;
        this.projectiles.set(projectileId, {
            id: projectileId,
            shooterSessionId,
            shooterEntityKey,
            shooterTeamId,
            projectileType: normalizedType,
            x,
            y,
            velocityX,
            velocityY,
            levelId: typeof levelId === 'string' ? levelId : null,
            damage,
            poiseDamage: Number.isFinite(poiseDamage) ? Math.max(0, poiseDamage) : 0,
            remainingRange: maxRange,
            remainingLifetimeMs: Number.isFinite(maxLifetimeMs) ? Math.max(0, maxLifetimeMs) : null,
            destinationX: Number.isFinite(destinationX) ? destinationX : null,
            destinationY: Number.isFinite(destinationY) ? destinationY : null,
            remainingToDestination: Number.isFinite(destinationDistance) ? destinationDistance : null,
            burstRadius: Number.isFinite(burstRadius) ? Math.max(0, burstRadius) : 0,
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
            const isImposingFlame = projectile.projectileType === IMPOSING_FLAME_SPELL_ID;
            if (isImposingFlame && Number.isFinite(projectile.remainingLifetimeMs)) {
                projectile.remainingLifetimeMs -= TICK_MS;
                if (projectile.remainingLifetimeMs <= 0) {
                    this._burstProjectile(projectile, projectile.x, projectile.y, 'lifetime');
                    this._despawnProjectile(projectileId, 'lifetime', projectile.x, projectile.y, projectile.projectileType);
                    continue;
                }
            }

            let stepRemaining = Math.min(projectile.remainingRange, speed * dtSeconds);
            if (isImposingFlame && Number.isFinite(projectile.remainingToDestination)) {
                stepRemaining = Math.min(stepRemaining, Math.max(0, projectile.remainingToDestination));
            }

            let currX = projectile.x;
            let currY = projectile.y;
            let despawned = false;
            let terminationReason = null;

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
                    if (isImposingFlame && Number.isFinite(projectile.remainingToDestination)) {
                        projectile.remainingToDestination -= stepRemaining;
                    }
                    stepRemaining = 0;
                    break;
                }

                const traveled = Math.max(0, nearestHitDistance);
                currX += dirX * traveled;
                currY += dirY * traveled;
                projectile.remainingRange -= traveled;
                if (isImposingFlame && Number.isFinite(projectile.remainingToDestination)) {
                    projectile.remainingToDestination -= traveled;
                }
                stepRemaining -= traveled;

                if (hitType === 'wall') {
                    terminationReason = 'wall';
                    if (isImposingFlame) {
                        this._burstProjectile(projectile, currX, currY, terminationReason);
                    }
                    this._despawnProjectile(projectileId, terminationReason, currX, currY, projectile.projectileType);
                    despawned = true;
                    break;
                }

                if (hitType === 'entity' && hitEntityKey) {
                    if (isImposingFlame) {
                        terminationReason = 'hit';
                        this._burstProjectile(projectile, currX, currY, terminationReason);
                    } else {
                        projectile.hitEntities.add(hitEntityKey);
                        this._applyDamageToEntity(
                            hitEntityKey,
                            projectile.damage,
                            projectile.shooterEntityKey ?? `player:${projectile.shooterSessionId}`,
                            null,
                            projectile.poiseDamage ?? 0
                        );
                    }
                }

                if (projectile.penetrationRemaining > 0) {
                    projectile.penetrationRemaining -= 1;
                    const nudge = Math.min(epsilon, stepRemaining);
                    currX += dirX * nudge;
                    currY += dirY * nudge;
                    projectile.remainingRange -= nudge;
                    if (isImposingFlame && Number.isFinite(projectile.remainingToDestination)) {
                        projectile.remainingToDestination -= nudge;
                    }
                    stepRemaining -= nudge;
                    continue;
                }

                if (!terminationReason) terminationReason = 'hit';
                this._despawnProjectile(projectileId, terminationReason, currX, currY, projectile.projectileType);
                despawned = true;
                break;
            }

            if (despawned) continue;
            if (!this.projectiles.has(projectileId)) continue;

            projectile.x = currX;
            projectile.y = currY;
            if (isImposingFlame && Number.isFinite(projectile.remainingToDestination) && projectile.remainingToDestination <= epsilon) {
                this._burstProjectile(projectile, currX, currY, 'destination');
                this._despawnProjectile(projectileId, 'destination', currX, currY, projectile.projectileType);
                continue;
            }
            if (projectile.remainingRange <= 0) {
                if (isImposingFlame) {
                    this._burstProjectile(projectile, currX, currY, 'range');
                }
                this._despawnProjectile(projectileId, 'range', currX, currY, projectile.projectileType);
            } else {
                this.projectiles.set(projectileId, projectile);
            }
        }
    }

    _burstProjectile(projectile, centerX, centerY, _reason = 'burst') {
        if (!projectile) return;
        if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return;
        const burstRadius = Number.isFinite(projectile.burstRadius) ? Math.max(0, projectile.burstRadius) : 0;
        const damage = Number.isFinite(projectile.damage) ? Math.max(0, projectile.damage) : 0;
        if (burstRadius <= 0 || damage <= 0) return;
        const poiseDamage = Number.isFinite(projectile.poiseDamage) ? Math.max(0, projectile.poiseDamage) : 0;
        this._applyAreaSpellDamage({
            levelId: projectile.levelId ?? null,
            centerX,
            centerY,
            radius: burstRadius,
            damage,
            poiseDamage,
            sourceEntityKey: projectile.shooterEntityKey ?? `player:${projectile.shooterSessionId}`,
            sourceTeamId: projectile.shooterTeamId ?? TEAM_PLAYERS,
        });
    }

    _applyAreaSpellDamage({
        levelId = null,
        centerX,
        centerY,
        radius,
        damage,
        poiseDamage = 0,
        sourceEntityKey = null,
        sourceTeamId = TEAM_PLAYERS,
    }) {
        if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return;
        if (!Number.isFinite(radius) || radius <= 0) return;
        if (!Number.isFinite(damage) || damage <= 0) return;

        const targets = this._listDamageableCombatantsInLevel(levelId);
        for (const target of targets) {
            if (sourceEntityKey && target.entityKey === sourceEntityKey) continue;
            if (!this._canDamage(sourceTeamId, target.teamId)) continue;
            const dx = target.x - centerX;
            const dy = target.y - centerY;
            const hitDistance = radius + Math.max(0, target.hitRadius);
            if (dx * dx + dy * dy > hitDistance * hitDistance) continue;
            this._applyDamageToEntity(target.entityKey, damage, sourceEntityKey, null, poiseDamage);
        }
    }

    _resolveSpellWindupMoveMultiplier(player, nowMs = Date.now()) {
        const pending = player?.spellState?.pendingCast ?? null;
        if (!pending) return 1;
        if (!Number.isFinite(pending.executeAtMs) || pending.executeAtMs <= nowMs) return 1;
        const spellCfg = resolveSpellConfig(pending.spellId);
        if (!spellCfg) return 1;
        const configured = Number.isFinite(spellCfg.windupMoveSpeedMultiplier)
            ? spellCfg.windupMoveSpeedMultiplier
            : 1;
        return Math.max(0, Math.min(1, configured));
    }

    _despawnProjectile(projectileId, reason = 'unknown', x = null, y = null, projectileType = 'bullet') {
        const existed = this.projectiles.delete(projectileId);
        if (!existed) return;
        this.#broadcastAll({
            type: MSG.PROJECTILE_DESPAWN,
            projectileId,
            reason,
            x: Number.isFinite(x) ? x : null,
            y: Number.isFinite(y) ? y : null,
            projectileType,
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
                poise: existing?.poise ?? this._defaultPoiseForKind('golem'),
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
            poise: this._defaultPoiseForKind('golem'),
        });
        if (DEBUG_WORLD_SYNC) {
            console.log('[WorldSync][Server] ensurePracticeGolem created', { x, y, levelId: PRACTICE_GOLEM_STAGE });
        }
    }

    _ensurePracticeZombie() {
        if (this.worldEntities.has(PRACTICE_ZOMBIE_KEY)) {
            const existing = this.worldEntities.get(PRACTICE_ZOMBIE_KEY);
            this.worldEntities.set(PRACTICE_ZOMBIE_KEY, {
                ...existing,
                kind: existing?.kind ?? 'zombie',
                teamId: existing?.teamId ?? TEAM_ZOMBIES,
                hitRadius: Number.isFinite(existing?.hitRadius) ? existing.hitRadius : ZOMBIE_HIT_RADIUS,
                stats: existing?.stats ?? { hp: ZOMBIE_HP_MAX, hpMax: ZOMBIE_HP_MAX },
                poise: existing?.poise ?? this._defaultPoiseForKind('zombie'),
            });
            return;
        }
        const x = PRACTICE_ZOMBIE_TILE_X * TILE_SIZE + TILE_SIZE / 2;
        const y = PRACTICE_ZOMBIE_TILE_Y * TILE_SIZE + TILE_SIZE / 2;
        this.worldEntities.set(PRACTICE_ZOMBIE_KEY, {
            entityKey: PRACTICE_ZOMBIE_KEY,
            kind: 'zombie',
            x,
            y,
            levelId: PRACTICE_ZOMBIE_STAGE,
            controllerSessionId: null,
            possessionEndAtMs: null,
            teamId: TEAM_ZOMBIES,
            hitRadius: ZOMBIE_HIT_RADIUS,
            intent: this._zombieIdleIntent(),
            motion: { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
            stats: { hp: ZOMBIE_HP_MAX, hpMax: ZOMBIE_HP_MAX },
            poise: this._defaultPoiseForKind('zombie'),
            home: { x, y, levelId: PRACTICE_ZOMBIE_STAGE },
            ai: {
                state: 'shamble_pause',
                stateTimerMs: this._randZombiePauseMs(),
                targetEntityKey: null,
                shambleDirX: 1,
                shambleDirY: 0,
                attackDirX: 1,
                attackDirY: 0,
                distanceBudgetPx: 0,
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
        return resolveMeleeAttackProfile(weaponId, phaseIndex);
    }

    _applyPlayerMeleeAttack(sessionId, { weaponId, phaseIndex, levelId, dirX, dirY }) {
        const source = this._resolveAttackSource(sessionId, levelId);
        if (!source) return;
        this._applyMeleeAttackFromSource(source, {
            sessionId,
            weaponId,
            phaseIndex,
            levelId,
            dirX,
            dirY,
        });
    }

    _applyWorldEntityMeleeAttack(attackerEntityKey, { weaponId, phaseIndex, levelId, dirX, dirY }) {
        const source = this._getCombatantByEntityKey(attackerEntityKey);
        if (!source) return;
        this._applyMeleeAttackFromSource(source, {
            sessionId: null,
            weaponId,
            phaseIndex,
            levelId,
            dirX,
            dirY,
        });
    }

    _applyMeleeAttackFromSource(source, { sessionId = null, weaponId, phaseIndex, levelId, dirX, dirY }) {
        const originX = source.x;
        const originY = source.y;
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
        if ((profile.hyperArmorMs ?? 0) > 0) {
            this._setEntityHyperArmor(source.entityKey, profile.hyperArmorMs);
        }
        const radiusSq = profile.radius * profile.radius;
        const minDot = Math.cos(profile.arc / 2);

        const candidates = this._listDamageableCombatantsInLevel(sourceLevelId);
        for (const target of candidates) {
            if (target.entityKey === source.entityKey) continue;
            if (!this._canDamage(source.teamId, target.teamId)) continue;

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

            this._applyDamageToEntity(target.entityKey, profile.damage, source.entityKey, null, profile.poiseDamage ?? 0);
        }
    }

    _normalizeMeleeWeaponId(weaponId) {
        if (weaponId === 'sword') return 'sword';
        if (weaponId === 'zombie_strike') return 'zombie_strike';
        return 'unarmed';
    }

    _randZombieWalkMs() {
        return ZOMBIE_SHAMBLE_WALK_MIN_MS + (Math.random() * (ZOMBIE_SHAMBLE_WALK_MAX_MS - ZOMBIE_SHAMBLE_WALK_MIN_MS));
    }

    _randZombiePauseMs() {
        return ZOMBIE_SHAMBLE_PAUSE_MIN_MS + (Math.random() * (ZOMBIE_SHAMBLE_PAUSE_MAX_MS - ZOMBIE_SHAMBLE_PAUSE_MIN_MS));
    }

    _zombieIdleIntent() {
        return {
            up: false,
            down: false,
            left: false,
            right: false,
            sprint: false,
            moveSpeedMultiplier: 0,
            attackPushVx: 0,
            attackPushVy: 0,
        };
    }

    _zombieMoveIntent(dirX, dirY, speedPxPerSec) {
        const nx = Number.isFinite(dirX) ? dirX : 0;
        const ny = Number.isFinite(dirY) ? dirY : 0;
        const moveScale = Number.isFinite(speedPxPerSec) && speedPxPerSec > 0
            ? speedPxPerSec / PLAYER_SPEED
            : 0;
        return {
            up: ny < -0.0001,
            down: ny > 0.0001,
            left: nx < -0.0001,
            right: nx > 0.0001,
            sprint: false,
            moveSpeedMultiplier: moveScale,
            attackPushVx: 0,
            attackPushVy: 0,
        };
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
            weaponId: this._normalizeMeleeWeaponId(weaponId),
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

    _applyDamageToEntity(targetEntityKey, damage, attackerEntityKey = null, timestamp = null, poiseDamage = 0) {
        if (typeof targetEntityKey !== 'string') return;
        if (!Number.isFinite(damage) || damage <= 0) return;
        if (attackerEntityKey && targetEntityKey === attackerEntityKey) return;

        const attackerTeamId = this._getEntityTeamId(attackerEntityKey);
        const targetTeamId = this._getEntityTeamId(targetEntityKey);
        if (!this._canDamage(attackerTeamId, targetTeamId)) return;

        const nowMs = Date.now();
        this._applyPoiseDamageToEntity(targetEntityKey, poiseDamage, attackerEntityKey, nowMs);

        if (targetEntityKey.startsWith('player:')) {
            const victimSessionId = targetEntityKey.slice('player:'.length);
            this._applyDamageToPlayer(victimSessionId, damage, attackerEntityKey, timestamp, attackerTeamId);
            return;
        }
        if (targetEntityKey.startsWith('world:')) {
            this._applyDamageToWorldEntity(targetEntityKey, damage);
        }
    }

    _defaultPoiseForKind(kind) {
        const archetype = resolveArchetypeConfig(kind) ?? resolveArchetypeConfig('player');
        const poiseCfg = archetype?.poise ?? resolveArchetypeConfig('player')?.poise;
        return {
            current: poiseCfg?.max ?? 0,
            max: poiseCfg?.max ?? 0,
            flinchThreshold: poiseCfg?.flinchThreshold ?? 0,
            regenDelayMs: poiseCfg?.regenDelayMs ?? 0,
            regenPerSec: poiseCfg?.regenPerSec ?? 0,
            lastDamageAtMs: 0,
            flinchEndAtMs: 0,
            staggerEndAtMs: 0,
            hyperArmorUntilMs: 0,
        };
    }

    _getEntityPoiseState(entityKey) {
        if (typeof entityKey !== 'string') return null;
        if (entityKey.startsWith('player:')) {
            const sid = entityKey.slice('player:'.length);
            return this.players.get(sid)?.poise ?? null;
        }
        if (entityKey.startsWith('world:')) {
            return this.worldEntities.get(entityKey)?.poise ?? null;
        }
        return null;
    }

    _setEntityPoiseState(entityKey, poise) {
        if (!poise || typeof entityKey !== 'string') return;
        if (entityKey.startsWith('player:')) {
            const sid = entityKey.slice('player:'.length);
            const player = this.players.get(sid);
            if (!player) return;
            this.players.set(sid, { ...player, poise });
            return;
        }
        if (entityKey.startsWith('world:')) {
            const world = this.worldEntities.get(entityKey);
            if (!world) return;
            this.worldEntities.set(entityKey, { ...world, poise });
        }
    }

    _setEntityHyperArmor(entityKey, durationMs) {
        const poise = this._getEntityPoiseState(entityKey);
        if (!poise || !Number.isFinite(durationMs) || durationMs <= 0) return;
        const nowMs = Date.now();
        poise.hyperArmorUntilMs = Math.max(poise.hyperArmorUntilMs ?? 0, nowMs + durationMs);
        this._setEntityPoiseState(entityKey, poise);
    }

    _emitEntityReaction(type, entityKey, durationMs, levelId = null) {
        if (!entityKey) return;
        if (type === 'flinch') {
            this.#broadcastAll({
                type: MSG.ENTITY_FLINCHED,
                entityKey,
                durationMs: Number.isFinite(durationMs) ? durationMs : FLINCH_DURATION_MS,
                levelId: typeof levelId === 'string' ? levelId : null,
            });
            return;
        }
        this.#broadcastAll({
            type: MSG.ENTITY_STAGGERED,
            entityKey,
            durationMs: Number.isFinite(durationMs) ? durationMs : STAGGER_DURATION_MS,
            levelId: typeof levelId === 'string' ? levelId : null,
        });
    }

    _cancelEntityActions(entityKey) {
        if (typeof entityKey !== 'string') return;
        if (entityKey.startsWith('player:')) {
            const sid = entityKey.slice('player:'.length);
            const player = this.players.get(sid);
            if (!player) return;
            this.players.set(sid, {
                ...player,
                intent: {
                    up: false, down: false, left: false, right: false, sprint: false,
                    moveSpeedMultiplier: 0, attackPushVx: 0, attackPushVy: 0,
                },
                motion: { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
            });
            return;
        }
        if (entityKey.startsWith('world:')) {
            const world = this.worldEntities.get(entityKey);
            if (!world) return;
            const next = {
                ...world,
                intent: this._zombieIdleIntent(),
                motion: { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
            };
            if (next.kind === 'zombie' && next.ai) {
                next.ai = {
                    ...next.ai,
                    state: 'shamble_pause',
                    stateTimerMs: this._randZombiePauseMs(),
                    targetEntityKey: null,
                    distanceBudgetPx: 0,
                };
            }
            this.worldEntities.set(entityKey, next);
        }
    }

    _isEntityIncapacitated(entityKey, nowMs = Date.now()) {
        const poise = this._getEntityPoiseState(entityKey);
        if (!poise) return false;
        return (poise.staggerEndAtMs ?? 0) > nowMs || (poise.flinchEndAtMs ?? 0) > nowMs;
    }

    _applyPoiseDamageToEntity(targetEntityKey, poiseDamage, attackerEntityKey = null, nowMs = Date.now()) {
        if (!Number.isFinite(poiseDamage) || poiseDamage <= 0) return;
        const poise = this._getEntityPoiseState(targetEntityKey);
        if (!poise) return;

        poise.current = Math.max(0, (poise.current ?? poise.max ?? 0) - poiseDamage);
        poise.lastDamageAtMs = nowMs;
        const levelId = this._getCombatantByEntityKey(targetEntityKey)?.levelId ?? null;

        if (poise.current <= 0) {
            const alreadyStaggered = (poise.staggerEndAtMs ?? 0) > nowMs;
            poise.current = 0;
            poise.staggerEndAtMs = Math.max(poise.staggerEndAtMs ?? 0, nowMs + STAGGER_DURATION_MS);
            poise.flinchEndAtMs = Math.max(poise.flinchEndAtMs ?? 0, poise.staggerEndAtMs);
            this._setEntityPoiseState(targetEntityKey, poise);
            this._cancelEntityActions(targetEntityKey);
            if (!alreadyStaggered) {
                this._emitEntityReaction('stagger', targetEntityKey, STAGGER_DURATION_MS, levelId);
            }
            return;
        }

        const hyperArmorActive = (poise.hyperArmorUntilMs ?? 0) > nowMs;
        if (!hyperArmorActive && poiseDamage >= (poise.flinchThreshold ?? 0)) {
            poise.flinchEndAtMs = Math.max(poise.flinchEndAtMs ?? 0, nowMs + FLINCH_DURATION_MS);
            this._setEntityPoiseState(targetEntityKey, poise);
            this._cancelEntityActions(targetEntityKey);
            this._emitEntityReaction('flinch', targetEntityKey, FLINCH_DURATION_MS, levelId);
            return;
        }

        this._setEntityPoiseState(targetEntityKey, poise);
    }

    _phaseUpdatePoiseAndReactions() {
        const nowMs = Date.now();
        for (const [sid, player] of this.players.entries()) {
            const poise = player?.poise ?? this._defaultPoiseForKind('player');
            if ((poise.staggerEndAtMs ?? 0) <= nowMs && poise.current <= 0) {
                poise.current = poise.max;
                poise.staggerEndAtMs = 0;
            }
            if ((poise.lastDamageAtMs ?? 0) + (poise.regenDelayMs ?? 0) <= nowMs &&
                (poise.staggerEndAtMs ?? 0) <= nowMs &&
                poise.current < poise.max) {
                poise.current = Math.min(poise.max, poise.current + (poise.regenPerSec * (TICK_MS / 1000)));
            }
            this.players.set(sid, { ...player, poise });
        }

        for (const [entityKey, world] of this.worldEntities.entries()) {
            const kind = world?.kind ?? null;
            const poise = world?.poise ?? this._defaultPoiseForKind(kind);
            if ((poise.staggerEndAtMs ?? 0) <= nowMs && poise.current <= 0) {
                poise.current = poise.max;
                poise.staggerEndAtMs = 0;
            }
            if ((poise.lastDamageAtMs ?? 0) + (poise.regenDelayMs ?? 0) <= nowMs &&
                (poise.staggerEndAtMs ?? 0) <= nowMs &&
                poise.current < poise.max) {
                poise.current = Math.min(poise.max, poise.current + (poise.regenPerSec * (TICK_MS / 1000)));
            }
            this.worldEntities.set(entityKey, { ...world, poise });
        }
    }

    _defaultTeamForKind(kind) {
        const archetype = resolveArchetypeConfig(kind);
        return archetype?.teamId ?? TEAM_NEUTRAL;
    }

    _defaultHitRadiusForKind(kind) {
        const archetype = resolveArchetypeConfig(kind);
        return Number.isFinite(archetype?.hitRadius) ? archetype.hitRadius : PLAYER_RADIUS;
    }

    _defaultStatsForKind(kind) {
        const archetype = resolveArchetypeConfig(kind);
        if (Number.isFinite(archetype?.hpMax) && archetype.hpMax > 0) {
            return { hp: archetype.hpMax, hpMax: archetype.hpMax };
        }
        return { hp: 0, hpMax: 0 };
    }

    _inferWorldKindFromEntityKey(entityKey) {
        if (entityKey === PRACTICE_GOLEM_KEY) return 'golem';
        if (entityKey === PRACTICE_ZOMBIE_KEY) return 'zombie';
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

    _isValidSpellTarget(sourceCombatant, targetEntityKey) {
        if (!sourceCombatant || typeof targetEntityKey !== 'string') return false;
        const target = this._getCombatantByEntityKey(targetEntityKey);
        if (!target) return false;
        if (!this._isCombatantDamageable(target)) return false;
        if ((sourceCombatant.levelId ?? null) !== (target.levelId ?? null)) return false;
        if (!this._canDamage(sourceCombatant.teamId, target.teamId)) return false;
        return true;
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
