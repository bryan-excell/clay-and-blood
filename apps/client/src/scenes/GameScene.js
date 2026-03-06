import Phaser from 'phaser';
import { EntityManager } from '../entities/EntityManager.js';
import { EntityLevelManager } from '../world/EntityLevelManager.js';
import { ExitManager } from '../world/ExitManager.js';
import { LightingRenderer } from '../world/LightingRenderer.js';
import { gameState } from '../core/GameState.js';
import { findEmptyTile } from '../utils/helpers.js';
import { actionManager } from '../core/ActionManager.js';
import { eventBus } from '../core/EventBus.js';
import { networkManager } from '../core/NetworkManager.js';
import { PLAYER_RADIUS, TILE_SIZE, PLAYER_SPEED, PLAYER_SPRINT_MULTIPLIER } from '../config.js';
import { getLevelDisplayName } from '../world/StageDefinitions.js';
import { getExitDestination, PLAYER_DASH_SPEED, PLAYER_DASH_DURATION, PLAYER_HEALTH_MAX } from '@clay-and-blood/shared';

// ── Reconciliation helpers (mirror GameRoom._runTick logic exactly) ───────────

const SERVER_TICK_DT = 0.05; // 50 ms in seconds, matches server TICK_MS
const SERVER_DASH_TICKS = Math.ceil(PLAYER_DASH_DURATION / (SERVER_TICK_DT * 1000)); // = 5
const REMOTE_INTERPOLATION_DELAY_MS = 100;
const REMOTE_INTERPOLATION_DELAY_TICKS = 2; // 2 * 50 ms = 100 ms
const REMOTE_MAX_EXTRAPOLATION_TICKS = 2;   // cap extrapolation to 100 ms
const REMOTE_SNAPSHOT_BUFFER_SIZE = 40;
const LOCAL_RECONCILE_DEADZONE_PX = 1.5;
const LOCAL_RECONCILE_NUDGE_RATIO = 0.35;
const LOCAL_RECONCILE_MAX_NUDGE_PX = 6;
const LOCAL_RECONCILE_HARD_SNAP_PX = 96;

/**
 * Pure-JS collision resolution matching the server's resolveCollisions().
 * Returns the corrected {x, y} after pushing out of wall tiles.
 */
function resolveCollisionsLocal(x, y, grid) {
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
            if (grid[ny][nx] !== 1) continue;

            const rLeft  = nx * TILE_SIZE;
            const rTop   = ny * TILE_SIZE;
            const rRight = rLeft + TILE_SIZE;
            const rBot   = rTop  + TILE_SIZE;

            const nearX = Math.max(rLeft, Math.min(x, rRight));
            const nearY = Math.max(rTop,  Math.min(y, rBot));
            const distX = x - nearX;
            const distY = y - nearY;
            const dist  = Math.sqrt(distX * distX + distY * distY);

            if (dist < r) {
                if (dist === 0) {
                    y -= r;
                } else {
                    const overlap = r - dist;
                    x += (distX / dist) * overlap;
                    y += (distY / dist) * overlap;
                }
            }
        }
    }

    x = Math.max(r, Math.min(gridW * TILE_SIZE - r, x));
    y = Math.max(r, Math.min(gridH * TILE_SIZE - r, y));
    return { x, y };
}

/**
 * Simulate one server tick of movement for reconciliation replay.
 * @param {number} x
 * @param {number} y
 * @param {object} input  - { up, down, left, right, sprint, dashVx, dashVy, dashTicksLeft }
 * @param {number[][]} grid - wall grid for collision, or null to skip
 * @returns {{ x, y, dashTicksLeft }} position after one server tick
 */
