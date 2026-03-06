import './utils/helpers.js';
import { eventBus } from './core/EventBus.js';
import { Entity } from './entities/Entity.js';
import { Component } from './components/Component.js';
import { gameState } from './core/GameState.js';
import { actionManager } from './core/ActionManager.js';
import './components/index.js';
import './entities/EntityManager.js';
import './scenes/GameScene.js';
import { ExitManager } from './world/ExitManager.js';
import { config } from './config.js';
import './game.js';

// Setup window resize handler
window.addEventListener('resize', function () {
    if (window.game) {
        window.game.scale.resize(window.innerWidth, window.innerHeight);
    }
});