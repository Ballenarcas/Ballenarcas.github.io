"""Builds the planet textures the site loads from the baked maps.

Source: assets-src/planets/baked/<slug>_{albedo,normal,emit,extra}.png, 2048×1024 equirectangular,
made by tools/bake_planets.cjs (the planet's whole look: source pack plus its drawn surface).
Output, in public/textures/planets/, for each size (256, 512 and 1024 wide):
  <slug>_albedo_<w>.webp  colour (sRGB)
  <slug>_normal_<w>.webp  RGB tangent normal (x east, y south: DirectX), A roughness
  <slug>_data_<w>.webp    RGB light the surface gives off (encoded, see the shader), A gloss
Three images per size: one request and one texture each.
Run: python3 tools/pack_planet_textures.py   (needs Pillow)
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets-src' / 'planets' / 'baked'
OUT = ROOT / 'public' / 'textures' / 'planets'
OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob('*.webp'):
    old.unlink()

slugs = sorted({p.name.split('_')[0] for p in SRC.glob('*_albedo.png')})
for slug in slugs:
    load = lambda m: Image.open(SRC / f'{slug}_{m}.png').convert('RGB')
    albedo, normal, emit, extra = load('albedo'), load('normal'), load('emit'), load('extra')
    rough, gloss, _ = extra.split()
    for w in (256, 512, 1024):
        size = (w, w // 2)
        fit = lambda im: im.resize(size, Image.LANCZOS)
        fit(albedo).save(OUT / f'{slug}_albedo_{w}.webp', quality=86, method=6)
        n = fit(normal).split()
        Image.merge('RGBA', (*n, fit(rough))).save(OUT / f'{slug}_normal_{w}.webp', quality=92, alpha_quality=90, method=6, exact=True)
        e = fit(emit).split()
        Image.merge('RGBA', (*e, fit(gloss))).save(OUT / f'{slug}_data_{w}.webp', quality=88, alpha_quality=90, method=6, exact=True)
    print(slug, 'done')
