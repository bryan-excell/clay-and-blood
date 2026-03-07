export const UI_STATE_SCHEMA_VERSION = 1;

export function createDefaultControlledEntityState() {
    return {
        entityId: null,
        entityType: null,
        sessionId: null,
        hp: 0,
        hpMax: 0,
        mana: 0,
        manaMax: 0,
        stamina: 0,
        staminaMax: 0,
        currentWeapon: 1,
        weapons: [],
        buffs: [],
    };
}

export function createDefaultUiState() {
    return {
        schemaVersion: UI_STATE_SCHEMA_VERSION,
        controlledEntity: createDefaultControlledEntityState(),
        networkSelf: null,
    };
}
