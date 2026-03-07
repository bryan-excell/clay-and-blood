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
        buffs: [],
        // Loadout snapshot — null until a controlled entity with a LoadoutComponent is active.
        loadout: null,
    };
}

export function createDefaultUiState() {
    return {
        schemaVersion: UI_STATE_SCHEMA_VERSION,
        controlledEntity: createDefaultControlledEntityState(),
        networkSelf: null,
        // True while the inventory drawer is open. Gameplay systems read this
        // to suppress clicks that land on the drawer panel.
        drawerOpen: false,
        // Pixel width of the drawer when open — used for click-region guard.
        drawerWidth: 0,
    };
}
