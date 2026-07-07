import { getTileProperties, tileHasTag } from '@clay-and-blood/shared';
import {
    BASE_RENDER_CHUNK_TILES,
    STAGE_RENDER_DEPTH,
    TILE_SIZE,
} from '../config.js';
import { TERRAIN_MATERIAL, sampleField } from './TerrainFieldCompiler.js';
import { getTerrainMaterialTextureKey } from './TerrainMaterialRegistry.js';
import { zonePalette } from './ZonePalette.js';
import { resolveCameraWorldView } from './CameraWorldView.js';

const FLOOR_STYLE_BY_PREFAB = Object.freeze({
    floor_dirt: Object.freeze({ fill: 0x162038 }),
    floor_grass: Object.freeze({ fill: 0x1a2d35 }),
});

const TILE_FILL_BY_ID = Object.freeze({
    exit: 0x294a6e,
    tall_grass: 0x1f3b46,
    shallow_water: 0x1b3046,
});

const WALL_STYLE = Object.freeze({
    fill: 0x10182b,
});
const CHUNK_OVERDRAW_PX = 1;
const CAMERA_CHUNK_MARGIN = 2;

export class ChunkedBaseRenderer {
    constructor(scene, stageData, options = {}) {
        this.scene = scene;
        this.stageData = stageData;
        this.terrainFields = options.terrainFields ?? stageData?.terrainFields ?? null;
        this.chunkTiles = Math.max(1, Math.floor(options.chunkTiles ?? BASE_RENDER_CHUNK_TILES));
        this.floorStyle = FLOOR_STYLE_BY_PREFAB[stageData?.floorTile] ?? FLOOR_STYLE_BY_PREFAB.floor_dirt;
        this._builder = scene.make.graphics({ add: false });
        this._activeChunks = new Map();
        this._chunkColumns = Math.ceil((stageData?.width ?? 0) / this.chunkTiles);
        this._chunkRows = Math.ceil((stageData?.height ?? 0) / this.chunkTiles);
        this._lastVisibleKey = null;
        this._materialFrameCache = new Map();
    }

    update(camera) {
        if (!camera || !this.stageData?.grid) return;
        if (this._chunkColumns <= 0 || this._chunkRows <= 0) return;
        const chunkWorldSize = this.chunkTiles * TILE_SIZE;
        const view = resolveCameraWorldView(camera);
        const minChunkX = Math.max(0, Math.floor(view.x / chunkWorldSize) - CAMERA_CHUNK_MARGIN);
        const maxChunkX = Math.min(this._chunkColumns - 1, Math.floor((view.x + view.width - 1) / chunkWorldSize) + CAMERA_CHUNK_MARGIN);
        const minChunkY = Math.max(0, Math.floor(view.y / chunkWorldSize) - CAMERA_CHUNK_MARGIN);
        const maxChunkY = Math.min(this._chunkRows - 1, Math.floor((view.y + view.height - 1) / chunkWorldSize) + CAMERA_CHUNK_MARGIN);
        const visibleKey = `${minChunkX}:${maxChunkX}:${minChunkY}:${maxChunkY}`;
        if (this._lastVisibleKey === visibleKey) return;
        this._lastVisibleKey = visibleKey;

        const nextActive = new Set();
        for (let cy = minChunkY; cy <= maxChunkY; cy++) {
            for (let cx = minChunkX; cx <= maxChunkX; cx++) {
                const key = this._chunkKey(cx, cy);
                nextActive.add(key);
                if (!this._activeChunks.has(key)) {
                    this._activeChunks.set(key, this._createChunk(cx, cy));
                }
            }
        }

        for (const [key, chunk] of this._activeChunks.entries()) {
            if (nextActive.has(key)) continue;
            chunk.floor?.destroy();
            chunk.wall?.destroy();
            this._activeChunks.delete(key);
        }
    }

    destroy() {
        for (const chunk of this._activeChunks.values()) {
            chunk.floor?.destroy();
            chunk.wall?.destroy();
        }
        this._activeChunks.clear();
        this._materialFrameCache.clear();
        this._builder?.destroy();
        this._builder = null;
    }

