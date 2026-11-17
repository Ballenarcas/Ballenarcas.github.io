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
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  Mesh,
  Object3D,
  Ray,
  RepeatWrapping,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
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
  /** The planet's designed look, from the project's data. Without one, a surface is picked by rank. */
  look?: Look;
  /** Second colour of the look (cracks, gold, aurora…). */
  accent2?: string;
  size?: 'medium' | 'medium-large';
  /** The project has a texture set in /textures/planets/<id>_<map>.png. */
  textures?: boolean;
}

export type Look = 'tech' | 'organic' | 'network' | 'celestial';

/** Everything that makes one planet look like itself. Each part is optional where it says so. */
interface LookConfig {
  /** Drawn surface used when there is no texture set (and while it loads), and the look's own features. */
  type: number;
  /** Second colour: light in the cracks, gold, aurora… */
  second: string;
  /** Halo outside the disc: strength, and how much it takes the second colour. */
  air: number;
  airMix: number;
  /** With a texture set. relief: large-scale slopes from the height map; fine: the normal map's detail;
   *  displace: how far the height map lifts the ground (in planet radii); emit: how much the
   *  emissive mask does (its role differs per planet); albedo: the share of the albedo map in the
   *  colour; saturation: of that map's colour; polish: how shiny the smoothest ground gets. */
  surface: { relief: number; fine: number; displace: number; emit: number; albedo: number; saturation: number; polish: number };
  /** A ring: inner and outer radius (planet radii) and how bright its thread of light is. */
  ring?: { inner: number; outer: number; glow: number };
  /** A cloud layer just above the ground. */
  clouds?: { color: string; coverage: number; scale: number; opacity: number; swirl?: boolean };
  /** A few small rocks circling close by. */
  debris?: { count: number; color: string };
  /** Where the look centres its main feature (Cielith's vortex), in the planet's own space. */
  pole?: [number, number, number];
}

const LOOKS: Record<Look, LookConfig> = {
  // Boost: silver mineral crust, fractured onto dark depths with ice-blue light; a fine ring.
  tech: {
    type: 3, second: '#8fd4ff', air: 0.3, airMix: 0.3,
    surface: { relief: 5, fine: 0.9, displace: 0.025, emit: 0.9, albedo: 0.3, saturation: 0.12, polish: 0.6 },
    ring: { inner: 1.6, outer: 1.7, glow: 0.6 },
    debris: { count: 5, color: '#8a8e9a' },
  },
  // Mercadito (slug aceituna): green and olive country, mountains and dark valleys, ochre highlands, light cloud.
  organic: {
    type: 4, second: '#c9a23a', air: 0.45, airMix: 0.0,
    surface: { relief: 8, fine: 0.8, displace: 0.04, emit: 0.18, albedo: 0.4, saturation: 0.9, polish: 0.12 },
    clouds: { color: '#f1efe6', coverage: 0.5, scale: 2.6, opacity: 0.55 },
    debris: { count: 6, color: '#9a8466' },
  },
  // Votify: violet crystal in facets, its network of light glowing in some regions only.
  network: {
    type: 5, second: '#ff4fd0', air: 1.1, airMix: 0.25,
    surface: { relief: 3, fine: 0.4, displace: 0.015, emit: 1, albedo: 0.25, saturation: 0.9, polish: 0.7 },
  },
  // Cielith: night blue, a great vortex, violet cloud regions, a faint aurora.
  celestial: {
    type: 6, second: '#b9a6ff', air: 0.95, airMix: 0.6,
    surface: { relief: 2, fine: 0.3, displace: 0.01, emit: 0.3, albedo: 0.3, saturation: 1, polish: 0.25 },
    clouds: { color: '#8a6ad8', coverage: 0.4, scale: 2.2, opacity: 0.55, swirl: true },
    // The vortex sits high on the globe, where the tilted axis keeps it in view most of the time.
    pole: [0.3, 0.9, 0.3],
  },
};

/** Where a planet is on screen, in CSS pixels. */
export interface PlanetSpot {
  id: string;
  x: number;
  y: number;
  /** Radius on screen. */
  r: number;
  /** 0 hidden … 1 fully there (entrance). */
  presence: number;
  /** Hidden behind the Moon. */
  behind: boolean;
}

