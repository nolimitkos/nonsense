'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_ROOT = path.join(ROOT, 'Engines', 'thirdparty');
const TIMEOUT = Number(process.env.JOB_TIMEOUT_MS || 15 * 60 * 1000);
const ENSURE_ENGINE = path.join(ROOT, 'tools', 'ensure-engine.sh');
const ensured = new Set();

function exists(p) { try { return fsSync.existsSync(p); } catch { return false; } }

async function ensureEngine(engine) {
  if (engine === 'luaobf-evil' || ensured.has(engine)) return;
  if (!exists(ENSURE_ENGINE)) throw new Error('Engine installer is missing.');
  await command('bash', [ENSURE_ENGINE, engine], ROOT);
  ensured.add(engine);
}

function command(bin, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill('SIGKILL');
      reject(new Error(`Engine timed out after ${Math.round(TIMEOUT / 60000)} minutes.`));
    }, TIMEOUT);
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', e => { clearTimeout(timer); if (!done) { done = true; reject(e); } });
    child.on('close', code => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      if (code !== 0) reject(new Error((stderr || stdout).trim().slice(-5000) || `engine exited with code ${code}`));
      else resolve({ stdout, stderr });
    });
  });
}

async function newestFile(dir, predicate = () => true) {
  if (!exists(dir)) return null;
  const found = [];
  async function walk(d) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (predicate(p)) found.push(p);
    }
  }
  await walk(dir);
  found.sort((a, b) => fsSync.statSync(b).mtimeMs - fsSync.statSync(a).mtimeMs);
  return found[0] || null;
}

async function runLuaVmp(input, outputDir) {
  const root = path.join(ENGINE_ROOT, 'luau-vmp-deobf');
  if (!exists(root)) throw new Error('Luraph v14.7 / MoonVeil engine is not installed. Run tools/setup-engines.sh.');
  await fs.mkdir(outputDir, { recursive: true });
  const exe = process.env.LUAUVMP_BIN || 'luauvmp';
  await command(exe, ['luraph-full', input, '-o', outputDir, '--no-lua-expert', '--force'], root);
  const preferred = [
    path.join(outputDir, 'embedded_main.luau'),
    path.join(outputDir, 'program.decompiled.luau'),
  ];
  for (const p of preferred) if (exists(p)) return p;
  const p = await newestFile(outputDir, x => /\.(lua|luau)$/i.test(x));
  if (!p) throw new Error('Luraph v14.7/MoonVeil engine produced no Lua/Luau source output.');
  return p;
}

async function runChaoticGood(input, output) {
  const root = path.join(ENGINE_ROOT, 'luaobfuscator-chaoticgood-deobf');
  if (!exists(root)) throw new Error('LuaObfuscator Chaotic Good engine is not installed. Run tools/setup-engines.sh.');
  const script = path.join(root, 'deobfuscate.py');
  if (!exists(script)) throw new Error('LuaObfuscator Chaotic Good deobfuscator.py is missing.');
  const py = process.env.PYTHON_BIN || 'python3';
  const wrapper = `import sys\nsys.path.insert(0, r${JSON.stringify(root)})\ntry:\n from deobfuscate import deobfuscatechaoticgood\nexcept Exception as e:\n raise SystemExit('LuaObfuscator Chaotic Good import failed: '+str(e))\nsrc=open(r${JSON.stringify(input)}, 'r', encoding='utf-8', errors='ignore').read()\nout=deobfuscatechaoticgood(src)\nif not out: raise SystemExit(2)\nopen(r${JSON.stringify(output)}, 'w', encoding='utf-8').write(out)\n`;
  const tmp = path.join(workdir, 'run-luaobf-good.py');
  await fs.writeFile(tmp, wrapper, 'utf8');
  try { await command(py, [tmp], workdir); } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
  if (!exists(output)) throw new Error('LuaObfuscator Chaotic Good produced no output.');
  return output;
}

async function runIronBrew(input, output) {
  const root = path.join(ENGINE_ROOT, 'ironbrew2-deobfuscator');
  if (!exists(root)) throw new Error('IronBrew2 engine is not installed. Run tools/setup-engines.sh.');
  const staged = path.join(root, 'input.lua');
  const out = path.join(root, 'restored.lua');
  await fs.copyFile(input, staged);
  try {
    await command(process.env.PYTHON_BIN || 'python3', ['processor.py'], root);
    if (!exists(out)) throw new Error('IronBrew2 engine finished without restored.lua.');
    await fs.copyFile(out, output);
  } finally {
    await fs.rm(staged, { force: true }).catch(() => {});
    await fs.rm(out, { force: true }).catch(() => {});
  }
  return output;
}

