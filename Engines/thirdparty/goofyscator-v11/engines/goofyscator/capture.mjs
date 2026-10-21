import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {analyzeV11} from './analyze.mjs';
import {makeNormalizer,decodeNormalized} from './normalizer.mjs';

const quote=s=>JSON.stringify(s);
export function discoverBridge(analysis){
  const boot=analysis.wrapper.entries.filter(e=>e.value.includes('cannot change environment')&&e.value.length>4000);
  if(boot.length!==1)throw Error('V11 bootstrap not found');
  const bootstrap=boot[0];
  const signature=/^\(function\((\w+),(\w+),(\w+)\)/.exec(bootstrap.value);
  if(!signature)throw Error('V11 bootstrap signature not found');
  const [,self,payload,env]=signature;
  const re=new RegExp('return \\w+\\(\\('+self+'\\.([A-Za-z_]\\w*)\\)\\('+self+','+payload+','+env+'\\)\\)');
  const matches=[...bootstrap.value.matchAll(new RegExp(re.source,'g'))];
  if(matches.length!==1)throw Error('V11 primary bridge missing or ambiguous');
  const primary=matches[0][1],source=analysis.wrapper.entries.find(e=>e.key===primary)?.value;
  const bridgeSignature=/^\(function\((\w+),(\w+),(\w+),(\w+)\)/.exec(source??'');
  if(!bridgeSignature)throw Error('V11 primary bridge signature not found');
  const [,bridgeSelf,bridgePayload,,bridgeArgs]=bridgeSignature;
  const decoder=new RegExp('=\\('+bridgeSelf+'\\.(\\w+)\\)\\('+bridgeSelf+','+bridgePayload+',0\\)').exec(source)?.[1];
  const executor=new RegExp('return \\('+bridgeSelf+'\\.(\\w+)\\)\\('+bridgeSelf+',\\w+,'+bridgeArgs+'\\)').exec(source)?.[1];
  if(!decoder||!executor)throw Error('V11 primary decode bridge layout not found');
  const runners=analysis.wrapper.entries.filter(e=>e.value.includes('stack overflow')&&e.value.includes('while true do')&&e.value.includes('xpcall'));
  if(runners.length!==1)throw Error('V11 runner missing or ambiguous');
  const executorSource=analysis.wrapper.entries.find(e=>e.key===executor)?.value??'';
  const cachedRunner=new RegExp('\\w+\\.(\\w+)=\\w+\\.'+runners[0].key+';').exec(executorSource)?.[1];
  if(!cachedRunner)throw Error('V11 runner identity cache not found');
  const payloadBridges=[...bootstrap.value.matchAll(new RegExp('return \\w+\\(\\('+self+'\\.(\\w+)\\)\\('+self+',','g'))].map(m=>m[1]);
  return {primary,decoder,executor,runner:runners[0].key,cachedRunner,bootstrap:bootstrap.key,payloadBridges:[...new Set(payloadBridges)]};
}

export function capturePrimary(source,options={}){
  if(options.validator||options.emulator)throw Error('Executing the validator is disabled until the protected-payload boundary is verified');
  if(options.handoff&&options.secondary)throw Error('Choose validator or payload-handoff capture, not both');
  if(typeof source!=='string'||Buffer.byteLength(source,'latin1')>5_000_000)throw Error('V11 input must be a string of at most 5 MB');
  const analysis=analyzeV11(source),bridge=discoverBridge(analysis);
  const builderSelf=/^\(function\((\w+)\)/.exec(analysis.builder.value)?.[1];
  const returnedHandle=/;return (\w+);end\)$/.exec(analysis.builder.value)?.[1];
  const handlerField=builderSelf&&returnedHandle?new RegExp(builderSelf+'\\.(\\w+)='+returnedHandle+';').exec(analysis.builder.value)?.[1]:null;
  if(!handlerField)throw Error('V11 handler-table field not found');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'goofy-v11-capture-'));
  try{
    const script=`
local nativeSetfenv=setfenv
local nativeTypeof=typeof
local emit=print
local safe={assert=assert,error=error,type=type,typeof=typeof,tonumber=tonumber,tostring=tostring,
  select=select,next=next,pairs=pairs,ipairs=ipairs,pcall=pcall,xpcall=xpcall,
  rawequal=rawequal,rawget=rawget,rawset=rawset,getmetatable=getmetatable,setmetatable=setmetatable,
  string=string,table=table,math=math,bit32=bit32,buffer=buffer,unpack=unpack,
  coroutine=coroutine,debug=debug,os={clock=os.clock},
  print=function()error('V11 protected printing blocked during extraction',0)end,
  getfenv=getfenv,setfenv=setfenv}
safe._G=safe
local randomLibrary,randomStates=(function()
${fs.readFileSync(new URL('./random.luau',import.meta.url),'utf8')}
end)()
safe.Random=randomLibrary
safe.typeof=function(value)if randomStates[value] then return 'Random'end;return nativeTypeof(value)end
local missingGlobal='none'
setmetatable(safe,{__index=function(_,key)missingGlobal=tostring(key);return nil end})
safe.task={defer=function(fn,...)local co=coroutine.create(fn);coroutine.resume(co,...);return co end}
safe.task.spawn=safe.task.defer
safe.task.wait=function()return 0 end
nativeSetfenv(0,safe)
nativeSetfenv(1,safe)
local factory=nativeSetfenv(function()return (${analysis.wrapper.tableSource})end,safe)
local object=factory()
local functionNames={}
local savedOriginalHandlers={}
${[...analysis.handlerSources.keys()].map(key=>`functionNames[object[${quote(key)}]]=${quote(key)}`).join('\n')}
${[...analysis.handlerSources.keys()].map(key=>`savedOriginalHandlers[${quote(key)}]=object[${quote(key)}]`).join('\n')}
local pristineRunner=nativeSetfenv(function()return ${analysis.wrapper.entries.find(e=>e.key===bridge.runner).value}end,safe)()
${options.discovery?makeNormalizer(options.discovery):''}
local captured=nil
local activeDecoded=nil
local phase='entry'
local snapshotVisits=0
local function snapshot(v,seen,depth)
  snapshotVisits=snapshotVisits+1;depth=depth or 0
  if snapshotVisits>1000000 or depth>64 then error('V11 snapshot budget exceeded',0)end
  if type(v)~='table' then return v end
  seen=seen or {};if seen[v] then return seen[v] end
  local result={};seen[v]=result;for k,x in pairs(v)do result[snapshot(k,seen,depth+1)]=snapshot(x,seen,depth+1)end;return result
end
local function save(self,state,instructions,decoded)
  if captured then error('__V11_CAPTURED__',0)end
  local handlers=self[${quote(handlerField)}]
  if type(handlers)~='table' then error('V11 handler table missing',0)end
  ${[...analysis.mapping.map].map(([id,key])=>`do local fn=handlers[${id}];if type(fn)=='function' then
    if functionNames[fn] and functionNames[fn]~=${quote(key)} then error('V11 dispatch family mismatch at ${id}: '..functionNames[fn]..' ~= ${key}',0)end
    functionNames[fn]=${quote(key)}end end`).join('\n')}
  local rows={}
  for pc=1,100000 do
    local row=instructions[pc]
    if row==nil then break end
    rows[pc]=snapshot(row)
    if pc==100000 then error('V11 instruction budget exceeded',0)end
  end
  emit('INITIAL_INSTRUCTION_COUNT',#rows)
  captured={state=snapshot(state),instructions=rows,decoded=snapshot(decoded),object=self}
  ${options.discovery?`local normalized,normalizationError=normalizeCaptured(self,state,instructions,activeDecoded or decoded,savedOriginalHandlers,pristineRunner,functionNames)
  captured.normalized=normalized;captured.normalizationError=normalizationError`:''}
  error('__V11_CAPTURED__',0)
end
local originalExecutor=object[${quote(bridge.executor)}]
local originalPrimary=object[${quote(bridge.primary)}]
object[${quote(bridge.executor)}]=function(self,decoded,args)
  if type(args)=='table' and args[1]==self and type(args[2])=='string' then
    ${options.secondary?`do self[${quote(bridge.runner)}]=function(ss,state,instructions)return save(self,state,instructions,decoded)end;self[${quote(bridge.cachedRunner)}]=self[${quote(bridge.runner)}];return originalExecutor(self,decoded,args) end` : ''}
    phase='primary redirect'
    return self[${quote(bridge.primary)}](self,args[2],args[3],nil)
  end
  return originalExecutor(self,decoded,args)
end
object[${quote(bridge.primary)}]=function(self,payload,env,args)
  phase='primary decode'
  local decoded=self[${quote(bridge.decoder)}](self,payload,0)
  phase='primary frame build'
  self[${quote(bridge.runner)}]=function(ss,state,instructions)
    return save(self,state,instructions,decoded)
  end
  self[${quote(bridge.cachedRunner)}]=self[${quote(bridge.runner)}]
  return self[${quote(bridge.executor)}](self,decoded,args)
end
${options.secondary?`object[${quote(bridge.executor)}]=originalExecutor
object[${quote(bridge.primary)}]=originalPrimary
object[${quote(bridge.runner)}]=function(self,state,instructions)return save(self,state,instructions,{})end` : ''}
${options.handoff?`object[${quote(bridge.executor)}]=function(self,decoded,args)
  activeDecoded=decoded;return originalExecutor(self,decoded,args)
end
local reachedPrimary=false
object[${quote(bridge.primary)}]=originalPrimary
${bridge.payloadBridges.map(key=>`do local original=object[${quote(key)}];object[${quote(key)}]=function(self,...)
  reachedPrimary=true;phase='protected bridge ${key}';return original(self,...)
end end`).join('\n')}
local originalRunner=nativeSetfenv(function()return ${analysis.wrapper.entries.find(e=>e.key===bridge.runner).value}end,safe)()
local runnerCalls=0
object[${quote(bridge.runner)}]=function(self,state,instructions)
  runnerCalls=runnerCalls+1;phase='validator runner '..runnerCalls
  if reachedPrimary then return save(self,state,instructions,{})end
  if runnerCalls>1000 then error('V11 validator runner budget exceeded',0)end
  return originalRunner(self,state,instructions)
end`:''}
local ok,diagnostic=pcall(object[${quote(analysis.wrapper.entryMethod)}],object,safe)
if not captured then error('V11 capture ('..phase..', missing '..missingGlobal..'): '..tostring(diagnostic),0)end
if not ${options.secondary?'true':'false'} and #captured.instructions==0 then error('V11 protected payload decoded to an empty stream; recovery is incomplete',0)end
local function hex(value)
  local parts={};for i=1,#value do parts[i]=string.format('%02x',string.byte(value,i))end;return table.concat(parts)
end
local function jsonString(value)
  local parts={'"'}
  for i=1,#value do
    local b=string.byte(value,i)
    if b>=32 and b<=126 and b~=34 and b~=92 then parts[#parts+1]=string.char(b)
    else parts[#parts+1]=string.format('\\\\u%04x',b)end
  end
  parts[#parts+1]='"';return table.concat(parts)
end
local visits=0
local function encode(value,depth,seen)
  visits=visits+1;if visits>${Math.min(4000000,1000000+Math.floor(source.length/(1024*1024))*1000000)} or depth>64 then error('V11 export budget exceeded',0)end
  local kind=type(value)
  if kind=='nil' then return 'null' end
  if kind=='boolean' then return tostring(value) end
  if kind=='number' then if value~=value or math.abs(value)==math.huge then error('Nonfinite V11 field',0)end;return string.format('%.17g',value)end
  if kind=='string' then return '{"type":"bytes","hex":"'..hex(value)..'"}' end
  if kind=='function' then return '{"type":"function","handler":'..(functionNames[value] and jsonString(functionNames[value]) or 'null')..'}' end
  if kind~='table' then return '{"type":'..jsonString(kind)..'}' end
  seen=seen or {};if seen[value] then error('Cyclic V11 instruction',0)end;seen[value]=true
  local entries={}
  for key,item in pairs(value)do
    if type(key)~='number' and type(key)~='string' then error('Invalid V11 field key',0)end
    entries[#entries+1]=jsonString(tostring(key))..':'..encode(item,depth+1,seen)
  end
  seen[value]=nil;return '{'..table.concat(entries,',')..'}'
end
emit('V11_DATA '..encode({version='V11 BETA-1',root=${options.secondary?"'validator'":options.handoff?"'payload-handoff'":"'protected'"},complete=false,instructionCount=#captured.instructions,instructions=captured.instructions,normalized=captured.normalized,normalizationError=captured.normalizationError},0))
local function describe(value,depth,seen)
  if type(value)=='string' then return string.format('%q',value) end
  if type(value)~='table' then return tostring(value) end
  if depth>3 then return '<table>' end
  seen=seen or {};if seen[value] then return '<cycle>' end;seen[value]=true
  local parts={};for key,item in pairs(value)do parts[#parts+1]=tostring(key)..'='..describe(item,depth+1,seen)end
  seen[value]=nil;return '{'..table.concat(parts,',')..'}'
end
${options.details?`emit('STATE',describe(captured.state,0))
emit('DECODED',describe(captured.decoded,0))`:''}
${options.details?"emit('INSTRUCTIONS',describe(captured.instructions,0))":''}
`;
    const file=path.join(directory,'capture.luau');fs.writeFileSync(file,script,'latin1');
    const runtime=path.resolve('deobfuscator/deobf/bin/luau'+(process.platform==='win32'?'.exe':''));
    const timeout=options.timeout??Math.min(100000,15000+Math.floor(source.length/(256*1024))*5000);
    const result=spawnSync(runtime,[file],{encoding:'utf8',timeout,maxBuffer:32*1024*1024,windowsHide:true});
    if(result.status!==0)throw Error('V11 capture failed: '+(result.error?.message||result.stderr||result.stdout||'extractor exited without a diagnostic').slice(0,1600));
    const line=result.stdout.split(/\r?\n/).find(line=>line.startsWith('V11_DATA '));
    if(!line)throw Error('V11 capture returned no structured instruction data');
    const data=JSON.parse(line.slice(9));
    data.version=Buffer.from(data.version.hex,'hex').toString('utf8');
    data.root=Buffer.from(data.root.hex,'hex').toString('utf8');
    if(data.normalized)data.normalized=decodeNormalized(data.normalized);
    if(data.normalizationError)data.normalizationError=decodeNormalized(data.normalizationError);
    if(!data.instructionCount)throw Error('V11 capture returned no instructions');
    return {bridge,data};
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv[2]){
  const result=capturePrimary(fs.readFileSync(process.argv[2],'latin1'),{secondary:process.argv.includes('--secondary'),validator:process.argv.includes('--validator'),emulator:process.argv.includes('--emulator'),handoff:process.argv.includes('--handoff')});
  const output=process.argv.indexOf('--output');
  if(output>=0){if(!process.argv[output+1])throw Error('--output requires a file');fs.writeFileSync(process.argv[output+1],JSON.stringify(result,null,2)+'\n');}
  console.log(JSON.stringify({bridge:result.bridge,root:result.data.root,instructionCount:result.data.instructionCount,complete:false}));
}
