/**
 * Galerie de sprites (page /sprites.html) : toutes les vues et images de marche,
 * plus une version animée par direction. Sert à itérer sur les designs.
 */
import { COLORS } from './config';
import {
  HAMMER,
  HAMMER_PALETTE,
  REMPART_SPRITE,
  FLUX_SPRITE,
  TEMPO_SPRITE,
  ROBOT_SPRITE,
  TURRET_BARREL,
  TURRET_BASE,
  TURRET_PALETTE,
  type CharacterSprite,
} from './sprites/library';
import { characterFrame, propImage, WALK_FPS, WALK_FRAMES, type Facing } from './sprites/SpriteRenderer';
import { deckImage, gearImage, SKATER_DIRS, skaterFrame, type SkaterLook } from './sprites/skater';
import { BLAST_FRAMES, blastImage, bombImage, IMPACT_FRAMES, impactImage, turtyFrame, type TurtyLook } from './sprites/turty';

interface Entry {
  title: string;
  def: CharacterSprite;
  outline: string;
  overrides?: Record<string, string>;
}

const ENTRIES: Entry[] = [
  { title: 'Rempart (allié)', def: REMPART_SPRITE, outline: COLORS.ally },
  { title: 'Flux (allié)', def: FLUX_SPRITE, outline: COLORS.ally },
  { title: 'Tempo — aura Soin', def: TEMPO_SPRITE, outline: COLORS.ally, overrides: { a: COLORS.auraHeal } },
  { title: 'Tempo — aura Vitesse', def: TEMPO_SPRITE, outline: COLORS.ally, overrides: { a: COLORS.auraSpeed } },
  { title: 'Robot — ennemi', def: ROBOT_SPRITE, outline: COLORS.enemy, overrides: { t: COLORS.enemy } },
  { title: 'Robot — allié', def: ROBOT_SPRITE, outline: COLORS.ally, overrides: { t: COLORS.ally } },
];

const FACINGS: Facing[] = ['down', 'up', 'left', 'right'];
const FACING_LABEL: Record<Facing, string> = { down: 'Face', up: 'Dos', left: 'Gauche', right: 'Droite' };

const root = document.getElementById('gallery')!;
const zoomInput = document.getElementById('zoom') as HTMLInputElement;
const animated: { canvas: HTMLCanvasElement; entry: Entry; facing: Facing }[] = [];

function blit(canvas: HTMLCanvasElement, img: HTMLCanvasElement, scale: number): void {
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
}