async function runMoonSec(input, output) {
  const root = path.join(ENGINE_ROOT, 'Lua-Deobfuscator');
  if (!exists(root)) throw new Error('MoonSec V2 engine is not installed. Run tools/setup-engines.sh.');
  const staged = path.join(root, 'input.lua');
  await fs.copyFile(input, staged);
  try {
    await command(process.execPath, ['index.js'], root);
    const candidate = await newestFile(path.join(root, 'temp'), x => /\.(lua|luau)$/i.test(x));
    if (!candidate) throw new Error('MoonSec V2 engine produced no Lua/Luau output.');
    await fs.copyFile(candidate, output);
  } finally { await fs.rm(staged, { force: true }).catch(() => {}); }
  return output;
}

async function runGoofy(input, output) {
  const root = path.join(ENGINE_ROOT, 'GoofyscatorEnvlogger');
  if (!exists(root)) throw new Error('Goofyfuscator engine is not installed. Run tools/setup-engines.sh.');
  const script = path.join(root, 'src', 'decompiler.py');
  await command(process.env.PYTHON_BIN || 'python3', [script, input, output, String(Math.ceil(TIMEOUT / 1000))], root, { GOOFYSCATOR_LUNE: process.env.GOOFYSCATOR_LUNE || '' });
  if (!exists(output)) throw new Error('Goofyfuscator engine produced no output file.');
  return output;
}

async function runIronVeil(input, output) {
  const root = path.join(ENGINE_ROOT, 'Ironveil-Deobfuscator-V1', 'deobfuscator');
  if (!exists(root)) throw new Error('IronVeil V1 engine is not installed. Run tools/setup-engines.sh.');
  await command(process.execPath, ['index.js', input, output], root);
  if (!exists(output)) throw new Error('IronVeil V1 engine produced no output file.');
  return output;
}

async function run77f(input, output) {
  const root = path.join(ENGINE_ROOT, '77fuscatorDeobfuscator');
  if (!exists(root)) throw new Error('77fuscator engine is not installed. Run tools/setup-engines.sh.');
  const dll = path.join(root, 'bin', 'Debug', 'net8.0', 'deobfuscator.dll');
  const project = path.join(root, 'deobfuscator.csproj');
  if (!exists(dll) && !exists(project)) throw new Error('77fuscator .NET project is missing.');
  const args = exists(dll) ? [dll, input, '-o', output, '--strings'] : ['run', '--project', project, '--', input, '-o', output, '--strings'];
  await command('dotnet', args, root);
  if (!exists(output)) throw new Error('77fuscator did not produce the expected Lua 5.1 bytecode.');
  return output;
}

async function runPrometheus(input, output) {
  const root = path.join(ENGINE_ROOT, 'Prometheus-Deobfuscator');
  if (!exists(root)) throw new Error('Prometheus engine is not installed.');
  const script = path.join(root, 'bin', 'pdeobf.js');
  if (!exists(script)) throw new Error('Prometheus pdeobf.js is missing.');
  await command(process.execPath, [script, input, '-o', output, '--force'], root);
  if (!exists(output)) {
    const candidate = await newestFile(root, x => /(?:deobf|output|result).*\.(lua|luau)$/i.test(path.basename(x)));
    if (candidate) await fs.copyFile(candidate, output);
  }
  if (!exists(output)) throw new Error('Prometheus engine produced no output file.');
  return output;
}

async function runHercules(input, output) {
  const root = path.join(ENGINE_ROOT, 'hercules-deobfuscator');
  if (!exists(root)) throw new Error('Hercules engine is not installed.');
  const script = path.join(root, 'hercules', 'deobfhercules_fixed', 'deobfhercules.py');
  if (!exists(script)) throw new Error('Hercules deobfuscator entrypoint is missing.');
  await command(process.env.PYTHON_BIN || 'python3', [script, input, output], path.dirname(script));
  if (!exists(output)) throw new Error('Hercules engine produced no output file.');
  return output;
}



async function runLuraphV15V2(input, output) {
  const root = path.join(ENGINE_ROOT, 'luraph-v15-v2');
  const script = path.join(root, 'deob.js');
  if (!exists(script)) throw new Error('Luraph V15 Version 2 engine is not installed. Run tools/setup-engines.sh.');
  await command(process.execPath, [script, input, '--output', output], root);
  if (!exists(output)) throw new Error('Luraph V15 Version 2 produced no output file.');
  return output;
}

async function runLuast(input, output) {
  const root = path.join(ENGINE_ROOT, 'Luast');
  const script = path.join(root, 'deobfuscate.py');
  if (!exists(script)) throw new Error('LUAST engine is not installed. Run tools/setup-engines.sh.');
  await command(process.env.PYTHON_BIN || 'python3', [script, input, '-o', output], root);
  if (!exists(output)) throw new Error('LUAST engine produced no output file.');
  return output;
}

async function runHideLat(input, output) {
  const root = path.join(ENGINE_ROOT, 'hidelat-deobfuscator-byaxom');
  const script = path.join(root, 'main.lua');
  if (!exists(script)) throw new Error('hide.lat engine is not installed. Run tools/setup-engines.sh.');
  const lua = process.env.LUA53_BIN || 'lua5.3';
  await command(lua, [script, input, output], root);
  if (!exists(output)) throw new Error('hide.lat engine produced no output file.');
  return output;
}

