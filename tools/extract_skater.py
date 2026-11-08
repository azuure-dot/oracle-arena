"""
Convertit la planche de sprites du Skater (concept/skater-sheet.png) en grilles pixel art
pour le jeu (src/sprites/skaterSheet.ts).

    python tools/extract_skater.py

- La planche est dessinée sur une grille de 4 px d'écran par pixel : on échantillonne le
  centre de chaque case, on retire le fond gris et on rogne chaque pose.
- Les couleurs (légèrement bruitées sur l'image) sont réduites à une palette commune
  (~34 couleurs), en gardant l'aspect d'origine.
- Les 24 poses gardent l'ordre de la planche : 0-11 sur la planche, 12-23 à pied.

Aucune dépendance : lecture PNG en pur Python (zlib).
"""
import math
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'concept' / 'skater-sheet.png'
OUT = ROOT / 'src' / 'sprites' / 'skaterSheet.ts'
CELL = 4
BG = (144, 144, 144)
CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+-=?@^~'


def read_png(path: Path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'pas un PNG'
    pos = 8
    idat = b''
    while pos < len(data):
        length, kind = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b'IHDR':
            w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', chunk)
            assert depth == 8 and ctype in (2, 6) and interlace == 0, 'PNG 8 bits RGB/RGBA non entrelacé attendu'
        elif kind == b'IDAT':
            idat += chunk
        pos += 12 + length
    bpp = 4 if ctype == 6 else 3
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows = []
    prev = bytearray(stride)
    i = 0
    for _ in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else b if pb <= pc else c
                line[x] = (line[x] + pr) & 255
        rows.append(line)
        prev = line
    return w, h, lambda x, y: tuple(rows[y][x * bpp:x * bpp + 3])


def main() -> None:
    w, h, px = read_png(SRC)
    is_bg = lambda c: all(abs(c[k] - BG[k]) < 22 for k in range(3))

    # Bandes horizontales (lignes de poses), sans les titres (trop bas)
    occ = [sum(1 for x in range(0, w, 2) if not is_bg(px(x, y))) for y in range(h)]
    bands, start = [], None
    for y, n in enumerate(occ + [0]):
        if n and start is None:
            start = y
        elif not n and start is not None:
            if y - start > 80:
                bands.append((start, y - 1))
            start = None

    frames = []
    for y0, y1 in bands:
        cols = [sum(1 for y in range(y0, y1 + 1, 2) if not is_bg(px(x, y))) for x in range(w)]
        segs, s = [], None
        for x, n in enumerate(cols + [0]):
            if n and s is None:
                s = x
            elif not n and s is not None:
                segs.append((s, x - 1))
                s = None
        for x0, x1 in segs:
            cx0, cx1 = x0 // CELL - 1, -(-x1 // CELL) + 1
            cy0, cy1 = y0 // CELL - 1, -(-y1 // CELL) + 1
            grid = []
            for cy in range(cy0, cy1):
                row = []
                for cx in range(cx0, cx1):
                    votes = {}
                    for yy in (0, 1):
                        for xx in (1, 2):
                            c = px(min(w - 1, cx * CELL + xx), min(h - 1, cy * CELL + yy))
                            votes[c] = votes.get(c, 0) + 1
                    row.append(max(votes, key=votes.get))
                grid.append(row)
            # Fond = cases grises reliées au bord (un gris à l'intérieur du dessin est gardé).
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
            while grid and not any(grid[0]):
                grid.pop(0)
            while grid and not any(grid[-1]):
                grid.pop()
            left = min(i for r in grid for i, v in enumerate(r) if v)
            right = max(i for r in grid for i, v in enumerate(r) if v)
            frames.append([r[left:right + 1] for r in grid])
    assert len(frames) == 24, f'{len(frames)} poses trouvées au lieu de 24'

    # Palette commune : graines par fréquence (écart minimal 30) puis k-moyennes.
    pts = [v for f in frames for r in f for v in r if v]
    freq = {}
    for v in pts:
        freq[v] = freq.get(v, 0) + 1
    dist = lambda a, b: math.dist(a, b)
    pal = []
    for c in sorted(freq, key=freq.get, reverse=True):
        if all(dist(p, c) >= 30 for p in pal):
            pal.append(c)
    uniq = list(freq.items())
    for _ in range(8):
        acc = [[0, 0, 0, 0] for _ in pal]
        for c, n in uniq:
            i = min(range(len(pal)), key=lambda k: dist(pal[k], c))
            a = acc[i]
            a[0] += c[0] * n
            a[1] += c[1] * n
            a[2] += c[2] * n
            a[3] += n
        pal = [tuple(round(a[k] / a[3]) for k in range(3)) for a in acc if a[3]]
    pal.sort(key=lambda c: sum(c))  # du plus sombre au plus clair : lettres stables
    assert len(pal) <= len(CHARS)
    nearest = {}
    for c, _ in uniq:
        nearest[c] = CHARS[min(range(len(pal)), key=lambda k: dist(pal[k], c))]

    lines = [
        '// Fichier généré par tools/extract_skater.py depuis concept/skater-sheet.png : ne pas modifier à la main.',
        "import { grid, type Grid, type Palette } from './pixelArt';",
        '',
        '/** Palette de la planche du Skater (du plus sombre au plus clair). */',
        'export const SKATER_SHEET_PALETTE: Palette = {',
    ]
    for i, c in enumerate(pal):
        lines.append(f"  '{CHARS[i]}': '#{c[0]:02x}{c[1]:02x}{c[2]:02x}',")
    lines += [
        '};',
        '',
        '/** Les 24 poses, dans l\'ordre de la planche : 0-11 sur la planche, 12-23 à pied (planche à la main). */',
        'export const SKATER_SHEET: readonly Grid[] = [',
    ]
    for n, f in enumerate(frames):
        lines.append('  grid(`')
        for r in f:
            lines.append('    |' + ''.join(nearest[v] if v else '.' for v in r) + '|')
        lines.append(f"  `, 'skater.{n}'),")
    lines.append('];')
    OUT.write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')
    print(f'{len(frames)} poses, {len(pal)} couleurs -> {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
