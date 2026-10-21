import {LiftContext} from '../deobfuscator/upstream/goofy-review/goofyscator/src/lift/context.js';
import {OPCODES} from '../deobfuscator/upstream/goofy-review/goofyscator/src/opcodes/index.js';
import {buildCfg} from '../deobfuscator/upstream/goofy-review/goofyscator/src/ir/cfg.js';
import {selector} from '../deobfuscator/upstream/goofy-review/goofyscator/src/decode/extra.js';
import {keyedStringSource} from './keyed-string.mjs';

export function liftNormalized(data,discovery){
  const context=new LiftContext(discovery);
  const programs=Object.values(data.programs).sort((a,b)=>a.id-b.id).map(program=>{
    let maximum=0;
    for(const i of Object.values(program.instructions))maximum=Math.max(maximum,i.dest??0,
      i.op1?.kind==='reg'?i.op1.value:0,i.op2?.kind==='reg'?i.op2.value:0);
    const scratch=maximum+32;
    const instructions=Object.values(program.instructions).flatMap(instruction=>{
      const i={...instruction,upvalues:Object.values(instruction.upvalues??{})};
      if(i.expandError||i.prototypeError)throw Error('V11 incomplete extraction at '+program.id+':'+i.pc+': '+(i.expandError||i.prototypeError));
      if(i.semantic==='return_zero')return context.base(i,'return',{base:0,count:0,open:false,hasValues:false});
      if(i.semantic==='return_one')return context.base(i,'return',{base:i.dest,count:1,open:false,hasValues:true});
      if(i.semantic==='return_fixed')return context.base(i,'return',{base:i.dest,count:i.op1.value,open:false,hasValues:i.op1.value>0});
      if(i.semantic==='return_open')return context.base(i,'return',{base:i.dest,count:i.op1.value,open:true,hasValues:true});
      if(i.semantic==='setupval')return context.base(i,'setupval',{slot:i.op1.value,value:context.reg(i.dest)});
      if(i.semantic==='keyed_string')return context.base(i,'move',{dst:i.dest,src:{kind:'function_source',singleResult:true,code:keyedStringSource(discovery.keyedStrings[discovery.dispatch[i.handlerId].property],i.extra)}});
      if(i.semantic==='native_factory'){
        const id=context.uleb(i.extra,0,-1).value,code=discovery.nativeFactories[id],count=i.op1.value;
        if(!code||!Number.isSafeInteger(count)||count<0||count>10000)throw Error('V11 native factory metadata missing at '+i.pc);
        if(count===0&&discovery.nativeDirectFunctions[id])return context.base(i,'move',{dst:i.dest,src:{kind:'function_source',code:discovery.nativeDirectFunctions[id]}});
        return [context.base(i,'move',{dst:i.dest,src:{kind:'function_source',code}}),
          {...context.base(i,'call',{base:i.dest,argCount:count,resultCount:1,openPrefix:-1}),pc:i.pc+0.25}];
      }
      if(i.semantic==='binary_store'){
        const cfg=discovery.binaryStores[discovery.dispatch[i.handlerId].property];
        const rhs=context.uleb(i.extra,0,-1),encoded=context.uleb(i.extra,rhs.next,-1);
        const operator=cfg.ops[(encoded.value^cfg.mask)>>>0];
        if(rhs.value<0||!operator||i.op1.kind!=='reg')throw Error('V11 compound table update metadata invalid at '+i.pc);
        return [context.base(i,'binary',{dst:scratch,operator,left:context.value(i.op1),right:context.reg(rhs.value)}),
          {...context.base(i,'move',{dst:i.op1.value,src:context.reg(scratch)}),pc:i.pc+0.25},
          {...context.base(i,'settable',{table:i.dest,key:context.value(i.op2),value:context.reg(scratch)}),pc:i.pc+0.5}];
      }
      if(i.semantic==='jump_nil')return [context.base(i,'binary',{dst:scratch,operator:i.op2.value!==0?'~=':'==',left:context.reg(i.dest),right:context.literal(null)}),
        {...context.base(i,'branch_false',{condition:context.reg(scratch),target:i.op1.value}),pc:i.pc+0.25}];
      if(i.semantic==='array_fixed')return context.base(i,'move',{dst:i.dest,src:{kind:'table',entries:
        Array.from({length:discovery.fixedArrays[discovery.dispatch[i.handlerId].property]},(_,j)=>context.reg(i.op1.value+j))}});
      if(i.semantic==='newarray'){
        const from=i.op1.value,to=i.op2.value,open=context.uleb(i.extra,0,0).value!==0;
        const count=Math.max(0,to-from+1);
        if(!Number.isSafeInteger(count)||count>100000)throw Error('V11 array constructor exceeds recovery budget');
        if(!open)return context.base(i,'move',{dst:i.dest,src:{kind:'table',entries:Array.from({length:count},(_,j)=>context.reg(from+j))}});
        if(i.dest>=from)throw Error('V11 overlapping open table constructor at '+i.pc);
        return [context.base(i,'newtable',{dst:i.dest}),{...context.base(i,'setlist',{table:i.dest,from,to,open:true}),pc:i.pc+0.25}];
      }
      if(i.semantic==='jump_compare'){
        const configuration=discovery.compare,id=selector(i.extra,configuration.mask),comparison=configuration.expressions[id];
        if(!comparison)throw Error('V11 unknown comparison selector at '+i.pc);
        const sequence=[context.base(i,'binary',{dst:scratch,operator:comparison.operator,left:context.reg(i.dest),right:context.value(i.op2)})];
        if(!comparison.negate)sequence.push({...context.base(i,'unary',{dst:scratch,operator:'not',value:context.reg(scratch)}),pc:i.pc+0.25});
        sequence.push({...context.base(i,'branch_false',{condition:context.reg(scratch),target:i.op1.value}),pc:i.pc+0.5});
        return sequence;
      }
      const lift=OPCODES[i.semantic];
      if(!lift)throw Error('V11 unsupported semantic '+i.semantic+' at '+program.id+':'+i.pc);
      return lift(i,context);
    }).map(instruction=>({...instruction,pc:instruction.pc*4,...(instruction.target!==undefined?{target:instruction.target*4}:{})}));
    const pcs=new Set(instructions.map(i=>i.pc));
    for(const instruction of instructions)if(instruction.target!==undefined&&!pcs.has(instruction.target))
      throw Error('V11 unresolved control-flow target '+instruction.target+' in prototype '+program.id);
    const result={id:program.id,paramCount:program.paramCount??0,instructionCount:program.instructionCount,instructions};
    result.cfg=buildCfg(result);return result;
  });
  return {version:'V11',root:data.root,programs};
}
