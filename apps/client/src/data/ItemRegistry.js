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
    unarmed:       Object.freeze({ id: 'unarmed',       name: 'Unarmed',      category: 'weapon', mouseUsage: 'left', implicit: true, baseSellable: false, baseDroppable: false, sellPrice: 0, buyPrice: 0 }),
    bow:           Object.freeze({ id: 'bow',           name: 'Bow',          category: 'weapon', mouseUsage: 'left', baseSellable: true, baseDroppable: true, sellPrice: 75, buyPrice: 150 }),
    longsword:     Object.freeze({ id: 'longsword',     name: 'Longsword',    category: 'weapon', mouseUsage: 'left', baseSellable: true, baseDroppable: true, sellPrice: 75, buyPrice: 150 }),
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
    cape: Object.freeze({ id: 'cape', name: 'Cape', category: 'accessory', spacebarAction: 'dash', baseSellable: true, baseDroppable: true, sellPrice: 40, buyPrice: 90 }),
});

export const ARMOR_SETS = Object.freeze({
    leather_armor: Object.freeze({ id: 'leather_armor', name: 'Leather Armor', category: 'armor', baseSellable: true, baseDroppable: true, sellPrice: 60, buyPrice: 120 }),
});

export const CONSUMABLES = Object.freeze({
    gold_pouch: Object.freeze({
        id: 'gold_pouch',
        name: 'Gold Pouch',
        category: 'consumable',
        baseSellable: true,
        baseDroppable: true,
        sellPrice: 25,
        buyPrice: 50,
        consumableEffect: Object.freeze({
            effectType: 'grant_gold',
            goldAmount: 100,
        }),
    }),
    healing_gem: Object.freeze({
        id: 'healing_gem',
        name: 'Healing Gem',
        category: 'consumable',
        baseSellable: true,
        baseDroppable: true,
        sellPrice: 20,
        buyPrice: 40,
        consumableEffect: Object.freeze({
            effectType: 'healing_gem_regen',
            durationMs: 5000,
            tickIntervalMs: 1000,
            magnitude: 8,
        }),
    }),
    magic_dew: Object.freeze({
        id: 'magic_dew',
        name: 'Magic Dew',
        category: 'consumable',
        baseSellable: true,
        baseDroppable: true,
        sellPrice: 20,
        buyPrice: 40,
        consumableEffect: Object.freeze({
            effectType: 'magic_dew_regen',
            durationMs: 5000,
            tickIntervalMs: 1000,
            magnitude: 6,
        }),
    }),
});

export const RESOURCES = Object.freeze({
    weapon_upgrade_material: Object.freeze({
        id: 'weapon_upgrade_material',
        name: 'Weapon Upgrade Material',
        category: 'resource',
        baseSellable: true,
        baseDroppable: true,
        sellPrice: 10,
        buyPrice: 20,
    }),
    spell_upgrade_material: Object.freeze({
        id: 'spell_upgrade_material',
        name: 'Spell Upgrade Material',
        category: 'resource',
        baseSellable: true,
        baseDroppable: true,
        sellPrice: 10,
        buyPrice: 20,
    }),
});

/**
 * Look up any item definition by id across all categories.
 * @param {string} id
 * @returns {object|null}
 */
export function getItemDef(id) {
    return WEAPONS[id] ?? SPELLS[id] ?? ACCESSORIES[id] ?? ARMOR_SETS[id] ?? CONSUMABLES[id] ?? RESOURCES[id] ?? null;
}
