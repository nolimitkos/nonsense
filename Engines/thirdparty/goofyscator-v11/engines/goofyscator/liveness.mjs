// Structured CFG liveness over lexical bindings, not identifier spellings.
// Unknown calls can observe captured locals; their stores are never eliminated.
export function analyzeLiveness(symbols){
  const statements=new WeakMap(),graphs=[],captured=new Set(symbols.bindings.filter(b=>b.refs.some(r=>r.fn!==b.fn)));
  const roots=new Map();for(const block of symbols.blocks)if(!roots.has(block.fn))roots.set(block.fn,block.body);
  for(const [fn,body] of roots){
    const refs=symbols.references.filter(r=>r.fn===fn&&r.binding&&!r.write).sort((a,b)=>a.node.range[0]-b.node.range[0]);
    const reads=n=>{
      const out=new Set();if(!n?.range)return out;
      let lo=0,hi=refs.length;while(lo<hi){const mid=(lo+hi)>>1;if(refs[mid].node.range[0]<n.range[0])lo=mid+1;else hi=mid;}
      for(let i=lo;i<refs.length&&refs[i].node.range[0]<n.range[1];i++)if(refs[i].node.range[1]<=n.range[1])out.add(refs[i].binding);
      return out;
    };
    const nodes=[];
    const node=(expression,next=[],defs=[],statement=null)=>{
      const n={use:reads(expression),def:new Set(defs.filter(Boolean)),next:next.filter(Boolean),pred:[],in:new Set(),out:new Set()};
      nodes.push(n);if(statement)statements.set(statement,n);return n;
    };
    const combine=expressions=>{const out=new Set();for(const expression of expressions)for(const b of reads(expression))out.add(b);return out;};
    function sequence(list,next,context){
      let entry=next;for(let i=(list?.length??0)-1;i>=0;i--)entry=statement(list[i],entry,context);return entry;
    }
    function statement(s,next,context){
      if(s.type==='IfStatement'){
        let alternate=next;
        for(let i=s.clauses.length-1;i>=0;i--){const c=s.clauses[i],branch=sequence(c.body,next,context);alternate=c.condition?node(c.condition,[branch,alternate]):branch;}
        return alternate;
      }
      if(s.type==='DoStatement')return sequence(s.body,next,context);
      if(s.type==='WhileStatement'){
        const head=node(s.condition);const entry=sequence(s.body,head,{...context,breakTo:next,continueTo:head});head.next=[entry,next].filter(Boolean);return head;
      }
      if(s.type==='RepeatStatement'){
        const condition=node(s.condition),entry=sequence(s.body,condition,{...context,breakTo:next,continueTo:condition});condition.next=[next,entry].filter(Boolean);return entry;
      }
      if(s.type==='ForNumericStatement'||s.type==='ForGenericStatement'){
        const variables=s.type==='ForNumericStatement'?[s.variable]:s.variables;
        const head=node(null,[],variables.map(n=>symbols.byNode.get(n)));
        const entry=sequence(s.body,head,{...context,breakTo:next,continueTo:head});head.next=[entry,next].filter(Boolean);
        const init=node(null,[head]);init.use=combine(s.type==='ForNumericStatement'?[s.start,s.end,s.step]:s.iterators);return init;
      }
      if(s.type==='BreakStatement')return node(null,[context.breakTo]);
      if(s.type==='ContinueStatement')return node(null,[context.continueTo]);
      if(s.type==='ReturnStatement')return node(s,[]);
      const defs=['LocalStatement','AssignmentStatement'].includes(s.type)?s.variables.filter(n=>n.type==='Identifier').map(n=>symbols.byNode.get(n)):
        s.type==='FunctionDeclaration'&&s.identifier?.type==='Identifier'?[symbols.byNode.get(s.identifier)]:[];
      return node(s,[next],defs,s);
    }
    const exit=node(null),entry=sequence(body,exit,{});
    for(const n of nodes)for(const successor of n.next)successor.pred.push(n);
    const work=[...nodes],queued=new Set(nodes);let iterations=0;
    while(work.length){
      const n=work.pop();queued.delete(n);iterations++;
      const out=new Set();for(const successor of n.next)for(const b of successor.in)out.add(b);
      const incoming=new Set(n.use);for(const b of out)if(!n.def.has(b))incoming.add(b);
      const changed=incoming.size!==n.in.size||[...incoming].some(b=>!n.in.has(b));n.in=incoming;n.out=out;
      if(changed)for(const predecessor of n.pred)if(!queued.has(predecessor)){queued.add(predecessor);work.push(predecessor);}
    }
    graphs.push({fn,entry,nodes,iterations});
  }
  return {statements,graphs,captured};
}
