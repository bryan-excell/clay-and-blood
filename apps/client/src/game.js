import Phaser from 'phaser';
import { config } from './config.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';

// Add our scene to the config
config.scene = [GameScene, UIScene];

// Create the game instance
window.game = new Phaser.Game(config);

// Suppress the browser context menu over the game canvas so right-click attacks work.
window.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Global game state for legacy code compatibility
window.stages = {};
window.currentStageId = 'stage-1';
