import {parseHandlerMap} from '../deobfuscator/upstream/goofy-review/goofyscator/src/discovery/handler-map.js';

const n=s=>/^0x/i.test(s)?parseInt(s,16):Number(s);
const N='(0x[0-9a-fA-F]+|[0-9]+)';
const mod32=x=>((x%4294967296)+4294967296)%4294967296;
function required(match,label){if(!match)throw Error('V11 handler map: '+label+' not found');return match;}

export function discoverHandlerMap(source){
  const initial=parseHandlerMap(source),map=new Map(initial.map),tags=new Map(),rings=[];
  const alphabet=required(/"([A-Za-z0-9_-]{64})"/.exec(source),'six-character alphabet')[1];
  if(new Set(alphabet).size!==64)throw Error('V11 handler map: duplicate alphabet bytes');
  const seed=required(new RegExp('=\\(\\w+ - '+N+'\\) % 0x100000000').exec(source),'seed offset');
  const step=required(new RegExp('(\\w+)=\\(\\1 \\+ '+N+' \\+ (\\w+) \\* '+N+'\\) % 0x100000000').exec(source),'rolling step');
  const feedback=required(new RegExp(step[1]+'=\\('+step[1]+' \\+ \\w+ \\+ '+N+'\\) % 0x100000000').exec(source),'rolling feedback');
  const divisor=n(required(new RegExp('\\w+\\(\\w+ / '+N+'\\)').exec(source),'packed divisor')[1]);
  const single=new RegExp('local\\s+(\\w+)=\\w+\\(\\w+ / '+N+'\\)').exec(source);
  const quotientFirst=new RegExp('local\\s+(\\w+),\\s*\\w+=\\w+\\(\\w+ / '+N+'\\)').exec(source);
  const quotientSecond=new RegExp('local\\s+\\w+,\\s*(\\w+)=\\w+ % '+N+',\\w+\\(\\w+ / '+N+'\\)').exec(source);
  const quotientVar=(single??quotientFirst??quotientSecond)?.[1];
  if(!quotientVar)throw Error('V11 handler map: ambiguous packed-field order');
  const idIsQuotient=new RegExp('\\w+\\['+quotientVar+'\\]=\\w+ and').test(source);
  function word(bytes,offset){
    let result=0;
    for(let i=0;i<6;i++){const digit=alphabet.indexOf(bytes[offset+i]);if(digit<0)throw Error('V11 handler map: invalid alphabet byte');result+=digit*64**i;}
    if(result>=4294967296)throw Error('V11 handler map: word overflow');return result;
  }
  const encoded=/local\s+(\w+)\s*=\s*\w+\.([A-Za-z_]\w*)\s*;\s*\w+\(\1\s*,\s*"([A-Za-z0-9_-]+)"\s*,\s*([01])\s*,\s*(true|false)\)/g;
  for(const match of source.matchAll(encoded)){
    const [,alias,property,bytes,orientation,seedFamily]=match;
    if(bytes.length<12||bytes.length%6)throw Error('V11 handler map: invalid encoded length');
    let state=mod32(word(bytes,0)-n(seed[1]));const ring=[];
    for(let offset=6,index=1;offset<bytes.length;offset+=6,index++){
      state=mod32(state+n(step[2])+index*n(step[4]));
      const encodedWord=word(bytes,offset),decoded=mod32(encodedWord-state);
      state=mod32(state+encodedWord+n(feedback[1]));
      const quotient=Math.floor(decoded/divisor),remainder=decoded-quotient*divisor;
      const tag=idIsQuotient?remainder:quotient,id=idIsQuotient?quotient:remainder;
      if(id<0||id>=131071)throw Error('V11 handler map: invalid dispatch ID');
      if(tag!==0&&(tag<64||tag>=32767))throw Error('V11 handler map: invalid dispatch tag');
      if(map.has(id))throw Error('V11 handler map: duplicate dispatch ID');
      map.set(id,property);tags.set(id,tag);ring.push({id,tag,forwarding:(Number(orientation)+index-1)%2===1,seedFamily:seedFamily==='true'});
    }
    rings.push({property,entries:ring});
  }
  if(!rings.length)throw Error('V11 handler map: no encoded dispatch rings');
  const properties=[...new Set(map.values())];
  if(initial.properties.some(key=>!properties.includes(key)))throw Error('V11 handler map: an erased handler has no dispatch mapping');
  return {map,properties,dispatchIds:[...map.keys()],tags,rings,encoding:{alphabet,seed:n(seed[1]),step:n(step[2]),stride:n(step[4]),feedback:n(feedback[1]),divisor,idIsQuotient}};
}
