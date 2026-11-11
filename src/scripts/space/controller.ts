// Turns the scroll position into the state of the space scene, once per frame.
// It knows nothing about WebGL: a renderer (3D or the flat fallback) draws the state it is given.
import { mixPose, poseFor, type Pose, type PoseKey } from './poses';

export interface Frame extends Pose {
  time: number;
  /** 0 → 1 while the scene makes its entrance. */
  intro: number;
  /** Smoothed pointer position, -1..1 on both axes. */
  pointer: [number, number];
  /** How far the page has been scrolled, 0..1. */
  progress: number;
  /** Scroll offset in screens, for the parallax of the stars. */
  screens: number;
}

export interface SpaceRenderer {
  /** True when the picture changes by itself (stars twinkle, the Moon turns) and needs frames while idle. */
  readonly alive: boolean;
  draw(frame: Frame): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

interface Anchor { top: number; key: PoseKey }

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export class SpaceController {
  private renderer: SpaceRenderer | null = null;
  private anchors: Anchor[] = [];
  private current: Pose | null = null;
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
    this.anchors = [...document.querySelectorAll<HTMLElement>('[data-pose]')].map((el) => ({
      top: el.getBoundingClientRect().top + scrollY,
      key: el.dataset.pose as PoseKey,
    }));
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
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const y = scrollY;
    // Nothing moved: a still picture needs no new frame, a live one gets by on half of them.
    const pointerMoving = Math.abs(this.pointerTarget[0] - this.pointer[0]) + Math.abs(this.pointerTarget[1] - this.pointer[1]) > 0.002;
    const busy = y !== this.lastY || pointerMoving || now - this.introStart < 3200 || this.follow < 7;
    this.lastY = y;
    this.idle = busy ? 0 : this.idle + 1;
    if (this.idle > 30 && this.renderer && (!this.renderer.alive || this.idle % 2 === 1)) return;
    const target = this.target(y);
    if (!this.current || !this.animate) this.current = target;
    else {
      this.follow = Math.min(7, this.follow + dt * 2.4);
      this.current = mixPose(this.current, target, 1 - Math.exp(-dt * this.follow));
    }
    const k = 1 - Math.exp(-dt * 3);
    this.pointer = [this.pointer[0] + (this.pointerTarget[0] - this.pointer[0]) * k, this.pointer[1] + (this.pointerTarget[1] - this.pointer[1]) * k];
    const frame: Frame = {
      ...this.current,
      time: now / 1000,
      intro: this.animate ? clamp01((now - this.introStart) / 2600) : 1,
      pointer: this.pointer,
      progress: clamp01(y / this.maxScroll),
      screens: y / this.height,
    };
    this.renderer?.draw(frame);
    this.onFrame?.(frame);
  };

  /** Draw one frame now (used when nothing animates: reduced motion). */
  refresh = () => { if (!this.raf) this.tick(performance.now()); };
}
