// Micro-interactions: scroll-reveal fallback and Skills card tilt + glow.

/** Only needed where CSS scroll-driven animations (animation-timeline: view()) are unsupported. */
export function initRevealFallback({ reducedMotion }) {
    if (reducedMotion || CSS.supports('animation-timeline: view()')) return;
    const els = document.querySelectorAll('[data-reveal]');
    if (!('IntersectionObserver' in window)) {
        els.forEach(el => el.classList.add('is-visible'));
        return;
    }
    const io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -10% 0px' });
    els.forEach(el => io.observe(el));
}

const MAX_TILT_DEG = 6;

/** Desktop only: tilt toward the cursor and move a soft glow under it. */
export function initTilt(cards, { reducedMotion }) {
    if (reducedMotion || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    cards.forEach(card => {
        card.addEventListener('pointermove', e => {
            const r = card.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width;
            const py = (e.clientY - r.top) / r.height;
            card.style.setProperty('--ry', `${((px - 0.5) * 2 * MAX_TILT_DEG).toFixed(2)}deg`);
            card.style.setProperty('--rx', `${((0.5 - py) * 2 * MAX_TILT_DEG).toFixed(2)}deg`);
            card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
            card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
        });
        card.addEventListener('pointerleave', () => {
            ['--rx', '--ry', '--mx', '--my'].forEach(p => card.style.removeProperty(p));
        });
    });
}