function render(): void {
  const scale = Number(zoomInput.value);
  root.innerHTML = '';
  animated.length = 0;

  for (const entry of ENTRIES) {
    const section = document.createElement('section');
    section.innerHTML = `<h2>${entry.title}</h2><div class="rows"></div>`;
    const rows = section.querySelector('.rows')!;
    for (const facing of FACINGS) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span>${FACING_LABEL[facing]}</span>`;
      for (let f = 0; f < WALK_FRAMES; f++) {
        const c = document.createElement('canvas');
        blit(c, characterFrame(entry.def, facing, f, { outline: entry.outline, overrides: entry.overrides }), scale);
        row.appendChild(c);
      }
      const anim = document.createElement('canvas');
      anim.className = 'anim';
      anim.title = 'Animation de marche';
      row.appendChild(anim);
      animated.push({ canvas: anim, entry, facing });
      rows.appendChild(row);
    }
    root.appendChild(section);
  }

  // Accessoires
  const props = document.createElement('section');
  props.innerHTML = '<h2>Accessoires</h2><div class="row"></div>';
  const row = props.querySelector('.row')!;
  for (const [name, img] of [
    ['Tourelle ennemie', propImage('turret.base', TURRET_BASE, TURRET_PALETTE, { outline: COLORS.enemy, overrides: { t: COLORS.enemy } })],
    ['Canon', propImage('turret.barrel', TURRET_BARREL, TURRET_PALETTE, { outline: COLORS.enemy, overrides: { t: COLORS.enemy } })],
    ['Tourelle alliée', propImage('turret.base', TURRET_BASE, TURRET_PALETTE, { outline: COLORS.ally, overrides: { t: COLORS.ally } })],
    ['Marteau', propImage('hammer', HAMMER, HAMMER_PALETTE, { outline: '#141820' })],
  ] as const) {
    const c = document.createElement('canvas');
    c.title = name;
    blit(c, img, scale);
    row.appendChild(c);
  }
  root.appendChild(props);
  renderSkater(scale);
  renderTurty(scale);
}

/** Skater : poses tirées de la planche du joueur, rangées en 8 directions × 2 images. */
const skaterAnims: { canvas: HTMLCanvasElement; look: SkaterLook; dir: (typeof SKATER_DIRS)[number] }[] = [];
const LOOK_LABEL: Record<SkaterLook, string> = {
  ride: 'Sur la planche',
  foot: 'À pied (planche à la main)',
  body: 'Corps sans planche (sauts)',
  swing: 'Corps sans bras (coups : bras et planche dessinés par le jeu)',
  throw: 'Lancer d’équipement (sans bras droit : il est dessiné par le jeu)',
};

function renderSkater(scale: number): void {
  skaterAnims.length = 0;
  const z = Math.max(1, Math.round(scale * 0.6));
  for (const look of ['ride', 'foot', 'body', 'swing', 'throw'] as SkaterLook[]) {
    const section = document.createElement('section');
    section.innerHTML = `<h2>Skater — ${LOOK_LABEL[look]}</h2><div class="row"></div>`;
    const row = section.querySelector('.row')!;
    for (const dir of SKATER_DIRS) {
      for (let f = 0; f < (look === 'body' || look === 'swing' || look === 'throw' ? 1 : 2); f++) {
        const c = document.createElement('canvas');
        c.title = `${dir} ${f ? 'B' : 'A'}`;
        blit(c, skaterFrame(look, dir, f, { outline: COLORS.ally }).img, z);
        row.appendChild(c);
      }
      if (look === 'ride' || look === 'foot') {
        const anim = document.createElement('canvas');
        anim.className = 'anim';
        anim.title = `${dir} (animé)`;
        row.appendChild(anim);
        skaterAnims.push({ canvas: anim, look, dir });
      }
    }
    root.appendChild(section);
  }
  const props = document.createElement('section');
  props.innerHTML = '<h2>Skater — accessoires (planche animée, équipement lancé)</h2><div class="row"></div>';
  const row = props.querySelector('.row')!;
  for (const img of [deckImage('grip'), deckImage('under'), deckImage('edge'), ...[0, 1, 2, 3].map((i) => gearImage(i, COLORS.enemy))]) {
    const c = document.createElement('canvas');
    blit(c, img, z);
    row.appendChild(c);
  }
  root.appendChild(props);
}

/** Turty : poses tirées des planches du joueur (8 directions par forme). */
const TURTY_LOOKS: Record<TurtyLook, string> = {
  human: 'Forme humaine',
  turtle: 'Forme tortue (sur l’eau)',
  turtleDry: 'Forme tortue (sur le sec : éclaboussures retirées)',
  shell: 'Dans la carapace',
};
function renderTurty(scale: number): void {
  const z = Math.max(1, Math.round(scale * 0.6));
  for (const look of Object.keys(TURTY_LOOKS) as TurtyLook[]) {
    const section = document.createElement('section');
    section.innerHTML = `<h2>Turty — ${TURTY_LOOKS[look]}</h2><div class="row"></div>`;
    const row = section.querySelector('.row')!;
    for (const dir of SKATER_DIRS) {
      const c = document.createElement('canvas');
      c.title = dir;
      blit(c, turtyFrame(look, dir, { outline: COLORS.ally }).img, z);
      row.appendChild(c);
    }
    root.appendChild(section);
  }
  // Forme humaine : temps de marche 1 à 3, puis image de tir, pour chaque direction.
  const anims: [string, { step?: number; fire?: boolean }][] = [
    ['marche, temps 1 (jambe gauche levée / enjambée avant)', { step: 1 }],
    ['marche, temps 3 (jambe droite levée / enjambée arrière)', { step: 3 }],
    ['tir (arme qui recule + jet d’eau)', { fire: true }],
  ];
  for (const [label, a] of anims) {
    const section = document.createElement('section');
    section.innerHTML = `<h2>Turty — forme humaine, ${label}</h2><div class="row"></div>`;
    const row = section.querySelector('.row')!;
    for (const dir of SKATER_DIRS) {
      const c = document.createElement('canvas');
      c.title = dir;
      blit(c, turtyFrame('human', dir, { outline: COLORS.ally, ...a }).img, z);
      row.appendChild(c);
    }
    root.appendChild(section);
  }
  const props = document.createElement('section');
  props.innerHTML = '<h2>Turty — bombe à eau (vol, impact, explosion)</h2><div class="row"></div>';
  const row = props.querySelector('.row')!;
  const imgs = [
    ...SKATER_DIRS.map((d) => bombImage(d)),
    ...Array.from({ length: IMPACT_FRAMES }, (_, i) => impactImage(i)),
    ...Array.from({ length: BLAST_FRAMES }, (_, i) => blastImage(i)),
  ];
  for (const img of imgs) {
    const c = document.createElement('canvas');
    blit(c, img, z);
    row.appendChild(c);
  }
  root.appendChild(props);
}

function animate(time: number): void {
  const scale = Number(zoomInput.value);
  const frame = Math.floor((time / 1000) * WALK_FPS) % WALK_FRAMES;
  for (const a of animated) {
    blit(a.canvas, characterFrame(a.entry.def, a.facing, frame, { outline: a.entry.outline, overrides: a.entry.overrides }), scale);
  }
  const skFrame = Math.floor((time / 1000) * 4) % 2;
  const z = Math.max(1, Math.round(scale * 0.6));
  for (const a of skaterAnims) blit(a.canvas, skaterFrame(a.look, a.dir, skFrame, { outline: COLORS.ally }).img, z);
  requestAnimationFrame(animate);
}

zoomInput.addEventListener('input', render);
render();
requestAnimationFrame(animate);
