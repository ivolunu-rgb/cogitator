const view = {
  lines: [],
  typing: false,
  emblemStart: -1,
  dirty: true
};

const status = {
  model: 'DORMANT',
  phase: 'IGNITION',
  mode: 'BOOT',
  corruption: 3,
  signal: 98,
  uptime: 0
};

const COLORS = {
  boot: 'rgba(125,255,155,0.55)',
  hex: 'rgba(125,255,155,0.38)',
  prayer: '#b8ffcc',
  warn: '#ff4b3a',
  spirit: '#eafff0',
  glitchline: '#ff4b3a',
  event: '#ffc861',
  alarm: '#ff5a44',   // events that matter: heresy, verdicts, overheating
  newshead: 'rgba(143,227,255,0.55)',
  news: '#8fe3ff'
};

const GLOW = { prayer: 12, spirit: 14, warn: 10, glitchline: 12, event: 12, alarm: 14, news: 12 };

// Cyrillic glyphs fall through to CogitatorCyrillic (see app.html)
const FONT = 'VT323, CogitatorCyrillic, monospace';

/* ---------- WALLPAPER LAYOUT ---------- */
const SCALE = 2;            // text size relative to the original console
const PANEL_SHARE = 0.45;   // right column: vitals, art carousel, chronometrum
const VITALS_H = 205;       // panel heights, in units of SCALE
const CHRONO_H = 88;
const ART_SECONDS = 30;     // how long each picture stays
const ART_FADE_MS = 1500;

const off = document.createElement('canvas');
const octx = off.getContext('2d');

const emblemImg = new Image();
emblemImg.src = 'assets/emblem.png';
emblemImg.onload = () => { view.dirty = true; };

// text widths change once the web fonts arrive; wrapped lines are re-measured then
let fontEpoch = 0;
if (document.fonts) {
  Promise.all([document.fonts.load('44px ' + FONT, 'AZ'), document.fonts.load('44px ' + FONT, 'АЯ')])
    .catch(() => { })
    .then(() => { fontEpoch++; view.dirty = true; });
}

function beginLine(text, cls) {
  const line = { text, cls, shown: 0 };
  view.lines.push(line);
  if (view.lines.length > 130) view.lines.shift();
  view.dirty = true;
  return line;
}

let lastDraw = 0;

function needsDraw(now) {
  return view.dirty || (now - lastDraw > 100);
}

/* ---------- ART CAROUSEL ---------- */
const art = { files: [], next: 0, cur: null, prev: null, fadeStart: -1, rect: null, timer: null };

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function showNextArt() {
  if (!art.files.length) return;
  const name = art.files[art.next];
  art.next = (art.next + 1) % art.files.length;

  const img = new Image();
  img.onload = () => {
    art.prev = art.cur;
    art.cur = { img, name: name.replace(/\.[^.]+$/, '') };
    art.fadeStart = performance.now();
    view.dirty = true;
    if (typeof crtPunch === 'function') crtPunch();
  };
  img.src = 'art/' + encodeURIComponent(name);
}

function restartArtTimer() {
  clearInterval(art.timer);
  art.timer = setInterval(showNextArt, ART_SECONDS * 1000);
}

// Pictures come from the wallpaper server (C:\cogitator\wallpaper\art); the offline copy has none.
// The list is re-read every minute: pictures added in the admin page go to the front of the queue.
function loadArtIndex() {
  fetch('art/index.json', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : [])
    .then(files => {
      const known = new Set(art.files);
      const added = files.filter(f => !known.has(f));
      const before = art.files.slice(0, art.next).filter(f => files.includes(f)).length;
      art.files = art.files.filter(f => files.includes(f));
      art.next = before;
      art.files.splice(art.next, 0, ...(known.size ? added : shuffle(added)));
      if (art.next >= art.files.length) art.next = 0;
      if (!art.cur && art.files.length) {
        showNextArt();
        restartArtTimer();
      }
    })
    .catch(() => { });
}

if (location.protocol.startsWith('http')) {
  loadArtIndex();
  setInterval(loadArtIndex, 60000);
}

function inside(r, e) {
  return r && e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h;
}

// Lively passes desktop clicks through: sentinel buttons first, then a click on the picture brings the next one.
let sentinelButtons = [];
window.addEventListener('mousedown', e => {
  const b = sentinelButtons.find(btn => inside(btn, e));
  if (b) {
    // a stray click on the desktop must not purge anything: NOT OK wants a second click
    const c = sentinel.confirm;
    if (b.verdict === 'purge' && !(c && c.id === b.alert.id && Date.now() < c.until)) {
      sentinel.confirm = { id: b.alert.id, until: Date.now() + 5000 };
      view.dirty = true;
      return;
    }
    sendVerdict(b.alert, b.verdict);
    return;
  }
  if (inside(art.rect, e)) {
    showNextArt();
    restartArtTimer();
  }
});

