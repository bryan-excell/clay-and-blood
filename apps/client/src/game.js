import Phaser from 'phaser';
import { config } from './config.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';

// Add our scene to the config
config.scene = [GameScene, UIScene];

// Create the game instance
window.game = new Phaser.Game(config);

// Global game state for legacy code compatibility
window.stages = {};
window.currentStageId = 'stage-1';
