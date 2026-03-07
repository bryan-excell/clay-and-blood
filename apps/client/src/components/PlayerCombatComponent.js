import { Component } from './Component.js';
import { eventBus } from '../core/EventBus.js';
import { networkManager } from '../core/NetworkManager.js';
import { gameState } from '../core/GameState.js';
import { uiStateStore } from '../core/UiStateStore.js';
import { WEAPONS, SPELLS } from '../data/ItemRegistry.js';
import { PLAYER_RADIUS, ARROW_MIN_SPEED, ARROW_MAX_SPEED, BOW_FULL_CHARGE_MS } from '../config.js';

/**
 * Combat component for player-like controllable entities.
 *
 * Dispatches primary and secondary actions based on what is currently equipped
 * in the entity's LoadoutComponent:
 *
 *   LMB → equipped weapon primary action
 *   RMB → if weapon.mouseUsage === 'both': weapon secondary action
 *          otherwise: equipped spell primary action
 *
 * Entities without a LoadoutComponent fall back to unarmed/nothing behavior.
 */
export class PlayerCombatComponent extends Component {
    constructor() {
        super('playerCombat');

        this.bowCharging   = false;
        this.bowChargeTime = 0;
        this.chargeBarGfx  = null;
        this.spearActive   = false;

        this._unsubscribeControlChanged = null;

        this.requireComponent('intent');
        this.optionalComponent('control');
        this.optionalComponent('loadout');
    }

    onAttach() {
        if (!super.onAttach()) return false;

        this._setupMouseInput();

        this._unsubscribeControlChanged = eventBus.on('control:changed', ({ entityId, controlMode }) => {
            if (entityId !== this.entity.id) return;
            if (controlMode !== 'local' && this.bowCharging) {
                this.bowCharging   = false;
                this.bowChargeTime = 0;
                this._destroyChargeBar();
            }
            if (controlMode !== 'local') {
                this.entity.getComponent('intent')?.clearTransient();
            }
        });

        return true;
    }

    onDetach() {
        const scene = this.entity?.scene;
        if (scene) {
            scene.input.off('pointerdown', this._onPointerDown, this);
            scene.input.off('pointerup',   this._onPointerUp,   this);
        }

        this._destroyChargeBar();

        if (this._unsubscribeControlChanged) {
            this._unsubscribeControlChanged();
            this._unsubscribeControlChanged = null;
        }
    }

    isLocallyControlled() {
        const control = this.entity.getComponent('control');
        return !!control && control.controlMode === 'local';
    }

    // ------------------------------------------------------------------
    // Mouse input capture
    // ------------------------------------------------------------------

    _setupMouseInput() {
        const scene = this.entity.scene;
        scene.input.off('pointerdown', this._onPointerDown, this);
        scene.input.off('pointerup',   this._onPointerUp,   this);
        scene.input.on('pointerdown',  this._onPointerDown, this);
        scene.input.on('pointerup',    this._onPointerUp,   this);
    }

    _onPointerDown(pointer) {
        if (!this.isLocallyControlled()) return;
        // Suppress clicks that land inside the open inventory drawer.
        if (this._isPointerInsideUiDrawer(pointer)) return;
        this._writeAimFromPointer(pointer);

        const intent = this.entity.getComponent('intent');
        if (!intent) return;

        if (pointer.leftButtonDown()) {
            intent.wantsAttackPrimary = true;
        } else if (pointer.rightButtonDown()) {
            intent.wantsAttackSecondary = true;
        }
    }

    _onPointerUp(pointer) {
        if (!this.isLocallyControlled()) return;
        // Prevent mouse-up on UI from falling through to gameplay actions.
        if (this._isPointerInsideUiDrawer(pointer)) return;
        this._writeAimFromPointer(pointer);

        const intent = this.entity.getComponent('intent');
        if (!intent) return;

        // Left button release fires primary again so the bow can release its charge.
        if (pointer.button === 0 || pointer.leftButtonReleased()) {
            intent.wantsAttackPrimary = true;
        }
    }

