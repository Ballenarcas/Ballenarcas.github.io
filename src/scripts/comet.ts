// A hidden comet, a nod to Your Name: stay on the opening screen for twenty seconds without scrolling and a comet
// crosses the sky, splitting in two on its way. Once per visit, never with reduced motion, and drawn
// on its own small 2D canvas behind the text only while it flies.
import { note } from './meteors';

// `?comet` in the address calls it after three seconds, to see it without waiting.
const asked = () => new URLSearchParams(location.search).has('comet');
const WAIT = 20_000;
const FLIGHT = 7500;
const SEEN = 'vm-comet';

function words() {
  return document.documentElement.lang === 'en'
    ? 'A comet splitting in two… do you remember its name?'
    : 'Un cometa que se parte en dos… ¿recuerdas su nombre?';
}

const seen = () => { if (asked()) return false; try { return sessionStorage.getItem(SEEN) === '1'; } catch { return false; } };

function fly() {
  try { sessionStorage.setItem(SEEN, '1'); } catch {}
  const canvas = document.createElement('canvas');
  canvas.className = 'comet';
  canvas.setAttribute('aria-hidden', 'true');
  // Inside the sky layer, over the Moon and behind all the text.
  (document.getElementById('space') ?? document.body).appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  const ratio = Math.min(devicePixelRatio || 1, 1.5);
  const w = (canvas.width = Math.round(innerWidth * ratio));
  const h = (canvas.height = Math.round(innerHeight * ratio));
  setTimeout(() => note(words(), 6000), FLIGHT * 0.45);

  // From high on one side to lower on the other, a slight curve; it splits a little past the middle.
  const left = Math.random() < 0.5;
  const a = { x: left ? -0.1 * w : 1.1 * w, y: 0.08 * h };
  const b = { x: left ? 1.1 * w : -0.1 * w, y: 0.62 * h };
  const bend = { x: (a.x + b.x) / 2, y: 0.12 * h };
  const at = (t: number) => ({
    x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * bend.x + t * t * b.x,
    y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * bend.y + t * t * b.y,
  });
  const SPLIT = 0.55;
  const start = performance.now();
  const trails: { x: number; y: number }[][] = [[], []];

  // A soft glowing head and a tapering tail of past positions.
  const draw = (trail: { x: number; y: number }[], head: string, tail: string, size: number, fade: number) => {
    for (let i = 1; i < trail.length; i++) {
      const k = i / trail.length;
      ctx.strokeStyle = `rgba(${tail}, ${0.55 * k * k * fade})`;
      ctx.lineWidth = size * (0.25 + 1.6 * k);
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    const p = trail[trail.length - 1];
    if (!p) return;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 9);
    g.addColorStop(0, `rgba(255, 255, 255, ${fade})`);
    g.addColorStop(0.15, `rgba(${head}, ${0.85 * fade})`);
    g.addColorStop(1, `rgba(${head}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 9, 0, Math.PI * 2);
    ctx.fill();
  };

  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / FLIGHT);
    // Slow at the ends, as if it came out of and went back into the distance.
    const s = t * t * (3 - 2 * t);
    const p = at(s);
    if (s < SPLIT) {
      trails[0].push(p);
    } else {
      // Two pieces drifting apart from the split, the smaller one a little faster.
      const d = (s - SPLIT) / (1 - SPLIT);
      const off = d * d * 0.09 * h;
      if (!trails[1].length) trails[1] = trails[0].slice();
      trails[0].push({ x: p.x, y: p.y - off * 0.4 });
      trails[1].push({ x: p.x - (left ? 1 : -1) * off * 0.35, y: p.y + off });
    }
    for (const tr of trails) if (tr.length > 110) tr.splice(0, tr.length - 110);
    const fade = Math.min(1, t / 0.12, (1 - t) / 0.15);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    draw(trails[0], '150, 120, 255', '120, 170, 255', 2.8 * ratio, fade);
    if (trails[1].length) draw(trails[1], '210, 140, 255', '190, 130, 255', 2.1 * ratio, fade);
    if (t < 1) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Arm the comet on a page with the opening screen; scrolling, a key or a tap starts the wait again (moving the mouse does not). */
export function comet(): () => void {
  const hero = document.getElementById('top');
  if (!hero || seen() || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  let timer = 0;
  const arm = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      // Only while the opening screen is in view and the tab is on show.
      if (document.hidden || scrollY > innerHeight * 0.4 || seen()) { arm(); return; }
      stop();
      fly();
    }, asked() ? 3000 : WAIT);
  };
  const events = ['scroll', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
  const stop = () => {
    clearTimeout(timer);
    for (const e of events) removeEventListener(e, arm);
  };
  for (const e of events) addEventListener(e, arm, { passive: true });
  arm();
  return stop;
}
