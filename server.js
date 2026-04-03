const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');

app.use(express.json());
app.use(express.static(__dirname));

// ─── Config ───────────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {}
  return {
    webhookUrl: '',
    watchlist: [],
    examples: ['weird', 'hollow', 'ghost', 'lunar', 'frost', 'ashen'],
    minLen: 4,
    maxLen: 10,
    notifiedUsernames: [],
  };
}
function saveConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }

let config = loadConfig();
let monitorInterval = null;
let isRunning = false;
let lastCheck = null;
let checkResults = {};
let alertHistory = [];
let candidateQueue = [];
let checkedCandidates = new Set();

// ─── Wordlist ─────────────────────────────────────────────────────────────────
const WORDLIST = [
  // eerie / dark / atmospheric
  'eerie','gloomy','hollow','murky','shady','bleak','dread','gloom','shroud',
  'abyss','void','shade','haunt','lurk','cryptic','sinister','dreary','dismal',
  'somber','grim','stark','gritty','moody','broody','sullen','muted','faded',
  'worn','scarred','crude','cold','blunt','ashen','pale','dim','ghostly',
  // aesthetic / vibe words
  'hazy','misty','foggy','vapor','silky','velvet','satin','sheer','wispy',
  'gauzy','dreamy','serene','lunar','solar','astral','cosmic','nebula','zenith',
  'aurora','prism','mirage','vortex','nexus','cipher','relic','ember','cinder',
  'frost','frozen','arctic','boreal','tundra','glacial','crystal','quartz',
  // cool / edgy
  'rogue','rebel','phantom','specter','wraith','rift','null','nix','grim',
  'blade','shard','fracture','clash','surge','spike','jolt','shock','bolt',
  'flare','blaze','scorch','smolder','inferno','tempest','havoc','chaos','mayhem',
  'anarchy','ruin','decay','wither','erode','corrode','tarnish','blight','plague',
  // nature aesthetic
  'pine','cedar','willow','birch','maple','aspen','spruce','hemlock','cypress',
  'raven','falcon','osprey','condor','swift','wren','finch','robin','heron',
  'lynx','vixen','stag','bison','moose','sable','onyx','obsidian','basalt',
  'granite','marble','slate','flint','quartz','jasper','garnet','topaz','opal',
  // short punchy 4-5 char
  'dusk','dawn','dew','mist','veil','haze','husk','halo','echo','glyph',
  'myth','lore','rune','omen','fate','soul','lost','dark','night','moon',
  'star','storm','rain','wind','wave','tide','reef','cove','vale','dale',
  'glen','moor','fen','bog','marsh','swamp','delta','mesa','ridge','bluff',
  'crag','gorge','chasm','abyss','depth','void','null','zero','apex','nadir',
  // feelings / states
  'numb','lost','gone','empty','broken','dazed','blurry','distant','remote',
  'absent','vacant','blank','hollow','quiet','silent','still','calm','cold',
  'tired','spent','worn','faded','jaded','weary','heavy','sullen','gloomy',
  // aesthetic single words
  'liminal','surreal','cryptic','arcane','occult','mystic','eldritch','abyssal',
  'ethereal','spectral','astral','planar','cosmic','stellar','orbital','ecliptic',
  'solstice','equinox','zenith','nadir','apogee','perigee','transit','eclipse',
  // cool short combos
  'lowkey','mellow','chilly','frosty','grunge','indie','loner','drifter',
  'nomad','exile','outlaw','ranger','hunter','seeker','warden','keeper',
  'herald','herald','oracle','cipher','enigma','paradox','anomaly','phantom',
  // colors as names
  'scarlet','crimson','maroon','burgundy','auburn','sienna','umber','ochre',
  'amber','ivory','ebony','obsidian','silver','cobalt','indigo','violet',
  'magenta','cerise','fuchsia','lilac','lavender','mauve','plum','teal',
  'cerulean','azure','sapphire','cyan','jade','emerald','viridian','olive',
  // more vibes
  'cursed','hexed','jinxed','doomed','fated','cursed','blighted','forsaken',
  'hollow','sunken','drowned','buried','forgotten','lost','hidden','veiled',
  'masked','cloaked','shrouded','veiled','obscured','shadowed','darkened',
  'dimmed','faded','muted','hushed','silenced','muffled','dulled','numbed',
].map(w => w.toLowerCase()).filter(w => w.length >= 4);

