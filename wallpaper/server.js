// Tiny server for the Cogitator Lively wallpaper.
// Lively opens wallpapers from disk (Origin: null), which Ollama rejects;
// served from http://127.0.0.1 the page gets an origin Ollama allows by default.
// It also gathers machine readings and events (games, drives, network, absence) for the console.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');
const { spawn, execFile } = require('child_process');

// The local DNS answers "::" for some hosts; prefer the real IPv4 addresses for news feeds.
dns.setDefaultResultOrder('ipv4first');

const PORT = 8484;
const ROOT = path.join(__dirname, 'www');
// Pictures for the art carousel: drop any images into this folder.
const ART_DIR = path.join(__dirname, 'art');
const IMAGE = /\.(jpe?g|png|webp|gif)$/i;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
};

/* ---------- TELEMETRY ---------- */
const vitals = { cpu: null, ram: null, gpu: null, games: [], drives: [], online: null, idle: 0 };
const events = [];
let lastEventId = 0;

function emit(type, data) {
    events.push({ id: ++lastEventId, type, time: Date.now(), ...data });
    if (events.length > 50) events.shift();
}

function onLines(stream, handle) {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.filter(Boolean).forEach(handle);
    });
}

let prevCpu = os.cpus();
function sampleCpu() {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    cpus.forEach((c, i) => {
        const p = prevCpu[i].times;
        for (const k in c.times) total += c.times[k] - p[k];
        idle += c.times.idle - p.idle;
    });
    prevCpu = cpus;
    vitals.cpu = { load: total ? Math.round(100 * (1 - idle / total)) : 0, cores: cpus.length };
    vitals.ram = { used: os.totalmem() - os.freemem(), total: os.totalmem() };
}

let gpuHot = false;
function watchGpu() {
    let missing = false;
    const smi = spawn('nvidia-smi', [
        '--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw',
        '--format=csv,noheader,nounits', '-l', '2'
    ], { windowsHide: true });

    onLines(smi.stdout, line => {
        const [load, temp, memUsed, memTotal, power] = line.split(',').map(Number);
        vitals.gpu = { load, temp, memUsed, memTotal, power };
        if (!gpuHot && temp >= 83) { gpuHot = true; emit('gpu-hot', { temp }); }
        if (gpuHot && temp < 75) gpuHot = false;
    });
    // no NVIDIA tools: the panel shows the GPU as silent
    smi.on('error', () => { missing = true; vitals.gpu = null; });
    smi.on('exit', () => { if (!missing) setTimeout(watchGpu, 10000); });
}

const gameStarted = new Map();
let prevIdle = 0;
let firstSystem = true;

function onSystem(s) {
    const games = s.games || [];
    for (const g of games) {
        if (!gameStarted.has(g)) { gameStarted.set(g, Date.now()); emit('game-start', { name: g }); }
    }
    for (const [g, since] of gameStarted) {
        if (!games.includes(g)) {
            gameStarted.delete(g);
            emit('game-stop', { name: g, minutes: Math.round((Date.now() - since) / 60000) });
        }
    }

    const drives = s.drives || [];
    if (!firstSystem) {
        for (const d of drives) if (!vitals.drives.some(o => o.letter === d.letter)) emit('drive-add', d);
        for (const d of vitals.drives) if (!drives.some(n => n.letter === d.letter)) emit('drive-remove', d);
        if (vitals.online !== null && s.online !== null && s.online !== vitals.online) emit(s.online ? 'net-up' : 'net-down', {});
    }
    if (prevIdle >= 600 && s.idle < 10) emit('return', { minutes: Math.round(prevIdle / 60) });

    prevIdle = s.idle;
    firstSystem = false;
    Object.assign(vitals, { games, drives, idle: s.idle, online: s.online });
}

function watchSystem() {
    const ps = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(__dirname, 'telemetry.ps1'), '-ParentPid', String(process.pid)
    ], { windowsHide: true });

    onLines(ps.stdout, line => {
        try { onSystem(JSON.parse(line)); } catch { }
    });
    ps.on('exit', () => setTimeout(watchSystem, 10000));
}

/* ---------- OLLAMA WATCHDOG ---------- */
// The machine-spirit lives in Ollama. If Ollama crashes, start it again; if it was quit by hand, leave it be.
const OLLAMA_APP = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama app.exe');
const OLLAMA_LOG = path.join(process.env.LOCALAPPDATA, 'Ollama', 'app.log');
let ollamaSilent = 0;
let lastOllamaStart = 0;

