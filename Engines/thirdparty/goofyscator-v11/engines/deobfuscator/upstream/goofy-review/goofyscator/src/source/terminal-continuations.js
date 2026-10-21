// A bounded straight-line suffix ending in return may be copied to its incoming
// edges. This removes cross-region early-return joins without inventing a value
// or evaluating the suffix on a path that did not originally reach it.
const STRAIGHT=new Set(['nop','source_label','getglobal','gettable','move','unary','binary','constant_call','source_call','call']);
const RETURNS=new Set(['return','source_return','return_literal','return_cell']);
function walk(xs,fn){for(const x of xs??[]){fn(x);for(const k of ['setup','body','thenBody','elseBody'])walk(x[k],fn);for(const b of x.branches??[])walk(b.body,fn);}}
export function recoverTerminalContinuations(program){
  const p=structuredClone(program),suffixes=new Map();let changed=0,budget=256;
  const collect=xs=>{
    for(let i=0;i<xs.length;i++){
      const tail=[];
      for(let j=i;j<Math.min(xs.length,i+12);j++){
        const x=xs[j];
        if(x.sourceRedeclare||x.sourceLocal||x.op==='source_call'&&(x.resultCount<0||x.sourceOpenResult))break;
        if(x.op==='call'&&(x.argCount<0||x.resultCount<0||x.sourceOpenResult||x.sourceVarargArgs))break;
        if(RETURNS.has(x.op)){
          if(x.open)break;
          tail.push(x);suffixes.set(xs[i].pc,tail);break;
        }
        if(!STRAIGHT.has(x.op)||x.target!=null)break;
        tail.push(x);
      }
      for(const k of ['setup','body','thenBody','elseBody'])if(xs[i][k])collect(xs[i][k]);
      for(const b of xs[i].branches??[])collect(b.body??[]);
    }
  };
  collect(p.instructions??[]);
  const process=xs=>xs.flatMap(x=>{
    for(const k of ['setup','body','thenBody','elseBody'])if(x[k])x[k]=process(x[k]);
    for(const b of x.branches??[])b.body=process(b.body??[]);
    const tail=['jump','branch_false'].includes(x.op)?suffixes.get(x.target):null;
    if(!tail||tail.length>budget)return [x];
    budget-=tail.length;changed++;
    const copy=tail.filter(y=>!['nop','source_label'].includes(y.op)).map((y,i)=>({...structuredClone(y),
      pc:i===0&&x.op==='jump'?x.pc:`TC_${x.pc}_${i}`,optimizedFrom:'terminal-continuation'}));
    if(x.op==='jump')return copy;
    return [{pc:x.pc,sourcePc:x.sourcePc,op:'if',condition:x.condition,thenBody:[],elseBody:copy,
      optimizedFrom:'terminal-continuation'}];
  });
  p.instructions=process(p.instructions??[]);
  const targets=new Set();walk(p.instructions,x=>{if(x.target!=null)targets.add(x.target);});
  const prune=xs=>xs.filter(x=>x.op!=='source_label'||targets.has(x.pc)).map(x=>{
    for(const k of ['setup','body','thenBody','elseBody'])if(x[k])x[k]=prune(x[k]);
    for(const b of x.branches??[])b.body=prune(b.body??[]);return x;
  });
  p.instructions=prune(p.instructions);
  return {program:p,changed};
}
