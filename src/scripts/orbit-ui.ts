// The page side of the orbit of the projects: the planet labels, the hover and the selection,
// the project panel, Escape, and the filters. It never moves the camera itself: it asks the scene,
// whose single director owns the camera.
import type { MoonScene, OrbitState } from './space/scene';
import type { PlanetDef } from './space/planets';

export function orbitUi(scene: MoonScene): () => void {
  const stage = document.querySelector<HTMLElement>('[data-orbit-stage]');
  const panel = document.querySelector<HTMLElement>('[data-orbit-panel]');
  if (!stage || !panel) {
    scene.focus(null);
    return () => {};
  }
  const labels = [...stage.querySelectorAll<HTMLButtonElement>('[data-planet]')];
  const cards = [...panel.querySelectorAll<HTMLElement>('[data-card]')];
  const close = panel.querySelector<HTMLButtonElement>('[data-orbit-close]');
  const byId = new Map(labels.map((b) => [b.dataset.planet!, b]));
  let current: string | null = null;
  let returnTo: HTMLElement | null = null;
  let openTimer = 0;

  const defs: PlanetDef[] = labels.map((b, i) => ({
    id: b.dataset.planet!,
    accent: b.dataset.accent!,
    featured: b.dataset.featured === 'true',
    rank: i,
  }));
  scene.setPlanets(defs);
  scene.showPlanets(defs.map((d) => d.id));

  /** Select a planet (or none). The panel comes in once the camera is well on its way. */
  const select = (id: string | null, from: HTMLElement | null = null) => {
    if (id === current) return;
    const was = current;
    current = id;
    scene.focus(id);
    stage.classList.toggle('is-focus', !!id);
    labels.forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.planet === id)));
    clearTimeout(openTimer);
    if (id) {
      if (!was) returnTo = from ?? byId.get(id) ?? null;
      panel.classList.remove('open');
      panel.hidden = false;
      cards.forEach((c) => { c.hidden = c.dataset.card !== id; });
      const card = cards.find((c) => c.dataset.card === id);
      if (card) panel.setAttribute('aria-labelledby', card.querySelector('h3')?.id ?? '');
      openTimer = window.setTimeout(() => {
        panel.classList.add('open');
        close?.focus({ preventScroll: true });
      }, was ? 380 : 620);
    } else {
      panel.classList.remove('open');
      openTimer = window.setTimeout(() => {
        panel.hidden = true;
        cards.forEach((c) => { c.hidden = true; });
      }, 420);
      // Keyboard users land back on the planet they opened.
      const lost = panel.contains(document.activeElement) || document.activeElement === document.body;
      if (returnTo && lost && !returnTo.hidden) returnTo.focus({ preventScroll: true });
      returnTo = null;
    }
  };

  // Labels follow their planets. A planet behind the Moon cannot be picked until it comes out.
  scene.onOrbit = (s: OrbitState) => {
    stage.style.setProperty('--orbit', s.weight.toFixed(3));
    stage.classList.toggle('is-live', s.weight > 0.5);
    for (const spot of s.spots) {
      const b = byId.get(spot.id);
      if (!b) continue;
      const size = Math.max(44, spot.r * 2);
      b.style.transform = `translate3d(${(spot.x - size / 2).toFixed(1)}px, ${(spot.y - size / 2).toFixed(1)}px, 0)`;
      b.style.width = b.style.height = `${size.toFixed(1)}px`;
      const usable = spot.presence > 0.5 && !spot.behind && s.weight > 0.5;
      b.classList.toggle('is-off', !usable);
      b.style.opacity = (spot.presence * (spot.behind ? 0.25 : 1)).toFixed(3);
    }
    if (!s.spots.length) labels.forEach((b) => b.classList.add('is-off'));
    // Leaving the section closes the project: the camera goes back to the journey.
    if (current && s.weight < 0.45) select(null);
  };

  const onLabel = (e: Event) => {
    const b = e.currentTarget as HTMLButtonElement;
    if (b.classList.contains('is-off')) return;
    const id = b.dataset.planet!;
    select(current === id ? null : id, b);
  };
  const onEnter = (e: Event) => scene.hover((e.currentTarget as HTMLElement).dataset.planet ?? null);
  const onLeave = () => scene.hover(null);
  labels.forEach((b) => {
    b.addEventListener('click', onLabel);
    b.addEventListener('pointerenter', onEnter);
    b.addEventListener('pointerleave', onLeave);
    b.addEventListener('focus', onEnter);
    b.addEventListener('blur', onLeave);
  });

  // The open sky of the stage: a planet picked by ray, with a margin for fingers; empty sky closes.
  const sky = stage.querySelector<HTMLElement>('[data-orbit-sky]')!;
  const onSky = (e: MouseEvent) => {
    if (e.target !== sky) return;
    const id = scene.pick(e.clientX, e.clientY, 28);
    if (id) select(id);
    else if (current) select(null);
  };
  const onSkyMove = (e: PointerEvent) => {
    if (e.target !== sky || e.pointerType === 'touch') return;
    const id = scene.pick(e.clientX, e.clientY, 0);
    sky.style.cursor = id ? 'pointer' : '';
    scene.hover(id);
  };
  sky.addEventListener('click', onSky);
  sky.addEventListener('pointermove', onSkyMove);
  close?.addEventListener('click', () => select(null));
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && current) select(null); };
  document.addEventListener('keydown', onKey);

  // Filters: the planets of other categories leave and the orbits close up.
  const filter = document.querySelector<HTMLElement>('[data-filter]');
  const onFilter = (e: Event) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cat]');
    if (!button) return;
    const cat = button.dataset.cat!;
    const ids = labels.filter((b) => cat === '*' || (b.dataset.orbitCats ?? '').split('|').includes(cat)).map((b) => b.dataset.planet!);
    labels.forEach((b) => { b.hidden = !ids.includes(b.dataset.planet!); });
    scene.showPlanets(ids);
    if (current && !ids.includes(current)) select(null);
  };
  filter?.addEventListener('click', onFilter);

  return () => {
    clearTimeout(openTimer);
    document.removeEventListener('keydown', onKey);
    filter?.removeEventListener('click', onFilter);
    scene.onOrbit = null;
    scene.hover(null);
    // The camera flies back to the Moon while the next page comes in.
    scene.focus(null);
  };
}
