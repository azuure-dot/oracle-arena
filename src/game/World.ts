import { COLORS } from '../config';
import type { Camera } from '../core/Camera';
import type { GameContext } from '../core/GameContext';
import { circleIntersectsBox } from '../core/geometry';
import { clamp, type Vec2 } from '../core/math';
import { Effects } from '../effects/Effects';
import type { Bot, BotContext } from '../entities/Bot';
import { hostile, type Combatant } from '../entities/Combatant';
import type { Projectile } from '../entities/Projectile';
import type { Hero } from '../heroes/Hero';
import type { Arena } from '../world/Arena';
import type { Fog } from '../world/Fog';
import { canSeeBox, computeVisibility, inVisionRange, lineOfSight, type VisPoint } from '../world/Visibility';

export interface DamageEvent {
  target: Combatant;
  source: Hero | null;
  dealt: number;
  killed: boolean;
}

/** Ce que le mode de jeu branche sur le monde. */
export interface WorldHooks {
  respawnPoint(hero: Hero): Vec2;
  onDamage?(e: DamageEvent): void;
}

export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * La simulation commune à tous les modes : héros (joueur + bots héros), bots du
 * champ de tir, projectiles, effets, ligne de vue du joueur et rendu du monde.
 * Les règles (score, timer, stats...) sont dans le mode de jeu (src/modes/).
 */
export class World {
  readonly effects = new Effects();
  heroes: Hero[] = [];
  bots: Bot[] = [];
  projectiles: Projectile[] = [];
  /** Le héros du joueur (null = fond animé des menus). */
  player: Hero | null = null;
  time = 0;
  turretsEnabled = true;

  private visibility: VisPoint[] = [];
  private targetList: Combatant[] = [];
  readonly ctx: GameContext;

  constructor(
    readonly arena: Arena,
    private readonly camera: Camera,
    private readonly hooks: WorldHooks,
  ) {
    const world = this;
    this.ctx = {
      arena,
      effects: this.effects,
      time: 0,
      get targets() {
        return world.targetList;
      },
      spawnProjectile: (p) => this.projectiles.push(p),
      damage: (target, amount, source) => this.damage(target, amount, source),
      respawnPoint: (hero) => this.hooks.respawnPoint(hero),
      shake: (m, at) => this.shake(m, at),
    };
  }

  /** Tout ce qui peut être touché. */
  get targets(): readonly Combatant[] {
    return this.targetList;
  }

  // ------------------------------------------------------------ simulation

  update(dt: number): void {
    this.time += dt;
    this.ctx.time = this.time;
    this.targetList = [...this.bots, ...this.heroes];

    // Les buffs d'aura sont réappliqués à chaque frame par les Tempo.
    for (const c of this.targetList) {
      c.buff = null;
      c.auraSpeedMul = 1;
    }

    for (const h of this.heroes) h.update(dt, this.ctx);

    const bctx: BotContext = {
      arena: this.arena,
      effects: this.effects,
      hero: this.player,
      turretsEnabled: this.turretsEnabled,
      spawnProjectile: (p) => this.projectiles.push(p),
    };
    for (const b of this.bots) b.update(dt, bctx);

    this.updateProjectiles(dt);
    this.updateVisibility();
    this.effects.update(dt);
  }

  damage(target: Combatant, amount: number, source: Hero | null): number {
    const wasAlive = target.alive;
    const dealt = target.takeDamage(amount, this.ctx);
    if (dealt <= 0) return 0;
    const killed = wasAlive && !target.alive;
    // Chiffres de dégâts : seulement ceux infligés par le joueur (lisibilité).
    if (source && source === this.player && source !== target) {
      this.effects.damageNumber(target.x, target.y - target.hh, dealt);
    }
    if (killed) {
      this.effects.sparks(target.x, target.y, COLORS.enemy, 26, 320);
      this.effects.ring(target.x, target.y, COLORS.enemy, 60, 0.4);
    }
    this.hooks.onDamage?.({ target, source, dealt, killed });
    return dealt;
  }

