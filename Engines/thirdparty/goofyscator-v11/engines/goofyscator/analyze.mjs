import fs from 'node:fs';
import {parseWrapper,findMatching} from '../deobfuscator/upstream/goofy-review/goofyscator/src/parser/lua-object.js';
import {discoverV10} from '../deobfuscator/upstream/goofy-review/goofyscator/src/discovery/v10.js';
import {classifyHandler} from '../deobfuscator/upstream/goofy-review/goofyscator/src/discovery/classify-handlers.js';
import {readableParser} from '../ad/lift/readable-parser.js';
import {discoverHandlerMap} from './handler-map.mjs';

function constant(node){
  if(node.type==='StringLiteral')return node.value;
  if(node.type==='NumericLiteral')return node.value;
  if(node.type==='BinaryExpression'&&node.operator==='..'){
    const a=constant(node.left),b=constant(node.right);
    if(typeof a==='string'&&typeof b==='string')return a+b;
  }
  throw Error('Nonconstant key');
}
function selectFunction(node){
  if(node.type==='FunctionDeclaration')return node;
  if(node.type!=='IndexExpression'||node.base.type!=='TableConstructorExpression')return null;
  let key;try{key=constant(node.index);}catch{return null;}
  for(const field of node.base.fields){
    let fieldKey;
    try{fieldKey=field.type==='TableKeyString'?field.key.name:field.type==='TableKey'?constant(field.key):null;}catch{return null;}
    if(fieldKey===key)return selectFunction(field.value);
  }
  return null;
}

export function normalizeWrapper(source){
  const wrapper=parseWrapper(source);
  for(const entry of wrapper.entries){
    if(entry.rawKey.startsWith('[')){
      try{entry.key=constant(readableParser.parse('return '+entry.rawKey.slice(1,-1),{luaVersion:'5.3'}).body[0].arguments[0]);}catch{}
    }
    let value=entry.value.trim();
    try{
      const fn=selectFunction(readableParser.parse('return '+value,{luaVersion:'5.3',ranges:true}).body[0].arguments[0]);
      if(fn)value='('+value.slice(fn.range[0]-7,fn.range[1]-7)+')';
    }catch{}
    while(value.startsWith('(')&&findMatching(value,0,'(',')')===value.length-1)value=value.slice(1,-1).trim();
    if(value.startsWith('function'))value='('+value+')';
    entry.value=value;entry.isFunction=value.startsWith('(function');
  }
  return wrapper;
}

export function analyzeV11(source){
  if(!/^--[^\n]*protected by goofyscator V11 BETA-1\b/i.test(source.trimStart()))throw Error('Expected Goofyscator V11 BETA-1 input');
  const wrapper=normalizeWrapper(source);
  if(!wrapper.entries.some(e=>e.key===wrapper.entryMethod&&e.isFunction))throw Error('V11 entry method missing');
  const builders=wrapper.entries.filter(e=>(e.value.includes('__pairs')||e.value.includes('"pairs"'))&&(e.value.includes('__newindex')||e.value.includes('"newindex"'))&&e.value.length>3000);
  if(builders.length!==1)throw Error('V11 handler builder is missing or ambiguous');
  const builder=builders[0],mapping=discoverHandlerMap(builder.value);
  const handlerSources=new Map(mapping.properties.map(key=>{
    const entry=wrapper.entries.find(e=>e.key===key);
    if(!entry?.isFunction)throw Error('V11 mapped handler is missing: '+key);
    return [key,entry.value];
  }));
  return {wrapper,builder,mapping,handlerSources};
}

if(process.argv[1]?.endsWith('analyze.mjs')&&process.argv[2]){
  if(process.argv.includes('--raw-builder')){
    const raw=normalizeWrapper(fs.readFileSync(process.argv[2],'latin1'));
    console.log(raw.entries.find(e=>e.value.includes('"pairs"')&&e.value.includes('"newindex"'))?.value);process.exit(0);
  }
  const {wrapper,builder,mapping}=analyzeV11(fs.readFileSync(process.argv[2],'latin1'));
  if(process.argv.includes('--method')){console.log(wrapper.entries.find(e=>e.key===process.argv[process.argv.indexOf('--method')+1])?.value);process.exit(0);}
  if(process.argv.includes('--handler')){console.log(wrapper.entries.find(e=>e.key===mapping.map.get(Number(process.argv[process.argv.indexOf('--handler')+1])))?.value);process.exit(0);}
  console.log(JSON.stringify({entry:wrapper.entryMethod,entries:wrapper.entries.length,builder:builder?.key,
    handlers:mapping?.properties.length,dispatch:mapping?.dispatchIds.length,
    classifications:mapping?.properties.map(key=>({key,semantic:classifyHandler(wrapper.entries.find(e=>e.key===key).value)}))}));
  try{const discovery=discoverV10(wrapper);console.log('Discovery completed: '+discovery.version);}
  catch(error){console.log('Discovery gap: '+error.message);}
  if(process.argv.includes('--details')){
    for(const e of wrapper.entries)if(e.isFunction&&e.value.length>3000)console.log(e.key,e.value.length,e.value.slice(0,650));
    for(const e of wrapper.entries)if(e.value.includes('__newindex')||e.value.includes('__pairs'))console.log('META',e.key,e.value.slice(0,3000));
    console.log('BUILDER',builder?.value);
    console.log('KEYS',wrapper.entries.map(e=>e.key));
  }
  if(process.argv.includes('--unknown'))for(const key of mapping.properties){const e=wrapper.entries.find(e=>e.key===key);if(classifyHandler(e.value)==='unknown')console.log(key,e.value);}
  if(process.argv.includes('--entry')){
    console.log('ENTRY',wrapper.entries.find(e=>e.key===wrapper.entryMethod)?.value);
    for(const e of wrapper.entries)if(e.value.includes('cannot change environment')&&e.value.length>4000)console.log('BOOT',e.key,e.value);
    for(const e of wrapper.entries)if(e.value.includes('limitedstack')&&e.value.length>4000)console.log('BOOTSTRAP',e.key,e.value);
    for(const e of wrapper.entries)if(e.value.includes('stack overflow')&&e.value.includes('while true'))console.log('RUNNER',e.key,e.value);
  }
}