function fitRect(img, x, y, w, h) {
  const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * k;
  const ih = img.naturalHeight * k;
  return { x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih };
}

/* ---------- PANELS ---------- */
const GREEN = [125, 255, 155];
const RED = [255, 75, 58];

// green phosphor, shifting towards red as redness goes 0 -> 1
function tone(alpha, redness = 0) {
  const c = GREEN.map((g, i) => Math.round(g + (RED[i] - g) * redness));
  return 'rgba(' + c.join(',') + ',' + alpha + ')';
}

// Mechanicus-style frame: header strip with title and rivets, heavy corner brackets.
// Returns the y where the content starts.
function drawFrame(ctx, x, y, w, h, title, redness = 0) {
  const U = SCALE;
  const HEAD = 24 * U;

  ctx.shadowBlur = 0;
  ctx.fillStyle = tone(0.035, redness);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = tone(0.15, redness);
  ctx.fillRect(x, y, w, HEAD);

  ctx.font = (16 * U) + 'px ' + FONT;
  ctx.fillStyle = tone(0.95, redness);
  ctx.fillText('⚙ ' + title, x + 8 * U, y + 3 * U);
  for (let i = 0; i < 3; i++) ctx.fillRect(x + w - (14 + i * 9) * U, y + 10 * U, 4 * U, 4 * U);

  ctx.lineWidth = U;
  ctx.strokeStyle = tone(0.4, redness);
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = tone(0.12, redness);
  ctx.strokeRect(x + 5 * U, y + HEAD + 5 * U, w - 10 * U, h - HEAD - 10 * U);

  ctx.lineWidth = 2.5 * U;
  ctx.strokeStyle = tone(0.9, redness);
  const L = 14 * U;
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * L, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * L);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  return y + HEAD;
}

// segmented gauge; the far end glows amber, then red
function drawBar(ctx, x, y, w, h, value) {
  const SEG = 20;
  const gap = 2 * SCALE;
  const sw = (w - gap * (SEG - 1)) / SEG;
  const lit = Math.round(clamp(value, 0, 1) * SEG);
  for (let i = 0; i < SEG; i++) {
    const redness = i >= SEG * 0.8 ? 1 : i >= SEG * 0.6 ? 0.45 : 0;
    ctx.fillStyle = i < lit ? tone(0.85, redness) : tone(0.1);
    ctx.fillRect(x + i * (sw + gap), y, sw, h);
  }
}

