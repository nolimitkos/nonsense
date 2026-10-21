import {buildCfg} from '../ir/cfg.js';
import {maxRegisterIndex} from '../ir/registers.js';
import {usesDefs} from '../optimize/dce.js';

// A loop-local capture must get a fresh lexical binding each iteration. Prove
// definite assignment and that every captured path closes before the backedge;
// do not approximate CLOSE by deleting it or sharing one outer local.
export function recoverLoopCaptures(program){
  const p=structuredClone(program),xs=p.instructions??[],cfg=buildCfg(p),max=maxRegisterIndex(p);
  const index=new Map(xs.map((x,i)=>[x.pc,i])),meta=xs.map(x=>usesDefs(x,max)),inserts=new Map();let changed=0;
  for(let h=0;h<xs.length;h++){
    const head=xs[h];if(head.op!=='tforloop')continue;
    const exit=index.get(head.target);if(exit==null||exit<=h+1)continue;
    const region=new Set(xs.slice(h+1,exit).map(x=>x.pc));
    if(cfg.nodes.some((n,j)=>j!==h&&!region.has(n.pc)&&n.successors.some(pc=>region.has(pc))))continue;
    if(xs.slice(h+1,exit).some(x=>x.target===xs[h+1].pc))continue;
    const closes=xs.slice(h+1,exit).filter(x=>x.op==='close'),regs=[...new Set(closes.map(x=>x.register))];
    for(const r of regs){
      if(r===head.control||(r>=head.resultBase&&r<head.resultBase+head.resultCount))continue;
      const queue=[[h+1,false,false,false]],seen=new Set();let safe=true,sawCapture=false;
      while(queue.length&&safe){
        const [i,defined,active,closed]=queue.pop(),key=`${i}:${defined}:${active}:${closed}`;
        if(seen.has(key))continue;seen.add(key);
        const x=xs[i];if(!x){safe=false;break;}
        if(!region.has(x.pc)){
          if(active){safe=false;break;}
          if(x.pc!==head.pc&&x.pc!==head.target){safe=false;break;}
          continue;
        }
        const capture=(x.upvalues??[]).some(b=>b.kind===0&&b.index===r);
        if(x.op!=='close'&&(meta[i].use.has(r)||meta[i].def.has(r))&&closed){safe=false;break;}
        if(x.op!=='close'&&meta[i].use.has(r)&&!defined){safe=false;break;}
        const definite=meta[i].def.has(r)&&!(x.op==='call'&&x.resultCount<0)&&!(x.op==='source_call'&&x.resultCount<0);
        const isClose=x.op==='close'&&x.register===r;
        if(capture)sawCapture=true;
        const nextActive=isClose?false:active||capture;
        if(['return','source_return','tailcall','source_tailcall'].includes(x.op))continue;
        for(const pc of cfg.nodes[i].successors){const j=index.get(pc);if(j!=null)queue.push([j,defined||definite,nextActive,closed||isClose]);}
      }
      if(!safe||!sawCapture)continue;
      const start=h+1,decls=inserts.get(start)??[];
      decls.push({pc:`ITER_${head.pc}_${r}`,op:'source_local',dst:r,value:{kind:'literal',value:null},sourceRecovered:'iteration-capture-lifetime'});
      inserts.set(start,decls);
      for(const x of closes)if(x.register===r){x.op='nop';x.optimizedAway='source-iteration-capture-close';}
      changed++;
    }
  }
  p.instructions=xs.flatMap((x,i)=>[...(inserts.get(i)??[]),x]);
  return {program:p,changed};
}
