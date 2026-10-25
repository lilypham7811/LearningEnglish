"""Article text for articles saved by link only (run by GitHub Actions in the sync repo).

On a phone, Safari's Share menu (and a pasted link) gives the app only the link, and the app can't read other
websites itself. The app lists those links in voice.json ("articles"); this script downloads each page,
keeps the article text (trafilatura) and writes it to articles.json, which the app reads into "Bài báo".
A page with no article text (a video page, a page that refuses robots) is written too, empty, so it isn't
tried again; the app then keeps its "paste the text" box.

Run from the sync repo's folder:  python make_articles.py
"""
import html, ipaddress, json, os, re, subprocess, time, urllib.parse, urllib.request

import trafilatura


VERSION = 2  # raise when the reader gets better: pages it couldn't read before are tried again


def public_link(url):
    """http(s) links to websites only: never this machine or a private network."""
    try:
        u = urllib.parse.urlparse(url)
        host = (u.hostname or "").lower()
        if u.scheme not in ("http", "https") or not host or host == "localhost" or "." not in host:
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return True  # a name, not a number
    except Exception:
        return False


def msn(url):
    """MSN pages build the article with scripts after loading; its content service has the text."""
    m = re.search(r"msn\.com/([a-z]{2}-[a-z]{2})/.*/ar-([A-Za-z0-9]+)", url)
    if not m:
        return None
    req = urllib.request.Request(f"https://assets.msn.com/content/view/v2/Detail/{m.group(1)}/{m.group(2)}", headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        d = json.loads(r.read().decode("utf-8"))
    body = re.sub(r"</p>|<br\s*/?>|</h[1-6]>", "\n\n", d.get("body") or "")
    text = re.sub(r"\n{3,}", "\n\n", html.unescape(re.sub(r"<[^>]+>", "", body))).strip()
    return {"title": d.get("title") or "", "site": (d.get("provider") or {}).get("name") or "MSN",
            "text": text[:40000], "at": int(time.time() * 1000), "v": VERSION}


def article(url):
    if "msn.com/" in url:
        found = msn(url)
        if found and len(found["text"]) >= 400:
            return found
    html = trafilatura.fetch_url(url)
    doc = trafilatura.bare_extraction(html, with_metadata=True) if html else None
    text = ((doc.text if doc else "") or "").strip()
    if len(text) < 400:  # a description or a cookie notice, not an article
        text = ""
    return {"title": (doc.title if doc else "") or "", "site": (doc.sitename if doc else "") or "",
            "text": text[:40000], "at": int(time.time() * 1000), "v": VERSION}


def main():
    if not os.path.exists("voice.json"):
        return
    wanted = json.load(open("voice.json", encoding="utf-8")).get("articles", [])
    data = json.load(open("articles.json", encoding="utf-8")) if os.path.exists("articles.json") else {}
    todo = [u for u in dict.fromkeys(str(x).strip() for x in wanted)
            if public_link(u) and (u not in data or (not data[u].get("text") and data[u].get("v", 1) < VERSION))][:50]
    print(f"{len(todo)} articles to fetch")
    if not todo:
        return
    for u in todo:
        try:
            data[u] = article(u)
        except Exception as err:
            print("could not read one page:", type(err).__name__)
            data[u] = {"title": "", "site": "", "text": "", "at": int(time.time() * 1000), "v": VERSION}
        time.sleep(1)
    with open("articles.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=0, sort_keys=True)
    subprocess.run(["git", "add", "articles.json"], check=True)
    subprocess.run(["git", "commit", "-q", "-m", f"Article text: {len(todo)} links"], check=True)
    for attempt in range(5):
        if subprocess.run(["git", "push", "-q"]).returncode == 0:
            return
        time.sleep(3 + attempt * 3)
        subprocess.run(["git", "pull", "-q", "--rebase"], check=True)


if __name__ == "__main__":
    main()
