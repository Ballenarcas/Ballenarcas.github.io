// The flat fallback: a picture of the Moon moved and scaled with CSS. Used when WebGL is missing,
// on very modest devices, and (without following the scroll) when the visitor asks for less motion.
import type { Frame, SpaceRenderer } from './controller';

export class FlatRenderer implements SpaceRenderer {
  private width = 1;
  private height = 1;
  constructor(private img: HTMLElement) {
    img.hidden = false;
  }
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  draw(f: Frame) {
    // The picture cannot be enlarged like the 3D Moon without turning to mush: cap its size.
    const r = Math.min(f.r, 0.75) * this.height;
    const base = this.img.offsetWidth * 0.46 || 1;
    const far = f.r > 0.75 ? Math.min(1, (f.r - 0.75) / 1.5) : 0;
    const x = f.x * this.width * 0.5;
    const y = -Math.max(f.y, -1.2) * this.height * 0.5;
    this.img.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(r / base).toFixed(4)})`;
    this.img.style.opacity = (Math.min(1, f.exposure) * (1 - far * 0.65) * f.intro).toFixed(3);
  }
  dispose() {
    this.img.hidden = true;
  }
}
