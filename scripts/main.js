import { INTRO, AUTO_SCROLL, GITHUB, PALETTE_ITEMS, PROMPT, GREETING, TMUX, COMMANDS } from './config.js';
import { createFourier } from './intro.js';
import { createTerminal } from './terminal.js';
import { createPalette } from './palette.js';
import { initTheme } from './theme.js';
import { initRevealFallback, initTilt } from './fx.js';
import { loadCurrentlyBuilding, renderCurrentlyBuilding } from './github.js';

const html = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = sel => document.querySelector(sel);

/* ── Navigation ─────────────────────────────────────────────── */
const burger = $('.burger');
const nav = $('.nav-links');
const navLinks = document.querySelectorAll('.nav-links li');

function setMenu(open) {
    nav.classList.toggle('nav-active', open);
    burger.classList.toggle('toggle', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    navLinks.forEach((link, index) => {
        link.style.animation = open ? `navLinkFade 0.5s ease forwards ${index / 7 + 0.3}s` : '';
    });
}
burger.addEventListener('click', () => setMenu(!nav.classList.contains('nav-active')));

function jumpTo(selector) {
    const target = document.querySelector(selector);
    if (!target) return;
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    if (target.tabIndex >= -1 && target.hasAttribute('tabindex')) target.focus({ preventScroll: true });
}

// Delegated so links printed later by the terminal work too.
document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute('href') === '#') return;
    e.preventDefault();
    jumpTo(a.getAttribute('href'));
    if (nav.classList.contains('nav-active')) setMenu(false);
});

window.addEventListener('scroll', () => {
    $('header').classList.toggle('scrolled', window.scrollY > 50);
}, { passive: true });

/* ── Background video (static poster under reduced motion) ──── */
const video = $('.bg-video');
if (!reducedMotion) {
    const play = () => video.play().catch(() => { /* autoplay blocked: poster stays */ });
    play();
    document.addEventListener('visibilitychange', () => (document.hidden ? video.pause() : play()));
}

/* ── Live "Currently building" ──────────────────────────────── */
const nowPromise = loadCurrentlyBuilding(GITHUB);
nowPromise.then(data => renderCurrentlyBuilding(data, { link: $('#now-link'), desc: $('#now-desc') }));

/* ── Theme, palette, micro-interactions ─────────────────────── */
const theme = initTheme($('#theme-toggle'), { reducedMotion });
/* ── Fourier name: drawn once on load, replayed on click or by the `fourier` command ── */
const hero = $('#hero');
const fourier = reducedMotion ? null : createFourier({
    canvas: $('#name-canvas'),
    textEl: $('#hero-name'),
    config: INTRO,
    onPause: paused => (paused ? (html.dataset.introPaused = '') : delete html.dataset.introPaused),
});
fourier?.ready.catch(err => console.warn('Fourier drawing unavailable:', err));

/** Replay: hide the heading while drawing, show it again as the outline fades.
 *  A newer replay cancels the older one; only the latest may bring the heading back. */
let replayId = 0;
async function replay(pass) {
    const id = ++replayId;
    hero.classList.add('is-redrawing');
    try {
        await pass();
    } catch (err) {
        console.warn('Fourier replay failed:', err);
    } finally {
        if (id === replayId) hero.classList.remove('is-redrawing');
    }
}
const fourierApi = fourier && {
    draw: opts => replay(() => fourier.draw(opts)),
    grow: () => replay(() => fourier.grow()),
    clamp: fourier.clamp,
    maxCircles: fourier.maxCircles,
    defaultCircles: INTRO.circles,
};
$('#name-replay').addEventListener('click', () => { if (fourierApi && introDone) fourierApi.draw(); });

const terminal = createTerminal({
    root: $('#terminal'), commands: COMMANDS, prompt: PROMPT, greeting: GREETING,
    getNow: () => nowPromise, extraContext: { fourier: fourierApi },
});

/* tmux status bar: session / window / host from config, live clock in the visitor's time */
$('#tmux-session').textContent = TMUX.session;
$('#tmux-window').textContent = TMUX.window;
$('#tmux-host').textContent = TMUX.host;
function tickClock() {
    const d = new Date();
    const date = d.toLocaleDateString('en-CA'); // YYYY-MM-DD, like tmux %Y-%m-%d
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: !TMUX.clock24h });
    $('#tmux-clock').textContent = `${date}  ${time}`;
}
tickClock();
setInterval(tickClock, 15_000);

