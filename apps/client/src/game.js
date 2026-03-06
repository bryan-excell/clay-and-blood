import Phaser from 'phaser';
import { config } from './config.js';
import { GameScene } from './scenes/GameScene.js';

// Add our scene to the config
config.scene = [GameScene];

// Create the game instance
window.game = new Phaser.Game(config);

// Global game state for legacy code compatibility
window.stages = {};
window.currentStageId = 'stage-1';