import Phaser from 'phaser';
import {
    TILE_SHALLOW_WATER,
    TILE_TALL_GRASS,
} from '@clay-and-blood/shared';
import {
    BASE_RENDER_CHUNK_TILES,
    STAGE_RENDER_DEPTH,
    TILE_SIZE,
} from '../config.js';

const FEATURE_TYPE_TO_DECORATION = Object.freeze({
    grass_patch: 'tall_grass',
    tall_grass_patch: 'tall_grass',
    water_pool: 'shallow_water',
    shallow_water_pool: 'shallow_water',
});

export class TerrainDecorationRenderer {
    constructor(scene, stageData, options = {}) {
        this.scene = scene;
        this.stageData = stageData;
        this.chunkTiles = Math.max(1, Math.floor(options.chunkTiles ?? BASE_RENDER_CHUNK_TILES));
        this._builder = scene.make.graphics({ add: false });
        this._activeChunks = new Map();
        this._chunkColumns = Math.ceil((stageData?.width ?? 0) / this.chunkTiles);
        this._chunkRows = Math.ceil((stageData?.height ?? 0) / this.chunkTiles);
        this._lastVisibleKey = null;
        this._featureCells = this._buildFeatureCells(stageData?.terrainFeatures ?? []);
        this._hasDecorations = this._stageHasDecorations();
    }

    update(camera) {
        if (!camera || !this._hasDecorations) return;
        const chunkWorldSize = this.chunkTiles * TILE_SIZE;
        const worldView = camera.worldView;
        const minChunkX = Math.max(0, Math.floor(worldView.x / chunkWorldSize) - 1);
        const maxChunkX = Math.min(this._chunkColumns - 1, Math.floor((worldView.right - 1) / chunkWorldSize) + 1);
        const minChunkY = Math.max(0, Math.floor(worldView.y / chunkWorldSize) - 1);
        const maxChunkY = Math.min(this._chunkRows - 1, Math.floor((worldView.bottom - 1) / chunkWorldSize) + 1);
        const visibleKey = `${minChunkX}:${maxChunkX}:${minChunkY}:${maxChunkY}`;
        if (visibleKey === this._lastVisibleKey) return;
        this._lastVisibleKey = visibleKey;

        const nextActive = new Set();
        for (let cy = minChunkY; cy <= maxChunkY; cy++) {
            for (let cx = minChunkX; cx <= maxChunkX; cx++) {
                const key = this._chunkKey(cx, cy);
                nextActive.add(key);
                if (!this._activeChunks.has(key)) {
                    const chunk = this._createChunk(cx, cy);
                    if (chunk) this._activeChunks.set(key, chunk);
                }
            }
        }

        for (const [key, chunk] of this._activeChunks.entries()) {
            if (nextActive.has(key)) continue;
            chunk.overlay?.destroy();
            this._activeChunks.delete(key);
        }
    }

    destroy() {
        for (const chunk of this._activeChunks.values()) {
            chunk.overlay?.destroy();
        }
        this._activeChunks.clear();
        this._builder?.destroy();
        this._builder = null;
    }

    _chunkKey(chunkX, chunkY) {
        return `${chunkX}:${chunkY}`;
    }

    _buildFeatureCells(features) {
        const cells = new Map();
        for (const feature of features) {
            const decoration = FEATURE_TYPE_TO_DECORATION[feature?.type];
            if (!decoration) continue;
            for (const cell of this._expandFeatureCells(feature)) {
                const key = `${cell.x}:${cell.y}`;
                if (!cells.has(key)) cells.set(key, new Set());
                cells.get(key).add(decoration);
            }
        }
        return cells;
    }