async function runFlowAuth(loaderUrl, output, workdir) {
  await ensureEngine('flowauth');
  const root = path.join(ENGINE_ROOT, 'FlowAuth-Deobfuscator');
  const script = path.join(root, 'flowauth_crack', 'flowauth_two_phase.py');
  if (!exists(script)) throw new Error('FlowAuth engine is not installed. Run tools/setup-engines.sh.');
  const sandbox = path.join(ENGINE_ROOT, 'luraph-v15-v2');
  if (!exists(path.join(sandbox, 'core', 'harness.py'))) throw new Error('FlowAuth sandbox dependency is missing.');
  await command(process.env.PYTHON_BIN || 'python3', [script, '--loader-url', loaderUrl], root, { FLOWAUTH_REPO: sandbox });
  const candidate = await newestFile(path.join(root, 'work'), x => /\.lua$/i.test(x) && /payload|deobf|lift|recovered/i.test(path.basename(x)));
  if (!candidate) throw new Error('FlowAuth finished without a recovered Lua/Luau payload.');
  await fs.copyFile(candidate, output);
  return output;
}

async function runLuarmor(loaderUrl, scriptKey, output, workdir) {
  await ensureEngine('luarmor');
  const root = path.join(ENGINE_ROOT, 'Luarmor-Fetch');
  const script = path.join(root, 'main.py');
  if (!exists(script)) throw new Error('Luarmor Fetch engine is not installed. Run tools/setup-engines.sh.');
  const sandbox = path.join(ENGINE_ROOT, 'luraph-v15-v2');
  if (!exists(path.join(sandbox, 'core', 'harness.py'))) throw new Error('Luarmor sandbox dependency is missing.');
  const outDir = path.join(workdir, 'luarmor-out');
  await fs.mkdir(outDir, { recursive: true });
  await command(process.env.PYTHON_BIN || 'python3', [script, 'two-phase', '--loader-url', loaderUrl, '--repo', sandbox, '--output', outDir], root, { LRM_SCRIPT_KEY: scriptKey, LUARMOR_REPO: sandbox });
  const candidate = await newestFile(outDir, x => /\.lua$/i.test(x));
  if (!candidate) {
    const candidate2 = await newestFile(path.join(root, 'work', 'out'), x => /\.lua$/i.test(x));
    if (candidate2) await fs.copyFile(candidate2, output);
  } else await fs.copyFile(candidate, output);
  if (!exists(output)) throw new Error('Luarmor fetch finished without a recovered Lua/Luau source.');
  return output;
}

async function run(engine, input, output, workdir) {
  await ensureEngine(engine);
  switch (engine) {
    case 'luraph14':
    case 'moonveil': return runLuaVmp(input, path.join(workdir, 'vmp-output'));
    case 'luraph15v2': return runLuraphV15V2(input, output);
    case 'luast': return runLuast(input, output);
    case 'hidelat': return runHideLat(input, output);
    case 'luaobf-good': return runChaoticGood(input, output);
    case 'luaobf-evil': {
      const mod = path.join(ROOT, 'Engines', 'luaobf_chaotic_evil.py');
      if (!exists(mod)) throw new Error('Chaotic Evil engine file is missing.');
      const py = process.env.PYTHON_BIN || 'python3';
      const runner = path.join(workdir, 'run-ce.py');
      const code = `import sys\nsys.path.insert(0, r${JSON.stringify(path.dirname(mod))})\nfrom luaobf_chaotic_evil import deobfuscate_chaotic_evil\ns=open(r${JSON.stringify(input)}, 'r', encoding='utf-8', errors='ignore').read()\nout=deobfuscate_chaotic_evil(s)\nif not out: raise SystemExit(2)\nopen(r${JSON.stringify(output)}, 'w', encoding='utf-8').write(out)\n`;
      await fs.writeFile(runner, code, 'utf8');
      await command(py, [runner], workdir);
      return output;
    }
    case 'ironbrew2': return runIronBrew(input, output);
    case 'moonsec2': return runMoonSec(input, output);
    case 'goofy': return runGoofy(input, output);
    case 'ironveil1': return runIronVeil(input, output);
    case '77f': return run77f(input, output);
    case 'prometheus':
    case 'wearedevs': return runPrometheus(input, output);
    case 'hercules': return runHercules(input, output);
    case 'flowauth': throw new Error('FlowAuth requires a loader URL; use the .flow command.');
    case 'luarmor': throw new Error('Luarmor requires a loader URL and script key; use the .luarmor command.');
    default: throw new Error(`Unknown engine '${engine}'.`);
  }
}

module.exports = { run, runFlowAuth, runLuarmor, command, exists };
