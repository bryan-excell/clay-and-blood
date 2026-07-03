import Phaser from 'phaser';
import { STAGE_RENDER_DEPTH } from '../config.js';
import { PARTICLE_SEMANTIC_COLORS } from './ParticleColors.js';
import { PARTICLE_TEXTURES } from './ParticleTextureFactory.js';
import { zonePalette } from './ZonePalette.js';

const REMOTE_ORBIT_MOTES = 12;
const TWO_PI = Math.PI * 2;

export class RemoteSpiritVisual {
    constructor(scene, x, y, options = {}) {
        this.scene = scene;
        this.radius = options.radius ?? 16;
        this.tintBias = options.tintBias ?? 0xbad7ff;
        this._lastPosition = { x, y };
        this._velocity = { x: 0, y: 0 };
        this._time = 0;
        this._maskedObjects = new Set();
        this._motes = [];

        this.glow = scene.add.image(x, y, PARTICLE_TEXTURES.spiritCore)
            .setDepth(STAGE_RENDER_DEPTH.actors + 0.65)
            .setBlendMode('ADD')
            .setTint(0x78cfff)
            .setAlpha(0.24)
            .setScale(1.05);
        this.core = scene.add.image(x, y, PARTICLE_TEXTURES.spiritCore)
            .setDepth(STAGE_RENDER_DEPTH.actors + 0.85)
            .setBlendMode('ADD')
            .setTint(this.tintBias)
            .setAlpha(0.84)
            .setScale(0.48);

        for (let i = 0; i < REMOTE_ORBIT_MOTES; i++) {
            const image = scene.add.image(x, y, PARTICLE_TEXTURES.spiritMote)
                .setDepth(STAGE_RENDER_DEPTH.actors + 0.75)
                .setBlendMode('ADD')
                .setTint(i % 3 === 0 ? zonePalette.getActivePalette().accent : this.tintBias)
                .setAlpha(0.48)
                .setScale(0.48);
            this._motes.push({
                image,
                angle: (i / REMOTE_ORBIT_MOTES) * TWO_PI,
                radiusBias: 0.78 + (i % 4) * 0.1,
                speedBias: 0.85 + (i % 3) * 0.14,
            });
        }

        this.bodyEmitter = scene.add.particles(x, y, PARTICLE_TEXTURES.soft, {
            blendMode: 'NORMAL',
            lifespan: { min: 520, max: 880 },
            speed: { min: 3, max: 14 },
            scale: { start: 0.44, end: 0.02 },
            alpha: { start: 0.48, end: 0 },
            frequency: 42,
            quantity: 2,
            tint: [this.tintBias, zonePalette.getActivePalette().accent],
            maxAliveParticles: 120,
            emitZone: {
                type: 'edge',
                source: new Phaser.Geom.Circle(0, 0, this.radius * 0.95),
                quantity: 14,
            },
        });
        this.bodyEmitter.setDepth(STAGE_RENDER_DEPTH.actors + 0.15);

        this.trailEmitter = scene.add.particles(x, y, PARTICLE_TEXTURES.streak, {
            blendMode: 'ADD',
            lifespan: { min: 120, max: 220 },
            speed: { min: 6, max: 28 },
            scale: { start: 0.32, end: 0 },
            alpha: { start: 0.28, end: 0 },
            frequency: 34,
            quantity: 1,
            tint: [this.tintBias, 0xffffff],
            maxAliveParticles: 50,
            emitting: false,
        });
        this.trailEmitter.setDepth(STAGE_RENDER_DEPTH.actors + 0.05);
        this.trailEmitter.stop?.();
        this.tryApplyVisibilityMask();
    }

