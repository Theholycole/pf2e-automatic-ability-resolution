import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";

// Only at a dying creature (2026-10-14, batch 313). Synthetic wording.
const item = (html) => ({ type: "action", name: "Test Reap", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: ["death"] }, rules: [], description: { value: html } } });
const DYING = "@UUID[Compendium.pf2e.conditionitems.Item.yZRUzMqrMmfLu0V1]{Dying}";

test("a save aimed at a dying creature only targets one; a dying creature nearby as a requirement becomes the target's (batch 313)", () => {
    const tug = compileMonsterAbility(item(`<p>The test imp reaps the soul of an adjacent ${DYING} creature. The target must attempt a @Check[fortitude|dc:20] save. If it fails, it dies.</p>`));
    assert.deepEqual(tug.needs, [{ target: { conditions: ["dying"], within: 5 } }]);
    const far = compileMonsterAbility(item(`<p>The test imp reaps the soul of a dying creature within 15 feet. The target must attempt a @Check[fortitude|dc:20] save. If it fails, it dies.</p>`));
    assert.deepEqual(far.needs, [{ target: { conditions: ["dying"], within: 15 } }]);
    const required = compileMonsterAbility(item(`<p><strong>Requirements</strong> The test imp is adjacent to a ${DYING} creature</p><p><strong>Effect</strong> The test imp reaps that creature's soul. The target must attempt a @Check[fortitude|dc:20] save. If it fails, it dies.</p>`));
    assert.deepEqual(required.needs, [{ target: { conditions: ["dying"], within: 5 } }]);
    // A corpse will do too: its own reading.
    const either = compileMonsterAbility(item(`<p>The test imp touches a dying creature or a corpse. The target must attempt a @Check[fortitude|dc:20] save. If it fails, it dies.</p>`));
    assert.equal(JSON.stringify(either.needs ?? null).includes('"target"'), false);
});
