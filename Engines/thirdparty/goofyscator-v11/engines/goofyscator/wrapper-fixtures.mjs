import {buildCfg} from '../deobfuscator/upstream/goofy-review/goofyscator/src/ir/cfg.js';
export const R=index=>({kind:'reg',index}),L=value=>({kind:'literal',value});
export function instructions(){
  const xs=[];
  return {xs,add(op,fields={}){const x={pc:xs.length+1,op,...fields};xs.push(x);return x;},
    move(dst,src){return this.add('move',{dst,src});},global(dst,key){return this.add('getglobal',{dst,key:L(key)});},
    call(base,argCount,resultCount){return this.add('call',{base,argCount,resultCount});},
    ret(base=0,count=0){return this.add('return',{base,count,open:false,hasValues:count>0});}};
}
export function wrapperFixture(keys){
  const [valueKey,unwrapKey,invokeKey]=keys,programs=[];
  const make=(id,paramCount,build)=>{const b=instructions();build(b);const p={id,paramCount,instructions:b.xs};p.cfg=buildCfg(p);programs.push(p);return p;};
  const capture=(index,slot,kind=0)=>({kind,index,slot});
  make(1,0,b=>{
    b.global(0,'rawget');b.global(1,'setmetatable');b.global(2,'string');b.add('gettable',{dst:2,table:2,key:L('byte')});
    b.global(3,'table');b.add('gettable',{dst:3,table:3,key:L('unpack')});
    b.add('closure',{dst:4,prototype:2,upvalues:[capture(0,101),capture(1,102)]});
    b.add('closure',{dst:5,prototype:6,upvalues:[capture(4,201),capture(2,202),capture(3,203)]});
    b.move(6,R(4));b.move(7,R(5));b.ret(6,2);
  });
  make(2,1,b=>{
    b.add('newtable',{dst:1});b.add('settable',{table:1,key:L(valueKey),value:R(0)});
    b.add('closure',{dst:2,prototype:3,upvalues:[capture(1,301),capture(101,302,1)]});b.add('settable',{table:1,key:L(unwrapKey),value:R(2)});
    b.add('closure',{dst:2,prototype:4,upvalues:[capture(1,401),capture(101,402,1)]});b.add('settable',{table:1,key:L(invokeKey),value:R(2)});
    b.add('getupval',{dst:2,slot:102});b.move(3,R(1));b.add('newtable',{dst:4});
    b.add('closure',{dst:5,prototype:5,upvalues:[capture(101,501,1)]});b.add('settable',{table:4,key:L('__call'),value:R(5)});
    b.add('settable',{table:4,key:L('__metatable'),value:L(false)});b.add('tailcall',{base:2,argCount:2});
  });
  make(3,0,b=>{b.add('getupval',{dst:0,slot:302});b.add('getupval',{dst:1,slot:301});b.move(2,L(valueKey));b.add('tailcall',{base:0,argCount:2});});
  make(4,0,b=>{b.add('getupval',{dst:0,slot:402});b.add('getupval',{dst:1,slot:401});b.move(2,L(valueKey));b.call(0,2,1);b.add('vararg',{base:1,count:-1});b.add('tailcall',{base:0,argCount:-1,openPrefix:0});});
  make(5,2,b=>{
    b.add('binary',{dst:2,operator:'==',left:R(1),right:L(null)});const check=b.add('branch_false',{condition:R(2),target:0});const skip=b.add('jump',{target:0});
    check.target=b.xs.length+1;b.add('binary',{dst:2,operator:'==',left:R(1),right:L(unwrapKey)});const stop=b.add('branch_false',{condition:R(2),target:0});
    skip.target=b.xs.length+1;b.add('getupval',{dst:2,slot:501});b.move(3,R(0));b.move(4,L(valueKey));b.add('tailcall',{base:2,argCount:2});stop.target=b.xs.length+1;b.ret();
  });
  make(6,2,b=>{
    b.add('newtable',{dst:2});b.add('vararg',{base:3,count:-1});b.add('setlist',{table:2,from:3,to:3,open:true});b.add('newtable',{dst:3});
    b.move(4,L(1));b.move(5,R(1));b.move(6,L(1));const prep=b.add('forprep',{index:4,limit:5,step:6,target:0});const start=b.xs.length+1;
    b.add('getupval',{dst:7,slot:202});b.move(8,R(0));b.move(9,R(4));b.call(7,2,1);b.add('binary',{dst:7,operator:'==',left:R(7),right:L(49)});
    const other=b.add('branch_false',{condition:R(7),target:0});b.add('getupval',{dst:7,slot:201});b.add('gettable',{dst:8,table:2,key:R(4)});b.call(7,1,1);const join=b.add('jump',{target:0});
    other.target=b.xs.length+1;b.add('gettable',{dst:7,table:2,key:R(4)});join.target=b.xs.length+1;b.add('settable',{table:3,key:R(4),value:R(7)});
    b.add('forloop',{index:4,limit:5,step:6,target:start});prep.target=b.xs.length+1;
    b.add('getupval',{dst:4,slot:203});b.move(5,R(3));b.move(6,L(1));b.move(7,R(1));b.add('tailcall',{base:4,argCount:3});
  });
  const root=instructions();
  // Deliberate keyword collision, as can occur in unrelated user code.
  for(const [i,key] of ['rawget','setmetatable','string','table'].entries())root.global(90+i,key);
  root.add('closure',{dst:0,prototype:1,upvalues:[]});root.call(0,0,2);root.move(80,R(1));root.move(81,R(0));
  const finish=()=>{root.ret();const p={id:0,paramCount:0,instructions:root.xs};p.cfg=buildCfg(p);return {root:0,programs:[p,...programs]};};
  const box=(register,value)=>{root.move(20,R(80));root.move(21,L('1'));root.move(22,L(1));root.move(23,value);root.call(20,3,1);root.move(register,R(20));};
  const read=register=>{root.move(20,R(register));root.move(21,L(unwrapKey));root.call(20,1,1);};
  const print=(...values)=>{root.global(30,'print');values.forEach((v,i)=>root.move(31+i,v));root.call(30,values.length,0);};
  return {root,programs,finish,box,read,print};
}
