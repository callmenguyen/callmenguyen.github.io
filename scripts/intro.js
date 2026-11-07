// Fourier epicycles drawing an SVG path (the name) onto the hero heading.
// One pass at a time — nothing keeps moving afterwards:
//   draw({ circles })  pen traces the curve made by the top-N circles, then hands off to the heading
//   grow()             circles are added one by one (1 → max) while the whole curve sharpens
// The path's viewBox is mapped onto the heading's text box, so the drawing lands on the text.

const SVG_NS = 'http://www.w3.org/2000/svg';

async function loadPath(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`name path: HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
    const svg = doc.querySelector('svg');
    const path = doc.querySelector('path');
    if (!svg || !path) throw new Error('name path: no <svg>/<path>');
    const [x, y, w, h] = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
    return { d: path.getAttribute('d'), viewBox: { x, y, w, h } };
}

/**
 * Sample the path as one closed loop. Each subpath (absolute "M…") is ink; the jumps
 * between subpaths are pen-up connectors traversed faster and never drawn.
 */
function samplePath(d, total) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    document.body.append(svg);
    const subpaths = d.split(/(?=M)/).map(s => s.trim()).filter(Boolean).map(sd => {
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', sd);
        svg.append(p);
        return { el: p, len: p.getTotalLength() };
    });

    const PEN_UP_SPEED = 3; // connectors move this many times faster than ink
    const starts = subpaths.map(s => s.el.getPointAtLength(0));
    const gaps = starts.map((p, i) => {
        const q = starts[(i + 1) % starts.length];
        return Math.hypot(q.x - p.x, q.y - p.y);
    });
    const inkLen = subpaths.reduce((a, s) => a + s.len, 0);
    const step = (inkLen + gaps.reduce((a, g) => a + g, 0) / PEN_UP_SPEED) / total;

    const pts = [];
    subpaths.forEach((s, i) => {
        const n = Math.max(2, Math.round(s.len / step));
        for (let k = 0; k < n; k++) {
            const p = s.el.getPointAtLength((k / n) * s.len);
            pts.push({ x: p.x, y: p.y, ink: true });
        }
        const a = starts[i], b = starts[(i + 1) % starts.length];
        const m = Math.round(gaps[i] / PEN_UP_SPEED / step);
        for (let k = 0; k < m; k++) {
            const t = k / m;
            pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ink: false });
        }
    });
    svg.remove();
    return pts;
}

/** Discrete Fourier transform of the points as complex numbers, sorted by amplitude. */
function dft(pts) {
    const N = pts.length;
    const terms = [];
    for (let k = 0; k < N; k++) {
        const freq = k <= N / 2 ? k : k - N; // signed frequencies → smoother epicycles
        let re = 0, im = 0;
        for (let n = 0; n < N; n++) {
            const phi = (-2 * Math.PI * freq * n) / N;
            const c = Math.cos(phi), s = Math.sin(phi);
            re += pts[n].x * c - pts[n].y * s;
            im += pts[n].x * s + pts[n].y * c;
        }
        re /= N; im /= N;
        terms.push({ freq, re, im, amp: Math.hypot(re, im), phase: Math.atan2(im, re) });
    }
    const dc = terms.find(t => t.freq === 0);
    const rest = terms.filter(t => t.freq !== 0).sort((a, b) => b.amp - a.amp);
    return { dc, rest };
}

/** Map viewBox units → canvas CSS pixels so the viewBox fits the heading's text box ("meet"). */
function viewMapping(canvas, textEl, vb) {
    const c = canvas.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const r = range.getBoundingClientRect();
    const s = Math.min(r.width / vb.w, r.height / vb.h);
    const ox = r.left - c.left + (r.width - vb.w * s) / 2 - vb.x * s;
    const oy = r.top - c.top + (r.height - vb.h * s) / 2 - vb.y * s;
    return { s, box: r, c, map: (x, y) => [ox + x * s, oy + y * s] };
}

/**
 * Creates the drawing controller. The SVG is fetched and transformed once.
 * Returns { ready, draw({ circles }), grow(), finish(), maxCircles }.
 * draw()/grow() return a Promise that resolves when the pass is drawn ('complete') or cut short
 * ('cancelled'); the outline then fades out over settleMs and the canvas goes idle.
 * Canvas state is exposed as data-state (idle | drawing | growing | settling) and data-circles.
 */
export function createFourier({ canvas, textEl, config, onPause = () => {} }) {
    const ctx = canvas.getContext('2d');
    let data = null;           // { pts, dc, rest, N, viewBox }
    let raf = 0, last = 0;
    let anim = null;           // current animation: { mode, elapsed, duration, circles, resolve, curveN, cx, cy }
    let visible = true, paused = false;

    const setState = state => { canvas.dataset.state = state; canvas.classList.toggle('is-on', state !== 'idle'); };
    setState('idle');

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; update(); });
    io.observe(canvas);
    document.addEventListener('visibilitychange', () => update());

    function update() {
        const shouldRun = visible && !document.hidden && anim && data;
        if (shouldRun && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
        if (!shouldRun && raf) { cancelAnimationFrame(raf); raf = 0; }
        const nowPaused = !shouldRun && !!anim && !!data;
        if (nowPaused !== paused) { paused = nowPaused; onPause(paused); }
    }

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const { width, height } = canvas.getBoundingClientRect();
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', () => { if (anim) resize(); });

    const ready = (async () => {
        const { d, viewBox } = await loadPath(config.namePathUrl);
        const pts = samplePath(d, config.samples);
        const { dc, rest } = dft(pts);
        data = { pts, dc, rest, N: pts.length, viewBox };
    })();

    /** Curve made by the first n terms, at every sample index; built incrementally (n·N work). */
    function ensureCurve(a, n) {
        const { N, dc, rest } = data;
        if (!a.cx || n < a.curveN) {
            a.cx = new Float64Array(N).fill(dc.re);
            a.cy = new Float64Array(N).fill(dc.im);
            a.curveN = 0;
        }
        for (let k = a.curveN; k < n; k++) {
            const { freq, amp, phase } = rest[k];
            for (let i = 0; i < N; i++) {
                const ang = (2 * Math.PI * freq * i) / N + phase;
                a.cx[i] += amp * Math.cos(ang);
                a.cy[i] += amp * Math.sin(ang);
            }
        }
        a.curveN = n;
    }

    const color = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    function strokeCurve(a, map, upto, alpha = 1) {
        const { pts } = data;
        ctx.strokeStyle = color('--fx-trail');
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (let i = 0; i < upto; i++) {
            const [x, y] = map(a.cx[i], a.cy[i]);
            if (i > 0 && pts[i].ink && pts[i - 1].ink) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    function drawEpicycles(map, s, t, n) {
        const { dc, rest, N } = data;
        let x = dc.re, y = dc.im;
        ctx.lineWidth = 1;
        const circle = color('--fx-circle'), arm = color('--fx-arm');
        for (let i = 0; i < n; i++) {
            const term = rest[i];
            const ang = (2 * Math.PI * term.freq * t) / N + term.phase;
            const nx = x + term.amp * Math.cos(ang);
            const ny = y + term.amp * Math.sin(ang);
            const [cx, cy] = map(x, y);
            const [px, py] = map(nx, ny);
            const r = term.amp * s;
            if (r > 0.6) { // sub-pixel circles add nothing visible
                ctx.strokeStyle = circle;
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, 2 * Math.PI);
                ctx.stroke();
            }
            ctx.strokeStyle = arm;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(px, py);
            ctx.stroke();
            x = nx; y = ny;
        }
        const [tx, ty] = map(x, y);
        ctx.fillStyle = color('--fx-trail');
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, 2 * Math.PI);
        ctx.fill();
    }

    function frame(a) {
        const { N, viewBox } = data;
        const { s, box, c, map } = viewMapping(canvas, textEl, viewBox);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const p = Math.min(a.elapsed / a.duration, 1);

        if (a.mode === 'settling') {
            strokeCurve(a, map, N, 1 - p);
            return;
        }
        let n = a.circles;
        if (a.mode === 'growing') {
            // Geometric growth: early circles change the shape most, so they get more time.
            n = Math.max(1, Math.min(a.circles, Math.round(a.circles ** p)));
            canvas.dataset.circles = String(n);
            ensureCurve(a, n);
            strokeCurve(a, map, N);
            const label = `${n} circle${n === 1 ? '' : 's'}`;
            ctx.font = '600 13px ui-monospace, monospace';
            ctx.fillStyle = color('--fx-arm');
            ctx.fillText(label, box.left - c.left, box.top - c.top - 6);
            drawEpicycles(map, s, ((a.elapsed / config.drawMs) % 1) * N, n);
        } else {
            strokeCurve(a, map, Math.floor(p * N));
            if (p < 1) drawEpicycles(map, s, p * N, n);
        }
    }

    function tick(now) {
        const a = anim;
        a.elapsed += Math.min(now - last, 100); // clamp: no jump after a pause
        last = now;
        frame(a);
        if (a.elapsed >= a.duration) {
            if (a.mode === 'settling') { stop(); return; }
            a.resolve('complete');
            settle(a);
        }
        raf = requestAnimationFrame(tick);
    }

    function settle(a) {
        anim = { ...a, mode: 'settling', elapsed: 0, duration: config.settleMs, resolve: () => {} };
        ensureCurve(anim, anim.circles);
        setState('settling');
    }

    function stop() {
        cancelAnimationFrame(raf);
        raf = 0;
        anim = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setState('idle');
        update();
    }

    async function start(mode, circles, duration) {
        anim?.resolve('cancelled');
        await ready;
        const a = { mode, circles, duration, elapsed: 0, curveN: 0 };
        const done = new Promise(r => { a.resolve = r; });
        resize();
        if (mode === 'drawing') ensureCurve(a, circles);
        anim = a;
        canvas.dataset.circles = String(mode === 'growing' ? 1 : circles);
        setState(mode);
        update();
        return done;
    }

    const clamp = n => Math.max(1, Math.min(config.maxCircles, Math.round(n)));

    return {
        ready,
        maxCircles: config.maxCircles,
        clamp,
        draw: ({ circles = config.circles } = {}) => start('drawing', clamp(circles), config.drawMs),
        grow: () => start('growing', config.maxCircles, config.growMs),
        /** Cut the current pass short: no outline, the heading shows right away. */
        finish() {
            anim?.resolve('cancelled');
            if (anim) stop();
        },
    };
}
