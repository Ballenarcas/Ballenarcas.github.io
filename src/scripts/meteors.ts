// A hidden meteor shower, a nod to Frieren: a shower of stars that only comes once every fifty years.
// It is called with the Konami code (↑ ↑ ↓ ↓ ← → ← → B A), or on a touch screen by tapping the title
// of the skills section five times in a row. Drawn on its own small 2D canvas over the page for a few
// seconds, then removed: nothing of it runs the rest of the time.

const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const SHOWER = 7000;

let running = false;

function words() {
  return document.documentElement.lang === 'en'
    ? 'A meteor shower like this only comes once every fifty years.'
    : 'Una lluvia de estrellas como esta solo pasa una vez cada cincuenta años.';
}

/** A quiet line of text at the foot of the screen, read out to screen readers too. */
export function note(text: string, ms: number) {
  const el = document.createElement('p');
  el.className = 'meteor-note hud';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 900); }, ms);
}

export function meteorShower() {
  if (running) return;
  running = true;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  note(words(), still ? 5000 : SHOWER);
  if (still) { setTimeout(() => { running = false; }, 5000); return; }

  const canvas = document.createElement('canvas');
  canvas.className = 'meteors';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); running = false; return; }
  const ratio = Math.min(devicePixelRatio || 1, 1.5);
  const size = () => {
    canvas.width = Math.round(innerWidth * ratio);
    canvas.height = Math.round(innerHeight * ratio);
  };
  size();
  addEventListener('resize', size);

  // All the meteors come from one radiant, high on one side, like a real shower.
  type Meteor = { x: number; y: number; vx: number; vy: number; life: number; age: number; len: number; width: number; tint: number };
  const meteors: Meteor[] = [];
  const angle = Math.PI * (0.62 + Math.random() * 0.1);
  const start = performance.now();
  let last = start;
  let spawn = 0;

  const frame = (now: number) => {
    const t = now - start;
    const dt = Math.min(50, now - last) / 1000;
    last = now;
    const w = canvas.width;
    const h = canvas.height;
    // Thickest in the middle of the shower, thinning out at both ends.
    const rate = t < SHOWER - 1500 ? 4 + 26 * Math.sin(Math.PI * Math.min(1, t / (SHOWER - 1500))) : 0;
    spawn += rate * dt;
    while (spawn >= 1) {
      spawn -= 1;
      const speed = (900 + Math.random() * 900) * ratio;
      const a = angle + (Math.random() - 0.5) * 0.12;
      meteors.push({
        x: Math.random() * w * 1.3 - w * 0.15,
        y: -Math.random() * h * 0.3,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0.5 + Math.random() * 0.9,
        age: 0,
        len: (60 + Math.random() * 160) * ratio,
        width: (0.6 + Math.random() * 1.4) * ratio,
        tint: Math.random(),
      });
    }
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.age += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.age > m.life) { meteors.splice(i, 1); continue; }
      const fade = Math.sin(Math.PI * (m.age / m.life));
      const k = m.len / Math.hypot(m.vx, m.vy);
      const tx = m.x - m.vx * k;
      const ty = m.y - m.vy * k;
      const head = m.tint < 0.7 ? '240, 228, 255' : '169, 138, 216';
      const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, `rgba(${head}, ${0.95 * fade})`);
      g.addColorStop(1, `rgba(${head}, 0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = m.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 250, 255, ${0.9 * fade})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.width * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    if (t < SHOWER || meteors.length) requestAnimationFrame(frame);
    else {
      removeEventListener('resize', size);
      canvas.remove();
      running = false;
    }
  };
  requestAnimationFrame(frame);
}

/** Listens once, for the whole visit: page changes keep it. */
export function meteorTriggers() {
  let typed = 0;
  addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    typed = key === CODE[typed] ? typed + 1 : key === CODE[0] ? 1 : 0;
    if (typed === CODE.length) { typed = 0; meteorShower(); }
  });
  // Touch screens have no arrows: five quick taps on the title of the skills section.
  let taps = 0;
  let lastTap = 0;
  document.addEventListener('click', (e) => {
    if (!(e.target as Element | null)?.closest?.('#skills h2')) return;
    const now = performance.now();
    taps = now - lastTap < 600 ? taps + 1 : 1;
    lastTap = now;
    if (taps >= 5) { taps = 0; meteorShower(); }
  });
}
