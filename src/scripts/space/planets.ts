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
  DoubleSide,
  Group,
  IcosahedronGeometry,
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
   *  displace: how far the height map lifts the ground (in planet radii); gain: how much the
   *  albedo map's brightness varies the drawn colour; polish: how shiny the smoothest ground gets.
   *  emit and saturation are kept for maps whose patterns suit their planet (none in the pack). */
  surface: { relief: number; fine: number; displace: number; emit: number; gain: number; saturation: number; polish: number };
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
    surface: { relief: 5, fine: 0.9, displace: 0.025, emit: 0, gain: 0.5, saturation: 1, polish: 0.6 },
    ring: { inner: 1.6, outer: 1.7, glow: 0.6 },
    debris: { count: 5, color: '#8a8e9a' },
  },
  // Aceituna: green and olive country, mountains and dark valleys, ochre highlands, light cloud.
  organic: {
    type: 4, second: '#c9a23a', air: 0.45, airMix: 0.0,
    surface: { relief: 8, fine: 0.8, displace: 0.04, emit: 0, gain: 0.6, saturation: 1, polish: 0.12 },
    clouds: { color: '#f1efe6', coverage: 0.5, scale: 2.6, opacity: 0.55 },
    debris: { count: 6, color: '#9a8466' },
  },
  // Votify: violet crystal in facets, its network of light glowing in some regions only.
  network: {
    type: 5, second: '#ff4fd0', air: 1.1, airMix: 0.25,
    surface: { relief: 3, fine: 0.4, displace: 0.015, emit: 0, gain: 0.3, saturation: 1, polish: 0.7 },
  },
  // Cielith: night blue, a great vortex, violet cloud regions, a faint aurora.
  celestial: {
    type: 6, second: '#b9a6ff', air: 0.95, airMix: 0.6,
    surface: { relief: 2, fine: 0.3, displace: 0.01, emit: 0, gain: 0.3, saturation: 1, polish: 0.25 },
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
uniform sampler2D uHeightMap;
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
    float h = 0.5 * (textureLod(uHeightMap, uv, 1.0).r + textureLod(uHeightMap, vec2(1.0 - uv.x, uv.y), 1.0).r);
    float d = min(uv.x, 1.0 - uv.x);
    float hs = mix(h, textureLod(uHeightMap, uv, 1.0).r, smoothstep(0.0, 0.03, d));
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
uniform sampler2D uAlbedoMap;
uniform sampler2D uNormalMap;
uniform sampler2D uHeightMap;
uniform sampler2D uRoughMap;
uniform sampler2D uEmissiveMap;
uniform vec4 uSurface;  // relief, fine, emit, gain
uniform vec4 uSurface2; // saturation, polish, displace, -
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
float heightLod(vec2 uv, float lod) {
  float d = min(uv.x, 1.0 - uv.x);
  float h = textureLod(uHeightMap, uv, lod).r;
  if (d < 0.03) h = mix(textureLod(uHeightMap, vec2(1.0 - uv.x, uv.y), lod).r, h, 0.5 + 0.5 * smoothstep(0.0, 0.03, d));
  return h;
}

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

float ridged(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uOctaves) break;
    float r = 1.0 - abs(noise(p) * 2.0 - 1.0);
    s += a * r * r;
    p = p * 2.1 + 3.7;
    a *= 0.5;
  }
  return s;
}
// Cells: distance to the nearest centre, how close the nearest border is, and a number per cell.
vec3 cells(vec3 x) {
  vec3 i = floor(x);
  vec3 f = x - i;
  float d1 = 9.0;
  float d2 = 9.0;
  float id = 0.0;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) {
    vec3 g = vec3(float(a), float(b), float(c));
    vec3 o = vec3(hash(i + g + 1.7), hash(i + g + 9.2), hash(i + g + 5.4));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = hash(i + g + 3.3); } else if (d < d2) { d2 = d; }
  }
  return vec3(d1, d2 - d1, id);
}
vec3 turn(vec3 v, vec3 k, float a) { return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }
// One crater per cell at most: a bowl with a raised rim. -1 at the floor, +0.35 on the rim.
float craterH(vec3 q) {
  vec3 id = floor(q);
  if (hash(id + 4.1) > 0.6) return 0.0;
  vec3 c = 0.32 + 0.36 * vec3(hash(id + 11.3), hash(id + 23.7), hash(id + 37.1));
  float rad = 0.09 + 0.12 * hash(id + 51.9);
  float d = length(q - id - c) / rad;
  if (d >= 1.5) return 0.0;
  float depth = 0.4 + 0.6 * hash(id + 71.3);
  return (d < 1.0 ? -1.0 + 1.35 * d * d : 0.35 * pow(1.0 - (d - 1.0) / 0.5, 2.0)) * depth;
}
// Tech: where the grey crust has broken open (1) and where it is whole (0), with a jagged edge.
float broken(vec3 p) {
  float m = noise(p * 1.25 + uSeed) + 0.35 * (fbm(p * 4.5 + uSeed) - 0.5) + 0.12 * (noise(p * 14.0) - 0.5);
  return smoothstep(0.6, 0.64, m);
}
// Organic: cloud bands that wrap round the planet in wisps.
float wisps(vec3 p) {
  vec3 q = vec3(p.x * 2.2, p.y * 6.0, p.z * 2.2) + uSeed + vec3(uTime * 0.01, 0.0, 0.0);
  float bands = smoothstep(0.3, 0.0, abs(p.y - 0.42 + 0.12 * sin(p.x * 3.0 + uSeed))) + smoothstep(0.24, 0.0, abs(p.y + 0.38 + 0.1 * sin(p.z * 3.0)));
  return smoothstep(0.4, 0.68, fbm(q + fbm(q * 0.5))) * min(bands, 1.0);
}
// Network: billowing violet cloud over part of the globe.
float billows(vec3 p) {
  vec3 q = p * 2.4 + uSeed;
  float where = smoothstep(0.6, 0.72, noise(q * 0.7 + 3.0));
  float puff = 1.0 - abs(noise(q * 1.6 + fbm(q)) * 2.0 - 1.0);
  return where * smoothstep(0.25, 0.8, puff * 0.6 + fbm(q * 2.0) * 0.6);
}
// Celestial: the sky is wound round a vortex at the pole of the look.
vec3 swirl(vec3 p) {
  float d = 1.0 - dot(p, uPole);
  return turn(p, uPole, 3.4 * exp(-d * 2.6) + uTime * 0.02);
}
// …and clouds gather low on the globe.
float clouds(vec3 p) {
  vec3 q = p * 3.0 + uSeed;
  float low = smoothstep(-0.25, -0.6, p.y + 0.18 * sin(p.x * 4.0 + uSeed));
  float puff = 1.0 - abs(noise(q * 1.4 + fbm(q * 0.8)) * 2.0 - 1.0);
  return low * smoothstep(0.3, 0.85, puff * 0.55 + fbm(q * 1.8) * 0.65);
}

