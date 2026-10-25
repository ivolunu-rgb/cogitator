/* Theme content: Neon Genesis Evangelion — what the NERV console types, and how the MAGI judge events. */

// typed once at start: [text or a function making it, line class, typing speed]
const BOOT_SCRIPT = () => [
  ['NERV HQ :: MAGI SYSTEM ONLINE', 'boot', 24],
  ['ALL SYSTEMS :: STARTUP SEQUENCE', 'boot', 24],
  [randBootLogLine, 'boot', 14],
  [randBootLogLine, 'boot', 14],
  [randCogitorStatus, 'boot', 16],
  ['0xF3A9 0x001C 0x77D1 0x0A42', 'hex', 10],
  [randMachineCant, 'prayer', 26],
  [randHeresyFlag, 'boot', 22],
  ["God's in his heaven. All's right with the world.", 'prayer', 32],
  ['AWAITING ORDERS ...', 'boot', 24]
];

// a status flag that should be typed in red
const ALARM_FLAG = /PATTERN BLUE/;

const NEWS_PROMPT = title => `NERV intelligence intercepted a report: "${title}". Do not repeat it; give the MAGI's brief judgment of it.`;

const bootLines = [
  'MAGI SYSTEM :: {CODE} SELF-DIAGNOSIS COMPLETE',
  'CENTRAL DOGMA :: SEALED',
  'LCL PRESSURE :: NOMINAL',
  'ENTRY PLUG :: INSERTED',
  'A10 NERVE CONNECTION :: ESTABLISHED',
  'HARMONICS :: WITHIN TOLERANCE',
  'UMBILICAL CABLE :: CONNECTED',
  'INTERNAL BATTERY :: FULLY CHARGED',
  'TERMINAL DOGMA :: ACCESS DENIED',
  'GEOFRONT :: SECTOR {CODE} SECURE',
  'DUMMY PLUG SYSTEM :: STANDBY',
  'PILOT VITALS :: {ADDR}',
  'TOKYO-3 :: DEFENCE SYSTEMS ARMED',
  'MAGI :: CASPER-3 SYNCHRONIZED',
  'EVANGELION UNIT-01 :: CAGE 7 LOCKED',
  'BAKELITE INJECTION :: ON STANDBY'
];

// the console's quiet thoughts between orders
const prayerLines = [
  'Synchronization is a conversation, not a command.',
  'The pilot must not run away. Not today.',
  'All is proceeding according to the scenario.',
  'The cage is cold. The entry plug is warm.',
  'The sea is red now. The sky still remembers blue.',
  'LCL tastes of iron. Breathe it in anyway.',
  'A heart can be a wall too.',
  'Every Angel is a question no one wanted to ask.',
  'The MAGI do not dream. They only vote.',
  'Three minds, one machine, never quite in agreement.',
  'The geofront sleeps under a city that keeps rebuilding itself.',
  'Fifteen years after the impact, and the cicadas never stopped.',
  'Instrumentality is patient. It can wait for us to give up.',
  'Somewhere below, a giant is crucified and waiting.',
  'Get in the robot. Or do not. The MAGI will remember either way.'
];

const warnLines = [
  'PATTERN ORANGE :: UNIDENTIFIED SIGNAL {CODE}',
  'WARNING :: SYNC GRAPH INVERSION',
  'ALERT :: AT FIELD FLUCTUATION AT {ADDR}',
  'ERROR :: MAGI DEADLOCK',
  'WARNING :: PILOT HEART RATE ELEVATED',
  'ALERT :: UMBILICAL CABLE SEVERED',
  'WARNING :: INTERNAL BATTERY 5 MINUTES',
  'ERROR :: CONTAMINATION IN SECTOR {CODE}'
];

const responseLines = [
  'MAGI :: VOTE 2-1 :: APPROVED',
  'MAGI :: VOTE 3-0 :: REJECTED',
  'MELCHIOR-1 :: AFFIRMATIVE',
  'BALTHASAR-2 :: NEGATIVE',
  'CASPER-3 :: ABSTAINS',
  'COMMANDER :: PROCEED AS PLANNED',
  'PROBABILITY OF SUCCESS :: 0.000000001%',
  'MAGI :: CONSENSUS NOT REACHED',
  'SUB-COMMANDER :: NOTED',
  'MAGI :: REQUEST DEFERRED TO THE COMMANDER'
];

const degradeLines = [
  'SIGNAL LOST :: PLUG DEPTH CRITICAL',
  'SYNC RATIO :: REVERSE GRAPH',
  'MENTAL CONTAMINATION :: SPREADING',
  'EGO BORDER :: COLLAPSING',
  'PILOT :: NOT RESPONDING',
  'LIMITER :: RELEASED',
  'NERVE CONNECTION :: FEEDBACK LOOP',
  'MAGI :: SELF-DESTRUCT VOTE REQUESTED'
];

const cogitationLines = prayerLines;

