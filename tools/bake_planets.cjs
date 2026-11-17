// Bakes each planet's look into its maps, so the page draws it with plain texture reads.
//
// The planets used to compute their surface live (noise, cells, vortex, network) on top of the
// source pack; that was too heavy for modest GPUs. This runs that same surface once, offline, on a
// GPU in a headless browser, and writes the result as maps:
//   assets-src/planets/baked/<slug>_{albedo,normal,emit,extra}.png  (2048×1024)
// tools/pack_planet_textures.py then makes the files the site loads.
//
// Needs: the site built and served (npx astro preview --port 4321), Playwright with Chromium.
//   node tools/bake_planets.cjs && python3 tools/pack_planet_textures.py
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets-src', 'planets');
const OUT = path.join(SRC, 'baked');
const W = 2048;
const H = 1024;
const NAMES = ['uDark', 'uBase', 'uLight', 'uType', 'uSeed', 'uSecond', 'uAir', 'uNodes', 'uPole', 'uSurface', 'uSurface2'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // The source pack's height, roughness and emissive maps, in one image as the old page read them.
  require('child_process').execFileSync('python3', ['-c', `
from pathlib import Path
from PIL import Image
src = Path(${JSON.stringify(SRC)}); out = Path(${JSON.stringify(OUT)})
for a in src.glob('*_albedo.png'):
    slug = a.name.split('_')[0]
    Image.merge('RGB', [Image.open(src / f'{slug}_{m}.png').convert('L') for m in ('height', 'roughness', 'emissive')]).save(out / f'{slug}_srcdata.png')
`], { stdio: 'inherit' });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  // 1. The planets' settings, exactly as the page sets them (colours, seeds, nodes, looks).
  const site = await browser.newPage();
  await site.goto('http://localhost:4321/es/?high');
  await site.waitForFunction(() => window.__space?.renderer?.planets?.bodies?.length, null, { timeout: 60000 });
  const planets = await site.evaluate((names) => window.__space.renderer.planets.bodies.map((b) => {
    const u = b.body.material.uniforms;
    const plain = (v) => (Array.isArray(v) ? v.map(plain) : typeof v === 'number' ? v : v.isColor ? [v.r, v.g, v.b] : v.toArray());
    return { id: b.def.id, uniforms: Object.fromEntries(names.map((n) => [n, plain(u[n].value)])) };
  }), NAMES);
  await site.close();

  const frag = fs.readFileSync(path.join(__dirname, 'planet_surface_bake.glsl'), 'utf8');
  const page = await browser.newPage();
  await page.setContent(`<canvas width="${W}" height="${H}"></canvas>`);
  const dataUrl = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

  for (const planet of planets) {
    const files = {
      albedo: dataUrl(path.join(SRC, `${planet.id}_albedo.png`)),
      normal: dataUrl(path.join(SRC, `${planet.id}_normal.png`)),
      data: dataUrl(path.join(OUT, `${planet.id}_srcdata.png`)),
    };
    const shots = await page.evaluate(async ({ frag, planet, files, W, H }) => {
      const canvas = document.querySelector('canvas');
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
      const img = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
      const texture = (image, srgb, unit) => {
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      };
      texture(await img(files.albedo), true, 0);
      texture(await img(files.normal), false, 1);
      texture(await img(files.data), false, 2);
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, '#version 300 es\nin vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }'));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, '#version 300 es\n#define texture2D texture\n' + frag));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const at = (n) => gl.getUniformLocation(prog, n);
      for (const [name, v] of Object.entries(planet.uniforms)) {
        const loc = at(name === 'uNodes' ? 'uNodes[0]' : name);
        if (!loc) continue;
        if (name === 'uNodes') gl.uniform3fv(loc, v.flat());
        else if (typeof v === 'number') gl.uniform1f(loc, v);
        else if (v.length === 3) gl.uniform3fv(loc, v);
        else gl.uniform4fv(loc, v);
      }
      gl.uniform1f(at('uMaps'), 1);
      gl.uniform1f(at('uOctaves'), 5);
      gl.uniform1f(at('uTime'), 0);
      gl.uniform1i(at('uAlbedoMap'), 0);
      gl.uniform1i(at('uNormalMap'), 1);
      gl.uniform1i(at('uDataMap'), 2);
      gl.uniform2f(at('uSize'), W, H);
      gl.viewport(0, 0, W, H);
      const out = [];
      for (let mode = 0; mode < 4; mode++) {
        gl.uniform1i(at('uMode'), mode);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.finish();
        out.push(canvas.toDataURL('image/png'));
      }
      return out;
    }, { frag, planet, files, W, H });
    ['albedo', 'normal', 'emit', 'extra'].forEach((kind, i) => {
      fs.writeFileSync(path.join(OUT, `${planet.id}_${kind}.png`), Buffer.from(shots[i].split(',')[1], 'base64'));
    });
    console.log(planet.id, 'baked');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
