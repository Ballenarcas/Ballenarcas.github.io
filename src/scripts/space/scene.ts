// The 3D scene: stars in depth, a soft halo and the Moon, drawn with Three.js on one fixed canvas.
// This file is loaded on demand, after the page has painted.
import {
  AdditiveBlending,
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
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
varying vec3 vView;
void main() {
  vUv = uv;
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

// The surface. Three scales of geology:
//  1. Basins, maria and rays: the photograph (albedo) of the Clementine mission.
//  2. Craters, rims, ridges and walls: the real topography measured by LRO's laser altimeter (LOLA),
//     read as heights; their slopes tilt the normal, their curvature finds rims and floors.
//  3. Craters too small for the map: a procedural crater field, shown only where its craters are a
//     few pixels wide or more, so it never shimmers.
const MOON_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uHeight;
uniform vec2 uHTexel;
uniform float uHeightOn;
uniform vec3 uLight;
uniform mat3 uRot;
uniform float uExposure;
uniform float uAmbient;
uniform float uRim;
uniform float uDetail;
uniform float uZoom;
uniform float uCraters;
uniform float uTime;
varying vec2 vUv;
varying vec3 vP;
varying vec3 vView;

// The Violet Moon palette, darkest maria to the brightest rays (sRGB, decoded below).
const vec3 NIGHT = vec3(0.071, 0.031, 0.122);  // #12081F
const vec3 DEEP = vec3(0.176, 0.086, 0.314);   // #2D1650
const vec3 PURPLE = vec3(0.388, 0.184, 0.6);   // #632F99
const vec3 SOFT = vec3(0.643, 0.416, 0.839);   // #A46AD6
const vec3 LAVENDER = vec3(0.812, 0.682, 0.941); // #CFAEF0
const vec3 LILAC = vec3(0.941, 0.894, 1.0);    // #F0E4FF
const vec3 MAGENTA = vec3(0.86, 0.55, 0.95);
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 violet(float t) {
  vec3 c = mix(lin(NIGHT), lin(DEEP), smoothstep(0.0, 0.22, t));
  c = mix(c, lin(PURPLE), smoothstep(0.18, 0.48, t));
  c = mix(c, lin(SOFT), smoothstep(0.42, 0.72, t));
  c = mix(c, lin(LAVENDER), smoothstep(0.66, 0.9, t));
  return mix(c, lin(LILAC), smoothstep(0.88, 1.0, t));
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

// Heights are stored compressed (tanh) in 8 bits; this gives kilometres back.
float heightKm(vec2 uv) {
  float x = clamp(texture2D(uHeight, uv).r, 0.003, 0.997) * 2.0 - 1.0;
  return 1.1 * log((1.0 + x) / (1.0 - x));
}

// One crater per cell at most, kept inside its cell, with a bowl, a raised rim and a skirt.
// Returns the slope it adds (object space) and its height (-1 floor … +0.35 rim), faded by lod.
vec4 crater(vec3 p, mat3 R, float scale, float seed, float density, float lod) {
  vec3 q = R * p * scale + seed;
  vec3 id = floor(q);
  if (hash(id + seed * 0.37) > density) return vec4(0.0);
  vec3 c = 0.3 + 0.4 * vec3(hash(id + 11.3), hash(id + 23.7), hash(id + 37.1));
  float rad = 0.06 + 0.1 * hash(id + 51.9);
  vec3 v = q - id - c;
  float len = length(v);
  float d = len / rad;
  if (d >= 1.8) return vec4(0.0);
  float h;
  float dh;
  if (d < 1.0) { h = -1.0 + 1.35 * d * d; dh = 2.7 * d; }
  else { float t = (d - 1.0) / 0.8; h = 0.35 * (1.0 - t) * (1.0 - t); dh = -0.875 * (1.0 - t); }
  // Older craters are shallower.
  float depth = 0.3 + 0.7 * hash(id + 71.3);
  vec3 g = transpose(R) * (dh * v / max(len, 1e-5)) * (0.42 * depth * lod);
  return vec4(g, h * depth * lod);
}

const mat3 R1 = mat3(0.7268, 0.2732, -0.6302, 0.2732, 0.7268, 0.6302, 0.6302, -0.6302, 0.4536);
const mat3 R2 = mat3(-0.6663, 0.5273, -0.5273, -0.5273, 0.1669, 0.8331, 0.5273, 0.8331, 0.1669);
const mat3 R3 = mat3(0.8824, 0.4555, 0.1176, -0.4555, 0.7648, 0.4555, 0.1176, -0.4555, 0.8824);
const mat3 R4 = mat3(-0.2288, 0.9478, -0.2223, -0.5697, 0.0548, 0.82, 0.7894, 0.3142, 0.5274);

// Visible share of a crater octave: 0 when its craters are under ~2 pixels wide.
float lodFor(float scale, float fw) { return smoothstep(2.0, 5.0, 0.2 / scale / fw); }

float noise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec3 p = normalize(vP);
  // East and north on the sphere at this point.
  vec3 T = normalize(vec3(p.z, 0.0, -p.x) + 1e-5);
  vec3 B = cross(p, T);

  // 2. The measured relief. Heights a pixel footprint apart give the slope (km per km) and the
  // curvature (rims stand above their surroundings, floors sit below).
  vec2 e = clamp(fwidth(vUv) * 0.75, uHTexel, uHTexel * 8.0);
  float hC = heightKm(vUv);
  float hL = heightKm(vUv - vec2(e.x, 0.0));
  float hR = heightKm(vUv + vec2(e.x, 0.0));
  float hD = heightKm(vUv - vec2(0.0, e.y));
  float hU = heightKm(vUv + vec2(0.0, e.y));
  float cosLat = max(sqrt(max(1.0 - p.y * p.y, 0.0)), 0.15);
  vec2 slope = vec2((hR - hL) / (2.0 * e.x * 10914.0 * cosLat), (hU - hD) / (2.0 * e.y * 5457.0));
  // Relief exaggerated for drama, a little less up close where the map runs out of detail.
  vec3 g = (slope.x * T + slope.y * B) * (2.8 - 1.4 * uZoom) * uHeightOn;
  float curve = (hC - 0.25 * (hL + hR + hD + hU)) * uHeightOn;

  // 3. Craters below the map's resolution, faded in by their size on screen.
  float fw = max(length(fwidth(p)), 1e-6);
  float craterShade = 0.0;
  if (uCraters > 0.5) {
    vec4 c;
    float l;
    l = lodFor(70.0, fw); if (l > 0.0) { c = crater(p, R1, 70.0, 3.1, 0.42, l); g += c.xyz; craterShade += c.w; }
    l = lodFor(150.0, fw); if (l > 0.0) { c = crater(p, R2, 150.0, 7.7, 0.5, l); g += c.xyz; craterShade += c.w; }
    if (uCraters > 1.5) {
      l = lodFor(320.0, fw); if (l > 0.0) { c = crater(p, R3, 320.0, 1.9, 0.55, l); g += c.xyz; craterShade += c.w; }
      l = lodFor(680.0, fw); if (l > 0.0) { c = crater(p, R4, 680.0, 5.3, 0.6, l); g += c.xyz; craterShade += c.w; }
    }
  }
  vec3 n = normalize(p - (g - dot(g, p) * p));

  vec3 albedo = texture2D(uMap, vUv).rgb;
  if (uDetail > 0.001) {
    // Fine grit for the closest views.
    float f = 900.0;
    float d = 0.00035;
    float n0 = fbm(p * f);
    float nT = fbm((p + T * d) * f);
    float nB = fbm((p + B * d) * f);
    n = normalize(n - uDetail * 0.0006 * ((nT - n0) * T + (nB - n0) * B) / d);
    albedo *= 1.0 + uDetail * (n0 - 0.5) * 0.12;
  }

  vec3 nW = normalize(uRot * n);
  vec3 pW = normalize(uRot * p);
  vec3 V = normalize(-vView);

  float rimLight = smoothstep(0.02, 0.3, curve);
  float cavity = smoothstep(0.02, 0.3, -curve);
  float a = lum(albedo);

  // 1. Violet as material: the brightness of the photograph runs through the palette, maria into
  // deep purple, highlands into violet and lavender, ray systems into lilac.
  float t = 0.07 + 0.93 * pow(smoothstep(0.08, 0.84, a), 0.85);
  t = clamp(t + 0.1 * craterShade, 0.0, 1.0);
  vec3 surface = violet(t);
  surface *= 1.0 - 0.3 * cavity;
  surface = mix(surface, lin(LAVENDER), 0.08 * rimLight);
  // Maria are not all alike: some lean indigo, some plum, in broad regions like real lava plains.
  float region = noise(p * 2.3 + 4.0) * 0.65 + noise(p * 5.7) * 0.35;
  float mare = 1.0 - smoothstep(0.3, 0.52, t);
  surface *= mix(vec3(1.0), mix(vec3(0.62, 0.72, 1.3), vec3(1.35, 0.8, 1.0), region) * (0.75 + 0.5 * region), 0.9 * mare);
  // A whisper of magenta in the brightest ground.
  surface = mix(surface, lin(MAGENTA) * 0.9, 0.12 * smoothstep(0.7, 0.95, t));

  // The sun of the eclipse, with a wide soft edge to its shadow.
  float facing = dot(pW, uLight);
  float day = smoothstep(-0.1, 0.3, facing);
  // Lunar reflectance (Lommel-Seeliger): a full Moon is evenly bright from centre to edge, and the
  // light only falls as the sun swings away. Relief stays visible through the slope of each facet.
  float mu0 = max(dot(nW, uLight), 0.0);
  float mu = max(dot(nW, V), 0.05);
  float lit = mix(mu0, 2.0 * mu0 / (mu0 + mu), 0.7) * day;

  // A fixed key light from the upper left models the relief at every phase, the full Moon included,
  // and rakes across it so small craters show their walls.
  vec3 K = normalize(vec3(-0.62, 0.5, 0.6));
  float relief = clamp(1.0 + (dot(nW, K) - dot(pW, K)) * 3.2 * (1.0 - 0.55 * uZoom), 0.25, 1.85);
  float key = 0.72 + 0.44 * dot(pW, K);

  vec3 col = surface * relief * key * lit * uExposure * 1.95;
  // Lavender sheen where the ground faces the key light; ray systems glow a little.
  float sheen = pow(max(dot(nW, normalize(K + V)), 0.0), 28.0);
  col += lin(SOFT) * sheen * 0.05 * lit * uExposure;
  col += lin(LILAC) * smoothstep(0.62, 0.86, a) * 0.16 * lit * uExposure;

  // Inside the shadow the Moon is still there: its relief stays readable in deep violet.
  float shade = 1.0 - day;
  float wrap = smoothstep(-0.75, 0.2, facing);
  vec3 umbra = surface * vec3(0.72, 0.5, 1.0) * relief * (0.5 + 0.5 * key);
  col += umbra * uAmbient * shade * (0.35 + 1.1 * wrap * wrap);

  // Rim light: the violet energy around the Moon catching its edge. Uneven along the limb (the same
  // slow pattern as the corona's streamers), strongest towards the sun and towards the key light.
  float ndv = clamp(dot(pW, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.5);
  vec2 limb = normalize(pW.xy + 1e-5);
  float drift = uTime * 0.02;
  float uneven = 0.45 + 0.95 * noise2(limb * 3.2 + vec2(drift, -drift));
  vec2 sunXY = uLight.xy;
  float side = length(sunXY) > 0.05 ? clamp(dot(limb, normalize(sunXY)), 0.0, 1.0) : 0.5;
  float keySide = 0.5 + 0.5 * dot(limb, normalize(K.xy));
  vec3 rimCol = mix(lin(SOFT), lin(LAVENDER), 0.4 + 0.3 * side);
  col += rimCol * fres * uneven * (uRim * (0.04 + 0.96 * side * side * side) + 0.07 * keySide * uExposure) * (0.5 + 0.5 * relief);

  // Tone curve on brightness only, so the violet keeps its colour in the highlights.
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= (1.0 - exp(-L * 1.7)) / max(L, 1e-4);
  // Grade: richer colour, the darkest tones falling towards deep purple.
  float G = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(G), col, 1.16), 0.0);
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

/** Half the size of the aura's plane, in Moon radii. */
const AURA_SPAN = 3.4;

// The aura: the Moon's own violet energy, drawn on one plane that faces the camera, behind the disc.
// Five layers, each with its own pace so they read as separate phenomena of one system:
//  - halo: a bright core hugging the limb and a wide soft glow; it breathes very slowly;
//  - filaments: corona-like streamers of uneven length and width, slowly drifting;
//  - aurora: thin wavy curtains on a few arcs around the Moon, flowing continuously;
//  - nebula: a small region of dark violet gas around the Moon, slowly evolving;
//  - particles: a few faint motes inside the gas, barely moving.
// With the eclipse the corona grows and leans towards the hidden sun until it leads the picture.
const GLOW_FRAG = /* glsl */ `
uniform float uStrength;
uniform float uEclipse;
uniform vec2 uSun;
uniform float uTime;
uniform float uNear;
uniform float uQuality;
uniform float uOrbit;
varying vec2 vUv;
const float SPAN = ${AURA_SPAN.toFixed(2)}; // half the plane, in Moon radii

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p, float oct) {
  float a = 0.5; float s = 0.0;
  for (int i = 0; i < 5; i++) { if (float(i) >= oct) break; s += a * noise(p); p = p * 2.02 + 3.7; a *= 0.5; }
  return s;
}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  vec2 q = (vUv - 0.5) * 2.0 * SPAN;
  float d = length(q);
  if (d < 0.985 || d > SPAN) discard;
  vec2 dir = q / d;
  float x = d - 1.0;                      // distance from the limb, in Moon radii
  float e = uEclipse;
  float t = uTime;
  float toward = length(uSun) > 0.05 ? max(dot(dir, normalize(uSun)), 0.0) : 0.5;
  // Towards the end of the eclipse the light leans to the side of the hidden sun.
  float lean = mix(1.0, 0.25 + 1.6 * pow(toward, 1.5), 0.85 * e);
  float edge = smoothstep(SPAN, SPAN * 0.66, d);
  float hi = uQuality;

  // Halo: core on the limb and wide glow, breathing (one slow cycle of ~25 s).
  float breathe = 0.93 + 0.07 * sin(t * 0.25);
  float core = exp(-x / 0.06);
  float wide = exp(-x / mix(0.3, 0.55, e));
  float halo = (core * (0.5 + 0.5 * e) + wide * (0.32 + 0.5 * e)) * breathe;

  // Filaments: noise around the disc (sampled on the direction, so there is no seam), warped so
  // the streamers bend, ridged so they are thin, with a length of their own each.
  float tf = t * 0.018;
  vec2 warp = vec2(noise(dir * 1.8 + vec2(tf, 0.0)), noise(dir * 1.8 + vec2(5.2, -tf))) - 0.5;
  // Soft streams carry most of the light; a few finer threads ride on them.
  vec2 fp = dir * 3.4 + warp * 0.7 + vec2(x * 0.12, -x * 0.08);
  float stream = noise(fp);
  float ridge = 1.0 - abs(noise(fp * 2.2 + 9.1) * 2.0 - 1.0);
  float thread = 0.15 + 0.85 * stream * stream + pow(ridge, 6.0) * 0.35 * hi * stream;
  float reach = mix(0.22, 0.45 + 1.1 * noise(dir * 2.4 + 17.0 + tf * 0.5), e);
  float filaments = thread * exp(-x / reach) * (0.12 + 1.2 * e * e);

  // Aurora: two thin curtains on wavy rings, shown on some arcs only, flowing round.
  float ta = t * 0.045;
  float ang = atan(dir.y, dir.x);
  float r1 = 0.2 + 0.05 * sin(ang * 3.0 + ta * 2.0) + 0.06 * (noise(dir * 2.2 + ta) - 0.5);
  // A soft lower edge and rays rising from it towards space, like an aurora's curtain.
  float below = exp(-pow(min(x - r1, 0.0) / 0.03, 2.0));
  float above = exp(-max(x - r1, 0.0) / 0.12);
  float curtain = below * above;
  // Folds of the curtain, uneven and rippling.
  float folds = 0.7 + 0.3 * sin(ang * 26.0 + noise(dir * 5.0 + ta) * 6.0 + ta * 2.0);
  // Only on one or two short arcs at a time, which wander slowly round.
  float arcs = smoothstep(0.62, 0.86, noise(dir * 1.1 + vec2(ta * 0.5, 2.0)));
  float aurora = curtain * folds * arcs * (0.16 + 0.16 * e) * hi + curtain * folds * arcs * 0.08 * (1.0 - hi);

  // Nebula: a small cloud of dark violet gas around the Moon, slowly turning over.
  float tn = t * 0.006;
  vec2 np = q * 0.75 + vec2(tn, -tn * 0.7);
  float gas = fbm(np + fbm(np * 0.8 + 11.0, 2.0 + hi) * 1.4, 3.0 + 2.0 * hi);
  float nebula = smoothstep(0.35, 0.85, gas) * exp(-x / 1.2) * (1.0 - 0.75 * uOrbit) * (0.16 + 0.1 * e);
  float knots = pow(smoothstep(0.62, 0.9, gas), 2.0) * exp(-x / 0.8) * 0.18 * (1.0 - 0.75 * uOrbit);

  // Particles: rare faint motes within the gas, drifting very slowly, twinkling out of step.
  float motes = 0.0;
  if (hi > 0.5) {
    vec2 mp = q * 9.0 + vec2(t * 0.004, t * 0.003);
    vec2 cell = floor(mp);
    float h = hash(cell);
    if (h > 0.86) {
      vec2 at = cell + 0.2 + 0.6 * vec2(hash(cell + 3.1), hash(cell + 7.7));
      float px = max(fwidth(mp.x), 1e-4) * 1.4;
      float r = length(mp - at);
      motes = exp(-r * r / (px * px)) * (0.4 + 0.6 * sin(t * (0.2 + h) + h * 40.0)) * smoothstep(0.3, 0.7, gas) * 0.5;
    }
  }

  // Colour: indigo gas, violet glow, lavender threads and core, a hint of magenta in the aurora.
  vec3 INDIGO = lin(vec3(0.17, 0.11, 0.42));
  vec3 GAS = lin(vec3(0.33, 0.15, 0.55));
  vec3 VIOLET = lin(vec3(0.5, 0.27, 0.84));
  vec3 LAV = lin(vec3(0.8, 0.66, 1.0));
  vec3 AUR = mix(lin(vec3(0.62, 0.34, 0.95)), lin(vec3(0.85, 0.5, 0.95)), noise(dir * 3.0 + ta));
  vec3 sum = VIOLET * wide * (0.32 + 0.5 * e) * breathe
           + LAV * core * (0.5 + 0.5 * e) * breathe
           + mix(VIOLET, LAV, 0.55) * filaments
           + AUR * aurora
           + mix(INDIGO, GAS, gas) * nebula + GAS * knots
           + LAV * motes;
  // The aura leans with the eclipse, steps back when the Moon is close, fades out before the edge.
  sum *= lean * edge * uStrength * (1.0 - 0.55 * uNear);
  float I = max(max(sum.r, sum.g), sum.b);
  if (I < 1e-4) discard;
  gl_FragColor = vec4(sum / I, I);
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
  private relief: Texture | null = null;
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
      new ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uStrength: { value: 0 }, uEclipse: { value: 0 }, uSun: { value: new Vector2() }, uTime: { value: 0 }, uNear: { value: 0 }, uQuality: { value: quality === 'high' ? 1 : 0 }, uOrbit: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending }),
    );
    this.moon = new Mesh(
      new SphereGeometry(1, quality === 'high' ? 128 : 72, quality === 'high' ? 96 : 54),
      new ShaderMaterial({
        vertexShader: MOON_VERT,
        fragmentShader: MOON_FRAG,
        uniforms: {
          uMap: { value: null },
          uHeight: { value: null },
          uHTexel: { value: new Vector2(1 / 2048, 1 / 1024) },
          uHeightOn: { value: 0 },
          uLight: { value: new Vector3(0, 0, 1) },
          uRot: { value: new Matrix3() },
          uExposure: { value: 0 },
          uAmbient: { value: 0 },
          uRim: { value: 0 },
          uDetail: { value: 0 },
          uZoom: { value: 0 },
          uCraters: { value: quality === 'high' ? 2 : 1 },
          uTime: { value: 0 },
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
      // The measured relief comes after the first picture; until then the surface is smooth.
      void this.loadHeight('/textures/moon-relief-2k.webp').catch(() => undefined);
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
    this.map?.dispose();
    this.map = texture;
  }

  /** The LOLA height map: data, not colour. */
  private async loadHeight(url: string) {
    const texture = await new TextureLoader().loadAsync(url);
    texture.colorSpace = NoColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    const u = this.moon.material.uniforms;
    u.uHeight.value = texture;
    u.uHTexel.value.set(1 / texture.image.width, 1 / texture.image.height);
    this.relief?.dispose();
    this.relief = texture;
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
    u.uTime.value = f.time;
    if (u.uHeight.value) u.uHeightOn.value = Math.min(1, u.uHeightOn.value + dt * 1.2);
    // How large the Moon really looks (the camera may be anywhere): half its height on screen.
    const distance = Math.max(radius * 1.001, this.camera.position.distanceTo(this.moonAt));
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    const apparent = radius / (Math.sqrt(distance * distance - radius * radius) * tanHalf) / 2;
    // Fine grain only matters once the Moon is large on screen.
    const zoom = Math.min(1, Math.max(0, (apparent - 0.45) / 0.9));
    u.uZoom.value = zoom;
    u.uDetail.value = this.detail * zoom;
    u.uCraters.value = this.quality === 'high' && this.detail > 0 ? 2 : 1;

    const g = this.glow.material.uniforms;
    this.glow.position.copy(this.moonAt);
    // Facing the camera itself, so the aura meets the limb all round, even off-axis and close up.
    this.glow.lookAt(this.camera.position);
    // Inside the orbit the corona sits among the planets: the ones in front of the Moon hide it.
    this.glow.material.depthTest = f.orbit > 0.001;
    // Scaled to the silhouette, which is a little larger than the radius when seen from near.
    this.glow.scale.setScalar(radius * (distance / Math.sqrt(distance * distance - radius * radius)) * 2 * AURA_SPAN);
    g.uStrength.value = (0.55 + 1.05 * Math.pow(e, 2.0)) * intro;
    g.uEclipse.value = e;
    (g.uSun.value as Vector2).set(this.light.x, this.light.y);
    g.uTime.value = f.time;
    g.uNear.value = zoom;
    g.uOrbit.value = f.orbit;
    // The quiet layers (fine threads, motes, gas detail) go first when the device is slow.
    g.uQuality.value = this.detail > 0 ? 1 : 0;

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
    const fit = Math.min(2.4, Math.max(1, (reach * 1.02) / this.aspect));
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
    // From a little above the plane of the orbits, so the other planets pass below the line of sight.
    r.pitch = 0.4;
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
  showPlanets(ids: string[]) {
    this.planets.show(ids);
    // The framing of the exploration changes with the planets on show: blend into it, never cut.
    if (this.director.source.kind === 'explore') this.director.follow({ kind: 'explore' }, 1.4);
  }
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
    this.relief?.dispose();
    this.moon.geometry.dispose();
    this.moon.material.dispose();
    this.glow.geometry.dispose();
    this.glow.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.renderer.dispose();
  }
}
