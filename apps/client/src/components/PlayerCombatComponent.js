import { Component } from './Component.js';
import { eventBus } from '../core/EventBus.js';
import { networkManager } from '../core/NetworkManager.js';
import { gameState } from '../core/GameState.js';
import { uiStateStore } from '../core/UiStateStore.js';
import { WEAPONS, SPELLS } from '../data/ItemRegistry.js';
import { resolveMeleeWeaponConfig, resolveSpellConfig } from '@clay-and-blood/shared';
import {
    PLAYER_RADIUS,
    ARROW_MIN_SPEED,
    ARROW_MAX_SPEED,
    ARROW_PENETRATION,
    BOW_MIN_CHARGE_MS,
    BOW_FULL_CHARGE_MS,
    ATTACK_MOVE_SPEED_MULTIPLIER,
} from '../config.js';

class BowWeaponStateMachine {
    constructor(owner) {
        this.owner = owner;
        this.charging = false;
        this.chargeMs = 0;
    }

    onEquip() {}

    onUnequip() {
        this.charging = false;
        this.chargeMs = 0;
        this.owner._destroyChargeBar();
    }

    handlePrimary({ down, up, targetX, targetY }) {
        if (down && !this.charging) {
            this.charging = true;
            this.chargeMs = 0;
        }

        if (up && this.charging) {
            const heldMs = this.chargeMs;
            this.charging = false;
            this.chargeMs = 0;
            this.owner._destroyChargeBar();

            if (heldMs < BOW_MIN_CHARGE_MS) return;
            this.owner._releaseArrow(targetX, targetY, heldMs);
        }
    }

    update(deltaTime) {
        if (!this.charging) return;
        this.chargeMs = Math.min(this.chargeMs + deltaTime, BOW_FULL_CHARGE_MS);
        this.owner._updateChargeBar(this.chargeMs);
    }

    getMovementInfluence() {
        return null;
    }
}

class ComboWeaponStateMachine {
    constructor(owner, steps, queueGraceMs, weaponId = 'unarmed') {
        this.owner = owner;
        this.steps = steps;
        this.queueGraceMs = queueGraceMs;
        this.weaponId = weaponId;

        this.phase = 'idle';
        this.timerMs = 0;
        this.stepIndex = 0;
        this.queuedNext = false;
        this.currentAttackDirection = { x: 1, y: 0 };
    }

    onEquip() {}

    onUnequip() {
        this._reset();
    }

    handlePrimary({ down }) {
        if (!down) return;

        if (this.phase === 'idle') {
            this._startStep(0);
            return;
        }

        if (this.phase === 'lockout') {
            return;
        }

        this.queuedNext = true;

        if (this.phase === 'chain') {
            this._consumeQueueAndAdvance();
        }
    }

    update(deltaTime) {
        if (this.phase === 'idle') return;

        this.timerMs -= deltaTime;

        while (this.phase !== 'idle' && this.timerMs <= 0) {
            if (this.phase === 'windup') {
                this._triggerHitForCurrentStep();
                this.phase = 'active';
                this.timerMs += this.steps[this.stepIndex].activeMs;
                continue;
            }

            if (this.phase === 'active') {
                const step = this.steps[this.stepIndex];
                const isFinalStep = this.stepIndex >= this.steps.length - 1;
                const finishLockoutMs = Number.isFinite(step.finishLockoutMs) ? Math.max(0, step.finishLockoutMs) : 0;

                if (isFinalStep && finishLockoutMs > 0) {
                    this.phase = 'lockout';
                    this.timerMs += finishLockoutMs;
                    this.queuedNext = false;
                    continue;
                }

                this.phase = 'chain';
                this.timerMs += this.queueGraceMs;
                if (this.queuedNext) {
                    this._consumeQueueAndAdvance();
                }
                continue;
            }

            if (this.phase === 'chain') {
                this._reset();
                continue;
            }

            if (this.phase === 'lockout') {
                this._reset();
                continue;
            }
        }
    }

    _startStep(index) {
        this.stepIndex = index;
        this.phase = 'windup';
        this.timerMs = this.steps[index].windupMs;
        this.queuedNext = false;
        this.currentAttackDirection = this.owner._resolveCurrentAimDirection();
    }

