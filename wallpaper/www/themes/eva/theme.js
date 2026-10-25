/* Theme: Neon Genesis Evangelion — a NERV HQ console run by the MAGI. */
const EVA_PHASES = { IGNITION: 'STANDBY', LITANY: 'SYNC TEST', DIAGNOSTIC: 'ACTIVATION TEST', CORRUPTION: 'BERSERK' };
const evaPhase = p => EVA_PHASES[p] || p;
const SECOND_IMPACT = Date.UTC(2000, 8, 13);

function hms(seconds) {
  return pad(Math.floor(seconds / 3600), 2) + ':' + pad(Math.floor(seconds / 60) % 60, 2) + ':' + pad(seconds % 60, 2);
}

const THEME = {
  id: 'eva',
  style: 'nerv',
  bg: '#070302',
  ink: [255, 140, 30],          // MAGI orange
  alarm: [255, 35, 35],         // pattern blue sirens are red
  font: '"Roboto Condensed", "Shippori Mincho B1", "Arial Narrow", sans-serif',
  titleFont: '"Shippori Mincho B1", "Roboto Condensed", serif',
  fontScale: 0.8,
  vitalsH: 230,
  glyph: '',
  emblem: null,
  splash: ['起動', 'MAGI SYSTEM :: BOOT SEQUENCE'],
  emergency: '緊急事態 :: EMERGENCY :: BERSERK RISK',

  colors: {
    boot: 'rgba(255,140,30,0.62)',
    hex: 'rgba(255,140,30,0.36)',
    prayer: '#ffcf8a',
    warn: '#ff3b2f',
    spirit: '#fff2df',
    glitchline: '#ff3b2f',
    event: '#b6ff5c',
    alarm: '#ff4433',
    newshead: 'rgba(150,240,110,0.6)',
    news: '#a6ff76'
  },
  glow: { prayer: 8, spirit: 10, warn: 8, glitchline: 10, event: 8, alarm: 10, news: 8 },

  labels: {
    vitals: 'MAGI SYSTEM :: 審議中',
    offline: 'MAGI OFFLINE :: NO RESPONSE FROM THE SYSTEM',
    cpu: 'MELCHIOR-1',
    gpu: 'BALTHASAR-2',
    gpuSilent: 'NO SIGNAL',
    vram: 'VRAM',
    ram: 'CASPER-3',
    mood: 'PATTERN',
    net: up => 'NERV LINE :: ' + (up ? 'OPEN' : 'CUT'),
    wards: 'ANGEL WATCH',
    knocks: k => 'CONTACTS :: ' + k.outer + ' EXT / ' + k.lan + ' LOCAL',
    art: 'NERV ARCHIVE :: ',
    chrono: '第3新東京市 :: TOKYO-3 STANDARD TIME',
    sentinel: '使徒 :: ANGEL DETECTED',
    ok: 'APPROVE',
    purge: 'REJECT :: ELIMINATE',
    confirm: 'CONFIRM ELIMINATION?',
    ack: 'ACKNOWLEDGED'
  },
  moods: ['STABLE', 'ELEVATED', 'UNSTABLE', 'BERSERK RISK', 'BERSERK'],
  wards: {
    missing: 'OFFLINE',
    silent: 'NO SIGNAL',
    heresy: n => 'PATTERN BLUE x' + n,
    learning: days => 'CALIBRATING :: ' + days + 'D LEFT',
    pure: 'NO ANGEL'
  },

  topBar: s => 'NERV HQ :: MAGI ' + (s.model === 'COMMUNION' ? 'ONLINE' : 'OFFLINE') +
    '   MODE :: ' + evaPhase(s.phase) +
    '   SYNC RATIO :: ' + Math.max(0, 100 - s.corruption * 0.85).toFixed(1) + '%' +
    '   CONTAMINATION :: ' + s.corruption + '%',
  bottomBar: s => 'ENTRY PLUG :: ' + (s.mode === 'ENDLESS' ? 'CONNECTED' : 'INSERTING') +
    '   SIGNAL :: ' + s.signal + '%   OPERATION TIME :: ' + hms(s.uptime),
  phaseShift: phase => 'OPERATION MODE :: ' + evaPhase(phase) + ' :: ALL PERSONNEL STAND BY',
  newsHeader: (n, age) => '>> NERV INTELLIGENCE :: ' + n.tag + ' :: ' + age + (n.source ? ' :: ' + n.source.toUpperCase() : ''),
  dateBig: d => pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2),
  dateSmall: d => 'SECOND IMPACT +' + Math.floor((d - SECOND_IMPACT) / 864e5) + ' DAYS  ::  ' + DAYS[d.getDay()] +
    '  ::  ' + pad(d.getDate(), 2) + '.' + pad(d.getMonth() + 1, 2) + '.' + d.getFullYear(),
  alertTitle: a => 'PATTERN BLUE :: ' + alertSubject(a)
};
