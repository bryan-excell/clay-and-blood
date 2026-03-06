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
import { PLAYER_RADIUS, TILE_SIZE } from '../config.js';
import { getLevelDisplayName } from '../world/StageDefinitions.js';
import { getExitDestination } from '@clay-and-blood/shared';

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
        eventBus.on('network:stateSnapshot', ({ players }) => {
            for (const p of players) {
                if (p.sessionId === networkManager.sessionId) {
                    this._applyServerCorrection(p.x, p.y);
                } else {
                    const rp = this.remotePlayers.get(p.sessionId);
                    if (rp) {
                        rp.targetX = p.x;
                        rp.targetY = p.y;
                        rp.stageId = p.levelId;
                        rp.circle.setVisible(p.levelId === gameState.currentLevelId);
                    } else {
                        this._addRemotePlayer(p.sessionId, p.x, p.y, p.levelId || 'town-square');
                    }
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
        });

        // A remote player fired a bullet – spawn it locally if in the same level
        eventBus.on('network:bulletFired', ({ x, y, velocityX, velocityY, levelId }) => {
            if (levelId === gameState.currentLevelId) {
                const bulletEntity = this.entityFactory.createFromPrefab('bullet', { x, y, velocityX, velocityY });
                const bulletGO = bulletEntity.getComponent('circle')?.gameObject;
                this.lightingRenderer?.maskGameObject(bulletGO);
            }
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
        // targetX/Y track the latest server position; renderUpdate lerps toward them
        this.remotePlayers.set(sessionId, { circle, stageId, targetX: x, targetY: y });
        console.log(`[Network] Remote player joined: ${sessionId} in stage ${stageId}`);
    }

    /**
     * Gently correct the local player's Phaser physics body toward the server's
     * authoritative position.  Small drift is ignored; large drift snaps immediately.
     *
     * NOTE: We move the body position WITHOUT calling body.reset(), because reset()
     * also zeroes velocity, which fights the client-side prediction and causes
     * rubber-banding.  Instead we move body.x/y directly, leaving velocity intact.
     */
    _applyServerCorrection(serverX, serverY) {
        if (!this.player) return;
        const circle = this.player.getComponent('circle');
        if (!circle || !circle.gameObject || !circle.gameObject.body) return;

        const go     = circle.gameObject;
        const body   = go.body;
        const dx     = serverX - go.x;
        const dy     = serverY - go.y;
        const distSq = dx * dx + dy * dy;

        if (distSq > 128 * 128) {
            // Very large drift – snap position, keep velocity
            go.x = serverX;
            go.y = serverY;
            body.x = serverX - body.halfWidth;
            body.y = serverY - body.halfHeight;
        } else if (distSq > 8 * 8) {
            // Small drift – nudge 20% toward server, keep velocity
            const corrX = go.x + dx * 0.2;
            const corrY = go.y + dy * 0.2;
            go.x = corrX;
            go.y = corrY;
            body.x = corrX - body.halfWidth;
            body.y = corrY - body.halfHeight;
        }
        // Under 8 px – within normal prediction error, ignore
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

        // Send current input state to the authoritative server
        if (this.player) {
            const keyboard = this.player.getComponent('keyboard');
            if (keyboard) {
                networkManager.sendInput(keyboard.inputState);
            }
        }
    }

    /**
     * Render update - interpolates remote players toward their last server position.
     * @param {number} delta - ms since last frame
     */
    renderUpdate(delta) {
        // Decay constant: remote player converges to server position in ~100 ms
        const t = 1 - Math.pow(0.01, delta / 100);

        // Smooth zoom toward target
        const cam = this.cameras.main;
        const zoomT = 1 - Math.pow(0.01, delta / 150);
        cam.setZoom(Phaser.Math.Linear(cam.zoom, this.targetZoom, zoomT));

        for (const rp of this.remotePlayers.values()) {
            if (rp.targetX !== undefined && rp.circle.visible) {
                rp.circle.x = Phaser.Math.Linear(rp.circle.x, rp.targetX, t);
                rp.circle.y = Phaser.Math.Linear(rp.circle.y, rp.targetY, t);
            }
        }

        this._updateExitLabel(delta);
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