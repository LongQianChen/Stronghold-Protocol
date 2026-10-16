import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run with `node tools/plugin.mjs test <id>`: it installs this plugin's content and SDK registrations before this
// module (SP_PLUGIN_TEST_SET). Anywhere else — a plain `node --test` of the repository finds this file too — it skips.
const run = process.env.SP_PLUGIN_TEST_SET ? {} : { skip: 'run with node tools/plugin.mjs test <id>' };

test('training guard has its deployment talent and duration skill', run, async () => {
  const { makeBattle, checkInvariants } = await import('../../../test/helpers/battleHarness.js');
  const h = makeBattle({units:[{chessId:'chess_x_script_demo_guard_a',row:10,col:5}]});
  h.step();
  const u = h.allies()[0];
  assert.equal(u.kit.generic, undefined);
  assert.equal(u.skill.kind, 'duration');
  assert.ok(u.s.atk >= u.base.atk + 25);
  checkInvariants(h.b);
});
