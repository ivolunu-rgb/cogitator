/* ---------- CONFIG ---------- */
const MODEL_NAME = 'qwen2.5:0.5b';
const OLLAMA_URL = new URLSearchParams(window.location.search).get('spirit')
  || 'http://127.0.0.1:11434/api/generate';
const SPIRIT_CHANCE = 0.12;
const SPIRIT_TIMEOUT_MS = 30000;

/* ---------- HELPERS ---------- */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* ---------- AUDIO ---------- */
let audioCtx = null;
let masterGain = null;
let clickBuffer = null;

function initAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;

  audioCtx = new AC();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.4;
  masterGain.connect(audioCtx.destination);

  const seconds = 0.03;
  const len = Math.floor(audioCtx.sampleRate * seconds);
  clickBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = clickBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  }
}

function unlockAudio() {
  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => { });
  }
}

function tick(volume = 0.05, rate = 1) {
  if (!audioCtx || !clickBuffer) return;
  if (audioCtx.state !== 'running') return;

  const src = audioCtx.createBufferSource();
  src.buffer = clickBuffer;
  src.playbackRate.value = rate * (0.85 + Math.random() * 0.3);

  const g = audioCtx.createGain();
  g.gain.value = volume;

  src.connect(g);
  g.connect(masterGain);
  src.start();
}

window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

/* ---------- TYPING / OUTPUT (WebGL) ---------- */

// lines that only flicker under glitches and are never left corrupted
const READABLE = ['event', 'alarm', 'news', 'newshead'];

async function typeLine(text, cls = '', speed = 28) {
  const level = corruption / 100;
  // a strained machine loses the ends of its sentences (events and news stay readable)
  const mustRead = READABLE.includes(cls);
  if (!mustRead && level > 0.45 && text.length > 12 && Math.random() < level - 0.35) {
    text = text.slice(0, Math.floor(text.length * (0.35 + Math.random() * 0.45))) +
      randItem([' —', '...', ' ▓▓▒', ' //ERR', ' [LOST]']);
  }

  const line = beginLine(text, cls);
  view.typing = true;
  const baseRate = cls === 'warn' ? 0.65 : 1;

  for (let i = 0; i < text.length; i++) {
    if (!mustRead && text[i] !== ' ' && Math.random() < corruption / 1200 + level * level * 0.15) {
      line.text = line.text.slice(0, i) + randGlitchChar() + line.text.slice(i + 1);
    }
    line.shown++;
    view.dirty = true;
    tick(0.04 + Math.random() * 0.02, baseRate * (0.9 + Math.random() * 0.2));
    await sleep(rand(speed - 10, speed + 18));
    // ...and stutters mid-word
    if (Math.random() < level * level * 0.06) await sleep(rand(150, 600));
  }

  tick(0.05, baseRate * 0.5);
  view.typing = false;
  view.dirty = true;
  await sleep(rand(120, 450));
}

function scrambleLastLine() {
  const line = view.lines[view.lines.length - 1];
  if (!line || line.shown < line.text.length) return;

  const original = line.text;
  let frames = 0;
  const maxFrames = rand(3, 6);

  const iv = setInterval(() => {
    frames++;
    let out = '';
    for (const ch of original) {
      out += (ch !== ' ' && Math.random() < 0.3) ? randGlitchChar() : ch;
    }
    line.text = out;
    view.dirty = true;

    if (frames >= maxFrames) {
      clearInterval(iv);
      if (Math.random() < 0.8 || READABLE.includes(line.cls)) line.text = original;
      view.dirty = true;
    }
  }, 40);
}

function triggerScreenGlitch() { crtPunch(); }
function triggerRoll() { crtRoll(); }

async function showEmblem() {
  view.emblemStart = performance.now();
  view.dirty = true;
  await sleep(1700);
}

/* ---------- GLITCH HELPERS ---------- */
const GLITCH_CHARS = '▓▒░█#%@&$01';
function randGlitchChar() {
  return GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
}

