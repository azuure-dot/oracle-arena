import { COLORS } from '../config';
import type { DamageCause, GameContext } from '../core/GameContext';
import { circleTouches } from '../core/geometry';
import { clamp, type Vec2 } from '../core/math';
import { Effects } from '../effects/Effects';
import type { Bot, BotContext } from '../entities/Bot';
import { hostile, type Combatant } from '../entities/Combatant';
import type { Decoy } from '../entities/Decoy';
import type { Projectile } from '../entities/Projectile';
import type { WorldObject } from '../entities/WorldObject';
import { RESPAWN_TIME, type Hero } from '../heroes/Hero';
import type { Arena } from '../world/Arena';
import type { Fog } from '../world/Fog';
import { WetGround } from './WetGround';
import { canSeeCircle, computeVisibility, inVisionRange, lineOfSight, type VisPoint } from '../world/Visibility';

export interface DamageEvent {
  target: Combatant;
  source: Hero | null;
  dealt: number;
  killed: boolean;
  cause?: DamageCause;
}

/** Ce que le mode de jeu branche sur le monde. */
export interface WorldHooks {
  respawnPoint(hero: Hero): Vec2;
  onDamage?(e: DamageEvent): void;
  /** Dessin au sol propre au mode (point de contrôle, packs de soin...), sous les entités. */
  drawGround?(ctx: CanvasRenderingContext2D, time: number): void;
  /** Chaque tremblement demandé (serveur multijoueur : retransmis aux clients). */
  onShake?(magnitude: number, at: Vec2): void;
}

/**
 * Ce qui tremble quand un héros frappe fort : la caméra du joueur. Le serveur multijoueur,
 * sans écran, passe un objet vide (`{ shake() {} }`) : le monde ne dépend pas de la caméra.
 */
export interface ShakeTarget {
  shake(magnitude: number): void;
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
  /** Objets autonomes (bombes à eau...). */
  objects: WorldObject[] = [];
  /** Leurres (clones holographiques de Flux) : des cibles de plus. */
  decoys: Decoy[] = [];
  /** Sol mouillé par Turty (15 s). */
  readonly wet: WetGround;
  /** Le héros du joueur (null = fond animé des menus). */
  player: Hero | null = null;
  time = 0;
  turretsEnabled = true;
  /** Délai de réapparition des héros (s). */
  respawnDelay = RESPAWN_TIME;

  private visibility: VisPoint[] = [];
  private targetList: Combatant[] = [];
  readonly ctx: GameContext;

  constructor(
    readonly arena: Arena,
    private readonly camera: ShakeTarget,
    private readonly hooks: WorldHooks,
  ) {
    const world = this;
    this.wet = new WetGround(arena);
    this.ctx = {
      arena,
      effects: this.effects,
      time: 0,
      get targets() {
        return world.targetList;
      },
      spawnProjectile: (p) => this.projectiles.push(p),
      spawnObject: (o) => this.objects.push(o),
      spawnDecoy: (d) => this.decoys.push(d),
      wet: this.wet,
      damage: (target, amount, source, cause) => this.damage(target, amount, source, cause),
      respawnPoint: (hero) => this.hooks.respawnPoint(hero),
      get respawnDelay() {
        return world.respawnDelay;
      },
      shake: (m, at) => this.shakeAt(m, at),
    };
  }

  /** Tout ce qui peut être touché. */
  get targets(): readonly Combatant[] {
    return this.targetList;
  }

  // ------------------------------------------------------------ simulation

  /** Fin de partie : vide les listes et libère les images du décor (voir Arena.dispose). */
  dispose(): void {
    this.clearTransient();
    this.arena.dispose();
  }

  update(dt: number): void {
    this.time += dt;
    this.ctx.time = this.time;
    this.rebuildTargets();

    // Les buffs d'aura sont réappliqués à chaque frame par les Tempo.
    for (const c of this.targetList) {
      c.buffs.length = 0;
      c.auraSpeedMul = 1;
    }

    // Auras d'abord : chaque héros profite des bonus de la frame, quel que soit l'ordre de mise à jour.
    for (const h of this.heroes) if (h.alive) h.applyAura(dt, this.ctx);
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
    this.objects = this.objects.filter((o) => o.update(dt, this.ctx));
    this.decoys = this.decoys.filter((d) => d.update(dt, this.ctx));
    this.wet.update(dt, this.time);
    this.updateVisibility();
    this.effects.update(dt);
  }

  /** Liste réutilisée à chaque image (pas de nouveau tableau 60 fois par seconde). */
  private rebuildTargets(): void {
    const list = this.targetList;
    list.length = 0;
    for (const c of this.bots) list.push(c);
    for (const c of this.heroes) list.push(c);
    for (const c of this.decoys) list.push(c);
  }

  /**
   * Partie en ligne (client) : le serveur simule, ce monde ne fait qu'AFFICHER. On ne fait vivre
   * que ce qui est purement visuel : ligne de vue du joueur, effets, séchage des flaques.
   * `time` est réglé par le client réseau (temps du serveur, voir src/network/NetMatch.ts).
   */
  updateDisplay(dt: number): void {
    this.ctx.time = this.time;
    this.rebuildTargets();
    this.wet.update(dt, this.time);
    this.updateVisibility();
    this.effects.update(dt);
  }

  /** Vide projectiles et effets (début de manche). */
  clearTransient(): void {
    this.projectiles = [];
    this.objects = [];
    this.decoys = [];
    this.effects.clear();
    this.wet.clear();
  }

