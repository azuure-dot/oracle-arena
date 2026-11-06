/**
 * Équipe d'une entité. Champ de tir : 'ally' (joueur + alliés) contre 'enemy'.
 * Deathmatch (chacun pour soi) : chaque participant a sa propre équipe.
 */
export type Team = string;

export const ALLY: Team = 'ally';
export const ENEMY: Team = 'enemy';
