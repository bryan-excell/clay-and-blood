/**
 * Master Prefabs Index
 * Centralizes all entity creation functions for easy importing
 */

// Character prefabs
export { createPlayer } from './player.js';
export { createGolem } from './golem.js';
export { createZombie } from './zombie.js';
export { createWarmFire } from './warmFire.js';

// Interactive object prefabs
export { createExit } from './exit.js';

// Environment prefabs
export * from './environment/index.js';

// Add new prefab categories here as they are created
