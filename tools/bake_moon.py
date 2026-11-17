"""Bake the Violet Moon into one colour map.

The Moon used to be shaded live: the photograph run through the violet palette, the LOLA relief read
five times per pixel, procedural craters and grit. That cost too much on modest GPUs, so it is done
once here instead. The result is a single sRGB map, public/textures/moon-violet-1k.webp, that already
holds the palette, the relief (lit from a fixed key in the upper left), the cavities and the rims.
The page only adds the eclipse light, the rim and the tone curve.

    python3 tools/bake_moon.py

Sources (not published): assets-src/moon/moon-1k.webp (Clementine photo) and
assets-src/moon/moon-relief-1k.webp (LOLA heights, tanh-compressed).
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TEX = ROOT / "public" / "textures"
SRC = ROOT / "assets-src" / "moon"

NIGHT = (0.071, 0.031, 0.122)
DEEP = (0.176, 0.086, 0.314)
PURPLE = (0.388, 0.184, 0.6)
SOFT = (0.643, 0.416, 0.839)
LAVENDER = (0.812, 0.682, 0.941)
LILAC = (0.941, 0.894, 1.0)


def lin(c):
    return np.power(np.asarray(c, dtype=np.float32), 2.2)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def mix(a, b, t):
    return a + (b - a) * t[..., None]


def violet(t):
    c = mix(np.broadcast_to(lin(NIGHT), t.shape + (3,)), lin(DEEP), smooth(0.0, 0.22, t))
    c = mix(c, lin(PURPLE), smooth(0.18, 0.48, t))
    c = mix(c, lin(SOFT), smooth(0.42, 0.72, t))
    c = mix(c, lin(LAVENDER), smooth(0.66, 0.9, t))
    return mix(c, lin(LILAC), smooth(0.88, 1.0, t))


def blur(a, r):
    """A cheap box blur, wrapping round in longitude."""
    out = a.copy()
    for _ in range(2):
        acc = np.zeros_like(out)
        for d in range(-r, r + 1):
            acc += np.roll(out, d, axis=1)
        out = acc / (2 * r + 1)
        acc = np.zeros_like(out)
        for d in range(-r, r + 1):
            acc += np.take(out, np.clip(np.arange(out.shape[0]) + d, 0, out.shape[0] - 1), axis=0)
        out = acc / (2 * r + 1)
    return out


def main():
    photo = np.asarray(Image.open(SRC / "moon-1k.webp").convert("RGB"), dtype=np.float32) / 255.0
    relief = np.asarray(Image.open(SRC / "moon-relief-1k.webp").convert("RGB"), dtype=np.float32)[..., 0] / 255.0
    h, w = relief.shape
    # Heights are stored compressed (tanh) in 8 bits; this gives kilometres back.
    x = np.clip(relief, 0.003, 0.997) * 2.0 - 1.0
    km = 1.1 * np.log((1.0 + x) / (1.0 - x))
    lat = (0.5 - (np.arange(h) + 0.5) / h) * np.pi
    cos_lat = np.maximum(np.cos(lat), 0.15)[:, None]
    dx = (np.roll(km, -1, 1) - np.roll(km, 1, 1)) / (2 * 10914.0 / w * cos_lat)
    up = np.take(km, np.clip(np.arange(h) - 1, 0, h - 1), axis=0)
    down = np.take(km, np.clip(np.arange(h) + 1, 0, h - 1), axis=0)
    dy = (up - down) / (2 * 5457.0 / h)
    curve = km - 0.25 * (np.roll(km, 1, 1) + np.roll(km, -1, 1) + up + down)

    a = photo @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    t = 0.07 + 0.93 * np.power(smooth(0.08, 0.84, a), 0.85)
    surface = violet(t)
    cavity = smooth(0.02, 0.3, -curve)
    rim = smooth(0.02, 0.3, curve)
    cavity *= smooth(0.12, 0.4, np.cos(lat))[:, None]
    rim *= smooth(0.12, 0.4, np.cos(lat))[:, None]
    surface *= (1.0 - 0.3 * cavity)[..., None]
    surface = mix(surface, lin(LAVENDER), 0.08 * rim)
    # Maria lean indigo or plum in broad regions; a slow pattern made from the photo itself.
    region = smooth(0.35, 0.65, blur(a, 24) * 1.6)
    mare = 1.0 - smooth(0.3, 0.52, t)
    tint = mix(np.broadcast_to(np.array([0.62, 0.72, 1.3], np.float32), t.shape + (3,)), np.array([1.35, 0.8, 1.0], np.float32), region)
    tint *= (0.75 + 0.5 * region)[..., None]
    surface *= mix(np.ones_like(surface), tint, 0.9 * mare)
    # Rays and bright ejecta stand out from their surroundings.
    ray = smooth(0.05, 0.2, a - blur(a, 16))
    surface += lin(LAVENDER) * (ray * 0.18)[..., None] + lin(LILAC) * (smooth(0.62, 0.86, a) * 0.12)[..., None]

    # Relief, lit from a key in the upper left (west, north), exaggerated for drama.
    k = np.array([-0.62, 0.5], np.float32)
    # Faded out near the poles, where the map is stretched and the slopes are not to be trusted.
    polar = smooth(0.12, 0.4, np.cos(lat))[:, None]
    shade = np.clip(1.0 + (-(dx * k[0] + dy * k[1]) * 2.8) * 3.2 * polar, 0.35, 1.7)
    surface *= shade[..., None]

    out = np.power(np.clip(surface, 0.0, 1.0), 1 / 2.2)
    img = Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), "RGB")
    img.save(TEX / "moon-violet-1k.webp", "WEBP", quality=82, method=6)
    img.resize((512, 256), Image.LANCZOS).save(TEX / "moon-violet-512.webp", "WEBP", quality=82, method=6)
    print("wrote moon-violet-1k.webp and moon-violet-512.webp")


if __name__ == "__main__":
    main()
