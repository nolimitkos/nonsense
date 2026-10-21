import {readableParser as parser} from './readable-parser.js';
import {inferApiLabels} from './api-metadata.js';
const reserved=new Set('and break continue do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' '));
const valid=(s:string)=>/^[_A-Za-z]\w*$/.test(s)&&!reserved.has(s);
export function polishReadable(source:string,options:{rename?:boolean}={}):string {
  let tree:any;try{tree=parser.parse(source,{ranges:true,luaVersion:'5.3',encodingMode:'x-user-defined'});}catch{return source;}
  const children=(n:any):any[]=>Object.entries(n).flatMap(([k,v]:any)=>['range','loc','comments'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);
  const walk=(n:any,f:(n:any)=>void)=>{f(n);for(const c of children(n))walk(c,f);};
  const names=new Map<string,string>(),used=new Set<string>();
  const apiLabels=inferApiLabels(tree);
  walk(tree,n=>{if(n.type==='Identifier')used.add(n.name);});
  const field=(n:any)=>n?.type==='MemberExpression'?n.identifier.name:n?.type==='IndexExpression'&&n.index.type==='StringLiteral'?n.index.value:null;
  function suggest(n:any):string|null {
    const inferred=apiLabels.get(n);if(inferred)return inferred;
    if(n.type==='CallExpression'){
      if(field(n.base)==='new'&&n.base.base?.name==='Instance'&&n.arguments[0]?.type==='StringLiteral')return n.arguments[0].value;
      if(field(n.base)==='GetService'&&n.arguments[0]?.type==='StringLiteral')return n.arguments[0].value;
      if(field(n.base)==='GetPlayers')return 'players';
      if(['HttpGet','HttpGetAsync'].includes(field(n.base)??''))return 'httpResponse';
      const method=field(n.base);
      const roles:Record<string,string>={CreateWindow:'window',AddTab:'tab',AddLeftGroupbox:'groupbox',AddRightGroupbox:'groupbox',AddToggle:'toggle',AddSlider:'slider',AddDropdown:'dropdown',AddButton:'button',AddColorPicker:'colorPicker',AddDependencyBox:'dependencyBox',CreateWatermark:'watermark',CreateKeybindList:'keybindList'};
      if(method&&roles[method]){
        const title=n.arguments.find((a:any)=>a.type==='StringLiteral')?.value;
        const prefix=typeof title==='string'?title.replace(/[^A-Za-z0-9]+(.)/g,(_:string,c:string)=>c.toUpperCase()).replace(/[^A-Za-z0-9]/g,''):'';
        return prefix&&/^[A-Za-z]/.test(prefix)?prefix+roles[method][0].toUpperCase()+roles[method].slice(1):roles[method];
      }
    }
    const f=field(n);return ['LocalPlayer','Character','Humanoid','HumanoidRootPart','CurrentCamera','Position','CFrame'].includes(f)?f:null;
  }
  function rename(original:string,label:string){if(options.rename===false||names.has(original))return;label=label[0].toLowerCase()+label.slice(1);if(!valid(label))return;
    let result=label,index=2;while(used.has(result))result=label+index++;
    names.set(original,result);used.add(result);
  }
  walk(tree,n=>{if(n.type==='AssignmentStatement'||n.type==='LocalStatement')n.variables.forEach((v:any,i:number)=>{
    if(v.type==='Identifier'&&/^local_\d+_/.test(v.name)&&n.init[i]){const label=suggest(n.init[i]);if(label)rename(v.name,label);}
  });});
  // Native upvalue records retain useful field names even when VM locals have
  // lost theirs. Use only unambiguous hints, never rewrite the record's keys.
  const hints=new Map<string,Set<string>>();
  walk(tree,n=>{if(n.type!=='AssignmentStatement')return;
    n.variables.forEach((lhs:any,i:number)=>{const rhs=n.init[i],key=field(lhs);
      if(rhs?.type!=='Identifier'||!/^local_\d+_/.test(rhs.name)||!key)return;
      const label=key==='LP'?'localPlayer':key;
      if(!valid(label)||label.length<4||['Parent','Value','Name','Default','Callback'].includes(label))return;
      const values=hints.get(rhs.name)??new Set<string>();values.add(label);hints.set(rhs.name,values);
    });
  });
  for(const [name,labels] of hints)if(labels.size===1)rename(name,[...labels][0]);
  walk(tree,n=>{if(n.type==='Identifier'&&/^local_\d+_/.test(n.name)&&!names.has(n.name))rename(n.name,'var'+n.name.match(/^local_(\d+)/)[1]);});
  const pad=(depth:number)=>'    '.repeat(depth);
  function expr(n:any,depth:number):string {
    let result:string;
    switch(n.type){
      case 'Identifier':return names.get(n.name)??n.name;
      case 'StringLiteral':return n.raw??source.slice(...n.range);
      case 'NumericLiteral':case 'BooleanLiteral':return String(n.value);
      case 'NilLiteral':return 'nil';case 'VarargLiteral':return n.inParens?'(...)':'...';
      case 'MemberExpression':return prefix(n.base,depth)+n.indexer+n.identifier.name;
      case 'IndexExpression':return prefix(n.base,depth)+(n.index.type==='StringLiteral'&&valid(n.index.value)?'.'+n.index.value:'['+expr(n.index,depth)+']');
      case 'UnaryExpression':return '('+n.operator+(n.operator==='not'?' ':'')+expr(n.argument,depth)+')';
      case 'BinaryExpression':case 'LogicalExpression':return '('+expr(n.left,depth)+' '+n.operator+' '+expr(n.right,depth)+')';
      case 'CallExpression':result=prefix(n.base,depth)+'('+n.arguments.map((a:any)=>expr(a,depth)).join(', ')+')';return n.inParens?'('+result+')':result;
      case 'StringCallExpression':return expr(n.base,depth)+'('+expr(n.argument,depth)+')';
      case 'TableCallExpression':return expr(n.base,depth)+'('+expr(n.arguments,depth)+')';
      case 'TableConstructorExpression':{
        const multiline=n.fields.some((f:any)=>f.value?.type==='FunctionDeclaration')||n.fields.length>=4&&n.fields.some((f:any)=>f.type!=='TableValue');
        const fieldDepth=depth+(multiline?1:0);
        const fields=n.fields.map((f:any)=>f.type==='TableKeyString'?f.key.name+' = '+expr(f.value,fieldDepth):f.type==='TableKey'?'['+expr(f.key,fieldDepth)+'] = '+expr(f.value,fieldDepth):expr(f.value,fieldDepth));
        return multiline?'{\n'+fields.map((f:string)=>pad(fieldDepth)+f).join(',\n')+',\n'+pad(depth)+'}':'{'+fields.join(', ')+'}';
      }
      case 'FunctionDeclaration':return 'function('+n.parameters.map((p:any)=>expr(p,depth)).join(', ')+')\n'+block(n.body,depth+1)+pad(depth)+'end';
      default:throw Error('Unsupported formatting expression '+n.type);
    }
  }
  function prefix(n:any,depth:number):string {
    const code=expr(n,depth);
    return ['Identifier','MemberExpression','IndexExpression','CallExpression','StringCallExpression','TableCallExpression'].includes(n.type)?code:'('+code+')';
  }
  function condition(n:any,depth:number):string {
    const rendered=expr(n,depth);
    return ['BinaryExpression','LogicalExpression','UnaryExpression'].includes(n.type)?rendered.slice(1,-1):rendered;
  }
  function block(body:any[],depth:number):string {
    body=body.flatMap((s:any,index:number)=>{
      const next=body[index+1],previous=body[index-1];
      const pair=(a:any,b:any)=>a?.type==='LocalStatement'&&a.init.length===0&&a.variables.length===1&&
        /^local_\d+_/.test(a.variables[0].name)&&b?.type==='AssignmentStatement'&&b.variables.length===1&&
        b.init.length===1&&b.variables[0].type==='Identifier'&&b.variables[0].name===a.variables[0].name&&
        !JSON.stringify(b.init).includes('"name":"'+a.variables[0].name+'"');
      if(pair(s,next))return [];
      if(pair(previous,s))return [{...s,type:'LocalStatement'}];
      return [s];
    });
    return body.map((s,index)=>{
    let line:string;
    switch(s.type){
      case 'LocalStatement':case 'AssignmentStatement':
        if(s.type==='AssignmentStatement'&&s.variables.length===1&&s.variables[0].type==='Identifier'&&s.init.length===1&&s.init[0].type==='FunctionDeclaration'){
          const f=s.init[0];line='function '+expr(s.variables[0],depth)+'('+f.parameters.map((p:any)=>expr(p,depth)).join(', ')+')\n'+block(f.body,depth+1)+pad(depth)+'end';
        }else line=(s.type==='LocalStatement'?'local ':'')+s.variables.map((v:any)=>expr(v,depth)).join(', ')+(s.init.length?' = '+s.init.map((v:any)=>expr(s.variables.length===1&&s.init.length===1?{...v,inParens:false}:v,depth)).join(', '):'');break;
      case 'CallStatement':line=expr(s.expression,depth);break;
      case 'ReturnStatement':line='return'+(s.arguments.length?' '+s.arguments.map((v:any)=>expr(v,depth)).join(', '):'');break;
      case 'BreakStatement':line='break';break;
      case 'ContinueStatement':line='continue';break;
      case 'FunctionDeclaration':line=(s.isLocal?'local ':'')+'function '+expr(s.identifier,depth)+'('+s.parameters.map((p:any)=>expr(p,depth)).join(', ')+')\n'+block(s.body,depth+1)+pad(depth)+'end';break;
      case 'IfStatement':line=s.clauses.map((c:any,i:number)=>(c.condition?(i?'elseif':'if')+' '+condition(c.condition,depth)+' then':'else')+'\n'+block(c.body,depth+1)+pad(depth)).join('')+'end';break;
      case 'WhileStatement':line='while '+condition(s.condition,depth)+' do\n'+block(s.body,depth+1)+pad(depth)+'end';break;
      case 'DoStatement':line='do\n'+block(s.body,depth+1)+pad(depth)+'end';break;
      case 'RepeatStatement':line='repeat\n'+block(s.body,depth+1)+pad(depth)+'until '+condition(s.condition,depth);break;
      case 'ForNumericStatement':line='for '+expr(s.variable,depth)+' = '+expr(s.start,depth)+', '+expr(s.end,depth)+(s.step?', '+expr(s.step,depth):'')+' do\n'+block(s.body,depth+1)+pad(depth)+'end';break;
      case 'ForGenericStatement':line='for '+s.variables.map((v:any)=>expr(v,depth)).join(', ')+' in '+s.iterators.map((v:any)=>expr(v,depth)).join(', ')+' do\n'+block(s.body,depth+1)+pad(depth)+'end';break;
      default:throw Error('Unsupported formatting statement '+s.type);
    }
    if(index>0&&['CallStatement','AssignmentStatement'].includes(s.type)&&line.trimStart().startsWith('('))line=';'+line;
    return pad(depth)+line+'\n';
  }).join('');}
  try{return block(tree.body,0);}catch{return source;}
}
