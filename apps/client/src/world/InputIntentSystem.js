/**
 * Converts controller-specific input into controller-agnostic IntentComponent data.
 */
export class InputIntentSystem {
    /**
     * Update intent for all entities that carry an IntentComponent.
     * @param {import('../entities/EntityManager.js').EntityManager} entityManager
     */
    static update(entityManager) {
        const entities = entityManager.getEntitiesWithComponent('intent');
        for (const entity of entities) {
            InputIntentSystem.updateEntity(entity);
        }
    }

    /**
     * Update a single entity's intent from its active control source.
     * @param {import('../entities/Entity.js').Entity} entity
     */
    static updateEntity(entity) {
        const intent = entity.getComponent('intent');
        if (!intent) return;

        const control = entity.getComponent('control');
        if (control && control.controlMode === 'disabled') {
            intent.set({
                moveX: 0,
                moveY: 0,
                wantsSprint: false,
                wantsDash: false,
                wantsAttackPrimary: false,
                wantsAttackSecondary: false,
            });
            return;
        }

        // Current implementation: keyboard is the local controller adapter.
        const keyboard = entity.getComponent('keyboard');
        if (!keyboard) return;

        const direction = keyboard.getMovementDirection();
        let moveX = direction.x;
        let moveY = direction.y;

        // Normalize diagonal movement to unit-length intent.
        if (moveX !== 0 && moveY !== 0) {
            const len = Math.sqrt(moveX * moveX + moveY * moveY);
            moveX /= len;
            moveY /= len;
        }

        intent.set({
            moveX,
            moveY,
            wantsSprint: !!keyboard.inputState.sprint,
            wantsDash: !!keyboard.inputState.dash,
            wantsAttackPrimary: !!keyboard.inputState.attack,
            wantsAttackSecondary: false,
        });
    }
}