/* ---------- STATUS BAR (WebGL) ---------- */
let corruption = 3;
let uptimeSec = 0;

function updateStatus() {
  uptimeSec++;
  status.uptime = uptimeSec;

  // With real readings, corruption follows how hard the machine is working; otherwise it drifts.
  const stress = machineStress();
  if (stress === null) {
    corruption += rand(-2, 3);
  } else {
    // unjudged heresy unsettles the spirit too
    const target = 3 + 92 * Math.pow(stress, 1.5) + Math.min(30, sentinelPending().length * 12);
    corruption += (target - corruption) * 0.15 + rand(-2, 2);
  }
  if (Math.random() < 0.06) {
    corruption += rand(5, 15);
    crtPunch();
  }
  if (phase === 'CORRUPTION') corruption += 1;
  if (phase === 'LITANY') corruption -= 1;
  corruption = clamp(Math.round(corruption), 1, stress === null ? 60 : 100);

  status.corruption = corruption;
  status.signal = clamp(100 - corruption - rand(0, 6), 20, 100);
  status.phase = phase;
  status.mode = mode;
  view.dirty = true;
}

setInterval(updateStatus, 1000);

/* ---------- CONTENT GENERATION ---------- */
function makeHexLine() {
  const count = rand(3, 6);
  const parts = [];
  for (let i = 0; i < count; i++) {
    parts.push('0x' + randHex(4));
  }
  return parts.join(' ');
}

function fillTokens(text) {
  return text
    .split('{ADDR}').join(randAddr())
    .split('{CODE}').join(randCode())
    .split('{PCT}').join(corruption)
    .split('{TEMP}').join(gpuTempText());
}

function nextEndlessLine() {
  const mix = PHASE_MIX[phase] || PHASE_MIX.IGNITION;
  const speedMul = PHASE_SPEED[phase] || 1;
  const roll = Math.random();

  let text, cls, speed;

  // BOOT / SYSTEM
  if (roll < mix.boot) {
    if (Math.random() < 0.4) {
      text = randBootLogLine();
      speed = rand(12, 18);
    } else {
      text = fillTokens(randItem(bootLines));
      speed = rand(18, 26);
    }
    cls = 'boot';
  }
  // HEX DATA
  else if (roll < mix.boot + mix.hex) {
    text = makeHexLine();
    cls = 'hex';
    speed = rand(8, 14);
  }
  // PRAYERS
  else if (roll < mix.boot + mix.hex + mix.prayer) {
    if (Math.random() < 0.5) {
      text = randMachineCant();
    } else {
      text = fillTokens(randItem(prayerLines));
    }
    cls = 'prayer';
    speed = rand(26, 36);
  }
  // WARNINGS
  else if (roll < mix.boot + mix.hex + mix.prayer + mix.warn) {
    const heresy = randHeresyFlag();
    text = heresy;
    if (ALARM_FLAG.test(heresy)) {
      cls = 'warn';
    } else {
      cls = 'boot';
    }
    speed = rand(24, 32);
  }
  // RESPONSES
  else {
    text = fillTokens(randItem(responseLines));
    cls = 'prayer';
    speed = rand(24, 34);
  }

  return { text, cls, speed: Math.round(speed * speedMul) };
}

/* ---------- PHASES ---------- */
let phase = 'IGNITION';
let mode = 'BOOT';

const PHASE_MIX = {
  IGNITION: { boot: 0.45, hex: 0.25, prayer: 0.15, warn: 0.10 },
  LITANY: { boot: 0.15, hex: 0.10, prayer: 0.50, warn: 0.05 },
  DIAGNOSTIC: { boot: 0.20, hex: 0.50, prayer: 0.10, warn: 0.10 },
  CORRUPTION: { boot: 0.15, hex: 0.20, prayer: 0.10, warn: 0.40 }
};

const PHASE_SPEED = {
  IGNITION: 0.9,
  LITANY: 1.25,
  DIAGNOSTIC: 0.7,
  CORRUPTION: 1.0
};

