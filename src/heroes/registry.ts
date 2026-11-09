import type { TKey } from '../i18n';
import { Camellia } from './Camellia';
import { Flux } from './Flux';
import type { Hero, InputSlot } from './Hero';
import { Rempart } from './Rempart';
import { Skater } from './Skater';
import { Tempo } from './Tempo';
import { Thor } from './Thor';
import { Turty } from './Turty';

export type Role = 'tank' | 'damage' | 'support';

/** Ordre d'affichage des rôles sur l'écran de sélection. */
export const ROLE_ORDER: Role[] = ['tank', 'damage', 'support'];
export const ROLE_KEYS: Record<Role, TKey> = {
  tank: 'role.tank',
  damage: 'role.damage',
  support: 'role.support',
};

export interface HeroEntry {
  id: string;
  name: string; // nom propre : non traduit
  role: Role;
  hp: number;
  color: string;
  tagline: TKey;
  abilities: { input: InputSlot; name: TKey; desc: TKey }[];
  create(): Hero;
}

/**
 * Héros jouables, triés par rôle (Tank → Dégâts → Soutien). Touches 1/2/3 = cet ordre.
 * Noms affichés et noms dans le code : Keraun = Thor, Kora = Turty, Elio = Skater (fichiers,
 * classes, identifiants et clés de texte gardent l'ancien nom).
 */
export const HEROES: HeroEntry[] = [
  {
    id: 'thor',
    name: 'Keraun',
    role: 'tank',
    hp: 600,
    color: '#5ab4ff',
    tagline: 'thor.tagline',
    abilities: [
      { input: 'primary', name: 'thor.weapon', desc: 'thor.weapon.desc' },
      { input: 'secondary', name: 'thor.barrier', desc: 'thor.barrier.desc' },
      { input: 'ability1', name: 'thor.smash', desc: 'thor.smash.desc' },
      { input: 'ability2', name: 'thor.throw', desc: 'thor.throw.desc' },
    ],
    create: () => new Thor(),
  },
  {
    id: 'flux',
    name: 'Flux',
    role: 'damage',
    hp: 175,
    color: '#ffb347',
    tagline: 'flux.tagline',
    abilities: [
      { input: 'primary', name: 'flux.weapon', desc: 'flux.weapon.desc' },
      { input: 'secondary', name: 'flux.phantom', desc: 'flux.phantom.desc' },
      { input: 'ability1', name: 'flux.permute', desc: 'flux.permute.desc' },
      { input: 'melee', name: 'melee.name', desc: 'melee.desc' },
    ],
    create: () => new Flux(),
  },
  {
    id: 'turty',
    name: 'Kora',
    role: 'damage',
    hp: 200,
    color: '#4fd1a5',
    tagline: 'turty.tagline',
    abilities: [
      { input: 'primary', name: 'turty.weapon', desc: 'turty.weapon.desc' },
      { input: 'secondary', name: 'turty.form', desc: 'turty.form.desc' },
      { input: 'ability1', name: 'turty.shell', desc: 'turty.shell.desc' },
      { input: 'ability2', name: 'turty.bomb', desc: 'turty.bomb.desc' },
      { input: 'melee', name: 'melee.name', desc: 'melee.desc' },
    ],
    create: () => new Turty(),
  },
  {
    id: 'skater',
    name: 'Elio',
    role: 'support',
    hp: 200,
    color: '#c7a3ff',
    tagline: 'skater.tagline',
    abilities: [
      { input: 'primary', name: 'skater.weapon', desc: 'skater.weapon.desc' },
      { input: 'secondary', name: 'skater.gear', desc: 'skater.gear.desc' },
      { input: 'ability1', name: 'skater.trick', desc: 'skater.trick.desc' },
      { input: 'ability2', name: 'skater.mode', desc: 'skater.mode.desc' },
    ],
    create: () => new Skater(),
  },
  {
    id: 'camellia',
    name: 'Camellia',
    role: 'support',
    hp: 200,
    color: '#ff8f9c',
    tagline: 'camellia.tagline',
    abilities: [
      { input: 'primary', name: 'camellia.weapon', desc: 'camellia.weapon.desc' },
      { input: 'secondary', name: 'camellia.angel', desc: 'camellia.angel.desc' },
      { input: 'ability1', name: 'camellia.flight', desc: 'camellia.flight.desc' },
      { input: 'ability2', name: 'camellia.sanctuary', desc: 'camellia.sanctuary.desc' },
      { input: 'melee', name: 'melee.name', desc: 'melee.desc' },
    ],
    create: () => new Camellia(),
  },
];

/**
 * Héros retirés de la sélection (plus jouables, ni par le joueur ni par les bots), gardés
 * dans le code au cas où : pour en remettre un, déplacer son entrée dans HEROES.
 */
export const RETIRED_HEROES: HeroEntry[] = [
  {
    id: 'rempart',
    name: 'Rempart',
    role: 'tank',
    hp: 600,
    color: '#a9b8c9',
    tagline: 'rempart.tagline',
    abilities: [
      { input: 'primary', name: 'rempart.weapon', desc: 'rempart.weapon.desc' },
      { input: 'secondary', name: 'rempart.shield', desc: 'rempart.shield.desc' },
      { input: 'ability1', name: 'rempart.fire', desc: 'rempart.fire.desc' },
      { input: 'ability2', name: 'rempart.charge', desc: 'rempart.charge.desc' },
    ],
    create: () => new Rempart(),
  },
  {
    id: 'tempo',
    name: 'Tempo',
    role: 'support',
    hp: 200,
    color: '#59d48a',
    tagline: 'tempo.tagline',
    abilities: [
      { input: 'primary', name: 'tempo.weapon', desc: 'tempo.weapon.desc' },
      { input: 'secondary', name: 'tempo.boop', desc: 'tempo.boop.desc' },
      { input: 'ability1', name: 'tempo.swap', desc: 'tempo.swap.desc' },
      { input: 'ability2', name: 'tempo.amp', desc: 'tempo.amp.desc' },
      { input: 'melee', name: 'melee.name', desc: 'melee.desc' },
    ],
    create: () => new Tempo(),
  },
];