    _chunkKey(chunkX, chunkY) {
        return `${chunkX}:${chunkY}`;
    }

    _createChunk(chunkX, chunkY) {
        const tileStartX = chunkX * this.chunkTiles;
        const tileStartY = chunkY * this.chunkTiles;
        const tileEndX = Math.min(this.stageData.width, tileStartX + this.chunkTiles);
        const tileEndY = Math.min(this.stageData.height, tileStartY + this.chunkTiles);
        const bleedLeft = chunkX > 0 ? CHUNK_OVERDRAW_PX : 0;
        const bleedRight = chunkX < this._chunkColumns - 1 ? CHUNK_OVERDRAW_PX : 0;
        const bleedTop = chunkY > 0 ? CHUNK_OVERDRAW_PX : 0;
        const bleedBottom = chunkY < this._chunkRows - 1 ? CHUNK_OVERDRAW_PX : 0;
        const pixelWidth = (tileEndX - tileStartX) * TILE_SIZE + bleedLeft + bleedRight;
        const pixelHeight = (tileEndY - tileStartY) * TILE_SIZE + bleedTop + bleedBottom;
        const originX = tileStartX * TILE_SIZE - bleedLeft;
        const originY = tileStartY * TILE_SIZE - bleedTop;

        const floorTexture = this.scene.add.renderTexture(originX, originY, pixelWidth, pixelHeight)
            .setOrigin(0, 0)
            .setDepth(STAGE_RENDER_DEPTH.floor);
        const wallTexture = this.scene.add.renderTexture(originX, originY, pixelWidth, pixelHeight)
            .setOrigin(0, 0)
            .setDepth(STAGE_RENDER_DEPTH.wall);

        this._builder.clear();
        let hasFloor = false;
        for (let y = tileStartY; y < tileEndY; y++) {
            for (let x = tileStartX; x < tileEndX; x++) {
                const tile = this.stageData.grid[y]?.[x];
                const properties = getTileProperties(tile);
                if (this._isSolidAt(x, y, tile)) continue;
                hasFloor = true;
                const material = this._materialAt(x, y, tile);
                const fill = this._resolveFloorFill(properties.id, material);
                const localX = (x - tileStartX) * TILE_SIZE + bleedLeft;
                const localY = (y - tileStartY) * TILE_SIZE + bleedTop;
                if (!this._drawMaterialTextureTile(floorTexture, material, localX, localY, x, y)) {
                    this._builder.fillStyle(fill, 1);
                    this._builder.fillRect(
                        localX - CHUNK_OVERDRAW_PX,
                        localY - CHUNK_OVERDRAW_PX,
                        TILE_SIZE + CHUNK_OVERDRAW_PX * 2,
                        TILE_SIZE + CHUNK_OVERDRAW_PX * 2
                    );
                }
            }
        }
        if (hasFloor) floorTexture.draw(this._builder);

        this._builder.clear();
        let hasWall = false;
        for (let y = tileStartY; y < tileEndY; y++) {
            for (let x = tileStartX; x < tileEndX; x++) {
                const tile = this.stageData.grid[y]?.[x];
                if (!this._isStructuralWallAt(x, y, tile)) continue;
                if (!this._isVisibleWall(x, y)) continue;
                hasWall = true;
                const localX = (x - tileStartX) * TILE_SIZE + bleedLeft;
                const localY = (y - tileStartY) * TILE_SIZE + bleedTop;
                this._builder.fillStyle(zonePalette.resolveColor('deep', WALL_STYLE.fill), 1);
                this._builder.fillRect(localX, localY, TILE_SIZE, TILE_SIZE);
            }
        }
        if (hasWall) wallTexture.draw(this._builder);

        return { floor: floorTexture, wall: wallTexture };
    }

