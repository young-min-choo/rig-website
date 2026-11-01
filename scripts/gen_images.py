#!/usr/bin/env python3
"""Generate the RIG site imagery locally (ComfyUI + MOSS Image, Apache-2.0).

Brief rules (Luqman, 2026-11): Japan, light, texture, calm. Tokyo at dusk,
serene Japanese interiors, soft light through shoji. NO needles, labs, people
in white coats, or clinical stock imagery. No text, no watermarks.
(Replaces the v1 pollinations.ai script, whose lab/cell images break the brief.)

Needs the local ComfyUI server with MOSS nodes on 127.0.0.1:8266 (see the moss-image-pipeline skill for
the launch line; the cudnn LD_LIBRARY_PATH fix is required). Z-Image Turbo was tried first and
rendered soft, grainy near-abstract frames — not usable for this brand.
Writes candidates to $OUT (default ~/.hermes/cache/scratch/rig-img/<name>-<seed>.png);
pick one per slot and export it to assets/img/<name>.jpg (see README).

  python3 scripts/gen_images.py [name ...]
"""
import json, os, shutil, sys, time, urllib.request

H = os.environ.get("COMFY", "http://127.0.0.1:8266")
OUT = os.environ.get("OUT", os.path.expanduser("~/.hermes/cache/scratch/rig-img"))
STYLE = ("professional architectural photograph, sharp focus, crisp detail, calm, quiet luxury, "
         "soft natural light, muted deep navy and warm ivory tones with a hint of champagne gold, "
         "editorial, magazine quality, no people, no text, no logo")

IMAGES = {  # name: (subject, width, height, seeds)
    "hero": ("Tokyo skyline at dusk seen from a quiet high-floor window, blue hour, clear evening air, "
             "detailed skyscrapers with city lights beginning to glow, Mount Fuji faint on the horizon", 1344, 768, [11, 23]),
    "shoji": ("soft morning light falling through shoji paper screens into a serene minimal Japanese "
              "room, tatami floor, a single ceramic vase, long gentle shadows", 896, 1120, [5, 17]),
    "washi": ("close-up of handmade washi paper texture with the soft shadow of a maple branch, "
              "warm ivory light, abstract and tranquil", 896, 1120, [3, 29]),
    "garden": ("a quiet Japanese stone garden at twilight, raked gravel, moss, a single stone lantern "
               "softly lit, serene", 1344, 768, [7, 31]),
}


def gen(prompt, w, h, seed, dst):
    graph = {  # canonical MOSS graph (SLG on single layer 22, er_sde 25 steps cfg 2.5)
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "moss_image_sft_int8_convrot.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3.5_9b_w4a8_gptq.safetensors", "type": "moss_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae-moss.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["2", 0]}},
        "6": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "15": {"class_type": "SkipLayerGuidanceDiTSimple", "inputs": {"model": ["1", 0], "double_layers": "", "single_layers": "22",
                                                                     "start_percent": 0.0, "end_percent": 0.5}},
        "7": {"class_type": "KSampler", "inputs": {"model": ["15", 0], "positive": ["4", 0], "negative": ["5", 0],
                                                   "latent_image": ["6", 0], "seed": seed, "steps": 25, "cfg": 2.5,
                                                   "sampler_name": "er_sde", "scheduler": "simple", "denoise": 1.0}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "rig_site"}},
    }
    req = urllib.request.Request(H + "/prompt", data=json.dumps({"prompt": graph, "client_id": "rig_site"}).encode(),
                                 headers={"Content-Type": "application/json"})
    pid = json.load(urllib.request.urlopen(req, timeout=60))["prompt_id"]
    t0 = time.time()
    while time.time() - t0 < 900:
        time.sleep(2)
        hist = json.load(urllib.request.urlopen(f"{H}/history/{pid}", timeout=30))
        if pid not in hist:
            continue
        st = hist[pid]["status"]
        if st.get("status_str") == "error":
            raise RuntimeError(json.dumps(st)[:800])
        if st.get("completed"):
            for out in hist[pid]["outputs"].values():
                for im in out.get("images", []):
                    src = im.get("fullpath") or os.path.join("/mnt/ssd/ai-models/comfyui/output", im.get("subfolder", ""), im["filename"])
                    shutil.copy(src, dst)
                    return time.time() - t0
            raise RuntimeError("completed without image")
    raise TimeoutError(pid)


def main():
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(IMAGES)
    for name in names:
        subject, w, h, seeds = IMAGES[name]
        for seed in seeds:
            dst = os.path.join(OUT, f"{name}-{seed}.png")
            if os.path.exists(dst):
                print("skip", dst); continue
            t = gen(f"{subject}. {STYLE}", w, h, seed, dst)
            print(f"{name} seed {seed}: {t:.0f}s -> {dst}", flush=True)


if __name__ == "__main__":
    main()
