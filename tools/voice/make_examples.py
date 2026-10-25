"""Example sentences from the learner's dictionaries, for the word list (run by GitHub Actions in the sync repo).

The app lists in voice.json the words that have no dictionary examples yet ("words"). This script reads each
word's page on Cambridge Dictionary and Oxford Learner's Dictionaries (pages a browser app can't read itself),
keeps the short, whole example sentences (Cambridge first: they sound more like everyday speech) and writes
them to examples.json, which the app reads and puts in the word list. A word with no examples is written
too (empty), so it isn't looked up again.

Run from the sync repo's folder:  python make_examples.py
"""
import json, os, re, subprocess, time, urllib.parse, urllib.request

from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
WORD_RE = re.compile(r"^[a-z][a-z' -]{0,40}$")


def page(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return BeautifulSoup(r.read().decode("utf-8", "replace"), "html.parser")


def text(x):
    return re.sub(r"\s+", " ", x.get_text()).strip()


def cambridge(word):
    s = page("https://dictionary.cambridge.org/dictionary/english/" + urllib.parse.quote(word.replace(" ", "-")))
    first = s.select_one("div.pr.dictionary") or s  # the learner's dictionary, not the American/business ones
    return [text(x) for x in first.select("div.examp span.eg")] + [text(x) for x in first.select("li.eg.dexamp")]


def oxford(word):
    s = page("https://www.oxfordlearnersdictionaries.com/search/english/direct/?q=" + urllib.parse.quote_plus(word))
    return [text(x) for x in s.select("ul.examples li span.x")] + [text(x) for x in s.select("span.unx")]


def good(sentence, word):
    """A whole, short sentence that uses the word (or a form of it): no 'efforts/behaviour' fragments."""
    n = len(sentence.split())
    stem = word.lower()[: max(4, len(word) - 3)]
    return (4 <= n <= 18 and sentence[0].isupper() and sentence[-1] in ".?!" and "/" not in sentence
            and "…" not in sentence and stem in sentence.lower())


def examples(word):
    out, src, seen = [], [], set()
    for name, get in (("Cambridge", cambridge), ("Oxford", oxford)):
        try:
            found = get(word)
        except Exception as err:
            print(f"{name}: {type(err).__name__}")
            found = []
        for x in found:
            key = re.sub(r"[^a-z]", "", x.lower())
            if good(x, word) and key not in seen:
                seen.add(key)
                out.append(x)
                src.append(name)
        time.sleep(1)  # be gentle with the dictionaries
    # Keep at most two from one dictionary when the other has some, so both are represented.
    picked, count = [], {}
    for x, s in zip(out, src):
        others = any(t != s for t in src)
        if count.get(s, 0) < (2 if others else 3):
            picked.append((x, s))
            count[s] = count.get(s, 0) + 1
    picked = picked[:3]
    return {"ex": [x for x, _ in picked], "src": [s for _, s in picked], "at": int(time.time() * 1000)}


def main():
    if not os.path.exists("voice.json"):
        return
    wanted = json.load(open("voice.json", encoding="utf-8")).get("words", [])
    data = json.load(open("examples.json", encoding="utf-8")) if os.path.exists("examples.json") else {}
    todo = [w for w in dict.fromkeys(str(x).strip().lower() for x in wanted) if WORD_RE.match(w) and w not in data][:300]
    print(f"{len(todo)} words to look up")
    if not todo:
        return
    for i, w in enumerate(todo):
        data[w] = examples(w)
        if (i + 1) % 25 == 0 or i + 1 == len(todo):
            with open("examples.json", "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=0, sort_keys=True)
            subprocess.run(["git", "add", "examples.json"], check=True)
            subprocess.run(["git", "commit", "-q", "-m", f"Dictionary examples: {i + 1} words"], check=True)
            for attempt in range(5):
                if subprocess.run(["git", "push", "-q"]).returncode == 0:
                    break
                time.sleep(3 + attempt * 3)
                subprocess.run(["git", "pull", "-q", "--rebase"], check=True)


if __name__ == "__main__":
    main()
