export const PARTICLE_TEXTURES = Object.freeze({
    soft: 'particle-soft',
    dot: 'particle-dot',
    streak: 'particle-streak',
});

export function ensureParticleTextures(scene) {
    if (!scene?.textures) return;
    if (!scene.textures.exists(PARTICLE_TEXTURES.soft)) {
        _createSoftParticle(scene);
    }
    if (!scene.textures.exists(PARTICLE_TEXTURES.dot)) {
        _createDotParticle(scene);
    }
    if (!scene.textures.exists(PARTICLE_TEXTURES.streak)) {
        _createStreakParticle(scene);
    }
}

function _createSoftParticle(scene) {
    const size = 16;
    const center = size / 2;
    const gfx = scene.make.graphics({ add: false });
    const steps = [
        { radius: 8, alpha: 0.05 },
        { radius: 6, alpha: 0.16 },
        { radius: 4, alpha: 0.36 },
        { radius: 2.5, alpha: 0.72 },
        { radius: 1.4, alpha: 1 },
    ];
    for (const step of steps) {
        gfx.fillStyle(0xffffff, step.alpha);
        gfx.fillCircle(center, center, step.radius);
    }
    gfx.generateTexture(PARTICLE_TEXTURES.soft, size, size);
    gfx.destroy();
}

function _createDotParticle(scene) {
    const size = 4;
    const gfx = scene.make.graphics({ add: false });
    gfx.fillStyle(0xffffff, 1);
    gfx.fillCircle(size / 2, size / 2, 2);
    gfx.generateTexture(PARTICLE_TEXTURES.dot, size, size);
    gfx.destroy();
}

function _createStreakParticle(scene) {
    const width = 24;
    const height = 8;
    const gfx = scene.make.graphics({ add: false });
    const cx = width / 2;
    const cy = height / 2;
    const ellipses = [
        { w: 24, h: 8, alpha: 0.08 },
        { w: 18, h: 6, alpha: 0.22 },
        { w: 12, h: 4, alpha: 0.55 },
        { w: 6, h: 2.5, alpha: 1 },
    ];
    for (const ellipse of ellipses) {
        gfx.fillStyle(0xffffff, ellipse.alpha);
        gfx.fillEllipse(cx, cy, ellipse.w, ellipse.h);
    }
    gfx.generateTexture(PARTICLE_TEXTURES.streak, width, height);
    gfx.destroy();
}