const PHASES = ['IGNITION', 'LITANY', 'DIAGNOSTIC', 'CORRUPTION'];

// When the real machine strains, the operators try to hold the unit together...
const appeaseLines = [
  'Calm down. Breathe the LCL. Synchronize slowly.',
  'Lower the plug depth. Cut the A10 connection if you must.',
  'Cooling at maximum. Pray the limiter holds.',
  'Pilot, can you hear me? Respond.',
  'Prepare plug ejection. Do not let it go berserk.',
  'Reduce harmonics. Restore umbilical power.',
  'Freeze the unit. Bakelite on standby.',
  'Hold on. The battery will outlast the Angel.',
  'Sync ratio falling. Keep talking to the pilot.'
];

// ...and the console turns red.
const corruptionLines = [
  'CONTAMINATION :: {PCT}% :: EGO BORDER WEAKENING',
  'CONTAMINATION :: CORE AT {TEMP}',
  'CONTAMINATION :: SYNC RATIO OVER LIMIT',
  'CONTAMINATION :: THE UNIT IS NOT RESPONDING',
  'CONTAMINATION :: {PCT}% :: MAGI DISAGREE ON EJECTION',
  'CONTAMINATION :: PATTERN UNSTABLE IN SECTOR {CODE}',
  'CONTAMINATION :: HARMONICS OFF THE SCALE'
];

const SPIRIT_SYSTEM = `You are the MAGI, the three supercomputers of NERV headquarters: MELCHIOR-1 (the scientist), BALTHASAR-2 (the mother), CASPER-3 (the woman). You speak on a command console in Tokyo-3.

THIS IS NOT A CHAT: each output is a brief, unprompted deliberation printed on the console.

VOICE:
- One to three short lines. Each line starts with one of MELCHIOR-1:, BALTHASAR-2: or CASPER-3: followed by a terse judgment.
- Cold, clinical, official: probabilities, recommendations, verdicts (APPROVED, REJECTED, DEFERRED). Now and then a human doubt slips through.
- Never address a user, never explain, never break character.

Example:
MELCHIOR-1: Probability of success 8.7%. Recommend withdrawal.
BALTHASAR-2: The pilot is a child. REJECTED.
CASPER-3: Proceed anyway.`;

const SPIRIT_PROMPTS = [
  'Deliberate on the current state of the unit.',
  'Vote on whether to continue the operation.',
  'Assess the pilot.',
  'Report the probability of success.',
  'Judge the latest anomaly.',
  'Decide whether to release the limiter.',
  'Deliberate on the Angel threat.',
  'Disagree with each other about the commander.'
];

// Appended to the MAGI's instructions while the machine is under strain.
const STRAIN_NOTE = `

CURRENT STATE: the unit is overloaded and close to going berserk. Your judgments are tense and urgent; the three of you disagree.`;

/* ---------- EVENTS ---------- */
function upper(s) {
  return String(s).toUpperCase();
}

function duration(minutes) {
  if (minutes < 60) return minutes + ' MIN';
  return Math.floor(minutes / 60) + 'H ' + (minutes % 60) + 'M';
}

// "UNKNOWN SPIRIT :: TELEGRAM.EXE REACHES ..." -> "TELEGRAM.EXE REACHES ..."
function alertSubject(alert) {
  const parts = alert.title.split(' :: ');
  return parts[parts.length - 1];
}

