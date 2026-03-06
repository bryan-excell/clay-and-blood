import { gameState } from "../core/GameState.js";
import { EntityLevelGenerator } from "./EntityLevelGenerator.js";
import { eventBus } from "../core/EventBus.js";
import { TILE_SIZE } from "../config.js";

/**
 * Manages entity-based levels.
 * Replaces the old StageManager with a fully entity-component approach.
 */
export class EntityLevelManager {
    /**
     * @param {Phaser.Scene} scene
     */
    constructor(scene) {
        this.scene = scene;
        this.currentLevel = null;
        this._background = null; // dark fill rect for the current level
        this.collisionGroups = {
            walls: null,
            exits: null,
        };
    }

    initialize() {
        this.collisionGroups.walls = this.scene.physics.add.staticGroup();
        this.collisionGroups.exits = this.scene.physics.add.staticGroup();
        console.log("Entity Level Manager initialized");
    }

    /**
     * Get a level by ID, creating it if it doesn't exist.
     * @param {string} levelId
     * @returns {object}
     */
    getLevel(levelId) {
        if (gameState.levels && gameState.levels[levelId]) {
            return gameState.levels[levelId];
        }

        const level = EntityLevelGenerator.createLevel(this.scene, levelId);

        if (!gameState.levels) gameState.levels = {};
        gameState.levels[levelId] = level;
        gameState.registerLevel(level);

        return level;
    }

    /**
     * Set up a level in the scene, replacing whatever is currently loaded.
     * @param {string} levelId
     * @returns {object} The level data
     */
    setupLevel(levelId) {
        console.log(`Setting up level: ${levelId}`);

        // Clear existing level entities
        this.clearCurrentLevel();

        // Destroy all non-player entities
        const playerEntity = this.scene.player;
        Object.values(this.scene.entityManager.entities)
            .filter(e => e !== playerEntity)
            .forEach(e => e.destroy());

        const level = this.getLevel(levelId);

        // Resize the physics world to match this level so the player body is
        // never clamped by a world-bounds edge smaller than the map.
        const levelW = level.width  * TILE_SIZE;
        const levelH = level.height * TILE_SIZE;
        this.scene.physics.world.setBounds(0, 0, levelW, levelH);

        // Replace (not accumulate) the dark background rectangle.
        if (this._background) this._background.destroy();
        this._background = this.scene.add.rectangle(
            levelW / 2, levelH / 2,
            levelW, levelH,
            0x222222
        ).setDepth(-20);

        this.generateLevelContent(level);

        // No camera bounds — the camera freely follows the player, keeping the
        // level centered in the viewport regardless of window size or zoom level.

        gameState.currentLevelId = levelId;
        eventBus.emit('level:transition', { levelId });
        this.currentLevel = level;

        return level;
    }

    /**
     * Generate Phaser entities for all tiles in the level.
     * @param {object} level
     */
    generateLevelContent(level) {
        console.log("Generating level content...");
        const { width: w, height: h, grid } = level;

        // Place floor entities using this level's designated floor tile
        const floorPrefab = level.floorTile ?? 'floor_dirt';
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (grid[y][x] === 0) {
                    const tileX = x * TILE_SIZE + TILE_SIZE / 2;
                    const tileY = y * TILE_SIZE + TILE_SIZE / 2;
                    const floor = this.scene.entityFactory.createFromPrefab(floorPrefab, { x: tileX, y: tileY });
                    if (!level.entities.floors) level.entities.floors = [];
                    level.entities.floors.push(floor);
                }
            }
        }

        // Place wall entities
        EntityLevelGenerator.placeWalls(this.scene, level);

        // Add walls to collision group
        if (level.entities.walls) {
            level.entities.walls.forEach(wall => {
                const visual = wall.getComponent('rectangle');
                if (visual && visual.gameObject) {
                    this.collisionGroups.walls.add(visual.gameObject);
                }
            });
            this.collisionGroups.walls.refresh();
        }

        // Rebuild exit entities from level.exits data
        if (!level.entities.exits) level.entities.exits = [];

        level.entities.exits.forEach(e => { if (e && e.destroy) e.destroy(); });
        level.entities.exits = [];

        if (level.exits && level.exits.length > 0) {
            console.log(`Creating ${level.exits.length} exits from level data`);
            level.exits.forEach(exitData => {
                const tileX = exitData.x * TILE_SIZE + TILE_SIZE / 2;
                const tileY = exitData.y * TILE_SIZE + TILE_SIZE / 2;
                const exitEntity = this.scene.entityFactory.createFromPrefab('exit', {
                    x: tileX, y: tileY, exitIndex: exitData.exitIndex
                });
                level.entities.exits.push(exitEntity);
                level.grid[exitData.y][exitData.x] = 2;
                console.log(`Created exit ${exitData.exitIndex} at (${exitData.x}, ${exitData.y})`);
            });
        } else {
            console.log("No exit data found - generating new exits");
            EntityLevelGenerator.addExits(this.scene, level);
        }

        // Add exits to collision group
        level.entities.exits.forEach(exit => {
            const visual = exit.getComponent('rectangle');
            if (visual && visual.gameObject) {
                this.collisionGroups.exits.add(visual.gameObject);
            }
        });

        console.log(
            `Level content generated: ` +
            `${level.entities.floors?.length ?? 0} floors, ` +
            `${level.entities.walls?.length ?? 0} walls, ` +
            `${level.entities.exits?.length ?? 0} exits ` +
            `(${w}×${h} tiles)`
        );
    }

    /** Clear the current level's collision groups and entity lists. */
    clearCurrentLevel() {
        if (this.collisionGroups.walls) this.collisionGroups.walls.clear(true, true);
        if (this.collisionGroups.exits) this.collisionGroups.exits.clear(true, true);

        if (this.currentLevel && this.currentLevel.entities) {
            this.currentLevel.entities = { walls: [], floors: [], exits: [] };
        }
    }

    /**
     * Connect two levels via their exits (bidirectional).
     * @param {string} level1Id
     * @param {number} exit1Index
     * @param {string} level2Id
     * @param {number} exit2Index
     */
    connectLevels(level1Id, exit1Index, level2Id, exit2Index) {
        const level1 = this.getLevel(level1Id);
        const level2 = this.getLevel(level2Id);

        if (!level1 || !level2) {
            console.error(`Cannot connect levels: ${level1Id} or ${level2Id} not found`);
            return;
        }

        const level1Exit = level1.exits.find(e => e.exitIndex === exit1Index);
        const level2Exit = level2.exits.find(e => e.exitIndex === exit2Index);

        if (!level1Exit) {
            console.error(`Exit ${exit1Index} not found in level ${level1Id}`);
            return;
        }
        if (!level2Exit) {
            console.error(`Exit ${exit2Index} not found in level ${level2Id}`);
            return;
        }

        if (!level1.exitConnections) level1.exitConnections = {};
        if (!level2.exitConnections) level2.exitConnections = {};

        level1.exitConnections[exit1Index] = { levelId: level2Id, exitIndex: exit2Index };
        level2.exitConnections[exit2Index] = { levelId: level1Id, exitIndex: exit1Index };

        console.log(`Connection established: ${level1Id}#${exit1Index} ↔ ${level2Id}#${exit2Index}`);

        if (gameState.levels) {
            gameState.levels[level1Id] = level1;
            gameState.levels[level2Id] = level2;
        }
    }
}
