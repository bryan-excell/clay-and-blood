import { gameState } from "../core/GameState.js";
import { EntityLevelGenerator } from "./EntityLevelGenerator.js";
import { eventBus } from "../core/EventBus.js";
import { STAGE_RENDER_DEPTH, TILE_SIZE } from "../config.js";
import { ChunkedBaseRenderer } from "./ChunkedBaseRenderer.js";
import { StageResidencyManager } from "./StageResidencyManager.js";
import { TerrainDecorationRenderer } from "./TerrainDecorationRenderer.js";

/**
 * Manages stage data and render state.
 * Static terrain is rendered by ChunkedBaseRenderer, not ECS tile entities.
 */
export class EntityLevelManager {
    constructor(scene) {
        this.scene = scene;
        this.currentLevel = null;
        this._background = null;
        this._currentRenderState = null;
        this._stageResidency = new StageResidencyManager({ maxStageData: 30 });
    }

    initialize() {
        console.log("Entity Level Manager initialized");
    }

    getLevel(levelId) {
        const cached = this._stageResidency.get(levelId);
        if (cached) return cached;

        const level = EntityLevelGenerator.createLevel(this.scene, levelId);
        gameState.registerLevel(level);
        this._stageResidency.set(level, gameState.currentLevelId ?? levelId);
        return level;
    }

    setupLevel(levelId) {
        console.log(`Setting up level: ${levelId}`);

        this.clearCurrentLevel();

        const playerEntity = this.scene.player;
        const controlledEntity = this.scene.controlledEntity;
        Object.values(this.scene.entityManager.entities)
            .filter((e) => e !== playerEntity && e !== controlledEntity)
            .forEach((e) => e.destroy());

        const level = this.getLevel(levelId);

        const levelW = level.width * TILE_SIZE;
        const levelH = level.height * TILE_SIZE;
        this.scene.physics.world.setBounds(0, 0, levelW, levelH);

        if (this._background) this._background.destroy();
        this._background = this.scene.add.rectangle(levelW / 2, levelH / 2, levelW, levelH, 0x0d120a, 1)
            .setDepth(STAGE_RENDER_DEPTH.floor - 1);

        this.generateLevelContent(level);

        gameState.currentLevelId = levelId;
        eventBus.emit('level:transition', { levelId });
        this.currentLevel = level;
        this._stageResidency.set(level, levelId);

        return level;
    }

    generateLevelContent(level) {
        console.log("Generating level content...");
        const { width: w, height: h } = level;

        this._currentRenderState = {
            stageSlug: level.id,
            baseRenderer: new ChunkedBaseRenderer(this.scene, level),
            decorationRenderer: new TerrainDecorationRenderer(this.scene, level),
        };
        this._currentRenderState.baseRenderer.update(this.scene.cameras.main);
        this._currentRenderState.decorationRenderer.update(this.scene.cameras.main);

        level.entities.exits?.forEach((e) => e?.destroy?.());
        level.entities.exits = [];

        if (level.exits && level.exits.length > 0) {
            console.log(`Creating ${level.exits.length} exits from level data`);
            level.exits.forEach((exitData) => {
                const tileX = exitData.x * TILE_SIZE + TILE_SIZE / 2;
                const tileY = exitData.y * TILE_SIZE + TILE_SIZE / 2;
                const exitEntity = this.scene.entityFactory.createFromPrefab('exit', {
                    x: tileX,
                    y: tileY,
                    exitIndex: exitData.exitIndex,
                    exitId: exitData.id ?? null,
                });
                level.entities.exits.push(exitEntity);
                console.log(`Created exit ${exitData.exitIndex} at (${exitData.x}, ${exitData.y})`);
            });
        } else {
            console.log("No exit data found - generating new exits");
            EntityLevelGenerator.addExits(this.scene, level);
        }

        console.log(
            `Level content generated: chunked terrain, ${level.entities.exits?.length ?? 0} exits (${w}x${h} tiles)`
        );
    }

    clearCurrentLevel() {
        this._currentRenderState?.baseRenderer?.destroy?.();
        this._currentRenderState?.decorationRenderer?.destroy?.();
        this._currentRenderState = null;

        if (this._background) {
            this._background.destroy();
            this._background = null;
        }

        if (this.currentLevel?.entities?.exits) {
            this.currentLevel.entities.exits.forEach((entity) => entity?.destroy?.());
            this.currentLevel.entities.exits = [];
        }
    }

    connectLevels(level1Id, exit1Index, level2Id, exit2Index) {
        const level1 = this.getLevel(level1Id);
        const level2 = this.getLevel(level2Id);

        if (!level1 || !level2) {
            console.error(`Cannot connect levels: ${level1Id} or ${level2Id} not found`);
            return;
        }

        const level1Exit = level1.exits.find((e) => e.exitIndex === exit1Index);
        const level2Exit = level2.exits.find((e) => e.exitIndex === exit2Index);

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

        level1.exitConnections[exit1Index] = {
            levelId: level2Id,
            exitIndex: exit2Index,
            exitId: level2Exit.id ?? null,
            arrivalDirection: null,
            entryDirection: null,
        };
        level2.exitConnections[exit2Index] = {
            levelId: level1Id,
            exitIndex: exit1Index,
            exitId: level1Exit.id ?? null,
            arrivalDirection: null,
            entryDirection: null,
        };

        this._stageResidency.rememberConnection(level1Id, exit1Index, level1.exitConnections[exit1Index], level1.kind);
        this._stageResidency.rememberConnection(level2Id, exit2Index, level2.exitConnections[exit2Index], level2.kind);
        this._stageResidency.set(level1, gameState.currentLevelId ?? level1Id);
        this._stageResidency.set(level2, gameState.currentLevelId ?? level2Id);

        console.log(`Connection established: ${level1Id}#${exit1Index} <-> ${level2Id}#${exit2Index}`);
    }

    update(camera) {
        this._currentRenderState?.baseRenderer?.update?.(camera);
        this._currentRenderState?.decorationRenderer?.update?.(camera);
    }
}