let phaseUntil = Date.now() + rand(30000, 60000);

function shiftPhase() {
  const others = PHASES.filter(p => p !== phase);
  // a tormented machine keeps falling back into CORRUPTION
  phase = corruption > 60 && phase !== 'CORRUPTION' && Math.random() < 0.6 ? 'CORRUPTION' : randItem(others);
  phaseUntil = Date.now() + rand(30000, 60000);
}

/* ---------- MACHINE SPIRIT ---------- */
function setSpirit(state) {
  status.model = state;
  view.dirty = true;
}

async function askMachineSpirit(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPIRIT_TIMEOUT_MS);

  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL_NAME,
        system: SPIRIT_SYSTEM + (corruption > 50 ? STRAIN_NOTE : ''),
        prompt: prompt || randItem(SPIRIT_PROMPTS),
        stream: false,
        keep_alive: -1,
        options: { temperature: 0.5, num_ctx: 1024, num_predict: 42}
      })
    });

    if (!res.ok) return [];
    const data = await res.json();
    setSpirit('COMMUNION');

    return (data.response || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.length > 90 ? s.slice(0, 90) + ' ...' : s)
      .slice(0, 3);
  } catch (e) {
    setSpirit('DORMANT');
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------- BOOT / MAIN ---------- */
async function boot() {
  await showEmblem();
  await sleep(700);

  const script = BOOT_SCRIPT();
  for (let i = 0; i < script.length; i++) {
    const [line, cls, speed] = script[i];
    if (i === script.length - 1) await sleep(700);
    await typeLine(typeof line === 'function' ? line() : line, cls, speed);
  }
}

/* ---------- EVENTS ---------- */
async function announceEvent(e) {
  const said = eventLines(e);
  if (!said) return;

  triggerScreenGlitch();
  // events that waited out a pause (e.g. a fullscreen game) are reported as a log
  const stamp = Date.now() - e.time > 60000 ? '[LOGGED ' + clockTime(e.time) + '] ' : '';
  for (let i = 0; i < said.lines.length; i++) {
    await typeLine((i === 0 ? stamp : '') + said.lines[i], said.cls, 22);
  }

  const prompt = eventSpiritPrompt(e);
  if (prompt) {
    for (const l of await askMachineSpirit(prompt)) {
      await typeLine(l, 'spirit', 26);
    }
  }
  await sleep(rand(400, 1000));
}

/* ---------- NEWS ---------- */
// Headlines from the wallpaper server (feeds listed in C:\cogitator\wallpaper\news.json),
// typed as intercepted astropathic messages.
let newsEveryMs = 90000;   // set in the admin page (news.json: showEverySeconds)
let lastNews = Date.now() - newsEveryMs / 2;   // the first one about 45 s after start

function loadNewsSettings() {
  if (!location.protocol.startsWith('http')) return;
  fetch('news/settings', { cache: 'no-store' })
    .then(r => r.json())
    .then(s => {
      newsEveryMs = s.showEverySeconds * 1000;
      // the theme was switched in the admin page: start again in the new one
      if (s.theme && s.theme !== THEME.id && !THEME_PREVIEW) location.reload();
    })
    .catch(() => { });
}
loadNewsSettings();
setInterval(loadNewsSettings, 60000);

function ageText(time) {
  const min = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (min < 60) return min + ' MIN AGO';
  if (min < 48 * 60) return Math.round(min / 60) + 'H AGO';
  return Math.round(min / 1440) + 'D AGO';
}

async function fetchNews() {
  if (!location.protocol.startsWith('http') || Date.now() - lastNews < newsEveryMs) return null;
  lastNews = Date.now();
  try {
    return await (await fetch('news/next', { cache: 'no-store' })).json();
  } catch {
    return null;
  }
}

async function announceNews(n) {
  triggerRoll();
  await typeLine(THEME.newsHeader(n, ageText(n.time)), 'newshead', 16);
  await typeLine(n.title, 'news', 24);

  if (Math.random() < 0.5) {
    const said = await askMachineSpirit(NEWS_PROMPT(n.title));
    // the small model likes to parrot the headline back; keep only its own words
    for (const l of said.filter(l => !echoes(l, n.title))) {
      await typeLine(l, 'spirit', 26);
    }
  }
  await sleep(rand(600, 1400));
}

function echoes(line, title) {
  const words = s => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
  const own = words(line);
  const theirs = words(title);
  let shared = 0;
  for (const w of own) if (theirs.has(w)) shared++;
  return own.size > 0 && shared / own.size > 0.4;
}

async function endlessMode() {
  while (true) {
    if (eventQueue.length) {
      await announceEvent(eventQueue.shift());
      continue;
    }

    const news = await fetchNews();
    if (news) {
      await announceNews(news);
      continue;
    }

    // a strained machine: pleas to calm its spirit and red corruption lines
    const level = corruption / 100;
    if (level > 0.4 && Math.random() < (level - 0.3) * 0.6) {
      if (Math.random() < 0.5) {
        await typeLine(fillTokens(randItem(appeaseLines)), 'prayer', rand(30, 42));
      } else {
        triggerScreenGlitch();
        await typeLine(fillTokens(randItem(corruptionLines)), 'warn', 20);
      }
      await fillerPause();
      continue;
    }

    // phase shift
    if (Date.now() > phaseUntil) {
      shiftPhase();
      triggerScreenGlitch();
      await typeLine(THEME.phaseShift(phase), 'boot', 20);
    }

    const spiritChance = SPIRIT_CHANCE *
      (phase === 'LITANY' ? 1.6 : phase === 'DIAGNOSTIC' ? 0.5 : 1);

    if (Math.random() < spiritChance) {
      const spiritLines = await askMachineSpirit();
      if (spiritLines.length) {
        for (const l of spiritLines) {
          await typeLine(l, 'spirit', 26);
        }
        await sleep(rand(400, 1000));
        continue;
      }
    }

    const item = nextEndlessLine();
    await typeLine(item.text, item.cls, item.speed);

    if (corruption > 30 && Math.random() < 0.12 + corruption / 300) {
      triggerScreenGlitch();
      await typeLine(randItem(degradeLines), 'glitchline', 20);
    }

    await fillerPause();
  }
}

// Background chatter is slow, so news and alerts don't scroll away; an event cuts the pause short.
async function fillerPause() {
  const until = Date.now() + rand(2000, 4500);
  while (Date.now() < until && !eventQueue.length) await sleep(200);
}

async function startConsole() {
  await boot();
  mode = 'ENDLESS';
  status.mode = mode;
  view.dirty = true;

  askMachineSpirit(); // warm up

  await endlessMode();
}

/* ---------- GLITCH / ROLL SCHEDULERS ---------- */
setInterval(() => {
  if (Math.random() < corruption / 450) triggerScreenGlitch();
  if (Math.random() < corruption / 250) scrambleLastLine();
}, 2500);

(function scheduleRoll() {
  setTimeout(() => {
    triggerRoll();
    scheduleRoll();
  }, Math.max(3000, rand(7000, 15000) - corruption * 80));
})();

/* ---------- SCREENSAVER MODE ---------- */
const saverParams = new URLSearchParams(window.location.search);

if (saverParams.get('saver') === '1') {
  let sx = null, sy = null;

  window.addEventListener('mousemove', (e) => {
    if (sx === null) { sx = e.screenX; sy = e.screenY; return; }
    if (Math.abs(e.screenX - sx) + Math.abs(e.screenY - sy) > 25) window.close();
  });

  ['keydown', 'mousedown', 'wheel', 'touchstart'].forEach(ev => {
    window.addEventListener(ev, () => window.close(), { once: true });
  });
}

/* ---------- INIT ---------- */
unlockAudio();
startConsole();