import { getLang, onLangChange, setLang, type Lang } from '../../i18n';
import { ART_IDS, type ArtId } from './art';

/**
 * État du menu principal (réactif) : profil du joueur, mode de jeu choisi, groupe.
 * Mémorisé dans le navigateur ; la langue reste gérée par i18n (même source de vérité).
 * `subscribe` prévient à chaque changement (langue comprise) : le menu se redessine.
 */

export type ModeId = 'quickplay' | 'deathmatch' | 'practice' | 'ranked';
export const MODES: ModeId[] = ['quickplay', 'deathmatch', 'practice', 'ranked'];
/** Modes jouables aujourd'hui (le Classé arrive avec le multijoueur). */
export const PLAYABLE: ModeId[] = ['quickplay', 'deathmatch', 'practice'];

/** Taille du groupe affiché : le joueur + 5 places (bots en attendant le jeu en ligne). */
export const PARTY_SIZE = 6;

export interface ProfileState {
  name: string;
  avatar: ArtId;
  banner: ArtId;
  mode: ModeId;
  /** Places 2 à 6 : héros d'un bot, ou vide (null). */
  party: (ArtId | null)[];
  readonly lang: Lang;
}

const STORAGE_KEY = 'hero-shooter.profile';

type Stored = Omit<ProfileState, 'lang'>;

const DEFAULTS: Stored = {
  name: '',
  avatar: 'torsten',
  banner: 'torsten',
  mode: 'quickplay',
  party: [null, null, null, null, null],
};

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Stored> | null;
    if (!raw) return { ...DEFAULTS, party: [...DEFAULTS.party] };
    // Ancien nom de Torsten (avant le renommage) : les profils enregistrés le gardent.
    const renamed = (v: unknown): unknown => (v === 'keraun' ? 'torsten' : v);
    if (raw.avatar) raw.avatar = renamed(raw.avatar) as ArtId;
    if (raw.banner) raw.banner = renamed(raw.banner) as ArtId;
    const isArt = (v: unknown): v is ArtId => ART_IDS.includes(v as ArtId);
    const party = Array.from({ length: PARTY_SIZE - 1 }, (_, i) => {
      const v = renamed(raw.party?.[i]);
      return isArt(v) ? v : null;
    });
    return {
      name: typeof raw.name === 'string' ? raw.name.slice(0, 16) : DEFAULTS.name,
      avatar: isArt(raw.avatar) ? raw.avatar : DEFAULTS.avatar,
      banner: isArt(raw.banner) ? raw.banner : DEFAULTS.banner,
      mode: MODES.includes(raw.mode as ModeId) && raw.mode !== 'ranked' ? (raw.mode as ModeId) : DEFAULTS.mode,
      party,
    };
  } catch {
    return { ...DEFAULTS, party: [...DEFAULTS.party] };
  }
}

class ProfileStore {
  private state: Stored = load();
  private readonly listeners = new Set<(s: ProfileState) => void>();

  constructor() {
    onLangChange(() => this.emit());
  }

  get(): ProfileState {
    return { ...this.state, party: [...this.state.party], lang: getLang() };
  }

  /** Met à jour une partie de l'état, le mémorise et prévient les abonnés. */
  set(patch: Partial<Stored>): void {
    this.state = { ...this.state, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* stockage indisponible : l'état reste en mémoire */
    }
    this.emit();
  }

  setLang(lang: Lang): void {
    setLang(lang); // i18n prévient ses abonnés, dont ce store (voir constructeur)
  }

  /** Place 2-6 : ajoute un bot (héros tiré au sort parmi ceux pas encore dans le groupe) ou le retire. */
  toggleBot(slot: number): void {
    const party = [...this.state.party];
    if (party[slot]) party[slot] = null;
    else {
      const used = new Set([this.state.avatar, ...party.filter(Boolean)]);
      const free = ART_IDS.filter((a) => !used.has(a));
      const pool = free.length ? free : ART_IDS;
      party[slot] = pool[Math.floor(Math.random() * pool.length)];
    }
    this.set({ party });
  }

  subscribe(cb: (s: ProfileState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    const s = this.get();
    this.listeners.forEach((cb) => cb(s));
  }
}

export const profile = new ProfileStore();
