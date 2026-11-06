/**
 * Buffer circulaire de taille fixe : écriture O(1), aucune allocation après
 * construction. Utilisé pour l'historique du Rappel (position + PV par frame).
 */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private head = 0; // index du prochain emplacement d'écriture
  private count = 0;

  constructor(readonly capacity: number) {
    this.items = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** i = 0 → élément le plus récent, i = size - 1 → le plus ancien. */
  fromNewest(i: number): T | undefined {
    if (i < 0 || i >= this.count) return undefined;
    const idx = (this.head - 1 - i + this.capacity * 2) % this.capacity;
    return this.items[idx];
  }

  newest(): T | undefined {
    return this.fromNewest(0);
  }

  oldest(): T | undefined {
    return this.fromNewest(this.count - 1);
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
