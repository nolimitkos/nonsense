import fs from 'node:fs';
import path from 'node:path';
import {deobfuscateV11} from './deobfuscate.mjs';
import {analyzeV11} from './analyze.mjs';
import {capturePrimary} from './capture.mjs';
import {discoverLayout,annotateInstructions} from './layout.mjs';

try{
  const [input,output,...flags]=process.argv.slice(2);
  if(!input||!output||flags.some(flag=>flag!=='--full-analysis'))throw Error('Usage: cli.mjs input.lua analysis.json [--full-analysis]');
  const source=fs.readFileSync(input,'latin1');
  let recoveryError,phase='discover';
  try{
    const recovered=deobfuscateV11(source,{onProgress:value=>{phase=value;if(process.env.GV11_PROGRESS==='1')console.error(new Date().toISOString()+' '+phase);}});
    fs.writeFileSync(path.join(path.dirname(output),'deobfuscated.lua'),recovered.code,'utf8');
    fs.writeFileSync(output,JSON.stringify({format:'goofyscator-v11-recovery-summary',protectedSourceRecovered:true,...recovered.summary},null,2)+'\n');
    console.log(JSON.stringify(recovered.summary));
    process.exit(0);
  }catch(error){recoveryError=String(error.message).slice(0,2000);}
  const analysis=analyzeV11(source);
  if(!flags.includes('--full-analysis')){
    const report={format:'goofyscator-v11-partial-analysis',version:'V11 BETA-1',complete:false,
      protectedSourceRecovered:false,inputBytes:Buffer.byteLength(source,'latin1'),phase,recoveryError,
      note:'Recovery failed. This is a diagnostic report, not deobfuscated Lua. Full VM diagnostics are omitted by default.'};
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({ok:true,clean:false,artifact_only:true,backend:'goofyscator-v11-analysis',
      status:'Goofyscator V11 incomplete recovery; attached recovery report is not recovered Lua. '+recoveryError.slice(0,250)}));
    process.exit(0);
  }
  const capture=capturePrimary(source,{secondary:true});
  const report={format:'goofyscator-v11-partial-analysis',version:'V11 BETA-1',complete:false,
    protectedSourceRecovered:false,recoveryError,root:'validator',instructionCount:capture.data.instructionCount,
    bridge:capture.bridge,dispatch:[...analysis.mapping.map].map(([id,handler])=>({id,handler})),
    instructions:capture.data.instructions};
  try{
    const layout=discoverLayout(analysis);
    report.layout=layout;
    report.disassembly=annotateInstructions(capture.data.instructions,layout);
  }catch(error){report.layoutError=error.message;}
  try{
    const handoff=capturePrimary(source,{handoff:true});
    report.payloadHandoff={...handoff.data,protectedSourceRecovered:false,
      note:'First VM frame entered through a validator callback. It may be another loader, not the user program.'};
    if(report.layout)report.payloadHandoff.disassembly=annotateInstructions(handoff.data.instructions,report.layout);
  }catch(error){report.payloadHandoffError=error.message;}
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:true,clean:false,artifact_only:true,backend:'goofyscator-v11-analysis',
    status:'Goofyscator V11 incomplete recovery; attached analysis is not recovered Lua. '+recoveryError.slice(0,250),
    instruction_count:report.instructionCount}));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;
}