    _triggerHitForCurrentStep() {
        const step = this.steps[this.stepIndex];
        this.owner._spawnMeleeArc(step.attackSpec, step.activeMs, {
            weaponId: this.weaponId,
            phaseIndex: this.stepIndex,
            damage: step.damage ?? 0,
        });
    }

    _consumeQueueAndAdvance() {
        this.queuedNext = false;
        const nextIndex = this.stepIndex + 1;
        if (nextIndex < this.steps.length) {
            this._startStep(nextIndex);
            return;
        }

        this._startStep(0);
    }

    _reset() {
        this.phase = 'idle';
        this.timerMs = 0;
        this.stepIndex = 0;
        this.queuedNext = false;
        this.currentAttackDirection = { x: 1, y: 0 };
    }

    getMovementInfluence() {
        if (this.phase === 'idle') return null;

        const step = this.steps[this.stepIndex];
        let attackPushVx = 0;
        let attackPushVy = 0;

        if (this.phase === 'windup' && step.windupMs > 0 && step.stepDistance > 0) {
            const pushSpeed = (step.stepDistance * 1000) / step.windupMs;
            attackPushVx = this.currentAttackDirection.x * pushSpeed;
            attackPushVy = this.currentAttackDirection.y * pushSpeed;
        }

        return {
            speedMultiplier: ATTACK_MOVE_SPEED_MULTIPLIER,
            attackPushVx,
            attackPushVy,
        };
    }
}

/**
 * Combat component for player-like controllable entities.
 */
export class PlayerCombatComponent extends Component {
    constructor() {
        super('playerCombat');

        this.chargeBarGfx = null;
        this.activeWeaponId = null;
        const swordCfg = resolveMeleeWeaponConfig('sword');
        const sword1 = swordCfg.phases[0];
        const sword2 = swordCfg.phases[1];
        const sword3 = swordCfg.phases[2];
        const unarmedCfg = resolveMeleeWeaponConfig('unarmed');
        const fists = unarmedCfg.phases[0];
        const zombieCfg = resolveMeleeWeaponConfig('zombie_strike');
        const zombieStrike = zombieCfg.phases[0];
        this.weaponStateMachines = {
            bow: new BowWeaponStateMachine(this),
            sword: new ComboWeaponStateMachine(this, [
                {
                    windupMs: sword1.windupMs,
                    activeMs: sword1.activeMs,
                    stepDistance: sword1.stepDistance,
                    damage: sword1.damage,
                    attackSpec: { radius: sword1.radius, arc: sword1.arc, color: sword1.visual.color, alpha: sword1.visual.alpha },
                },
                {
                    windupMs: sword2.windupMs,
                    activeMs: sword2.activeMs,
                    stepDistance: sword2.stepDistance,
                    damage: sword2.damage,
                    attackSpec: { radius: sword2.radius, arc: sword2.arc, color: sword2.visual.color, alpha: sword2.visual.alpha },
                },
                {
                    windupMs: sword3.windupMs,
                    activeMs: sword3.activeMs,
                    stepDistance: sword3.stepDistance,
                    finishLockoutMs: sword3.finishLockoutMs,
                    damage: sword3.damage,
                    attackSpec: { radius: sword3.radius, arc: sword3.arc, color: sword3.visual.color, alpha: sword3.visual.alpha },
                },
            ], swordCfg.queueGraceMs, 'sword'),
            unarmed: new ComboWeaponStateMachine(this, [
                {
                    windupMs: fists.windupMs,
                    activeMs: fists.activeMs,
                    stepDistance: fists.stepDistance,
                    damage: fists.damage,
                    attackSpec: { radius: fists.radius, arc: fists.arc, color: fists.visual.color, alpha: fists.visual.alpha },
                },
            ], unarmedCfg.queueGraceMs, 'unarmed'),
            zombie_strike: new ComboWeaponStateMachine(this, [
                {
                    windupMs: zombieStrike.windupMs,
                    activeMs: zombieStrike.activeMs,
                    stepDistance: zombieStrike.stepDistance,
                    damage: zombieStrike.damage,
                    attackSpec: { radius: zombieStrike.radius, arc: zombieStrike.arc, color: zombieStrike.visual.color, alpha: zombieStrike.visual.alpha },
                },
            ], zombieCfg.queueGraceMs, 'zombie_strike'),
        };

        this._unsubscribeControlChanged = null;
        this._unsubscribeLoadoutChanged = null;
        this._spellCooldownUntilMs = new Map();
        this._spellWindupUntilMs = 0;
        this._spellWindupMoveSpeedMultiplier = 1;
        this._holdingSpellTargetId = null;
        this._spellTargetIndicatorGfx = null;

        this.requireComponent('intent');
        this.optionalComponent('control');
        this.optionalComponent('loadout');
    }

