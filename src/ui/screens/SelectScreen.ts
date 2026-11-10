import camelliaArt from '../../assets/heroes/camellia.webp';
import fluxArt from '../../assets/heroes/flux.webp';
import skaterArt from '../../assets/heroes/skater.webp';
import thorArt from '../../assets/heroes/thor.webp';
import turtyArt from '../../assets/heroes/turty.webp';
import { INPUT_LABEL_KEYS } from '../../heroes/Hero';
import { ROLE_KEYS, ROLE_ORDER, type HeroEntry, type Role } from '../../heroes/registry';
import { t } from '../../i18n';
import type { ModeKind } from '../../modes/GameMode';
import type { MapDef } from '../../world/maps';
import { Screen, digitOf } from './Screen';

const ROLE_ICONS: Record<Role, string> = {
  tank: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/>',
  damage:
    '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6" stroke="currentColor" stroke-width="2.5"/>',
  support: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z"/>',
};

/** Grandes illustrations des héros (détourées), par identifiant du registre. */
const ART: Record<string, string> = {
  thor: thorArt,
  flux: fluxArt,
  turty: turtyArt,
  skater: skaterArt,
  camellia: camelliaArt,
};

/** Vignettes : le héros tel qu'on le voit en jeu (vue de dessus), dessiné une fois puis gardé. */
const tileCache = new Map<string, string>();
function tileArt(h: HeroEntry): string {
  let url = tileCache.get(h.id);
  if (url) return url;
  const size = 160;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const hero = h.create();
  hero.outline = h.color;
  hero.aim = -Math.PI / 2; // regard vers le haut
  hero.x = 0;
  hero.y = 0;
  const scale = (size * 0.33) / hero.radius;
  g.translate(size / 2, size / 2 + size * 0.04);
  g.scale(scale, scale);
  hero.draw(g);
  url = c.toDataURL();
  tileCache.set(h.id, url);
  return url;
}

/** Changement de héros en cours de partie (au spawn) : héros interdits + rappels. */
export interface SwapContext {
  /** Noms des héros déjà pris par les coéquipiers. */
  taken: string[];
  current: string;
  onPick(hero: HeroEntry): void;
  onClose(): void;
}

/**
 * Sélection du héros, façon Overwatch / Valorant :
 * - au fond, le marbre du thème (comme l'accueil et le choix de la carte) ;
 * - au centre, la grande illustration du héros sélectionné, son nom, son rôle, ses compétences ;
 * - en bas, la grille des héros (vignettes = le héros vu en jeu), regroupés par rôle, et le
 *   bouton « Prêt » qui lance la partie.
 * Clic (ou touches 1-5) : sélectionner · double-clic, Entrée ou « Prêt » : jouer · Échap : retour.
 */
export class SelectScreen extends Screen {
  private readonly ordered: HeroEntry[];
  mode: ModeKind = 'practice';
  /** Carte choisie en Partie rapide (titre « Carte · Mode »). */
  map: MapDef | null = null;
  /** Défini pendant un changement de héros en jeu. */
  swap: SwapContext | null = null;
  /** Héros sélectionné (affiché au centre), pas encore validé. */
  private selected: HeroEntry;

