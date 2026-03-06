import { Component } from './Component.js';
import { eventBus } from '../core/EventBus.js';
import { networkManager } from '../core/NetworkManager.js';
import { gameState } from '../core/GameState.js';
import { PLAYER_SPEED, PLAYER_SPRINT_MULTIPLIER, PLAYER_RADIUS, BULLET_SPEED,
    ARROW_MIN_SPEED, ARROW_MAX_SPEED, BOW_FULL_CHARGE_MS } from '../config.js';

/**
 * Movement and attack state machine for the player
 * Controls player behavior based on input and current state
 */
export class PlayerStateMachine extends Component {
    /**
     * Create a new PlayerStateMachine component
     */
    constructor() {
        super('playerStateMachine');
        
        // Define all possible movement states
        this.movementStates = {
            STANDING: 'standing',
            WALKING: 'walking',
            RUNNING: 'running',
            DASHING: 'dashing'
        };
        
        // Define all possible attack types
        this.attackTypes = {
            PRIMARY: 'primary',
            SECONDARY: 'secondary'
        };
        
        // Weapon state
        this.currentWeapon = 1; // 1=bow, 2=melee, 3=spear
        this.spearActive = false; // prevent overlapping spear thrusts
        this.weaponUI = null; // HUD game objects

        // Bow charge state
        this.bowCharging = false;
        this.bowChargeTime = 0; // ms held so far
        this.chargeBarGfx = null; // world-space charge bar graphics

        // Current state tracking
        this.currentMovementState = this.movementStates.STANDING;
        this.dashCooldown = 0;
        this.dashDuration = 0;
        this.dashDirection = { x: 0, y: 0 };
        this.maxDashCooldown = 1000; // 1 second cooldown between dashes
        this.maxDashDuration = 250;  // dash lasts 250ms
        this.desiredVelocity = { x: 0, y: 0 };
        this._unsubscribeControlChanged = null;

        this.requireComponent('intent');
        this.optionalComponent('control');
    }
    
    /**
     * Handle component initialization
     * @returns {boolean} True if successfully attached
     */
    onAttach() {
        if (!super.onAttach()) return false;
        
        // Set up attack input listeners
        this.setupMouseInput();

        // Set up weapon-switch keys (1/2/3)
        const scene = this.entity.scene;
        scene.input.keyboard.on('keydown-ONE',   () => this._onWeaponKey(1), this);
        scene.input.keyboard.on('keydown-TWO',   () => this._onWeaponKey(2), this);
        scene.input.keyboard.on('keydown-THREE', () => this._onWeaponKey(3), this);

        // Create weapon HUD
        this.createWeaponUI();
        this._unsubscribeControlChanged = eventBus.on('control:changed', ({ entityId, controlMode }) => {
            if (entityId !== this.entity.id) return;
            if (controlMode !== 'local' && this.bowCharging) {
                this.bowCharging = false;
                this.bowChargeTime = 0;
                this._destroyChargeBar();
            }
            if (controlMode !== 'local') {
                const intent = this.entity.getComponent('intent');
                intent?.clearTransient();
            }
        });

        console.log("Player state machine initialized");
        return true;
    }
    
    /**
     * Clean up event listeners and HUD on detach.
     */
    onDetach() {
        const scene = this.entity?.scene;
        if (scene) {
            scene.input.keyboard.off('keydown-ONE',   undefined, this);
            scene.input.keyboard.off('keydown-TWO',   undefined, this);
            scene.input.keyboard.off('keydown-THREE', undefined, this);
            scene.input.off('pointerdown', this._onPointerDown, this);
            scene.input.off('pointerup',   this._onPointerUp,   this);
        }
        this._destroyChargeBar();
        if (this._unsubscribeControlChanged) {
            this._unsubscribeControlChanged();
            this._unsubscribeControlChanged = null;
        }
        if (this.weaponUI) {
            this.weaponUI.forEach(({ bg, text }) => { bg.destroy(); text.destroy(); });
            this.weaponUI = null;
        }
    }