    _isVisibleWall(x, y) {
        if (this.terrainFields) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    if (this._isOpenTile(x + dx, y + dy)) return true;
                }
            }
            return false;
        }
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= this.stageData.width || ny >= this.stageData.height) continue;
                const neighbor = this.stageData.grid[ny]?.[nx];
                const properties = getTileProperties(neighbor);
                if (!properties.solid && !tileHasTag(neighbor, 'out_of_bounds')) return true;
            }
        }
        return false;
    }

    _drawMaterialTextureTile(renderTexture, material, localX, localY, tileX, tileY) {
        const key = getTerrainMaterialTextureKey(material);
        if (!key || !this.scene.textures.exists(key)) return false;
        const frameName = this._getMaterialTileFrameName(key, tileX, tileY);
        if (!frameName) return false;
        renderTexture.drawFrame(key, frameName, localX, localY);
        return true;
    }

    _getMaterialTileFrameName(key, tileX, tileY) {
        const texture = this.scene.textures.get(key);
        const baseFrame = this.scene.textures.getFrame(key, '__BASE') ?? this.scene.textures.getFrame(key);
        if (!texture || !baseFrame?.width || !baseFrame?.height) return null;

        const columns = Math.floor(baseFrame.width / TILE_SIZE);
        const rows = Math.floor(baseFrame.height / TILE_SIZE);
        if (columns <= 0 || rows <= 0) return null;

        const frameX = positiveModulo(tileX, columns);
        const frameY = positiveModulo(tileY, rows);
        const frameName = `tile-${TILE_SIZE}-${frameX}-${frameY}`;
        const cacheKey = `${key}:${frameName}`;
        if (!this._materialFrameCache.has(cacheKey)) {
            if (!texture.has(frameName)) {
                texture.add(
                    frameName,
                    0,
                    frameX * TILE_SIZE,
                    frameY * TILE_SIZE,
                    TILE_SIZE,
                    TILE_SIZE
                );
            }
            this._materialFrameCache.set(cacheKey, frameName);
        }
        return frameName;
    }

    _resolveFloorFill(tileId, material = null) {
        const palette = zonePalette.getActivePalette();
        if (tileId === 'exit') return palette.surface ?? TILE_FILL_BY_ID.exit;
        if (material === TERRAIN_MATERIAL.grass || tileId === 'tall_grass') return 0x203746;
        if (material === TERRAIN_MATERIAL.water || tileId === 'shallow_water') return 0x172b45;
        return palette.shadow ?? this.floorStyle.fill;
    }

    _isOpenTile(x, y) {
        if (x < 0 || y < 0 || x >= this.stageData.width || y >= this.stageData.height) return false;
        if (this.terrainFields) return sampleField(this.terrainFields, 'solid', x, y, 1) === 0;
        const tile = this.stageData.grid[y]?.[x];
        const properties = getTileProperties(tile);
        return !properties.solid && !tileHasTag(tile, 'out_of_bounds');
    }

    _materialAt(x, y, tile) {
        if (this.terrainFields) {
            return sampleField(this.terrainFields, 'material', x, y, TERRAIN_MATERIAL.floor);
        }
        const id = getTileProperties(tile).id;
        if (id === 'tall_grass') return TERRAIN_MATERIAL.grass;
        if (id === 'shallow_water') return TERRAIN_MATERIAL.water;
        if (id === 'wall') return TERRAIN_MATERIAL.wall;
        if (id === 'exit') return TERRAIN_MATERIAL.exit;
        if (id === 'floor') return TERRAIN_MATERIAL.floor;
        if (tileHasTag(tile, 'out_of_bounds')) return TERRAIN_MATERIAL.void;
        return TERRAIN_MATERIAL.floor;
    }

    _isSolidAt(x, y, tile) {
        if (this.terrainFields) return sampleField(this.terrainFields, 'solid', x, y, 1) === 1;
        const properties = getTileProperties(tile);
        return properties.solid || tileHasTag(tile, 'out_of_bounds');
    }

    _isStructuralWallAt(x, y, tile) {
        if (this.terrainFields) return sampleField(this.terrainFields, 'material', x, y, TERRAIN_MATERIAL.void) === TERRAIN_MATERIAL.wall;
        return getTileProperties(tile).solid && tileHasTag(tile, 'structure');
    }

}

function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}
