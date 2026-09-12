/* ============================================================================
   Detection automatique de la position de depart a partir d'une capture
   d'ecran DOFUS du combat "En ce jardin qui nous unit".

   Entree : pixels RGBA (Uint8ClampedArray), largeur, hauteur.
   Sortie : { ok, lattice:{hw,hh,ox,oy}, souffles:[{u,v,c}], player:[u,v], ... }

   Principe
   1. Les cases de placement ennemies sont entourees d'un hexagone orange :
      on en extrait les centres -> ce sont exactement des centres de cases.
   2. On ajuste le pas de la grille isometrique (hw, hh = hw/2) puis l'origine.
   3. Couleur du souffle : la tete du dragon se trouve ~1,35 * hw au-dessus du
      centre de la case ; tete tres sombre = Wukin (noir), sinon Wukang (blanc).
   4. Le personnage est sur la case au liseré clair entourée des cases vertes
      de placement.
   5. On recale enfin la grille sur la carte connue de l'arene.
   ============================================================================ */
(function (root) {
  'use strict';

  function luminance(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  /* ---------------------------------------------------- composantes liees */
  function components(mask, W, H, minPix) {
    const lab = new Int32Array(W * H).fill(-1);
    const st = new Int32Array(W * H);
    const out = [];
    for (let i = 0; i < W * H; i++) {
      if (!mask[i] || lab[i] >= 0) continue;
      let sp = 0; st[sp++] = i; lab[i] = out.length;
      let n = 0, sx = 0, sy = 0, mnx = 1e9, mxx = -1, mny = 1e9, mxy = -1;
      while (sp) {
        const c = st[--sp], x = c % W, y = (c - x) / W;
        n++; sx += x; sy += y;
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (y < mny) mny = y; if (y > mxy) mxy = y;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (mask[ni] && lab[ni] < 0) { lab[ni] = out.length; st[sp++] = ni; }
        }
      }
      out.push({ n, cx: sx / n, cy: sy / n, w: mxx - mnx + 1, h: mxy - mny + 1,
                 x0: mnx, y0: mny, x1: mxx, y1: mxy });
    }
    return out.filter(c => c.n >= minPix);
  }

  /* ------------------------------------------------- hexagones de placement */
  function orangeCenters(d, W, H) {
    const mask = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      const r = d[j], g = d[j + 1], b = d[j + 2];
      if (r > 125 && r - g > 50 && g - b > 5 && b < 115) mask[i] = 1;
    }
    const comps = components(mask, W, H, 45);
    // un hexagone fait ~0,75 case de large et 2x moins haut : ratio ~2
    return comps.filter(c => c.w > 12 && c.w < 260 && c.h > 5 && c.h < 140 &&
                             c.w / c.h > 1.2 && c.w / c.h < 4.2);
  }

  /* --------------------------------------------------------- pas de grille */
  function fitLattice(pts) {
    if (pts.length < 3) return null;
    const ref = pts.reduce((a, b) => (a.cy < b.cy ? a : b));
    let best = null;
    for (let hw = 120; hw >= 16; hw -= 0.25) {
      const hh = hw / 2;
      let err = 0;
      for (const p of pts) {
        const a = (p.cx - ref.cx) / hw, b = (p.cy - ref.cy) / hh;
        const u = (a + b) / 2, v = (b - a) / 2;
        const du = u - Math.round(u), dv = v - Math.round(v);
        err += du * du + dv * dv;
      }
      err = Math.sqrt(err / pts.length);
      if (err < 0.085) { best = { hw, hh, err }; break; }   // le plus grand pas valable
      if (!best || err < best.err) best = { hw, hh, err, weak: true };
    }
    if (!best || best.err > 0.2) return null;
    // affinage de l'origine : moyenne des residus
    const { hw, hh } = best;
    let sx = 0, sy = 0;
    for (const p of pts) {
      const a = (p.cx - ref.cx) / hw, b = (p.cy - ref.cy) / hh;
      const u = Math.round((a + b) / 2), v = Math.round((b - a) / 2);
      sx += p.cx - (u - v) * hw; sy += p.cy - (u + v) * hh;
    }
    return { hw, hh, ox: sx / pts.length, oy: sy / pts.length, err: best.err };
  }

  /* Balayage complet : score de "hexagone orange" pour chaque case de la grille.
     Recupere aussi les hexagones partiellement masques par les sprites.      */
  function ringScore(d, W, H, L, u, v) {
    const cx = L.ox + (u - v) * L.hw, cy = L.oy + (u + v) * L.hh;
    let hit = 0, tot = 0;
    for (let dy = -L.hh; dy <= L.hh; dy++)
      for (let dx = -L.hw; dx <= L.hw; dx++) {
        const m = Math.abs(dx) / L.hw + Math.abs(dy) / L.hh;
        if (m < 0.5 || m > 0.95) continue;
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        tot++;
        if (r > 110 && r - g > 45 && g - b > 5 && b < 120) hit++;
      }
    return tot ? hit / tot : 0;
  }

  function sweepCells(d, W, H, L) {
    const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(c => {
      const a = (c[0] - L.ox) / L.hw, b = (c[1] - L.oy) / L.hh;
      return [(a + b) / 2, (b - a) / 2];
    });
    const u0 = Math.floor(Math.min(...corners.map(c => c[0]))) - 1;
    const u1 = Math.ceil(Math.max(...corners.map(c => c[0]))) + 1;
    const v0 = Math.floor(Math.min(...corners.map(c => c[1]))) - 1;
    const v1 = Math.ceil(Math.max(...corners.map(c => c[1]))) + 1;
    const found = [];
    for (let u = u0; u <= u1; u++)
      for (let v = v0; v <= v1; v++) {
        const s = ringScore(d, W, H, L, u, v);
        if (s > 0.02) found.push({ u, v, s });
      }
    if (!found.length) return [];
    found.sort((a, b) => b.s - a.s);
    // seuil adaptatif : on coupe au plus grand ecart relatif dans le haut du classement
    const top = found[0].s;
    let cut = Math.max(0.09, top * 0.33);
    const strong = found.filter(f => f.s >= cut);
    return strong;
  }

  const toCell = (L, x, y) => {
    const a = (x - L.ox) / L.hw, b = (y - L.oy) / L.hh;
    return [Math.round((a + b) / 2), Math.round((b - a) / 2)];
  };
  const toXY = (L, u, v) => [L.ox + (u - v) * L.hw, L.oy + (u + v) * L.hh];

  /* ------------------------------------------------------ couleur du souffle */
  function headDarkness(d, W, H, L, u, v) {
    const [cx, cy] = toXY(L, u, v);
    const y0 = cy - 1.78 * L.hw, y1 = cy - 0.88 * L.hw;
    const x0 = cx - 0.52 * L.hw, x1 = cx + 0.52 * L.hw;
    let dark = 0, n = 0;
    for (let y = Math.round(y0); y <= y1; y++) {
      if (y < 0 || y >= H) continue;
      for (let x = Math.round(x0); x <= x1; x++) {
        if (x < 0 || x >= W) continue;
        const i = (y * W + x) * 4;
        n++;
        if (luminance(d[i], d[i + 1], d[i + 2]) < 64) dark++;
      }
    }
    return n ? dark / n : 0;
  }

  /* ------------------------------------------------------------ personnage */
  // Les cases de deplacement/placement libres sont vert vif ; la case occupee
  // par le personnage porte un liseré blanc au milieu de ces cases vertes.
  // Fractions "vert de deplacement" et "liseré blanc" d'une case.
  function cellStats(d, W, H, L, u, v) {
    const cx = L.ox + (u - v) * L.hw, cy = L.oy + (u + v) * L.hh;
    let wh = 0, gr = 0, n = 0;
    for (let dy = -L.hh; dy <= L.hh; dy++)
      for (let dx = -L.hw; dx <= L.hw; dx++) {
        if (Math.abs(dx) / L.hw + Math.abs(dy) / L.hh > 0.95) continue;
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        n++;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 200 && mx - mn < 40) wh++;
        if (g > 95 && g - r > 40 && g - b > 40) gr++;
      }
    return n ? { wh: wh / n, gr: gr / n } : { wh: 0, gr: 0 };
  }

  /* Le personnage se tient sur une case de la zone verte de placement :
     cette case n'est donc que partiellement verte et porte le liseré blanc
     de selection du personnage.                                            */
  function playerCell(d, W, H, L, occupied) {
    const green = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      const r = d[j], g = d[j + 1], b = d[j + 2];
      if (g > 95 && g - r > 40 && g - b > 40) green[i] = 1;
    }
    const cellPix = new Map();
    for (let i = 0; i < W * H; i++) {
      if (!green[i]) continue;
      const x = i % W, y = (i - x) / W;
      const k = toCell(L, x, y).join(',');
      cellPix.set(k, (cellPix.get(k) || 0) + 1);
    }
    if (!cellPix.size) return null;
    const minPix = Math.max(30, L.hw * L.hh * 0.12);
    const cand = [];
    for (const [k, px] of cellPix) {
      if (px < minPix) continue;
      if (occupied.has(k)) continue;
      const [u, v] = k.split(',').map(Number);
      const st = cellStats(d, W, H, L, u, v);
      cand.push({ u, v, ...st });
    }
    if (!cand.length) return null;
    // case partiellement verte + liseré blanc marque = personnage
    const inner = cand.filter(c => c.gr < 0.72);
    const pool = inner.length ? inner : cand;
    pool.sort((a, b) => b.wh - a.wh);
    if (pool[0].wh < 0.02) {
      // repli : le "trou" entoure par le plus de cases vertes
      const gset = new Set(cand.filter(c => c.gr >= 0.72).map(c => c.u + ',' + c.v));
      const near = new Map();
      for (const k of gset) {
        const [u, v] = k.split(',').map(Number);
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nk = (u + du) + ',' + (v + dv);
          if (gset.has(nk) || occupied.has(nk)) continue;
          near.set(nk, (near.get(nk) || 0) + 1);
        }
      }
      let bk = null, bn = -1;
      for (const [k, n] of near) if (n > bn) { bn = n; bk = k.split(',').map(Number); }
      return bk;
    }
    return [pool[0].u, pool[0].v];
  }

  function whiteRing(d, W, H, L, u, v) {
    const [cx, cy] = toXY(L, u, v);
    let hit = 0, tot = 0;
    for (let dy = -L.hh; dy <= L.hh; dy++) {
      for (let dx = -L.hw; dx <= L.hw; dx++) {
        const m = Math.abs(dx) / L.hw + Math.abs(dy) / L.hh;
        if (m < 0.45 || m > 0.95) continue;
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        tot++;
        if (mx > 190 && mx - mn < 45) hit++;
      }
    }
    return tot ? hit / tot : 0;
  }

  /* -------------------------------------------------- recalage sur l'arene */
  /* Etendue du sol de l'arene : sert de repere absolu pour le recalage.
     On prend la plus grande zone "beige" de la capture et on mesure ses
     extremes selon les deux axes de la grille.                             */
  function arenaAnchor(d, W, H, L) {
    const m = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      const r = d[j], g = d[j + 1], b = d[j + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b, c = r - b;
      if (l > 110 && c > 14 && c < 72) m[i] = 1;
    }
    const lab = new Int32Array(W * H).fill(-1), st = new Int32Array(W * H);
    let bestN = 0, bestId = -1, nc = 0;
    for (let i = 0; i < W * H; i++) {
      if (!m[i] || lab[i] >= 0) continue;
      let sp = 0; st[sp++] = i; lab[i] = nc; let n = 0;
      while (sp) {
        const c = st[--sp], x = c % W, y = (c - x) / W; n++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (m[ni] && lab[ni] < 0) { lab[ni] = nc; st[sp++] = ni; }
        }
      }
      if (n > bestN) { bestN = n; bestId = nc; }
      nc++;
    }
    if (bestId < 0 || bestN < 2000) return null;
    let minS = 1e9, maxS = -1e9, minD = 1e9, maxD = -1e9;
    for (let i = 0; i < W * H; i++) {
      if (lab[i] !== bestId) continue;
      const x = i % W, y = (i - x) / W;
      const a = (x - L.ox) / L.hw, b = (y - L.oy) / L.hh;
      const u = (a + b) / 2, v = (b - a) / 2, sSum = u + v, sDif = u - v;
      if (sSum < minS) minS = sSum; if (sSum > maxS) maxS = sSum;
      if (sDif < minD) minD = sDif; if (sDif > maxD) maxD = sDif;
    }
    return { cs: (minS + maxS) / 2, cd: (minD + maxD) / 2, area: bestN };
  }

  function align(cells, player, solver, anchor) {
    const map = solver.makeMap(null, null);
    const all = cells.map(c => [c.u, c.v]);
    if (player) all.push(player);
    const modelCS = (solver.S_MIN + solver.S_MAX) / 2;
    const modelCD = (solver.D_MIN + solver.D_MAX) / 2;
    const tgtSum = anchor ? modelCS - anchor.cs : null;
    const tgtDif = anchor ? modelCD - anchor.cd : null;

    let best = null;
    for (let du = -28; du <= 28; du++)
      for (let dv = -28; dv <= 28; dv++) {
        let onFloor = 0;
        for (const [u, v] of all) {
          const a = u + du, b = v + dv;
          if (solver.inRect(a, b) && map.free(solver.cid(a, b))) onFloor++;
        }
        if (!onFloor) continue;
        let pen;
        if (tgtSum !== null)
          pen = Math.abs((du + dv) - tgtSum) + Math.abs((du - dv) - tgtDif);
        else {
          const cu0 = all.reduce((s, c) => s + c[0] + du, 0) / all.length;
          const cv0 = all.reduce((s, c) => s + c[1] + dv, 0) / all.length;
          pen = Math.abs(cu0 - 4) + Math.abs(cv0 - 4);
        }
        const sc = onFloor * 100 - pen;
        if (!best || sc > best.sc) best = { du, dv, sc, onFloor, pen };
      }
    return best;
  }

  /* ------------------------------------------------------------------ API */
  function detect(d, W, H, solver) {
    const pts = orangeCenters(d, W, H);
    if (pts.length < 3)
      return { ok: false, reason: "Impossible de repérer les cases oranges des souffles. Prends la capture pendant la phase de placement (ou au début de ton tour), sans interface par-dessus." };

    const L = fitLattice(pts);
    if (!L)
      return { ok: false, reason: "La grille n'a pas pu être calée sur la capture. Essaie une capture non redimensionnée." };

    const cells = [];
    const seen = new Set();
    for (const f of sweepCells(d, W, H, L)) {
      const k = f.u + ',' + f.v;
      if (seen.has(k)) continue;
      seen.add(k);
      const dk = headDarkness(d, W, H, L, f.u, f.v);
      cells.push({ u: f.u, v: f.v, c: dk > 0.25 ? solver.NOIR : solver.BLANC, dark: dk, score: f.s });
    }
    if (!cells.length)
      return { ok: false, reason: "Aucune case de souffle reconnue sur la capture." };
    const player = playerCell(d, W, H, L, seen);

    const anchor = arenaAnchor(d, W, H, L);
    const off = align(cells, player, solver, anchor);
    const du = off ? off.du : 0, dv = off ? off.dv : 0;

    const moved = cells.map(c => ({ u: c.u + du, v: c.v + dv, c: c.c, dark: c.dark, score: c.score }));
    const keep = moved.filter(c => solver.inRect(c.u, c.v));
    const dropped = moved.length - keep.length;
    let pl = player ? [player[0] + du, player[1] + dv] : null;
    if (pl && !solver.inRect(pl[0], pl[1])) pl = null;

    return {
      ok: true,
      lattice: L,
      offset: { du, dv },
      souffles: keep,
      player: pl,
      dropped,
      raw: { cells, player, count: pts.length }
    };
  }

  const API = { detect, arenaAnchor, fitLattice, orangeCenters, ringScore, sweepCells, playerCell, cellStats, toCell, toXY, headDarkness, whiteRing, align, components };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.JardinDetect = API;
})(typeof window !== 'undefined' ? window : globalThis);
