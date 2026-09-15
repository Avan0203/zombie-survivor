const TAU = Math.PI * 2;
const RANGE = 16;
const RANGE_SQ = RANGE * RANGE;
const SWEEP_PERIOD = 2.4;
const SWEEP_SPEED = TAU / SWEEP_PERIOD;
const SWEEP_WEDGE = 0.62;
const FADE_DURATION = 2.1;
const MAX_SWEEP_STEP = 0.55;

export interface RadarContact {
  id: number;
  position: { readonly x: number; readonly y: number };
  state: 'alive' | 'dying';
}

interface RadarBlip {
  x: number;
  y: number;
  age: number;
}

function wrapTau(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

/** 玩家为圆心的声呐雷达：扫过才亮，随后淡出。 */
export class Radar {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly blips = new Map<number, RadarBlip>();
  private sweep = 0;
  private sweepStep = 0;
  private prevSweep = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('雷达需要 2D canvas');
    this.canvas = canvas;
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const css = Math.max(1, this.canvas.clientWidth);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = Math.round(css * dpr);
    if (this.canvas.width === pixels && this.canvas.height === pixels) return;
    this.canvas.width = pixels;
    this.canvas.height = pixels;
  }

  reset(): void {
    this.blips.clear();
    this.sweep = 0;
    this.sweepStep = 0;
    this.prevSweep = 0;
  }

  dispose(): void {
    this.blips.clear();
  }

  update(
    delta: number,
    sweeping: boolean,
    origin: { x: number; y: number } | undefined,
    contacts: readonly RadarContact[],
  ): void {
    if (sweeping && origin) this.scan(delta, origin, contacts);
    this.draw();
  }

  private scan(delta: number, origin: { x: number; y: number }, contacts: readonly RadarContact[]): void {
    for (const [id, blip] of this.blips) {
      blip.age += delta;
      if (blip.age >= FADE_DURATION) this.blips.delete(id);
    }

    this.sweepStep = Math.min(SWEEP_SPEED * delta, MAX_SWEEP_STEP);
    this.prevSweep = this.sweep;
    this.sweep = wrapTau(this.sweep - this.sweepStep);

    for (const contact of contacts) {
      if (contact.state !== 'alive') continue;
      const dx = contact.position.x - origin.x;
      const dy = contact.position.y - origin.y;
      const distSq = dx * dx + dy * dy;
      const inRange = distSq <= RANGE_SQ;
      if (inRange && distSq > 1e-8 && this.crossed(Math.atan2(dy, dx))) {
        this.ping(contact.id, dx, dy);
      }
      const blip = this.blips.get(contact.id);
      if (blip && inRange) {
        blip.x = dx;
        blip.y = dy;
      }
    }
  }

  private crossed(angle: number): boolean {
    return wrapTau(this.prevSweep - angle) <= this.sweepStep;
  }

  private ping(id: number, x: number, y: number): void {
    const existing = this.blips.get(id);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.age = 0;
      return;
    }
    this.blips.set(id, { x, y, age: 0 });
  }

  private draw(): void {
    const ctx = this.ctx;
    const { width } = this.canvas;
    const cx = width / 2;
    const cy = width / 2;
    const radius = width * 0.5 - Math.max(1.5, width * 0.018);

    ctx.clearRect(0, 0, width, width);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.clip();

    ctx.fillStyle = 'rgba(8, 12, 8, 0.88)';
    ctx.fill();

    ctx.strokeStyle = 'rgba(191, 204, 158, 0.16)';
    ctx.lineWidth = Math.max(1, width * 0.006);
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(191, 204, 158, 0.2)';
    for (const ring of [1 / 3, 2 / 3, 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * ring, 0, TAU);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-this.sweep);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, 0, -SWEEP_WEDGE, true);
    ctx.closePath();
    const wedge = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    wedge.addColorStop(0, 'rgba(199, 215, 146, 0.28)');
    wedge.addColorStop(1, 'rgba(199, 215, 146, 0.02)');
    ctx.fillStyle = wedge;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius, 0);
    ctx.strokeStyle = 'rgba(232, 240, 190, 0.92)';
    ctx.lineWidth = Math.max(1.2, width * 0.012);
    ctx.stroke();
    ctx.restore();

    const scale = radius / RANGE;
    const dot = Math.max(1.6, width * 0.018);
    for (const blip of this.blips.values()) {
      const alpha = Math.max(0, 1 - blip.age / FADE_DURATION);
      const px = cx + blip.x * scale;
      const py = cy - blip.y * scale;
      ctx.beginPath();
      ctx.arc(px, py, dot * (0.7 + alpha * 0.45), 0, TAU);
      ctx.fillStyle = `rgba(255, 81, 69, ${0.18 + alpha * 0.55})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, dot * 0.55, 0, TAU);
      ctx.fillStyle = `rgba(255, 92, 78, ${0.25 + alpha * 0.75})`;
      ctx.fill();
    }

    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.strokeStyle = 'rgba(191, 204, 158, 0.38)';
    ctx.lineWidth = Math.max(1.4, width * 0.014);
    ctx.stroke();
  }
}
