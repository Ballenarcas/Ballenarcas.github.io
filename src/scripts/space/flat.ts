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
    // A picture cannot show a terminator: it darkens with the eclipse and a violet corona grows around it.
    const e = f.eclipse;
    this.img.style.opacity = ((1 - far * 0.65) * f.intro).toFixed(3);
    this.img.style.filter = `brightness(${(1 - 0.86 * e).toFixed(3)}) drop-shadow(0 0 ${(6 + 34 * e).toFixed(1)}px rgba(169, 138, 216, ${(0.25 + 0.6 * e).toFixed(2)}))`;
  }
  dispose() {
    this.img.hidden = true;
  }
}
