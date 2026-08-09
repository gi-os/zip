/* Zip engine — puzzle generation + uniqueness solving. No DOM. */
(function (root) {
  'use strict';

  // ---------- RNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------- grid helpers ----------
  const ek = (a, b) => (a < b ? a + ',' + b : b + ',' + a);

  function rawNeighbors(R, C) {
    const N = R * C, out = new Array(N);
    for (let i = 0; i < N; i++) {
      const r = (i / C) | 0, c = i % C, a = [];
      if (r > 0) a.push(i - C);
      if (r < R - 1) a.push(i + C);
      if (c > 0) a.push(i - 1);
      if (c < C - 1) a.push(i + 1);
      out[i] = a;
    }
    return out;
  }

  function buildAdj(R, C, walls) {
    const base = rawNeighbors(R, C);
    if (!walls || !walls.size) return base;
    return base.map((list, i) => list.filter(j => !walls.has(ek(i, j))));
  }

  function allEdges(R, C) {
    const out = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const i = r * C + c;
      if (c < C - 1) out.push(ek(i, i + 1));
      if (r < R - 1) out.push(ek(i, i + C));
    }
    return out;
  }

  // ---------- random hamiltonian path (backbite) ----------
  function snake(R, C) {
    const p = [];
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) p.push(r * C + (r % 2 === 0 ? c : C - 1 - c));
    return p;
  }

  function backbite(path, R, C, iters, rng) {
    const N = R * C;
    const nb = rawNeighbors(R, C);
    const pos = new Int32Array(N);
    for (let i = 0; i < N; i++) pos[path[i]] = i;
    const rev = (i, j) => {
      while (i < j) { const t = path[i]; path[i] = path[j]; path[j] = t; pos[path[i]] = i; pos[path[j]] = j; i++; j--; }
    };
    for (let it = 0; it < iters; it++) {
      const tail = rng() < 0.5;
      const end = tail ? path[N - 1] : path[0];
      const list = nb[end];
      const n = list[(rng() * list.length) | 0];
      const i = pos[n];
      if (tail) { if (i >= N - 2) continue; rev(i + 1, N - 1); }
      else { if (i <= 1) continue; rev(0, i - 1); }
    }
    return path;
  }

  // ---------- solver: count solutions up to `limit` ----------
  function countSolutions(R, C, walls, checkpoints, limit, nodeCap) {
    limit = limit || 2;
    nodeCap = nodeCap || 400000;
    const N = R * C;
    const adj = buildAdj(R, C, walls);
    const cpIdx = new Int32Array(N).fill(-1);
    checkpoints.forEach((cell, i) => { cpIdx[cell] = i; });
    const last = checkpoints[checkpoints.length - 1];
    const K = checkpoints.length;

    const visited = new Uint8Array(N);
    const mark = new Int32Array(N).fill(-1);
    const stack = new Int32Array(N);
    let gen = 0, nodes = 0, count = 0, aborted = false;

    // prune: all unvisited cells reachable from cur, and no bad dead-ends
    function prune(cur, depth) {
      const rem = N - depth;
      if (rem === 0) return false;
      gen++;
      let sp = 0, cnt = 0;
      const cn = adj[cur];
      for (let i = 0; i < cn.length; i++) {
        const v = cn[i];
        if (!visited[v] && mark[v] !== gen) { mark[v] = gen; stack[sp++] = v; }
      }
      if (sp === 0) return true;
      const seen = [];
      while (sp) {
        const u = stack[--sp]; cnt++; seen.push(u);
        const un = adj[u];
        for (let i = 0; i < un.length; i++) {
          const v = un[i];
          if (!visited[v] && mark[v] !== gen) { mark[v] = gen; stack[sp++] = v; }
        }
      }
      if (cnt !== rem) return true;
      let deg1 = 0;
      for (let s = 0; s < seen.length; s++) {
        const u = seen[s];
        let d = 0;
        const un = adj[u];
        for (let i = 0; i < un.length; i++) if (!visited[un[i]]) d++;
        for (let i = 0; i < cn.length; i++) if (cn[i] === u) { d++; break; }
        if (d === 0) return true;
        if (d === 1) { if (u !== last) return true; if (++deg1 > 1) return true; }
      }
      return false;
    }

    function dfs(cur, need, depth) {
      if (++nodes > nodeCap) { aborted = true; return true; }
      if (depth === N) {
        if (cur === last && need === K) count++;
        return count >= limit;
      }
      if (prune(cur, depth)) return false;
      const cn = adj[cur];
      for (let i = 0; i < cn.length; i++) {
        const nx = cn[i];
        if (visited[nx]) continue;
        const ci = cpIdx[nx];
        if (ci >= 0 && ci !== need) continue;
        visited[nx] = 1;
        const stop = dfs(nx, ci >= 0 ? need + 1 : need, depth + 1);
        visited[nx] = 0;
        if (stop) return true;
      }
      return false;
    }

    visited[checkpoints[0]] = 1;
    dfs(checkpoints[0], 1, 1);
    return { count, aborted };
  }

  // ---------- checkpoint placement ----------
  function pickIdx(N, k, rng) {
    const set = new Set([0, N - 1]);
    const seg = (N - 1) / (k - 1);
    for (let i = 1; i < k - 1; i++) {
      let j = Math.round(i * seg) + ((rng() * 5) | 0) - 2;
      j = Math.max(1, Math.min(N - 2, j));
      set.add(j);
    }
    return [...set].sort((a, b) => a - b);
  }

  // ---------- generate ----------
  const LEVELS = {
    easy:   { R: 6, C: 6, numbers: 8, walls: 5 },
    medium: { R: 6, C: 6, numbers: 6, walls: 4 },
    hard:   { R: 7, C: 7, numbers: 7, walls: 6 }
  };

  // strip redundant walls / numbers while keeping the solution unique
  function minimize(R, C, walls, cps, idxs, path, cfg, rng) {
    const unique = (w, c) => {
      const r = countSolutions(R, C, w, c, 2, 250000);
      return !r.aborted && r.count === 1;
    };
    let W = new Set(walls), CP = cps.slice(), IX = idxs.slice();

    for (const w of shuffle([...W], rng)) {
      const t = new Set(W); t.delete(w);
      if (unique(t, CP)) W = t;
    }
    const interior = shuffle(IX.slice(1, -1), rng);
    for (const j of interior) {
      if (CP.length <= cfg.numbers) break;
      const nIX = IX.filter(x => x !== j);
      const nCP = nIX.map(i => path[i]);
      if (unique(W, nCP)) { IX = nIX; CP = nCP; }
    }
    for (const w of shuffle([...W], rng)) {
      const t = new Set(W); t.delete(w);
      if (unique(t, CP)) W = t;
    }
    return { walls: W, cps: CP };
  }

  function generate(level, seed) {
    const cfg = LEVELS[level] || LEVELS.medium;
    const R = cfg.R, C = cfg.C, N = R * C;
    const rng = mulberry32(seed >>> 0);
    const t0 = Date.now();

    for (let attempt = 0; attempt < 60; attempt++) {
      const path = backbite(snake(R, C), R, C, 6000, rng);
      const pathEdges = new Set();
      for (let i = 0; i < N - 1; i++) pathEdges.add(ek(path[i], path[i + 1]));
      const cand = shuffle(allEdges(R, C).filter(e => !pathEdges.has(e)), rng);

      const walls = new Set();
      let wi = 0;
      const slow = Date.now() - t0 > 1500;
      const baseW = cfg.walls + (slow ? 3 : 0);
      while (wi < baseW && wi < cand.length) walls.add(cand[wi++]);

      let idxs = pickIdx(N, cfg.numbers + (slow ? 2 : 0), rng);
      let cps = idxs.map(i => path[i]);

      for (let step = 0; step < 40; step++) {
        const res = countSolutions(R, C, walls, cps, 2, 250000);
        if (!res.aborted && res.count === 1) {
          const out = minimize(R, C, walls, cps, idxs, path, cfg, rng);
          return {
            level, seed, R, C,
            walls: [...out.walls],
            checkpoints: out.cps,
            solution: path,
            ms: Date.now() - t0
          };
        }
        if (wi < cand.length && (step % 3 !== 2 || idxs.length >= N - 2)) {
          walls.add(cand[wi++]);
        } else {
          let j, t = 0;
          const used = new Set(idxs);
          do { j = 1 + ((rng() * (N - 2)) | 0); t++; } while (used.has(j) && t < 60);
          idxs = [...new Set([...idxs, j])].sort((a, b) => a - b);
          cps = idxs.map(i => path[i]);
        }
      }
    }
    return null;
  }

  const api = { generate, countSolutions, buildAdj, rawNeighbors, ek, mulberry32, LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ZipEngine = api;
})(typeof self !== 'undefined' ? self : globalThis);
