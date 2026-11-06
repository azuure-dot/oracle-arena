import { ordinal, t } from '../../i18n';
import { Screen } from './Screen';

export interface ScoreRow {
  /** Place (Deathmatch). */
  rank?: number;
  /** Nom du bot ; null pour le joueur (affiché « Toi » / « You » dans la langue courante). */
  name: string | null;
  hero: string;
  heroColor: string;
  kills: number;
  deaths: number;
  /** Équipe (Contrôle). */
  team?: 'blue' | 'red';
}

export type MatchResult =
  | { kind: 'deathmatch'; rows: ScoreRow[]; playerRank: number; playerWon: boolean }
  | { kind: 'control'; rows: ScoreRow[]; won: boolean; rounds: { blue: number; red: number } };

/** Tableau des scores de fin de match (Deathmatch : classement · Contrôle : victoire / défaite). */
export class Scoreboard extends Screen {
  private result: MatchResult = { kind: 'deathmatch', rows: [], playerRank: 1, playerWon: false };

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
    let head: string;
    let rows: string;
    if (r.kind === 'deathmatch') {
      head = `
        <h1>${t('score.title')}</h1>
        ${
          r.playerWon
            ? `<p class="score-headline win">${t('score.victory')}</p>`
            : `<p class="score-headline">${t('score.place', { rank: ordinal(r.playerRank), n: r.rows.length })}</p>`
        }`;
      rows = r.rows.map((row) => this.rowHtml(row, ordinal(row.rank ?? 0))).join('');
    } else {
      head = `
        <h1 class="result-title ${r.won ? 'win' : 'lose'}">${t(r.won ? 'control.victory' : 'control.defeat')}</h1>
        <p class="score-headline">${t('score.rounds', { a: r.rounds.blue, b: r.rounds.red })}</p>`;
      const team = (tm: 'blue' | 'red') =>
        `<tr class="team-head team-${tm}"><td colspan="4">${t(tm === 'blue' ? 'score.teamBlue' : 'score.teamRed')}</td></tr>` +
        r.rows
          .filter((row) => row.team === tm)
          .map((row) => this.rowHtml(row, ''))
          .join('');
      rows = team('blue') + team('red');
    }

    return `
      ${head}
      <table class="score-table${r.kind === 'control' ? ' by-team' : ''}">
        <thead>
          <tr>
            <th class="col-rank">${r.kind === 'deathmatch' ? '#' : ''}</th>
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

  private rowHtml(row: ScoreRow, rank: string): string {
    const cls = [row.name === null ? 'is-you' : '', row.rank === 1 ? 'is-first' : '', row.team ? `team-${row.team}` : '']
      .join(' ')
      .trim();
    return `
      <tr class="${cls}">
        <td class="col-rank">${rank}</td>
        <td class="col-name">${row.name ?? t('score.you')}</td>
        <td class="col-hero"><span class="hero-dot" style="--hero-color:${row.heroColor}"></span>${row.hero}</td>
        <td class="col-num">${row.kills}</td>
        <td class="col-num">${row.deaths}</td>
      </tr>`;
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
