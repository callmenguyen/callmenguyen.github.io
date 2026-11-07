# Nhat Nguyen — portfolio

**AI-focused Software Engineer**: building practical AI systems with strong backend foundations,
while exploring methods to advance model capability and reasoning.

**[🌐 callmenguyen.github.io](https://callmenguyen.github.io)** · [GitHub](https://github.com/callmenguyen)

A static site for GitHub Pages: plain HTML, CSS and JavaScript modules, with no build step and no dependencies.

## What's on the page

- **Fourier name**: on load, epicycles draw "Nhat Nguyen" once, then hand off to the heading. Click the name to replay it.
- **Terminal** styled like kitty + tmux + fish in Tokyo Night. Commands: `help`, `whoami`, `about`, `skills`, `now`, `contact`, `fourier [n | --grow]`, `clear`.
- **Two panes on desktop**: name, terminal and section nav on the left; About and Skills scroll on the right.
- `Ctrl`/`Cmd` + `K` command palette, dark/light theme, scroll-in animations, and a "Currently building" line from the GitHub API.
- Respects `prefers-reduced-motion`; works with keyboard and screen readers.

## Run locally

ES modules need a web server (opening `index.html` as a file won't work):

```sh
python3 -m http.server 8000
# then open http://127.0.0.1:8000
```

## Tests

```sh
python3 -m unittest discover tests   # static checks
node tests/browser_check.mjs         # real-browser checks (Node 22+, Chromium); add --shots <dir> for screenshots
```

## Where to change things

| What | Where |
| --- | --- |
| Terminal commands, intro timing, Fourier circles, palette items, GitHub user | `scripts/config.js` |
| Colors for both themes, terminal glass | top of `styles/main.css` |
| The drawn name | `res/name-path.svg` (one `<path>`; viewBox = the heading's line box) |

## Contact

- **Email:** [nhatnguyen.blitz@gmail.com](mailto:nhatnguyen.blitz@gmail.com)
- **GitHub:** [github.com/callmenguyen](https://github.com/callmenguyen)
- **Facebook:** [fb.com/call.me.nnguyen](https://fb.com/call.me.nnguyen)

MIT License © 2024–2026 Nhat Nguyen
