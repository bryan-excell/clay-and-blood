import { eventBus } from '../core/EventBus.js';
import { getStageDefinition } from './StageDefinitions.js';
import { DEFAULT_ZONE_PALETTE, ZONE_PARTICLE_PALETTES } from './ParticleColors.js';

class ZonePalette {
    constructor() {
        this.activePalette = { ...DEFAULT_ZONE_PALETTE };
        this.activeZoneId = null;
        this._unsubscribe = null;
    }

    start() {
        if (this._unsubscribe) return;
        this._unsubscribe = eventBus.on('level:transition', ({ levelId }) => {
            this.setFromLevelId(levelId);
        });
    }

    stop() {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    setFromLevelId(levelId) {
        const definition = getStageDefinition(levelId);
        const zoneId = definition?.zoneId ?? null;
        const nextPalette = {
            ...DEFAULT_ZONE_PALETTE,
            ...(ZONE_PARTICLE_PALETTES[zoneId] ?? {}),
            ...(definition?.palette ?? {}),
        };
        this.activeZoneId = zoneId;
        this.activePalette = nextPalette;
        eventBus.emit('particle:paletteChanged', {
            levelId,
            zoneId,
            palette: nextPalette,
        });
    }

    getActivePalette() {
        return this.activePalette ?? DEFAULT_ZONE_PALETTE;
    }

    resolveColor(token, fallback = DEFAULT_ZONE_PALETTE.base) {
        if (typeof token === 'number') return token;
        const palette = this.getActivePalette();
        return Number.isFinite(palette?.[token]) ? palette[token] : fallback;
    }
}

export const zonePalette = new ZonePalette();
