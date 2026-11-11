// Where the Moon is, how large and how it is lit, for every scene of the journey.
// x, y: centre of the Moon in half-viewport units (0,0 is the centre of the screen, +y is up).
// r: radius as a fraction of the viewport height.
// light: direction towards the sun (it is normalised later). +z points at the viewer.
// tilt, spin: rotation of the surface, in radians. ambient: earthshine on the night side.

export interface Pose {
  x: number;
  y: number;
  r: number;
  light: [number, number, number];
  tilt: number;
  spin: number;
  exposure: number;
  ambient: number;
  glow: number;
}

export type PoseKey = 'hero' | 'about' | 'skills' | 'projects' | 'contact' | 'detail' | 'detail-end' | 'page';

const wide: Record<PoseKey, Pose> = {
  // 01 A small gibbous Moon hanging in space.
  hero: { x: 0, y: 0.26, r: 0.17, light: [-0.55, 0.35, 0.76], tilt: 0.1, spin: 0, exposure: 1.05, ambient: 0.012, glow: 0.5 },
  // 02 It grows and drifts right; the lit half faces the text.
  about: { x: 0.5, y: -0.04, r: 0.4, light: [-0.9, 0.22, 0.38], tilt: 0.16, spin: 0.35, exposure: 1.1, ambient: 0.014, glow: 0.42 },
  // 03 A large Moon low on the right; the constellations take the rest of the sky.
  skills: { x: 0.92, y: -0.66, r: 0.58, light: [-0.7, 0.62, 0.34], tilt: 0.34, spin: 0.85, exposure: 1.0, ambient: 0.016, glow: 0.3 },
  // 04 Low orbit over the night side: only the limb is lit, the ground below is in earthshine.
  projects: { x: 0, y: -1.36, r: 1.1, light: [0.2, 0.36, -0.91], tilt: 0.62, spin: 1.35, exposure: 1.15, ambient: 0.02, glow: 0.1 },
  // 05 Touchdown: the horizon at sunrise.
  contact: { x: 0, y: -6.86, r: 3.2, light: [0.18, 0.5, -0.42], tilt: 1.12, spin: 1.7, exposure: 1.35, ambient: 0.03, glow: 0 },
  // Inner pages.
  detail: { x: 0.78, y: -0.5, r: 0.62, light: [-0.8, 0.5, 0.1], tilt: 0.3, spin: 0.6, exposure: 0.95, ambient: 0.02, glow: 0.22 },
  'detail-end': { x: 0.1, y: -3.3, r: 1.7, light: [0.1, 0.55, -0.45], tilt: 0.9, spin: 1.2, exposure: 1.2, ambient: 0.03, glow: 0 },
  page: { x: 0.66, y: 0.1, r: 0.3, light: [-0.85, 0.3, 0.42], tilt: 0.14, spin: 0.3, exposure: 1.0, ambient: 0.014, glow: 0.36 },
};

// Portrait screens: the Moon stays out of the way of the text and is dimmer behind it.
const tall: Record<PoseKey, Pose> = {
  hero: { ...wide.hero, x: 0, y: 0.34, r: 0.125 },
  about: { ...wide.about, x: 0.62, y: 0.66, r: 0.2, exposure: 0.85 },
  skills: { ...wide.skills, x: 0.95, y: -0.9, r: 0.3, exposure: 0.7 },
  projects: { ...wide.projects, x: 0, y: -1.5, r: 1.1, ambient: 0.018 },
  contact: { ...wide.contact, x: 0, y: -3.72, r: 1.6 },
  detail: { ...wide.detail, x: 0.9, y: 0.7, r: 0.2, exposure: 0.6 },
  'detail-end': { ...wide['detail-end'], y: -3.9, r: 1.6 },
  page: { ...wide.page, x: 0.7, y: 0.62, r: 0.16, exposure: 0.8 },
};

export function poseFor(key: PoseKey, aspect: number): Pose {
  return (aspect < 0.85 ? tall : wide)[key] ?? wide.hero;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  return {
    x: mix(a.x, b.x, t),
    y: mix(a.y, b.y, t),
    // Sizes are blended on a log scale, so the growth feels even from 0.17 to 3.2.
    r: Math.exp(mix(Math.log(a.r), Math.log(b.r), t)),
    light: [mix(a.light[0], b.light[0], t), mix(a.light[1], b.light[1], t), mix(a.light[2], b.light[2], t)],
    tilt: mix(a.tilt, b.tilt, t),
    spin: mix(a.spin, b.spin, t),
    exposure: mix(a.exposure, b.exposure, t),
    ambient: mix(a.ambient, b.ambient, t),
    glow: mix(a.glow, b.glow, t),
  };
}