function ollamaRunning() {
    return new Promise(resolve => {
        execFile('tasklist', ['/FI', 'IMAGENAME eq ollama*', '/NH', '/FO', 'CSV'], { windowsHide: true },
            (err, out) => resolve(!err && /ollama/i.test(out)));
    });
}

// app.log starts over with every Ollama start; a clean quit (tray menu, Windows logoff) ends with this line
function ollamaQuitByHand() {
    try {
        return fs.readFileSync(OLLAMA_LOG, 'utf8').includes('msg="shutting down ollama server"');
    } catch {
        return false;
    }
}

async function watchOllama() {
    try {
        await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(3000) });
        ollamaSilent = 0;
        return;
    } catch { }

    ollamaSilent++;
    // silent for a minute, nothing of Ollama running, not quit on purpose, no restart in the last 10 minutes
    if (ollamaSilent < 2 || Date.now() - lastOllamaStart < 600000) return;
    if (await ollamaRunning() || ollamaQuitByHand()) return;

    lastOllamaStart = Date.now();
    spawn(OLLAMA_APP, [], { detached: true, stdio: 'ignore' }).unref();
    emit('spirit-restart', {});
}

/* ---------- SENTINEL ---------- */
// The sentinel (sentinel\sentinel.ps1) runs as SYSTEM and writes its state here; verdicts go back through the inbox.
const SENTINEL_DIR = 'C:\\ProgramData\\CogitatorSentinel';
const SENTINEL_INBOX = path.join(__dirname, 'sentinel-inbox');
const ORIGIN = 'http://127.0.0.1:' + PORT;

function readSentinel() {
    try {
        const state = JSON.parse(fs.readFileSync(path.join(SENTINEL_DIR, 'state.json'), 'utf8').replace(/^\uFEFF/, ''));
        // the sentinel rewrites its state every few seconds; an old file means it has stopped
        return Date.now() - state.updated < 60000 ? state : { running: false, installed: true };
    } catch {
        return { running: false, installed: fs.existsSync(SENTINEL_DIR) };
    }
}

// Changes may only come from our own pages (wallpaper, admin): same host and origin,
// so no web page open in a browser can click or upload for you.
function sameOrigin(req) {
    return req.headers.host === '127.0.0.1:' + PORT && req.headers.origin === ORIGIN;
}

function decide(req, res) {
    if (!sameOrigin(req)) {
        res.writeHead(403);
        return res.end();
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; if (body.length > 1000) req.destroy(); });
    req.on('end', () => {
        let v;
        try { v = JSON.parse(body); } catch { }
        if (!v || !/^[0-9a-f]{12}$/.test(v.id) || !['ok', 'ack', 'purge'].includes(v.verdict)) {
            res.writeHead(400);
            return res.end();
        }
        fs.mkdirSync(SENTINEL_INBOX, { recursive: true });
        fs.writeFile(path.join(SENTINEL_INBOX, v.id + '.json'), JSON.stringify({ id: v.id, verdict: v.verdict }), err => {
            res.writeHead(err ? 500 : 204);
            res.end();
        });
    });
}

/* ---------- NEWS ---------- */
// Headlines for the console from the feeds in news.json; each is shown once (remembered in news-seen.json).
const NEWS_FILE = path.join(__dirname, 'news.json');
const SEEN_FILE = path.join(__dirname, 'news-seen.json');
let news = [];   // { feed, tag, title, source, time, key }, newest first
let feedTurn = 0;
let seen;
try { seen = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); } catch { seen = new Set(); }

