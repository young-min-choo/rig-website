#!/usr/bin/env python3
# Generate AI images for the RIG website via pollinations.ai (Flux).
# Regenerate anytime:  python3 scripts/gen_images.py
import os, time, json, urllib.parse, urllib.request

OUT = os.path.expanduser("~/dev/rig-website/assets/img")
TEAM = os.path.expanduser("~/dev/rig-website/assets/team")
os.makedirs(OUT, exist_ok=True)
os.makedirs(TEAM, exist_ok=True)
open(os.path.join(TEAM, ".gitkeep"), "w").close()

IMAGES = {
    "hero.jpg": ("photorealistic modern regenerative medicine laboratory, scientist in white coat working with stem cell cultures under a microscope, clean premium biotech facility, deep navy and teal ambient lighting, cinematic, high detail, professional photography", 1280, 880, 7),
    "network.jpg": ("elegant abstract visualization of a global network over Asia, glowing teal connection lines and nodes linking Japan and Malaysia on a dark navy world map, premium, minimal, professional", 1280, 800, 11),
    "cells.jpg": ("stem cells under a microscope, macro scientific photography, soft teal and cyan fluorescence on a dark background, beautiful, high detail", 1200, 900, 3),
    "hospital.jpg": ("modern hospital building with glass facade at dusk, architectural photography, calm blue hour tones, clean and professional", 1200, 800, 21),
}

results = {}
for name, (prompt, w, h, seed) in IMAGES.items():
    url = "https://image.pollinations.ai/prompt/" + urllib.parse.quote(prompt) + f"?width={w}&height={h}&nologo=true&model=flux&seed={seed}"
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=240) as r:
                data = r.read()
            if len(data) > 20000:
                with open(os.path.join(OUT, name), "wb") as f:
                    f.write(data)
                results[name] = len(data)
                break
        except Exception as e:
            results[name] = f"attempt{attempt+1}: {e}"
            time.sleep(5)
    print(name, "->", results.get(name), flush=True)

print("DONE", json.dumps(results))