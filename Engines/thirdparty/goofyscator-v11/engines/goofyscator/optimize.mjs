import {collapseEnvironmentProxy,finalizeEnvironmentProxy,findEnvironmentProxy} from '../deobfuscator/upstream/goofy-review/goofyscator/src/optimize/environment-collapse.js';
import {optimizeBundle} from '../deobfuscator/upstream/goofy-review/goofyscator/src/optimize/index.js';
import {buildCfg} from '../deobfuscator/upstream/goofy-review/goofyscator/src/ir/cfg.js';
import {narrowWrappedOpenResults,narrowKnownSingleResults} from './open-results.mjs';
import {discoverSuite} from '../deobfuscator/upstream/goofy-review/goofyscator/src/optimize/wrapper-collapse.js';

function stripV11Guard(bundle,recoveredSuite=null){
  const root=bundle.programs.find(p=>p.id===0),guards=bundle.programs.filter(p=>{
    const strings=new Set();for(const x of p.instructions)for(const v of Object.values(x))if(v?.kind==='literal'&&typeof v.value==='string')strings.add(v.value);
    return [':(%d*)\n','tonumber','l'].every(s=>strings.has(s));
  });
  if(guards.length!==1)return {stripped:false,reason:'guard-missing-or-ambiguous'};
  let proxy;
  for(const x of root.instructions)if(x.op==='call'&&x.argCount===2&&x.resultCount===1){
    proxy=findEnvironmentProxy(bundle,{stripped:true,fromPc:x.pc+1});if(proxy)break;
  }
  if(!proxy)return {stripped:false,reason:'verified-proxy-missing'};
  const xs=root.instructions,closureIndex=xs.findIndex(x=>x.op==='closure'&&x.prototype===guards[0].id);
  if(closureIndex<=proxy.throughIndex)return {stripped:false,reason:'guard-order-mismatch'};
  const aliases=new Set([xs[closureIndex].dst]);let callIndex=-1,crashIndex=-1,branch=false;
  for(let i=closureIndex+1;i<Math.min(xs.length,closureIndex+12);i++){
    const x=xs[i];
    if(x.op==='move'&&x.src?.kind==='reg'&&aliases.has(x.src.index))aliases.add(x.dst);
    else if(x.op==='call'&&aliases.has(x.base)&&x.argCount===0&&x.resultCount===1){callIndex=i;break;}
    else if(x.dst!==undefined)aliases.delete(x.dst);
  }
  if(callIndex<0)return {stripped:false,reason:'direct-guard-call-missing'};
  for(let i=callIndex+1;i<Math.min(xs.length,callIndex+10);i++){
    const x=xs[i];if(x.op==='branch_false')branch=true;
    if(branch&&x.op==='call'&&x.argCount===0&&x.resultCount===0){crashIndex=i;break;}
  }
  if(crashIndex<0)return {stripped:false,reason:'guard-failure-path-missing'};
  // The value-wrapper initializer is also used by the protected user program.
  // It is not part of the disposable validator, even when it sits between the
  // environment proxy and the final guard. Preserve its proven initialization.
  let from=proxy.throughIndex+1;
  const suite=discoverSuite(bundle)??recoveredSuite;
  if(!suite&&xs.slice(from,closureIndex).some(x=>x.op==='closure'))
    return {stripped:false,reason:'unproven-bootstrap-before-guard'};
  if(suite){
    const start=xs.findIndex((x,i)=>i>=from&&i<closureIndex&&x.op==='closure'&&x.prototype===suite.helperId);
    if(start>=0){
      const next=xs.findIndex((x,i)=>i>start&&x.op!=='nop');
      const call=xs[next];
      if(call?.op!=='call'||call.base!==xs[start].dst||call.argCount!==0||call.resultCount!==2)
        return {stripped:false,reason:'wrapper-initializer-not-proven'};
      from=next+1;
    }
  }
  for(let i=from;i<=crashIndex;i++)xs[i]={pc:xs[i].pc,sourcePc:xs[i].sourcePc,sub:xs[i].sub,op:'nop',optimizedAway:'verified-v11-guard-envelope'};
  root.cfg=buildCfg(root);
  return {stripped:true,fromPc:xs[from].pc,throughPc:xs[crashIndex].pc,userEntryPc:xs[crashIndex+1]?.pc};
}

export function optimizeV11(bundle){
  bundle.root=0;
  // Propagate proven literal keys before identifying the environment bootstrap.
  const initial=optimizeBundle(bundle);bundle=initial.bundle;
  const protection=stripV11Guard(bundle,initial.stats.wrappers?.suite);
  let environment=collapseEnvironmentProxy(bundle,protection);
  if(!environment.collapsed){
    const root=bundle.programs.find(p=>p.id===0);
    // The anti-tamper-off variant has the same independently verified proxy
    // bootstrap, but no final guard. Let the reference pass prove its identity
    // and non-observability before removing anything.
    for(const instruction of root.instructions){
      if(instruction.op!=='call'||instruction.argCount!==2||instruction.resultCount!==1)continue;
      const attempt=collapseEnvironmentProxy(bundle,{stripped:true,fromPc:instruction.pc+1});
      if(attempt.collapsed){environment=attempt;break;}
    }
  }
  let result=optimizeBundle(bundle);
  const wrapperStages=[initial.stats.wrappers,result.stats.wrappers];
  if(narrowKnownSingleResults(result.bundle)){result=optimizeBundle(result.bundle);wrapperStages.push(result.stats.wrappers);}
  narrowWrappedOpenResults(result.bundle);
  finalizeEnvironmentProxy(result.bundle,environment);
  const wrapperRecovery=wrapperStages.find(stage=>stage?.collapsed)??wrapperStages.at(-1);
  return {...result,stats:{...result.stats,initialWrappers:initial.stats.wrappers,wrapperRecovery,v11Protection:protection,v11Environment:environment}};
}
