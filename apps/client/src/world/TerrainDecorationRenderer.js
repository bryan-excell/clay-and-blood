/**
 * Reserved response layer for future terrain effects.
 *
 * Keep this no-op while the material foundation is being evaluated. Ground,
 * path, tall grass, and water should currently be rendered only by
 * ChunkedBaseRenderer using TerrainMaterialRegistry textures.
 */
export class TerrainDecorationRenderer {
    update() {}

    destroy() {}
}
