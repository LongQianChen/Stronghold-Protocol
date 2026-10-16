// Drives a deterministic probe through the production match-host boot, including its script snapshot checks.
import {createBattleFromSpec,resultDigest} from '../../../server/sim/spec.js';
import {DataSource} from '../../../server/sim/simdata.js';
export class Match {
  constructor(opts){this.opts=opts;}
  start(){
    const b=createBattleFromSpec(this.opts.scriptSpec,new DataSource(this.opts.data));
    b.start();for(let i=0;i<90;i++) b.step();
    this.opts.broadcast({t:'m.result',snapshot:b.snapshot(),digest:resultDigest(b.result()),errors:b.errors});
  }
  dispose(){}
}
