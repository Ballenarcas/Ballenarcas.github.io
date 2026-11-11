// Where the Moon is and how large, for every scene of the journey. Poses hold placement only:
// the light comes from one value, the eclipse, which follows the scroll of the whole page.
// x, y: centre of the Moon in half-viewport units (0,0 is the centre of the screen, +y is up).
// r: radius as a fraction of the viewport height. tilt, spin: rotation of the surface, in radians.

export interface Pose {
  x: number;
  y: number;
  r: number;
  tilt: number;
  spin: number;
}

export type PoseKey = 'hero' | 'about' | 'skills' | 'projects' | 'contact' | 'detail' | 'detail-end' | 'page';

const wide: Record<PoseKey, Pose> = {
  // 01 A small full violet Moon hanging in space.
  hero: { x: 0, y: 0.26, r: 0.17, tilt: 0.1, spin: 0 },
  // 02 It grows and drifts right while the shadow comes in from its far side.
  about: { x: 0.5, y: -0.04, r: 0.4, tilt: 0.16, spin: 0.35 },
  // 03 Half in shadow, it sinks to the bottom-right corner: the constellations take the sky.
  skills: { x: 1.06, y: -1.4, r: 0.32, tilt: 0.34, spin: 0.85 },
  // 04 Low orbit: a large Moon below the expeditions, only its edge still lit.
  projects: { x: 0, y: -1.36, r: 1.1, tilt: 0.62, spin: 1.35 },
  // 05 Total eclipse, centred behind the last words, with its violet corona.
  contact: { x: 0, y: -0.06, r: 0.3, tilt: 0.3, spin: 1.6 },
  // Inner pages: small and high in the corner, away from the reading column.
  detail: { x: 0.9, y: 0.68, r: 0.12, tilt: 0.3, spin: 0.6 },
  'detail-end': { x: 0, y: -0.06, r: 0.3, tilt: 0.3, spin: 1.2 },
  page: { x: 0.9, y: 0.68, r: 0.12, tilt: 0.14, spin: 0.3 },
};

// Portrait screens: the Moon stays out of the way of the text.
const tall: Record<PoseKey, Pose> = {
  hero: { ...wide.hero, x: 0, y: 0.34, r: 0.125 },
  about: { ...wide.about, x: 1.0, y: 0.9, r: 0.13 },
  skills: { ...wide.skills, x: 1.04, y: 0.92, r: 0.15 },
  projects: { ...wide.projects, x: 0, y: -2.25, r: 0.9 },
  contact: { ...wide.contact, y: 0.02, r: 0.2 },
  detail: { ...wide.detail, x: 1.0, y: 0.9, r: 0.11 },
  'detail-end': { ...wide['detail-end'], y: 0.02, r: 0.2 },
  page: { ...wide.page, x: 1.0, y: 0.9, r: 0.11 },
};

export function poseFor(key: PoseKey, aspect: number): Pose {
  return (aspect < 0.85 ? tall : wide)[key] ?? wide.hero;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  return {
    x: mix(a.x, b.x, t),
    y: mix(a.y, b.y, t),
    // Sizes are blended on a log scale, so the growth feels even.
    r: Math.exp(mix(Math.log(a.r), Math.log(b.r), t)),
    tilt: mix(a.tilt, b.tilt, t),
    spin: mix(a.spin, b.spin, t),
  };
}

/** The eclipse (0 full Moon … 1 total) for a scroll progress of the page (0 … 1). */
export function eclipseFor(progress: number): number {
  // A short calm at the top, so the first screen is a full Moon, then an even advance to the end.
  const t = Math.min(1, Math.max(0, (progress - 0.015) / 0.975));
  return t;
}

/** Direction towards the sun, in view space (+z is the viewer), for an eclipse value.
 *  The sun swings along one fixed path from in front of the Moon to almost behind it,
 *  so the shadow always enters from the same side and a thin rim stays lit at the end. */
export function sunFor(eclipse: number): [number, number, number] {
  const theta = eclipse * (150 * Math.PI) / 180;
  const s = Math.sin(theta);
  return [-s * 0.93, s * 0.37, Math.cos(theta)];
}
