'use strict';

// Game-name detection is intentionally evidence-based. A Roblox PlaceId can be
// resolved reliably, but when no PlaceId exists there is no universal API that
// can tell us the game's identity from arbitrary code. In that case we only
// report text that has enough game-name context and suppress common Roblox/API
// identifiers such as Players, GetService, HttpGet, etc.

const KNOWN_GAMES = [
  ['Blox Fruits', ['blox fruits', 'bloxfruit']],
  ['Brookhaven RP', ['brookhaven rp', 'brookhaven']],
  ['Adopt Me!', ['adopt me', 'adoptme']],
  ['Murder Mystery 2', ['murder mystery 2', 'mm2']],
  ['Arsenal', ['arsenal']],
  ['Blade Ball', ['blade ball', 'bladeball']],
  ['Da Hood', ['da hood', 'dahood']],
  ['Pet Simulator 99', ['pet simulator 99', 'ps99']],
  ['Pet Simulator X', ['pet simulator x', 'psx']],
  ['Doors', ['doors']],
  ['Piggy', ['piggy']],
  ['Tower of Hell', ['tower of hell', 'toh']],
  ['BedWars', ['bedwars', 'bed wars']],
  ['Jailbreak', ['jailbreak']],
  ['MeepCity', ['meepcity']],
  ['Welcome to Bloxburg', ['welcome to bloxburg', 'bloxburg']],
  ['Dress To Impress', ['dress to impress', 'dti']],
  ['Fisch', ['fisch']],
  ['Grow a Garden', ['grow a garden', 'growagarden']],
  ['RIVALS', ['rivals']],
  ['99 Nights in the Forest', ['99 nights in the forest', '99 nights']],
  ['The Strongest Battlegrounds', ['the strongest battlegrounds', 'strongest battlegrounds', 'tsb']],
  ['Evade', ['evade']],
  ['Build A Boat For Treasure', ['build a boat for treasure', 'build a boat']],
  ['Rainbow Friends', ['rainbow friends']],
  ['Deepwoken', ['deepwoken']],
  ['Shindo Life', ['shindo life']],
  ['King Legacy', ['king legacy']],
  ['Anime Defenders', ['anime defenders']],
  ['All Star Tower Defense', ['all star tower defense', 'astd']],
  ['Bee Swarm Simulator', ['bee swarm simulator', 'bee swarm']],
  ['Driving Empire', ['driving empire']],
  ['Greenville', ['greenville']],
  ['Phantom Forces', ['phantom forces']],
  ['Combat Warriors', ['combat warriors']],
  ['A Universal Time', ['a universal time', 'universal time', 'aut']],
  ['Project Slayers', ['project slayers']],
  ['Toilet Tower Defense', ['toilet tower defense', 'ttd']],
  ['Anime Last Stand', ['anime last stand', 'als']],
  ['Murder Party', ['murder party']],
  ['Natural Disaster Survival', ['natural disaster survival']],
  ['Work at a Pizza Place', ['work at a pizza place']],
  ['Survive the Killer!', ['survive the killer', 'stk']],
  ['Flee the Facility', ['flee the facility', 'ftf']],
  ['Vehicle Legends', ['vehicle legends']],
  ['Restaurant Tycoon 2', ['restaurant tycoon 2']],
  ['Theme Park Tycoon 2', ['theme park tycoon 2']],
  ['Speed Run 4', ['speed run 4']],
  ['Super Bomb Survival', ['super bomb survival']],
  ['Flood Escape 2', ['flood escape 2', 'fe2']],
];

const GENERIC_WORDS = new Set([
  'players','player','teams','team','workspace','lighting','replicatedstorage',
  'replicatedfirst','serverstorage','serverscriptservice','startergui','starterpack',
  'starterplayer','userinputservice','runservice','collectionservice','tweenservice',
  'httpget','getservice','waitforchild','findfirstchild','findfirstancestor','clone',
  'instance','instances','script','localscript','modulescript','module','folder',
  'part','model','camera','character','humanoid','backpack','mouse','input',
  'remote','remoteevent','remotefunction','bindableevent','bindablefunction',
  'event','connection','connections','service','services','data','source','output',
  'value','values','config','settings','main','loader','loadstring','function',
  'true','false','nil','none','unknown','game','place','experience','title',
  'door','doors','button','buttons','gui','screen','frame','label','text','name',
  'version','status','success','error','warning','info','localplayer','localplayergui',
  'httpservice','teleportservice','marketplaceservice','debris','debrisservice',
  'pathfindingservice','physicsservice','contentprovider','chat','textchatservice',
]);

