// 敌方血条/名字牌的头顶高度：定位要用"原点以上的高度"（bounds.y + bounds.height），不是包围盒高度。
// 数值取自 data/assets.json 里真实的 setup-pose bounds（逐腐兽 / 猎狗pro / 大鲍勃 / 锏）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// units.js 读的是浏览器全局的 PIXI（脚本标签加载），模块只在运行时碰它
globalThis.PIXI = globalThis.PIXI || { Container: class {}, Graphics: class {}, Sprite: class {} };
const { headTilesForUnit, HEAD_TILES_CAP, HEAD_TILES_CAP_BOSS } = await import('../../public/js/render/units.js');
const { UNIT } = await import('../../public/js/render/style.js');

/** The real setup-pose bounds (data/assets.json enemies.*.spine.bounds), with the official model factor. */
const CASES = {
  逐腐兽: { y: -404.687, height: 722.64, modelScale: 0.8889 },
  疯狂的逐腐兽: { y: -404.687, height: 722.64, modelScale: 0.8889 },
  猎狗pro: { y: -3.745, height: 257.006, modelScale: 0.963 },
  大鲍勃: { y: -2.62, height: 408.999, modelScale: 1.1111, boss: true },
  锏: { y: -798, height: 1183, modelScale: 1, boss: true },
};
const head = (name, extra = {}) => {
  const c = CASES[name];
  return headTilesForUnit({
    isEnemy: true, isBoss: !!c.boss, spineShown: true, hasBounds: true,
    bounds: { y: c.y, height: c.height }, modelK: c.modelScale, modelKY: 1, ...extra,
  });
};

describe('敌方血条的头顶高度（bounds.y 不能忽略）', () => {
  test('逐腐兽：原点在身体中间，血条按"原点以上" 0.8 格，而不是包围盒高度的 1.85 格', () => {
    const tiles = head('逐腐兽');
    assert.ok(Math.abs(tiles - 0.81) < 0.02, `逐腐兽 ≈ 0.81 格，实得 ${tiles.toFixed(3)}`);
    assert.ok(tiles < head('逐腐兽', { bounds: { height: CASES.逐腐兽.height } }) - 0.9, '与忽略 bounds.y 的老算法差约一格');
    assert.equal(head('疯狂的逐腐兽').toFixed(3), tiles.toFixed(3), '同一个模型，同样的高度');
  });

  test('脚锚定的敌人（y ≈ 0）几乎不变：猎狗pro / 大鲍勃', () => {
    assert.ok(Math.abs(head('猎狗pro') - 0.71) < 0.01, `猎狗pro ≈ 0.71 格，实得 ${head('猎狗pro').toFixed(3)}`);
    // y = −3.7（猎狗pro）时两种算法的差只有 0.01 格：脚锚定的模型几乎不受这次修正影响
    assert.ok(Math.abs(head('猎狗pro') - head('猎狗pro', { bounds: { height: CASES.猎狗pro.height } })) < 0.02, 'y≈0 时两种算法几乎一致');
    assert.ok(Math.abs(head('大鲍勃') - 1.31) < 0.02, `大鲍勃 ≈ 1.31 格，实得 ${head('大鲍勃').toFixed(3)}`);
  });

  test('上限仍然兜底：模型再高，血条也不会飞出屏幕', () => {
    assert.ok(Math.abs(head('锏') - 1.11) < 0.02, `锏 ≈ 1.11 格（385/320×0.92），实得 ${head('锏').toFixed(3)}`);
    assert.ok(head('锏') <= HEAD_TILES_CAP_BOSS);
    assert.ok(head('逐腐兽') <= HEAD_TILES_CAP);
    const absurd = headTilesForUnit({ isEnemy: true, isBoss: false, spineShown: true, bounds: { y: 0, height: 5000 }, modelK: 1, modelKY: 1 });
    assert.equal(absurd, HEAD_TILES_CAP, '超过上限就截到上限');
  });

  test('回退分支：没有 bounds 用 chibi 头顶余量 × 模型系数；非敌方用固定余量；Boss 无模型用 Boss 高度', () => {
    assert.equal(headTilesForUnit({ isEnemy: true, isBoss: false, spineShown: true, bounds: null, modelK: 1, modelKY: 1 }), UNIT.headroom);
    assert.equal(headTilesForUnit({ isEnemy: true, isBoss: false, spineShown: true, bounds: null, modelK: 1.5, modelKY: 1 }), Math.min(HEAD_TILES_CAP, UNIT.headroom * 1.5));
    assert.equal(headTilesForUnit({ isEnemy: true, isBoss: true, spineShown: false, bounds: null, modelK: 1, modelKY: 1 }), HEAD_TILES_CAP, 'Boss 没有模型时按 Boss 高度');
    assert.equal(headTilesForUnit({ isEnemy: false, isBoss: false, spineShown: true, bounds: { y: 0, height: 500 }, modelK: 1, modelKY: 1 }), UNIT.headroom, '干员/召唤物一律用统一余量');
  });

  test('实现只有一处：纯函数算 y + height，units.js 把 bounds 交给它（防止有人改回 height）', () => {
    const units = readFileSync(path.join(ROOT, 'public/js/render/units.js'), 'utf8');
    assert.match(units, /const top = Number\.isFinite\(b\.y\) \? b\.y \+ b\.height : b\.height;/, 'top = y + height');
    assert.match(units, /bounds: actor && actor\.entry \? actor\.entry\.bounds : null/, 'units.js 把 bounds 交给纯函数');
    assert.match(units, /headTilesForUnit\(\{/, '而且用的就是它');
  });
});
