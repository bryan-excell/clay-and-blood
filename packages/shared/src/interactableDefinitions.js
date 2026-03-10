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
