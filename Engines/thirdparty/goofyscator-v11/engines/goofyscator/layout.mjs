import {readableParser} from '../ad/lift/readable-parser.js';

const identifier=(node,name)=>node?.type==='Identifier'&&node.name===name;
function visit(node,fn){
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const item of node)visit(item,fn);return;}
  fn(node);for(const [key,value] of Object.entries(node))if(key!=='loc'&&key!=='range')visit(value,fn);
}
function number(node){return node?.type==='NumericLiteral'?node.value:null;}
function luaTruthy(value){return value!==null&&value!==undefined&&value!==false;}

// Evaluate only the arithmetic/field-access subset used for VM metadata.
// No target function, property getter, host callback or generated JavaScript runs.
export function metadataExpression(node,variables){
  switch(node?.type){
    case 'NumericLiteral':case 'BooleanLiteral':case 'StringLiteral':return node.value;
    case 'NilLiteral':return null;
    case 'Identifier':
      if(!Object.hasOwn(variables,node.name))throw Error('Unknown metadata variable: '+node.name);
      return variables[node.name];
    case 'TableConstructorExpression':
      if(node.fields.length===0)return Object.create(null);
      break;
    case 'IndexExpression':{
      const base=metadataExpression(node.base,variables),key=metadataExpression(node.index,variables);
      if(!base||typeof base!=='object'||Object.getPrototypeOf(base)!==Object.prototype&&Object.getPrototypeOf(base)!==null)
        throw Error('Non-data metadata lookup');
      const descriptor=Object.getOwnPropertyDescriptor(base,String(key));
      if(descriptor?.get||descriptor?.set)throw Error('Metadata accessor rejected');
      return descriptor?.value??null;
    }
    case 'LogicalExpression':{
      const left=metadataExpression(node.left,variables);
      if(node.operator==='or')return luaTruthy(left)?left:metadataExpression(node.right,variables);
      if(node.operator==='and')return luaTruthy(left)?metadataExpression(node.right,variables):left;
      break;
    }
    case 'UnaryExpression':{
      const value=metadataExpression(node.argument,variables);
      if(node.operator==='not')return !luaTruthy(value);
      if(node.operator==='-'&&typeof value==='number')return -value;
      break;
    }
    case 'BinaryExpression':{
      const a=metadataExpression(node.left,variables),b=metadataExpression(node.right,variables);
      if(typeof a!=='number'||typeof b!=='number')throw Error('Non-numeric metadata arithmetic');
      let result;
      switch(node.operator){
        case '+':result=a+b;break;case '-':result=a-b;break;case '*':result=a*b;break;
        case '/':result=a/b;break;case '%':result=a-Math.floor(a/b)*b;break;
        case '^':result=a**b;break;default:throw Error('Unsupported metadata operator');
      }
      if(!Number.isFinite(result))throw Error('Nonfinite metadata result');
      return result;
    }
  }
  throw Error('Unsupported metadata expression: '+node?.type);
}

