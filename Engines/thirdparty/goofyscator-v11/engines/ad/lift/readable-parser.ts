import {createRequire} from 'node:module';
const lua=createRequire(import.meta.url)('../../obf/node_modules/luaparse');

// Preserve offsets while letting the Lua AST passes handle Luau's continue.
// Lexing, rather than text replacement, keeps strings/comments unchanged.
export const readableParser={parse(source:string,options:any={}) {
  if(!/\bcontinue\b/.test(source))return lua.parse(source,options);
  lua.parse(source,{...options,wait:true});
  const positions=new Set<number>();
  while(true){const token=lua.lex();if(token.type===1)break;
    if(token.value==='continue'&&token.type===8)positions.add(token.range[0]);
  }
  let rewritten=source;
  for(const start of [...positions].sort((a,b)=>b-a))rewritten=rewritten.slice(0,start)+'break   '+rewritten.slice(start+8);
  const tree=lua.parse(rewritten,{...options,ranges:true});
  const pending:any[]=[tree];
  while(pending.length){const node=pending.pop();if(!node||typeof node!=='object')continue;
    if(node.type==='BreakStatement'&&positions.has(node.range[0])){node.type='ContinueStatement';node.range[1]=node.range[0]+8;}
    for(const [key,value] of Object.entries(node)){
      if(['range','loc','comments','globals'].includes(key))continue;
      if(Array.isArray(value))pending.push(...value);else if((value as any)?.type)pending.push(value);
    }
  }
  return tree;
}};
