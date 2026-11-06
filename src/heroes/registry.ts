import type { TKey } from '../i18n';
import { Flux } from './Flux';
import type { Hero, InputSlot } from './Hero';
import { Rempart } from './Rempart';
import { Tempo } from './Tempo';

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

/** Héros jouables, triés par rôle (Tank → Dégâts → Soutien). Touches 1/2/3 = cet ordre. */
export const HEROES: HeroEntry[] = [
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
    id: 'flux',
    name: 'Flux',
    role: 'damage',
    hp: 175,
    color: '#ffb347',
    tagline: 'flux.tagline',
    abilities: [
      { input: 'primary', name: 'flux.weapon', desc: 'flux.weapon.desc' },
      { input: 'secondary', name: 'flux.blink', desc: 'flux.blink.desc' },
      { input: 'ability1', name: 'flux.recall', desc: 'flux.recall.desc' },
      { input: 'melee', name: 'melee.name', desc: 'melee.desc' },
    ],
    create: () => new Flux(),
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
