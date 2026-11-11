// The one place that sets the camera. Every frame it works out a single rig and applies it.
//
// A rig is a camera described by what it looks at: the point it frames, from which direction
// (yaw, pitch), how much of the world fits in half the screen height there (frame), the field of
// view and a lens shift that moves that point away from the centre of the picture.
// Describing cameras this way lets any two of them be blended without jumps, and a blend that
// changes target and direction at once travels along a curve around the scene, not a straight line.
//
// Two sources give rigs: the exploration (the scroll) and the focus on one planet. A change of
// source never cuts: the camera as it is at that moment is kept as a snapshot and blended into the
// new source over a fixed time. A new change in the middle of one starts from wherever the camera
// is then, so quick clicks, a switch from one planet to another or a close always continue smoothly.
import { PerspectiveCamera, Vector3 } from 'three';

export interface Rig {
  target: Vector3;
  yaw: number;
  pitch: number;
  /** Half the visible height at the target, in world units. */
  frame: number;
  /** Vertical field of view, in degrees. */
  fov: number;
  /** Where the target sits on screen, in normalised device units (-1..1). */
  shiftX: number;
  shiftY: number;
}

export const TELE_DISTANCE = 60;
/** A camera so far away and so narrow that it draws the plane z = 0 exactly like the old flat camera. */
export const TELE_FOV = (2 * Math.atan(1 / TELE_DISTANCE) * 180) / Math.PI;

export const makeRig = (): Rig => ({ target: new Vector3(), yaw: 0, pitch: 0, frame: 1, fov: TELE_FOV, shiftX: 0, shiftY: 0 });

export function copyRig(out: Rig, a: Rig): Rig {
  out.target.copy(a.target);
  out.yaw = a.yaw;
  out.pitch = a.pitch;
  out.frame = a.frame;
  out.fov = a.fov;
  out.shiftX = a.shiftX;
  out.shiftY = a.shiftY;
  return out;
}

const TAU = Math.PI * 2;
/** The same angle, moved by whole turns to lie within half a turn of `near`. */
export const nearAngle = (angle: number, near: number) => angle - TAU * Math.round((angle - near) / TAU);

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Blend two rigs. `turn` is added to b.yaw first, so the camera goes round the short way. */
export function mixRig(out: Rig, a: Rig, b: Rig, t: number, turn = 0): Rig {
  out.target.lerpVectors(a.target, b.target, t);
  out.yaw = mix(a.yaw, b.yaw + turn, t);
  out.pitch = mix(a.pitch, b.pitch, t);
  // Sizes on a log scale, so a zoom feels even.
  out.frame = Math.exp(mix(Math.log(a.frame), Math.log(b.frame), t));
  out.fov = mix(a.fov, b.fov, t);
  out.shiftX = mix(a.shiftX, b.shiftX, t);
  out.shiftY = mix(a.shiftY, b.shiftY, t);
  return out;
}

const position = new Vector3();

/** Put a perspective camera where a rig says. */
export function applyRig(camera: PerspectiveCamera, rig: Rig) {
  const distance = rig.frame / Math.tan((rig.fov * Math.PI) / 360);
  const c = Math.cos(rig.pitch);
  position.set(Math.sin(rig.yaw) * c, Math.sin(rig.pitch), Math.cos(rig.yaw) * c).multiplyScalar(distance).add(rig.target);
  camera.position.copy(position);
  camera.up.set(0, 1, 0);
  camera.lookAt(rig.target);
  camera.fov = rig.fov;
  camera.near = Math.max(0.01, distance * 0.02);
  camera.far = distance + 200;
  camera.updateProjectionMatrix();
  // Lens shift: an off-centre projection, so the framed point moves on screen without any rotation.
  if (rig.shiftX || rig.shiftY) {
    const e = camera.projectionMatrix.elements;
    e[8] = -rig.shiftX;
    e[9] = -rig.shiftY;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  camera.updateMatrixWorld();
}

/** Ease in and out, for the camera moves between sources. */
const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export type Source = { kind: 'explore' } | { kind: 'focus'; id: string };

/** Decides which source the camera follows and blends between them. */
export class Director {
  readonly rig = makeRig();
  source: Source = { kind: 'explore' };
  private from = makeRig();
  private to = makeRig();
  /** 0 → 1 during a change of source. 1 when settled. */
  private t = 1;
  private turn = 0;
  private duration = 1.7;

  /** Follow another source, starting from the camera as it is now. */
  follow(source: Source, duration = 1.7) {
    copyRig(this.from, this.rig);
    this.source = source;
    this.t = 0;
    this.turn = Number.NaN; // decided on the first frame, once the new rig is known
    this.duration = duration;
  }

  get settled() { return this.t >= 1; }
  /** How far the current change of source has gone, 0..1 (1 when nothing is changing). */
  get progress() { return this.t; }

  /** One frame: `wanted` is the rig of the current source for this frame. */
  update(wanted: Rig, dt: number) {
    if (this.t >= 1) { copyRig(this.rig, wanted); return this.rig; }
    if (Number.isNaN(this.turn)) this.turn = nearAngle(wanted.yaw, this.from.yaw) - wanted.yaw;
    this.t = Math.min(1, this.t + dt / this.duration);
    const k = inOut(this.t);
    copyRig(this.to, wanted);
    mixRig(this.rig, this.from, this.to, k, this.turn);
    // An arc: the camera pulls back a little half-way and rises, so the move reads as a flight.
    const arc = Math.sin(Math.PI * k);
    this.rig.frame *= 1 + 0.32 * arc;
    this.rig.pitch += 0.1 * arc;
    if (this.t >= 1) copyRig(this.rig, wanted);
    return this.rig;
  }
}
