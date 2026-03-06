/**
 * Applies resolved intent to movement state and baseline locomotion velocity.
 */
export class LocomotionSystem {
    /**
     * @param {import('../entities/EntityManager.js').EntityManager} entityManager
     */
    static update(entityManager) {
        const entities = entityManager.getEntitiesWithComponent('playerStateMachine');
        for (const entity of entities) {
            const intent = entity.getComponent('intent');
            const stateMachine = entity.getComponent('playerStateMachine');
            if (!intent || !stateMachine) continue;

            stateMachine.updateLocomotionState(intent);
            stateMachine.applyMovementFromIntent(intent);
        }
    }
}