const BODY_VERT = /* glsl */ `
uniform float uMaps;
uniform sampler2D uDataMap;
uniform vec4 uSurface2;
varying vec3 vP;
varying vec3 vView;
varying vec3 vX;
varying vec3 vY;
varying vec3 vZ;
varying vec2 vUv;
void main() {
  vP = position;
  vUv = uv;
  vec3 pos = position;
  if (uMaps > 0.5 && uSurface2.z > 0.0) {
    // The height map lifts the ground a little, so the edge of the planet is not a perfect circle.
    // Both sides of the 180th meridian get the same height (the maps do not tile), and the poles,
    // where many vertices meet at one point, stay put.
    float h = 0.5 * (textureLod(uDataMap, uv, 1.0).r + textureLod(uDataMap, vec2(1.0 - uv.x, uv.y), 1.0).r);
    float d = min(uv.x, 1.0 - uv.x);
    float hs = mix(h, textureLod(uDataMap, uv, 1.0).r, smoothstep(0.0, 0.03, d));
    pos *= 1.0 + uSurface2.z * (hs - 0.5) * smoothstep(0.95, 0.78, abs(normalize(position).y));
  }
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vView = mv.xyz;
  // The body's axes in view space, to turn the bumped normal into view space in the fragment shader.
  vX = normalMatrix * vec3(1.0, 0.0, 0.0);
  vY = normalMatrix * vec3(0.0, 1.0, 0.0);
  vZ = normalMatrix * vec3(0.0, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

// Surfaces. Four are designed looks a project can ask for (tech, organic, network, celestial);
// three generic ones (cratered rock, banded gas, ice with clouds) serve any other project.
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
uniform vec3 uSecond;
uniform vec3 uAir;
uniform vec3 uNodes[10];
uniform vec3 uPole;
uniform float uTime;
// The project's own texture set (equirectangular): colour, normal, height, roughness, light.
uniform float uMaps;
uniform sampler2D uAlbedoMap;  // colour, sRGB (decoded to linear by the GPU)
uniform sampler2D uNormalMap;  // tangent-space normal, data
uniform sampler2D uDataMap;    // R height, G roughness, B emissive mask, data
uniform vec4 uSurface;  // relief, fine, emit, -
uniform vec4 uSurface2; // saturation, polish, displace, albedo share
varying vec3 vP;
varying vec3 vView;
varying vec3 vX;
varying vec3 vY;
varying vec3 vZ;
varying vec2 vUv;

// Map coordinates, worked out per pixel from the point on the sphere. The mesh's own UVs are
// interpolated across the triangles that meet at the poles, which shows as wedges there.
// Derivatives come from whichever of two longitude cuts is smooth here, so the 180th meridian
// gets no seam line.
vec2 suv;
vec2 sdx;
vec2 sdy;
void mapCoords(vec3 p) {
  float u = atan(p.z, -p.x) / 6.2832;
  suv = vec2(fract(u), 1.0 - acos(clamp(p.y, -1.0, 1.0)) / 3.1416);
  float u2 = fract(u + 0.5);
  bool wrap = fwidth(suv.x) > fwidth(u2);
  sdx = vec2(wrap ? dFdx(u2) : dFdx(suv.x), dFdx(suv.y));
  sdy = vec2(wrap ? dFdy(u2) : dFdy(suv.x), dFdy(suv.y));
}
// The maps do not tile across the 180th meridian: close to it, both sides are blended.
vec4 texAt(sampler2D m, vec2 uv) {
  vec4 c = textureGrad(m, uv, sdx, sdy);
  float d = min(uv.x, 1.0 - uv.x);
  if (d < 0.03) c = mix(textureGrad(m, vec2(1.0 - uv.x, uv.y), sdx, sdy), c, 0.5 + 0.5 * smoothstep(0.0, 0.03, d));
  return c;
}
vec4 tex(sampler2D m) { return texAt(m, suv); }

void main() {
  // Only the project's own maps, no procedural surface: the drawn worlds that used to sit under the
  // maps (noise, cells, vortex, network) were far too heavy for modest GPUs.
  vec3 p = normalize(vP);
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), p) + 1e-4);
  vec3 B = cross(p, T);
  vec3 nObj = p;
  // Until the maps are in: a plain shading in the planet's colours.
  vec3 albedo = mix(uDark, uBase, 0.55 + 0.35 * p.y);
  vec3 emit = vec3(0.0);
  float gloss = 0.25 * uSurface2.y;
  float shine = 36.0;

  if (uMaps > 0.5) {
    // The maps hold the whole look, baked offline from the planet's former live surface
    // (tools/bake_planets.cjs): colour; normal (x east, y south) with roughness in alpha; the light
    // the surface gives off (encoded: half, gamma 2.2) with gloss in alpha.
    mapCoords(p);
    // Near the poles an equirectangular map fans out into rays: there the maps give their average.
    float poleFade = smoothstep(0.8, 0.95, abs(p.y));
    vec4 nr = tex(uNormalMap);
    vec3 nm = nr.xyz * 2.0 - 1.0;
    nObj = normalize(mix(T * nm.x - B * nm.y + p * nm.z, p, poleFade));
    albedo = mix(tex(uAlbedoMap).rgb, textureLod(uAlbedoMap, suv, 10.0).rgb, poleFade);
    vec4 ed = tex(uDataMap);
    emit = pow(ed.rgb, vec3(2.2)) * 2.0 * (1.0 - poleFade);
    gloss = ed.a;
    shine = mix(90.0, 10.0, nr.a);
  }
  vec3 n = normalize(vX * nObj.x + vY * nObj.y + vZ * nObj.z);
  vec3 n0 = normalize(vX * p.x + vY * p.y + vZ * p.z);

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
  vec3 V = normalize(-vView);
  // Polished faces catch the key light: sharp and bright where the ground is smooth, broad and dim
  // where it is rough.
  col += mix(vec3(1.0), uLight, 0.5) * gloss * pow(max(dot(n, normalize(uKey + V)), 0.0), shine) * (shine + 8.0) / 60.0 * (0.4 + 0.6 * key);
  col += emit;

  // A thin atmosphere: light caught at the edge, strongest towards the sun.
  float fres = pow(1.0 - max(dot(n0, V), 0.0), 3.0);
  float toward = 0.3 + 0.7 * max(dot(n0, uSun) + 0.35, 0.0);
  col += uAir * fres * toward * (0.55 + 0.6 * uHover);

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
  #include <colorspace_fragment>
}`;

