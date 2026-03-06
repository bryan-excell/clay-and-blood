import Phaser from 'phaser';
import { eventBus } from '../core/EventBus.js';
import { TILE_SIZE } from '../config.js';

// The darkness rectangle must be larger than the world-space area visible at
// minimum zoom (0.15) on a large monitor.  1920 / 0.15 ≈ 12 800 px wide, so
// 50 000 px in each direction from the level center covers any realistic case.
const DARKNESS_SIZE = 50000;

/**
 * Scene-level system that renders the fog-of-war / dynamic lighting effect.
 *
 * How it works
 * ------------
 * A large dark rectangle covers the entire camera view at depth 50.
 * A Phaser GeometryMask (invertAlpha = true) is applied to it.  Each frame
 * the mask Graphics object is repainted with the player's visibility polygon;
 * the mask punches a transparent hole in the darkness wherever the player
 * can see, revealing the world below.
 *
 * Entity masking (fog-of-war culling)
 * ------------------------------------
 * The SAME mask Graphics feeds a second GeometryMask (invertAlpha = false)
 * that is applied to any "dynamic" game object registered via maskGameObject().
 * Because both masks share the same underlying geometry, entities automatically
 * disappear outside the player's field of view without any per-frame CPU checks.
 * This produces the Starcraft 2 fog-of-war effect: enemies are hidden even if
 * the ambient light is high (daytime outdoors).
 *
 * Ambient light level
 * -------------------
 * setAmbientAlpha(0) — transparent darkness (bright daylight, still culls entities)
 * setAmbientAlpha(1) — fully opaque darkness (pitch-black dungeon)
 * The entity mask is always active regardless of ambient alpha.
 *
 * Extending for multiple light sources
 * -------------------------------------
 * addLightSource(entityId) / removeLightSource(entityId) — any entity with a
 * VisibilityComponent automatically contributes its polygon to the lighting.
 *
 * IMPORTANT: mask Graphics is created with { add: false } so Phaser does NOT
 * render the white-filled polygon to the screen.  Without this, the lit area
 * would appear as a white shape on top of the game world.
 *
 * Depth budget
 * ------------
 *   50 – darkness overlay rectangle
 */