    onAttach() {
        if (!super.onAttach()) return false;

        this._setupMouseInput();
        this._refreshActiveWeapon(true);

        this._unsubscribeControlChanged = eventBus.on('control:changed', ({ entityId, controlMode }) => {
            if (entityId !== this.entity.id) return;
            if (controlMode !== 'local') {
                this.entity.getComponent('intent')?.clearTransient();
                this._resetAllWeaponStateMachines();
                this._clearSpellHoldTargeting();
            }
        });

        this._unsubscribeLoadoutChanged = eventBus.on('loadout:changed', ({ entityId }) => {
            if (entityId !== this.entity.id) return;
            this._refreshActiveWeapon(true);
        });

        return true;
    }

    onDetach() {
        const scene = this.entity?.scene;
        if (scene) {
            scene.input.off('pointerdown', this._onPointerDown, this);
            scene.input.off('pointerup', this._onPointerUp, this);
        }

        this._destroyChargeBar();
        this._clearSpellHoldTargeting();

        if (this._unsubscribeControlChanged) {
            this._unsubscribeControlChanged();
            this._unsubscribeControlChanged = null;
        }

        if (this._unsubscribeLoadoutChanged) {
            this._unsubscribeLoadoutChanged();
            this._unsubscribeLoadoutChanged = null;
        }

        this._resetAllWeaponStateMachines();
    }

    isLocallyControlled() {
        const control = this.entity.getComponent('control');
        return !!control && control.controlMode === 'local';
    }

    _setupMouseInput() {
        const scene = this.entity.scene;
        scene.input.off('pointerdown', this._onPointerDown, this);
        scene.input.off('pointerup', this._onPointerUp, this);
        scene.input.on('pointerdown', this._onPointerDown, this);
        scene.input.on('pointerup', this._onPointerUp, this);
    }

    _onPointerDown(pointer) {
        if (!this.isLocallyControlled()) return;
        if (this._isPointerInsideUiDrawer(pointer)) return;
        this._writeAimFromPointer(pointer);

        const intent = this.entity.getComponent('intent');
        if (!intent) return;

        if (pointer.button === 0 || pointer.leftButtonDown()) {
            intent.wantsAttackPrimary = true;
            intent.attackPrimaryDown = true;
            intent.attackPrimaryHeld = true;
        } else if (pointer.button === 2 || pointer.rightButtonDown()) {
            intent.wantsAttackSecondary = true;
            intent.attackSecondaryDown = true;
            intent.attackSecondaryHeld = true;
        }
    }

    _onPointerUp(pointer) {
        if (!this.isLocallyControlled()) return;
        if (this._isPointerInsideUiDrawer(pointer)) return;
        this._writeAimFromPointer(pointer);

        const intent = this.entity.getComponent('intent');
        if (!intent) return;

        if (pointer.button === 0 || pointer.leftButtonReleased()) {
            intent.wantsAttackPrimary = true;
            intent.attackPrimaryUp = true;
            intent.attackPrimaryHeld = false;
        } else if (pointer.button === 2 || pointer.rightButtonReleased()) {
            intent.wantsAttackSecondary = true;
            intent.attackSecondaryUp = true;
            intent.attackSecondaryHeld = false;
        }
    }

    _writeAimFromPointer(pointer) {
        const intent = this.entity.getComponent('intent');
        const transform = this.entity.getComponent('transform');
        if (!intent || !transform) return;

        const worldPoint = this.entity.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        intent.aimX = worldPoint.x - transform.position.x;
        intent.aimY = worldPoint.y - transform.position.y;
    }

