// End-to-end checks in real headless Chromium (no npm packages; Node 22+).
// Usage: node tests/browser_check.mjs [--shots <dir>]
// Starts its own static server + Chromium, mocks the GitHub API, prints PASS/FAIL per check.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const PORT = 8000 + Math.floor(Math.random() * 1000) + 1000;
const CDP_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}/`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
    if (!ok) failures++;
};

const profile = mkdtempSync(join(tmpdir(), 'portfolio-chrome-'));
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
// Headless Chrome reports no pointer at all (hover: none); declare a mouse so desktop hover effects can be tested.
const chrome = spawn('chromium-browser', ['--headless', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${CDP_PORT}`,
    '--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2',
    '--window-size=1440,900', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

/* ── minimal CDP client ── */
let ws, nextId = 0;
const pending = new Map();
const listeners = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
});
const on = (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]);
const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
};
const waitFor = async (expression, timeout = 8000, interval = 40) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (await evaluate(expression)) return Date.now() - start;
        await sleep(interval);
    }
    return -1;
};
const shot = async name => {
    if (!shotsDir) return;
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, 'base64'));
};
const key = async (k, opts = {}) => {
    const codes = { Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'], ArrowRight: [39, 'ArrowRight'], Shift: [16, 'ShiftLeft'], k: [75, 'KeyK', 'k'] };
    const [vk, code, text] = codes[k];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: opts.modifiers || 0, ...(text && !opts.modifiers ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: opts.modifiers || 0 });
};
const type = async text => { await send('Input.insertText', { text }); };
const runCmd = async cmd => { await type(cmd); await key('Enter'); await sleep(150); };
const termText = () => evaluate(`document.getElementById('term-output').innerText`);
const opacity = sel => evaluate(`+getComputedStyle(document.querySelector('${sel}')).opacity`);

/* GitHub API mock: 'ok' returns a fake repo list, 'fail' simulates a network error / rate limit */
let githubMode = 'ok';
const MOCK_REPOS = [
    { name: 'callmenguyen', fork: false, archived: false, html_url: 'https://github.com/callmenguyen/callmenguyen', description: 'profile' },
    { name: 'rust-fork', fork: true, archived: false, html_url: 'x', description: '' },
    { name: 'mock-mlops-repo', fork: false, archived: false, html_url: 'https://github.com/callmenguyen/mock-mlops-repo', description: 'Mocked description' },
];

