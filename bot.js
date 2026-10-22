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
const http = require('http');
const { spawn } = require('child_process');

const { ENGINES, detect, get } = require('./Engines/registry');
const engineRunner = require('./Engines/engine_runner');
const { detectGames } = require('./GameDetector');

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
const resultCache = new Map();

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
    luraph: 'luraph', luarmor: 'luarmor', moonveil: 'Moonveil', hercules: 'hercules', luaobf: 'luaobf', moonsec: 'MoonSec',
    ironbrew2: 'ironbrew2', prometheus: 'prometheus', wrd: 'wrd', pastefy: 'pastefy',
    goofy: 'Goofyscator', ironveil: 'ironveil', sevenf: '77fuscator',
  };
  const fallback = { loading: '⏳', done: '✓', open: '↗', error: '⚠', failed: '×', preview: '◉', link: '🔗', luarmor: 'LF', luraph: 'L', moonveil: 'M', hercules: 'H', moonsec: 'MS', ironbrew2: 'IB', prometheus: 'P', wrd: 'WRD', pastefy: 'P', luaobf: 'LO', goofy: 'G', ironveil: 'IV', sevenf: '77F' };
  return Object.fromEntries(Object.entries(names).map(([key, name]) => [key, serverEmoji(guild, name, fallback[key])]));
}

function engineEmojiKey(engineId) {
  return ({
    luraph15: 'luraph', luraph15v2: 'luraph', luraph151: 'luraph', 'goofyscator-v11': 'goofy', luraph14: 'luraph', luraph147: 'luraph', luraph148: 'luraph', luraph149: 'luraph', luarmor: 'luarmor', moonveil: 'moonveil', 'luaobf-good': null, 'luaobf-evil': null,
    ironbrew2: 'ironbrew2', goofy: 'goofy', moonsec2: 'moonsec', ironveil1: 'ironveil', hercules: 'hercules', '77f': 'sevenf', prometheus: 'prometheus', wearedevs: 'wrd', luast: null, flowauth: null, hidelat: null
  })[engineId] || null;
}

function actionVerb(kind) {
  return ({ deobfuscate: 'deobfuscated', beautify: 'beautified', rename: 'renamed', decode: 'decoded', fetch: 'fetched' })[kind] || kind;
}