    /**
     * Set up mouse input for attacks
     */
    setupMouseInput() {
        const scene = this.entity.scene;
        scene.input.off('pointerdown', this._onPointerDown, this);
        scene.input.off('pointerup',   this._onPointerUp,   this);
        scene.input.on('pointerdown',  this._onPointerDown, this);
        scene.input.on('pointerup',    this._onPointerUp,   this);
    }

    _isLocallyControlled() {
        const control = this.entity.getComponent('control');
        return !!control && control.controlMode === 'local';
    }

    _onWeaponKey(index) {
        if (!this._isLocallyControlled()) return;
        this.setWeapon(index);
    }

    _onPointerDown(pointer) {
        if (!this._isLocallyControlled()) return;
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
        if (!this._isLocallyControlled()) return;
        this._writeAimFromPointer(pointer);

        const intent = this.entity.getComponent('intent');
        if (!intent) return;

        if (pointer.button === 0 || pointer.leftButtonReleased()) {
            intent.wantsAttackPrimary = true;
        }
    }

    /**
     * Begin charging the bow on left mouse down.
     */
    _startBowCharge() {
        this.bowCharging = true;
        this.bowChargeTime = 0;
    }

    /**
     * Fire the arrow on left mouse up. Speed scales with charge time.
     * @param {number} targetX
     * @param {number} targetY
     */
    _releaseArrow(targetX, targetY) {
        this.bowCharging = false;
        this._destroyChargeBar();

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

        // Speed scales linearly from ARROW_MIN_SPEED to ARROW_MAX_SPEED
        const pct = Math.min(this.bowChargeTime / BOW_FULL_CHARGE_MS, 1);
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

        // Brief release flash
        const flash = scene.add.circle(spawnX, spawnY, PLAYER_RADIUS * 0.5, 0xFFFF88, 0.8);
        scene.tweens.add({
            targets: flash,
            alpha: 0,
            scaleX: 2,
            scaleY: 2,
            duration: 60,
            ease: 'Quad.easeOut',
            onComplete: () => flash.destroy(),
        });

        networkManager.sendBullet(spawnX, spawnY, nx * speed, ny * speed, gameState.currentLevelId, {
            projectileType: 'arrow',
            chargeRatio:    pct,
        });
    }

    _writeAimFromPointer(pointer) {
        const intent = this.entity.getComponent('intent');
        const transform = this.entity.getComponent('transform');
        if (!intent || !transform) return;

        const worldPoint = this.entity.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        intent.aimX = worldPoint.x - transform.position.x;
        intent.aimY = worldPoint.y - transform.position.y;
    }

    /**
     * Draw/update the world-space charge bar above the player.
     */
    _updateChargeBar() {
        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const pct = Math.min(this.bowChargeTime / BOW_FULL_CHARGE_MS, 1);
        const barW = 36;
        const barH = 6;
        const bx = transform.position.x - barW / 2;
        const by = transform.position.y - PLAYER_RADIUS - 16;

        if (!this.chargeBarGfx) {
            this.chargeBarGfx = this.entity.scene.add.graphics();
            this.chargeBarGfx.setDepth(200);
        }

        this.chargeBarGfx.clear();

        // Dark background border
        this.chargeBarGfx.fillStyle(0x111111, 0.9);
        this.chargeBarGfx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);

        // Charge fill: green → yellow → orange
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

    /**
     * Switch the active weapon and refresh the HUD.
     * @param {number} num - 1, 2, or 3
     */
    setWeapon(num) {
        this.currentWeapon = num;
        this.updateWeaponUI();
    }

