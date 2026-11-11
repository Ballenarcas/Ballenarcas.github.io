// The flat fallback: a picture of the Moon moved and scaled with CSS. Used when WebGL is missing,
// on very modest devices, and (without following the scroll) when the visitor asks for less motion.
import type { Frame, SpaceRenderer } from './controller';

export class FlatRenderer implements SpaceRenderer {
  private width = 1;
  private height = 1;
  private base = 1;
  readonly alive = false;
  constructor(private img: HTMLElement) {
    img.hidden = false;
  }
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.base = this.img.offsetWidth * 0.46 || 1;
  }
  draw(f: Frame) {
    // The picture cannot be enlarged like the 3D Moon without turning to mush: cap its size.
    const r = Math.min(f.r, 0.75) * this.height;
    const far = f.r > 0.75 ? Math.min(1, (f.r - 0.75) / 1.5) : 0;
    const x = f.x * this.width * 0.5;
    const y = -Math.max(f.y, -1.2) * this.height * 0.5;
    this.img.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(r / this.base).toFixed(4)})`;
    // The picture cannot show phases: when the scene is a night side, it simply dims.
    const len = Math.hypot(f.light[0], f.light[1], f.light[2]) || 1;
    const lit = Math.min(1, Math.max(0, 0.55 + (f.light[2] / len) * 0.9));
    this.img.style.opacity = (Math.min(1, f.exposure) * (1 - far * 0.65) * (0.2 + 0.8 * lit) * f.intro).toFixed(3);
  }
  dispose() {
    this.img.hidden = true;
  }
}