function makeHeader(obfuscator, kind = 'deobfuscate', date = new Date()) {
  if (kind === 'deobfuscate') return '-- This file was deobfuscated by Skulx Cli';
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
    if (/^--/.test(t) && /(deobfuscat|devirtualiz|obfuscat|decompiler|generated|watermark|credits?|made by|github\.com|discord\.gg|license)/i.test(t)) {
      lines.shift(); removed.push(line); continue;
    }
    break;
  }
  return lines.join('\n').trimStart();
}
function withHeader(content, obfuscator, kind = 'deobfuscate') {
  const body = stripForeignHeaders(content);
  return kind === 'deobfuscate' ? `${makeHeader(obfuscator, kind)}\n\n${body}` : `${makeHeader(obfuscator, kind)}\n${body}`;
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
  const commandGroups = [
    {
      name: 'General',
      commands: [
        [`${PREFIX}help`, 'Show all commands and their purposes.'],
        [`${PREFIX}deobf`, 'Open the interactive deobfuscator selector for an attached, replied-to, or linked source.'],
        [`${PREFIX}detect`, 'Detect the likely obfuscator and whether an engine is available.'],
        [`${PREFIX}game`, 'Detect Roblox game names and PlaceIds from source text.'],
        [`${PREFIX}preview`, 'Preview source without modifying it.'],
        [`${PREFIX}paste`, 'Upload source/code to Pastefy.'],
      ],
    },
    {
      name: 'Luraph and Lua engines',
      commands: [
        [`${PREFIX}lph`, 'Choose Luraph V15, V15.1, V14.7, V14.8, or V14.9.'],
        [`${PREFIX}lph147`, 'Run the Luraph V14.7 backend directly.'],
        [`${PREFIX}lph148`, 'Run the Luraph V14.8 backend directly.'],
        [`${PREFIX}lph149`, 'Run the Luraph V14.9 backend directly.'],
        [`${PREFIX}lph151`, 'Run the separate Luraph V15.1 backend directly.'],
        [`${PREFIX}luaobf`, 'Choose Chaotic Good / Chaotic Evil; or use `.luaobf good` and `.luaobf evil`.'],
        [`${PREFIX}mv`, 'MoonVeil 1.4.5.'],
        [`${PREFIX}luast`, 'LUAST deobfuscator.'],
        [`${PREFIX}hl`, 'hide.lat lite deobfuscator.'],
        [`${PREFIX}flow`, 'FlowAuth deobfuscation/fetch pipeline.'],
        [`${PREFIX}ib`, 'IronBrew2 deobfuscator.'],
        [`${PREFIX}goofy`, 'Goofyfuscator V10.'],
        [`${PREFIX}ms`, 'MoonSec V2.'],
        [`${PREFIX}iv`, 'IronVeil V1.'],
        [`${PREFIX}hercules`, 'Hercules deobfuscator.'],
        [`${PREFIX}7f`, '77fuscator deobfuscator.'],
        [`${PREFIX}promdeobf`, 'Prometheus deobfuscator.'],
        [`${PREFIX}wrd`, 'WeAreDevs Prometheus-family deobfuscator.'],
      ],
    },
    {
      name: 'Utilities',
      commands: [
        [`${PREFIX}luarmor`, 'Fetch authorized Luarmor loaders using a configured or supplied script key.'],
        [`${PREFIX}get`, 'Fetch direct/raw HTTP(S) source; HTML pages are rejected.'],
        [`${PREFIX}decode`, 'Decode recognized text encodings without executing the result.'],
        [`${PREFIX}beautify / ${PREFIX}beutify`, 'Format Lua/Luau only; does not deobfuscate or rename.'],
        [`${PREFIX}rename`, 'Safely clean machine-looking identifiers while preserving strings, comments, and property names.'],
      ],
    },
  ];

  const fields = [];
  for (const group of commandGroups) {
    let chunk = [];
    let length = 0;
    for (const [command, description] of group.commands) {
      const line = `**${command}** — ${description}`;
      const extra = line.length + (chunk.length ? 1 : 0);
      if (length + extra > 1000 && chunk.length) {
        fields.push({ name: group.name, value: chunk.join('\n'), inline: false });
        chunk = [];
        length = 0;
      }
      chunk.push(line);
      length += line.length + (chunk.length > 1 ? 1 : 0);
    }
    if (chunk.length) fields.push({ name: group.name, value: chunk.join('\n'), inline: false });
  }

  const aliases = ENGINES.map(x => `**${x.command}** — ${x.label}`);
  let aliasChunk = [];
  let aliasLength = 0;
  for (const alias of aliases) {
    const extra = alias.length + (aliasChunk.length ? 1 : 0);
    if (aliasLength + extra > 1000 && aliasChunk.length) {
      fields.push({ name: 'Deobfuscator aliases', value: aliasChunk.join('\n'), inline: false });
      aliasChunk = [];
      aliasLength = 0;
    }
    aliasChunk.push(alias);
    aliasLength += alias.length + (aliasChunk.length > 1 ? 1 : 0);
  }
  if (aliasChunk.length) fields.push({ name: 'Deobfuscator aliases', value: aliasChunk.join('\n'), inline: false });

  return new EmbedBuilder()
    .setTitle(`${e.done} Lua Utility Bot — Commands`)
    .setDescription('Lua/Luau analysis, deobfuscation, formatting, detection and decoding. Supported input: `.lua`, `.luau`, `.txt`.')
    .addFields(fields)
    .setFooter({ text: 'Full outputs are attached. Pastefy requires PASTEFY_API_TOKEN / PASTEFY_API_KEY.' });
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
function resultButtons(guild, cacheId, pasteUrl = null) {
  const row = new ActionRowBuilder();
  row.addComponents(makeButton(guild, `copyresult:${cacheId}`, 'Copy Output', ButtonStyle.Secondary, 'preview'));
  if (pasteUrl) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Pastefy').setURL(pasteUrl));
  return row;
}
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

async function uploadPastefy(title, content, type = 'PASTE') {
  if (!PASTEFY_TOKEN) return { url: null, configured: false, error: 'PASTEFY_API_TOKEN / PASTEFY_API_KEY is not configured.' };
  const auth = /^(?:Bearer|Token)\s+/i.test(PASTEFY_TOKEN) ? PASTEFY_TOKEN : `Bearer ${PASTEFY_TOKEN}`;
  // Keep the request deliberately minimal. Pastefy's API accepts title/content and
  // optional paste metadata; sending an unsupported type/tags combination can result
  // in a server-side 500 on some Pastefy deployments.
  const payload = {
    title: String(title).slice(0, 255),
    content: String(content),
    encrypted: false,
    visibility: 'UNLISTED',
    type: 'PASTE',
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(PASTEFY_API_URL, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.text();
    let data = null; try { data = body ? JSON.parse(body) : null; } catch {}
    if (!res.ok) {
      const detail = String(data?.message || data?.error || data?.exception || data?.errors?.[0]?.message || body || `HTTP ${res.status}`).slice(0, 1200);
      return { url: null, configured: true, error: `Pastefy HTTP ${res.status}: ${detail}` };
    }
    const paste = data?.paste || data?.data?.paste || data?.data || data;
    const url = paste?.raw_url || paste?.rawUrl || (paste?.id ? `https://pastefy.app/${paste.id}/raw` : null);
    if (!url) return { url: null, configured: true, error: 'Pastefy returned success but no paste URL/ID.' };
    return { url, configured: true, error: null };
  } catch (err) {
    return { url: null, configured: true, error: err?.name === 'AbortError' ? 'Pastefy request timed out.' : `Pastefy request failed: ${err?.message || err}` };
  } finally {
    clearTimeout(timer);
  }
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

function beautifyLua(code, maxLine = 120) {
  // Word-wrap only. We NEVER insert a character that was not already present.
  // A line break can only replace an existing whitespace run outside strings/comments.
  // Therefore the token stream remains byte-for-byte identical apart from whitespace.
  const src = String(code).replace(/\r\n?/g, '\n');
  const out = [];
  let line = '';
  let i = 0;
  let quote = null;
  let longClose = null;
  let comment = false;

  const flush = () => { out.push(line); line = ''; };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { flush(); i++; comment = false; continue; }

    if (comment) { line += c; i++; continue; }
    if (longClose) {
      if (src.startsWith(longClose, i)) { line += longClose; i += longClose.length; longClose = null; }
      else { line += c; i++; }
      continue;
    }
    if (quote) {
      line += c;
      if (c === '\\' && i + 1 < src.length) { line += src[i + 1]; i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '-' && src[i + 1] === '-') {
      const lm = src.slice(i).match(/^--(\[=*)\[/);
      if (lm) { const opener = lm[0]; longClose = ']' + lm[1].slice(1) + ']'; line += opener; i += opener.length; continue; }
      line += '--'; i += 2; comment = true; continue;
    }
    if (c === '"' || c === "'") { quote = c; line += c; i++; continue; }
    if (c === '[') {
      const lm = src.slice(i).match(/^\[(=*)\[/);
      if (lm) { const opener = lm[0]; longClose = ']' + lm[1] + ']'; line += opener; i += opener.length; continue; }
    }
    if (c === ' ' || c === '\t') {
      let j = i + 1;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
      const ws = src.slice(i, j);
      // Only replace existing whitespace with a newline when the next token fits
      // on a fresh line. This avoids splitting identifiers, literals or operators.
      if (line.length >= maxLine && line.trim().length && j < src.length && src[j] !== '\n') flush();
      else line += ws;
      i = j; continue;
    }
    line += c; i++;
  }
  if (line.length || src.endsWith('\n')) flush();
  return out.join('\n');
}

function renameLua(code) {
  const src = String(code);
  const tokens = tokenizeLua(src);
  const suspicious = new Set();
  const safeNames = new Set(['game','workspace','script','shared','_G','_ENV','task','coroutine','math','string','table','os','io','debug','utf8','bit32','Enum','Instance','UDim2','UDim','Vector2','Vector3','CFrame','Color3','BrickColor','RaycastParams','TweenInfo','Random','pcall','xpcall','require','error','warn','print','assert','pairs','ipairs','next','select','tonumber','tostring','type','typeof','setmetatable','getmetatable','rawget','rawset','rawequal','unpack','table','string','math']);

  const machine = v =>
    !safeNames.has(v) && (
      /^[A-Za-z]$/.test(v) ||
      /^_+\d+$/.test(v) ||
      /^(?:v|var|value|data|context|result|function|table|string|number|argument|callback|index|key|item|state|config|buffer|source|target|output|local|str|num|obj|tbl|tmp|ret|arg|fn|func|res|val|env|obj|ref|tmp|unk|unknown)_?\d{1,5}$/i.test(v) ||
      /^[A-Za-z]{1,3}\d{2,8}$/.test(v)
    );

  for (const t of tokens) if (t.type === 'id' && !LUA_KEYWORDS.has(t.value) && machine(t.value)) suspicious.add(t.value);

  const stats = new Map();
  const stat = (name, key, n = 1) => { const s = stats.get(name) || {}; s[key] = (s[key] || 0) + n; stats.set(name, s); };
  const valuesAround = i => tokens.slice(Math.max(0, i - 8), Math.min(tokens.length, i + 14)).map(t => t.value).join(' ');

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]; if (t.type !== 'id' || !suspicious.has(t.value)) continue;
    const n = t.value, prev = tokens[i-1]?.value, next = tokens[i+1]?.value, after = tokens.slice(i+1, i+15).map(t=>t.value).join(' ');
    if (prev === '.' || prev === ':') stat(n, 'property');
    if (prev === 'local') stat(n, 'declaration');
    if (next === '(') stat(n, 'call');
    if (next === '[') stat(n, 'index');
    if (next === '=') stat(n, 'assign');
    if (prev === 'function') stat(n, 'function');
    if (/GetService\s*\(/.test(after)) stat(n, 'service');
    if (/WaitForChild\s*\(|FindFirstChild\s*\(/.test(after)) stat(n, 'child');
    if (/Connect\s*\(/.test(after)) stat(n, 'connection');
    if (/Instance\s*\.\s*new\s*\(/.test(after)) stat(n, 'instance');
    if (/UDim2\s*\[|UDim2\s*\(/.test(after)) stat(n, 'uiSize');
    if (/Color3\s*\[|Color3\s*\(/.test(after)) stat(n, 'color');
    if (/Vector[23]\s*\[|Vector[23]\s*\(/.test(after)) stat(n, 'vector');
    if (/CFrame\s*\[|CFrame\s*\(/.test(after)) stat(n, 'cframe');
    if (/Enum\s*\[/.test(after)) stat(n, 'enum');
    if (/string\s*\[|string\s*\./.test(after)) stat(n, 'stringApi');
    if (/table\s*\[|table\s*\./.test(after)) stat(n, 'tableApi');
    if (/math\s*\[|math\s*\./.test(after)) stat(n, 'mathApi');
    if (/^=\s*\{/.test(after)) stat(n, 'tableValue');
    if (/^=\s*function\b/.test(after) || next === 'function') stat(n, 'functionValue');
    if (/^=\s*(?:true|false)\b/.test(after)) stat(n, 'boolean');
    if (/^=\s*(?:"|')/.test(after)) stat(n, 'stringValue');
    if (/^=\s*(?:0x|\d)/.test(after)) stat(n, 'numberValue');
  }

  // Extract useful API names from dynamic access such as string["gmatch"] and
  // use them as semantic hints for the identifier immediately receiving the value.
  const hints = new Map();
  const addHint = (name, hint, weight=3) => {
    const arr = hints.get(name) || []; arr.push([hint, weight]); hints.set(name, arr);
  };
  for (let i=0;i<tokens.length-4;i++) {
    if (tokens[i].type !== 'id' || !suspicious.has(tokens[i].value)) continue;
    const n=tokens[i].value;
    const slice=tokens.slice(i, i+12).map(t=>t.value);
    const joined=slice.join(' ');
    if (/GetService/.test(joined)) addHint(n,'service');
    if (/WaitForChild|FindFirstChild/.test(joined)) addHint(n,'child');
    if (/Connect/.test(joined)) addHint(n,'connection');
    const api=joined.match(/(?:string|table|math|task)\s*(?:\.|\[\s*['"])([A-Za-z_][A-Za-z0-9_]*)/);
    if (api) addHint(n, api[1].replace(/^(gmatch|match|gsub|sub)$/,'patternMatcher').replace(/^concat$/,'join').replace(/^random$/,'randomNumber').replace(/^floor$/,'floor').replace(/^remove$/,'removeItem').replace(/^insert$/,'insertItem'));
    if (/Instance\s*\.\s*new/.test(joined)) addHint(n,'instance');
    if (/UDim2/.test(joined)) addHint(n,'uiSize');
    if (/Color3/.test(joined)) addHint(n,'color');
    if (/Vector[23]/.test(joined)) addHint(n,'vector');
    if (/CFrame/.test(joined)) addHint(n,'cframe');
    if (/Enum/.test(joined)) addHint(n,'enum');
  }

  // Assignment-level inference is deliberately stronger than broad nearby-token
  // inference. This keeps unrelated identifiers from all becoming "service" or
  // "number" just because the same line contains an API call.
  const assignmentHints = new Map();
  const addAssignmentHint = (name, hint, weight = 10) => {
    const arr = assignmentHints.get(name) || []; arr.push([hint, weight]); assignmentHints.set(name, arr);
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'id' || !suspicious.has(t.value)) continue;
    if (tokens[i + 1]?.value !== '=') continue;
    const rhs = tokens.slice(i + 2, Math.min(tokens.length, i + 18));
    const vals = rhs.map(x => x.value);
    const text = vals.join(' ');
    const first = vals[0] || '';
    if (vals.includes('GetService')) addAssignmentHint(t.value, 'service', 30);
    if (vals.includes('WaitForChild') || vals.includes('FindFirstChild')) addAssignmentHint(t.value, 'child', 28);
    if (vals.includes('Connect')) addAssignmentHint(t.value, 'connection', 28);
    if (vals.includes('Instance') && vals.includes('new')) addAssignmentHint(t.value, 'instance', 25);
    if (vals.includes('UDim2')) addAssignmentHint(t.value, 'uiSize', 24);
    if (vals.includes('Color3')) addAssignmentHint(t.value, 'color', 24);
    if (vals.includes('Vector2') || vals.includes('Vector3')) addAssignmentHint(t.value, 'vector', 24);
    if (vals.includes('CFrame')) addAssignmentHint(t.value, 'cframe', 24);
    if (vals.includes('Enum')) addAssignmentHint(t.value, 'enum', 24);
    if (first === 'function') addAssignmentHint(t.value, 'handler', 24);
    if (first === '{') addAssignmentHint(t.value, 'table', 18);
    if (first === 'true' || first === 'false') addAssignmentHint(t.value, 'flag', 18);
    if (/^(?:string|table|math|task)$/.test(first) && vals[1] === '[') {
      const literal = vals.find((v,j) => j > 1 && /^['"].*['"]$/.test(v));
      if (literal) {
        const api = literal.slice(1,-1);
        const apiNames = {
          gmatch:'patternMatcher', match:'patternMatcher', gsub:'replaceText', sub:'substring',
          concat:'joinText', random:'randomNumber', floor:'floorValue', ceil:'ceilValue',
          remove:'removeItem', insert:'insertItem', len:'length', byte:'byteValue', char:'charValue',
          tonumber:'toNumber', tostring:'toString'
        };
        addAssignmentHint(t.value, apiNames[api] || api, 22);
      }
    }
    if (first === 'tostring') addAssignmentHint(t.value, 'text', 20);
    if (first === 'tonumber') addAssignmentHint(t.value, 'number', 20);
    if (first === 'pcall' || first === 'xpcall') addAssignmentHint(t.value, 'protectedCall', 25);
  }

  // Short functions repeatedly invoked as d(...), f(...), k(...), etc. are often
  // decoder/lookup helpers in generated obfuscator output. Prefer decoder only when
  // the source also shows string/byte/tonumber operations nearby.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'id' || !suspicious.has(t.value) || tokens[i + 1]?.value !== '(') continue;
    const near = tokens.slice(Math.max(0, i - 20), Math.min(tokens.length, i + 25)).map(x => x.value).join(' ');
    if (/tonumber|tostring|string|byte|char|gsub|gmatch|sub/.test(near)) addAssignmentHint(t.value, 'decoder', 18);
  }

  const bases = {
    service:'service', child:'child', connection:'connection', instance:'instance', uiSize:'uiSize', color:'color', vector:'vector', cframe:'cframe', enum:'enum',
    patternMatcher:'patternMatcher', replaceText:'replaceText', substring:'substring', joinText:'joinedText', randomNumber:'randomNumber', floorValue:'floorValue', ceilValue:'ceilValue', removeItem:'removedItem', insertItem:'insertedItem', length:'length', byteValue:'byteValue', charValue:'charValue', toNumber:'numberValue', toString:'text', protectedCall:'protectedCall', join:'joinedText',
    stringApi:'stringValue', tableApi:'tableValue', mathApi:'mathValue', tableValue:'table', functionValue:'handler', function:'handler', boolean:'flag', stringValue:'text', numberValue:'number',
    decoder:'decoder', environment:'environment', index:'index', callback:'callback', result:'result', state:'state', buffer:'buffer', source:'source', target:'target', output:'output', value:'value'
  };
  const used = new Set([...safeNames, ...LUA_KEYWORDS]);
  const counts = Object.create(null);
  const makeName = base => {
    base = String(base || 'value').replace(/[^A-Za-z0-9_]/g,'_');
    if (!/^[A-Za-z_]/.test(base)) base = '_' + base;
    counts[base] = (counts[base] || 0) + 1;
    let candidate = counts[base] === 1 ? base : `${base}_${counts[base]}`;
    while (used.has(candidate)) { counts[base]++; candidate=`${base}_${counts[base]}`; }
    used.add(candidate); return candidate;
  };

  const map = new Map();
  const scoredBase = name => {
    const arr = [...(hints.get(name) || []), ...(assignmentHints.get(name) || [])];
    const score = new Map(); for (const [h,w] of arr) score.set(h,(score.get(h)||0)+w);
    const s=stats.get(name)||{};
    if (s.service) score.set('service',(score.get('service')||0)+8);
    if (s.child) score.set('child',(score.get('child')||0)+7);
    if (s.connection) score.set('connection',(score.get('connection')||0)+7);
    if (s.instance) score.set('instance',(score.get('instance')||0)+6);
    if (s.uiSize) score.set('uiSize',(score.get('uiSize')||0)+6);
    if (s.color) score.set('color',(score.get('color')||0)+6);
    if (s.vector) score.set('vector',(score.get('vector')||0)+6);
    if (s.cframe) score.set('cframe',(score.get('cframe')||0)+6);
    if (s.enum) score.set('enum',(score.get('enum')||0)+6);
    if (s.functionValue || s.function) score.set('handler',(score.get('handler')||0)+5);
    if (s.tableValue || s.tableApi) score.set('table',(score.get('table')||0)+4);
    if (s.boolean) score.set('flag',(score.get('flag')||0)+4);
    if (s.stringValue) score.set('text',(score.get('text')||0)+4);
    if (s.numberValue) score.set('number',(score.get('number')||0)+3);
    if (s.call && s.index >= 2 && s.property === 0) score.set('function',(score.get('function')||0)+2);
    if (!score.size) return 'value';
    return [...score.entries()].sort((a,b)=>b[1]-a[1])[0][0];
  };
  for (const name of suspicious) map.set(name, makeName(bases[scoredBase(name)] || scoredBase(name)));

  // Preserve property names after . and :; rename actual identifiers everywhere else.
  let out=''; let i=0, quote=null, longClose=null, comment=false, prevSig='';
  while(i<src.length){
    const c=src[i];
    if(comment){out+=c;if(c==='\n')comment=false;i++;continue;}
    if(longClose){if(src.startsWith(longClose,i)){out+=longClose;i+=longClose.length;longClose=null;}else{out+=c;i++;}continue;}
    if(quote){out+=c;if(c==='\\'&&i+1<src.length){out+=src[i+1];i+=2;continue;}if(c===quote)quote=null;i++;continue;}
    if(c==='-'&&src[i+1]==='-'){const lm=src.slice(i).match(/^--(\[=*)\[/);if(lm){const op=lm[0];longClose=']'+lm[1].slice(1)+']';out+=op;i+=op.length;}else{out+='--';i+=2;comment=true;}continue;}
    if(c==='"'||c==="'"){quote=c;out+=c;i++;continue;}
    if(c==='['){const lm=src.slice(i).match(/^\[(=*)\[/);if(lm){const op=lm[0];longClose=']'+lm[1]+']';out+=op;i+=op.length;continue;}}
    const m=src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if(m){const w=m[0];const repl=map.get(w);out+=(repl&&prevSig!=='.'&&prevSig!==':'?repl:w);prevSig=repl&&prevSig!=='.'&&prevSig!==':'?repl:w;i+=w.length;continue;}
    out+=c;if(!/\s/.test(c))prevSig=c;i++;
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
  const argText = args.join(' ').trim();
  const replied = await repliedMessage(message);
  const text = argText || (replied && !attachmentFrom(replied) ? String(replied.content || '').trim() : '');
  if (!text) return null;
  const input = path.join(dir, 'inline.lua');
  await fs.writeFile(input, text, 'utf8');
  return { input, label: argText ? 'inline source' : 'replied source' };
}

// Engine runners consume source code, not file-format metadata. Discord attachments
// and raw URLs may legitimately end in .txt, so normalize only the temporary engine
// input to .lua. The original label/extension is preserved for the user's result.
async function normalizeEngineInput(source, dir) {
  const ext = path.extname(source.input).toLowerCase();
  if (ext !== '.txt') return source.input;
  const normalized = path.join(dir, `${path.basename(source.input, ext)}.lua`);
  await fs.copyFile(source.input, normalized);
  return normalized;
}

function statusEmbed(guild, detectedLabel, deobfuscatingLabel, requestedUser, state = 'working') {
  const e = E(guild);
  const embed = new EmbedBuilder()
    .setTitle(state === 'working' ? 'Deobfuscation Status' : state === 'done' ? 'Deobfuscation Complete' : 'Deobfuscation Failed')
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
      { name: 'Pastefy', value: paste.url ? `${e.pastefy} ${paste.url}` : `${e.error} ${paste.error || 'Upload failed.'}`, inline: false },
    )
    .setFooter({ text: p.truncated ? 'Preview truncated • full result attached.' : 'Full result attached.' });
  const cacheId = crypto.randomUUID();
  resultCache.set(cacheId, { content: resultWithHeader, ownerId: message.author.id, expires: Date.now() + 15 * 60 * 1000, pasteUrl: paste.url || null });
  await message.reply({ embeds: [embed], components: [resultButtons(message.guild, cacheId, paste.url || null)], files: [new AttachmentBuilder(output, { name: filename || 'deobfuscated.luau' })] });
}


async function runEngineForMessage(message, args, engineId) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lph-engine-'));
  try {
    await withJob(async () => {
      const source = await sourceForAction(message, args, dir);
      if (!source) throw new Error('No supported `.lua`, `.luau`, or `.txt` source was found. Attach a file, reply to one, paste code, or provide a direct/raw URL.');
      const engine = get(engineId);
      if (!engine) throw new Error(`Unknown engine: ${engineId}`);
      const engineInput = await normalizeEngineInput(source, dir);
      const sourceText = await fs.readFile(engineInput, 'utf8');
      const found = detect(sourceText);
      const detectedLabel = found.engine ? found.engine.label : 'Unknown / not confidently detected';
      const status = await message.reply({ embeds: [statusEmbed(message.guild, detectedLabel, engine.label, `<@${message.author.id}>`, 'working')] });
      const out = path.join(dir, engineId === '77f' ? 'result.luac' : 'result.luau');
      if (engineId === 'luraph15') await runV15(engineInput, out);
      else if (engineId === 'luraph15v2') {
        const produced = await engineRunner.run(engineId, engineInput, out, dir);
        if (produced !== out) await fs.copyFile(produced, out);
      } else {
        const produced = await engineRunner.run(engineId, engineInput, out, dir);
        if (produced !== out) await fs.copyFile(produced, out);
      }
      const outName = engineId === '77f' ? '77fuscator.deobfuscated.luac' : `${engineId}.deobfuscated${sourceExtension(source.label, '.luau') === '.txt' ? '.luau' : sourceExtension(source.label, '.luau')}`;
      await finishResult(message, engine.label, engineId, source.label, out, outName, engineId === '77f', `<@${message.author.id}>`);
      await status.edit({ embeds: [statusEmbed(message.guild, detectedLabel, engine.label, `<@${message.author.id}>`, 'done')] }).catch(() => {});
    });
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

function makeButton(guild, customId, label, style, emojiName = null) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  const x = emojiName ? buttonEmoji(guild, emojiName) : undefined; if (x) b.setEmoji(x);
  return b;
}
function lphRows(guild, prefix = 'lphver') {
  return [
    new ActionRowBuilder().addComponents(
      makeButton(guild, `${prefix}:luraph15`, 'Luraph V15 • Version 1', ButtonStyle.Secondary, 'luraph'),
      makeButton(guild, `${prefix}:luraph15v2`, 'Luraph V15 • Version 2', ButtonStyle.Secondary, 'luraph'),
      makeButton(guild, `${prefix}:luraph147`, 'Luraph V14.7', ButtonStyle.Secondary, 'luraph'),
      makeButton(guild, `${prefix}:luraph148`, 'Luraph V14.8', ButtonStyle.Secondary, 'luraph'),
      makeButton(guild, `${prefix}:luraph149`, 'Luraph V14.9', ButtonStyle.Secondary, 'luraph'),
    ),
    new ActionRowBuilder().addComponents(
      makeButton(guild, `${prefix}:luraph151`, 'Luraph V15.1', ButtonStyle.Primary, 'luraph'),
    )
  ];
}
function deobfRows(guild) {
  const specs = [
    ['goofyscator-v11', 'Goofyscator V11', 'goofy'],
    ['luraph151', 'Luraph V15.1', 'luraph'],
    ['luraph15', 'Luraph V15 • V1', 'luraph'],
    ['luraph15v2', 'Luraph V15 • V2', 'luraph'],
    ['luraph147', 'Luraph V14.7', 'luraph'],
    ['luraph148', 'Luraph V14.8', 'luraph'],
    ['luraph149', 'Luraph V14.9', 'luraph'],
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
    const embed = new EmbedBuilder().setTitle(`${E(message.guild).open} Choose deobfuscator`).setDescription('Choose a recovery engine. **Luraph V15.1, V15, and V14.7/V14.8/V14.9 use separate backends.**').addFields({ name: 'Source', value: source.label.slice(0, 1024) });
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

async function handleGameDetect(message, args) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'game-detect-'));
  try {
    const source = await sourceForAction(message, args, dir);
    if (!source) return message.reply(`${E(message.guild).error} No supported source found.`);
    const text = await fs.readFile(source.input, 'utf8');
    if (!text.trim()) throw new Error('The source file is empty.');

    const found = await detectGames(text);
    const e = E(message.guild);
    const lines = [];

    if (found.games.length) {
      for (const game of found.games.slice(0, 12)) {
        const confidence = game.score >= 95 ? 'High' : game.score >= 85 ? 'Strong' : game.score >= 75 ? 'Possible' : 'Low';
        const evidence = game.evidence ? game.evidence.replace(/`/g, "'").slice(0, 180) : '';
        lines.push('**' + game.name + '** — ' + confidence + '\n' + game.method + (evidence ? ' • `' + evidence + '`' : ''));
      }
    }

    const resolvedIds = found.resolvedPlaceIds.map(x => '`' + x.placeId + '` → **' + x.name + '**').join('\n');
    const unresolvedIds = found.placeIds.filter(id => !found.resolvedPlaceIds.some(x => x.placeId === id));

    const embed = new EmbedBuilder()
      .setTitle(`${e.done} Roblox Game Detection`)
      .setDescription(lines.length ? lines.join('\n\n').slice(0, 3900) : `${e.error} No game name was confidently found in the source.`)
      .addFields({ name: 'Input', value: String(source.label).slice(0, 1024), inline: false });

    if (resolvedIds) embed.addFields({ name: 'Resolved PlaceIds', value: resolvedIds.slice(0, 1024), inline: false });
    if (unresolvedIds.length) embed.addFields({ name: 'Unresolved PlaceIds', value: unresolvedIds.map(id => '`' + id + '`').join(', ').slice(0, 1024), inline: false });
    embed.setFooter({ text: 'Detection checks actual text in the source; it does not require game.PlaceId to be present.' });

    await message.reply({ embeds: [embed] });
  } catch (e) {
    await message.reply(`${E(message.guild).error} Game detection failed: ${String(e.message || e).slice(0, 1800)}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function handlePaste(message, args) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paste-bot-'));
  try {
    const source = await sourceForAction(message, args, dir);
    if (!source) return message.reply(`${E(message.guild).error} No supported source found.`);
    const text = await fs.readFile(source.input, 'utf8');
    if (!text.trim()) throw new Error('The source file is empty.');
    const ext = sourceExtension(source.label, path.extname(source.input) || '.txt');
    const title = path.basename(source.input, path.extname(source.input)) || 'source';
    const paste = await uploadPastefy(`${title} — Skulx Cli`, text, 'PASTE');
    if (!paste.url) throw new Error(paste.error || 'Pastefy upload failed.');
    const e = E(message.guild);
    const p = makePreview(text);
    const embed = new EmbedBuilder()
      .setTitle(`${e.done} Paste created`)
      .setDescription(`${e.preview} **Preview:**\n\`\`\`lua\n${safeCodeBlock(p.text)}\n\`\`\``)
      .addFields(
        { name: 'Input', value: String(source.label).slice(0, 1024), inline: false },
        { name: 'Pastefy', value: `${e.pastefy} ${paste.url}`, inline: false },
      )
      .setFooter({ text: p.truncated ? 'Preview truncated.' : 'Source uploaded as text.' });
    await message.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Pastefy').setURL(paste.url))] });
  } catch (e) {
    await message.reply(`${E(message.guild).error} Paste failed: ${String(e.message || e).slice(0, 1800)}`);
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function handlePreview(message, args) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-bot-'));
  try {
    const source = await sourceForAction(message, args, dir);
    if (!source) return message.reply(`${E(message.guild).error} No supported source found.`);
    const text = await fs.readFile(source.input, 'utf8');
    const p = makePreview(text);
    const e = E(message.guild);
    const embed = new EmbedBuilder()
      .setTitle(`${e.preview} File Preview`)
      .setDescription(`\`\`\`lua\n${safeCodeBlock(p.text)}\n\`\`\``)
      .addFields({ name: 'Input', value: String(source.label).slice(0, 1024), inline: false })
      .setFooter({ text: p.truncated ? 'Preview truncated; full source is attached.' : 'Preview only; source was not modified.' });
    await message.reply({ embeds: [embed], files: [new AttachmentBuilder(source.input, { name: path.basename(source.input) })] });
  } catch (e) {
    await message.reply(`${E(message.guild).error} Preview failed: ${String(e.message || e).slice(0, 1800)}`);
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function extractUrlAndKey(message, args) {
  const replied = await repliedMessage(message);
  const urls = extractUrls(args.join(' ')).concat(extractUrls(allSourceText(message, replied))).filter((u, i, a) => a.indexOf(u) === i);
  const url = urls[0] || null;
  const key = process.env.LUARMOR_SCRIPT_KEY || process.env.LRM_SCRIPT_KEY || null;
  const explicit = args.find(x => !/^https?:\/\//i.test(x) && x.length > 8) || null;
  return { url, key: explicit || key };
}

async function handleLuarmor(message, args) {
  const pair = await extractUrlAndKey(message, args);
  if (!pair.url) return message.reply(`${E(message.guild).error} Usage: \`${PREFIX}luarmor <Luarmor loader URL> [script key]\``);
  if (!pair.key) return message.reply(`${E(message.guild).error} A script key is required. Put it in \`LUARMOR_SCRIPT_KEY\` on Railway or provide it after the loader URL.`);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luarmor-bot-'));
  try {
    await withJob(async () => {
      const outputDir = path.join(dir, 'out');
      const out = path.join(dir, 'luarmor-recovered.lua');
      const status = await message.reply({ embeds: [statusEmbed(message.guild, 'Luarmor', 'Luarmor Fetch', `<@${message.author.id}>`, 'working')] });
      const produced = await engineRunner.runLuarmor(pair.url, pair.key, out, dir);
      if (produced !== out) await fs.copyFile(produced, out);
      await finishResult(message, 'Luarmor Fetch', 'luarmor', pair.url, out, 'luarmor.fetched.luau', false, `<@${message.author.id}>`);
      await status.edit({ embeds: [statusEmbed(message.guild, 'Luarmor', 'Luarmor Fetch', `<@${message.author.id}>`, 'done')] }).catch(() => {});
    });
  } catch (e) {
    await message.reply(`${E(message.guild).failed} Luarmor fetch failed: ${String(e.message || e).slice(-3500)}`).catch(() => {});
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function handleFlowAuth(message, args) {
  const replied = await repliedMessage(message);
  const urls = extractUrls(args.join(' ')).concat(extractUrls(allSourceText(message, replied))).filter((u, i, a) => a.indexOf(u) === i);
  if (!urls.length) return message.reply(`${E(message.guild).error} Usage: \`${PREFIX}flow <FlowAuth loader URL>\` or reply to a message containing the loader URL.`);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowauth-bot-'));
  try {
    await withJob(async () => {
      const out = path.join(dir, 'flowauth.deobfuscated.luau');
      const status = await message.reply({ embeds: [statusEmbed(message.guild, 'FlowAuth', 'FlowAuth', `<@${message.author.id}>`, 'working')] });
      const produced = await engineRunner.runFlowAuth(urls[0], out, dir);
      if (produced !== out) await fs.copyFile(produced, out);
      await finishResult(message, 'FlowAuth', 'flowauth', urls[0], out, 'flowauth.deobfuscated.luau', false, `<@${message.author.id}>`);
      await status.edit({ embeds: [statusEmbed(message.guild, 'FlowAuth', 'FlowAuth', `<@${message.author.id}>`, 'done')] }).catch(() => {});
    });
  } catch (e) { await message.reply(`${E(message.guild).failed} FlowAuth failed: ${String(e.message || e).slice(-3500)}`).catch(() => {}); }
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
          results.push({ url: r.finalUrl, preview: makePreview(r.buffer.toString('utf8')), mode: 'direct/raw' });
        } catch (e) {
          results.push({ url: urls[i], error: String(e.message || e), mode: 'direct/raw' });
          // If the direct/raw request fails, optionally fall back to the dedicated
          // Luarmor protocol. This only runs when a script key is configured/provided.
          const looksLuarmor = /luarmor\.net\/files\/v4\/loaders\//i.test(urls[i]);
          const key = args.find(x => !/^https?:\/\//i.test(x) && x.length > 8) || process.env.LUARMOR_SCRIPT_KEY || process.env.LRM_SCRIPT_KEY || null;
          if (looksLuarmor && key) {
            try {
              const fallbackOut = path.join(dir, `luarmor_${i + 1}.lua`);
              const produced = await engineRunner.runLuarmor(urls[i], key, fallbackOut, dir);
              if (produced !== fallbackOut) await fs.copyFile(produced, fallbackOut);
              files.push(new AttachmentBuilder(fallbackOut, { name: path.basename(fallbackOut) }));
              results[results.length - 1] = { url: urls[i], preview: makePreview(await fs.readFile(fallbackOut, 'utf8')), mode: 'Luarmor fallback' };
            } catch (fallbackErr) {
              results[results.length - 1].fallbackError = String(fallbackErr.message || fallbackErr);
            }
          }
        }
      }
      const first = results[0];
      const embed = new EmbedBuilder()
        .setTitle(`${E(message.guild).open} Fetch`)
        .setDescription(first.error && !first.preview ? `${E(message.guild).failed} ${first.error}${first.fallbackError ? `\n${E(message.guild).luarmor} Luarmor fallback: ${first.fallbackError}` : ''}` : `**${first.mode || 'Raw source'} preview:**\n\`\`\`lua\n${safeCodeBlock(first.preview.text)}\n\`\`\``)
        .setFooter({ text: files.length ? 'Source files attached. HTML pages are rejected; Luarmor fallback is used only for Luarmor loader URLs when a key is available.' : 'No source could be fetched.' });
      await message.reply({ embeds: [embed], files: files.slice(0, 10) });
      if (results.length > 1) await message.reply(results.slice(1).map((x, i) => x.error && !x.preview ? `${E(message.guild).failed} ${i + 2}. ${x.error}` : `${E(message.guild).done} ${i + 2}. ${x.url} • ${x.mode}`).join('\n').slice(0, 1900));
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
    const ext = sourceExtension(source.label, '.luau'); const output = path.join(dir, `beautified${ext === '.txt' ? '.txt' : ext}`); await fs.writeFile(output, pretty, 'utf8');
    const p = makePreview(pretty);
    const embed = new EmbedBuilder().setTitle(`${E(message.guild).done} Beautify finished`).setDescription(`**Formatting only**\n\n\`\`\`lua\n${safeCodeBlock(p.text)}\n\`\`\``).setFooter({ text: 'No deobfuscation or identifier renaming was performed.' });
    await message.reply({ embeds: [embed], files: [new AttachmentBuilder(output, { name: path.basename(output) })] });
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
    const ext = sourceExtension(source.label, '.luau');
    const output = path.join(dir, `renamed${ext === '.txt' ? '.txt' : ext}`); await fs.writeFile(output, renamed, 'utf8');
    const p = makePreview(renamed);
    const embed = new EmbedBuilder().setTitle(`${E(message.guild).done} Rename finished`).setDescription(`**Maximum safe identifier cleanup**\n\n\`\`\`lua\n${safeCodeBlock(p.text)}\n\`\`\``).setFooter({ text: 'Strings, comments and property names are preserved.' });
    await message.reply({ embeds: [embed], files: [new AttachmentBuilder(output, { name: path.basename(output) })] });
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
  if (kind === 'copyresult') {
    const cached = resultCache.get(id);
    if (!cached || cached.expires < Date.now()) { resultCache.delete(id); return interaction.reply({ content: `${E(interaction.guild).error} This result has expired. Run the command again.`, ephemeral: true }); }
    if (cached.ownerId && cached.ownerId !== interaction.user.id) return interaction.reply({ content: `${E(interaction.guild).error} Only the user who generated this result can use Copy Output.`, ephemeral: true });
    const preview = cached.content.length > 1800 ? cached.content.slice(0, 1800) + '\n-- ... output is larger than Discord\'s copyable message limit; use the attached file/Pastefy link. ...' : cached.content;
    return interaction.reply({ content: `\`\`\`lua\n${safeCodeBlock(preview)}\n\`\`\``, ephemeral: true });
  }
  if (!['deobf', 'lphver'].includes(kind)) return;
  const pendingId = [...pending.keys()].find(k => pending.get(k)?.selectorMessageId === interaction.message.id);
  if (!pendingId) return interaction.reply({ content: `${E(interaction.guild).error} This selector expired. Run the command again.`, ephemeral: true });
  const state = pending.get(pendingId);
  if (state.expires < Date.now()) { pending.delete(pendingId); return interaction.reply({ content: `${E(interaction.guild).error} This selector expired. Run the command again.`, ephemeral: true }); }
  if (state.ownerId && state.ownerId !== interaction.user.id) return interaction.reply({ content: `${E(interaction.guild).error} Only the user who requested this deobfuscation can use these buttons.`, ephemeral: true });
  let engineId = id;
  if (kind === 'lphver' && !['luraph15', 'luraph15v2', 'luraph147', 'luraph148', 'luraph149', 'luraph151'].includes(id)) return interaction.reply({ content: `${E(interaction.guild).error} Unknown Luraph version.`, ephemeral: true });
  const engine = get(engineId);
  if (!engine) return interaction.reply({ content: `${E(interaction.guild).error} Unknown engine.`, ephemeral: true });
  await interaction.deferUpdate();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'deobf-click-'));
  try {
    await withJob(async () => {
      const originalInput = path.join(work, path.basename(state.sourcePath));
      await fs.copyFile(state.sourcePath, originalInput);
      const sourceForEngine = { input: originalInput };
      const input = await normalizeEngineInput(sourceForEngine, work);
      const output = path.join(work, engineId === '77f' ? 'result.luac' : 'result.luau');
      const sourceText = await fs.readFile(input, 'utf8');
      const found = detect(sourceText);
      const detectedLabel = found.engine ? found.engine.label : 'Unknown / not confidently detected';
      await interaction.editReply({ embeds: [statusEmbed(interaction.guild, detectedLabel, engine.label, `<@${interaction.user.id}>`, 'working')], components: [] });
      if (engineId === 'luraph15') await runV15(input, output);
      else if (engineId === 'luraph151' || engineId === 'goofyscator-v11' || ['luraph147', 'luraph148', 'luraph149'].includes(engineId)) { const produced = await engineRunner.run(engineId, input, output, work); if (produced !== output) await fs.copyFile(produced, output); }
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
            { name: 'Pastefy', value: paste.url ? `${e.pastefy} ${paste.url}` : `${e.error} ${paste.error || 'Upload failed.'}`, inline: false },
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
    else if (command === 'game' || command === 'gamedetect' || command === 'gamename') await handleGameDetect(message, parts);
    else if (command === 'lph') {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lph-select-'));
      try {
        const source = await sourceForAction(message, parts, dir);
        if (!source) return message.reply(`${E(message.guild).error} No supported source found.`);
        const copied = path.join(dir, path.basename(source.input)); await fs.copyFile(source.input, copied);
        const key = crypto.randomUUID();
        const selector = await message.reply({ embeds: [new EmbedBuilder().setTitle(`${E(message.guild).open} Luraph version`).setDescription('Choose the matching Luraph version. V14.7, V14.8, V14.9, V15, and V15.1 use separate engine paths.').addFields({ name: 'Source', value: source.label.slice(0, 1024) })], components: lphRows(message.guild) });
        pending.set(key, { sourcePath: copied, sourceLabel: source.label, dir, selectorMessageId: selector.id, ownerId: message.author.id, expires: Date.now() + 10 * 60 * 1000 });
      } catch (e) { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); throw e; }
    }
    else if (command === 'luraph' || command === 'lph147' || command === 'luraph147') await handleDirect(message, parts, 'luraph147');
    else if (command === 'lph148' || command === 'luraph148') await handleDirect(message, parts, 'luraph148');
    else if (command === 'lph149' || command === 'luraph149') await handleDirect(message, parts, 'luraph149');
    else if (command === 'lph151' || command === 'luraph151') await handleDirect(message, parts, 'luraph151');
    else if (command === 'gv11d' || command === 'goofyscator') await handleDirect(message, parts, 'goofyscator-v11');
    else if (command === 'mv') await handleDirect(message, parts, 'moonveil');
    else if (command === 'luaobf') {
      const mode = (parts[0] || '').toLowerCase();
      if (mode === 'good' || mode === 'chaoticgood') await handleDirect(message, parts.slice(1), 'luaobf-good');
      else if (mode === 'evil' || mode === 'chaoticevil') await handleDirect(message, parts.slice(1), 'luaobf-evil');
      else {
        const row = new ActionRowBuilder().addComponents(
          makeButton(message.guild, 'deobf:luaobf-good', 'Chaotic Good', ButtonStyle.Success, 'luaobf'),
          makeButton(message.guild, 'deobf:luaobf-evil', 'Chaotic Evil', ButtonStyle.Danger, 'luaobf'),
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
    else if (command === 'luast') await handleDirect(message, parts, 'luast');
    else if (command === 'hl') await handleDirect(message, parts, 'hidelat');
    else if (command === 'flow') await handleFlowAuth(message, parts);
    else if (command === 'luarmor') await handleLuarmor(message, parts);
    else if (command === 'get') await handleGet(message, parts);
    else if (command === 'paste') await handlePaste(message, parts);
    else if (command === 'preview') await handlePreview(message, parts);
    else if (command === 'decode') await handleDecode(message, parts);
    else if (command === 'beautify' || command === 'beutify') await handleBeautify(message, parts);
    else if (command === 'rename') await handleRename(message, parts);
  } catch (e) { console.error(e); await message.reply(`${E(message.guild).error} Unexpected bot error.`).catch(() => {}); }
});

setInterval(() => {
  const now = Date.now();
  for (const [id, state] of pending) if (state.expires < now) { pending.delete(id); fs.rm(state.dir, { recursive: true, force: true }).catch(() => {}); }
  for (const [id, state] of resultCache) if (state.expires < now) resultCache.delete(id);
}, 60_000).unref();

// Render Web Services require an HTTP listener. This endpoint reports service health;
// it does not prevent Render's free instance from sleeping when idle.
const PORT = Number(process.env.PORT || 10000);
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(client.isReady() ? 'Skulx Discord Bot is online' : 'Skulx Discord Bot is starting');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});
healthServer.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP health server listening on port ${PORT}`);
});

client.login(TOKEN);
