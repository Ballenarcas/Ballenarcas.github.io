// The projects as planets around the Moon. Everything about a planet comes from its project's data
// (id, colour, featured, order): nothing here is written for one project in particular.
//
// The system lives in a group that sits on the Moon and is scaled by its radius, so orbits are
// measured in Moon radii. Planets share their geometry and one shader program; each has its own
// uniforms. Their light is the same as the Moon's: the sun of the eclipse, plus the fixed key light
// that models the Moon's relief, and the Moon casts its shadow on them.
import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  Group,
  Mesh,
  Object3D,
  Ray,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sphere,
  Vector3,
  Vector4,
  type PerspectiveCamera,
} from 'three';
import gsap from 'gsap';

export interface PlanetDef {
  id: string;
  accent: string;
  featured: boolean;
  /** Position in the list of projects: 0 is the most important. */
  rank: number;
}

/** Where a planet is on screen, in CSS pixels. */
export interface PlanetSpot {
  id: string;
  x: number;
  y: number;
  /** Radius on screen. */
  r: number;
  /** 0 hidden … 1 fully there (filters, entrance). */
  presence: number;
  /** Hidden behind the Moon. */
  behind: boolean;
}

const BODY_VERT = /* glsl */ `
varying vec3 vP;
varying vec3 vView;
varying vec3 vX;
varying vec3 vY;
varying vec3 vZ;
void main() {
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  // The body's axes in view space, to turn the bumped normal into view space in the fragment shader.
  vX = normalMatrix * vec3(1.0, 0.0, 0.0);
  vY = normalMatrix * vec3(0.0, 1.0, 0.0);
  vZ = normalMatrix * vec3(0.0, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

// Three kinds of surface, picked per project: cratered rock, banded gas and ice with clouds.
const BODY_FRAG = /* glsl */ `
uniform vec3 uDark;
uniform vec3 uBase;
uniform vec3 uLight;
uniform float uType;
uniform float uSeed;
uniform float uHover;
uniform float uDim;
uniform float uOctaves;
uniform vec3 uSun;
uniform vec3 uKey;
uniform vec4 uMoon;
varying vec3 vP;
varying vec3 vView;
varying vec3 vX;
varying vec3 vY;
varying vec3 vZ;

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
  for (int i = 0; i < 5; i++) {
    if (float(i) >= uOctaves) break;
    s += a * noise(p);
    p = p * 2.07 + 5.3;
    a *= 0.5;
  }
  return s;
}

// Height of the ground (rock and ice) or of the cloud tops (gas), for a point on the unit sphere.
float height(vec3 p) {
  vec3 q = p * 2.6 + uSeed;
  if (uType < 0.5) {
    // Rock: rolling ground, worn basins with raised rims, fine grit.
    float h = fbm(q * 1.6);
    float c = noise(q * 2.4 + 3.0);
    float basin = smoothstep(0.6, 0.72, c);
    float rim = smoothstep(0.5, 0.6, c) - smoothstep(0.6, 0.7, c);
    return h * 0.9 - 0.12 * basin + 0.05 * rim + 0.07 * noise(q * 14.0);
  }
  if (uType < 1.5) {
    // Gas: soft latitude bands bent by turbulence, wide and fine together.
    float turb = fbm(q * vec3(1.0, 3.2, 1.0));
    float wide = sin(p.y * 9.0 + turb * 2.6 + uSeed);
    float fine = sin(p.y * 31.0 + turb * 5.0);
    return 0.5 + 0.3 * wide + 0.14 * fine;
  }
  // Ice: smooth ground with a few faint cracks.
  float cracks = 1.0 - abs(noise(q * 2.2) * 2.0 - 1.0);
  return fbm(q) * 0.75 + 0.14 * pow(cracks, 16.0);
}

