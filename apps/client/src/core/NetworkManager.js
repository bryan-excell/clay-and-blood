import { MSG } from '@clay-and-blood/shared';
import { eventBus } from './EventBus.js';

const WS_URL = import.meta?.env?.VITE_WS_URL || 'ws://localhost:8787/room/default';

/**
 * NetworkManager – singleton WebSocket client.
 *
 * Clients send PLAYER_INPUT (key state) rather than positions.
 * The server runs the authoritative physics simulation and broadcasts
 * STATE_SNAPSHOT every tick.
 *
 * Events emitted on eventBus:
 *   network:connected      { sessionId }
 *   network:disconnected   {}
 *   network:gameState      { players: [{ sessionId, x, y, stageId }] }
 *   network:stateSnapshot  { tick, players: [{ sessionId, x, y, levelId, seq }], self?: { sessionId, hp, hpMax } }
 *   network:playerJoined   { sessionId }
 *   network:playerLeft     { sessionId }
 *   network:levelChanged   { sessionId, levelId }
 */
class NetworkManager {
    constructor() {
        this.ws              = null;
        this.sessionId       = null;
        this.connected       = false;
        this._inputInterval  = 50; // send at most 20 input packets/sec (matches server tick)
        this._nextInputAt    = 0;  // monotonic next send time (performance.now ms)
        this._seq            = 0;  // monotonic input sequence number
        this._lastServerTick = 0;  // most-recent tick acknowledged from server (for lag comp)
    }

    connect() {
        this.ws = new WebSocket(WS_URL);

        this.ws.addEventListener('open', () => {
            this.connected = true;
            console.log('[Network] Connected to server');
            this.send({ type: MSG.PLAYER_JOIN });
        });

        this.ws.addEventListener('message', ({ data }) => {
            let msg;
            try { msg = JSON.parse(data); } catch { return; }
            this._handleMessage(msg);
        });

        this.ws.addEventListener('close', () => {
            this.connected = false;
            console.log('[Network] Disconnected from server');
            eventBus.emit('network:disconnected');
        });

        this.ws.addEventListener('error', (err) => {
            console.warn('[Network] WebSocket error', err);
        });
    }

    _handleMessage(msg) {
        switch (msg.type) {
            case MSG.PLAYER_JOIN:
                if (!this.sessionId) {
                    this.sessionId = msg.sessionId;
                    console.log(`[Network] My session ID: ${this.sessionId}`);
                    eventBus.emit('network:connected', { sessionId: this.sessionId });
                } else {
                    eventBus.emit('network:playerJoined', { sessionId: msg.sessionId });
                }
                break;

            case MSG.GAME_STATE:
                // Initial snapshot of players already in the room
                eventBus.emit('network:gameState', { players: msg.players });
                break;

            case MSG.STATE_SNAPSHOT:
                // Periodic authoritative state from the server physics tick
                this._lastServerTick = msg.tick;
                eventBus.emit('network:stateSnapshot', {
                    tick: msg.tick,
                    players: msg.players,
                    self: msg.self ?? null,
                });
                break;

            case MSG.PLAYER_LEAVE:
                eventBus.emit('network:playerLeft', { sessionId: msg.sessionId });
                break;

            case MSG.LEVEL_CHANGE:
                eventBus.emit('network:levelChanged', { sessionId: msg.sessionId, levelId: msg.levelId });
                break;

            case MSG.BULLET_FIRED:
                eventBus.emit('network:bulletFired', {
                    sessionId: msg.sessionId,
                    x:         msg.x,
                    y:         msg.y,
                    velocityX: msg.velocityX,
                    velocityY: msg.velocityY,
                    levelId:   msg.levelId,
                });
                break;

            case MSG.PLAYER_DAMAGED:
                eventBus.emit('network:playerDamaged', {
                    sessionId:  msg.sessionId,
                    attackerId: msg.attackerId,
                    damage:     msg.damage,
                    hp:         msg.hp,
                    died:       msg.died,
                });
                break;
        }
    }

    /**
     * Send the local player's current input state to the server.
     * Throttled to match the server tick rate.
     * @param {object} inputState - { up, down, left, right, sprint }
     * @returns {number} The seq number used, or -1 if the message was throttled/not sent.
     */
    sendInput(inputState) {
        if (!this.connected) return -1;
        const now = performance.now();
        if (this._nextInputAt === 0) {
            this._nextInputAt = now;
        }
        if (now < this._nextInputAt) return -1;

        const seq = ++this._seq;
        this.send({
            type:   MSG.PLAYER_INPUT,
            seq,
            up:     !!inputState.up,
            down:   !!inputState.down,
            left:   !!inputState.left,
            right:  !!inputState.right,
            sprint: !!inputState.sprint,
        });

        // Keep a stable 20 Hz cadence even if frame timing jitters.
        this._nextInputAt += this._inputInterval;
        while (this._nextInputAt <= now - this._inputInterval) {
            this._nextInputAt += this._inputInterval;
        }
        return seq;
    }

    /**
     * Send an immediate dash impulse to the server, bypassing the throttle.
     * Call this once when the dash begins; the server will simulate dash velocity
     * for PLAYER_DASH_DURATION ms.
     * @param {object} inputState - Current input state (used to derive direction)
     * @returns {number} The seq number used for this dash input.
     */
    sendDash(inputState) {
        if (!this.connected) return -1;
        const seq = ++this._seq;
        this.send({
            type:   MSG.PLAYER_INPUT,
            seq,
            up:     !!inputState.up,
            down:   !!inputState.down,
            left:   !!inputState.left,
            right:  !!inputState.right,
            sprint: !!inputState.sprint,
            dash:   true,
        });
        // Keep post-dash timing aligned to the normal 20 Hz cadence.
        this._nextInputAt = performance.now() + this._inputInterval;
        return seq;
    }

    /**
     * Notify the server that the local player has moved to a new level.
     * @param {string} levelId
     * @param {number} x  - spawn X in the new level
     * @param {number} y  - spawn Y in the new level
     */
    sendLevelChange(levelId, x, y) {
        this.send({ type: MSG.LEVEL_CHANGE, levelId, x, y });
    }

    /**
     * Notify the server (and other clients) that this player fired a projectile.
     * @param {number} x              - Spawn world X
     * @param {number} y              - Spawn world Y
     * @param {number} velocityX      - Horizontal speed (px/s)
     * @param {number} velocityY      - Vertical speed (px/s)
     * @param {string} levelId        - The level the projectile was fired in
     * @param {object} [opts]
     * @param {string} [opts.projectileType] - 'bullet' (default) or 'arrow'
     * @param {number} [opts.chargeRatio]    - 0-1, arrow charge fraction (used for damage)
     */
    sendBullet(x, y, velocityX, velocityY, levelId, opts = {}) {
        this.send({
            type:          MSG.BULLET_FIRED,
            x, y, velocityX, velocityY, levelId,
            projectileType: opts.projectileType ?? 'bullet',
            chargeRatio:    opts.chargeRatio    ?? 1,
            lastKnownTick:  this._lastServerTick,
        });
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    disconnect() {
        if (this.ws) this.ws.close();
    }
}

export const networkManager = new NetworkManager();
