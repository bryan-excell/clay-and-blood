import Phaser from 'phaser';
import { EntityManager } from '../entities/EntityManager.js';
import { EntityLevelManager } from '../world/EntityLevelManager.js';
import { ExitManager } from '../world/ExitManager.js';
import { LightingRenderer } from '../world/LightingRenderer.js';
import { InputIntentSystem } from '../world/InputIntentSystem.js';
import { LocomotionSystem } from '../world/LocomotionSystem.js';
import { DashSystem } from '../world/DashSystem.js';
import { CombatSystem } from '../world/CombatSystem.js';
import { AuthoritySystem } from '../world/AuthoritySystem.js';
import { UiProjectionSystem } from '../world/UiProjectionSystem.js';
import { gameState } from '../core/GameState.js';
import { actionManager } from '../core/ActionManager.js';
import { eventBus } from '../core/EventBus.js';
import { networkManager } from '../core/NetworkManager.js';
import { NetworkUiAdapter } from '../core/NetworkUiAdapter.js';
import { PLAYER_RADIUS, TILE_SIZE } from '../config.js';
import { getLevelDisplayName } from '../world/StageDefinitions.js';
import {
    getExitDestination,
    dashStateFromInput,
    stepPlayerKinematics,
} from '@clay-and-blood/shared';

// ── Reconciliation helpers (mirror GameRoom._runTick logic exactly) ───────────

const REMOTE_INTERPOLATION_DELAY_MS = 100;
const REMOTE_INTERPOLATION_DELAY_TICKS = 2; // 2 * 50 ms = 100 ms
const REMOTE_MAX_EXTRAPOLATION_TICKS = 2;   // cap extrapolation to 100 ms
const REMOTE_SNAPSHOT_BUFFER_SIZE = 40;
const SERVER_TICK_MS = 50;
const LOCAL_RECONCILE_DEADZONE_PX = 1.5;
const LOCAL_RECONCILE_NUDGE_RATIO = 0.35;
const LOCAL_RECONCILE_MAX_NUDGE_PX = 6;
const LOCAL_RECONCILE_HARD_SNAP_PX = 96;

// Fixed-step ECS order contract (see docs/ecs-architecture.md)
const PHASE_INPUT_COMPONENTS = ['input', 'keyboard'];
const PHASE_PHYSICS = ['bullet', 'physics'];
const PHASE_TRANSFORM_SYNC = ['transform'];
const PHASE_VISUAL_SYNC = ['phaserObject', 'circle', 'rectangle'];
const PHASE_PRESENTATION = ['playerStateMachine', 'playerCombat', 'visibility'];
const DEBUG_WORLD_SYNC = import.meta?.env?.VITE_DEBUG_WORLD_SYNC === '1';

/**
 * Main game scene, updated for entity-based levels
 */
