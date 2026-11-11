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
  PerspectiveCamera,
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
import { applyRig, copyRig, Director, makeRig, mixRig, nearAngle, TELE_DISTANCE, TELE_FOV, type Rig } from './camera';
import { PlanetSystem, type PlanetDef, type PlanetSpot } from './planets';

/** What the page needs to know about the orbit, every frame it is on. */
export interface OrbitState {
  weight: number;
  spots: PlanetSpot[];
  focus: string | null;
  /** 0..1 while the camera travels to a new target, 1 when it has arrived. */
  travel: number;
}

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
uniform float uRim;
uniform float uBump;
uniform float uDetail;
uniform float uZoom;
varying vec2 vUv;
varying vec3 vP;

// The Violet Moon palette, from the darkest maria to the brightest highlands (sRGB, decoded below).
const vec3 DEEP = vec3(0.145, 0.086, 0.220);   // #251638
const vec3 ROYAL = vec3(0.396, 0.259, 0.553);  // #65428D
const vec3 SOFT = vec3(0.663, 0.541, 0.847);   // #A98AD8
const vec3 SILVER = vec3(0.867, 0.835, 0.914); // #DDD5E9
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 violet(float t) {
  // Maria in deep purple, plains in royal violet, highlands in lavender; silver is kept for the brightest ground.
  vec3 c = mix(lin(DEEP), lin(ROYAL) * vec3(0.95, 0.85, 1.12), smoothstep(0.0, 0.42, t));
  c = mix(c, lin(SOFT), smoothstep(0.34, 0.8, t));
  return mix(c, mix(lin(SOFT), lin(SILVER), 0.7), smoothstep(0.82, 1.0, t));
}

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
  vec2 e = clamp(fwidth(vUv) * 0.75, uTexel * 2.0, uTexel * 10.0);
  float hL = lum(texture2D(uMap, vUv - vec2(e.x, 0.0)).rgb);
  float hR = lum(texture2D(uMap, vUv + vec2(e.x, 0.0)).rgb);
  float hD = lum(texture2D(uMap, vUv - vec2(0.0, e.y)).rgb);
  float hU = lum(texture2D(uMap, vUv + vec2(0.0, e.y)).rgb);
  float cosLat = max(sqrt(max(1.0 - p.y * p.y, 0.0)), 0.2);
  vec2 slope = vec2((hR - hL) / (2.0 * e.x) / (6.2832 * cosLat), (hU - hD) / (2.0 * e.y) / 3.1416);
  // Up close the photograph runs out of detail: lean less on it and let the fine grain take over.
  vec3 n = p - uBump * (1.0 - 0.55 * uZoom) * (slope.x * T + slope.y * B);

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
  vec3 pW = normalize(uRot * p);

  // Crater shape read from the map itself: rims stand above their surroundings, floors sit below.
  float h = lum(albedo);
  float curve = h - 0.25 * (hL + hR + hD + hU);
  float rimLight = smoothstep(0.004, 0.05, curve);
  float cavity = smoothstep(0.004, 0.05, -curve);

  // The sun of the eclipse. Its shadow has a wide soft edge, like a shadow drawn over the Moon.
  float facing = dot(pW, uLight);
  float day = smoothstep(-0.1, 0.3, facing);
  float lit = max(dot(nW, uLight), 0.0);
  lit = mix(lit, sqrt(lit), 0.18) * day;

  // A fixed key light from the upper left models the relief at every phase, the full Moon included.
  vec3 R = normalize(vec3(-0.62, 0.5, 0.6));
  // Close up the photograph is magnified: soften the relief so it does not turn into noise.
  float relief = clamp(1.0 + (dot(nW, R) - dot(pW, R)) * 2.5 * (1.0 - 0.65 * uZoom), 0.38, 1.6);
  float key = 0.74 + 0.42 * dot(pW, R);

  // Violet as material: the brightness of the map runs through the palette.
  vec3 surface = violet(0.14 + 0.8 * smoothstep(0.01, 0.5, h));
  surface *= 1.0 - 0.4 * cavity;
  surface = mix(surface, lin(SILVER), 0.5 * rimLight);

  vec3 col = surface * relief * key * lit * uExposure * 1.5;
  // A lavender sheen where the ground faces the key light.
  float sheen = pow(max(dot(nW, normalize(R + vec3(0.0, 0.0, 1.0))), 0.0), 9.0);
  col += lin(SOFT) * sheen * 0.16 * lit * uExposure;

  // Inside the shadow the Moon is still there: its craters and relief stay readable in deep violet.
  float shade = 1.0 - day;
  float wrap = smoothstep(-0.75, 0.2, facing);
  vec3 umbra = surface * vec3(0.72, 0.5, 1.0) * relief * (0.5 + 0.5 * key);
  col += umbra * uAmbient * shade * (0.35 + 1.1 * wrap * wrap);

  // Fresnel rim: the light of the corona catching the edge that faces the sun.
  float fres = pow(1.0 - clamp(pW.z, 0.0, 1.0), 4.0);
  vec2 sunXY = uLight.xy;
  float side = length(sunXY) > 0.05 ? clamp(dot(normalize(pW.xy + 1e-5), normalize(sunXY)), 0.0, 1.0) : 0.5;
  col += lin(SOFT) * fres * uRim * (0.02 + 0.98 * side * side * side) * (0.5 + 0.5 * relief);

  // Tone curve on brightness only, so the violet keeps its colour in the highlights.
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= (1.0 - exp(-L * 1.7)) / max(L, 1e-4);
  // Grade: a little more colour, and the darkest tones fall towards deep purple instead of grey.
  float G = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(G), col, 1.22), 0.0);
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
  // At the far end of the depth range: the Moon and the planets hide the stars behind them.
  gl_Position = vec4(p * 2.0 - 1.0, 0.9999, 1.0);
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
  vec3 col = mix(vec3(0.8, 0.74, 1.0), vec3(1.0, 0.97, 1.0), vWarm);
  gl_FragColor = vec4(col, a * vAlpha);
}`;

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// The corona: violet light spilling from behind the Moon. No ring is drawn: there is a soft glow that
// hugs the edge and streamers of uneven length, both pulled towards the hidden sun.
const GLOW_FRAG = /* glsl */ `
uniform float uStrength;
uniform float uEclipse;
uniform vec2 uSun;
uniform float uTime;
varying vec2 vUv;
const float SPAN = 2.6; // half the plane, in Moon radii
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 q = (vUv - 0.5) * 2.0 * SPAN;
  float d = length(q);
  if (d < 0.985) discard;
  vec2 dir = q / d;
  float x = d - 1.0;
  float toward = length(uSun) > 0.05 ? max(dot(dir, normalize(uSun)), 0.0) : 0.5;
  // Streamers: noise sampled around the disc (on the direction, so there is no seam) and stretched outwards.
  float t = uTime * 0.02;
  float n1 = noise(dir * 3.2 + vec2(t, -t) + x * 0.35);
  float n2 = noise(dir * 8.5 - vec2(t * 1.6, t) + x * 0.9);
  float streams = 0.35 + 0.95 * n1 * n1 + 0.4 * n2;
  float reach = mix(0.22, 0.4 + 0.75 * n1, uEclipse);
  float halo = exp(-x / reach) * streams;
  float hug = exp(-x / 0.16);
  float bias = mix(1.0, 0.14 + 1.7 * pow(toward, 1.6), uEclipse);
  float fade = smoothstep(SPAN, SPAN * 0.62, d);
  float alpha = (halo * 0.95 + hug * 0.3) * bias * fade * uStrength;
  vec3 col = mix(vec3(0.36, 0.17, 0.66), vec3(0.74, 0.6, 1.0), clamp(halo * halo * 0.8 + hug * 0.35, 0.0, 1.0));
  gl_FragColor = vec4(col, alpha);
}`;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export class MoonScene implements SpaceRenderer {
  readonly ready: Promise<void>;
  readonly alive = true;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  // A perspective camera. Away from the orbit it is a tele lens far away, which draws the plane of
  // the Moon exactly like a flat camera would, so the poses keep their meaning.
  private camera = new PerspectiveCamera(TELE_FOV, 1, 0.1, TELE_DISTANCE + 200);
  private director = new Director();
  private tele = makeRig();
  private orbitRig = makeRig();
  private focusRig = makeRig();
  private explore = makeRig();
  private view = new Matrix4();
  private planets: PlanetSystem;
  private moonAt = new Vector3();
  private lean = new Vector3();
  private focusYaw = 0;
  private prevTime = -1;
  private weight = 0;
  private width = 1;
  private height = 1;
  private spotsOn = false;
  /** Called every frame the orbit is on (and once when it goes off), for the labels and the panel. */
  onOrbit: ((state: OrbitState) => void) | null = null;
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
    applyRig(this.camera, this.director.update(this.explore, 0));

    this.stars = this.makeStars(quality === 'high' ? 1500 : 650);
    this.glow = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uStrength: { value: 0 }, uEclipse: { value: 0 }, uSun: { value: new Vector2() }, uTime: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending }),
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
          uRim: { value: 0 },
          uBump: { value: 0.03 },
          uDetail: { value: 0 },
          uZoom: { value: 0 },
        },
      }),
    );
    this.moon.visible = false;
    this.stars.renderOrder = 0;
    this.glow.renderOrder = 1;
    this.moon.renderOrder = 2;
    this.planets = new PlanetSystem(quality);
    this.scene.add(this.stars, this.glow, this.moon, this.planets.group);

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
      depthTest: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.aspect = width / Math.max(1, height);
    this.camera.aspect = this.aspect;
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
    this.moon.updateMatrixWorld();

    const dt = this.prevTime < 0 ? 0 : Math.min(0.1, Math.max(0, f.time - this.prevTime));
    this.prevTime = f.time;
    this.weight = f.orbit;
    this.moonAt.set(x, y, 0);
    this.planets.update({ dt, weight: f.orbit, progress: f.orbitProgress, moon: this.moonAt, moonRadius: radius });
    this.camera.aspect = this.aspect;
    applyRig(this.camera, this.director.update(this.wanted(f.orbit, f.orbitProgress), dt));
    // The shading works in view space: the Moon's turn as the camera sees it.
    this.view.multiplyMatrices(this.camera.matrixWorldInverse, this.moon.matrixWorld);
    this.rotation.extractRotation(this.view);

    const u = this.moon.material.uniforms;
    (u.uRot.value as Matrix3).setFromMatrix4(this.rotation);
    this.light.set(f.light[0], f.light[1], f.light[2]).normalize();
    (u.uLight.value as Vector3).copy(this.light);
    const e = f.eclipse;
    u.uExposure.value = intro;
    u.uAmbient.value = (0.03 + 0.035 * e) * intro;
    u.uRim.value = (0.05 + 0.6 * e * e) * intro;
    // Fine grain only matters once the Moon is large on screen.
    const zoom = Math.min(1, Math.max(0, (f.r - 0.45) / 0.9));
    u.uZoom.value = zoom;
    u.uDetail.value = this.detail * zoom;

    const g = this.glow.material.uniforms;
    this.glow.position.set(x, y, 0);
    this.glow.quaternion.copy(this.camera.quaternion);
    // Inside the orbit the corona sits among the planets: the ones in front of the Moon hide it.
    this.glow.material.depthTest = f.orbit > 0.001;
    this.glow.scale.setScalar(radius * 2 * 2.6);
    g.uStrength.value = (0.22 + 1.35 * Math.pow(e, 2.2)) * intro;
    g.uEclipse.value = e;
    (g.uSun.value as Vector2).set(this.light.x, this.light.y);
    g.uTime.value = f.time;

    this.planets.light(this.camera, this.light);

    // The stars turn with the camera, so a move round the Moon reads as travel.
    const rig = this.director.rig;
    const s = this.stars.material.uniforms;
    (s.uShift.value as Vector2).set(f.pointer[0] * -0.006 - rig.yaw * 0.08, f.screens * 0.05 + f.pointer[1] * -0.006 + rig.pitch * 0.12);
    s.uTime.value = f.time;
    s.uFade.value = Math.min(1, f.intro * 2.2);

    this.renderer.render(this.scene, this.camera);
    this.report();
    this.watch(f);
  }

  /** The rig of whatever the camera follows now. */
  private wanted(weight: number, progress: number): Rig {
    copyRig(this.explore, this.tele);
    if (weight > 0) {
      this.makeOrbitRig(progress);
      const w = weight * weight * (3 - 2 * weight);
      mixRig(this.explore, this.tele, this.orbitRig, w);
    }
    const src = this.director.source;
    if (src.kind === 'focus') {
      const rig = this.makeFocusRig(src.id);
      if (rig) return rig;
    }
    return this.explore;
  }

  /** The exploration: the camera circles the Moon as the section scrolls, dipping towards the plane of
   *  the orbits half-way, and leans towards one planet after another as their moments come. */
  private makeOrbitRig(s: number) {
    const r = this.orbitRig;
    const R = this.moon.scale.x;
    const reach = this.planets.reach * R;
    const planets = this.planets.shownWorld();
    this.lean.set(0, 0, 0);
    let spot = 0;
    planets.forEach((p, k) => {
      const at = 0.14 + (0.72 * (k + 0.5)) / planets.length;
      const w = Math.exp(-(((s - at) / 0.1) ** 2));
      this.lean.addScaledVector(this.tmpV.copy(p).sub(this.moonAt), w);
      spot += w;
    });
    r.target.copy(this.moonAt).addScaledVector(this.lean, 0.5);
    r.yaw = 0.35 + s * Math.PI * 1.5;
    r.pitch = 0.42 + (0.3 - 0.42) * s - 0.26 * Math.sin(Math.PI * s);
    const fit = Math.min(1.5, Math.max(1, (reach * 1.02) / this.aspect));
    r.frame = fit * (1 - 0.3 * Math.min(1, spot));
    r.fov = 30;
    r.shiftX = 0;
    r.shiftY = 0;
  }

  /** Close on one planet, from outside its orbit, with the Moon behind it. The planet sits to the left
   *  of the panel on wide screens, above it on tall ones. It follows the planet round its orbit. */
  private makeFocusRig(id: string): Rig | null {
    const p = this.planets.where(id);
    if (!p) return null;
    const r = this.focusRig;
    const tall = this.aspect < 0.85;
    r.target.copy(p.at);
    const out = this.tmpV.copy(p.at).sub(this.moonAt);
    this.focusYaw = nearAngle(Math.atan2(out.x, out.z) + 0.5, this.focusYaw);
    r.yaw = this.focusYaw;
    r.pitch = 0.16;
    r.frame = p.radius / (tall ? 0.28 : 0.36);
    r.fov = 34;
    r.shiftX = tall ? 0 : -0.36;
    r.shiftY = tall ? 0.44 : 0.02;
    return r;
  }

  private tmpV = new Vector3();

  /** Tell the page where the planets are. */
  private report() {
    if (!this.onOrbit) return;
    const on = this.weight > 0.001;
    if (!on && !this.spotsOn) return;
    this.spotsOn = on;
    const src = this.director.source;
    this.onOrbit({
      weight: this.weight,
      spots: on ? this.planets.spots(this.camera, this.width, this.height) : [],
      focus: src.kind === 'focus' ? src.id : null,
      travel: this.director.progress,
    });
  }

  // ---- The orbit, as the page sees it ----

  get busy() { return this.weight > 0.001 || !this.director.settled; }

  setPlanets(defs: PlanetDef[]) { this.planets.set(defs); }
  showPlanets(ids: string[]) { this.planets.show(ids); }
  hover(id: string | null) { this.planets.hover(id); }

  /** Fly to a planet, or back to the exploration with null. */
  focus(id: string | null) {
    const src = this.director.source;
    const current = src.kind === 'focus' ? src.id : null;
    if (id === current) return;
    if (id && !this.planets.has(id)) return;
    if (id && !current) this.focusYaw = this.director.rig.yaw;
    this.director.follow(id ? { kind: 'focus', id } : { kind: 'explore' }, id ? 1.9 : 1.6);
    this.planets.focus(id);
  }

  /** The planet under a point of the screen, in CSS pixels. */
  pick(x: number, y: number, margin = 22): string | null {
    if (this.weight < 0.5) return null;
    return this.planets.pick(this.camera, this.width, this.height, x, y, margin);
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
    this.planets.dispose();
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
