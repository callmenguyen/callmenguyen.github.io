"""Static checks for the portfolio page. Run: python3 -m unittest discover tests"""
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / "index.html").read_text()
CSS = (ROOT / "styles/main.css").read_text()
JS = "\n".join(p.read_text() for p in sorted((ROOT / "scripts").glob("*.js")))


class Collector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.hrefs, self.forms, self.sources, self.poster = set(), [], 0, [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.add(a["id"])
        if tag == "a" and "href" in a:
            self.hrefs.append(a["href"])
        if tag == "form" and "google" in a.get("action", ""):
            self.forms += 1
        if tag == "source" and "src" in a:
            self.sources.append(a["src"])
        if tag == "video":
            self.poster = a.get("poster")


page = Collector()
page.feed(HTML)


class PageTests(unittest.TestCase):
    def test_search_and_news_removed(self):
        self.assertEqual(page.forms, 0)  # no Google search form
        for gone in ("searchbar", "news-panel"):
            self.assertNotIn(gone, page.ids)
        for text in (CSS, JS):
            self.assertNotRegex(text, r"searchbar|search-container|news-")

    def test_portfolio_sections_present(self):
        for sid in ("background-overlay", "hero", "about", "skills", "contact"):
            self.assertIn(sid, page.ids)

    def test_projects_removed(self):
        self.assertNotIn("projects", page.ids)
        self.assertNotIn("project-", HTML + CSS)

    def test_in_page_links_resolve(self):
        for href in page.hrefs:
            if href.startswith("#"):
                self.assertIn(href[1:], page.ids, href)

    def test_overlay_background_is_valid(self):
        block = re.search(r"#background-overlay\s*{([^}]*)}", CSS).group(1)
        bg = re.search(r"background-image:\s*([^;]+);", block).group(1)
        first_layer = bg.split(",")[0].strip()
        # A bare color in background-image invalidates the whole declaration.
        self.assertTrue(first_layer.startswith(("url(", "linear-gradient(")), first_layer)
        for img in re.findall(r'url\("\.\./([^"]+)"\)', bg):
            self.assertTrue((ROOT / img).exists(), img)

    def test_background_video_with_poster(self):
        self.assertEqual(sorted(Path(x).suffix for x in page.sources), [".mp4", ".webm"])
        for src in page.sources + [page.poster]:
            self.assertTrue((ROOT / src).exists(), src)
        self.assertIn('url("../res/minato-poster.jpg")', CSS)  # static fallback / reduced motion

    def test_name_path_is_one_svg_path_with_viewbox(self):
        svg = (ROOT / "res/name-path.svg").read_text()
        self.assertRegex(svg, r'viewBox="[-\d.]+ [-\d.]+ [\d.]+ [\d.]+"')
        self.assertEqual(svg.count("<path"), 1)

    def test_terminal_commands_in_config(self):
        config = (ROOT / "scripts/config.js").read_text()
        for cmd in ("help", "whoami", "about", "skills", "now", "contact", "clear"):
            self.assertRegex(config, rf"\n    {cmd}: {{", cmd)
        self.assertNotRegex(config, r"\n    projects: {")


if __name__ == "__main__":
    unittest.main()
