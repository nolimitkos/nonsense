import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {analyzeV11} from './analyze.mjs';
import {discoverExtraction} from './discovery.mjs';
import {capturePrimary} from './capture.mjs';
import {liftNormalized} from './lift.mjs';
import {foldDecoderCalls} from './fold.mjs';
import {optimizeV11} from './optimize.mjs';
import {emitSourceLua} from '../deobfuscator/upstream/goofy-review/goofyscator/src/emit/source-lua.js';
import {readableParser} from '../ad/lift/readable-parser.js';
import {polishReadable} from '../ad/lift/polish.js';
import {improveReadability,validateGeneratedBindings,measureReadability} from './readability.mjs';
import {validateStartupCalls} from './semantic-validation.mjs';

function walk(node,fn){
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){node.forEach(n=>walk(n,fn));return;}
  fn(node);for(const value of Object.values(node))if(value&&typeof value==='object')walk(value,fn);
}

export function validateRecoveredSource(code){
  if(/P_0\s*=\s*function\(UP/.test(code))throw Error('V11 source emitter required a register-VM fallback');
  const ast=readableParser.parse(code,{luaVersion:'5.3'});
  walk(ast,node=>{
    if(node.type==='GotoStatement'||node.type==='LabelStatement')throw Error('V11 control flow is not fully structured');
  });
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'goofy-v11-syntax-'));
  try{
    const output=path.join(directory,'recovered.lua');fs.writeFileSync(output,code,'utf8');
    const runtime=new URL('../deobfuscator/deobf/bin/luau-ast'+(process.platform==='win32'?'.exe':''),import.meta.url);
    if(fs.existsSync(fileURLToPath(runtime))){
      const result=spawnSync(fileURLToPath(runtime),[output],{encoding:'utf8',stdio:['ignore','ignore','pipe'],timeout:15000,maxBuffer:1024*1024,windowsHide:true});
      if(result.status!==0)throw Error('V11 recovered source syntax invalid: '+(result.stderr||result.error?.message||'compiler unavailable').slice(0,600));
    } else if(process.env.GOOFY_SKIP_NATIVE_VALIDATION!=='1') throw Error('V11 native Luau syntax validator is unavailable');
    // Parse success alone does not prove the compiler's register/local limits
    // are satisfied. Compile the recovered text as DATA; never invoke it.
    let eq='=';while(code.includes(']'+eq+']'))eq+='=';
    const checker=path.join(directory,'compile-only.luau');
    fs.writeFileSync(checker,`local fn, diagnostic = loadstring([${eq}[${code}]${eq}], "recovered")\nif not fn then error(diagnostic, 0) end\nprint("COMPILE OK")\n`,'utf8');
    const interpreter=new URL('../deobfuscator/deobf/bin/luau'+(process.platform==='win32'?'.exe':''),import.meta.url);
    if(fs.existsSync(fileURLToPath(interpreter))){
      const compiled=spawnSync(fileURLToPath(interpreter),[checker],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024,windowsHide:true});
      if(compiled.status!==0)throw Error('V11 recovered source compile invalid: '+(compiled.stderr||compiled.error?.message||'compiler unavailable').slice(0,600));
    } else if(process.env.GOOFY_SKIP_NATIVE_VALIDATION!=='1') throw Error('V11 native Luau compile validator is unavailable');
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}

export function deobfuscateV11(source,{onProgress=()=>{}}={}){
  onProgress('discover');
  const analysis=analyzeV11(source),discovery=discoverExtraction(analysis);
  onProgress('extract');
  const capture=capturePrimary(source,{handoff:true,discovery});
  if(capture.data.normalizationError)throw Error('V11 instruction extraction failed: '+capture.data.normalizationError);
  if(!capture.data.normalized?.programs)throw Error('V11 prototype graph was not recovered');
  const programs=Object.values(capture.data.normalized.programs);
  for(const program of programs)for(const instruction of Object.values(program.instructions)){
    if(instruction.decoy==='undispatched'||instruction.decoy==='undispatched_inline_child')
      throw Error(`V11 unresolved instruction dispatch at ${program.id}:${instruction.pc}`);
  }
  onProgress('lift '+programs.length+' prototypes');
  const ir=liftNormalized(capture.data.normalized,discovery);
  const allowedGlobals=[];walk(ir,n=>{if(['getglobal','setglobal'].includes(n.op)&&n.key?.kind==='literal'&&typeof n.key.value==='string')allowedGlobals.push(n.key.value);});
  onProgress('recover strings');
  const folded=foldDecoderCalls(ir);
  if(folded.errors?.length)throw Error('V11 string recovery incomplete: '+folded.errors[0]);
  onProgress('optimize');
  const optimized=optimizeV11(ir);
  onProgress('emit');
  const emitted=emitSourceLua(optimized.bundle,{watermark:'-- deobfuscated by kfc'});
  validateStartupCalls(emitted);
  validateGeneratedBindings(emitted,{allowedGlobals});
  const readable=improveReadability(emitted);
  const code='-- deobfuscated by kfc\n\n'+polishReadable(readable.code,{rename:false}).replace(/^-- deobfuscated by kfc\s*/, '');
  onProgress('validate');validateGeneratedBindings(code,{allowedGlobals});const startupValidation=validateStartupCalls(code);validateRecoveredSource(code);
  return {code,summary:{ok:true,clean:true,artifact_only:false,backend:'goofyscator-v11',
    status:'Goofyscator V11 deobfuscated (inferred local names)',prototype_count:programs.length,
    decoded_strings:folded.folded,syntax_checked:true,compile_checked:true,wrapperRecovery:optimized.stats.wrapperRecovery,startupValidation,readability:readable.stats,metrics:measureReadability(code)}};
}
