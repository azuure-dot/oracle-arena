import { ordinal, t } from '../i18n';
import { escapeHtml } from './lobby/settingsPanel';
import { morph } from './morph';
import type { MatchResult, ScoreRow } from './screens/Scoreboard';
import './ingame.css';

export interface LiveScores {
  /** Nom du mode (et de la carte), en tête du tableau. */
  title: string;
  result: MatchResult;
  /** Partie en ligne : colonne Ping, et ping du joueur en tête. */
  online: boolean;
  /** Ping du joueur (ms), null s'il n'est pas encore mesuré. */
  ping: number | null;
}

/**
 * TABLEAU DES SCORES EN JEU (touche Tab maintenue ; bouton ★ sur téléphone).
 * Panneau de marbre translucide, dans le style du menu principal : la partie reste visible
 * derrière (on voit son héros pour continuer à se déplacer) et il ne capte aucun clic.
 * Le HTML n'est réécrit que quand le contenu change (pas 60 fois par seconde).
 */
export class ScoreOverlay {
  private readonly root: HTMLDivElement;
  private last = '';
  private shown = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'score-overlay';
    this.root.setAttribute('aria-live', 'polite');
    parent.appendChild(this.root);
  }

  show(s: LiveScores): void {
    const html = this.html(s);
    if (html !== this.last) {
      this.last = html;
      morph(this.root, html);
    }
    if (!this.shown) {
      this.shown = true;
      this.root.classList.add('visible');
    }
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.remove('visible');
  }

  private html(s: LiveScores): string {
    const r = s.result;
    const ping = s.online ? `<span class="so-ping ${pingClass(s.ping)}"><i></i>${t('scores.ping')} ${s.ping === null ? '—' : `${Math.round(s.ping)} ms`}</span>` : '';
    const cols = s.online ? 6 : 5;
    const head = `
      <tr>
        <th class="col-rank">${r.kind === 'deathmatch' ? '#' : ''}</th>
        <th class="col-name">${t('score.player')}</th>
        <th class="col-hero">${t('score.hero')}</th>
        <th class="col-num">${t('score.kills')}</th>
        <th class="col-num">${t('score.deaths')}</th>
        ${s.online ? `<th class="col-num">${t('scores.ping')}</th>` : ''}
      </tr>`;
    let body: string;
    if (r.kind === 'deathmatch') {
      body = r.rows.map((row) => this.row(row, ordinal(row.rank ?? 0), s.online)).join('');
    } else {
      const team = (tm: 'blue' | 'red') =>
        `<tr class="so-team so-team--${tm}"><td colspan="${cols}">${t(tm === 'blue' ? 'score.teamBlue' : 'score.teamRed')}</td></tr>` +
        r.rows
          .filter((row) => row.team === tm)
          .map((row) => this.row(row, '', s.online))
          .join('');
      body = team('blue') + team('red');
    }
    return `
      <section class="so-panel" aria-label="${escapeHtml(s.title)}">
        <header class="so-head">
          <h2>${escapeHtml(s.title)}${s.online ? ` <small>${t('scores.online')}</small>` : ''}</h2>
          ${ping}
        </header>
        <table class="so-table">
          <thead>${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </section>`;
  }

  private row(row: ScoreRow, rank: string, online: boolean): string {
    const cls = [row.name === null ? 'is-you' : '', row.rank === 1 ? 'is-first' : ''].join(' ').trim();
    return `
      <tr class="${cls}">
        <td class="col-rank">${rank}</td>
        <td class="col-name">${row.name === null ? t('score.you') : escapeHtml(row.name)}</td>
        <td class="col-hero"><span class="hero-dot" style="--hero-color:${row.heroColor}"></span>${row.hero}</td>
        <td class="col-num">${row.kills}</td>
        <td class="col-num">${row.deaths}</td>
        ${online ? `<td class="col-num col-ping">${row.ping ?? ''}</td>` : ''}
      </tr>`;
  }
}

/** Couleur de la pastille du ping : bon (< 60 ms), moyen (< 120 ms), mauvais. */
function pingClass(ms: number | null): string {
  if (ms === null) return '';
  return ms < 60 ? 'is-good' : ms < 120 ? 'is-ok' : 'is-bad';
}