// A cloud layer just above the ground: its own sphere, so it sits apart from the surface and turns
// a little faster than it.
const CLOUD_VERT = /* glsl */ `
varying vec3 vP;
varying vec3 vN;
varying vec3 vView;
void main() {
  vP = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const CLOUD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uCoverage;
uniform float uScale;
uniform float uOpacity;
uniform float uSwirl;
uniform vec3 uPole;
uniform float uSeed;
uniform float uTime;
uniform float uDim;
uniform vec3 uSun;
uniform vec3 uKey;
varying vec3 vP;
varying vec3 vN;
varying vec3 vView;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 3; i++) { s += a * noise(p); p = p * 2.03 + 5.1; a *= 0.5; } return s; }
vec3 turn(vec3 v, vec3 k, float a) { return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }
void main() {
  vec3 p = normalize(vP);
  // Celestial clouds wind round the vortex; others drift along the latitudes.
  if (uSwirl > 0.5) p = turn(p, uPole, 3.0 * exp(-(1.0 - dot(p, uPole)) * 2.4));
  vec3 q = vec3(p.x, p.y * 1.6, p.z) * uScale + uSeed + vec3(uTime * 0.008, 0.0, 0.0);
  float c = fbm(q);
  float a = smoothstep(uCoverage, uCoverage + 0.18, c) * uOpacity * mix(1.0, 0.4, uDim);
  if (a < 0.01) discard;
  vec3 n = normalize(vN);
  float light = 0.18 + 0.62 * max(dot(n, uKey), 0.0) + 0.45 * max(dot(n, uSun), 0.0);
  // Thinner towards the limb, where the eye looks through less of the layer.
  a *= smoothstep(0.0, 0.35, dot(n, normalize(-vView)));
  gl_FragColor = vec4(uColor * light, a);
  #include <colorspace_fragment>
}`;

