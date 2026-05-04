export function createRng(seedText = 'seed') {
    let h = 2166136261 >>> 0;
    const seed = String(seedText);
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return function rng() {
        h += 0x6D2B79F5;
        let t = h;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function intRange(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
}

export function choice(rng, values) {
    if (!Array.isArray(values) || values.length === 0) return undefined;
    return values[Math.floor(rng() * values.length)];
}