export class LightingRenderer {
    /**
     * @param {Phaser.Scene} scene
     * @param {string}       playerEntityId  Entity whose FOVwa drives the main light
     * @param {number}      [ambientAlpha=0.03]  Initial darkness opacity (0–1)
     */
    constructor(scene, playerEntityId, ambientAlpha = 0.25) {
        this.scene = scene;

        /** @type {Map<string, {x:number,y:number}[]>} */
        this._lightSources = new Map();
        this._lightSources.set(playerEntityId, []);
        this._playerEntityId = playerEntityId;

        // -----------------------------------------------------------------------
        // Phaser objects
        // -----------------------------------------------------------------------

        // Large world-space darkness rectangle — repositioned in onLevelChanged()
        this._darkness = scene.add
            .rectangle(0, 0, DARKNESS_SIZE, DARKNESS_SIZE, 0x000000, ambientAlpha)
            .setDepth(50)
            .setOrigin(0.5, 0.5);

        // Mask Graphics — NOT in the display list.
        // scene.add.graphics() would render the white polygon visibly.
        // { add: false } keeps it invisible while still feeding the GeometryMasks.
        this._maskGraphics = scene.make.graphics({ add: false });

        // Darkness mask: inverted — darkness is TRANSPARENT inside the polygon
        const darknessMask = new Phaser.Display.Masks.GeometryMask(scene, this._maskGraphics);
        darknessMask.invertAlpha = true;
        this._darkness.setMask(darknessMask);

        // Entity mask: non-inverted — game objects are VISIBLE inside the polygon,
        // hidden outside.  Applied to dynamic entities via maskGameObject().
        this._entityMask = new Phaser.Display.Masks.GeometryMask(scene, this._maskGraphics);
        this._entityMask.invertAlpha = false;

        // -----------------------------------------------------------------------
        // Event subscriptions
        // -----------------------------------------------------------------------

        this._unsubVisibility = eventBus.on(
            'visibility:updated',
            this._onVisibilityUpdated.bind(this),
        );

        this._unsubLevelTransition = eventBus.on(
            'level:transition',
            this._onLevelTransition.bind(this),
        );
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Reposition the darkness overlay to stay centered on a newly loaded level.
     * Call once after construction with the initial level; subsequent levels
     * are handled automatically via the 'level:transition' event.
     *
     * @param {{ width: number, height: number }} level
     */
    onLevelChanged(level) {
        const cx = (level.width  * TILE_SIZE) / 2;
        const cy = (level.height * TILE_SIZE) / 2;
        this._darkness.setPosition(cx, cy);
    }

    /**
     * Set the ambient darkness opacity.
     *
     *   0   → fully transparent (bright daylight — world is fully visible but
     *          entities outside FOV are still culled by the entity mask)
     *   0.93→ nearly opaque (dungeon default)
     *   1   → pitch black (no ambient light at all)
     *
     * @param {number} alpha - Clamped to [0, 1]
     */
    setAmbientAlpha(alpha) {
        this._darkness.setAlpha(Phaser.Math.Clamp(alpha, 0, 1));
    }

    /**
     * Apply the entity mask to a game object so it is only visible inside the
     * player's field of view.  Call this immediately after the game object is
     * created.  The mask updates automatically each frame with no further calls.
     *
     * @param {Phaser.GameObjects.GameObject} go
     */
    maskGameObject(go) {
        if (go) go.setMask(this._entityMask);
    }

    /**
     * Remove the FOV mask from a game object (e.g. before destroying it).
     *
     * @param {Phaser.GameObjects.GameObject} go
     */
    unmaskGameObject(go) {
        if (go) go.clearMask();
    }

    /**
     * Register an additional entity as a light source.
     * Its visibility polygon will be merged with the player's each frame.
     *
     * @param {string} entityId
     */
    addLightSource(entityId) {
        if (!this._lightSources.has(entityId)) {
            this._lightSources.set(entityId, []);
        }
    }

    /**
     * Remove a previously registered light source.
     *
     * @param {string} entityId
     */
    removeLightSource(entityId) {
        if (entityId !== this._playerEntityId) {
            this._lightSources.delete(entityId);
            this._redrawAll();
        }
    }

    destroy() {
        this._unsubVisibility();
        this._unsubLevelTransition();
        this._darkness.destroy();
        this._maskGraphics.destroy();
    }

    // -------------------------------------------------------------------------
    // Private
    // -------------------------------------------------------------------------

    _onLevelTransition({ levelId }) {
        console.log('[Lighting] level:transition →', levelId, '— clearing all polygons');
        const level = this.scene.levelManager?.getLevel(levelId);
        if (level) this.onLevelChanged(level);
        // Clear stale polygons to avoid a single-frame flash of old light data
        for (const key of this._lightSources.keys()) {
            this._lightSources.set(key, []);
        }
        this._maskGraphics.clear();
    }

    _onVisibilityUpdated({ entityId, polygon }) {
        if (!this._lightSources.has(entityId)) {
            console.warn('[Lighting] visibility:updated ignored — entityId not registered:', entityId, '| known:', [...this._lightSources.keys()]);
            return;
        }
        this._lightSources.set(entityId, polygon);
        this._redrawAll();
    }

    /**
     * Repaint the mask with all registered light-source polygons.
     * Because both the darkness mask and the entity mask share the same
     * Graphics object, a single redraw updates both simultaneously.
     */
    _redrawAll() {
        this._maskGraphics.clear();
        this._maskGraphics.fillStyle(0xffffff, 1);

        let totalDrawn = 0;
        for (const [id, polygon] of this._lightSources.entries()) {
            if (polygon.length >= 3) {
                this._maskGraphics.fillPoints(polygon, true);
                totalDrawn++;
            } else if (polygon.length > 0) {
                console.warn(`[Lighting] Polygon for ${id} has only ${polygon.length} points — skipped`);
            }
        }

        if (totalDrawn === 0) {
            console.warn('[Lighting] _redrawAll drew NOTHING — screen will be black. lightSources:', [...this._lightSources.entries()].map(([id, p]) => `${id}:${p.length}pts`));
        }
    }
}
