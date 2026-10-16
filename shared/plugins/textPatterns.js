// Count phrases read out of skill / talent / trait text (DESIGN §32.5). Official maxima are scanned from
// vanilla tables only. A pattern that is not a count (a percent, a duration) does not belong here.

/** @type {readonly {id: string, re: RegExp}[]} */
export const TEXT_COUNT_PATTERNS = Object.freeze([
  { id: 'burst', re: /(\d+)连发/ },
  { id: 'attack-times', re: /攻击(\d+)次/ },
  { id: 'steal', re: /偷取触发(\d+)次/ },
  { id: 'combo', re: /(\d+|[一二两三四五六七八九十])连击/ },
  { id: 'chain-attack', re: /连续攻击(\d+|[一二两三四五六七八九十])次/ },
  { id: 'total-times', re: /总计(\d+)次/ },
  { id: 'extra-targets', re: /额外攻击(\d+)个目标/ },
  { id: 'at-most', re: /至多(\d+|[一二两三四五六七八九十])个/ },
  { id: 'at-most-pack', re: /至多(\d+|[一二两三四五六七八九十])只/ },
  { id: 'initial-pack', re: /初始(\d+|[一二两三四五六七八九十])只/ },
  { id: 'jump-ally', re: /在(\d+)个友方单位间跳跃/ },
  { id: 'jump-enemy', re: /在(\d+)个敌人间跳跃/ },
  { id: 'own-max', re: /最多拥有(\d+)个/ },
  { id: 'exist-n', re: /存在\s*(\d+)\s*名/ },
]);
