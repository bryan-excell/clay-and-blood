import { tileHasTag } from './tileRegistry.js';
import { resolveArchetypeConfig } from '../combatData.js';

const TILE_SIZE = 64;
const DEFAULT_VISION_PROFILE = Object.freeze({
    sightRadius: 300,
    ignoreConcealment: false,
    ignoreWalls: false,
    observerTags: Object.freeze([]),
    targetTags: Object.freeze([]),
});

const DEFAULT_VISION_CONTEXT = Object.freeze({
    sightRadius: 300,
    effectiveSightRadius: 300,
    rayCount: 360,
    ignoreConcealment: false,
    ignoreWalls: false,
    ambientLightMultiplier: 1,
    sightRadiusMultiplier: 1,
    extraSightRadius: 0,
    observerTags: Object.freeze([]),
    targetTags: Object.freeze([]),
});

export function createVisionContext(options = {}) {
    const baseSightRadius = options.sightRadius === Infinity
        ? Infinity
        : (Number.isFinite(options.sightRadius) ? Math.max(0, options.sightRadius) : DEFAULT_VISION_CONTEXT.sightRadius);
    const sightRadiusMultiplier = Number.isFinite(options.sightRadiusMultiplier)
        ? Math.max(0, options.sightRadiusMultiplier)
        : DEFAULT_VISION_CONTEXT.sightRadiusMultiplier;
    const ambientLightMultiplier = Number.isFinite(options.ambientLightMultiplier)
        ? Math.max(0, options.ambientLightMultiplier)
        : DEFAULT_VISION_CONTEXT.ambientLightMultiplier;
    const extraSightRadius = Number.isFinite(options.extraSightRadius)
        ? options.extraSightRadius
        : DEFAULT_VISION_CONTEXT.extraSightRadius;
    const effectiveSightRadius = baseSightRadius === Infinity
        ? Infinity
        : Math.max(0, baseSightRadius * sightRadiusMultiplier * ambientLightMultiplier + extraSightRadius);

    return {
        sightRadius: baseSightRadius,
        effectiveSightRadius,
        rayCount: Number.isFinite(options.rayCount) ? Math.max(1, Math.floor(options.rayCount)) : DEFAULT_VISION_CONTEXT.rayCount,
        ignoreConcealment: options.ignoreConcealment === true,
        ignoreWalls: options.ignoreWalls === true,
        ambientLightMultiplier,
        sightRadiusMultiplier,
        extraSightRadius,
        observerTags: Array.isArray(options.observerTags) ? [...options.observerTags] : [],
        targetTags: Array.isArray(options.targetTags) ? [...options.targetTags] : [],
    };
}

export function createVisionProfile(options = {}) {
    return {
        sightRadius: options.sightRadius === Infinity
            ? Infinity
            : (Number.isFinite(options.sightRadius) ? Math.max(0, options.sightRadius) : DEFAULT_VISION_PROFILE.sightRadius),
        ignoreConcealment: options.ignoreConcealment === true,
        ignoreWalls: options.ignoreWalls === true,
        observerTags: Array.isArray(options.observerTags) ? [...options.observerTags] : [],
        targetTags: Array.isArray(options.targetTags) ? [...options.targetTags] : [],
    };
}

export function resolveVisionProfileForKind(kind, overrides = {}) {
    const archetype = resolveArchetypeConfig(kind);
    return createVisionProfile({
        sightRadius: Number.isFinite(overrides.sightRadius)
            ? overrides.sightRadius
            : (Number.isFinite(archetype?.sightRadius) ? archetype.sightRadius : DEFAULT_VISION_PROFILE.sightRadius),
        ignoreConcealment: overrides.ignoreConcealment === true,
        ignoreWalls: overrides.ignoreWalls === true,
        observerTags: Array.isArray(overrides.observerTags) ? overrides.observerTags : [],
        targetTags: Array.isArray(overrides.targetTags) ? overrides.targetTags : [],
    });
}

export function createVisionContextFromProfile(profile, modifiers = {}) {
    const resolvedProfile = createVisionProfile(profile);
    return createVisionContext({
        sightRadius: resolvedProfile.sightRadius,
        ignoreConcealment: resolvedProfile.ignoreConcealment,
        ignoreWalls: resolvedProfile.ignoreWalls,
        observerTags: resolvedProfile.observerTags,
        targetTags: resolvedProfile.targetTags,
        rayCount: modifiers.rayCount,
        ambientLightMultiplier: modifiers.ambientLightMultiplier,
        sightRadiusMultiplier: modifiers.sightRadiusMultiplier,
        extraSightRadius: modifiers.extraSightRadius,
    });
}

export function tileAtWorldPosition(grid, x, y) {
    if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const tileX = Math.floor(x / TILE_SIZE);
    const tileY = Math.floor(y / TILE_SIZE);
    if (tileY < 0 || tileY >= grid.length || tileX < 0 || tileX >= grid[0].length) return null;
    return grid[tileY][tileX];
}

export function isPositionInConcealment(grid, x, y) {
    const tile = tileAtWorldPosition(grid, x, y);
    return tile != null && tileHasTag(tile, 'concealment');
}