// Small rocks: a lumpy shape and plain stone, lit like the planets. Not the planet's own material.
const ROCK_VERT = /* glsl */ `
varying vec3 vN;
float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  // All of a planet's rocks are one instanced draw: each instance has its own place, turn and size.
  vec3 p = position * (0.78 + 0.4 * h(floor(position * 3.0) + instanceMatrix[3].xyz));
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}`;
const ROCK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSun;
uniform vec3 uKey;
uniform float uDim;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  vec3 col = uColor * (0.08 + 0.75 * max(dot(n, uKey), 0.0) + 0.6 * max(dot(n, uSun), 0.0)) * mix(1.0, 0.35, uDim);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
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
uniform float uGlow;
uniform vec3 uTint;
varying float vR;
float h(float x) { return fract(sin(x * 91.7 + uSeed) * 43758.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  float t = (vR - uIn) / (uOut - uIn);
  float bands = 0.25 + 0.75 * n1(t * 34.0) * n1(t * 9.0 + 4.0);
  float edge = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.86, t);
  float gap = 1.0 - 0.85 * smoothstep(0.02, 0.0, abs(t - 0.62));
  float a = bands * edge * gap * 0.55 * mix(1.0, 0.35, uDim);
  vec3 col = mix(uBase, uLight, n1(t * 21.0)) * 0.75;
  if (uGlow > 0.0) {
    // A fine ring of light: a bright thread with a soft skirt.
    float c = abs(t - 0.5) * 2.0;
    a = (exp(-c * c * 60.0) * 0.9 + exp(-c * c * 6.0) * 0.12) * uGlow * mix(1.0, 0.35, uDim);
    col = mix(uTint, vec3(1.0), exp(-c * c * 40.0) * 0.6);
  }
  gl_FragColor = vec4(col, a);
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
  clouds: Mesh<SphereGeometry, ShaderMaterial> | null;
  debris: Object3D | null;
  rockMaterial: ShaderMaterial | null;
  /** Removed from the system: anything still loading for it is thrown away when it arrives. */
  gone: boolean;
  /** The project's texture set: not asked for, waiting for the orbit to open, loading, or in use. */
  maps: 'none' | 'wanted' | 'loading' | 'done';
  textures: Texture[];
  /** Width of the texture set on the GPU now (0 for none), and of the one being fetched. */
  res: number;
  fetching: number;
  /** Cancels the fetch in flight. */
  abort: AbortController | null;
  size: number;
  /** Orbit, in Moon radii and radians. */
  orbit: { a: number; e: number; incl: number; node: number; angle: number; speed: number; spin: number };
  /** Animated values, written by tweens and read every frame. */
  live: { a: number; presence: number; hover: number; dim: number };
  shown: boolean;
  world: Vector3;
}

function blank(colour: boolean) {
  const t = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  t.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Why a file did not load: missing, refused by the server, or not reachable at all. */
async function whyNot(url: string): Promise<string> {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (r.status === 404) return 'not found: check the file name and the project slug';
    if (!r.ok) return `server answered ${r.status}`;
    return 'the file is there but could not be decoded as an image';
  } catch {
    return 'network error';
  }
}

const SLOT0 = 2.7;
const SLOT_STEP = 1.45;

export class PlanetSystem {
  readonly group = new Group();
  private bodies: Body[] = [];
  private sphere: SphereGeometry;
  private rock = new IcosahedronGeometry(1, 1);
  private time = { value: 0 };
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

  private quality: 'high' | 'medium' | 'low';

  /** 1×1 stand-ins with the same formats and sampling as the real maps, bound until those arrive:
   *  some drivers rebuild a shader when a texture's format or sampling changes, so the program
   *  prepared behind the loading screen stays the one used once the maps are in. */
  private blankColour = blank(true);
  private blankData = blank(false);