// ─── Scoring ──────────────────────────────────────────────────────────────────
function scoreUsername(name, examples, minLen, maxLen) {
  const n = name.toLowerCase();
  const len = n.length;
  if (len < minLen || len > maxLen) return 0;
  if (!/^[a-z0-9_.]+$/.test(n)) return 0;

  let score = 0;

  if (len === 4) score += 55;
  else if (len === 5) score += 45;
  else if (len === 6) score += 35;
  else if (len <= 8) score += 20;
  else score += 8;

  if (/^[a-z]+$/.test(n)) score += 20;

  const vowels = (n.match(/[aeiou]/g) || []).length;
  const ratio = vowels / len;
  if (ratio >= 0.2 && ratio <= 0.6) score += 15;

  const exLens = examples.map(e => e.length);
  const avgLen = exLens.reduce((a, b) => a + b, 0) / (exLens.length || 1);
  if (Math.abs(len - avgLen) <= 1) score += 15;
  else if (Math.abs(len - avgLen) <= 2) score += 8;

  for (const ex of examples) {
    const e = ex.toLowerCase();
    if (e === n) score += 50;
    if (len >= 3 && e.length >= 3 && e.slice(0, 3) === n.slice(0, 3)) score += 12;
    if (len >= 3 && e.length >= 3 && e.slice(-3) === n.slice(-3)) score += 10;
  }

  return Math.min(score, 100);
}

function buildCandidates() {
  const examples = config.examples || [];
  const minLen = Math.max(config.minLen || 4, 4);
  const maxLen = config.maxLen || 10;

  const scored = WORDLIST
    .filter(w => w.length >= minLen && w.length <= maxLen)
    .map(w => ({ name: w, score: scoreUsername(w, examples, minLen, maxLen) }))
    .filter(w => w.score >= 25)
    .sort((a, b) => b.score - a.score);

  // Also include full wordlist sorted by score for broader coverage
  const all = WORDLIST.filter(w => w.length >= minLen && w.length <= maxLen);

  const combined = [...new Set([...scored.map(s => s.name), ...all])];
  return combined.filter(s => !checkedCandidates.has(s));
}

