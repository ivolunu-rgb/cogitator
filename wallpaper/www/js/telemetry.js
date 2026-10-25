/* ---------- TELEMETRY (from the wallpaper server) ---------- */
// Real machine readings and events from C:\cogitator\wallpaper\server.js; the offline copy has none.
const telemetry = {
  vitals: null,
  sentinel: null,
  lastId: null,
  history: []   // recent max(CPU, GPU) load for the pulse line
};
const eventQueue = [];

function pollTelemetry() {
  fetch('telemetry?since=' + (telemetry.lastId || 0), { cache: 'no-store' })
    .then(r => r.json())
    .then(data => {
      telemetry.vitals = data.vitals;
      // events from before this page loaded are old news; after a pause the backlog is "while you were away"
      if (telemetry.lastId !== null) eventQueue.push(...data.events);
      telemetry.lastId = data.lastEventId;
      telemetry.sentinel = data.sentinel;
      noticeSentinel(data.sentinel);

      const { cpu, gpu } = data.vitals;
      telemetry.history.push(Math.max(cpu ? cpu.load : 0, gpu && isFinite(gpu.load) ? gpu.load : 0));
      if (telemetry.history.length > 60) telemetry.history.shift();
    })
    .catch(() => { telemetry.vitals = null; });
}

if (location.protocol.startsWith('http')) {
  pollTelemetry();
  setInterval(pollTelemetry, 2000);
}

// 0 = idle and cool .. 1 = pinned and hot; null when there are no readings.
function machineStress() {
  const v = telemetry.vitals;
  if (!v) return null;
  const cpu = v.cpu ? v.cpu.load : 0;
  const gpu = v.gpu && isFinite(v.gpu.load) ? v.gpu.load : 0;
  const load = Math.max(cpu, gpu) / 100;
  const heat = v.gpu && isFinite(v.gpu.temp) ? clamp((v.gpu.temp - 55) / 30, 0, 1) : 0;
  const mem = v.ram ? clamp((v.ram.used / v.ram.total - 0.8) / 0.2, 0, 1) : 0;
  return clamp(0.6 * load + 0.4 * heat + 0.3 * mem, 0, 1);
}

// the machine's mood in the theme's words, calm to worst
function temperament(stress) {
  const step = stress < 0.2 ? 0 : stress < 0.45 ? 1 : stress < 0.7 ? 2 : stress < 0.85 ? 3 : 4;
  return THEME.moods[step];
}

function gpuTempText() {
  const v = telemetry.vitals;
  return v && v.gpu && isFinite(v.gpu.temp) ? v.gpu.temp + '°C' : '??°C';
}

/* ---------- SENTINEL ---------- */
// Alerts from the sentinel (C:\cogitator\wallpaper\sentinel), decided with the OK / NOT OK buttons.
const sentinel = {
  seen: null,            // alert ids already announced in the console
  decided: new Set(),    // verdicts sent from this page, hidden until the sentinel confirms
  confirm: null          // { id, until } after a first click on NOT OK
};

function sentinelPending() {
  const s = telemetry.sentinel;
  if (!s || !s.running || !s.pending) return [];
  return s.pending.filter(a => !sentinel.decided.has(a.id));
}

// new alerts, and purges that failed, are announced in the console once
function noticeSentinel(state) {
  const live = state && state.running;
  const news = [
    ...(live && state.pending || []).map(alert => ({ key: alert.id + ':pending', type: 'heresy', alert })),
    ...(live && state.recent || []).filter(a => a.status === 'failed').map(alert => ({ key: alert.id + ':failed', type: 'verdict-failed', alert }))
  ];
  if (sentinel.seen) {
    for (const n of news) {
      if (!sentinel.seen.has(n.key)) eventQueue.push({ type: n.type, time: Date.now(), alert: n.alert });
    }
  }
  sentinel.seen = new Set([...(sentinel.seen || []), ...news.map(n => n.key)]);
}

function sendVerdict(alert, verdict) {
  sentinel.decided.add(alert.id);
  sentinel.confirm = null;
  fetch('sentinel/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: alert.id, verdict })
  }).catch(() => { });
  eventQueue.push({ type: 'verdict', time: Date.now(), alert, verdict });
  view.dirty = true;
}

/* ---------- CHRONOMETRUM ---------- */
function pad(n, len) {
  return String(n).padStart(len, '0');
}

// Imperial dating: check number (0 = Terra), thousandth of the year, year of the millennium, millennium.
function imperialDate(d) {
  const start = new Date(d.getFullYear(), 0, 1);
  const end = new Date(d.getFullYear() + 1, 0, 1);
  const fraction = (Math.floor((d - start) / (end - start) * 1000) + 1) % 1000;
  return '0 ' + pad(fraction, 3) + ' ' + pad(d.getFullYear() % 1000, 3) + '.M' + (Math.floor(d.getFullYear() / 1000) + 1);
}

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function localStamp(d) {
  return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2) +
    '  ::  ' + DAYS[d.getDay()] + '  ::  ' +
    pad(d.getDate(), 2) + '.' + pad(d.getMonth() + 1, 2) + '.' + d.getFullYear();
}

function clockTime(ms) {
  const d = new Date(ms);
  return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
}

// a new day is an event too
let today = new Date().toDateString();
setInterval(() => {
  const now = new Date().toDateString();
  if (now !== today) {
    today = now;
    eventQueue.push({ type: 'new-day', time: Date.now() });
  }
}, 30000);
