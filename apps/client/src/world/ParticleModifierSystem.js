export class ParticleModifierSystem {
    static update(entityManager, scene, deltaMs = 16.67) {
        const entities = entityManager?.getEntitiesWithComponent?.('particle') ?? [];
        const controlled = scene?.getLocallyControlledEntity?.() ?? null;
        for (const entity of entities) {
            const particle = entity.getComponent('particle');
            if (!particle) continue;
            particle.syncToTransform();
            particle.tryApplyVisibilityMask();

            const stats = entity.getComponent('stats');
            this._setModifier(
                particle,
                'low_hp',
                Number.isFinite(stats?.hp) && Number.isFinite(stats?.hpMax) && stats.hpMax > 0 && stats.hp / stats.hpMax < 0.25
            );

            const stateMachine = entity.getComponent('playerStateMachine');
            this._setModifier(
                particle,
                'dashing',
                stateMachine?.currentMovementState === stateMachine?.movementStates?.DASHING
            );

            const control = entity.getComponent('control');
            this._setModifier(particle, 'controlled', controlled?.id === entity.id);
            this._setModifier(
                particle,
                'possessed',
                entity.type !== 'player' && !!control?.controllerId && control.controlMode === 'local'
            );

            this._setModifier(particle, 'hostile', entity.type === 'zombie');
        }
    }

    static _setModifier(particle, key, enabled) {
        if (enabled) particle.applyStateModifier(key);
        else particle.clearStateModifier(key);
    }
}