// ─── Check username availability ──────────────────────────────────────────────
// Discord's public API: GET /api/v9/users/@me won't work unauthenticated,
// but we can use the username lookup endpoint used during registration.
// A 200 with "username": ... means taken. A specific error code means available.
async function checkUsername(username) {
  try {
    // Discord's pomelo username check endpoint
    const res = await fetch(`https://discord.com/api/v9/unique-username/username-attempt-unauthed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Origin': 'https://discord.com',
        'Referer': 'https://discord.com/',
      },
      body: JSON.stringify({ username }),
    });

    if (res.status === 200) {
      const data = await res.json().catch(() => ({}));
      // taken = { taken: true } or similar
      if (data.taken === true) return 'taken';
      if (data.taken === false) return 'available';
      return 'unknown';
    }
    if (res.status === 429) return 'ratelimited';
    if (res.status === 400) {
      const data = await res.json().catch(() => ({}));
      // If errors mention "username" is taken
      if (JSON.stringify(data).includes('taken')) return 'taken';
      return 'unknown';
    }
    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Alert ────────────────────────────────────────────────────────────────────
async function sendAlert(username, score) {
  if (!config.webhookUrl) return false;

  const payload = {
    username: 'Username Sniper 👤',
    embeds: [{
      title: '🟢 Username Available!',
      description: `**@${username}** is available on Discord!`,
      color: 0x57f287,
      fields: [
        { name: '👤 Username', value: `@${username}`, inline: true },
        { name: '📏 Length', value: `${username.length} chars`, inline: true },
        { name: '⭐ Score', value: `${score}/100`, inline: true },
        { name: '⚡ How to Claim', value: 'User Settings → My Account → Username', inline: false },
      ],
      footer: { text: 'Username Sniper • Discord API' },
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      alertHistory.unshift({ username, score, alertedAt: new Date() });
      if (alertHistory.length > 200) alertHistory = alertHistory.slice(0, 200);
      return true;
    }
    return false;
  } catch { return false; }
}

// ─── Monitor ──────────────────────────────────────────────────────────────────
async function runCheck() {
  lastCheck = new Date();

  if (!candidateQueue.length) {
    candidateQueue = buildCandidates();
    console.log(`[Sniper] Queue rebuilt: ${candidateQueue.length} usernames`);
    if (!candidateQueue.length) {
      console.log('[Sniper] Nothing to check — add examples or watchlist items');
      return;
    }
  }

  // Always check manual watchlist first
  const watchlist = (config.watchlist || []).filter(w => !checkedCandidates.has(w));
  const batch = [...new Set([...watchlist, ...candidateQueue.splice(0, 25)])];

  console.log(`[Sniper] Checking batch of ${batch.length}...`);

  for (const username of batch) {
    checkedCandidates.add(username);
    const status = await checkUsername(username);
    const score = scoreUsername(username, config.examples || [], config.minLen || 4, config.maxLen || 10);
    checkResults[username] = { status, score, checkedAt: new Date() };

    if (status === 'available') {
      console.log(`[Sniper] 🟢 AVAILABLE: @${username} (score ${score})`);
      if (!config.notifiedUsernames.includes(username)) {
        const sent = await sendAlert(username, score);
        if (sent) {
          config.notifiedUsernames.push(username);
          if (config.notifiedUsernames.length > 1000) config.notifiedUsernames = config.notifiedUsernames.slice(-1000);
          saveConfig(config);
        }
      }
    } else if (status === 'ratelimited') {
      console.warn('[Sniper] Rate limited — pausing 20s');
      candidateQueue.unshift(username);
      checkedCandidates.delete(username);
      await sleep(20000);
      break;
    }

    await sleep(900);
  }

  console.log(`[Sniper] Done. ${candidateQueue.length} left in queue.`);
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    running: isRunning,
    lastCheck,
    checkResults,
    alertHistory,
    queueLength: candidateQueue.length,
    checkedTotal: checkedCandidates.size,
    availableCount: Object.values(checkResults).filter(v => v.status === 'available').length,
    config: {
      webhookConfigured: !!config.webhookUrl,
      examples: config.examples,
      watchlist: config.watchlist,
      minLen: config.minLen,
      maxLen: config.maxLen,
    },
  });
});

app.post('/api/config', (req, res) => {
  const { webhookUrl, examples, watchlist, minLen, maxLen } = req.body;
  if (webhookUrl !== undefined) config.webhookUrl = webhookUrl;
  if (examples !== undefined) config.examples = examples;
  if (watchlist !== undefined) config.watchlist = watchlist;
  if (minLen !== undefined) config.minLen = minLen;
  if (maxLen !== undefined) config.maxLen = maxLen;
  saveConfig(config);
  candidateQueue = [];
  checkedCandidates.clear();
  res.json({ ok: true });
});

app.post('/api/start', async (req, res) => {
  if (isRunning) return res.json({ ok: true });
  isRunning = true;
  await runCheck();
  monitorInterval = setInterval(runCheck, 90000);
  console.log('[Sniper] ▶ Started');
  res.json({ ok: true });
});

app.post('/api/stop', (req, res) => {
  clearInterval(monitorInterval);
  isRunning = false;
  console.log('[Sniper] ■ Stopped');
  res.json({ ok: true });
});

app.post('/api/check-now', async (req, res) => {
  await runCheck();
  res.json({ ok: true });
});

app.post('/api/regenerate', (req, res) => {
  candidateQueue = [];
  checkedCandidates.clear();
  checkResults = {};
  candidateQueue = buildCandidates();
  res.json({ ok: true, queueLength: candidateQueue.length });
});

app.post('/api/test-webhook', async (req, res) => {
  const url = req.body.webhookUrl || config.webhookUrl;
  if (!url) return res.json({ ok: false, error: 'No webhook URL' });
  const payload = {
    username: 'Username Sniper 👤',
    embeds: [{ title: '✅ Webhook Connected!', description: 'Username Sniper is ready.', color: 0x5865f2, timestamp: new Date().toISOString() }],
  };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    res.json({ ok: r.ok, status: r.status });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/reset', (req, res) => {
  config.notifiedUsernames = [];
  saveConfig(config);
  alertHistory = [];
  checkResults = {};
  candidateQueue = [];
  checkedCandidates.clear();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[Sniper] 🚀 http://localhost:${PORT}`);
});
