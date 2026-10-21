import {readableParser} from '../ad/lift/readable-parser.js';
import {bindSymbols} from './readability.mjs';

// Deliberately bounded: diagnose definite non-callable startup values, not
// arbitrary runtime errors in callbacks or intentionally failing pcall tests.
// Unknown calls, escapes and control flow weaken facts instead of guessing.
export function validateStartupCalls(source){
  const ast=readableParser.parse(source,{luaVersion:'5.3',ranges:true}),symbols=bindSymbols(ast),state=new Map();
  const unknown={kind:'unknown'},knownFunction={kind:'function'};let checkedCalls=0,stoppedAtControlFlow=false;
  const builtinNames=new Set(['setmetatable','rawget']);
  for(const r of symbols.references)if(r.write&&!r.binding)builtinNames.delete(r.node.name);
  const binding=n=>n?.type==='Identifier'?symbols.byNode.get(n):null;
  const escape=value=>{if(value?.kind==='table')value.escaped=true;};
  const forget=()=>state.clear();
  function value(n){
    if(!n)return {kind:'nil'};
    if(n.type==='Identifier')return state.get(binding(n))??(!binding(n)&&builtinNames.has(n.name)?{kind:'builtin',name:n.name}:unknown);
    if(n.type==='NilLiteral')return {kind:'nil'};
    if(['NumericLiteral','StringLiteral','BooleanLiteral'].includes(n.type))return {kind:'primitive',value:n.value};
    if(n.type==='FunctionDeclaration'){for(const v of state.values())escape(v);return knownFunction;}
    if(n.type==='TableConstructorExpression'){
      const table={kind:'table',fields:new Map(),meta:null,escaped:false};
      for(const f of n.fields){const key=f.type==='TableKeyString'?f.key.name:f.key?.value;const v=value(f.value);if(key!==undefined)table.fields.set(key,v);}
      return table;
    }
    if(n.type==='MemberExpression'||n.type==='IndexExpression'){
      const table=value(n.base),key=n.type==='MemberExpression'?n.identifier.name:n.index.value;
      return table.kind==='table'&&!table.escaped?(table.fields.get(key)??unknown):unknown;
    }
    if(n.type==='CallExpression'){
      const callee=value(n.base);
      // Lua chooses the callee value first, then evaluates arguments, then
      // resolves a table's callable metatable. Argument calls can repair it.
      const args=n.arguments.map(value);checkedCalls++;
      if(callee.kind==='primitive'||callee.kind==='nil'||callee.kind==='table'&&!callee.escaped&&!callee.meta){
        const label=n.base.type==='Identifier'?n.base.name:'expression';
        throw Error('Definite non-callable startup value: '+label);
      }
      if(callee.kind==='builtin'&&callee.name==='setmetatable'&&args[0]?.kind==='table'){
        const table=args[0],meta=args[1];table.meta=meta?.kind==='table'?meta:unknown;return table;
      }
      if(callee.kind==='builtin'&&callee.name==='rawget'&&args[0]?.kind==='table'&&!args[0].escaped&&args[1]?.kind==='primitive')return args[0].fields.get(args[1].value)??{kind:'nil'};
      args.forEach(escape);forget();return unknown;
    }
    return unknown;
  }
  for(const s of ast.body){
    if(['IfStatement','DoStatement','WhileStatement','RepeatStatement','ForNumericStatement','ForGenericStatement','ReturnStatement','BreakStatement'].includes(s.type)){stoppedAtControlFlow=true;break;}
    if(s.type==='FunctionDeclaration'){for(const v of state.values())escape(v);forget();const b=binding(s.identifier);if(b)state.set(b,knownFunction);continue;}
    if(s.type==='CallStatement'){value(s.expression);continue;}
    if(s.type==='LocalStatement'||s.type==='AssignmentStatement'){
      const values=s.init.map(value);
      s.variables.forEach((n,i)=>{
        const b=binding(n),v=values[i]??(s.init.length===0?{kind:'nil'}:unknown);
        if(b)state.set(b,v);
        else if(n.type==='MemberExpression'||n.type==='IndexExpression'){
          const table=value(n.base),key=n.type==='MemberExpression'?n.identifier.name:n.index.value;
          if(table.kind==='table'&&key!==undefined)table.fields.set(key,v);else forget();
        }
      });
    }
  }
  return {checkedCalls,stoppedAtControlFlow,scope:'straight-line-startup-only'};
}
