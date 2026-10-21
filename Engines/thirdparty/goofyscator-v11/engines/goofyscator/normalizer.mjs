import {makeProbe} from '../deobfuscator/upstream/goofy-review/goofyscator/src/runtime/probe.js';
import {readableParser} from '../ad/lift/readable-parser.js';

export function validateNormalizerSource(code){
  const ast=readableParser.parse(code,{luaVersion:'5.3',scope:true,comments:false});
  const forbidden=new Set(['loadfile','dofile','io','require']);
  if((ast.globals??[]).some(node=>forbidden.has(node.name)))
    throw Error('Unexpected host API in metadata normalizer');
}

// Reuse only the private metadata-normalization routines, never the upstream
// host runtime, file loader, bootstrap override or probe process launcher.
export function makeNormalizer(discovery){
  const bootstrap={key:'',stateField:'',loaderField:'',emptyFields:[],payloadSeedField:'',secondaryField:'',geKey:'',
    mapField:'',alphabet:'',hashField:'',antiSeedMagic:0,primaryExecKey:'',primaryCallbackId:0,
    ...discovery.bootstrap};
  const probe=makeProbe({objectPath:'',discovery:{...discovery,bootstrap}});
  let code=probe.slice(probe.indexOf('local C={'),probe.indexOf('local originalLB='));
  if(!code||!code.includes('local obj=assert(loadfile(object_path))();'))throw Error('Normalizer reference layout changed');
  code=code.replace('local obj=assert(loadfile(object_path))();','local obj=object;');
  code=code.replace('local function setof(a)',`C.cacheKey=${discovery.instructionLayout.cacheKey}
local function setof(a)`);
  code=code.replace('local function hid(ins)local a=hids(ins);return a[1] end',`local function hid(ins)
    local metadata=rawget(ins,${discovery.forwardingMetaKey})
    if type(metadata)=='table' and type(metadata[1])=='function' then
      local id=metadata[2]
      if functionNames[metadata[1]]~=C.property[id] then error('V11 unverified forwarding family',0)end
      return id
    end
    local a=hids(ins);return a[1]
  end`);
  code=code.replace('local H=obj[C.H];local saved={};for _,id in ipairs(C.ids)do saved[id]=H[id];if not keep[id] then local cid=id;H[id]=function(a,b,x)return collector(cid,a,b,x)end end end',
    'local H=obj[C.H];local saved={};for _,id in ipairs(C.ids)do saved[id]=rawget(H,id);if not keep[id] then local cid=id;rawset(H,id,function(a,b,x)return collector(cid,a,b,x)end)end end');
  code=code.replace('for _,id in ipairs(C.ids)do H[id]=saved[id] end','for _,id in ipairs(C.ids)do rawset(H,id,saved[id])end');
  code=code.replace('local function with_capture_handlers(keep,collector,fn,disableAnti)',`local function rebind(value,seen,depth)
    depth=depth or 0;if depth>64 then error('V11 cached handler depth exceeded',0)end
    if type(value)=='function' then
      local property=functionNames[value]
      if not property then error('V11 unresolved cached handler reference',0)end
      for _,id in ipairs(C.ids)do if C.property[id]==property then return obj[C.H][id]end end
      error('V11 cached handler dispatch missing',0)
    end
    if type(value)~='table' then return value end
    seen=seen or {};if seen[value] then return seen[value]end
    local copy={};seen[value]=copy
    for key,item in pairs(value)do copy[key]=rebind(item,seen,depth+1)end
    return copy
  end
local function with_capture_handlers(keep,collector,fn,disableAnti)`);
  code=code.replace('local one=clone(ins);setpc(fake,pc);','local one=clone(ins);one[C.cacheKey]=nil;setpc(fake,pc);');
  code=code.replaceAll('hf(obj,state,c)','hf(obj,state,rebind(c))');
  code=code.replaceAll('hf(obj,state,parent)','hf(obj,state,rebind(parent))');
  code=code.replaceAll('local hf=SAVED_HANDLERS[C.property[id]] or obj[C.H][id]',
    `local hf=C.semantic[id]=='inline' and SAVED_HANDLERS[${JSON.stringify(discovery.genericInlineProperty)}] or SAVED_HANDLERS[C.property[id]] or obj[C.H][id]`);
  code=code.replace('local ins=x.ins or {};local pc=x.logical_pc or sourcePc;',
    `local ins=x.ins or {};local pc=x.logical_pc or sourcePc;
    object[${JSON.stringify(discovery.prepareConstantAccess)}](object,state,ins);`);
  code=code.replace('pr.paramCount=proto_param_count(childCap.state,childCap.ins);',
    `pr.paramCount=(childCap.state[${discovery.parameterTopKey}] or -1)+1;`);
  code=code.replace('local count=rawget(ins,0)or #ins;','local count=0;while ins[count+1]~=nil do count=count+1;if count>100000 then error("V11 normalization instruction budget",0)end end;');
  validateNormalizerSource(code);
  return `local function normalizeCaptured(object,state,instructions,decoded,savedOriginalHandlers,originalRunner,functionNames)
${code}
for property,fn in pairs(savedOriginalHandlers)do SAVED_HANDLERS[property]=fn end
local oldRunner=object[C.runner]
local oldAnti=C.anti~='' and object[C.anti] or nil
if C.anti~='' then object[C.anti]=function(mode,a,b,c)
  if mode==nil and oldAnti then return oldAnti(nil)end
  return c
end end
object[C.runner]=originalRunner
local ok,result=pcall(function()
  FRESH_BANK=type(decoded)=='table' and decoded[2] or {}
  local main=normalize_program(state,instructions,0)
  main.id=0
  main.paramCount=type(decoded)=='table' and type(decoded[1])=='table' and decoded[1][C.paramProtoKey] or 0
  local programs={main}
  for i=1,#PROGRAMS do if PROGRAMS[i] and not PROGRAMS[i].pending then programs[#programs+1]=PROGRAMS[i]end end
  return {version='V11',root='payload-handoff',programs=programs}
end)
object[C.runner]=oldRunner
if C.anti~='' then object[C.anti]=oldAnti end
if not ok then return nil,tostring(result)end
return result
end`;
}

export function decodeNormalized(value){
  if(!value||typeof value!=='object')return value;
  if(value.type==='bytes')return Buffer.from(value.hex,'hex').toString('latin1');
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,decodeNormalized(item)]));
}
