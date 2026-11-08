"""
Convertit les planches de Turty (concept/turty-*.png) en grilles pixel art pour le jeu
(src/sprites/turtySheet.ts).

    python tools/extract_turty.py

- Les premières planches n'ont pas de grille nette (images redimensionnées, un peu floues) :
  on rééchantillonne chaque pose sur une grille de CELL px d'écran, calée sur les
  bords du dessin (phase mesurée pose par pose). La planche de la forme humaine de combat
  (turty-human-combat.png) a une grille nette de 4 px : sa rangée a sa propre taille de case.
- Le fond gris relié au bord de la pose est retiré (un gris à l'intérieur du dessin est gardé).
- Les couleurs sont réduites à une palette commune (k-moyennes), du plus sombre au plus clair.
- Chaque rangée suit l'ordre des étiquettes de la planche :
  SUD, SUD-OUEST, OUEST, NORD-OUEST, NORD, NORD-EST, EST, SUD-EST.

Les .webp d'origine sont convertis en .png par Windows (WIC), voir le README.
Aucune dépendance : lecture PNG en pur Python (zlib), partagée avec extract_skater.py.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_skater import CHARS, read_png  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'sprites' / 'turtySheet.ts'
CELL = 2.84
COLORS = 44

# (nom, fichier, y0, y1, x0, x1, coupes approximatives entre poses[, taille de case])
# Les coupes sont recalées sur la colonne la plus vide à ±30 px.
ROWS = [
    ('HUMAN', 'turty-human-combat.png', 50, 210, 5, 1000, [122, 275, 380, 530, 645, 768, 872], 4.0),
    ('TURTLE', 'turty-sheet.png', 368, 505, 20, 1005, [150, 295, 442, 550, 645, 760, 870]),
    ('SHELL', 'turty-shell.png', 58, 165, 15, 1000, [137, 266, 391, 517, 635, 756, 877]),
    ('BOMB', 'turty-bomb.png', 48, 200, 25, 1005, [150, 290, 395, 535, 650, 780, 878]),
    ('IMPACT', 'turty-bomb.png', 320, 478, 190, 900, [390, 640]),
    ('BLAST', 'turty-bomb.png', 548, 752, 20, 1010, [270, 580, 810]),
]

DOCS = {
    'HUMAN': 'Forme humaine (combat), 8 directions.',
    'TURTLE': 'Forme tortue (mobilité), 8 directions.',
    'SHELL': 'Rentrée dans la carapace, 8 directions.',
    'BOMB': 'Bombe à eau en vol, 8 directions.',
    'IMPACT': "Bombe posée au sol : impact puis amorce (3 images).",
    'BLAST': 'Explosion de la bombe (4 images).',
}


def is_bg(c):
    return max(c) - min(c) < 20 and 112 < sum(c) / 3 < 172


def main() -> None:
    sheets = {}
    frames = {}
    for name, file, y0, y1, x0, x1, cuts, *opt in ROWS:
        cell_size = opt[0] if opt else CELL
        if file not in sheets:
            sheets[file] = read_png(ROOT / 'concept' / file)
        w, h, px = sheets[file]
        occ = [sum(1 for y in range(y0, y1) if not is_bg(px(x, y))) for x in range(w)]
        cuts = [min(range(c - 30, c + 31), key=lambda x: (occ[x], abs(x - c))) for c in cuts]
        edges = [x0] + cuts + [x1]
        frames[name] = []
        for a, b in zip(edges, edges[1:]):
            frames[name].append(sample(px, w, h, a, y0, b, y1, cell_size))

    # Palette commune : graines par fréquence (écart minimal) puis k-moyennes.
    pts = {}
    for fs in frames.values():
        for f in fs:
            for r in f:
                for v in r:
                    if v:
                        pts[v] = pts.get(v, 0) + 1
    uniq = list(pts.items())
    pal = []
    gap = 40
    while len(pal) < COLORS and gap > 4:
        pal = []
        for c in sorted(pts, key=pts.get, reverse=True):
            if all(math.dist(p, c) >= gap for p in pal):
                pal.append(c)
        if len(pal) > COLORS:
            pal = pal[:COLORS]
            break
        gap -= 3
    for _ in range(10):
        acc = [[0, 0, 0, 0] for _ in pal]
        for c, n in uniq:
            a = acc[min(range(len(pal)), key=lambda k: math.dist(pal[k], c))]
            a[0] += c[0] * n
            a[1] += c[1] * n
            a[2] += c[2] * n
            a[3] += n
        pal = [tuple(round(a[k] / a[3]) for k in range(3)) for a in acc if a[3]]
    pal.sort(key=lambda c: (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]))
    nearest = {c: CHARS[min(range(len(pal)), key=lambda k: math.dist(pal[k], c))] for c, _ in uniq}

    lines = [
        '// Fichier généré par tools/extract_turty.py depuis concept/turty-*.png : ne pas modifier à la main.',
        "import { grid, type Grid, type Palette } from './pixelArt';",
        '',
        '/** Palette des planches de Turty (du plus sombre au plus clair). */',
        'export const TURTY_SHEET_PALETTE: Palette = {',
    ]
    for i, c in enumerate(pal):
        lines.append(f"  '{CHARS[i]}': '#{c[0]:02x}{c[1]:02x}{c[2]:02x}',")
    lines.append('};')
    for name, fs in frames.items():
        lines += ['', f'/** {DOCS[name]} */', f'export const TURTY_{name}: readonly Grid[] = [']
        for n, f in enumerate(fs):
            lines.append('  grid(`')
            for r in f:
                lines.append('    |' + ''.join(nearest[v] if v else '.' for v in r) + '|')
            lines.append(f"  `, 'turty.{name.lower()}.{n}'),")
        lines.append('];')
    OUT.write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')
    print(f'{sum(len(f) for f in frames.values())} poses, {len(pal)} couleurs -> {OUT.relative_to(ROOT)}')


def phase(px, x0, y0, x1, y1, axis, cell=CELL):
    """Décalage de la grille (0..CELL) qui aligne le mieux les bords des cases sur les contrastes."""
    c = s = 0.0
    for y in range(y0, y1):
        for x in range(x0, x1):
            a = px(x, y)
            b = px(x + 1, y) if axis == 'x' else px(x, y + 1)
            d = abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
            e = 2 * math.pi * ((x if axis == 'x' else y) + 0.5) / cell
            c += d * math.cos(e)
            s += d * math.sin(e)
    return (math.atan2(s, c) / 2 / math.pi * cell) % cell


def sample(px, w, h, x0, y0, x1, y1, CELL=CELL):
    ph_x = phase(px, x0, y0, x1 - 1, y1 - 1, 'x', CELL)
    ph_y = phase(px, x0, y0, x1 - 1, y1 - 1, 'y', CELL)

    def centers(lo, hi, ph):
        g = ph + math.floor((lo - ph) / CELL) * CELL
        out = []
        while g < hi:
            if g + CELL / 2 >= lo:
                out.append(g + CELL / 2)
            g += CELL
        return out

    xs = centers(x0, x1, ph_x)
    ys = centers(y0, y1, ph_y)

    def cell(cx, cy):
        votes = []
        for dx in (-0.5, 0.5):
            for dy in (-0.5, 0.5):
                votes.append(px(min(w - 1, max(0, round(cx + dx))), min(h - 1, max(0, round(cy + dy)))))
        # Moyenne des 4 points les plus proches de leur médiane (évite les bords flous).
        return tuple(sum(v[k] for v in votes) // 4 for k in range(3))

    grid = [[cell(cx, cy) for cx in xs] for cy in ys]
    gh, gw = len(grid), len(grid[0])
    seen = set()
    stack = [(x, y) for x in range(gw) for y in (0, gh - 1)] + [(x, y) for y in range(gh) for x in (0, gw - 1)]
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < gw and 0 <= y < gh) or not is_bg(grid[y][x]):
            continue
        seen.add((x, y))
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    grid = [[None if (x, y) in seen else c for x, c in enumerate(r)] for y, r in enumerate(grid)]
    # Points isolés (bruit du fond) : retirés s'ils sont presque gris.
    for y in range(gh):
        for x in range(gw):
            c = grid[y][x]
            if c and max(c) - min(c) < 30 and 100 < sum(c) / 3 < 185:
                if not any(grid[yy][xx] for xx, yy in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)) if 0 <= xx < gw and 0 <= yy < gh):
                    grid[y][x] = None
    while grid and not any(grid[0]):
        grid.pop(0)
    while grid and not any(grid[-1]):
        grid.pop()
    left = min(i for r in grid for i, v in enumerate(r) if v)
    right = max(i for r in grid for i, v in enumerate(r) if v)
    return [r[left:right + 1] for r in grid]


if __name__ == '__main__':
    sys.exit(main())