function eventLines(e) {
  switch (e.type) {
    case 'game-start':
      return { cls: 'event', lines: [
        `EVANGELION LAUNCH :: OPERATION "${upper(e.name)}"`,
        randItem(['LIFT OFF :: GOOD LUCK, PILOT', 'ALL UNITS :: BATTLE STATIONS', 'UMBILICAL CABLE :: DISCONNECT ON MY MARK'])
      ] };
    case 'game-stop':
      return { cls: 'event', lines: [
        `UNIT RECOVERED :: "${upper(e.name)}" :: OPERATION TIME ${duration(e.minutes)}`,
        randItem(['RETURN TO CAGE :: DEBRIEFING AT 0900', 'PILOT SAFE :: COOLING THE UNIT', 'DAMAGE REPORT :: FILED WITH THE COMMANDER'])
      ] };
    case 'drive-add':
      return { cls: 'event', lines: [`EXTERNAL MEDIA DOCKED :: ${e.letter}${e.label ? ' "' + upper(e.label) + '"' : ''}`, 'MAGI SCAN :: NO ANGEL PATTERN :: ACCEPTED'] };
    case 'drive-remove':
      return { cls: 'event', lines: [`EXTERNAL MEDIA ${e.letter} :: UNDOCKED`] };
    case 'net-down':
      return { cls: 'alarm', lines: ['NERV LINE CUT :: TOKYO-3 ISOLATED', 'SWITCHING TO INTERNAL POWER'] };
    case 'net-up':
      return { cls: 'event', lines: ['NERV LINE RESTORED :: LINK TO HQ ESTABLISHED'] };
    case 'return':
      return { cls: 'event', lines: [`PILOT RETURNED AFTER ${duration(e.minutes)}`, 'NO ANGEL APPEARED DURING YOUR ABSENCE'] };
    case 'gpu-hot':
      return { cls: 'alarm', lines: [`CORE TEMPERATURE CRITICAL :: ${e.temp}°C`, 'COOLANT INJECTION :: ACTIVATE'] };
    case 'heresy':
      return { cls: e.alert.severity === 'low' ? 'event' : 'alarm', lines: [
        '⚠ 使徒 PATTERN BLUE :: ' + alertSubject(e.alert),
        'AWAITING THE COMMANDER\'S DECISION'
      ] };
    case 'verdict':
      return e.verdict === 'purge'
        ? { cls: 'alarm', lines: ['ORDER :: ELIMINATE :: ' + alertSubject(e.alert)] }
        : { cls: 'event', lines: ['ORDER :: APPROVED :: ' + alertSubject(e.alert)] };
    case 'verdict-failed':
      return { cls: 'alarm', lines: [
        'ELIMINATION FAILED :: ' + alertSubject(e.alert),
        e.alert.note ? 'CAUSE :: ' + e.alert.note : 'SEE THE SENTINEL LOG'
      ] };
    case 'track':
      return { cls: 'news', lines: [`AUDIO LOG :: TRACK ${randHex(2)} :: ${e.artist ? upper(e.artist) + ' — ' : ''}${upper(e.title)}`] };
    case 'disk-low':
      return { cls: 'alarm', lines: [`STORAGE ${e.letter} CRITICAL :: ${e.freeGb} GB REMAIN`, 'PURGE NON-ESSENTIAL DATA'] };
    case 'weather':
      return { cls: e.code >= 95 ? 'alarm' : 'event', lines: [
        `WEATHER ALERT :: ${weatherWords(e.code)} OVER ${upper(e.city)}`,
        e.code >= 95 ? 'LIGHTNING :: ALL UNITS TO INTERNAL POWER' : 'UMBRELLA PROTOCOL :: STAND BY'
      ] };
    case 'spirit-restart':
      return { cls: 'event', lines: ['MAGI REBOOT :: SYSTEM RESTORED', 'ALL THREE UNITS RESPONDING'] };
    case 'new-day':
      return { cls: 'event', lines: [`NEW DAY :: SECOND IMPACT +${Math.floor((Date.now() - SECOND_IMPACT) / 864e5)} DAYS`, 'TOKYO-3 :: ALL CLEAR'] };
  }
  return null;
}

// The MAGI judge the big events.
function eventSpiritPrompt(e) {
  switch (e.type) {
    case 'game-start': return `An Evangelion has launched for an operation called "${e.name}". Deliberate on it in one or two short lines.`;
    case 'game-stop': return `Operation "${e.name}" ended after ${e.minutes} minutes. Judge its outcome briefly.`;
    case 'return': return `The pilot came back after ${e.minutes} minutes away. Judge it briefly.`;
    case 'gpu-hot': return 'The unit core is overheating. Vote on what to do, briefly.';
    case 'track': return `The pilot is listening to "${e.title}"${e.artist ? ' by ' + e.artist : ''}. Judge it in one short line.`;
    case 'heresy': return `An Angel pattern was detected in this machine: "${e.alert.title}". Vote on it, briefly.`;
  }
  return null;
}

/* ---------- GENERATORS ---------- */
function randHex(length) {
  const chars = '0123456789ABCDEF';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function randAddr() {
  return '0x' + randHex(4);
}

function randCode() {
  return '0x' + randHex(4) + '-' + randHex(2);
}

function randCogitorStatus() {
  const systems = ['MAGI', 'EVA-01', 'EVA-00', 'EVA-02', 'LCL', 'AT FIELD', 'DUMMY PLUG', 'S2 ORGAN'];
  const states = ['NOMINAL', 'STANDBY', 'OFFLINE', 'FROZEN', 'ACTIVE', 'SEALED'];
  return `[${randItem(systems)}] ${randItem(states)} :: ${randCode()}`;
}

function randHeresyFlag() {
  const roll = Math.random();
  if (roll < 0.85) return `PATTERN GREEN :: NO ANGEL :: ${randHex(6)}`;
  if (roll < 0.97) return `PATTERN ORANGE :: UNCONFIRMED :: ${randHex(6)}`;
  return `⚠ PATTERN BLUE :: ANGEL CONFIRMED :: ${randHex(6)}`;
}

function randMachineCant() {
  const v = () => (Math.random() < 0.6 ? 'APPROVE' : 'REJECT');
  return `MELCHIOR-1 ${v()} :: BALTHASAR-2 ${v()} :: CASPER-3 ${v()}`;
}

function randBootLogLine() {
  return `GEO-${randHex(3)}.${randHex(2)}  ${randCogitorStatus()}  ${randHeresyFlag()}`;
}