    _isPointerInsideUiDrawer(pointer) {
        if (!uiStateStore.get('drawerOpen')) return false;
        return pointer.x < (uiStateStore.get('drawerWidth') ?? 0);
    }

    handlePrimaryInput({ down, held, up, targetX, targetY }) {
        this._refreshActiveWeapon();
        const weaponMachine = this._getActiveWeaponStateMachine();
        weaponMachine?.handlePrimary({ down, held, up, targetX, targetY });
    }

    handleSecondaryInput({ down, held, up, targetX, targetY }) {
        const loadout = this.entity.getComponent('loadout');
        const weapon = loadout?.getEquippedWeapon() ?? WEAPONS.unarmed;

        if (weapon.mouseUsage === 'both') {
            const weaponMachine = this._getActiveWeaponStateMachine();
            weaponMachine?.handleSecondary?.({ down, held, up, targetX, targetY });
            return;
        }

        const spell = loadout?.getEquippedSpell() ?? SPELLS.nothing;
        const spellCfg = resolveSpellConfig(spell.id);
        if (spellCfg?.castMode === 'hold_release') {
            const liveTarget = this._resolveLivePointerTarget(targetX, targetY);
            const canStartHold = this._isSpellReady(spellCfg);
            if (this._holdingSpellTargetId && this._holdingSpellTargetId !== spell.id) {
                this._clearSpellHoldTargeting();
            }
            if (down) {
                if (!canStartHold) {
                    this._clearSpellHoldTargeting();
                    return;
                }
                this._beginSpellHoldTargeting(spellCfg, liveTarget.x, liveTarget.y);
            }
            if (held && this._holdingSpellTargetId === spell.id) {
                this._updateSpellHoldTargeting(spellCfg, liveTarget.x, liveTarget.y);
            }
            if (up && this._holdingSpellTargetId === spell.id) {
                this._attemptSpellCast(spellCfg, liveTarget.x, liveTarget.y);
                this._clearSpellHoldTargeting();
            }
            return;
        }

        if (spellCfg?.castMode === 'target_click') {
            if (!down) return;
            const liveTarget = this._resolveLivePointerTarget(targetX, targetY);
            const tractionActive = spellCfg.id === 'traction' && this._hasActiveSpellEffect('traction_source');
            if (tractionActive) {
                this._attemptSpellCast(spellCfg, liveTarget.x, liveTarget.y, { isCancellation: true });
                return;
            }
            if (!this._isSpellReady(spellCfg)) return;
            const clicked = this._resolveClickableSpellTarget(liveTarget.x, liveTarget.y, spellCfg);
            if (!clicked) return;
            this._attemptSpellCast(spellCfg, liveTarget.x, liveTarget.y, {
                targetEntityKey: clicked.entityKey,
            });
            return;
        }

        if (this._holdingSpellTargetId) {
            this._clearSpellHoldTargeting();
        }
        if (!down) return;
        this._handleSpellPrimary(spell, targetX, targetY);
    }

    _refreshActiveWeapon(force = false) {
        const loadout = this.entity.getComponent('loadout');
        const equipped = loadout?.getEquippedWeapon() ?? WEAPONS.unarmed;
        const nextWeaponId = this.weaponStateMachines[equipped.id] ? equipped.id : 'unarmed';

        if (!force && nextWeaponId === this.activeWeaponId) return;

        if (this.activeWeaponId && this.weaponStateMachines[this.activeWeaponId]) {
            this.weaponStateMachines[this.activeWeaponId].onUnequip?.();
        }

        this.activeWeaponId = nextWeaponId;
        this.weaponStateMachines[this.activeWeaponId]?.onEquip?.();
    }

    _resetAllWeaponStateMachines() {
        for (const machine of Object.values(this.weaponStateMachines)) {
            machine.onUnequip?.();
        }
    }

    _getActiveWeaponStateMachine() {
        this._refreshActiveWeapon();
        return this.weaponStateMachines[this.activeWeaponId] ?? this.weaponStateMachines.unarmed;
    }