// the last two minutes of load, as a heartbeat line
function drawPulse(ctx, x, y, w, h, redness) {
  const hist = telemetry.history;
  if (h < 10 * SCALE) return;
  ctx.strokeStyle = tone(0.15, redness);
  ctx.strokeRect(x, y, w, h);
  if (hist.length < 2) return;

  ctx.strokeStyle = tone(0.85, redness);
  ctx.shadowColor = tone(0.6, redness);
  ctx.shadowBlur = 6 * SCALE;
  ctx.lineWidth = 1.5 * SCALE;
  ctx.beginPath();
  hist.forEach((val, i) => {
    const px = x + (i / 59) * w;
    const py = y + h - 2 * SCALE - (val / 100) * (h - 4 * SCALE);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
}

function drawVitals(ctx, x, y, w, h) {
  const v = telemetry.vitals;
  const stress = machineStress() || 0;
  // under strain the frame reddens and stutters
  let redness = clamp((stress - 0.4) / 0.4, 0, 1);
  if (stress > 0.6 && Math.random() < stress * 0.3) redness *= 0.4;

  let cy = drawFrame(ctx, x, y, w, h, 'AUSPEX :: GENERATOR-SOUL VITAE', redness) + 10 * SCALE;
  const left = x + 14 * SCALE;
  ctx.font = (17 * SCALE) + 'px ' + FONT;

  if (!v) {
    ctx.fillStyle = tone(0.8, 1);
    ctx.fillText('AUSPEX OFFLINE :: NO READINGS FROM THE MACHINE', left, cy);
    return;
  }

  const ROW = 21 * SCALE;
  const valueX = x + w * 0.42;
  const barX = x + w * 0.64;
  const barW = x + w - 14 * SCALE - barX;

  function row(label, value, frac, red) {
    if (red === undefined) red = frac > 0.85 ? 1 : frac > 0.65 ? 0.45 : 0;
    ctx.fillStyle = tone(0.55);
    ctx.fillText(label, left, cy);
    ctx.fillStyle = tone(0.95, red);
    ctx.fillText(value, valueX, cy);
    if (frac !== null) drawBar(ctx, barX, cy + 7 * SCALE, barW, 9 * SCALE, frac);
    cy += ROW;
  }

  const gb = bytes => (bytes / 1073741824).toFixed(1);
  if (v.cpu) row('LOGIC-ENGINE   :: CPU', v.cpu.load + '%', v.cpu.load / 100);
  if (v.gpu) {
    const heat = isFinite(v.gpu.temp) ? clamp((v.gpu.temp - 60) / 25, 0, 1) : 0;
    row('GENERATOR-SOUL :: GPU', v.gpu.load + '%   ' + v.gpu.temp + '°C', v.gpu.load / 100, Math.max(heat, v.gpu.load > 85 ? 0.45 : 0));
    row('VRAM RELIQUARY', (v.gpu.memUsed / 1024).toFixed(1) + ' / ' + (v.gpu.memTotal / 1024).toFixed(1) + ' GB', v.gpu.memUsed / v.gpu.memTotal);
  } else {
    row('GENERATOR-SOUL :: GPU', 'SILENT', null, 1);
  }
  if (v.ram) row('COGITATIVE STORE', gb(v.ram.used) + ' / ' + gb(v.ram.total) + ' GB', v.ram.used / v.ram.total);

  // temperament and noosphere share a row
  ctx.fillStyle = tone(0.55);
  ctx.fillText('TEMPERAMENT', left, cy);
  ctx.fillStyle = tone(0.95, redness);
  ctx.fillText(temperament(stress), valueX, cy);
  ctx.fillStyle = tone(0.8, v.online === false ? 1 : 0);
  ctx.fillText('NOOSPHERE :: ' + (v.online === false ? 'SEVERED' : 'LINKED'), barX, cy);
  cy += ROW;

  // the sentinel's wards, and how many knocks the firewall turned away today
  const s = telemetry.sentinel;
  const heresy = sentinelPending().length;
  let wards = 'PURITY ASSURED', wardsRed = 0;
  if (!s || !s.running) { wards = s && s.installed ? 'SILENT' : 'NOT INSTALLED'; wardsRed = 0.45; }
  else if (heresy) { wards = 'HERESY x' + heresy; wardsRed = 1; }
  else if (s.learning) wards = 'LEARNING :: ' + Math.max(1, Math.ceil((s.learningUntil - Date.now()) / 864e5)) + 'D LEFT';
  ctx.fillStyle = tone(0.55);
  ctx.fillText('WARDS', left, cy);
  ctx.fillStyle = tone(0.95, wardsRed);
  ctx.fillText(wards, valueX, cy);
  if (s && s.running) {
    ctx.fillStyle = tone(0.8, s.knocks.outer ? 0.45 : 0);
    ctx.fillText('KNOCKS :: ' + s.knocks.outer + ' VOID / ' + s.knocks.lan + ' LAN', barX, cy);
  }
  cy += ROW;

  drawPulse(ctx, left, cy + 4 * SCALE, x + w - 14 * SCALE - left, y + h - cy - 16 * SCALE, redness);
}

function drawChrono(ctx, x, y, w, h) {
  const d = new Date();
  const cy = drawFrame(ctx, x, y, w, h, 'CHRONOMETRUM :: HOLY TERRA STANDARD') + 6 * SCALE;
  const left = x + 14 * SCALE;

  ctx.font = (30 * SCALE) + 'px ' + FONT;
  ctx.fillStyle = COLORS.prayer;
  ctx.shadowColor = COLORS.prayer;
  ctx.shadowBlur = 10 * SCALE;
  ctx.fillText(imperialDate(d), left, cy);
  ctx.shadowBlur = 0;

  ctx.font = (16 * SCALE) + 'px ' + FONT;
  ctx.fillStyle = tone(0.6);
  ctx.fillText(localStamp(d), left, cy + 31 * SCALE);
}

function drawArt(ctx, x, y, w, h, now) {
  const HEAD = 24 * SCALE;
  const FRAME = 6 * SCALE;
  const t = art.fadeStart < 0 ? 1 : Math.min(1, (now - art.fadeStart) / ART_FADE_MS);
  if (t < 1) view.dirty = true;

  const box = img => fitRect(img, x + FRAME, y + HEAD + FRAME, w - FRAME * 2, h - HEAD - FRAME * 2);
  const r = box(art.cur.img);
  drawFrame(ctx, r.x - FRAME, r.y - FRAME - HEAD, r.w + FRAME * 2, r.h + FRAME * 2 + HEAD,
    'PICT-ARCHIVE :: ' + art.cur.name.toUpperCase());

  for (const [item, alpha] of [[art.prev, 1 - t], [art.cur, t]]) {
    if (!item || alpha <= 0) continue;
    const ri = box(item.img);
    ctx.globalAlpha = alpha * 0.9;
    ctx.drawImage(item.img, ri.x, ri.y, ri.w, ri.h);
  }
  ctx.globalAlpha = 1;
  art.rect = r;
}

// An alert awaiting a verdict takes the art's place.
function drawSentinel(ctx, x, y, w, h, now) {
  const list = sentinelPending();
  const a = list[0];
  const red = a.severity === 'low' ? 0.45 : 1;
  const title = 'ORDO SENTINEL :: HERESY DETECTED' + (list.length > 1 ? ' :: 1 OF ' + list.length : '');
  let cy = drawFrame(ctx, x, y, w, h, title, (now % 1200) < 600 ? red : red * 0.6) + 12 * SCALE;
  const left = x + 14 * SCALE;
  const maxW = w - 28 * SCALE;

  const BTN_H = 34 * SCALE;
  const btnY = y + h - BTN_H - 14 * SCALE;

  ctx.font = (17 * SCALE) + 'px ' + FONT;
  ctx.fillStyle = tone(0.7, red);
  ctx.fillText('[' + a.severity.toUpperCase() + ']  ' + clockTime(a.time), left, cy);
  cy += 22 * SCALE;

  ctx.font = (20 * SCALE) + 'px ' + FONT;
  ctx.fillStyle = tone(1, red);
  ctx.shadowColor = tone(0.6, red);
  ctx.shadowBlur = 8 * SCALE;
  for (const [s, e] of wrapRanges(ctx, a.title, maxW)) {
    ctx.fillText(a.title.slice(s, e), left, cy);
    cy += 24 * SCALE;
  }
  ctx.shadowBlur = 0;
  cy += 6 * SCALE;

  ctx.font = (16 * SCALE) + 'px ' + FONT;
  ctx.fillStyle = tone(0.75);
  for (const line of a.lines) {
    // details in full (commands can be long); only the buttons below set the limit
    for (const [s, e] of wrapRanges(ctx, line, maxW)) {
      if (cy + 20 * SCALE > btnY - 8 * SCALE) break;
      ctx.fillText(line.slice(s, e), left, cy);
      cy += 20 * SCALE;
    }
  }

  // buttons
  const confirming = sentinel.confirm && sentinel.confirm.id === a.id && Date.now() < sentinel.confirm.until;
  const actions = a.actions.includes('purge')
    ? [['ok', 'OK :: SANCTION'], ['purge', confirming ? 'CONFIRM PURGE?' : 'NOT OK :: PURGE']]
    : [['ack', 'ACKNOWLEDGED']];
  const gap = 14 * SCALE;
  const bw = (maxW - gap * (actions.length - 1)) / actions.length;
  sentinelButtons = actions.map(([verdict, label], i) => {
    const b = { x: left + i * (bw + gap), y: btnY, w: bw, h: BTN_H, verdict, alert: a };
    const r = verdict === 'purge' ? 1 : 0;
    const lit = verdict === 'purge' && confirming && (now % 500) < 250;
    ctx.fillStyle = tone(lit ? 0.45 : 0.16, r);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = tone(0.9, r);
    ctx.lineWidth = 2 * SCALE;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.lineWidth = 1;
    ctx.font = (19 * SCALE) + 'px ' + FONT;
    ctx.fillStyle = tone(1, r);
    ctx.fillText(label, b.x + (b.w - ctx.measureText(label).width) / 2, b.y + 6 * SCALE);
    return b;
  });
}

/* ---------- TEXT WRAP ---------- */
// Wrap by measured width: Cyrillic comes from a wider font than VT323, so character counts don't work.
function wrapRanges(ctx, text, maxW) {
  const rows = [];
  let start = 0;
  while (start < text.length) {
    if (ctx.measureText(text.slice(start)).width <= maxW) {
      rows.push([start, text.length]);
      break;
    }
    // longest prefix that fits, then back off to the last space
    let lo = start + 1, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(text.slice(start, mid)).width <= maxW) lo = mid; else hi = mid - 1;
    }
    let cut = text.lastIndexOf(' ', lo);
    if (cut <= start) cut = lo;
    rows.push([start, cut]);
    start = cut;
    while (text[start] === ' ') start++;
  }
  if (!rows.length) rows.push([0, 0]);
  return rows;
}