    setPosition(x, y, deltaMs = 16.67) {
        const dt = Math.max(1, deltaMs) / 1000;
        const previous = this._lastPosition ?? { x, y };
        this._velocity.x = (x - previous.x) / dt;
        this._velocity.y = (y - previous.y) / dt;
        this._lastPosition = { x, y };
        this._time += deltaMs;

        const speed = Math.sqrt(this._velocity.x ** 2 + this._velocity.y ** 2);
        const dir = speed > 8
            ? { x: this._velocity.x / speed, y: this._velocity.y / speed }
            : { x: 0, y: 0 };
        const breath = Math.sin(this._time / 920);
        const lag = Math.min(9, speed * 0.025);

        this.core.setPosition(x, y).setScale(0.48 * (1 + breath * 0.035));
        this.glow.setPosition(x, y).setScale(1.02 * (1 + breath * 0.055));
        this.bodyEmitter.setPosition(x - dir.x * lag, y - dir.y * lag);
        this.trailEmitter.setPosition(x - dir.x * 10, y - dir.y * 10);
        if (speed > 34) this.trailEmitter.start?.();
        else this.trailEmitter.stop?.();

        for (let i = 0; i < this._motes.length; i++) {
            const mote = this._motes[i];
            mote.angle += deltaMs * 0.001 * mote.speedBias;
            const radius = this.radius * mote.radiusBias * (1 + breath * 0.04);
            const px = Math.cos(mote.angle) * radius - dir.x * lag;
            const py = Math.sin(mote.angle) * radius * 0.78 - dir.y * lag;
            mote.image
                .setPosition(x + px, y + py)
                .setAlpha(0.34 + Math.sin(this._time / 700 + i) * 0.08)
                .setScale(0.42 + Math.sin(this._time / 1000 + i) * 0.04);
        }
    }

    setVisible(visible) {
        for (const object of this._objects()) object?.setVisible?.(!!visible);
    }

    emitBurst(burstKey, options = {}) {
        if (burstKey !== 'damaged' && burstKey !== 'flinch' && burstKey !== 'death') return null;
        const position = this._lastPosition ?? { x: 0, y: 0 };
        const quantity = Number.isFinite(options.quantity) ? options.quantity : (burstKey === 'death' ? 54 : 16);
        const emitter = this.scene.add.particles(position.x, position.y, PARTICLE_TEXTURES.soft, {
            blendMode: 'ADD',
            lifespan: burstKey === 'death' ? { min: 380, max: 760 } : { min: 90, max: 190 },
            speed: burstKey === 'death' ? { min: 35, max: 190 } : { min: 60, max: 170 },
            scale: { start: burstKey === 'flinch' ? 0.8 : 1.05, end: 0 },
            alpha: { start: 0.9, end: 0 },
            tint: burstKey === 'death' ? PARTICLE_SEMANTIC_COLORS.DEATH : PARTICLE_SEMANTIC_COLORS.DAMAGE,
            quantity,
            frequency: -1,
            emitting: false,
            maxAliveParticles: quantity,
        });
        emitter.setDepth(STAGE_RENDER_DEPTH.actors + 1);
        this.scene.lightingRenderer?.maskGameObject?.(emitter);
        emitter.explode(quantity, position.x, position.y);
        this.scene.time.delayedCall(burstKey === 'death' ? 900 : 360, () => {
            this.scene.lightingRenderer?.unmaskGameObject?.(emitter);
            emitter.destroy?.();
        });
        return emitter;
    }

    tryApplyVisibilityMask() {
        const lighting = this.scene?.lightingRenderer;
        if (!lighting?.maskGameObject) return;
        for (const object of this._objects()) {
            if (!object || this._maskedObjects.has(object)) continue;
            lighting.maskGameObject(object);
            this._maskedObjects.add(object);
        }
    }

    destroy() {
        for (const object of this._maskedObjects) {
            this.scene?.lightingRenderer?.unmaskGameObject?.(object);
        }
        this._maskedObjects.clear();
        for (const object of this._objects()) object?.destroy?.();
        this._motes = [];
    }

    _objects() {
        return [
            this.glow,
            this.core,
            this.bodyEmitter,
            this.trailEmitter,
            ...this._motes.map((mote) => mote.image),
        ];
    }
}