  private shake(magnitude: number, at: Vec2): void {
    const p = this.player;
    if (!p) return;
    const f = clamp(1 - Math.hypot(at.x - p.x, at.y - p.y) / 900, 0, 1);
    if (f > 0) this.camera.shake(magnitude * f);
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      const dx = p.vx * dt;
      const dy = p.vy * dt;
      const dist = Math.hypot(dx, dy);
      // Sous-pas : un projectile ne "saute" jamais par-dessus un mur, une cible ou un bouclier.
      const steps = Math.max(1, Math.ceil(dist / 8));

      for (let s = 0; s < steps && !p.dead; s++) {
        p.x += dx / steps;
        p.y += dy / steps;
        p.traveled += dist / steps;

        if (this.arena.pointInWall(p.x, p.y)) {
          p.dead = true;
          this.effects.sparks(p.x, p.y, p.color, p.style === 'fire' ? 14 : 3, 160);
          break;
        }
        if (this.blockedByShield(p)) break;
        this.hitTargets(p);
        if (p.traveled >= p.maxRange) p.dead = true;
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  /** Bouclier d'un héros adverse (Rempart) : arrête le projectile. */
  private blockedByShield(p: Projectile): boolean {
    for (const h of this.heroes) {
      if (!h.alive || !hostile(h, p) || !h.shieldBlocks(p)) continue;
      p.dead = true;
      this.effects.sparks(p.x, p.y, COLORS.shield, 5, 160);
      return true;
    }
    return false;
  }

  /** Les cibles de la même équipe que le tireur sont traversées. */
  private hitTargets(p: Projectile): void {
    for (const c of this.targetList) {
      if (!c.alive || !hostile(c, p)) continue;
      if (!circleIntersectsBox(p.x, p.y, p.radius, c.box())) continue;
      if (p.pierce) {
        if (p.hits.has(c)) continue;
        p.hits.add(c);
        this.damage(c, p.damage, p.owner);
        this.effects.sparks(c.x, c.y, p.color, 10, 220);
      } else {
        this.damage(c, p.damage, p.owner);
        this.effects.sparks(p.x, p.y, p.owner ? COLORS.enemy : COLORS.enemyBullet, 4, 180);
        p.dead = true;
        return;
      }
    }
  }

  /** Ce que le joueur voit : dans le périmètre 16:9 ET pas caché par un mur. */
  private updateVisibility(): void {
    const eye = this.player;
    if (!eye) {
      for (const b of this.bots) b.visible = true;
      for (const h of this.heroes) h.visible = true;
      return;
    }
    this.visibility = computeVisibility(eye.x, eye.y, this.arena);
    const sees = (c: Combatant) =>
      inVisionRange(eye.x, eye.y, c.x, c.y, c.hw, c.hh) && canSeeBox(this.arena, eye.x, eye.y, c.box());
    for (const b of this.bots) b.visible = sees(b);
    for (const h of this.heroes) h.visible = h === eye || (h.alive && sees(h));
  }

  // ------------------------------------------------------------------ rendu

  draw(
    ctx: CanvasRenderingContext2D,
    dpr: number,
    view: ViewTransform,
    viewW: number,
    viewH: number,
    fog: Fog,
    showHitboxes: boolean,
  ): void {
    const toWorld = () => ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);
    const toScreen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const eye = this.player;
    const shown = this.heroes.filter((h) => h.visible);

    // --- 1. Monde (sol, entités visibles, effets)
    toWorld();
    this.arena.drawFloor(ctx);
    this.effects.drawUnder(ctx);
    for (const h of shown) h.drawUnder(ctx, this.time);
    for (const b of this.bots) if (b.visible) b.draw(ctx);
    for (const h of shown) h.draw(ctx);
    for (const p of this.projectiles) {
      // Projectiles adverses hors de vue (mur ou périmètre) : non affichés.
      if (
        eye &&
        hostile(p, eye) &&
        (!inVisionRange(eye.x, eye.y, p.x, p.y) || !lineOfSight(this.arena, eye.x, eye.y, p.x, p.y))
      ) {
        continue;
      }
      p.draw(ctx);
    }
    this.effects.drawOver(ctx);
    for (const h of shown) h.drawOver(ctx);
    if (showHitboxes) this.drawHitboxes(ctx, shown);

    // --- 2. Ombre des murs (ligne de vue)
    toScreen();
    if (eye) fog.drawLineOfSight(ctx, this.visibility, view, eye.x, eye.y, viewW, viewH);

    // --- 3. Murs par-dessus l'ombre (la map proche reste lisible)
    toWorld();
    this.arena.drawWalls(ctx);

    // --- 4. Périmètre de vision : au-delà, tout est dans l'ombre (murs compris)
    toScreen();
    if (eye) fog.drawVisionLimit(ctx, view, eye.x, eye.y, viewW, viewH);

    // --- 5. Barres de vie (seulement ce qui est visible), le joueur par-dessus
    toWorld();
    for (const b of this.bots) if (b.visible) b.drawOverlay(ctx);
    for (const h of shown) if (h !== eye) h.drawOverlay(ctx);
    eye?.drawOverlay(ctx);
    toScreen();
  }

  private drawHitboxes(ctx: CanvasRenderingContext2D, heroes: Hero[]): void {
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#00ff9c';
    const boxes = [
      ...heroes.filter((h) => h.alive).map((h) => h.box()),
      ...this.bots.filter((b) => b.visible && b.alive).map((b) => b.box()),
    ];
    for (const b of boxes) ctx.strokeRect(b.x - b.hw, b.y - b.hh, b.hw * 2, b.hh * 2);
    ctx.restore();
  }
}
