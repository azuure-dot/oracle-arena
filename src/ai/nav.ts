import type { Vec2 } from '../core/math';
import type { Team } from '../entities/Team';
import type { Arena } from '../world/Arena';
import { pathClear, type Mover } from './steering';

/**
 * Graphe de navigation léger pour les cartes à salles (Contrôle).
 * - Les nœuds sont placés à la main dans la carte (portes, couloirs, salles).
 * - Les liaisons sont calculées automatiquement : deux nœuds sont reliés si la plus
 *   grosse hitbox (Rempart) peut aller de l'un à l'autre en ligne droite.
 * - route() : Dijkstra sur une vingtaine de nœuds, puis le bot "coupe" les virages
 *   dès qu'il voit plus loin sur le chemin (voir HeroBrain.navigate).
 */
export class NavGraph {
  private readonly adj: { to: number; cost: number }[][];

  constructor(
    private readonly arena: Arena,
    readonly nodes: readonly Vec2[],
    probe = { hw: 31, hh: 33 },
  ) {
    this.adj = nodes.map(() => []);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (!pathClear(arena, { x: a.x, y: a.y, hw: probe.hw, hh: probe.hh }, b.x, b.y)) continue;
        const cost = Math.hypot(b.x - a.x, b.y - a.y);
        this.adj[i].push({ to: j, cost });
        this.adj[j].push({ to: i, cost });
      }
    }
  }

  /** Nombre de liaisons (débogage). */
  get edgeCount(): number {
    return this.adj.reduce((s, a) => s + a.length, 0) / 2;
  }

  /** Nœud utilisable par cette équipe (pas dans la zone de spawn adverse). */
  private usable(i: number, team?: Team): boolean {
    const z = this.arena.safeZoneAt(this.nodes[i].x, this.nodes[i].y);
    return !z || team === undefined || z.team === team;
  }

  /**
   * Chemin de `from` vers `to` : liste de points à suivre (le dernier est `to`).
   * null si aucun chemin n'est trouvé.
   */
  route(from: Mover, to: Vec2): Vec2[] | null {
    const arena = this.arena;
    if (pathClear(arena, from, to.x, to.y)) return [to];

    const n = this.nodes.length;
    const dist = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);

    for (let i = 0; i < n; i++) {
      if (!this.usable(i, from.team)) continue;
      const p = this.nodes[i];
      if (pathClear(arena, from, p.x, p.y)) dist[i] = Math.hypot(p.x - from.x, p.y - from.y);
    }

    // Dijkstra (n ≈ 40 : une recherche linéaire du minimum suffit).
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      for (const e of this.adj[u]) {
        if (!this.usable(e.to, from.team)) continue;
        const d = dist[u] + e.cost;
        if (d < dist[e.to]) {
          dist[e.to] = d;
          prev[e.to] = u;
        }
      }
    }

    // Meilleur nœud d'arrivée : atteint, et qui voit la destination.
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < n; i++) {
      if (dist[i] === Infinity) continue;
      const p = this.nodes[i];
      const total = dist[i] + Math.hypot(to.x - p.x, to.y - p.y);
      if (total >= bestCost) continue;
      if (!pathClear(arena, { x: p.x, y: p.y, hw: from.hw, hh: from.hh, team: from.team }, to.x, to.y)) continue;
      best = i;
      bestCost = total;
    }
    if (best < 0) return null;

    const path: Vec2[] = [to];
    for (let i = best; i >= 0; i = prev[i]) path.unshift(this.nodes[i]);
    return path;
  }
}
