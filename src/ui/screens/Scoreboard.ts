import { ordinal, t } from '../../i18n';
import { Screen } from './Screen';

export interface ScoreRow {
  rank: number;
  /** Nom du bot ; null pour le joueur (affiché « Toi » / « You » dans la langue courante). */
  name: string | null;
  hero: string;
  heroColor: string;
  kills: number;
  deaths: number;
}

export interface MatchResult {
  rows: ScoreRow[];
  playerRank: number;
  /** Le joueur est seul en tête (pas d'égalité). */
  playerWon: boolean;
}

/** Tableau des scores de fin de match. */
export class Scoreboard extends Screen {
  private result: MatchResult = { rows: [], playerRank: 1, playerWon: false };

  constructor(
    parent: HTMLElement,
    private readonly onMenu: () => void,
    private readonly onReplay: () => void,
  ) {
    super(parent, 'scoreboard');
  }

  showResult(result: MatchResult): void {
    this.result = result;
    this.show();
  }

  protected html(): string {
    const r = this.result;
    const headline = r.playerWon
      ? `<p class="score-headline win">${t('score.victory')}</p>`
      : `<p class="score-headline">${t('score.place', { rank: ordinal(r.playerRank), n: r.rows.length })}</p>`;
    const rows = r.rows
      .map(
        (row) => `
        <tr class="${row.name === null ? 'is-you' : ''} ${row.rank === 1 ? 'is-first' : ''}">
          <td class="col-rank">${ordinal(row.rank)}</td>
          <td class="col-name">${row.name ?? t('score.you')}</td>
          <td class="col-hero"><span class="hero-dot" style="--hero-color:${row.heroColor}"></span>${row.hero}</td>
          <td class="col-num">${row.kills}</td>
          <td class="col-num">${row.deaths}</td>
        </tr>`,
      )
      .join('');
    return `
      <h1>${t('score.title')}</h1>
      ${headline}
      <table class="score-table">
        <thead>
          <tr>
            <th class="col-rank">#</th>
            <th class="col-name">${t('score.player')}</th>
            <th class="col-hero">${t('score.hero')}</th>
            <th class="col-num">${t('score.kills')}</th>
            <th class="col-num">${t('score.deaths')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="screen-actions">
        <button type="button" class="btn" data-action="menu">${t('ui.mainMenu')}</button>
        <button type="button" class="btn btn-primary" data-action="replay">${t('ui.replay')}</button>
      </div>`;
  }

  protected override onAction(action: string): void {
    if (action === 'menu') this.onMenu();
    else if (action === 'replay') this.onReplay();
  }

  override handleKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') this.onMenu();
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') this.onReplay();
    else return false;
    return true;
  }
}
