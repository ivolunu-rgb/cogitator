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

// Colours, fonts and words come from the theme (themes/<id>/theme.js).
const COLORS = THEME.colors;
const GLOW = THEME.glow;
const NERV = THEME.style === 'nerv';

/* ---------- WALLPAPER LAYOUT ---------- */
const SCALE = 2;            // text size relative to the original console
const PANEL_SHARE = 0.45;   // right column: vitals, art carousel, chronometrum
const VITALS_H = THEME.vitalsH || 205;   // panel heights, in units of SCALE
const CHRONO_H = 88;
const ART_SECONDS = 30;     // how long each picture stays
const ART_FADE_MS = 1500;

function font(size, weight) {
  return (weight ? weight + ' ' : '') + (size * SCALE * THEME.fontScale) + 'px ' + THEME.font;
}

function titleFont(size) {
  return (size * SCALE) + 'px ' + (THEME.titleFont || THEME.font);
}

const off = document.createElement('canvas');
const octx = off.getContext('2d');

const emblemImg = new Image();
if (THEME.emblem) emblemImg.src = THEME.emblem;
emblemImg.onload = () => { view.dirty = true; };

// text widths change once the web fonts arrive; wrapped lines are re-measured then
let fontEpoch = 0;
if (document.fonts) {
  const faces = [THEME.font, THEME.titleFont].filter(Boolean);
  Promise.all(faces.map(f => document.fonts.load('44px ' + f, 'AZАЯ起動')))
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

// Pictures come from the wallpaper server (the art folder next to server.js); the offline copy has none.
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
// the theme's ink, shifting towards its alarm colour as redness goes 0 -> 1
function tone(alpha, redness = 0) {
  const c = THEME.ink.map((g, i) => Math.round(g + (THEME.alarm[i] - g) * redness));
  return 'rgba(' + c.join(',') + ',' + alpha + ')';
}

// Returns the y where the panel's content starts.
function drawFrame(ctx, x, y, w, h, title, redness = 0) {
  return NERV ? drawFrameNerv(ctx, x, y, w, h, title, redness) : drawFrameMechanicus(ctx, x, y, w, h, title, redness);
}

// header strip with title and rivets, heavy corner brackets
function drawFrameMechanicus(ctx, x, y, w, h, title, redness) {
  const U = SCALE;
  const HEAD = 24 * U;

  ctx.shadowBlur = 0;
  ctx.fillStyle = tone(0.035, redness);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = tone(0.15, redness);
  ctx.fillRect(x, y, w, HEAD);

  ctx.font = font(16);
  ctx.fillStyle = tone(0.95, redness);
  ctx.fillText(THEME.glyph + title, x + 8 * U, y + 3 * U);
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

// NERV screens: a solid header with the title knocked out, hazard stripes, a cut corner
function drawFrameNerv(ctx, x, y, w, h, title, redness) {
  const U = SCALE;
  const HEAD = 24 * U;
  const STRIPES = 84 * U;

  ctx.shadowBlur = 0;
  ctx.fillStyle = tone(0.045, redness);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = tone(0.88, redness);
  ctx.fillRect(x, y, w, HEAD);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + w - STRIPES, y, STRIPES, HEAD);
  ctx.clip();
  ctx.fillStyle = THEME.bg;
  for (let i = -HEAD; i < STRIPES; i += 14 * U) {
    const sx = x + w - STRIPES + i;
    ctx.beginPath();
    ctx.moveTo(sx, y + HEAD);
    ctx.lineTo(sx + HEAD, y);
    ctx.lineTo(sx + HEAD + 6 * U, y);
    ctx.lineTo(sx + 6 * U, y + HEAD);
    ctx.fill();
  }
  ctx.restore();

  ctx.font = font(17, 700);
  ctx.fillStyle = THEME.bg;
  ctx.fillText(title, x + 10 * U, y + 4 * U);

  const CUT = 16 * U;
  ctx.lineWidth = 1.5 * U;
  ctx.strokeStyle = tone(0.75, redness);
  ctx.beginPath();
  ctx.moveTo(x, y + HEAD);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + w - CUT, y + h);
  ctx.lineTo(x + w, y + h - CUT);
  ctx.lineTo(x + w, y + HEAD);
  ctx.stroke();
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

function hexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i;
    if (i) ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    else ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
}