    getMovementInfluence() {
        const machine = this._getActiveWeaponStateMachine();
        const weaponInfluence = machine?.getMovementInfluence?.() ?? null;
        const nowMs = performance.now();
        if (nowMs >= this._spellWindupUntilMs) {
            this._spellWindupMoveSpeedMultiplier = 1;
            return weaponInfluence;
        }

        const spellInfluence = {
            speedMultiplier: Number.isFinite(this._spellWindupMoveSpeedMultiplier)
                ? Math.max(0, Math.min(1, this._spellWindupMoveSpeedMultiplier))
                : 1,
            attackPushVx: 0,
            attackPushVy: 0,
        };
        if (this._hasActiveSpellEffect('traction_source')) {
            const tractionCfg = resolveSpellConfig('traction')?.traction ?? {};
            const dragMultiplier = Number.isFinite(tractionCfg.dragMoveSpeedMultiplier)
                ? Math.max(0, Math.min(1, tractionCfg.dragMoveSpeedMultiplier))
                : 1;
            spellInfluence.speedMultiplier = Math.min(spellInfluence.speedMultiplier, dragMultiplier);
        }
        if (!weaponInfluence) return spellInfluence;
        return {
            speedMultiplier: Math.min(
                Number.isFinite(weaponInfluence.speedMultiplier) ? weaponInfluence.speedMultiplier : 1,
                spellInfluence.speedMultiplier
            ),
            attackPushVx: Number.isFinite(weaponInfluence.attackPushVx) ? weaponInfluence.attackPushVx : 0,
            attackPushVy: Number.isFinite(weaponInfluence.attackPushVy) ? weaponInfluence.attackPushVy : 0,
        };
    }

    /** Returns true when the active weapon state machine is fully idle (no attack in flight). */
    isWeaponIdle() {
        const machine = this._getActiveWeaponStateMachine();
        return !machine || machine.phase === 'idle' || machine.phase === undefined;
    }

    forceInterrupt() {
        this._resetAllWeaponStateMachines();
        this._destroyChargeBar();
        this._clearSpellHoldTargeting();
        this._spellWindupUntilMs = 0;
        this._spellWindupMoveSpeedMultiplier = 1;
        const intent = this.entity.getComponent('intent');
        if (intent) {
            intent.wantsAttackPrimary = false;
            intent.wantsAttackSecondary = false;
            intent.attackPrimaryHeld = false;
            intent.attackSecondaryHeld = false;
            intent.clearTransient();
        }
    }

    _spawnMeleeArc({ radius, arc, color, alpha }, activeDurationMs, attackMeta = null) {
        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const scene = this.entity.scene;
        const aim = this._resolveCurrentAimTarget();
        const dx = aim.x - transform.position.x;
        const dy = aim.y - transform.position.y;
        const angle = Math.atan2(dy, dx);
        const len = Math.sqrt(dx * dx + dy * dy);
        const dirX = len > 0.001 ? dx / len : 1;
        const dirY = len > 0.001 ? dy / len : 0;

        const gfx = scene.add.graphics();
        gfx.fillStyle(color, alpha);
        gfx.beginPath();
        gfx.moveTo(transform.position.x, transform.position.y);
        gfx.arc(
            transform.position.x,
            transform.position.y,
            radius,
            angle - arc / 2,
            angle + arc / 2
        );
        gfx.closePath();
        gfx.fillPath();

        scene.time.delayedCall(activeDurationMs, () => {
            gfx.destroy();
        });

        if (this.isLocallyControlled()) {
            networkManager.sendMeleeAttack({
                weaponId: attackMeta?.weaponId ?? 'unarmed',
                phaseIndex: Number.isFinite(attackMeta?.phaseIndex) ? attackMeta.phaseIndex : 0,
                dirX,
                dirY,
                levelId: gameState.currentLevelId ?? null,
            });
        }
    }

    _resolveCurrentAimTarget() {
        const intent = this.entity.getComponent('intent');
        if (!intent) {
            const transform = this.entity.getComponent('transform');
            return {
                x: (transform?.position.x ?? 0) + 1,
                y: transform?.position.y ?? 0,
            };
        }

        return this.resolveAimTarget(intent);
    }

    _resolveCurrentAimDirection() {
        const transform = this.entity.getComponent('transform');
        if (!transform) return { x: 1, y: 0 };

        const target = this._resolveCurrentAimTarget();
        const dx = target.x - transform.position.x;
        const dy = target.y - transform.position.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return { x: 1, y: 0 };
        return { x: dx / len, y: dy / len };
    }

