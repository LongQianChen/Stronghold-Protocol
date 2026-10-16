// Same expressions run by the Node child suite and browser Worker E2E.
export const escapeCases = Object.freeze([
  ['eval', 'typeof eval', 'undefined'], ['Function global', 'typeof Function', 'undefined'], ['Promise', 'typeof Promise', 'undefined'],
  ['harden', 'typeof harden', 'undefined'], ['lockdown', 'typeof lockdown', 'undefined'],
  ['process', 'typeof process', 'undefined'], ['require', 'typeof require', 'undefined'],
  ['fetch', 'typeof fetch', 'undefined'], ['host global', 'typeof globalThis.process', 'undefined'],
  ['self', 'typeof self', 'undefined'], ['window', 'typeof window', 'undefined'],
  ['Function constructor', "({}).constructor.constructor('return this')()", 'throws'],
  ['async constructor', "(async function(){}).constructor('return process')()", 'throws'],
  ['dynamic import', "import('node:fs')", 'throws'],
  ['prototype mutation', 'Object.prototype.pwned = 1', 'throws'],
  ['Date.now', 'Date.now()', 'throws'], ['random', 'Math.random()', 'throws'],
  ['clock', 'typeof performance', 'undefined'], ['Intl', 'typeof Intl', 'undefined'],
  ['weak references', 'typeof WeakRef + typeof FinalizationRegistry', 'undefinedundefined'],
  ['shared memory', 'typeof SharedArrayBuffer + typeof Atomics', 'undefinedundefined'],
  ['timer', 'typeof setTimeout', 'undefined'], ['nested compartment', 'typeof Compartment', 'undefined'],
  ['recursion', '(function f(){ return f(); })()', 'throws'],
  ['oversized array', 'new Array(2 ** 40)', 'throws'],
]);
