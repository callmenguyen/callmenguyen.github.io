// Ctrl/Cmd+K command palette: filter, arrow keys, Enter to run, Esc to close.

export function createPalette({ dialog, openButton, items, onSelect }) {
    const input = dialog.querySelector('input');
    const list = dialog.querySelector('[role="listbox"]');
    let matches = items;
    let active = 0;
    let returnFocus = null;

    function render() {
        const q = input.value.trim().toLowerCase();
        matches = items.filter(it => `${it.label} ${it.keywords || ''}`.toLowerCase().includes(q));
        active = Math.min(active, Math.max(matches.length - 1, 0));
        list.replaceChildren(...matches.map((it, i) => {
            const li = document.createElement('li');
            li.id = `palette-opt-${i}`;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', String(i === active));
            const icon = document.createElement('i');
            icon.className = `fas ${it.icon}`;
            icon.setAttribute('aria-hidden', 'true');
            li.append(icon, it.label);
            li.addEventListener('mousemove', () => { if (active !== i) { active = i; render(); } });
            li.addEventListener('click', () => choose(i));
            return li;
        }));
        if (!matches.length) {
            const li = document.createElement('li');
            li.className = 'palette-empty';
            li.textContent = 'No matches';
            list.append(li);
            input.removeAttribute('aria-activedescendant');
        } else {
            input.setAttribute('aria-activedescendant', `palette-opt-${active}`);
            list.children[active].scrollIntoView({ block: 'nearest' });
        }
    }

    function open() {
        if (dialog.open) return;
        returnFocus = document.activeElement;
        input.value = '';
        active = 0;
        render();
        dialog.showModal();
        input.focus();
    }

    function close(restoreFocus = true) {
        if (!dialog.open) return;
        dialog.close();
        if (restoreFocus && returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    }

    function choose(i) {
        const item = matches[i];
        if (!item) return;
        close(false);
        onSelect(item, returnFocus);
    }

    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!matches.length) return;
            active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
            render();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(active);
        }
    });
    // Esc: the native dialog closes itself; put focus back where it was.
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    // Click on the backdrop closes.
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });

    window.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            dialog.open ? close() : open();
        }
    });
    openButton.addEventListener('click', open);

    return { open, close, get isOpen() { return dialog.open; } };
}
