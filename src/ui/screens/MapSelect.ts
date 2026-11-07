import { COLORS } from '../../config';
import { t } from '../../i18n';
import type { MapDef } from '../../world/maps';
import { Screen, digitOf } from './Screen';

/** Aperçu vectoriel de la carte, généré depuis ses murs (toujours à jour avec la carte). */
function mapPreview(m: MapDef): string {
  const walls = m.walls.map((w) => `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}"/>`).join('');
  const safe = m.safeZones
    .map(
      (z) =>
        `<rect x="${z.rect.x}" y="${z.rect.y}" width="${z.rect.w}" height="${z.rect.h}" fill="${z.team === 'ally' ? COLORS.ally : COLORS.enemy}" opacity="0.35"/>`,
    )
    .join('');
  const point = m.control
    ? `<circle cx="${m.control.x}" cy="${m.control.y}" r="${m.control.r}" fill="#ffb347" fill-opacity="0.18" stroke="#ffb347" stroke-width="12" stroke-dasharray="40 26"/>`
    : '';
  const packs = m.healthPacks.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="26" fill="${COLORS.recall}"/>`).join('');
  const water = (m.water ?? [])
    .map((w) => `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" fill="#1d5a7d"/>`)
    .join('');
  const lava = (m.lava ?? [])
    .map((w) => `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" fill="#ff6a1a"/>`)
    .join('');
  // Escorte : parcours du convoi, checkpoint, arrivée et salles de spawn
  let escort = '';
  if (m.escort) {
    const e = m.escort;
    const pts = e.path.map((p) => `${p.x},${p.y}`).join(' ');
    const cp = e.path[e.checkpoint];
    const end = e.path[e.path.length - 1];
    const room = (r: { rect: { x: number; y: number; w: number; h: number } }) =>
      `<rect x="${r.rect.x}" y="${r.rect.y}" width="${r.rect.w}" height="${r.rect.h}" fill="#f5d742" opacity="0.22"/>`;
    escort = `
      ${room(e.rooms.start)}${room(e.rooms.mid)}${room(e.rooms.end)}
      <polyline points="${pts}" fill="none" stroke="#5be37d" stroke-width="22" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>
      <circle cx="${e.path[0].x}" cy="${e.path[0].y}" r="40" fill="#5be37d"/>
      <circle cx="${cp.x}" cy="${cp.y}" r="46" fill="#10141a" stroke="#5be37d" stroke-width="16"/>
      <circle cx="${end.x}" cy="${end.y}" r="70" fill="#5be37d"/>`;
  }
  return `
    <svg class="map-preview" viewBox="0 0 ${m.width} ${m.height}" role="img" aria-label="${t(m.nameKey)}">
      <rect width="${m.width}" height="${m.height}" fill="#151b23" stroke="rgba(255,255,255,0.25)" stroke-width="12"/>
      ${water}${lava}${safe}${escort}${point}
      <g fill="#536079">${walls}</g>
      ${packs}
    </svg>`;
}

/** Partie rapide : choix de la carte (la carte détermine le mode de jeu). */
export class MapSelect extends Screen {
  constructor(
    parent: HTMLElement,
    private readonly maps: MapDef[],
    private readonly onPick: (map: MapDef) => void,
    private readonly onBack: () => void,
  ) {
    super(parent, 'map-select');
  }

  protected html(): string {
    const cards = this.maps
      .map(
        (m, i) => `
        <button type="button" class="map-card" data-action="pick" data-map="${m.id}">
          ${mapPreview(m)}
          <span class="map-info">
            <span class="mode-index">${i + 1}</span>
            <span class="map-name">${t(m.nameKey)}</span>
            <span class="map-mode">${t(m.modeKey)} · ${t(m.escort ? 'mode.teams.escort' : 'mode.teams')}</span>
            <span class="mode-desc">${t(m.descKey)}</span>
          </span>
        </button>`,
      )
      .join('');
    return `
      <h1>${t('map.title')}</h1>
      <p class="select-sub">${t('map.subtitle')}</p>
      <div class="map-cards">${cards}</div>
      <div class="screen-actions">
        <button type="button" class="btn" data-action="back"><kbd>${t('key.escape')}</kbd> ${t('ui.back')}</button>
      </div>`;
  }

  protected override onAction(action: string, el: HTMLElement): void {
    if (action === 'back') return this.onBack();
    const map = this.maps.find((m) => m.id === el.dataset.map);
    if (action === 'pick' && map) this.onPick(map);
  }

  override handleKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') {
      this.onBack();
      return true;
    }
    const d = digitOf(e);
    const map = d !== null ? this.maps[d - 1] : undefined;
    if (!map) return false;
    this.onPick(map);
    return true;
  }
}
