export class ParticleModifierSystem {
    static update(entityManager, scene, deltaMs = 16.67) {
        const entities = this._getVisualEntities(entityManager);
        const controlled = scene?.getLocallyControlledEntity?.() ?? null;
        for (const entity of entities) {
            const visual = this._getParticleVisual(entity);
            if (!visual) continue;

            const stats = entity.getComponent('stats');
            this._setModifier(
                visual,
                'low_hp',
                Number.isFinite(stats?.hp) && Number.isFinite(stats?.hpMax) && stats.hpMax > 0 && stats.hp / stats.hpMax < 0.25
            );

            const stateMachine = entity.getComponent('playerStateMachine');
            this._setModifier(
                visual,
                'dashing',
                stateMachine?.currentMovementState === stateMachine?.movementStates?.DASHING
            );

            const control = entity.getComponent('control');
            this._setModifier(visual, 'controlled', controlled?.id === entity.id);
            this._setModifier(
                visual,
                'possessed',
                entity.type !== 'player' && !!control?.controllerId && control.controlMode === 'local'
            );

            this._setModifier(visual, 'hostile', entity.type === 'zombie');
            visual.update?.(deltaMs);
        }
    }

    static _setModifier(visual, key, enabled) {
        if (enabled) visual.applyStateModifier?.(key);
        else visual.clearStateModifier?.(key);
    }

    static _getParticleVisual(entity) {
        return entity?.getComponent?.('spiritForm') ?? entity?.getComponent?.('particle') ?? null;
    }

    static _getVisualEntities(entityManager) {
        const entities = new Set();
        for (const entity of entityManager?.getEntitiesWithComponent?.('particle') ?? []) entities.add(entity);
        for (const entity of entityManager?.getEntitiesWithComponent?.('spiritForm') ?? []) entities.add(entity);
        return [...entities];
    }
}
