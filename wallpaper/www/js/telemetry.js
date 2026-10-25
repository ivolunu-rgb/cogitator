/* ---------- TELEMETRY (from the wallpaper server) ---------- */
// Real machine readings and events from server.js; the offline copy has none.
const telemetry = {
  vitals: null,
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

/* ---------- WEATHER AND MUSIC ---------- */
// WMO weather codes, as Open-Meteo reports them
function weatherWords(code) {
  if (code === 0) return 'CLEAR';
  if (code <= 2) return 'PARTLY CLOUDY';
  if (code === 3) return 'OVERCAST';
  if (code <= 48) return 'FOG';
  if (code <= 57) return 'DRIZZLE';
  if (code <= 67) return 'RAIN';
  if (code <= 77) return 'SNOW';
  if (code <= 82) return 'SHOWERS';
  if (code <= 86) return 'SNOW SHOWERS';
  return 'THUNDERSTORM';
}

function weatherText(w) {
  if (!w) return 'NO DATA';
  if (w.error === 'no-city') return 'SET YOUR CITY IN THE ADMIN PAGE';
  if (w.error === 'unknown-city') return 'CITY NOT FOUND :: CHECK THE ADMIN PAGE';
  if (w.error) return 'NO SIGNAL';
  const t = Math.round(w.temp);
  return upper(w.city) + '  ' + (t > 0 ? '+' : '') + t + '°C  ' + weatherWords(w.code) + '  WIND ' + Math.round(w.wind) + ' M/S';
}

function mediaText(m) {
  if (!m || !m.title) return 'SILENCE';
  return (m.artist ? m.artist + ' — ' : '') + m.title + (m.playing ? '' : '  [PAUSED]');
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
