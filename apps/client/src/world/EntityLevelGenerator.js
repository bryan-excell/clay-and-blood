import { getStageData } from '@clay-and-blood/shared';
import { TILE_SIZE } from "../config.js";
import { getStageDefinition } from "./StageDefinitions.js";

/**
 * EntityLevelGenerator
 *
 * createLevel() resolves the stage definition (static or random), then
 * either loads the hand-authored tile layout or delegates to the shared
 * generateLevelData() so the layout is bit-for-bit identical on the server
 * and every client.
 *
 * The Phaser entity methods (placeWalls, addExits, createExitAtPosition)
 * remain here because they need scene context.
 */
export class EntityLevelGenerator {

    /**
     * Create and return a level data object.
     * For random stages, grid/exit positions come from the canonical shared generator.
     * For static stages, the hand-authored tile layout is used directly.
     * No Phaser entities are created here – that happens in EntityLevelManager.
     *
     * @param {Phaser.Scene} scene
     * @param {string} levelId
     * @returns {object} level data
     */
    static createLevel(scene, levelId) {
        console.log(`Creating new level: ${levelId}`);
        const def = getStageDefinition(levelId);

        let grid, exits, width, height;

        if (def.kind === 'static') {
            // Use the hand-authored layout verbatim
            width  = def.width;
            height = def.height;
            // Deep-copy so callers can mutate without corrupting the definition
            grid  = def.tiles.map(row => [...row]);
            exits = def.exits.map(e => ({ ...e }));
        } else {
            // Procedurally generated, deterministic from levelId seed
            ({ grid, exits, width, height } = getStageData(levelId, {
                width:  def.width,
                height: def.height,
            }));
        }

        // Pre-wire any named connections declared in the stage definition
        const exitConnections = {};
        if (def.connections) {
            Object.assign(exitConnections, def.connections);
        }

        return {
            id:              levelId,
            stageSlug:       def.stageSlug ?? levelId,
            stageUuid:       def.stageUuid ?? null,
            type:            def.kind === 'static' ? 'static' : 'random',
            kind:            def.kind ?? 'procedural',
            displayName:     def.displayName ?? null,
            regionId:        def.regionId ?? null,
            tags:            Array.isArray(def.tags) ? [...def.tags] : [],
            width,
            height,
            floorTile:       def.floorTile  ?? 'floor_dirt',
            spawnPoint:      def.spawnPoint ?? null,
            entities:        { walls: [], floors: [], exits: [] },
            grid,
            exits,
            exitConnections,
        };
    }

    // ── Phaser entity creation ────────────────────────────────────────────

    /**
     * Place wall entities for every wall cell that borders a floor/exit cell.
     * @param {Phaser.Scene} scene
     * @param {object} level
     */
    static placeWalls(scene, level) {
        const { width: w, height: h, grid } = level;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (grid[y][x] !== 1) continue;

                // Only create a visible wall if it borders walkable open space.
                // Out-of-bounds and void tiles (3) are treated as solid — they do
                // not trigger wall creation so that irregular-shaped levels don't
                // sprout walls along their void boundary.
                let shouldCreate = false;
                outer: for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                        const neighbor = grid[ny][nx];
                        if (neighbor === 0 || neighbor === 2) {
                            shouldCreate = true;
                            break outer;
                        }
                    }
                }

                if (shouldCreate) {
                    const tileX = x * TILE_SIZE + TILE_SIZE / 2;
                    const tileY = y * TILE_SIZE + TILE_SIZE / 2;
                    const wall  = scene.entityFactory.createFromPrefab('wall_stone', { x: tileX, y: tileY });
                    level.entities.walls.push(wall);
                }
            }
        }
    }

    /**
     * Fallback exit generator – only used when level.exits is empty.
     * Normally exits come from generateLevelData() in the shared package.
     * @param {Phaser.Scene} scene
     * @param {object} level
     * @param {object[]|null} targetExits
     */
    static addExits(scene, level, targetExits = null) {
        if (targetExits && targetExits.length > 0) {
            targetExits.forEach(exitData => {
                this.createExitAtPosition(scene, level, exitData.x, exitData.y, exitData.exitIndex, exitData.id ?? null);
            });
            return;
        }

        const { width: w, height: h, grid } = level;
        const potentialExits = [];
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                if (grid[y][x] === 0 &&
                    (grid[y-1][x] === 1 || grid[y+1][x] === 1 ||
                     grid[y][x-1] === 1 || grid[y][x+1] === 1)) {
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
     * Create a single exit Phaser entity and record it in level data.
     * @param {Phaser.Scene} scene
     * @param {object} level
     * @param {number} x  grid x
     * @param {number} y  grid y
     * @param {number} exitIndex
     */
    static createExitAtPosition(scene, level, x, y, exitIndex, exitId = null) {
        const existing = level.exits.findIndex(e => e.exitIndex === exitIndex);
        if (existing !== -1) level.exits.splice(existing, 1);

        if (level.grid[y]) level.grid[y][x] = 2;

        const tileX      = x * TILE_SIZE + TILE_SIZE / 2;
        const tileY      = y * TILE_SIZE + TILE_SIZE / 2;
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
