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
export const BOW_MIN_CHARGE_MS = 200;  // ms minimum hold before release will fire
export const BOW_FULL_CHARGE_MS = 500; // ms to reach full charge
export const ARROW_MAX_RANGE = 1000;
export const ARROW_PENETRATION = 0;

// Melee timing defaults
export const SWORD_QUEUE_GRACE_MS = 120;
export const SWORD_SWING_1_WINDUP_MS = 200;
export const SWORD_SWING_1_ACTIVE_MS = 100;
export const SWORD_SWING_2_WINDUP_MS = 200;
export const SWORD_SWING_2_ACTIVE_MS = 100;
export const SWORD_SWING_3_WINDUP_MS = 300;
export const SWORD_SWING_3_ACTIVE_MS = 500;
export const SWORD_FINISH_LOCKOUT_MS = 140; // short recovery after swing 3 before combo can restart

export const FISTS_SWING_WINDUP_MS = 100;
export const FISTS_SWING_ACTIVE_MS = 100;
export const FISTS_QUEUE_GRACE_MS = 120;
export const FISTS_HIT_DAMAGE = 4;
export const SWORD_HIT_DAMAGE_1 = 6;
export const SWORD_HIT_DAMAGE_2 = 6;
export const SWORD_HIT_DAMAGE_3 = 10;
export const GAME_FONT_FAMILY = '"Libre Baskerville", Georgia, serif';

// Attack movement feel
export const ATTACK_MOVE_SPEED_MULTIPLIER = 0.25;
export const SWORD_SWING_1_STEP_DISTANCE = 20; // px traveled during windup
export const SWORD_SWING_2_STEP_DISTANCE = 24;
export const SWORD_SWING_3_STEP_DISTANCE = 34;
export const FISTS_SWING_STEP_DISTANCE = 12;

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
