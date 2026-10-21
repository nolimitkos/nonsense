'use strict';

const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dns = require('dns/promises');
const net = require('net');
const { spawn } = require('child_process');

const { ENGINES, detect, get } = require('./Engines/registry');
const engineRunner = require('./Engines/engine_runner');

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) throw new Error('Missing DISCORD_TOKEN environment variable.');
const PREFIX = process.env.PREFIX || '.';
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 8);
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS || 15 * 60 * 1000);
const MAX_PREVIEW = Number(process.env.MAX_PREVIEW_CHARS || 3500);
const MAX_JOBS = Number(process.env.MAX_JOBS || 2);
const PASTEFY_TOKEN = (process.env.PASTEFY_API_TOKEN || process.env.PASTEFY_API_KEY || process.env.PASTEFY_TOKEN || '').trim();
const PASTEFY_API_URL = process.env.PASTEFY_API_URL || 'https://pastefy.app/api/v2/paste';
const PASTEFY_AUTH_SCHEME = (process.env.PASTEFY_AUTH_SCHEME || 'Bearer').trim();
const DEOB = path.resolve(__dirname, 'Deobfuscator/deob.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const running = new Set();
const pending = new Map();

const SUPPORTED_EXT = /\.(lua|luau|txt)$/i;
const LUA_KEYWORDS = new Set([
  'and','break','do','else','elseif','end','false','for','function','goto','if','in','local','nil','not','or','repeat','return','then','true','until','while',
  'self','type','export','continue','const','using','declare','native','typeof',
]);

function serverEmoji(guild, name, fallback) {
  const e = guild?.emojis?.cache?.find(x => x.name?.toLowerCase() === name.toLowerCase());
  return e ? e.toString() : fallback;
}
function buttonEmoji(guild, name) {
  const e = guild?.emojis?.cache?.find(x => x.name?.toLowerCase() === name.toLowerCase());
  return e ? { id: e.id, name: e.name } : undefined;
}
function E(guild) {
  const names = {
    loading: 'loading', done: 'done', open: 'open', error: 'error', failed: 'failed', preview: 'preview', link: 'link',
    luraph: 'luraph', moonveil: 'Moonveil', hercules: 'hercules', moonsec: 'MoonSec',
    ironbrew2: 'ironbrew2', prometheus: 'prometheus', wrd: 'wrd', pastefy: 'pastefy',
    goofy: 'Goofyscator', ironveil: 'ironveil', sevenf: '77fuscator',
  };
  const fallback = { loading: '⏳', done: '✓', open: '↗', error: '⚠', failed: '×', preview: '◉', link: '🔗', luraph: 'L', moonveil: 'M', hercules: 'H', moonsec: 'MS', ironbrew2: 'IB', prometheus: 'P', wrd: 'WRD', pastefy: 'P', goofy: 'G', ironveil: 'IV', sevenf: '77F' };
  return Object.fromEntries(Object.entries(names).map(([key, name]) => [key, serverEmoji(guild, name, fallback[key])]));
}

function engineEmojiKey(engineId) {
  return ({
    luraph15: 'luraph', luraph14: 'luraph', moonveil: 'moonveil', 'luaobf-good': 'hercules', 'luaobf-evil': 'prometheus',
    ironbrew2: 'ironbrew2', goofy: 'goofy', moonsec2: 'moonsec', ironveil1: 'ironveil', hercules: 'hercules', '77f': 'sevenf', prometheus: 'prometheus', wearedevs: 'wrd'
  })[engineId] || null;
}

function actionVerb(kind) {
  return ({ deobfuscate: 'deobfuscated', beautify: 'beautified', rename: 'renamed', decode: 'decoded', fetch: 'fetched' })[kind] || kind;
}

function makeHeader(obfuscator, kind = 'deobfuscate', date = new Date()) {
  const time = date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  return `-- This file was ${actionVerb(kind)} by Skulx Cli | ${obfuscator} | ${time}`;
}

function stripForeignHeaders(content) {
  let body = String(content).replace(/^\uFEFF/, '').replace(/^\s+/, '');
  const lines = body.split(/\r?\n/);
  const removed = [];
  while (lines.length) {
    const line = lines[0];
    const t = line.trim();
    if (!t) { lines.shift(); removed.push(line); continue; }
    if (/^--/.test(t) && /(deobfuscat|obfuscat|decompiler|decompiler|generated|watermark|credits?|made by|github\.com|discord\.gg|license)/i.test(t)) {
      lines.shift(); removed.push(line); continue;
    }
    break;
  }
  return lines.join('\n').trimStart();
}
function withHeader(content, obfuscator, kind = 'deobfuscate') {
  const body = stripForeignHeaders(content);
  return `${makeHeader(obfuscator, kind)}\n${body}`;
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  const units = ['B', 'KB', 'MB', 'GB'];
  if (n < 1024) return `${n} B`;
  let value = n, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function sourceExtension(sourceLabel, fallback = '.luau') {
  const m = String(sourceLabel || '').match(/\.(lua|luau|txt)(?:$|[?#])/i);
  return m ? `.${m[1].toLowerCase()}` : fallback;
}


function helpEmbed(guild) {
  const e = E(guild);
  return new EmbedBuilder()
    .setTitle(`${e.done} Lua Utility Bot — Commands`)
    .setDescription('Lua/Luau analysis, deobfuscation, formatting, detection and decoding. Supported input: `.lua`, `.luau`, `.txt`.')
    .addFields(
      { name: `${PREFIX}help`, value: 'Show all commands and their purposes.' },
      { name: `${PREFIX}deobf`, value: 'Open buttons to choose a deobfuscator for the attached/replied source.' },
      { name: `${PREFIX}detect`, value: 'Detect the likely obfuscator and show whether this bot has an engine for it.' },
      { name: `${PREFIX}lph`, value: 'Luraph family; opens V15 / V14.7 version choices.' },
      { name: `${PREFIX}luraph`, value: 'Compatibility alias for Luraph V14.7.' },
      { name: `${PREFIX}mv`, value: 'MoonVeil 1.4.5 engine.' },
      { name: `${PREFIX}luaobf`, value: 'LuaObfuscator; opens Chaotic Good / Chaotic Evil choices.' },
      { name: `${PREFIX}ib`, value: 'IronBrew2 deobfuscator.' },
      { name: `${PREFIX}goofy`, value: 'Goofyfuscator v10 engine.' },
      { name: `${PREFIX}ms`, value: 'MoonSec V2 deobfuscator.' },
      { name: `${PREFIX}iv`, value: 'IronVeil V1 deobfuscator.' },
      { name: `${PREFIX}hercules`, value: 'Hercules deobfuscator.' },
      { name: `${PREFIX}7f`, value: '77fuscator deobfuscator.' },
      { name: `${PREFIX}promdeobf`, value: 'Prometheus deobfuscator.' },
      { name: `${PREFIX}wrd`, value: 'WeAreDevs Prometheus-family deobfuscator.' },
      { name: `${PREFIX}get`, value: 'Fetch direct/raw HTTP(S) content only. It rejects HTML pages instead of scraping them.' },
      { name: `${PREFIX}decode`, value: 'Layered decoder for recognized text encodings; never executes decoded code.' },
      { name: `${PREFIX}beautify` + ` / ${PREFIX}beutify`, value: 'Formatting only: lexer-aware Lua/Luau beautification. It does not deobfuscate or rename.' },
      { name: `${PREFIX}rename`, value: 'Maximum safe identifier cleanup for machine-looking locals/variables while preserving strings, comments and property names.' },
    )
    .addFields({ name: 'Deobfuscator aliases', value: ENGINES.map(x => `[1;37m${x.command}[0m — ${x.label}`).join('\n') })
    .setFooter({ text: 'Full outputs are attached. Pastefy uses PASTEFY_API_TOKEN / PASTEFY_API_KEY.' });
}

function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>'"`]+/gi) || [];
  return [...new Set(matches.map(x => x.replace(/[)\]}>,;]+$/g, '')).filter(x => { try { const u = new URL(x); return ['http:', 'https:'].includes(u.protocol); } catch { return false; } }))];
}
function isPrivateIp(ip) {
  if (!net.isIP(ip)) return false;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80:');
}
async function assertSafeUrl(raw) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only HTTP(S) URLs are supported.');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('Local URLs are not allowed.');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('Private/local IP addresses are not allowed.'); return; }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(x => isPrivateIp(x.address))) throw new Error('The URL resolves to a private/local address and was blocked.');
}

