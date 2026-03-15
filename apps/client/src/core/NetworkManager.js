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
 *   network:gameState      { players: [{ sessionId, x, y, stageId, teamId, sightRadius }] }
 *   network:stateSnapshot  { tick, players: [{ sessionId, x, y, levelId, seq, teamId, sightRadius }], self?: { sessionId, controlledEntityKey, resources, teamId, sightRadius }, worldEntities?: [], entityEquips?: [] }
 *   network:worldState     { entities: [{ entityKey, x, y, levelId, controllerSessionId, teamId, resources, hitRadius, decayMsRemaining, identity }] }
 *   network:entityState    { sessionId, entityKey, x, y, levelId, controllerSessionId, teamId, resources, possessionMsRemaining, hitRadius, decayMsRemaining, identity }
 *   network:forceControl   { controlledEntityKey, reason, previousControllerSessionId, winnerSessionId, possessionMsRemaining? }
 *   network:entityControl  { entityKey, controllerSessionId, previousControllerSessionId, winnerSessionId, possessionMsRemaining? }
 *   network:playerJoined   { sessionId }
 *   network:playerLeft     { sessionId }
 *   network:levelChanged   { sessionId, levelId }
 *   network:entityEquip    { sessionId, entityKey, levelId, equipped }
 *   network:worldEntityDamaged { entityKey, damage, hp, died, x, y, levelId }
 *   network:worldReset     { source, interactableId, triggeredBySessionId, respawnedCount }
 *   network:toast          { message, durationMs }
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

            case MSG.WORLD_STATE:
                eventBus.emit('network:worldState', {
                    entities: msg.entities ?? [],
                    scope: msg.scope ?? 'all',
                    levelId: msg.levelId ?? null,
                });
                break;

            case MSG.STATE_SNAPSHOT:
                // Periodic authoritative state from the server physics tick
                this._lastServerTick = msg.tick;
                eventBus.emit('network:stateSnapshot', {
                    tick: msg.tick,
                    players: msg.players,
                    self: msg.self ?? null,
                    worldEntities: msg.worldEntities ?? [],
                    entityEquips: msg.entityEquips ?? [],
                });
                break;

            case MSG.PLAYER_EQUIP:
                eventBus.emit('network:entityEquip', {
                    sessionId: msg.sessionId,
                    entityKey: msg.entityKey,
                    levelId: msg.levelId ?? null,
                    equipped: msg.equipped ?? null,
                });
                break;

            case MSG.ENTITY_STATE:
                eventBus.emit('network:entityState', {
                    sessionId: msg.sessionId,
                    entityKey: msg.entityKey,
                    kind: msg.kind ?? null,
                    x: msg.x,
                    y: msg.y,
                    levelId: msg.levelId ?? null,
                    resources: msg.resources ?? null,
                    controllerSessionId: msg.controllerSessionId ?? null,
                    teamId: msg.teamId ?? null,
                    possessionMsRemaining: Number.isFinite(msg.possessionMsRemaining) ? msg.possessionMsRemaining : null,
                    hitRadius: Number.isFinite(msg.hitRadius) ? msg.hitRadius : null,
                    decayMsRemaining: Number.isFinite(msg.decayMsRemaining) ? msg.decayMsRemaining : null,
                    identity: msg.identity ?? null,
                });
                break;

            case MSG.FORCE_CONTROL:
                eventBus.emit('network:forceControl', {
                    controlledEntityKey: msg.controlledEntityKey,
                    reason: msg.reason ?? 'control:force',
                    previousControllerSessionId: msg.previousControllerSessionId ?? null,
                    winnerSessionId: msg.winnerSessionId ?? null,
                    possessionMsRemaining: Number.isFinite(msg.possessionMsRemaining) ? msg.possessionMsRemaining : null,
                    // Level/position context set by the server at moment of release,
                    // enabling the client to restore the player entity to the correct
                    // level and coordinates when possession ends.
                    levelId: typeof msg.levelId === 'string' ? msg.levelId : null,
                    x: Number.isFinite(msg.x) ? msg.x : null,
                    y: Number.isFinite(msg.y) ? msg.y : null,
                });
                break;

            case MSG.ENTITY_CONTROL:
                eventBus.emit('network:entityControl', {
                    entityKey: msg.entityKey,
                    controllerSessionId: msg.controllerSessionId ?? null,
                    previousControllerSessionId: msg.previousControllerSessionId ?? null,
                    winnerSessionId: msg.winnerSessionId ?? null,
                    reason: msg.reason ?? 'control:update',
                    possessionMsRemaining: Number.isFinite(msg.possessionMsRemaining) ? msg.possessionMsRemaining : null,
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
                    sourceTeamId: typeof msg.sourceTeamId === 'string' ? msg.sourceTeamId : null,
                    projectileId: typeof msg.projectileId === 'string' ? msg.projectileId : null,
                    projectileType: msg.projectileType ?? 'bullet',
                    chargeRatio: Number.isFinite(msg.chargeRatio) ? msg.chargeRatio : 1,
                    penetration: Number.isFinite(msg.penetration) ? Math.max(0, Math.floor(msg.penetration)) : 0,
                });
                break;

            case MSG.MELEE_ATTACK:
                eventBus.emit('network:meleeAttack', {
                    sessionId: typeof msg.sessionId === 'string' ? msg.sessionId : null,
                    attackerEntityKey: typeof msg.attackerEntityKey === 'string' ? msg.attackerEntityKey : null,
                    weaponId: msg.weaponId === 'longsword' || msg.weaponId === 'sword' || msg.weaponId === 'zombie_strike' ? msg.weaponId : 'unarmed',
                    phaseIndex: Number.isFinite(msg.phaseIndex) ? Math.max(0, Math.floor(msg.phaseIndex)) : 0,
                    levelId: typeof msg.levelId === 'string' ? msg.levelId : null,
                    originX: Number.isFinite(msg.originX) ? msg.originX : null,
                    originY: Number.isFinite(msg.originY) ? msg.originY : null,
                    dirX: Number.isFinite(msg.dirX) ? msg.dirX : 1,
                    dirY: Number.isFinite(msg.dirY) ? msg.dirY : 0,
                });
                break;

            case MSG.PROJECTILE_DESPAWN:
                eventBus.emit('network:projectileDespawn', {
                    projectileId: typeof msg.projectileId === 'string' ? msg.projectileId : null,
                    reason: typeof msg.reason === 'string' ? msg.reason : 'unknown',
                    x: Number.isFinite(msg.x) ? msg.x : null,
                    y: Number.isFinite(msg.y) ? msg.y : null,
                    projectileType: typeof msg.projectileType === 'string' ? msg.projectileType : 'bullet',
                });
                break;

            case MSG.SPELL_EFFECT:
                eventBus.emit('network:spellEffect', {
                    spellId: typeof msg.spellId === 'string' ? msg.spellId : null,
                    phase: typeof msg.phase === 'string' ? msg.phase : 'manifest',
                    x: Number.isFinite(msg.x) ? msg.x : null,
                    y: Number.isFinite(msg.y) ? msg.y : null,
                    sourceX: Number.isFinite(msg.sourceX) ? msg.sourceX : null,
                    sourceY: Number.isFinite(msg.sourceY) ? msg.sourceY : null,
                    targetX: Number.isFinite(msg.targetX) ? msg.targetX : null,
                    targetY: Number.isFinite(msg.targetY) ? msg.targetY : null,
                    hitX: Number.isFinite(msg.hitX) ? msg.hitX : null,
                    hitY: Number.isFinite(msg.hitY) ? msg.hitY : null,
                    levelId: typeof msg.levelId === 'string' ? msg.levelId : null,
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

            case MSG.WORLD_ENTITY_DAMAGED:
                eventBus.emit('network:worldEntityDamaged', {
                    entityKey: typeof msg.entityKey === 'string' ? msg.entityKey : null,
                    damage: Number.isFinite(msg.damage) ? msg.damage : 0,
                    hp: Number.isFinite(msg.hp) ? msg.hp : null,
                    died: !!msg.died,
                    x: Number.isFinite(msg.x) ? msg.x : null,
                    y: Number.isFinite(msg.y) ? msg.y : null,
                    levelId: typeof msg.levelId === 'string' ? msg.levelId : null,
                });
                break;

            case MSG.ENTITY_FLINCHED:
                eventBus.emit('network:entityFlinched', {
                    entityKey: typeof msg.entityKey === 'string' ? msg.entityKey : null,
                    durationMs: Number.isFinite(msg.durationMs) ? Math.max(0, msg.durationMs) : 0,
                    levelId: typeof msg.levelId === 'string' ? msg.levelId : null,
                });
                break;

            case MSG.ENTITY_STAGGERED:
                eventBus.emit('network:entityStaggered', {
                    entityKey: typeof msg.entityKey === 'string' ? msg.entityKey : null,
                    durationMs: Number.isFinite(msg.durationMs) ? Math.max(0, msg.durationMs) : 0,
                    levelId: typeof msg.levelId === 'string' ? msg.levelId : null,
                });
                break;

            case MSG.WORLD_RESET:
                eventBus.emit('network:worldReset', {
                    source: typeof msg.source === 'string' ? msg.source : 'unknown',
                    interactableId: typeof msg.interactableId === 'string' ? msg.interactableId : null,
                    triggeredBySessionId: typeof msg.triggeredBySessionId === 'string' ? msg.triggeredBySessionId : null,
                    respawnedCount: Number.isFinite(msg.respawnedCount) ? Math.max(0, Math.floor(msg.respawnedCount)) : 0,
                });
                break;

            case MSG.TOAST:
                eventBus.emit('network:toast', {
                    message: typeof msg.message === 'string' ? msg.message : '',
                    durationMs: Number.isFinite(msg.durationMs) ? Math.max(600, Math.floor(msg.durationMs)) : 1800,
                });
                break;
        }
    }

    /**
     * Send the local player's current input state to the server.
     * Throttled to match the server tick rate.
     * @param {object} inputState - { up, down, left, right, sprint, moveSpeedMultiplier, attackPushVx, attackPushVy }
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
            moveSpeedMultiplier: Number.isFinite(inputState.moveSpeedMultiplier) ? inputState.moveSpeedMultiplier : 1,
            attackPushVx: Number.isFinite(inputState.attackPushVx) ? inputState.attackPushVx : 0,
            attackPushVy: Number.isFinite(inputState.attackPushVy) ? inputState.attackPushVy : 0,
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
            moveSpeedMultiplier: Number.isFinite(inputState.moveSpeedMultiplier) ? inputState.moveSpeedMultiplier : 1,
            attackPushVx: Number.isFinite(inputState.attackPushVx) ? inputState.attackPushVx : 0,
            attackPushVy: Number.isFinite(inputState.attackPushVy) ? inputState.attackPushVy : 0,
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
     * @param {object} [opts]
     */
    sendLevelChange(levelId, x, y, opts = {}) {
        this.send({
            type: MSG.LEVEL_CHANGE,
            levelId,
            x,
            y,
            entityKey: opts.entityKey ?? null,
            fromLevelId: opts.fromLevelId ?? null,
            fromExitIndex: Number.isFinite(opts.fromExitIndex) ? opts.fromExitIndex : null,
            toExitIndex: Number.isFinite(opts.toExitIndex) ? opts.toExitIndex : null,
            entryDirection: opts.entryDirection ?? null,
        });
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
     * @param {number} [opts.penetration]    - projectile penetration count
     */
    sendBullet(x, y, velocityX, velocityY, levelId, opts = {}) {
        this.send({
            type:          MSG.BULLET_FIRED,
            x, y, velocityX, velocityY, levelId,
            projectileType: opts.projectileType ?? 'bullet',
            chargeRatio:    opts.chargeRatio    ?? 1,
            penetration: Number.isFinite(opts.penetration) ? Math.max(0, Math.floor(opts.penetration)) : 0,
            lastKnownTick:  this._lastServerTick,
        });
    }

    sendSpellCast(payload) {
        this.send({
            type: MSG.SPELL_CAST,
            spellId: typeof payload?.spellId === 'string' ? payload.spellId : 'nothing',
            targetX: Number.isFinite(payload?.targetX) ? payload.targetX : 0,
            targetY: Number.isFinite(payload?.targetY) ? payload.targetY : 0,
            targetEntityKey: typeof payload?.targetEntityKey === 'string' ? payload.targetEntityKey : null,
            levelId: typeof payload?.levelId === 'string' ? payload.levelId : null,
        });
    }

    /**
     * Notify the server about a local melee swing request.
     * Server remains authoritative for hit resolution and damage.
     * @param {object} payload
     * @param {'unarmed'|'longsword'} payload.weaponId
     * @param {number} payload.phaseIndex
     * @param {number} payload.dirX
     * @param {number} payload.dirY
     * @param {string|null} payload.levelId
     */
    sendMeleeAttack(payload) {
        this.send({
            type: MSG.MELEE_ATTACK,
            weaponId: payload?.weaponId ?? 'unarmed',
            phaseIndex: Number.isFinite(payload?.phaseIndex) ? Math.floor(payload.phaseIndex) : 0,
            dirX: Number.isFinite(payload?.dirX) ? payload.dirX : 1,
            dirY: Number.isFinite(payload?.dirY) ? payload.dirY : 0,
            levelId: typeof payload?.levelId === 'string' ? payload.levelId : null,
        });
    }

    /**
     * Notify the server of a loadout equip change.
     * Fire-and-forget: the server stores it for future display to other clients.
     * @param {string} entityKey
     * @param {object} equipped - { weaponId, spellId, armorSetId, accessoryId }
     * @param {string|null} levelId
     * @param {object|null} loadoutSnapshot
     */
    sendEquip(entityKey, equipped, levelId = null, loadoutSnapshot = null) {
        this.send({ type: MSG.PLAYER_EQUIP, entityKey, equipped, levelId, loadoutSnapshot });
    }

    /**
     * Request an inventory entry drop.
     * @param {string} entryId
     * @param {'one'|'all'} mode
     */
    sendDropEntry(entryId, mode = 'one') {
        this.send({
            type: MSG.DROP_ENTRY,
            entryId: typeof entryId === 'string' ? entryId : null,
            mode: mode === 'all' ? 'all' : 'one',
        });
    }

    /**
     * Request an inventory entry sale.
     * @param {string} merchantId
     * @param {string} entryId
     * @param {'one'|'all'} mode
     */
    sendSellEntry(merchantId, entryId, mode = 'one') {
        this.send({
            type: MSG.SELL_ENTRY,
            merchantId: typeof merchantId === 'string' ? merchantId : null,
            entryId: typeof entryId === 'string' ? entryId : null,
            mode: mode === 'all' ? 'all' : 'one',
        });
    }

    /**
     * Request buying one merchant item.
     * @param {string} merchantId
     * @param {string} definitionId
     */
    sendBuyMerchantItem(merchantId, definitionId) {
        this.send({
            type: MSG.BUY_MERCHANT_ITEM,
            merchantId: typeof merchantId === 'string' ? merchantId : null,
            definitionId: typeof definitionId === 'string' ? definitionId : null,
        });
    }

    sendUpgradeWeaponItem(upgraderId, entryId) {
        this.send({
            type: MSG.UPGRADE_WEAPON_ITEM,
            upgraderId: typeof upgraderId === 'string' ? upgraderId : null,
            entryId: typeof entryId === 'string' ? entryId : null,
        });
    }

    sendUpgradeSpellItem(upgraderId, spellId) {
        this.send({
            type: MSG.UPGRADE_SPELL_ITEM,
            upgraderId: typeof upgraderId === 'string' ? upgraderId : null,
            spellId: typeof spellId === 'string' ? spellId : null,
        });
    }

    /**
     * Replicate a world entity's state (e.g. possessed golem) to the server.
     * @param {string} entityKey
     * @param {number} x
     * @param {number} y
     * @param {string|null} levelId
     */
    sendEntityState(entityKey, x, y, levelId = null) {
        this.send({ type: MSG.ENTITY_STATE, entityKey, x, y, levelId });
    }

    /**
     * Request possession control transfer for a world entity.
     * Server decides whether request succeeds (currently always allows steals).
     * @param {string} targetEntityKey
     * @param {number} x
     * @param {number} y
     * @param {string|null} levelId
     */
    sendPossessRequest(targetEntityKey, x, y, levelId = null) {
        this.send({
            type: MSG.POSSESS_REQUEST,
            targetEntityKey,
            x,
            y,
            levelId,
        });
    }

    /**
     * Request release from the currently possessed world entity.
     * @param {string} targetEntityKey
     */
    sendPossessRelease(targetEntityKey) {
        this.send({
            type: MSG.POSSESS_RELEASE,
            targetEntityKey,
        });
    }

    sendInteract(interactableId) {
        this.send({
            type: MSG.INTERACT_REQUEST,
            interactableId: typeof interactableId === 'string' ? interactableId : null,
        });
    }

    sendUseConsumable(definitionId) {
        this.send({
            type: MSG.USE_CONSUMABLE,
            definitionId: typeof definitionId === 'string' ? definitionId : 'nothing',
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
