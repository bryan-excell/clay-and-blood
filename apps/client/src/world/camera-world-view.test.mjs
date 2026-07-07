import assert from 'node:assert/strict';
import { resolveCameraWorldView } from './CameraWorldView.js';

function makeCamera(overrides = {}) {
    return {
        width: 1600,
        height: 1200,
        zoom: 1,
        zoomX: overrides.zoom ?? 1,
        zoomY: overrides.zoom ?? 1,
        originX: 0.5,
        originY: 0.5,
        scrollX: 0,
        scrollY: 0,
        followOffset: { x: 0, y: 0 },
        lerp: { x: 1, y: 1 },
        roundPixels: false,
        useBounds: false,
        panEffect: { isRunning: false },
        ...overrides,
    };
}

export function runCameraWorldViewZoomedFollowTest() {
    const camera = makeCamera({
        zoom: 5,
        scrollX: 2000 - 800,
        scrollY: 1800 - 600,
        _follow: { x: 2000, y: 1800 },
    });

    const view = resolveCameraWorldView(camera);

    assert.equal(view.width, 320);
    assert.equal(view.height, 240);
    assert.equal(view.x, 1840);
    assert.equal(view.y, 1680);
}

export function runCameraWorldViewZoomChangedWithoutPrerenderTest() {
    const camera = makeCamera({
        zoom: 5,
        scrollX: 2000 - 800,
        scrollY: 1800 - 600,
        worldView: {
            x: 1200,
            y: 1200,
            width: 1600,
            height: 1200,
        },
    });

    const view = resolveCameraWorldView(camera);

    assert.equal(view.x, 1840);
    assert.equal(view.y, 1680);
    assert.equal(view.width, 320);
    assert.equal(view.height, 240);
}
