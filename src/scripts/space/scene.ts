// The 3D scene: stars in depth, a soft halo and the Moon, drawn with Three.js on one fixed canvas.
// This file is loaded on demand, after the page has painted.
import {
  AdditiveBlending,
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  Matrix3,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
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

export type Quality = 'high' | 'medium' | 'low';

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

// The surface. The palette, the relief, the cavities and the rims are baked into one violet map
// (tools/bake_moon.py), so the GPU does very little here: one texture read, the light of the eclipse,
// the shadow side and the rim. Kept this cheap on purpose: modest GPUs froze on the live version.
const MOON_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLight;
uniform mat3 uRot;
uniform float uExposure;
uniform float uAmbient;
uniform float uRim;
varying vec2 vUv;
varying vec3 vP;
varying vec3 vView;

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  vec3 p = normalize(vP);
  vec3 pW = normalize(uRot * p);
  vec3 V = normalize(-vView);
  vec3 surface = texture2D(uMap, vUv).rgb;

  // The sun of the eclipse, with a wide soft edge to its shadow; a full Moon is evenly lit.
  float facing = dot(pW, uLight);
  float day = smoothstep(-0.1, 0.3, facing);
  float key = 0.8 + 0.3 * dot(pW, normalize(vec3(-0.62, 0.5, 0.6)));
  vec3 col = surface * key * day * uExposure * 1.25;

  // Inside the shadow the Moon is still there, in deep violet.
  float wrap = smoothstep(-0.75, 0.2, facing);
  col += surface * vec3(0.72, 0.5, 1.0) * uAmbient * (1.0 - day) * (0.35 + 1.1 * wrap * wrap);

  // Rim light, strongest towards the sun.
  float fres = pow(1.0 - clamp(dot(pW, V), 0.0, 1.0), 3.5);
  vec2 limb = normalize(pW.xy + 1e-5);
  float side = length(uLight.xy) > 0.05 ? clamp(dot(limb, normalize(uLight.xy)), 0.0, 1.0) : 0.5;
  vec3 rimCol = mix(lin(vec3(0.643, 0.416, 0.839)), lin(vec3(0.812, 0.682, 0.941)), 0.4 + 0.3 * side);
  col += rimCol * fres * (uRim * (0.04 + 0.96 * side * side * side) + 0.07 * uExposure);

  // Tone curve on brightness only, so the violet keeps its colour in the highlights.
  float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= (1.0 - exp(-L * 1.7)) / max(L, 1e-4);
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
const AURA_SPAN = 2.2;

// The aura: a soft violet glow on one plane that faces the camera, behind the disc. Only simple
// curves, no noise loops: this plane can cover much of the screen, so every pixel must be cheap.
// With the eclipse the glow grows and leans towards the hidden sun.
const GLOW_FRAG = /* glsl */ `
uniform float uStrength;
uniform float uEclipse;
uniform vec2 uSun;
uniform float uTime;
uniform float uNear;
varying vec2 vUv;
const float SPAN = ${AURA_SPAN.toFixed(2)}; // half the plane, in Moon radii
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  vec2 q = (vUv - 0.5) * 2.0 * SPAN;
  float d = length(q);
  if (d < 0.985 || d > SPAN) discard;
  vec2 dir = q / d;
  float x = d - 1.0;
  float e = uEclipse;
  float toward = length(uSun) > 0.05 ? max(dot(dir, normalize(uSun)), 0.0) : 0.5;
  float lean = mix(1.0, 0.25 + 1.6 * pow(toward, 1.5), 0.85 * e);
  float edge = smoothstep(SPAN, SPAN * 0.6, d);
  float breathe = 0.93 + 0.07 * sin(uTime * 0.25);
  float ang = atan(dir.y, dir.x);
  // A few broad streamers: sums of sines round the disc, drifting slowly.
  float rays = 0.6 + 0.25 * sin(ang * 5.0 + uTime * 0.03) + 0.15 * sin(ang * 11.0 - uTime * 0.02);
  float core = exp(-x / 0.06);
  float wide = exp(-x / mix(0.3, 0.55, e));
  float streams = exp(-x / mix(0.2, 0.5, e)) * rays * (0.1 + 0.8 * e * e);
  vec3 VIOLET = lin(vec3(0.5, 0.27, 0.84));
  vec3 LAV = lin(vec3(0.8, 0.66, 1.0));
  vec3 sum = VIOLET * wide * (0.2 + 0.32 * e) * breathe + LAV * core * (0.5 + 0.5 * e) * breathe + mix(VIOLET, LAV, 0.5) * streams;
  sum *= lean * edge * uStrength * (1.0 - 0.55 * uNear);
  float I = max(max(sum.r, sum.g), sum.b);
  if (I < 1e-4) discard;
  gl_FragColor = vec4(sum / I, I);
  #include <colorspace_fragment>
}`;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const UP = new Vector3(0, 1, 0);
/** The camera's drift round the Moon for a progress through the orbit: a few degrees, no more. */
const orbitYaw = (s: number) => 0.35 + s * 0.3;

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
  private pixelRatio: number;
  private maxRatio: number;
  // Frame-time watch: if the device cannot keep up, quality steps down by itself.
  private slow = 0;
  private frames = 0;
  private lastTime = 0;

  /** Called once if the device cannot keep up even at the lowest resolution. */
  onTooSlow: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private quality: Quality, strict = true) {
    // No multisampling, the default GPU (asking for the fast one can wake a second GPU and stall the
    // whole browser while it switches), and no 3D at all on a software renderer.
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'default', failIfMajorPerformanceCaveat: strict });
    // Start low; the frame watch raises the resolution while the device keeps up.
    this.maxRatio = Math.min(devicePixelRatio || 1, quality === 'high' ? 1.5 : quality === 'medium' ? 1.25 : 1);
    this.pixelRatio = Math.min(this.maxRatio, quality === 'low' ? 0.75 : 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    applyRig(this.camera, this.director.update(this.explore, 0));

    this.stars = this.makeStars(quality === 'high' ? 900 : quality === 'medium' ? 500 : 300);
    this.glow = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uStrength: { value: 0 }, uEclipse: { value: 0 }, uSun: { value: new Vector2() }, uTime: { value: 0 }, uNear: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending }),
    );
    this.moon = new Mesh(
      new SphereGeometry(1, quality === 'high' ? 72 : 48, quality === 'high' ? 48 : 32),
      new ShaderMaterial({
        vertexShader: MOON_VERT,
        fragmentShader: MOON_FRAG,
        uniforms: {
          uMap: { value: null },
          uLight: { value: new Vector3(0, 0, 1) },
          uRot: { value: new Matrix3() },
          uExposure: { value: 0 },
          uAmbient: { value: 0 },
          uRim: { value: 0 },
        },
      }),
    );
    this.moon.visible = false;
    this.stars.renderOrder = 0;
    this.glow.renderOrder = 1;
    this.moon.renderOrder = 2;
    this.planets = new PlanetSystem(quality, (t) => this.renderer.initTexture(t));
    this.scene.add(this.stars, this.glow, this.moon, this.planets.group);

    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

    // One baked map (the palette and the relief are in it). A small one first, for everyone; the
    // fastest tier gets the 1K map later, when the browser is idle.
    this.ready = this.loadMap('/textures/moon-violet-512.webp').then(() => {
      this.moon.visible = true;
      if (quality === 'high') {
        const later = () => void this.loadMap('/textures/moon-violet-1k.webp').catch(() => undefined);
        if ('requestIdleCallback' in window) requestIdleCallback(later, { timeout: 8000 }); else setTimeout(later, 4000);
      }
    });
  }

  /** Width of the Moon map in use: a map only ever replaces a smaller one, whatever order they arrive in. */
  private mapWidth = 0;

  private async loadMap(url: string) {
    const texture = await new TextureLoader().loadAsync(url);
    const width = (texture.image as { width: number }).width;
    if (width <= this.mapWidth) { texture.dispose(); return; }
    this.mapWidth = width;
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.anisotropy = Math.min(2, this.renderer.capabilities.getMaxAnisotropy());
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    // Uploaded now, then swapped in: the change of map never shows as a gap or a pause mid-scroll.
    this.renderer.initTexture(texture);
    const u = this.moon.material.uniforms;
    u.uMap.value = texture;
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
    // Leaving the orbit, the camera goes back to its plain place in front of the Moon. Unwinding its
    // trip round would spin everything backwards, so the Moon and the planets turn with it instead
    // and nothing is seen to rotate: the view simply pulls back.
    const through = f.orbitProgress;
    const on = f.orbit * f.orbit * (3 - 2 * f.orbit);
    const leaving = Math.min(1, Math.max(0, (through - 0.75) / 0.25));
    const carried = -(leaving * leaving * (3 - 2 * leaving)) * (orbitYaw(1) - on * orbitYaw(through));
    this.moon.quaternion.premultiply(this.turnY.setFromAxisAngle(UP, carried));
    this.moon.updateMatrixWorld();

    const dt = this.prevTime < 0 ? 0 : Math.min(0.1, Math.max(0, f.time - this.prevTime));
    this.prevTime = f.time;
    this.weight = f.orbit;
    this.moonAt.set(x, y, 0);
    this.planets.update({ dt, weight: f.orbit, progress: f.orbitProgress, moon: this.moonAt, moonRadius: radius, turn: carried });
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
    // How large the Moon really looks (the camera may be anywhere): half its height on screen.
    const distance = Math.max(radius * 1.001, this.camera.position.distanceTo(this.moonAt));
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    const apparent = radius / (Math.sqrt(distance * distance - radius * radius) * tanHalf) / 2;
    // The aura steps back when the Moon is large on screen.
    const zoom = Math.min(1, Math.max(0, (apparent - 0.45) / 0.9));

    const g = this.glow.material.uniforms;
    this.glow.position.copy(this.moonAt);
    // Facing the camera itself, so the aura meets the limb all round, even off-axis and close up.
    this.glow.lookAt(this.camera.position);
    // Inside the orbit the corona sits among the planets: the ones in front of the Moon hide it.
    this.glow.material.depthTest = f.orbit > 0.001;
    // Scaled to the silhouette, which is a little larger than the radius when seen from near.
    this.glow.scale.setScalar(radius * (distance / Math.sqrt(distance * distance - radius * radius)) * 2 * AURA_SPAN);
    g.uStrength.value = (0.5 + 0.8 * Math.pow(e, 2.0)) * intro;
    g.uEclipse.value = e;
    (g.uSun.value as Vector2).set(this.light.x, this.light.y);
    g.uTime.value = f.time;
    g.uNear.value = zoom;

    this.planets.light(this.camera, this.light);

    // The stars turn with the camera, so a move round the Moon reads as travel.
    const rig = this.director.rig;
    const s = this.stars.material.uniforms;
    (s.uShift.value as Vector2).set(f.pointer[0] * -0.006 - (rig.yaw - carried) * 0.08, f.screens * 0.05 + f.pointer[1] * -0.006 + rig.pitch * 0.12);
    s.uTime.value = f.time;
    s.uFade.value = Math.min(1, f.intro * 2.2);

    this.renderer.render(this.scene, this.camera);
    this.warm();
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

  /** The exploration: the system comes in, holds still while the section scrolls, and goes. */
  private makeOrbitRig(s: number) {
    const r = this.orbitRig;
    const reach = this.planets.reach * this.moon.scale.x;
    // A steady view of the whole system, centred on the Moon: no zoom, no lean, only a slow drift round.
    r.target.copy(this.moonAt);
    r.yaw = orbitYaw(s);
    r.pitch = 0.36;
    // Wide enough for the outermost orbit with room to spare, so the system is seen from afar.
    // On tall screens the view stops short of that, or the planets would be specks.
    r.frame = Math.min(this.aspect < 0.85 ? 2.1 : 3, Math.max(1.25, (reach * 1.12) / this.aspect));
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
    // Still centred on the Moon: the camera stands on the line from the Moon through the planet,
    // beyond the planet, so following it round its orbit is a turn about the Moon.
    r.target.copy(this.moonAt);
    const out = this.tmpV.copy(p.at).sub(this.moonAt);
    r.out = Math.hypot(out.x, out.z);
    r.lift = out.y;
    this.focusYaw = nearAngle(Math.atan2(out.x, out.z), this.focusYaw);
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
  private turnY = new Quaternion();

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

  setPlanets(defs: PlanetDef[]) {
    // Only the data: no shader is compiled and no texture fetched until the section comes near.
    this.planets.set(defs);
  }

  /** Draw the whole system once into a single pixel, far from the orbit, so the driver finishes
   *  preparing every shader before the first frame that shows the planets. */
  private warmed = true;
  private warm() {
    if (this.warmed || this.weight > 0.001) return;
    this.warmed = true;
    // Show everything for the one draw, then put every object's visibility back as it was.
    const shown: [Object3D, boolean][] = [];
    this.planets.group.traverse((o) => { shown.push([o, o.visible]); o.visible = true; });
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(0, 0, 1, 1);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
    for (const [o, v] of shown) o.visible = v;
  }

  /** The projects section is near: start streaming the planets' textures, and prepare their
   *  shaders with one tiny draw at the next quiet moment. Nothing of the planets is done before. */
  prefetchPlanets() {
    this.planets.prefetch();
    // In the background where the browser can compile in parallel; the tiny draw finishes the job.
    if (this.renderer.extensions.has('KHR_parallel_shader_compile')) {
      const shown = this.planets.group.visible;
      this.planets.group.visible = true;
      void this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
      this.planets.group.visible = shown;
    }
    this.warmed = false;
  }
  /** Leaving the page: stop fetching. */
  cancelPlanetLoads() { this.planets.cancel(); }
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
    // Close up, the planet gets its large texture set.
    if (id) this.planets.sharpen(id);
  }

  /** The planet under a point of the screen, in CSS pixels. */
  pick(x: number, y: number, margin = 22): string | null {
    if (this.weight < 0.5) return null;
    return this.planets.pick(this.camera, this.width, this.height, x, y, margin);
  }

  /** Steps quality down when frames keep arriving late. */
  /** Adaptive quality: every 40 frames, look at how many arrived late. Too many: drop the fine
   *  detail first, then the resolution a quarter step at a time (down to 0.75). Several smooth
   *  windows in a row: give a quarter step of resolution back. A frame counts as late under about
   *  22 fps, so the frames the controller skips on purpose when nothing moves are not mistaken
   *  for slowness. */
  private good = 0;
  private hopeless = 0;
  private watch(f: Frame) {
    const now = f.time;
    const dt = now - this.lastTime;
    this.lastTime = now;
    if (f.intro < 1 || dt <= 0 || dt > 0.25) return;
    this.frames++;
    if (dt > 0.045) this.slow++;
    if (this.frames < 40) return;
    if (this.slow > 12) {
      this.good = 0;
      if (this.pixelRatio > 0.5) this.setRatio(Math.max(0.5, this.pixelRatio - 0.25));
      // Still too slow at the lowest resolution, window after window: give up on 3D.
      else if (++this.hopeless >= 3 && this.onTooSlow) { const give = this.onTooSlow; this.onTooSlow = null; give(); }
    } else if (this.slow === 0 && ++this.good >= 4 && this.pixelRatio < this.maxRatio) {
      this.good = 0;
      this.setRatio(Math.min(this.maxRatio, this.pixelRatio + 0.25));
    }
    this.frames = 0;
    this.slow = 0;
  }

  private setRatio(ratio: number) {
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.stars.material.uniforms.uPx.value = ratio;
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
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
