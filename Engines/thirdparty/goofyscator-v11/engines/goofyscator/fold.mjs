import {foldV10DecoderCalls} from '../deobfuscator/upstream/goofy-review/goofyscator/src/optimize/decoder-fold.js';
import {evaluateIrProgram} from '../deobfuscator/upstream/goofy-review/goofyscator/src/eval/ir-interpreter.js';

function isDecoder(program){
  if(program.paramCount!==3||program.instructions.length<80||program.instructions.length>180)return false;
  const strings=new Set(),numbers=new Set(),globals=new Set();
  for(const instruction of program.instructions){
    for(const value of Object.values(instruction))if(value?.kind==='literal'){
      if(typeof value.value==='string')strings.add(value.value);
      if(typeof value.value==='number')numbers.add(value.value);
    }
    if(instruction.op==='getglobal')globals.add(instruction.key.value);
  }
  return ['string','byte','char','math','floor'].every(s=>strings.has(s))&&numbers.has(256)&&numbers.has(65536)&&
    [...globals].every(g=>['string','table','math','bit32'].includes(g));
}

export function foldDecoderCalls(bundle){
  const candidates=bundle.programs.filter(isDecoder);
  if(candidates.length!==1)return {folded:0,error:'V11 pure string decoder missing or ambiguous'};
  const decoder=candidates[0],evaluationBundle=structuredClone(bundle),evaluationDecoder=evaluationBundle.programs.find(p=>p.id===decoder.id);
  const root=bundle.programs.find(p=>p.id===0),registers=new Map(),bindings=new Map();
  for(const instruction of root.instructions){
    if(instruction.op==='closure'&&instruction.prototype===decoder.id){
      for(const binding of instruction.upvalues??[]){
        const known=binding.kind===0?registers.get(binding.index):null;
        if(known?.op==='closure'&&(known.upvalues??[]).length===0)bindings.set(binding.slot,known.prototype);
      }
      break;
    }
    if(instruction.dst!==undefined)registers.delete(instruction.dst);
    if(instruction.op==='closure')registers.set(instruction.dst,instruction);
  }
  evaluationDecoder.instructions=evaluationDecoder.instructions.map(instruction=>{
    if(instruction.op!=='getupval'||!bindings.has(instruction.slot))return instruction;
    return {...instruction,op:'closure',prototype:bindings.get(instruction.slot),upvalues:[]};
  });
  const errors=new Set();let evaluations=0;
  const result=foldV10DecoderCalls(bundle,{isDecoder,evaluate:(_bundle,id,args)=>{
    evaluations++;
    try{return evaluateIrProgram(evaluationBundle,id,args,{maxSteps:500000});}
    catch(error){errors.add(error.message);throw error;}
  }});
  return {...result,evaluations,errors:[...errors]};
}