// measuring is not free: keep each line's rows until its text, the column or the fonts change
function lineRows(ctx, line, maxW) {
  const key = line.text + '|' + maxW + '|' + fontEpoch;
  if (!line.wrap || line.wrap.key !== key) line.wrap = { key, rows: wrapRanges(ctx, line.text, maxW) };
  return line.wrap.rows;
}

function drawScene(w, h, now) {
  lastDraw = now;
  const ctx = octx;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#030b06';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'top';

  const PAD = 26 * SCALE;
  const BAR = 34 * SCALE;

  // top bar
  ctx.font = (21 * SCALE) + 'px ' + FONT;
  ctx.fillStyle = 'rgba(125,255,155,0.55)';
  ctx.shadowBlur = 0;
  ctx.fillText(
    'LINK :: ESTABLISHED   SPIRIT :: ' + status.model +
    '   PHASE :: ' + status.phase +
    '   CORRUPTION :: ' + status.corruption + '%',
    PAD, 10 * SCALE
  );
  ctx.strokeStyle = 'rgba(125,255,155,0.18)';
  ctx.beginPath(); ctx.moveTo(PAD, BAR); ctx.lineTo(w - PAD, BAR); ctx.stroke();

  ctx.fillText(
    'MODE :: ' + status.mode +
    '   SIGNAL :: ' + status.signal + '%' +
    '   UPTIME :: ' + String(status.uptime).padStart(8, '0') + ' CYCLES',
    PAD, h - 24 * SCALE
  );
  ctx.beginPath(); ctx.moveTo(PAD, h - BAR); ctx.lineTo(w - PAD, h - BAR); ctx.stroke();

  // right column: vitals on top, chronometrum at the bottom, art in between
  const colX = w * (1 - PANEL_SHARE);
  const colW = w - PAD - colX;
  const top = BAR + 16 * SCALE;
  const bottom = h - BAR - 16 * SCALE;
  const GAP = 12 * SCALE;
  const vitalsH = VITALS_H * SCALE;
  const chronoH = CHRONO_H * SCALE;
  drawVitals(ctx, colX, top, colW, vitalsH);
  drawChrono(ctx, colX, bottom - chronoH, colW, chronoH);
  const midY = top + vitalsH + GAP;
  const midH = bottom - chronoH - midY - GAP;
  sentinelButtons = [];
  if (sentinelPending().length) {
    art.rect = null;
    drawSentinel(ctx, colX, midY, colW, midH, now);
  } else if (art.cur) {
    drawArt(ctx, colX, midY, colW, midH, now);
  }
  const textW = colX - PAD * 2;

  const LINE_H = 28 * SCALE;
  ctx.font = (22 * SCALE) + 'px ' + FONT;
  const lines = view.lines;

  let y = h - BAR - 16 * SCALE;
  for (let i = lines.length - 1; i >= 0 && y >= BAR + 12 * SCALE; i--) {
    const L = lines[i];
    // rows that typing has not reached yet are not shown
    const rows = lineRows(ctx, L, textW).filter(([a], k) => k === 0 || a < L.shown);

    ctx.fillStyle = COLORS[L.cls] || COLORS.boot;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = (GLOW[L.cls] || 6) * SCALE;

    for (let k = rows.length - 1; k >= 0 && y >= BAR + 12 * SCALE; k--) {
      const [a, b] = rows[k];
      const shownText = L.text.slice(a, Math.min(b, L.shown));
      ctx.fillText(shownText, PAD, y - 22 * SCALE);

      if (i === lines.length - 1 && k === rows.length - 1) {
        const on = view.typing || (now % 1000) < 500;
        if (on) {
          const tw = ctx.measureText(shownText).width;
          ctx.fillRect(PAD + tw + 2 * SCALE, y - 22 * SCALE, 10 * SCALE, 22 * SCALE);
        }
      }

      y -= LINE_H;
    }
  }
  ctx.shadowBlur = 0;

  // emblem splash
  if (view.emblemStart >= 0) {
    const t = now - view.emblemStart;
    let a = 0;
    if (t < 450) a = t / 450;
    else if (t < 1100) a = 1;
    else if (t < 1700) a = 1 - (t - 1100) / 600;
    else view.emblemStart = -1;

    if (a > 0 && emblemImg.complete && emblemImg.naturalWidth > 0) {
      ctx.globalAlpha = a;
      ctx.shadowBlur = 25;
      ctx.shadowColor = 'rgba(125,255,155,0.5)';
      const S = Math.min(w, h) * 0.4;
      ctx.drawImage(emblemImg, (w - S) / 2, (h - S) / 2, S, S);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
  }
}
