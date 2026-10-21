import {buildCfg} from '../ir/cfg.js';
import {maxRegisterIndex} from '../ir/registers.js';
import {usesDefs} from '../optimize/dce.js';

const reg=index=>({kind:'reg',index});

// Work on raw CFG instructions, before range operands are split into lexical
// lifetimes. Only the fresh constructor / terminal return consumes TOP, and
// every erased result register must be dead on every outgoing CFG edge.
export function recoverOpenExpressions(program){
  const p=structuredClone(program),xs=p.instructions??[],max=maxRegisterIndex(p);
  const cfg=buildCfg(p),index=new Map(xs.map((x,i)=>[x.pc,i]));
  const meta=xs.map(x=>usesDefs(x,max)),live=xs.map(()=>new Set()),out=xs.map(()=>new Set());
  let dirty=true;
  while(dirty){dirty=false;for(let i=xs.length-1;i>=0;i--){
    const next=new Set();for(const pc of cfg.nodes[i].successors){const j=index.get(pc);if(j!=null)for(const r of live[j])next.add(r);}
    out[i]=next;const before=new Set(meta[i].use);for(const r of next)if(!meta[i].def.has(r))before.add(r);
    if(before.size!==live[i].size||[...before].some(r=>!live[i].has(r))){live[i]=before;dirty=true;}
  }}
  const targets=new Set(xs.filter(x=>x.target!=null).map(x=>x.target));
  const captured=new Set(xs.flatMap(x=>(x.upvalues??[]).filter(b=>b.kind===0).map(b=>b.index)));
  const escaped=xs.map(()=>new Set()),escapedOut=xs.map(()=>new Set());
  dirty=true;
  while(dirty){dirty=false;for(let i=0;i<xs.length;i++){
    const after=new Set(escaped[i]),x=xs[i];
    if(x.op==='close')after.delete(x.register);
    for(const b of x.upvalues??[])if(b.kind===0)after.add(b.index);
    escapedOut[i]=after;
    for(const pc of cfg.nodes[i].successors){const j=index.get(pc);if(j==null)continue;for(const r of after)if(!escaped[j].has(r)){escaped[j].add(r);dirty=true;}}
  }}
  const next=i=>{do{i++;}while(xs[i]?.op==='nop');return i;};
  const erase=x=>({pc:x.pc,sourcePc:x.sourcePc,sub:x.sub,op:'nop',optimizedAway:'source-open-expression'});
  let changed=0;
  for(let i=0;i<xs.length;i++){
    const a=xs[i];if(!['call','source_call'].includes(a.op)||a.resultCount>=0||a.argCount<0)continue;
    const j=next(i),b=xs[j];if(!b||targets.has(b.pc))continue;
    const call={kind:'call',fn:a.op==='source_call'?structuredClone(a.fn):reg(a.base),
      args:a.op==='source_call'?structuredClone(a.args):Array.from({length:a.argCount},(_,k)=>reg(a.base+1+k)),sourceOpenResult:true};
    if(['call','tailcall'].includes(b.op)&&b.argCount<0&&a.base===b.base+1+Math.max(0,b.openPrefix??0)){
      const prefix=Math.max(0,b.openPrefix??0);
      if([...escaped[i]].some(r=>r>=a.base)||[...out[j]].some(r=>r>=a.base&&!meta[j].def.has(r)))continue;
      xs[i]=erase(a);xs[j]={...b,op:b.op==='tailcall'?'source_tailcall':'source_call',
        fn:reg(b.base),args:[...Array.from({length:prefix},(_,k)=>reg(b.base+1+k)),call],argCount:prefix+1,
        sourceOpenArgCall:true,optimizedFrom:'cfg-open-call-expression'};
      changed++;continue;
    }
    if(b.op==='return'&&b.open&&b.base<=a.base){
      const prefix=Array.from({length:a.base-b.base},(_,k)=>b.base+k);
      if(prefix.some(r=>captured.has(r)))continue;
      xs[i]=erase(a);xs[j]={...b,op:'source_return',open:false,values:[...prefix.map(reg),call]};changed++;continue;
    }
    if(b.op!=='newtable'||b.dst>=a.base)continue;
    const k=next(j),c=xs[k];
    if(c?.op!=='setlist'||!c.open||c.table!==b.dst||c.from>a.base||c.to!==a.base||targets.has(c.pc))continue;
    const prefix=Array.from({length:a.base-c.from},(_,n)=>c.from+n);
    if(prefix.some(r=>escaped[i].has(r))||[...out[k]].some(r=>r>=a.base)||[...escaped[i]].some(r=>r>=a.base))continue;
    xs[i]=erase(a);xs[j]=erase(b);
    xs[k]={pc:c.pc,sourcePc:c.sourcePc,sub:c.sub,op:'table_literal',dst:b.dst,entries:[...prefix.map(reg),call],optimizedFrom:'open-call-constructor'};
    changed++;
  }
  return {program:p,changed};
}
