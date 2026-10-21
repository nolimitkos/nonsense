import {readableParser} from '../ad/lift/readable-parser.js';
import {readUleb,extraBytes} from '../deobfuscator/upstream/goofy-review/goofyscator/src/decode/extra.js';
import {luaString} from '../deobfuscator/upstream/goofy-review/goofyscator/src/emit/lua.js';
function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const value of Object.values(node))if(value&&typeof value==='object')walk(value,visit);}

// Keep the key-dependent function, including wrong-key behavior. No key is
// guessed and no macro implementation is executed during source recovery.
export function discoverKeyedString(source,envField,bitField){
  if(!source.includes('.bxor')||!source.includes('0x3B9ACA07'))return null;
  const text='return '+source,fn=readableParser.parse(text,{luaVersion:'5.3',ranges:true}).body[0].arguments[0];
  const self=fn.parameters[0].name;
  const writerIndex=fn.body.findIndex(n=>n.type==='CallStatement'&&n.expression.arguments?.[3]?.type==='FunctionDeclaration');
  const startIndex=fn.body.findIndex(n=>n.type==='LocalStatement'&&n.init.length===1&&n.init[0].type==='MemberExpression'&&n.init[0].base.name===self&&n.init[0].identifier.name===envField);
  if(writerIndex<0||startIndex<0||writerIndex<=startIndex)return null;
  const envName=fn.body[startIndex].variables[0].name,metadataNames=new Set();
  for(const statement of fn.body.slice(0,startIndex))walk(statement,node=>{
    if(node.type==='AssignmentStatement'&&node.variables[0]?.type==='Identifier'&&node.init[0]?.type==='TableConstructorExpression'&&node.init[0].fields.length===4)metadataNames.add(node.variables[0].name);
  });
  if(metadataNames.size!==1)throw Error('V11 keyed-string metadata layout ambiguous');
  const metadata=[...metadataNames][0],returned=fn.body[writerIndex].expression.arguments[3];
  const start=fn.body[startIndex].range[1],end=fn.body[writerIndex].range[0];
  const replacements=[];
  for(const statement of [...fn.body.slice(startIndex+1,writerIndex),returned])walk(statement,node=>{
    if(node.type==='MemberExpression'&&node.base.type==='Identifier'&&node.base.name===self){
      if(node.identifier.name!==bitField)throw Error('V11 keyed-string references an unknown VM field');
      replacements.push({start:node.range[0],end:node.range[1]});
    }
  });
  function fragment(from,to){let result=text.slice(from,to);for(const r of replacements.filter(r=>r.start>=from&&r.end<=to).sort((a,b)=>b.start-a.start))result=result.slice(0,r.start-from)+self+result.slice(r.end-from);return result;}
  return {factory:`(function(${envName},${self},${metadata}) ${fragment(start,end).replace(/^\s*;/,'')} return ${fragment(...returned.range)} end)`};
}

export function keyedStringSource(configuration,extra){
  const values=[];let offset=0;
  for(let n=0;n<4;n++){const decoded=readUleb(extra,offset);if(decoded.value===null)throw Error('V11 truncated keyed-string metadata');values.push(decoded.value);offset=decoded.next;}
  const bytes=extraBytes(extra),length=values.pop();
  if(offset+length!==bytes.length)throw Error('V11 keyed-string payload length mismatch');
  const encrypted=bytes.subarray(offset).toString('latin1');
  return `${configuration.factory}((getfenv and getfenv()) or _ENV or _G,bit32,{${values.join(',')},${luaString(encrypted)}})`;
}