const GAME_CONTEXT = /\b(game|game\s*name|game\s*title|gamename|game_name|gametitle|game_title|experience|experience\s*name|place\s*name|placename|place_name|script\s*(?:for|from)|made\s*for|compatible\s*with|supported\s*game|works\s*with)\b/i;
const TITLE_CONTEXT = /\b(title|name|game|experience|place|script|source|target|supported|compatible)\b/i;

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[“”‘’]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanCandidate(s) {
  return String(s || '')
    .replace(/^[\s\-–—:|•#]+|[\s\-–—:|•,;.!?]+$/g, '')
    .replace(/\\["']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isBadCandidate(candidate) {
  const n = normalize(candidate);
  if (!n || n.length < 3 || n.length > 100) return true;
  if (GENERIC_WORDS.has(n)) return true;
  if (/^(https?|rbxassetid|rbxasset|https?\s*www)$/i.test(n)) return true;
  if (/^[0-9_\- .]+$/.test(candidate)) return true;
  if (/^(?:get|set|find|wait|remove|create|make|update|load|init|start|stop)[a-z0-9_]*(?:service|child|object|part|value|event|function)?$/i.test(candidate)) return true;
  return false;
}

function addHit(map, name, method, evidence, score) {
  const cleaned = cleanCandidate(name);
  if (isBadCandidate(cleaned)) return;
  const key = normalize(cleaned);
  const prev = map.get(key);
  const item = { name: cleaned, method, evidence: String(evidence || '').trim().slice(0, 240), score };
  if (!prev || score > prev.score) map.set(key, item);
}

function aliasRegex(alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i');
}

function scanKnown(source, map) {
  const text = String(source);
  const lower = text.toLowerCase();
  for (const [canonical, aliases] of KNOWN_GAMES) {
    for (const alias of aliases) {
      const re = aliasRegex(alias);
      const m = re.exec(lower);
      if (!m) continue;
      const start = Math.max(0, m.index - 120);
      const end = Math.min(text.length, m.index + alias.length + 120);
      const context = text.slice(start, end);
      const isMultiWord = normalize(alias).split(' ').length >= 2;
      const contextual = GAME_CONTEXT.test(context) || /--|\/\//.test(context);
      // Single-word names such as Doors, Arsenal, Evade, Fisch, etc. are too
      // ambiguous to call a game unless the surrounding source gives context.
      if (!isMultiWord && !contextual) continue;
      addHit(map, canonical, contextual ? 'known game name with context' : 'known game-name text', context, contextual ? 96 : 90);
      break;
    }
  }
}

function scanExplicitFields(source, map) {
  const text = String(source);
  const patterns = [
    // Only assignment-style fields. This deliberately does NOT match
    // game:GetService(...) or game:HttpGet(...).
    /\b(?:gameName|game_name|gameTitle|game_title|placeName|place_name|experienceName|experience_name|game|experience|place)\s*=\s*["']([^"'\n\r]{2,120})["']/gi,
    /\b(?:Game\s*Name|Game\s*Title|Place\s*Name|Experience\s*Name|Game|Experience|Place)\s*:\s*["']([^"'\n\r]{2,120})["']/gi,
    /\b(?:script|source)\s+(?:for|from|made\s+for|created\s+for)\s*["']([^"'\n\r]{2,120})["']/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) addHit(map, m[1], 'explicit game-name field/text', m[0], 100);
  }

  // Comment forms: -- Game: Blox Fruits, -- Script for Doors, etc.
  const commentRe = /(?:^|\n)\s*(?:--|\/\/|#)\s*(?:game|game\s*name|game\s*title|experience|experience\s*name|place|place\s*name|script\s*for|made\s*for|compatible\s*with|supported\s*game)\s*[:\-]?\s*(.+)$/gim;
  let c;
  while ((c = commentRe.exec(text))) {
    const candidate = cleanCandidate(c[1]);
    if (candidate && candidate.length <= 120) addHit(map, candidate, 'game-name comment', c[0], 98);
  }
}

function scanRobloxUrls(source, map) {
  const text = String(source);
  const urlRe = /https?:\/\/www\.roblox\.com\/games\/(\d+)\/([^\s?#"']+)/gi;
  let u;
  while ((u = urlRe.exec(text))) {
    const slug = decodeURIComponent(u[2]).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (!isBadCandidate(slug)) addHit(map, slug, 'Roblox game URL text', u[0], 99);
  }
}

function scanContextualStrings(source, map) {
  const text = String(source);
  const re = /(?:(?:local|var|const)?\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
  let m;
  while ((m = re.exec(text))) {
    const value = cleanCandidate(m[1].slice(1, -1));
    if (isBadCandidate(value) || value.length < 3 || value.length > 100) continue;
    const before = text.slice(Math.max(0, m.index - 180), m.index);
    const after = text.slice(m.index + m[0].length, Math.min(text.length, m.index + m[0].length + 120));
    const context = before + ' ' + after;
    if (!TITLE_CONTEXT.test(context)) continue;

    const words = normalize(value).split(' ').filter(Boolean);
    const titleLike = words.length >= 2 && words.length <= 10 && !/[{}()[\];=]/.test(value);
    if (!titleLike) continue;

    // Require stronger context for arbitrary strings. This avoids treating
    // service names and UI labels as games.
    const strong = GAME_CONTEXT.test(context) || /\b(?:game|title|experience|place)\s*[:=]/i.test(before);
    if (strong) addHit(map, value, 'contextual game-name string', m[0], 86);
  }
}

function scanGameLikeComments(source, map) {
  const text = String(source);
  const re = /(?:^|\n)\s*(?:--|\/\/|#)\s*(?:[^\n]{0,30})$/g;
  let m;
  while ((m = re.exec(text))) {
    const line = m[0].replace(/^[\s\n]*(?:--|\/\/|#)\s*/, '').trim();
    if (!line || line.length > 100) continue;
    if (!GAME_CONTEXT.test(line) && !/\b(?:roblox|game|script|hub|cheat|executor|supported|for)\b/i.test(line)) continue;
    const candidate = line.replace(/^(?:game|script|source|for)\s*[:\-]?\s*/i, '').trim();
    if (candidate.split(/\s+/).length >= 2) addHit(map, candidate, 'game-related comment text', line, 80);
  }
}

function extractPlaceIds(source) {
  const ids = new Set();
  const text = String(source);
  const patterns = [
    /\bgame\s*\.\s*PlaceId\s*(?:=|:)?\s*(\d{3,15})/gi,
    /\bPlaceId\b\s*[:=]\s*(\d{3,15})/gi,
    /\bplace[_ ]?id\b[^\d]{0,12}(\d{3,15})/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) ids.add(m[1]);
  }
  return [...ids].slice(0, 8);
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'Skulx-Cli-GameDetector/2.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function resolvePlaceId(placeId) {
  try {
    const universe = await fetchJson(`https://apis.roblox.com/universes/v1/places/${encodeURIComponent(placeId)}/universe`);
    const universeId = universe?.universeId;
    if (!universeId) return null;
    const details = await fetchJson(`https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(universeId)}`);
    const game = Array.isArray(details?.data) ? details.data[0] : null;
    return game?.name ? { placeId, universeId, name: game.name } : null;
  } catch { return null; }
}

async function detectGames(source) {
  const text = String(source || '');
  const hits = new Map();

  scanKnown(text, hits);
  scanExplicitFields(text, hits);
  scanRobloxUrls(text, hits);
  scanContextualStrings(text, hits);
  scanGameLikeComments(text, hits);

  const placeIds = extractPlaceIds(text);
  const resolved = await Promise.all(placeIds.map(resolvePlaceId));
  for (const r of resolved) {
    if (r) addHit(hits, r.name, 'Roblox PlaceId lookup', `PlaceId: ${r.placeId}`, 110);
  }

  // Do not flood Discord with weak candidates. If there is no PlaceId, the
  // remaining entries are textual evidence only; a random string is never
  // presented as a confirmed game.
  const games = [...hits.values()]
    .filter(x => x.score >= 80)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return {
    games,
    placeIds,
    resolvedPlaceIds: resolved.filter(Boolean),
    hasPlaceId: placeIds.length > 0,
    hasResolvedPlaceId: resolved.some(Boolean),
  };
}

module.exports = { detectGames, extractPlaceIds };
