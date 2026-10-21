import {readableParser} from '../ad/lift/readable-parser.js';
import {apiMember} from '../ad/lift/api-metadata.js';
import {createRequire} from 'node:module';
import {analyzeLiveness} from './liveness.mjs';
const lexer=createRequire(import.meta.url)('../obf/node_modules/luaparse');

const reserved=new Set('and break continue do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' '));
const valid=name=>typeof name==='string'&&/^[A-Za-z_]\w*$/.test(name)&&!reserved.has(name);
const synthetic=name=>/^(?:v\d+(?:_\d+)*|c\d+|p\d+(?:_\d+)*|_o\d+|result\d*|value_\d+)$/.test(name);
const primitive=n=>n&&['StringLiteral','NumericLiteral','BooleanLiteral','NilLiteral'].includes(n.type);
const field=n=>n?.type==='MemberExpression'?n.identifier.name:n?.type==='IndexExpression'&&n.index?.type==='StringLiteral'?n.index.value:null;
const children=n=>Object.entries(n??{}).flatMap(([k,v])=>['range','loc','comments','globals'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);
function walk(n,visit){if(!n)return;visit(n);for(const c of children(n))walk(c,visit);}
function parse(source){
  const tree=readableParser.parse(source,{ranges:true,luaVersion:'5.3',encodingMode:'x-user-defined'});
  // The bundled parser has legacy postfix ranges: index nodes can omit their
  // closing bracket and call bases can include the entire argument list.
  // Normalize using matched lexer tokens before any source-range edit.
  lexer.parse(source,{wait:true,luaVersion:'5.3'});
  const tokens=[],stack=[],pairs=new Map();
  for(;;){const t=lexer.lex();if(t.type===1)break;tokens.push(t);if(t.type!==32)continue;
    if(['[','(','{'].includes(t.value))stack.push(t);
    else if([']',')','}'].includes(t.value)){const open=stack.pop();if(open)pairs.set(open.range[0],t.range[1]);}
  }
  function firstAt(pos){let lo=0,hi=tokens.length;while(lo<hi){const mid=(lo+hi)>>1;if(tokens[mid].range[0]<pos)lo=mid+1;else hi=mid;}return lo;}
  function fix(n){
    if(n.range)n.range=[...n.range];
    for(const c of children(n))fix(c);
    if(n.type==='Identifier')n.range[1]=n.range[0]+n.name.length;
    else if(n.type==='MemberExpression')n.range[1]=n.identifier.range[1];
    else if(n.type==='IndexExpression'){
      let i=firstAt(n.base.range[1]);while(i<tokens.length&&tokens[i].value!== '['&&tokens[i].range[0]<=n.range[1])i++;
      const end=pairs.get(tokens[i]?.range[0]);if(end)n.range[1]=end;
    }else if(['BinaryExpression','LogicalExpression'].includes(n.type))n.range[1]=Math.max(n.range[1],n.right.range[1]);
    else if(n.type==='UnaryExpression')n.range[1]=Math.max(n.range[1],n.argument.range[1]);
  }
  fix(tree);return tree;
}

// Bind identifiers by lexical declaration, never by spelling. In particular,
// local RHSs see the old scope, local functions see themselves, repeat's
// condition sees its body locals, and property keys are not variable reads.
export function bindSymbols(tree){
  const bindings=[],byNode=new WeakMap(),references=[],blocks=[],allNames=new Set();
  let functionId=0;
  function bind(node,scope,statement,body,fn,init){
    allNames.add(node.name);
    const b={name:node.name,node,statement,body,fn,init,refs:[]};
    scope.set(node.name,b);bindings.push(b);byNode.set(node,b);return b;
  }
  function reference(node,scope,parent,key,write,fn){
    allNames.add(node.name);
    const b=scope.get(node.name),ref={node,parent,key,write,fn,binding:b};
    references.push(ref);byNode.set(node,b);if(b)b.refs.push(ref);
  }
  function expression(n,scope,fn,parent=null,key=null,write=false){
    if(!n)return;
    if(n.type==='Identifier'){reference(n,scope,parent,key,write,fn);return;}
    if(n.type==='FunctionDeclaration'){functionBody(n,scope,fn);return;}
    if(n.type==='MemberExpression'){expression(n.base,scope,fn,n,'base');return;}
    if(n.type==='IndexExpression'){expression(n.base,scope,fn,n,'base');expression(n.index,scope,fn,n,'index');return;}
    if(n.type==='TableConstructorExpression'){
      for(const f of n.fields){if(f.type==='TableKey')expression(f.key,scope,fn,f,'key');expression(f.value,scope,fn,f,'value');}return;
    }
    for(const [k,v] of Object.entries(n)){
      if(['range','loc','comments','globals'].includes(k))continue;
      if(Array.isArray(v)){for(const c of v)if(c?.type)expression(c,scope,fn,n,k);}
      else if(v?.type)expression(v,scope,fn,n,k);
    }
  }
  function functionBody(n,outer){
    const scope=new Map(outer),fn=++functionId;
    for(const p of n.parameters??[])if(p.type==='Identifier')bind(p,scope,n,n.body,fn,null);
    if(n.identifier?.type==='MemberExpression'&&n.identifier.indexer===':')bind({type:'Identifier',name:'self',range:[n.range[0],n.range[0]]},scope,n,n.body,fn,null);
    block(n.body,scope,fn);
  }
  function block(body,scope,fn){
    blocks.push({body,fn});
    for(const s of body??[]){
      if(s.type==='LocalStatement'){
        for(const v of s.init)expression(v,scope,fn,s,'init');
        s.variables.forEach((n,i)=>bind(n,scope,s,body,fn,s.init[i]));
      }else if(s.type==='AssignmentStatement'){
        for(const v of s.variables)expression(v,scope,fn,s,'variables',v.type==='Identifier');
        for(const v of s.init)expression(v,scope,fn,s,'init');
      }else if(s.type==='FunctionDeclaration'){
        if(s.isLocal&&s.identifier?.type==='Identifier')bind(s.identifier,scope,s,body,fn,s);
        else expression(s.identifier,scope,fn,s,'identifier',s.identifier?.type==='Identifier');
        functionBody(s,scope);
      }else if(s.type==='IfStatement'){
        for(const c of s.clauses){expression(c.condition,scope,fn,c,'condition');block(c.body,new Map(scope),fn);}
      }else if(s.type==='WhileStatement'){
        expression(s.condition,scope,fn,s,'condition');block(s.body,new Map(scope),fn);
      }else if(s.type==='RepeatStatement'){
        const inner=new Map(scope);block(s.body,inner,fn);expression(s.condition,inner,fn,s,'condition');
      }else if(s.type==='DoStatement')block(s.body,new Map(scope),fn);
      else if(s.type==='ForNumericStatement'){
        for(const key of ['start','end','step'])expression(s[key],scope,fn,s,key);
        const inner=new Map(scope);bind(s.variable,inner,s,s.body,fn,null);block(s.body,inner,fn);
      }else if(s.type==='ForGenericStatement'){
        for(const v of s.iterators)expression(v,scope,fn,s,'iterators');
        const inner=new Map(scope);for(const v of s.variables)bind(v,inner,s,s.body,fn,null);block(s.body,inner,fn);
      }else expression(s,scope,fn);
    }
  }
  block(tree.body,new Map(),0);
  return {bindings,byNode,references,blocks,allNames};
}

function apply(source,edits){
  let end=source.length,out='';
  for(const e of edits.sort((a,b)=>b.start-a.start||b.end-a.end)){
    if(e.end>end)continue;
    out=e.text+source.slice(e.end,end)+out;end=e.start;
  }
  return source.slice(0,end)+out;
}
const edit=(node,text)=>({start:node.range[0],end:node.range[1],text});
function commit(edits,group){
  if(group.some(a=>edits.some(b=>a.start<b.end&&b.start<a.end)))return false;
  edits.push(...group);return true;
}
function pure(n,symbols){
  if(!n||primitive(n)||n.type==='FunctionDeclaration')return true;
  if(n.type==='Identifier')return Boolean(symbols.byNode.get(n));
  if(n.type==='TableConstructorExpression')return n.fields.every(f=>(f.type!=='TableKey'||pure(f.key,symbols))&&pure(f.value,symbols));
  // Unary arithmetic/comparisons can invoke user metamethods. Global and
  // property reads can invoke environment/index metamethods as well.
  if(n.type==='UnaryExpression'&&n.operator==='not')return pure(n.argument,symbols);
  return false;
}
function statementOf(body,node){return body.findIndex(s=>s.range[0]<=node.range[0]&&s.range[1]>=node.range[1]);}
function stableArgument(n,symbols){
  if(primitive(n)||n?.type==='FunctionDeclaration')return true;
  if(n?.type==='Identifier'){const b=symbols.byNode.get(n);return Boolean(b&&!b.refs.some(r=>r.write));}
  if(n?.type==='TableConstructorExpression')return n.fields.every(f=>(f.type!=='TableKey'||stableArgument(f.key,symbols))&&stableArgument(f.value,symbols));
  return false;
}

function localLifetimes(source,tree,symbols,stats){
  const edits=[];
  const localCounts=new Map();for(const b of symbols.bindings)localCounts.set(b.fn,(localCounts.get(b.fn)??0)+1);
  for(const b of symbols.bindings){
    if(!synthetic(b.name)||b.statement?.type!=='LocalStatement')continue;
    for(const ref of b.refs.filter(r=>r.write)){
      const s=ref.parent;
      if(s?.type!=='AssignmentStatement'||s.variables.length!==1||s.init.length!==1||!b.body.includes(s)||ref.fn!==b.fn)continue;
      // A closure created before this write observes the old binding's future
      // assignments. Never split it. Closures created later capture the new
      // lexical generation, matching the original execution order.
      if(b.refs.some(r=>r.fn!==b.fn&&r.node.range[0]<s.range[0]))continue;
      // Leave headroom below Luau's 200-register limit for expression/call
      // temporaries. Prefer reusing a register over emitting uncompilable Lua.
      if(localCounts.get(b.fn)>=150)continue;
      edits.push({start:s.range[0],end:s.range[0],text:'local '});localCounts.set(b.fn,localCounts.get(b.fn)+1);stats.lifetimes++;
    }
  }
  for(const {body,fn} of symbols.blocks)for(const s of body){
    if(s.type==='FunctionDeclaration'&&!s.isLocal&&s.identifier?.type==='Identifier'){
      const b=symbols.byNode.get(s.identifier);
      if(b&&synthetic(b.name)&&b.fn===fn&&b.body===body&&!b.refs.some(r=>r.fn!==fn&&r.node.range[0]<s.range[0])&&localCounts.get(fn)<150){
        edits.push({start:s.range[0],end:s.range[0],text:'local '});localCounts.set(fn,localCounts.get(fn)+1);stats.lifetimes++;
      }
    }
    if(s.type!=='AssignmentStatement'||s.variables.length<2||s.variables.some(n=>n.type!=='Identifier'))continue;
    const bindings=s.variables.map(n=>symbols.byNode.get(n));
    if(bindings.some(b=>!b||!synthetic(b.name)||b.fn!==fn||b.body!==body||b.refs.some(r=>r.fn!==fn&&r.node.range[0]<s.range[0])))continue;
    if(new Set(bindings).size!==bindings.length||localCounts.get(fn)+bindings.length>=150)continue;
    // Lua evaluates every RHS in the old scope before introducing the fresh
    // result bindings, preserving pcall's status and nil-containing tuples.
    edits.push({start:s.range[0],end:s.range[0],text:'local '});localCounts.set(fn,localCounts.get(fn)+bindings.length);stats.lifetimes+=bindings.length;
  }
  return apply(source,edits);
}

function simplify(source,tree,symbols,stats){
  const edits=[];
  const truth=n=>primitive(n)?n.type!=='NilLiteral'&&!(n.type==='BooleanLiteral'&&!n.value):n?.type==='UnaryExpression'&&n.operator==='not'&&truth(n.argument)!==undefined?!truth(n.argument):undefined;
  for(const {body} of symbols.blocks){
    const terminal=body.findIndex(s=>s.type==='ReturnStatement'||s.type==='BreakStatement'||s.type==='ContinueStatement');
    if(terminal>=0&&terminal+1<body.length){commit(edits,[{start:body[terminal+1].range[0],end:body.at(-1).range[1],text:''}]);stats.unreachable+=body.length-terminal-1;}
  }
  walk(tree,n=>{
    if(n.type==='IfStatement'&&n.clauses.length===1&&!n.clauses[0].body.length&&['CallExpression','StringCallExpression','TableCallExpression'].includes(n.clauses[0].condition?.type)){
      if(commit(edits,[edit(n,source.slice(...n.clauses[0].condition.range)+';')]))stats.dead++;
    }
    if(n.type==='DoStatement'&&!n.body.some(s=>s.type==='LocalStatement'||s.type==='FunctionDeclaration'&&s.isLocal)){
      if(commit(edits,[edit(n,n.body.map(s=>source.slice(...s.range)).join('\n'))]))stats.scopesRemoved++;
    }
    if(n.type==='IfStatement'&&n.clauses.some(c=>c.condition&&truth(c.condition)!==undefined)){
      const kept=[];
      for(const clause of n.clauses){
        const value=clause.condition?truth(clause.condition):true;
        if(value===false)continue;
        const body=clause.body.map(s=>source.slice(...s.range)).join('\n');
        if(value===true){kept.push({body});break;}
        kept.push({condition:source.slice(...clause.condition.range),body});
      }
      const replacement=!kept.length?'':!kept[0].condition?'do\n'+kept[0].body+'\nend':kept.map((c,i)=>c.condition?(i?'elseif ':'if ')+c.condition+' then\n'+c.body:'else\n'+c.body).join('\n')+'\nend';
      if(commit(edits,[edit(n,replacement)]))stats.booleans++;
    }
    if(n.type==='UnaryExpression'&&n.operator==='not'&&n.argument?.type==='BinaryExpression'&&['==','~='].includes(n.argument.operator)){
      const a=n.argument;commit(edits,[edit(n,`(${source.slice(...a.left.range)} ${a.operator==='=='?'~=':'=='} ${source.slice(...a.right.range)})`)]);stats.booleans++;
    }
    if(n.type==='IfStatement'&&n.clauses.every(c=>!c.body.length&&(!c.condition||pure(c.condition,symbols)))){commit(edits,[edit(n,'')]);stats.dead++;}
  });
  const nameCounts=new Map();for(const b of symbols.bindings)nameCounts.set(b.name,(nameCounts.get(b.name)??0)+1);
  for(const b of symbols.bindings){
    const s=b.statement;
    // Parameters also point at their owning FunctionDeclaration. An unused
    // parameter is not evidence that the function itself is unused.
    if(s?.type==='FunctionDeclaration'&&s.isLocal&&s.identifier===b.node&&synthetic(b.name)&&!b.refs.length){commit(edits,[edit(s,'')]);stats.dead++;continue;}
    if(s?.type!=='LocalStatement'||s.variables.length!==1||s.init.length!==1||!synthetic(b.name)||b.refs.some(r=>r.write))continue;
    const reads=b.refs.filter(r=>!r.write);
    if(!reads.length&&pure(b.init,symbols)){commit(edits,[edit(s,'')]);stats.dead++;continue;}
    if(!reads.length&&['CallExpression','StringCallExpression','TableCallExpression'].includes(b.init.type)){
      // Dropping the dead destination must not drop the call itself.
      commit(edits,[edit(s,source.slice(...b.init.range))]);stats.dead++;continue;
    }
    if(primitive(b.init)&&!(b.init.type==='StringLiteral'&&String(b.init.value??b.init.raw).length>160)){
      commit(edits,[...reads.map(r=>edit(r.node,`(${source.slice(...b.init.range)})`)),edit(s,'')]);stats.constants++;continue;
    }
    if(b.init.type==='Identifier'){
      const target=symbols.byNode.get(b.init);
      if(target&&!target.refs.some(r=>r.write)&&nameCounts.get(target.name)===1){
        commit(edits,[...reads.map(r=>edit(r.node,target.name)),edit(s,'')]);stats.aliases++;continue;
      }
    }
  }
  return apply(source,edits);
}

function identityWrappers(source,tree,symbols,stats){
  const edits=[];
  for(const b of symbols.bindings){
    const f=b.init;
    if(f?.type!=='FunctionDeclaration'||f.parameters.length!==1||f.parameters[0].type!=='Identifier'||f.body.length!==1||f.body[0].type!=='ReturnStatement'||f.body[0].arguments.length!==1)continue;
    const arg=f.body[0].arguments[0];
    if(arg.type!=='Identifier'||symbols.byNode.get(arg)!==symbols.byNode.get(f.parameters[0]))continue;
    if(b.refs.some(r=>r.write||r.parent?.type!=='CallExpression'||r.key!=='base'))continue;
    for(const ref of b.refs){const call=ref.parent;if(call.arguments.length!==1)continue;
      commit(edits,[edit(call,`(${source.slice(...call.arguments[0].range)})`)]);stats.wrappers++;
    }
  }
  return apply(source,edits);
}

function deadStores(source,tree,symbols,stats){
  const edits=[],liveness=analyzeLiveness(symbols);
  for(const {body} of symbols.blocks)for(const s of body){
    if(s.type==='LocalStatement'&&!s.init.length){
      const keep=s.variables.filter(n=>symbols.byNode.get(n)?.refs.length);
      if(keep.length!==s.variables.length){commit(edits,[edit(s,keep.length?'local '+keep.map(n=>n.name).join(', '):'')]);stats.deadStores+=s.variables.length-keep.length;}
      continue;
    }
    if(!['AssignmentStatement','LocalStatement'].includes(s.type)||s.variables.length!==s.init.length||s.init.some(n=>!pure(n,symbols)))continue;
    if(s.variables.some(n=>n.type!=='Identifier'||!symbols.byNode.get(n)))continue;
    const node=liveness.statements.get(s);if(!node)continue;
    const keep=[],declare=[];
    for(let j=0;j<s.variables.length;j++){
      const b=symbols.byNode.get(s.variables[j]);
      if(liveness.captured.has(b)||node.out.has(b))keep.push(j);
      else if(s.type==='LocalStatement'&&b.refs.length)declare.push(b.name);
    }
    if(keep.length===s.variables.length)continue;
    // Empty declarations follow retained initializers. Putting them first can
    // incorrectly shadow the OLD outer binding read by a simultaneous RHS.
    const declarations=declare.length?'local '+declare.join(', ')+';':'';
    const replacement=keep.length?(s.type==='LocalStatement'?'local ':'')+keep.map(j=>s.variables[j].name).join(', ')+' = '+keep.map(j=>source.slice(...s.init[j].range)).join(', '):'';
    if(commit(edits,[edit(s,replacement+(replacement?'; ':'')+declarations)]))stats.deadStores+=s.variables.length-keep.length;
  }
  return apply(source,edits);
}

function lexicalRegions(source,tree,symbols,stats){
  const edits=[];
  for(const {body,fn} of symbols.blocks){
    const direct=symbols.bindings.filter(b=>b.body===body&&b.fn===fn);
    const start=body[0]?.range[0];
    const ancestors=Number.isFinite(start)?symbols.bindings.filter(b=>b.fn===fn&&b.body!==body&&b.node.range[0]<start&&b.body?.length&&b.body[0].range[0]<=start&&b.body.at(-1).range[1]>=body.at(-1).range[1]).length:0;
    // Nested blocks share the function's register budget with live outer
    // lexical locals. A flat 140-per-block cap can still exceed 200 in total.
    const budget=Math.max(12,140-ancestors);
    let remaining=direct.length;
    if(remaining<budget)continue;
    const occupied=new Set();
    for(let i=0;i<body.length;i++){
      if(remaining<budget)break;
      if(occupied.has(i))continue;
      const s=body[i],declared=direct.filter(b=>b.statement===s);
      if(!declared.length||!['LocalStatement','FunctionDeclaration'].includes(s.type))continue;
      let end=i;
      for(const b of declared)for(const r of b.refs){const j=statementOf(body,r.node);if(j<0){end=body.length;break;}end=Math.max(end,j);}
      // Small, contiguous non-escaping declaration islands are enough to release
      // temporary/export-helper registers. Do not move or hoist declarations.
      if(end>i+32||end>=body.length-1)continue;
      const from=s.range[0],to=body[end].range[1];
      const escaping=direct.some(b=>b.node.range[0]>=from&&b.node.range[0]<to&&b.refs.some(r=>r.node.range[0]<from||r.node.range[1]>to));
      if(escaping)continue;
      const region=source.slice(from,to);
      if(commit(edits,[{start:from,end:to,text:'do\n'+region+'\nend'}])){for(let j=i;j<=end;j++)occupied.add(j);remaining-=direct.filter(b=>b.node.range[0]>=from&&b.node.range[0]<to).length;stats.scopes++;}
    }
  }
  return apply(source,edits);
}

// A single-use local may be deferred into the next statement only when no
// observable evaluation in that statement precedes its use. This preserves
// callee lookup order, metamethods, nil-containing tuples and closure timing.
function inlineTemporaries(source,tree,symbols,stats){
  const edits=[];
  function prefixSafe(root,target){
    if(root===target)return {found:true,safe:true};
    if(!root)return {found:false,safe:true};
    if(root.type==='FunctionDeclaration')return {found:false,safe:false};
    if(root.type==='MemberExpression'||root.type==='IndexExpression'){
      const a=prefixSafe(root.base,target);if(a.found||!a.safe)return a;
      if(root.type==='IndexExpression'){const b=prefixSafe(root.index,target);if(b.found||!b.safe)return b;}
      return {found:false,safe:false};
    }
    if(root.type==='Identifier')return {found:false,safe:Boolean(symbols.byNode.get(root))};
    if(primitive(root))return {found:false,safe:true};
    for(const c of children(root)){
      const a=prefixSafe(c,target);if(a.found||!a.safe)return a;
    }
    return {found:false,safe:!['CallExpression','StringCallExpression','TableCallExpression','BinaryExpression','UnaryExpression'].includes(root.type)};
  }
  for(const b of symbols.bindings){
    const s=b.statement,reads=b.refs.filter(r=>!r.write);
    if(!synthetic(b.name)||s?.type!=='LocalStatement'||s.variables.length!==1||s.init.length!==1||b.refs.some(r=>r.write)||reads.length!==1)continue;
    const ref=reads[0],i=b.body.indexOf(s),next=b.body[i+1];
    if(!next||ref.fn!==b.fn||statementOf([next],ref.node)!==0)continue;
    let roots;
    if(['AssignmentStatement','LocalStatement'].includes(next.type)){
      const stable=n=>n?.type==='Identifier'&&symbols.byNode.get(n)&&!symbols.byNode.get(n).refs.some(r=>r.write);
      const safeTarget=n=>n.type==='Identifier'||n.type==='MemberExpression'&&stable(n.base)||n.type==='IndexExpression'&&stable(n.base)&&(primitive(n.index)||stable(n.index));
      if(next.variables.some(v=>!safeTarget(v)))continue;roots=[...next.variables,...next.init];
    }else if(next.type==='CallStatement')roots=[next.expression];
    else if(next.type==='ReturnStatement')roots=next.arguments;
    else if(next.type==='IfStatement')roots=[next.clauses[0]?.condition];
    else continue;
    let okay=false;
    for(const root of roots){const p=prefixSafe(root,ref.node);if(p.found){okay=p.safe;break;}if(!p.safe)break;}
    if(!okay)continue;
    // Logical RHSs are conditional: moving an eager initializer there would
    // change whether it executes, even if its textual prefix is pure.
    let conditional=false;walk(next,n=>{if(n.type==='LogicalExpression'&&n.right.range[0]<=ref.node.range[0]&&n.right.range[1]>=ref.node.range[1])conditional=true;});
    if(conditional)continue;
    const replacement=source.slice(...b.init.range),prefixUse=['CallExpression','MemberExpression','IndexExpression'].includes(ref.parent?.type)&&ref.key==='base';
    const prefix=prefixUse&&['Identifier','MemberExpression','IndexExpression','CallExpression'].includes(b.init.type);
    // A parenthesized assignment/call at statement start can otherwise attach
    // to the preceding call across a newline. Keep a lexical separator; the
    // final AST printer removes unnecessary semicolons.
    if(commit(edits,[edit(ref.node,prefix?replacement:`(${replacement})`),edit(s,';')]))stats.temporaries++;
  }
  return apply(source,edits);
}

// Propagate one straight-line register generation, not every use of a spelling.
// Stop at control flow and count RHS reads before the destination is killed.
function reachingSnapshots(source,tree,symbols,stats){
  const edits=[];
  const slice=n=>source.slice(...n.range);
  const isDef=s=>['LocalStatement','AssignmentStatement'].includes(s?.type)&&s.variables.length===1&&s.variables[0].type==='Identifier'&&s.init.length===1;
  function prefix(root,target){
    if(root===target)return {found:true,safe:true};if(!root)return {found:false,safe:true};
    if(root.type==='FunctionDeclaration')return {found:false,safe:false};
    if(root.type==='Identifier')return {found:false,safe:stableArgument(root,symbols)};
    if(primitive(root))return {found:false,safe:true};
    for(const child of children(root)){const p=prefix(child,target);if(p.found||!p.safe)return p;}
    return {found:false,safe:false};
  }
  for(const {body,fn} of symbols.blocks)for(let i=0;i<body.length;i++){
    const def=body[i];if(!isDef(def))continue;
    const b=symbols.byNode.get(def.variables[0]),init=def.init[0];
    if(!b||b.fn!==fn||!synthetic(b.name)||b.refs.some(r=>r.fn!==fn)||init.type==='FunctionDeclaration')continue;
    const dependencies=new Set();walk(init,n=>{if(n.type==='Identifier')dependencies.add(n.name);});
    let target=null,consumer=null,j=i+1;
    for(;j<body.length;j++){
      const s=body[j];
      if(!['LocalStatement','AssignmentStatement','CallStatement','ReturnStatement'].includes(s.type))break;
      const reads=b.refs.filter(r=>!r.write&&r.node.range[0]>=s.range[0]&&r.node.range[1]<=s.range[1]);
      const writes=b.refs.some(r=>r.write&&r.node.range[0]>=s.range[0]&&r.node.range[1]<=s.range[1]);
      if(reads.length){if(reads.length!==1)break;target=reads[0];consumer=s;break;}
      if(writes)break;
      // Cross only literal/empty local declarations, not table allocations,
      // lookups, calls, or unrelated mutable assignments.
      if(s.type!=='LocalStatement'||s.init.some(n=>!primitive(n))||s.variables.some(n=>dependencies.has(n.name)))break;
    }
    if(!target||target.fn!==fn)continue;
    const roots=consumer.type==='CallStatement'?[consumer.expression]:consumer.type==='ReturnStatement'?consumer.arguments:consumer.init;
    if(consumer.variables?.some(n=>n.type!=='Identifier'))continue;
    let safe=false;for(const root of roots){const p=prefix(root,target.node);if(p.found){safe=p.safe;break;}if(!p.safe)break;}
    if(!safe&&!stableArgument(init,symbols))continue;
    let conditional=false;walk(consumer,n=>{if(n.type==='LogicalExpression'&&n.right.range[0]<=target.node.range[0]&&n.right.range[1]>=target.node.range[1])conditional=true;});if(conditional)continue;
    const killed=consumer.variables?.some(n=>symbols.byNode.get(n)===b);
    let retained=false;
    if(!killed){
      const later=b.refs.filter(r=>r.node.range[0]>=consumer.range[1]);
      if(later.some(r=>!r.write))retained=true;
    }
    // Pure constants may be copied at their proven use even if another path
    // still needs the old destination. Effectful initializers must move once.
    if(retained&&!primitive(init))continue;
    const prefixUse=['CallExpression','MemberExpression','IndexExpression'].includes(target.parent?.type)&&target.key==='base';
    const value=init.type==='Identifier'||prefixUse&&['MemberExpression','IndexExpression','CallExpression'].includes(init.type)?slice(init):'('+slice(init)+')';
    const group=[edit(target.node,value)];
    if(!retained){const later=b.refs.some(r=>r.node.range[0]>=consumer.range[0]&&r.node!==target.node);group.push(edit(def,def.type==='LocalStatement'&&later?'local '+b.name+';':';'));}
    if(commit(edits,group))stats.reachingAliases++;
  }
  return apply(source,edits);
}

function engineMethods(source,tree,symbols,stats){
  const edits=[],unstable=new Set();let customEnvironment=false;
  for(const ref of symbols.references)if(!ref.binding&&ref.write)unstable.add(ref.node.name);
  walk(tree,n=>{
    if(n.type==='Identifier'&&!symbols.byNode.get(n)&&['getfenv','setfenv','rawset'].includes(n.name))customEnvironment=true;
    if(n.type==='AssignmentStatement'&&n.variables.some(v=>v.type==='IndexExpression'&&v.base?.name==='_ENV'||v.type==='MemberExpression'&&['_ENV','_G'].includes(v.base?.name)))customEnvironment=true;
    if(n.type==='AssignmentStatement'&&n.variables.some(v=>['game','workspace'].includes(field(v))&&v.base?.type==='CallExpression'&&['getgenv','getrenv','getfenv'].includes(v.base.base?.name)))customEnvironment=true;
  });
  if(customEnvironment)return source;
  walk(tree,n=>{
    const callee=n.type==='CallExpression'?n.base:null,base=callee?.base,arg=n.arguments?.[0];
    if(callee?.type!=='MemberExpression'||callee.indexer!=='.'||base.type!=='Identifier'||arg?.type!=='Identifier'||base.name!==arg.name||symbols.byNode.get(base)||symbols.byNode.get(arg)||unstable.has(base.name))return;
    const type=base.name==='game'?'DataModel':base.name==='workspace'?'Workspace':null;
    if(!type||apiMember(type,callee.identifier.name)?.kind!=='Function'||n.arguments.slice(1).some(a=>!stableArgument(a,symbols)))return;
    if(source.slice(callee.identifier.range[1],arg.range[0]).trim()!=='(')return;
    const comma=n.arguments[1]?source.slice(arg.range[1],n.arguments[1].range[0]).match(/^\s*,/):null;if(n.arguments[1]&&!comma)return;
    if(commit(edits,[{start:callee.range[0],end:callee.identifier.range[1],text:base.name+':'+callee.identifier.name},{start:arg.range[0],end:arg.range[1]+(comma?.[0].length??0),text:''}]))stats.methods++;
  });
  return apply(source,edits);
}

function repeatConditions(source,tree,symbols,stats){
  const edits=[];
  walk(tree,loop=>{
    if(loop.type!=='RepeatStatement'||loop.condition.type!=='Identifier'||loop.body.length<2)return;
    const b=symbols.byNode.get(loop.condition),guard=loop.body.at(-1),seed=loop.body.at(-2);
    if(!b||b.refs.some(r=>r.fn!==b.fn)||guard.type!=='IfStatement'||guard.clauses.length!==1||guard.clauses[0].condition?.type!=='Identifier'||symbols.byNode.get(guard.clauses[0].condition)!==b)return;
    if(!['AssignmentStatement','LocalStatement'].includes(seed.type)||seed.variables.length!==1||seed.init.length!==1||symbols.byNode.get(seed.variables[0])!==b)return;
    const branch=guard.clauses[0].body,assignment=branch[0];
    if(branch.length!==1||assignment.type!=='AssignmentStatement'||assignment.variables.length!==1||assignment.init.length!==1||symbols.byNode.get(assignment.variables[0])!==b)return;
    const allowed=new Set([loop.condition,guard.clauses[0].condition,seed.variables[0],assignment.variables[0]]);
    // Removing the register's writes is valid only if nothing observes that
    // generation: not a closure, a later statement, or the next iteration.
    if(b.refs.some(r=>!allowed.has(r.node)))return;
    let dependent=false;for(const init of [seed.init[0],assignment.init[0]])walk(init,n=>{if(n.type==='Identifier'&&symbols.byNode.get(n)===b)dependent=true;});if(dependent)return;
    if(commit(edits,[edit(seed,';'),edit(guard,';'),edit(loop.condition,'('+source.slice(...seed.init[0].range)+' and '+source.slice(...assignment.init[0].range)+')')]))stats.repeatConditions++;
  });
  return apply(source,edits);
}

function methodsAndTables(source,tree,symbols,stats){
  const edits=[];
  walk(tree,n=>{
    if(n.type==='CallExpression'&&n.base?.type==='MemberExpression'&&n.base.indexer==='.'&&n.arguments.length){
      if(n.arguments.slice(1).some(a=>!stableArgument(a,symbols)))return;
      const receiver=n.base.base,arg=n.arguments[0];
      // A lexical local read is stable and non-effectful. Repeated global,
      // property or call receivers are deliberately not assumed equivalent.
      if(receiver.type==='Identifier'&&arg.type==='Identifier'&&symbols.byNode.get(receiver)&&symbols.byNode.get(receiver)===symbols.byNode.get(arg)&&!symbols.byNode.get(receiver).refs.some(r=>r.write)){
        if(source.slice(n.base.identifier.range[1],arg.range[0]).trim()!=='(')return;
        const comma=n.arguments[1]?source.slice(arg.range[1],n.arguments[1].range[0]).match(/^\s*,/):null;
        if(n.arguments[1]&&!comma)return;
        // luaparse extends a call base's range through the argument list.
        // The property identifier is the actual end of the callee spelling.
        const from=n.base.range[0],to=n.base.identifier.range[1],text=source.slice(from,to);
        if(commit(edits,[{start:from,end:to,text:text.slice(0,text.lastIndexOf('.'))+':'+n.base.identifier.name},
          {start:arg.range[0],end:arg.range[1]+(comma?.[0].length??0),text:''}]))stats.methods++;
      }
    }
  });
  for(const {body} of symbols.blocks){
    for(let i=0;i+1<body.length;i++){
      const s=body[i];if(s.type!=='LocalStatement'||s.variables.length!==1||s.init.length!==1||s.init[0].type!=='TableConstructorExpression')continue;
      const b=symbols.byNode.get(s.variables[0]);if(!b||b.refs.some(r=>r.write))continue;
      const fields=[],removed=[],seen=new Set(s.init[0].fields.filter(f=>f.type==='TableKeyString').map(f=>f.key.name));
      for(let j=i+1;j<body.length;j++){
        const a=body[j],declaration=a.type==='FunctionDeclaration'&&!a.isLocal&&a.identifier?.type==='MemberExpression'&&a.identifier.indexer==='.';
        if(!declaration&&(a.type!=='AssignmentStatement'||a.variables.length!==1||a.init.length!==1))break;
        const lhs=declaration?a.identifier:a.variables[0],value=declaration?a:a.init[0],key=field(lhs);
        if(!key||lhs.base?.type!=='Identifier'||symbols.byNode.get(lhs.base)!==b||seen.has(key)||!valid(key)||!pure(value,symbols))break;
        // No self-reference: construction must not turn reads of the old table
        // into reads of an uninitialized/new table.
        let self=false;const scan=v=>{if(v.type==='Identifier'&&symbols.byNode.get(v)===b)self=true;};if(declaration)for(const statement of a.body)walk(statement,scan);else walk(value,scan);if(self)break;
        const text=declaration?'function'+source.slice(a.identifier.identifier.range[1],a.range[1]):source.slice(...value.range);
        fields.push(`${key} = ${text}`);removed.push(a);seen.add(key);
      }
      if(fields.length){
        const t=s.init[0],old=source.slice(t.range[0]+1,t.range[1]-1).trim();
        if(commit(edits,[edit(t,`{${old}${old?', ':''}${fields.join(', ')}}`),...removed.map(a=>edit(a,''))]))stats.tableFields+=fields.length;
      }
    }
  }
  return apply(source,edits);
}

function methodSnapshots(source,tree,symbols,stats){
  const edits=[];
  function identity(n,seen=new Set()){
    if(n?.type!=='Identifier')return null;
    const b=symbols.byNode.get(n);if(!b||b.refs.some(r=>r.write&&(r.fn!==b.fn||r.node.range[0]<n.range[0]))||seen.has(b))return null;
    seen.add(b);return b.init?.type==='Identifier'?identity(b.init,seen)??b:b;
  }
  for(const b of symbols.bindings){
    const s=b.statement,member=b.init;
    if(s?.type!=='LocalStatement'||s.variables.length!==1||s.init.length!==1||member?.type!=='MemberExpression'||member.indexer!=='.'||!identity(member.base))continue;
    if(b.refs.length!==1||b.refs[0].write)continue;
    const ref=b.refs[0],call=ref.parent;
    if(call?.type!=='CallExpression'||ref.key!=='base'||!call.arguments.length||ref.fn!==b.fn||identity(call.arguments[0])!==identity(member.base))continue;
    if(call.arguments.slice(1).some(a=>!stableArgument(a,symbols)))continue;
    const i=b.body.indexOf(s),j=statementOf(b.body,call);if(i<0||j<=i)continue;
    const next=b.body[j];
    if(!(next.type==='CallStatement'&&next.expression===call||['LocalStatement','AssignmentStatement'].includes(next.type)&&next.init.length===1&&next.init[0]===call&&next.variables.every(n=>n.type==='Identifier')))continue;
    // Preserve a captured method across every observable operation. Only local
    // function creation and side-effect-free local declarations may intervene.
    // Even a local read cannot cross an unknown __index: the lookup may mutate
    // the captured variable before its snapshot. Literal/function creation is
    // safe here; general "pure" expressions are not a commutation proof.
    if(b.body.slice(i+1,j).some(n=>!(n.type==='FunctionDeclaration'&&n.isLocal||n.type==='LocalStatement'&&n.init.every(v=>primitive(v)||v.type==='FunctionDeclaration'))))continue;
    const arg=call.arguments[0],comma=call.arguments[1]?source.slice(arg.range[1],call.arguments[1].range[0]).match(/^\s*,/):null;
    if(call.arguments[1]&&!comma)continue;
    if(source.slice(call.base.range[1],arg.range[0]).trim()!=='(')continue;
    if(commit(edits,[edit(s,';'),edit(call.base,source.slice(...member.base.range)+':'+member.identifier.name),{start:arg.range[0],end:arg.range[1]+(comma?.[0].length??0),text:''}]))stats.methods++;
  }
  return apply(source,edits);
}

// Recover a staged method/configuration call as one evaluation sequence. Method
// lookup must remain BEFORE evaluating defaults and constructing callbacks.
function configuredMethodCalls(source,tree,symbols,stats){
  const edits=[];
  const single=s=>['LocalStatement','AssignmentStatement'].includes(s?.type)&&s.variables.length===1&&s.init.length===1&&s.variables[0].type==='Identifier';
  const text=n=>source.slice(...n.range);
  const belongs=(n,b)=>n?.type==='Identifier'&&symbols.byNode.get(n)===b;
  const captured=b=>b.refs.some(r=>r.fn!==b.fn);
  const laterRead=(b,end)=>{
    for(const ref of b.refs.filter(r=>r.node.range[0]>=end).sort((a,b)=>a.node.range[0]-b.node.range[0])){if(ref.write)return false;return true;}return false;
  };
  for(const {body} of symbols.blocks)for(let i=0;i+2<body.length;i++){
    const methodDef=body[i],configDef=body[i+1];if(!single(methodDef)||!single(configDef))continue;
    const member=methodDef.init[0],table=configDef.init[0];
    if(member.type!=='MemberExpression'||member.indexer!=='.'||member.base.type!=='Identifier'||table.type!=='TableConstructorExpression')continue;
    const method=symbols.byNode.get(methodDef.variables[0]),config=symbols.byNode.get(configDef.variables[0]),receiver=symbols.byNode.get(member.base);
    if(!method||!config||!receiver||method===config||captured(method)||captured(config)||receiver.refs.some(r=>r.write))continue;
    const fields=table.fields.map(text),keys=new Set(table.fields.map(f=>f.type==='TableKeyString'?f.key.name:null)),removed=[methodDef,configDef];
    let stableFields=stableArgument(table,symbols);
    let blocked=false;walk(table,n=>{if(belongs(n,config)||belongs(n,method))blocked=true;});if(blocked)continue;
    const earlyNodes=[table];
    for(let j=i+2;j<body.length;j++){
      const s=body[j];let lhs,rhs;
      if(s.type==='LocalStatement'&&!s.init.length){
        const names=new Set(s.variables.map(v=>v.name));let shadows=false;
        for(const node of earlyNodes)walk(node,n=>{if(n.type==='Identifier'&&names.has(n.name))shadows=true;});
        if(shadows)break;continue;
      }
      if(s.type==='AssignmentStatement'&&s.variables.length===1&&s.init.length===1){lhs=s.variables[0];rhs=s.init[0];}
      else if(s.type==='FunctionDeclaration'&&!s.isLocal&&s.identifier?.type==='MemberExpression'&&s.identifier.indexer==='.')lhs=s.identifier;
      const key=field(lhs);
      if(key&&valid(key)&&belongs(lhs.base,config)&&!keys.has(key)){
        let self=false;walk(rhs??s,n=>{if(n===lhs)return;if(belongs(n,config)||belongs(n,method))self=true;});
        // The function's assignment target is not a captured self-reference.
        if(!rhs){self=false;for(const statement of s.body)walk(statement,n=>{if(belongs(n,config)||belongs(n,method))self=true;});}
        if(self)break;
        earlyNodes.push(rhs??s);
        if(rhs&&!stableArgument(rhs,symbols))stableFields=false;
        fields.push(key+' = '+(rhs?text(rhs):'function'+source.slice(s.identifier.range[1],s.range[1])));keys.add(key);removed.push(s);continue;
      }
      const call=s.type==='CallStatement'?s.expression:single(s)?s.init[0]:null;
      if(call?.type!=='CallExpression'||!belongs(call.base,method)||call.arguments.length<2||!belongs(call.arguments[0],receiver)||!belongs(call.arguments.at(-1),config))break;
      if(call.arguments.slice(1,-1).some(n=>!primitive(n)&&!(n.type==='Identifier'&&symbols.byNode.get(n)&&!symbols.byNode.get(n).refs.some(r=>r.write))))break;
      const start=methodDef.range[0],end=s.range[1];
      const methodReads=method.refs.filter(r=>!r.write&&r.node.range[0]>=start&&r.node.range[0]<end);
      const configReads=config.refs.filter(r=>!r.write&&r.node.range[0]>=configDef.range[0]&&r.node.range[0]<end);
      if(methodReads.length!==1||configReads.some(r=>r.node!==call.arguments.at(-1)&&!removed.slice(2).some(a=>r.node.range[0]>=a.range[0]&&r.node.range[1]<=a.range[1])))break;
      if(laterRead(method,end)||laterRead(config,end))break;
      // Luau NAMECALL can resolve the method after evaluating arguments. If
      // defaults are observable, retain the saved function identity and only
      // rebuild its configuration. Never exchange correctness for a colon.
      const replacement=(stableFields?text(member.base)+':'+member.identifier.name:text(call.base))+'('+[...call.arguments.slice(stableFields?1:0,-1).map(text),'{'+fields.join(', ')+'}'].join(', ')+')';
      const deletions=removed.filter(a=>stableFields||a!==methodDef).map(a=>edit(a,a.type==='LocalStatement'&&symbols.byNode.get(a.variables[0]).refs.some(r=>r.node.range[0]>=end)?'local '+a.variables[0].name+';':';'));
      if(commit(edits,[...deletions,edit(call,replacement)])){stats.configCalls++;stats.tableFields+=fields.length;stats.methods++;}break;
    }
  }
  return apply(source,edits);
}

function semanticNames(source,tree,symbols,stats){
  const info=new Map(),suggestions=new Map(),exports=new Map(),visiting=new Set(),mutableRoles=new Set();
  const knownGlobal=(n,name)=>n?.type==='Identifier'&&n.name===name&&!symbols.byNode.get(n);
  const suggest=(b,label,type)=>{if(!b||!valid(label))return;if(!suggestions.has(b))suggestions.set(b,new Set());suggestions.get(b).add(label);if(type)info.set(b,{label,type});};
  function infer(n,depth=0){
    if(!n||depth>16)return {};
    if(n.type==='Identifier'){
      const b=symbols.byNode.get(n);
      if(b){if(info.has(b))return info.get(b);if(visiting.has(b)||b.refs.some(r=>r.write))return {};visiting.add(b);const value=infer(b.init,depth+1);visiting.delete(b);info.set(b,value);return value;}
      return n.name==='game'?{type:'DataModel',label:'game'}:n.name==='workspace'?{type:'Workspace',label:'Workspace'}:['cloneref','getgenv','getrenv','getfenv'].includes(n.name)?{api:n.name}:{};
    }
    if(n.type==='MemberExpression'||n.type==='IndexExpression'){
      const base=infer(n.base,depth+1),key=field(n);if(!key)return {};
      const member=base.type?apiMember(base.type,key):null;
      if(member?.kind==='Event')return {type:'RBXScriptSignal',label:key};
      if(member?.kind==='Function')return {type:'function',method:key,receiverType:base.type};
      const roles={LocalPlayer:'Player',Character:'Model',PlayerGui:'PlayerGui',Backpack:'Backpack',CurrentCamera:'Camera',HumanoidRootPart:'BasePart',Humanoid:'Humanoid'};
      if(base.type&&roles[key])return {type:roles[key],label:key==='CurrentCamera'?'Camera':key};
      if(member)return {type:member.valueType??member.returnType,label:key};
      return {label:key};
    }
    if(n.type==='CallExpression'){
      const callee=infer(n.base,depth+1),method=field(n.base)??callee.method,args=n.arguments,receiver=n.base?.base;
      if((knownGlobal(n.base,'cloneref')||callee.api==='cloneref')&&args.length===1)return infer(args[0],depth+1);
      if(['getgenv','getrenv','getfenv'].includes(callee.api))return {type:'Environment',label:'environment'};
      if(knownGlobal(n.base,'pcall'))return {type:'boolean',label:'success'};
      if(knownGlobal(n.base,'identifyexecutor')||knownGlobal(n.base,'getexecutorname'))return {type:'string',label:'executor'};
      const base=receiver?infer(receiver,depth+1):{type:callee.receiverType};
      if(base.type==='DataModel'&&['GetService','FindService','service'].includes(method)){
        const service=args[n.base.indexer===':'?0:1];
        if(service?.type==='StringLiteral'&&valid(service.value))return {type:service.value,label:service.value};
        return {type:'Instance',label:'service'};
      }
      if(receiver?.type==='Identifier'&&receiver.name==='Instance'&&!symbols.byNode.get(receiver)&&method==='new'&&args[0]?.type==='StringLiteral')return {type:args[0].value,label:args[0].value};
      if(['FindFirstChildOfClass','FindFirstChildWhichIsA'].includes(method)&&args[0]?.type==='StringLiteral')return {type:args[0].value,label:args[0].value};
      if(['FindFirstChild','WaitForChild'].includes(method)&&args[0]?.type==='StringLiteral')return {type:'Instance',label:args[0].value};
      if(['Connect','Once','ConnectParallel'].includes(method))return {type:'RBXScriptConnection',label:base.label?base.label+'Connection':'connection'};
      if(method==='GetPropertyChangedSignal'&&args[0]?.type==='StringLiteral'&&valid(args[0].value))return {type:'RBXScriptSignal',label:args[0].value+'Changed'};
      if(knownGlobal(n.base,'require'))return {label:infer(args[0],depth+1).label};
      if(['GetPlayers','GetChildren','GetDescendants','GetConnections'].includes(method))return {type:'Array',label:method.slice(3),element:method==='GetPlayers'?'player':method==='GetChildren'?'child':method==='GetDescendants'?'descendant':'connection'};
      if(method==='new'&&receiver?.type==='Identifier'&&['Vector2','Vector3','CFrame','Color3','UDim2','UDim','Ray','Rect','Region3','Random'].includes(receiver.name)&&!symbols.byNode.get(receiver))return {type:receiver.name,label:receiver.name[0].toLowerCase()+receiver.name.slice(1)};
      const member=base.type&&method?apiMember(base.type,method):null;
      if(member?.returnType&&!['void','null','Tuple','Variant'].includes(member.returnType))return {type:member.returnType,label:method.replace(/^(Get|Find|Create)/,'').replace(/^./,c=>c.toLowerCase())||'result'};
    }
    if(n.type==='LogicalExpression'){
      const a=infer(n.left,depth+1),b=infer(n.right,depth+1);
      if(a.type===b.type&&a.label===b.label)return a;
      if(a.type==='nil'||b.type==='nil'){const v=a.type==='nil'?b:a;return {...v,type:v.type?`${v.type}?`:undefined};}
      if(n.operator==='or'&&!a.label&&valid(b.label))return {label:'resolved'+b.label[0].toUpperCase()+b.label.slice(1)};
      return a.type&&b.type?{type:[...new Set([...a.type.split('|'),...b.type.split('|')])].sort().join('|')}:{};
    }
    if(primitive(n))return {type:n.type==='NilLiteral'?'nil':n.type==='StringLiteral'?'string':n.type==='NumericLiteral'?'number':'boolean'};
    if(n.type==='TableConstructorExpression')return {type:'table',label:'config'};
    if(n.type==='FunctionDeclaration'){
      const upper=s=>s[0].toUpperCase()+s.slice(1);
      const last=n.body.at(-1),result=last?.type==='ReturnStatement'&&last.arguments.length===1?last.arguments[0]:null;
      if(n.body.length===1&&result?.type==='CallExpression'){
        let http=false,compile=false;walk(result,x=>{if(x.type==='CallExpression'&&['HttpGet','HttpGetAsync'].includes(field(x.base)))http=true;if(x.type==='CallExpression'&&knownGlobal(x.base,'loadstring'))compile=true;});
        if(http&&compile)return {type:'function',label:'loadRemoteModule'};
      }
      const propertySignals=new Set(),eventSignals=new Set(),nameFilters=new Set();let connects=false,returnsParent=false,traverses=false;
      function scanOwn(node){
        if(!node||node!==n&&node.type==='FunctionDeclaration')return;
        if(node.type==='MemberExpression'&&node.identifier.name==='Connect')connects=true;
        if(node.type==='CallExpression'){
          const method=field(node.base),args=node.arguments;
          if(method==='GetPropertyChangedSignal'&&args[0]?.type==='StringLiteral'&&valid(args[0].value))propertySignals.add(args[0].value);
          if(['GetDescendants','GetChildren'].includes(method))traverses=true;
          if(method==='Connect'){const signal=infer(node.base.base);if(signal.type==='RBXScriptSignal'&&signal.label)eventSignals.add(signal.label);}
        }
        if(node.type==='BinaryExpression'&&node.operator==='=='&&field(node.left)==='Name'&&node.right?.type==='StringLiteral'&&valid(node.right.value))nameFilters.add(node.right.value);
        if(node.type==='ReturnStatement'&&node.arguments.length===1&&field(node.arguments[0])==='Parent')returnsParent=true;
        for(const child of children(node))scanOwn(child);
      }
      scanOwn(n);
      if(connects&&propertySignals.size===1)return {type:'function',label:'track'+upper([...propertySignals][0])+'Changes'};
      if(connects&&eventSignals.size===1)return {type:'function',label:'connect'+upper([...eventSignals][0])};
      if(traverses&&returnsParent&&nameFilters.size===1)return {type:'function',label:'find'+upper([...nameFilters][0])+'Parent'};
      if(result?.type==='CallExpression'&&field(result.base)==='Wait'){
        const signal=infer(result.base.base),event=signal.type==='RBXScriptSignal'&&signal.label;
        if(event?.endsWith('Added')&&valid(event.slice(0,-5)))return {type:'function',label:'get'+upper(event.slice(0,-5))};
      }
      if(result?.type==='BinaryExpression'&&result.operator==='=='&&result.right?.type==='BooleanLiteral'&&result.right.value===true&&result.left.type==='IndexExpression'){
        const key=field(result.left.base);if(key&&valid(key))return {type:'function',label:'is'+upper(key)};
      }
      const marked=new Set(),methods=new Set();
      const scan=body=>{for(const s of body){
        if(s.type==='AssignmentStatement'&&s.variables.length===1&&s.init[0]?.type==='BooleanLiteral'&&s.init[0].value===true&&s.variables[0].type==='IndexExpression'){
          const key=field(s.variables[0].base);if(key&&valid(key))marked.add(key);
        }
        // Traverse control flow, not nested closures with unrelated roles.
        if(s.type==='CallStatement'&&s.expression.type==='CallExpression'&&s.expression.base.type==='MemberExpression')methods.add(field(s.expression.base));
        if(s.type==='IfStatement')for(const c of s.clauses)scan(c.body);
      }};
      scan(n.body);
      if(marked.size===1)return {type:'function',label:'mark'+upper([...marked][0])};
      if(methods.size===1&&methods.has('Disconnect'))return {type:'function',label:'disconnect'};
      const returns=n.body.filter(s=>s.type==='ReturnStatement'&&s.arguments.length===1);
      if(returns.length===1){const v=infer(returns[0].arguments[0],depth+1);if(v.label)return {type:'function',label:'get'+v.label[0].toUpperCase()+v.label.slice(1)};}
      return {type:'function'};
    }
    return {};
  }
  for(const b of symbols.bindings){const v=infer(b.node);if(v.label&&!b.refs.some(r=>r.write))suggest(b,v.label,v.type);}
  // Distinguish an optional candidate from its shadowing fallback result using
  // lexical binding identity. Do not rename unrelated reused register slots.
  for(const b of symbols.bindings){
    if(b.init?.type!=='LogicalExpression'||b.init.operator!=='or'||b.init.left.type!=='Identifier'||b.init.left.name!==b.name)continue;
    const previous=symbols.byNode.get(b.init.left),fallback=infer(b.init.right);
    if(previous?.init?.type!=='NilLiteral'||!valid(fallback.label)||previous.refs.some(r=>r.fn!==previous.fn||r.node.range[0]>b.statement.range[1]))continue;
    suggest(previous,'candidate'+fallback.label[0].toUpperCase()+fallback.label.slice(1));mutableRoles.add(previous);
  }
  // Exports and event uses carry names without guessing a gameplay purpose.
  function exportHint(rhs,name){
    if(!valid(name))return;
    if(rhs?.type==='Identifier'){
      const b=symbols.byNode.get(rhs);if(b){if(!exports.has(b))exports.set(b,new Set());exports.get(b).add(name);}
    }else if(rhs?.type==='CallExpression'&&rhs.arguments.length===1&&rhs.arguments[0].type==='Identifier'){
      // A wrapper need not return its input unchanged. Name its implementation
      // argument from the export without deleting or executing the wrapper.
      const b=symbols.byNode.get(rhs.arguments[0]);
      if(b?.init?.type==='FunctionDeclaration')suggest(b,name+'Implementation','function');
    }
  }
  walk(tree,n=>{
    if(n.type==='LocalStatement'&&n.variables.length>1&&n.init.length===1&&n.init[0].type==='CallExpression'&&knownGlobal(n.init[0].base,'pcall')){
      suggest(symbols.byNode.get(n.variables[0]),'success','boolean');
      const fn=infer(n.init[0].arguments[0]),role=fn.label?.replace(/^load(?=[A-Z])/,'').replace(/^./,s=>s.toLowerCase());
      if(role&&valid(role))suggest(symbols.byNode.get(n.variables[1]),role+'OrError','Variant|string');
    }
    if(n.type==='AssignmentStatement')n.variables.forEach((lhs,i)=>exportHint(n.init[i],field(lhs)));
    if(n.type==='TableKeyString')exportHint(n.value,n.key.name);
    if(n.type==='CallExpression'&&['Connect','Once','ConnectParallel'].includes(field(n.base))){
      const cb=n.arguments[0],signal=infer(n.base.base),event=field(n.base.base)??(signal.type==='RBXScriptSignal'?signal.label:null);if(cb?.type==='Identifier'&&event)suggest(symbols.byNode.get(cb),'on'+event);
      const f=cb?.type==='FunctionDeclaration'?cb:symbols.byNode.get(cb)?.init;
      if(f?.type==='FunctionDeclaration'&&f.parameters[0]?.type==='Identifier'&&event==='CharacterAdded')suggest(symbols.byNode.get(f.parameters[0]),'Character','Model');
    }
    if(n.type==='ForGenericStatement'){
      const iterator=n.iterators[0],iter=iterator?.type==='CallExpression'&&['ipairs','pairs'].includes(iterator.base?.name)?iterator.arguments[0]:iterator;
      const v=infer(iter);if(v.element){const b=symbols.byNode.get(n.variables.at(-1));suggest(b,v.element);}
    }
    if(n.type==='CallExpression'&&n.base.type==='Identifier'){
      const f=symbols.byNode.get(n.base)?.init;
      if(f?.type==='FunctionDeclaration')f.parameters.forEach((p,i)=>{if(p.type!=='Identifier')return;const v=infer(n.arguments[i]);if(v.label&&v.type)suggest(symbols.byNode.get(p),v.label,v.type);});
    }
  });
  const used=new Set(symbols.allNames),edits=[];
  for(const b of symbols.bindings){
    const loopValue=b.statement?.type==='ForGenericStatement'&&['value','control','item'].includes(b.name);
    if((!synthetic(b.name)&&!loopValue)||b.refs.some(r=>r.write)&&!mutableRoles.has(b))continue;
    let labels=exports.get(b)??suggestions.get(b),label;
    if(labels?.size===1)label=[...labels][0];
    else if(b.init?.type==='FunctionDeclaration')label='callback';
    if(!valid(label))continue;
    let name=label,n=2;while(used.has(name))name=label+n++;
    used.add(name);edits.push(edit(b.node,name));for(const ref of b.refs)edits.push(edit(ref.node,name));stats.renamed++;
  }
  stats.inferredTypes=[...new Set([...info.values()].map(v=>v.type).filter(Boolean))].sort();
  return apply(source,edits);
}

export function improveReadability(source,{maxRounds=12,onPass=()=>{},onReject=()=>{}}={}){
  const stats={lifetimes:0,constants:0,aliases:0,temporaries:0,reachingAliases:0,dead:0,deadStores:0,scopes:0,scopesRemoved:0,repeatConditions:0,unreachable:0,booleans:0,methods:0,tableFields:0,configCalls:0,wrappers:0,renamed:0,rounds:0,converged:false,cleanupRounds:0,cleanupConverged:false,rolledBack:[]};
  let code=source;
  function checkedPass(pass,round){
    const tree=parse(code),before=bindSymbols(tree),snapshot=structuredClone(stats);
    const candidate=pass(code,tree,before,stats);
    if(candidate!==code){
      try{validateBindingTransition(code,candidate);code=candidate;}
      catch(error){Object.assign(stats,snapshot);stats.rolledBack.push({pass:pass.name,round,reason:error.message});onReject(pass.name,round,candidate,error);}
    }
    onPass(pass.name,round,code);
  }
  // Rebind after every structural phase: identifier identity and definition
  // ranges change when register lifetimes are split or statements disappear.
  for(let round=0;round<Math.min(12,maxRounds);round++){
    const before=code;
    for(const pass of [localLifetimes,simplify,deadStores,identityWrappers,configuredMethodCalls,reachingSnapshots,inlineTemporaries,methodSnapshots,methodsAndTables,engineMethods,repeatConditions,lexicalRegions]){
      checkedPass(pass,round);
    }
    stats.rounds++;if(code===before){stats.converged=true;break;}
  }
  checkedPass(semanticNames,stats.rounds);
  // Naming is terminal: run only non-renaming cleanup afterward so successful
  // late transforms cannot leave newly dead stores or churn semantic names.
  for(let round=0;round<12;round++){
    const before=code;
    for(const pass of [simplify,deadStores])checkedPass(pass,stats.rounds+round);
    stats.cleanupRounds++;if(code===before){stats.cleanupConverged=true;break;}
  }
  stats.stopReason=stats.converged?'fixed-point':'bounded-structural-rounds';
  return {code,stats};
}

export function measureReadability(source){
  const symbols=bindSymbols(parse(source)),liveness=analyzeLiveness(symbols);
  let deadStoreDestinations=0;
  for(const {body} of symbols.blocks)for(const s of body){
    if(!['LocalStatement','AssignmentStatement'].includes(s.type)||!s.init.length||s.variables.length!==s.init.length||s.init.some(n=>!pure(n,symbols)))continue;
    const node=liveness.statements.get(s);if(!node)continue;
    for(const variable of s.variables){const b=variable.type==='Identifier'&&symbols.byNode.get(variable);if(b&&!liveness.captured.has(b)&&!node.out.has(b))deadStoreDestinations++;}
  }
  return {bytes:Buffer.byteLength(source),lines:source.trimEnd().split(/\r?\n/).length,
    deadStoreDestinations,unresolvedGeneratedReads:symbols.references.filter(r=>!r.binding&&!r.write&&synthetic(r.node.name)).length,
    unresolvedGeneratedWrites:symbols.references.filter(r=>!r.binding&&r.write&&synthetic(r.node.name)).length,
    cfgNodes:liveness.graphs.reduce((n,g)=>n+g.nodes.length,0),capturedLocals:liveness.captured.size};
}

// Compilation alone cannot catch a removed local: Lua silently resolves its
// remaining references through the environment. Every phase must preserve the
// free-reference boundary, including globals already present elsewhere.
export function validateBindingTransition(before,after){
  const free=source=>{
    const symbols=bindSymbols(parse(source)),counts=new Map();
    for(const ref of symbols.references)if(!ref.binding){
      const key=(ref.write?'write:':'read:')+ref.node.name;
      counts.set(key,(counts.get(key)??0)+1);
    }
    return counts;
  };
  const old=free(before),next=free(after);
  for(const [key,count] of next)if(count>(old.get(key)??0))throw Error('New unresolved reference: '+key);
  return true;
}

export function validateGeneratedBindings(source,{allowedGlobals=[]}={}){
  const allowed=new Set(allowedGlobals),symbols=bindSymbols(parse(source));
  for(const ref of symbols.references)if(!ref.binding&&synthetic(ref.node.name)&&!allowed.has(ref.node.name))
    throw Error('Unbound generated register '+ref.node.name+' ('+(ref.write?'write':'read')+')');
  return true;
}