    /**
     * Melee swipe: an orange wedge that fans out toward the mouse and fades.
     * @param {number} targetX
     * @param {number} targetY
     */
    swipeMelee(targetX, targetY) {
        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const scene = this.entity.scene;
        const dx = targetX - transform.position.x;
        const dy = targetY - transform.position.y;
        const angle = Math.atan2(dy, dx);

        const SWIPE_RADIUS = 55;
        const SWIPE_ARC = Math.PI * 0.55; // ~100 degree arc

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

    /**
     * Spear thrust: a thin silver rectangle that juts out toward the mouse then retracts.
     * @param {number} targetX
     * @param {number} targetY
     */
    thrustSpear(targetX, targetY) {
        if (this.spearActive) return;

        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const scene = this.entity.scene;
        const dx = targetX - transform.position.x;
        const dy = targetY - transform.position.y;
        const angle = Math.atan2(dy, dx);

        const SPEAR_LENGTH = 100;
        const startX = transform.position.x + Math.cos(angle) * PLAYER_RADIUS;
        const startY = transform.position.y + Math.sin(angle) * PLAYER_RADIUS;

        // Origin (0, 0.5): left edge anchored at player surface, extends outward
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

    /**
     * Create the weapon selection HUD (fixed to screen, bottom-left).
     */
    createWeaponUI() {
        const scene = this.entity.scene;
        const LABELS = ['1 Bow', '2 Melee', '3 Spear'];
        const slotW = 72;
        const slotH = 28;
        const padding = 6;
        const startX = 10;
        const startY = scene.scale.height - slotH - 10;

        this.weaponUI = LABELS.map((label, i) => {
            const x = startX + i * (slotW + padding);
            const bg = scene.add.rectangle(x, startY, slotW, slotH, 0x222222, 0.85)
                .setOrigin(0, 0)
                .setScrollFactor(0)
                .setDepth(100);
            const text = scene.add.text(x + slotW / 2, startY + slotH / 2, label, {
                fontSize: '13px',
                color: '#ffffff',
                fontFamily: 'monospace',
            })
                .setOrigin(0.5, 0.5)
                .setScrollFactor(0)
                .setDepth(101);
            return { bg, text };
        });

        this.updateWeaponUI();
    }

    /**
     * Highlight the active weapon slot in the HUD.
     */
    updateWeaponUI() {
        if (!this.weaponUI) return;
        this.weaponUI.forEach(({ bg }, i) => {
            const active = i + 1 === this.currentWeapon;
            bg.setFillStyle(active ? 0x885500 : 0x222222, active ? 1 : 0.85);
            bg.setStrokeStyle(active ? 2 : 0, 0xFFAA00);
        });
    }

    /**
     * Update dash cooldown/state from resolved intent.
     * @param {object} intent
     * @param {number} deltaTime - Time in ms since last update
     */
    updateDashState(intent, deltaTime) {
        const inputState = this._intentToInputState(intent);

        // If currently dashing, manage dash state
        if (this.currentMovementState === this.movementStates.DASHING) {
            this.dashDuration -= deltaTime;

            if (this.dashDuration <= 0) {
                // Dash has finished
                this.dashDuration = 0;
                
                // Determine the next state based on input
                if (inputState.up || inputState.down || inputState.left || inputState.right) {
                    this.currentMovementState = inputState.sprint ? 
                        this.movementStates.RUNNING : this.movementStates.WALKING;
                } else {
                    this.currentMovementState = this.movementStates.STANDING;
                }
                this.applyMovementFromIntent(intent);
                
                console.log(`Dash ended, now ${this.currentMovementState}`);
            }
            this.desiredVelocity.x = this.dashDirection.x * 800;
            this.desiredVelocity.y = this.dashDirection.y * 800;
            return;
        }
        
        // Update dash cooldown
        if (this.dashCooldown > 0) {
            this.dashCooldown -= deltaTime;
            if (this.dashCooldown < 0) this.dashCooldown = 0;
        }
        
        // Check for dash input (space)
        if (inputState.dash && this.dashCooldown === 0 && 
            this.currentMovementState !== this.movementStates.STANDING) {
            // Start a dash
            this.startDashFromIntent(intent);
            return;
        }
    }

    /**
     * Updates walking/running/standing state from resolved intent.
     * No-op while dashing.
     * @param {object} intent
     */
    updateLocomotionState(intent) {
        if (this.currentMovementState === this.movementStates.DASHING) return;

        const moving = Math.abs(intent.moveX) > 0.0001 || Math.abs(intent.moveY) > 0.0001;
        if (moving) {
            const newState = intent.wantsSprint ? this.movementStates.RUNNING : this.movementStates.WALKING;
            if (this.currentMovementState !== newState) {
                this.currentMovementState = newState;
                console.log(`Movement state: ${this.currentMovementState}`);
            }
            return;
        }

        if (this.currentMovementState !== this.movementStates.STANDING) {
            this.currentMovementState = this.movementStates.STANDING;
            console.log(`Movement state: ${this.currentMovementState}`);
        }
    }
    
    /**
     * Start a dash in the current movement direction
     */
    startDashFromIntent(intent) {
        // Can only dash if moving
        if (this.currentMovementState === this.movementStates.STANDING) {
            return;
        }

        this.dashDirection = { x: intent.moveX, y: intent.moveY };

        // If no direction, use the last known direction or default to down
        if (this.dashDirection.x === 0 && this.dashDirection.y === 0) {
            // Default to downward dash if no direction is available
            this.dashDirection = { x: 0, y: 1 };
        }

        // Normalize diagonal directions so all dashes travel at the same speed
        const dirLen = Math.sqrt(this.dashDirection.x ** 2 + this.dashDirection.y ** 2);
        if (dirLen > 0) {
            this.dashDirection.x /= dirLen;
            this.dashDirection.y /= dirLen;
        }
        
        // Set dash state
        this.currentMovementState = this.movementStates.DASHING;
        this.dashDuration = this.maxDashDuration;
        this.dashCooldown = this.maxDashCooldown;

        console.log(`Started dash in direction (${this.dashDirection.x}, ${this.dashDirection.y})`);

        // Inform the server immediately so it mirrors the dash (prevents rubber-banding)
        const keyboard = this.entity.getComponent('keyboard');
        const dashInput = keyboard?.inputState ?? this._intentToInputState(intent);
        const dashSeq = networkManager.sendDash(dashInput);

        // Let GameScene know a dash started so it can update the reconciliation input buffer
        eventBus.emit('player:dashStarted', { input: dashInput, seq: dashSeq });
        this.desiredVelocity.x = this.dashDirection.x * 800;
        this.desiredVelocity.y = this.dashDirection.y * 800;
    }
    
    /**
     * Perform an attack based on current movement state
     * @param {string} attackType - Type of attack (primary or secondary)
     */
    attack(attackType) {
        const attackName = `${this.currentMovementState}_${attackType}`;
        console.log(`Performing attack: ${attackName}`);
        
        // Different attacks based on movement state
        switch (this.currentMovementState) {
            case this.movementStates.STANDING:
                this.performStandingAttack(attackType);
                break;
            case this.movementStates.WALKING:
                this.performWalkingAttack(attackType);
                break;
            case this.movementStates.RUNNING:
                this.performRunningAttack(attackType);
                break;
            case this.movementStates.DASHING:
                this.performDashingAttack(attackType);
                break;
        }
        
        // Emit an event for attack
        eventBus.emit('player:attack', {
            entity: this.entity,
            attackType: attackType,
            movementState: this.currentMovementState
        });
    }
    
    /**
     * Perform standing attack
     * @param {string} attackType - Type of attack (primary or secondary)
     */
    performStandingAttack(attackType) {
        if (attackType === this.attackTypes.PRIMARY) {
            console.log("Standing Primary Attack: A precise strike");
        } else {
            console.log("Standing Secondary Attack: A defensive counter move");
        }
    }
    
    /**
     * Perform walking attack
     * @param {string} attackType - Type of attack (primary or secondary)
     */
    performWalkingAttack(attackType) {
        if (attackType === this.attackTypes.PRIMARY) {
            console.log("Walking Primary Attack: A mobile strike");
        } else {
            console.log("Walking Secondary Attack: A directional power move");
        }
    }
    
    /**
     * Perform running attack
     * @param {string} attackType - Type of attack (primary or secondary)
     */
    performRunningAttack(attackType) {
        if (attackType === this.attackTypes.PRIMARY) {
            console.log("Running Primary Attack: A lunging strike with momentum");
        } else {
            console.log("Running Secondary Attack: A spinning area attack");
        }
    }
    
    /**
     * Perform dashing attack
     * @param {string} attackType - Type of attack (primary or secondary)
     */
    performDashingAttack(attackType) {
        if (attackType === this.attackTypes.PRIMARY) {
            console.log("Dashing Primary Attack: A powerful piercing attack");
        } else {
            console.log("Dashing Secondary Attack: A shockwave blast on impact");
        }
    }
    
    /**
     * Update component state
     * @param {number} deltaTime - Time in ms since last update
     */
    update(deltaTime) {
        // Tick bow charge
        if (this.bowCharging) {
            this.bowChargeTime = Math.min(this.bowChargeTime + deltaTime, BOW_FULL_CHARGE_MS);
            this._updateChargeBar();
        }

        this._consumeAttackIntent();
    }
    
    /**
     * Apply movement based on current state and resolved intent.
     * @param {object} intent
     */
    applyMovementFromIntent(intent) {
        // Skip if dashing (handled in startDash)
        if (this.currentMovementState === this.movementStates.DASHING) {
            return;
        }
        
        // Calculate movement direction
        const direction = {
            x: intent.moveX ?? 0,
            y: intent.moveY ?? 0
        };
        
        // Check if there's any movement input
        const isMoving = direction.x !== 0 || direction.y !== 0;
        
        if (isMoving) {
            // Normalize direction vector for diagonal movement
            if (direction.x !== 0 && direction.y !== 0) {
                const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
                direction.x /= length;
                direction.y /= length;
            }
            
            // Set speed based on movement state (must match server PLAYER_SPEED constants)
            let speed = 0;
            switch (this.currentMovementState) {
                case this.movementStates.WALKING:
                    speed = PLAYER_SPEED;
                    break;
                case this.movementStates.RUNNING:
                    speed = PLAYER_SPEED * PLAYER_SPRINT_MULTIPLIER;
                    break;
                default:
                    speed = 0;
            }
            
            // Apply movement
            this.desiredVelocity.x = direction.x * speed;
            this.desiredVelocity.y = direction.y * speed;
        } else {
            // No movement
            this.desiredVelocity.x = 0;
            this.desiredVelocity.y = 0;
        }
    }

    _intentToInputState(intent) {
        return {
            up: (intent.moveY ?? 0) < -0.0001,
            down: (intent.moveY ?? 0) > 0.0001,
            left: (intent.moveX ?? 0) < -0.0001,
            right: (intent.moveX ?? 0) > 0.0001,
            sprint: !!intent.wantsSprint,
            dash: !!intent.wantsDash,
        };
    }

    _consumeAttackIntent() {
        if (!this._isLocallyControlled()) return;

        const intent = this.entity.getComponent('intent');
        if (!intent) return;

        const { x: targetX, y: targetY } = this._resolveAimTarget(intent);

        if (intent.wantsAttackPrimary) {
            if (this.currentWeapon === 1) {
                if (this.bowCharging) this._releaseArrow(targetX, targetY);
                else this._startBowCharge();
            } else if (this.currentWeapon === 2) {
                this.swipeMelee(targetX, targetY);
            } else if (this.currentWeapon === 3) {
                this.thrustSpear(targetX, targetY);
            }
        }

        if (intent.wantsAttackSecondary) {
            this.attack(this.attackTypes.SECONDARY);
        }

        intent.clearTransient();
    }

    _resolveAimTarget(intent) {
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
}
