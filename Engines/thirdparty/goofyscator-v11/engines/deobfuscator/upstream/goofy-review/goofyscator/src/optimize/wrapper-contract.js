// Verify the storage read and forwarding closures, rather than assigning
// meanings to their randomized field numbers from arity/vararg presence alone.
export function verifyWrapperMethods({byId,helper,constructor,constructorClosure,wrapperRoot,valueKey,readMethod,invokeMethod,unwrapKey,invokeKey}){
  const rawgetSlots=new Set(),nativeSlots=new Map();
  for(const binding of constructorClosure.upvalues??[]){
    if(binding.kind!==0)continue;
    const before=helper.instructions.indexOf(constructorClosure);
    let definition=null;
    for(let i=before-1;i>=0;i--){const x=helper.instructions[i];if(x.dst===binding.index||x.secondDst===binding.index){definition=x;break;}}
    if(definition?.op==='getglobal'&&['rawget','setmetatable'].includes(definition.key?.value))nativeSlots.set(binding.slot,definition.key.value);
    if(nativeSlots.get(binding.slot)==='rawget')rawgetSlots.add(binding.slot);
  }
  const read={kind:'call',fn:'rawget',args:['box',valueKey]};
  const expectedInvoke={kind:'call',fn:read,args:['varargs']};
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function summarize(closure){
    if(!closure)return null;
    const p=byId.get(closure.prototype);if(!p||p.paramCount!==0)return null;
    const captures=new Map();
    for(const b of closure.upvalues??[]){
      if(b.kind===0&&b.index===wrapperRoot)captures.set(b.slot,'box');
      else if(b.kind===1&&rawgetSlots.has(b.index))captures.set(b.slot,'rawget');
      else return null;
    }
    const registers=new Map();let varargsBase=null,calls=0;
    const value=v=>v?.kind==='literal'?v.value:v?.kind==='reg'?registers.get(v.index):undefined;
    const expression=x=>{
      const fn=registers.get(x.base),args=[];
      if(x.argCount<0){if(varargsBase!==x.base+1)return null;args.push('varargs');}
      else for(let i=1;i<=x.argCount;i++)args.push(registers.get(x.base+i));
      if(fn===undefined||args.some(v=>v===undefined))return null;
      return {kind:'call',fn,args};
    };
    for(const x of p.instructions){
      if(['nop','vm_internal','close'].includes(x.op))continue;
      if(x.op==='getupval'){if(!captures.has(x.slot))return null;registers.set(x.dst,captures.get(x.slot));}
      else if(x.op==='move')registers.set(x.dst,value(x.src));
      else if(x.op==='move_pair'){const a=value(x.src),b=registers.get(x.secondSrc);registers.set(x.dst,a);registers.set(x.secondDst,b);}
      else if(x.op==='vararg'&&x.count<0)varargsBase=x.base;
      else if(x.op==='call'){
        const e=expression(x);if(x.resultCount!==1||!equal(e,read)||calls++)return null;registers.set(x.base,e);
      }else if(x.op==='tailcall'){const e=expression(x);return {value:e,tail:true,calls};}
      else if(x.op==='return'&&x.hasValues&&!x.open&&x.count===1)return {value:registers.get(x.base),tail:false,calls};
      else return null;
    }
    return null;
  }
  const a=summarize(readMethod),b=summarize(invokeMethod);
  if(!(a&&equal(a.value,read)&&b?.tail&&b.calls===1&&equal(b.value,expectedInvoke)))return false;
  // The constructor must create fresh storage and attach exactly the proven
  // methods through setmetatable. No unknown calls or stores are summarized.
  const registers=new Map([[0,'input']]);let meta=null;
  const value=v=>v?.kind==='literal'?v.value:v?.kind==='reg'?registers.get(v.index):undefined;
  for(const x of constructor.instructions){
    if(['nop','vm_internal','close'].includes(x.op))continue;
    if(x.op==='newtable')registers.set(x.dst,{fields:new Map()});
    else if(x.op==='move')registers.set(x.dst,value(x.src));
    else if(x.op==='move_pair'){const a=value(x.src),b=registers.get(x.secondSrc);registers.set(x.dst,a);registers.set(x.secondDst,b);}
    else if(x.op==='closure')registers.set(x.dst,x);
    else if(x.op==='getupval')registers.set(x.dst,nativeSlots.get(x.slot));
    else if(x.op==='settable'){
      const table=registers.get(x.table),key=value(x.key),v=value(x.value);
      if(!table?.fields||key===undefined||v===undefined)return false;table.fields.set(key,v);
    }else if(x.op==='setlist'&&!x.open&&x.to<x.from)continue;
    else if(x.op==='tailcall'){
      const box=registers.get(x.base+1);meta=registers.get(x.base+2);
      if(registers.get(x.base)!=='setmetatable'||x.argCount!==2||!box?.fields||!meta?.fields||
        box.fields.get(valueKey)!=='input'||box.fields.get(unwrapKey)?.prototype!==readMethod.prototype||box.fields.get(invokeKey)?.prototype!==invokeMethod.prototype||meta.fields.get('__metatable')!==false)return false;
      break;
    }else return false;
  }
  const call=meta?.fields.get('__call'),program=byId.get(call?.prototype);
  if(!program||program.paramCount!==2)return false;
  const captures=new Map();for(const binding of call.upvalues??[]){if(binding.kind!==1||!rawgetSlots.has(binding.index))return false;captures.set(binding.slot,'rawget');}
  const box=Symbol('box'),stored=Symbol('stored');
  function check(argument){
    const state=new Map([[0,box],[1,argument]]),xs=program.instructions,indices=new Map(xs.map((x,i)=>[x.pc,i]));let ip=0,steps=0;
    const val=v=>v?.kind==='literal'?v.value:v?.kind==='reg'?(state.get(v.index)??null):undefined;
    while(ip<xs.length&&steps++<128){
      const x=xs[ip++];
      if(['nop','vm_internal','close'].includes(x.op))continue;
      if(x.op==='getupval'){if(!captures.has(x.slot))return false;state.set(x.dst,captures.get(x.slot));}
      else if(x.op==='move')state.set(x.dst,val(x.src));
      else if(x.op==='binary'&&['==','~='].includes(x.operator))state.set(x.dst,x.operator==='=='?val(x.left)===val(x.right):val(x.left)!==val(x.right));
      else if(x.op==='unary'&&x.operator==='not'){const v=val(x.value);state.set(x.dst,v===false||v==null);}
      else if(x.op==='jump'||x.op==='branch_false'&&(val(x.condition)===false||val(x.condition)==null)){
        if(!indices.has(x.target))return false;ip=indices.get(x.target);
      }else if(x.op==='branch_false')continue;
      else if(x.op==='tailcall'||x.op==='call'){
        if(state.get(x.base)!=='rawget'||x.argCount!==2||state.get(x.base+1)!==box||state.get(x.base+2)!==valueKey)return false;
        if(x.op==='tailcall')return true;
        if(x.resultCount!==1)return false;state.set(x.base,stored);
      }else if(x.op==='return')return x.hasValues&&!x.open&&x.count===1&&state.get(x.base)===stored;
      else return false;
    }
    return false;
  }
  return check(null)&&check(unwrapKey);
}