/* Minimal PNG decoder (8-bit RGB/RGBA, as Chrome screenshots are) → luminance samples */
function decodePng(buf) {
    let pos = 8, width, height, colorType, idat = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
        if (type === 'IDAT') idat.push(data);
        pos += 12 + len;
    }
    const bpp = colorType === 6 ? 4 : 3, stride = width * bpp, raw = inflateSync(Buffer.concat(idat));
    const px = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
        const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
            const pr = f === 4 ? (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })() : 0;
            px[y * stride + x] = (line[x] + [0, a, b, (a + b) >> 1, pr][f]) & 255;
        }
    }
    return { width, height, bpp, px };
}
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hexLum = h => lum(...[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/** Brightest (99th percentile) background luminance behind terminal text, over a few video frames. */
async function terminalBackgroundWorst() {
    await evaluate(`(() => { const st = document.createElement('style'); st.id = '__hide'; st.textContent = '.terminal .term-body, .terminal .term-body * { color: transparent !important; text-decoration-color: transparent !important; background: transparent !important; caret-color: transparent !important }'; document.head.append(st); })()`);
    const r = await evaluate(`(() => { const b = document.querySelector('.term-body').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
    let worst = 0;
    for (let i = 0; i < 5; i++) {
        const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
        const { width, height, bpp, px } = decodePng(Buffer.from(data, 'base64'));
        const ls = [];
        for (let k = 0; k < width * height; k++) ls.push(lum(px[k * bpp], px[k * bpp + 1], px[k * bpp + 2]));
        ls.sort((a, b) => a - b);
        worst = Math.max(worst, ls[Math.floor(ls.length * 0.99)]);
        await sleep(450);
    }
    await evaluate(`document.getElementById('__hide').remove()`);
    return worst;
}
const TN_TEXT = { fg: '#c0caf5', muted: '#a9b1d6', cyan: '#7dcfff', blue: '#7aa2f7', purple: '#bb9af7', red: '#f7768e', link: '#73daca' };

const errors = [];
async function load({ reducedMotion = false, mobile = false, clearStorage = true } = {}) {
    await send('Emulation.setEmulatedMedia', { features: [
        { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
        { name: 'prefers-color-scheme', value: 'dark' }, // deterministic first theme (headless defaults to light)
    ] });
    if (mobile) {
        await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
        await send('Emulation.clearDeviceMetricsOverride');
        await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
    if (clearStorage) await send('Storage.clearDataForOrigin', { origin: BASE.slice(0, -1), storageTypes: 'local_storage,session_storage' });
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(100);
    await send('Page.navigate', { url: BASE });
    await waitFor(`document.readyState === 'complete'`);
}
const introDone = () => waitFor(`document.documentElement.dataset.intro === 'done'`, 12000);

try {
    let targets;
    for (let i = 0; i < 60 && !targets; i++) {
        try { targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json(); } catch { await sleep(200); }
    }
    for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(100); } }
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    ws.addEventListener('message', e => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        } else if (m.method) (listeners.get(m.method) || []).forEach(fn => fn(m.params));
    });
    await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable'].map(m => send(m)));
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.github.com/*' }] });
    on('Fetch.requestPaused', ({ requestId }) => {
        if (githubMode === 'fail') send('Fetch.failRequest', { requestId, errorReason: 'Failed' });
        else send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(MOCK_REPOS)).toString('base64') });
    });
    on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    on('Log.entryAdded', ({ entry }) => {
        // The GitHub failure is simulated on purpose; everything else must be clean.
        if (entry.level === 'error' && !(githubMode === 'fail' && /api\.github\.com|ERR_FAILED/.test(`${entry.url} ${entry.text}`))) errors.push(`${entry.text} ${entry.url || ''}`);
    });

    /* 1. Intro sequence */
    console.log('\n# Intro sequence (desktop, dark)');
    await load();
    const t0 = Date.now();
    const phases = {};
    while (Date.now() - t0 < 10000) {
        const p = await evaluate('document.documentElement.dataset.intro');
        if (p && !(p in phases)) {
            phases[p] = Date.now() - t0;
            if (p === 'settling') phases.h1Settling = await evaluate(`document.querySelector('#hero h1').getBoundingClientRect().top`);
        }
        if (p === 'drawing' && phases.drawing && !phases.shot && Date.now() - t0 - phases.drawing > 1300) {
            phases.shot = 1;
            phases.subtitleHidden = (await opacity('#hero h2')) === 0 && (await opacity('#hero h1')) === 0;
            await shot('intro-drawing');
        }
        if (p === 'done') break;
        await sleep(30);
    }
    check('phases run in order', ['drawing', 'settling', 'typing', 'done'].every(p => p in phases) && phases.drawing < phases.settling && phases.settling < phases.typing && phases.typing < phases.done, JSON.stringify({ drawing: phases.drawing, settling: phases.settling, typing: phases.typing, done: phases.done }));
    check('slower first pass, whole intro ≈ 5.5 s', phases.settling - phases.drawing >= 4400 && phases.done - phases.drawing < 6500, `${phases.settling - phases.drawing} ms drawing, ${phases.done - phases.drawing} ms total`);
    await sleep(600);
    check('heading visible at the end', (await opacity('#hero h1')) === 1);
    const h1Done = await evaluate(`document.querySelector('#hero h1').getBoundingClientRect().top`);
    check('heading does not jump when the terminal output appears', Math.abs(h1Done - phases.h1Settling) < 1, `${phases.h1Settling} → ${h1Done}`);
    const still = await evaluate(`(async () => { const c = document.getElementById('name-canvas'); const a = c.toDataURL(); await new Promise(r => setTimeout(r, 600)); return c.dataset.state === 'idle' && a === c.toDataURL(); })()`);
    check('drawn once: nothing moves on the left after the intro', still && (await opacity('#name-canvas')) === 0);
    check('load drawing uses 180 circles', (await evaluate(`document.getElementById('name-canvas').dataset.circles`)) === '180');
    check('terminal not focused automatically', await evaluate(`document.activeElement === document.body`));
    check('two panes on desktop: name/terminal left, content right', await evaluate(`(() => { const h = document.getElementById('hero').getBoundingClientRect(), a = document.getElementById('about').getBoundingClientRect(); return getComputedStyle(document.getElementById('hero')).position === 'fixed' && h.right <= a.left + 1 && h.width < innerWidth * 0.6; })()`));
    check('macOS title bar (traffic lights)', (await evaluate(`document.querySelectorAll('.term-titlebar .tl').length`)) === 3);
    const intro = await termText();
    check('terminal shows whoami + intro line', intro.includes('whoami') && intro.includes('AI-focused software engineer'), JSON.stringify(intro));
    check('"Currently building" uses GitHub (skips profile repo + forks)', (await evaluate(`document.getElementById('now-link').textContent`)) === 'mock-mlops-repo');
    check('reveal uses native animation-timeline', (await evaluate(`getComputedStyle(document.querySelector('[data-reveal]')).animationTimeline`)) === 'view()');
    check('background video playing', await evaluate(`!document.querySelector('.bg-video').paused`));
    check('subtitle hidden while drawing', phases.subtitleHidden === true);
    await shot('desktop-initial-hero');
    const darkBg = await terminalBackgroundWorst();
    const darkMin = Math.min(...Object.values(TN_TEXT).map(c => contrast(hexLum(c), darkBg)));
    check('terminal text contrast ≥ 4.5 on glass (dark theme, brightest frame)', darkMin >= 4.5, `min ${darkMin.toFixed(2)}:1`);

    /* 2. Terminal */
    console.log('\n# Terminal (kitty + tmux + fish look)');
    check('fish greeting printed first', (await termText()).startsWith('Victory belongs to the most preserving!'));
    check('agnoster prompt segments', (await evaluate(`[...document.querySelectorAll('.term-prompt .seg')].map(s => s.textContent).join('|')`)) === 'nhat@portfolio|~');
    check('glass: more transparent + backdrop blur', await evaluate(`(() => { const cs = getComputedStyle(document.getElementById('terminal')); return cs.backdropFilter.includes('blur(') && cs.backgroundColor === 'rgba(26, 27, 38, 0.16)'; })()`));
    // Either the visitor's local Nerd Font (as on the dotfiles machine) or the web JetBrains Mono must render:
    // a monospace font makes "iiii" and "mmmm" equally wide, the serif fallback would not.
    const fontInUse = await evaluate(`(async () => {
        await document.fonts.ready;
        const c = document.createElement('canvas').getContext('2d');
        const mono = f => { c.font = '16px "' + f + '", serif'; return c.measureText('iiii').width === c.measureText('mmmm').width; };
        return ['JetBrainsMono Nerd Font', 'JetBrains Mono'].filter(mono).join(' + ');
    })()`);
    check('terminal renders in JetBrains Mono (local Nerd Font or web font)', fontInUse.length > 0, fontInUse);
    check('tmux clock shows local time', /^\d{4}-\d{2}-\d{2}  \d{2}:\d{2} (AM|PM)$/.test(await evaluate(`document.getElementById('tmux-clock').textContent`)));
    await evaluate(`document.getElementById('term-input').focus()`);
    await type('hel');
    await sleep(50);
    check('fish coloring: partial/unknown command is red', await evaluate(`document.getElementById('term-input').classList.contains('is-unknown')`));
    check('autosuggestion shows the rest in grey', (await evaluate(`(() => { const g = document.querySelector('.term-ghost'); return g.hidden ? '' : g.textContent; })()`)) === 'p');
    await key('ArrowRight');
    check('→ accepts the suggestion', (await evaluate(`document.getElementById('term-input').value`)) === 'help');
    check('fish coloring: known command is cyan', await evaluate(`!document.getElementById('term-input').classList.contains('is-unknown')`));
    await evaluate(`document.getElementById('term-input').value = ''`);
    await runCmd('help');
    let out = await termText();
    check('help lists all commands', ['help', 'whoami', 'about', 'skills', 'now', 'contact', 'clear'].every(c => out.includes(c)));
    check('help lists the three fourier forms', ['fourier ', 'fourier <n>', 'fourier --grow'].every(c => out.includes(c)));
    check('no projects command yet', !out.includes('projects'));
    await runCmd('about');
    check('about mentions math + quantum', /math and quantum computing/.test(await termText()));
    await runCmd('skills');
    out = await termText();
    check('skills read from the Skills section', out.includes('PyTorch') && out.includes('Neovim'));
    await runCmd('now');
    await sleep(100);
    check('now shows the live repo', (await termText()).includes('Currently building: mock-mlops-repo'));
    await runCmd('contact');
    check('contact prints links', await evaluate(`!!document.querySelector('#term-output a[href="mailto:nhatnguyen.blitz@gmail.com"]')`));
    await runCmd('sudo rm -rf /');
    check('unknown command → friendly hint', (await termText()).includes('fish: Unknown command: sudo — type "help"'));
    await key('ArrowUp');
    check('↑ recalls history', (await evaluate(`document.getElementById('term-input').value`)) === 'sudo rm -rf /');
    await evaluate(`document.getElementById('term-input').value = ''`);
    const termBox = await evaluate(`(() => { const t = document.getElementById('terminal'), b = t.querySelector('.term-body'); return { h: t.offsetHeight, scrolls: b.scrollHeight > b.clientHeight, bottom: Math.abs(b.scrollHeight - b.clientHeight - b.scrollTop) < 2, contain: getComputedStyle(b).overscrollBehaviorY }; })()`);
    check('terminal keeps a fixed height and scrolls inside', termBox.scrolls && termBox.bottom, JSON.stringify(termBox));
    check('overscroll-behavior: contain', termBox.contain === 'contain');
    const pageY = await evaluate('scrollY');
    const tb = await evaluate(`(() => { const r = document.querySelector('.term-body').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: tb.x, y: tb.y, deltaX: 0, deltaY: -400 });
    await sleep(300);
    check('wheel inside the terminal does not scroll the page', (await evaluate('scrollY')) === pageY);
    await runCmd('clear');
    check('clear empties output', (await termText()).trim() === '');
    check('height unchanged after clear', (await evaluate(`document.getElementById('terminal').offsetHeight`)) === termBox.h);
    await evaluate(`document.activeElement.blur()`);
    const ti = await evaluate(`(() => { const r = document.querySelector('.term-output').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 10 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: ti.x, y: ti.y, button: 'left', clickCount: 1 });
    check('click focuses the terminal input', (await evaluate(`document.activeElement.id`)) === 'term-input');
    await shot('terminal');

    /* 3. Palette */
    console.log('\n# Command palette');
    await evaluate(`document.activeElement.blur(); document.getElementById('palette-btn').focus()`);
    await key('k', { modifiers: 2 });
    check('Ctrl+K opens palette with focus in input', await evaluate(`document.getElementById('palette').open && document.activeElement.id === 'palette-input'`));
    await key('ArrowDown'); await key('ArrowDown');
    check('arrow keys move the active option', (await evaluate(`document.getElementById('palette-input').getAttribute('aria-activedescendant')`)) === 'palette-opt-2');
    await key('Escape');
    await sleep(100);
    check('Esc closes and restores focus', await evaluate(`!document.getElementById('palette').open && document.activeElement.id === 'palette-btn'`));
    await key('k', { modifiers: 2 });
    await type('skil');
    await sleep(50);
    check('typing filters', (await evaluate(`[...document.querySelectorAll('#palette-list [role=option]')].map(o => o.textContent).join('|')`)) === 'Skills');
    await shot('palette');
    await key('Enter');
    await sleep(1500);
    check('Enter jumps to the section', await evaluate(`!document.getElementById('palette').open && Math.abs(document.getElementById('skills').getBoundingClientRect().top) < 5`));

    /* 4. Tilt */
    console.log('\n# Skills card tilt');
    const box = await evaluate(`(() => { const r = document.querySelector('.skill-group').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + box.w * 0.85, y: box.y + box.h * 0.2 });
    await sleep(100);
    const tilt = await evaluate(`[document.querySelector('.skill-group').style.getPropertyValue('--ry'), document.querySelector('.skill-group').style.getPropertyValue('--rx')]`);
    check('card tilts toward the cursor', parseFloat(tilt[0]) > 2 && parseFloat(tilt[1]) > 2, tilt.join(' '));
    await shot('skills-tilt');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await sleep(100);
    check('tilt resets on leave', (await evaluate(`document.querySelector('.skill-group').style.getPropertyValue('--ry')`)) === '');

    /* 5. Theme */
    console.log('\n# Theme toggle');
    await evaluate('scrollTo(0, 0)');
    const before = await evaluate('document.documentElement.dataset.theme');
    const btn = await evaluate(`(() => { const r = document.getElementById('theme-toggle').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await evaluate(`window.__vt = 0; const o = document.startViewTransition.bind(document); document.startViewTransition = cb => { window.__vt++; return o(cb); }`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
    await sleep(800);
    const after = await evaluate('document.documentElement.dataset.theme');
    check('click switches theme', before !== after, `${before} → ${after}`);
    check('uses a view transition', (await evaluate('window.__vt')) === 1);
    check('choice saved', (await evaluate(`localStorage.getItem('theme')`)) === after);
    check('button label updated', (await evaluate(`document.getElementById('theme-toggle').getAttribute('aria-label')`)) === `Switch to ${before} theme`);
    await shot(`desktop-${after}-hero`);
    const lightBg = await terminalBackgroundWorst();
    const lightMin = Math.min(...Object.values(TN_TEXT).map(c => contrast(hexLum(c), lightBg)));
    check('terminal text contrast ≥ 4.5 on glass (light theme, brightest frame)', lightMin >= 4.5, `min ${lightMin.toFixed(2)}:1`);
    await load({ clearStorage: false });
    check('theme persists after reload', (await evaluate('document.documentElement.dataset.theme')) === after);

    /* 6. Skip */
    console.log('\n# Skip');
    await load();
    await waitFor(`document.documentElement.dataset.intro === 'drawing'`);
    await sleep(500);
    await key('Shift');
    check('keypress skips straight to the end', (await waitFor(`document.documentElement.dataset.intro === 'done'`, 300)) >= 0);
    await sleep(600);
    check('after skip: heading + whoami output shown', (await opacity('#hero h1')) === 1 && (await termText()).includes('AI-focused software engineer'));
    check('after skip: canvas idle, nothing drawing', (await evaluate(`document.getElementById('name-canvas').dataset.state`)) === 'idle');

    /* 6b. Reload while scrolled down → still plays from the top; deep link → no intro */
    console.log('\n# Reload / deep link');
    await introDone();
    await evaluate(`scrollTo(0, document.getElementById('skills').offsetTop)`);
    await sleep(300);
    await send('Page.reload');
    await waitFor(`document.readyState === 'complete'`);
    check('reload while scrolled down starts at the top', (await waitFor(`document.documentElement.dataset.intro === 'drawing' && scrollY === 0`, 3000)) >= 0);
    check('…and the drawing is not paused', (await evaluate(`'introPaused' in document.documentElement.dataset`)) === false);
    await send('Page.navigate', { url: 'about:blank' }); // fresh load, not a same-page fragment jump
    await sleep(100);
    await send('Page.navigate', { url: BASE + '#skills' });
    await waitFor(`document.readyState === 'complete'`);
    await sleep(500);
    check('deep link (#skills) skips the intro', (await evaluate(`document.documentElement.dataset.intro`)) === 'done');


    /* 7. Pause when hidden / off-screen */
    console.log('\n# Pause off-screen / hidden tab');
    await load();
    await waitFor(`document.documentElement.dataset.intro === 'drawing'`);
    await sleep(300);
    await evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))`);
    check('pauses when the tab is hidden', (await waitFor(`'introPaused' in document.documentElement.dataset`, 500)) >= 0);
    await sleep(5000); // longer than the whole first pass
    check('no progress while hidden', (await evaluate('document.documentElement.dataset.intro')) === 'drawing');
    await evaluate(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`);
    check('resumes when visible again', (await waitFor(`!('introPaused' in document.documentElement.dataset)`, 500)) >= 0);
    await evaluate(`scrollTo(0, document.getElementById('skills').offsetTop)`);
    await sleep(500);
    check('desktop: left pane stays in view, so the drawing keeps going while scrolling', await evaluate(`!('introPaused' in document.documentElement.dataset) && Math.abs(document.getElementById('hero').getBoundingClientRect().top) < 1`));
    await evaluate('scrollTo(0, 0)');
    check('finishes', (await introDone()) >= 0);

    /* 7b. Left pane never moves, not even when the footer arrives */
    console.log('\n# Fixed left pane');
    await evaluate(`scrollTo(0, document.documentElement.scrollHeight)`);
    await sleep(400);
    const atBottom = await evaluate(`(() => { const h = document.getElementById('hero').getBoundingClientRect(), f = document.querySelector('footer').getBoundingClientRect(); return { heroTop: h.top, heroBottom: h.bottom, footerTop: f.top, footerLeft: f.left, heroRight: h.right, vh: innerHeight }; })()`);
    check('left pane still at the top with the footer in view', Math.abs(atBottom.heroTop) < 1 && Math.abs(atBottom.heroBottom - atBottom.vh) < 1 && atBottom.footerTop < atBottom.vh, JSON.stringify(atBottom));
    check('footer sits in the right column', atBottom.footerLeft >= atBottom.heroRight - 1);
    await evaluate('scrollTo(0, 0)');

    /* 7c. Replays: click the name, `fourier`, `fourier <n>`, `fourier --grow` */
    console.log('\n# Fourier replays');
    const nameBox = await evaluate(`(() => { const r = document.getElementById('hero-name').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: nameBox.x, y: nameBox.y, button: 'left', clickCount: 1 });
    check('click on the name replays the drawing', (await waitFor(`document.getElementById('name-canvas').dataset.state === 'drawing'`, 1500)) >= 0);
    await sleep(700);
    check('heading hidden while it redraws', (await opacity('#hero h1')) === 0);
    check('replay ends: canvas idle, heading back', (await waitFor(`document.getElementById('name-canvas').dataset.state === 'idle'`, 8000)) >= 0 && (await sleep(600), (await opacity('#hero h1')) === 1));
    await evaluate(`document.getElementById('term-input').focus()`);
    await runCmd('fourier 999');
    check('fourier <n> clamps to 300', (await termText()).includes('300 circles… (clamped from 999)') && (await evaluate(`document.getElementById('name-canvas').dataset.circles`)) === '300');
    await runCmd('fourier 0');
    check('fourier 0 clamps to 1', (await evaluate(`document.getElementById('name-canvas').dataset.circles`)) === '1');
    await runCmd('fourier 42');
    check('fourier 42 draws with 42 circles', (await evaluate(`document.getElementById('name-canvas').dataset.circles`)) === '42' && (await evaluate(`document.getElementById('name-canvas').dataset.state`)) === 'drawing');
    await runCmd('fourier abc');
    check('bad argument prints usage', (await termText()).includes('usage: fourier [n | --grow]'));
    await runCmd('fourier --grow');
    await sleep(300);
    const g1 = await evaluate(`[document.getElementById('name-canvas').dataset.state, +document.getElementById('name-canvas').dataset.circles]`);
    await sleep(3000);
    const g2 = await evaluate(`+document.getElementById('name-canvas').dataset.circles`);
    await shot('fourier-grow');
    check('fourier --grow adds circles over time', g1[0] === 'growing' && g1[1] < g2 && g2 < 300, `${g1[1]} → ${g2}`);
    check('heading stays hidden when one replay interrupts another', (await opacity('#hero h1')) === 0);
    check('…reaches 300 and stops', (await waitFor(`document.getElementById('name-canvas').dataset.state === 'idle'`, 8000)) >= 0 && (await evaluate(`document.getElementById('name-canvas').dataset.circles`)) === '300');
    await runCmd('fourier');
    check('fourier replays with the default 180', (await termText()).includes('Redrawing the name with 180 circles') && (await evaluate(`document.getElementById('name-canvas').dataset.circles`)) === '180');
    await evaluate(`document.activeElement.blur()`);
    check('replay finishes', (await waitFor(`document.getElementById('name-canvas').dataset.state === 'idle'`, 8000)) >= 0);

    /* 8. Auto-scroll */
    console.log('\n# Auto-scroll');
    await load();
    await introDone();
    await sleep(3000);
    check('waits while idle < 4 s', (await evaluate('scrollY')) === 0);
    await sleep(2500);
    const y1 = await evaluate('scrollY');
    await sleep(1000);
    const y2 = await evaluate('scrollY');
    check('then scrolls ~60 px/s', y1 > 0 && y2 - y1 > 45 && y2 - y1 < 75, `+${Math.round(y2 - y1)} px/s`);
    await key('Shift'); // user input stops the running auto-scroll first
    await evaluate(`scrollTo(0, 0); document.getElementById('term-input').focus()`);
    await sleep(5500);
    check('paused while the terminal is focused', (await evaluate('scrollY')) === 0);

    /* 9. GitHub fallback */
    console.log('\n# GitHub fallback');
    githubMode = 'fail';
    await load();
    await sleep(800);
    check('static fallback when the API fails', (await evaluate(`document.getElementById('now-link').textContent`)) === 'practical AI systems');
    githubMode = 'ok';

    /* 10. Reduced motion */
    console.log('\n# prefers-reduced-motion');
    await load({ reducedMotion: true });
    await sleep(400);
    check('no intro state at all', (await evaluate('document.documentElement.dataset.intro')) === undefined);
    check('heading + terminal output instantly', (await opacity('#hero h1')) === 1 && (await termText()).includes('AI-focused software engineer'));
    check('no canvas, no video', await evaluate(`getComputedStyle(document.getElementById('name-canvas')).display === 'none' && getComputedStyle(document.querySelector('.bg-video')).display === 'none' && document.querySelector('.bg-video').paused`));
    check('static poster background', (await evaluate(`getComputedStyle(document.body).backgroundImage`)).includes('minato-poster.jpg'));
    check('no scroll animations', (await evaluate(`getComputedStyle(document.querySelector('[data-reveal]')).animationName`)) === 'none');
    await evaluate(`window.__vt = 0; document.startViewTransition = () => { window.__vt++; }`);
    await evaluate(`document.getElementById('theme-toggle').click()`);
    check('theme switches instantly (no transition)', (await evaluate('window.__vt')) === 0);
    await shot('reduced-motion');
    await sleep(5500);
    check('no auto-scroll', (await evaluate('scrollY')) === 0);

    /* 11. Mobile 360 px */
    console.log('\n# Mobile 360 px');
    await load({ mobile: true });
    await introDone();
    await sleep(600);
    await shot('mobile-hero');
    const overflow = await evaluate(`(async () => {
        const out = [];
        for (const theme of ['dark', 'light']) {
            document.documentElement.dataset.theme = theme;
            for (const y of [0, 900, 1800, 1e6]) { scrollTo(0, y); await new Promise(r => setTimeout(r, 50)); out.push(document.documentElement.scrollWidth); }
        }
        return out;
    })()`);
    check('no horizontal scroll at 360 px', overflow.every(w => w <= 360), overflow.join(','));
    check('no hover effects on touch', await evaluate(`!matchMedia('(hover: hover) and (pointer: fine)').matches`));
    check('single column on mobile', await evaluate(`(() => { const h = document.getElementById('hero').getBoundingClientRect(), a = document.getElementById('about').getBoundingClientRect(); return !['sticky', 'fixed'].includes(getComputedStyle(document.getElementById('hero')).position) && a.top >= h.bottom - 1; })()`));
    await evaluate(`document.getElementById('name-replay').click()`);
    await waitFor(`document.getElementById('name-canvas').dataset.state === 'drawing'`, 1500);
    await evaluate(`scrollTo(0, document.getElementById('skills').offsetTop)`);
    check('mobile: a replay pauses when the name is off-screen', (await waitFor(`'introPaused' in document.documentElement.dataset`, 1500)) >= 0);
    await evaluate('scrollTo(0, 0)');
    check('mobile: …and resumes when back on screen', (await waitFor(`!('introPaused' in document.documentElement.dataset)`, 1500)) >= 0);
    await evaluate(`scrollTo(0, document.getElementById('skills').offsetTop)`);
    await sleep(300);
    await shot('mobile-skills');
    check('burger opens menu', await evaluate(`document.querySelector('.burger').click(); document.querySelector('.burger').getAttribute('aria-expanded') === 'true'`));

    console.log('\n# Console');
    check('no JS errors or failed requests', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (err) {
    console.error(err);
    failures++;
} finally {
    ws?.close();
    chrome.kill();
    server.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
    console.log(`\n${failures ? `${failures} check(s) FAILED` : 'All browser checks passed'}`);
    process.exit(failures ? 1 : 0);
}