// Height of the ground (rock and ice) or of the cloud tops (gas), for a point on the unit sphere.
float height(vec3 p) {
  vec3 q = p * 2.6 + uSeed;
  if (uType > 5.5) return fbm(swirl(p) * 2.2 + uSeed) * 0.5;
  if (uType > 4.5) {
    // Rough crystal ground under the billows.
    return ridged(q * 1.5) * 0.5;
  }
  if (uType > 3.5) {
    // Mountain country: long sharp ridges, one great crater, cloud on top.
    float cr = length(p - uPole) / 0.34;
    float crater = cr < 1.0 ? -0.5 + 0.75 * cr * cr : 0.25 * smoothstep(1.5, 1.0, cr);
    return ridged(q * 1.25 + fbm(q * 0.7) * 0.8) * 1.1 + fbm(q * 4.0) * 0.2 + crater;
  }
  if (uType > 2.5) {
    // Cratered crust; the broken regions lie lower and smoother.
    float br = broken(p);
    float cr = craterH(q * 1.6) * 0.22 + craterH(q * 3.7 + 9.0) * 0.1 + craterH(q * 8.0 + 3.0) * 0.045;
    return mix(fbm(q * 1.8) * 0.3 + cr, fbm(q * 3.0) * 0.12 - 0.12, br);
  }
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
  vec3 nObj = p;
  float h = 0.0;
  vec3 albedo = vec3(0.0);
  // Light the surface gives off by itself: cracks, points, aurora.
  vec3 emit = vec3(0.0);
  float gloss = 0.0;
  float shine = 36.0;
  float d = 0.012;
  h = height(p);
  float hT = height(normalize(p + T * d));
  float hB = height(normalize(p + B * d));
  float bump = uType < 0.5 ? 0.9 : (uType < 1.5 ? 0.12 : (uType < 2.5 ? 0.35 : (uType < 3.5 ? 1.6 : (uType < 4.5 ? 1.5 : (uType < 5.5 ? 1.2 : 1.0)))));
  nObj = normalize(p - bump * ((hT - h) * T + (hB - h) * B) / d * 0.08);
  if (uType > 5.5) {
    // Celestial: night-blue streams of blue, cyan and violet wound into a vortex, lavender cloud
    // low on the globe, stars, an aurora and a soft light in the eye of the vortex.
    float cl = 0.0;
    vec3 sw = swirl(p);
    vec3 sq = vec3(sw.x * 1.3, sw.y * 4.2, sw.z * 1.3) + uSeed;
    float flow = fbm(sq + fbm(sq * 0.6) * 0.8);
    float bright = smoothstep(0.42, 0.7, flow);
    float thread = pow(1.0 - abs(noise(sq * 1.7 + 5.0) * 2.0 - 1.0), 5.0);
    albedo = mix(vec3(0.003, 0.006, 0.03), uBase * 0.4, smoothstep(0.3, 0.75, flow));
    vec3 stream = mix(vec3(0.08, 0.3, 1.0), vec3(0.25, 0.85, 1.0), smoothstep(0.55, 0.85, flow));
    stream = mix(stream, uSecond, smoothstep(0.45, 0.7, noise(sw * 1.8 + uSeed + 3.0)));
    emit += stream * (bright * 0.22 + thread * bright * 0.35) * (1.0 - cl);
    albedo = mix(albedo, mix(vec3(0.72, 0.72, 1.0), uSecond, 0.35), cl * 0.92);
    // The aurora: an oval round the vortex, like an aurora round a magnetic pole.
    vec3 axisA = normalize(cross(uPole, vec3(0.31, 0.9, 0.3)));
    float along = atan(dot(p, cross(axisA, uPole)), dot(p, axisA));
    float off = dot(p, uPole) - 0.55 + 0.05 * sin(along * 3.0 + uSeed) + 0.04 * (noise(p * 3.0 + uTime * 0.05) - 0.5);
    float band = exp(-pow(off / 0.05, 2.0));
    float part = smoothstep(0.35, 0.55, noise(vec3(along * 0.9, uSeed, uTime * 0.03)));
    float folds = 0.6 + 0.4 * sin(along * 22.0 + noise(p * 5.0) * 5.0 + uTime * 0.25);
    emit += mix(vec3(0.2, 0.75, 1.0), uSecond, 0.5 + 0.5 * sin(along * 2.0)) * band * part * folds * 0.6;
    vec3 sc = p * 15.0 + uSeed;
    vec3 si = floor(sc);
    float sh = hash(si + 2.2);
    if (sh > 0.95) {
      float sd = length(sc - si - 0.5);
      emit += mix(vec3(1.0), uSecond, 0.4) * smoothstep(0.18, 0.0, sd) * 1.3 * (1.0 - cl) * (0.6 + 0.4 * sin(uTime * (0.4 + sh) + sh * 30.0));
    }
    // The vortex: two spiral arms of lighter blue and lavender wound into a dark eye that glows softly.
    float dv = 1.0 - dot(p, uPole);
    vec3 v1 = normalize(cross(uPole, vec3(0.0, 0.0, 1.0)));
    vec3 v2 = cross(uPole, v1);
    float rv = sqrt(max(2.0 * dv, 0.0));
    float av = atan(dot(p, v2), dot(p, v1));
    float arms = 0.5 + 0.5 * sin(2.0 * av + 6.5 * log(rv + 0.03) - uTime * 0.04 + (noise(p * 6.0 + uSeed) - 0.5) * 2.0);
    float zone = smoothstep(0.95, 0.25, rv) * smoothstep(0.03, 0.12, rv);
    albedo = mix(albedo, mix(vec3(0.2, 0.3, 0.8), uSecond, 0.5), pow(arms, 3.0) * zone * 0.8);
    albedo *= 1.0 - 0.6 * smoothstep(0.14, 0.04, rv);
    emit += mix(vec3(0.3, 0.7, 1.0), uSecond, 0.5) * pow(arms, 5.0) * zone * 0.1;
    emit += mix(uSecond, vec3(0.6, 0.8, 1.0), 0.4) * (exp(-dv * 90.0) * 0.45 + exp(-dv * 14.0) * 0.06);
  } else if (uType > 4.5) {
    // Network: dark violet crystal with a web of magenta light and bright nodes, under lavender billows.
    float bl = 0.0;
    vec3 ce = cells(p * 3.4 + uSeed);
    // Each crystal is a flat face, tilted its own way: facets catch the light one by one.
    vec3 tilt = vec3(hash(vec3(ce.z * 91.0, 1.0, 2.0)), hash(vec3(ce.z * 57.0, 3.0, 1.0)), 0.0) - 0.5;
    nObj = normalize(nObj + (T * tilt.x + B * tilt.y) * 0.5);
    albedo = mix(uDark * 0.5, uBase * 0.7, 0.2 + 0.8 * ce.z);
    gloss = 0.4 * ce.z * (1.0 - bl);
    float open = 1.0 - smoothstep(0.05, 0.5, bl);
    // The fine web: the seams between crystals.
    float web = 1.0 - smoothstep(0.0, 0.016, ce.y);
    emit += uSecond * web * open * 0.55;
    float points = 0.0;
    float lines = 0.0;
    float warm = 0.0;
    for (int i = 0; i < 10; i++) {
      vec3 a = uNodes[i];
      float da = 1.0 - dot(p, a);
      float pt = exp(-da * 1400.0) * 1.4 + exp(-da * 160.0) * 0.25;
      points += pt;
      if (i == 2 || i == 6) warm += pt;
      for (int k = 1; k <= 2; k++) {
        if (k == 2 && (i - (i / 2) * 2) != 0) continue;
        vec3 b = uNodes[(i + k) - ((i + k) / 10) * 10];
        vec3 nn = normalize(cross(a, b));
        float inside = step(0.0, dot(cross(a, p), nn)) * step(0.0, dot(cross(p, b), nn));
        lines += (1.0 - smoothstep(0.0, 0.007, abs(dot(p, nn)))) * inside;
      }
    }
    emit += (mix(uSecond, vec3(1.0, 0.85, 1.0), 0.65) * points + vec3(1.0, 0.45, 0.2) * warm * 0.25
      + mix(uSecond, vec3(1.0, 0.8, 1.0), 0.35) * min(lines, 1.0) * 0.55) * (0.25 + 0.75 * open);
    // Billows: lavender on top, violet in their folds.
    vec3 cloud = mix(uBase * 0.3, vec3(0.42, 0.28, 0.8), smoothstep(0.3, 1.0, bl));
    albedo = mix(albedo, cloud, smoothstep(0.05, 0.4, bl));
  } else if (uType > 3.5) {
    // Organic: dark green valleys, olive slopes, gold and ochre on the sunlit ridges, white cloud.
    float g = h;
    albedo = mix(uDark * 0.7, uBase, smoothstep(0.2, 0.6, g));
    vec3 ochre = mix(uSecond, vec3(0.42, 0.3, 0.1), 0.35 + 0.4 * noise(p * 6.0 + uSeed));
    albedo = mix(albedo, ochre, smoothstep(0.6, 0.95, g) * (0.45 + 0.5 * smoothstep(0.4, 0.6, noise(p * 1.8 + uSeed + 9.0))));
    albedo = mix(albedo, uSecond * 1.3, smoothstep(0.95, 1.25, g) * 0.6);
    albedo *= 0.7 + 0.6 * fbm(p * 11.0 + uSeed);
  } else if (uType > 2.5) {
    // Tech: silver-grey cratered crust; where it has broken, dark blue depths crossed by veins of
    // ice-blue light, with glints where veins meet.
    float br = broken(p);
    albedo = mix(uDark * 1.5, uBase, smoothstep(-0.05, 0.3, h));
    albedo = mix(albedo, uLight, smoothstep(0.28, 0.45, h) * 0.5);
    albedo *= 0.8 + 0.4 * fbm(p * 13.0 + uSeed);
    // Thin dark cracks run across the whole crust; only the broken regions hold light.
    float crackLine = pow(1.0 - abs(noise(p * 5.0 + uSeed + fbm(p * 3.0) * 0.8) * 2.0 - 1.0), 7.0);
    crackLine *= smoothstep(0.3, 0.5, noise(p * 2.2 + uSeed + 7.0));
    albedo *= 1.0 - 0.85 * smoothstep(0.35, 0.8, crackLine) * smoothstep(0.02, 0.006, length(fwidth(p)));
    gloss = 0.35 * (1.0 - br);
    vec3 ce = cells(p * 4.2 + uSeed + (fbm(p * 6.0) - 0.5) * 0.5);
    vec3 depths = mix(vec3(0.006, 0.014, 0.06), vec3(0.03, 0.08, 0.26), ce.z * 0.8 + 0.2 * noise(p * 5.0));
    albedo = mix(albedo, depths, br);
    // Only some seams carry light, so the veins stay local.
    float vein = (1.0 - smoothstep(0.0, 0.012, ce.y)) * step(0.55, hash(vec3(ce.z * 31.0, 2.0, 7.0)));
    float glow = exp(-ce.y * 16.0) * 0.12;
    float glint = exp(-ce.x * ce.x * 260.0) * step(0.72, ce.z);
    // The edge of the break glows faintly too.
    float rim = br * (1.0 - br) * 4.0;
    emit += br * (mix(uSecond, vec3(0.92, 0.97, 1.0), 0.6) * vein * 1.25 + uSecond * glow + vec3(0.9, 0.96, 1.0) * glint * 0.8) + uSecond * rim * 0.15;
  } else if (uType < 0.5) {
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

  if (uMaps > 0.5) {
    // The project's texture set adds its relief to the drawn world. Its colour and light maps are
    // not used as colour: their patterns (blue blobs on Boost, a wavy web on Votify, spots on
    // Cielith) work against each planet's identity. Their brightness only varies the ground a little.
    mapCoords(p);
    // Near the poles an equirectangular map fans out into rays: there its detail fades out.
    float poleFade = smoothstep(0.74, 0.93, abs(p.y));
    // The pack's normal maps keep green pointing down (DirectX): flipped here. They are computed
    // from the height maps, so the two are used at two scales, not twice: coarse slopes from the
    // height map, fine detail from the normal map, hollows from fine minus coarse height.
    vec3 nm = tex(uNormalMap).xyz * 2.0 - 1.0;
    nm.y = -nm.y;
    vec2 size = vec2(textureSize(uHeightMap, 0));
    vec2 e = 6.0 / size;
    float hC = tex(uHeightMap).r;
    float hL = heightLod(suv - vec2(e.x, 0.0), 2.5);
    float hR = heightLod(suv + vec2(e.x, 0.0), 2.5);
    float hD = heightLod(suv - vec2(0.0, e.y), 2.5);
    float hU = heightLod(suv + vec2(0.0, e.y), 2.5);
    float cosLat = max(sqrt(max(1.0 - p.y * p.y, 0.0)), 0.2);
    vec2 slope = vec2((hR - hL) / (2.0 * e.x * 6.2832 * cosLat), (hU - hD) / (2.0 * e.y * 3.1416)) * (1.0 - poleFade);
    vec3 gm = (slope.x * T + slope.y * B) * uSurface.x * 0.02;
    nObj = normalize(nObj + (T * nm.x + B * nm.y) * uSurface.y * (1.0 - poleFade) - gm);
    float occ = clamp(1.0 + (hC - heightLod(suv, 5.0)) * 2.4 * (1.0 - poleFade), 0.6, 1.2);
    float lm = dot(tex(uAlbedoMap).rgb, vec3(0.2126, 0.7152, 0.0722));
    float lmAvg = dot(textureLod(uAlbedoMap, suv, 10.0).rgb, vec3(0.2126, 0.7152, 0.0722));
    albedo *= occ * clamp(1.0 + (lm - lmAvg) / max(lmAvg, 0.05) * uSurface.w * (1.0 - poleFade), 0.65, 1.35);
    // Roughness sets how sharp and how bright the highlights are.
    float rough = mix(tex(uRoughMap).r, textureLod(uRoughMap, suv, 10.0).r, poleFade);
    gloss *= 1.3 - rough;
    shine = mix(90.0, 10.0, rough);
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
float fbm(vec3 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 5.1; a *= 0.5; } return s; }
vec3 turn(vec3 v, vec3 k, float a) { return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }
void main() {
  vec3 p = normalize(vP);
  // Celestial clouds wind round the vortex; others drift along the latitudes.
  if (uSwirl > 0.5) p = turn(p, uPole, 3.0 * exp(-(1.0 - dot(p, uPole)) * 2.4));
  vec3 q = vec3(p.x, p.y * 1.6, p.z) * uScale + uSeed + vec3(uTime * 0.008, 0.0, 0.0);
  float c = fbm(q + fbm(q * 0.5) * 0.8);
  // Large clear regions between the cloud fields.
  c *= smoothstep(0.38, 0.56, noise(q * 0.45 + 9.0));
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
  vec3 p = position * (0.78 + 0.4 * h(floor(position * 3.0)));
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
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
  size: number;
  /** Orbit, in Moon radii and radians. */
  orbit: { a: number; e: number; incl: number; node: number; angle: number; speed: number; spin: number };
  /** Animated values, written by tweens and read every frame. */
  live: { a: number; presence: number; hover: number; dim: number };
  shown: boolean;
  world: Vector3;
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

  private quality: 'high' | 'low';

  /** Sends one texture to the GPU now (the renderer's initTexture). */
  private upload: (t: Texture) => void;

  constructor(quality: 'high' | 'low', upload: (t: Texture) => void) {
    this.quality = quality;
    this.upload = upload;
    this.sphere = new SphereGeometry(1, quality === 'high' ? 64 : 40, quality === 'high' ? 44 : 28);
    this.octaves = quality === 'high' ? 5 : 3;
    this.group.visible = false;
  }

  get ids() { return this.bodies.map((b) => b.def.id); }
  /** Every texture set asked for is on the GPU (or has failed and fallen back). */
  get ready() { return this.bodies.length > 0 && this.bodies.every((b) => b.maps === 'done' || b.maps === 'none') && this.queue.length === 0; }
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
    // Texture sets are fetched and decoded while the browser is idle, long before the orbit is
    // reached, so arriving at the section costs nothing.
    const later = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1200));
    for (const b of this.bodies) if (b.maps === 'wanted') later(() => void this.loadMaps(b));
  }

  /** Decoded maps waiting to go to the GPU, one per frame, so no frame does all the work. */
  private queue: { body: Body; maps: Texture[]; next: number }[] = [];

  private uploadOne() {
    const job = this.queue[0];
    if (!job) return;
    if (job.body.gone) { job.maps.forEach((t) => t.dispose()); this.queue.shift(); return; }
    this.upload(job.maps[job.next++]);
    if (job.next < job.maps.length) return;
    this.queue.shift();
    const b = job.body;
    b.textures = job.maps;
    const u = b.body.material.uniforms;
    [u.uAlbedoMap.value, u.uNormalMap.value, u.uHeightMap.value, u.uRoughMap.value, u.uEmissiveMap.value] = job.maps;
    u.uMaps.value = 1;
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
    const sf = look?.surface ?? { relief: 4, fine: 0.8, displace: 0.02, emit: 0.6, gain: 1, saturation: 1, polish: 0.3 };
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
        uAlbedoMap: { value: null },
        uNormalMap: { value: null },
        uHeightMap: { value: null },
        uRoughMap: { value: null },
        uEmissiveMap: { value: null },
        uSurface: { value: new Vector4(sf.relief, sf.fine, sf.emit, sf.gain) },
        uSurface2: { value: new Vector4(sf.saturation, sf.polish, this.quality === 'high' ? sf.displace : 0, 0) },
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
    if (look?.clouds) {
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
    if (look?.debris) {
      rockMaterial = new ShaderMaterial({
        vertexShader: ROCK_VERT,
        fragmentShader: ROCK_FRAG,
        uniforms: { uColor: { value: new Color(look.debris.color).convertSRGBToLinear() }, uSun: body.material.uniforms.uSun, uKey: body.material.uniforms.uKey, uDim: body.material.uniforms.uDim },
      });
      debris = new Object3D();
      debris.rotation.set(0.5, 0, 0.25);
      for (let i = 0; i < look.debris.count; i++) {
        const rock = new Mesh(this.rock, rockMaterial);
        const a = (i / look.debris.count) * Math.PI * 2 + rnd() * 0.8;
        const r = 1.35 + rnd() * 0.4;
        rock.position.set(Math.cos(a) * r, (rnd() - 0.5) * 0.25, Math.sin(a) * r);
        rock.scale.set(0.025 + rnd() * 0.03, 0.02 + rnd() * 0.02, 0.025 + rnd() * 0.025);
        rock.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
        debris.add(rock);
      }
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

  /** Load a project's five maps (only once the orbit is on screen) and hand them to its material.
   *  Until they are all in, and if any is missing, the planet keeps its drawn surface. Each failure
   *  is reported with the file and the reason. */
  private async loadMaps(b: Body) {
    if (b.maps !== 'wanted') return;
    b.maps = 'loading';
    const names = ['albedo', 'normal', 'height', 'roughness', 'emissive'] as const;
    const urls = names.map((n) => `/textures/planets/${b.def.id}_${n}.png`);
    // Decoded off the main thread (createImageBitmap), flipped there too, and with no colour
    // conversion: data maps must arrive exactly as stored.
    const decode = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const bitmap = await createImageBitmap(await res.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const t = new Texture(bitmap);
      t.flipY = false;
      return t;
    };
    const results = await Promise.allSettled(urls.map(decode));
    const maps = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    const failed = urls.filter((_, i) => !maps[i]);
    if (b.gone || failed.length) {
      maps.forEach((t) => t?.dispose());
      if (!b.gone) {
        b.maps = 'none';
        for (const url of failed) console.warn(`[planets] ${b.def.id}: could not load ${url} (${await whyNot(url)}). Keeping the drawn surface.`);
      }
      return;
    }
    const loaded = maps as Texture[];
    loaded.forEach((t, i) => {
      // Albedo is colour (sRGB, decoded to linear by the GPU when sampled); normal, height,
      // roughness and the emissive mask are plain data.
      t.colorSpace = i === 0 ? SRGBColorSpace : NoColorSpace;
      t.wrapS = RepeatWrapping;
      t.wrapT = ClampToEdgeWrapping;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.anisotropy = 4;
      t.generateMipmaps = true;
      t.needsUpdate = true;
    });
    this.queue.push({ body: b, maps: loaded, next: 0 });
  }

  private drop(b: Body) {
    b.gone = true;
    b.textures.forEach((t) => t.dispose());
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
    this.rock.dispose();
  }
}