void main() {
  vec3 p = normalize(vP);
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), p) + 1e-4);
  vec3 B = cross(p, T);
  float d = 0.012;
  float h = height(p);
  float hT = height(normalize(p + T * d));
  float hB = height(normalize(p + B * d));
  float bump = uType < 0.5 ? 0.9 : (uType < 1.5 ? 0.12 : 0.35);
  vec3 nObj = normalize(p - bump * ((hT - h) * T + (hB - h) * B) / d * 0.08);
  vec3 n = normalize(vX * nObj.x + vY * nObj.y + vZ * nObj.z);
  vec3 n0 = normalize(vX * p.x + vY * p.y + vZ * p.z);

  vec3 albedo;
  if (uType < 0.5) {
    albedo = mix(uDark, uBase, smoothstep(0.32, 0.62, h));
    albedo = mix(albedo, uLight, smoothstep(0.66, 0.85, h) * 0.7);
  } else if (uType < 1.5) {
    float storm = smoothstep(0.84, 0.95, noise(p * 3.0 + uSeed * 1.7));
    albedo = mix(mix(uDark, uBase, 0.45), uBase, smoothstep(0.1, 0.9, h));
    albedo = mix(albedo, uLight, smoothstep(0.7, 1.0, h) * 0.35 + storm * 0.4);
  } else {
    // Clouds stream along the latitudes.
    vec3 cq = p * vec3(3.0, 7.0, 3.0) + vec3(uSeed, 0.0, uSeed);
    float cloud = smoothstep(0.48, 0.78, fbm(cq + fbm(cq * 0.7)));
    float cap = smoothstep(0.74, 0.92, abs(p.y));
    albedo = mix(uDark, uBase, smoothstep(0.25, 0.65, h));
    albedo = mix(albedo, uLight, max(cloud * 0.6, cap));
  }

  // The sun of the eclipse, hidden where the Moon stands between it and this point.
  vec3 oc = uMoon.xyz - vView;
  float tca = dot(oc, uSun);
  float miss = dot(oc, oc) - tca * tca;
  float r2 = uMoon.w * uMoon.w;
  float shadow = tca > 0.0 ? smoothstep(r2 * 0.75, r2 * 1.3, miss) : 1.0;
  float sun = max(dot(n, uSun), 0.0) * shadow;
  // The key light that also models the Moon's relief keeps every planet readable during the eclipse.
  float key = max(dot(n, uKey), 0.0);
  vec3 col = albedo * (0.05 + 0.7 * key + 0.85 * sun);

  // A thin atmosphere: light caught at the edge, strongest towards the sun.
  vec3 V = normalize(-vView);
  float fres = pow(1.0 - max(dot(n0, V), 0.0), 3.0);
  float toward = 0.3 + 0.7 * max(dot(n0, uSun) + 0.35, 0.0);
  vec3 air = mix(uBase, vec3(0.74, 0.6, 1.0), 0.45);
  col += air * fres * toward * (0.55 + 0.6 * uHover);

  col *= (1.0 + 0.35 * uHover) * mix(1.0, 0.32, uDim);
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= (1.0 - exp(-L * 1.8)) / max(L, 1e-4);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// The glow of the atmosphere outside the disc: the back of a slightly larger sphere.
const AIR_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const AIR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSun;
uniform float uStrength;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 V = normalize(-vView);
  // 0 at the outer edge of the shell, ~0.55 where it meets the planet's edge.
  float x = clamp(-dot(normalize(vN), V), 0.0, 1.0);
  float glow = pow(smoothstep(0.0, 0.55, x), 2.2);
  vec2 s = uSun.xy;
  float side = length(s) > 0.05 ? 0.35 + 0.65 * max(dot(normalize(-vN.xy + 1e-5), normalize(s)), 0.0) : 0.7;
  // Additive: the alpha carries the light, so the canvas stays clear around the planet.
  gl_FragColor = vec4(uColor, glow * side * uStrength);
}`;

const RING_VERT = /* glsl */ `
varying float vR;
varying vec3 vView;
void main() {
  vR = length(position.xy);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const RING_FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uLight;
uniform float uSeed;
uniform float uDim;
uniform float uIn;
uniform float uOut;
varying float vR;
float h(float x) { return fract(sin(x * 91.7 + uSeed) * 43758.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  float t = (vR - uIn) / (uOut - uIn);
  float bands = 0.25 + 0.75 * n1(t * 34.0) * n1(t * 9.0 + 4.0);
  float edge = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.86, t);
  float gap = 1.0 - 0.85 * smoothstep(0.02, 0.0, abs(t - 0.62));
  float a = bands * edge * gap * 0.55 * mix(1.0, 0.35, uDim);
  vec3 col = mix(uBase, uLight, n1(t * 21.0));
  gl_FragColor = vec4(col * 0.75, a);
  #include <colorspace_fragment>
}`;

/** A small stable hash of a text, 0..1 per call of `next`. */
function seeded(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let s = h >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const VIOLET = new Color('#65428D');
const DEEP = new Color('#251638');
const WHITE = new Color('#f2eefa');

interface Body {
  def: PlanetDef;
  holder: Object3D;
  body: Mesh<SphereGeometry, ShaderMaterial>;
  air: Mesh<SphereGeometry, ShaderMaterial>;
  ring: Mesh<RingGeometry, ShaderMaterial> | null;
  size: number;
  /** Orbit, in Moon radii and radians. */
  orbit: { a: number; e: number; incl: number; node: number; angle: number; speed: number; spin: number };
  /** Animated values, written by tweens and read every frame. */
  live: { a: number; presence: number; hover: number; dim: number };
  shown: boolean;
  world: Vector3;
}

const SLOT0 = 2.55;
const SLOT_STEP = 1.3;

export class PlanetSystem {
  readonly group = new Group();
  private bodies: Body[] = [];
  private sphere: SphereGeometry;
  private octaves: number;
  private lastProgress = -1;
  private hovered: string | null = null;
  private focused: string | null = null;
  private moonView = new Vector4();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private ray = new Ray();
  private moonSphere = new Sphere();
  private otherSphere = new Sphere();

  constructor(quality: 'high' | 'low') {
    this.sphere = new SphereGeometry(1, quality === 'high' ? 64 : 40, quality === 'high' ? 44 : 28);
    this.octaves = quality === 'high' ? 5 : 3;
    this.group.visible = false;
  }

  get ids() { return this.bodies.map((b) => b.def.id); }
  has(id: string) { return this.bodies.some((b) => b.def.id === id && b.shown); }

  /** Build the planets for these projects. Planets already built for the same id are kept. */
  set(defs: PlanetDef[]) {
    const keep = new Set(defs.map((d) => d.id));
    for (const b of this.bodies.filter((x) => !keep.has(x.def.id))) this.drop(b);
    this.bodies = this.bodies.filter((b) => keep.has(b.def.id));
    for (const def of defs) {
      const old = this.bodies.find((b) => b.def.id === def.id);
      if (old) { old.def = def; continue; }
      this.bodies.push(this.make(def, defs.length));
    }
    this.bodies.sort((a, b) => a.def.rank - b.def.rank);
    this.layout(false);
  }

  /** Show only these planets (the filter); the others leave and the orbits close up. */
  show(ids: string[]) {
    const on = new Set(ids);
    for (const b of this.bodies) b.shown = on.has(b.def.id);
    this.layout(true);
  }

  hover(id: string | null) {
    if (id === this.hovered) return;
    this.hovered = id;
    for (const b of this.bodies) gsap.to(b.live, { hover: b.def.id === id ? 1 : 0, duration: 0.45, ease: 'power2.out', overwrite: 'auto' });
  }

  focus(id: string | null) {
    this.focused = id;
    for (const b of this.bodies) gsap.to(b.live, { dim: id && b.def.id !== id ? 1 : 0, duration: 1.1, ease: 'power2.inOut', overwrite: 'auto' });
  }

  /** World position and radius of a planet, for the camera. */
  where(id: string): { at: Vector3; radius: number } | null {
    const b = this.bodies.find((x) => x.def.id === id);
    if (!b) return null;
    return { at: b.world, radius: b.size * this.group.scale.x };
  }

  /** The shown planets in their order, with their world positions. Depends on the filter only, so the
   *  framing changes in one step that the camera then blends. */
  shownWorld() { return this.bodies.filter((b) => b.shown).map((b) => b.world); }

  /** Radius of the outermost shown orbit, in Moon radii. */
  get reach() {
    const n = Math.max(1, this.bodies.filter((b) => b.shown).length);
    return SLOT0 + this.step * (n - 1) + 0.6;
  }

  /** Space between orbits: it narrows as projects are added, so a long list still fits the frame. */
  private get step() {
    return Math.min(SLOT_STEP, Math.max(0.72, 3.9 / Math.max(1, this.bodies.length)));
  }

  private make(def: PlanetDef, count: number): Body {
    const rnd = seeded(def.id);
    const accent = new Color(def.accent);
    // Each project's colour, pulled a little towards the violet of the site.
    const base = accent.clone().lerp(VIOLET, 0.12);
    const dark = accent.clone().multiplyScalar(0.22).lerp(DEEP, 0.45);
    const light = accent.clone().lerp(WHITE, 0.45);
    // The kinds of surface take turns down the list, so neighbours never look alike.
    const type = (def.rank + Math.floor(seeded('orbit')() * 3)) % 3;
    const size = (def.featured ? 0.5 - 0.045 * Math.min(def.rank, 4) : 0.3) * (0.92 + 0.16 * rnd());

    const body = new Mesh(this.sphere, new ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      uniforms: {
        uDark: { value: dark.clone().convertSRGBToLinear() },
        uBase: { value: base.clone().convertSRGBToLinear() },
        uLight: { value: light.clone().convertSRGBToLinear() },
        uType: { value: type },
        uSeed: { value: rnd() * 40 },
        uHover: { value: 0 },
        uDim: { value: 0 },
        uOctaves: { value: this.octaves },
        uSun: { value: new Vector3(0, 0, 1) },
        uKey: { value: new Vector3(-0.62, 0.5, 0.6).normalize() },
        uMoon: { value: this.moonView },
      },
    }));
    const air = new Mesh(this.sphere, new ShaderMaterial({
      vertexShader: AIR_VERT,
      fragmentShader: AIR_FRAG,
      uniforms: { uColor: { value: base.clone().lerp(new Color('#bda5ec'), 0.5).convertSRGBToLinear() }, uSun: body.material.uniforms.uSun, uStrength: { value: 0.9 } },
      side: BackSide,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }));
    air.scale.setScalar(1.16);

    // holder: the place on the orbit. axis: the planet's tilted axis, which the body turns about.
    const holder = new Object3D();
    const axis = new Object3D();
    axis.rotation.set(0.3 + rnd() * 0.25, 0, (rnd() - 0.5) * 0.9);
    axis.add(body);
    holder.add(axis, air);

    let ring: Body['ring'] = null;
    // Banded giants carry a ring.
    if (type === 1) {
      const inner = 1.4;
      const outer = 2.25;
      ring = new Mesh(new RingGeometry(inner, outer, 128, 1), new ShaderMaterial({
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        uniforms: { uBase: body.material.uniforms.uBase, uLight: body.material.uniforms.uLight, uSeed: { value: rnd() * 10 }, uDim: body.material.uniforms.uDim, uIn: { value: inner }, uOut: { value: outer } },
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      axis.add(ring);
    }
    this.group.add(holder);

    return {
      def,
      holder,
      body,
      air,
      ring,
      size,
      orbit: {
        a: SLOT0,
        e: 0.03 + 0.1 * rnd(),
        incl: (rnd() - 0.5) * 0.42,
        node: rnd() * Math.PI * 2,
        // Start spread around the Moon, each a little off an even share.
        angle: (def.rank / Math.max(1, count)) * Math.PI * 2 + rnd() * 0.9 + 0.4,
        speed: 0.85 + 0.3 * rnd(),
        spin: (0.06 + 0.08 * rnd()) * (rnd() > 0.2 ? 1 : -1),
      },
      live: { a: SLOT0, presence: 1, hover: 0, dim: 0 },
      shown: true,
      world: new Vector3(),
    };
  }

  /** Give each shown planet its orbit: the most important closest in. */
  private layout(animate: boolean) {
    let slot = 0;
    for (const b of this.bodies) {
      const a = SLOT0 + this.step * (b.shown ? slot++ : slot + 0.6);
      b.orbit.a = a;
      if (animate) {
        gsap.to(b.live, { a, duration: 1.4, ease: 'power2.inOut', overwrite: 'auto' });
        gsap.to(b.live, { presence: b.shown ? 1 : 0, duration: b.shown ? 1.1 : 0.8, ease: b.shown ? 'power2.out' : 'power2.in' });
      } else {
        b.live.a = a;
        b.live.presence = b.shown ? 1 : 0;
      }
    }
  }

  private drop(b: Body) {
    gsap.killTweensOf(b.live);
    this.group.remove(b.holder);
    b.body.material.dispose();
    b.air.material.dispose();
    if (b.ring) { b.ring.geometry.dispose(); b.ring.material.dispose(); }
  }

  /**
   * One frame. `weight` is how much of the orbit is on (0 outside the section), `progress` the
   * scroll through it. `sun` is the sun direction in view space; the Moon's place and size are given
   * in world space and its centre is turned into view space for the shadow.
   */
  update(o: { dt: number; weight: number; progress: number; moon: Vector3; moonRadius: number }) {
    const on = o.weight > 0.001 && this.bodies.length > 0;
    this.group.visible = on;
    if (this.lastProgress < 0) this.lastProgress = o.progress;
    const scrolled = o.progress - this.lastProgress;
    this.lastProgress = o.progress;
    if (!on) return;
    this.group.position.copy(o.moon);
    this.group.scale.setScalar(o.moonRadius);
    this.group.updateMatrixWorld();

    this.bodies.forEach((b, i) => {
      const k = b.orbit;
      const a = b.live.a;
      // Kepler-like: outer planets go round more slowly. The scroll also carries them along.
      k.angle += (0.3 * Math.pow(SLOT0 / a, 1.5) * k.speed) * o.dt + scrolled * 1.6 * Math.pow(SLOT0 / a, 0.5);
      // Crowded systems get rounder orbits, so neighbours do not cross.
      const e = k.e * (this.step / SLOT_STEP);
      const r = (a * (1 - e * e)) / (1 + e * Math.cos(k.angle));
      this.tmp.set(Math.cos(k.angle) * r, 0, Math.sin(k.angle) * r);
      // Tilt the orbit's plane, then turn it about the vertical.
      const y = -this.tmp.z * Math.sin(k.incl);
      const z = this.tmp.z * Math.cos(k.incl);
      const cn = Math.cos(k.node);
      const sn = Math.sin(k.node);
      b.holder.position.set(this.tmp.x * cn + z * sn, y, -this.tmp.x * sn + z * cn);
      // They come in one after the other as the section opens.
      const enter = Math.min(1, Math.max(0, (o.weight - 0.12 * i) / 0.55));
      const s = b.size * b.live.presence * enter * enter * (3 - 2 * enter) * (1 + 0.06 * b.live.hover);
      b.holder.scale.setScalar(Math.max(s, 1e-4));
      b.holder.visible = s > 0.002;
      b.body.rotation.y += k.spin * o.dt;
      const u = b.body.material.uniforms;
      u.uHover.value = b.live.hover;
      u.uDim.value = b.live.dim;
      b.holder.getWorldPosition(b.world);
    });
  }

  /** Once the camera is placed: the sun and the Moon's shadow, in view space. */
  light(camera: PerspectiveCamera, sun: Vector3) {
    if (!this.group.visible) return;
    const m = this.group.position;
    this.moonView.set(m.x, m.y, m.z, 1).applyMatrix4(camera.matrixWorldInverse);
    this.moonView.w = this.group.scale.x;
    for (const b of this.bodies) (b.body.material.uniforms.uSun.value as Vector3).copy(sun);
  }

  /** Where every planet is on screen (CSS pixels), and whether the Moon hides it. */
  spots(camera: PerspectiveCamera, width: number, height: number): PlanetSpot[] {
    this.moonSphere.set(this.group.position, this.group.scale.x);
    return this.bodies.map((b) => {
      const radius = b.holder.scale.x * this.group.scale.x;
      this.tmp.copy(b.world).project(camera);
      const x = (this.tmp.x * 0.5 + 0.5) * width;
      const y = (-this.tmp.y * 0.5 + 0.5) * height;
      // Screen radius: the distance to the camera sets how large the sphere looks.
      const dist = this.tmp2.copy(b.world).sub(camera.position).length();
      const r = (radius / Math.max(dist * Math.tan((camera.fov * Math.PI) / 360), 1e-4)) * height * 0.5;
      // Behind the Moon: the line from the camera to the planet passes through it first.
      this.ray.origin.copy(camera.position);
      this.ray.direction.copy(this.tmp2).normalize();
      const hit = this.ray.intersectSphere(this.moonSphere, this.tmp2);
      let behind = !!hit && hit.distanceTo(camera.position) < dist - radius;
      // …or through a nearer planet.
      for (const o of this.bodies) {
        if (behind || o === b || !o.holder.visible) continue;
        this.otherSphere.set(o.world, o.holder.scale.x * this.group.scale.x);
        const h2 = this.ray.intersectSphere(this.otherSphere, this.tmp2);
        if (h2 && h2.distanceTo(camera.position) < dist - radius) behind = true;
      }
      const presence = this.group.visible && b.shown ? Math.min(1, b.holder.scale.x / Math.max(b.size, 1e-4)) : 0;
      return { id: b.def.id, x, y, r, presence: this.tmp.z < 1 ? presence : 0, behind };
    });
  }

  /** The planet under a point of the screen (CSS pixels), if any. Small planets get a generous margin for touch. */
  pick(camera: PerspectiveCamera, width: number, height: number, px: number, py: number, margin: number): string | null {
    let best: string | null = null;
    let bestDist = Infinity;
    for (const s of this.spots(camera, width, height)) {
      if (s.presence < 0.5 || s.behind) continue;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d <= Math.max(s.r * 1.1, margin) && d < bestDist) { best = s.id; bestDist = d; }
    }
    return best;
  }

  dispose() {
    for (const b of this.bodies) this.drop(b);
    this.bodies = [];
    this.sphere.dispose();
  }
}
