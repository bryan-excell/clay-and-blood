import { TransformComponent } from '../../components/TransformComponent.js';
import { CircleComponent } from '../../components/CircleComponent.js';
import { CorpseIdentityComponent } from '../../components/CorpseIdentityComponent.js';
import { DecayComponent } from '../../components/DecayComponent.js';
import { DecayBarComponent } from '../../components/DecayBarComponent.js';
import { STAGE_RENDER_DEPTH } from '../../config.js';
import { ARCHETYPE_CONFIG } from '@clay-and-blood/shared';

export function createCorpse(scene, config = {}) {
    const {
        id,
        x = 0,
        y = 0,
        radius = ARCHETYPE_CONFIG.corpse.hitRadius,
        identity = null,
        decayMsRemaining = ARCHETYPE_CONFIG.corpse.decayDurationMs,
        totalDecayMs = ARCHETYPE_CONFIG.corpse.decayDurationMs,
    } = config;

    const corpse = scene.entityFactory.createEntity(id);
    corpse.type = 'corpse';

    corpse.addComponent(new TransformComponent(x, y));
    const circle = new CircleComponent(radius, 0x3a3030, 0.7, 0x1a1212, 1);
    corpse.addComponent(circle);
    circle.gameObject?.setDepth(STAGE_RENDER_DEPTH.actors);
    corpse.addComponent(new CorpseIdentityComponent(identity));
    corpse.addComponent(new DecayComponent(totalDecayMs, decayMsRemaining));
    corpse.addComponent(new DecayBarComponent());

    return corpse;
}
