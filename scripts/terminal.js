// Inline terminal styled like fish (agnoster prompt) in tmux in kitty: renders command
// output, keeps history, colors input like fish, shows autosuggestions, types the intro.

export function createTerminal({ root, commands, prompt, greeting = [], getNow, extraContext = {} }) {
    const output = root.querySelector('.term-output');
    const body = root.querySelector('.term-body'); // fixed-height scroll container
    const form = root.querySelector('form');
    const input = root.querySelector('input');
    const label = root.querySelector('.term-prompt');
    const ghost = root.querySelector('.term-ghost');
    const history = [];
    let historyIndex = 0;
    let introTimers = [];

    const ctx = { commands, getNow, clear: () => output.replaceChildren(), ...extraContext };
    const isCommand = word => Object.hasOwn(commands, word.toLowerCase());

    // Click anywhere in the terminal (except links) focuses the prompt.
    root.addEventListener('click', e => {
        if (!e.target.closest('a') && !window.getSelection().toString()) input.focus();
    });

    /** agnoster-style powerline prompt: [context][dir] */
    function promptNode() {
        const wrap = document.createElement('span');
        wrap.className = 'term-ps1';
        for (const [cls, text] of [['seg-ctx', prompt.context], ['seg-dir', prompt.dir]]) {
            const seg = document.createElement('span');
            seg.className = `seg ${cls}`;
            seg.textContent = text;
            wrap.append(seg);
        }
        wrap.append(' '); // real space so copied text reads "nhat@portfolio~ whoami"
        return wrap;
    }
    label.replaceChildren(promptNode());

    function renderSegment(seg) {
        if (seg instanceof Node) return seg;
        if (typeof seg === 'string') return document.createTextNode(seg);
        if (seg.href) {
            const a = document.createElement('a');
            a.href = seg.href;
            a.textContent = seg.text;
            if (!seg.href.startsWith('#') && !seg.href.startsWith('mailto:')) {
                a.target = '_blank';
                a.rel = 'noopener';
            }
            return a;
        }
        const span = document.createElement('span');
        span.className = seg.className || '';
        span.textContent = seg.text;
        return span;
    }

    function print(line, className = '') {
        const row = document.createElement('div');
        row.className = `term-row ${className}`.trim();
        (Array.isArray(line) ? line : [line]).forEach(seg => row.append(renderSegment(seg)));
        output.append(row);
        body.scrollTop = body.scrollHeight;
        return row;
    }

    /** Echo a command line with fish syntax colors: command cyan (red if unknown), args purple. */
    function echo(text) {
        const [cmd = '', ...args] = text.split(/(\s+)/).filter(Boolean);
        print([
            promptNode(),
            { text: cmd, className: isCommand(cmd) || !cmd ? 'tn-cyan' : 'tn-red' },
            { text: args.join(''), className: 'tn-purple' },
        ], 'term-echo');
    }

    function printGreeting() {
        if (greeting.length) print(greeting);
    }

    async function run(raw) {
        const text = raw.trim();
        echo(text);
        if (!text) return;
        const [first, ...args] = text.split(/\s+/);
        const name = first.toLowerCase();
        if (!isCommand(name)) {
            print(`fish: Unknown command: ${name} — type "help" to see what I understand.`, 'tn-red');
            return;
        }
        try {
            const lines = await commands[name].run(ctx, args);
            (lines || []).forEach(line => print(line));
        } catch {
            print(`${name}: something went wrong, try again.`, 'tn-red');
        }
    }

    /* fish-like input: live command coloring + grey autosuggestion accepted with → */
    function suggestion(value) {
        if (!value.trim()) return '';
        const fromHistory = [...history].reverse().find(h => h.startsWith(value) && h !== value);
        if (fromHistory) return fromHistory;
        return Object.keys(commands).find(c => !commands[c].hidden && c.startsWith(value.toLowerCase()) && c !== value) || '';
    }

    function refreshInput() {
        const value = input.value;
        const first = value.trimStart().split(/\s+/)[0];
        input.classList.toggle('is-unknown', !!first && !isCommand(first));
        const s = suggestion(value);
        const rest = s ? s.slice(value.length) : '';
        ghost.textContent = rest;
        // Monospace: the suggestion starts right after the typed characters.
        ghost.style.left = `${value.length}ch`;
        ghost.hidden = !rest || input.selectionStart !== value.length;
    }

    input.addEventListener('input', () => { historyIndex = history.length; refreshInput(); });
    input.addEventListener('keyup', refreshInput);
    input.addEventListener('blur', () => { ghost.hidden = true; });
    input.addEventListener('focus', refreshInput);

    form.addEventListener('submit', e => {
        e.preventDefault();
        const value = input.value;
        if (value.trim()) history.push(value.trim());
        historyIndex = history.length;
        input.value = '';
        refreshInput();
        run(value);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' && !ghost.hidden && input.selectionStart === input.value.length) {
            e.preventDefault();
            input.value += ghost.textContent;
            refreshInput();
            return;
        }
        if (e.key === 'ArrowUp' && historyIndex > 0) {
            historyIndex--;
        } else if (e.key === 'ArrowDown' && historyIndex < history.length) {
            historyIndex++;
        } else {
            return;
        }
        e.preventDefault();
        input.value = history[historyIndex] ?? '';
        refreshInput();
    });

    /** Final state of the intro: greeting, the command and its output, no animation. */
    function showIntroFinal(command) {
        introTimers.forEach(clearTimeout);
        introTimers = [];
        output.removeAttribute('aria-busy');
        ctx.clear();
        printGreeting();
        echo(command);
        commands[command].run(ctx, []).forEach(line => print(line));
    }

    /** Greeting, then types `command` after the prompt, then prints its output. Calls onDone when finished. */
    function typeIntro(command, { charMs, outputDelayMs }, onDone) {
        ctx.clear();
        output.setAttribute('aria-busy', 'true'); // don't read every keystroke to screen readers
        printGreeting();
        const typed = document.createElement('span');
        typed.className = 'tn-cyan';
        const caret = document.createElement('span');
        caret.className = 'term-caret';
        print([promptNode(), typed, caret], 'term-echo');

        [...command].forEach((ch, i) => {
            introTimers.push(setTimeout(() => { typed.textContent += ch; }, charMs * (i + 1)));
        });
        introTimers.push(setTimeout(() => {
            showIntroFinal(command);
            onDone();
        }, charMs * command.length + outputDelayMs));
    }

    return { run, typeIntro, showIntroFinal, input, root };
}