function drawVitals(ctx, x, y, w, h) {
  const v = telemetry.vitals;
  const stress = machineStress() || 0;
  const L = THEME.labels;
  // under strain the frame reddens and stutters
  let redness = clamp((stress - 0.4) / 0.4, 0, 1);
  if (stress > 0.6 && Math.random() < stress * 0.3) redness *= 0.4;

  let cy = drawFrame(ctx, x, y, w, h, L.vitals, redness) + 10 * SCALE;
  const left = x + 14 * SCALE;
  ctx.font = font(17);

  if (!v) {
    ctx.fillStyle = tone(0.8, 1);
    ctx.fillText(L.offline, left, cy);
    return;
  }

  const ROW = 21 * SCALE;
  const valueX = x + w * 0.42;
  const barX = x + w * 0.64;
  const barW = x + w - 14 * SCALE - barX;

  function row(label, value, frac, red) {
    if (red === undefined) red = frac > 0.85 ? 1 : frac > 0.65 ? 0.45 : 0;
    ctx.font = font(17);
    ctx.fillStyle = tone(0.55);
    ctx.fillText(label, left, cy);
    ctx.fillStyle = tone(0.95, red);
    ctx.fillText(value, valueX, cy);
    if (frac !== null) drawBar(ctx, barX, cy + 7 * SCALE, barW, 9 * SCALE, frac);
    cy += ROW;
  }

  const gb = bytes => (bytes / 1073741824).toFixed(1);
  const heat = v.gpu && isFinite(v.gpu.temp) ? clamp((v.gpu.temp - 60) / 25, 0, 1) : 0;

  if (NERV) {
    // MAGI: three supercomputers in a row, one per resource
    const r = 46 * SCALE;
    const hy = cy + r * 0.87;
    const units = [
      [L.cpu, v.cpu ? v.cpu.load : null, 'CPU', 0],
      [L.gpu, v.gpu ? v.gpu.load : null, v.gpu ? 'GPU  ' + v.gpu.temp + '°C' : L.gpuSilent, heat],
      [L.ram, v.ram ? Math.round(100 * v.ram.used / v.ram.total) : null, 'RAM  ' + (v.ram ? gb(v.ram.used) + ' GB' : ''), 0]
    ];
    ctx.textAlign = 'center';
    units.forEach(([name, val, sub, hot], i) => {
      const hx = x + w * (i + 0.5) / 3;
      const frac = val === null ? 0 : val / 100;
      const red = Math.max(hot, frac > 0.85 ? 1 : frac > 0.65 ? 0.45 : 0);
      hexPath(ctx, hx, hy, r);
      ctx.fillStyle = tone(0.06 + 0.32 * frac, red);
      ctx.fill();
      ctx.lineWidth = 2 * SCALE;
      ctx.strokeStyle = tone(0.9, red);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.font = font(12, 700);
      ctx.fillStyle = tone(0.95, red);
      ctx.fillText(name, hx, hy - r * 0.62);
      ctx.font = font(30, 700);
      ctx.fillText(val === null ? '--' : val + '%', hx, hy - 15 * SCALE);
      ctx.font = font(11);
      ctx.fillStyle = tone(0.7, red);
      ctx.fillText(sub, hx, hy + r * 0.42);
    });
    ctx.textAlign = 'left';
    cy = hy + r * 0.87 + 12 * SCALE;
    if (v.gpu) row(L.vram, (v.gpu.memUsed / 1024).toFixed(1) + ' / ' + (v.gpu.memTotal / 1024).toFixed(1) + ' GB', v.gpu.memUsed / v.gpu.memTotal);
  } else {
    if (v.cpu) row(L.cpu, v.cpu.load + '%', v.cpu.load / 100);
    if (v.gpu) {
      row(L.gpu, v.gpu.load + '%   ' + v.gpu.temp + '°C', v.gpu.load / 100, Math.max(heat, v.gpu.load > 85 ? 0.45 : 0));
      row(L.vram, (v.gpu.memUsed / 1024).toFixed(1) + ' / ' + (v.gpu.memTotal / 1024).toFixed(1) + ' GB', v.gpu.memUsed / v.gpu.memTotal);
    } else {
      row(L.gpu, L.gpuSilent, null, 1);
    }
    if (v.ram) row(L.ram, gb(v.ram.used) + ' / ' + gb(v.ram.total) + ' GB', v.ram.used / v.ram.total);
  }

  // mood and network share a row
  ctx.font = font(17);
  ctx.fillStyle = tone(0.55);
  ctx.fillText(L.mood, left, cy);
  ctx.fillStyle = tone(0.95, redness);
  ctx.fillText(temperament(stress), valueX, cy);
  ctx.fillStyle = tone(0.8, v.online === false ? 1 : 0);
  ctx.fillText(L.net(v.online !== false), barX, cy);
  cy += ROW;

  // the sentinel's wards, and how many knocks the firewall turned away today
  const s = telemetry.sentinel;
  const heresy = sentinelPending().length;
  const W = THEME.wards;
  let wards = W.pure, wardsRed = 0;
  if (!s || !s.running) { wards = s && s.installed ? W.silent : W.missing; wardsRed = 0.45; }
  else if (heresy) { wards = W.heresy(heresy); wardsRed = 1; }
  else if (s.learning) wards = W.learning(Math.max(1, Math.ceil((s.learningUntil - Date.now()) / 864e5)));
  ctx.fillStyle = tone(0.55);
  ctx.fillText(L.wards, left, cy);
  ctx.fillStyle = tone(0.95, wardsRed);
  ctx.fillText(wards, valueX, cy);
  if (s && s.running) {
    ctx.fillStyle = tone(0.8, s.knocks.outer ? 0.45 : 0);
    ctx.fillText(L.knocks(s.knocks), barX, cy);
  }
  cy += ROW;

  drawPulse(ctx, left, cy + 4 * SCALE, x + w - 14 * SCALE - left, y + h - cy - 16 * SCALE, redness);
}