    _expandFeatureCells(feature) {
        const cells = [];
        if (Array.isArray(feature?.cells)) {
            for (const cell of feature.cells) {
                if (!Number.isFinite(cell?.x) || !Number.isFinite(cell?.y)) continue;
                cells.push({ x: Math.floor(cell.x), y: Math.floor(cell.y) });
            }
        }
        if (feature?.rect && Number.isFinite(feature.rect.x) && Number.isFinite(feature.rect.y) &&
            Number.isFinite(feature.rect.width) && Number.isFinite(feature.rect.height)) {
            const startX = Math.floor(feature.rect.x);
            const startY = Math.floor(feature.rect.y);
            const endX = Math.ceil(feature.rect.x + feature.rect.width);
            const endY = Math.ceil(feature.rect.y + feature.rect.height);
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    cells.push({ x, y });
                }
            }
        }
        return cells;
    }

    _stageHasDecorations() {
        if (this._featureCells.size > 0) return true;
        for (let y = 0; y < (this.stageData?.height ?? 0); y++) {
            for (let x = 0; x < (this.stageData?.width ?? 0); x++) {
                const tile = this.stageData.grid?.[y]?.[x];
                if (tile === TILE_TALL_GRASS || tile === TILE_SHALLOW_WATER) return true;
            }
        }
        return false;
    }

    _createChunk(chunkX, chunkY) {
        const tileStartX = chunkX * this.chunkTiles;
        const tileStartY = chunkY * this.chunkTiles;
        const tileEndX = Math.min(this.stageData.width, tileStartX + this.chunkTiles);
        const tileEndY = Math.min(this.stageData.height, tileStartY + this.chunkTiles);
        const pixelWidth = (tileEndX - tileStartX) * TILE_SIZE;
        const pixelHeight = (tileEndY - tileStartY) * TILE_SIZE;
        const originX = tileStartX * TILE_SIZE;
        const originY = tileStartY * TILE_SIZE;

        this._builder.clear();
        let hasOverlay = false;
        for (let y = tileStartY; y < tileEndY; y++) {
            for (let x = tileStartX; x < tileEndX; x++) {
                const decoration = this._getDecorationAt(x, y);
                if (!decoration) continue;
                hasOverlay = true;
                const localX = (x - tileStartX) * TILE_SIZE;
                const localY = (y - tileStartY) * TILE_SIZE;
                if (decoration === 'tall_grass') this._drawTallGrass(localX, localY, x, y);
                if (decoration === 'shallow_water') this._drawShallowWater(localX, localY, x, y);
            }
        }

        if (!hasOverlay) return null;

        const overlay = this.scene.add.renderTexture(originX, originY, pixelWidth, pixelHeight)
            .setOrigin(0, 0)
            .setDepth(STAGE_RENDER_DEPTH.terrainDecoration);
        overlay.draw(this._builder);
        return { overlay };
    }

    _getDecorationAt(x, y) {
        const tile = this.stageData.grid?.[y]?.[x];
        if (tile === TILE_TALL_GRASS) return 'tall_grass';
        if (tile === TILE_SHALLOW_WATER) return 'shallow_water';
        const featureDecorations = this._featureCells.get(`${x}:${y}`);
        if (!featureDecorations || featureDecorations.size === 0) return null;
        if (featureDecorations.has('shallow_water')) return 'shallow_water';
        if (featureDecorations.has('tall_grass')) return 'tall_grass';
        return null;
    }

    _drawTallGrass(localX, localY, tileX, tileY) {
        for (let i = 0; i < 6; i++) {
            const jitterX = this._noise(tileX, tileY, i * 2) * (TILE_SIZE * 0.55);
            const jitterY = this._noise(tileX, tileY, i * 2 + 1) * (TILE_SIZE * 0.35);
            const bladeX = localX + TILE_SIZE * 0.2 + jitterX;
            const bladeY = localY + TILE_SIZE * 0.45 + jitterY;
            const bladeH = TILE_SIZE * (0.22 + this._noise(tileX, tileY, i + 9) * 0.28);
            this._builder.lineStyle(3, 0x62873a, 0.55);
            this._builder.beginPath();
            this._builder.moveTo(bladeX, bladeY + bladeH * 0.6);
            this._builder.lineTo(bladeX + 2, bladeY - bladeH * 0.4);
            this._builder.strokePath();
        }
        this._builder.fillStyle(0x3c5f23, 0.14);
        this._builder.fillEllipse(localX + TILE_SIZE / 2, localY + TILE_SIZE / 2, TILE_SIZE * 0.92, TILE_SIZE * 0.78);
    }

    _drawShallowWater(localX, localY, tileX, tileY) {
        const width = TILE_SIZE * (0.88 + this._noise(tileX, tileY, 20) * 0.22);
        const height = TILE_SIZE * (0.76 + this._noise(tileX, tileY, 21) * 0.18);
        this._builder.fillStyle(0x2b6ea8, 0.26);
        this._builder.fillEllipse(localX + TILE_SIZE / 2, localY + TILE_SIZE / 2, width, height);
        this._builder.lineStyle(2, 0x72b8e8, 0.22);
        this._builder.strokeEllipse(localX + TILE_SIZE / 2, localY + TILE_SIZE / 2, width, height);
    }

    _noise(x, y, salt) {
        const value = Math.sin((x + 1) * 12.9898 + (y + 1) * 78.233 + salt * 37.719);
        return (value - Math.floor(value));
    }
}
