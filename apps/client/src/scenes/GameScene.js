import Phaser from 'phaser';
import { EntityManager } from '../entities/EntityManager.js';
import { EntityLevelManager } from '../world/EntityLevelManager.js';
import { ExitManager } from '../world/ExitManager.js';
import { LightingRenderer } from '../world/LightingRenderer.js';
import { VisibilitySystem } from '../world/VisibilitySystem.js';
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
import { uiStateStore } from '../core/UiStateStore.js';
import {
    GAME_FONT_FAMILY,
    PLAYER_RADIUS,
    TILE_SIZE,
} from '../config.js';
import { getLevelDisplayName } from '../world/StageDefinitions.js';
import {
    ARCHETYPE_CONFIG,
    TEAM_IDS,
    getTerrainMovementMultiplierAtWorldPosition,
    getExitDestination,
    getInteractableDefinitionsForLevel,
    dashStateFromInput,
    stepPlayerKinematics,
    resolveMeleeAttackProfile,
    resolveSpellConfig,
    resolveStageSpawnPosition,
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
const PHASE_PRESENTATION = ['playerStateMachine', 'playerCombat', 'visibility', 'decay', 'decayBar'];
const DEBUG_WORLD_SYNC = import.meta?.env?.VITE_DEBUG_WORLD_SYNC === '1';
const DEBUG_GOLEM_KEY = 'world:golem_town_square';
const DAMAGE_TEXT_RISE_PX = 24;
const DAMAGE_TEXT_LIFETIME_MS = 460;
const HOVER_SELECT_PADDING_PX = 14;
const HOVER_SELECT_MIN_RADIUS_PX = 24;
const HOVER_SWITCH_SCORE_MARGIN = 140;
const HOVER_RESOLVE_INTERVAL_MS = 25;
const HOVER_TARGETABLE_ENTITY_TYPES = Object.freeze(['golem', 'zombie', 'corpse']);

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
        this._networkProjectiles = new Map(); // projectileId -> entityId
        this._staggerPulseState = new Map(); // entityKey -> { event, originalColor, originalAlpha }
        this._interactableEntities = new Map(); // interactableId -> entity
        this._renderedInteractableLevelId = null;
        this._nearestInteractable = null;
        this._worldResetFx = null;
        this._pendingWorldResetFxUntilMs = 0;
        this._hoveredEntityTarget = null;
        this._hoverTargetGfx = null;
        this._lastHoverResolveAtMs = 0;

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
        const initialLevelId = 'inn';
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
        this._localTeamId = TEAM_IDS.players;

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
        this._worldResetFlash = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0xf0d8a0, 0)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(260);
        this._syncWorldResetOverlayToViewport();
        this.scale.on('resize', this._syncWorldResetOverlayToViewport, this);

        this._setupNetworkListeners();
        networkManager.connect();

        // --- Exit proximity label ---
        this._exitLabel = this.add.text(0, 0, '', {
            fontSize: '18px',
            fontFamily: GAME_FONT_FAMILY,
            color: '#c8e8ff',
            stroke: '#0a1a2a',
            strokeThickness: 5,
            alpha: 0,
        }).setOrigin(0.5, 1).setDepth(100);
        this._exitLabelAlpha = 0; // current rendered alpha
        this._interactLabel = this.add.text(0, 0, '', {
            fontSize: '18px',
            fontFamily: GAME_FONT_FAMILY,
            color: '#ffd9a3',
            stroke: '#2d1400',
            strokeThickness: 5,
            alpha: 0,
            align: 'center',
        }).setOrigin(0.5, 1).setDepth(110);
        this._interactLabelAlpha = 0;
        this._interactKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
        this._hoverTargetGfx = this.add.graphics().setDepth(214);
        this._refreshInteractablesForCurrentLevel();
        this.uiProjectionSystem.publishImmediate();

        this.events.once('shutdown', () => {
            this.uiProjectionSystem?.stop();
            this.networkUiAdapter?.stop();
            this._possessionBarGfx?.destroy();
            this._possessionBarGfx = null;
            this._interactLabel?.destroy();
            this._interactLabel = null;
            this.scale.off('resize', this._syncWorldResetOverlayToViewport, this);
            this._worldResetFx?.flash?.stop?.();
            this._worldResetFlash?.destroy();
            this._hoverTargetGfx?.destroy();
            this._hoverTargetGfx = null;
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
        const transform = this.player?.getComponent('transform');
        if (transform) {
            transform.levelId = level?.id ?? gameState.currentLevelId ?? 'inn';
        }
        
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
        const resolved = resolveStageSpawnPosition(level?.id ?? gameState.currentLevelId ?? 'inn');
        const tileX = resolved?.tileX ?? level.spawnPoint?.x ?? Math.floor(level.grid[0].length / 2);
        const tileY = resolved?.tileY ?? level.spawnPoint?.y ?? Math.floor(level.grid.length / 2);
        return {
            x: tileX * TILE_SIZE + TILE_SIZE / 2,
            y: tileY * TILE_SIZE + TILE_SIZE / 2,
        };
    }

    _spawnPracticeEntitiesForLevel(levelId) {
        if (levelId !== 'town-square') return;

        const level = this.levelManager.currentLevel || this.levelManager.getLevel(levelId);
        if (!level?.grid) return;

        // ── Golem (possession target) ─────────────────────────────────────────
        if (this.entityManager.getEntitiesByType('golem').length === 0) {
            const cached = this._worldEntityStateCache?.get('world:golem');
            if (DEBUG_WORLD_SYNC) {
                console.log('[WorldSync] spawnPractice: cache lookup world:golem', {
                    levelId,
                    cached: cached ?? null,
                });
            }
            let gx, gy;
            if (
                cached &&
                cached.levelId === levelId &&
                Number.isFinite(cached.x) &&
                Number.isFinite(cached.y)
            ) {
                gx = cached.x;
                gy = cached.y;
            } else {
                const tile = this._findNearestWalkableTile(level.grid, 24, 20, 10);
                gx = tile.x * TILE_SIZE + TILE_SIZE / 2;
                gy = tile.y * TILE_SIZE + TILE_SIZE / 2;
            }

            const golem = this.entityFactory.createFromPrefab('golem', {
                x: gx,
                y: gy,
                controlMode: 'remote',
            });
            if (DEBUG_WORLD_SYNC) {
                console.log('[WorldSync] spawnPractice: created golem entity', {
                    levelId,
                    entityId: golem?.id ?? null,
                    x: gx,
                    y: gy,
                });
            }
            const golemCircle = golem?.getComponent('circle');
            if (golemCircle?.gameObject) {
                this.lightingRenderer?.maskGameObject(golemCircle.gameObject);
            }
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
            // currently rendered level.
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
        if (this.player?.id && nextEntity.id !== this.player.id) {
            this.lightingRenderer?.addLightSource(this.player.id);
        } else if (this.player?.id) {
            this.lightingRenderer?.removeLightSource(this.player.id);
        }
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

    _isPointerInsideUiDrawer(pointer = this.input?.activePointer) {
        if (!pointer || !uiStateStore.get('drawerOpen')) return false;
        return pointer.x < (uiStateStore.get('drawerWidth') ?? 0);
    }

    _resolvePointerWorldPoint(pointer = this.input?.activePointer) {
        if (!pointer || !this.cameras?.main) return null;
        if (this._isPointerInsideUiDrawer(pointer)) return null;
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        if (!Number.isFinite(world?.x) || !Number.isFinite(world?.y)) return null;
        return world;
    }

    _getEquippedSpellIdForHover() {
        const controlled = this.getLocallyControlledEntity?.();
        const loadout = controlled?.getComponent?.('loadout');
        return loadout?.equipped?.spellId ?? 'nothing';
    }

    _isEntityTargetSpellId(spellId) {
        if (spellId === 'possess') return true;
        const spellCfg = resolveSpellConfig(spellId);
        return spellCfg?.castMode === 'target_click';
    }

    _isEntitySelectableForHover(entity) {
        if (!entity || entity === this.getLocallyControlledEntity?.()) return false;
        if (entity.id === this.player?.id) return false;
        if (entity.type === 'exit') return false;
        const transform = entity.getComponent?.('transform');
        const levelId = transform?.levelId ?? gameState.currentLevelId ?? null;
        if (levelId && levelId !== gameState.currentLevelId) return false;
        const circleGo = entity.getComponent?.('circle')?.gameObject;
        const rectGo = entity.getComponent?.('rectangle')?.gameObject;
        if (circleGo && !circleGo.visible) return false;
        if (rectGo && !rectGo.visible) return false;
        return entity.type === 'golem' || entity.type === 'zombie' || entity.type === 'corpse';
    }

    _getHoverTargetShape(entity) {
        const circle = entity?.getComponent?.('circle');
        if (circle?.gameObject && Number.isFinite(circle.radius)) {
            return {
                kind: 'circle',
                x: circle.gameObject.x,
                y: circle.gameObject.y,
                radius: circle.radius,
            };
        }

        const rect = entity?.getComponent?.('rectangle');
        if (rect?.gameObject && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
            return {
                kind: 'rect',
                x: rect.gameObject.x,
                y: rect.gameObject.y,
                width: rect.width,
                height: rect.height,
            };
        }

        const transform = entity?.getComponent?.('transform');
        if (!Number.isFinite(transform?.position?.x) || !Number.isFinite(transform?.position?.y)) return null;
        return {
            kind: 'circle',
            x: transform.position.x,
            y: transform.position.y,
            radius: PLAYER_RADIUS,
        };
    }

    _distanceScoreToHoverShape(shape, worldX, worldY) {
        if (!shape || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        if (shape.kind === 'circle') {
            const dx = worldX - shape.x;
            const dy = worldY - shape.y;
            const distSq = dx * dx + dy * dy;
            const selectRadius = Math.max(HOVER_SELECT_MIN_RADIUS_PX, shape.radius + HOVER_SELECT_PADDING_PX);
            if (distSq > selectRadius * selectRadius) return null;
            return {
                insidePrimary: distSq <= shape.radius * shape.radius,
                score: 1000 - distSq,
            };
        }

        const halfW = shape.width / 2;
        const halfH = shape.height / 2;
        const nearX = Math.max(shape.x - halfW, Math.min(worldX, shape.x + halfW));
        const nearY = Math.max(shape.y - halfH, Math.min(worldY, shape.y + halfH));
        const dx = worldX - nearX;
        const dy = worldY - nearY;
        const distSq = dx * dx + dy * dy;
        const selectRadius = HOVER_SELECT_PADDING_PX;
        if (distSq > selectRadius * selectRadius) return null;
        const insidePrimary = worldX >= shape.x - halfW && worldX <= shape.x + halfW &&
            worldY >= shape.y - halfH && worldY <= shape.y + halfH;
        return {
            insidePrimary,
            score: 1000 - distSq,
        };
    }

    _canSpellTargetHoveredEntity(entity, spellId, entityKey = this._getNetworkEntityKey(entity)) {
        if (!entity || typeof spellId !== 'string') return false;
        if (!entityKey) return false;

        if (spellId === 'possess') {
            return entityKey.startsWith('world:') && entity.hasComponent?.('control');
        }

        if (spellId === 'traction') {
            return entityKey.startsWith('world:') && entity.type === 'corpse';
        }

        if (spellId === 'arc_flash') {
            return entityKey.startsWith('world:') && this._canLocalProjectileHitEntity(this._localTeamId, entity);
        }

        return false;
    }

    _resolveHoveredEntityTarget(pointerWorld = this._resolvePointerWorldPoint()) {
        if (!pointerWorld) return null;

        const spellId = this._getEquippedSpellIdForHover();
        const previousKey = this._hoveredEntityTarget?.entityKey ?? null;
        let best = null;
        let previous = null;

        for (const type of HOVER_TARGETABLE_ENTITY_TYPES) {
            const entities = this.entityManager.getEntitiesByType(type);
            for (const entity of entities) {
                if (!this._isEntitySelectableForHover(entity)) continue;
                const shape = this._getHoverTargetShape(entity);
                const hit = this._distanceScoreToHoverShape(shape, pointerWorld.x, pointerWorld.y);
                if (!hit) continue;

                const entityKey = this._getNetworkEntityKey(entity);
                if (!entityKey) continue;

                let score = hit.score;
                const validForSpell = this._canSpellTargetHoveredEntity(entity, spellId, entityKey);
                if (hit.insidePrimary) score += 180;
                if (validForSpell) score += 220;
                if (entityKey === previousKey) score += 120;

                const candidate = {
                    entity,
                    entityKey,
                    spellId,
                    shape,
                    score,
                    validForSpell,
                };
                if (entityKey === previousKey) previous = candidate;
                if (!best || candidate.score > best.score) best = candidate;
            }
        }

        if (!best) return null;
        if (previous && best.entityKey !== previous.entityKey && previous.score + HOVER_SWITCH_SCORE_MARGIN >= best.score) {
            return previous;
        }
        return best;
    }

    _getHoverHighlightStyle(target) {
        const spellId = target?.spellId ?? this._getEquippedSpellIdForHover();
        const entityTargetSpell = this._isEntityTargetSpellId(spellId);
        if (target?.validForSpell && entityTargetSpell) {
            return { color: 0x9be7ff, alpha: 0.95, width: 3 };
        }
        if (entityTargetSpell) {
            return { color: 0xe8c27a, alpha: 0.75, width: 2 };
        }
        return { color: 0xf4e2b3, alpha: 0.65, width: 2 };
    }

    _renderHoveredEntityTarget(nowMs = performance.now()) {
        const gfx = this._hoverTargetGfx;
        if (!gfx) return;
        gfx.clear();

        const target = this._hoveredEntityTarget;
        if (!target?.entity || !target?.shape) return;

        const style = this._getHoverHighlightStyle(target);
        const pulse = 0.82 + Math.sin(nowMs / 120) * 0.12;
        gfx.lineStyle(style.width, style.color, Math.max(0.1, Math.min(1, style.alpha * pulse)));

        if (target.shape.kind === 'circle') {
            gfx.strokeCircle(target.shape.x, target.shape.y, target.shape.radius + 5);
            return;
        }

        const halfW = target.shape.width / 2 + 4;
        const halfH = target.shape.height / 2 + 4;
        gfx.strokeRoundedRect(
            target.shape.x - halfW,
            target.shape.y - halfH,
            halfW * 2,
            halfH * 2,
            8
        );
    }

    _updateHoveredEntityTarget(nowMs = performance.now()) {
        if (nowMs - this._lastHoverResolveAtMs >= HOVER_RESOLVE_INTERVAL_MS) {
            this._hoveredEntityTarget = this._resolveHoveredEntityTarget();
            this._lastHoverResolveAtMs = nowMs;
        }
        this._renderHoveredEntityTarget();
    }

    getHoveredSpellTarget(spellId = null) {
        const target = this._hoveredEntityTarget;
        if (!target) return null;
        if (spellId && !this._canSpellTargetHoveredEntity(target.entity, spellId, target.entityKey)) {
            return null;
        }
        return target;
    }

    tryPossessAtWorldPoint(casterEntity, worldX, worldY) {
        const hovered = this.getHoveredSpellTarget('possess');
        if (hovered?.entity && hovered.entity !== casterEntity) {
            const transform = hovered.entity.getComponent('transform');
            const targetX = transform?.position?.x ?? worldX;
            const targetY = transform?.position?.y ?? worldY;
            if (hovered.entityKey?.startsWith('world:')) {
                networkManager.sendPossessRequest(
                    hovered.entityKey,
                    targetX,
                    targetY,
                    gameState.currentLevelId ?? null
                );
                return true;
            }
        }

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
                this._addRemotePlayer(
                    p.sessionId,
                    p.x,
                    p.y,
                    p.stageId || 'inn',
                    p.teamId ?? null,
                    p.sightRadius ?? null
                );
            }
        });

        // Another player connected after us – assume same starting area
        eventBus.on('network:playerJoined', ({ sessionId }) => {
            this._addRemotePlayer(sessionId, 0, 0, 'inn');
        });

        // Authoritative state snapshot from the server physics tick
        eventBus.on('network:stateSnapshot', ({ players, tick, self, worldEntities, entityEquips }) => {
            if (typeof self?.teamId === 'string') {
                this._localTeamId = self.teamId;
            }
            if (self?.resources) {
                const controlled = self?.controlledEntityKey
                    ? this._resolveEntityByNetworkKey(self.controlledEntityKey)
                    : this.getLocallyControlledEntity();
                this._applyResourceSummaryToEntity(controlled, self.resources);
            }
            if (self?.inventory) {
                this.player?.getComponent('inventory')?.applySnapshot(self.inventory);
            }
            if (self?.spellbook) {
                this.player?.getComponent('spellbook')?.applySnapshot(self.spellbook);
            }
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
                    const playerTransform = this.player?.getComponent('transform');
                    if (playerTransform) {
                        playerTransform.levelId = p.levelId ?? playerTransform.levelId ?? gameState.currentLevelId;
                    }
                    this._setEntityVisibility(
                        this.player,
                        (playerTransform?.levelId ?? gameState.currentLevelId) === gameState.currentLevelId
                    );
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
                        p.levelId || 'inn',
                        tick,
                        p.teamId ?? null,
                        p.sightRadius ?? null
                    );
                }
            }
            // Tick snapshots are continuous replication updates, not a hard resync.
            // Preserve interpolation buffers across ticks.
            this._applyNetworkWorldState(worldEntities, 'all', null, tick, 'stream');
            if (this._pendingWorldResetFxUntilMs > performance.now()) {
                this._pendingWorldResetFxUntilMs = 0;
                this._playWorldResetShimmer();
            }
            this._applyNetworkEntityEquips(entityEquips);
        });

        eventBus.on('network:worldState', ({ entities, scope, levelId }) => {
            if (DEBUG_WORLD_SYNC) {
                const golem = Array.isArray(entities)
                    ? entities.find((e) => e?.entityKey === DEBUG_GOLEM_KEY)
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
            if (scope === 'all' && this._pendingWorldResetFxUntilMs > performance.now()) {
                this._pendingWorldResetFxUntilMs = 0;
                this._playWorldResetShimmer();
            }
        });

        eventBus.on('network:entityState', ({
            sessionId,
            entityKey,
            kind,
            x,
            y,
            levelId,
            resources,
            controllerSessionId,
            teamId,
            possessionMsRemaining,
            hitRadius,
            decayMsRemaining,
            identity,
        }) => {
            if (sessionId === networkManager.sessionId) return;
            this._applyNetworkWorldEntityState({
                entityKey,
                kind,
                x,
                y,
                levelId,
                resources,
                controllerSessionId,
                teamId,
                possessionMsRemaining,
                hitRadius,
                decayMsRemaining,
                identity,
                tick: null,
            });
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
            this._refreshAllRemotePlayerLightSources();
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
            this._refreshWorldEntityLightSource(entityKey);
            this._refreshAllRemotePlayerLightSources();
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
                this._refreshRemotePlayerLightSource(sessionId);
            }
        });

        // Local player changed stage – refresh remote visibilities
        // (sendLevelChange is now called by ExitManager with the final position)
        eventBus.on('level:transition', ({ levelId }) => {
            for (const rp of this.remotePlayers.values()) {
                rp.circle.setVisible(rp.stageId === levelId);
            }
            this._refreshAllRemotePlayerLightSources();
            this._localDashState = { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 };
            const playerLevelId = this.player?.getComponent('transform')?.levelId ?? levelId;
            this._setEntityVisibility(this.player, playerLevelId === levelId);
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
        // A remote player fired a projectile - spawn it locally if in the same level.
        eventBus.on('network:bulletFired', ({
            x,
            y,
            velocityX,
            velocityY,
            levelId,
            sourceTeamId,
            projectileType,
            projectileId,
            penetration,
        }) => {
            if (levelId === gameState.currentLevelId) {
                let projectileEntity = null;
                if (projectileType === 'arrow') {
                    projectileEntity = this.entityFactory.createFromPrefab('arrow', {
                        x,
                        y,
                        velocityX,
                        velocityY,
                        penetration,
                        sourceTeamId,
                    });
                } else if (projectileType === 'imposing_flame') {
                    const spellCfg = resolveSpellConfig('imposing_flame');
                    projectileEntity = this.entityFactory.createFromPrefab('bullet', {
                        x,
                        y,
                        velocityX,
                        velocityY,
                        maxRange: spellCfg?.projectile?.maxRange ?? 520,
                        color: 0xff5b1a,
                        radius: 8,
                    });
                } else {
                    projectileEntity = this.entityFactory.createFromPrefab('bullet', {
                        x,
                        y,
                        velocityX,
                        velocityY,
                        penetration,
                    });
                }
                if (!projectileEntity) return;
                if (projectileId) {
                    this._networkProjectiles.set(projectileId, projectileEntity.id);
                }
                const projectileGO =
                    projectileEntity.getComponent('rectangle')?.gameObject ??
                    projectileEntity.getComponent('circle')?.gameObject;
                this.lightingRenderer?.maskGameObject(projectileGO);
            }
        });

        eventBus.on('network:meleeAttack', (payload) => {
            this._renderReplicatedMeleeAttack(payload);
        });

        eventBus.on('network:projectileDespawn', ({ projectileId, x, y, projectileType, reason }) => {
            let burstX = Number.isFinite(x) ? x : null;
            let burstY = Number.isFinite(y) ? y : null;
            if (projectileId) {
                const entityId = this._networkProjectiles.get(projectileId);
                if (entityId) {
                    const projectile = this.entityManager.getEntityById(entityId);
                    const transform = projectile?.getComponent('transform');
                    if (!Number.isFinite(burstX)) burstX = transform?.position?.x ?? null;
                    if (!Number.isFinite(burstY)) burstY = transform?.position?.y ?? null;
                    projectile?.destroy?.();
                    this._networkProjectiles.delete(projectileId);
                }
            }

            if (projectileType === 'imposing_flame' &&
                (reason === 'hit' || reason === 'wall' || reason === 'range' || reason === 'lifetime' || reason === 'destination') &&
                Number.isFinite(burstX) &&
                Number.isFinite(burstY)) {
                this._renderImposingFlameBurstFx(burstX, burstY);
            }
        });

        eventBus.on('network:spellEffect', ({
            spellId,
            phase,
            x,
            y,
            levelId,
            sourceX,
            sourceY,
            hitX,
            hitY,
        }) => {
            if (levelId !== gameState.currentLevelId) return;
            if (spellId === 'gelid_cradle' && phase === 'manifest') {
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                this._renderGelidCradleManifestFx(x, y);
                return;
            }
            if (spellId === 'arc_flash' && phase === 'flash') {
                if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) return;
                if (!Number.isFinite(hitX) || !Number.isFinite(hitY)) return;
                this._renderArcFlashFx(sourceX, sourceY, hitX, hitY);
            }
        });

        // Server confirmed an authoritative health change.
        eventBus.on('network:playerDamaged', ({ sessionId, hp, damage }) => {
            if (sessionId === networkManager.sessionId) {
                const localStats = this.player?.getComponent('stats');
                if (localStats) localStats.setHp(hp);
            }

            this.uiProjectionSystem?.publishImmediate();
            const damageValue = Number.isFinite(damage) ? Math.max(0, Math.round(damage)) : 0;
            if (damageValue <= 0) return;

            const targetPos = this._getPlayerDamageAnchor(sessionId);
            if (!targetPos) return;
            if (targetPos.levelId !== gameState.currentLevelId) return;
            this._showDamageNumber(targetPos.x, targetPos.y, damageValue);
        });

        eventBus.on('network:worldEntityDamaged', ({ entityKey, damage, hp, died, x, y, levelId }) => {
            const targetEntity = this._resolveEntityByNetworkKey(entityKey);
            const targetStats = targetEntity?.getComponent('stats');
            if (targetStats) {
                if (Number.isFinite(hp)) {
                    targetStats.setHp(hp);
                } else if (died) {
                    targetStats.setHp(0);
                }
                this.uiProjectionSystem?.publishImmediate();
            }

            const damageValue = Number.isFinite(damage) ? Math.max(0, Math.round(damage)) : 0;
            if (damageValue <= 0) return;
            const anchor = this._getWorldEntityDamageAnchor(entityKey, x, y, levelId);
            if (!anchor) return;
            if (anchor.levelId !== gameState.currentLevelId) return;
            this._showDamageNumber(anchor.x, anchor.y, damageValue);
        });

        eventBus.on('network:entityFlinched', ({ entityKey, levelId }) => {
            this._onEntityFlinched(entityKey, levelId);
        });

        eventBus.on('network:entityStaggered', ({ entityKey, durationMs, levelId }) => {
            this._onEntityStaggered(entityKey, durationMs, levelId);
        });

        // Inventory drawer equip actions — UIScene emits these, we route them to the
        // controlled entity's LoadoutComponent so the ECS stays as the source of truth.
        eventBus.on('network:worldReset', ({ source }) => {
            if (source !== 'warm_fire') return;
            this._pendingWorldResetFxUntilMs = 0;
            this._playWorldResetShimmer();
        });

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
        eventBus.on('ui:assignWeaponSlot', ({ slotIndex, id }) => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.assignWeaponSlot(slotIndex, id);
        });
        eventBus.on('ui:assignSpellSlot', ({ slotIndex, id }) => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.assignSpellSlot(slotIndex, id);
        });
        eventBus.on('ui:activateWeaponSlot', ({ slotIndex }) => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.activateWeaponSlot(slotIndex);
        });
        eventBus.on('ui:activateSpellSlot', ({ slotIndex }) => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.activateSpellSlot(slotIndex);
        });
        eventBus.on('ui:assignConsumableSlot', ({ slotIndex, id }) => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.assignConsumableSlot(slotIndex, id);
        });
        eventBus.on('ui:activateConsumableSlot', ({ slotIndex }) => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.activateConsumableSlot(slotIndex);
        });
        eventBus.on('ui:cycleWeaponSlot', () => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.cycleWeaponSlot();
        });
        eventBus.on('ui:cycleSpellSlot', () => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.cycleSpellSlot();
        });
        eventBus.on('ui:cycleConsumableSlot', () => {
            this.getLocallyControlledEntity()?.getComponent('loadout')?.cycleConsumableSlot();
        });
        eventBus.on('ui:useConsumable', () => {
            const loadout = this.getLocallyControlledEntity()?.getComponent('loadout');
            const definitionId = loadout?.consumableSlots?.[loadout.activeConsumableSlotIndex] ?? 'nothing';
            if (!definitionId || definitionId === 'nothing') {
                eventBus.emit('toast:enqueue', { message: 'No consumable assigned', durationMs: 1400 });
                return;
            }
            networkManager.sendUseConsumable(definitionId);
        });
        eventBus.on('ui:dropEntry', ({ entryId, mode }) => {
            if (typeof entryId !== 'string' || !entryId) return;
            networkManager.sendDropEntry(entryId, mode === 'all' ? 'all' : 'one');
        });
        eventBus.on('ui:sellEntry', ({ merchantId, entryId, mode }) => {
            if (typeof entryId !== 'string' || !entryId) return;
            networkManager.sendSellEntry(merchantId, entryId, mode === 'all' ? 'all' : 'one');
        });
        eventBus.on('ui:buyMerchantItem', ({ merchantId, definitionId }) => {
            if (typeof merchantId !== 'string' || typeof definitionId !== 'string' || !definitionId) return;
            networkManager.sendBuyMerchantItem(merchantId, definitionId);
        });
        eventBus.on('ui:upgradeWeaponItem', ({ upgraderId, entryId }) => {
            if (typeof upgraderId !== 'string' || typeof entryId !== 'string') return;
            networkManager.sendUpgradeWeaponItem(upgraderId, entryId);
        });
        eventBus.on('ui:upgradeSpellItem', ({ upgraderId, spellId }) => {
            if (typeof upgraderId !== 'string' || typeof spellId !== 'string') return;
            networkManager.sendUpgradeSpellItem(upgraderId, spellId);
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
            const loadoutSnapshot = this._buildServerLoadoutSnapshot(entity.getComponent('loadout'));
            if (!entityKey) return;
            networkManager.sendEquip(entityKey, equipped, levelId, loadoutSnapshot);
        });
        eventBus.on('loadout:kitChanged', ({ entityId }) => {
            const entity = this.entityManager.getEntityById(entityId);
            if (!entity) return;

            const transform = entity.getComponent('transform');
            const levelId = transform?.levelId ?? gameState.currentLevelId ?? null;
            const entityKey = this._getNetworkEntityKey(entity);
            const loadout = entity.getComponent('loadout');
            const loadoutSnapshot = this._buildServerLoadoutSnapshot(loadout);
            if (!entityKey || !loadoutSnapshot) return;
            networkManager.sendEquip(entityKey, loadout.equipped, levelId, loadoutSnapshot);
        });
        eventBus.on('control:changed', ({ controlMode }) => {
            if (controlMode !== 'local') return;
            uiStateStore.patch({
                pendingSlotAssignment: null,
                quickRadialHover: null,
                quickRadialOpen: false,
            });
        });

        // A remote player disconnected
        eventBus.on('network:playerLeft', ({ sessionId }) => {
            const rp = this.remotePlayers.get(sessionId);
            if (rp) {
                this.lightingRenderer?.removeLightSource(this._remotePlayerLightSourceId(sessionId));
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
            for (const entityId of this._networkProjectiles.values()) {
                this.entityManager.getEntityById(entityId)?.destroy?.();
            }
            this._networkProjectiles.clear();
            for (const sessionId of this.remotePlayers.keys()) {
                this.lightingRenderer?.removeLightSource(this._remotePlayerLightSourceId(sessionId));
            }
            for (const entityKey of this._worldEntityStateCache.keys()) {
                this.lightingRenderer?.removeLightSource(this._worldEntityLightSourceId(entityKey));
            }
            for (const pulse of this._staggerPulseState.values()) {
                pulse?.event?.remove?.(false);
            }
            this._staggerPulseState.clear();
        });

        eventBus.on('network:connected', () => {
            if (DEBUG_WORLD_SYNC) {
                console.log('[WorldSync] network:connected -> clearing cache', {
                    cacheKeys: Array.from(this._worldEntityStateCache.keys()),
                });
            }
            this._worldEntityStateCache.clear();
            this._replicationTracks.clear();
            for (const entityId of this._networkProjectiles.values()) {
                this.entityManager.getEntityById(entityId)?.destroy?.();
            }
            this._networkProjectiles.clear();
            for (const pulse of this._staggerPulseState.values()) {
                pulse?.event?.remove?.(false);
            }
            this._staggerPulseState.clear();

            const controlled = this.getLocallyControlledEntity?.();
            const loadout = controlled?.getComponent?.('loadout');
            const transform = controlled?.getComponent?.('transform');
            const entityKey = this._getNetworkEntityKey(controlled);
            if (loadout && entityKey) {
                networkManager.sendEquip(
                    entityKey,
                    loadout.equipped,
                    transform?.levelId ?? gameState.currentLevelId ?? null,
                    this._buildServerLoadoutSnapshot(loadout)
                );
            }
        });
    }

    _getPlayerDamageAnchor(sessionId) {
        if (!sessionId) return null;
        if (sessionId === networkManager.sessionId) {
            const circle = this.player?.getComponent('circle');
            const go = circle?.gameObject;
            const transform = this.player?.getComponent('transform');
            const x = Number.isFinite(go?.x) ? go.x : transform?.position?.x;
            const y = Number.isFinite(go?.y) ? go.y : transform?.position?.y;
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const radius = circle?.radius ?? PLAYER_RADIUS;
            const levelId = transform?.levelId ?? gameState.currentLevelId ?? null;
            return { x, y: y - radius - 8, levelId };
        }

        const remote = this.remotePlayers.get(sessionId);
        if (!remote?.circle) return null;
        const x = remote.circle.x;
        const y = remote.circle.y - PLAYER_RADIUS - 8;
        return { x, y, levelId: remote.stageId ?? null };
    }

    _getWorldEntityDamageAnchor(entityKey, fallbackX, fallbackY, fallbackLevelId) {
        const entity = this._resolveEntityByNetworkKey(entityKey);
        const circle = entity?.getComponent?.('circle');
        const rectangle = entity?.getComponent?.('rectangle');
        const transform = entity?.getComponent?.('transform');
        const circleGo = circle?.gameObject;
        const rectGo = rectangle?.gameObject;
        const x = Number.isFinite(circleGo?.x)
            ? circleGo.x
            : Number.isFinite(rectGo?.x)
                ? rectGo.x
                : Number.isFinite(transform?.position?.x)
                    ? transform.position.x
                    : fallbackX;
        const y = Number.isFinite(circleGo?.y)
            ? circleGo.y
            : Number.isFinite(rectGo?.y)
                ? rectGo.y
                : Number.isFinite(transform?.position?.y)
                    ? transform.position.y
                    : fallbackY;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

        const halfHeight = Number.isFinite(circle?.radius)
            ? circle.radius
            : Number.isFinite(rectangle?.height)
                ? rectangle.height / 2
                : PLAYER_RADIUS;
        const levelId = transform?.levelId ?? fallbackLevelId ?? gameState.currentLevelId ?? null;
        return { x, y: y - halfHeight - 8, levelId };
    }

    _showDamageNumber(x, y, amount) {
        if (!Number.isFinite(x) || !Number.isFinite(y) || amount <= 0) return;
        const txt = this.add.text(x, y, String(amount), {
            fontSize: '18px',
            fontFamily: GAME_FONT_FAMILY,
            color: '#ffdf7b',
            stroke: '#341d10',
            strokeThickness: 5,
        }).setOrigin(0.5, 1).setDepth(245);

        this.tweens.add({
            targets: txt,
            y: y - DAMAGE_TEXT_RISE_PX,
            alpha: 0,
            duration: DAMAGE_TEXT_LIFETIME_MS,
            ease: 'Cubic.easeOut',
            onComplete: () => txt.destroy(),
        });
    }

    _renderImposingFlameBurstFx(x, y) {
        const ring = this.add.circle(x, y, 14, 0xff8f24, 0.55).setDepth(210);
        const core = this.add.circle(x, y, 10, 0xffd27a, 0.85).setDepth(211);
        this.tweens.add({
            targets: ring,
            radius: 72,
            alpha: 0,
            duration: 180,
            ease: 'Quad.easeOut',
            onComplete: () => ring.destroy(),
        });
        this.tweens.add({
            targets: core,
            scaleX: 2.2,
            scaleY: 2.2,
            alpha: 0,
            duration: 160,
            ease: 'Quad.easeOut',
            onComplete: () => core.destroy(),
        });
    }

    _renderGelidCradleManifestFx(x, y) {
        const ring = this.add.circle(x, y, 12, 0x8fd8ff, 0.5).setDepth(210);
        const core = this.add.circle(x, y, 8, 0xe5f7ff, 0.9).setDepth(211);
        this.tweens.add({
            targets: ring,
            radius: 80,
            alpha: 0,
            duration: 220,
            ease: 'Quad.easeOut',
            onComplete: () => ring.destroy(),
        });
        this.tweens.add({
            targets: core,
            scaleX: 2.3,
            scaleY: 2.3,
            alpha: 0,
            duration: 180,
            ease: 'Quad.easeOut',
            onComplete: () => core.destroy(),
        });
    }

    _renderArcFlashFx(x1, y1, x2, y2) {
        const gfx = this.add.graphics().setDepth(212);
        gfx.lineStyle(4, 0xe8f8ff, 0.95);
        gfx.beginPath();
        gfx.moveTo(x1, y1);
        gfx.lineTo(x2, y2);
        gfx.strokePath();

        const impact = this.add.circle(x2, y2, 8, 0xd6f2ff, 0.9).setDepth(213);
        this.tweens.add({
            targets: impact,
            alpha: 0,
            scaleX: 1.9,
            scaleY: 1.9,
            duration: 120,
            ease: 'Quad.easeOut',
            onComplete: () => impact.destroy(),
        });

        this.tweens.add({
            targets: gfx,
            alpha: 0,
            duration: 120,
            ease: 'Quad.easeOut',
            onComplete: () => gfx.destroy(),
        });
    }

    _resolveReactionVisualTarget(entityKey) {
        if (typeof entityKey !== 'string') return null;
        if (entityKey.startsWith('player:')) {
            const sid = entityKey.slice('player:'.length);
            if (sid === (networkManager.sessionId ?? '')) {
                const circle = this.player?.getComponent('circle')?.gameObject;
                const transform = this.player?.getComponent('transform');
                if (!circle || !transform) return null;
                return { go: circle, x: circle.x, y: circle.y, levelId: transform.levelId ?? gameState.currentLevelId ?? null };
            }
            const remote = this.remotePlayers.get(sid);
            if (!remote?.circle) return null;
            return { go: remote.circle, x: remote.circle.x, y: remote.circle.y, levelId: remote.stageId ?? null };
        }
        if (entityKey.startsWith('world:')) {
            const entity = this._resolveEntityByNetworkKey(entityKey);
            const circle = entity?.getComponent?.('circle')?.gameObject ?? null;
            const transform = entity?.getComponent?.('transform');
            if (!circle || !transform) return null;
            return { go: circle, x: circle.x, y: circle.y, levelId: transform.levelId ?? null };
        }
        return null;
    }

    _onEntityFlinched(entityKey, levelId = null) {
        const target = this._resolveReactionVisualTarget(entityKey);
        if (!target) return;
        const resolvedLevelId = levelId ?? target.levelId;
        if (resolvedLevelId !== gameState.currentLevelId) return;

        if (entityKey === `player:${networkManager.sessionId ?? ''}`) {
            this.player?.getComponent('playerCombat')?.forceInterrupt?.();
        }

        const burst = this.add.circle(target.x, target.y, 8, 0xffaa66, 0.9).setDepth(250);
        this.tweens.add({
            targets: burst,
            alpha: 0,
            scaleX: 2.6,
            scaleY: 2.6,
            duration: 140,
            ease: 'Quad.easeOut',
            onComplete: () => burst.destroy(),
        });
    }

    _onEntityStaggered(entityKey, durationMs, levelId = null) {
        const target = this._resolveReactionVisualTarget(entityKey);
        if (!target) return;
        const resolvedLevelId = levelId ?? target.levelId;
        if (resolvedLevelId !== gameState.currentLevelId) return;

        if (entityKey === `player:${networkManager.sessionId ?? ''}`) {
            this.player?.getComponent('playerCombat')?.forceInterrupt?.();
        }

        this._startStaggerPulse(entityKey, Math.max(120, durationMs || 0));
    }

    _startStaggerPulse(entityKey, durationMs) {
        const target = this._resolveReactionVisualTarget(entityKey);
        const go = target?.go;
        if (!go || typeof go.setFillStyle !== 'function') return;

        const previous = this._staggerPulseState.get(entityKey);
        if (previous) {
            previous.event?.remove?.(false);
            go.setFillStyle(previous.originalColor, previous.originalAlpha);
            this._staggerPulseState.delete(entityKey);
        }

        const originalColor = Number.isFinite(go.fillColor) ? go.fillColor : 0xffffff;
        const originalAlpha = Number.isFinite(go.fillAlpha) ? go.fillAlpha : 1;
        const endAt = performance.now() + durationMs;
        let on = false;

        const event = this.time.addEvent({
            delay: 120,
            loop: true,
            callback: () => {
                if (!go.active || performance.now() >= endAt) {
                    go.setFillStyle(originalColor, originalAlpha);
                    event.remove(false);
                    this._staggerPulseState.delete(entityKey);
                    return;
                }
                on = !on;
                if (on) go.setFillStyle(0xff4444, originalAlpha);
                else go.setFillStyle(originalColor, originalAlpha);
            },
        });

        this._staggerPulseState.set(entityKey, { event, originalColor, originalAlpha });
    }

    _resolveMeleeVisualSpec(weaponId, phaseIndex) {
        if (weaponId === 'longsword' || weaponId === 'sword') {
            const p0 = resolveMeleeAttackProfile('longsword', 0);
            const p1 = resolveMeleeAttackProfile('longsword', 1);
            const p2 = resolveMeleeAttackProfile('longsword', 2);
            const swordSpecs = [
                { radius: p0.radius, arc: p0.arc, color: p0.visual.color, alpha: p0.visual.alpha, activeMs: p0.activeMs },
                { radius: p1.radius, arc: p1.arc, color: p1.visual.color, alpha: p1.visual.alpha, activeMs: p1.activeMs },
                { radius: p2.radius, arc: p2.arc, color: p2.visual.color, alpha: p2.visual.alpha, activeMs: p2.activeMs },
            ];
            const index = Math.max(0, Math.min(swordSpecs.length - 1, Number.isFinite(phaseIndex) ? Math.floor(phaseIndex) : 0));
            return swordSpecs[index];
        }
        if (weaponId === 'zombie_strike') {
            const profile = resolveMeleeAttackProfile('zombie_strike', 0);
            return {
                radius: profile.radius,
                arc: profile.arc,
                color: profile.visual.color,
                alpha: profile.visual.alpha,
                activeMs: profile.activeMs,
            };
        }
        const profile = resolveMeleeAttackProfile('unarmed', 0);
        return {
            radius: profile.radius,
            arc: profile.arc,
            color: profile.visual.color,
            alpha: profile.visual.alpha,
            activeMs: profile.activeMs,
        };
    }

    _resolveReplicatedMeleeOrigin(payload) {
        const attackerEntityKey = payload?.attackerEntityKey;
        if (typeof attackerEntityKey === 'string' && attackerEntityKey.startsWith('world:')) {
            const entity = this._resolveEntityByNetworkKey(attackerEntityKey);
            const circle = entity?.getComponent?.('circle');
            const rectangle = entity?.getComponent?.('rectangle');
            const transform = entity?.getComponent?.('transform');
            const x = Number.isFinite(circle?.gameObject?.x)
                ? circle.gameObject.x
                : Number.isFinite(rectangle?.gameObject?.x)
                    ? rectangle.gameObject.x
                    : transform?.position?.x;
            const y = Number.isFinite(circle?.gameObject?.y)
                ? circle.gameObject.y
                : Number.isFinite(rectangle?.gameObject?.y)
                    ? rectangle.gameObject.y
                    : transform?.position?.y;
            const levelId = transform?.levelId ?? payload?.levelId ?? null;
            if (Number.isFinite(x) && Number.isFinite(y)) {
                return { x, y, levelId };
            }
        }

        if (typeof payload?.sessionId === 'string') {
            if (payload.sessionId === networkManager.sessionId) {
                const transform = this.player?.getComponent?.('transform');
                const x = transform?.position?.x;
                const y = transform?.position?.y;
                const levelId = transform?.levelId ?? payload?.levelId ?? null;
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    return { x, y, levelId };
                }
            } else {
                const remote = this.remotePlayers.get(payload.sessionId);
                if (remote?.circle) {
                    return {
                        x: remote.circle.x,
                        y: remote.circle.y,
                        levelId: remote.stageId ?? payload?.levelId ?? null,
                    };
                }
            }
        }

        const x = payload?.originX;
        const y = payload?.originY;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y, levelId: payload?.levelId ?? null };
    }

    _renderReplicatedMeleeAttack(payload) {
        if (!payload) return;
        if (payload.sessionId && payload.sessionId === networkManager.sessionId) return;

        const origin = this._resolveReplicatedMeleeOrigin(payload);
        if (!origin) return;
        if (origin.levelId !== gameState.currentLevelId) return;

        const dirX = Number.isFinite(payload.dirX) ? payload.dirX : 1;
        const dirY = Number.isFinite(payload.dirY) ? payload.dirY : 0;
        const dirLen = Math.hypot(dirX, dirY);
        if (dirLen < 0.001) return;
        const nx = dirX / dirLen;
        const ny = dirY / dirLen;
        const angle = Math.atan2(ny, nx);
        const spec = this._resolveMeleeVisualSpec(payload.weaponId, payload.phaseIndex);

        const gfx = this.add.graphics();
        gfx.fillStyle(spec.color, spec.alpha);
        gfx.beginPath();
        gfx.moveTo(origin.x, origin.y);
        gfx.arc(origin.x, origin.y, spec.radius, angle - spec.arc / 2, angle + spec.arc / 2);
        gfx.closePath();
        gfx.fillPath();
        gfx.setDepth(190);

        this.time.delayedCall(spec.activeMs, () => {
            gfx.destroy();
        });
    }

    _getNetworkEntityKey(entity) {
        if (!entity?.id) return null;
        if (entity.id === this.player?.id) {
            return `player:${networkManager.sessionId ?? 'local'}`;
        }
        return `world:${entity.id}`;
    }

    _buildServerLoadoutSnapshot(loadout) {
        if (!loadout) return null;
        return {
            weaponSlots: Array.isArray(loadout.weaponSlots) ? loadout.weaponSlots.slice(0, 3) : [],
            spellSlots: Array.isArray(loadout.spellSlots) ? loadout.spellSlots.slice(0, 3) : [],
            consumableSlots: Array.isArray(loadout.consumableSlots) ? loadout.consumableSlots.slice(0, 3) : [],
            activeWeaponSlotIndex: Number.isFinite(loadout.activeWeaponSlotIndex) ? Math.max(0, Math.floor(loadout.activeWeaponSlotIndex)) : 0,
            activeSpellSlotIndex: Number.isFinite(loadout.activeSpellSlotIndex) ? Math.max(0, Math.floor(loadout.activeSpellSlotIndex)) : 0,
            activeConsumableSlotIndex: Number.isFinite(loadout.activeConsumableSlotIndex) ? Math.max(0, Math.floor(loadout.activeConsumableSlotIndex)) : 0,
        };
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
        if (kind === 'corpse') return 'corpse';
        if (kind === 'golem') return 'golem';
        if (kind === 'zombie') return 'zombie';
        if (kind === 'loot') return 'loot';
        if (typeof entityKey === 'string' && entityKey.includes('golem')) return 'golem';
        if (typeof entityKey === 'string' && entityKey.includes('zombie')) return 'zombie';
        return null;
    }

    _isReplicatedWorldActor(entity) {
        if (!entity) return false;
        return entity.type === 'golem' || entity.type === 'zombie' || entity.type === 'corpse' || entity.type === 'loot';
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
                this.lightingRenderer?.removeLightSource(this._worldEntityLightSourceId(entityKey));
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
                this.lightingRenderer?.removeLightSource(this._worldEntityLightSourceId(entityKey));
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
                golemCache: this._worldEntityStateCache.get(DEBUG_GOLEM_KEY) ?? null,
            });
        }
    }

    _applyNetworkWorldEntityState({
        entityKey,
        x,
        y,
        levelId,
        kind,
        resources,
        controllerSessionId,
        teamId,
        possessionMsRemaining,
        decayMsRemaining,
        hitRadius,
        identity,
        tick = null,
    }) {
        if (!entityKey || !entityKey.startsWith('world:')) return;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (DEBUG_WORLD_SYNC && entityKey === DEBUG_GOLEM_KEY) {
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
            resources: resources ?? null,
            hitRadius: Number.isFinite(hitRadius) ? hitRadius : null,
            controllerSessionId: controllerSessionId ?? null,
            teamId: typeof teamId === 'string' ? teamId : null,
            possessionMsRemaining: Number.isFinite(possessionMsRemaining) ? possessionMsRemaining : null,
            decayMsRemaining: Number.isFinite(decayMsRemaining) ? decayMsRemaining : null,
            identity: identity ?? null,
        });

        const entityId = entityKey.slice('world:'.length);
        let entity = this.entityManager.getEntityById(entityId);
        if (DEBUG_WORLD_SYNC && entityKey === DEBUG_GOLEM_KEY) {
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
                : worldPrefab === 'corpse'
                    ? {
                        id: entityId,
                        x,
                        y,
                        radius: Number.isFinite(hitRadius) ? hitRadius : undefined,
                        identity: identity ?? null,
                        decayMsRemaining,
                    }
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

        this._applyResourceSummaryToEntity(entity, resources ?? null);

        const decay = entity.getComponent('decay');
        if (decay && Number.isFinite(decayMsRemaining)) {
            decay.setTiming(decay.totalMs, decayMsRemaining);
        }
        const corpseIdentity = entity.getComponent('corpseIdentity');
        if (corpseIdentity && identity) {
            corpseIdentity.setIdentity(identity);
        }

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
            this._refreshWorldEntityLightSource(entityKey);
            if (DEBUG_WORLD_SYNC && entityKey === DEBUG_GOLEM_KEY) {
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
            this._refreshWorldEntityLightSource(entityKey);
            return;
        }

        this._pushReplicationTrack(entityKey, x, y, levelId ?? null, tick);
        this._refreshWorldEntityLightSource(entityKey, x, y);
        if (DEBUG_WORLD_SYNC && entityKey === DEBUG_GOLEM_KEY) {
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

    _applyResourceSummaryToEntity(entity, resources) {
        const stats = entity?.getComponent?.('stats');
        if (!stats || !resources) return;
        stats.applyResourceSummary(resources);
        this.uiProjectionSystem?.publishImmediate();
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

    _addRemotePlayer(sessionId, x, y, stageId = 'inn', teamId = null, sightRadius = null) {
        if (this.remotePlayers.has(sessionId)) return;
        const circle = this.add.circle(x, y, PLAYER_RADIUS, 0x6688cc, 0.9);
        circle.setStrokeStyle(3, 0x223355);
        const isVisible = stageId === gameState.currentLevelId;
        circle.setVisible(isVisible);
        this.lightingRenderer?.maskGameObject(circle);
        this.remotePlayers.set(sessionId, {
            circle,
            stageId,
            teamId: typeof teamId === 'string' ? teamId : null,
            sightRadius: Number.isFinite(sightRadius) ? sightRadius : ARCHETYPE_CONFIG.player.sightRadius,
        });
        this._seedReplicationTrack(this._remotePlayerTrackKey(sessionId), x, y, stageId, null);
        this._refreshRemotePlayerLightSource(sessionId);
        console.log(`[Network] Remote player joined: ${sessionId} in stage ${stageId}`);
    }

    _pushRemoteSnapshot(sessionId, x, y, stageId, tick, teamId = null, sightRadius = null) {
        let rp = this.remotePlayers.get(sessionId);
        if (!rp) {
            this._addRemotePlayer(sessionId, x, y, stageId, teamId, sightRadius);
            rp = this.remotePlayers.get(sessionId);
            if (!rp) return;
        }

        const nowMs = performance.now();
        rp.stageId = stageId;
        if (typeof teamId === 'string') {
            rp.teamId = teamId;
        }
        if (Number.isFinite(sightRadius)) {
            rp.sightRadius = sightRadius;
        }
        rp.circle.setVisible(stageId === gameState.currentLevelId);
        this._pushReplicationTrack(this._remotePlayerTrackKey(sessionId), x, y, stageId, tick, nowMs);
        this._refreshRemotePlayerLightSource(sessionId, x, y);
    }

    _remotePlayerLightSourceId(sessionId) {
        return `remote-player:${sessionId}`;
    }

    _worldEntityLightSourceId(entityKey) {
        return `world-entity:${entityKey}`;
    }

    _refreshAllRemotePlayerLightSources() {
        for (const sessionId of this.remotePlayers.keys()) {
            this._refreshRemotePlayerLightSource(sessionId);
        }
        for (const entityKey of this._worldEntityStateCache.keys()) {
            this._refreshWorldEntityLightSource(entityKey);
        }
    }

    _refreshRemotePlayerLightSource(sessionId, x = null, y = null) {
        const rp = this.remotePlayers.get(sessionId);
        if (!rp) return;

        const lightSourceId = this._remotePlayerLightSourceId(sessionId);
        const isAlly = !!rp.teamId && rp.teamId === this._localTeamId;
        const inCurrentLevel = rp.stageId === gameState.currentLevelId;
        const grid = this.levelManager?.currentLevel?.grid;
        const sourceX = Number.isFinite(x) ? x : rp.circle?.x;
        const sourceY = Number.isFinite(y) ? y : rp.circle?.y;
        if (
            !isAlly ||
            !inCurrentLevel ||
            !grid ||
            !Number.isFinite(sourceX) ||
            !Number.isFinite(sourceY)
        ) {
            this.lightingRenderer?.removeLightSource(lightSourceId);
            return;
        }

        const sightRadius = Number.isFinite(rp.sightRadius)
            ? rp.sightRadius
            : ARCHETYPE_CONFIG.player.sightRadius;
        const { polygon } = VisibilitySystem.compute(grid, sourceX, sourceY, sightRadius, 360);
        this.lightingRenderer?.addLightSource(lightSourceId);
        this.lightingRenderer?.setLightSourcePolygon(lightSourceId, polygon);
    }

    _refreshWorldEntityLightSource(entityKey, x = null, y = null) {
        if (!entityKey?.startsWith('world:')) return;

        const lightSourceId = this._worldEntityLightSourceId(entityKey);
        const cached = this._worldEntityStateCache.get(entityKey);
        const entity = this._resolveEntityByNetworkKey(entityKey);
        const isLocallyControlled = entity?.id === this.getLocallyControlledEntity()?.id;
        const teamId = cached?.teamId ?? null;
        const levelId = cached?.levelId ?? entity?.getComponent('transform')?.levelId ?? null;
        const grid = this.levelManager?.currentLevel?.grid;
        const sourceX = Number.isFinite(x) ? x : (cached?.x ?? entity?.getComponent('transform')?.position?.x);
        const sourceY = Number.isFinite(y) ? y : (cached?.y ?? entity?.getComponent('transform')?.position?.y);
        const kind = cached?.kind ?? this._resolveWorldPrefabName(entityKey, null);
        const sightRadius = Number.isFinite(ARCHETYPE_CONFIG?.[kind]?.sightRadius)
            ? ARCHETYPE_CONFIG[kind].sightRadius
            : ARCHETYPE_CONFIG.player.sightRadius;

        if (
            isLocallyControlled ||
            teamId !== this._localTeamId ||
            levelId !== gameState.currentLevelId ||
            !grid ||
            !Number.isFinite(sourceX) ||
            !Number.isFinite(sourceY)
        ) {
            this.lightingRenderer?.removeLightSource(lightSourceId);
            return;
        }

        const { polygon } = VisibilitySystem.compute(grid, sourceX, sourceY, sightRadius, 360);
        this.lightingRenderer?.addLightSource(lightSourceId);
        this.lightingRenderer?.setLightSourcePolygon(lightSourceId, polygon);
    }

    _resolveClientEntityTeamId(entity) {
        if (!entity) return null;
        if (entity.id === this.player?.id) {
            return TEAM_IDS.players;
        }

        const entityKey = this._getNetworkEntityKey(entity);
        if (entityKey?.startsWith('world:')) {
            const cached = this._worldEntityStateCache.get(entityKey);
            if (typeof cached?.teamId === 'string') return cached.teamId;
        }

        const kind = entity.type ?? this._resolveWorldPrefabName(entityKey ?? null, null);
        return ARCHETYPE_CONFIG?.[kind]?.teamId ?? null;
    }

    _canLocalProjectileHitEntity(sourceTeamId, targetEntity) {
        if (!targetEntity || targetEntity.id == null) return false;
        const targetStats = targetEntity.getComponent?.('stats');
        if (!Number.isFinite(targetStats?.hpMax) || targetStats.hpMax <= 0) return false;

        const targetTeamId = this._resolveClientEntityTeamId(targetEntity);
        if (!targetTeamId || !sourceTeamId) return false;
        return sourceTeamId !== targetTeamId;
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
        const combat = controlled.getComponent('playerCombat');
        const movementInfluence = combat?.getMovementInfluence?.() ?? null;

        const levelData = gameState.levels?.[gameState.currentLevelId];
        const grid = levelData?.grid ?? null;
        const terrainMoveSpeedMultiplier = getTerrainMovementMultiplierAtWorldPosition(
            grid,
            transform.position.x,
            transform.position.y
        );
        const effectiveMoveSpeedMultiplier = (movementInfluence?.speedMultiplier ?? 1) * terrainMoveSpeedMultiplier;
        const input = intent ? {
            up: (intent.moveY ?? 0) < -0.0001,
            down: (intent.moveY ?? 0) > 0.0001,
            left: (intent.moveX ?? 0) < -0.0001,
            right: (intent.moveX ?? 0) > 0.0001,
            sprint: !!intent.wantsSprint,
            dash: !!intent.wantsDash,
            moveSpeedMultiplier: effectiveMoveSpeedMultiplier,
            attackPushVx: movementInfluence?.attackPushVx ?? 0,
            attackPushVy: movementInfluence?.attackPushVy ?? 0,
        } : (keyboard?.inputState ?? {
            up: false, down: false, left: false, right: false, sprint: false, dash: false,
            moveSpeedMultiplier: 1, attackPushVx: 0, attackPushVy: 0,
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
        // Always use the player body's intent, not the locally controlled entity's.
        // During possession the locally controlled entity is the golem — sending its
        // movement intent as PLAYER_INPUT would cause the server to move the player
        // body in lockstep with the possessed entity.
        if (this.player) {
            const intent = this.player.getComponent('intent');
            const combat = this.player.getComponent('playerCombat');
            const movementInfluence = combat?.getMovementInfluence?.() ?? null;
            if (intent) {
                networkManager.sendInput({
                    up: (intent.moveY ?? 0) < -0.0001,
                    down: (intent.moveY ?? 0) > 0.0001,
                    left: (intent.moveX ?? 0) < -0.0001,
                    right: (intent.moveX ?? 0) > 0.0001,
                    sprint: !!intent.wantsSprint,
                    moveSpeedMultiplier: movementInfluence?.speedMultiplier ?? 1,
                    attackPushVx: movementInfluence?.attackPushVx ?? 0,
                    attackPushVy: movementInfluence?.attackPushVy ?? 0,
                });
            }
        }
    }

    /**
     * Render update - interpolates remote players toward their last server position.
     * @param {number} delta - ms since last frame
     */
    renderUpdate(delta) {
        this._refreshInteractablesForCurrentLevel();
        this._updateHoveredEntityTarget(performance.now());

        // Smooth zoom toward target
        const cam = this.cameras.main;
        const zoomT = 1 - Math.pow(0.01, delta / 150);
        cam.setZoom(Phaser.Math.Linear(cam.zoom, this.targetZoom, zoomT));
        this.levelManager?.update?.(cam);

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
                this._refreshRemotePlayerLightSource(sessionId, sample.x, sample.y);
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
            this._refreshWorldEntityLightSource(entityKey, sample.x, sample.y);

            const transform = entity.getComponent('transform');
            if (transform) {
                transform.position.x = sample.x;
                transform.position.y = sample.y;
                transform.levelId = sample.stageId ?? transform.levelId ?? null;
            }
        }

        this._updateExitLabel(delta);
        this._updateInteractLabel(delta);
        this._updatePossessionBar();
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

    _refreshInteractablesForCurrentLevel() {
        const levelId = gameState.currentLevelId ?? null;
        if (!levelId || this._renderedInteractableLevelId === levelId) return;
        eventBus.emit('ui:closeMerchantShop');
        eventBus.emit('ui:closeUpgrader');

        for (const entity of this._interactableEntities.values()) {
            entity?.destroy?.();
        }
        this._interactableEntities.clear();
        this._nearestInteractable = null;
        this._renderedInteractableLevelId = levelId;

        for (const definition of getInteractableDefinitionsForLevel(levelId)) {
            if (definition.kind !== 'warm_fire' && definition.kind !== 'vendor_shop' && definition.kind !== 'weapon_upgrader' && definition.kind !== 'spell_upgrader') continue;
            const x = definition.tileX * TILE_SIZE + TILE_SIZE / 2;
            const y = definition.tileY * TILE_SIZE + TILE_SIZE / 2;
            const entityId = definition.interactableId.replace(/[^a-z0-9_-]/gi, '_');
            const entity = this.entityFactory.createFromPrefab('warm-fire', { id: entityId, x, y });
            const circle = entity?.getComponent('circle');
            if (circle?.gameObject) {
                this.lightingRenderer?.maskGameObject(circle.gameObject);
            }
            if (entity) {
                this._interactableEntities.set(definition.interactableId, entity);
            }
        }
    }

    _syncWorldResetOverlayToViewport() {
        const width = this.scale.width;
        const height = this.scale.height;
        if (this._worldResetFlash) {
            this._worldResetFlash.setPosition(0, 0);
            this._worldResetFlash.setSize(width, height);
        }
    }

    _playWorldResetShimmer() {
        this._syncWorldResetOverlayToViewport();
        this._worldResetFx?.flash?.stop?.();

        if (!this._worldResetFlash) return;

        this._worldResetFlash.setAlpha(0);
        this.cameras.main.flash(220, 255, 244, 214, false);

        const flash = this.tweens.add({
            targets: this._worldResetFlash,
            alpha: { from: 0, to: 0.22 },
            duration: 120,
            yoyo: true,
            ease: 'Sine.easeOut',
        });

        this._worldResetFx = { flash };
    }

    _updateInteractLabel(delta) {
        if (!this._interactLabel) return;

        const localEntity = this.getLocallyControlledEntity();
        const playerCircle = localEntity?.getComponent('circle');
        if (!playerCircle?.gameObject) return;

        const px = playerCircle.gameObject.x;
        const py = playerCircle.gameObject.y;
        let nearest = null;
        let nearestDistSq = Infinity;

        for (const definition of getInteractableDefinitionsForLevel(gameState.currentLevelId)) {
            const x = definition.tileX * TILE_SIZE + TILE_SIZE / 2;
            const y = definition.tileY * TILE_SIZE + TILE_SIZE / 2;
            const radius = Number.isFinite(definition.interactionRadius) ? definition.interactionRadius : TILE_SIZE * 1.5;
            const dx = x - px;
            const dy = y - py;
            const distSq = dx * dx + dy * dy;
            if (distSq > radius * radius || distSq >= nearestDistSq) continue;
            nearestDistSq = distSq;
            nearest = { definition, x, y };
        }

        for (const entity of this.entityManager.getEntitiesByType('loot')) {
            const transform = entity?.getComponent?.('transform');
            if (!transform || (transform.levelId ?? gameState.currentLevelId) !== gameState.currentLevelId) continue;
            const circle = entity?.getComponent?.('circle')?.gameObject;
            const x = Number.isFinite(circle?.x) ? circle.x : transform.position.x;
            const y = Number.isFinite(circle?.y) ? circle.y : transform.position.y;
            const radius = 72;
            const dx = x - px;
            const dy = y - py;
            const distSq = dx * dx + dy * dy;
            if (distSq > radius * radius || distSq >= nearestDistSq) continue;
            nearestDistSq = distSq;
            nearest = {
                definition: {
                    displayName: 'Glowing Loot',
                    promptText: 'Pick up [E]',
                    interactableId: this._getNetworkEntityKey(entity),
                },
                x,
                y,
            };
        }

        this._nearestInteractable = nearest;

        const targetAlpha = nearest ? 1 : 0;
        const fadeSpeed = 1 - Math.pow(0.001, delta / 200);
        this._interactLabelAlpha = Phaser.Math.Linear(this._interactLabelAlpha, targetAlpha, fadeSpeed);

        if (nearest) {
            this._interactLabel.setText(`${nearest.definition.displayName}\n${nearest.definition.promptText}`);
            this._interactLabel.setPosition(nearest.x, nearest.y - TILE_SIZE * 0.8);
            if (Phaser.Input.Keyboard.JustDown(this._interactKey)) {
                if (nearest.definition.kind === 'vendor_shop') {
                    eventBus.emit('ui:openMerchantShop', {
                        merchantId: nearest.definition.interactableId,
                        title: nearest.definition.shopTitle ?? nearest.definition.displayName ?? 'Shop',
                        stock: Array.isArray(nearest.definition.shopStock) ? nearest.definition.shopStock : [],
                    });
                } else if (nearest.definition.kind === 'weapon_upgrader' || nearest.definition.kind === 'spell_upgrader') {
                    eventBus.emit('ui:openUpgrader', {
                        upgraderId: nearest.definition.interactableId,
                        type: nearest.definition.kind === 'weapon_upgrader' ? 'weapon' : 'spell',
                        title: nearest.definition.menuTitle ?? nearest.definition.displayName ?? 'Upgrader',
                    });
                } else {
                    if (!nearest.definition.interactableId?.startsWith?.('world:')) {
                        this._pendingWorldResetFxUntilMs = performance.now() + 2000;
                    }
                    networkManager.sendInteract(nearest.definition.interactableId);
                }
            }
        }

        if (this._interactLabelAlpha < 0.01) {
            this._interactLabel.setAlpha(0);
            return;
        }

        this._interactLabel.setAlpha(this._interactLabelAlpha);
    }
}