  constructor(
    parent: HTMLElement,
    heroes: HeroEntry[],
    private readonly onPick: (hero: HeroEntry) => void,
    private readonly onBack: () => void,
  ) {
    super(parent, 'select-screen');
    this.ordered = ROLE_ORDER.flatMap((role) => heroes.filter((h) => h.role === role));
    this.selected = this.ordered[0];
    // Préparation en avance (pendant que le joueur est sur l'accueil) : vignettes dessinées et
    // illustrations décodées, pour que la première ouverture de l'écran soit immédiate.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 400));
    idle(() => {
      for (const h of this.ordered) tileArt(h);
      for (const src of Object.values(ART)) {
        const img = new Image();
        img.src = src;
        img.decode().catch(() => {});
      }
    });
    this.root.addEventListener('dblclick', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-hero]');
      if (el) this.ready();
    });
  }

  override show(): void {
    // En changement de héros : on part d'un héros libre (pas celui qu'on joue déjà).
    if (this.isTaken(this.selected)) this.selected = this.ordered.find((h) => !this.isTaken(h)) ?? this.selected;
    super.show();
  }

  private title(): string {
    if (this.swap) return t('select.swap');
    if ((this.mode === 'control' || this.mode === 'escort') && this.map) {
      return t('select.title.map', { map: t(this.map.nameKey), mode: t(this.map.modeKey) });
    }
    if (this.mode === 'deathmatch') return t('select.title.dm');
    return t('select.title');
  }

  protected html(): string {
    const h = this.selected;
    const blocked = this.isTaken(h);
    const grid = ROLE_ORDER.map((role) => {
      const heroes = this.ordered.filter((x) => x.role === role);
      if (!heroes.length) return '';
      return `
        <div class="hs-group role-${role}">
          <div class="hs-group-head">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ROLE_ICONS[role]}</svg>
            ${t(ROLE_KEYS[role])}
          </div>
          <div class="hs-tiles">${heroes.map((x) => this.tileHtml(x)).join('')}</div>
        </div>`;
    }).join('');

    return `
      <header class="hs-top">
        <button type="button" class="hs-back" data-action="back" aria-label="${t('ui.back')}">‹ <span>${t('ui.back')}</span></button>
        <div class="hs-title">
          <small>${t('select.pick')}</small>
          <h1>${this.title()}</h1>
        </div>
      </header>

      <section class="hs-stage" style="--hero-color:${h.color}">
        <div class="hs-info" data-morph-key="${h.id}">
          <div class="hs-role role-${h.role}">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ROLE_ICONS[h.role]}</svg>
            ${t(ROLE_KEYS[h.role])} · ${h.hp} ${t('unit.hp')}
          </div>
          <h2 class="hs-name">${h.name}</h2>
          <p class="hs-tagline">${t(h.tagline)}</p>
        </div>
        <div class="hs-art-wrap">
          <div class="hs-art-glow"></div>
          ${ART[h.id] ? `<img class="hs-art" data-morph-key="${h.id}" src="${ART[h.id]}" alt="${h.name}" draggable="false">` : ''}
        </div>
        <ul class="hs-abilities" data-morph-key="${h.id}">
          ${h.abilities
            .map(
              (a) =>
                `<li><kbd>${t(INPUT_LABEL_KEYS[a.input])}</kbd><span><b>${t(a.name)}</b><small>${t(a.desc)}</small></span></li>`,
            )
            .join('')}
        </ul>
      </section>

      <footer class="hs-bottom">
        <div class="hs-grid">${grid}</div>
        <button type="button" class="hs-ready" data-action="ready" style="--hero-color:${h.color}" ${blocked ? 'disabled' : ''}>
          ${this.swap ? t('select.swap.ready') : t('select.ready')}
        </button>
      </footer>`;
  }

  private isTaken(h: HeroEntry): boolean {
    return !!this.swap && (this.swap.taken.includes(h.name) || this.swap.current === h.name);
  }

  private tileHtml(h: HeroEntry): string {
    const taken = this.isTaken(h);
    const index = this.ordered.indexOf(h) + 1;
    const note = taken ? `<span class="hs-taken">${this.swap?.current === h.name ? t('select.current') : t('select.takenShort')}</span>` : '';
    const sel = h === this.selected;
    return `
      <button type="button" class="hs-tile${sel ? ' is-selected' : ''}${taken ? ' is-taken' : ''}" data-action="pick" data-hero="${h.id}"
        style="--hero-color:${h.color}" aria-pressed="${sel}" title="${h.name}" ${taken ? 'aria-disabled="true"' : ''}>
        <img src="${tileArt(h)}" alt="" draggable="false">
        <span class="hs-tile-name">${h.name}</span>
        <span class="hs-tile-key">${index}</span>
        ${note}
      </button>`;
  }

  private back(): void {
    if (this.swap) this.swap.onClose();
    else this.onBack();
  }

  private select(hero: HeroEntry): void {
    if (hero === this.selected) return;
    this.selected = hero;
    this.render();
  }

  /** « Prêt » : lance la partie (ou change de héros en jeu) avec le héros sélectionné. */
  private ready(): void {
    const hero = this.selected;
    if (this.isTaken(hero)) return;
    if (this.swap) this.swap.onPick(hero);
    else this.onPick(hero);
  }

  protected override onAction(action: string, el: HTMLElement): void {
    if (action === 'back') return this.back();
    if (action === 'ready') return this.ready();
    if (action !== 'pick') return;
    const hero = this.ordered.find((h) => h.id === el.dataset.hero);
    if (hero) this.select(hero);
  }

  override handleKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') {
      this.back();
      return true;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      this.ready();
      return true;
    }
    const d = digitOf(e);
    const hero = d !== null ? this.ordered[d - 1] : undefined;
    if (!hero) return false;
    this.select(hero);
    return true;
  }
}
