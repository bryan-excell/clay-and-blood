function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function lerp(from, to, t) {
    return from + (to - from) * t;
}

/**
 * Resolve the camera's visible world rectangle for culling decisions.
 *
 * Phaser updates Camera.worldView during Camera.preRender(), after scene update
 * code has already run. Terrain residency is updated inside scene code, so it
 * needs to mirror the camera follow/zoom math instead of reading stale
 * worldView or treating scrollX/scrollY as the zoomed viewport origin.
 */
export function resolveCameraWorldView(camera) {
    if (!camera) return { x: 0, y: 0, width: 0, height: 0 };

    const width = Math.max(0, finiteOr(camera.width, 0));
    const height = Math.max(0, finiteOr(camera.height, 0));
    const zoomX = Math.max(0.0001, finiteOr(camera.zoomX, finiteOr(camera.zoom, 1)));
    const zoomY = Math.max(0.0001, finiteOr(camera.zoomY, finiteOr(camera.zoom, 1)));
    const originX = width * finiteOr(camera.originX, 0.5);
    const originY = height * finiteOr(camera.originY, 0.5);
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;

    let scrollX = finiteOr(camera.scrollX, 0);
    let scrollY = finiteOr(camera.scrollY, 0);
    const follow = camera._follow;

    if (follow && camera.panEffect?.isRunning !== true) {
        const followX = finiteOr(follow.x, null);
        const followY = finiteOr(follow.y, null);
        const offsetX = finiteOr(camera.followOffset?.x, 0);
        const offsetY = finiteOr(camera.followOffset?.y, 0);
        const lerpX = clamp01(finiteOr(camera.lerp?.x, 1));
        const lerpY = clamp01(finiteOr(camera.lerp?.y, 1));

        if (followX !== null) {
            const targetX = followX - offsetX;
            const deadzone = camera.deadzone;
            if (deadzone) {
                const midX = finiteOr(camera.midPoint?.x, scrollX + halfWidth);
                const dzWidth = finiteOr(deadzone.width, 0);
                const dzX = midX - dzWidth * 0.5;
                if (targetX < dzX) {
                    scrollX = lerp(scrollX, scrollX - (dzX - targetX), lerpX);
                } else if (targetX > dzX + dzWidth) {
                    scrollX = lerp(scrollX, scrollX + (targetX - (dzX + dzWidth)), lerpX);
                }
            } else {
                scrollX = lerp(scrollX, targetX - originX, lerpX);
            }
        }

        if (followY !== null) {
            const targetY = followY - offsetY;
            const deadzone = camera.deadzone;
            if (deadzone) {
                const midY = finiteOr(camera.midPoint?.y, scrollY + halfHeight);
                const dzHeight = finiteOr(deadzone.height, 0);
                const dzY = midY - dzHeight * 0.5;
                if (targetY < dzY) {
                    scrollY = lerp(scrollY, scrollY - (dzY - targetY), lerpY);
                } else if (targetY > dzY + dzHeight) {
                    scrollY = lerp(scrollY, scrollY + (targetY - (dzY + dzHeight)), lerpY);
                }
            } else {
                scrollY = lerp(scrollY, targetY - originY, lerpY);
            }
        }
    }

    if (camera.roundPixels) {
        scrollX = Math.floor(scrollX);
        scrollY = Math.floor(scrollY);
    }

    if (camera.useBounds) {
        if (typeof camera.clampX === 'function') scrollX = camera.clampX(scrollX);
        if (typeof camera.clampY === 'function') scrollY = camera.clampY(scrollY);
    }

    const displayWidth = Math.floor((width / zoomX) + 0.5);
    const displayHeight = Math.floor((height / zoomY) + 0.5);
    const midX = scrollX + halfWidth;
    const midY = scrollY + halfHeight;

    return {
        x: Math.floor((midX - displayWidth / 2) + 0.5),
        y: Math.floor((midY - displayHeight / 2) + 0.5),
        width: displayWidth,
        height: displayHeight,
    };
}
