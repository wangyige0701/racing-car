/** 固定步长模拟时钟；受限补帧可防止隐藏标签页导致螺旋失控。 */
export class FixedStep {
  readonly step = 1 / 60;
  private accumulator = 0;

  advance(delta: number, simulate: (dt: number) => void): number {
    this.accumulator += Math.min(Math.max(delta, 0), this.step * 5);
    while (this.accumulator + 1e-10 >= this.step) {
      simulate(this.step);
      this.accumulator = Math.max(0, this.accumulator - this.step);
    }
    return this.accumulator / this.step;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
