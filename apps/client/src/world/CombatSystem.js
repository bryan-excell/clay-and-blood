/**
 * Consumes attack intent and dispatches weapon actions.
 */
export class CombatSystem {
    /**
     * @param {import('../entities/EntityManager.js').EntityManager} entityManager
     */
    static update(entityManager) {
        const entities = entityManager.getEntitiesWithComponent('playerStateMachine');
        for (const entity of entities) {
            const intent = entity.getComponent('intent');
            const stateMachine = entity.getComponent('playerStateMachine');
            if (!intent || !stateMachine) continue;

            if (!stateMachine.isLocallyControlled()) {
                intent.clearTransient();
                continue;
            }

            const target = stateMachine.resolveAimTarget(intent);

            if (intent.wantsAttackPrimary) {
                stateMachine.handlePrimaryAttack(target.x, target.y);
            }
            if (intent.wantsAttackSecondary) {
                stateMachine.handleSecondaryAttack();
            }

            intent.clearTransient();
        }
    }
}
