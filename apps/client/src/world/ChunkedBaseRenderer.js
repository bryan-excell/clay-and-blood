import Phaser from 'phaser';
import { getTileProperties, tileHasTag } from '@clay-and-blood/shared';
import {
    BASE_RENDER_CHUNK_TILES,
    STAGE_RENDER_DEPTH,
    TILE_SIZE,
} from '../config.js';

const FLOOR_STYLE_BY_PREFAB = Object.freeze({
    floor_dirt: Object.freeze({ fill: 0x2a1808 }),
    floor_grass: Object.freeze({ fill: 0x24381b }),
});

const TILE_FILL_BY_ID = Object.freeze({
    exit: 0x345821,
    tall_grass: 0x29441f,
    shallow_water: 0x1b3046,
});

const WALL_STYLE = Object.freeze({
    fill: 0x1e2418,
    stroke: 0x131a0e,
    strokeWidth: 2,
});
const CHUNK_OVERDRAW_PX = 1;

export class ChunkedBaseRenderer {
    constructor(scene, stageData, options = {}) {
        this.scene = scene;
        this.stageData = stageData;
        this.chunkTiles = Math.max(1, Math.floor(options.chunkTiles ?? BASE_RENDER_CHUNK_TILES));
        this.floorStyle = FLOOR_STYLE_BY_PREFAB[stageData?.floorTile] ?? FLOOR_STYLE_BY_PREFAB.floor_dirt;
        this._builder = scene.make.graphics({ add: false });
        this._activeChunks = new Map();
        this._chunkColumns = Math.ceil((stageData?.width ?? 0) / this.chunkTiles);
        this._chunkRows = Math.ceil((stageData?.height ?? 0) / this.chunkTiles);
        this._lastVisibleKey = null;
    }

    update(camera) {
        if (!camera || !this.stageData?.grid) return;
        const chunkWorldSize = this.chunkTiles * TILE_SIZE;
        const scrollX = camera.scrollX;
        const scrollY = camera.scrollY;
        const viewW = camera.width / camera.zoom;
        const viewH = camera.height / camera.zoom;
        const minChunkX = Math.max(0, Math.floor(scrollX / chunkWorldSize) - 1);
        const maxChunkX = Math.min(this._chunkColumns - 1, Math.floor((scrollX + viewW - 1) / chunkWorldSize) + 1);
        const minChunkY = Math.max(0, Math.floor(scrollY / chunkWorldSize) - 1);
        const maxChunkY = Math.min(this._chunkRows - 1, Math.floor((scrollY + viewH - 1) / chunkWorldSize) + 1);
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
                if (properties.solid || tileHasTag(tile, 'out_of_bounds')) continue;
                hasFloor = true;
                const fill = TILE_FILL_BY_ID[properties.id] ?? this.floorStyle.fill;
                this._builder.fillStyle(fill, 1);
                const localX = (x - tileStartX) * TILE_SIZE + bleedLeft;
                const localY = (y - tileStartY) * TILE_SIZE + bleedTop;
                this._builder.fillRect(
                    localX - CHUNK_OVERDRAW_PX,
                    localY - CHUNK_OVERDRAW_PX,
                    TILE_SIZE + CHUNK_OVERDRAW_PX * 2,
                    TILE_SIZE + CHUNK_OVERDRAW_PX * 2
                );
            }
        }
        if (hasFloor) floorTexture.draw(this._builder);

        this._builder.clear();
        this._builder.fillStyle(WALL_STYLE.fill, 1);
        this._builder.lineStyle(WALL_STYLE.strokeWidth, WALL_STYLE.stroke, 1);
        let hasWall = false;
        for (let y = tileStartY; y < tileEndY; y++) {
            for (let x = tileStartX; x < tileEndX; x++) {
                const tile = this.stageData.grid[y]?.[x];
                if (!getTileProperties(tile).solid || !tileHasTag(tile, 'structure')) continue;
                if (!this._isVisibleWall(x, y)) continue;
                hasWall = true;
                const localX = (x - tileStartX) * TILE_SIZE + bleedLeft;
                const localY = (y - tileStartY) * TILE_SIZE + bleedTop;
                this._builder.fillRect(localX, localY, TILE_SIZE, TILE_SIZE);
                this._builder.strokeRect(localX, localY, TILE_SIZE, TILE_SIZE);
            }
        }
        if (hasWall) wallTexture.draw(this._builder);

        return { floor: floorTexture, wall: wallTexture };
    }

    _isVisibleWall(x, y) {
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
}