  damage(target: Combatant, amount: number, source: Hero | null, cause?: DamageCause): number {
    if (source) amount *= source.damageMultiplier; // bots : -30 %
    // Protégé (Sanctuaire de Camellia) : ne descend pas sous un seuil de PV. La lave tue quand même.
    const guard = target.guard;
    if (guard && guard.until >= this.time && cause !== 'lava') amount = Math.min(amount, Math.max(0, target.hp - guard.floor));
    const wasAlive = target.alive;
    const dealt = target.takeDamage(amount, this.ctx);
    if (dealt <= 0) return 0;
    const killed = wasAlive && !target.alive;
    // Chiffres de dégâts : seulement ceux infligés par le joueur (lisibilité).
    if (source && source === this.player && source !== target) {
      this.effects.damageNumber(target.x, target.y - target.radius, dealt);
    }
    if (killed) {
      this.effects.sparks(target.x, target.y, COLORS.enemy, 26, 320);
      this.effects.ring(target.x, target.y, COLORS.enemy, 60, 0.4);
    }
    this.hooks.onDamage?.({ target, source, dealt, killed, cause });
    return dealt;
  }

  /** Tremblement d'écran, atténué avec la distance au joueur. */
  shakeAt(magnitude: number, at: Vec2): void {
    this.hooks.onShake?.(magnitude, at);
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
      p.onUpdate?.(p);
      if (p.dead) p.onEnd?.(p);
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

  /** Les cibles de la même équipe que le tireur sont traversées (sauf projectile qui soigne : plumes de Camellia). */
  private hitTargets(p: Projectile): void {
    for (const c of this.targetList) {
      if (!c.alive) continue;
      if (!hostile(c, p)) {
        if (p.allyHeal <= 0 || c === p.owner || c.decoy) continue;
        if (!circleTouches(p.x, p.y, p.radius, c.circle())) continue;
        c.heal(p.allyHeal);
        this.effects.sparks(p.x, p.y, COLORS.auraHeal, 4, 140);
        p.dead = true;
        return;
      }
      if (!circleTouches(p.x, p.y, p.radius, c.circle())) continue;
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
      for (const h of this.heroes) h.visible = !h.stealthed;
      for (const d of this.decoys) d.visible = true;
      return;
    }
    this.visibility = computeVisibility(eye.x, eye.y, this.arena);
    const sees = (c: Combatant) =>
      inVisionRange(eye.x, eye.y, c.x, c.y, c.radius) && canSeeCircle(this.arena, eye.x, eye.y, c.circle());
    for (const b of this.bots) b.visible = sees(b);
    // Les alliés restent toujours affichés (comme leurs contours dans un hero shooter) ;
    // un adversaire invisible (Frappe fantôme) ne l'est pas, même en pleine vue.
    for (const h of this.heroes) h.visible = h === eye || (h.alive && (!hostile(h, eye) || (!h.stealthed && sees(h))));
    for (const d of this.decoys) d.visible = d.alive && (!hostile(d, eye) || sees(d));
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
    this.arena.drawFloor(ctx, this.time);
    this.wet.draw(ctx, this.player?.team ?? null); // eau de l'équipe du joueur en bleu, adverse en rouge
    this.hooks.drawGround?.(ctx, this.time);
    this.effects.drawUnder(ctx);
    const objects = this.objects.filter((o) => !eye || !hostile(o, eye) || this.seesPoint(eye, o.x, o.y));
    for (const o of objects) o.drawUnder(ctx);
    for (const h of shown) h.drawUnder(ctx, this.time);
    for (const b of this.bots) if (b.visible) b.draw(ctx);
    for (const h of shown) h.draw(ctx);
    for (const d of this.decoys) if (d.visible) d.draw(ctx, eye);
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
    for (const o of objects) o.drawOver(ctx);
    this.effects.drawOver(ctx);
    for (const h of shown) h.drawOver(ctx);
    if (showHitboxes) this.drawHitboxes(ctx, shown);

    // --- 2. Ombre des murs (ligne de vue)
    toScreen();
    if (eye) fog.drawLineOfSight(ctx, this.visibility, view, eye.x, eye.y, viewW, viewH);

    // --- 3. Murs par-dessus l'ombre (la map proche reste lisible)
    toWorld();
    this.arena.drawWalls(ctx);
    for (const o of objects) o.drawSky?.(ctx);

    // --- 4. Périmètre de vision : au-delà, tout est dans l'ombre (murs compris)
    toScreen();
    if (eye) fog.drawVisionLimit(ctx, view, eye.x, eye.y, viewW, viewH);

    // --- 5. Barres de vie (seulement ce qui est visible), le joueur par-dessus
    toWorld();
    for (const b of this.bots) if (b.visible) b.drawOverlay(ctx);
    for (const d of this.decoys) if (d.visible) d.drawOverlay(ctx, eye);
    for (const h of shown) if (h !== eye) h.drawOverlay(ctx);
    eye?.drawOverlay(ctx);
    toScreen();
  }

  /** Le joueur voit-il ce point ? (périmètre + ligne de vue) */
  private seesPoint(eye: Hero, x: number, y: number): boolean {
    return inVisionRange(eye.x, eye.y, x, y) && lineOfSight(this.arena, eye.x, eye.y, x, y);
  }

  private drawHitboxes(ctx: CanvasRenderingContext2D, heroes: Hero[]): void {
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#00ff9c';
    const circles = [
      ...heroes.filter((h) => h.alive).map((h) => h.circle()),
      ...this.bots.filter((b) => b.visible && b.alive).map((b) => b.circle()),
    ];
    for (const c of circles) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
