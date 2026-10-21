'use strict';

const ENGINES = [
  { id: 'luraph15', label: 'Luraph V15 • Version 1', command: '.lph', color: 0x5865F2, detect: [/Luraph Obfuscator v15(?!\.1)/i, /This file was protected using Luraph Obfuscator v15(?!\.1)/i] },
  { id: 'luraph15v2', label: 'Luraph V15 • Version 2', command: '.lph', color: 0x5865F2, detect: [/Luraph Obfuscator v15(?!\.1)/i, /This file was protected using Luraph Obfuscator v15(?!\.1)/i] },
  { id: 'luraph151', label: 'Luraph V15.1', command: '.lph151', color: 0x5865F2, detect: [/Luraph Obfuscator v15\.1/i, /Luraph v15\.1/i] },
  { id: 'goofyscator-v11', label: 'Goofyscator V11 BETA-1', command: '.gv11d', color: 0xFEE75C, detect: [/Goofyscator V11/i, /GUF_ENCNUM/i, /Goofy V11/i] },
  { id: 'luraph147', label: 'Luraph V14.7', command: '.lph147', color: 0x5865F2, detect: [/Luraph Obfuscator v14\.7/i, /Luraph v14\.7/i] },
  { id: 'luraph148', label: 'Luraph V14.8', command: '.lph148', color: 0x5865F2, detect: [/Luraph Obfuscator v14\.8/i, /Luraph v14\.8/i] },
  { id: 'luraph149', label: 'Luraph V14.9', command: '.lph149', color: 0x5865F2, detect: [/Luraph Obfuscator v14\.9/i, /Luraph v14\.9/i] },
  { id: 'moonveil', label: 'MoonVeil 1.4.5', command: '.mv', color: 0x5865F2, detect: [/MoonVeil/i, /Moonveil/i, /MV_[A-Z_]+/i] },
  { id: 'luaobf-good', label: 'LuaObfuscator Chaotic Good', command: '.luaobf good', color: 0x57F287, detect: [/Chaotic\s*Good/i, /LuaObfuscator/i, /luaobfuscator/i, /v7\s*\(/i] },
  { id: 'luaobf-evil', label: 'LuaObfuscator Chaotic Evil', command: '.luaobf evil', color: 0xED4245, detect: [/LOL![0-9A-Fa-f2-9Q]+/i, /Chaotic\s*Evil/i, /luaobfuscator/i] },
  { id: 'ironbrew2', label: 'IronBrew2', command: '.ib', color: 0xFAA61A, detect: [/IronBrew/i, /IB2/i, /IronBrew2/i, /\bIB2_[A-Za-z0-9_]+/i] },
  { id: 'goofy', label: 'Goofyfuscator', command: '.goofy', color: 0xFEE75C, detect: [/Goofyfuscator/i, /Goofyscator/i, /Spectra/i, /viT\s*\(/i] },
  { id: 'moonsec2', label: 'MoonSec V2', command: '.ms', color: 0xEB459E, detect: [/MoonSec/i, /MoonSec V2/i, /MOONSEC/i, /MS_[A-Z_]+/i] },
  { id: 'ironveil1', label: 'IronVeil V1', command: '.iv', color: 0x9B59B6, detect: [/Ironveil/i, /IronVeil/i, /\bZ\[1[0-9]\]/i, /__ironveil/i] },
  { id: 'hercules', label: 'Hercules', command: '.hercules', color: 0x5865F2, detect: [/Obfuscated by Hercules/i, /Hercules Obfuscator/i, /WrapState\s*\(\s*BcToState/i, /getfenv\s*\(\s*0\s*\)\s*or\s*_ENV/i] },
  { id: '77f', label: '77fuscator', command: '.7f', color: 0x3498DB, detect: [/77FUS\|/i, /77fuscator/i, /77FUS/i] },
  { id: 'prometheus', label: 'Prometheus', command: '.promdeobf', color: 0x2ECC71, detect: [/Prometheus/i, /Vmify/i, /EncryptStrings/i, /ConstantArray/i, /WrapInFunction/i] },
  { id: 'wearedevs', label: 'WeAreDevs Prometheus', command: '.wrd', color: 0x2ECC71, detect: [/wearedevs\.net/i, /wearedevs/i, /Lua obfuscator.*v1\.0\.0/i] },
  { id: 'luast', label: 'LUAST', command: '.luast', color: 0x3498DB, detect: [/LUAST v1\.0\.1/i, /LUAST/i, /luast_l3/i] },
  { id: 'flowauth', label: 'FlowAuth', command: '.flow', color: 0x9B59B6, detect: [/flowauth\.net/i, /FlowAuth/i, /runtime_keys\.onyx-v1/i] },
  { id: 'hidelat', label: 'hide.lat', command: '.hl', color: 0x95A5A6, detect: [/hide\.lat/i, /hidelat/i, /hidelat lite/i] },
];

function detect(source) {
  const scores = ENGINES.map(engine => {
    let hits = 0;
    for (const re of engine.detect) if (re.test(source)) hits++;
    return { engine, score: hits ? Math.min(0.98, 0.52 + hits * 0.14) : 0 };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scores[0] || { engine: null, score: 0 };
}
function get(id) { return ENGINES.find(x => x.id === id) || null; }
function supportedIds() { return ENGINES.map(x => x.id); }
module.exports = { ENGINES, detect, get, supportedIds };