function drawChrono(ctx, x, y, w, h) {
  const d = new Date();
  const cy = drawFrame(ctx, x, y, w, h, THEME.labels.chrono) + 6 * SCALE;
  const left = x + 14 * SCALE;

  ctx.font = font(30, NERV ? 700 : '');
  ctx.fillStyle = COLORS.prayer;
  ctx.shadowColor = COLORS.prayer;
  ctx.shadowBlur = 10 * SCALE;
  ctx.fillText(THEME.dateBig(d), left, cy);
  ctx.shadowBlur = 0;

  ctx.font = font(16);
  ctx.fillStyle = tone(0.6);
  ctx.fillText(THEME.dateSmall(d), left, cy + 31 * SCALE);
}

function drawArt(ctx, x, y, w, h, now) {
  const HEAD = 24 * SCALE;
  const FRAME = 6 * SCALE;
  const t = art.fadeStart < 0 ? 1 : Math.min(1, (now - art.fadeStart) / ART_FADE_MS);
  if (t < 1) view.dirty = true;

  const box = img => fitRect(img, x + FRAME, y + HEAD + FRAME, w - FRAME * 2, h - HEAD - FRAME * 2);
  const r = box(art.cur.img);
  drawFrame(ctx, r.x - FRAME, r.y - FRAME - HEAD, r.w + FRAME * 2, r.h + FRAME * 2 + HEAD,
    THEME.labels.art + art.cur.name.toUpperCase());

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
  const L = THEME.labels;
  const red = a.severity === 'low' ? 0.45 : 1;
  const title = L.sentinel + (list.length > 1 ? ' :: 1 OF ' + list.length : '');
  let cy = drawFrame(ctx, x, y, w, h, title, (now % 1200) < 600 ? red : red * 0.6) + 12 * SCALE;
  const left = x + 14 * SCALE;
  const maxW = w - 28 * SCALE;

  const BTN_H = 34 * SCALE;
  const btnY = y + h - BTN_H - 14 * SCALE;

  ctx.font = font(17);
  ctx.fillStyle = tone(0.7, red);
  ctx.fillText('[' + a.severity.toUpperCase() + ']  ' + clockTime(a.time), left, cy);
  cy += 22 * SCALE;

  const heading = THEME.alertTitle(a);
  ctx.font = font(20, NERV ? 700 : '');
  ctx.fillStyle = tone(1, red);
  ctx.shadowColor = tone(0.6, red);
  ctx.shadowBlur = 8 * SCALE;
  for (const [s, e] of wrapRanges(ctx, heading, maxW)) {
    ctx.fillText(heading.slice(s, e), left, cy);
    cy += 24 * SCALE;
  }
  ctx.shadowBlur = 0;
  cy += 6 * SCALE;

  ctx.font = font(16);
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
    ? [['ok', L.ok], ['purge', confirming ? L.confirm : L.purge]]
    : [['ack', L.ack]];
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
    ctx.font = font(19, NERV ? 700 : '');
    ctx.fillStyle = tone(1, r);
    ctx.fillText(label, b.x + (b.w - ctx.measureText(label).width) / 2, b.y + 6 * SCALE);
    return b;
  });
}

