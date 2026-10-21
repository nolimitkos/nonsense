import fs from 'node:fs';

// This is the canonical source also used to generate .l15d's roblox_api.luau.
const schema=JSON.parse(fs.readFileSync(new URL('../../dumper/fixtures/roblox_api_schema.json',import.meta.url),'utf8'));
export const apiVersion:string=schema.version;
export function apiMember(className:string,name:string):any {
  const visited=new Set<string>();
  while(className&&!visited.has(className)){
    visited.add(className);const definition=schema.classes[className];
    if(!definition)return undefined;
    if(definition.members[name])return definition.members[name];
    className=definition.superclass;
  }
}

export function inferApiLabels(tree:any):WeakMap<object,string> {
  const labels=new WeakMap<object,string>();
  const field=(n:any)=>n?.type==='MemberExpression'?n.identifier.name:
    n?.type==='IndexExpression'&&n.index.type==='StringLiteral'?n.index.value:null;
  const nonPrimitive=(type:string)=>Boolean(schema.classes[type])||
    !['null','void','bool','boolean','string','int','int64','float','double','Variant','Tuple','Array','Objects','Dictionary','Map','Content','BinaryString'].includes(type)&&/^[_A-Za-z]\w*$/.test(type);
  function expression(n:any,env:Map<string,string>):string|undefined {
    if(!n)return undefined;
    if(n.type==='Identifier')return env.get(n.name);
    if(n.type==='FunctionDeclaration'){
      const child=new Map(env);for(const parameter of n.parameters)if(parameter.name)child.delete(parameter.name);
      block(n.body,child);return undefined;
    }
    if(n.type==='MemberExpression'||n.type==='IndexExpression'){
      const base=expression(n.base,env),name=field(n);
      if(!base||!name)return undefined;
      if(base==='DataModel'&&schema.classes[name]?.tags.includes('Service')){
        labels.set(n,name);return name;
      }
      const member=apiMember(base,name);
      if(member?.kind==='Property'){
        if(nonPrimitive(member.valueType))labels.set(n,name);
        return member.valueType;
      }
      return undefined;
    }
    if(n.type==='CallExpression'){
      for(const argument of n.arguments)expression(argument,env);
      const name=field(n.base),receiver=n.base?.base;
      const type=expression(receiver,env);
      if(receiver?.name==='Instance'&&name==='new'&&n.arguments[0]?.type==='StringLiteral'){
        const className=n.arguments[0].value;
        if(schema.classes[className]){labels.set(n,className);return className;}
      }
      if(type==='DataModel'&&['GetService','FindService','service'].includes(name??'')&&n.arguments[0]?.type==='StringLiteral'){
        const service=n.arguments[0].value;
        if(schema.classes[service]?.tags.includes('Service')){labels.set(n,service);return service;}
      }
      const member=type&&name?apiMember(type,name):undefined;
      if(member?.kind==='Function'&&name==='Clone'){labels.set(n,type!);return type;}
      if(member?.kind==='Function'&&nonPrimitive(member.returnType)){
        labels.set(n,member.returnType);return member.returnType;
      }
      return undefined;
    }
    if(n.type==='BinaryExpression'||n.type==='LogicalExpression'){
      const left=expression(n.left,env),right=expression(n.right,env);
      return n.type==='LogicalExpression'&&left===right?left:undefined;
    }
    return undefined;
  }
  function block(body:any[],env:Map<string,string>){
    for(const statement of body){
      if(['LocalStatement','AssignmentStatement'].includes(statement.type)){
        const types=statement.init.map((value:any)=>expression(value,env));
        statement.variables.forEach((variable:any,index:number)=>{
          if(variable.type==='Identifier'){
            if(types[index])env.set(variable.name,types[index]);else env.delete(variable.name);
          }
        });
      }else if(statement.type==='IfStatement'){
        const branches=statement.clauses.map((clause:any)=>{
          expression(clause.condition,env);const child=new Map(env);block(clause.body,child);return child;
        });
        if(!statement.clauses.some((clause:any)=>!clause.condition))branches.push(new Map(env));
        for(const key of new Set(branches.flatMap((branch:Map<string,string>)=>[...branch.keys()]))){
          const value=branches[0].get(key);
          if(value&&branches.every((branch:Map<string,string>)=>branch.get(key)===value))env.set(key,value);else env.delete(key);
        }
      }else if(statement.type==='FunctionDeclaration'){
        expression(statement,env);if(statement.identifier?.name)env.delete(statement.identifier.name);
      }else if(statement.body){
        const child=new Map(env);block(statement.body,child);
        for(const key of env.keys())if(child.get(key)!==env.get(key))env.delete(key);
      }else if(statement.type==='CallStatement')expression(statement.expression,env);
      else if(statement.type==='ReturnStatement')for(const value of statement.arguments)expression(value,env);
    }
  }
  block(tree.body,new Map([['game','DataModel'],['workspace','Workspace']]));
  return labels;
}
