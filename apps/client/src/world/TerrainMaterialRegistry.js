import groundUrl from '../assets/environment/materials/spirit-ground.png';
import pathUrl from '../assets/environment/materials/spirit-path.png';
import tallGrassUrl from '../assets/environment/materials/spirit-tallgrass.png';
import waterUrl from '../assets/environment/materials/spirit-water.png';
import { TERRAIN_MATERIAL } from './TerrainFieldCompiler.js';

export const TERRAIN_MATERIAL_ASSETS = Object.freeze([
    Object.freeze({ key: 'terrain-material-ground', url: groundUrl, material: TERRAIN_MATERIAL.floor }),
    Object.freeze({ key: 'terrain-material-path', url: pathUrl, material: TERRAIN_MATERIAL.exit }),
    Object.freeze({ key: 'terrain-material-tall-grass', url: tallGrassUrl, material: TERRAIN_MATERIAL.grass }),
    Object.freeze({ key: 'terrain-material-water', url: waterUrl, material: TERRAIN_MATERIAL.water }),
]);

export const TERRAIN_MATERIAL_TEXTURE_BY_MATERIAL = Object.freeze({
    [TERRAIN_MATERIAL.floor]: 'terrain-material-ground',
    [TERRAIN_MATERIAL.exit]: 'terrain-material-path',
    [TERRAIN_MATERIAL.grass]: 'terrain-material-tall-grass',
    [TERRAIN_MATERIAL.water]: 'terrain-material-water',
});

export function getTerrainMaterialTextureKey(material) {
    return TERRAIN_MATERIAL_TEXTURE_BY_MATERIAL[material] ?? TERRAIN_MATERIAL_TEXTURE_BY_MATERIAL[TERRAIN_MATERIAL.floor];
}
