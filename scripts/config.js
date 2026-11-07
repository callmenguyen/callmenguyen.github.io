// ── Everything tweakable lives here. Colors are CSS tokens in styles/main.css (:root). ──

/** Hero: on load the Fourier epicycles draw the name once, hand off to the heading, then the
 *  terminal types `whoami`. Nothing loops; click the name or run `fourier` to replay. */
export const INTRO = {
    namePathUrl: 'res/name-path.svg', // swap this file to draw something else (one <path>, viewBox = text line box)
    circles: 180,          // circles for the load drawing (enough for a crisp name)
    maxCircles: 300,       // upper limit for `fourier <n>` and the end point of `fourier --grow`
    drawMs: 4500,          // one drawing pass
    growMs: 7000,          // `fourier --grow`: 1 → maxCircles
    settleMs: 600,         // outline fades out as the real heading fades in
    typeCharMs: 45,        // terminal typing speed per character
    outputDelayMs: 120,    // pause between the typed command and its output
    samples: 640,          // points sampled along the path (must stay above maxCircles)
    command: 'whoami',     // command auto-typed in the terminal
};

/** Auto-scroll after the page has been idle. */
export const AUTO_SCROLL = {
    idleMs: 4000,
    speed: 60, // px per second
};

/** "Currently building" line and the `now` command. */
export const GITHUB = {
    user: 'callmenguyen',
    cacheMinutes: 60, // sessionStorage cache, keeps us far below the 60 req/h unauthenticated limit
    fallback: {
        name: 'practical AI systems',
        url: 'https://github.com/callmenguyen',
        description: 'LLM agents, RAG and model serving',
    },
};

/** Ctrl/Cmd+K palette. `target` = element to jump to; `action` = 'terminal' | 'theme'. */
export const PALETTE_ITEMS = [
    { label: 'Home', target: '#hero', icon: 'fa-house', keywords: 'top start hero' },
    { label: 'About', target: '#about', icon: 'fa-user', keywords: 'bio me' },
    { label: 'Skills', target: '#skills', icon: 'fa-layer-group', keywords: 'stack tools tech' },
    { label: 'Contact', target: '#contact', icon: 'fa-envelope', keywords: 'email github facebook' },
    { label: 'Open terminal', action: 'terminal', icon: 'fa-terminal', keywords: 'shell command cli' },
    { label: 'Toggle light / dark theme', action: 'theme', icon: 'fa-circle-half-stroke', keywords: 'mode color dark light' },
];

/** Terminal look: fish (agnoster prompt) inside tmux inside kitty, Tokyo Night colors (see .terminal in main.css). */
export const PROMPT = { context: 'nhat@portfolio', dir: '~' };

/** Same as ~/.config/fish/functions/fish_greeting.fish. Segment classes map to Tokyo Night colors. */
export const GREETING = [
    { text: 'Victory belongs ', className: 'tn-red tn-bold' },
    { text: 'to the most ', className: 'tn-fg' },
    { text: 'preserving!', className: 'tn-cyan' },
];

/** tmux status bar at the bottom of the terminal. The clock shows the visitor's local time. */
export const TMUX = { session: 'nhat', window: '1 fish', host: 'portfolio', clock24h: false };

const WHOAMI = 'Nhat Nguyen — AI-focused software engineer building practical AI systems on solid backends.';

/**
 * Terminal commands. Each command: { description, hidden?, run(ctx) }.
 * run() returns lines (or a Promise of lines). A line is a string, or an array of
 * segments: string | { text, href } | { text, className }.
 * ctx: { commands, clear(), getNow(), fourier }; args: the words after the command name.
 * `usage: [[form, description], …]` lists several forms in `help` (see `fourier`).
 * `hidden: true` keeps a command out of `help` — handy for easter eggs, e.g.
 *   projects: { description: 'things I built', run: () => [['PBL5 → ', { text: 'repo', href: '…' }]] },
 */
export const COMMANDS = {
    help: {
        description: 'list available commands',
        run: ({ commands }) => [
            'Available commands:',
            ...Object.entries(commands)
                .filter(([, c]) => !c.hidden)
                .flatMap(([name, c]) => c.usage || [[name, c.description]])
                .map(([usage, description]) => [{ text: `  ${usage.padEnd(16)}`, className: 'tn-cyan' }, { text: description, className: 'tn-muted' }]),
        ],
    },
    whoami: {
        description: 'who I am, in one line',
        run: () => [WHOAMI],
    },
    about: {
        description: 'a bit more about me',
        run: () => [
            'AI-focused software engineer: LLM systems, agents (RAG, ReAct, MCP),',
            'fine-tuning, quantization and local model serving (llama.cpp, vLLM).',
            'Research interests: Energy-Based Models and Diffusion Models.',
            'Also into math and quantum computing.',
            [{ text: '→ About section', href: '#about' }],
        ],
    },
    skills: {
        description: 'my stack, by area',
        // Read from the Skills section so the page stays the single source of truth.
        run: () => [
            ...[...document.querySelectorAll('#skills .skill-group')].map(group => [
                { text: `${group.querySelector('h3').textContent.trim()}: `, className: 'tn-blue' },
                [...group.querySelectorAll('li')].map(li => li.textContent).join(', '),
            ]),
            [{ text: '→ Skills section', href: '#skills' }],
        ],
    },
    now: {
        description: 'what I am building right now',
        run: async ({ getNow }) => {
            const now = await getNow();
            return [[
                'Currently building: ',
                { text: now.name, href: now.url },
                now.description ? ` — ${now.description}` : '',
                now.live ? '' : { text: ' (offline fallback)', className: 'tn-muted' },
            ]];
        },
    },
    contact: {
        description: 'how to reach me',
        run: () => [
            ['Email:    ', { text: 'nhatnguyen.blitz@gmail.com', href: 'mailto:nhatnguyen.blitz@gmail.com' }],
            ['GitHub:   ', { text: 'github.com/callmenguyen', href: 'https://github.com/callmenguyen' }],
            ['Facebook: ', { text: 'fb.com/call.me.nnguyen', href: 'https://fb.com/call.me.nnguyen' }],
        ],
    },
    fourier: {
        description: 'replay the name drawing',
        usage: [
            ['fourier', 'replay the name drawing'],
            ['fourier <n>', 'replay with n circles (1–300)'],
            ['fourier --grow', 'add circles one by one, 1 → 300'],
        ],
        run: ({ fourier }, args) => {
            if (!fourier) return [{ text: 'fourier: animations are off (prefers-reduced-motion).', className: 'tn-muted' }];
            const [arg] = args;
            if (arg === undefined) {
                fourier.draw();
                return [`Redrawing the name with ${fourier.defaultCircles} circles…`];
            }
            if (arg === '--grow') {
                fourier.grow();
                return [`Growing from 1 to ${fourier.maxCircles} circles…`];
            }
            const n = Number(arg);
            if (!Number.isFinite(n) || args.length > 1) {
                return [{ text: 'usage: fourier [n | --grow]   (n = 1–300)', className: 'tn-red' }];
            }
            const used = fourier.clamp(n);
            fourier.draw({ circles: used });
            return [`Redrawing the name with ${used} circle${used === 1 ? '' : 's'}…${used !== n ? ` (clamped from ${arg})` : ''}`];
        },
    },
    clear: {
        description: 'clear the terminal',
        run: ({ clear }) => { clear(); return []; },
    },
};
