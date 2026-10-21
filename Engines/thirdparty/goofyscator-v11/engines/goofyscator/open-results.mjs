import {buildCfg} from '../deobfuscator/upstream/goofy-review/goofyscator/src/ir/cfg.js';
import {maxRegisterIndex} from '../deobfuscator/upstream/goofy-review/goofyscator/src/ir/registers.js';
import {usesDefs} from '../deobfuscator/upstream/goofy-review/goofyscator/src/optimize/dce.js';

export function narrowKnownSingleResults(bundle){
  let changed=0;
  for(const p of bundle.programs){
    const known=new Set(),max=maxRegisterIndex(p),targets=new Set(p.instructions.filter(x=>x.target!==undefined).map(x=>x.target));
    const escaped=new Set(p.instructions.flatMap(x=>(x.upvalues??[]).filter(b=>b.kind===0).map(b=>b.index)));
    for(const x of p.instructions){
      if(targets.has(x.pc))known.clear();
      const moveKnown=x.op==='move'&&(x.src?.singleResult||x.src?.kind==='reg'&&known.has(x.src.index));
      const cellKnown=x.op==='cell_get'&&known.has(x.cell);
      const wrappedKnown=x.op==='cell_results'&&x.count===1&&known.has(x.sourceBase);
      if(x.op==='call'&&known.has(x.base)&&x.resultCount<0){x.resultCount=1;x.optimizedKnownReturnArity=true;changed++;}
      for(const r of usesDefs(x,max).def)known.delete(r);
      if(moveKnown||cellKnown)known.add(x.dst);
      if(wrappedKnown)known.add(x.base);
      if(x.op==='call')for(const r of escaped)known.delete(r);
      if(x.op==='cell_set')known.clear();
      if(['jump','branch_false','forloop','tforloop','forprep'].includes(x.op))known.clear();
    }
  }
  return changed;
}

// A proven fixed-arity wrapper consumes the open packet and resets TOP. Shrink
// the producer only if CFG liveness proves every discarded register is dead.
export function narrowWrappedOpenResults(bundle){
  let changed=0;
  for(const program of bundle.programs){
    const xs=program.instructions,cfg=buildCfg(program),max=maxRegisterIndex(program);
    const indices=new Map(xs.map((x,i)=>[x.pc,i])),nodes=new Map(cfg.nodes.map(n=>[n.pc,n])),meta=xs.map(x=>usesDefs(x,max));
    const live=xs.map(()=>new Set()),out=xs.map(()=>new Set());let dirty=true;
    while(dirty){
      dirty=false;
      for(let i=xs.length-1;i>=0;i--){
        const next=new Set();
        for(const pc of nodes.get(xs[i].pc)?.successors??[]){
          const j=indices.get(pc);if(j!==undefined)for(const r of live[j])next.add(r);
        }
        out[i]=next;
        const incoming=new Set(meta[i].use);for(const r of next)if(!meta[i].def.has(r))incoming.add(r);
        if(incoming.size!==live[i].size||[...incoming].some(r=>!live[i].has(r))){live[i]=incoming;dirty=true;}
      }
    }
    for(let i=0;i<xs.length;i++){
      const producer=xs[i];if(producer.op!=='call'||producer.resultCount>=0)continue;
      let j=i+1;while(xs[j]?.op==='nop')j++;
      const consumer=xs[j];
      if(!['cell_results','identity_results'].includes(consumer?.op)||consumer.sourceBase!==producer.base||consumer.resultCount<0)continue;
      const count=Math.min(consumer.count,consumer.sourceCount??consumer.count);
      if([...out[i]].some(r=>r>=producer.base+count))continue;
      producer.resultCount=count;producer.narrowedOpenResults=true;changed++;
    }
  }
  return changed;
}
