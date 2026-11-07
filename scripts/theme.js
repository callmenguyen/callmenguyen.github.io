// Dark/light theme with a circular reveal from the click point (View Transitions API).

const html = document.documentElement;
const REVEAL_MS = 550;

function current() {
    return html.dataset.theme === 'light' ? 'light' : 'dark';
}

function apply(theme, button) {
    html.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* private mode: not remembered */ }
    const next = theme === 'light' ? 'dark' : 'light';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.querySelector('i').className = `fas ${theme === 'light' ? 'fa-moon' : 'fa-sun'}`;
}

export function initTheme(button, { reducedMotion }) {
    apply(current(), button);

    function toggle(x = innerWidth / 2, y = innerHeight / 2) {
        const next = current() === 'light' ? 'dark' : 'light';
        if (!document.startViewTransition || reducedMotion) {
            apply(next, button);
            return;
        }
        const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        const transition = document.startViewTransition(() => apply(next, button));
        transition.ready.then(() => {
            html.animate(
                { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
                { duration: REVEAL_MS, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' },
            );
        }).catch(() => {});
    }

    button.addEventListener('click', e => {
        // Keyboard activation has no pointer position: reveal from the button itself.
        if (e.detail === 0) {
            const r = button.getBoundingClientRect();
            toggle(r.left + r.width / 2, r.top + r.height / 2);
        } else {
            toggle(e.clientX, e.clientY);
        }
    });

    return { toggle };
}
