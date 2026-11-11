// Everything that moves. The space scene follows the scroll; the content gets its entrances,
// parallax and small interactions. With no script, or with reduced motion, all content is visible.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { SpaceController, type Frame } from './space/controller';
import { FlatRenderer } from './space/flat';

gsap.registerPlugin(ScrollTrigger);

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let cleanups: Array<() => void> = [];
let controller: SpaceController | null = null;

/** Which version of the scene this device gets. `?flat`, `?low` and `?high` force one, for testing. */
function tier(): 'high' | 'low' | 'flat' {
  const query = new URLSearchParams(location.search);
  if (query.has('flat')) return 'flat';
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData || (nav.deviceMemory ?? 8) <= 2) return 'flat';
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) return 'flat';
  probe.getExtension('WEBGL_lose_context')?.loseContext();
  const modest = matchMedia('(max-width: 820px)').matches || (nav.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4;
  if (query.has('high')) return 'high';
  return query.has('low') || modest ? 'low' : 'high';
}

/** Start the space scene once; it then lives across page changes. */
function space() {
  const root = document.getElementById('space');
  if (!root) return;
  if (controller) { controller.bind(); return; }
  // Reduced motion: a still Moon placed by CSS, nothing follows the scroll.
  if (reduced()) { root.classList.add('is-static'); return; }

  const canvas = root.querySelector('canvas')!;
  const picture = root.querySelector<HTMLElement>('.moon2d')!;
  controller = new SpaceController({ animate: true });
  controller.onFrame = telemetry;
  const flat = () => { root.classList.add('is-flat'); controller!.attach(new FlatRenderer(picture)); };
  const level = tier();
  if (level === 'flat') flat();
  else {
    import('./space/scene')
      .then(async ({ MoonScene }) => {
        const scene = new MoonScene(canvas, level);
        await scene.ready;
        controller!.attach(scene);
        root.classList.add('is-live');
      })
      .catch(flat);
  }
  controller.bind();
  (window as unknown as { __space?: SpaceController }).__space = controller;
}

// Distance to the surface, read out as the journey advances.
let lastReading = '';
function telemetry(frame: Frame) {
  const out = document.querySelector<HTMLElement>('[data-telemetry]');
  if (!out) return;
  const km = Math.round((384400 * Math.pow(1 - frame.progress, 3)) / 10) * 10;
  const text = frame.progress > 0.992 ? out.dataset.done! : `${km.toLocaleString(document.documentElement.lang)} km`;
  if (text !== lastReading) { out.textContent = text; lastReading = text; }
}

function reveals() {
  const items = document.querySelectorAll<HTMLElement>('[data-r]');
  if (reduced() || !('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -10% 0px' });
  items.forEach((el) => io.observe(el));
  cleanups.push(() => io.disconnect());
}

/** The rail of scenes at the side: marks the scene on screen. */
function rail() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-rail] a')];
  if (!links.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.toggleAttribute('aria-current', a.hash === `#${e.target.id}`));
    }
  }, { rootMargin: '-50% 0px -50% 0px' });
  document.querySelectorAll('section[id], footer[id]').forEach((el) => io.observe(el));
  cleanups.push(() => io.disconnect());
}

/** Scroll-linked moves of the content itself: each scene's parts drift at their own depth. */
function depth() {
  if (reduced()) return;
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (hero) {
    gsap.to(hero.querySelector('.hero-copy'), {
      yPercent: -28, opacity: 0, ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom 35%', scrub: true },
    });
    gsap.to(hero.querySelector('.scroll-cue'), {
      opacity: 0, ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: '18% top', scrub: true },
    });
  }
  document.querySelectorAll<HTMLElement>('[data-depth]').forEach((el) => {
    const amount = Number(el.dataset.depth) || 0.1;
    gsap.fromTo(el, { yPercent: amount * 60 }, {
      yPercent: -amount * 60, ease: 'none',
      scrollTrigger: { trigger: el.closest('article, section') ?? el, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  });
  cleanups.push(() => ScrollTrigger.getAll().forEach((st) => st.kill()));
}

/** Elements that lean a little towards the cursor. */
function lean() {
  const items = [...document.querySelectorAll<HTMLElement>('[data-lean]')];
  if (!items.length || reduced() || !matchMedia('(hover: hover)').matches) return;
  const setters = items.map((el) => ({
    x: gsap.quickTo(el, 'x', { duration: 0.9, ease: 'power3' }),
    y: gsap.quickTo(el, 'y', { duration: 0.9, ease: 'power3' }),
    k: Number(el.dataset.lean) || 10,
  }));
  const move = (e: PointerEvent) => {
    const px = e.clientX / innerWidth - 0.5;
    const py = e.clientY / innerHeight - 0.5;
    setters.forEach((s) => { s.x(px * s.k); s.y(py * s.k); });
  };
  addEventListener('pointermove', move, { passive: true });
  cleanups.push(() => removeEventListener('pointermove', move));
}

/** Expedition filters: show the projects of one category. */
function filters() {
  const bar = document.querySelector<HTMLElement>('[data-filter]');
  if (!bar) return;
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')];
  const items = [...document.querySelectorAll<HTMLElement>('[data-cats]')];
  const count = document.querySelector<HTMLElement>('[data-filter-count]');
  const apply = (cat: string) => {
    let shown = 0;
    items.forEach((el) => {
      const on = cat === '*' || (el.dataset.cats ?? '').split('|').includes(cat);
      el.hidden = !on;
      if (on) shown++;
    });
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === cat)));
    if (count) count.textContent = String(shown);
    controller?.bind();
    ScrollTrigger.refresh();
  };
  buttons.forEach((b) => b.addEventListener('click', () => apply(b.dataset.cat!)));
}

/** Clips play only while they are on screen. */
function clips() {
  const vids = document.querySelectorAll<HTMLVideoElement>('video[data-autoplay]');
  if (!vids.length) return;
  if (reduced()) { vids.forEach((v) => v.setAttribute('controls', '')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target as HTMLVideoElement;
      if (e.isIntersecting) { if (!v.src && v.dataset.src) v.src = v.dataset.src; v.play().catch(() => {}); }
      else v.pause();
    }
  }, { threshold: 0.35 });
  vids.forEach((v) => io.observe(v));
  cleanups.push(() => io.disconnect());
}

function menu() {
  const box = document.querySelector<HTMLDetailsElement>('[data-menu]');
  if (!box) return;
  box.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { box.open = false; }));
}

function smooth() {
  if (reduced()) return;
  const lenis = new Lenis({ anchors: true });
  lenis.on('scroll', ScrollTrigger.update);
  const tick = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  cleanups.push(() => { gsap.ticker.remove(tick); lenis.destroy(); });
}

function init() {
  document.documentElement.classList.add('ready');
  space();
  reveals();
  rail();
  smooth();
  depth();
  lean();
  filters();
  clips();
  menu();
  ScrollTrigger.refresh();
}

document.addEventListener('astro:page-load', init);
document.addEventListener('astro:before-swap', (event) => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  // The incoming page must know that scripts are running, or it shows its no-script fallbacks.
  (event as Event & { newDocument: Document }).newDocument.documentElement.classList.add('js', 'ready');
});
