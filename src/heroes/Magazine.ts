/** Chargeur + rechargement, partagé par les héros à munitions. */
export class Magazine {
  ammo: number;
  private reloadTimer = 0;

  constructor(
    readonly size: number,
    readonly reloadTime: number,
  ) {
    this.ammo = size;
  }

  get reloading(): boolean {
    return this.reloadTimer > 0;
  }

  get progress(): number {
    return this.reloading ? 1 - this.reloadTimer / this.reloadTime : 0;
  }

  update(dt: number): void {
    if (this.reloadTimer <= 0) return;
    this.reloadTimer -= dt;
    if (this.reloadTimer <= 0) {
      this.reloadTimer = 0;
      this.ammo = this.size;
    }
  }

  startReload(): void {
    if (!this.reloading && this.ammo < this.size) this.reloadTimer = this.reloadTime;
  }

  cancelReload(): void {
    this.reloadTimer = 0;
  }

  /** Consomme une munition ; false si vide ou en rechargement. */
  consume(): boolean {
    if (this.reloading || this.ammo <= 0) return false;
    this.ammo--;
    return true;
  }

  refill(): void {
    this.ammo = this.size;
    this.reloadTimer = 0;
  }
}