    _writeAimFromPointer(pointer) {
        const intent    = this.entity.getComponent('intent');
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

    // ------------------------------------------------------------------
    // Primary / secondary dispatch (called by CombatSystem)
    // ------------------------------------------------------------------

    /**
     * Dispatches the primary action for the currently equipped weapon.
     * @param {number} targetX
     * @param {number} targetY
     */
    handlePrimaryAttack(targetX, targetY) {
        const loadout = this.entity.getComponent('loadout');
        const weapon  = loadout?.getEquippedWeapon() ?? WEAPONS.unarmed;
        this._handleWeaponPrimary(weapon, targetX, targetY);
    }

    /**
     * Dispatches either the weapon's secondary action (if weapon.mouseUsage === 'both')
     * or the equipped spell's primary action.
     * @param {number} targetX
     * @param {number} targetY
     */
    handleSecondaryAttack(targetX, targetY) {
        const loadout = this.entity.getComponent('loadout');
        const weapon  = loadout?.getEquippedWeapon() ?? WEAPONS.unarmed;

        if (weapon.mouseUsage === 'both') {
            this._handleWeaponSecondary(weapon, targetX, targetY);
        } else {
            const spell = loadout?.getEquippedSpell() ?? SPELLS.nothing;
            this._handleSpellPrimary(spell, targetX, targetY);
        }
    }

    // ------------------------------------------------------------------
    // Weapon actions
    // ------------------------------------------------------------------

    _handleWeaponPrimary(weapon, targetX, targetY) {
        switch (weapon.id) {
            case 'bow':
                if (this.bowCharging) this._releaseArrow(targetX, targetY);
                else this._startBowCharge();
                break;

            case 'unarmed':
            default:
                this.swipeMelee(targetX, targetY);
                break;
        }
    }

    _handleWeaponSecondary(weapon, targetX, targetY) {
        // Placeholder for future dual-bind weapon secondary actions.
        // e.g. case 'bomb': detonate
        switch (weapon.id) {
            default:
                break;
        }
    }

    // ------------------------------------------------------------------
    // Spell actions
    // ------------------------------------------------------------------

    _handleSpellPrimary(spell, targetX, targetY) {
        switch (spell.id) {
            case 'possess':
                this.castPossess(targetX, targetY);
                break;

            case 'nothing':
            default:
                break;
        }
    }

    // ------------------------------------------------------------------
    // Concrete weapon implementations
    // ------------------------------------------------------------------

    swipeMelee(targetX, targetY) {
        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const scene = this.entity.scene;
        const dx    = targetX - transform.position.x;
        const dy    = targetY - transform.position.y;
        const angle = Math.atan2(dy, dx);

        const SWIPE_RADIUS = 55;
        const SWIPE_ARC    = Math.PI * 0.55;

        const gfx = scene.add.graphics();
        gfx.fillStyle(0xFF8800, 0.8);
        gfx.beginPath();
        gfx.moveTo(transform.position.x, transform.position.y);
        gfx.arc(
            transform.position.x, transform.position.y,
            SWIPE_RADIUS,
            angle - SWIPE_ARC / 2,
            angle + SWIPE_ARC / 2
        );
        gfx.closePath();
        gfx.fillPath();

        scene.tweens.add({
            targets: gfx,
            alpha: 0,
            duration: 160,
            ease: 'Quad.easeOut',
            onComplete: () => gfx.destroy(),
        });
    }

    thrustSpear(targetX, targetY) {
        if (this.spearActive) return;

        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const scene = this.entity.scene;
        const dx    = targetX - transform.position.x;
        const dy    = targetY - transform.position.y;
        const angle = Math.atan2(dy, dx);

        const SPEAR_LENGTH = 100;
        const startX = transform.position.x + Math.cos(angle) * PLAYER_RADIUS;
        const startY = transform.position.y + Math.sin(angle) * PLAYER_RADIUS;

        const spear = scene.add.rectangle(startX, startY, SPEAR_LENGTH, 5, 0xCCCCFF);
        spear.setOrigin(0, 0.5);
        spear.setRotation(angle);
        spear.setScale(0, 1);

        this.spearActive = true;
        scene.tweens.add({
            targets: spear,
            scaleX: 1,
            duration: 110,
            ease: 'Quad.easeOut',
            onComplete: () => {
                scene.tweens.add({
                    targets: spear,
                    scaleX: 0,
                    duration: 160,
                    ease: 'Quad.easeIn',
                    onComplete: () => {
                        spear.destroy();
                        this.spearActive = false;
                    },
                });
            },
        });
    }

    // ------------------------------------------------------------------
    // Bow implementation
    // ------------------------------------------------------------------

    _startBowCharge() {
        this.bowCharging   = true;
        this.bowChargeTime = 0;
    }

    _releaseArrow(targetX, targetY) {
        this.bowCharging = false;
        this._destroyChargeBar();

        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const scene = this.entity.scene;
        const dx    = targetX - transform.position.x;
        const dy    = targetY - transform.position.y;
        const len   = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return;

        const nx    = dx / len;
        const ny    = dy / len;
        const angle = Math.atan2(dy, dx);

        const pct   = Math.min(this.bowChargeTime / BOW_FULL_CHARGE_MS, 1);
        const speed = ARROW_MIN_SPEED + (ARROW_MAX_SPEED - ARROW_MIN_SPEED) * pct;

        const spawnX = transform.position.x + nx * (PLAYER_RADIUS + 8);
        const spawnY = transform.position.y + ny * (PLAYER_RADIUS + 8);

        const arrowEntity = scene.entityFactory.createFromPrefab('arrow', {
            x: spawnX, y: spawnY,
            velocityX: nx * speed,
            velocityY: ny * speed,
            angle,
        });
        const arrowGO = arrowEntity.getComponent('rectangle')?.gameObject;
        scene.lightingRenderer?.maskGameObject(arrowGO);

        const flash = scene.add.circle(spawnX, spawnY, PLAYER_RADIUS * 0.5, 0xFFFF88, 0.8);
        scene.tweens.add({
            targets: flash,
            alpha: 0, scaleX: 2, scaleY: 2,
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

    _updateChargeBar() {
        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const pct  = Math.min(this.bowChargeTime / BOW_FULL_CHARGE_MS, 1);
        const barW = 36;
        const barH = 6;
        const bx   = transform.position.x - barW / 2;
        const by   = transform.position.y - PLAYER_RADIUS - 16;

        if (!this.chargeBarGfx) {
            this.chargeBarGfx = this.entity.scene.add.graphics();
            this.chargeBarGfx.setDepth(200);
        }

        this.chargeBarGfx.clear();
        this.chargeBarGfx.fillStyle(0x111111, 0.9);
        this.chargeBarGfx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);

        const fillColor = pct < 0.5 ? 0x44DD44 : pct < 0.85 ? 0xFFDD00 : 0xFF8800;
        this.chargeBarGfx.fillStyle(fillColor, 1);
        this.chargeBarGfx.fillRect(bx, by, Math.ceil(barW * pct), barH);
    }

    _destroyChargeBar() {
        if (this.chargeBarGfx) {
            this.chargeBarGfx.destroy();
            this.chargeBarGfx = null;
        }
    }

    // ------------------------------------------------------------------
    // Spell implementations
    // ------------------------------------------------------------------

    castPossess(targetX, targetY) {
        const scene    = this.entity.scene;
        const possessed = scene.tryPossessAtWorldPoint(this.entity, targetX, targetY);

        const color = possessed ? 0x7fe8ff : 0x555f6a;
        const fx    = scene.add.circle(targetX, targetY, possessed ? 20 : 12, color, 0.55);
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

    // ------------------------------------------------------------------
    // Aim resolution
    // ------------------------------------------------------------------

    resolveAimTarget(intent) {
        const transform = this.entity.getComponent('transform');
        const scene     = this.entity.scene;
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

    // ------------------------------------------------------------------
    // Update
    // ------------------------------------------------------------------

    update(deltaTime) {
        if (this.bowCharging) {
            this.bowChargeTime = Math.min(this.bowChargeTime + deltaTime, BOW_FULL_CHARGE_MS);
            this._updateChargeBar();
        }
    }
}