  /** Sends one texture to the GPU now (the renderer's initTexture). */
  private upload: (t: Texture) => void;

  constructor(quality: 'high' | 'medium' | 'low', upload: (t: Texture) => void) {
    this.quality = quality;
    this.upload = upload;
    this.sphere = new SphereGeometry(1, quality === 'high' ? 64 : quality === 'medium' ? 40 : 32, quality === 'high' ? 44 : quality === 'medium' ? 28 : 22);
    this.octaves = quality === 'high' ? 5 : 3;
    this.group.visible = false;
  }

  get ids() { return this.bodies.map((b) => b.def.id); }
  /** Share of the texture sets on the GPU, 0..1 (1 when there are none to load). */
  get loaded() { const want = this.bodies.filter((b) => b.maps !== 'none'); return want.length ? want.filter((b) => b.res > 0).length / want.length : 1; }
  /** Every texture set asked for is on the GPU (or has failed and fallen back). */
  get ready() { return this.bodies.length > 0 && this.bodies.every((b) => b.maps === 'done' || b.maps === 'none') && this.queue.length === 0 && this.active === 0; }
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

  // ---- Texture sets: streamed by priority ----
  // 1. Nothing is fetched until the projects section is near (prefetch).
  // 2. Then each planet's small set (512 wide), most important planet first, two at a time.
  // 3. A planet the visitor selects gets its large set (1024), ahead of everything else.
  // Every fetch can be cancelled (leaving the page); results for a removed planet are thrown away.
  // Decoding happens off the main thread; textures go to the GPU one per frame.

  /** Width of the set used in the general view, and the one for a selected planet. */
  // The baked sets are light (all four planets: ~140 KB at 256, ~410 KB at 512), so phones get 512
  // too; a planet seen close up on a computer gets its 1024 set.
  private get small() { return this.quality === 'low' ? 256 : 512; }
  private get large() { return this.quality === 'high' ? 1024 : this.small; }
  private wanted: { body: Body; width: number }[] = [];
  /** While the loading screen shows, every decoded texture goes to the GPU at once. */
  bulk = false;
  private active = 0;

  /** The section is near: fetch every planet's small set. */
  prefetch() {
    for (const b of this.bodies) if (b.maps === 'wanted' && !b.fetching && b.res === 0) this.request(b, this.small, false);
  }

  /** A planet is selected: its large set goes first. */
  sharpen(id: string) {
    const b = this.bodies.find((x) => x.def.id === id);
    if (!b || b.maps === 'none' || b.res >= this.large || b.fetching >= this.large) return;
    this.request(b, this.large, true);
  }

  /** Leaving the page: stop every fetch in flight and forget the ones waiting. */
  cancel() {
    this.wanted = [];
    for (const b of this.bodies) {
      b.abort?.abort();
      b.abort = null;
      if (b.fetching) { b.fetching = 0; if (b.maps === 'loading') b.maps = b.res ? 'done' : 'wanted'; }
    }
  }

  private request(b: Body, width: number, first: boolean) {
    this.wanted = this.wanted.filter((w) => w.body !== b);
    if (first) this.wanted.unshift({ body: b, width }); else this.wanted.push({ body: b, width });
    this.pump();
  }

  private pump() {
    while (this.active < 2 && this.wanted.length) {
      const { body, width } = this.wanted.shift()!;
      if (body.gone || body.res >= width) continue;
      this.active++;
      void this.fetchSet(body, width).finally(() => { this.active--; this.pump(); });
    }
  }