function simulateServerTick(x, y, input, grid) {
    let vx = 0, vy = 0;
    let newDashTicksLeft = input.dashTicksLeft;

    if (input.dashTicksLeft > 0) {
        vx = input.dashVx;
        vy = input.dashVy;
        newDashTicksLeft--;
    } else {
        if (input.left)  vx -= 1;
        if (input.right) vx += 1;
        if (input.up)    vy -= 1;
        if (input.down)  vy += 1;

        if (vx !== 0 && vy !== 0) {
            const len = Math.sqrt(vx * vx + vy * vy);
            vx /= len;
            vy /= len;
        }

        const speed = input.sprint
            ? PLAYER_SPEED * PLAYER_SPRINT_MULTIPLIER
            : PLAYER_SPEED;
        vx *= speed;
        vy *= speed;
    }

    let newX = x + vx * SERVER_TICK_DT;
    let newY = y + vy * SERVER_TICK_DT;

    if (grid) ({ x: newX, y: newY } = resolveCollisionsLocal(newX, newY, grid));

    return { x: newX, y: newY, dashTicksLeft: newDashTicksLeft };
}

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

        // --- Health tracking (populated via PLAYER_DAMAGED events) ---
        // Map of sessionId -> current hp (populated lazily as damage events arrive)
        this._playerHps = new Map();

        // HP HUD – fixed to screen top-left
        this._hpText = this.add.text(12, 12, `HP: ${PLAYER_HEALTH_MAX}`, {
            fontSize:   '16px',
            fontFamily: 'monospace',
            color:      '#88ff88',
            stroke:     '#000000',
            strokeThickness: 3,
        }).setScrollFactor(0).setDepth(200);

        // --- Server reconciliation ---
        // Pending inputs are those sent to the server but not yet acknowledged.
        // Each entry: { seq, up, down, left, right, sprint, dashVx, dashVy, dashTicksLeft }
        this._pendingInputs = [];
        // Local mirror of the server-side dash state so replays match exactly.
        this._localDashState = { dashVx: 0, dashVy: 0, dashTicksLeft: 0 };
        // Latest server tick seen by this client, used for tick-based interpolation.
        this._latestServerTick = 0;

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
        eventBus.on('network:stateSnapshot', ({ players, tick }) => {
            if (Number.isFinite(tick)) {
                this._latestServerTick = Math.max(this._latestServerTick, tick);
            }
            for (const p of players) {
                if (p.sessionId === networkManager.sessionId) {
                    this._applyServerCorrection(p.x, p.y, p.seq ?? 0);
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
            // Clear the pending input buffer; positions reset on level change
            this._pendingInputs = [];
            this._localDashState = { dashVx: 0, dashVy: 0, dashTicksLeft: 0 };
        });

        // Track local dash state so the reconciliation replay can mirror it
        eventBus.on('player:dashStarted', ({ input, seq }) => {
            let dvx = 0, dvy = 0;
            if (input.left)  dvx -= 1;
            if (input.right) dvx += 1;
            if (input.up)    dvy -= 1;
            if (input.down)  dvy += 1;
            if (dvx !== 0 && dvy !== 0) {
                const len = Math.sqrt(dvx * dvx + dvy * dvy);
                dvx /= len; dvy /= len;
            }
            if (dvx !== 0 || dvy !== 0) {
                this._localDashState = {
                    dashVx:        dvx * PLAYER_DASH_SPEED,
                    dashVy:        dvy * PLAYER_DASH_SPEED,
                    dashTicksLeft: SERVER_DASH_TICKS,
                };
            }
            // Push the dash input into the pending buffer immediately (seq already assigned)
            if (seq >= 0) {
                this._pendingInputs.push({
                    seq,
                    ...input,
                    dashVx:        this._localDashState.dashVx,
                    dashVy:        this._localDashState.dashVy,
                    dashTicksLeft: this._localDashState.dashTicksLeft,
                });
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
            this._playerHps.set(sessionId, hp);

            // Find world position of the damaged player
            let worldX, worldY;
            if (sessionId === networkManager.sessionId) {
                // Local player
                const circle = this.player?.getComponent('circle');
                worldX = circle?.gameObject?.x ?? 0;
                worldY = circle?.gameObject?.y ?? 0;

                // Update HP HUD
                const hpColor = hp > 60 ? '#88ff88' : hp > 25 ? '#ffdd44' : '#ff4444';
                this._hpText.setText(`HP: ${hp}`).setColor(hpColor);
                if (died) this._hpText.setText(`HP: ${PLAYER_HEALTH_MAX}`).setColor('#88ff88');
            } else {
                const rp = this.remotePlayers.get(sessionId);
                worldX = rp?.circle?.x ?? 0;
                worldY = rp?.circle?.y ?? 0;
            }

            this._spawnDamageFloat(worldX, worldY, damage, died);
        });

        // A remote player disconnected
        eventBus.on('network:playerLeft', ({ sessionId }) => {
            const rp = this.remotePlayers.get(sessionId);
            if (rp) {
                rp.circle.destroy();
                this.remotePlayers.delete(sessionId);
                console.log(`[Network] Remote player left: ${sessionId}`);
            }
        });
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
            snapshots: [{ timeMs: performance.now(), tick: null, x, y, stageId }],
        });
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
        const hasTick = Number.isFinite(tick);
        rp.stageId = stageId;
        rp.circle.setVisible(stageId === gameState.currentLevelId);
        if (hasTick && rp.snapshots.length > 0 && !Number.isFinite(rp.snapshots[0].tick)) {
            rp.snapshots = [];
        }
        rp.snapshots.push({
            timeMs: nowMs,
            tick: hasTick ? tick : null,
            x,
            y,
            stageId,
        });

        if (rp.snapshots.length > REMOTE_SNAPSHOT_BUFFER_SIZE) {
            rp.snapshots.splice(0, rp.snapshots.length - REMOTE_SNAPSHOT_BUFFER_SIZE);
        }
    }

    _sampleRemoteSnapshot(rp, renderTick, renderTimeMs) {
        const samples = rp.snapshots;
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
    _applyServerCorrection(serverX, serverY, serverSeq) {
        if (!this.player) return;
        const circle = this.player.getComponent('circle');
        if (!circle || !circle.gameObject || !circle.gameObject.body) return;
        const transform = this.player.getComponent('transform');

        // Drop inputs the server has already consumed (kept for telemetry/debug).
        this._pendingInputs = this._pendingInputs.filter(i => i.seq > serverSeq);
        // Use authoritative server position directly as the correction target.
        // Pending-input replay here is unstable with our current stateful-input model.
        const x = serverX;
        const y = serverY;

        // Reconciliation target minus current local state.
        // Apply bounded micro-corrections to avoid periodic hard teleports.
        const go   = circle.gameObject;
        const body = go.body;
        const currentX = body.x + body.halfWidth;
        const currentY = body.y + body.halfHeight;
        const errX = x - currentX;
        const errY = y - currentY;
        const dist = Math.sqrt(errX * errX + errY * errY);
        if (dist < LOCAL_RECONCILE_DEADZONE_PX) {
            return;
        }

        const vx = body.velocity.x;
        const vy = body.velocity.y;
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
        body.x = targetX - body.halfWidth;
        body.y = targetY - body.halfHeight;
        body.prev.x = body.x;
        body.prev.y = body.y;
        body.velocity.set(vx, vy);
        if (transform) {
            transform.position.x = targetX;
            transform.position.y = targetY;
        }
        circle._skipNextPositionUpdate = true;
    }

    setupCollisions() {
        console.log("Setting up collisions for all entities");
        
        // Get the player entity
        const playerEntity = this.player;
        
        // Get the player's physics component via its visual component
        const playerVisual = playerEntity.getComponent('circle');
        
        if (playerVisual && playerVisual.gameObject && playerVisual.gameObject.body) {
            console.log("Setting up player collisions");
            
            // Setup collisions with walls
            this.physics.add.collider(
                playerVisual.gameObject, 
                this.levelManager.collisionGroups.walls,
                null, // No callback needed for basic wall collisions
                null,
                this
            );

            // Get all exit entities and set up overlaps with each
            const exitEntities = this.entityManager.getEntitiesByType('exit');
            console.log(`Found ${exitEntities.length} exit entities for collision setup`);
            
            for (const exitEntity of exitEntities) {
                const exitVisual = exitEntity.getComponent('rectangle');
                
                if (exitVisual && exitVisual.gameObject && exitVisual.gameObject.body) {
                    // Setup overlap detection between player and this exit
                    this.physics.add.overlap(
                        playerVisual.gameObject,
                        exitVisual.gameObject,
                        () => {
                            const exitComponent = exitEntity.getComponent('exit');
                            if (exitComponent) {
                                this.exitManager.handleExit(playerEntity, exitComponent.exitIndex);
                            }
                        },
                        null, // No custom process callback needed
                        this
                    );
                    
                    console.log(`Set up overlap detection between player and exit ${exitEntity.id}`);
                } else {
                    console.warn(`Exit entity ${exitEntity.id} is missing visual component or physics body`);
                }
            }
        } else {
            console.error("Player entity missing visual component or physics body - cannot set up collisions");
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
        // Process all actions
        actionManager.processActions();

        // Update all entities
        this.entityManager.update(deltaTime);

        // Send current input state to the authoritative server.
        // If the message was actually sent (not throttled), buffer it for reconciliation.
        if (this.player) {
            const keyboard = this.player.getComponent('keyboard');
            if (keyboard) {
                const seq = networkManager.sendInput(keyboard.inputState);
                if (seq >= 0) {
                    const { up, down, left, right, sprint } = keyboard.inputState;

                    // Advance the local dash counter (mirrors server decrement each tick)
                    if (this._localDashState.dashTicksLeft > 0) {
                        this._localDashState.dashTicksLeft--;
                    }

                    this._pendingInputs.push({
                        seq,
                        up, down, left, right, sprint,
                        dashVx:        this._localDashState.dashVx,
                        dashVy:        this._localDashState.dashVy,
                        dashTicksLeft: this._localDashState.dashTicksLeft,
                    });

                    // Cap the buffer to prevent unbounded growth if the server goes silent
                    if (this._pendingInputs.length > 120) {
                        this._pendingInputs.splice(0, this._pendingInputs.length - 120);
                    }
                }
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
            ? this._latestServerTick - REMOTE_INTERPOLATION_DELAY_TICKS
            : null;
        const renderTimeMs = performance.now() - REMOTE_INTERPOLATION_DELAY_MS;
        for (const rp of this.remotePlayers.values()) {
            if (!rp.circle.visible) continue;
            const sample = this._sampleRemoteSnapshot(rp, renderTick, renderTimeMs);
            if (sample) {
                rp.circle.x = sample.x;
                rp.circle.y = sample.y;
            }
        }

        this._updateExitLabel(delta);
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

        const playerCircle = this.player.getComponent('circle');
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
