// Shared build-time ground paths, using the exact sim Grid (DATA §12, DESIGN §32.5).
import { Grid } from './grid.js';
const PAIRS = [
  [[9, 10], [9, 2]], [[12, 10], [9, 2]], [[9, 18], [9, 2]], [[12, 18], [9, 2]],
  [[2, 10], [2, 2]], [[5, 10], [2, 2]], [[2, 10], [1, 3]], [[5, 10], [1, 3]],
  [[2, 10], [2, 18]], [[5, 10], [2, 18]], [[2, 10], [1, 17]], [[5, 10], [1, 17]],
];
/** Pure helper. Additional WALK routes may be supplied for plugin waves; official helper order is unchanged. */
export function computeGroundPaths(stage, routes = []) {
  const normalized = { ...stage, legend: stage.tiles ?? stage.legend };
  const empty = new Grid(normalized, { r0: 0, r1: 18, c0: 0, c1: 20 });
  const blocked = new Grid(normalized, { r0: 0, r1: 18, c0: 0, c1: 20 });
  for (const d of stage.devices || []) if (d.active && d.pos && ['crate', 'platform', 'mound'].includes(d.role)) {
    blocked.setObstacle(d.pos[0], d.pos[1], true, d.role === 'crate' ? 'crate' : undefined);
  }
  const groundPaths = {}, groundPathsWithDevices = {};
  const pairs = [...PAIRS, ...routes.filter(r => r.motion !== 'FLY' && r.motion !== 'E_NUM').map(r => [r.start, r.end])];
  for (const [a, b] of pairs) {
    if (!a || !b || !empty.groundPassable(a[0], a[1]) || !empty.groundPassable(b[0], b[1])) continue;
    const key = `${a.join(',')}->${b.join(',')}`;
    const p = empty.findPath(...a, ...b), q = blocked.findPath(...a, ...b);
    if (p) groundPaths[key] = p;
    if (q) groundPathsWithDevices[key] = q;
  }
  return { groundPaths, groundPathsWithDevices };
}

/** Derived placement lists for a plugin's raw stage. Official builds keep their existing deployment metadata. */
export function computeDeployTiles(stage) {
  const grid = new Grid({ ...stage, legend: stage.tiles ?? stage.legend }, { r0: 0, r1: 18, c0: 0, c1: 20 });
  const devices = new Map((stage.devices ?? []).filter(d => d.active && d.pos && ['crate','platform','mound'].includes(d.role)).map(d => [d.pos.join(','), d.role]));
  const region = (r0, r1, c0, c1) => {
    const melee = [], rangedOnly = [], changedByDevices = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const tile = grid.tile(r,c), role = devices.get(`${r},${c}`), p = [r,c];
      if (role) { if (tile.build !== 'NONE') changedByDevices.push(p); if (role === 'platform') rangedOnly.push(p); continue; }
      if (tile.height === 'LOW' && ['ALL','MELEE'].includes(tile.build)) melee.push(p);
      else if (tile.build === 'RANGED' || tile.height === 'HIGH' && tile.build === 'ALL' && tile.key !== 'tile_achand') rangedOnly.push(p);
    }
    return { melee, rangedOnly, changedByDevices };
  };
  return { normal: region(9,12,2,10), bossLeft: region(1,5,2,10), bossRight: region(1,5,10,18) };
}
