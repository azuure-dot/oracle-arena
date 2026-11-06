/** Statistiques du champ de tir : dégâts, éliminations, DPS glissant. */
export class Stats {
  totalDamage = 0;
  kills = 0;
  private events: { t: number; amount: number }[] = [];
  private static readonly WINDOW = 3; // secondes

  record(time: number, amount: number, killed: boolean): void {
    this.totalDamage += amount;
    if (killed) this.kills++;
    this.events.push({ t: time, amount });
  }

  dps(time: number): number {
    const from = time - Stats.WINDOW;
    while (this.events.length && this.events[0].t < from) this.events.shift();
    if (!this.events.length) return 0;
    const sum = this.events.reduce((s, e) => s + e.amount, 0);
    return sum / Stats.WINDOW;
  }

  reset(): void {
    this.totalDamage = 0;
    this.kills = 0;
    this.events = [];
  }
}
