/* Zip — app */
(function () {
  'use strict';
  const E = self.ZipEngine;
  const $ = id => document.getElementById(id);

  const board = $('board'), cellsEl = $('cells'), inkEl = $('ink'), numsEl = $('nums');
  const clockEl = $('clock'), hudEl = $('hud'), toastEl = $('toast');
  const winEl = $('win');

  const SVGNS = 'http://www.w3.org/2000/svg';

  let P = null;            // puzzle
  let path = [];           // cell indices
  let adj = null;          // walled adjacency
  let cpIndex = null;      // cell -> checkpoint index
  let level = 'medium';
  let hints = 0;
  let started = 0, elapsed = 0, tick = null, solved = false;
  let drawing = false;

  /* ---------------- storage ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('zip.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('zip.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------------- helpers ---------------- */
  const fmt = ms => {
    const t = Math.floor(ms / 1000);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  };
  const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  let toastT;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  /* ---------------- build ---------------- */
  function newPuzzle(lvl, seed) {
    level = lvl || level;
    seed = seed == null ? (Math.random() * 0x7fffffff) | 0 : seed;
    let p = null, s = seed;
    for (let i = 0; i < 8 && !p; i++) { p = E.generate(level, s); if (!p) s = (s + 1013904223) | 0; }
    if (!p) { toast('Could not build a puzzle — try again'); return; }
    P = p;
    history.replaceState(null, '', '#' + level + '-' + (P.seed >>> 0));

    adj = E.buildAdj(P.R, P.C, new Set(P.walls));
    cpIndex = new Map();
    P.checkpoints.forEach((c, i) => cpIndex.set(c, i));

    path = []; hints = 0; solved = false; elapsed = 0; started = 0;
    stopClock(); clockEl.textContent = '0:00';
    store.set('level', level);

    drawGrid();
    render();
    hudEl.innerHTML = 'Drag from <b>1</b> to <b>' + P.checkpoints.length + '</b>. Fill every square.';
    document.querySelectorAll('#levels button').forEach(b => b.classList.toggle('on', b.dataset.level === level));
  }

  function drawGrid() {
    const { R, C } = P;
    const tmpl = `repeat(${C},1fr)`, rows = `repeat(${R},1fr)`;
    cellsEl.style.gridTemplateColumns = tmpl; cellsEl.style.gridTemplateRows = rows;
    numsEl.style.gridTemplateColumns = tmpl; numsEl.style.gridTemplateRows = rows;

    cellsEl.innerHTML = '';
    for (let i = 0; i < R * C; i++) {
      const d = document.createElement('div');
      d.className = 'cell' + (((i / C) | 0) === R - 1 ? ' r-last' : '') + ((i % C) === C - 1 ? ' c-last' : '');
      cellsEl.appendChild(d);
    }

    numsEl.innerHTML = '';
    P.checkpoints.forEach((cell, i) => {
      const d = document.createElement('div');
      d.className = 'num';
      d.style.gridArea = `${((cell / C) | 0) + 1} / ${(cell % C) + 1}`;
      d.dataset.cell = cell;
      d.innerHTML = '<i>' + (i + 1) + '</i>';
      numsEl.appendChild(d);
    });

    inkEl.setAttribute('viewBox', `0 0 ${C} ${R}`);
  }

  /* ---------------- render ---------------- */
  function render() {
    const { R, C } = P;
    while (inkEl.firstChild) inkEl.removeChild(inkEl.firstChild);

    if (path.length) {
      const pts = path.map(i => `${(i % C) + 0.5},${((i / C) | 0) + 0.5}`).join(' ');
      const pl = document.createElementNS(SVGNS, 'polyline');
      pl.setAttribute('points', pts);
      pl.setAttribute('fill', 'none');
      pl.setAttribute('stroke', solved ? 'var(--trail-done)' : 'var(--trail)');
      pl.setAttribute('stroke-width', '0.58');
      pl.setAttribute('stroke-linecap', 'round');
      pl.setAttribute('stroke-linejoin', 'round');
      pl.style.transition = 'stroke .35s';
      inkEl.appendChild(pl);

      if (path.length === 1) {
        const dot = document.createElementNS(SVGNS, 'circle');
        dot.setAttribute('cx', (path[0] % C) + 0.5);
        dot.setAttribute('cy', ((path[0] / C) | 0) + 0.5);
        dot.setAttribute('r', '0.29');
        dot.setAttribute('fill', 'var(--trail)');
        inkEl.appendChild(dot);
      }
    }

    P.walls.forEach(w => {
      const [a, b] = w.split(',').map(Number);
      const ar = (a / C) | 0, ac = a % C;
      const ln = document.createElementNS(SVGNS, 'line');
      if (b === a + 1) { ln.setAttribute('x1', ac + 1); ln.setAttribute('y1', ar); ln.setAttribute('x2', ac + 1); ln.setAttribute('y2', ar + 1); }
      else { ln.setAttribute('x1', ac); ln.setAttribute('y1', ar + 1); ln.setAttribute('x2', ac + 1); ln.setAttribute('y2', ar + 1); }
      ln.setAttribute('stroke', 'var(--wall)');
      ln.setAttribute('stroke-width', '0.15');
      ln.setAttribute('stroke-linecap', 'round');
      inkEl.appendChild(ln);
    });

    const inPath = new Set(path);
    numsEl.querySelectorAll('.num').forEach(n => n.classList.toggle('hit', inPath.has(+n.dataset.cell)));
    $('hintCount').textContent = hints ? ' ' + hints : '';
    $('btnUndo').disabled = !path.length;
    $('btnClear').disabled = !path.length;
  }

  /* ---------------- clock ---------------- */
  function startClock() {
    if (tick) return;
    started = Date.now() - elapsed;
    tick = setInterval(() => { elapsed = Date.now() - started; clockEl.textContent = fmt(elapsed); }, 200);
  }
  function stopClock() { clearInterval(tick); tick = null; }

  /* ---------------- movement ---------------- */
  const needNext = () => {
    let n = 0;
    for (const c of path) if (cpIndex.has(c)) n++;
    return n;
  };
  function canStep(a, b) {
    if (path.indexOf(b) !== -1) return false;
    if (adj[a].indexOf(b) === -1) return false;
    const ci = cpIndex.get(b);
    return ci === undefined || ci === needNext();
  }
  function push(c) {
    path.push(c);
    const n = numsEl.querySelector('.num[data-cell="' + c + '"]');
    if (n) { n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); buzz(14); }
    else buzz(6);
  }

  function advance(t) {
    if (!path.length) {
      if (t === P.checkpoints[0]) { push(t); startClock(); return true; }
      return false;
    }
    const last = path[path.length - 1];
    if (t === last) return false;
    if (path.length > 1 && t === path[path.length - 2]) { path.pop(); return true; }
    if (canStep(last, t)) { push(t); return true; }

    // bridge one gap (fast drags / diagonals)
    const C = P.C;
    const lr = (last / C) | 0, lc = last % C, tr = (t / C) | 0, tc = t % C;
    const dr = tr - lr, dc = tc - lc;
    if (Math.abs(dr) + Math.abs(dc) === 2) {
      const mids = (dr === 0 || dc === 0)
        ? [((lr + dr / 2) | 0) * C + ((lc + dc / 2) | 0)]
        : [lr * C + tc, tr * C + lc];
      for (const m of mids) {
        if (canStep(last, m) && canStep(m, t)) { push(m); push(t); return true; }
      }
    }
    return false;
  }

  function checkWin() {
    if (solved || path.length !== P.R * P.C) return;
    solved = true; stopClock();
    render();
    const best = store.get('best.' + level, null);
    const played = store.get('played.' + level, 0) + 1;
    store.set('played.' + level, played);
    if (best === null || elapsed < best) store.set('best.' + level, elapsed);
    showWin(best, played);
    buzz([18, 60, 18]);
  }

  /* ---------------- pointer ---------------- */
  function cellAt(e) {
    const r = board.getBoundingClientRect();
    const c = Math.floor((e.clientX - r.left) / (r.width / P.C));
    const row = Math.floor((e.clientY - r.top) / (r.height / P.R));
    if (c < 0 || row < 0 || c >= P.C || row >= P.R) return -1;
    return row * P.C + c;
  }

  board.addEventListener('pointerdown', e => {
    if (solved) return;
    const i = cellAt(e); if (i < 0) return;
    e.preventDefault();
    board.setPointerCapture(e.pointerId);
    drawing = true;
    const at = path.indexOf(i);
    if (at >= 0) { path.length = at + 1; buzz(6); }
    else if (!advance(i)) {
      if (!path.length) { board.classList.remove('shake'); void board.offsetWidth; board.classList.add('shake'); toast('Start on 1'); }
    }
    render(); checkWin();
  });

  board.addEventListener('pointermove', e => {
    if (!drawing || solved) return;
    e.preventDefault();
    const i = cellAt(e); if (i < 0) return;
    const at = path.indexOf(i);
    if (at >= 0 && at < path.length - 1) { path.length = at + 1; render(); return; }
    if (advance(i)) { render(); checkWin(); }
  });

  const end = () => { drawing = false; };
  board.addEventListener('pointerup', end);
  board.addEventListener('pointercancel', end);

  /* ---------------- hints ---------------- */
  function hint() {
    if (solved) return;
    const sol = P.solution;
    let i = 0;
    while (i < path.length && i < sol.length && path[i] === sol[i]) i++;
    if (i < path.length) { path.length = i; toast('Rewound to the last correct move'); }
    let revealed = -1;
    if (path.length < sol.length) {
      if (!path.length) startClock();
      push(sol[path.length]);
      revealed = path[path.length - 1];
    }
    hints++;
    store.set('hints.total', store.get('hints.total', 0) + 1);
    render();
    if (revealed >= 0) flash(revealed);
    checkWin();
  }
  function flash(cell) {
    const d = document.createElementNS(SVGNS, 'circle');
    d.setAttribute('cx', (cell % P.C) + 0.5);
    d.setAttribute('cy', ((cell / P.C) | 0) + 0.5);
    d.setAttribute('r', '0.1'); d.setAttribute('fill', 'none');
    d.setAttribute('stroke', 'var(--accent)'); d.setAttribute('stroke-width', '0.07');
    inkEl.appendChild(d);
    const an = d.animate([{ r: 0.12, opacity: 1 }, { r: 0.55, opacity: 0 }], { duration: 520, easing: 'ease-out' });
    an.onfinish = () => d.remove();
  }

  /* ---------------- win sheet ---------------- */
  function showWin(prevBest, played) {
    $('winTime').textContent = fmt(elapsed);
    $('winTitle').textContent = (prevBest !== null && elapsed < prevBest) ? 'New best time!' : 'Zipped!';
    $('statBest').textContent = fmt(store.get('best.' + level, elapsed));
    $('statPlayed').textContent = played;
    $('statHints').textContent = hints;
    const burst = $('burst'); burst.innerHTML = '';
    const cols = ['#a8bcf0', '#7fd6a8', '#f0c674', '#ef9a9a', '#b39ddb'];
    for (let i = 0; i < 26; i++) {
      const s = document.createElement('span');
      s.style.left = (Math.random() * 100) + '%';
      s.style.top = '-20px';
      s.style.background = cols[i % cols.length];
      s.style.animationDelay = (Math.random() * .5) + 's';
      burst.appendChild(s);
    }
    setTimeout(() => { winEl.hidden = false; }, 480);
  }

  /* ---------------- wiring ---------------- */
  $('levels').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    winEl.hidden = true; newPuzzle(b.dataset.level);
  });
  $('btnUndo').onclick = () => { if (solved) return; path.pop(); render(); };
  $('btnClear').onclick = () => { if (solved) return; path = []; render(); };
  $('btnHint').onclick = hint;
  $('btnNew').onclick = () => { winEl.hidden = true; newPuzzle(level); };
  $('winNew').onclick = () => { winEl.hidden = true; newPuzzle(level); };
  $('winShare').onclick = async () => {
    const url = location.origin + location.pathname + '#' + level + '-' + (P.seed >>> 0);
    const data = { title: 'Zip', text: 'Beat my time: ' + fmt(elapsed), url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    } catch (e) { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e2) { toast(url); } }
  };
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

  /* ---------------- boot ---------------- */
  const m = /^#(easy|medium|hard)-(\d+)$/.exec(location.hash);
  const name = store.get('who', 'Jordann');
  $('forWho').textContent = 'for ' + name;
  newPuzzle(m ? m[1] : store.get('level', 'medium'), m ? +m[2] : null);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
