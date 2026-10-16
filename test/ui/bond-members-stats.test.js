import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bondMemberChess } from '../../public/js/ui/stats.js';

test('alliance members retain distinct tiers, exclude unavailable variants and sort by tier then shop order', () => {
  const member = (chessId, fields = {}) => ({ chessId, charId: chessId, tier: 4, shopSortId: 1, bonds: ['preciShip'], ...fields });
  const chess = [member('late', { shopSortId: 2 }), member('early'),
    member('low', { charId: 'early', tier: 1 }), member('duplicate', { charId: 'early' }),
    member('gold', { isGolden: true }), member('hidden', { isHidden: true }),
    member('diy', { isDiy: true }), member('unavailable', { visible: false }), member('other', { bonds: ['yanShip'] }),
  ];
  assert.deepEqual(bondMemberChess(chess, 'preciShip').map((c) => c.chessId), ['low', 'early', 'late']);
  assert.deepEqual(bondMemberChess(chess, undefined), []);
});
