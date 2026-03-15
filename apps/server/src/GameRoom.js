import {
    MSG,
    STATIC_EXIT_CONNECTIONS,
    getStageData,
    resolveExitTransition,
    resolveExitSpawnPosition,
    resolveStageSpawnPosition,
    TILE_SIZE,
    STAGE_WIDTH,
    STAGE_HEIGHT,
    PLAYER_RADIUS,
    PLAYER_SPEED,
    stepPlayerKinematics,
    dashStateFromInput,
    resolvePlayerCollisions,
    BULLET_DAMAGE,
    BULLET_MAX_RANGE,
    ARROW_MIN_DAMAGE,
    ARROW_MAX_DAMAGE,
    ARROW_MAX_RANGE,
    ARROW_BASE_PENETRATION,
    ARCHETYPE_CONFIG,
    TEAM_IDS,
    REACTION_CONFIG,
    MOVEMENT_RESOURCE_CONFIG,
    PROJECTILE_RESOURCE_COST,
    RESOURCE_KINDS,
    resolveArchetypeConfig,
    resolveMeleeAttackProfile,
    PROJECTILE_POISE_DAMAGE,
    resolveSpellConfig,
    isDraggableWorldKind,
    getWorldSpawnDefinitions,
    getWorldSpawnDefinition,
    getInteractableDefinition,
    createEntityResources,
    tickResourceRegen,
    canPayResourceCosts,
    payResourceCosts,
    fillResource,
    damageHealth,
    summarizeResources,
} from '@clay-and-blood/shared';
import {
    phaseInputIntent,
    phaseLocomotionDash,
    phasePhysicsTransform,
    phaseBuildHistoryPositions,
} from '@clay-and-blood/shared/server-tick';

const TICK_MS = 50; // 20 Hz server tick
const LAG_COMP_HISTORY_SIZE = 20; // 1 second of history at 20 Hz
const POSSESSION_DURATION_MS = 8000;
const DEBUG_WORLD_SYNC = false;
const DEBUG_GOLEM_KEY = 'world:golem_town_square';
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
const CORPSE_DECAY_DURATION_MS = ARCHETYPE_CONFIG.corpse.decayDurationMs;
const FLINCH_DURATION_MS = REACTION_CONFIG.flinchDurationMs;
const STAGGER_DURATION_MS = REACTION_CONFIG.staggerDurationMs;
const TEAM_PLAYERS = TEAM_IDS.players;
const TEAM_GOLEMS = TEAM_IDS.golems;
const TEAM_ZOMBIES = TEAM_IDS.zombies;
const TEAM_NEUTRAL = TEAM_IDS.neutral;
const IMPOSING_FLAME_SPELL_ID = 'imposing_flame';
const GELID_CRADLE_SPELL_ID = 'gelid_cradle';
const ARC_FLASH_SPELL_ID = 'arc_flash';
const TRACTION_SPELL_ID = 'traction';
const ACTIVE_EFFECT_TRACTION = 'traction';
const ARC_FLASH_RAY_HIT_EPSILON = 0.5; // px tolerance to avoid endpoint precision misses
const EQUIP_ID_PATTERN = /^[a-z0-9_-]{1,32}$/i;
const ENTITY_KEY_PATTERN = /^(player:[a-z0-9-]{1,64}|world:[a-z0-9_-]{1,64})$/i;
const SOLID_PROJECTILE_TILES = new Set([1, 3]); // wall + void
const PROJECTILE_MIN_SPEED = 0.001;
const SPRINT_STAMINA_DRAIN_PER_SEC = MOVEMENT_RESOURCE_CONFIG.sprint.staminaDrainPerSec;
const DASH_STAMINA_COST = MOVEMENT_RESOURCE_CONFIG.dash.staminaCost;
const ACTIVE_EFFECT_HEALING_GEM = 'healing_gem_regen';
const ACTIVE_EFFECT_MAGIC_DEW = 'magic_dew_regen';
const INVENTORY_CATEGORY_WEAPON = 'weapon';
const INVENTORY_CATEGORY_ARMOR = 'armor';
const INVENTORY_CATEGORY_ACCESSORY = 'accessory';
const INVENTORY_CATEGORY_CONSUMABLE = 'consumable';
const INVENTORY_CATEGORY_RESOURCE = 'resource';
const STARTER_SPELLS = Object.freeze([
    { spellId: 'possess', upgradeLevel: 0 },
    { spellId: 'imposing_flame', upgradeLevel: 0 },
    { spellId: 'gelid_cradle', upgradeLevel: 0 },
    { spellId: 'arc_flash', upgradeLevel: 0 },
    { spellId: 'traction', upgradeLevel: 0 },
]);
const ITEM_DEFINITIONS = Object.freeze({
    bow: Object.freeze({ id: 'bow', name: 'Bow', category: INVENTORY_CATEGORY_WEAPON, baseSellable: true, baseDroppable: true, sellPrice: 75, buyPrice: 150 }),
    longsword: Object.freeze({ id: 'longsword', name: 'Longsword', category: INVENTORY_CATEGORY_WEAPON, baseSellable: true, baseDroppable: true, sellPrice: 75, buyPrice: 150 }),
    leather_armor: Object.freeze({ id: 'leather_armor', name: 'Leather Armor', category: INVENTORY_CATEGORY_ARMOR, baseSellable: true, baseDroppable: true, sellPrice: 60, buyPrice: 120 }),
    cape: Object.freeze({ id: 'cape', name: 'Cape', category: INVENTORY_CATEGORY_ACCESSORY, baseSellable: true, baseDroppable: true, sellPrice: 40, buyPrice: 90 }),
    gold_pouch: Object.freeze({ id: 'gold_pouch', name: 'Gold Pouch', category: INVENTORY_CATEGORY_CONSUMABLE, baseSellable: true, baseDroppable: true, sellPrice: 25, buyPrice: 50, effectType: 'grant_gold', goldAmount: 100 }),
    healing_gem: Object.freeze({ id: 'healing_gem', name: 'Healing Gem', category: INVENTORY_CATEGORY_CONSUMABLE, baseSellable: true, baseDroppable: true, sellPrice: 20, buyPrice: 40, effectType: ACTIVE_EFFECT_HEALING_GEM, durationMs: 5000, tickIntervalMs: 1000, magnitude: 8 }),
    magic_dew: Object.freeze({ id: 'magic_dew', name: 'Magic Dew', category: INVENTORY_CATEGORY_CONSUMABLE, baseSellable: true, baseDroppable: true, sellPrice: 20, buyPrice: 40, effectType: ACTIVE_EFFECT_MAGIC_DEW, durationMs: 5000, tickIntervalMs: 1000, magnitude: 6 }),
    weapon_upgrade_material: Object.freeze({ id: 'weapon_upgrade_material', name: 'Weapon Upgrade Material', category: INVENTORY_CATEGORY_RESOURCE, baseSellable: true, baseDroppable: true, sellPrice: 10, buyPrice: 20 }),
    spell_upgrade_material: Object.freeze({ id: 'spell_upgrade_material', name: 'Spell Upgrade Material', category: INVENTORY_CATEGORY_RESOURCE, baseSellable: true, baseDroppable: true, sellPrice: 10, buyPrice: 20 }),
});
const MAX_UPGRADE_LEVEL = 3;
const UPGRADE_COST_BY_LEVEL = Object.freeze({
    0: Object.freeze({ gold: 100, materials: 1 }),
    1: Object.freeze({ gold: 200, materials: 2 }),
    2: Object.freeze({ gold: 300, materials: 3 }),
});
const SEEDED_WORLD_DROPS = Object.freeze([
    // Spread the test loot across the walkable base of the inn so each pickup is easy to see.
    Object.freeze({ entityKey: 'world:loot_inn_cape', definitionId: 'cape', quantity: 1, upgradeLevel: 0, levelId: 'inn', x: 2 * TILE_SIZE + TILE_SIZE / 2, y: 8 * TILE_SIZE + TILE_SIZE / 2 }),
    Object.freeze({ entityKey: 'world:loot_inn_longsword', definitionId: 'longsword', quantity: 1, upgradeLevel: 0, levelId: 'inn', x: 4 * TILE_SIZE + TILE_SIZE / 2, y: 8 * TILE_SIZE + TILE_SIZE / 2 }),
    Object.freeze({ entityKey: 'world:loot_inn_bow', definitionId: 'bow', quantity: 1, upgradeLevel: 0, levelId: 'inn', x: 6 * TILE_SIZE + TILE_SIZE / 2, y: 8 * TILE_SIZE + TILE_SIZE / 2 }),
    Object.freeze({ entityKey: 'world:loot_inn_leather_armor', definitionId: 'leather_armor', quantity: 1, upgradeLevel: 0, levelId: 'inn', x: 8 * TILE_SIZE + TILE_SIZE / 2, y: 8 * TILE_SIZE + TILE_SIZE / 2 }),
    Object.freeze({ entityKey: 'world:loot_inn_gold_pouch', definitionId: 'gold_pouch', quantity: 2, upgradeLevel: 0, levelId: 'inn', x: 10 * TILE_SIZE + TILE_SIZE / 2, y: 8 * TILE_SIZE + TILE_SIZE / 2 }),
    Object.freeze({ entityKey: 'world:loot_inn_healing_gem', definitionId: 'healing_gem', quantity: 3, upgradeLevel: 0, levelId: 'inn', x: 12 * TILE_SIZE + TILE_SIZE / 2, y: 8 * TILE_SIZE + TILE_SIZE / 2 }),
    Object.freeze({ entityKey: 'world:loot_inn_magic_dew', definitionId: 'magic_dew', quantity: 3, upgradeLevel: 0, levelId: 'inn', x: 3 * TILE_SIZE + TILE_SIZE / 2, y: 9 * TILE_SIZE + TILE_SIZE / 2 }),
    Object.freeze({ entityKey: 'world:loot_inn_weapon_material', definitionId: 'weapon_upgrade_material', quantity: 10, upgradeLevel: 0, levelId: 'inn', x: 6 * TILE_SIZE + TILE_SIZE / 2, y: 9 * TILE_SIZE + TILE_SIZE / 2 }),
    Object.freeze({ entityKey: 'world:loot_inn_spell_material', definitionId: 'spell_upgrade_material', quantity: 10, upgradeLevel: 0, levelId: 'inn', x: 9 * TILE_SIZE + TILE_SIZE / 2, y: 9 * TILE_SIZE + TILE_SIZE / 2 }),
]);

function getItemDefinition(definitionId) {
    return typeof definitionId === 'string' ? ITEM_DEFINITIONS[definitionId] ?? null : null;
}

function getUpgradeCostForLevel(currentLevel) {
    const normalized = Number.isFinite(currentLevel) ? Math.max(0, Math.floor(currentLevel)) : 0;
    return UPGRADE_COST_BY_LEVEL[normalized] ?? null;
}

function buildInventoryEntry(entryId, definitionId, quantity = 1, upgradeLevel = 0) {
    const definition = getItemDefinition(definitionId);
    if (!definition) return null;
    return {
        entryId,
        definitionId,
        category: definition.category,
        quantity: Math.max(1, Math.floor(quantity)),
        upgradeLevel: Math.max(0, Math.floor(upgradeLevel)),
    };
}

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

