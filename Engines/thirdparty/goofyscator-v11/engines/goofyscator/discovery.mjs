import {discoverBridge} from './capture.mjs';
import {discoverLayout} from './layout.mjs';
import {readableParser} from '../ad/lift/readable-parser.js';
import {discoverKeyedString} from './keyed-string.mjs';
function walk(node,fn){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(n=>walk(n,fn));return;}fn(node);for(const value of Object.values(node))walk(value,fn);}
export function fixedArraySize(source){
  const fn=readableParser.parse('return '+source,{luaVersion:'5.3'}).body[0]?.arguments?.[0];
  if(fn?.type!=='FunctionDeclaration')return null;
  const declarations=fn.body.filter(n=>n.type==='LocalStatement');
  const arrays=declarations.flatMap(n=>n.variables.filter((_,i)=>n.init[i]?.type==='TableConstructorExpression'&&n.init[i].fields.length===0).map(v=>v.name));
  for(const name of arrays){
    const writes=fn.body.filter(n=>n.type==='AssignmentStatement');
    if(!writes.length)continue;
    let getter=null,base=null;
    const valid=writes.every((n,i)=>{
      const target=n.variables[0],value=n.init[0];
      if(n.variables.length!==1||n.init.length!==1||target?.type!=='IndexExpression'||target.base?.name!==name||target.index?.value!==i+1||value?.type!=='CallExpression'||value.arguments.length!==3)return false;
      const offset=value.arguments[2];
      if(offset?.type!=='BinaryExpression'||offset.operator!=='+'||offset.right?.value!==i||offset.left?.type!=='Identifier')return false;
      if(i===0){getter=value.base?.name;base=offset.left.name;}
      return getter&&value.base?.name===getter&&offset.left.name===base;
    });
    const tail=fn.body.at(-1);
    if(valid&&tail?.type==='CallStatement'&&tail.expression?.arguments?.at(-1)?.name===name)return writes.length;
  }
  return null;
}
import {classifyHandler} from '../deobfuscator/upstream/goofy-review/goofyscator/src/discovery/classify-handlers.js';
import {discoverRunner,discoverDest,discoverBinaryConfig,discoverExtraSelectorConfig,
  discoverClosureLayout,discoverPrototypeLayout,discoverInlineDecoder}
  from '../deobfuscator/upstream/goofy-review/goofyscator/src/discovery/v10.js';