function directReturn(fn){
  return fn.body.length===1&&fn.body[0].type==='ReturnStatement'&&fn.body[0].arguments.length===1
    ?fn.body[0].arguments[0]:null;
}
function parseEntry(entry){return readableParser.parse('return '+entry.value,{luaVersion:'5.3'}).body[0].arguments[0];}
function matchDestination(fn){
  if(fn.parameters.length!==2)return null;
  const expression=directReturn(fn),input=fn.parameters[1].name;
  if(expression?.type!=='BinaryExpression'||expression.operator!=='%')return null;
  const fields=[];let unsupported=false;
  visit(expression,node=>{
    if(node.type==='IndexExpression'){
      if(!identifier(node.base,input)||number(node.index)===null)unsupported=true;
      else fields.push(node.index.value);
    }
    if(node.type==='CallExpression'||node.type==='MemberExpression')unsupported=true;
    if(node.type==='Identifier'&&node.name!==input)unsupported=true;
  });
  if(unsupported||new Set(fields).size!==1)return null;
  // Require a nontrivial transform, rather than confusing a raw numeric getter
  // with a destination register decoder.
  let multiply=false,subtract=false;
  visit(expression,node=>{multiply||=node.operator==='*';subtract||=node.operator==='-';});
  if(!multiply||!subtract)return null;
  return {input,field:fields[0],expression};
}
function matchOperand(fn){
  if(fn.parameters.length!==2)return null;
  const expression=directReturn(fn),input=fn.parameters[1].name;
  if(fn.body.length===2&&fn.body[0].type==='LocalStatement'&&fn.body[0].variables.length===1&&
     fn.body[0].init.length===1&&fn.body[1].type==='ReturnStatement'){
    const local=fn.body[0],lookup=local.init[0],ret=fn.body[1].arguments[0];
    const guard=ret?.type==='LogicalExpression'&&ret.operator==='or'?ret.left:null;
    const condition=guard?.operator==='and'?guard.left:null,child=guard?.right;
    if(lookup.type==='IndexExpression'&&identifier(lookup.base,input)&&number(lookup.index)!==null&&
       condition?.type==='BinaryExpression'&&condition.operator==='=='&&
       condition.left.type==='CallExpression'&&identifier(condition.left.base,'type')&&
       condition.left.arguments.length===1&&identifier(condition.left.arguments[0],local.variables[0].name)&&
       condition.right.type==='StringLiteral'&&condition.right.value==='table'&&
       child?.type==='IndexExpression'&&identifier(child.base,local.variables[0].name)&&number(child.index)!==null&&
       ret.right.type==='TableConstructorExpression'&&ret.right.fields.length===0){
      return {input,bundle:lookup.index.value,slot:child.index.value,expression:{type:'LogicalExpression',operator:'or',
        left:{type:'IndexExpression',base:{type:'LogicalExpression',operator:'or',left:lookup,
          right:{type:'TableConstructorExpression',fields:[]}},index:child.index},
        right:{type:'TableConstructorExpression',fields:[]}}};
    }
  }
  // The descriptor getters return (instruction[bundle] or {})[slot] or {}.
  if(expression?.type!=='LogicalExpression'||expression.operator!=='or')return null;
  const outer=expression.left;
  if(outer?.type!=='IndexExpression'||number(outer.index)===null)return null;
  const middle=outer.base;
  if(middle?.type!=='LogicalExpression'||middle.operator!=='or')return null;
  const inner=middle.left;
  if(inner?.type!=='IndexExpression'||!identifier(inner.base,input)||number(inner.index)===null)return null;
  if(middle.right?.type!=='TableConstructorExpression'||expression.right?.type!=='TableConstructorExpression')return null;
  return {input,bundle:inner.index.value,slot:outer.index.value,expression};
}
function matchResolver(fn){
  if(fn.parameters.length!==3)return null;
  const state=fn.parameters[1].name,descriptor=fn.parameters[2].name;
  const bindings=new Map();
  for(const statement of fn.body){
    if(statement.type==='LocalStatement')statement.variables.forEach((v,i)=>bindings.set(v.name,statement.init[i]));
  }
  const descriptorFields=[];
  for(const [name,expression] of bindings){
    if(expression?.type==='LogicalExpression'&&expression.operator==='or'&&
       expression.left.type==='IndexExpression'&&identifier(expression.left.base,descriptor)&&
       number(expression.left.index)!==null&&number(expression.right)!==null)
      descriptorFields.push({name,field:expression.left.index.value,fallback:expression.right.value});
  }
  if(descriptorFields.length!==2)return null;
  let registerKind=null,registerStateKey=null,immediateKind=null,kindVariable=null,valueVariable=null;
  const mainIf=fn.body.find(node=>node.type==='IfStatement');
  if(!mainIf)return null;
  for(const clause of mainIf.clauses){
    const condition=clause.condition;
    if(condition?.type!=='BinaryExpression'||condition.operator!=='=='||number(condition.right)===null)continue;
    const ret=clause.body.length===1&&clause.body[0].type==='ReturnStatement'?clause.body[0].arguments[0]:null;
    if(ret?.type==='IndexExpression'&&ret.base.type==='IndexExpression'&&identifier(ret.base.base,state)&&
       number(ret.base.index)!==null&&ret.index.type==='Identifier'){
      registerKind=condition.right.value;kindVariable=condition.left.name;
      registerStateKey=ret.base.index.value;valueVariable=ret.index.name;
    }
    if(ret?.type==='Identifier')immediateKind=condition.right.value;
  }
  const kind=descriptorFields.find(x=>x.name===kindVariable),value=descriptorFields.find(x=>x.name===valueVariable);
  if(!kind||!value||registerKind===null||immediateKind===null)return null;
  const constantKinds=new Set(),poolFields=new Set();
  visit(fn.body,node=>{
    if(node.type==='BinaryExpression'&&node.operator==='=='&&identifier(node.left,kindVariable)&&number(node.right)!==null)
      constantKinds.add(node.right.value);
    if(node.type==='IndexExpression'&&node.base.type==='IndexExpression'&&identifier(node.base.base,state)&&
       number(node.base.index)!==null&&identifier(node.index,valueVariable)&&node.base.index.value!==registerStateKey)
      poolFields.add(node.base.index.value);
  });
  constantKinds.delete(registerKind);constantKinds.delete(immediateKind);
  if(poolFields.size!==1||constantKinds.size===0)return null;
  return {kindField:kind.field,valueField:value.field,defaultKind:kind.fallback,
    defaultValue:value.fallback,registerKind,immediateKind,constantKinds:[...constantKinds],
    registerStateKey,constantsStateKey:[...poolFields][0]};
}