function decodeXml(s) {
    return s
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

function tagText(block, name) {
    const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
    return m ? decodeXml(m[1]) : '';
}

// RSS <item> and Atom <entry> alike
function parseFeed(xml) {
    const items = [];
    for (const m of xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
        let title = tagText(m[2], 'title');
        const source = tagText(m[2], 'source');
        // Google News appends " - Outlet" to every title
        if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
        const time = Date.parse(tagText(m[2], 'pubDate') || tagText(m[2], 'published') || tagText(m[2], 'updated'));
        if (title) items.push({ title, source, time: isNaN(time) ? Date.now() : time });
    }
    return items;
}

function newsKey(title) {
    return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function readNewsConfig() {
    return JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8'));
}

async function fetchFeed(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (CogitatorWallpaper)' },
        signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return parseFeed(await res.text());
}

let newsTimer = null;
let feedStats = [];   // per feed: fresh headlines found, or the error, for the admin page

async function refreshNews() {
    clearTimeout(newsTimer);
    let minutes = 30;
    try {
        const config = readNewsConfig();
        minutes = config.refreshMinutes || minutes;
        const fresh = [];
        const stats = [];
        await Promise.all(config.feeds.map(async (feed, i) => {
            try {
                const maxAge = (feed.maxAgeHours || config.maxAgeHours || 48) * 3600000;
                let count = 0;
                for (const item of await fetchFeed(feed.url)) {
                    if (Date.now() - item.time > maxAge) continue;
                    count++;
                    fresh.push({
                        feed: i, tag: feed.tag, title: item.title,
                        source: item.source || feed.source || '', time: item.time, key: newsKey(item.title)
                    });
                }
                stats[i] = { count };
            } catch (e) {
                stats[i] = { error: e.message };   // a feed that is down just sits this round out
            }
        }));
        feedStats = stats;
        news = fresh.sort((a, b) => b.time - a.time);
    } catch { }
    newsTimer = setTimeout(refreshNews, minutes * 60000);
}

// Feeds take turns, so no topic or language crowds out the rest; within a feed, newest first.
function nextNews() {
    const feeds = [...new Set(news.map(n => n.feed))].sort((a, b) => a - b);
    for (let k = 0; k < feeds.length; k++) {
        const feed = feeds[(feedTurn + k) % feeds.length];
        const item = news.find(n => n.feed === feed && !seen.has(n.key));
        if (!item) continue;

        feedTurn = (feedTurn + k + 1) % feeds.length;
        seen.add(item.key);
        if (seen.size > 4000) seen = new Set([...seen].slice(-3000));
        fs.writeFile(SEEN_FILE, JSON.stringify([...seen]), () => { });
        const { tag, title, source, time } = item;
        return { tag, title, source, time };
    }
    return null;
}

/* ---------- ADMIN ---------- */
// Backs the admin page (www/admin.html): art uploads and deletions, news feeds and timings.
const MAX_IMAGE = 25 * 1024 * 1024;

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', c => {
            size += c.length;
            if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// only real pictures, whatever the file is called
function isImage(b) {
    const head = b.subarray(0, 12).toString('latin1');
    return (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || head.startsWith('\x89PNG') ||
        head.startsWith('GIF8') || (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP');
}

function safeArtName(name) {
    const base = path.basename(String(name)).replace(/[^\p{L}\p{N} ._'(),&-]+/gu, '_').trim().slice(-120);
    return IMAGE.test(base) && !base.startsWith('.') ? base : null;
}

function freeArtName(name) {
    const ext = path.extname(name);
    const stem = name.slice(0, -ext.length);
    let candidate = name;
    for (let n = 2; fs.existsSync(path.join(ART_DIR, candidate)); n++) candidate = `${stem} (${n})${ext}`;
    return candidate;
}

function cleanNewsConfig(c) {
    const num = (v, lo, hi, d) => Number.isFinite(Number(v)) && v !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d;
    if (!c || !Array.isArray(c.feeds)) throw new Error('no feeds');
    return {
        refreshMinutes: num(c.refreshMinutes, 5, 720, 30),
        maxAgeHours: num(c.maxAgeHours, 1, 720, 48),
        showEverySeconds: num(c.showEverySeconds, 20, 3600, 90),
        feeds: c.feeds.slice(0, 40).map(f => {
            const u = new URL(String(f.url));
            if (u.protocol !== 'https:') throw new Error('only https feeds');
            const feed = {
                tag: String(f.tag || 'NEWS').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'NEWS',
                source: String(f.source || '').slice(0, 40),
                url: u.href
            };
            if (f.maxAgeHours) feed.maxAgeHours = num(f.maxAgeHours, 1, 720, 48);
            if (f.keywords) feed.keywords = String(f.keywords).slice(0, 200);
            if (f.lang === 'ru' || f.lang === 'en') feed.lang = f.lang;
            return feed;
        })
    };
}

async function admin(req, res, rel, url) {
    const fail = (code, message) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(message || ''); };

    if (req.method === 'GET' && rel === '/admin/state') {
        const art = fs.readdirSync(ART_DIR).filter(n => IMAGE.test(n)).sort()
            .map(name => ({ name, size: fs.statSync(path.join(ART_DIR, name)).size }));
        let config = {};
        try { config = readNewsConfig(); } catch { }
        return sendJson(res, { art, news: config, feedStats });
    }

    if (req.method !== 'POST') return fail(405);
    if (!sameOrigin(req)) return fail(403);

    try {
        if (rel === '/admin/art/upload') {
            const name = safeArtName(url.searchParams.get('name'));
            if (!name) return fail(400, 'Only .jpg, .png, .webp or .gif');
            const body = await readBody(req, MAX_IMAGE);
            if (!isImage(body)) return fail(400, 'Not a picture');
            const saved = freeArtName(name);
            fs.writeFileSync(path.join(ART_DIR, saved), body);
            return sendJson(res, { name: saved });
        }

        const json = JSON.parse((await readBody(req, 100000)).toString('utf8') || '{}');

        if (rel === '/admin/art/delete') {
            const name = safeArtName(json.name);
            if (!name || name !== json.name || !fs.existsSync(path.join(ART_DIR, name))) return fail(404);
            fs.unlinkSync(path.join(ART_DIR, name));
            return sendJson(res, { ok: true });
        }

        if (rel === '/admin/news/save') {
            const config = cleanNewsConfig(json);
            fs.writeFileSync(NEWS_FILE, JSON.stringify(config, null, 2));
            await refreshNews();
            return sendJson(res, { news: config, feedStats });
        }

        if (rel === '/admin/news/test') {
            const u = new URL(String(json.url));
            if (u.protocol !== 'https:') return fail(400, 'Only https feeds');
            const items = (await fetchFeed(u.href)).sort((a, b) => b.time - a.time);
            return sendJson(res, { count: items.length, sample: items.slice(0, 5) });
        }
    } catch (e) {
        return fail(400, e.message);
    }
    return fail(404);
}

/* ---------- HTTP ---------- */
function sendJson(res, data) {
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
    let url, rel;
    try {
        url = new URL(req.url, 'http://127.0.0.1');
        rel = decodeURIComponent(url.pathname);
    } catch {
        res.writeHead(400);
        return res.end();
    }

    if (req.method === 'POST' && rel === '/sentinel/decide') return decide(req, res);
    if (rel.startsWith('/admin/')) return admin(req, res, rel, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        return res.end();
    }
    if (rel === '/') rel = '/app.html';
    if (rel === '/admin') rel = '/admin.html';

    if (rel === '/news/settings') {
        let config = {};
        try { config = readNewsConfig(); } catch { }
        return sendJson(res, { showEverySeconds: config.showEverySeconds || 90 });
    }

    // page errors from the wallpaper, for debugging what Lively's browser does differently
    if (rel === '/log') {
        const line = new Date().toISOString() + ' ' + (url.searchParams.get('m') || '').slice(0, 2000) + '\n';
        fs.appendFile(path.join(__dirname, 'wallpaper.log'), line, () => { });
        res.writeHead(204);
        return res.end();
    }

    if (rel === '/news/next') {
        return sendJson(res, nextNews());
    }

    if (rel === '/telemetry') {
        const since = Number(url.searchParams.get('since')) || 0;
        return sendJson(res, { vitals, lastEventId, events: events.filter(e => e.id > since), sentinel: readSentinel() });
    }

    if (rel === '/art/index.json') {
        return fs.readdir(ART_DIR, (err, names) => sendJson(res, err ? [] : names.filter(n => IMAGE.test(n)).sort()));
    }

    const [root, sub] = rel.startsWith('/art/') ? [ART_DIR, rel.slice('/art'.length)] : [ROOT, rel];
    const file = path.join(root, path.normalize(sub));
    if (!file.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end();
    }

    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404);
            return res.end();
        }
        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        });
        res.end(req.method === 'HEAD' ? undefined : data);
    });
});

// Port taken means another copy is already serving: nothing to do.
server.on('error', () => process.exit(0));
server.listen(PORT, '127.0.0.1', () => {
    setInterval(sampleCpu, 2000);
    watchGpu();
    watchSystem();
    refreshNews();
    setInterval(watchOllama, 30000);
});
