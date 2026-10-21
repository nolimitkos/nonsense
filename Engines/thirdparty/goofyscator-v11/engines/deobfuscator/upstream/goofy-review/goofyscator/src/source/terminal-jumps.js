import {buildCfg} from '../ir/cfg.js';

export function recoverTerminalJumps(program){
  const p=structuredClone(program),xs=p.instructions??[],index=new Map(xs.map((x,i)=>[x.pc,i]));let changed=0;
  const loopBoundaries=new Set(xs.filter(x=>['forprep','forloop','tforloop'].includes(x.op)).flatMap(x=>[x.pc,x.target]));
  const thread=pc=>{
    const seen=new Set();let i=index.get(pc);
    while(i!=null&&i<xs.length&&!seen.has(i)){
      seen.add(i);const x=xs[i];
      if(loopBoundaries.has(x.pc))return x.pc;
      if(x.op==='nop'){i++;continue;}
      if(x.op==='jump'&&typeof x.target==='number'&&x.target>x.pc){i=index.get(x.target);continue;}
      return x.pc;
    }
    return pc; // A cycle is not a transparent forwarding chain.
  };
  for(const x of xs)if(['jump','branch_false'].includes(x.op)){
    const target=thread(x.target);if(target!==x.target){x.target=target;changed++;}
  }
  const terminal=pc=>{
    const seen=new Set();let i=index.get(pc);
    while(i!=null&&i<xs.length&&!seen.has(i)){
      seen.add(i);const x=xs[i];
      if(x.op==='nop'){i++;continue;}
      if(x.op==='jump'){i=index.get(x.target);continue;}
      if(x.op==='return'&&!x.open)return x;
      return null;
    }
    return null;
  };
  for(let i=0;i<xs.length;i++){
    const x=xs[i];if(!['jump','branch_false'].includes(x.op))continue;
    const ret=terminal(x.target);if(!ret)continue;
    const copy={...ret,pc:x.pc,sourcePc:x.sourcePc,sub:x.sub,optimizedFrom:'terminal-jump'};
    xs[i]=x.op==='jump'?copy:{pc:x.pc,op:'if',condition:structuredClone(x.condition),thenBody:[],elseBody:[copy]};
    changed++;
  }
  if(changed){
    const cfg=buildCfg(p),nodes=new Map(cfg.nodes.map(n=>[n.pc,n])),seen=new Set(),queue=[cfg.entry];
    while(queue.length){const pc=queue.pop();if(seen.has(pc))continue;seen.add(pc);queue.push(...(nodes.get(pc)?.successors??[]));}
    p.instructions=xs.filter(x=>seen.has(x.pc));
  }
  return {program:p,changed};
}
