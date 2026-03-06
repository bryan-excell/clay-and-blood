import Phaser from 'phaser';

// Game Constants
export const TILE_SIZE = 64;
export const STAGE_WIDTH = 20;
export const STAGE_HEIGHT = 20;
export const PLAYER_RADIUS = 16;
export const PLAYER_SPEED = 200;
export const PLAYER_SPRINT_MULTIPLIER = 1.75;
export const BULLET_SPEED = 600;
export const BULLET_RADIUS = 4;
export const BULLET_DAMAGE = 10;
export const BULLET_MAX_RANGE = 800;

// Bow and arrow constants
export const ARROW_MIN_SPEED = 150;   // px/s at zero charge
export const ARROW_MAX_SPEED = 950;   // px/s at full charge (faster than bullet)
export const BOW_FULL_CHARGE_MS = 600; // ms to reach full charge
export const ARROW_MAX_RANGE = 1000;

// Colors — dark forest / dungeon palette
export const COLOR_SOLID = 0x0d120a;   // Near-black forest void
export const COLOR_EMPTY = 0x1e2e16;   // Dark undergrowth
export const COLOR_EXIT  = 0x3a7fff;   // Ethereal blue portal/shrine
export const COLOR_PLAYER = 0xe8d090;  // Warm torchlight parchment

// Game configuration
export const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#0d120a',        // Deep forest black-green
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false,
            fixedStep: true,
            fps: 120,
        }
    },
    scene: [] // We'll add scenes dynamically
};