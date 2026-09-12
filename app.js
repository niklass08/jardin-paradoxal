/* ============================================================================
   Jardin Paradoxal — interface du solveur
   ========================================================================== */
(function () {
  'use strict';
  const S = window.JardinSolver, D = window.JardinDetect;
  const $ = s => document.querySelector(s);
  const NOIR = S.NOIR, BLANC = S.BLANC;

  /* ------------------------------------------------------------------ etat */
  const st = {
    souffles: new Map(),          // "u,v" -> 0 | 1
    player: null,                 // [u,v]
    holes: new Set(S.DEFAULT_HOLES),
    rocks: new Set(S.DEFAULT_ROCKS),
    img: null, lattice: null, offset: { du: 0, dv: 0 },
    bg: 'schema',
    tool: 'noir',
    plan: null, frame: 0
  };

  /* Position d'exemple : la capture fournie par le joueur. */
  const DEMO = {
    player: [5, 5],
    souffles: [[0,0,1],[-1,-1,0],[5,-2,1],[6,-3,0],[5,0,0],[3,3,1],[2,4,0],[9,2,1],
               [6,5,1],[2,11,1],[6,10,0],[12,6,0],[-1,9,1],[-1,5,0],[-2,4,1],[8,1,1],
               [0,9,0],[12,1,1]]
  };
  function loadDemo() {
    st.souffles.clear();
    DEMO.souffles.forEach(s => st.souffles.set(s[0] + ',' + s[1], s[2]));
    st.player = DEMO.player.slice();
  }

  /* ----------------------------------------------------------------- canvas */
  const cv = $('#board'), ctx = cv.getContext('2d');
  const CW = 1160, CH = 600, HW = 31, HH = 15.5;

  function sizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = CW * dpr; cv.height = CH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function view() {
    if (st.bg === 'capture' && st.img && st.lattice) {
      const L = st.lattice;
      const s = Math.min(CW / st.img.width, CH / st.img.height);
      const offX = (CW - st.img.width * s) / 2, offY = (CH - st.img.height * s) / 2;
      return {
        kind: 'capture', s, offX, offY, hw: L.hw * s, hh: L.hh * s,
        xy(u, v) {
          const a = u - st.offset.du, b = v - st.offset.dv;
          return [offX + (L.ox + (a - b) * L.hw) * s, offY + (L.oy + (a + b) * L.hh) * s];
        },
        cell(x, y) {
          const px = (x - offX) / s, py = (y - offY) / s;
          const a = (px - L.ox) / L.hw, b = (py - L.oy) / L.hh;
          return [Math.round((a + b) / 2) + st.offset.du, Math.round((b - a) / 2) + st.offset.dv];
        }
      };
    }
    const ox = 42 + 17 * HW, oy = 46 + 8 * HH;
    return {
      kind: 'schema', hw: HW, hh: HH,
      xy: (u, v) => [ox + (u - v) * HW, oy + (u + v) * HH],
      cell(x, y) {
        const a = (x - ox) / HW, b = (y - oy) / HH;
        return [Math.round((a + b) / 2), Math.round((b - a) / 2)];
      }
    };
  }

  let palCache = null, palKey = '';
  function pal() {
    const k = (document.documentElement.getAttribute('data-theme') || '') +
              (matchMedia('(prefers-color-scheme: dark)').matches ? 'D' : 'L');
    if (palCache && palKey === k) return palCache;
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    palKey = k;
    palCache = { bg3: g('--bg3'), floor: g('--floor'), floor2: g('--floor2'), hole: g('--hole'),
                 rock: g('--rock'), accent: g('--accent'), jade: g('--jade'),
                 wukin: g('--wukin'), wukinRing: g('--wukin-ring'),
                 wukang: g('--wukang'), wukangRing: g('--wukang-ring') };
    return palCache;
  }

  function diamond(V, u, v, k) {
    const [x, y] = V.xy(u, v), hw = V.hw * (k || 1), hh = V.hh * (k || 1);
    ctx.beginPath();
    ctx.moveTo(x - hw, y); ctx.lineTo(x, y - hh); ctx.lineTo(x + hw, y); ctx.lineTo(x, y + hh);
    ctx.closePath();
  }

  function drawBoard() {
    const V = view();
    ctx.clearRect(0, 0, CW, CH);
    const P = pal();
    ctx.fillStyle = P.bg3; ctx.fillRect(0, 0, CW, CH);

    if (V.kind === 'capture') {
      ctx.drawImage(st.img, V.offX, V.offY, st.img.width * V.s, st.img.height * V.s);
      ctx.fillStyle = 'rgba(10,14,17,.42)';
      ctx.fillRect(0, 0, CW, CH);
    }

    const map = S.makeMap([...st.holes], [...st.rocks]);
    const fr = st.plan ? uiFrames()[st.frame] : null;
    const snap = fr ? fr.before : null;
    const step = fr && fr.step && fr.step.spell !== 'DONE' ? fr.step : null;

    /* --- cases --- */
    for (const c of map.cells) {
      const isHole = st.holes.has(c.u + ',' + c.v), isRock = st.rocks.has(c.u + ',' + c.v);
      if (V.kind === 'schema') {
        diamond(V, c.u, c.v, 0.94);
        ctx.fillStyle = isHole ? P.hole : isRock ? P.rock
                      : ((c.u + c.v) & 1 ? P.floor : P.floor2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.stroke();
      } else if (isHole || isRock) {
        diamond(V, c.u, c.v, 0.9);
        ctx.strokeStyle = isRock ? P.rock : P.accent;
        ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    /* --- lignes de propagation de la case d'arrivee --- */
    if (step && (step.spell === 'VP' || step.spell === 'RECI')) {
      const au = S.cu(step.arrival), av = S.cv(step.arrival);
      ctx.save();
      ctx.strokeStyle = P.accent; ctx.globalAlpha = .55; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
      for (const [du, dv] of [[1, 0], [0, 1]]) {
        let a = au, b = av;
        while (S.inRect(a - du, b - dv)) { a -= du; b -= dv; }
        let e = au, f = av;
        while (S.inRect(e + du, f + dv)) { e += du; f += dv; }
        const p1 = V.xy(a, b), p2 = V.xy(e, f);
        ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      }
      ctx.restore();
      /* case d'arrivee */
      diamond(V, au, av, 0.9);
      ctx.strokeStyle = P.accent; ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    }

    /* --- souffles --- */
    const flippedSet = new Set();
    if (step && step.flipped && snap)
      step.flipped.forEach(i => flippedSet.add(snap.souffles[i].u + ',' + snap.souffles[i].v));

    const list = snap ? snap.souffles.map(s => [s.u, s.v, s.c])
                      : [...st.souffles].map(([k, c]) => [ ...k.split(',').map(Number), c ]);

    for (const [u, v, c] of list) {
      const [x, y] = V.xy(u, v);
      const r = Math.max(6, V.hh * 0.8);
      const k = u + ',' + v;
      if (flippedSet.has(k)) {
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 6.284);
        ctx.strokeStyle = P.accent; ctx.globalAlpha = .85; ctx.lineWidth = 2; ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.ellipse(x, y + 2, r * .95, r * .45, 0, 0, 6.284);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - r * .25, r, 0, 6.284);
      ctx.fillStyle = c === BLANC ? P.wukang : P.wukin;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = c === BLANC ? P.wukangRing : P.wukinRing;
      ctx.stroke();
    }

    /* --- cible --- */
    if (step && (step.spell === 'VP' || step.spell === 'RECI')) {
      const tu = S.cu(step.from), tv = S.cv(step.from);
      const [x, y] = V.xy(tu, tv), r = Math.max(6, V.hh * 0.8);
      ctx.beginPath(); ctx.arc(x, y - r * .25, r + 9, 0, 6.284);
      ctx.strokeStyle = P.accent; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - r * .25, r + 14, 0, 6.284);
      ctx.globalAlpha = .35; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    }

    /* --- personnage --- */
    const pl = snap ? snap.player : st.player;
    if (pl) {
      const [x, y] = V.xy(pl[0], pl[1]);
      diamond(V, pl[0], pl[1], 0.86);
      ctx.strokeStyle = P.accent; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - V.hh * .95); ctx.lineTo(x + V.hw * .34, y);
      ctx.lineTo(x, y + V.hh * .95); ctx.lineTo(x - V.hw * .34, y); ctx.closePath();
      ctx.fillStyle = P.accent; ctx.fill();
    }

    /* --- fleche du sort --- */
    if (step && pl) {
      if (step.spell === 'VP') arrow(V, pl, [S.cu(step.from), S.cv(step.from)]);
      else if (step.spell === 'RECI') arrow(V, pl, [S.cu(step.from), S.cv(step.from)], true);
      else if (step.spell === 'MOVE') arrow(V, pl, [pl[0] + step.dir[0], pl[1] + step.dir[1]]);
    }
  }

  function arrow(V, from, to, dashed) {
    const P = pal();
    const a = V.xy(from[0], from[1]), b = V.xy(to[0], to[1]);
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const x1 = a[0] + ux * 20, y1 = a[1] + uy * 20 - 6;
    const x2 = b[0] - ux * 24, y2 = b[1] - uy * 24 - 6;
    ctx.save();
    ctx.strokeStyle = P.accent; ctx.lineWidth = 2.5;
    if (dashed) ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2 + ux * 9, y2 + uy * 9);
    ctx.lineTo(x2 - uy * 6, y2 + ux * 6);
    ctx.lineTo(x2 + uy * 6, y2 - ux * 6);
    ctx.closePath(); ctx.fillStyle = P.accent; ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------------------- compteurs */
  function refreshCounts() {
    let n = 0, b = 0;
    for (const c of st.souffles.values()) { if (c === BLANC) b++; else n++; }
    $('#cntN').textContent = n; $('#cntB').textContent = b;
    $('#chipPlayer').innerHTML = 'Personnage <b>' +
      (st.player ? '(' + st.player[0] + ',' + st.player[1] + ')' : '—') + '</b>';
  }

  function redraw() { palCache = null; drawBoard(); refreshCounts(); }

  /* ----------------------------------------------------------- interaction */
  cv.addEventListener('click', e => {
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * CW / r.width, y = (e.clientY - r.top) * CH / r.height;
    const [u, v] = view().cell(x, y);
    if (!S.inRect(u, v)) return;
    const k = u + ',' + v;
    st.plan = null; $('#planZone').hidden = true; $('#solveMsg').innerHTML = '';
    switch (st.tool) {
      case 'noir': case 'blanc':
        if (st.player && st.player[0] === u && st.player[1] === v) st.player = null;
        st.holes.delete(k); st.rocks.delete(k);
        st.souffles.set(k, st.tool === 'noir' ? NOIR : BLANC); break;
      case 'player':
        st.souffles.delete(k); st.holes.delete(k); st.rocks.delete(k);
        st.player = [u, v]; break;
      case 'erase':
        st.souffles.delete(k); st.holes.delete(k); st.rocks.delete(k);
        if (st.player && st.player[0] === u && st.player[1] === v) st.player = null; break;
      case 'hole':
        st.souffles.delete(k); st.rocks.delete(k);
        if (st.holes.has(k)) st.holes.delete(k); else st.holes.add(k);
        if (st.player && st.player[0] === u && st.player[1] === v) st.player = null; break;
      case 'rock':
        st.souffles.delete(k); st.holes.delete(k);
        if (st.rocks.has(k)) st.rocks.delete(k); else st.rocks.add(k);
        if (st.player && st.player[0] === u && st.player[1] === v) st.player = null; break;
    }
    redraw();
  });

  document.querySelectorAll('#tools .tool').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#tools .tool').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); st.tool = b.dataset.tool;
  }));

  $('#clearBoard').addEventListener('click', () => {
    st.souffles.clear(); st.player = null; st.plan = null;
    $('#planZone').hidden = true; $('#solveMsg').innerHTML = '';
    redraw();
  });

  $('#bgToggle').addEventListener('click', () => {
    st.bg = st.bg === 'schema' ? 'capture' : 'schema';
    $('#bgToggle').textContent = 'Fond : ' + (st.bg === 'schema' ? 'schéma' : 'capture');
    redraw();
  });

  document.querySelectorAll('[data-nudge]').forEach(b => b.addEventListener('click', () => {
    const [du, dv] = b.dataset.nudge.split(',').map(Number);
    st.offset.du += du; st.offset.dv += dv;
    const moved = new Map();
    for (const [k, c] of st.souffles) {
      const [u, v] = k.split(',').map(Number);
      moved.set((u + du) + ',' + (v + dv), c);
    }
    st.souffles = moved;
    if (st.player) st.player = [st.player[0] + du, st.player[1] + dv];
    st.plan = null; $('#planZone').hidden = true;
    redraw();
  }));

  $('#theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    redraw();
  });

  /* ---------------------------------------------------------------- import */
  const drop = $('#drop'), fileIn = $('#file');
  drop.addEventListener('click', () => fileIn.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  fileIn.addEventListener('change', () => { if (fileIn.files[0]) handleFile(fileIn.files[0]); });
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  window.addEventListener('paste', e => {
    for (const it of (e.clipboardData || {}).items || [])
      if (it.type.startsWith('image/')) { handleFile(it.getAsFile()); break; }
  });

  function say(el, cls, html) { el.innerHTML = '<div class="msg ' + cls + '">' + html + '</div>'; }

  function handleFile(file) {
    const msg = $('#detectMsg');
    say(msg, 'ok', 'Analyse de la capture…');
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => runDetect(img);
      img.onerror = () => say(msg, 'err', "Impossible de lire cette image.");
      img.src = fr.result;                       // data: URL — lisible par le canvas
    };
    fr.onerror = () => say(msg, 'err', "Lecture du fichier impossible.");
    fr.readAsDataURL(file);
  }

  function runDetect(img) {
    const msg = $('#detectMsg');
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    let px;
    try { px = x.getImageData(0, 0, c.width, c.height); }
    catch (err) { say(msg, 'err', "Cette image ne peut pas être analysée par le navigateur."); return; }

    const r = D.detect(px.data, c.width, c.height, S);
    if (!r.ok) { say(msg, 'err', r.reason); return; }

    st.img = img; st.lattice = r.lattice; st.offset = { du: r.offset.du, dv: r.offset.dv };
    st.souffles.clear();
    r.souffles.forEach(s => st.souffles.set(s.u + ',' + s.v, s.c));
    st.player = r.player;
    st.plan = null; $('#planZone').hidden = true; $('#solveMsg').innerHTML = '';
    st.bg = 'capture';
    $('#bgToggle').disabled = false;
    $('#bgToggle').textContent = 'Fond : capture';
    $('#nudgeRow').hidden = false;

    const n = r.souffles.filter(s => s.c === NOIR).length;
    const b = r.souffles.length - n;
    let txt = '<b>' + r.souffles.length + ' souffles</b> détectés — ' + n + ' Wukin, ' + b + ' Wukang.';
    txt += st.player ? ' Personnage en <b>(' + st.player[0] + ',' + st.player[1] + ')</b>.'
                     : ' <b>Personnage non trouvé</b> : choisis l’outil « Personnage » et clique sa case.';
    if (r.dropped) txt += ' ' + r.dropped + ' repère(s) hors terrain ignoré(s).';
    txt += '<br><span style="color:var(--muted)">Vérifie le plateau, corrige au clic si besoin.</span>';
    say(msg, st.player ? 'ok' : 'warn', txt);
    redraw();
  }

  /* -------------------------------------------------------------- resoudre */
  $('#optColor').addEventListener('change', e => { $('#colorSel').disabled = !e.target.checked; });

  $('#solve').addEventListener('click', () => {
    const msg = $('#solveMsg');
    if (!st.player) { say(msg, 'err', "Place d’abord ton personnage (outil « Personnage »)."); return; }
    if (!st.souffles.size) { say(msg, 'err', "Aucun souffle sur le plateau."); return; }
    const btn = $('#solve');
    btn.disabled = true; btn.textContent = 'Calcul en cours…';
    say(msg, 'ok', 'Exploration des combinaisons…');
    requestAnimationFrame(() => setTimeout(() => {
      const souffles = [...st.souffles].map(([k, c]) => [...k.split(',').map(Number), c]);
      const forced = $('#optColor').checked ? Number($('#colorSel').value) : null;
      let res;
      try {
        res = S.solve(st.player, souffles, {
          holes: [...st.holes], rocks: [...st.rocks], budgetMs: 2600, forceColor: forced
        });
      } catch (err) { res = { ok: false, reason: 'Erreur interne : ' + err.message }; }
      btn.disabled = false; btn.textContent = 'Calculer la solution';
      if (!res.ok) { say(msg, 'err', res.reason); return; }
      msg.innerHTML = '';
      st.plan = res; st.frame = 0;
      showPlan();
    }, 30));
  });

  /* ------------------------------------------------------------------ plan */
  const SPELL_NAME = { VP: 'Vibration Paradoxale', RECI: 'Réciprocité', MOVE: 'Déplacement', END: 'Fin de tour' };
  const colName = c => c === BLANC ? 'Wukang (blanc)' : 'Wukin (noir)';

  function relDesc(du, dv) {
    const parts = [];
    if (du) parts.push(Math.abs(du) + ' × ' + S.dirInfo(du > 0 ? [1, 0] : [-1, 0]).arrow);
    if (dv) parts.push(Math.abs(dv) + ' × ' + S.dirInfo(dv > 0 ? [0, 1] : [0, -1]).arrow);
    return parts.join(' puis ');
  }

  function describe(step, before) {
    if (step.spell === 'END') return { title: 'Fin de tour', body: 'Passe ton tour. Tu perdras 1 PV au début du suivant.', sub: '' };
    if (step.spell === 'MOVE') {
      const i = S.dirInfo(step.dir);
      return { title: 'Déplacement (1 PM)', body: 'Avance d’<b>1 case</b> vers ' + i.arrow + ' <b>' + i.label + '</b>.', sub: '' };
    }
    const tu = S.cu(step.from), tv = S.cv(step.from);
    const au = S.cu(step.arrival), av = S.cv(step.arrival);
    const nb = step.flipped.length + 1;
    const become = colName(1 - step.color).replace(' (', ' — ').replace(')', '');
    if (step.spell === 'VP') {
      const i = S.dirInfo(step.dir);
      const dist = Math.abs(tu - before.player[0]) + Math.abs(tv - before.player[1]);
      const act = step.color === NOIR ? 'poussé' : 'attiré';
      return {
        title: 'Vibration Paradoxale — 1 PA',
        body: 'Cible le souffle <b>' + colName(step.color) + '</b> aligné vers ' + i.arrow +
              ' <b>' + i.label + '</b>, à <b>' + dist + ' case' + (dist > 1 ? 's' : '') + '</b> ' +
              '<span style="color:var(--muted)">(c’est le premier souffle dans cette direction)</span>.',
        sub: (step.moved ? 'Il est <b>' + act + '</b> jusqu’en (' + au + ',' + av + ')'
                         : 'Bloqué : il <b>reste sur sa case</b> (' + au + ',' + av + ')') +
             ' · <b>' + nb + ' souffle' + (nb > 1 ? 's' : '') + '</b> change' + (nb > 1 ? 'nt' : '') +
             ' de couleur : la cible' + (step.flipped.length
               ? ' et ' + step.flipped.length + ' autre' + (step.flipped.length > 1 ? 's' : '') +
                 ', sur les deux lignes pointillées de la case d’arrivée.' : ' seule.')
      };
    }
    const du = tu - before.player[0], dv = tv - before.player[1];
    return {
      title: 'Réciprocité — 2 PA',
      body: 'Cible le souffle <b>' + colName(step.color) + '</b> en <b>(' + tu + ',' + tv + ')</b> — ' +
            relDesc(du, dv) + ' depuis ta case. Vous échangez de place.',
      sub: 'Case d’arrivée = <b>ta case actuelle (' + au + ',' + av + ')</b> · <b>' + nb +
           ' souffle' + (nb > 1 ? 's' : '') + '</b> change' + (nb > 1 ? 'nt' : '') + ' de couleur : la cible' +
           (step.flipped.length ? ' et ' + step.flipped.length + ' sur les lignes pointillées.' : ' seule.')
    };
  }

  function showPlan() {
    const p = st.plan;
    $('#planZone').hidden = false;
    $('#planTitle').textContent = p.already ? 'Déjà gagné' :
      'Tout passer en ' + (p.color === BLANC ? 'Wukang (blanc)' : 'Wukin (noir)');
    const hp = p.steps.filter(s => s.spell === 'VP').length + 3 * p.steps.filter(s => s.spell === 'RECI').length + (p.turns - 1);
    $('#planSummary').innerHTML =
      '<span class="big">' + p.spells + ' sort' + (p.spells > 1 ? 's' : '') + '</span>' +
      '<span class="stat"><b>' + p.turns + '</b> tour' + (p.turns > 1 ? 's' : '') + '</span>' +
      '<span class="stat">coût <b>' + hp + ' PV</b> sur 50</span>' +
      '<span class="stat">' + (p.moves || 0) + ' déplacement' + ((p.moves || 0) > 1 ? 's' : '') + '</span>';

    const list = $('#stepList'); list.innerHTML = '';
    let turn = 1, idx = 0;
    addTurn(list, 1);
    p.steps.forEach((s, i) => {
      if (s.spell === 'END') { turn++; addTurn(list, turn); return; }
      idx++;
      const li = document.createElement('li');
      li.dataset.frame = i + 1;
      li.innerHTML = '<span class="i">' + (s.spell === 'MOVE' ? '·' : idx) + '</span><span>' +
        (s.spell === 'MOVE'
          ? 'Déplacement ' + S.dirInfo(s.dir).arrow
          : (s.spell === 'VP' ? 'Vibration ' + S.dirInfo(s.dir).arrow : 'Réciprocité') +
            ' <span style="color:var(--muted)">→ (' + S.cu(s.arrival) + ',' + S.cv(s.arrival) + ') · ' +
            (s.flipped.length + 1) + ' retourné' + (s.flipped.length ? 's' : '') + '</span>') +
        '</span>';
      li.addEventListener('click', () => { st.frame = i + 1; renderStep(); });
      list.appendChild(li);
    });
    st.frame = p.steps.length ? 1 : 0;
    renderStep();
    const pz = $('#planZone');
    if (pz.scrollIntoView) pz.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function addTurn(list, n) {
    const li = document.createElement('li');
    li.className = 'turn'; li.textContent = 'Tour ' + n;
    list.appendChild(li);
  }

  function uiFrames() {
    const p = st.plan;
    return p.timeline.frames.concat([{ before: p.timeline.final, step: { spell: 'DONE' } }]);
  }

  function renderStep() {
    const p = st.plan; if (!p) return;
    const frames = uiFrames();
    st.frame = Math.max(0, Math.min(frames.length - 1, st.frame));
    const fr = frames[st.frame];
    const card = $('#stepCard');

    if (!fr.step) {
      card.innerHTML = '<div class="k"><span class="num">Départ</span><span class="spell">Position initiale</span></div>' +
        '<p>Voici ta position de départ. Clique <b>Suivant</b> pour dérouler le plan, sort par sort.</p>';
    } else if (fr.step.spell === 'DONE') {
      const c = p.color === BLANC ? 'Wukang (blancs)' : 'Wukin (noirs)';
      const n = fr.before.souffles.length;
      card.innerHTML = '<div class="k"><span class="num">Terminé</span><span class="spell">Les ' + n + ' souffles sont unis</span></div>' +
        '<p>Tous les souffles sont <b>' + c + '</b>. Termine ton tour : le combat se conclut au tour du Reflet.</p>' +
        '<p class="sub">PV restants : <b>' + fr.before.hp + '</b>/50</p>';
    } else {
      const d = describe(fr.step, fr.before);
      const spellIdx = frames.slice(1, st.frame + 1).filter(f => f.step.spell === 'VP' || f.step.spell === 'RECI').length;
      const total = p.spells;
      card.innerHTML =
        '<div class="k"><span class="num">Tour ' + fr.before.turn +
          (fr.step.spell === 'VP' || fr.step.spell === 'RECI' ? ' · sort ' + spellIdx + '/' + total : '') +
          '</span><span class="spell">' + d.title + '</span></div>' +
        '<p>' + d.body + '</p>' + (d.sub ? '<p class="sub">' + d.sub + '</p>' : '') +
        '<p class="sub">PA restants après ce sort : <b>' + (fr.after ? fr.after.pa : fr.before.pa) + '</b>/10' +
        ' · PV : <b>' + (fr.after ? fr.after.hp : fr.before.hp) + '</b></p>';
    }

    document.querySelectorAll('#stepList li').forEach(li => {
      li.classList.toggle('cur', Number(li.dataset.frame) === st.frame);
    });
    const cur = document.querySelector('#stepList li.cur');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    $('#prev').disabled = st.frame <= 0;
    $('#next').disabled = st.frame >= frames.length - 1;
    redraw();
  }

  $('#prev').addEventListener('click', () => { st.frame--; renderStep(); });
  $('#next').addEventListener('click', () => { st.frame++; renderStep(); });
  window.addEventListener('keydown', e => {
    if (!st.plan) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight') { st.frame++; renderStep(); }
    if (e.key === 'ArrowLeft') { st.frame--; renderStep(); }
  });

  $('#copyPlan').addEventListener('click', () => {
    const p = st.plan; if (!p) return;
    const frames = p.timeline.frames;
    let out = 'Jardin Paradoxal — tout passer en ' +
      (p.color === BLANC ? 'WUKANG (blanc)' : 'WUKIN (noir)') +
      ' · ' + p.spells + ' sorts, ' + p.turns + ' tour(s)\n';
    let turn = 1, idx = 0;
    out += '\n-- Tour 1 --\n';
    p.steps.forEach((s, i) => {
      if (s.spell === 'END') { turn++; out += '\n-- Tour ' + turn + ' --\n'; return; }
      const d = describe(s, frames[i].before);
      idx += (s.spell === 'MOVE' ? 0 : 1);
      out += (s.spell === 'MOVE' ? '   ' : String(idx).padStart(2, ' ') + '.') + ' ' +
        d.title + ' — ' + (d.body + ' ' + d.sub).replace(/<[^>]+>/g, '') + '\n';
    });
    const done = ok => {
      $('#copyPlan').textContent = ok ? 'Copié ✓' : 'Copie impossible';
      setTimeout(() => $('#copyPlan').textContent = 'Copier le plan', 1800);
    };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = out; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta); done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(out).then(() => done(true), fallback);
    else fallback();
  });

  /* ------------------------------------------------------------------ boot */
  sizeCanvas();
  loadDemo();
  redraw();
  window.addEventListener('resize', () => { sizeCanvas(); redraw(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
})();
