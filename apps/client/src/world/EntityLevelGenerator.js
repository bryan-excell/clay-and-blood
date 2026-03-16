import { getStageData } from '@clay-and-blood/shared';
import { TILE_SIZE } from "../config.js";
import { getStageDefinition } from "./StageDefinitions.js";

/**
 * Resolves shared stage data into client runtime stage data.
 * Static terrain is rendered separately by ChunkedBaseRenderer.
 */
export class EntityLevelGenerator {
    /**
     * @param {Phaser.Scene} scene
     * @param {string} levelId
     * @returns {object}
     */
    static createLevel(scene, levelId) {
        console.log(`Creating new level: ${levelId}`);
        const def = getStageDefinition(levelId);

        let grid, exits, width, height;

        if (def.kind === 'static') {
            width = def.width;
            height = def.height;
            grid = def.tiles.map((row) => [...row]);
            exits = def.exits.map((e) => ({ ...e }));
        } else {
            ({ grid, exits, width, height } = getStageData(levelId, {
                width: def.width,
                height: def.height,
            }));
        }

        const exitConnections = {};
        if (def.connections) {
            Object.assign(exitConnections, def.connections);
        }

        return {
            id: levelId,
            stageSlug: def.stageSlug ?? levelId,
            stageUuid: def.stageUuid ?? null,
            type: def.kind === 'static' ? 'static' : 'random',
            kind: def.kind ?? 'procedural',
            displayName: def.displayName ?? null,
            regionId: def.regionId ?? null,
            tags: Array.isArray(def.tags) ? [...def.tags] : [],
            width,
            height,
            floorTile: def.floorTile ?? 'floor_dirt',
            spawnPoint: def.spawnPoint ?? null,
            terrainFeatures: Array.isArray(def.terrainFeatures)
                ? def.terrainFeatures.map((feature) => ({
                    ...feature,
                    cells: Array.isArray(feature.cells) ? feature.cells.map((cell) => ({ ...cell })) : undefined,
                    rect: feature.rect ? { ...feature.rect } : null,
                    tags: Array.isArray(feature.tags) ? [...feature.tags] : [],
                }))
                : [],
            entities: { exits: [] },
            grid,
            exits,
            exitConnections,
        };
    }

    /**
     * Fallback exit generator – only used when level.exits is empty.
     * @param {Phaser.Scene} scene
     * @param {object} level
     * @param {object[]|null} targetExits
     */
    static addExits(scene, level, targetExits = null) {
        if (targetExits && targetExits.length > 0) {
            targetExits.forEach((exitData) => {
                this.createExitAtPosition(scene, level, exitData.x, exitData.y, exitData.exitIndex, exitData.id ?? null);
            });
            return;
        }

        const { width: w, height: h, grid } = level;
        const potentialExits = [];
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                if (grid[y][x] === 0 &&
                    (grid[y - 1][x] === 1 || grid[y + 1][x] === 1 ||
                     grid[y][x - 1] === 1 || grid[y][x + 1] === 1)) {
                    potentialExits.push({ x, y });
                }
            }
        }

        if (potentialExits.length === 0) {
            potentialExits.push({ x: Math.floor(w / 2), y: Math.floor(h / 2) });
        }

        const numExits = Math.max(1, Math.min(3, Math.floor(Math.random() * 3) + 1));
        potentialExits.slice(0, numExits).forEach((exit, index) => {
            this.createExitAtPosition(scene, level, exit.x, exit.y, index);
        });
    }

    /**
     * @param {Phaser.Scene} scene
     * @param {object} level
     * @param {number} x
     * @param {number} y
     * @param {number} exitIndex
     * @param {string|null} exitId
     */
    static createExitAtPosition(scene, level, x, y, exitIndex, exitId = null) {
        const existing = level.exits.findIndex((e) => e.exitIndex === exitIndex);
        if (existing !== -1) level.exits.splice(existing, 1);

        if (level.grid[y]) level.grid[y][x] = 2;

        const tileX = x * TILE_SIZE + TILE_SIZE / 2;
        const tileY = y * TILE_SIZE + TILE_SIZE / 2;
        const exitEntity = scene.entityFactory.createFromPrefab('exit', { x: tileX, y: tileY, exitIndex, exitId });

        if (!exitEntity) {
            console.error(`Failed to create exit entity at ${x},${y} index ${exitIndex}`);
            return;
        }

        if (!level.entities.exits) level.entities.exits = [];
        level.entities.exits.push(exitEntity);
        level.exits.push({ x, y, exitIndex, id: exitId });

        console.log(`Created exit ${exitIndex} at grid (${x}, ${y}), world (${tileX}, ${tileY})`);
    }
}
