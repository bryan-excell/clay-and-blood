import { Component } from './Component.js';
import { eventBus } from '../core/EventBus.js';
import { networkManager } from '../core/NetworkManager.js';
import { gameState } from '../core/GameState.js';
import { uiStateStore } from '../core/UiStateStore.js';
import { WEAPONS, SPELLS } from '../data/ItemRegistry.js';
import {
    PLAYER_RADIUS,
    ARROW_MIN_SPEED,
    ARROW_MAX_SPEED,
    BOW_MIN_CHARGE_MS,
    BOW_FULL_CHARGE_MS,
    SWORD_QUEUE_GRACE_MS,
    SWORD_SWING_1_WINDUP_MS,
    SWORD_SWING_1_ACTIVE_MS,
    SWORD_SWING_2_WINDUP_MS,
    SWORD_SWING_2_ACTIVE_MS,
    SWORD_SWING_3_WINDUP_MS,
    SWORD_SWING_3_ACTIVE_MS,
    FISTS_SWING_WINDUP_MS,
    FISTS_SWING_ACTIVE_MS,
    FISTS_QUEUE_GRACE_MS,
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
}

class ComboWeaponStateMachine {
    constructor(owner, steps, queueGraceMs) {
        this.owner = owner;
        this.steps = steps;
        this.queueGraceMs = queueGraceMs;

        this.phase = 'idle';
        this.timerMs = 0;
        this.stepIndex = 0;
        this.queuedNext = false;
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
        }
    }

    _startStep(index) {
        this.stepIndex = index;
        this.phase = 'windup';
        this.timerMs = this.steps[index].windupMs;
        this.queuedNext = false;
    }

    _triggerHitForCurrentStep() {
        const step = this.steps[this.stepIndex];
        this.owner._spawnMeleeArc(step.attackSpec, step.activeMs);
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
        this.weaponStateMachines = {
            bow: new BowWeaponStateMachine(this),
            sword: new ComboWeaponStateMachine(this, [
                {
                    windupMs: SWORD_SWING_1_WINDUP_MS,
                    activeMs: SWORD_SWING_1_ACTIVE_MS,
                    attackSpec: { radius: 58, arc: Math.PI * 0.62, color: 0xd2d8ff, alpha: 0.78 },
                },
                {
                    windupMs: SWORD_SWING_2_WINDUP_MS,
                    activeMs: SWORD_SWING_2_ACTIVE_MS,
                    attackSpec: { radius: 74, arc: Math.PI * 0.72, color: 0xc4ceff, alpha: 0.8 },
                },
                {
                    windupMs: SWORD_SWING_3_WINDUP_MS,
                    activeMs: SWORD_SWING_3_ACTIVE_MS,
                    attackSpec: { radius: 102, arc: Math.PI * 0.88, color: 0xb8c2ff, alpha: 0.84 },
                },
            ], SWORD_QUEUE_GRACE_MS),
            unarmed: new ComboWeaponStateMachine(this, [
                {
                    windupMs: FISTS_SWING_WINDUP_MS,
                    activeMs: FISTS_SWING_ACTIVE_MS,
                    attackSpec: { radius: 46, arc: Math.PI * 0.56, color: 0xff9b47, alpha: 0.85 },
                },
            ], FISTS_QUEUE_GRACE_MS),
        };

        this._unsubscribeControlChanged = null;
        this._unsubscribeLoadoutChanged = null;

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

        if (!down) return;
        const spell = loadout?.getEquippedSpell() ?? SPELLS.nothing;
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

    _spawnMeleeArc({ radius, arc, color, alpha }, activeDurationMs) {
        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const scene = this.entity.scene;
        const aim = this._resolveCurrentAimTarget();
        const dx = aim.x - transform.position.x;
        const dy = aim.y - transform.position.y;
        const angle = Math.atan2(dy, dx);

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

        if (this.entity.id === this.entity.scene.player?.id) {
            networkManager.sendBullet(spawnX, spawnY, nx * speed, ny * speed, gameState.currentLevelId, {
                projectileType: 'arrow',
                chargeRatio: pct,
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
            case 'nothing':
            default:
                break;
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