export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    create() {
        // Initialize managers
        this.entityManager = new EntityManager(this);
        this.levelManager = new EntityLevelManager(this);
        this.levelManager.initialize();
        this.exitManager = new ExitManager(this);
        this._worldEntityStateCache = new Map(); // entityKey -> { x, y, levelId, controllerSessionId, possessionMsRemaining }
        this._replicationTracks = new Map(); // trackKey -> { stageId, snapshots: [{timeMs,tick,x,y,stageId}] }

        // Track time for fixed updates
        this.lastUpdateTime = Date.now();
        this.fixedTimeStep = 16.67; // ~60 updates per second
        this.accumulator = 0;

        // Camera zoom
        this.defaultZoom = 1;
        this.targetZoom = 1;
        this.input.on('wheel', (_pointer, _objs, _dx, deltaY) => {
            const factor = deltaY > 0 ? 0.9 : 1.1;
            this.targetZoom = Phaser.Math.Clamp(this.targetZoom * factor, 0.15, 5);
        });
        this.input.on('pointerdown', (pointer) => {
            if (pointer.middleButtonDown()) {
                this.targetZoom = this.defaultZoom;
            }
        });

        // Always start in the town square on fresh load
        const initialLevelId = 'town-square';
        const initialLevel = this.levelManager.setupLevel(initialLevelId);

        // Create player at a safe spot
        this.createPlayerInLevel(initialLevel);
        this.controlledEntity = this.player;
        this.scene.launch('UIScene');
        this.networkUiAdapter = new NetworkUiAdapter();
        this.networkUiAdapter.start();
        this.uiProjectionSystem = new UiProjectionSystem(this);
        this.uiProjectionSystem.start();

        // Increase overlap bias to prevent corner-seam slipping between wall tiles
        this.physics.world.OVERLAP_BIAS = 16;

        // Set up collisions
        this.setupCollisions();

        // Lighting / fog-of-war — must come after player creation so we have the entity id
        this.lightingRenderer = new LightingRenderer(this, this.player.id);
        this.lightingRenderer.onLevelChanged(initialLevel);

        // Camera bounds are set per-level by EntityLevelManager.setupLevel()

        // --- Multiplayer ---
        // Map of remote sessionId -> Phaser.GameObjects.Arc (circle)
        this.remotePlayers = new Map();

        // --- Networking state ---
        // Latest server tick seen by this client, used for tick-based interpolation.
        this._latestServerTick = 0;
        this._latestServerTickAtMs = 0;
        // Local dash state for deterministic client prediction.
        this._localDashState = { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 };
        this._lastWorldEntitySyncAt = 0;
        this._possessionEndAtMs = 0;
        this._possessionDurationMs = 8000;
        this._possessionBarGfx = this.add.graphics().setDepth(240);

        this._setupNetworkListeners();
        networkManager.connect();

        // --- Exit proximity label ---
        this._exitLabel = this.add.text(0, 0, '', {
            fontSize: '18px',
            fontFamily: 'Georgia, serif',
            color: '#c8e8ff',
            stroke: '#0a1a2a',
            strokeThickness: 5,
            alpha: 0,
        }).setOrigin(0.5, 1).setDepth(100);
        this._exitLabelAlpha = 0; // current rendered alpha
        this.uiProjectionSystem.publishImmediate();

        this.events.once('shutdown', () => {
            this.uiProjectionSystem?.stop();
            this.networkUiAdapter?.stop();
            this._possessionBarGfx?.destroy();
            this._possessionBarGfx = null;
        });
    }

    /**
     * Create a player in a safe location in the given level
     * @param {object} level - The level to create player in
     */
    createPlayerInLevel(level) {
        // Find a safe spot (floor tile not near exits or walls)
        const safePosition = this.findSafePlayerPosition(level);
        
        // Create the player entity
        this.player = this.entityFactory.createFromPrefab('player', {
            x: safePosition.x,
            y: safePosition.y
        });
        
        console.log(`Player created at position (${safePosition.x}, ${safePosition.y})`);
    }

    /**
     * Find a safe position for the player in the level
     * @param {object} level - The level to find a position in
     * @returns {object} Safe position {x, y}
     */
    findSafePlayerPosition(level) {
        // Use the stage's declared spawn point if available; otherwise fall back
        // to the grid centre (procedural levels always carve a centre room).
        const tileX = level.spawnPoint?.x ?? Math.floor(level.grid[0].length / 2);
        const tileY = level.spawnPoint?.y ?? Math.floor(level.grid.length / 2);
        return {
            x: tileX * TILE_SIZE + TILE_SIZE / 2,
            y: tileY * TILE_SIZE + TILE_SIZE / 2,
        };
    }

    _spawnPracticeEntitiesForLevel(levelId) {
        if (levelId !== 'town-square') return;
        if (this.entityManager.getEntitiesByType('golem').length > 0) return;

        const level = this.levelManager.currentLevel || this.levelManager.getLevel(levelId);
        if (!level?.grid) return;

        const cached = this._worldEntityStateCache?.get('world:golem');
        if (DEBUG_WORLD_SYNC) {
            console.log('[WorldSync] spawnPractice: cache lookup world:golem', {
                levelId,
                cached: cached ?? null,
            });
        }
        let x;
        let y;
        if (
            cached &&
            cached.levelId === levelId &&
            Number.isFinite(cached.x) &&
            Number.isFinite(cached.y)
        ) {
            x = cached.x;
            y = cached.y;
        } else {
            const tile = this._findNearestWalkableTile(level.grid, 24, 20, 10);
            x = tile.x * TILE_SIZE + TILE_SIZE / 2;
            y = tile.y * TILE_SIZE + TILE_SIZE / 2;
        }

        const golem = this.entityFactory.createFromPrefab('golem', {
            x,
            y,
            controlMode: 'remote',
        });
        if (DEBUG_WORLD_SYNC) {
            console.log('[WorldSync] spawnPractice: created golem entity', {
                levelId,
                entityId: golem?.id ?? null,
                x,
                y,
            });
        }

        const circle = golem?.getComponent('circle');
        if (circle?.gameObject) {
            this.lightingRenderer?.maskGameObject(circle.gameObject);
        }
    }

    getLocallyControlledEntity() {
        const localEntity = this.entityManager.getEntitiesWithComponent('control')
            .find(e => e.getComponent('control')?.controlMode === 'local');
        return localEntity ?? this.player;
    }

    setLocallyControlledEntity(nextEntity, reason = 'control:switch') {
        if (!nextEntity) return false;
        const nextControl = nextEntity.getComponent('control');
        if (!nextControl) return false;
        if (!AuthoritySystem.canSimulateOnClient(nextEntity)) return false;

        const requestedControllerId = networkManager.sessionId ?? 'local';
        const currentLocal = this.entityManager.getEntitiesWithComponent('control')
            .find(e => e.getComponent('control')?.controlMode === 'local');
        const alreadyLocalTarget = currentLocal?.id === nextEntity.id &&
            nextControl.controlMode === 'local' &&
            nextControl.controllerId === requestedControllerId;

        if (!alreadyLocalTarget && currentLocal) {
            const currentControl = currentLocal.getComponent('control');
            currentControl?.setControl('remote', currentControl.controllerId, reason);
            // Keep non-controlled entities visible only when they are in the
            // currently rendered level. Do not hide the player just because
            // control switched away from it.
            if (currentLocal.id !== nextEntity.id) {
                const currentLevelId = currentLocal.getComponent('transform')?.levelId ?? gameState.currentLevelId;
                this._setEntityVisibility(currentLocal, currentLevelId === gameState.currentLevelId);
            }
        }

        if (!alreadyLocalTarget) {
            nextControl.setControl('local', requestedControllerId, reason);
        }
        this._setEntityVisibility(nextEntity, true);

        this.controlledEntity = nextEntity;

        const circle = nextEntity.getComponent('circle');
        if (circle?.gameObject) {
            this.cameras.main.startFollow(circle.gameObject);
        }

        this.lightingRenderer?.setPrimaryLightSource(nextEntity.id);
        this._localDashState = { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 };
        this._syncReleasePossessionSpell(nextEntity);
        this.uiProjectionSystem?.publishImmediate();
        return true;
    }

    _setEntityVisibility(entity, isVisible) {
        const circle = entity?.getComponent('circle');
        if (circle?.gameObject) {
            circle.gameObject.setVisible(!!isVisible);
        }
    }

    tryPossessAtWorldPoint(casterEntity, worldX, worldY) {
        const candidates = this.entityManager.getEntitiesWithComponent('control')
            .filter(e => e.id !== casterEntity?.id);

        let best = null;
        let bestDistSq = Infinity;

        for (const entity of candidates) {
            const circle = entity.getComponent('circle');
            const go = circle?.gameObject;
            if (!go || !go.visible) continue;

            const radius = circle?.radius ?? PLAYER_RADIUS;
            const dx = worldX - go.x;
            const dy = worldY - go.y;
            const distSq = dx * dx + dy * dy;
            if (distSq <= radius * radius && distSq < bestDistSq) {
                best = entity;
                bestDistSq = distSq;
            }
        }

        if (!best) return false;

        const key = this._getNetworkEntityKey(best);
        const transform = best.getComponent('transform');
        const targetX = transform?.position?.x ?? worldX;
        const targetY = transform?.position?.y ?? worldY;
        if (!key || !key.startsWith('world:')) return false;

        networkManager.sendPossessRequest(
            key,
            targetX,
            targetY,
            gameState.currentLevelId ?? null
        );
        return true;
    }

    requestReleasePossession(casterEntity) {
        const controlled = this.getLocallyControlledEntity();
        if (!controlled || controlled.id !== casterEntity?.id) return false;
        if (controlled.id === this.player?.id) return false;
        const key = this._getNetworkEntityKey(controlled);
        if (!key || !key.startsWith('world:')) return false;
        networkManager.sendPossessRelease(key);
        return true;
    }

    _findNearestWalkableTile(grid, startX, startY, maxRadius = 8) {
        const h = grid.length;
        const w = grid[0]?.length ?? 0;
        const inBounds = (x, y) => x >= 0 && x < w && y >= 0 && y < h;

        if (inBounds(startX, startY) && grid[startY][startX] === 0) {
            return { x: startX, y: startY };
        }

        for (let r = 1; r <= maxRadius; r++) {
            for (let y = startY - r; y <= startY + r; y++) {
                for (let x = startX - r; x <= startX + r; x++) {
                    if (!inBounds(x, y) || grid[y][x] !== 0) continue;
                    return { x, y };
                }
            }
        }

        const fallbackX = Math.max(1, Math.min(w - 2, startX));
        const fallbackY = Math.max(1, Math.min(h - 2, startY));
        return { x: fallbackX, y: fallbackY };
    }

    // -----------------------------------------------------------------------
    // Multiplayer
    // -----------------------------------------------------------------------

    _setupNetworkListeners() {
        // Snapshot of players already in the room when we join
        eventBus.on('network:gameState', ({ players }) => {
            for (const p of players) {
                this._addRemotePlayer(p.sessionId, p.x, p.y, p.stageId || 'town-square');
            }
        });

        // Another player connected after us – assume same starting area
        eventBus.on('network:playerJoined', ({ sessionId }) => {
            this._addRemotePlayer(sessionId, 0, 0, 'town-square');
        });

        // Authoritative state snapshot from the server physics tick
        eventBus.on('network:stateSnapshot', ({ players, tick, worldEntities, entityEquips }) => {
            if (Number.isFinite(tick)) {
                if (tick > this._latestServerTick) {
                    this._latestServerTick = tick;
                    this._latestServerTickAtMs = performance.now();
                } else if (tick === this._latestServerTick && this._latestServerTickAtMs <= 0) {
                    this._latestServerTickAtMs = performance.now();
                }
            }
            for (const p of players) {
                if (p.sessionId === networkManager.sessionId) {
                    // During possession the server co-locates the player body with
                    // the controlled entity (Phase 1A/B) for level-tracking, but the
                    // player entity is dormant and must not be visually dragged along.
                    // Only reconcile when the player is actually locally controlled.
                    const isControllingPlayer = this.getLocallyControlledEntity()?.id === this.player?.id;
                    if (isControllingPlayer) {
                        this._applyServerCorrection(p.x, p.y);
                    }
                } else {
                    this._pushRemoteSnapshot(
                        p.sessionId,
                        p.x,
                        p.y,
                        p.levelId || 'town-square',
                        tick
                    );
                }
            }
            // Tick snapshots are continuous replication updates, not a hard resync.
            // Preserve interpolation buffers across ticks.
            this._applyNetworkWorldState(worldEntities, 'all', null, tick, 'stream');
            this._applyNetworkEntityEquips(entityEquips);
        });

        eventBus.on('network:worldState', ({ entities, scope, levelId }) => {
            if (DEBUG_WORLD_SYNC) {
                const golem = Array.isArray(entities)
                    ? entities.find((e) => e?.entityKey === 'world:golem')
                    : null;
                console.log('[WorldSync] network:worldState', {
                    scope,
                    levelId,
                    count: Array.isArray(entities) ? entities.length : 0,
                    golem: golem ?? null,
                    currentLevel: gameState.currentLevelId,
                });
            }
            // WORLD_STATE is a scoped authoritative refresh and can invalidate stale buffers.
            this._applyNetworkWorldState(entities, scope, levelId, null, 'resync');
        });

        eventBus.on('network:entityState', ({ sessionId, entityKey, kind, x, y, levelId, controllerSessionId, possessionMsRemaining }) => {
            if (sessionId === networkManager.sessionId) return;
            this._applyNetworkWorldEntityState({ entityKey, kind, x, y, levelId, controllerSessionId, possessionMsRemaining, tick: null });
        });

        eventBus.on('network:forceControl', ({ controlledEntityKey, possessionMsRemaining, levelId, x, y }) => {
            if (!controlledEntityKey) return;
            const target = this._resolveEntityByNetworkKey(controlledEntityKey);
            if (!target) return;

            if (target.id === this.player?.id) {
                // Possession ended — returning control to the player body.
                this._possessionEndAtMs = 0;

                // Reposition the player entity at the server-authoritative location.
                // The server co-locates the player body with the possessed entity
                // (Phase 1A/B), so these coordinates are wherever the entity was
                // standing when possession expired or was released.
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    const transform = target.getComponent('transform');
                    if (transform) {
                        transform.position.x = x;
                        transform.position.y = y;
                    }
                    const circle = target.getComponent('circle');
                    if (circle?.gameObject) circle.gameObject.setPosition(x, y);
                }

                // If the entity finished possession in a different level than the one
                // we are currently rendering, transition there now.
                // setupLevel is safe here: the golem is no longer locally controlled
                // (possession ended before this message arrived) so Phase 2 will NOT
                // preserve it, and it will be cleanly destroyed and re-spawned as a
                // remote entity the next time it appears in the current level.
                if (levelId && levelId !== gameState.currentLevelId) {
                    this.levelManager.setupLevel(levelId);
                }
            } else if (Number.isFinite(possessionMsRemaining) && possessionMsRemaining > 0) {
                this._possessionDurationMs = Math.max(this._possessionDurationMs, possessionMsRemaining);
                this._possessionEndAtMs = performance.now() + possessionMsRemaining;
            }

            this.setLocallyControlledEntity(target, 'network:forceControl');
        });

        eventBus.on('network:entityControl', ({ entityKey, controllerSessionId, possessionMsRemaining }) => {
            if (!entityKey?.startsWith('world:')) return;
            const entityId = entityKey.slice('world:'.length);
            const entity = this.entityManager.getEntityById(entityId);
            const control = entity?.getComponent('control');
            const loadout = entity?.getComponent('loadout');
            if (!control) return;

            const isMine = controllerSessionId === (networkManager.sessionId ?? null);
            const wasLocal = control.controlMode === 'local';
            control.setControlMode(isMine ? 'local' : 'remote', 'network:entityControl');
            control.setController(controllerSessionId ?? null, 'network:entityControl');
            if (!wasLocal && isMine) {
                // Possession started: local prediction now owns this visual.
                this._clearReplicationTrack(entityKey);
            } else if (wasLocal && !isMine) {
                // Possession ended: reset buffer so stale local samples cannot leak.
                const transform = entity.getComponent('transform');
                const seedX = transform?.position?.x;
                const seedY = transform?.position?.y;
                const seedLevelId = transform?.levelId ?? gameState.currentLevelId ?? null;
                if (Number.isFinite(seedX) && Number.isFinite(seedY)) {
                    this._seedReplicationTrack(entityKey, seedX, seedY, seedLevelId, this._latestServerTick);
                } else {
                    this._clearReplicationTrack(entityKey);
                }
            }
            if (controllerSessionId) {
                loadout?.addTemporarySpell('release_possession');
            } else {
                loadout?.removeTemporarySpell('release_possession');
            }
            if (isMine && Number.isFinite(possessionMsRemaining) && possessionMsRemaining > 0) {
                this._possessionDurationMs = Math.max(this._possessionDurationMs, possessionMsRemaining);
                this._possessionEndAtMs = performance.now() + possessionMsRemaining;
            } else if (!isMine && entity.id === this.getLocallyControlledEntity()?.id) {
                this._possessionEndAtMs = 0;
            }
        });

        eventBus.on('network:entityEquip', ({ entityKey, levelId, equipped }) => {
            this._applyNetworkEntityEquip({ entityKey, levelId, equipped });
        });

        // A remote player changed stage – update visibility
        eventBus.on('network:levelChanged', ({ sessionId, levelId }) => {
            const rp = this.remotePlayers.get(sessionId);
            if (rp) {
                rp.stageId = levelId;
                rp.circle.setVisible(levelId === gameState.currentLevelId);
            }
        });

        // Local player changed stage – refresh remote visibilities
        // (sendLevelChange is now called by ExitManager with the final position)
        eventBus.on('level:transition', ({ levelId }) => {
            for (const rp of this.remotePlayers.values()) {
                rp.circle.setVisible(rp.stageId === levelId);
            }
            this._localDashState = { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 };
        });

        eventBus.on('player:dashStarted', ({ input }) => {
            const dash = dashStateFromInput(input);
            if (dash) {
                this._localDashState = {
                    dashVx: dash.dashVx,
                    dashVy: dash.dashVy,
                    dashTimeLeftMs: dash.dashTimeLeftMs,
                };
            }
        });
        // A remote player fired a bullet – spawn it locally if in the same level
        eventBus.on('network:bulletFired', ({ x, y, velocityX, velocityY, levelId }) => {
            if (levelId === gameState.currentLevelId) {
                const bulletEntity = this.entityFactory.createFromPrefab('bullet', { x, y, velocityX, velocityY });
                const bulletGO = bulletEntity.getComponent('circle')?.gameObject;
                this.lightingRenderer?.maskGameObject(bulletGO);
            }
        });

        // Server confirmed a hit via lag-compensated detection
        eventBus.on('network:playerDamaged', ({ sessionId, damage, hp, died }) => {
            // Find world position of the damaged player
            let worldX, worldY;
            if (sessionId === networkManager.sessionId) {
                // Local player
                const circle = this.player?.getComponent('circle');
                worldX = circle?.gameObject?.x ?? 0;
                worldY = circle?.gameObject?.y ?? 0;
                const localStats = this.player?.getComponent('stats');
                if (localStats) localStats.setHp(hp);
            } else {
                const rp = this.remotePlayers.get(sessionId);
                worldX = rp?.circle?.x ?? 0;
                worldY = rp?.circle?.y ?? 0;
            }

            this.uiProjectionSystem?.publishImmediate();
            this._spawnDamageFloat(worldX, worldY, damage, died);
        });

        // Inventory drawer equip actions — UIScene emits these, we route them to the
        // controlled entity's LoadoutComponent so the ECS stays as the source of truth.
        eventBus.on('ui:equipWeapon', ({ id }) => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.equipWeapon(id);
        });
        eventBus.on('ui:equipSpell', ({ id }) => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.equipSpell(id);
        });
        eventBus.on('ui:equipArmor', ({ id }) => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.equipArmor(id);
        });
        eventBus.on('ui:equipAccessory', ({ id }) => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.equipAccessory(id);
        });

        // Replicate any equip change for the controlled entity to the server.
        // For now we replicate only the primary local player's loadout to the server.
        // Possessed entities (e.g. golem) keep local entity-specific loadout state.
        eventBus.on('loadout:changed', ({ entityId, equipped }) => {
            const entity = this.entityManager.getEntityById(entityId);
            if (!entity) return;

            const transform = entity.getComponent('transform');
            const levelId = transform?.levelId ?? gameState.currentLevelId ?? null;
            const entityKey = this._getNetworkEntityKey(entity);
            if (!entityKey) return;
            networkManager.sendEquip(entityKey, equipped, levelId);
        });

        // A remote player disconnected
        eventBus.on('network:playerLeft', ({ sessionId }) => {
            const rp = this.remotePlayers.get(sessionId);
            if (rp) {
                rp.circle.destroy();
                this.remotePlayers.delete(sessionId);
                this._clearReplicationTrack(this._remotePlayerTrackKey(sessionId));
                console.log(`[Network] Remote player left: ${sessionId}`);
            }
        });

        eventBus.on('network:disconnected', () => {
            if (DEBUG_WORLD_SYNC) {
                console.log('[WorldSync] network:disconnected -> clearing cache', {
                    cacheKeys: Array.from(this._worldEntityStateCache.keys()),
                });
            }
            this._worldEntityStateCache.clear();
            this._replicationTracks.clear();
        });

        eventBus.on('network:connected', () => {
            if (DEBUG_WORLD_SYNC) {
                console.log('[WorldSync] network:connected -> clearing cache', {
                    cacheKeys: Array.from(this._worldEntityStateCache.keys()),
                });
            }
            this._worldEntityStateCache.clear();
            this._replicationTracks.clear();
        });
    }

    _getNetworkEntityKey(entity) {
        if (!entity?.id) return null;
        if (entity.id === this.player?.id) {
            return `player:${networkManager.sessionId ?? 'local'}`;
        }
        return `world:${entity.id}`;
    }

    _resolveEntityByNetworkKey(entityKey) {
        if (typeof entityKey !== 'string') return null;
        if (entityKey.startsWith('player:')) {
            const sid = entityKey.slice('player:'.length);
            if (sid !== (networkManager.sessionId ?? '')) return null;
            return this.player ?? null;
        }
        if (entityKey.startsWith('world:')) {
            const entityId = entityKey.slice('world:'.length);
            return this.entityManager.getEntityById(entityId) ?? null;
        }
        return null;
    }

    _resolveWorldPrefabName(entityKey, kind = null) {
        if (kind === 'golem') return 'golem';
        if (kind === 'bandit') return 'bandit';
        if (entityKey === 'world:golem') return 'golem';
        return null;
    }

    _isReplicatedWorldActor(entity) {
        if (!entity) return false;
        return entity.type === 'golem' || entity.type === 'bandit';
    }

    _applyNetworkEntityEquips(entityEquips) {
        if (!Array.isArray(entityEquips) || entityEquips.length === 0) return;
        for (const payload of entityEquips) {
            this._applyNetworkEntityEquip(payload);
        }
    }

    _applyNetworkEntityEquip({ entityKey, levelId, equipped }) {
        if (!entityKey || !equipped) return;
        if (levelId && levelId !== gameState.currentLevelId) return;

        if (typeof entityKey !== 'string') return;
        if (entityKey.startsWith('world:')) {
            const entityId = entityKey.slice('world:'.length);
            const entity = this.entityManager.getEntityById(entityId);
            const loadout = entity?.getComponent('loadout');
            if (loadout) {
                loadout.applyNetworkEquipped(equipped);
                this.uiProjectionSystem?.publishImmediate();
            }
            return;
        }

        if (entityKey.startsWith('player:')) {
            const sessionId = entityKey.slice('player:'.length);
            if (sessionId !== (networkManager.sessionId ?? '')) return;
            const loadout = this.player?.getComponent('loadout');
            if (loadout) {
                loadout.applyNetworkEquipped(equipped);
                this.uiProjectionSystem?.publishImmediate();
            }
        }
    }

    _applyNetworkWorldState(entities, scope = 'all', levelId = null, tick = null, updateMode = 'resync') {
        const incomingKeys = new Set(
            Array.isArray(entities)
                ? entities
                    .map((entry) => (typeof entry?.entityKey === 'string' ? entry.entityKey : null))
                    .filter((key) => !!key)
                : []
        );

        if (scope === 'all') {
            const existingWorldEntities = Object.values(this.entityManager.entities)
                .filter((entity) => entity && entity.id !== this.player?.id)
                .filter((entity) => this._isReplicatedWorldActor(entity));
            for (const entity of existingWorldEntities) {
                const entityKey = this._getNetworkEntityKey(entity);
                if (!entityKey || incomingKeys.has(entityKey)) continue;
                if (entity.id === this.getLocallyControlledEntity()?.id) continue;
                this._clearReplicationTrack(entityKey);
                entity.destroy();
            }
        } else if (scope === 'level' && levelId) {
            const existingWorldEntities = Object.values(this.entityManager.entities)
                .filter((entity) => entity && entity.id !== this.player?.id)
                .filter((entity) => this._isReplicatedWorldActor(entity));
            for (const entity of existingWorldEntities) {
                const transformLevelId = entity.getComponent('transform')?.levelId ?? gameState.currentLevelId;
                if (transformLevelId !== levelId) continue;
                const entityKey = this._getNetworkEntityKey(entity);
                if (!entityKey || incomingKeys.has(entityKey)) continue;
                if (entity.id === this.getLocallyControlledEntity()?.id) continue;
                this._clearReplicationTrack(entityKey);
                entity.destroy();
            }
        }

        if (DEBUG_WORLD_SYNC) {
            console.log('[WorldSync] applyWorldState:start', {
                scope,
                levelId,
                incomingCount: Array.isArray(entities) ? entities.length : 0,
                cacheKeysBefore: Array.from(this._worldEntityStateCache.keys()),
            });
        }
        if (scope === 'all') {
            this._worldEntityStateCache.clear();
            if (updateMode === 'resync') {
                this._clearReplicationTracksByPrefix('world:');
            }
        } else if (scope === 'level' && levelId) {
            for (const [key, cached] of this._worldEntityStateCache.entries()) {
                if ((cached?.levelId ?? null) === levelId) {
                    this._worldEntityStateCache.delete(key);
                }
            }
            if (updateMode === 'resync') {
                this._clearReplicationTracksByPrefix('world:', levelId);
            }
        }

        if (!Array.isArray(entities) || entities.length === 0) return;
        for (const entityState of entities) {
            this._applyNetworkWorldEntityState({ ...entityState, tick });
        }
        if (DEBUG_WORLD_SYNC) {
            console.log('[WorldSync] applyWorldState:end', {
                scope,
                levelId,
                cacheKeysAfter: Array.from(this._worldEntityStateCache.keys()),
                golemCache: this._worldEntityStateCache.get('world:golem') ?? null,
            });
        }
    }

    _applyNetworkWorldEntityState({ entityKey, x, y, levelId, kind, controllerSessionId, possessionMsRemaining, tick = null }) {
        if (!entityKey || !entityKey.startsWith('world:')) return;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (DEBUG_WORLD_SYNC && entityKey === 'world:golem') {
            console.log('[WorldSync] applyWorldEntityState:incoming golem', {
                entityKey,
                x,
                y,
                levelId,
                currentLevel: gameState.currentLevelId,
                controllerSessionId: controllerSessionId ?? null,
            });
        }

        this._worldEntityStateCache.set(entityKey, {
            entityKey,
            kind: kind ?? null,
            x,
            y,
            levelId: levelId ?? null,
            controllerSessionId: controllerSessionId ?? null,
            possessionMsRemaining: Number.isFinite(possessionMsRemaining) ? possessionMsRemaining : null,
        });

        const entityId = entityKey.slice('world:'.length);
        let entity = this.entityManager.getEntityById(entityId);
        if (DEBUG_WORLD_SYNC && entityKey === 'world:golem') {
            const hasEntity = !!entity;
            const existingPos = entity?.getComponent('transform')?.position ?? null;
            console.log('[WorldSync] applyWorldEntityState:entity lookup golem', {
                entityId,
                hasEntity,
                existingPos,
            });
        }

        // Spawn if the entity is missing but is now in our current level.
        // Phase 4B: use the correct control mode based on who the server says
        // is controlling it — not always 'remote'.
        const worldPrefab = this._resolveWorldPrefabName(entityKey, kind);
        if (!entity && levelId && levelId === gameState.currentLevelId && worldPrefab) {
            const isMe = controllerSessionId === (networkManager.sessionId ?? null);
            const spawnConfig = worldPrefab === 'golem'
                ? { id: entityId, x, y, controlMode: isMe ? 'local' : 'remote' }
                : { id: entityId, x, y };
            entity = this.entityFactory.createFromPrefab(worldPrefab, spawnConfig);
            const circle = entity?.getComponent('circle');
            if (circle?.gameObject) {
                this.lightingRenderer?.maskGameObject(circle.gameObject);
            }
            if (worldPrefab === 'golem' && isMe && entity) {
                this.setLocallyControlledEntity(entity, 'network:respawn');
                if (Number.isFinite(possessionMsRemaining) && possessionMsRemaining > 0) {
                    this._possessionDurationMs = Math.max(this._possessionDurationMs, possessionMsRemaining);
                    this._possessionEndAtMs = performance.now() + possessionMsRemaining;
                }
            }
        }

        if (!entity) return;

        // Phase 4A: explicitly show/hide based on whether the entity is in the
        // level we are currently rendering. Previously the function silently
        // returned on a level mismatch, leaving the visual frozen at its last
        // position — creating "ghost" entities visible in the wrong level.
        const inThisLevel = !levelId || levelId === gameState.currentLevelId;
        const circle = entity.getComponent('circle');
        if (circle?.gameObject) {
            circle.gameObject.setVisible(inThisLevel);
        }

        if (!inThisLevel) {
            if (DEBUG_WORLD_SYNC && entityKey === 'world:golem') {
                console.log('[WorldSync] applyWorldEntityState:hidden golem (level mismatch)', {
                    entityLevel: levelId,
                    currentLevel: gameState.currentLevelId,
                });
            }
            return;
        }

        const isLocallyControlled = entity.id === this.getLocallyControlledEntity()?.id;
        if (isLocallyControlled && Number.isFinite(possessionMsRemaining) && possessionMsRemaining > 0) {
            this._possessionDurationMs = Math.max(this._possessionDurationMs, possessionMsRemaining);
            this._possessionEndAtMs = performance.now() + possessionMsRemaining;
        }
        if (isLocallyControlled) {
            // Local prediction now drives this entity; drop remote interpolation state.
            this._clearReplicationTrack(entityKey);
            return;
        }

        this._pushReplicationTrack(entityKey, x, y, levelId ?? null, tick);
        if (DEBUG_WORLD_SYNC && entityKey === 'world:golem') {
            console.log('[WorldSync] applyWorldEntityState:applied golem', {
                x,
                y,
                levelId,
            });
        }
    }

    _syncControlledWorldEntityState(nowMs) {
        const controlled = this.getLocallyControlledEntity();
        if (!controlled || controlled.id === this.player?.id) return;
        if (nowMs - this._lastWorldEntitySyncAt < 50) return;
        this._lastWorldEntitySyncAt = nowMs;

        const transform = controlled.getComponent('transform');
        if (!transform) return;
        const entityKey = this._getNetworkEntityKey(controlled);
        if (!entityKey || !entityKey.startsWith('world:')) return;

        networkManager.sendEntityState(
            entityKey,
            transform.position.x,
            transform.position.y,
            gameState.currentLevelId ?? null
        );
    }

    _syncReleasePossessionSpell(controlled = this.getLocallyControlledEntity()) {
        const allWithLoadout = this.entityManager.getEntitiesWithComponent('loadout');
        for (const entity of allWithLoadout) {
            entity.getComponent('loadout')?.removeTemporarySpell('release_possession');
        }

        if (!controlled) return;
        if (controlled.id === this.player?.id) return;
        controlled.getComponent('loadout')?.addTemporarySpell('release_possession');
    }

    _updatePossessionBar() {
        const gfx = this._possessionBarGfx;
        if (!gfx) return;
        gfx.clear();

        const controlled = this.getLocallyControlledEntity();
        if (!controlled || controlled.id === this.player?.id) return;
        if (!Number.isFinite(this._possessionEndAtMs) || this._possessionEndAtMs <= 0) return;

        const now = performance.now();
        const remaining = Math.max(0, this._possessionEndAtMs - now);
        const ratio = this._possessionDurationMs > 0
            ? Phaser.Math.Clamp(remaining / this._possessionDurationMs, 0, 1)
            : 0;
        if (ratio <= 0) return;

        const circle = controlled.getComponent('circle');
        const go = circle?.gameObject;
        if (!go) return;
        const width = 44;
        const height = 6;
        const x = go.x - width / 2;
        const y = go.y + (circle?.radius ?? PLAYER_RADIUS) + 8;

        gfx.fillStyle(0x1a1030, 0.8);
        gfx.fillRect(x - 1, y - 1, width + 2, height + 2);
        gfx.fillStyle(0x9f59ff, 1);
        gfx.fillRect(x, y, Math.round(width * ratio), height);
    }

    _addRemotePlayer(sessionId, x, y, stageId = 'town-square') {
        if (this.remotePlayers.has(sessionId)) return;
        const circle = this.add.circle(x, y, PLAYER_RADIUS, 0x6688cc, 0.9);
        circle.setStrokeStyle(3, 0x223355);
        const isVisible = stageId === gameState.currentLevelId;
        circle.setVisible(isVisible);
        this.lightingRenderer?.maskGameObject(circle);
        this.remotePlayers.set(sessionId, {
            circle,
            stageId,
        });
        this._seedReplicationTrack(this._remotePlayerTrackKey(sessionId), x, y, stageId, null);
        console.log(`[Network] Remote player joined: ${sessionId} in stage ${stageId}`);
    }

    _pushRemoteSnapshot(sessionId, x, y, stageId, tick) {
        let rp = this.remotePlayers.get(sessionId);
        if (!rp) {
            this._addRemotePlayer(sessionId, x, y, stageId);
            rp = this.remotePlayers.get(sessionId);
            if (!rp) return;
        }

        const nowMs = performance.now();
        rp.stageId = stageId;
        rp.circle.setVisible(stageId === gameState.currentLevelId);
        this._pushReplicationTrack(this._remotePlayerTrackKey(sessionId), x, y, stageId, tick, nowMs);
    }

    _sampleSnapshotBuffer(buffer, renderTick, renderTimeMs) {
        const samples = buffer?.snapshots;
        if (!samples || samples.length === 0) return null;
        if (samples.length === 1) return samples[0];

        // Prefer tick-domain interpolation when tick data exists.
        const canUseTicks = Number.isFinite(renderTick) &&
            samples.every(s => Number.isFinite(s.tick));
        if (canUseTicks) {
            if (renderTick <= samples[0].tick) return samples[0];

            const last = samples[samples.length - 1];
            if (renderTick >= last.tick) {
                const prev = samples[samples.length - 2];
                if (!prev || prev.stageId !== last.stageId || last.tick <= prev.tick) return last;

                const dtTicks = last.tick - prev.tick;
                const vxPerTick = (last.x - prev.x) / dtTicks;
                const vyPerTick = (last.y - prev.y) / dtTicks;
                const aheadTicks = Phaser.Math.Clamp(
                    renderTick - last.tick,
                    0,
                    REMOTE_MAX_EXTRAPOLATION_TICKS
                );
                return {
                    x: last.x + vxPerTick * aheadTicks,
                    y: last.y + vyPerTick * aheadTicks,
                    stageId: last.stageId,
                };
            }

            let i = 0;
            while (i < samples.length - 1 && samples[i + 1].tick < renderTick) i++;
            const a = samples[i];
            const b = samples[i + 1];
            if (!b || a.stageId !== b.stageId) return b || a;

            const span = Math.max(1, b.tick - a.tick);
            const t = Phaser.Math.Clamp((renderTick - a.tick) / span, 0, 1);
            return {
                x: Phaser.Math.Linear(a.x, b.x, t),
                y: Phaser.Math.Linear(a.y, b.y, t),
                stageId: b.stageId,
            };
        }

        // Fallback for snapshots without tick numbers: interpolation by local receive time.
        if (renderTimeMs <= samples[0].timeMs) return samples[0];
        const last = samples[samples.length - 1];
        if (renderTimeMs >= last.timeMs) return last;

        let i = 0;
        while (i < samples.length - 1 && samples[i + 1].timeMs < renderTimeMs) i++;
        const a = samples[i];
        const b = samples[i + 1];
        if (!b || a.stageId !== b.stageId) return b || a;

        const span = Math.max(1, b.timeMs - a.timeMs);
        const t = Phaser.Math.Clamp((renderTimeMs - a.timeMs) / span, 0, 1);
        return { x: Phaser.Math.Linear(a.x, b.x, t), y: Phaser.Math.Linear(a.y, b.y, t), stageId: b.stageId };
    }

    _remotePlayerTrackKey(sessionId) {
        return `player:${sessionId}`;
    }

    _seedReplicationTrack(trackKey, x, y, levelId, tick = null, nowMs = performance.now()) {
        if (!trackKey || !Number.isFinite(x) || !Number.isFinite(y)) return;
        const stageId = levelId ?? null;
        this._replicationTracks.set(trackKey, {
            stageId,
            snapshots: [{
                timeMs: nowMs,
                tick: Number.isFinite(tick) ? tick : null,
                x,
                y,
                stageId,
            }],
        });
    }

    _pushReplicationTrack(trackKey, x, y, levelId, tick = null, nowMs = performance.now()) {
        if (!trackKey || !Number.isFinite(x) || !Number.isFinite(y)) return;
        const stageId = levelId ?? null;
        let buffer = this._replicationTracks.get(trackKey);
        if (!buffer) {
            this._seedReplicationTrack(trackKey, x, y, stageId, tick, nowMs);
            return;
        }

        const hasTick = Number.isFinite(tick);
        if (hasTick && buffer.snapshots.length > 0 && !Number.isFinite(buffer.snapshots[0].tick)) {
            buffer.snapshots = [];
        }

        const last = buffer.snapshots[buffer.snapshots.length - 1] ?? null;
        if (last &&
            last.x === x &&
            last.y === y &&
            last.stageId === stageId &&
            ((hasTick && last.tick === tick) || (!hasTick && !Number.isFinite(last.tick)))
        ) {
            buffer.stageId = stageId;
            return;
        }

        buffer.stageId = stageId;
        buffer.snapshots.push({
            timeMs: nowMs,
            tick: hasTick ? tick : null,
            x,
            y,
            stageId,
        });

        if (buffer.snapshots.length > REMOTE_SNAPSHOT_BUFFER_SIZE) {
            buffer.snapshots.splice(0, buffer.snapshots.length - REMOTE_SNAPSHOT_BUFFER_SIZE);
        }
    }

    _sampleReplicationTrack(trackKey, renderTick, renderTimeMs) {
        const buffer = this._replicationTracks.get(trackKey);
        if (!buffer) return null;
        return this._sampleSnapshotBuffer(buffer, renderTick, renderTimeMs);
    }

    _clearReplicationTrack(trackKey) {
        if (!trackKey) return;
        this._replicationTracks.delete(trackKey);
    }

    _clearReplicationTracksByPrefix(prefix, stageId = null) {
        if (!prefix) return;
        for (const [key, buffer] of this._replicationTracks.entries()) {
            if (!key.startsWith(prefix)) continue;
            if (stageId != null && (buffer?.stageId ?? null) !== stageId) continue;
            this._replicationTracks.delete(key);
        }
    }

    /**
     * Server reconciliation (Gambetta Part 2).
     *
     * 1. Discard all pending inputs the server has already processed (seq ≤ serverSeq).
     * 2. Start from the server's authoritative position.
     * 3. Re-simulate every remaining pending input using the same movement math
     *    as the server, producing the best estimate of our current position.
     * 4. Snap the Phaser body to that estimate.
     *
     * This eliminates rubber-banding while keeping client-side prediction.
     */
    _applyServerCorrection(serverX, serverY) {
        if (!this.player) return;
        const circle = this.player.getComponent('circle');
        if (!circle || !circle.gameObject) return;
        const transform = this.player.getComponent('transform');
        // Use authoritative server position directly as the correction target.
        const x = serverX;
        const y = serverY;

        // Reconciliation target minus current local state.
        // Apply bounded micro-corrections to avoid periodic hard teleports.
        const go   = circle.gameObject;
        const body = go.body;
        const currentX = body ? body.x + body.halfWidth : go.x;
        const currentY = body ? body.y + body.halfHeight : go.y;
        const errX = x - currentX;
        const errY = y - currentY;
        const dist = Math.sqrt(errX * errX + errY * errY);
        if (dist < LOCAL_RECONCILE_DEADZONE_PX) {
            return;
        }

        const vx = body ? body.velocity.x : 0;
        const vy = body ? body.velocity.y : 0;
        let targetX = x;
        let targetY = y;

        // Smooth correction for normal drift.
        if (dist < LOCAL_RECONCILE_HARD_SNAP_PX) {
            let stepX = errX * LOCAL_RECONCILE_NUDGE_RATIO;
            let stepY = errY * LOCAL_RECONCILE_NUDGE_RATIO;
            const stepDist = Math.sqrt(stepX * stepX + stepY * stepY);
            if (stepDist > LOCAL_RECONCILE_MAX_NUDGE_PX) {
                const s = LOCAL_RECONCILE_MAX_NUDGE_PX / stepDist;
                stepX *= s;
                stepY *= s;
            }
            targetX = currentX + stepX;
            targetY = currentY + stepY;
        }

        go.x = targetX;
        go.y = targetY;
        if (body) {
            body.x = targetX - body.halfWidth;
            body.y = targetY - body.halfHeight;
            body.prev.x = body.x;
            body.prev.y = body.y;
            body.velocity.set(vx, vy);
        }
        if (transform) {
            transform.position.x = targetX;
            transform.position.y = targetY;
        }
        circle._skipNextPositionUpdate = true;
    }

    setupCollisions() {
        // Player movement/collision is handled manually (deterministic tile solver).
        console.log("Player uses manual movement/collision; skipping Arcade player colliders");
    }

    _simulateLocalPlayerMovement(deltaTime) {
        const controlled = this.getLocallyControlledEntity();
        if (!controlled) return;
        if (!AuthoritySystem.canSimulateOnClient(controlled)) return;

        const transform = controlled.getComponent('transform');
        const circle = controlled.getComponent('circle');
        if (!transform || !circle?.gameObject) return;

        const intent = controlled.getComponent('intent');
        const keyboard = controlled.getComponent('keyboard');

        const levelData = gameState.levels?.[gameState.currentLevelId];
        const grid = levelData?.grid ?? null;
        const input = intent ? {
            up: (intent.moveY ?? 0) < -0.0001,
            down: (intent.moveY ?? 0) > 0.0001,
            left: (intent.moveX ?? 0) < -0.0001,
            right: (intent.moveX ?? 0) > 0.0001,
            sprint: !!intent.wantsSprint,
            dash: !!intent.wantsDash,
        } : (keyboard?.inputState ?? {
            up: false, down: false, left: false, right: false, sprint: false, dash: false
        });

        const stepped = stepPlayerKinematics(
            {
                x: transform.position.x,
                y: transform.position.y,
                dashVx: this._localDashState.dashVx,
                dashVy: this._localDashState.dashVy,
                dashTimeLeftMs: this._localDashState.dashTimeLeftMs,
            },
            input,
            deltaTime,
            grid
        );

        const newX = stepped.x;
        const newY = stepped.y;
        this._localDashState.dashVx = stepped.dashVx;
        this._localDashState.dashVy = stepped.dashVy;
        this._localDashState.dashTimeLeftMs = stepped.dashTimeLeftMs;

        transform.position.x = newX;
        transform.position.y = newY;
        circle.gameObject.setPosition(newX, newY);

        this._checkManualExitOverlap(controlled, newX, newY);
    }

    _checkManualExitOverlap(controlledEntity, entityX, entityY) {
        if (!controlledEntity) return;
        if (!this.exitManager?.canEntityUseExits(controlledEntity)) return;
        const exits = this.entityManager.getEntitiesByType('exit');
        let overlappingExitIndex = null;

        for (const exitEntity of exits) {
            const rect = exitEntity.getComponent('rectangle');
            const exitComp = exitEntity.getComponent('exit');
            if (!rect || !exitComp) continue;
            const ex = rect.gameObject?.x ?? exitEntity.getComponent('transform')?.position.x;
            const ey = rect.gameObject?.y ?? exitEntity.getComponent('transform')?.position.y;
            if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;

            const halfW = rect.width / 2;
            const halfH = rect.height / 2;
            const nearX = Math.max(ex - halfW, Math.min(entityX, ex + halfW));
            const nearY = Math.max(ey - halfH, Math.min(entityY, ey + halfH));
            const dx = entityX - nearX;
            const dy = entityY - nearY;
            if (dx * dx + dy * dy <= PLAYER_RADIUS * PLAYER_RADIUS) {
                overlappingExitIndex = exitComp.exitIndex;
                break;
            }
        }

        this.exitManager.updateDebounceState(
            controlledEntity,
            overlappingExitIndex,
            gameState.currentLevelId
        );

        if (overlappingExitIndex != null) {
            this.exitManager.handleExit(controlledEntity, overlappingExitIndex);
        }
    }

    /**
     * Main update loop - processes variable-time updates
     * @param {number} time - Current time
     * @param {number} delta - Time since last frame
     */
    update(time, delta) {
        // Use fixed timestep for physics and game logic
        this.accumulator += delta;

        while (this.accumulator >= this.fixedTimeStep) {
            this.fixedUpdate(this.fixedTimeStep);
            this.accumulator -= this.fixedTimeStep;
        }

        // Process rendering-specific updates (interpolation)
        this.renderUpdate(delta);
    }

    /**
     * Fixed update - runs at consistent intervals
     * @param {number} deltaTime - Fixed time step in ms
     */
    fixedUpdate(deltaTime) {
        const nowMs = performance.now();
        // Process all actions
        actionManager.processActions();

        // Canonical ECS order (input -> locomotion/dash -> physics -> transform -> visual -> presentation)
        let updated = new Set();
        updated = this.entityManager.updateComponents(deltaTime, PHASE_INPUT_COMPONENTS, updated);
        InputIntentSystem.update(this.entityManager);
        LocomotionSystem.update(this.entityManager);
        DashSystem.update(this.entityManager, deltaTime);
        CombatSystem.update(this.entityManager);

        // Local player deterministic movement/collision.
        this._simulateLocalPlayerMovement(deltaTime);

        updated = this.entityManager.updateComponents(deltaTime, PHASE_PHYSICS, updated);
        updated = this.entityManager.updateComponents(deltaTime, PHASE_TRANSFORM_SYNC, updated);
        updated = this.entityManager.updateComponents(deltaTime, PHASE_VISUAL_SYNC, updated);
        updated = this.entityManager.updateComponents(deltaTime, PHASE_PRESENTATION, updated);
        this.uiProjectionSystem?.update();
        this._syncControlledWorldEntityState(nowMs);

        // Send current input state to the authoritative server.
        // If the message was actually sent (not throttled), buffer it for reconciliation.
        if (this.player) {
            const intent = this.player.getComponent('intent');
            if (intent) {
                networkManager.sendInput({
                    up: (intent.moveY ?? 0) < -0.0001,
                    down: (intent.moveY ?? 0) > 0.0001,
                    left: (intent.moveX ?? 0) < -0.0001,
                    right: (intent.moveX ?? 0) > 0.0001,
                    sprint: !!intent.wantsSprint,
                });
            }
        }
    }

    /**
     * Render update - interpolates remote players toward their last server position.
     * @param {number} delta - ms since last frame
     */
    renderUpdate(delta) {
        // Smooth zoom toward target
        const cam = this.cameras.main;
        const zoomT = 1 - Math.pow(0.01, delta / 150);
        cam.setZoom(Phaser.Math.Linear(cam.zoom, this.targetZoom, zoomT));

        const renderTick = this._latestServerTick > 0
            ? (this._latestServerTick + ((performance.now() - this._latestServerTickAtMs) / SERVER_TICK_MS)) - REMOTE_INTERPOLATION_DELAY_TICKS
            : null;
        const renderTimeMs = performance.now() - REMOTE_INTERPOLATION_DELAY_MS;
        for (const [sessionId, rp] of this.remotePlayers.entries()) {
            if (!rp.circle.visible) continue;
            const sample = this._sampleReplicationTrack(this._remotePlayerTrackKey(sessionId), renderTick, renderTimeMs);
            if (sample) {
                rp.circle.x = sample.x;
                rp.circle.y = sample.y;
            }
        }

        for (const [entityKey] of this._replicationTracks.entries()) {
            if (!entityKey.startsWith('world:')) continue;
            const entityId = entityKey.slice('world:'.length);
            const entity = this.entityManager.getEntityById(entityId);
            if (!entity) {
                this._clearReplicationTrack(entityKey);
                continue;
            }

            const isLocallyControlled = entity.id === this.getLocallyControlledEntity()?.id;
            if (isLocallyControlled) {
                this._clearReplicationTrack(entityKey);
                continue;
            }

            const circle = entity.getComponent('circle');
            const go = circle?.gameObject;
            if (!go || !go.visible) continue;

            const sample = this._sampleReplicationTrack(entityKey, renderTick, renderTimeMs);
            if (!sample) continue;

            go.x = sample.x;
            go.y = sample.y;

            const transform = entity.getComponent('transform');
            if (transform) {
                transform.position.x = sample.x;
                transform.position.y = sample.y;
                transform.levelId = sample.stageId ?? transform.levelId ?? null;
            }
        }

        this._updateExitLabel(delta);
        this._updatePossessionBar();
    }

    /**
     * Spawn a floating damage number at the given world position.
     * @param {number} worldX
     * @param {number} worldY
     * @param {number} damage
     * @param {boolean} [died]
     */
    _spawnDamageFloat(worldX, worldY, damage, died = false) {
        const label = died ? `${damage} 💀` : `-${damage}`;
        const color = died ? '#ff4444' : '#ffdd44';
        const text = this.add.text(worldX, worldY - 20, label, {
            fontSize:        died ? '20px' : '16px',
            fontFamily:      'monospace',
            color,
            stroke:          '#000000',
            strokeThickness: 3,
        }).setOrigin(0.5, 1).setDepth(300);

        this.tweens.add({
            targets:  text,
            y:        worldY - 70,
            alpha:    0,
            duration: 900,
            ease:     'Quad.easeOut',
            onComplete: () => text.destroy(),
        });
    }

    _updateExitLabel(delta) {
        if (!this._exitLabel || !this.player) return;

        const localEntity = this.getLocallyControlledEntity();
        const playerCircle = localEntity?.getComponent('circle');
        if (!playerCircle?.gameObject) return;

        const px = playerCircle.gameObject.x;
        const py = playerCircle.gameObject.y;

        // Find the nearest exit within range
        const PROXIMITY = TILE_SIZE * 2.5; // ~160 px
        let nearest = null;
        let nearestDist = Infinity;

        const exits = this.entityManager.getEntitiesByType('exit');
        for (const exitEntity of exits) {
            const visual = exitEntity.getComponent('rectangle');
            if (!visual?.gameObject) continue;
            const dx = visual.gameObject.x - px;
            const dy = visual.gameObject.y - py;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < PROXIMITY && dist < nearestDist) {
                nearestDist = dist;
                nearest = { exitEntity, worldX: visual.gameObject.x, worldY: visual.gameObject.y };
            }
        }

        const targetAlpha = nearest ? 1 : 0;
        const fadeSpeed = 1 - Math.pow(0.001, delta / 200);
        this._exitLabelAlpha = Phaser.Math.Linear(this._exitLabelAlpha, targetAlpha, fadeSpeed);

        if (this._exitLabelAlpha < 0.01) {
            this._exitLabel.setAlpha(0);
            return;
        }

        if (nearest) {
            // Resolve destination name
            const exitComp = nearest.exitEntity.getComponent('exit');
            const exitIndex = exitComp?.exitIndex ?? 0;
            const currentLevelId = gameState.currentLevelId;
            const currentLevel = gameState.levels[currentLevelId];
            let destLevelId;
            if (currentLevel?.exitConnections?.[exitIndex]) {
                destLevelId = currentLevel.exitConnections[exitIndex].levelId;
            } else {
                destLevelId = getExitDestination(currentLevelId, exitIndex).toLevelId;
            }
            const destName = getLevelDisplayName(destLevelId);
            this._exitLabel.setText(destName);
            this._exitLabel.setPosition(nearest.worldX, nearest.worldY - TILE_SIZE * 0.75);
        }

        this._exitLabel.setAlpha(this._exitLabelAlpha);
    }
}