/* ---------- NERV EXTRAS ---------- */
// a faint hexagon grid behind everything, drawn once into a pattern
let hexGrid = null;
function hexPattern(ctx) {
  if (hexGrid) return hexGrid;
  const r = 18 * SCALE;
  const tile = document.createElement('canvas');
  tile.width = Math.round(r * 3);
  tile.height = Math.round(r * Math.sqrt(3));
  const t = tile.getContext('2d');
  t.strokeStyle = tone(0.05);
  t.lineWidth = 1;
  for (const [cx, cy] of [[0, 0], [r * 1.5, tile.height / 2], [r * 3, 0], [0, tile.height], [r * 3, tile.height]]) {
    hexPath(t, cx, cy, r);
    t.stroke();
  }
  hexGrid = ctx.createPattern(tile, 'repeat');
  return hexGrid;
}

// over the console when the machine is close to the edge
function drawEmergency(ctx, x, y, w, now) {
  const H = 40 * SCALE;
  const blink = (now % 1000) < 600;
  ctx.fillStyle = blink ? 'rgba(255,40,30,0.85)' : 'rgba(255,40,30,0.55)';
  ctx.fillRect(x, y, w, H);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = -H; i < w; i += 22 * SCALE) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + H);
    ctx.lineTo(x + i + H, y);
    ctx.lineTo(x + i + H + 9 * SCALE, y);
    ctx.lineTo(x + i + 9 * SCALE, y + H);
    ctx.fill();
  }
  ctx.font = titleFont(24);
  ctx.fillStyle = '#fff4ec';
  ctx.textAlign = 'center';
  ctx.fillText(THEME.emergency, x + w / 2, y + 6 * SCALE);
  ctx.textAlign = 'left';
}

/* ---------- TEXT WRAP ---------- */
// Wrap by measured width: fonts and scripts differ in width, so character counts don't work.
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
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, w, h);
  if (NERV) {
    ctx.fillStyle = hexPattern(ctx);
    ctx.fillRect(0, 0, w, h);
  }
  ctx.textBaseline = 'top';

  const PAD = 26 * SCALE;
  const BAR = 34 * SCALE;

  // top and bottom bars
  ctx.font = font(21, NERV ? 700 : '');
  ctx.fillStyle = tone(NERV ? 0.8 : 0.55);
  ctx.shadowBlur = 0;
  ctx.fillText(THEME.topBar(status), PAD, 10 * SCALE);
  ctx.strokeStyle = tone(0.18);
  ctx.beginPath(); ctx.moveTo(PAD, BAR); ctx.lineTo(w - PAD, BAR); ctx.stroke();

  ctx.fillText(THEME.bottomBar(status), PAD, h - 24 * SCALE);
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
  ctx.font = font(22);
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

  if (NERV && status.corruption >= 70) drawEmergency(ctx, PAD, BAR + 10 * SCALE, textW, now);

  // boot splash: the theme's emblem, or its words
  if (view.emblemStart >= 0) {
    const t = now - view.emblemStart;
    let a = 0;
    if (t < 450) a = t / 450;
    else if (t < 1100) a = 1;
    else if (t < 1700) a = 1 - (t - 1100) / 600;
    else view.emblemStart = -1;

    if (a > 0) {
      ctx.globalAlpha = a;
      ctx.shadowBlur = 25;
      ctx.shadowColor = tone(0.5);
      if (THEME.emblem && emblemImg.complete && emblemImg.naturalWidth > 0) {
        const S = Math.min(w, h) * 0.4;
        ctx.drawImage(emblemImg, (w - S) / 2, (h - S) / 2, S, S);
      } else if (THEME.splash) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)';   // the words stand on a darkened screen
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.fillStyle = tone(1);
        ctx.font = titleFont(110);
        ctx.fillText(THEME.splash[0], w / 2, h / 2 - 150 * SCALE);
        ctx.font = font(26, 700);
        ctx.fillText(THEME.splash[1], w / 2, h / 2 + 90 * SCALE);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
  }
}
