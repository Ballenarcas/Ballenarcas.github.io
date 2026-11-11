// Motion layer: reveals, the hero project picker, the horizontal work scene and smooth scrolling.
// Everything here is an enhancement: with no script, or with reduced motion, the content is all visible.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let cleanups: Array<() => void> = [];

function reveals() {
  const items = document.querySelectorAll<HTMLElement>('[data-r]');
  if (reduced() || !('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((el) => io.observe(el));
  cleanups.push(() => io.disconnect());
}

function hero() {
  const root = document.querySelector<HTMLElement>('[data-hero]');
  if (!root) return;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-pick]')];
  const films = [...root.querySelectorAll<HTMLVideoElement>('[data-film]')];
  const link = root.querySelector<HTMLAnchorElement>('[data-now-link]');
  const title = root.querySelector<HTMLElement>('[data-now-title]');
  const tagline = root.querySelector<HTMLElement>('[data-now-tagline]');
  const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  let current = 0;
  let visible = true;

  const show = (n: number) => {
    current = n;
    const b = buttons[n];
    root.style.setProperty('--g', b.dataset.g!);
    root.style.setProperty('--i', b.dataset.i!);
    theme?.setAttribute('content', b.dataset.g!);
    buttons.forEach((x, i) => x.setAttribute('aria-pressed', String(i === n)));
    if (link) link.href = b.dataset.href!;
    if (title) title.textContent = b.dataset.title!;
    if (tagline) tagline.textContent = b.dataset.tagline!;
    films.forEach((v, i) => {
      v.classList.toggle('on', i === n);
      if (i === n) {
        if (!v.src) v.src = v.dataset.src!;
        if (!reduced() && visible) v.play().catch(() => {});
      } else v.pause();
    });
  };

  let timer = 0;
  const stop = () => { clearInterval(timer); timer = 0; };
  const start = () => { if (!timer && !reduced()) timer = window.setInterval(() => show((current + 1) % buttons.length), 9000); };
  buttons.forEach((b, i) => b.addEventListener('click', () => { stop(); show(i); }));
  root.addEventListener('pointerenter', stop);
  root.addEventListener('focusin', stop);

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    const v = films[current];
    if (visible) { if (!reduced()) v.play().catch(() => {}); start(); } else { v.pause(); stop(); }
  }, { threshold: 0.25 });
  io.observe(root);
  if (reduced()) films[0].setAttribute('controls', '');
  cleanups.push(() => { stop(); io.disconnect(); });
}

function work() {
  const section = document.querySelector<HTMLElement>('[data-work]');
  const track = section?.querySelector<HTMLElement>('.work-track');
  if (!section || !track || reduced()) return;
  const mm = gsap.matchMedia();
  mm.add('(min-width: 1024px)', () => {
    section.classList.add('is-h');
    const distance = () => track.scrollWidth - window.innerWidth;
    const tween = gsap.to(track, {
      x: () => -distance(),
      ease: 'none',
      scrollTrigger: { trigger: section, pin: true, scrub: true, end: () => `+=${distance()}`, invalidateOnRefresh: true, anticipatePin: 1 },
    });
    // Keyboard users: bring a focused panel into view by scrolling the page to its place in the scene.
    const onFocus = (e: FocusEvent) => {
      const panel = (e.target as HTMLElement).closest<HTMLElement>('[data-panel]');
      const st = tween.scrollTrigger;
      if (!panel || !st) return;
      section.scrollLeft = 0;
      window.scrollTo({ top: st.start + panel.offsetLeft, behavior: 'auto' });
    };
    track.addEventListener('focusin', onFocus);
    return () => { track.removeEventListener('focusin', onFocus); section.classList.remove('is-h'); gsap.set(track, { clearProps: 'transform' }); };
  });
  cleanups.push(() => mm.revert());
}

function films() {
  const vids = document.querySelectorAll<HTMLVideoElement>('video[data-autoplay]');
  if (!vids.length || reduced()) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target as HTMLVideoElement;
      if (e.isIntersecting) v.play().catch(() => {}); else v.pause();
    }
  }, { threshold: 0.5 });
  vids.forEach((v) => io.observe(v));
  cleanups.push(() => io.disconnect());
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
  reveals();
  hero();
  smooth();
  work();
  films();
  ScrollTrigger.refresh();
}

document.addEventListener('astro:page-load', init);
document.addEventListener('astro:before-swap', () => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  ScrollTrigger.getAll().forEach((st) => st.kill());
});
