// "Currently building": latest updated public repo from the GitHub API, with a static fallback.

const CACHE_KEY = 'currently-building';

export async function loadCurrentlyBuilding({ user, cacheMinutes, fallback }) {
    try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
        if (cached && Date.now() - cached.at < cacheMinutes * 60_000) return cached.data;
    } catch { /* storage unavailable: just fetch */ }

    try {
        const res = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}/repos?sort=updated&per_page=20`, {
            headers: { Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`GitHub API ${res.status}`); // 403/429 = rate-limited
        const repos = await res.json();
        // Skip forks, archived repos and the profile README repo (named after the user).
        const repo = repos.find(r => !r.fork && !r.archived && r.name.toLowerCase() !== user.toLowerCase());
        if (!repo) throw new Error('no eligible repo');
        const data = { name: repo.name, url: repo.html_url, description: repo.description || '', live: true };
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
        return data;
    } catch {
        return { ...fallback, live: false };
    }
}

export function renderCurrentlyBuilding(data, { link, desc }) {
    link.textContent = data.name;
    link.href = data.url;
    desc.textContent = data.description ? ` — ${data.description}` : '';
}