    _releaseArrow(targetX, targetY, chargeMs) {
        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const scene = this.entity.scene;
        const dx = targetX - transform.position.x;
        const dy = targetY - transform.position.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return;

        const nx = dx / len;
        const ny = dy / len;
        const angle = Math.atan2(dy, dx);

        const pct = Math.min(chargeMs / BOW_FULL_CHARGE_MS, 1);
        const speed = ARROW_MIN_SPEED + (ARROW_MAX_SPEED - ARROW_MIN_SPEED) * pct;

        const spawnX = transform.position.x + nx * (PLAYER_RADIUS + 8);
        const spawnY = transform.position.y + ny * (PLAYER_RADIUS + 8);

        const arrowEntity = scene.entityFactory.createFromPrefab('arrow', {
            x: spawnX,
            y: spawnY,
            velocityX: nx * speed,
            velocityY: ny * speed,
            angle,
            penetration: ARROW_PENETRATION,
            sourceTeamId: scene._resolveClientEntityTeamId?.(this.entity) ?? null,
        });
        const arrowGO = arrowEntity.getComponent('rectangle')?.gameObject;
        scene.lightingRenderer?.maskGameObject(arrowGO);

        const flash = scene.add.circle(spawnX, spawnY, PLAYER_RADIUS * 0.5, 0xffff88, 0.8);
        scene.tweens.add({
            targets: flash,
            alpha: 0,
            scaleX: 2,
            scaleY: 2,
            duration: 60,
            ease: 'Quad.easeOut',
            onComplete: () => flash.destroy(),
        });

        if (this.isLocallyControlled()) {
            networkManager.sendBullet(spawnX, spawnY, nx * speed, ny * speed, gameState.currentLevelId, {
                projectileType: 'arrow',
                chargeRatio: pct,
                penetration: ARROW_PENETRATION,
            });
        }
    }

    _updateChargeBar(chargeMs) {
        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const pct = Math.min(chargeMs / BOW_FULL_CHARGE_MS, 1);
        const barW = 36;
        const barH = 6;
        const bx = transform.position.x - barW / 2;
        const by = transform.position.y - PLAYER_RADIUS - 16;

        if (!this.chargeBarGfx) {
            this.chargeBarGfx = this.entity.scene.add.graphics();
            this.chargeBarGfx.setDepth(200);
        }

        this.chargeBarGfx.clear();
        this.chargeBarGfx.fillStyle(0x111111, 0.9);
        this.chargeBarGfx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);

