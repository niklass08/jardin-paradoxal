/* ============================================================================
   Solveur du combat final de "En ce jardin qui nous unit" (DOFUS)

   Regles modelisees (source : dofuspourlesnoobs.com)
   - 50 PV, 10 PA, 1 PM. -1 PV a chaque debut de tour.
   - Vibration Paradoxale : 1 PA, -1 PV, 10 lancers/tour, uniquement en ligne,
     portee infinie, ligne de vue requise.
       * cible NOIRE (Wukin)  -> poussee de 1 case (s'eloigne du lanceur)
       * cible BLANCHE (Wukang) -> attiree de 1 case (se rapproche)
       * la cible change de couleur, ET tous les souffles en ligne de la
         CASE D'ARRIVEE changent aussi de couleur.
   - Reciprocite : 2 PA, -3 PV, 1 lancer/tour, relance 2 tours, portee 2-5,
     sans ligne de vue. Echange de place avec la cible ; la cible change de
     couleur et tous les souffles en ligne de la case d'arrivee (= l'ancienne
     case du joueur) changent aussi de couleur.
   - Objectif : tous les souffles de la meme couleur.

   Repere : (u,v) = les deux axes "en ligne" de la grille Dofus.
   Ecran  : x = OX + (u-v)*HW ; y = OY + (u+v)*HH  avec HH = HW/2.
   ============================================================================ */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- carte */
  const U_MIN = -4, U_MAX = 12, V_MIN = -4, V_MAX = 13;
  const D_MIN = -14, D_MAX = 13;               // bornes sur (u - v)
  const S_MIN = -8, S_MAX = 22;                // bornes sur (u + v)

  // Trous : infranchissables, mais la ligne de vue passe.
  const DEFAULT_HOLES = ['4,2', '5,2', '6,2', '12,4'];
  // Rochers sureleves : infranchissables ET bloquent la ligne de vue.
  const DEFAULT_ROCKS = ['2,6', '3,6', '9,7', '10,7', '4,11', '4,12'];

  const OFF = 8, SH = 6, MASK = 63;
  const cid = (u, v) => ((u + OFF) << SH) | (v + OFF);
  const cu = id => (id >> SH) - OFF;
  const cv = id => (id & MASK) - OFF;
  const key = (u, v) => u + ',' + v;
  const parse = k => k.split(',').map(Number);

  const NOIR = 0;    // Souffle du Wukin
  const BLANC = 1;   // Souffle du Wukang

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // Orientation ecran des 4 directions "en ligne"
  const DIR_INFO = {
    '1,0':  { label: 'bas-droite',  arrow: '↘' },
    '-1,0': { label: 'haut-gauche', arrow: '↖' },
    '0,1':  { label: 'bas-gauche',  arrow: '↙' },
    '0,-1': { label: 'haut-droite', arrow: '↗' }
  };
  const dirInfo = d => DIR_INFO[d[0] + ',' + d[1]];

  function inRect(u, v) {
    return u >= U_MIN && u <= U_MAX && v >= V_MIN && v <= V_MAX &&
           (u - v) >= D_MIN && (u - v) <= D_MAX &&
           (u + v) >= S_MIN && (u + v) <= S_MAX;
  }

  function makeMap(holes, rocks) {
    const flag = new Uint8Array(1 << (SH + 5));   // 1 = sol, 2 = rocher
    const H = new Set(holes || DEFAULT_HOLES);
    const R = new Set(rocks || DEFAULT_ROCKS);
    const cells = [];
    for (let u = U_MIN; u <= U_MAX; u++)
      for (let v = V_MIN; v <= V_MAX; v++) {
        if (!inRect(u, v)) continue;
        const k = key(u, v), id = cid(u, v);
        cells.push({ u, v, id });
        if (R.has(k)) flag[id] = 2;
        else if (H.has(k)) flag[id] = 0;
        else flag[id] = 1;
      }
    return {
      cells, holes: H, rocks: R, flag,
      free: id => flag[id] === 1,
      known: id => { const u = cu(id), v = cv(id); return inRect(u, v); },
      opaque: id => { const u = cu(id), v = cv(id); return !inRect(u, v) || flag[id] === 2; }
    };
  }

  /* ---------------------------------------------------------------- etat */
  /* pos : Int16Array des cases des souffles ; col : bitmask (1 = BLANC)    */

  function initState(playerUV, souffles, opts) {
    opts = opts || {};
    const n = souffles.length;
    const pos = new Int16Array(n);
    let col = 0;
    souffles.forEach((s, i) => { pos[i] = cid(s[0], s[1]); if (s[2] === BLANC) col |= (1 << i); });
    return {
      p: cid(playerUV[0], playerUV[1]), pos, col, n,
      pa: opts.pa !== undefined ? opts.pa : 10,
      pm: opts.pm !== undefined ? opts.pm : 1,
      vp: 10, reciCd: 0, turn: 1,
      hp: opts.hp !== undefined ? opts.hp : 49
    };
  }

  const clone = st => ({ p: st.p, pos: st.pos.slice(), col: st.col, n: st.n,
                         pa: st.pa, pm: st.pm, vp: st.vp, reciCd: st.reciCd,
                         turn: st.turn, hp: st.hp });

  function counts(st) {
    let b = 0;
    for (let i = 0; i < st.n; i++) if (st.col & (1 << i)) b++;
    return { total: st.n, blanc: b, noir: st.n - b };
  }
  const wrongCount = (st, target) => target === BLANC ? st.n - counts(st).blanc : counts(st).blanc;
  const solved = st => { const c = counts(st); return c.total === 0 || !c.blanc || !c.noir; };

  function hashState(st) {
    let s = String.fromCharCode(st.p, st.col & 0xffff, (st.col >>> 16) & 0xffff);
    for (let i = 0; i < st.n; i++) s += String.fromCharCode(st.pos[i]);
    return s;
  }

  function occupancy(st) {
    const o = new Map();
    for (let i = 0; i < st.n; i++) o.set(st.pos[i], i);
    return o;
  }

  /* ------------------------------------------------------------- ciblage */
  function vpTargets(st, map, occ) {
    occ = occ || occupancy(st);
    const out = [];
    for (let k = 0; k < 4; k++) {
      const d = DIRS[k];
      let u = cu(st.p), v = cv(st.p);
      for (let step = 1; step <= 34; step++) {
        u += d[0]; v += d[1];
        if (!inRect(u, v)) break;
        const id = cid(u, v);
        const i = occ.get(id);
        if (i !== undefined) { out.push({ i, id, u, v, d, dist: step }); break; }
        if (map.opaque(id)) break;
      }
    }
    return out;
  }

  function reciTargets(st) {
    const pu = cu(st.p), pv = cv(st.p), out = [];
    for (let i = 0; i < st.n; i++) {
      const u = cu(st.pos[i]), v = cv(st.pos[i]);
      const dist = Math.abs(u - pu) + Math.abs(v - pv);
      if (dist >= 2 && dist <= 5) out.push({ i, id: st.pos[i], u, v, dist });
    }
    return out;
  }

  /* ------------------------------------------------------------- effets */
  function flipAround(st, nst, au, av, ti) {
    const flipped = [];
    for (let i = 0; i < st.n; i++) {
      if (i === ti) continue;
      const u = cu(st.pos[i]), v = cv(st.pos[i]);
      if (u === au || v === av) { nst.col ^= (1 << i); flipped.push(i); }
    }
    return flipped;
  }

  function applyVP(st, map, t, occ) {
    occ = occ || occupancy(st);
    const nst = clone(st);
    const col = (st.col >> t.i) & 1;                  // 1 = BLANC
    const sign = col === NOIR ? 1 : -1;               // noir pousse, blanc attire
    let du = t.u + t.d[0] * sign, dv = t.v + t.d[1] * sign;
    let moved = true;
    const did = cid(du, dv);
    if (!inRect(du, dv) || !map.free(did) || occ.has(did) || did === st.p) {
      du = t.u; dv = t.v; moved = false;
    }
    nst.pos[t.i] = cid(du, dv);
    nst.col ^= (1 << t.i);
    const flipped = flipAround(st, nst, du, dv, t.i);
    nst.pa -= 1; nst.vp -= 1; nst.hp -= 1;
    return { st: nst, spell: 'VP', target: t.id, from: t.id, arrival: cid(du, dv),
             dir: t.d, moved, pushed: col === NOIR, flipped, color: col };
  }

  function applyReci(st, map, t) {
    const nst = clone(st);
    const col = (st.col >> t.i) & 1;
    const au = cu(st.p), av = cv(st.p);
    nst.pos[t.i] = st.p;
    nst.col ^= (1 << t.i);
    const flipped = flipAround(st, nst, au, av, t.i);
    nst.p = t.id;
    nst.pa -= 2; nst.hp -= 3; nst.reciCd = 2;
    return { st: nst, spell: 'RECI', target: t.id, from: t.id, arrival: cid(au, av),
             flipped, color: col };
  }

  function applyMove(st, d) {
    const nst = clone(st);
    nst.p = cid(cu(st.p) + d[0], cv(st.p) + d[1]);
    nst.pm -= 1;
    return { st: nst, spell: 'MOVE', dir: d, arrival: nst.p };
  }

  function endTurn(st) {
    const nst = clone(st);
    nst.turn += 1; nst.pa = 10; nst.pm = 1; nst.vp = 10;
    nst.reciCd = Math.max(0, nst.reciCd - 1);
    nst.hp -= 1;
    return nst;
  }

  /* ------------------------------------------------------------ coups */
  function spellActions(st, map, occ) {
    const acts = [];
    if (st.pa >= 1 && st.vp >= 1)
      for (const t of vpTargets(st, map, occ)) acts.push({ type: 'VP', target: t });
    if (st.pa >= 2 && st.reciCd === 0)
      for (const t of reciTargets(st)) acts.push({ type: 'RECI', target: t });
    return acts;
  }

  function moveActions(st, map, occ) {
    occ = occ || occupancy(st);
    const acts = [];
    if (st.pm >= 1)
      for (const d of DIRS) {
        const u = cu(st.p) + d[0], v = cv(st.p) + d[1];
        if (!inRect(u, v)) continue;
        const id = cid(u, v);
        if (map.free(id) && !occ.has(id)) acts.push({ type: 'MOVE', d });
      }
    return acts;
  }

  function applyAction(st, map, a, occ) {
    if (a.type === 'VP') return applyVP(st, map, a.target, occ);
    if (a.type === 'RECI') return applyReci(st, map, a.target);
    if (a.type === 'MOVE') return applyMove(st, a.d);
    if (a.type === 'END') return { st: endTurn(st), spell: 'END' };
    throw new Error('action inconnue: ' + a.type);
  }

  /* ------------------------------------------------------- heuristique */
  function maxGain(st) {
    const byU = new Map(), byV = new Map();
    for (let i = 0; i < st.n; i++) {
      const u = cu(st.pos[i]), v = cv(st.pos[i]);
      byU.set(u, (byU.get(u) || 0) + 1);
      byV.set(v, (byV.get(v) || 0) + 1);
    }
    let a = 0, b = 0;
    for (const x of byU.values()) if (x > a) a = x;
    for (const x of byV.values()) if (x > b) b = x;
    return a + b + 1;
  }

  /* ------------------------------------------------------------ recherche */
  function Heap(cmp) { this.a = []; this.cmp = cmp; }
  Heap.prototype.push = function (x) {
    const a = this.a; a.push(x); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1;
      if (this.cmp(a[i], a[p]) < 0) { const t = a[i]; a[i] = a[p]; a[p] = t; i = p; } else break; }
  };
  Heap.prototype.pop = function () {
    const a = this.a; if (!a.length) return null;
    const top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && this.cmp(a[l], a[m]) < 0) m = l;
        if (r < a.length && this.cmp(a[r], a[m]) < 0) m = r;
        if (m === i) break; const t = a[i]; a[i] = a[m]; a[m] = t; i = m; } }
    return top;
  };
  Heap.prototype.size = function () { return this.a.length; };

  const popcount = x => { let c = 0; x >>>= 0; while (x) { x &= x - 1; c++; } return c; };

  /* Recherche en faisceau (beam search) : rapide et tres efficace ici.
     A chaque profondeur on garde les W meilleurs etats (moins de souffles de
     la mauvaise couleur d'abord, puis moins de sorts depenses).            */
  function beamSearch(start, map, targetColor, W, maxDepth, jitter, deadline) {
    const mask = start.n >= 31 ? -1 : (1 << start.n) - 1;
    const wrongOf = st => popcount(targetColor === BLANC ? (~st.col & mask) : (st.col & mask));
    let frontier = [{ st: start, path: [], g: 0 }];
    const seen = new Set([hashState(start) + '#' + start.pa + '#' + start.turn]);

    for (let depth = 0; depth < maxDepth; depth++) {
      const next = [];
      for (const node of frontier) {
        const st = node.st, occ = occupancy(st);
        const spells = spellActions(st, map, occ);
        const kids = [];
        for (const a of spells) {
          const r = applyAction(st, map, a, occ);
          if (r.st.hp > 1) kids.push({ r, c: 1 });
        }
        for (const a of moveActions(st, map, occ)) kids.push({ r: applyAction(st, map, a, occ), c: 0.4 });
        if (st.pa < 1 || !spells.length) {
          const nst = endTurn(st);
          if (nst.hp > 1) kids.push({ r: { st: nst, spell: 'END' }, c: 0.9 });
        }
        for (const k of kids) {
          const nst = k.r.st;
          const h = hashState(nst) + '#' + nst.pa + '#' + nst.turn;
          if (seen.has(h)) continue;
          seen.add(h);
          const step = Object.assign({}, k.r); delete step.st;
          next.push({ st: nst, path: node.path.concat([step]), g: node.g + k.c, w: wrongOf(nst) });
        }
      }
      if (!next.length) return null;
      for (const n of next) if (n.w === 0) return n.path;
      for (const n of next) n.score = n.w * 1000 + n.g * 3 + (jitter ? Math.random() * jitter : 0);
      next.sort((a, b) => a.score - b.score);
      frontier = next.slice(0, W);
      if (deadline && Date.now() > deadline) return null;
    }
    return null;
  }

  const planCost = path => ({
    spells: path.filter(s => s.spell === 'VP' || s.spell === 'RECI').length,
    turns: 1 + path.filter(s => s.spell === 'END').length,
    moves: path.filter(s => s.spell === 'MOVE').length
  });

  /* --------------------------------------------------------------- API */
  function solve(playerUV, souffles, options) {
    const opt = Object.assign({
      holes: null, rocks: null, budgetMs: 2200, beamWidth: 1600, maxDepth: 34,
      forceColor: null
    }, options || {});
    const map = makeMap(opt.holes, opt.rocks);
    const start = initState(playerUV, souffles, opt);

    if (!start.n) return { ok: false, reason: 'Aucun souffle placé sur le plateau.' };
    if (!map.free(start.p)) return { ok: false, reason: "Le personnage n'est pas sur une case praticable." };
    if (solved(start)) {
      const c = counts(start);
      return { ok: true, steps: [], color: c.blanc ? BLANC : NOIR, turns: 1, spells: 0,
               already: true, timeline: buildTimeline(start, [], map) };
    }

    const colors = opt.forceColor === null || opt.forceColor === undefined
      ? [NOIR, BLANC] : [opt.forceColor];
    const deadline = Date.now() + opt.budgetMs;
    let best = null;
    const consider = (path, color) => {
      if (!path) return;
      const c = planCost(path);
      if (!best || c.spells < best.spells || (c.spells === best.spells && c.turns < best.turns) ||
          (c.spells === best.spells && c.turns === best.turns && path.length < best.steps.length)) {
        best = { steps: path, color, spells: c.spells, turns: c.turns, moves: c.moves };
      }
    };

    // 1) passe deterministe
    for (const col of colors) consider(beamSearch(start, map, col, opt.beamWidth, opt.maxDepth, 0, deadline), col);
    // 2) relances aleatoires tant qu'il reste du temps
    const widths = [500, 900, 1800, 3000];
    let i = 0;
    while (Date.now() < deadline - 120) {
      const col = colors[i % colors.length];
      const W = widths[(i / colors.length | 0) % widths.length];
      consider(beamSearch(start, map, col, W, opt.maxDepth, 5000, deadline), col);
      i++;
      if (i > 60) break;
    }
    if (!best) return { ok: false, reason: "Aucune solution trouvée. Vérifie les couleurs, la position du personnage et les obstacles (trous / rochers)." };
    best.ok = true;
    best.timeline = buildTimeline(start, best.steps, map);
    return best;
  }

  /* Rejoue le plan et renvoie, pour chaque etape, l'etat avant/apres. */
  function buildTimeline(start, path, map) {
    const snap = st => ({
      player: [cu(st.p), cv(st.p)],
      souffles: Array.from({ length: st.n }, (_, i) =>
        ({ u: cu(st.pos[i]), v: cv(st.pos[i]), c: (st.col >> i) & 1 })),
      pa: st.pa, pm: st.pm, hp: st.hp, turn: st.turn
    });
    const out = [{ before: snap(start), step: null }];
    let st = start;
    for (const s of path) {
      const before = snap(st);
      let nst;
      if (s.spell === 'END') nst = endTurn(st);
      else if (s.spell === 'MOVE') nst = applyMove(st, s.dir).st;
      else if (s.spell === 'VP') {
        const occ = occupancy(st);
        const i = occ.get(s.from);
        nst = applyVP(st, map, { i, id: s.from, u: cu(s.from), v: cv(s.from), d: s.dir }, occ).st;
      } else {
        const occ = occupancy(st);
        const i = occ.get(s.from);
        nst = applyReci(st, map, { i, id: s.from, u: cu(s.from), v: cv(s.from) }).st;
      }
      out.push({ before, after: snap(nst), step: s });
      st = nst;
    }
    out[0].after = out.length > 1 ? out[1].before : snap(st);
    return { frames: out, final: snap(st) };
  }

  const API = {
    NOIR, BLANC, DIRS, DIR_INFO, dirInfo,
    U_MIN, U_MAX, V_MIN, V_MAX, D_MIN, D_MAX, S_MIN, S_MAX,
    DEFAULT_HOLES, DEFAULT_ROCKS,
    cid, cu, cv, key, parse, inRect, makeMap,
    initState, clone, counts, solved, hashState, occupancy,
    vpTargets, reciTargets, spellActions, moveActions, applyAction, endTurn, beamSearch,
    wrongCount, solve, buildTimeline
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.JardinSolver = API;
})(typeof window !== 'undefined' ? window : globalThis);
