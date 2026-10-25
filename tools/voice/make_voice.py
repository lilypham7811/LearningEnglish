"""AI voice for the phone, made by GitHub Actions in the private sync repo (shadow-english-sync).

The app writes voice.json there: the chosen voices and every sentence that needs audio (word examples,
dialog lines, speech sentences), each with the file name the app will look for. This script reads it,
makes the missing files with Kokoro (open model, Apache-2.0, the same voice as "Giọng AI tự nhiên" on the
computer) and commits them under audio/<voice>/. It commits every few dozen files, so the phone gets
the first sentences within minutes even when there are hundreds to make.

Run from the sync repo's folder:  python make_voice.py <folder with kokoro-v1.0.onnx and voices-v1.0.bin>
"""
import json, os, re, shutil, subprocess, sys, time

import lameenc
import numpy as np
from kokoro_onnx import Kokoro

FILE_RE = re.compile(r"^audio/[a-z]{2}_[a-z]+/[0-9a-z]{6,24}\.mp3$")  # nothing outside audio/, no "..": checked
BATCH_FILES, BATCH_SECONDS = 40, 120


def git(*args):
    subprocess.run(["git", *args], check=True)


def publish(n):
    """Commit the new files and push; another device may have pushed meanwhile, so rebase and retry."""
    git("add", "-A", "audio")
    if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode == 0:
        return
    git("commit", "-q", "-m", f"AI voice: {n} sentences")
    for attempt in range(5):
        if subprocess.run(["git", "push", "-q"]).returncode == 0:
            return
        time.sleep(3 + attempt * 3)
        git("pull", "-q", "--rebase")
    raise SystemExit("push failed")


def voices_changed(voices):
    """The learner chose other voices since this run started: stop, the next run makes those."""
    if subprocess.run(["git", "fetch", "-q"]).returncode != 0:
        return False
    shown = subprocess.run(["git", "show", "origin/main:voice.json"], capture_output=True)
    try:
        now = json.loads(shown.stdout.decode("utf-8"))
        return {x.get("v") for x in now.get("items", [])} != voices
    except Exception:
        return False


def mp3(samples, rate):
    enc = lameenc.Encoder()
    enc.set_bit_rate(64)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes()
    return enc.encode(pcm) + enc.flush()


def main():
    models = sys.argv[1]
    if not os.path.exists("voice.json"):
        print("no voice.json yet: the app writes it after its next sync")
        return
    spec = json.load(open("voice.json", encoding="utf-8"))
    items, seen = [], set()
    for x in spec.get("items", []):
        f, v, t = x.get("f", ""), x.get("v", ""), (x.get("t") or "").strip()
        if FILE_RE.match(f) and f.split("/")[1] == v and t and len(t) <= 600 and f not in seen:
            seen.add(f)
            items.append((f, v, t))
    voices = {v for _, v, _ in items}
    # The checkout is the commit that started this run; files made by an earlier run may have come after it.
    subprocess.run(["git", "pull", "-q", "--rebase"])

    # Voices no longer chosen: remove their folders (they stay in the history, and come back if chosen again).
    removed = 0
    if os.path.isdir("audio"):
        for d in os.listdir("audio"):
            if d not in voices and os.path.isdir(os.path.join("audio", d)):
                shutil.rmtree(os.path.join("audio", d))
                removed += 1
    todo = [x for x in items if not os.path.exists(x[0])]
    print(f"{len(items)} sentences, {len(todo)} to make, {removed} old voice folders removed")
    if not todo:
        if removed:
            publish(0)
        return

    tts = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
    known = set(tts.get_voices())
    made, since, last = 0, 0, time.time()
    for f, v, t in todo:
        if v not in known:
            continue
        try:
            samples, rate = tts.create(t, voice=v, speed=1.0, lang="en-gb" if v.startswith("b") else "en-us")
        except Exception as err:  # one odd sentence must not stop the rest
            print("skipped one sentence:", type(err).__name__)
            continue
        os.makedirs(os.path.dirname(f), exist_ok=True)
        with open(f, "wb") as out:
            out.write(mp3(samples, rate))
        made += 1
        since += 1
        if since >= BATCH_FILES or time.time() - last > BATCH_SECONDS:
            publish(since)
            since, last = 0, time.time()
            if voices_changed(voices):
                print("voices changed: stopping")
                return
    publish(since)
    print(f"made {made}")


if __name__ == "__main__":
    main()