        const fillColor = pct < 0.5 ? 0x44dd44 : pct < 0.85 ? 0xffdd00 : 0xff8800;
        this.chargeBarGfx.fillStyle(fillColor, 1);
        this.chargeBarGfx.fillRect(bx, by, Math.ceil(barW * pct), barH);
    }

    _destroyChargeBar() {
        if (this.chargeBarGfx) {
            this.chargeBarGfx.destroy();
            this.chargeBarGfx = null;
        }
    }

    _handleSpellPrimary(spell, targetX, targetY) {
        switch (spell.id) {
            case 'possess':
                this.castPossess(targetX, targetY);
                break;
            case 'release_possession':
                this.entity.scene?.requestReleasePossession?.(this.entity);
                break;
            case 'imposing_flame':
                this.castImposingFlame(targetX, targetY);
                break;
            case 'gelid_cradle':
                this.castGelidCradle(targetX, targetY);
                break;
            case 'arc_flash':
                // Arc Flash uses target-click flow in handleSecondaryInput.
                break;
            case 'traction':
                // Traction uses target-click flow in handleSecondaryInput.
                break;
            case 'nothing':
            default:
                break;
        }
    }

    castImposingFlame(targetX, targetY) {
        const spellCfg = resolveSpellConfig('imposing_flame');
        this._attemptSpellCast(spellCfg, targetX, targetY);
    }

    castGelidCradle(targetX, targetY) {
        const spellCfg = resolveSpellConfig('gelid_cradle');
        this._attemptSpellCast(spellCfg, targetX, targetY);
    }

    _attemptSpellCast(spellCfg, targetX, targetY, options = {}) {
        if (!spellCfg) return;
        const isCancellation = !!options.isCancellation;
        const now = performance.now();
        if (!isCancellation && !this._isSpellReady(spellCfg, now)) return;

        if (!isCancellation) {
            const cooldownMs = Number.isFinite(spellCfg.cooldownMs) ? Math.max(0, spellCfg.cooldownMs) : 0;
            this._spellCooldownUntilMs.set(spellCfg.id, now + cooldownMs);
            const uiCooldowns = { ...(uiStateStore.get('spellCooldowns') ?? {}) };
            uiCooldowns[spellCfg.id] = now + cooldownMs;
            uiStateStore.set('spellCooldowns', uiCooldowns);

            const windupMs = Number.isFinite(spellCfg.windupMs) ? Math.max(0, spellCfg.windupMs) : 0;
            this._spellWindupUntilMs = Math.max(this._spellWindupUntilMs, now + windupMs);
            this._spellWindupMoveSpeedMultiplier = Number.isFinite(spellCfg.windupMoveSpeedMultiplier)
                ? Math.max(0, Math.min(1, spellCfg.windupMoveSpeedMultiplier))
                : 1;
        }

        if (!this.isLocallyControlled()) return;
        networkManager.sendSpellCast({
            spellId: spellCfg.id,
            targetX,
            targetY,
            targetEntityKey: typeof options.targetEntityKey === 'string' ? options.targetEntityKey : null,
            levelId: gameState.currentLevelId ?? null,
        });
    }

    _isSpellReady(spellCfg, now = performance.now()) {
        if (!spellCfg?.id) return false;
        const cooldownUntilMs = this._spellCooldownUntilMs.get(spellCfg.id) ?? 0;
        return now >= cooldownUntilMs;
    }

    _resolveLivePointerTarget(fallbackX, fallbackY) {
        const scene = this.entity?.scene;
        const pointer = scene?.input?.activePointer;
        if (scene?.cameras?.main && pointer) {
            const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
            if (Number.isFinite(world?.x) && Number.isFinite(world?.y)) {
                return { x: world.x, y: world.y };
            }
        }
        return { x: fallbackX, y: fallbackY };
    }

    _resolveClickableSpellTarget(worldX, worldY, spellCfg = null) {
        const scene = this.entity?.scene;
        const hovered = typeof scene?.getHoveredSpellTarget === 'function'
            ? scene.getHoveredSpellTarget(spellCfg?.id ?? null)
            : null;
        if (hovered?.entityKey) {
            return {
                entity: hovered.entity ?? null,
                entityKey: hovered.entityKey,
            };
        }

        const manager = scene?.entityManager;
        if (!manager) return null;

        const statCandidates = manager.getEntitiesWithComponent('stats');
        const draggableKinds = Array.isArray(spellCfg?.targeting?.draggableKinds)
            ? new Set(spellCfg.targeting.draggableKinds)
            : null;
        const corpseCandidates = draggableKinds?.has('corpse')
            ? Object.values(manager.entities ?? {}).filter((entity) => entity?.type === 'corpse')
            : [];
        const candidates = [...statCandidates, ...corpseCandidates];
        let best = null;
        let bestDistSq = Infinity;

        for (const entity of candidates) {
            if (!entity || entity.id === this.entity?.id) continue;
            if (entity.type === 'exit') continue;
            const circle = entity.getComponent('circle');
            const transform = entity.getComponent('transform');
            const cx = Number.isFinite(circle?.gameObject?.x) ? circle.gameObject.x : transform?.position?.x;
            const cy = Number.isFinite(circle?.gameObject?.y) ? circle.gameObject.y : transform?.position?.y;
            const radius = Number.isFinite(circle?.radius) ? circle.radius : PLAYER_RADIUS;
            if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
            if (circle?.gameObject && !circle.gameObject.visible) continue;

            const dx = worldX - cx;
            const dy = worldY - cy;
            const distSq = dx * dx + dy * dy;
            if (distSq > radius * radius) continue;

            const entityKey = typeof scene._getNetworkEntityKey === 'function'
                ? scene._getNetworkEntityKey(entity)
                : null;
            if (!entityKey || entityKey === `player:${networkManager.sessionId ?? ''}`) continue;

            if (distSq < bestDistSq) {
                best = { entity, entityKey };
                bestDistSq = distSq;
            }
        }

        return best;
    }

    _hasActiveSpellEffect(effectType) {
        if (typeof effectType !== 'string') return false;
        const buffs = uiStateStore.get('networkSelf')?.buffs;
        if (!Array.isArray(buffs)) return false;
        return buffs.some((buff) => buff?.type === effectType);
    }

    _beginSpellHoldTargeting(spellCfg, targetX, targetY) {
        this._holdingSpellTargetId = spellCfg.id;
        this._updateSpellHoldTargeting(spellCfg, targetX, targetY);
    }

    _updateSpellHoldTargeting(spellCfg, targetX, targetY) {
        const indicator = spellCfg.indicator ?? {};
        const radius = Number.isFinite(indicator.radius)
            ? Math.max(1, indicator.radius)
            : Math.max(1, spellCfg?.burst?.radius ?? 1);
        if (!this._spellTargetIndicatorGfx) {
            this._spellTargetIndicatorGfx = this.entity.scene.add.graphics();
            this._spellTargetIndicatorGfx.setDepth(205);
        }

        const fillColor = Number.isFinite(indicator.color) ? indicator.color : 0x7ad2ff;
        const fillAlpha = Number.isFinite(indicator.alpha) ? indicator.alpha : 0.2;
        const outlineColor = Number.isFinite(indicator.outlineColor) ? indicator.outlineColor : 0xc7ecff;
        const outlineAlpha = Number.isFinite(indicator.outlineAlpha) ? indicator.outlineAlpha : 0.9;
        const outlineWidth = Number.isFinite(indicator.outlineWidth) ? Math.max(1, indicator.outlineWidth) : 2;

        this._spellTargetIndicatorGfx.clear();
        this._spellTargetIndicatorGfx.fillStyle(fillColor, fillAlpha);
        this._spellTargetIndicatorGfx.fillCircle(targetX, targetY, radius);
        this._spellTargetIndicatorGfx.lineStyle(outlineWidth, outlineColor, outlineAlpha);
        this._spellTargetIndicatorGfx.strokeCircle(targetX, targetY, radius);
    }

    _clearSpellHoldTargeting() {
        this._holdingSpellTargetId = null;
        if (this._spellTargetIndicatorGfx) {
            this._spellTargetIndicatorGfx.destroy();
            this._spellTargetIndicatorGfx = null;
        }
    }

    castPossess(targetX, targetY) {
        const scene = this.entity.scene;
        const possessed = scene.tryPossessAtWorldPoint(this.entity, targetX, targetY);

        const color = possessed ? 0x7fe8ff : 0x555f6a;
        const fx = scene.add.circle(targetX, targetY, possessed ? 20 : 12, color, 0.55);
        scene.tweens.add({
            targets: fx,
            alpha: 0,
            scaleX: possessed ? 2.4 : 1.8,
            scaleY: possessed ? 2.4 : 1.8,
            duration: possessed ? 180 : 120,
            ease: 'Quad.easeOut',
            onComplete: () => fx.destroy(),
        });
    }

    resolveAimTarget(intent) {
        const transform = this.entity.getComponent('transform');
        const scene = this.entity.scene;
        if (!transform || !scene) return { x: 0, y: 0 };

        const aimX = Number.isFinite(intent.aimX) ? intent.aimX : 0;
        const aimY = Number.isFinite(intent.aimY) ? intent.aimY : 0;
        if (Math.abs(aimX) > 0.001 || Math.abs(aimY) > 0.001) {
            return { x: transform.position.x + aimX, y: transform.position.y + aimY };
        }

        const pointer = scene.input?.activePointer;
        if (pointer) {
            const worldPoint = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
            return { x: worldPoint.x, y: worldPoint.y };
        }

        return { x: transform.position.x + 1, y: transform.position.y };
    }

    update(deltaTime) {
        this._refreshActiveWeapon();
        const weaponMachine = this._getActiveWeaponStateMachine();
        weaponMachine?.update(deltaTime);
    }
}
