/**
 * Master Prefabs Index
 * Centralizes all entity creation functions for easy importing
 */

// Character prefabs
export { createPlayer } from './player.js';
export { createGolem } from './golem.js';
export { createBandit } from './bandit.js';

// Projectile prefabs
export { createBullet } from './bullet.js';
export { createArrow } from './arrow.js';

// Interactive object prefabs
export { createExit } from './exit.js';

// Environment prefabs
export * from './environment/index.js';

// Add new prefab categories here as they are created

// Core Components
export { Component } from '../../components/Component.js';
export { TransformComponent } from '../../components/TransformComponent.js';

// Phaser Object Components
export { PhaserObjectComponent } from '../../components/PhaserObjectComponent.js';
export { CircleComponent } from '../../components/CircleComponent.js';
export { RectangleComponent } from '../../components/RectangleComponent.js';

// Capability Components
export { PhysicsCapability } from '../../components/PhysicsCapability.js';

// Input Components
export { InputComponent } from '../../components/InputComponent.js';
export { KeyboardInputComponent } from '../../components/KeyboardInputComponent.js';
