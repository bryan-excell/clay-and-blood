export const INTERACTABLE_DEFINITIONS = Object.freeze([
    Object.freeze({
        interactableId: 'interactable:warm_fire_nativity',
        kind: 'warm_fire',
        levelId: 'nativity',
        tileX: 10,
        tileY: 7,
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
