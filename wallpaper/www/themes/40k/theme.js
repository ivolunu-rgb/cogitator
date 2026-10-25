/* Theme: Warhammer 40,000 — an Adeptus Mechanicus cogitator on green phosphor. */
const THEME = {
  id: '40k',
  style: 'mechanicus',          // frame and panel drawing style (renderer.js)
  bg: '#030b06',
  ink: [125, 255, 155],         // the screen's own colour
  alarm: [255, 75, 58],         // what it turns into under strain
  font: 'VT323, CogitatorCyrillic, monospace',
  fontScale: 1,
  vitalsH: 226,
  glyph: '⚙ ',                  // before every panel title
  emblem: 'assets/emblem.png',  // boot splash

  colors: {
    boot: 'rgba(125,255,155,0.55)',
    hex: 'rgba(125,255,155,0.38)',
    prayer: '#b8ffcc',
    warn: '#ff4b3a',
    spirit: '#eafff0',
    glitchline: '#ff4b3a',
    event: '#ffc861',
    alarm: '#ff5a44',
    newshead: 'rgba(143,227,255,0.55)',
    news: '#8fe3ff'
  },
  glow: { prayer: 12, spirit: 14, warn: 10, glitchline: 12, event: 12, alarm: 14, news: 12 },

  labels: {
    vitals: 'AUSPEX :: GENERATOR-SOUL VITAE',
    offline: 'AUSPEX OFFLINE :: NO READINGS FROM THE MACHINE',
    cpu: 'LOGIC-ENGINE   :: CPU',
    gpu: 'GENERATOR-SOUL :: GPU',
    gpuSilent: 'SILENT',
    vram: 'VRAM RELIQUARY',
    ram: 'COGITATIVE STORE',
    mood: 'TEMPERAMENT',
    net: up => 'NOOSPHERE :: ' + (up ? 'LINKED' : 'SEVERED'),
    netRow: 'DATA-STREAM',
    disks: 'MEMORY VAULTS',
    free: 'FREE',
    weather: 'ATMOSPHERICS',
    audio: 'VOX-CHOIR',
    wards: 'WARDS',
    knocks: k => 'KNOCKS :: ' + k.outer + ' VOID / ' + k.lan + ' LAN',
    art: 'PICT-ARCHIVE :: ',
    chrono: 'CHRONOMETRUM :: HOLY TERRA STANDARD',
    sentinel: 'ORDO SENTINEL :: HERESY DETECTED',
    ok: 'OK :: SANCTION',
    purge: 'NOT OK :: PURGE',
    confirm: 'CONFIRM PURGE?',
    ack: 'ACKNOWLEDGED'
  },
  moods: ['SERENE', 'ATTENTIVE', 'RESTLESS', 'WRATHFUL', 'IN TORMENT'],
  wards: {
    missing: 'NOT INSTALLED',
    silent: 'SILENT',
    heresy: n => 'HERESY x' + n,
    learning: days => 'LEARNING :: ' + days + 'D LEFT',
    pure: 'PURITY ASSURED'
  },

  topBar: s => 'LINK :: ESTABLISHED   SPIRIT :: ' + s.model + '   PHASE :: ' + s.phase + '   CORRUPTION :: ' + s.corruption + '%',
  bottomBar: s => 'MODE :: ' + s.mode + '   SIGNAL :: ' + s.signal + '%   UPTIME :: ' + String(s.uptime).padStart(8, '0') + ' CYCLES',
  phaseShift: phase => 'PHASE SHIFT :: ' + phase + ' PROTOCOLS ENGAGED',
  newsHeader: (n, age) => '+++ ASTROPATHIC RELAY :: ' + n.tag + ' :: ' + age + (n.source ? ' :: ' + n.source.toUpperCase() : '') + ' +++',
  dateBig: d => imperialDate(d),
  dateSmall: d => localStamp(d),
  alertTitle: a => a.title
};