const palette = createPalette({
    dialog: $('#palette'),
    openButton: $('#palette-btn'),
    items: PALETTE_ITEMS,
    onSelect(item, returnFocus) {
        if (item.target) {
            jumpTo(item.target);
        } else if (item.action === 'terminal') {
            jumpTo('#hero');
            terminal.input.focus({ preventScroll: true });
        } else if (item.action === 'theme') {
            theme.toggle();
            returnFocus?.focus({ preventScroll: true });
        }
    },
});

initRevealFallback({ reducedMotion });

/* Left-pane section nav: mark the section currently in view */
const sectionLinks = [...document.querySelectorAll('.section-nav a')];
const spy = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        sectionLinks.forEach(a => (a.getAttribute('href') === `#${entry.target.id}`
            ? a.setAttribute('aria-current', 'true')
            : a.removeAttribute('aria-current')));
    });
}, { rootMargin: '-45% 0px -50% 0px' });
sectionLinks.forEach(a => { const el = document.querySelector(a.getAttribute('href')); if (el) spy.observe(el); });
initTilt(document.querySelectorAll('.skill-group'), { reducedMotion });

/* ── Intro: Fourier name → heading → terminal types `whoami` ── */
const SKIP_EVENTS = ['pointerdown', 'wheel', 'touchstart', 'keydown'];
let introDone = false;

function finishIntro() {
    if (introDone) return;
    introDone = true;
    fourier?.finish(); // cut the first drawing short: heading shows right away
    SKIP_EVENTS.forEach(evt => window.removeEventListener(evt, finishIntro, true));
    terminal.showIntroFinal(INTRO.command);
    if (html.dataset.intro) html.dataset.intro = 'done';
    startAutoScroll();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function playIntro() {
    if (!fourier) return finishIntro(); // reduced motion: static heading, no canvas
    // Deep link to a section (e.g. /#skills): go straight there.
    if (html.dataset.intro === 'done' || location.hash.length > 1) return finishIntro();
    // A reload would otherwise restore the old scroll position, leaving the drawing off-screen (paused).
    history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    SKIP_EVENTS.forEach(evt => window.addEventListener(evt, finishIntro, { capture: true, passive: true }));
    await document.fonts.ready; // measure the heading with its real font
    if (introDone) return;

    html.dataset.intro = 'drawing';
    const result = await fourier.draw().catch(() => 'error');
    if (introDone) return;
    if (result !== 'complete') return finishIntro();

    html.dataset.intro = 'settling';
    await sleep(INTRO.settleMs);
    if (introDone) return;

    html.dataset.intro = 'typing';
    terminal.typeIntro(INTRO.command, { charMs: INTRO.typeCharMs, outputDelayMs: INTRO.outputDelayMs }, finishIntro);
}
playIntro();

/* ── Auto-scroll after idle (never under reduced motion) ────── */
function startAutoScroll() {
    if (reducedMotion) return;
    let frame = null;
    let idleTimer = null;

    const stop = () => { cancelAnimationFrame(frame); frame = null; };
    // Don't move the page while someone is typing in the terminal or using the palette.
    const busy = () => palette.isOpen || terminal.root.contains(document.activeElement);

    function run() {
        if (busy()) return resetIdle();
        let pos = window.scrollY;
        let last = performance.now();
        const step = () => {
            const now = performance.now();
            const maxY = document.documentElement.scrollHeight - window.innerHeight;
            pos += Math.min(now - last, 100) / 1000 * AUTO_SCROLL.speed;
            last = now;
            if (pos >= maxY) {
                window.scrollTo(0, maxY);
                stop();
                return;
            }
            window.scrollTo(0, pos);
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
    }

    function resetIdle() {
        stop();
        clearTimeout(idleTimer);
        idleTimer = setTimeout(run, AUTO_SCROLL.idleMs);
    }

    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(evt =>
        window.addEventListener(evt, resetIdle, { passive: true })
    );
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetIdle(); });
    resetIdle();
}