  private async fetchSet(b: Body, width: number) {
    b.abort?.abort();
    const abort = new AbortController();
    b.abort = abort;
    b.fetching = width;
    if (b.maps === 'wanted') b.maps = 'loading';
    const urls = ['albedo', 'normal', 'data'].map((n) => `/textures/planets/${b.def.id}_${n}_${width}.webp`);
    // Decoded off the main thread, flipped there, and with no colour conversion: data maps must
    // arrive exactly as stored.
    const decode = async (url: string) => {
      const res = await fetch(url, { signal: abort.signal });
      if (!res.ok) throw new Error(String(res.status));
      return createImageBitmap(await res.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    };
    const results = await Promise.allSettled(urls.map(decode));
    const bitmaps = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const stale = b.gone || abort.signal.aborted || b.abort !== abort;
    if (b.abort === abort) b.abort = null;
    if (stale || bitmaps.some((x) => !x)) {
      bitmaps.forEach((x) => x?.close());
      if (stale) return;
      b.fetching = 0;
      // A missing small set leaves the drawn surface; a missing large one keeps the small set.
      if (!b.res) b.maps = 'none'; else b.maps = 'done';
      for (const [i, url] of urls.entries()) if (!bitmaps[i]) console.warn(`[planets] ${b.def.id}: could not load ${url} (${await whyNot(url)}). ${b.res ? 'Keeping the smaller set.' : 'Keeping the drawn surface.'}`);
      return;
    }
    const maps = (bitmaps as ImageBitmap[]).map((bitmap, i) => {
      const t = new Texture(bitmap);
      t.flipY = false;
      // Albedo is colour (sRGB, decoded to linear by the GPU when sampled); the others are data.
      t.colorSpace = i === 0 ? SRGBColorSpace : NoColorSpace;
      t.wrapS = RepeatWrapping;
      t.wrapT = ClampToEdgeWrapping;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.anisotropy = this.quality === 'high' ? 4 : 2;
      t.generateMipmaps = true;
      t.needsUpdate = true;
      return t;
    });
    this.queue.push({ body: b, maps, next: 0, width });
  }

  /** Decoded maps waiting to go to the GPU, one per frame, so no frame does all the work. */
  private queue: { body: Body; maps: Texture[]; next: number; width: number }[] = [];

  private uploadOne() {
    if (this.bulk) { let n = 0; while (this.queue.length && n++ < 24) this.uploadNext(); return; }
    this.uploadNext();
  }

  private uploadNext() {
    const job = this.queue[0];
    if (!job) return;
    if (job.body.gone || job.body.res >= job.width) { job.maps.forEach((t) => { (t.image as ImageBitmap).close?.(); t.dispose(); }); this.queue.shift(); return; }
    this.upload(job.maps[job.next++]);
    if (job.next < job.maps.length) return;
    this.queue.shift();
    const b = job.body;
    // Swap only once the whole new set is on the GPU, then free the old one: no flicker.
    const old = b.textures;
    b.textures = job.maps;
    const u = b.body.material.uniforms;
    [u.uAlbedoMap.value, u.uNormalMap.value, u.uDataMap.value] = job.maps;
    u.uMaps.value = 1;
    old.forEach((t) => { (t.image as ImageBitmap).close?.(); t.dispose(); });
    b.res = job.width;
    if (b.fetching === job.width) b.fetching = 0;
    b.maps = 'done';
  }

  /** Show only these planets; the others leave and the orbits close up. */
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

  /** The shown planets in their order, with their world positions. Depends on which are shown only, so the
   *  framing changes in one step that the camera then blends. */
  shownWorld() { return this.bodies.filter((b) => b.shown).map((b) => b.world); }

  /** Radius of the outermost shown orbit, in Moon radii. */
  get reach() {
    const n = Math.max(1, this.bodies.filter((b) => b.shown).length);
    return SLOT0 + this.step * (n - 1) + 0.6;
  }

  /** Space between orbits: it narrows as projects are added, so a long list still fits the frame. */
  private get step() {
    return Math.min(SLOT_STEP, Math.max(0.72, 6.5 / Math.max(1, this.bodies.length)));
  }

  private make(def: PlanetDef, count: number): Body {
    const rnd = seeded(def.id);
    const accent = new Color(def.accent);
    // Each project's colour, pulled a little towards the violet of the site.
    const base = accent.clone().lerp(VIOLET, 0.12);
    const dark = accent.clone().multiplyScalar(0.22).lerp(DEEP, 0.45);
    const light = accent.clone().lerp(WHITE, 0.45);
    // The kinds of surface take turns down the list, so neighbours never look alike.
    const look = def.look ? LOOKS[def.look] : null;
    const type = look ? look.type : (def.rank + Math.floor(seeded('orbit')() * 3)) % 3;
    const sf = look?.surface ?? { relief: 4, fine: 0.8, displace: 0.02, emit: 0.6, albedo: 0.6, saturation: 1, polish: 0.3 };
    // Planets without a designed look: banded giants get a wide ring of their own colours.
    const ringConfig = look ? look.ring : type === 1 ? { inner: 1.4, outer: 2.25, glow: 0 } : undefined;
    const size = def.size
      ? (def.size === 'medium-large' ? 0.5 : 0.42)
      : (def.featured ? 0.5 - 0.045 * Math.min(def.rank, 4) : 0.3) * (0.92 + 0.16 * rnd());
    const second = new Color(def.accent2 ?? look?.second ?? '#bda5ec');
    // The halo: the planet's colour, leaning to its second colour where the look asks for it.
    const airColor = base.clone().lerp(new Color('#bda5ec'), look ? 0.15 : 0.5).lerp(second, look?.airMix ?? 0);
    // Points of light for the network look, spread evenly with a little disorder.
    const nodes = Array.from({ length: 10 }, (_, i) => {
      const y = 0.85 - (1.7 * (i + 0.5)) / 10 + (rnd() - 0.5) * 0.12;
      const a = i * 2.39996 + (rnd() - 0.5) * 0.5;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      return new Vector3(Math.cos(a) * r, y, Math.sin(a) * r).normalize();
    });

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
        uSecond: { value: second.clone().convertSRGBToLinear() },
        uAir: { value: airColor.clone().convertSRGBToLinear() },
        uNodes: { value: nodes },
        uPole: { value: new Vector3(...(look?.pole ?? [0.35, 0.45, 0.82])).normalize() },
        uTime: this.time,
        uMaps: { value: 0 },
        uAlbedoMap: { value: this.blankColour },
        uNormalMap: { value: this.blankData },
        uDataMap: { value: this.blankData },
        uSurface: { value: new Vector4(sf.relief, sf.fine, sf.emit, 0) },
        uSurface2: { value: new Vector4(sf.saturation, sf.polish, 0, sf.albedo) },
      },
    }));
    const air = new Mesh(this.sphere, new ShaderMaterial({
      vertexShader: AIR_VERT,
      fragmentShader: AIR_FRAG,
      uniforms: { uColor: body.material.uniforms.uAir, uSun: body.material.uniforms.uSun, uStrength: { value: look?.air ?? 0.9 } },
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
    if (ringConfig) {
      const { inner, outer, glow } = ringConfig;
      ring = new Mesh(new RingGeometry(inner, outer, 128, 1), new ShaderMaterial({
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        uniforms: { uBase: body.material.uniforms.uBase, uLight: body.material.uniforms.uLight, uSeed: { value: rnd() * 10 }, uDim: body.material.uniforms.uDim, uIn: { value: inner }, uOut: { value: outer }, uGlow: { value: glow }, uTint: body.material.uniforms.uSecond },
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
      }));
      // In the planet's equator, well clear of the ground and of the halo.
      ring.rotation.x = -Math.PI / 2;
      axis.add(ring);
    }

    let clouds: Body['clouds'] = null;
    // Low-end devices skip the secondary layers: the planet itself keeps its identity.
    if (look?.clouds && this.quality === 'high') {
      const c = look.clouds;
      clouds = new Mesh(this.sphere, new ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uColor: { value: new Color(c.color).convertSRGBToLinear() },
          uCoverage: { value: c.coverage },
          uScale: { value: c.scale },
          uOpacity: { value: c.opacity },
          uSwirl: { value: c.swirl ? 1 : 0 },
          uPole: body.material.uniforms.uPole,
          uSeed: { value: rnd() * 20 },
          uTime: this.time,
          uDim: body.material.uniforms.uDim,
          uSun: body.material.uniforms.uSun,
          uKey: body.material.uniforms.uKey,
        },
        transparent: true,
        depthWrite: false,
      }));
      clouds.scale.setScalar(1.035);
      axis.add(clouds);
    }

    let debris: Object3D | null = null;
    let rockMaterial: ShaderMaterial | null = null;
    if (look?.debris && this.quality === 'high') {
      rockMaterial = new ShaderMaterial({
        vertexShader: ROCK_VERT,
        fragmentShader: ROCK_FRAG,
        uniforms: { uColor: { value: new Color(look.debris.color).convertSRGBToLinear() }, uSun: body.material.uniforms.uSun, uKey: body.material.uniforms.uKey, uDim: body.material.uniforms.uDim },
      });
      debris = new Object3D();
      debris.rotation.set(0.5, 0, 0.25);
      const rocks = new InstancedMesh(this.rock, rockMaterial, look.debris.count);
      const place = new Object3D();
      for (let i = 0; i < look.debris.count; i++) {
        const a = (i / look.debris.count) * Math.PI * 2 + rnd() * 0.8;
        const r = 1.35 + rnd() * 0.4;
        place.position.set(Math.cos(a) * r, (rnd() - 0.5) * 0.25, Math.sin(a) * r);
        place.scale.set(0.025 + rnd() * 0.03, 0.02 + rnd() * 0.02, 0.025 + rnd() * 0.025);
        place.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
        place.updateMatrix();
        rocks.setMatrixAt(i, place.matrix);
      }
      // The rocks' bounds are not the base shape's: never cull them on that.
      rocks.frustumCulled = false;
      debris.add(rocks);
      holder.add(debris);
    }
    this.group.add(holder);

    return {
      def,
      holder,
      body,
      air,
      ring,
      clouds,
      debris,
      rockMaterial,
      gone: false,
      maps: def.textures ? 'wanted' : 'none',
      textures: [],
      res: 0,
      fetching: 0,
      abort: null,
      size,
      orbit: {
        a: SLOT0,
        // Circles centred on the Moon. (The draw is still taken, so the other values stay as they were.)
        e: rnd() * 0,
        incl: (rnd() - 0.5) * 0.24,
        node: rnd() * Math.PI * 2,
        // Start spread around the Moon, each a little off an even share.
        angle: (def.rank / Math.max(1, count)) * Math.PI * 2 + rnd() * 0.35 + 0.4,
        speed: 0.92 + 0.16 * rnd(),
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
    b.gone = true;
    b.abort?.abort();
    b.textures.forEach((t) => { (t.image as ImageBitmap).close?.(); t.dispose(); });
    b.textures = [];
    b.clouds?.material.dispose();
    b.rockMaterial?.dispose();
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
  update(o: { dt: number; weight: number; progress: number; moon: Vector3; moonRadius: number; turn: number }) {
    const on = o.weight > 0.001 && this.bodies.length > 0;
    this.group.visible = on;
    if (this.lastProgress < 0) this.lastProgress = o.progress;
    const scrolled = o.progress - this.lastProgress;
    this.lastProgress = o.progress;
    // Uploads happen on any frame, so they are done before the orbit is reached.
    this.uploadOne();
    if (!on) return;
    this.time.value += o.dt;
    this.group.position.copy(o.moon);
    this.group.rotation.y = o.turn;
    this.group.scale.setScalar(o.moonRadius);
    this.group.updateMatrixWorld();

    this.bodies.forEach((b, i) => {
      const k = b.orbit;
      const a = b.live.a;
      // Kepler-like: outer planets go round more slowly. The scroll also carries them along.
      k.angle += (0.24 * Math.pow(SLOT0 / a, 0.6) * k.speed) * o.dt + scrolled * 0.35 * Math.pow(SLOT0 / a, 0.5);
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
      if (b.debris) b.debris.rotation.y += 0.22 * o.dt;
      if (b.clouds) b.clouds.rotation.y += k.spin * 0.35 * o.dt;
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
      // The silhouette of a sphere seen from near is a little wider than its radius at that distance.
      const r = (radius / Math.max(Math.sqrt(Math.max(dist * dist - radius * radius, 1e-8)) * Math.tan((camera.fov * Math.PI) / 360), 1e-4)) * height * 0.5;
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
    this.rock.dispose();
    this.blankColour.dispose();
    this.blankData.dispose();
  }
}
