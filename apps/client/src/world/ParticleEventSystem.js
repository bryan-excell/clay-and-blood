import { eventBus } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { networkManager } from '../core/NetworkManager.js';

export class ParticleEventSystem {
    constructor(scene) {
        this.scene = scene;
        this._unsubscribers = [];
    }

    start() {
        if (this._unsubscribers.length > 0) return;
        this._unsubscribers.push(
            eventBus.on('network:playerDamaged', ({ sessionId, damage }) => {
                const target = sessionId === networkManager.sessionId
                    ? this.scene.player
                    : null;
                this._emitDamageBurst(target, damage);
            }),
            eventBus.on('network:worldEntityDamaged', ({ entityKey, damage, died, x, y, levelId }) => {
                if (levelId && levelId !== gameState.currentLevelId) return;
                const target = this.scene._resolveEntityByNetworkKey?.(entityKey);
                this._emitDamageBurst(target, damage, { x, y });
                if (died) this._emitBurst(target, 'death', { x, y });
            }),
            eventBus.on('network:entityFlinched', ({ entityKey, levelId }) => {
                if (levelId && levelId !== gameState.currentLevelId) return;
                const target = this.scene._resolveEntityByNetworkKey?.(entityKey);
                this._emitBurst(target, 'flinch');
            }),
            eventBus.on('network:entityStaggered', ({ entityKey, levelId }) => {
                if (levelId && levelId !== gameState.currentLevelId) return;
                const target = this.scene._resolveEntityByNetworkKey?.(entityKey);
                this._emitBurst(target, 'flinch');
            }),
            eventBus.on('network:worldReset', ({ source }) => {
                if (source !== 'warm_fire') return;
                const fires = this.scene.entityManager?.getEntitiesByType?.('warm_fire') ?? [];
                for (const fire of fires) this._emitBurst(fire, 'cleanse');
            }),
        );
    }

    stop() {
        for (const unsubscribe of this._unsubscribers) unsubscribe?.();
        this._unsubscribers = [];
    }

    _emitDamageBurst(entity, damage, position = {}) {
        const amount = Number.isFinite(damage) ? Math.max(0, damage) : 0;
        if (amount <= 0) return;
        const quantity = Math.min(40, 5 + Math.floor(amount / 5));
        this._emitBurst(entity, 'damaged', { ...position, quantity });
    }

    _emitBurst(entity, burstKey, options = {}) {
        const particle = entity?.getComponent?.('spiritForm') ?? entity?.getComponent?.('particle');
        if (!particle) return;
        const transform = entity.getComponent?.('transform');
        const levelId = transform?.levelId ?? gameState.currentLevelId;
        if (levelId && levelId !== gameState.currentLevelId) return;
        particle.emitBurst(burstKey, options);
    }
}
