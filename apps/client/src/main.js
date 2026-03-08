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

function ensureGameFontLoaded() {
    const href = 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&display=swap';
    if (document.head.querySelector(`link[href="${href}"]`)) return;

    const preconnectA = document.createElement('link');
    preconnectA.rel = 'preconnect';
    preconnectA.href = 'https://fonts.googleapis.com';
    document.head.appendChild(preconnectA);

    const preconnectB = document.createElement('link');
    preconnectB.rel = 'preconnect';
    preconnectB.href = 'https://fonts.gstatic.com';
    preconnectB.crossOrigin = 'anonymous';
    document.head.appendChild(preconnectB);

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = href;
    document.head.appendChild(stylesheet);
}

ensureGameFontLoaded();

// Setup window resize handler
window.addEventListener('resize', function () {
    if (window.game) {
        window.game.scale.resize(window.innerWidth, window.innerHeight);
    }
});