export function discoverLayout(analysis){
  const destinations=[],operands=[],resolvers=[];
  for(const entry of analysis.wrapper.entries.filter(e=>e.isFunction)){
    const fn=parseEntry(entry);
    const destination=matchDestination(fn),operand=matchOperand(fn),resolver=matchResolver(fn);
    if(destination)destinations.push({method:entry.key,...destination});
    if(operand)operands.push({method:entry.key,...operand});
    if(resolver)resolvers.push({method:entry.key,...resolver});
  }
  if(destinations.length!==1||resolvers.length!==1)throw Error('V11 operand layout missing or ambiguous');
  const bundles=new Set(operands.map(x=>x.bundle));
  if(operands.length!==2||bundles.size!==1||new Set(operands.map(x=>x.slot)).size!==2)
    throw Error('V11 operand getter layout missing or ambiguous');
  return {destination:destinations[0],operands,resolver:resolvers[0]};
}

export function decodeOperand(desc,resolver){
  if(!desc||typeof desc!=='object')return {kind:'none'};
  const code=desc[resolver.kindField]??resolver.defaultKind;
  const value=desc[resolver.valueField]??resolver.defaultValue;
  if(code===resolver.registerKind)return {kind:'register',index:value};
  if(code===resolver.immediateKind)return {kind:'immediate',value};
  if(resolver.constantKinds.includes(code))return {kind:'encrypted-constant',index:value,kindCode:code};
  if(code===resolver.defaultKind)return {kind:'none'};
  return {kind:'unknown',kindCode:code,value};
}

export function annotateInstructions(instructions,layout){
  return Object.entries(instructions).map(([pc,instruction])=>{
    const row={pc:Number(pc),destination:metadataExpression(layout.destination.expression,
      {[layout.destination.input]:instruction}),operands:layout.operands.map(operand=>
        decodeOperand(metadataExpression(operand.expression,{[operand.input]:instruction}),layout.resolver))};
    const handlers=Object.values(instruction).filter(v=>v?.type==='function');
    row.handler=handlers.length===1?handlers[0].handler:null;
    return row;
  }).sort((a,b)=>a.pc-b.pc);
}
