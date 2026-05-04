export function createRng(seedText = 'seed') {
    let h = 5381;
    for (let i = 0; i < seedText.length; i++) {
        h = (Math.imul(33, h) ^ seedText.charCodeAt(i)) >>> 0;
    }
    let s = h || 1;
    return function rng() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (Math.imul(t ^ (t >>> 7), 61 | t) ^ t) >>> 0;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function intRange(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
}

export function choice(rng, values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    return values[Math.floor(rng() * values.length)];
}
