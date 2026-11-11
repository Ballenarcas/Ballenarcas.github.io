// Turns the scroll position into the state of the space scene, once per frame.
// It knows nothing about WebGL: a renderer (3D or the flat fallback) draws the state it is given.
import { eclipseFor, mixPose, poseFor, sunFor, type Pose, type PoseKey } from './poses';

export interface Frame extends Pose {
  time: number;
  /** 0 → 1 while the scene makes its entrance. */
  intro: number;
  /** Smoothed pointer position, -1..1 on both axes. */
  pointer: [number, number];
  /** How far the page has been scrolled, 0..1. */
  progress: number;
  /** 0 full violet Moon … 1 total eclipse. Follows the scroll of the whole page, smoothed. */
  eclipse: number;
  /** Direction towards the sun for that eclipse, in view space. */
  light: [number, number, number];
  /** Scroll offset in screens, for the parallax of the stars. */
  screens: number;
  /** How much the orbit of the projects is on: 0 away from it, 1 while its stage is pinned. Smoothed. */
  orbit: number;
  /** Progress through the orbit, 0..1, measured on the projects section only. Smoothed. */
  orbitProgress: number;
}

export interface SpaceRenderer {
  /** True when the picture changes by itself (stars twinkle, the Moon turns) and needs frames while idle. */
  readonly alive: boolean;
  /** True while the renderer is in the middle of something that needs every frame (a camera move). */
  readonly busy?: boolean;
  draw(frame: Frame): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

interface Anchor { top: number; key: PoseKey }
interface Track { top: number; height: number }

/** The orbit of the projects runs only with the 3D scene; the class is set before the page is measured. */
export const orbitOn = () => document.documentElement.classList.contains('orbit-on');

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export class SpaceController {
  private renderer: SpaceRenderer | null = null;
  private anchors: Anchor[] = [];
  private current: Pose | null = null;
  private eclipse = -1;
  private track: Track | null = null;
  private orbit = [0, 0];
  private pointer: [number, number] = [0, 0];
  private pointerTarget: [number, number] = [0, 0];
  private raf = 0;
  private last = 0;
  private introStart = 0;
  private width = 1;
  private height = 1;
  private maxScroll = 1;
  private lastY = -1;
  private idle = 0;
  private observer: ResizeObserver | null = null;
  /** Follow speed. Lower right after a page change, so the Moon glides to its new place. */
  private follow = 7;
  private readonly animate: boolean;
  onFrame: ((frame: Frame) => void) | null = null;

  constructor(options: { animate: boolean }) {
    this.animate = options.animate;
    addEventListener('resize', this.measure, { passive: true });
    if (this.animate) addEventListener('pointermove', this.onPointer, { passive: true });
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  attach(renderer: SpaceRenderer) {
    this.renderer?.dispose();
    this.renderer = renderer;
    this.introStart = performance.now();
    this.measure();
    this.start();
  }

  /** Read the scenes of the page that is now on screen. Call it after every navigation. */
  bind() {
    this.observer?.disconnect();
    this.observer = new ResizeObserver(this.measure);
    this.observer.observe(document.body);
    this.follow = 2.2;
    this.measure();
  }

  private measure = () => {
    this.width = innerWidth;
    this.height = innerHeight;
    const orbit = orbitOn();
    this.anchors = [...document.querySelectorAll<HTMLElement>('[data-pose]')].map((el) => {
      const key = el.dataset.pose as PoseKey;
      // With the orbit on, the projects open on a central Moon, the hub of the system.
      return { top: el.getBoundingClientRect().top + scrollY, key: key === 'projects' && orbit ? 'orbit' : key };
    });
    const track = orbit ? document.querySelector<HTMLElement>('[data-orbit-track]') : null;
    this.track = track ? { top: track.getBoundingClientRect().top + scrollY, height: track.offsetHeight } : null;
    this.maxScroll = Math.max(1, document.documentElement.scrollHeight - this.height);
    this.lastY = -1;
    this.renderer?.resize(this.width, this.height);
  };

  private onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.pointerTarget = [(e.clientX / this.width) * 2 - 1, -((e.clientY / this.height) * 2 - 1)];
  };

  /** The pose the scroll position asks for. Each scene holds its pose and hands over to the next one
   *  during the last screen of its own scroll, while the next scene comes in. */
  private target(y: number): Pose {
    const aspect = this.width / this.height;
    const list = this.anchors;
    if (!list.length) return poseFor('page', aspect);
    let i = 0;
    while (i < list.length - 1 && y >= list[i + 1].top) i++;
    const here = poseFor(list[i].key, aspect);
    const next = list[i + 1];
    if (!next) return here;
    const holdEnd = Math.max(list[i].top, next.top - this.height);
    // The handover is over a little before the next scene reaches the top, so its text arrives on a settled sky.
    const end = Math.max(holdEnd + 1, next.top - this.height * 0.3);
    const t = clamp01((y - holdEnd) / (end - holdEnd));
    return mixPose(here, poseFor(next.key, aspect), smooth(t));
  }

  /** Orbit weight and progress for a scroll position. Both are measured on the track of the projects:
   *  the weight rises as its stage pins and falls back to 0 before the stage leaves, so the Moon's own
   *  handover to the next scene never overlaps the orbit. */
  private orbitFor(y: number): [number, number] {
    const t = this.track;
    if (!t) return [0, 0];
    const vh = this.height;
    const pinEnd = t.top + t.height - vh;
    const inA = t.top - 0.35 * vh;
    const inB = t.top + 0.25 * vh;
    const outB = Math.max(inB + 1, pinEnd - 0.1 * vh);
    const outA = Math.max(inB, outB - 0.6 * vh);
    const weight = smooth(clamp01((y - inA) / (inB - inA))) * (1 - smooth(clamp01((y - outA) / (outB - outA))));
    return [weight, clamp01((y - inB) / Math.max(1, outA - inB))];
  }

  private start() {
    if (this.raf || !this.renderer) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (now: number) => {
    this.raf = this.animate ? requestAnimationFrame(this.tick) : 0;
    const elapsed = (now - this.last) / 1000;
    const dt = Math.min(0.05, elapsed);
    this.last = now;
    const y = scrollY;
    // Nothing moved: a still picture needs no new frame, a live one gets by on half of them.
    const pointerMoving = Math.abs(this.pointerTarget[0] - this.pointer[0]) + Math.abs(this.pointerTarget[1] - this.pointer[1]) > 0.002;
    const orbitTarget = this.orbitFor(y);
    const settling = Math.abs(eclipseFor(clamp01(y / this.maxScroll)) - this.eclipse) > 1e-4
      || Math.abs(orbitTarget[0] - this.orbit[0]) + Math.abs(orbitTarget[1] - this.orbit[1]) > 1e-4;
    const busy = y !== this.lastY || pointerMoving || settling || now - this.introStart < 3200 || this.follow < 7 || !!this.renderer?.busy;
    this.lastY = y;
    this.idle = busy ? 0 : this.idle + 1;
    if (this.idle > 30 && this.renderer && (!this.renderer.alive || this.idle % 2 === 1)) return;
    const target = this.target(y);
    const progress = clamp01(y / this.maxScroll);
    const eclipseTarget = eclipseFor(progress);
    if (!this.current || !this.animate || this.eclipse < 0) { this.current = target; this.eclipse = eclipseTarget; this.orbit = orbitTarget; }
    else {
      this.follow = Math.min(7, this.follow + dt * 2.4);
      // Real elapsed time (up to a tenth of a second), so a slow device still settles on time.
      const k = 1 - Math.exp(-Math.min(0.1, elapsed) * this.follow);
      this.current = mixPose(this.current, target, k);
      // The same easing as the pose: one clock for placement and light.
      this.eclipse += (eclipseTarget - this.eclipse) * k;
      if (Math.abs(eclipseTarget - this.eclipse) < 1e-4) this.eclipse = eclipseTarget;
      for (const i of [0, 1]) {
        this.orbit[i] += (orbitTarget[i] - this.orbit[i]) * k;
        if (Math.abs(orbitTarget[i] - this.orbit[i]) < 1e-4) this.orbit[i] = orbitTarget[i];
      }
    }
    const kp = 1 - Math.exp(-dt * 3);
    this.pointer = [this.pointer[0] + (this.pointerTarget[0] - this.pointer[0]) * kp, this.pointer[1] + (this.pointerTarget[1] - this.pointer[1]) * kp];
    const frame: Frame = {
      ...this.current,
      time: now / 1000,
      intro: this.animate ? clamp01((now - this.introStart) / 2600) : 1,
      pointer: this.pointer,
      progress,
      eclipse: this.eclipse,
      light: sunFor(this.eclipse),
      screens: y / this.height,
      orbit: this.orbit[0],
      orbitProgress: this.orbit[1],
    };
    this.renderer?.draw(frame);
    this.onFrame?.(frame);
  };

  /** Draw one frame now (used when nothing animates: reduced motion). */
  refresh = () => { if (!this.raf) this.tick(performance.now()); };
}