function sanitizeLoadoutSnapshot(loadout) {
    if (!loadout || typeof loadout !== 'object') return null;
    const sanitizeSlotArray = (value) => (
        Array.isArray(value)
            ? value.slice(0, 3).map((entry) => sanitizeEquipId(entry)).filter(Boolean)
            : []
    );
    return {
        weaponSlots: sanitizeSlotArray(loadout.weaponSlots),
        spellSlots: sanitizeSlotArray(loadout.spellSlots),
        consumableSlots: sanitizeSlotArray(loadout.consumableSlots),
        activeWeaponSlotIndex: Number.isFinite(loadout.activeWeaponSlotIndex) ? Math.max(0, Math.floor(loadout.activeWeaponSlotIndex)) : 0,
        activeSpellSlotIndex: Number.isFinite(loadout.activeSpellSlotIndex) ? Math.max(0, Math.floor(loadout.activeSpellSlotIndex)) : 0,
        activeConsumableSlotIndex: Number.isFinite(loadout.activeConsumableSlotIndex) ? Math.max(0, Math.floor(loadout.activeConsumableSlotIndex)) : 0,
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
        //   resources: { hp, stamina, mana },
        //   net:       { lastSeq }
        // }
        this.players = new Map();
        this.entityEquips = new Map(); // entityKey -> { entityKey, levelId, equipped, ownerSessionId }
        this.worldEntities = new Map(); // entityKey -> { entityKey, x, y, levelId, controllerSessionId }
        this.spawnStates = new Map(); // spawnKey -> { spawnKey, alive, entityKey }
        this.suppressedTags = new Set();
        this.activeEffects = new Map(); // effectId -> authoritative ongoing effect state
        this.activeEffectIdsByEntityKey = new Map(); // entityKey -> Set<effectId>
        this.projectiles = new Map(); // projectileId -> { id, shooterSessionId, projectileType, x, y, velocityX, velocityY, levelId, damage, remainingRange }
        this.pendingSpellEffects = new Map(); // effectId -> { id, spellId, sourceEntityKey, sourceTeamId, levelId, x, y, executeAtMs, damage, poiseDamage, radius }
        // levelId -> grid (2-D number array, cached)
        this.grids   = new Map();
        this.tickCount = 0;
        // Lag-compensation history: array of { tick, positions: Map<sessionId,{x,y,levelId}> }

    // Capped at LAG_COMP_HISTORY_SIZE entries (sliding window ~1 second).
        this.positionHistory = [];
        this._seedWorldDrops();
        this._initializeWorldSpawns();
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
                const spawn = resolveStageSpawnPosition('inn');
                const spawnX = spawn?.x ?? (Math.floor(STAGE_WIDTH / 2) * TILE_SIZE + TILE_SIZE / 2);
                const spawnY = spawn?.y ?? (Math.floor(STAGE_HEIGHT / 2) * TILE_SIZE + TILE_SIZE / 2);

                this.players.set(sessionId, {
                    transform: { x: spawnX, y: spawnY, levelId: 'inn' },
                    intent:    {
                        up: false, down: false, left: false, right: false, sprint: false,
                        moveSpeedMultiplier: 1, attackPushVx: 0, attackPushVy: 0,
                    },
                    motion:    { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
                    resources: createEntityResources('player'),
                    net:       { lastSeq: 0 },
                    equipped:  null, // populated on first PLAYER_EQUIP message
                    loadoutSnapshot: null,
                    controlledEntityKey: `player:${sessionId}`,
                    returnEntityKey: `player:${sessionId}`,
                    teamId: TEAM_PLAYERS,
                    sightRadius: ARCHETYPE_CONFIG.player.sightRadius,
                    poise: this._defaultPoiseForKind('player'),
                    spellState: { pendingCast: null, cooldownUntilBySpellId: {} },
                    inventory: { gold: 0, entries: [], nextEntryId: 1 },
                    spellbook: { knownSpells: STARTER_SPELLS.map((entry) => ({ ...entry })) },
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
                            stageId: p.transform.levelId,
                            teamId: typeof p.teamId === 'string' ? p.teamId : null,
                            sightRadius: Number.isFinite(p.sightRadius) ? p.sightRadius : null,
                        });
                    }
                }
                ws.send(JSON.stringify({ type: MSG.GAME_STATE, players: playerList }));
                ws.send(JSON.stringify({
                    type: MSG.WORLD_STATE,
                    scope: 'all',
                    entities: Array.from(this.worldEntities.values())
                        .map((entry) => this._serializeWorldEntity(entry, Date.now()))
                        .filter(Boolean),
                }));

                // Notify the others that someone new arrived
                this.#broadcast({ type: MSG.PLAYER_JOIN, sessionId }, ws);

                // Start the tick loop when the first player joins
                if (this.players.size === 1) {
                    await this.state.storage.setAlarm(Date.now() + TICK_MS);
                }
                break;
            }

            case MSG.USE_CONSUMABLE: {
                this._useConsumableForPlayer(sessionId, sanitizeEquipId(data.definitionId));
                break;
            }

            case MSG.DROP_ENTRY: {
                const entryId = typeof data.entryId === 'string' ? data.entryId : null;
                const mode = data.mode === 'all' ? 'all' : 'one';
                if (!entryId) break;
                this._dropInventoryEntry(sessionId, entryId, mode);
                break;
            }

            case MSG.SELL_ENTRY: {
                const merchantId = typeof data.merchantId === 'string' ? data.merchantId : null;
                const entryId = typeof data.entryId === 'string' ? data.entryId : null;
                const mode = data.mode === 'all' ? 'all' : 'one';
                if (!merchantId || !entryId) break;
                this._sellInventoryEntry(sessionId, merchantId, entryId, mode);
                break;
            }

            case MSG.BUY_MERCHANT_ITEM: {
                const merchantId = typeof data.merchantId === 'string' ? data.merchantId : null;
                const definitionId = sanitizeEquipId(data.definitionId);
                if (!merchantId || !definitionId) break;
                this._buyMerchantItem(sessionId, merchantId, definitionId);
                break;
            }

            case MSG.UPGRADE_WEAPON_ITEM: {
                const upgraderId = typeof data.upgraderId === 'string' ? data.upgraderId : null;
                const entryId = typeof data.entryId === 'string' ? data.entryId : null;
                if (!upgraderId || !entryId) break;
                this._upgradeWeaponItem(sessionId, upgraderId, entryId);
                break;
            }

            case MSG.UPGRADE_SPELL_ITEM: {
                const upgraderId = typeof data.upgraderId === 'string' ? data.upgraderId : null;
                const spellId = sanitizeEquipId(data.spellId);
                if (!upgraderId || !spellId) break;
                this._upgradeSpellItem(sessionId, upgraderId, spellId);
                break;
            }

            case MSG.INTERACT_REQUEST: {
                const player = this.players.get(sessionId);
                if (!player) break;
                const interactableId = typeof data.interactableId === 'string' ? data.interactableId : null;
                if (!interactableId) break;
                this._handleInteractRequest(sessionId, player, interactableId);
                break;
            }

            case MSG.PLAYER_INPUT: {
                const player = this.players.get(sessionId);
                if (!player) break;
                const playerEntityKey = player.controlledEntityKey ?? `player:${sessionId}`;
                const incapacitated = this._isEntityIncapacitated(playerEntityKey, Date.now());

                // Preserve existing dash state unless a new dash is requested
                let { dashVx, dashVy, dashTimeLeftMs } = player.motion;

                if (data.dash && dashTimeLeftMs <= 0) {
                    const dash = dashStateFromInput(data);
                    if (dash && this._payEntityCosts(playerEntityKey, { stamina: DASH_STAMINA_COST, mana: 0 }, Date.now())) {
                        dashVx = dash.dashVx;
                        dashVy = dash.dashVy;
                        dashTimeLeftMs = dash.dashTimeLeftMs;
                    }
                }

                const latestPlayer = this.players.get(sessionId) ?? player;
                this._updatePlayer(sessionId, (currentPlayer) => ({
                    ...currentPlayer,
                    intent: {
                        up:     !incapacitated && !!data.up,
                        down:   !incapacitated && !!data.down,
                        left:   !incapacitated && !!data.left,
                        right:  !incapacitated && !!data.right,
                        sprint: !incapacitated && !!data.sprint,
                        moveSpeedMultiplier: (Number.isFinite(data.moveSpeedMultiplier)
                            ? Math.max(0, Math.min(1, data.moveSpeedMultiplier))
                            : 1) * this._resolveSpellWindupMoveMultiplier(latestPlayer, Date.now())
                            * this._resolveActiveEffectMoveMultiplier(playerEntityKey),
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
                    net: { ...currentPlayer.net, lastSeq: data.seq ?? currentPlayer.net.lastSeq },
                }));
                break;
            }

            case MSG.MELEE_ATTACK: {
                const player = this.players.get(sessionId);
                if (!player) break;
                if (this._isEntityIncapacitated(player.controlledEntityKey ?? `player:${sessionId}`, Date.now())) break;
                const dirX = Number.isFinite(data.dirX) ? data.dirX : 1;
                const dirY = Number.isFinite(data.dirY) ? data.dirY : 0;
                const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
                if (dirLen < 0.001) break;

                const requestedWeaponId = (data.weaponId === 'longsword' || data.weaponId === 'sword') ? 'longsword' : 'unarmed';
                const equippedWeaponId = (player.equipped?.weaponId === 'longsword' || player.equipped?.weaponId === 'sword') ? 'longsword' : 'unarmed';
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
                const loadoutSnapshot = sanitizeLoadoutSnapshot(data.loadoutSnapshot);
                const levelId = typeof data.levelId === 'string' ? data.levelId : null;
                if (!player || !entityKey || !sanitized) break;
                const equipState = { entityKey, levelId, equipped: sanitized, ownerSessionId: sessionId, loadoutSnapshot };
                this.entityEquips.set(entityKey, equipState);
                this._updatePlayer(sessionId, (currentPlayer) => ({
                    ...currentPlayer,
                    equipped: sanitized,
                    loadoutSnapshot: loadoutSnapshot ?? currentPlayer.loadoutSnapshot ?? null,
                }));
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
                        resources: this._defaultResourcesForKind(kind),
                        poise: this._defaultPoiseForKind(kind),
                    };
                    if (DEBUG_WORLD_SYNC && targetEntityKey === DEBUG_GOLEM_KEY) {
                        console.log('[WorldSync][Server] possess_request created missing golem from request', {
                            x,
                            y,
                            levelId,
                        });
                    }
                } else if (DEBUG_WORLD_SYNC && targetEntityKey === DEBUG_GOLEM_KEY) {
                    console.log('[WorldSync][Server] possess_request existing golem keeps authoritative pose', {
                        requested: { x, y, levelId },
                        authoritative: { x: target.x, y: target.y, levelId: target.levelId },
                    });
                }
                if (DEBUG_WORLD_SYNC && targetEntityKey === DEBUG_GOLEM_KEY) {
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
                if (!target.resources) {
                    target.resources = this._defaultResourcesForKind(target.kind);
                }

                const previousControllerSessionId = target.controllerSessionId;
                const canSteal = this._canStealPossession({
                    requesterSessionId: sessionId,
                    previousControllerSessionId,
                    targetEntityKey,
                    levelId,
                });
                if (!canSteal) break;
                const possessCfg = resolveSpellConfig('possess');
                const requesterCurrentKey = player.controlledEntityKey ?? `player:${sessionId}`;
                if (possessCfg && !this._payEntityCosts(requesterCurrentKey, {
                    stamina: possessCfg.staminaCost ?? 0,
                    mana: possessCfg.manaCost ?? 0,
                }, Date.now())) {
                    break;
                }

                const requesterPreviousKey = requesterCurrentKey;
                this._updatePlayer(sessionId, (latestPlayer) => ({
                    ...latestPlayer,
                    controlledEntityKey: targetEntityKey,
                    returnEntityKey: requesterPreviousKey,
                }));

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
                target.teamId = this._getPlayerTeamId(sessionId);
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
                const releaseCfg = resolveSpellConfig('release_possession');
                if (releaseCfg && !this._payEntityCosts(targetEntityKey, {
                    stamina: releaseCfg.staminaCost ?? 0,
                    mana: releaseCfg.manaCost ?? 0,
                }, Date.now())) {
                    break;
                }
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
                    resources: prev?.resources ?? this._defaultResourcesForKind(kind),
                    poise: prev?.poise ?? this._defaultPoiseForKind(kind),
                };
                this.worldEntities.set(entityKey, next);
                if (DEBUG_WORLD_SYNC && entityKey === DEBUG_GOLEM_KEY) {
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
                const player = this.players.get(sessionId);
                if (this._isEntityIncapacitated(player?.controlledEntityKey ?? `player:${sessionId}`, Date.now())) break;
                const { x, y, velocityX, velocityY, levelId,
                        projectileType, chargeRatio, penetration } = data;
                const source = this._resolveAttackSource(sessionId, levelId);
                const sourceTeamId = source?.teamId ?? TEAM_PLAYERS;
                const sourceEntityKey = source?.entityKey ?? `player:${sessionId}`;
                const projectileLevelId = typeof levelId === 'string'
                    ? levelId
                    : (source?.levelId ?? null);

                const normalizedType = projectileType === 'arrow' ? 'arrow' : 'bullet';
                const projectileCost = PROJECTILE_RESOURCE_COST[normalizedType] ?? PROJECTILE_RESOURCE_COST.bullet;
                if (!this._payEntityCosts(sourceEntityKey, {
                    stamina: projectileCost.staminaCost ?? 0,
                    mana: projectileCost.manaCost ?? 0,
                }, Date.now())) {
                    break;
                }
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
                        sourceTeamId,
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
                        sourceTeamId,
                        chargeRatio: ratio,
                        penetration: 0,
                    }, ws);
                }
                break;
            }
            case MSG.SPELL_CAST: {
                const player = this.players.get(sessionId);
                if (this._isEntityIncapacitated(player?.controlledEntityKey ?? `player:${sessionId}`, Date.now())) break;
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
                    this._updatePlayer(sessionId, (latestPlayer) => ({
                        ...latestPlayer,
                        transform: { ...latestPlayer.transform, levelId, x, y },
                        intent: { up: false, down: false, left: false, right: false, sprint: false },
                        motion: { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
                    }));
                    const traction = this._findTractionEffectBySource(movingEntityKey);
                    if (traction) {
                        const target = this.worldEntities.get(traction.targetEntityKey);
                        const sourceCombatant = this._getCombatantByEntityKey(movingEntityKey);
                        const nextTargetPos = target && sourceCombatant
                            ? this._resolveTractionTargetPosition(traction, sourceCombatant, target, {
                                levelId,
                                preferredDirection: entryDirection,
                            })
                            : null;
                        if (target && nextTargetPos) {
                            this.worldEntities.set(traction.targetEntityKey, {
                                ...target,
                                levelId,
                                x: nextTargetPos.x,
                                y: nextTargetPos.y,
                            });
                        }
                        traction.levelId = levelId;
                        this.activeEffects.set(traction.id, traction);
                    }
                    this.#broadcast({ type: MSG.LEVEL_CHANGE, sessionId, levelId }, ws);
                } else if (movingWorldEntity) {
                    this.worldEntities.set(movingEntityKey, {
                        ...movingWorldEntity,
                        levelId,
                        x,
                        y,
                    });
                    const traction = this._findTractionEffectBySource(movingEntityKey);
                    if (traction) {
                        const sourceCombatant = this._getCombatantByEntityKey(movingEntityKey);
                        const target = this.worldEntities.get(traction.targetEntityKey);
                        const nextTargetPos = target && sourceCombatant
                            ? this._resolveTractionTargetPosition(traction, sourceCombatant, target, {
                                levelId,
                                preferredDirection: entryDirection,
                            })
                            : null;
                        if (target && nextTargetPos) {
                            this.worldEntities.set(traction.targetEntityKey, {
                                ...target,
                                levelId,
                                x: nextTargetPos.x,
                                y: nextTargetPos.y,
                            });
                        }
                        traction.levelId = levelId;
                        this.activeEffects.set(traction.id, traction);
                    }

                this.#broadcast({
                    type: MSG.ENTITY_STATE,
                    sessionId,
                    entityKey: movingEntityKey,
                    kind: movingWorldEntity.kind ?? null,
                    x,
                    y,
                    levelId,
                    controllerSessionId: sessionId,
                    teamId: movingWorldEntity.teamId ?? this._defaultTeamForKind(movingWorldEntity.kind),
                    possessionMsRemaining: Number.isFinite(movingWorldEntity.possessionEndAtMs)
                        ? Math.max(0, movingWorldEntity.possessionEndAtMs - Date.now())
                        : null,
                }, ws);
                }

                // Send the destination level's current authoritative world entities
                // immediately so entrants do not render stale/default local positions.
                const destinationEntities = Array.from(this.worldEntities.values())
                    .filter((entry) => (entry.levelId ?? null) === levelId)
                    .map((entry) => this._serializeWorldEntity(entry, Date.now()))
                    .filter(Boolean);
                if (DEBUG_WORLD_SYNC) {
                    const golem = this.worldEntities.get(DEBUG_GOLEM_KEY) ?? null;
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
        const player = this.players.get(sessionId);
        if (player?.controlledEntityKey) {
            this._cancelActiveEffectsForEntity(player.controlledEntityKey, 'disconnect');
        }
        this._cancelActiveEffectsForEntity(`player:${sessionId}`, 'disconnect');
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
        const player = this.players.get(sessionId);
        if (player?.controlledEntityKey) {
            this._cancelActiveEffectsForEntity(player.controlledEntityKey, 'disconnect');
        }
        this._cancelActiveEffectsForEntity(`player:${sessionId}`, 'disconnect');
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
        this._phaseUpdateResources();
        this._phaseUpdatePoiseAndReactions();
        this._phaseDecayCorpses();
        const inputPhase = this._phaseInputIntent();
        const locomotionPhase = this._phaseLocomotionDash(inputPhase);
        this._phasePhysicsTransform(locomotionPhase);
        this._phaseZombieAi();
        this._phaseZombieMovement();
        this._phaseActiveEffects();
        this._phaseSpellCasts();
        this._phaseSpellEffects();
        this._phaseProjectiles();

        const snapshotPlayers = this._phaseBuildSnapshotPlayers();
        this._phaseRecordLagCompHistory();
        this._phaseBroadcastSnapshot(snapshotPlayers);
    }

    _phaseUpdateResources() {
        const nowMs = Date.now();
        for (const [sessionId, player] of this.players.entries()) {
            const resources = tickResourceRegen(player.resources, TICK_MS, nowMs);
            this._updatePlayer(sessionId, (currentPlayer) => ({ ...currentPlayer, resources }));
        }

        for (const [entityKey, world] of this.worldEntities.entries()) {
            const kind = world?.kind ?? null;
            if (kind === 'loot') continue;
            const resources = tickResourceRegen(world?.resources ?? this._defaultResourcesForKind(kind), TICK_MS, nowMs);
            this._updateWorldEntity(entityKey, (currentWorld) => ({ ...currentWorld, resources }));
        }

        for (const [sessionId, player] of this.players.entries()) {
            const controlledEntityKey = player.controlledEntityKey ?? `player:${sessionId}`;
            const isMoving = !!(player?.intent?.up || player?.intent?.down || player?.intent?.left || player?.intent?.right);
            const wantsSprint = !!player?.intent?.sprint;
            if (wantsSprint && isMoving) {
                const controlledResources = this._getEntityResources(controlledEntityKey);
                const drained = this._drainEntityResourcePool(
                    controlledResources,
                    RESOURCE_KINDS.stamina,
                    SPRINT_STAMINA_DRAIN_PER_SEC * (TICK_MS / 1000),
                    nowMs
                );
                if (drained && drained !== controlledResources) {
                    this._setEntityResources(controlledEntityKey, drained);
                }
            }

            const staminaCurrent = this._getEntityResources(controlledEntityKey)?.stamina?.current ?? 0;
            if (wantsSprint && staminaCurrent <= 0) {
                this._updatePlayer(sessionId, (currentPlayer) => ({
                    ...currentPlayer,
                    intent: { ...currentPlayer.intent, sprint: false },
            }));
            }
        }
    }

    _phaseExpirePossessions() {
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

    _phaseDecayCorpses() {
        const nowMs = Date.now();
        for (const [entityKey, entity] of this.worldEntities.entries()) {
            if (entity?.kind !== 'corpse') continue;
            const expiresAtMs = entity.decay?.expiresAtMs ?? null;
            if (!Number.isFinite(expiresAtMs) || expiresAtMs > nowMs) continue;
            this._cancelActiveEffectsForEntity(entityKey, 'corpse-decayed');
            this.worldEntities.delete(entityKey);
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
        const snapshotPlayers = [];
        for (const [sessionId, player] of this.players.entries()) {
            snapshotPlayers.push({
                sessionId,
                x: player.transform.x,
                y: player.transform.y,
                levelId: player.transform.levelId,
                seq: player.net.lastSeq,
                teamId: typeof player.teamId === 'string' ? player.teamId : null,
                sightRadius: this._resolveSightRadiusForPlayer(sessionId),
            });
        }
        return snapshotPlayers;
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
                    levelId: entity.levelId ?? 'west-gate',
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
            const grid = this._getGrid(entity.levelId ?? 'west-gate');
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

    _trackEffectEntity(effectId, entityKey) {
        if (!effectId || typeof entityKey !== 'string') return;
        const current = this.activeEffectIdsByEntityKey.get(entityKey) ?? new Set();
        current.add(effectId);
        this.activeEffectIdsByEntityKey.set(entityKey, current);
    }

    _untrackEffectEntity(effectId, entityKey) {
        if (!effectId || typeof entityKey !== 'string') return;
        const current = this.activeEffectIdsByEntityKey.get(entityKey);
        if (!current) return;
        current.delete(effectId);
        if (current.size === 0) {
            this.activeEffectIdsByEntityKey.delete(entityKey);
            return;
        }
        this.activeEffectIdsByEntityKey.set(entityKey, current);
    }

    _registerActiveEffect(effect) {
        if (!effect?.id || !effect.type) return null;
        this.activeEffects.set(effect.id, effect);
        if (typeof effect.sourceEntityKey === 'string') this._trackEffectEntity(effect.id, effect.sourceEntityKey);
        if (typeof effect.targetEntityKey === 'string') this._trackEffectEntity(effect.id, effect.targetEntityKey);
        return effect;
    }

    _removeActiveEffect(effectId, reason = 'removed') {
        const effect = this.activeEffects.get(effectId);
        if (!effect) return null;
        this.activeEffects.delete(effectId);
        if (typeof effect.sourceEntityKey === 'string') this._untrackEffectEntity(effectId, effect.sourceEntityKey);
        if (typeof effect.targetEntityKey === 'string') this._untrackEffectEntity(effectId, effect.targetEntityKey);
        if (effect.type === ACTIVE_EFFECT_TRACTION) {
            const sourcePlayer = effect.sourceEntityKey?.startsWith('player:')
                ? this.players.get(effect.sourceEntityKey.slice('player:'.length))
                : null;
            if (sourcePlayer?.spellState?.pendingCast?.spellId === TRACTION_SPELL_ID) {
                const sid = effect.sourceEntityKey.slice('player:'.length);
                this._updatePlayer(sid, (currentPlayer) => {
                    if (currentPlayer?.spellState?.pendingCast?.spellId !== TRACTION_SPELL_ID) return currentPlayer;
                    const spellState = currentPlayer.spellState ?? {
                        pendingCast: null,
                        cooldownUntilBySpellId: {},
                    };
                    return {
                        ...currentPlayer,
                        spellState: {
                            ...spellState,
                            pendingCast: null,
                            cooldownUntilBySpellId: {
                                ...(spellState.cooldownUntilBySpellId ?? {}),
                            },
                        },
                    };
                });
            }
        }
        return { ...effect, removedReason: reason };
    }

    _listActiveEffectsForEntity(entityKey, type = null) {
        if (typeof entityKey !== 'string') return [];
        const ids = this.activeEffectIdsByEntityKey.get(entityKey);
        if (!ids || ids.size === 0) return [];
        const effects = [];
        for (const effectId of ids) {
            const effect = this.activeEffects.get(effectId);
            if (!effect) continue;
            if (type && effect.type !== type) continue;
            effects.push(effect);
        }
        return effects;
    }

    _findTractionEffectBySource(entityKey) {
        return this._listActiveEffectsForEntity(entityKey, ACTIVE_EFFECT_TRACTION)
            .find((effect) => effect.sourceEntityKey === entityKey) ?? null;
    }

    _findTractionEffectByTarget(entityKey) {
        return this._listActiveEffectsForEntity(entityKey, ACTIVE_EFFECT_TRACTION)
            .find((effect) => effect.targetEntityKey === entityKey) ?? null;
    }

    _findTractionEffectByOwnerSessionId(sessionId) {
        if (typeof sessionId !== 'string') return null;
        for (const effect of this.activeEffects.values()) {
            if (effect?.type !== ACTIVE_EFFECT_TRACTION) continue;
            if (effect.ownerSessionId === sessionId) return effect;
        }
        return null;
    }

    _cancelActiveEffectsForEntity(entityKey, reason = 'invalidated') {
        if (typeof entityKey !== 'string') return;
        const ids = Array.from(this.activeEffectIdsByEntityKey.get(entityKey) ?? []);
        for (const effectId of ids) {
            this._removeActiveEffect(effectId, reason);
        }
    }

    _buildEffectSummariesForEntity(entityKey) {
        if (typeof entityKey !== 'string') return [];
        const summaries = [];
        for (const effect of this._listActiveEffectsForEntity(entityKey)) {
            if (effect.type === ACTIVE_EFFECT_TRACTION && effect.sourceEntityKey === entityKey) {
                summaries.push({
                    id: effect.id,
                    type: 'traction_source',
                    spellId: TRACTION_SPELL_ID,
                    targetEntityKey: effect.targetEntityKey ?? null,
                });
            } else if (effect.type === ACTIVE_EFFECT_TRACTION && effect.targetEntityKey === entityKey) {
                summaries.push({
                    id: effect.id,
                    type: 'traction_target',
                    spellId: TRACTION_SPELL_ID,
                    sourceEntityKey: effect.sourceEntityKey ?? null,
                });
            } else if (effect.type === ACTIVE_EFFECT_HEALING_GEM || effect.type === ACTIVE_EFFECT_MAGIC_DEW) {
                summaries.push({
                    id: effect.id,
                    type: effect.type,
                    expiresAtMs: effect.expiresAtMs ?? null,
                });
            }
        }
        return summaries;
    }

    _serializeDragStateForWorldEntity(entityKey) {
        const traction = this._findTractionEffectByTarget(entityKey);
        if (!traction) return null;
        return {
            sourceEntityKey: traction.sourceEntityKey ?? null,
            targetEntityKey: traction.targetEntityKey ?? null,
            startedAtMs: traction.startedAtMs ?? null,
        };
    }

    _isValidTractionTarget(sourceCombatant, targetEntityKey, options = {}) {
        if (!sourceCombatant || typeof targetEntityKey !== 'string' || !targetEntityKey.startsWith('world:')) return false;
        const target = this.worldEntities.get(targetEntityKey);
        if (!target) return false;
        if (!isDraggableWorldKind(target.kind ?? null)) return false;
        if ((sourceCombatant.levelId ?? null) !== (target.levelId ?? null)) return false;
        if (target.controllerSessionId) return false;
        const ignoreEffectId = typeof options.ignoreEffectId === 'string' ? options.ignoreEffectId : null;
        const bySource = this._findTractionEffectBySource(sourceCombatant.entityKey);
        if (bySource && bySource.id !== ignoreEffectId) return false;
        const byTarget = this._findTractionEffectByTarget(targetEntityKey);
        if (byTarget && byTarget.id !== ignoreEffectId) return false;
        return true;
    }

    _resolveTractionDirection(effect, sourceCombatant, targetEntity = null, preferredDirection = null) {
        if (preferredDirection) {
            const normalized = sanitizeDirection(preferredDirection);
            if (normalized === 'north') return { x: 0, y: -1 };
            if (normalized === 'south') return { x: 0, y: 1 };
            if (normalized === 'east') return { x: 1, y: 0 };
            if (normalized === 'west') return { x: -1, y: 0 };
        }

        const sourcePlayer = sourceCombatant?.entityKey?.startsWith('player:')
            ? this.players.get(sourceCombatant.entityKey.slice('player:'.length))
            : null;
        const intent = sourcePlayer?.intent ?? null;
        let dirX = 0;
        let dirY = 0;
        if (intent) {
            if (intent.left) dirX -= 1;
            if (intent.right) dirX += 1;
            if (intent.up) dirY -= 1;
            if (intent.down) dirY += 1;
        }
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        if (len > 0.001) {
            return { x: dirX / len, y: dirY / len };
        }

        if (targetEntity && Number.isFinite(targetEntity.x) && Number.isFinite(targetEntity.y) &&
            Number.isFinite(sourceCombatant?.x) && Number.isFinite(sourceCombatant?.y)) {
            const dx = sourceCombatant.x - targetEntity.x;
            const dy = sourceCombatant.y - targetEntity.y;
            const gap = Math.sqrt(dx * dx + dy * dy);
            if (gap > 0.001) {
                return { x: dx / gap, y: dy / gap };
            }
        }

        return { x: 0, y: 1 };
    }

    _resolveTractionTargetPosition(effect, sourceCombatant, targetEntity = null, options = {}) {
        if (!effect || !sourceCombatant) return null;
        const direction = this._resolveTractionDirection(
            effect,
            sourceCombatant,
            targetEntity,
            options.preferredDirection ?? null
        );
        const tractionCfg = effect.config ?? {};
        const followDistance = Number.isFinite(tractionCfg.followDistance)
            ? Math.max(0, tractionCfg.followDistance)
            : 0;
        let x = sourceCombatant.x - direction.x * followDistance;
        let y = sourceCombatant.y - direction.y * followDistance;
        const grid = this._getGrid(options.levelId ?? sourceCombatant.levelId ?? targetEntity?.levelId ?? 'town-square');
        if (grid) ({ x, y } = resolveCollisions(x, y, grid));
        return { x, y };
    }

    _applyTractionEffect(sessionId, pendingCast, spellCfg, nowMs = Date.now()) {
        const source = this._resolveAttackSource(sessionId, pendingCast.requestedLevelId ?? null);
        if (!source) return false;
        if (!pendingCast.targetEntityKey) return false;
        if (!this._isValidTractionTarget(source, pendingCast.targetEntityKey)) return false;

        const target = this.worldEntities.get(pendingCast.targetEntityKey);
        if (!target) return false;

        const effectId = crypto.randomUUID();
        const tractionCfg = spellCfg.traction ?? {};
        const effect = this._registerActiveEffect({
            id: effectId,
            type: ACTIVE_EFFECT_TRACTION,
            spellId: TRACTION_SPELL_ID,
            sourceEntityKey: source.entityKey,
            targetEntityKey: pendingCast.targetEntityKey,
            ownerSessionId: sessionId,
            levelId: source.levelId ?? pendingCast.requestedLevelId ?? null,
            startedAtMs: nowMs,
            config: {
                dragMoveSpeedMultiplier: Number.isFinite(tractionCfg.dragMoveSpeedMultiplier)
                    ? Math.max(0, Math.min(1, tractionCfg.dragMoveSpeedMultiplier))
                    : 1,
                followDistance: Number.isFinite(tractionCfg.followDistance)
                    ? Math.max(0, tractionCfg.followDistance)
                    : 0,
            },
        });
        if (!effect) return false;

        const nextPos = this._resolveTractionTargetPosition(effect, source, target, {
            levelId: source.levelId ?? target.levelId ?? null,
        });
        if (nextPos) {
            this.worldEntities.set(target.entityKey, {
                ...target,
                levelId: source.levelId ?? target.levelId ?? null,
                x: nextPos.x,
                y: nextPos.y,
            });
        }
        return true;
    }

    _phaseActiveEffects() {
        if (this.activeEffects.size === 0) return;
        for (const effect of Array.from(this.activeEffects.values())) {
            if (!effect) continue;
            if (effect.type === ACTIVE_EFFECT_TRACTION) {
                const source = this._getCombatantByEntityKey(effect.sourceEntityKey);
                const target = this.worldEntities.get(effect.targetEntityKey);
                if (!source || !target) {
                    this._removeActiveEffect(effect.id, 'missing-endpoint');
                    continue;
                }
                if (!this._isValidTractionTarget(source, target.entityKey, { ignoreEffectId: effect.id })) {
                    this._removeActiveEffect(effect.id, 'invalid-target');
                    continue;
                }
                const nextPos = this._resolveTractionTargetPosition(effect, source, target, {
                    levelId: source.levelId ?? target.levelId ?? null,
                });
                if (!nextPos) continue;
                this.worldEntities.set(target.entityKey, {
                    ...target,
                    levelId: source.levelId ?? target.levelId ?? null,
                    x: nextPos.x,
                    y: nextPos.y,
                });
                continue;
            }

            const nowMs = Date.now();
            if (Number.isFinite(effect.expiresAtMs) && effect.expiresAtMs <= nowMs) {
                this._removeActiveEffect(effect.id, 'expired');
                continue;
            }
            if (!Number.isFinite(effect.nextTickAtMs) || effect.nextTickAtMs > nowMs) continue;

            const sourceEntityKey = effect.sourceEntityKey ?? null;
            const resources = this._getEntityResources(sourceEntityKey);
            if (!resources) {
                this._removeActiveEffect(effect.id, 'missing-resources');
                continue;
            }
            let nextResources = resources;
            if (effect.type === ACTIVE_EFFECT_HEALING_GEM) {
                nextResources = {
                    ...resources,
                    hp: {
                        ...resources.hp,
                        current: Math.min(resources.hp.max, (resources.hp.current ?? 0) + (effect.magnitude ?? 0)),
                    },
                };
            } else if (effect.type === ACTIVE_EFFECT_MAGIC_DEW) {
                nextResources = {
                    ...resources,
                    mana: {
                        ...resources.mana,
                        current: Math.min(resources.mana.max, (resources.mana.current ?? 0) + (effect.magnitude ?? 0)),
                    },
                };
            }
            this._setEntityResources(sourceEntityKey, nextResources);
            effect.nextTickAtMs = nowMs + Math.max(250, effect.tickIntervalMs ?? 1000);
            this.activeEffects.set(effect.id, effect);
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
        const spellState = {
            pendingCast: player.spellState?.pendingCast ?? null,
            cooldownUntilBySpellId: { ...(player.spellState?.cooldownUntilBySpellId ?? {}) },
        };
        const cooldownUntil = Number.isFinite(spellState.cooldownUntilBySpellId?.[spellId])
            ? spellState.cooldownUntilBySpellId[spellId]
            : 0;
        if (nowMs < cooldownUntil) return;
        if (spellState.pendingCast) return;

        if (spellId === TRACTION_SPELL_ID) {
            const activeTraction = this._findTractionEffectByOwnerSessionId(sessionId);
            if (activeTraction) {
                this._removeActiveEffect(activeTraction.id, 'manual-cancel');
                return;
            }
        }

        if (spellCfg.castMode === 'target_click') {
            if (!targetEntityKey) return;
            const source = this._resolveAttackSource(sessionId, levelId);
            if (!source) return;
            const valid = spellId === TRACTION_SPELL_ID
                ? this._isValidTractionTarget(source, targetEntityKey)
                : this._isValidSpellTarget(source, targetEntityKey);
            if (!valid) return;
        } else if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
            return;
        }

        const source = this._resolveAttackSource(sessionId, levelId);
        if (!source) return;
        if (!this._payEntityCosts(source.entityKey, {
            stamina: spellCfg.staminaCost ?? 0,
            mana: spellCfg.manaCost ?? 0,
        }, nowMs)) {
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

        this._updatePlayer(sessionId, (latestPlayer) => ({
            ...latestPlayer,
            spellState,
        }));
    }

    _phaseSpellCasts() {
        const nowMs = Date.now();
        for (const [sessionId, player] of this.players.entries()) {
            const spellState = {
                pendingCast: player.spellState?.pendingCast ?? null,
                cooldownUntilBySpellId: { ...(player.spellState?.cooldownUntilBySpellId ?? {}) },
            };
            const pending = spellState.pendingCast;
            if (!pending) continue;
            if (!Number.isFinite(pending.executeAtMs) || pending.executeAtMs > nowMs) continue;

            spellState.pendingCast = null;
            this._updatePlayer(sessionId, (latestPlayer) => ({ ...latestPlayer, spellState }));
            this._executeSpellCast(sessionId, pending, nowMs);
        }
    }

    _executeSpellCast(sessionId, pendingCast, nowMs = Date.now()) {
        if (!pendingCast?.spellId) return;
        const player = this.players.get(sessionId);
        if (!player) return;
        if (this._isEntityIncapacitated(player.controlledEntityKey ?? `player:${sessionId}`, nowMs)) return;
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
        } else if (pendingCast.spellId === TRACTION_SPELL_ID) {
            didCast = this._applyTractionEffect(sessionId, pendingCast, spellCfg, nowMs);
        }
        if (!didCast) return;

        if ((spellCfg.cooldownStartsAt ?? 'cast') === 'resolution') {
            return;
        }

        const nextPlayer = this.players.get(sessionId);
        if (!nextPlayer) return;
        const nextSpellState = {
            pendingCast: nextPlayer.spellState?.pendingCast ?? null,
            cooldownUntilBySpellId: { ...(nextPlayer.spellState?.cooldownUntilBySpellId ?? {}) },
        };
        nextSpellState.cooldownUntilBySpellId[pendingCast.spellId] = nowMs + Math.max(0, spellCfg.cooldownMs ?? 0);
        this._updatePlayer(sessionId, (latestPlayer) => ({ ...latestPlayer, spellState: nextSpellState }));
    }

    _setPlayerSpellCooldown(sessionId, spellId, cooldownMs, nowMs = Date.now()) {
        const player = this.players.get(sessionId);
        if (!player || !spellId) return;
        const spellState = {
            pendingCast: player.spellState?.pendingCast ?? null,
            cooldownUntilBySpellId: { ...(player.spellState?.cooldownUntilBySpellId ?? {}) },
        };
        spellState.cooldownUntilBySpellId[spellId] = nowMs + Math.max(0, cooldownMs ?? 0);
        this._updatePlayer(sessionId, (latestPlayer) => ({ ...latestPlayer, spellState }));
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

    _resolveActiveEffectMoveMultiplier(entityKey) {
        if (typeof entityKey !== 'string') return 1;
        let multiplier = 1;
        for (const effect of this._listActiveEffectsForEntity(entityKey)) {
            if (effect.type !== ACTIVE_EFFECT_TRACTION) continue;
            const configured = Number.isFinite(effect.config?.dragMoveSpeedMultiplier)
                ? effect.config.dragMoveSpeedMultiplier
                : 1;
            multiplier = Math.min(multiplier, Math.max(0, Math.min(1, configured)));
        }
        return multiplier;
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
                self: selfPlayer ? this._buildSelfSnapshotForSession(sessionId, selfPlayer) : null,
                worldEntities: Array.from(this.worldEntities.values())
                    .map((entry) => this._serializeWorldEntity(entry, now))
                    .filter(Boolean),
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
        this._cancelActiveEffectsForEntity(`player:${sessionId}`, `${reason}:player`);
        if (typeof controlledKey === 'string') {
            this._cancelActiveEffectsForEntity(controlledKey, `${reason}:controlled`);
        }

        if (controlledKey && controlledKey.startsWith('world:')) {
            const target = this.worldEntities.get(controlledKey);
            if (target && target.controllerSessionId === sessionId) {
                target.controllerSessionId = null;
                target.possessionEndAtMs = null;
                target.teamId = this._defaultTeamForKind(target.kind);
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

        this._updatePlayer(sessionId, (currentPlayer) => ({
            ...currentPlayer,
            transform: {
                ...currentPlayer.transform,
                x: returnX,
                y: returnY,
                levelId: returnLevelId,
            },
            controlledEntityKey: fallbackKey,
            returnEntityKey: fallbackKey,
        }));
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

    _initializeWorldSpawns() {
        for (const definition of getWorldSpawnDefinitions()) {
            this._spawnEntityFromDefinition(definition, { force: false });
        }
    }

    _defaultWorldEntityKeyForSpawn(definition) {
        if (!definition?.spawnKey) return null;
        return `world:${definition.spawnKey.slice('spawn:'.length)}`;
    }

    _buildWorldEntityFromSpawn(definition, entityKey) {
        if (!definition || !entityKey) return null;
        const x = definition.tileX * TILE_SIZE + TILE_SIZE / 2;
        const y = definition.tileY * TILE_SIZE + TILE_SIZE / 2;
        const base = {
            entityKey,
            spawnKey: definition.spawnKey,
            kind: definition.kind,
            x,
            y,
            levelId: definition.levelId,
            controllerSessionId: null,
            possessionEndAtMs: null,
            teamId: this._defaultTeamForKind(definition.kind),
            hitRadius: this._defaultHitRadiusForKind(definition.kind),
            resources: this._defaultResourcesForKind(definition.kind),
            poise: this._defaultPoiseForKind(definition.kind),
        };

        if (definition.kind === 'zombie') {
            return {
                ...base,
                intent: this._zombieIdleIntent(),
                motion: { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
                home: { x, y, levelId: definition.levelId },
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
            };
        }

        return base;
    }

    _spawnEntityFromDefinition(definition, { force = false } = {}) {
        if (!definition?.spawnKey) return null;
        const existingState = this.spawnStates.get(definition.spawnKey) ?? null;
        if (!force && existingState?.alive && existingState.entityKey && this.worldEntities.has(existingState.entityKey)) {
            return existingState.entityKey;
        }

        const entityKey = this._defaultWorldEntityKeyForSpawn(definition);
        if (!entityKey) return null;
        const entity = this._buildWorldEntityFromSpawn(definition, entityKey);
        if (!entity) return null;

        this.worldEntities.set(entityKey, entity);
        this.spawnStates.set(definition.spawnKey, {
            spawnKey: definition.spawnKey,
            alive: true,
            entityKey,
        });
        return entityKey;
    }

    _isSpawnSuppressed(definition) {
        if (!definition) return false;
        if (!Array.isArray(definition.tags) || definition.tags.length === 0) return false;
        return definition.tags.some((tag) => this.suppressedTags.has(tag));
    }

    _resetRespawnableWorldEntities(context = {}) {
        let respawned = 0;
        for (const definition of getWorldSpawnDefinitions()) {
            if (this._isSpawnSuppressed(definition)) continue;
            const state = this.spawnStates.get(definition.spawnKey) ?? null;
            if (state?.alive && state.entityKey && this.worldEntities.has(state.entityKey)) continue;
            const spawnedKey = this._spawnEntityFromDefinition(definition, { force: true });
            if (spawnedKey) respawned += 1;
        }

        if (respawned > 0) {
            this.#broadcastAll({
                type: MSG.WORLD_STATE,
                scope: 'all',
                entities: Array.from(this.worldEntities.values())
                    .map((entry) => this._serializeWorldEntity(entry, Date.now()))
                    .filter(Boolean),
            });
        }

        this.#broadcastAll({
            type: MSG.WORLD_RESET,
            source: typeof context.source === 'string' ? context.source : 'unknown',
            interactableId: typeof context.interactableId === 'string' ? context.interactableId : null,
            triggeredBySessionId: typeof context.sessionId === 'string' ? context.sessionId : null,
            respawnedCount: respawned,
        });

        return respawned;
    }

    _handleInteractRequest(sessionId, player, interactableId) {
        if (typeof interactableId === 'string' && interactableId.startsWith('world:')) {
            this._pickupWorldLoot(sessionId, player, interactableId);
            return;
        }
        const definition = getInteractableDefinition(interactableId);
        if (!definition || !this._playerCanUseInteractable(player, definition)) return;
        if (definition.kind !== 'warm_fire') return;

        this._restorePlayerToFullHealth(sessionId);
        this._resetRespawnableWorldEntities({
            source: 'warm_fire',
            sessionId,
            interactableId,
        });
    }

    _playerCanUseInteractable(player, definition) {
        if (!player || !definition) return false;
        const playerLevelId = player.transform?.levelId ?? null;
        if (playerLevelId !== definition.levelId) return false;
        const x = player.transform?.x;
        const y = player.transform?.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        const interactX = definition.tileX * TILE_SIZE + TILE_SIZE / 2;
        const interactY = definition.tileY * TILE_SIZE + TILE_SIZE / 2;
        const radius = Number.isFinite(definition.interactionRadius) ? definition.interactionRadius : TILE_SIZE * 1.5;
        const distSq = (x - interactX) ** 2 + (y - interactY) ** 2;
        return distSq <= radius * radius;
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
        const profile = this._resolveMeleeProfile(weaponId, phaseIndex);
        if (!this._payEntityCosts(source.entityKey, {
            stamina: profile?.staminaCost ?? 0,
            mana: 0,
        }, Date.now())) {
            return;
        }

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
        if (weaponId === 'longsword' || weaponId === 'sword') return 'longsword';
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

        const nextResources = damageHealth(victim.resources, damage, Date.now());
        const newHp = nextResources.hp.current;
        const died = newHp === 0;
        let nextHp = newHp;
        let nextPlayer = {
            ...victim,
            resources: nextResources,
        };
        if (died) {
            nextPlayer = this._respawnPlayerToInn(victimSessionId, nextPlayer);
            nextHp = nextPlayer.resources?.hp?.current ?? 0;
        }
        this._updatePlayer(victimSessionId, () => nextPlayer);

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

    _restorePlayerToFullHealth(sessionId) {
        const player = this.players.get(sessionId);
        if (!player) return;

        let resources = player.resources ?? this._defaultResourcesForKind('player');
        resources = fillResource(resources, RESOURCE_KINDS.hp);
        resources = fillResource(resources, RESOURCE_KINDS.stamina);
        resources = fillResource(resources, RESOURCE_KINDS.mana);
        const nextHp = resources.hp.current;
        if ((player.resources?.hp?.current ?? 0) === nextHp &&
            (player.resources?.stamina?.current ?? 0) === resources.stamina.current &&
            (player.resources?.mana?.current ?? 0) === resources.mana.current) return;

        this._updatePlayer(sessionId, (currentPlayer) => ({
            ...currentPlayer,
            resources,
        }));

        this.#broadcastAll({
            type: MSG.PLAYER_DAMAGED,
            sessionId,
            attackerId: null,
            damage: 0,
            hp: nextHp,
            died: false,
        });
    }

    _applyDamageToWorldEntity(entityKey, damage, attackerEntityKey = null) {
        const entity = this.worldEntities.get(entityKey);
        if (!entity) return;
        const nextResources = damageHealth(entity.resources, damage, Date.now());
        const nextHp = nextResources.hp.current;
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
            this._cancelActiveEffectsForEntity(entityKey, 'death');
            if (typeof entity.spawnKey === 'string') {
                this.spawnStates.set(entity.spawnKey, {
                    spawnKey: entity.spawnKey,
                    alive: false,
                    entityKey: null,
                });
            }
            this._convertWorldEntityToCorpse(entityKey, entity, attackerEntityKey);
            this.worldEntities.delete(entityKey);
            return;
        }
        this.worldEntities.set(entityKey, {
            ...entity,
            resources: nextResources,
        });
    }

    _respawnPlayerToInn(sessionId, player) {
        if (!player) return player;

        const latest = this.players.get(sessionId) ?? player;
        const controlledKey = latest.controlledEntityKey ?? `player:${sessionId}`;
        this._cancelActiveEffectsForEntity(`player:${sessionId}`, 'death');
        if (typeof controlledKey === 'string') {
            this._cancelActiveEffectsForEntity(controlledKey, 'death');
        }
        if (controlledKey.startsWith('world:')) {
            const target = this.worldEntities.get(controlledKey);
            if (target && target.controllerSessionId === sessionId) {
                target.controllerSessionId = null;
                target.possessionEndAtMs = null;
                target.teamId = this._defaultTeamForKind(target.kind);
                this.worldEntities.set(controlledKey, target);
                this.#broadcastAll({
                    type: MSG.ENTITY_CONTROL,
                    entityKey: controlledKey,
                    controllerSessionId: null,
                    previousControllerSessionId: sessionId,
                    winnerSessionId: null,
                    possessionMsRemaining: 0,
                    reason: 'death:release',
                });
            }
        }
        const spawn = resolveStageSpawnPosition('inn');
        const respawnX = spawn?.x ?? latest.transform?.x ?? 0;
        const respawnY = spawn?.y ?? latest.transform?.y ?? 0;
        this.#sendToSession(sessionId, {
            type: MSG.FORCE_CONTROL,
            controlledEntityKey: `player:${sessionId}`,
            levelId: 'inn',
            x: respawnX,
            y: respawnY,
            winnerSessionId: null,
            previousControllerSessionId: controlledKey.startsWith('world:') ? sessionId : null,
            possessionMsRemaining: 0,
            reason: 'death:respawn',
        });

        return {
            ...latest,
            transform: {
                ...latest.transform,
                x: respawnX,
                y: respawnY,
                levelId: 'inn',
            },
            resources: this._defaultResourcesForKind('player'),
            controlledEntityKey: `player:${sessionId}`,
            returnEntityKey: `player:${sessionId}`,
            motion: { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
            intent: {
                up: false, down: false, left: false, right: false, sprint: false,
                moveSpeedMultiplier: 0, attackPushVx: 0, attackPushVy: 0,
            },
            poise: this._defaultPoiseForKind('player'),
        };
    }

    _convertWorldEntityToCorpse(entityKey, entity, killerEntityKey = null) {
        if (!entity) return null;
        const equipSnapshot = this.entityEquips.get(entityKey)?.equipped ?? null;
        this.entityEquips.delete(entityKey);

        if (entity.controllerSessionId) {
            this._releaseControllerToReturn(entity.controllerSessionId, 'death:controlled-entity', {
                previousControllerSessionId: entity.controllerSessionId,
            });
        }

        const nowMs = Date.now();
        const corpseKey = `world:corpse_${crypto.randomUUID().replace(/-/g, '_')}`;
        const corpse = {
            entityKey: corpseKey,
            kind: 'corpse',
            teamId: TEAM_NEUTRAL,
            x: Number.isFinite(entity.x) ? entity.x : 0,
            y: Number.isFinite(entity.y) ? entity.y : 0,
            levelId: entity.levelId ?? null,
            hitRadius: Number.isFinite(entity.hitRadius)
                ? entity.hitRadius
                : this._getWorldEntityHitRadius(entity),
            decay: {
                startedAtMs: nowMs,
                durationMs: CORPSE_DECAY_DURATION_MS,
                expiresAtMs: nowMs + CORPSE_DECAY_DURATION_MS,
            },
            identity: {
                originalEntityKey: entityKey,
                originalKind: entity.kind ?? null,
                displayName: entity.kind ?? 'corpse',
                teamIdAtDeath: this._getWorldEntityTeamId(entity),
                statsSnapshot: {
                    resources: summarizeResources(entity.resources),
                },
                loadoutSnapshot: equipSnapshot,
                diedAtMs: nowMs,
                killerEntityKey: typeof killerEntityKey === 'string' ? killerEntityKey : null,
            },
        };
        this.worldEntities.set(corpseKey, corpse);
        return corpseKey;
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
            this._applyDamageToWorldEntity(targetEntityKey, damage, attackerEntityKey);
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
            this._updatePlayer(sid, (player) => ({ ...player, poise }));
            return;
        }
        if (entityKey.startsWith('world:')) {
            this._updateWorldEntity(entityKey, (world) => ({ ...world, poise }));
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
        this._cancelActiveEffectsForEntity(entityKey, 'interrupt');
        if (entityKey.startsWith('player:')) {
            const sid = entityKey.slice('player:'.length);
            const player = this.players.get(sid);
            if (!player) return;
            this._updatePlayer(sid, (currentPlayer) => ({
                ...currentPlayer,
                intent: {
                    up: false, down: false, left: false, right: false, sprint: false,
                    moveSpeedMultiplier: 0, attackPushVx: 0, attackPushVy: 0,
                },
                motion: { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
            }));
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
            this._updatePlayer(sid, (currentPlayer) => ({ ...currentPlayer, poise }));
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
            this._updateWorldEntity(entityKey, (currentWorld) => ({ ...currentWorld, poise }));
        }
    }

    _buildSelfSnapshotForSession(sessionId, player) {
        const controlledEntityKey = player?.controlledEntityKey ?? `player:${sessionId}`;
        const resources = this._getEntityResources(controlledEntityKey) ?? this._getEntityResources(`player:${sessionId}`);
        return {
            sessionId,
            controlledEntityKey,
            resources: summarizeResources(resources),
            inventory: this._buildInventorySnapshot(player?.inventory),
            spellbook: this._buildSpellbookSnapshot(player?.spellbook),
            teamId: typeof this._getEntityTeamId(controlledEntityKey) === 'string'
                ? this._getEntityTeamId(controlledEntityKey)
                : null,
            sightRadius: this._resolveSightRadiusForPlayer(sessionId),
            buffs: this._buildEffectSummariesForEntity(controlledEntityKey),
        };
    }

    _buildInventorySnapshot(inventory) {
        const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
        return {
            gold: Number.isFinite(inventory?.gold) ? Math.max(0, Math.floor(inventory.gold)) : 0,
            entries: entries.map((entry) => ({
                entryId: entry.entryId,
                definitionId: entry.definitionId,
                category: entry.category,
                quantity: entry.quantity,
                upgradeLevel: entry.upgradeLevel ?? 0,
            })),
        };
    }

    _buildSpellbookSnapshot(spellbook) {
        return {
            knownSpells: Array.isArray(spellbook?.knownSpells)
                ? spellbook.knownSpells.map((entry) => ({
                    spellId: entry.spellId,
                    upgradeLevel: entry.upgradeLevel ?? 0,
                }))
                : [],
        };
    }

    _nextInventoryEntryId(inventory) {
        const nextValue = Number.isFinite(inventory?.nextEntryId) ? Math.max(1, Math.floor(inventory.nextEntryId)) : 1;
        return `inv_${String(nextValue).padStart(6, '0')}`;
    }

    _inventoryEntries(inventory) {
        return Array.isArray(inventory?.entries) ? inventory.entries : [];
    }

    _addInventoryEntry(sessionId, definitionId, quantity = 1, upgradeLevel = 0) {
        const definition = getItemDefinition(definitionId);
        if (!definition) return false;
        if (!Number.isFinite(quantity) || quantity <= 0) return false;
        this._updatePlayer(sessionId, (player) => {
            const inventory = player.inventory ?? { gold: 0, entries: [], nextEntryId: 1 };
            const existing = this._inventoryEntries(inventory).find((entry) => (
                entry.definitionId === definitionId &&
                entry.category === definition.category &&
                (entry.upgradeLevel ?? 0) === Math.max(0, Math.floor(upgradeLevel))
            ));
            if (existing) {
                existing.quantity += Math.max(1, Math.floor(quantity));
                return { ...player, inventory: { ...inventory, entries: [...inventory.entries] } };
            }
            const entryId = this._nextInventoryEntryId(inventory);
            const nextEntry = buildInventoryEntry(entryId, definitionId, quantity, upgradeLevel);
            return {
                ...player,
                inventory: {
                    gold: inventory.gold ?? 0,
                    nextEntryId: (inventory.nextEntryId ?? 1) + 1,
                    entries: [...this._inventoryEntries(inventory), nextEntry],
                },
            };
        });
        return true;
    }

    _consumeInventoryEntryByDefinition(sessionId, definitionId, category) {
        let consumed = null;
        this._updatePlayer(sessionId, (player) => {
            const inventory = player.inventory ?? { gold: 0, entries: [], nextEntryId: 1 };
            const entries = [...this._inventoryEntries(inventory)].sort((a, b) => a.entryId.localeCompare(b.entryId));
            const entry = entries.find((candidate) => candidate.definitionId === definitionId && candidate.category === category && candidate.quantity > 0);
            if (!entry) return player;
            entry.quantity -= 1;
            consumed = { ...entry, quantity: entry.quantity + 1 };
            const filtered = entries.filter((candidate) => candidate.quantity > 0);
            return {
                ...player,
                inventory: {
                    gold: inventory.gold ?? 0,
                    nextEntryId: inventory.nextEntryId ?? 1,
                    entries: filtered,
                },
            };
        });
        return consumed;
    }

    _findInventoryEntry(sessionId, entryId) {
        const player = this.players.get(sessionId);
        if (!player || typeof entryId !== 'string') return null;
        return this._inventoryEntries(player.inventory).find((entry) => entry.entryId === entryId) ?? null;
    }

    _isDefinitionAssignedForDrop(player, definitionId, category) {
        if (!player || typeof definitionId !== 'string') return false;
        const loadoutSnapshot = player.loadoutSnapshot ?? null;
        if (category === INVENTORY_CATEGORY_WEAPON && loadoutSnapshot?.weaponSlots?.includes(definitionId)) return true;
        if (category === INVENTORY_CATEGORY_CONSUMABLE && loadoutSnapshot?.consumableSlots?.includes(definitionId)) return true;
        if (category === INVENTORY_CATEGORY_ARMOR && player.equipped?.armorSetId === definitionId) return true;
        if (category === INVENTORY_CATEGORY_ACCESSORY && player.equipped?.accessoryId === definitionId) return true;
        if (player.equipped?.weaponId === definitionId) return true;
        return false;
    }

    _addGold(sessionId, amount) {
        if (!Number.isFinite(amount) || amount <= 0) return;
        this._updatePlayer(sessionId, (player) => {
            const inventory = player.inventory ?? { gold: 0, entries: [], nextEntryId: 1 };
            return {
                ...player,
                inventory: {
                    ...inventory,
                    gold: Math.max(0, Math.floor(inventory.gold ?? 0) + Math.floor(amount)),
                },
            };
        });
    }

    _dropInventoryEntry(sessionId, entryId, mode = 'one') {
        const player = this.players.get(sessionId);
        if (!player) return false;

        const entry = this._findInventoryEntry(sessionId, entryId);
        if (!entry || !Number.isFinite(entry.quantity) || entry.quantity <= 0) return false;

        const definition = getItemDefinition(entry.definitionId);
        if (!definition?.baseDroppable) {
            this._enqueueToast(sessionId, 'That item cannot be dropped', 1400);
            return false;
        }
        if (this._isDefinitionAssignedForDrop(player, entry.definitionId, entry.category)) {
            this._enqueueToast(sessionId, 'Assigned items cannot be dropped', 1400);
            return false;
        }

        const dropQuantity = mode === 'all' ? entry.quantity : 1;
        const scatterX = (Math.random() - 0.5) * 44;
        const scatterY = (Math.random() - 0.5) * 44;
        const sourceEntityKey = player.controlledEntityKey ?? `player:${sessionId}`;
        const sourceX = this._getEntityX(sourceEntityKey) ?? player.transform?.x ?? 0;
        const sourceY = this._getEntityY(sourceEntityKey) ?? player.transform?.y ?? 0;
        const sourceLevelId = this._getEntityLevelId(sourceEntityKey) ?? player.transform?.levelId ?? 'inn';

        let removed = false;
        this._updatePlayer(sessionId, (currentPlayer) => {
            const inventory = currentPlayer.inventory ?? { gold: 0, entries: [], nextEntryId: 1 };
            const entries = this._inventoryEntries(inventory).map((candidate) => ({ ...candidate }));
            const target = entries.find((candidate) => candidate.entryId === entryId);
            if (!target || target.quantity < dropQuantity) return currentPlayer;
            target.quantity -= dropQuantity;
            removed = true;
            return {
                ...currentPlayer,
                inventory: {
                    gold: inventory.gold ?? 0,
                    nextEntryId: inventory.nextEntryId ?? 1,
                    entries: entries.filter((candidate) => candidate.quantity > 0),
                },
            };
        });
        if (!removed) return false;

        const worldDropKey = `world:loot_drop_${crypto.randomUUID().replace(/-/g, '_')}`;
        this.worldEntities.set(worldDropKey, {
            entityKey: worldDropKey,
            kind: 'loot',
            x: sourceX + scatterX,
            y: sourceY + scatterY,
            levelId: sourceLevelId,
            teamId: TEAM_NEUTRAL,
            hitRadius: 14,
            resources: null,
            loot: {
                definitionId: entry.definitionId,
                quantity: dropQuantity,
                upgradeLevel: entry.upgradeLevel ?? 0,
                category: entry.category,
            },
        });

        const quantityText = dropQuantity > 1 ? ` x${dropQuantity}` : '';
        this._enqueueToast(sessionId, `Dropped: ${definition.name}${quantityText}`, 1400);
        return true;
    }

    _sellInventoryEntry(sessionId, merchantId, entryId, mode = 'one') {
        const player = this.players.get(sessionId);
        if (!player) return false;
        const merchant = getInteractableDefinition(merchantId);
        if (!merchant || merchant.kind !== 'vendor_shop' || !this._playerCanUseInteractable(player, merchant)) {
            this._enqueueToast(sessionId, 'Move closer to the vendor', 1400);
            return false;
        }

        const entry = this._findInventoryEntry(sessionId, entryId);
        if (!entry || !Number.isFinite(entry.quantity) || entry.quantity <= 0) return false;

        const definition = getItemDefinition(entry.definitionId);
        if (!definition?.baseSellable) {
            this._enqueueToast(sessionId, 'That item cannot be sold', 1400);
            return false;
        }
        if (this._isDefinitionAssignedForDrop(player, entry.definitionId, entry.category)) {
            this._enqueueToast(sessionId, 'Assigned items cannot be sold', 1400);
            return false;
        }

        const sellQuantity = mode === 'all' ? entry.quantity : 1;
        const unitSellPrice = Math.max(0, Math.floor(definition.sellPrice ?? 0));
        const goldAward = unitSellPrice * sellQuantity;
        let removed = false;
        this._updatePlayer(sessionId, (currentPlayer) => {
            const inventory = currentPlayer.inventory ?? { gold: 0, entries: [], nextEntryId: 1 };
            const entries = this._inventoryEntries(inventory).map((candidate) => ({ ...candidate }));
            const target = entries.find((candidate) => candidate.entryId === entryId);
            if (!target || target.quantity < sellQuantity) return currentPlayer;
            target.quantity -= sellQuantity;
            removed = true;
            return {
                ...currentPlayer,
                inventory: {
                    gold: Math.max(0, Math.floor(inventory.gold ?? 0) + goldAward),
                    nextEntryId: inventory.nextEntryId ?? 1,
                    entries: entries.filter((candidate) => candidate.quantity > 0),
                },
            };
        });
        if (!removed) return false;

        const quantityText = sellQuantity > 1 ? ` x${sellQuantity}` : '';
        const goldText = goldAward > 0 ? ` (+${goldAward} gold)` : '';
        this._enqueueToast(sessionId, `Sold: ${definition.name}${quantityText}${goldText}`, 1400);
        return true;
    }

    _buyMerchantItem(sessionId, merchantId, definitionId) {
        const player = this.players.get(sessionId);
        if (!player) return false;
        const merchant = getInteractableDefinition(merchantId);
        if (!merchant || merchant.kind !== 'vendor_shop' || !this._playerCanUseInteractable(player, merchant)) {
            this._enqueueToast(sessionId, 'Move closer to the vendor', 1400);
            return false;
        }

        const stock = Array.isArray(merchant.shopStock) ? merchant.shopStock : [];
        if (!stock.includes(definitionId)) {
            this._enqueueToast(sessionId, 'That item is not sold here', 1400);
            return false;
        }

        const definition = getItemDefinition(definitionId);
        const buyPrice = Math.max(0, Math.floor(definition?.buyPrice ?? 0));
        const currentGold = Math.max(0, Math.floor(player.inventory?.gold ?? 0));
        if (!definition || currentGold < buyPrice) {
            this._enqueueToast(sessionId, 'Not enough gold', 1400);
            return false;
        }

        this._updatePlayer(sessionId, (currentPlayer) => {
            const inventory = currentPlayer.inventory ?? { gold: 0, entries: [], nextEntryId: 1 };
            return {
                ...currentPlayer,
                inventory: {
                    ...inventory,
                    gold: Math.max(0, Math.floor(inventory.gold ?? 0) - buyPrice),
                },
            };
        });
        this._addInventoryEntry(sessionId, definitionId, 1, 0);
        this._enqueueToast(sessionId, `Bought: ${definition.name} (-${buyPrice} gold)`, 1400);
        return true;
    }

    _getTotalInventoryQuantity(sessionId, definitionId, category = null) {
        const player = this.players.get(sessionId);
        if (!player || typeof definitionId !== 'string') return 0;
        return this._inventoryEntries(player.inventory).reduce((sum, entry) => {
            if (entry.definitionId !== definitionId) return sum;
            if (category && entry.category !== category) return sum;
            return sum + (entry.quantity ?? 0);
        }, 0);
    }

    _consumeInventoryQuantityByDefinition(sessionId, definitionId, category, amount) {
        const targetAmount = Number.isFinite(amount) ? Math.max(1, Math.floor(amount)) : 1;
        let removed = 0;
        this._updatePlayer(sessionId, (player) => {
            const inventory = player.inventory ?? { gold: 0, entries: [], nextEntryId: 1 };
            const entries = this._inventoryEntries(inventory)
                .map((entry) => ({ ...entry }))
                .sort((a, b) => a.entryId.localeCompare(b.entryId));
            let remaining = targetAmount;
            for (const entry of entries) {
                if (remaining <= 0) break;
                if (entry.definitionId !== definitionId || entry.category !== category || entry.quantity <= 0) continue;
                const take = Math.min(entry.quantity, remaining);
                entry.quantity -= take;
                remaining -= take;
                removed += take;
            }
            if (removed <= 0) return player;
            return {
                ...player,
                inventory: {
                    gold: inventory.gold ?? 0,
                    nextEntryId: inventory.nextEntryId ?? 1,
                    entries: entries.filter((entry) => entry.quantity > 0),
                },
            };
        });
        return removed;
    }

    _upgradeWeaponItem(sessionId, upgraderId, entryId) {
        const player = this.players.get(sessionId);
        if (!player) return false;
        const upgrader = getInteractableDefinition(upgraderId);
        if (!upgrader || upgrader.kind !== 'weapon_upgrader' || !this._playerCanUseInteractable(player, upgrader)) {
            this._enqueueToast(sessionId, 'Move closer to the Weapon Upgrader', 1400);
            return false;
        }

        const entry = this._findInventoryEntry(sessionId, entryId);
        if (!entry || entry.category !== INVENTORY_CATEGORY_WEAPON) return false;
        const currentLevel = Math.max(0, Math.floor(entry.upgradeLevel ?? 0));
        if (currentLevel >= MAX_UPGRADE_LEVEL) {
            this._enqueueToast(sessionId, 'That weapon is already at max upgrade', 1400);
            return false;
        }
        const cost = getUpgradeCostForLevel(currentLevel);
        if (!cost) return false;
        const materialCount = this._getTotalInventoryQuantity(sessionId, 'weapon_upgrade_material', INVENTORY_CATEGORY_RESOURCE);
        const currentGold = Math.max(0, Math.floor(player.inventory?.gold ?? 0));
        if (materialCount < cost.materials || currentGold < cost.gold) {
            this._enqueueToast(sessionId, 'Missing upgrade requirements', 1400);
            return false;
        }

        let upgraded = false;
        this._updatePlayer(sessionId, (currentPlayer) => {
            const inventory = currentPlayer.inventory ?? { gold: 0, entries: [], nextEntryId: 1 };
            const entries = this._inventoryEntries(inventory).map((candidate) => ({ ...candidate }));
            const target = entries.find((candidate) => candidate.entryId === entryId);
            if (!target || target.quantity <= 0 || (target.upgradeLevel ?? 0) !== currentLevel) return currentPlayer;
            target.quantity -= 1;
            const nextUpgradeLevel = currentLevel + 1;
            const mergeTarget = entries.find((candidate) => (
                candidate.definitionId === target.definitionId &&
                candidate.category === target.category &&
                (candidate.upgradeLevel ?? 0) === nextUpgradeLevel
            ));
            if (mergeTarget) {
                mergeTarget.quantity += 1;
            } else {
                entries.push(buildInventoryEntry(this._nextInventoryEntryId(inventory), target.definitionId, 1, nextUpgradeLevel));
            }
            upgraded = true;
            return {
                ...currentPlayer,
                inventory: {
                    gold: Math.max(0, Math.floor(inventory.gold ?? 0) - cost.gold),
                    nextEntryId: (inventory.nextEntryId ?? 1) + (mergeTarget ? 0 : 1),
                    entries: entries.filter((candidate) => candidate && candidate.quantity > 0),
                },
            };
        });
        if (!upgraded) return false;
        this._consumeInventoryQuantityByDefinition(sessionId, 'weapon_upgrade_material', INVENTORY_CATEGORY_RESOURCE, cost.materials);
        const definition = getItemDefinition(entry.definitionId);
        this._enqueueToast(sessionId, `Upgraded: ${definition?.name ?? entry.definitionId} +${currentLevel + 1}`, 1400);
        return true;
    }

    _upgradeSpellItem(sessionId, upgraderId, spellId) {
        const player = this.players.get(sessionId);
        if (!player) return false;
        const upgrader = getInteractableDefinition(upgraderId);
        if (!upgrader || upgrader.kind !== 'spell_upgrader' || !this._playerCanUseInteractable(player, upgrader)) {
            this._enqueueToast(sessionId, 'Move closer to the Spell Upgrader', 1400);
            return false;
        }

        const currentEntry = Array.isArray(player.spellbook?.knownSpells)
            ? player.spellbook.knownSpells.find((entry) => entry.spellId === spellId)
            : null;
        const currentLevel = Math.max(0, Math.floor(currentEntry?.upgradeLevel ?? -1));
        if (!currentEntry) return false;
        if (currentLevel >= MAX_UPGRADE_LEVEL) {
            this._enqueueToast(sessionId, 'That spell is already at max upgrade', 1400);
            return false;
        }
        const cost = getUpgradeCostForLevel(currentLevel);
        if (!cost) return false;
        const materialCount = this._getTotalInventoryQuantity(sessionId, 'spell_upgrade_material', INVENTORY_CATEGORY_RESOURCE);
        const currentGold = Math.max(0, Math.floor(player.inventory?.gold ?? 0));
        if (materialCount < cost.materials || currentGold < cost.gold) {
            this._enqueueToast(sessionId, 'Missing upgrade requirements', 1400);
            return false;
        }

        let upgraded = false;
        this._updatePlayer(sessionId, (currentPlayer) => {
            const inventory = currentPlayer.inventory ?? { gold: 0, entries: [], nextEntryId: 1 };
            const spellbook = currentPlayer.spellbook ?? { knownSpells: [] };
            const knownSpells = Array.isArray(spellbook.knownSpells)
                ? spellbook.knownSpells.map((entry) => ({ ...entry }))
                : [];
            const target = knownSpells.find((entry) => entry.spellId === spellId);
            if (!target || (target.upgradeLevel ?? 0) !== currentLevel) return currentPlayer;
            target.upgradeLevel = currentLevel + 1;
            upgraded = true;
            return {
                ...currentPlayer,
                inventory: {
                    ...inventory,
                    gold: Math.max(0, Math.floor(inventory.gold ?? 0) - cost.gold),
                },
                spellbook: {
                    knownSpells,
                },
            };
        });
        if (!upgraded) return false;
        this._consumeInventoryQuantityByDefinition(sessionId, 'spell_upgrade_material', INVENTORY_CATEGORY_RESOURCE, cost.materials);
        this._enqueueToast(sessionId, `Upgraded spell: ${spellId} +${currentLevel + 1}`, 1400);
        return true;
    }

    _enqueueToast(sessionId, message, durationMs = 1800) {
        if (!message) return;
        this.#sendToSession(sessionId, {
            type: MSG.TOAST,
            message,
            durationMs,
        });
    }

    _seedWorldDrops() {
        for (const seed of SEEDED_WORLD_DROPS) {
            if (this.worldEntities.has(seed.entityKey)) continue;
            this.worldEntities.set(seed.entityKey, {
                entityKey: seed.entityKey,
                kind: 'loot',
                x: seed.x,
                y: seed.y,
                levelId: seed.levelId,
                teamId: TEAM_NEUTRAL,
                hitRadius: 14,
                resources: null,
                loot: {
                    definitionId: seed.definitionId,
                    quantity: seed.quantity,
                    upgradeLevel: seed.upgradeLevel ?? 0,
                    category: getItemDefinition(seed.definitionId)?.category ?? null,
                },
            });
        }
    }

    _pickupWorldLoot(sessionId, player, entityKey) {
        const drop = this.worldEntities.get(entityKey);
        if (!drop || drop.kind !== 'loot' || !drop.loot) return false;
        const radius = 80;
        const x = player.transform?.x ?? 0;
        const y = player.transform?.y ?? 0;
        const dx = (drop.x ?? 0) - x;
        const dy = (drop.y ?? 0) - y;
        if ((dx * dx + dy * dy) > radius * radius) return false;

        const definition = getItemDefinition(drop.loot.definitionId);
        if (!definition) return false;
        this._addInventoryEntry(sessionId, drop.loot.definitionId, drop.loot.quantity ?? 1, drop.loot.upgradeLevel ?? 0);
        this.worldEntities.delete(entityKey);
        const quantityText = (drop.loot.quantity ?? 1) > 1 ? ` x${drop.loot.quantity}` : '';
        this._enqueueToast(sessionId, `Picked up: ${definition.name}${quantityText}`);
        return true;
    }

    _useConsumableForPlayer(sessionId, definitionId) {
        const definition = getItemDefinition(definitionId);
        if (!definition || definition.category !== INVENTORY_CATEGORY_CONSUMABLE) {
            this._enqueueToast(sessionId, 'No consumable assigned', 1400);
            return;
        }

        const consumed = this._consumeInventoryEntryByDefinition(sessionId, definitionId, INVENTORY_CATEGORY_CONSUMABLE);
        if (!consumed) {
            this._enqueueToast(sessionId, `Out of ${definition.name}`, 1400);
            return;
        }

        if (definition.effectType === 'grant_gold') {
            this._addGold(sessionId, definition.goldAmount ?? 0);
            return;
        }

        this._applyConsumableEffect(sessionId, definition);
    }

    _applyConsumableEffect(sessionId, definition) {
        const sourceEntityKey = this.players.get(sessionId)?.controlledEntityKey ?? `player:${sessionId}`;
        const nowMs = Date.now();
        const activeType = definition.effectType;
        const existing = Array.from(this.activeEffects.values()).find((effect) => (
            effect?.type === activeType && effect.sourceEntityKey === sourceEntityKey
        ));
        const durationMs = Math.max(1000, definition.durationMs ?? 1000);
        const tickIntervalMs = Math.max(250, definition.tickIntervalMs ?? 1000);
        const magnitude = Math.max(1, definition.magnitude ?? 1);

        if (existing) {
            existing.startedAtMs = nowMs;
            existing.expiresAtMs = nowMs + durationMs;
            existing.nextTickAtMs = nowMs + tickIntervalMs;
            existing.magnitude = magnitude;
            this.activeEffects.set(existing.id, existing);
            return;
        }

        this._registerActiveEffect({
            id: crypto.randomUUID(),
            type: activeType,
            sourceEntityKey,
            targetEntityKey: sourceEntityKey,
            ownerSessionId: sessionId,
            startedAtMs: nowMs,
            expiresAtMs: nowMs + durationMs,
            nextTickAtMs: nowMs + tickIntervalMs,
            tickIntervalMs,
            magnitude,
        });
    }

    _updatePlayer(sessionId, updater) {
        if (typeof updater !== 'function') return null;
        const current = this.players.get(sessionId);
        if (!current) return null;
        const next = updater(current);
        if (!next) return null;
        this.players.set(sessionId, next);
        return next;
    }

    _updateWorldEntity(entityKey, updater) {
        if (typeof updater !== 'function') return null;
        const current = this.worldEntities.get(entityKey);
        if (!current) return null;
        const next = updater(current);
        if (!next) return null;
        this.worldEntities.set(entityKey, next);
        return next;
    }

    _getEntityResources(entityKey) {
        if (typeof entityKey !== 'string') return null;
        if (entityKey.startsWith('player:')) {
            const sid = entityKey.slice('player:'.length);
            return this.players.get(sid)?.resources ?? null;
        }
        if (entityKey.startsWith('world:')) {
            return this.worldEntities.get(entityKey)?.resources ?? null;
        }
        return null;
    }

    _getEntityX(entityKey) {
        if (typeof entityKey !== 'string') return null;
        if (entityKey.startsWith('player:')) {
            const sid = entityKey.slice('player:'.length);
            return this.players.get(sid)?.transform?.x ?? null;
        }
        if (entityKey.startsWith('world:')) {
            return this.worldEntities.get(entityKey)?.x ?? null;
        }
        return null;
    }

    _getEntityY(entityKey) {
        if (typeof entityKey !== 'string') return null;
        if (entityKey.startsWith('player:')) {
            const sid = entityKey.slice('player:'.length);
            return this.players.get(sid)?.transform?.y ?? null;
        }
        if (entityKey.startsWith('world:')) {
            return this.worldEntities.get(entityKey)?.y ?? null;
        }
        return null;
    }

    _getEntityLevelId(entityKey) {
        if (typeof entityKey !== 'string') return null;
        if (entityKey.startsWith('player:')) {
            const sid = entityKey.slice('player:'.length);
            return this.players.get(sid)?.transform?.levelId ?? null;
        }
        if (entityKey.startsWith('world:')) {
            return this.worldEntities.get(entityKey)?.levelId ?? null;
        }
        return null;
    }

    _setEntityResources(entityKey, resources) {
        if (!resources || typeof entityKey !== 'string') return;
        if (entityKey.startsWith('player:')) {
            const sid = entityKey.slice('player:'.length);
            this._updatePlayer(sid, (player) => ({ ...player, resources }));
            return;
        }
        if (entityKey.startsWith('world:')) {
            this._updateWorldEntity(entityKey, (world) => ({ ...world, resources }));
        }
    }

    _canEntityPayCosts(entityKey, costs) {
        const resources = this._getEntityResources(entityKey);
        if (!resources) return false;
        return canPayResourceCosts(resources, costs);
    }

    _payEntityCosts(entityKey, costs, nowMs = Date.now()) {
        const resources = this._getEntityResources(entityKey);
        if (!resources) return false;
        const nextResources = payResourceCosts(resources, costs, nowMs);
        if (nextResources === resources) return false;
        this._setEntityResources(entityKey, nextResources);
        return true;
    }

    _drainEntityResourcePool(resources, kind, amount, nowMs = Date.now()) {
        if (!resources) return resources;
        const current = resources?.[kind]?.current ?? 0;
        if (!Number.isFinite(amount) || amount <= 0 || current <= 0) return resources;
        return payResourceCosts(resources, {
            stamina: kind === RESOURCE_KINDS.stamina ? amount : 0,
            mana: kind === RESOURCE_KINDS.mana ? amount : 0,
        }, nowMs);
    }

    _defaultTeamForKind(kind) {
        const archetype = resolveArchetypeConfig(kind);
        return archetype?.teamId ?? TEAM_NEUTRAL;
    }

    _defaultHitRadiusForKind(kind) {
        const archetype = resolveArchetypeConfig(kind);
        return Number.isFinite(archetype?.hitRadius) ? archetype.hitRadius : PLAYER_RADIUS;
    }

    _defaultResourcesForKind(kind) {
        return createEntityResources(kind);
    }

    _inferWorldKindFromEntityKey(entityKey) {
        if (typeof entityKey !== 'string' || !entityKey.startsWith('world:')) return null;
        const spawnKey = `spawn:${entityKey.slice('world:'.length)}`;
        const definition = getWorldSpawnDefinition(spawnKey);
        if (definition?.kind) return definition.kind;
        return null;
    }

    _getPlayerTeamId(sessionId) {
        const player = this.players.get(sessionId);
        return player?.teamId ?? TEAM_PLAYERS;
    }

    _resolveSightRadiusForPlayer(sessionId) {
        const player = this.players.get(sessionId);
        if (!player) return ARCHETYPE_CONFIG.player.sightRadius;

        const controlledEntityKey = player.controlledEntityKey ?? `player:${sessionId}`;
        if (controlledEntityKey.startsWith('world:')) {
            const controlled = this.worldEntities.get(controlledEntityKey);
            const archetype = resolveArchetypeConfig(controlled?.kind ?? null);
            if (Number.isFinite(archetype?.sightRadius)) {
                return archetype.sightRadius;
            }
        }

        return ARCHETYPE_CONFIG.player.sightRadius;
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
                hp: player?.resources?.hp?.current ?? null,
                hpMax: player?.resources?.hp?.max ?? null,
                controllerSessionId: sessionId,
            };
        }

        if (entityKey.startsWith('world:')) {
            const entity = this.worldEntities.get(entityKey);
            if (!entity) return null;
            if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return null;
            return {
                entityKey,
                domain: 'world',
                kind: entity.kind ?? null,
                teamId: this._getWorldEntityTeamId(entity),
                levelId: entity.levelId ?? null,
                x: entity.x,
                y: entity.y,
                hitRadius: this._getWorldEntityHitRadius(entity),
                hp: entity?.resources?.hp?.current ?? null,
                hpMax: entity?.resources?.hp?.max ?? null,
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
            hp: player?.resources?.hp?.current ?? null,
            hpMax: player?.resources?.hp?.max ?? null,
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
            hitRadius: Number.isFinite(entry.hitRadius) ? entry.hitRadius : this._getWorldEntityHitRadius(entry),
            controllerSessionId: entry.controllerSessionId ?? null,
            possessionMsRemaining: Number.isFinite(entry.possessionEndAtMs)
                ? Math.max(0, entry.possessionEndAtMs - nowMs)
                : null,
            decayMsRemaining: Number.isFinite(entry.decay?.expiresAtMs)
                ? Math.max(0, entry.decay.expiresAtMs - nowMs)
                : null,
            identity: entry.identity ? {
                originalEntityKey: entry.identity.originalEntityKey ?? null,
                originalKind: entry.identity.originalKind ?? null,
                displayName: entry.identity.displayName ?? null,
                teamIdAtDeath: entry.identity.teamIdAtDeath ?? null,
                statsSnapshot: entry.identity.statsSnapshot ?? null,
                loadoutSnapshot: entry.identity.loadoutSnapshot ?? null,
                diedAtMs: entry.identity.diedAtMs ?? null,
                killerEntityKey: entry.identity.killerEntityKey ?? null,
            } : null,
            resources: summarizeResources(entry.resources),
            dragState: this._serializeDragStateForWorldEntity(entry.entityKey),
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