async function fetchBuffer(url) {
  let current = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertSafeUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': 'LPH-Discord-Bot/7.0', Accept: 'text/plain, text/x-lua, text/x-luau, application/json;q=0.9, */*;q=0.1' },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error(`Remote server returned HTTP ${res.status} without a redirect target.`);
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) throw new Error(`Remote server returned HTTP ${res.status}.`);
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (/text\/html|application\/xhtml\+xml/.test(contentType)) throw new Error('HTML response rejected: .get only accepts direct/raw source or API content, not HTML pages.');
      const length = Number(res.headers.get('content-length') || 0);
      if (length > MAX_MB * 1024 * 1024) throw new Error(`Remote file is larger than ${MAX_MB} MB.`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_MB * 1024 * 1024) throw new Error(`Remote file is larger than ${MAX_MB} MB.`);
      const textProbe = buf.toString('utf8', 0, Math.min(buf.length, 4096)).trimStart().toLowerCase();
      if (textProbe.startsWith('<!doctype html') || textProbe.startsWith('<html') || textProbe.startsWith('<head') || textProbe.startsWith('<body')) throw new Error('HTML response rejected: direct/raw source expected.');
      return { buffer: buf, finalUrl: current, contentType };
    } catch (e) {
      if (e?.name === 'AbortError') throw new Error('Remote URL fetch timed out.');
      throw e;
    } finally { clearTimeout(timer); }
  }
  throw new Error('Too many redirects.');
}
async function downloadAttachment(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Discord returned HTTP ${res.status}.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_MB * 1024 * 1024) throw new Error(`File is larger than ${MAX_MB} MB.`);
  await fs.writeFile(dest, buf);
  return buf.length;
}
function runV15(input, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DEOB, input, '--output', output], { cwd: path.resolve(__dirname, 'Deobfuscator'), env: { ...process.env, PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; child.kill('SIGKILL'); reject(new Error(`Deobfuscation exceeded ${Math.round(JOB_TIMEOUT_MS / 60000)} minutes.`)); } }, JOB_TIMEOUT_MS);
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', e => { clearTimeout(timer); if (!settled) { settled = true; reject(e); } });
    child.on('close', code => {
      clearTimeout(timer); if (settled) return; settled = true;
      if (code !== 0) return reject(new Error((stderr || stdout).trim().slice(-5000) || `deob.js exited with code ${code}`));
      if (!fsSync.existsSync(output)) return reject(new Error('The V15 engine finished without producing an output file.'));
      resolve({ stdout, stderr });
    });
  });
}

function makePreview(code) {
  const clean = String(code).replace(/\r\n/g, '\n');
  return clean.length <= MAX_PREVIEW ? { text: clean, truncated: false } : { text: clean.slice(0, MAX_PREVIEW) + '\n-- ... preview truncated; full result is attached ...', truncated: true };
}
function safeCodeBlock(code) { return String(code).replace(/```/g, '` ` `'); }
function attachmentFrom(message) { return [...message.attachments.values()].find(a => SUPPORTED_EXT.test(a.name || '')); }
async function repliedMessage(message) { return message.reference?.messageId ? message.fetchReference().catch(() => null) : null; }
function sourceMessages(message, replied) { return [message, replied].filter(Boolean); }
function findSourceAttachment(messages) { for (const m of messages) { const a = attachmentFrom(m); if (a) return { message: m, attachment: a }; } return null; }
function allSourceText(message, replied) { return sourceMessages(message, replied).map(m => m.content || '').join('\n'); }

async function acquireInput(message, args, dir) {
  const replied = await repliedMessage(message);
  const messages = sourceMessages(message, replied);
  const argText = args.join(' ');
  const urls = extractUrls(argText).concat(extractUrls(allSourceText(message, replied))).filter((u, i, a) => a.indexOf(u) === i);
  const found = findSourceAttachment(messages);
  if (urls.length) {
    const r = await fetchBuffer(urls[0]);
    const finalPath = new URL(r.finalUrl).pathname.toLowerCase();
    const ext = /\.luau$/.test(finalPath) ? '.luau' : /\.lua$/.test(finalPath) ? '.lua' : '.txt';
    const input = path.join(dir, `input${ext}`);
    await fs.writeFile(input, r.buffer);
    return { input, label: `${E(message.guild).open} ${r.finalUrl}`, replied };
  }
  if (found) {
    const safeName = path.basename(found.attachment.name).replace(/[^a-zA-Z0-9._-]/g, '_') || 'input.lua';
    const input = path.join(dir, safeName);
    await downloadAttachment(found.attachment.url, input);
    return { input, label: `📎 ${found.attachment.name}`, replied };
  }
  return null;
}
async function withJob(fn) {
  if (running.size >= MAX_JOBS) throw new Error(`There are already ${MAX_JOBS} jobs running. Try again shortly.`);
  const id = crypto.randomUUID(); running.add(id);
  try { return await fn(); } finally { running.delete(id); }
}

async function uploadPastefy(title, content, type = 'LUA') {
  if (!PASTEFY_TOKEN) return { url: null, configured: false, error: 'PASTEFY_API_TOKEN / PASTEFY_API_KEY is not configured.' };
  const auth = /^(?:Bearer|Token)\s+/i.test(PASTEFY_TOKEN) ? PASTEFY_TOKEN : `${PASTEFY_AUTH_SCHEME} ${PASTEFY_TOKEN}`;
  const payload = { title, content, visibility: 'UNLISTED', type, encrypted: false, tags: ['skulx-cli'] };
  const res = await fetch(PASTEFY_API_URL, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  let data = null; try { data = body ? JSON.parse(body) : null; } catch {}
  if (!res.ok) {
    const detail = String(data?.message || data?.error || data?.errors?.[0]?.message || body || `HTTP ${res.status}`).slice(0, 1000);
    return { url: null, configured: true, error: `Pastefy HTTP ${res.status}: ${detail}` };
  }
  const paste = data?.paste || data?.data?.paste || data?.data || data;
  const url = paste?.raw_url || paste?.rawUrl || (paste?.id ? `https://pastefy.app/${paste.id}` : null);
  if (!url) return { url: null, configured: true, error: 'Pastefy returned success but no paste URL/ID.' };
  return { url, configured: true, error: null };
}


function stripLuaCommentsPreservingStrings(code) {
  const out = [];
  let i = 0, quote = null;
  while (i < code.length) {
    const c = code[i];
    if (quote) {
      out.push(c);
      if (c === '\\') { if (i + 1 < code.length) out.push(code[++i]); }
      else if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '"' || c === "'") { quote = c; out.push(c); i++; continue; }
    if (c === '-' && code[i + 1] === '-') {
      const long = code.slice(i).match(/^--(\[=*)\[/);
      if (long) {
        const closer = ']' + long[1].slice(1) + ']';
        const end = code.indexOf(closer, i + long[0].length);
        i = end < 0 ? code.length : end + closer.length;
      } else {
        const end = code.indexOf('\n', i + 2); i = end < 0 ? code.length : end;
      }
      continue;
    }
    out.push(c); i++;
  }
  return out.join('');
}

function tokenizeLua(code) {
  const tokens = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && code[i + 1] === '-') {
      const start = i; const end = code.indexOf('\n', i + 2); i = end < 0 ? code.length : end; tokens.push({ type: 'comment', value: code.slice(start, i) }); continue;
    }
    if (c === '"' || c === "'") {
      const q = c, start = i++; while (i < code.length) { if (code[i] === '\\') i += 2; else if (code[i++] === q) break; } tokens.push({ type: 'string', value: code.slice(start, i) }); continue;
    }
    if (c === '[') {
      const m = code.slice(i).match(/^\[(=*)\[/);
      if (m) { const close = ']' + m[1] + ']'; const end = code.indexOf(close, i + m[0].length); const j = end < 0 ? code.length : end + close.length; tokens.push({ type: 'string', value: code.slice(i, j) }); i = j; continue; }
    }
    const id = code.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (id) { tokens.push({ type: 'id', value: id[0] }); i += id[0].length; continue; }
    const num = code.slice(i).match(/^(?:0[xX][0-9A-Fa-f]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (num) { tokens.push({ type: 'number', value: num[0] }); i += num[0].length; continue; }
    const op = code.slice(i).match(/^(?:\.\.\.|==|~=|<=|>=|::|->|\+=|-=|\*=|\/=|%=|\^=|\.\.)/);
    if (op) { tokens.push({ type: 'op', value: op[0] }); i += op[0].length; continue; }
    tokens.push({ type: 'op', value: c }); i++;
  }
  return tokens;
}

function beautifyLua(code) {
  const tokens = tokenizeLua(code);
  const out = [];
  let line = '', indent = 0;
  const pushLine = () => { const x = line.trim(); if (x) out.push('  '.repeat(Math.max(0, indent)) + x); line = ''; };
  const append = s => { line += s; };
  const prev = () => line.trim().slice(-1);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], v = t.value, next = tokens[i + 1]?.value;
    if (t.type === 'comment') { if (line.trim()) append(' '); append(v); pushLine(); continue; }
    if (t.type === 'string' || t.type === 'number' || t.type === 'id') {
      if (line && !/[.(\[=:]/.test(prev()) && !/^[,;)]/.test(v)) append(' ');
      append(v);
      if (t.type === 'id' && ['then','do','else','elseif','end','until'].includes(v) && (v === 'else' || v === 'elseif')) pushLine();
      continue;
    }
    if (v === ',') { append(','); if (next && next !== ')') append(' '); continue; }
    if (v === ';') { append(';'); pushLine(); continue; }
    if (v === '(' || v === '[') { append(v); continue; }
    if (v === ')' || v === ']') { append(v); continue; }
    if (v === '.') { append('.'); continue; }
    if (v === ':') { append(':'); continue; }
    if (v === '=') { append(' = '); continue; }
    if (/^(==|~=|<=|>=|<|>|\+|-|\*|\/|%|\^|\.\.|and|or)$/.test(v)) { append(` ${v} `); continue; }
    if (v === 'function') { if (line.trim()) pushLine(); append('function'); continue; }
    if (v === 'then' || v === 'do') { append(` ${v}`); pushLine(); indent++; continue; }
    if (v === 'else' || v === 'elseif') { pushLine(); indent = Math.max(0, indent - 1); append(v); if (v === 'elseif') append(' '); else pushLine(); if (v === 'elseif') {} continue; }
    if (v === 'end' || v === 'until') { pushLine(); indent = Math.max(0, indent - 1); append(v); pushLine(); continue; }
    if (v === 'repeat') { if (line.trim()) pushLine(); append(v); pushLine(); indent++; continue; }
    if (v === 'return' || v === 'break' || v === 'continue') { if (line.trim()) append(' '); append(v); if (!next || next === 'end') pushLine(); continue; }
    append(v);
  }
  pushLine();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function renameLua(code) {
  const tokens = tokenizeLua(code);
  const counts = new Map();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'id' || LUA_KEYWORDS.has(tokens[i].value)) continue;
    const v = tokens[i].value;
    if (/^(?:v|var|value|l|local|r|f|fn|func|t|tbl|s|str|string|n|num|number|a|b|c|d|x|y|z)_?\d{1,4}$/i.test(v) || /^_+\d+$/.test(v) || /^[A-Za-z]{1,2}\d{2,5}$/.test(v)) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const candidates = [...counts.entries()].filter(([, c]) => c >= 1).map(([name]) => name);
  const map = new Map();
  let n = 1;
  const names = ['value','data','context','result','function','table','string','number','argument','callback','index','key','item','state','config','buffer','source','target','output'];
  for (const old of candidates) {
    const base = names[(n - 1) % names.length];
    const next = `${base}_${Math.floor((n - 1) / names.length) + 1}`;
    map.set(old, next); n++;
  }
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'id' && map.has(t.value) && tokens[i - 1]?.value !== '.' && tokens[i - 1]?.value !== ':') t.value = map.get(t.value);
    if (t.type === 'comment' || t.type === 'string') out += t.value;
    else { const pv = tokens[i - 1]?.value || ''; const need = out && /[A-Za-z0-9_]$/.test(out) && /^[A-Za-z0-9_]/.test(t.value) && pv !== '.' && pv !== ':'; if (need) out += ' '; out += t.value; }
    if (t.type === 'comment') out += '\n';
  }
  return out;
}

function decodeOnce(text) {
  const trimmed = text.trim();
  if (/^(?:[A-Fa-f0-9]{2})+$/.test(trimmed) && trimmed.length >= 8) {
    try { const b = Buffer.from(trimmed, 'hex'); const s = b.toString('utf8'); if (!s.includes('\uFFFD')) return { out: s, method: 'hex' }; } catch {}
  }
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed) && trimmed.length >= 16) {
    try { const b = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); const s = b.toString('utf8'); if (s && !s.includes('\uFFFD')) return { out: s, method: 'base64' }; } catch {}
  }
  if (/\\(?:x[0-9a-fA-F]{2}|[0-9]{1,3}|n|r|t|v|a|b|f|\\|"|')/.test(text)) {
    const out = text.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\([0-9]{1,3})/g, (_, n) => String.fromCharCode(parseInt(n, 10))).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\v/g, '\v').replace(/\\a/g, '\x07').replace(/\\b/g, '\b').replace(/\\f/g, '\f').replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (out !== text) return { out, method: 'Lua escapes' };
  }
  if (/%[0-9a-fA-F]{2}/.test(text)) { try { const out = decodeURIComponent(text); if (out !== text) return { out, method: 'URL encoding' }; } catch {} }
  return null;
}
function decodeDeep(text) {
  let out = text, methods = [];
  for (let i = 0; i < 8; i++) { const r = decodeOnce(out); if (!r || r.out === out) break; out = r.out; methods.push(r.method); }
  return { out, methods: [...new Set(methods)] };
}

async function sourceForAction(message, args, dir) {
  const source = await acquireInput(message, args, dir);
  if (source) return source;
  const text = args.join(' ') || allSourceText(message, await repliedMessage(message));
  if (text.trim()) {
    const input = path.join(dir, 'inline.lua'); await fs.writeFile(input, text, 'utf8'); return { input, label: 'inline/replied source' };
  }
  return null;
}

function statusEmbed(guild, detectedLabel, deobfuscatingLabel, requestedUser, state = 'working') {
  const e = E(guild);
  const icon = state === 'working' ? e.loading : state === 'done' ? e.done : e.failed;
  const embed = new EmbedBuilder()
    .setTitle(`${icon} Deobfuscation Status`)
    .addFields(
      { name: 'Detected Obfuscator', value: String(detectedLabel || 'Unknown').slice(0, 1024), inline: false },
      { name: 'Deobfuscating', value: String(deobfuscatingLabel || '—').slice(0, 1024), inline: false },
      { name: 'Requested', value: String(requestedUser || 'Unknown').slice(0, 1024), inline: false },
    );
  if (state === 'working') embed.setDescription(`${e.loading} Deobfuscating...`);
  if (state === 'done') embed.setDescription(`${e.done} Deobfuscation completed.`);
  if (state === 'failed') embed.setDescription(`${e.failed} Deobfuscation failed.`);
  return embed;
}

async function finishResult(message, engineLabel, engineId, sourceLabel, output, filename, binary = false, requestedUser = null) {
  const e = E(message.guild);
  const engineIcon = e[engineEmojiKey(engineId)] || e.done;
  if (binary) {
    const bytes = (await fs.stat(output)).size;
    const embed = new EmbedBuilder()
      .setTitle(`${e.done} Deobfuscation complete`)
      .addFields(
        { name: 'Obfuscator', value: `${engineIcon} ${engineLabel}`, inline: false },
        { name: 'Input', value: String(sourceLabel).slice(0, 1024), inline: false },
        { name: 'Output', value: `${formatSize(bytes)} • Lua 5.1 bytecode`, inline: false },
        { name: 'Pastefy', value: `${e.pastefy} Binary output was not uploaded as text.`, inline: false },
      )
      .setFooter({ text: 'Full result attached.' });
    return message.reply({ embeds: [embed], files: [new AttachmentBuilder(output, { name: filename || 'deobfuscated.luac' })] });
  }
  let result = await fs.readFile(output, 'utf8');
  if (!result.trim()) throw new Error('Engine returned an empty result.');
  const resultWithHeader = withHeader(result, engineLabel, 'deobfuscate');
  await fs.writeFile(output, resultWithHeader, 'utf8');
  const bytes = Buffer.byteLength(resultWithHeader, 'utf8');
  const p = makePreview(resultWithHeader);
  const paste = await uploadPastefy(`${engineLabel} — Skulx Cli`, resultWithHeader, 'LUA');
  const embed = new EmbedBuilder()
    .setTitle(`${e.done} Deobfuscation complete`)
    .setDescription(`${e.preview} **Preview:**\n\`\`\`lua\n${safeCodeBlock(p.text)}\n\`\`\``)
    .addFields(
      { name: 'Obfuscator', value: `${engineIcon} ${engineLabel}`, inline: false },
      { name: 'Input', value: String(sourceLabel).slice(0, 1024), inline: false },
      { name: 'Output', value: `${formatSize(bytes)} • source`, inline: false },
      { name: 'Pastefy', value: paste.url ? `${e.pastefy} ${e.link} [Open result](${paste.url})` : `${e.error} ${paste.error || 'Upload failed.'}`, inline: false },
    )
    .setFooter({ text: p.truncated ? 'Preview truncated • full result attached.' : 'Full result attached.' });
  await message.reply({ embeds: [embed], files: [new AttachmentBuilder(output, { name: filename || 'deobfuscated.luau' })] });
}


async function runEngineForMessage(message, args, engineId) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lph-engine-'));
  try {
    await withJob(async () => {
      const source = await sourceForAction(message, args, dir);
      if (!source) throw new Error('No supported `.lua`, `.luau`, or `.txt` source was found. Attach a file, reply to one, paste code, or provide a direct/raw URL.');
      const engine = get(engineId);
      if (!engine) throw new Error(`Unknown engine: ${engineId}`);
      const sourceText = await fs.readFile(source.input, 'utf8');
      const found = detect(sourceText);
      const detectedLabel = found.engine ? found.engine.label : 'Unknown / not confidently detected';
      const status = await message.reply({ embeds: [statusEmbed(message.guild, detectedLabel, engine.label, `<@${message.author.id}>`, 'working')] });
      const out = path.join(dir, engineId === '77f' ? 'result.luac' : 'result.luau');
      if (engineId === 'luraph15') await runV15(source.input, out);
      else {
        const produced = await engineRunner.run(engineId, source.input, out, dir);
        if (produced !== out) await fs.copyFile(produced, out);
      }
      const outName = engineId === '77f' ? '77fuscator.deobfuscated.luac' : `${engineId}.deobfuscated${sourceExtension(source.label, '.luau') === '.txt' ? '.luau' : sourceExtension(source.label, '.luau')}`;
      await finishResult(message, engine.label, engineId, source.label, out, outName, engineId === '77f', `<@${message.author.id}>`);
      await status.edit({ embeds: [statusEmbed(message.guild, detectedLabel, engine.label, `<@${message.author.id}>`, 'done')] }).catch(() => {});
    });
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

function makeButton(guild, customId, label, style, emojiName) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  const x = buttonEmoji(guild, emojiName); if (x) b.setEmoji(x);
  return b;
}
function lphRows(guild, prefix = 'lphver') {
  return [new ActionRowBuilder().addComponents(
    makeButton(guild, `${prefix}:luraph15`, 'Luraph V15', ButtonStyle.Secondary, 'luraph'),
    makeButton(guild, `${prefix}:luraph14`, 'Luraph V14.7', ButtonStyle.Secondary, 'luraph'),
  )];
}
function deobfRows(guild) {
  const specs = [
    ['luraph15', 'Luraph V15', 'luraph'], ['luraph14', 'Luraph 14.7', 'luraph'], ['moonveil', 'MoonVeil 1.4.5', 'moonveil'], ['luaobf-good', 'Chaotic Good', 'hercules'], ['luaobf-evil', 'Chaotic Evil', 'prometheus'],
    ['ironbrew2', 'IronBrew2', 'ironbrew2'], ['goofy', 'Goofy', 'goofy'], ['moonsec2', 'MoonSec V2', 'moonsec'], ['ironveil1', 'IronVeil V1', 'ironveil'], ['hercules', 'Hercules', 'hercules'],
    ['77f', '77fuscator', 'sevenf'], ['prometheus', 'Prometheus', 'prometheus'], ['wearedevs', 'WeAreDevs', 'wrd'],
  ];
  const rows = [];
  for (let i = 0; i < specs.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const [id, label, emoji] of specs.slice(i, i + 5)) row.addComponents(makeButton(guild, `deobf:${id}`, label, ButtonStyle.Secondary, emoji));
    rows.push(row);
  }
  return rows;
}


async function handleDeobf(message, args) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deobf-select-'));
  try {
    const source = await sourceForAction(message, args, dir);
    if (!source) { await fs.rm(dir, { recursive: true, force: true }); return message.reply(`${E(message.guild).error} No supported source found. Attach/reply to a `.lua`, `.luau`, or `.txt` file, or provide a direct/raw URL.`); }
    const copied = path.join(dir, path.basename(source.input)); await fs.copyFile(source.input, copied);
    const id = crypto.randomUUID();
    const embed = new EmbedBuilder().setTitle(`${E(message.guild).open} Choose deobfuscator`).setDescription('Pick the engine that matches the source. **Luraph V14.7 and V15 are selectable from the same Luraph family.**').addFields({ name: 'Source', value: source.label.slice(0, 1024) });
    const selector = await message.reply({ embeds: [embed], components: deobfRows(message.guild) });
    pending.set(id, { sourcePath: copied, sourceLabel: source.label, dir, selectorMessageId: selector.id, ownerId: message.author.id, expires: Date.now() + 10 * 60 * 1000 });
  } catch (e) { await message.reply(`${E(message.guild).error} ${String(e.message || e).slice(0, 1800)}`); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function handleDetect(message, args) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'detect-bot-'));
  try {
    const source = await sourceForAction(message, args, dir);
    if (!source) return message.reply(`${E(message.guild).error} No supported source found.`);
    const text = await fs.readFile(source.input, 'utf8');
    const found = detect(text);
    const e = E(message.guild);
    const embed = new EmbedBuilder().setTitle(`${e.done} Obfuscator Detection`).setDescription(found.engine ? `**Detected:** ${found.engine.label}\n**Confidence:** ${(found.score * 100).toFixed(0)}%\n**Command:** \`${found.engine.command}\`\n**Supported engine:** Yes` : `${e.error} No supported signature matched strongly enough.`).addFields({ name: 'Input', value: source.label.slice(0, 1024) });
    await message.reply({ embeds: [embed] });
  } catch (e) { await message.reply(`${E(message.guild).error} Detect failed: ${String(e.message || e).slice(0, 1800)}`); }
  finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function handleGet(message, args) {
  const replied = await repliedMessage(message);
  const urls = extractUrls(args.join(' ')).concat(extractUrls(allSourceText(message, replied))).filter((u, i, a) => a.indexOf(u) === i);
  if (!urls.length) return message.reply(`Usage: \`${PREFIX}get <direct/raw URL>\` or reply to a message containing one.`);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'get-bot-'));
  try {
    await withJob(async () => {
      const files = [], results = [];
      for (let i = 0; i < urls.length; i++) {
        try {
          const r = await fetchBuffer(urls[i]);
          const ext = /\.luau(?:[?#]|$)/i.test(r.finalUrl) ? '.luau' : /\.lua(?:[?#]|$)/i.test(r.finalUrl) ? '.lua' : '.txt';
          const p = path.join(dir, `fetched_${i + 1}${ext}`); await fs.writeFile(p, r.buffer); files.push(new AttachmentBuilder(p, { name: path.basename(p) }));
          results.push({ url: r.finalUrl, preview: makePreview(r.buffer.toString('utf8')) });
        } catch (e) { results.push({ url: urls[i], error: String(e.message || e) }); }
      }
      const first = results[0];
      const embed = new EmbedBuilder().setTitle(`${E(message.guild).open} Direct/raw fetch`).setDescription(first.error ? `${E(message.guild).failed} ${first.error}` : `**Raw source preview:**\n\`\`\`lua\n${safeCodeBlock(first.preview.text)}\n\`\`\``).setFooter({ text: files.length ? 'Direct/raw source files attached. HTML pages are rejected.' : 'No direct/raw source could be fetched.' });
      await message.reply({ embeds: [embed], files: files.slice(0, 10) });
      if (results.length > 1) await message.reply(results.slice(1).map((x, i) => x.error ? `${E(message.guild).failed} ${i + 2}. ${x.error}` : `${E(message.guild).done} ${i + 2}. ${x.url}`).join('\n').slice(0, 1900));
    });
  } catch (e) { await message.reply(`${E(message.guild).error} Fetch failed: ${String(e.message || e).slice(0, 1800)}`); }
  finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function handleDecode(message, args) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'decode-bot-'));
  try {
    const source = await sourceForAction(message, args, dir);
    if (!source) return message.reply(`${E(message.guild).error} No encoded source found.`);
    const text = await fs.readFile(source.input, 'utf8');
    const r = decodeDeep(text);
    const decoded = withHeader(r.out, 'Generic Encoding', 'decode');
    const output = path.join(dir, 'decoded.txt'); await fs.writeFile(output, decoded, 'utf8');
    const p = makePreview(decoded);
    const embed = new EmbedBuilder().setTitle(`${E(message.guild).done} Decode finished`).setDescription(`**Detected layers:** ${r.methods.length ? r.methods.join(' → ') : 'none'}\n\n**Preview:**\n\`\`\`text\n${safeCodeBlock(p.text)}\n\`\`\``).setFooter({ text: 'Decoder never executes the decoded result.' });
    await message.reply({ embeds: [embed], files: [new AttachmentBuilder(output, { name: 'decoded.txt' })] });
  } catch (e) { await message.reply(`${E(message.guild).error} Decode failed: ${String(e.message || e).slice(0, 1800)}`); }
  finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function handleBeautify(message, args) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'beautify-bot-'));
  try {
    const source = await sourceForAction(message, args, dir);
    if (!source) return message.reply(`${E(message.guild).error} No source found.`);
    const text = await fs.readFile(source.input, 'utf8');
    const pretty = withHeader(beautifyLua(text), 'Lua/Luau', 'beautify');
    const output = path.join(dir, 'beautified.luau'); await fs.writeFile(output, pretty, 'utf8');
    const p = makePreview(pretty);
    const embed = new EmbedBuilder().setTitle(`${E(message.guild).done} Beautify finished`).setDescription(`**Formatting only**\n\n\`\`\`lua\n${safeCodeBlock(p.text)}\n\`\`\``).setFooter({ text: 'No deobfuscation or identifier renaming was performed.' });
    await message.reply({ embeds: [embed], files: [new AttachmentBuilder(output, { name: 'beautified.luau' })] });
  } catch (e) { await message.reply(`${E(message.guild).error} Beautify failed: ${String(e.message || e).slice(0, 1800)}`); }
  finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function handleRename(message, args) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rename-bot-'));
  try {
    const source = await sourceForAction(message, args, dir);
    if (!source) return message.reply(`${E(message.guild).error} No source found.`);
    const text = await fs.readFile(source.input, 'utf8');
    const renamed = withHeader(renameLua(text), 'Lua/Luau', 'rename');
    const output = path.join(dir, 'renamed.luau'); await fs.writeFile(output, renamed, 'utf8');
    const p = makePreview(renamed);
    const embed = new EmbedBuilder().setTitle(`${E(message.guild).done} Rename finished`).setDescription(`**Maximum safe identifier cleanup**\n\n\`\`\`lua\n${safeCodeBlock(p.text)}\n\`\`\``).setFooter({ text: 'Strings, comments and property names are preserved.' });
    await message.reply({ embeds: [embed], files: [new AttachmentBuilder(output, { name: 'renamed.luau' })] });
  } catch (e) { await message.reply(`${E(message.guild).error} Rename failed: ${String(e.message || e).slice(0, 1800)}`); }
  finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function handleDirect(message, args, id) {
  try { await runEngineForMessage(message, args, id); }
  catch (e) { console.error(e); await message.reply(`${E(message.guild).failed} ${String(e.message || e).slice(-3500)}`).catch(() => {}); }
}

client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const [kind, id] = interaction.customId.split(':');
  if (!['deobf', 'lphver'].includes(kind)) return;
  const pendingId = [...pending.keys()].find(k => pending.get(k)?.selectorMessageId === interaction.message.id);
  if (!pendingId) return interaction.reply({ content: `${E(interaction.guild).error} This selector expired. Run the command again.`, ephemeral: true });
  const state = pending.get(pendingId);
  if (state.expires < Date.now()) { pending.delete(pendingId); return interaction.reply({ content: `${E(interaction.guild).error} This selector expired. Run the command again.`, ephemeral: true }); }
  if (state.ownerId && state.ownerId !== interaction.user.id) return interaction.reply({ content: `${E(interaction.guild).error} Only the user who requested this deobfuscation can use these buttons.`, ephemeral: true });
  let engineId = id;
  if (kind === 'lphver' && !['luraph15', 'luraph14'].includes(id)) return interaction.reply({ content: `${E(interaction.guild).error} Unknown Luraph version.`, ephemeral: true });
  const engine = get(engineId);
  if (!engine) return interaction.reply({ content: `${E(interaction.guild).error} Unknown engine.`, ephemeral: true });
  await interaction.deferUpdate();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'deobf-click-'));
  try {
    await withJob(async () => {
      const input = path.join(work, path.basename(state.sourcePath)); await fs.copyFile(state.sourcePath, input);
      const output = path.join(work, engineId === '77f' ? 'result.luac' : 'result.luau');
      const sourceText = await fs.readFile(input, 'utf8');
      const found = detect(sourceText);
      const detectedLabel = found.engine ? found.engine.label : 'Unknown / not confidently detected';
      await interaction.editReply({ embeds: [statusEmbed(interaction.guild, detectedLabel, engine.label, `<@${interaction.user.id}>`, 'working')], components: [] });
      if (engineId === 'luraph15') await runV15(input, output);
      else {
        const produced = await engineRunner.run(engineId, input, output, work);
        if (produced !== output) await fs.copyFile(produced, output);
      }
      const e = E(interaction.guild);
      if (engineId === '77f') {
        const bytes = (await fs.stat(output)).size;
        const embed = statusEmbed(interaction.guild, detectedLabel, engine.label, `<@${interaction.user.id}>`, 'done')
          .addFields(
            { name: 'Obfuscator', value: `${e[engineEmojiKey(engineId)] || e.done} ${engine.label}`, inline: false },
            { name: 'Input', value: String(state.sourceLabel).slice(0, 1024), inline: false },
            { name: 'Output', value: `${formatSize(bytes)} • Lua 5.1 bytecode`, inline: false },
            { name: 'Pastefy', value: `${e.pastefy} Binary output was not uploaded as text.`, inline: false },
          );
        await interaction.editReply({ embeds: [embed], files: [new AttachmentBuilder(output, { name: '77fuscator.deobfuscated.luac' })], components: [] });
      } else {
        let result = await fs.readFile(output, 'utf8');
        if (!result.trim()) throw new Error('Engine returned an empty result.');
        result = withHeader(result, engine.label, 'deobfuscate');
        await fs.writeFile(output, result, 'utf8');
        const bytes = Buffer.byteLength(result, 'utf8');
        const p = makePreview(result);
        const paste = await uploadPastefy(`${engine.label} — Skulx Cli`, result, 'LUA');
        const embed = statusEmbed(interaction.guild, detectedLabel, engine.label, `<@${interaction.user.id}>`, 'done')
          .setDescription(`${e.preview} **Preview:**\n\`\`\`lua\n${safeCodeBlock(p.text)}\n\`\`\``)
          .addFields(
            { name: 'Obfuscator', value: `${e[engineEmojiKey(engineId)] || e.done} ${engine.label}`, inline: false },
            { name: 'Input', value: String(state.sourceLabel).slice(0, 1024), inline: false },
            { name: 'Output', value: `${formatSize(bytes)} • source`, inline: false },
            { name: 'Pastefy', value: paste.url ? `${e.pastefy} ${e.link} [Open result](${paste.url})` : `${e.error} ${paste.error || 'Upload failed.'}`, inline: false },
          )
          .setFooter({ text: p.truncated ? 'Preview truncated • full result attached.' : 'Full result attached.' });
        const extension = sourceExtension(state.sourceLabel, '.luau');
        const outputName = `deobfuscated${extension === '.txt' ? '.luau' : extension}`;
        await interaction.editReply({ embeds: [embed], files: [new AttachmentBuilder(output, { name: outputName })], components: [] });
      }
    });
  } catch (e) {
    await interaction.editReply({ embeds: [statusEmbed(interaction.guild, get(engineId)?.label || 'Unknown', get(engineId)?.label || engineId, `<@${interaction.user.id}>`, 'failed').setDescription(`${E(interaction.guild).failed} ${String(e.message || e).slice(-2500)}`)], components: [] }).catch(() => {});
  } finally { await fs.rm(work, { recursive: true, force: true }).catch(() => {}); pending.delete(pendingId); }
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  const parts = message.content.slice(PREFIX.length).trim().split(/\s+/); const command = (parts.shift() || '').toLowerCase();
  try {
    if (command === 'help') await message.reply({ embeds: [helpEmbed(message.guild)] });
    else if (command === 'deobf') await handleDeobf(message, parts);
    else if (command === 'detect') await handleDetect(message, parts);
    else if (command === 'lph') {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lph-select-'));
      try {
        const source = await sourceForAction(message, parts, dir);
        if (!source) return message.reply(`${E(message.guild).error} No supported source found.`);
        const copied = path.join(dir, path.basename(source.input)); await fs.copyFile(source.input, copied);
        const key = crypto.randomUUID();
        const selector = await message.reply({ embeds: [new EmbedBuilder().setTitle(`${E(message.guild).open} Luraph version`).setDescription('Choose which Luraph engine to use. V14.7 and V15 are separate engines.').addFields({ name: 'Source', value: source.label.slice(0, 1024) })], components: lphRows(message.guild) });
        pending.set(key, { sourcePath: copied, sourceLabel: source.label, dir, selectorMessageId: selector.id, ownerId: message.author.id, expires: Date.now() + 10 * 60 * 1000 });
      } catch (e) { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); throw e; }
    }
    else if (command === 'luraph') await handleDirect(message, parts, 'luraph14');
    else if (command === 'mv') await handleDirect(message, parts, 'moonveil');
    else if (command === 'luaobf') {
      const mode = (parts[0] || '').toLowerCase();
      if (mode === 'good' || mode === 'chaoticgood') await handleDirect(message, parts.slice(1), 'luaobf-good');
      else if (mode === 'evil' || mode === 'chaoticevil') await handleDirect(message, parts.slice(1), 'luaobf-evil');
      else {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('deobf:luaobf-good').setLabel('Chaotic Good').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('deobf:luaobf-evil').setLabel('Chaotic Evil').setStyle(ButtonStyle.Danger),
        );
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luaobf-select-'));
            const source = await sourceForAction(message, [], dir);
        if (!source) { await fs.rm(dir, { recursive: true, force: true }); return message.reply(`${E(message.guild).error} No source found.`); }
        const copied = path.join(dir, path.basename(source.input)); await fs.copyFile(source.input, copied);
        const key = crypto.randomUUID();
        const selector = await message.reply({ content: `${E(message.guild).open} Choose LuaObfuscator type:`, components: [row] });
        pending.set(key, { sourcePath: copied, sourceLabel: source.label, dir, selectorMessageId: selector.id, ownerId: message.author.id, expires: Date.now() + 10 * 60 * 1000 });
      }
    }
    else if (command === 'ib') await handleDirect(message, parts, 'ironbrew2');
    else if (command === 'goofy') await handleDirect(message, parts, 'goofy');
    else if (command === 'ms') await handleDirect(message, parts, 'moonsec2');
    else if (command === 'iv') await handleDirect(message, parts, 'ironveil1');
    else if (command === 'hercules') await handleDirect(message, parts, 'hercules');
    else if (command === '7f') await handleDirect(message, parts, '77f');
    else if (command === 'promdeobf') await handleDirect(message, parts, 'prometheus');
    else if (command === 'wrd') await handleDirect(message, parts, 'wearedevs');
    else if (command === 'get') await handleGet(message, parts);
    else if (command === 'decode') await handleDecode(message, parts);
    else if (command === 'beautify' || command === 'beutify') await handleBeautify(message, parts);
    else if (command === 'rename') await handleRename(message, parts);
  } catch (e) { console.error(e); await message.reply(`${E(message.guild).error} Unexpected bot error.`).catch(() => {}); }
});

setInterval(() => {
  const now = Date.now();
  for (const [id, state] of pending) if (state.expires < now) { pending.delete(id); fs.rm(state.dir, { recursive: true, force: true }).catch(() => {}); }
}, 60_000).unref();

client.login(TOKEN);
