"""Builds the planet textures the site loads from the source texture pack.

Source: assets-src/planets/<slug>_{albedo,normal,height,roughness,emissive}.png (equirectangular).
Output, in public/textures/planets/, for each size (512 and 1024 wide):
  <slug>_albedo_<w>.webp  colour (sRGB), lossy
  <slug>_normal_<w>.webp  normal map (data), lossless
  <slug>_data_<w>.webp    R = height, G = roughness, B = emissive mask (data), lossless
Three greyscale maps travel as one image: one request and one texture on the GPU instead of three.
Run: python3 tools/pack_planet_textures.py   (needs Pillow)
"""
from pathlib import Path
from PIL import Image

SRC = Path(__file__).resolve().parent.parent / 'assets-src' / 'planets'
OUT = Path(__file__).resolve().parent.parent / 'public' / 'textures' / 'planets'
OUT.mkdir(parents=True, exist_ok=True)

slugs = sorted({p.name.split('_')[0] for p in SRC.glob('*_albedo.png')})
for slug in slugs:
    load = lambda m: Image.open(SRC / f'{slug}_{m}.png')
    for w in (512, 1024):
        size = (w, w // 2)
        load('albedo').convert('RGB').resize(size, Image.LANCZOS).save(OUT / f'{slug}_albedo_{w}.webp', quality=86, method=6)
        load('normal').convert('RGB').resize(size, Image.LANCZOS).save(OUT / f'{slug}_normal_{w}.webp', lossless=True, quality=100, method=6)
        data = Image.merge('RGB', [load(m).convert('L').resize(size, Image.LANCZOS) for m in ('height', 'roughness', 'emissive')])
        data.save(OUT / f'{slug}_data_{w}.webp', lossless=True, quality=100, method=6)
    print(slug, 'done')
