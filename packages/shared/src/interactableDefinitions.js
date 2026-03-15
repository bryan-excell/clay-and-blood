export const INTERACTABLE_DEFINITIONS = Object.freeze([
    Object.freeze({
        interactableId: 'interactable:warm_fire_inn',
        kind: 'warm_fire',
        levelId: 'inn',
        tileX: 8,
        tileY: 8,
        displayName: 'A Warm Fire',
        promptText: 'Rest [E]',
        interactionRadius: 96,
    }),
    Object.freeze({
        interactableId: 'interactable:vendor_town_square',
        kind: 'vendor_shop',
        levelId: 'town-square',
        tileX: 32,
        tileY: 6,
        displayName: 'Vendor',
        promptText: 'Shop [E]',
        interactionRadius: 96,
        shopTitle: 'Town Vendor',
        shopStock: Object.freeze(['healing_gem', 'magic_dew']),
    }),
    Object.freeze({
        interactableId: 'interactable:weapon_upgrader_town_square',
        kind: 'weapon_upgrader',
        levelId: 'town-square',
        tileX: 31,
        tileY: 6,
        displayName: 'Weapon Upgrader',
        promptText: 'Upgrade [E]',
        interactionRadius: 96,
        menuTitle: 'Weapon Upgrader',
    }),
    Object.freeze({
        interactableId: 'interactable:spell_upgrader_town_square',
        kind: 'spell_upgrader',
        levelId: 'town-square',
        tileX: 33,
        tileY: 6,
        displayName: 'Spell Upgrader',
        promptText: 'Upgrade [E]',
        interactionRadius: 96,
        menuTitle: 'Spell Upgrader',
    }),
]);

export function getInteractableDefinitions() {
    return INTERACTABLE_DEFINITIONS;
}

export function getInteractableDefinitionsForLevel(levelId) {
    if (typeof levelId !== 'string') return [];
    return INTERACTABLE_DEFINITIONS.filter((entry) => entry.levelId === levelId);
}

export function getInteractableDefinition(interactableId) {
    if (typeof interactableId !== 'string') return null;
    return INTERACTABLE_DEFINITIONS.find((entry) => entry.interactableId === interactableId) ?? null;
}