export function discoverExtraction(analysis){
  const bridge=discoverBridge(analysis),layout=discoverLayout(analysis),entries=analysis.wrapper.entries;
  const classifications=new Map([...analysis.handlerSources].map(([key,source])=>{
    let semantic=classifyHandler(source);
    // V11 changed these implementation shapes. These matches are extraction
    // categories only; a later lifter must reject any unsupported family.
    if(semantic==='unknown'&&source.includes('stack overflow')===false&&source.includes('string.byte')&&
       source.includes('table.concat')&&/return \(\w+\)\(\w+,\w+,\w+\)/.test(source))semantic='dispatch_wrapper';
    if(semantic==='unknown'&&source.includes('repeat local')&&source.includes('until')&&/\w+\(\w+,\w+,\w+\)/.test(source))semantic='inline';
    return [key,semantic];
  }));
  const genericInlineProperty=[...classifications].find(([,s])=>s==='inline')?.[0];
  const forwardingMetaKey=Number(/\w+\[(0x[\da-fA-F]+|\d+)\]=\{\w+,\w+,\w+,\w+\}/.exec(analysis.builder.value)?.[1]);
  if(!Number.isFinite(forwardingMetaKey))throw Error('V11 forwarding metadata layout missing');
  const inlineDecoderKey=discoverInlineDecoder(entries,classifications);
  if(!genericInlineProperty||!inlineDecoderKey)throw Error('V11 generic superinstruction decoder missing');
  let returnWriter=null;
  for(const [key,source] of analysis.handlerSources){
    if(classifications.get(key)==='unknown'&&/local \w+=\w+\[\w+\];if not \w+ then/.test(source)&&
       /\w+\(\w+\(\w+,1,\w+\)\)/.test(source)&&source.includes('function()end'))classifications.set(key,'native_factory');
    if(!/\(\w+,\w+,\{\},0\);return;/.test(source))continue;
    const ast=readableParser.parse('return '+source,{luaVersion:'5.3'}).body[0].arguments[0];
    const declaration=ast.body[0];
    if(declaration.type==='LocalStatement'&&declaration.init.length===1&&declaration.init[0].type==='MemberExpression')
      returnWriter=declaration.init[0].identifier.name;
  }
  for(const [key,source] of analysis.handlerSources){
    if(new RegExp('\\.'+inlineDecoderKey+'\\b').test(source)&&key!==genericInlineProperty)classifications.set(key,'inline');
    else if(returnWriter&&!['tailcall','call'].includes(classifications.get(key))&&new RegExp('\\.'+returnWriter+'(?:,|;)').test(source))
      classifications.set(key,/\{\},0\);return;/.test(source)?'return_zero':/if \w+ < 0 then \w+=0;/.test(source)?'return_open':'return_fixed');
    else if(/\(\w+ > 0 and \w+ <= \w+\) or \(\w+ < 0 and \w+ >= \w+\)/.test(source))classifications.set(key,'forloop');
    else if(/\["n"\]=1/.test(source)&&/\w+\[1\]=\w+\[/.test(source))classifications.set(key,'return_one');
    else if(classifications.get(key)==='setlist'){
      const ast=readableParser.parse('return '+source,{luaVersion:'5.3'}).body[0].arguments[0];
      if(ast.body.some(n=>n.type==='LocalStatement'&&n.init.some(i=>i.type==='TableConstructorExpression'&&i.fields.length===0)))
        classifications.set(key,'newarray');
    }
  }
  const runner=discoverRunner(entries);
  const bootstrapSource=entries.find(e=>e.key===bridge.bootstrap).value;
  const builderSelf=/^\(function\((\w+)/.exec(analysis.builder.value)[1];
  const handle=/;return (\w+);end\)$/.exec(analysis.builder.value)[1];
  const handlerField=new RegExp(builderSelf+'\\.(\\w+)='+handle+';').exec(analysis.builder.value)[1];
  const self=/^\(function\((\w+)/.exec(runner.source)[1];
  const envField=new RegExp(self+'\\.(\\w+)\\.xpcall').exec(runner.source)[1];
  const fixedArrays={},binaryStores={};
  for(const [key,source] of analysis.handlerSources){
    if(classifications.get(key)==='unknown'&&source.includes('__idiv')){
      const ast=readableParser.parse('return '+source,{luaVersion:'5.3'}).body[0].arguments[0];
      const branch=ast.body.find(n=>n.type==='IfStatement'&&n.clauses.length===8);
      const tail=ast.body.at(-1);
      if(branch&&tail?.type==='AssignmentStatement'&&tail.variables[0]?.type==='IndexExpression'){
        const selectorName=branch.clauses[0].condition?.left?.name,ops={};let mask;
        walk(ast,node=>{
          if(node.type==='CallExpression'&&node.base.type==='MemberExpression'&&node.base.identifier.name==='bxor'&&node.arguments[1]?.type==='NumericLiteral')mask=node.arguments[1].value;
        });
        for(const clause of branch.clauses){
          if(clause.condition?.left?.name!==selectorName||clause.condition.operator!=='=='||clause.condition.right.type!=='NumericLiteral')continue;
          const expression=clause.body[0]?.init?.[0];
          if(expression?.type==='BinaryExpression'&&['+','-','*','/','%','^','..'].includes(expression.operator))ops[clause.condition.right.value]=expression.operator;
          else if(clause.body[0]?.type==='LocalStatement'&&JSON.stringify(clause).includes('__idiv'))ops[clause.condition.right.value]='//';
        }
        if(Number.isFinite(mask)&&Object.keys(ops).length===8){binaryStores[key]={mask,ops};classifications.set(key,'binary_store');}
      }
    }
    if(classifications.get(key)==='unknown'&&/if \(\w+ == nil\) == \w+ then do local/.test(source)&&/\) ~= 0[;,]/.test(source))classifications.set(key,'jump_nil');
    if(classifications.get(key)!=='inline'&&source.includes('.'+envField+'[')&&source.includes('elseif'))
      classifications.set(key,/% 2 == 1/.test(source)?'getglobal_select':'getglobal');
    else if(classifications.get(key)==='unknown'&&(source.match(/elseif/g)||[]).length===5&&source.includes('not (')&&/if \w+ then do local/.test(source))
      classifications.set(key,'jump_compare');
    else if(fixedArraySize(source)!==null){
      fixedArrays[key]=fixedArraySize(source);classifications.set(key,'array_fixed');
    }
    else if(classifications.get(key)==='jump'&&/^\(function\([^)]*\)local \w+=\w+\.\w+;\w+\(\w+,\w+,/.test(source))
      classifications.set(key,'setupval');
    else if(classifications.get(key)==='unknown'&&/if not \(\w+ == nil\) then \w+\[\w+\]=\w+;else if \w+ == \w+\.\w+ then/.test(source))
      classifications.set(key,'setglobal');
  }
  const runnerAST=readableParser.parse('return '+runner.source,{luaVersion:'5.3'}).body[0].arguments[0];
  const bitAliases=new Set();
  walk(runnerAST,node=>{if(node.type==='MemberExpression'&&node.identifier.name==='bxor'&&node.base.type==='Identifier')bitAliases.add(node.base.name);});
  const decl=runnerAST.body[0],bitFields=[];
  decl.variables.forEach((v,i)=>{if(bitAliases.has(v.name)&&decl.init[i]?.type==='MemberExpression')bitFields.push(decl.init[i].identifier.name);});
  if(bitFields.length!==1)throw Error('V11 bit backend layout ambiguous');
  const bitField=bitFields[0];
  const keyedStrings={};
  for(const [key,source] of analysis.handlerSources){
    if(classifications.get(key)!=='unknown')continue;
    const configuration=discoverKeyedString(source,envField,bitField);
    if(configuration){keyedStrings[key]=configuration;classifications.set(key,'keyed_string');}
  }
  const antiField=new RegExp('local \\w+='+self+'\\.(\\w+);if \\w+ then \\w+=\\w+\\(\\w+,\\w+,\\w+,\\w+\\)').exec(runner.source)?.[1];
  const prepAlias=new RegExp('\\b(\\w+)\\('+self+',\\w+,\\w+\\);end;').exec(runner.source)?.[1];
  let prepareConstantAccess;
  walk(runnerAST,node=>{
    if(node.type!=='LocalStatement')return;
    const i=node.variables.findIndex(v=>v.name===prepAlias);
    if(i>=0&&node.init[i]?.type==='MemberExpression')prepareConstantAccess=node.init[i].identifier.name;
  });
  if(!prepareConstantAccess)throw Error('V11 constant preflight method not found');
  const source=entries.find(e=>e.key===bridge.executor).value;
  const proto=/local (\w+)=\w+ and \w+\[1\]/.exec(source)?.[1];
  const paramProtoKey=proto?new RegExp(proto+'\\[(0x[0-9A-Fa-f]+|\\d+)\\] or 0').exec(source)?.[1]:null;
  const resolver={key:layout.resolver.method,valueKey:layout.resolver.valueField,kindKey:layout.resolver.kindField,
    defaultKind:layout.resolver.defaultKind,regKind:layout.resolver.registerKind,immKind:layout.resolver.immediateKind,
    constKinds:layout.resolver.constantKinds,registerStateKey:layout.resolver.registerStateKey,
    constantsStateKey:layout.resolver.constantsStateKey};
  const resolverSource=entries.find(e=>e.key===resolver.key).value;
  const rs=/^\(function\((\w+)/.exec(resolverSource)[1];
  const refs=[...resolverSource.matchAll(new RegExp(rs+'\\.(\\w+) or 0','g'))].map(m=>m[1]);
  resolver.pcContextField=refs[0];
  const bootstrap={executorKey:bridge.executor,envField,handlerField,bitField,antiField,paramProtoKey:Number(paramProtoKey)};
  const prototypeLayout=discoverPrototypeLayout(entries,bootstrap,resolver);
  let closureLayout;
  try{closureLayout=discoverClosureLayout(entries,classifications);}catch{
    const property=[...classifications].find(([,semantic])=>semantic==='closure')?.[0];
    const closureSource=analysis.handlerSources.get(property)??'';
    const closureAST=readableParser.parse('return '+closureSource,{luaVersion:'5.3'}).body[0].arguments[0];
    const declaration=closureAST.body[0],calls=[];
    walk(closureAST,node=>{
      if(node.type!=='CallExpression'||node.arguments.length!==4||node.base.type!=='Identifier')return;
      const args=node.arguments.slice(1);
      if(args.every(a=>a.type==='IndexExpression'&&a.index.type==='NumericLiteral'&&a.base.type==='Identifier')&&
         new Set(args.map(a=>a.base.name)).size===1)calls.push(node);
    });
    if(calls.length!==1||declaration.type!=='LocalStatement')throw Error('V11 closure prototype layout not recognized');
    const call=calls[0];
    const index=declaration.variables.findIndex(v=>v.name===call.base.name);
    const initial=declaration.init[index];
    const builderKey=initial?.type==='MemberExpression'?initial.identifier.name:null;
    if(!builderKey)throw Error('V11 closure builder alias not found');
    const processed=/return \(\w+\.\w+\)\(\w+,\w+,\w+\[(0x[\da-fA-F]+|\d+)\]\)/.exec(source)?.[1];
    if(!processed)throw Error('V11 processed prototype key missing');
    closureLayout={property,builderKey,processedKey:Number(processed),rawKeys:call.arguments.slice(1).map(a=>a.index.value)};
  }
  const closureAST=readableParser.parse('return '+analysis.handlerSources.get(closureLayout.property),{luaVersion:'5.3'}).body[0].arguments[0];
  const topKeys=new Set();
  walk(closureAST,node=>{
    if(node.type==='TableKey'&&node.key.type==='NumericLiteral'&&node.value.type==='BinaryExpression'&&
       node.value.operator==='-'&&node.value.right.type==='NumericLiteral'&&node.value.right.value===1)
      topKeys.add(node.key.value);
  });
  if(topKeys.size!==1)throw Error('V11 closure parameter count state missing');
  const parameterTopKey=[...topKeys][0];
  const dest=discoverDest(entries,analysis.mapping.properties);
  const binary=discoverBinaryConfig(entries,classifications);
  // V11 may split arithmetic and comparisons into independent selector maps.
  const binaryByProperty={};
  for(const [property,semantic] of classifications){
    if(semantic!=='binary')continue;
    const config=discoverBinaryConfig(entries,new Map([[property,'binary']]));
    if(!config?.selector||!Object.keys(config.ops).length)throw Error('V11 binary selector metadata missing for '+property);
    binaryByProperty[property]=config;
  }
  const select={move:discoverExtraSelectorConfig(entries,classifications,'move_select'),
    global:discoverExtraSelectorConfig(entries,classifications,'getglobal_select')};
  const compare=discoverExtraSelectorConfig(entries,classifications,'jump_compare');
  if(compare){
    compare.expressions={};
    const ast=readableParser.parse('return '+analysis.handlerSources.get(compare.property),{luaVersion:'5.3'}).body[0].arguments[0];
    walk(ast,node=>{
      if(node.type!=='IfStatement')return;
      for(const clause of node.clauses){
        if(clause.condition?.type!=='BinaryExpression'||clause.condition.operator!=='=='||clause.condition.right.type!=='NumericLiteral')continue;
        if(clause.body.length!==1||clause.body[0].type!=='AssignmentStatement')continue;
        let expression=clause.body[0].init[0],negate=false;
        if(expression.type==='UnaryExpression'&&expression.operator==='not'){negate=true;expression=expression.argument;}
        if(expression.type==='BinaryExpression'&&['==','~=','<','>','<=','>='].includes(expression.operator))
          compare.expressions[clause.condition.right.value]={operator:expression.operator,negate};
      }
    });
    if(Object.keys(compare.expressions).length!==6)throw Error('V11 comparison selector table incomplete');
  }
  const wrapperProperty=[...classifications].find(([,s])=>s==='dispatch_wrapper')?.[0];
  const wrapperAST=readableParser.parse('return '+analysis.handlerSources.get(wrapperProperty),{luaVersion:'5.3'}).body[0].arguments[0];
  const ins=wrapperAST.parameters[2].name,reads=[],clears=[];
  walk(wrapperAST,node=>{
    if(node.type==='LocalStatement'&&node.init.length===1&&node.init[0].type==='IndexExpression'&&
       node.init[0].base.type==='Identifier'&&node.init[0].base.name===ins&&node.init[0].index.type==='NumericLiteral')
      reads.push(node.init[0].index.value);
    if(node.type==='AssignmentStatement'&&node.variables.length===1&&node.init[0]?.type==='NilLiteral'&&
       node.variables[0].type==='IndexExpression'&&node.variables[0].base.type==='Identifier'&&node.variables[0].base.name===ins)
      clears.push(node.variables[0].index.value);
  });
  const inlineGetter=entries.find(e=>e.key===inlineDecoderKey)?.value??'';
  const inlineListKey=/return \w+\[(0x[\da-fA-F]+|\d+)\] or \{\}/.exec(inlineGetter)?.[1];
  if(reads.length<2||clears.length!==1||!inlineListKey)throw Error('V11 dispatch record layout missing');
  const globalProperty=[...classifications].find(([,s])=>s==='getglobal')?.[0];
  const globalAST=readableParser.parse('return '+analysis.handlerSources.get(globalProperty),{luaVersion:'5.3'}).body[0].arguments[0];
  const globalIns=globalAST.parameters[2].name,primarySlots=new Set();
  walk(globalAST,node=>{
    if(node.type!=='IndexExpression'||node.index.type!=='NumericLiteral')return;
    const base=node.base;
    if(base.type==='LogicalExpression'&&base.operator==='or'&&base.left.type==='IndexExpression'&&
       base.left.base.type==='Identifier'&&base.left.base.name===globalIns&&
       base.left.index.value===layout.operands[0].bundle)primarySlots.add(node.index.value);
  });
  if(primarySlots.size!==1)throw Error('V11 primary operand ordering ambiguous');
  const primaryOperandKey=[...primarySlots][0],secondaryOperandKey=layout.operands.find(o=>o.slot!==primaryOperandKey)?.slot;
  if(secondaryOperandKey===undefined)throw Error('V11 secondary operand ordering missing');
  const instructionLayout={payloadKey:reads[0],extraKey:reads[0],opcodeKey:reads.at(-1),cacheKey:clears[0],inlineListKey:Number(inlineListKey),
    operandsKey:layout.operands[0].bundle,primaryOperandKey,secondaryOperandKey};
  const dispatch=Object.fromEntries([...analysis.mapping.map].map(([id,property])=>[id,{property,semantic:classifications.get(property)}]));
  const nativeFactories=Object.fromEntries(entries.filter(e=>typeof e.key==='number'&&e.isFunction).map(e=>[e.key,e.value]));
  const nativeDirectFunctions={};
  for(const [key,value] of Object.entries(nativeFactories)){
    const text='return '+value,fn=readableParser.parse(text,{luaVersion:'5.3',ranges:true}).body[0].arguments[0];
    const returned=fn.body[0]?.arguments?.[0];
    if(fn.parameters.length===0&&fn.body.length===1&&fn.body[0].type==='ReturnStatement'&&
       fn.body[0].arguments.length===1&&returned?.type==='FunctionDeclaration')nativeDirectFunctions[key]='('+text.slice(...returned.range)+')';
  }
  return {version:'V11',entryMethod:analysis.wrapper.entryMethod,builderKey:analysis.builder.key,runner,bootstrap,
    resolver,prototypeLayout,closureLayout,dest,binary,binaryByProperty,select,compare,inlineDecoderKey,instructionLayout,genericInlineProperty,prepareConstantAccess,parameterTopKey,forwardingMetaKey,fixedArrays,
    handlerMap:{...analysis.mapping,dispatchIds:[...analysis.mapping.map.keys()]},handlerClassifications:classifications,
    nativeFactories,nativeDirectFunctions,keyedStrings,
    dispatch,binaryStores,wrapperIds:Object.entries(dispatch).filter(([,x])=>x.semantic==='dispatch_wrapper').map(([id])=>Number(id)),
    inlineIds:Object.entries(dispatch).filter(([,x])=>x.semantic==='inline').map(([id])=>Number(id))};
}
