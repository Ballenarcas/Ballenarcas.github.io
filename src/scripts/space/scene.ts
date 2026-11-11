// The 3D scene: stars in depth, a soft halo and the Moon, drawn with Three.js on one fixed canvas.
// This file is loaded on demand, after the page has painted.
import {
  AdditiveBlending,
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import type { Frame, SpaceRenderer } from './controller';

export type Quality = 'high' | 'low';

const MOON_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vP;
void main() {
  vUv = uv;
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The relief comes from the photograph itself: its brightness is read as height, and the slope of
// that height tilts the normal. Up close a fine procedural grain keeps the ground from going soft.
const MOON_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uTexel;
uniform vec3 uLight;
uniform mat3 uRot;
uniform float uExposure;
uniform float uAmbient;
uniform float uBump;
uniform float uDetail;
varying vec2 vUv;
varying vec3 vP;

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return s;
}

void main() {
  vec3 p = normalize(vP);
  // East and north on the sphere at this point.
  vec3 T = normalize(vec3(p.z, 0.0, -p.x) + 1e-5);
  vec3 B = cross(p, T);

  // Sample the height one pixel footprint apart, so the relief keeps its strength at every zoom.
  vec2 e = clamp(fwidth(vUv) * 0.75, uTexel * 1.25, uTexel * 10.0);
  float hL = lum(texture2D(uMap, vUv - vec2(e.x, 0.0)).rgb);
  float hR = lum(texture2D(uMap, vUv + vec2(e.x, 0.0)).rgb);
  float hD = lum(texture2D(uMap, vUv - vec2(0.0, e.y)).rgb);
  float hU = lum(texture2D(uMap, vUv + vec2(0.0, e.y)).rgb);
  float cosLat = max(sqrt(max(1.0 - p.y * p.y, 0.0)), 0.2);
  vec2 slope = vec2((hR - hL) / (2.0 * e.x) / (6.2832 * cosLat), (hU - hD) / (2.0 * e.y) / 3.1416);
  vec3 n = p - uBump * (slope.x * T + slope.y * B);

  vec3 albedo = texture2D(uMap, vUv).rgb;
  if (uDetail > 0.001) {
    float f = 260.0;
    float d = 0.0009;
    float n0 = fbm(p * f);
    float nT = fbm((p + T * d) * f);
    float nB = fbm((p + B * d) * f);
    n -= uDetail * 0.0016 * ((nT - n0) * T + (nB - n0) * B) / d;
    albedo *= 1.0 + uDetail * (n0 - 0.5) * 0.3;
  }

  vec3 nW = normalize(uRot * n);
  float flat_ = dot(uRot * p, uLight);
  float lit = max(dot(nW, uLight), 0.0);
  // The Moon is a dusty, almost flat disc of light: lift the mid tones instead of a hard Lambert falloff.
  lit = mix(lit, sqrt(lit), 0.5) * smoothstep(-0.06, 0.14, flat_);

  albedo = pow(albedo, vec3(0.92)) * 2.1;
  vec3 col = albedo * (lit * uExposure * vec3(1.0, 0.985, 0.955) + uAmbient * vec3(0.5, 0.68, 1.0));
  col = 1.0 - exp(-col * 1.25);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const STAR_VERT = /* glsl */ `
attribute vec4 aLook; // size, phase, warmth, strength
uniform vec2 uShift;
uniform float uTime;
uniform float uPx;
uniform float uFade;
varying float vAlpha;
varying float vWarm;
void main() {
  // "position" holds the place on the screen (0..1) and the depth of the star.
  vec2 p = fract(position.xy + uShift * (0.12 + position.z));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  float twinkle = 0.8 + 0.2 * sin(uTime * (0.5 + aLook.y * 1.6) + aLook.y * 40.0);
  gl_PointSize = aLook.x * uPx;
  vAlpha = twinkle * uFade * aLook.w;
  vWarm = aLook.z;
}`;

const STAR_FRAG = /* glsl */ `
varying float vAlpha;
varying float vWarm;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  vec3 col = mix(vec3(0.74, 0.84, 1.0), vec3(1.0, 0.95, 0.88), vWarm);
  gl_FragColor = vec4(col, a * vAlpha);
}`;

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const GLOW_FRAG = /* glsl */ `
uniform float uStrength;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(smoothstep(1.0, 0.5, d), 2.4) * uStrength;
  gl_FragColor = vec4(vec3(0.6, 0.74, 1.0), a);
}`;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export class MoonScene implements SpaceRenderer {
  readonly ready: Promise<void>;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private moon: Mesh<SphereGeometry, ShaderMaterial>;
  private glow: Mesh<PlaneGeometry, ShaderMaterial>;
  private stars: Points<BufferGeometry, ShaderMaterial>;
  private aspect = 1;
  private rotation = new Matrix4();
  private euler = new Euler();
  private light = new Vector3();
  private map: Texture | null = null;
  private detail: number;
  private pixelRatio: number;
  // Frame-time watch: if the device cannot keep up, quality steps down by itself.
  private slow = 0;
  private frames = 0;
  private lastTime = 0;

  constructor(private canvas: HTMLCanvasElement, private quality: Quality) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(devicePixelRatio || 1, quality === 'high' ? 2 : 1.5);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    this.detail = quality === 'high' ? 1 : 0;
    this.camera.position.z = 50;

    this.stars = this.makeStars(quality === 'high' ? 1500 : 650);
    this.glow = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uStrength: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending }),
    );
    this.moon = new Mesh(
      new SphereGeometry(1, quality === 'high' ? 128 : 72, quality === 'high' ? 96 : 54),
      new ShaderMaterial({
        vertexShader: MOON_VERT,
        fragmentShader: MOON_FRAG,
        uniforms: {
          uMap: { value: null },
          uTexel: { value: new Vector2(1 / 2048, 1 / 1024) },
          uLight: { value: new Vector3(0, 0, 1) },
          uRot: { value: new Matrix3() },
          uExposure: { value: 0 },
          uAmbient: { value: 0 },
          uBump: { value: 0.03 },
          uDetail: { value: 0 },
        },
      }),
    );
    this.moon.visible = false;
    this.stars.renderOrder = 0;
    this.glow.renderOrder = 1;
    this.moon.renderOrder = 2;
    this.scene.add(this.stars, this.glow, this.moon);

    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

    this.ready = this.loadMap('/textures/moon-2k.webp').then(() => {
      this.moon.visible = true;
      if (quality === 'high') {
        const upgrade = () => void this.loadMap('/textures/moon-4k.webp').catch(() => undefined);
        if ('requestIdleCallback' in window) requestIdleCallback(upgrade, { timeout: 4000 });
        else setTimeout(upgrade, 2500);
      }
    });
  }

  private async loadMap(url: string) {
    const texture = await new TextureLoader().loadAsync(url);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    const u = this.moon.material.uniforms;
    u.uMap.value = texture;
    u.uTexel.value.set(1 / texture.image.width, 1 / texture.image.height);
    this.map?.dispose();
    this.map = texture;
  }

  private makeStars(count: number) {
    const place = new Float32Array(count * 3);
    const look = new Float32Array(count * 4);
    // A small seeded generator: the sky is the same on every visit.
    let seed = 20261111;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      const dust = i % 23 === 0;
      const depth = dust ? 1.1 + rnd() * 0.9 : Math.pow(rnd(), 1.6);
      place.set([rnd(), rnd(), depth], i * 3);
      const bright = rnd() > 0.965;
      const size = dust ? 7 + rnd() * 12 : bright ? 3.2 + rnd() * 1.8 : 1.1 + depth * 1.6 + rnd() * 0.6;
      const strength = dust ? 0.05 + rnd() * 0.05 : bright ? 0.95 : 0.3 + depth * 0.55;
      look.set([size, rnd(), rnd() > 0.82 ? 0.8 : rnd() * 0.25, strength], i * 4);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(place, 3));
    geometry.setAttribute('aLook', new Float32BufferAttribute(look, 4));
    const material = new ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uShift: { value: new Vector2() }, uTime: { value: 0 }, uPx: { value: this.pixelRatio }, uFade: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  resize(width: number, height: number) {
    this.aspect = width / Math.max(1, height);
    this.camera.left = -this.aspect;
    this.camera.right = this.aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  draw(f: Frame) {
    const intro = ease(f.intro);
    const radius = f.r * 2 * (0.9 + 0.1 * intro);
    const x = f.x * this.aspect + f.pointer[0] * 0.012;
    const y = f.y + f.pointer[1] * 0.012;

    this.moon.position.set(x, y, 0);
    this.moon.scale.setScalar(radius);
    this.euler.set(f.tilt + f.pointer[1] * -0.015, -Math.PI / 2 + f.spin + f.time * 0.004 + f.pointer[0] * 0.02, 0.06, 'XYZ');
    this.moon.rotation.copy(this.euler);
    this.rotation.makeRotationFromEuler(this.euler);

    const u = this.moon.material.uniforms;
    (u.uRot.value as Matrix3).setFromMatrix4(this.rotation);
    this.light.set(f.light[0] + f.pointer[0] * 0.05, f.light[1] + f.pointer[1] * 0.05, f.light[2]).normalize();
    (u.uLight.value as Vector3).copy(this.light);
    u.uExposure.value = f.exposure * intro;
    u.uAmbient.value = f.ambient * intro;
    // Fine grain only matters once the Moon is large on screen.
    u.uDetail.value = this.detail * Math.min(1, Math.max(0, (f.r - 0.45) / 0.9));

    this.glow.position.set(x + this.light.x * radius * 0.06, y + this.light.y * radius * 0.06, -1);
    this.glow.scale.setScalar(radius * 3.6);
    this.glow.material.uniforms.uStrength.value = f.glow * 0.34 * intro * Math.max(0, this.light.z * 0.6 + 0.5);

    const s = this.stars.material.uniforms;
    (s.uShift.value as Vector2).set(f.pointer[0] * -0.006, f.screens * 0.05 + f.pointer[1] * -0.006);
    s.uTime.value = f.time;
    s.uFade.value = Math.min(1, f.intro * 2.2);

    this.renderer.render(this.scene, this.camera);
    this.watch(f);
  }

  /** Steps quality down when frames keep arriving late. */
  private watch(f: Frame) {
    const now = f.time;
    const dt = now - this.lastTime;
    this.lastTime = now;
    if (f.intro < 1 || dt <= 0 || dt > 0.25) return;
    this.frames++;
    if (dt > 0.034) this.slow++;
    if (this.frames < 90) return;
    if (this.slow > 45) {
      if (this.detail > 0) this.detail = 0;
      else if (this.pixelRatio > 1) {
        this.pixelRatio = Math.max(1, this.pixelRatio - 0.5);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.stars.material.uniforms.uPx.value = this.pixelRatio;
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
      }
    }
    this.frames = 0;
    this.slow = 0;
  }

  dispose() {
    this.map?.dispose();
    this.moon.geometry.dispose();
    this.moon.material.dispose();
    this.glow.geometry.dispose();
    this.glow.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.renderer.dispose();
  }
}
