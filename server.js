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
    maxLen: 20,
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

  // ── emotional / raw ──
  'bleed','bleeds','bleeding','bled','cutsonmyhand','cutsonyourhand','scarredwrists',
  'freeher','freehim','freeus','imissher','imisshim','imissyou','imissyouso',
  'shecantforget','hecantforget','shewontcome','hewontcome','sheleftme','heleftme',
  'youletmego','iletmego','ilethergo','ilethimgo','stillinlove','stillloveyou',
  'cantmoveon','cantforget','cantforgetyou','cantforgether','cantforgethim',
  'lovesick','heartbroken','heartsick','heartache','heartburn','heartless',
  'numb','numbfeeling','numbtothepain','numbtoit','numbinside','feelingnumb',
  'empty','emptyinside','emptyroom','emptyhands','emptybed','emptyheart',
  'hollow','hollowchest','holloweyes','hollowheart','hollowbones','hollowsoul',
  'ghost','ghosted','ghosting','ghostofyou','ghostofme','ghostofus','ghostofher',
  'haunt','haunted','haunting','hauntedme','hauntedher','hishaunt','herhaunt',
  'fade','faded','fading','fadingout','fadingaway','fadedaway','fadedout',
  'drift','drifted','drifting','driftaway','driftedaway','driftedoff','driftapart',
  'lost','lostme','lostyou','lostus','lostinit','lostinher','lostinhim',
  'broken','brokedown','brokeinside','brokenheart','brokendown','brokenapart',
  'shattered','shattering','shatterme','shatteredme','shatteredus','shatteredhim',
  'torn','tornapart','tornopen','tornup','torndown','torninside','tornaside',
  'hurt','hurting','hurtsme','hurtmemore','hurtalot','hurtlikeit','hurtsobad',
  'cry','cried','crying','criedalone','criedallnight','cryalone','cryatnight',
  'tears','tearsfall','tearsdry','tearsalone','teared','tearedup','tearaway',
  'pain','painful','painless','painaway','painfades','painstays','painstuck',
  'scar','scars','scarred','scarring','scarredme','scarredover','scarreddeep',
  'wound','wounded','wounding','woundsopen','woundsclose','woundsnever','woundsdeep',
  'ache','aching','achesdeep','acheslong','acheslow','achestays','achefade',
  'miss','missing','missingher','missinghim','missingyou','missingus','missedyou',

  // ── dark / moody ──
  'dark','darker','darkest','darkinside','darkhour','darkplace','darkroom',
  'void','voidout','voided','voidme','voidus','voidinside','voidaway',
  'abyss','abysslike','abyssdeep','abysswithin','abyssfall','abyssthere',
  'shadow','shadows','shadowme','shadowhim','shadowher','shadowself','shadowside',
  'shade','shaded','shadeoff','shademe','shadeover','shadedout','shadeaway',
  'grim','grimly','grimside','grimface','grimday','grimnight','grimtale',
  'bleak','bleakly','bleakside','bleakhour','bleakroom','bleakday','bleaknight',
  'dread','dreading','dreadful','dreadmore','dreadless','dreadsit','dreadsme',
  'gloom','gloomy','gloomfall','gloomday','gloomnight','gloomover','gloomaway',
  'somber','somberly','somberme','somberday','somberhour','sombernight','sombertone',
  'mournful','mourning','mourned','mournher','mournhim','mournus','mournalone',
  'grieve','grieving','grieved','griefstruck','grieffalls','grieffades','griefstays',
  'wither','withered','withering','witheraway','witherslow','withersout','withersdeep',
  'decay','decayed','decaying','decayinside','decayslow','decaysout','decaysaway',
  'rust','rusted','rusting','rustaway','rustover','ruststay','rustdeep',
  'rot','rotting','rotted','rotaway','rotslow','rotsinside','rotsout',
  'crumble','crumbled','crumbling','crumbledown','crumbleaway','crumbleout',

  // ── attitude / tuff ──
  'cold','colder','coldest','coldinside','coldblood','coldheart','coldeyes',
  'stone','stoned','stonecold','stoneface','stonewall','stonehard','stoneheart',
  'nonchalant','unbothered','unfazed','unphased','detached','disconnected',
  'ruthless','careless','reckless','restless','loveless','fearless','hopeless',
  'dead','deadinside','deadpan','deadcold','deadset','deadzone','deadweight',
  'killer','killervibe','killerinstinct','killermood','killerway','killerlook',
  'savage','savagely','savagemode','savageside','savagery','savagetime',
  'demon','demonmode','demonside','demonhours','demonrun','demontime','demoncore',
  'devil','devilish','devilside','devilgrin','devileyes','devilmood','devilrun',
  'villain','villainarc','villainmode','villainera','villainside','villainpov',
  'menace','menacing','menaceme','menacemode','menacevibes','menaceera',
  'threat','threaten','threatening','threatmode','threatlevel','threatreal',
  'reign','reigning','reignover','reignfall','reignalone','reigncold','reignsilent',
  'reign','reigned','reigncheck','reignfree','reignhigh','reignlow','reignout',
  'nocap','frfr','onsite','ontop','ontopofitall','ontopforever','ontopalone',
  'lowkey','lowkeyme','lowkeyfaded','lowkeybroken','lowkeyhurting','lowkeygone',
  'silent','silently','silenttype','silentkiller','silenthurt','silentpain',
  'quiet','quietly','quietkiller','quietrage','quietpain','quiethurt','quiethours',

  // ── aesthetic ──
  'lunar','lunarvibe','lunarcore','lunarhour','lunardream','lunardrift','lunarnight',
  'solar','solarflare','solarcore','solardrift','solarhour','solarnight','solarwave',
  'astral','astraldrift','astralplane','astralcore','astralhour','astralnight',
  'cosmic','cosmicpain','cosmiccore','cosmicdrift','cosmichour','cosmicnight',
  'ethereal','etherealme','etherealdrift','etherealcore','etherealhour','etherealvibe',
  'celestial','celestialcore','celestialdrift','celestialhour','celestialnight',
  'nebula','nebulacore','nebuladrift','nebulahour','nebulanight','nebulavibe',
  'aurora','auroracore','auroradrift','aurorahour','auroranight','auroravibe',
  'frost','frostbite','frostcore','frostdrift','frosthour','frostnight','frostvibe',
  'frozen','frozencore','frozendrift','frozenhour','frozennight','frozenvibe',
  'crystal','crystalcore','crystaldrift','crystalhour','crystalnight','crystalvibe',
  'prism','prismcore','prismdrift','prismhour','prismnight','prismvibe','prismlight',
  'velvet','velvetcore','velvetdrift','velvethour','velvetnight','velvetvibe',
  'silk','silkcore','silkdrift','silkhour','silknight','silkvibe','silktouch',
  'marble','marblecore','marbledrift','marblemood','marblehour','marblevibe',
  'onyx','onyxcore','onyxdrift','onyxhour','onyxnight','onyxvibe','onyxmood',
  'obsidian','obsidiancore','obsidiandrift','obsidianhour','obsidiannight',
  'ivory','ivorycore','ivorydrift','ivoryhour','ivorynight','ivoryvibe',
  'scarlet','scarletcore','scarletdrift','scarlethour','scarletnight','scarletvibe',
  'crimson','crimsoncore','crimsondrift','crimsonhour','crimsonnight','crimsonvibe',
  'indigo','indigocore','indigodrift','indigohour','indigonight','indigovibe',
  'violet','violetcore','violetdrift','violethour','violetnight','violetvibe',
  'cobalt','cobaltcore','cobaltdrift','cobalthour','cobaltnight','cobaltvibe',
  'azure','azurecore','azuredrift','azurehour','azurenight','azurevibe',

  // ── nature dark ──
  'raven','ravencore','ravenwing','ravenhour','ravennight','ravenvibe','ravenlike',
  'crow','crowcore','crowwing','crowhour','crownight','crowvibe','crowlike',
  'wolf','wolfcore','wolfhour','wolfnight','wolfalone','wolfpack','wolfmode',
  'fox','foxcore','foxhour','foxnight','foxalone','foxlike','foxmode',
  'viper','vipercore','viperhour','vipernight','vipermode','viperlike','viperstrike',
  'serpent','serpentcore','serpenthour','serpentnight','serpentmode','serpentlike',
  'phantom','phantomcore','phantomhour','phantomnight','phantommode','phantomlike',
  'specter','spectercore','specterhour','specternight','spectermode','specterlike',
  'wraith','wraithcore','wraithhour','wraithnight','wraithmode','wraithlike',
  'revenant','revenantcore','revenanthour','revenantnight','revenantmode',
  'banshee','bansheecore','bansheehour','bansheenight','bansheemode','bansheelike',

  // ── short clean rare ──
  'vex','hex','nox','lux','ryx','zyn','kael','lune','zara','aeon',
  'nova','lyra','vela','oryn','zoel','cael','nael','rael','dael','fael',
  'isle','vale','gale','hale','bale','dale','tale','pale','male','sale',
  'dusk','dawn','noon','mist','veil','haze','husk','halo','echo','glow',
  'flux','crux','apex','nadir','nexus','vortex','cipher','relic','ember',
  'sable','noble','fable','table','cable','gable','stable','able',
  'elegy','dirge','throe','knell','vigil','revel','quell','dwelt','bereft',

  // ── phrases / compound ──
  'cutdeep','cutsdeep','rundeep','runsdeep','goesdeep','staysdeep','feelsdeep',
  'bleednow','bleedout','bleedthrough','bleedaway','bleedalone','bleedslow',
  'cryalone','crytome','crywithme','cryitout','cryforher','cryforhim','cryforus',
  'diealone','dieinside','dieslowly','dieforyou','dieforher','dieforhim',
  'livealone','livewithit','livewithpain','liveforher','liveforhim','liveforit',
  'stayalone','staygone','staycold','stayaway','staynumb','stayhurt','staybroken',
  'goneforgood','goneforever','gonealone','gonecold','gonewild','gonenumb',
  'neverhealed','nevermended','neverclosed','neverfaded','nevergone','neverfree',
  'alwayshurt','alwayscold','alwaysnumb','alwaysalone','alwaysbroken','alwaysthere',
  'justme','justus','justalone','justnumb','justhurt','justbroken','justgone',
  'onlyme','onlyus','onlyalone','onlynumb','onlyhurt','onlybroken','onlygone',
  'nooneleft','noonehere','nooneknows','noonecares','noonesaw','noonestayed',
  'leftbehind','leftalone','leftcold','leftnumb','lefthurt','leftbroken',
  'leftme','leftyou','lefther','lefthim','leftus','leftitall','leftitbehind',

].map(w => w.toLowerCase()).filter(w => w.length >= 4 && w.length <= 32 && /^[a-z0-9]+$/.test(w));

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