export function castVisionRay(grid, x1, y1, x2, y2, context = {}) {
    const visionContext = normalizeVisionContext(context);
    if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) return null;

    const rows = grid.length;
    const cols = grid[0].length;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const rayLen = Math.sqrt(dx * dx + dy * dy);
    if (rayLen < 0.0001) return null;

    const originInConcealment = !visionContext.ignoreConcealment && isPositionInConcealment(grid, x1, y1);
    const rdx = dx / rayLen;
    const rdy = dy / rayLen;
    let mapX = Math.floor(x1 / TILE_SIZE);
    let mapY = Math.floor(y1 / TILE_SIZE);
    const stepX = rdx >= 0 ? 1 : -1;
    const stepY = rdy >= 0 ? 1 : -1;
    const deltaDX = rdx !== 0 ? Math.abs(TILE_SIZE / rdx) : Infinity;
    const deltaDY = rdy !== 0 ? Math.abs(TILE_SIZE / rdy) : Infinity;

    let sideDistX;
    if (rdx > 0) sideDistX = ((mapX + 1) * TILE_SIZE - x1) / rdx;
    else if (rdx < 0) sideDistX = (x1 - mapX * TILE_SIZE) / (-rdx);
    else sideDistX = Infinity;

    let sideDistY;
    if (rdy > 0) sideDistY = ((mapY + 1) * TILE_SIZE - y1) / rdy;
    else if (rdy < 0) sideDistY = (y1 - mapY * TILE_SIZE) / (-rdy);
    else sideDistY = Infinity;

    let side = -1;
    let isFirstTile = true;

    while (true) {
        if (!(mapX >= 0) || mapX >= cols || !(mapY >= 0) || mapY >= rows) return null;

        if (!isFirstTile) {
            const tile = grid[mapY][mapX];
            const entryT = side === 0 ? sideDistX - deltaDX : sideDistY - deltaDY;
            if (entryT > rayLen) return null;

            if (!visionContext.ignoreWalls && tileHasTag(tile, 'structure')) {
                return buildVisionHit(x1, y1, rdx, rdy, entryT, mapX, mapY, side, stepX, stepY, 'wall');
            }

            if (!visionContext.ignoreConcealment && !originInConcealment && tileHasTag(tile, 'concealment')) {
                return buildVisionHit(x1, y1, rdx, rdy, entryT, mapX, mapY, side, stepX, stepY, 'concealment');
            }
        }

        isFirstTile = false;

        if (sideDistX < sideDistY) {
            if (sideDistX > rayLen) return null;
            side = 0;
            mapX += stepX;
            sideDistX += deltaDX;
        } else {
            if (sideDistY > rayLen) return null;
            side = 1;
            mapY += stepY;
            sideDistY += deltaDY;
        }
    }
}

export function hasLineOfSight(grid, x1, y1, x2, y2, context = {}) {
    const visionContext = normalizeVisionContext(context);
    const maxRange = Number.isFinite(visionContext.effectiveSightRadius)
        ? visionContext.effectiveSightRadius
        : Infinity;
    if (maxRange !== Infinity) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        if (dx * dx + dy * dy > maxRange * maxRange) return false;
    }
    return castVisionRay(grid, x1, y1, x2, y2, visionContext) === null;
}

export function computeVisibilityPolygon(grid, originX, originY, context = {}) {
    const visionContext = normalizeVisionContext(context);
    const polygon = [];
    const radius = visionContext.effectiveSightRadius;
    const step = (Math.PI * 2) / visionContext.rayCount;

    for (let i = 0; i < visionContext.rayCount; i++) {
        const angle = i * step;
        const endX = originX + Math.cos(angle) * radius;
        const endY = originY + Math.sin(angle) * radius;
        const hit = castVisionRay(grid, originX, originY, endX, endY, visionContext);
        polygon.push(hit ? { x: hit.x, y: hit.y } : { x: endX, y: endY });
    }

    return {
        polygon,
        context: visionContext,
    };
}

export function canObserverDetectTarget(grid, observer, target, context = {}) {
    if (!observer || !target) {
        return {
            visible: false,
            blockedBy: 'invalid',
            observerInConcealment: false,
            targetInConcealment: false,
            distance: Infinity,
        };
    }

    const observerInConcealment = isPositionInConcealment(grid, observer.x, observer.y);
    const targetInConcealment = isPositionInConcealment(grid, target.x, target.y);
    const dx = target.x - observer.x;
    const dy = target.y - observer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const visionContext = normalizeVisionContext(context);
    if (Number.isFinite(visionContext.effectiveSightRadius) && distance > visionContext.effectiveSightRadius) {
        return {
            visible: false,
            blockedBy: 'range',
            observerInConcealment,
            targetInConcealment,
            distance,
        };
    }
    const hit = castVisionRay(grid, observer.x, observer.y, target.x, target.y, visionContext);

    return {
        visible: hit === null,
        blockedBy: hit?.kind ?? null,
        observerInConcealment,
        targetInConcealment,
        distance,
    };
}

function normalizeVisionContext(context) {
    if (
        Number.isFinite(context?.effectiveSightRadius) &&
        Number.isFinite(context?.rayCount)
    ) {
        return context;
    }
    return createVisionContext(context);
}

function buildVisionHit(x1, y1, rdx, rdy, distance, tileX, tileY, side, stepX, stepY, kind) {
    return {
        x: x1 + rdx * distance,
        y: y1 + rdy * distance,
        tileX,
        tileY,
        normal: side === 0 ? { x: -stepX, y: 0 } : { x: 0, y: -stepY },
        distance,
        kind,
    };
}
