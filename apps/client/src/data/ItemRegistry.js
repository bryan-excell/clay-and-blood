/**
 * Central registry of all usable items in the game.
 * Both gameplay systems and the UI read item definitions from here.
 *
 * mouseUsage:
 *   'left'  — primary action fires on LMB
 *   'right' — primary action fires on RMB
 *   'both'  — item owns LMB (primary) and RMB (secondary),
 *             displacing whatever occupied the other slot
 *
 * implicit: true — always available to every entity as a fallback,
 *                  even if not listed in their loadout weapons/spells arrays.
 */

export const WEAPONS = Object.freeze({
    unarmed:       Object.freeze({ id: 'unarmed',       name: 'Fists',        mouseUsage: 'left', implicit: true }),
    bow:           Object.freeze({ id: 'bow',           name: 'Bow',          mouseUsage: 'left' }),
    sword:         Object.freeze({ id: 'sword',         name: 'Sword',        mouseUsage: 'left' }),
    zombie_strike: Object.freeze({ id: 'zombie_strike', name: 'Zombie Strike', mouseUsage: 'left' }),
});

export const SPELLS = Object.freeze({
    nothing:            Object.freeze({ id: 'nothing', name: 'Nothing', mouseUsage: 'right', implicit: true }),
    possess:            Object.freeze({ id: 'possess', name: 'Possess', mouseUsage: 'right' }),
    release_possession: Object.freeze({ id: 'release_possession', name: 'Release Possession', mouseUsage: 'right' }),
    imposing_flame:     Object.freeze({ id: 'imposing_flame', name: 'Imposing Flame', mouseUsage: 'right' }),
    gelid_cradle:       Object.freeze({ id: 'gelid_cradle', name: 'Gelid Cradle', mouseUsage: 'right' }),
    arc_flash:          Object.freeze({ id: 'arc_flash', name: 'Arc Flash', mouseUsage: 'right' }),
    traction:           Object.freeze({ id: 'traction', name: 'Traction', mouseUsage: 'right' }),
});

export const ACCESSORIES = Object.freeze({
    cape: Object.freeze({ id: 'cape', name: 'Cape', spacebarAction: 'dash' }),
});

export const ARMOR_SETS = Object.freeze({
    // Future armor sets go here.
});

/**
 * Look up any item definition by id across all categories.
 * @param {string} id
 * @returns {object|null}
 */
export function getItemDef(id) {
    return WEAPONS[id] ?? SPELLS[id] ?? ACCESSORIES[id] ?? ARMOR_SETS[id] ?? null;
}
