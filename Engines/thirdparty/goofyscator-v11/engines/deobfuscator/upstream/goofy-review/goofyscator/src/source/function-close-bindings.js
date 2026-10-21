// A function-level CLOSE freezes one captured register generation. A fresh
// lexical binding initialized from the current value models subsequent register
// accesses exactly, including a read before the next write. Never move a
// declaration across an unresolved jump or out of a conditional/loop scope.
export function recoverFunctionCloseBindings(program){
  const p=structuredClone(program);let changed=0,unstructured=false;
  function inspect(xs){for(const x of xs??[]){
    if(['jump','branch_false','forprep','forloop','tforloop'].includes(x.op))unstructured=true;
    for(const k of ['setup','body','thenBody','elseBody'])inspect(x[k]);
    for(const b of x.branches??[])inspect(b.body);
  }}
  inspect(p.instructions);
  if(unstructured)return {program:p,changed};
  p.instructions=(p.instructions??[]).map(x=>{
    if(x.op!=='close'||!Number.isInteger(x.register))return x;
    changed++;
    return {pc:x.pc,sourcePc:x.sourcePc,sub:x.sub,op:'source_local',dst:x.register,
      value:{kind:'reg',index:x.register},sourceCloseGeneration:true,
      sourceRecovered:'function-close-generation'};
  });
  return {program:p,changed};
}
