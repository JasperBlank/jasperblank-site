// ── Hex Tic Tac Toe — Bot AI (v4 — Stronger + Optimized) ──
// Include this file to enable bot play. Remove it for human-vs-human tournament mode.
//
// v4 optimizations:
//  - Fast numeric board (Map<int,int>) eliminates all string alloc in hot path
//  - Combined lineScan: length + feasibility + openness in ONE pass (was 2 functions)
//  - Must-block safety net only at root (not inside deep search nodes)
//  - Accumulative scoring, iterative deepening, alpha-beta pruning

(function() {
  'use strict';

  window.HEX_BOT_LOADED = true;
  window.botSearchDepth = 0;

  const ALL_DQ = [1, -1, 0, 0, -1, 1];
  const ALL_DR = [0, 0, 1, -1, 1, -1];
  const DIR3_DQ = [1, 0, -1];
  const DIR3_DR = [0, 1, 1];

  // ── Fast numeric board ──
  // Map<int key, 1|2> where 1=X, 2=O. ~5x faster than string-keyed object lookups.
  const _fb = new Map();
  const P_X = 1, P_O = 2;

  function pCode(player) { return player === 'X' ? P_X : P_O; }

  // Numeric key — same as before but used for _fb too
  function nkey(q, r) { return (q + 10000) + (r + 10000) * 20001; }

  // Sync _fb from window.board at the start of each bot turn
  function syncFastBoard() {
    _fb.clear();
    const board = window.board;
    const keys = Object.keys(board);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = board[k];
      if (!v) continue;
      const ci = k.indexOf(',');
      const q = +k.substring(0, ci), r = +k.substring(ci + 1);
      _fb.set(nkey(q, r), v === 'X' ? P_X : P_O);
    }
  }

  // ── Combined line scan: length + feasibility + openness in ONE pass ──
  // Returns packed int: bits 0-7 = length, bit 8 = feasible, bits 9-10 = openness (0/1/2)
  // Openness: 0 = both ends blocked, 1 = one end open, 2 = both ends open
  function lineScan(q, r, dq, dr, pc) {
    let fwd = 0;
    for (let i = 1; i <= 5; i++) {
      if (_fb.get(nkey(q + dq * i, r + dr * i)) === pc) fwd++; else break;
    }
    let bwd = 0;
    for (let i = 1; i <= 5; i++) {
      if (_fb.get(nkey(q - dq * i, r - dr * i)) === pc) bwd++; else break;
    }
    const len = 1 + fwd + bwd;

    // Openness: check cells just beyond the line ends
    const fwdCell = _fb.get(nkey(q + dq * (fwd + 1), r + dr * (fwd + 1)));
    const bwdCell = _fb.get(nkey(q - dq * (bwd + 1), r - dr * (bwd + 1)));
    const fwdOpen = (fwdCell === undefined); // empty
    const bwdOpen = (bwdCell === undefined);
    const openness = (fwdOpen ? 1 : 0) + (bwdOpen ? 1 : 0);

    if (len >= 6) return len | 0x100 | (openness << 9);

    // Feasibility: can this line reach 6?
    const need = 6 - len;
    const sx = q - dq * bwd, sy = r - dr * bwd;
    let spaceBefore = 0;
    for (let i = 1; i <= need; i++) {
      const cell = _fb.get(nkey(sx - dq * i, sy - dr * i));
      if (cell === undefined || cell === pc) spaceBefore++; else break;
    }
    if (spaceBefore >= need) return len | 0x100 | (openness << 9);
    const ex = q + dq * fwd, ey = r + dr * fwd;
    let spaceAfter = 0;
    for (let i = 1; i <= need; i++) {
      const cell = _fb.get(nkey(ex + dq * i, ey + dr * i));
      if (cell === undefined || cell === pc) spaceAfter++; else break;
    }
    const feasible = (spaceBefore + spaceAfter >= need) ? 0x100 : 0;
    return len | feasible | (openness << 9);
  }

  // Legacy lineLenFeasible for functions that still use string board (findThreats etc.)
  function lineLenFeasible(q, r, dq, dr, player) {
    const board = window.board;
    let fwd = 0;
    for (let i = 1; i <= 5; i++) {
      if (board[(q + dq * i) + ',' + (r + dr * i)] === player) fwd++; else break;
    }
    let bwd = 0;
    for (let i = 1; i <= 5; i++) {
      if (board[(q - dq * i) + ',' + (r - dr * i)] === player) bwd++; else break;
    }
    const len = 1 + fwd + bwd;
    if (len >= 6) return len | 0x100;
    const need = 6 - len;
    const sx = q - dq * bwd, sy = r - dr * bwd;
    let spaceBefore = 0;
    for (let i = 1; i <= need; i++) {
      const cell = board[(sx - dq * i) + ',' + (sy - dr * i)];
      if (cell === undefined || cell === player) spaceBefore++; else break;
    }
    if (spaceBefore >= need) return len | 0x100;
    const ex = q + dq * fwd, ey = r + dr * fwd;
    let spaceAfter = 0;
    for (let i = 1; i <= need; i++) {
      const cell = board[(ex + dq * i) + ',' + (ey + dr * i)];
      if (cell === undefined || cell === player) spaceAfter++; else break;
    }
    return (spaceBefore + spaceAfter >= need) ? (len | 0x100) : len;
  }

  // Simulate place + undo — maintains BOTH boards + comCache
  function simPlace(q, r, player, fn) {
    const board = window.board;
    const comCache = window.comCache;
    const k = q + ',' + r;
    const nk = nkey(q, r);
    const pc = pCode(player);
    board[k] = player;
    _fb.set(nk, pc);
    comCache[player].sq += q; comCache[player].sr += r; comCache[player].n++;
    const result = fn();
    delete board[k];
    _fb.delete(nk);
    comCache[player].sq -= q; comCache[player].sr -= r; comCache[player].n--;
    return result;
  }

  // Get threat completion cells (blocks & extensions for 3+ in a row)
  function getThreatCells() {
    if (!window.findThreats) return [];
    const threats = window.findThreats();
    const cells = [];
    const seen = new Set();
    for (const t of threats) {
      for (const c of t.completions) {
        const k = nkey(c.q, c.r);
        if (!seen.has(k)) { seen.add(k); cells.push(c); }
      }
    }
    return cells;
  }

  // ── Must-block detection (root only — not called during deep search) ──
  function findMustBlocks(opponent) {
    const pc = pCode(opponent);
    const pieceList = window.pieceList;
    const checked = new Set();
    const blockCells = [];
    const seen = new Set();

    function scan(pq, pr) {
      for (let di = 0; di < 3; di++) {
        const dq = DIR3_DQ[di], dr = DIR3_DR[di];
        let sq = pq, sr = pr;
        while (_fb.get(nkey(sq - dq, sr - dr)) === pc) { sq -= dq; sr -= dr; }
        const rk = nkey(sq, sr) * 4 + di;
        if (checked.has(rk)) continue;
        checked.add(rk);
        let len = 0, cq = sq, cr = sr;
        while (_fb.get(nkey(cq, cr)) === pc) { len++; cq += dq; cr += dr; }
        if (len < 4) continue;
        if (!window.hasSpaceForSix(sq, sr, dq, dr, len, opponent)) continue;
        const beforeQ = sq - dq, beforeR = sr - dr;
        const afterQ = cq, afterR = cr;
        if (!_fb.has(nkey(beforeQ, beforeR))) {
          const k = nkey(beforeQ, beforeR);
          if (!seen.has(k)) { seen.add(k); blockCells.push({ q: beforeQ, r: beforeR }); }
        }
        if (!_fb.has(nkey(afterQ, afterR))) {
          const k = nkey(afterQ, afterR);
          if (!seen.has(k)) { seen.add(k); blockCells.push({ q: afterQ, r: afterR }); }
        }
      }
    }

    for (let pi = 0; pi < pieceList.length; pi++) {
      if (pieceList[pi].player === opponent) scan(pieceList[pi].q, pieceList[pi].r);
    }
    // Also scan sim-placed pieces
    for (const [nk, v] of _fb) {
      if (v !== pc) continue;
      const r = Math.floor(nk / 20001) - 10000;
      const q = (nk % 20001) - 10000;
      scan(q, r);
    }
    return blockCells;
  }

  // Get candidates using pieceList + numeric dedup
  function getCandidates() {
    const seen = new Set();
    const result = [];
    const pieceList = window.pieceList;
    for (let pi = 0; pi < pieceList.length; pi++) {
      const bq = pieceList[pi].q, br = pieceList[pi].r;
      for (let d = 0; d < 6; d++) {
        const dq = ALL_DQ[d], dr = ALL_DR[d];
        for (let dist = 1; dist <= 2; dist++) {
          const nq = bq + dq * dist, nr = br + dr * dist;
          const nk = nkey(nq, nr);
          if (seen.has(nk)) continue;
          seen.add(nk);
          if (!_fb.has(nk)) result.push({ q: nq, r: nr });
        }
      }
    }
    // Sim-placed pieces (in _fb but not pieceList)
    for (const [nk, _v] of _fb) {
      const r = Math.floor(nk / 20001) - 10000;
      const q = (nk % 20001) - 10000;
      for (let d = 0; d < 6; d++) {
        const dq = ALL_DQ[d], dr = ALL_DR[d];
        for (let dist = 1; dist <= 2; dist++) {
          const nq = q + dq * dist, nr = r + dr * dist;
          const nk2 = nkey(nq, nr);
          if (seen.has(nk2)) continue;
          seen.add(nk2);
          if (!_fb.has(nk2)) result.push({ q: nq, r: nr });
        }
      }
    }
    // Threat completion cells
    const threatCells = getThreatCells();
    for (const c of threatCells) {
      const nk = nkey(c.q, c.r);
      if (!seen.has(nk) && !_fb.has(nk)) { seen.add(nk); result.push(c); }
    }

    // ── Island candidates: cells deliberately far from existing pieces ──
    // Creating a separate island of pieces forces the opponent to defend
    // in two distant locations, which they can't do with just 2 moves.
    // We add a few "pioneer" cells at distance 4-6 from the nearest piece.
    if (pieceList.length >= 4) {
      const com = window.comCache;
      const xc = com.X.n > 0 ? com.X.sq / com.X.n : 0;
      const xr = com.X.n > 0 ? com.X.sr / com.X.n : 0;
      const oc = com.O.n > 0 ? com.O.sq / com.O.n : 0;
      const or2 = com.O.n > 0 ? com.O.sr / com.O.n : 0;
      // Pick spots in 6 directions, distance 4-5 from center of mass
      const cq = Math.round((xc + oc) / 2);
      const cr = Math.round((xr + or2) / 2);
      for (let d = 0; d < 6; d++) {
        const dq = ALL_DQ[d], dr = ALL_DR[d];
        for (let dist = 4; dist <= 6; dist++) {
          const nq = cq + dq * dist, nr = cr + dr * dist;
          const nk = nkey(nq, nr);
          if (!seen.has(nk) && !_fb.has(nk)) {
            seen.add(nk);
            result.push({ q: nq, r: nr });
          }
        }
      }
    }

    if (result.length === 0) result.push({ q: 0, r: 0 });
    return result;
  }

  function getCandidatesNear(extraCells) {
    const seen = new Set();
    const result = [];
    const pieceList = window.pieceList;
    for (let ei = 0; ei < extraCells.length; ei++) {
      const eq = extraCells[ei].q, er = extraCells[ei].r;
      for (let d = 0; d < 6; d++) {
        const dq = ALL_DQ[d], dr = ALL_DR[d];
        for (let dist = 1; dist <= 3; dist++) {
          const nq = eq + dq * dist, nr = er + dr * dist;
          const nk = nkey(nq, nr);
          if (seen.has(nk)) continue;
          seen.add(nk);
          if (!_fb.has(nk)) result.push({ q: nq, r: nr });
        }
      }
    }
    for (let pi = 0; pi < pieceList.length; pi++) {
      const p = pieceList[pi];
      let near = false;
      for (let ei = 0; ei < extraCells.length; ei++) {
        if (Math.abs(p.q - extraCells[ei].q) <= 3 && Math.abs(p.r - extraCells[ei].r) <= 3) { near = true; break; }
      }
      if (!near) continue;
      for (let d = 0; d < 6; d++) {
        const dq = ALL_DQ[d], dr = ALL_DR[d];
        for (let dist = 1; dist <= 2; dist++) {
          const nq = p.q + dq * dist, nr = p.r + dr * dist;
          const nk = nkey(nq, nr);
          if (seen.has(nk)) continue;
          seen.add(nk);
          if (!_fb.has(nk)) result.push({ q: nq, r: nr });
        }
      }
    }
    if (result.length === 0) result.push({ q: 0, r: 0 });
    return result;
  }

  function mergeCandidates(local, globalTop) {
    const seen = new Set();
    for (const c of local) seen.add(nkey(c.q, c.r));
    const threatCells = getThreatCells();
    for (const c of threatCells) {
      const nk = nkey(c.q, c.r);
      if (!seen.has(nk) && !_fb.has(nk)) { local.push({ q: c.q, r: c.r }); seen.add(nk); }
    }
    for (const c of globalTop) {
      const nk = nkey(c.q, c.r);
      if (!seen.has(nk) && !_fb.has(nk)) { local.push({ q: c.q, r: c.r }); seen.add(nk); }
    }
    return local;
  }

  // Playstyle multipliers: [offense, defense]
  const PLAYSTYLE_MULT = {
    aggressive:  [1.4, 0.6],
    balanced:    [1.0, 1.0],
    defensive:   [0.6, 1.4],
  };

  // ── Tunable weight defaults (distilled from deep search ground truth) ──
  // Distillation results: four↓ three↑↑↑ fork↑ defense↓
  //   four  ×0.75 → deep search doesn't overvalue single fours
  //   three ×8    → threes ARE the path to forks in 2-move turns
  //   fork  ×2    → fork combos are even more decisive than we thought
  //   def   ×0.5  → blocking less panicky, focus on own threats
  const W_FIVE   = 20000;
  const W_FOUR   = 7500;    // was 10000 — distilled ×0.75
  const W_THREE  = 4000;    // was 500   — distilled ×8 (threes build forks!)
  const W_TWO    = 30;
  const W_FORK   = 160000;  // was 80000 — distilled ×2 (forks are king)
  const W_4_3    = 50000;   // scaled up proportionally with fork
  const W_PRE_FORK = 20000; // two threes = pre-fork, also scaled up
  const W_TRIPLE = 30000;   // triple threat scaled up
  const W_BLOCK6 = 95000;
  const W_BLOCK5 = 85000;
  const W_BLOCK4 = 42500;   // was 85000 — distilled ×0.5 (less panicky)
  const W_BLOCK3 = 300;
  const W_OPP_FORK = 25000;  // was 50000 — distilled ×0.5
  const W_OPP_43   = 7500;   // scaled with defense
  const W_OPP_PRE  = 2500;   // scaled with defense

  function getWeights() {
    const tw = window._tuneWeights;
    if (!tw) return null;
    return tw;
  }

  // ── Accumulative scoring using fast lineScan ──
  function scoreMove(q, r, player) {
    const opponent = player === 'X' ? 'O' : 'X';
    const pc = pCode(player);
    const opc = pCode(opponent);
    const style = window.botPlaystyle || 'balanced';
    const [offMul, defMul] = PLAYSTYLE_MULT[style] || PLAYSTYLE_MULT.balanced;

    // Allow weight overrides for distillation grid search
    const tw = window._tuneWeights;
    const wFour = tw ? tw.four : W_FOUR;
    const wThree = tw ? (tw.three || W_THREE) : W_THREE;
    const wFork = tw ? tw.fork : W_FORK;
    const wBlock4 = tw ? tw.block4 : W_BLOCK4;
    const wOppFork = tw ? tw.oppFork : W_OPP_FORK;

    let offScore = 0, defScore = 0;
    let myFives = 0, myFours = 0, myThrees = 0, myTwos = 0;
    let oppFours = 0, oppThrees = 0;

    for (let di = 0; di < 3; di++) {
      const dq = DIR3_DQ[di], dr = DIR3_DR[di];

      // Own lines (single scan gives length + feasibility + openness)
      const my = lineScan(q, r, dq, dr, pc);
      const myLen = my & 0xFF;
      if (myLen >= 6) return 100000;
      if (my & 0x100) { // feasible
        const open = (my >> 9) & 0x3;
        const openMul = open === 2 ? 1.5 : 1.0;
        if (myLen === 5)      { myFives++; offScore += W_FIVE * openMul; }
        else if (myLen === 4) { myFours++; offScore += wFour * openMul; }
        else if (myLen === 3) { myThrees++; offScore += wThree * openMul; }
        else if (myLen === 2) { myTwos++; offScore += W_TWO; }
      }

      // Opponent lines
      const opp = lineScan(q, r, dq, dr, opc);
      const oppLen = opp & 0xFF;
      if (opp & 0x100) {
        if (oppLen >= 6)      defScore += W_BLOCK6;
        else if (oppLen === 5) defScore += W_BLOCK5;
        else if (oppLen === 4) { oppFours++; defScore += wBlock4; }
        else if (oppLen === 3) { oppThrees++; defScore += W_BLOCK3; }
      }
    }

    // Offense combos (stack)
    if (myFours >= 2)                       offScore += wFork;
    if (myFours >= 1 && myThrees >= 1)      offScore += W_4_3;
    if (myThrees >= 2)                      offScore += W_PRE_FORK;
    if (myThrees >= 3)                      offScore += W_TRIPLE;

    // Defense combos
    if (oppFours >= 2)                      defScore += wOppFork;
    if (oppFours >= 1 && oppThrees >= 1)    defScore += W_OPP_43;
    if (oppThrees >= 2)                     defScore += W_OPP_PRE;

    return offScore * offMul + defScore * defMul + Math.random() * 3;
  }

  // Check instant win (uses fast board)
  function isWinMove(q, r, pc) {
    for (let di = 0; di < 3; di++) {
      const dq = DIR3_DQ[di], dr = DIR3_DR[di];
      let fwd = 0;
      for (let i = 1; i <= 5; i++) { if (_fb.get(nkey(q+dq*i, r+dr*i)) === pc) fwd++; else break; }
      let bwd = 0;
      for (let i = 1; i <= 5; i++) { if (_fb.get(nkey(q-dq*i, r-dr*i)) === pc) bwd++; else break; }
      if (1 + fwd + bwd >= 6) return true;
    }
    return false;
  }

  // ── Pre-search win scan ──
  function findWinningMoves(player, hasTwo) {
    const pc = pCode(player);
    const candidates = getCandidates();

    for (const c of candidates) {
      if (_fb.has(nkey(c.q, c.r))) continue;
      if (isWinMove(c.q, c.r, pc)) return hasTwo ? [c, c] : [c];
    }

    if (!hasTwo) return null;

    for (const m1 of candidates) {
      if (_fb.has(nkey(m1.q, m1.r))) continue;
      const win = simPlace(m1.q, m1.r, player, () => {
        for (const m2 of candidates) {
          if (_fb.has(nkey(m2.q, m2.r))) continue;
          if (isWinMove(m2.q, m2.r, pc)) return m2;
        }
        for (let d = 0; d < 6; d++) {
          const nq = m1.q + ALL_DQ[d], nr = m1.r + ALL_DR[d];
          if (_fb.has(nkey(nq, nr))) continue;
          if (isWinMove(nq, nr, pc)) return { q: nq, r: nr };
        }
        return null;
      });
      if (win) return [m1, win];
    }

    return null;
  }

  // ── Fork-aware board evaluation (uses fast board) ──
  function evalBoard(player) {
    const pieceList = window.pieceList;
    const checked = new Set();
    const lines = { 1: { 5: 0, 4: 0, 3: 0, 2: 0 }, 2: { 5: 0, 4: 0, 3: 0, 2: 0 } };
    const pc = pCode(player);
    const opc = pc === P_X ? P_O : P_X;

    function scanPiece(pq, pr, p) {
      const ppc = pCode(p);
      for (let di = 0; di < 3; di++) {
        const dq = DIR3_DQ[di], dr = DIR3_DR[di];
        let sq = pq, sr = pr;
        while (_fb.get(nkey(sq - dq, sr - dr)) === ppc) { sq -= dq; sr -= dr; }
        const rk = nkey(sq, sr) * 4 + di;
        if (checked.has(rk)) continue;
        checked.add(rk);
        let len = 0, cq = sq, cr = sr;
        while (_fb.get(nkey(cq, cr)) === ppc) { len++; cq += dq; cr += dr; }
        if (len < 2 || len > 5) continue;
        if (!window.hasSpaceForSix(sq, sr, dq, dr, len, p)) continue;
        lines[ppc][len]++;
      }
    }

    for (let pi = 0; pi < pieceList.length; pi++) {
      scanPiece(pieceList[pi].q, pieceList[pi].r, pieceList[pi].player);
    }
    // Sim-placed pieces
    for (const [nk, v] of _fb) {
      const r = Math.floor(nk / 20001) - 10000;
      const q = (nk % 20001) - 10000;
      scanPiece(q, r, v === P_X ? 'X' : 'O');
    }

    function evalSide(s) {
      let v = 0;
      // Distilled weights: threes ×8, forks ×2, defense ×0.5
      v += s[5] * 20000;
      v += s[4] * 7500;
      v += s[3] * 4000;   // threes are fork builders
      v += s[2] * 30;
      if (s[4] >= 2)                    v += 160000;  // fork
      if (s[4] >= 1 && s[3] >= 2)      v += 60000;
      if (s[4] >= 1 && s[3] >= 1)      v += 50000;
      if (s[3] >= 2)                    v += 20000;   // pre-fork
      if (s[3] >= 3)                    v += 30000;   // triple threat
      return v;
    }

    return evalSide(lines[pc]) - evalSide(lines[opc]);
  }

  // ── Must-block safety (root only) ──
  function applyMustBlock(moves, player, hasTwo) {
    const opponent = player === 'X' ? 'O' : 'X';
    const blocks = findMustBlocks(opponent);
    if (blocks.length === 0) return moves;

    const moveKeys = new Set(moves.map(m => nkey(m.q, m.r)));
    for (const b of blocks) {
      if (moveKeys.has(nkey(b.q, b.r))) return moves; // already blocking
    }

    const blockCell = blocks[0];
    if (!hasTwo || moves.length < 2) return [blockCell];

    const s0 = scoreMove(moves[0].q, moves[0].r, player);
    const s1 = scoreMove(moves[1].q, moves[1].r, player);
    return s0 >= s1 ? [moves[0], blockCell] : [blockCell, moves[1]];
  }

  // ── Difficulty: Easy (greedy) ──
  function botPickMovesGreedy(activePlayer) {
    const hasTwo = window.movesLeft >= 2;
    const winMoves = findWinningMoves(activePlayer, hasTwo);
    if (winMoves) return winMoves;
    const candidates = getCandidates();
    let bestScore = -Infinity, bestMove = candidates[0];
    for (const c of candidates) {
      const s = scoreMove(c.q, c.r, activePlayer);
      if (s > bestScore) { bestScore = s; bestMove = c; }
    }
    if (!hasTwo) return applyMustBlock([bestMove], activePlayer, false);
    const result = simPlace(bestMove.q, bestMove.r, activePlayer, () => {
      const cands2 = getCandidates();
      let best2Score = -Infinity, best2 = cands2[0];
      for (const c of cands2) {
        if (_fb.has(nkey(c.q, c.r))) continue;
        const s = scoreMove(c.q, c.r, activePlayer);
        if (s > best2Score) { best2Score = s; best2 = c; }
      }
      return [bestMove, best2];
    });
    return applyMustBlock(result, activePlayer, true);
  }

  // ── Difficulty: Medium (1-ply lookahead) ──
  function botPickMovesMedium(activePlayer) {
    const player = activePlayer;
    const hasTwo = window.movesLeft >= 2;
    const winMoves = findWinningMoves(player, hasTwo);
    if (winMoves) return winMoves;
    if (!hasTwo) {
      const candidates = getCandidates();
      let bestScore = -Infinity, bestMove = candidates[0];
      for (const c of candidates) {
        const s = scoreMove(c.q, c.r, player);
        if (s > bestScore) { bestScore = s; bestMove = c; }
      }
      return applyMustBlock([bestMove], player, false);
    }
    const candidates = getCandidates();
    const scored = [];
    for (const c of candidates) scored.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, player) });
    scored.sort((a, b) => b.s - a.s);
    const topN = scored.length > 12 ? scored.slice(0, 12) : scored;
    let bestScore = -Infinity, bestPair = [topN[0], topN[1] || topN[0]];
    const pc = pCode(player);
    for (let i1 = 0; i1 < topN.length; i1++) {
      if (bestScore >= 200000) break;
      const m1 = topN[i1];
      simPlace(m1.q, m1.r, player, () => {
        if (isWinMove(m1.q, m1.r, pc)) { bestScore = 200000; bestPair = [m1]; return; }
        const cands2 = mergeCandidates(getCandidatesNear([m1]), topN);
        const scored2 = [];
        for (const c of cands2) {
          if (_fb.has(nkey(c.q, c.r))) continue;
          scored2.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, player) });
        }
        scored2.sort((a, b) => b.s - a.s);
        const top2 = scored2.length > 10 ? scored2.slice(0, 10) : scored2;
        for (const m2 of top2) {
          const ps = simPlace(m2.q, m2.r, player, () => {
            if (isWinMove(m2.q, m2.r, pc)) return 200000;
            return m1.s + m2.s + evalBoard(player) * 0.3;
          });
          if (ps > bestScore) { bestScore = ps; bestPair = [m1, m2]; }
        }
      });
    }
    return applyMustBlock(bestPair, player, true);
  }

  // ── Difficulty: Hard (iterative deepening alpha-beta) ──

  let _nodesSearched = 0;
  let _pruned = 0;
  const WIN = 200000, LOSS = -200000;

  // Quick heuristic for very deep plies (ply 6+)
  function quickScore(q, r, pc) {
    const opc = pc === P_X ? P_O : P_X;
    let s = 0;
    for (let d = 0; d < 6; d++) {
      const v = _fb.get(nkey(q + ALL_DQ[d], r + ALL_DR[d]));
      if (v === pc) s += 10;
      else if (v === opc) s += 6;
    }
    for (let di = 0; di < 3; di++) {
      const dq = DIR3_DQ[di], dr = DIR3_DR[di];
      if (_fb.get(nkey(q+dq, r+dr)) === pc && _fb.get(nkey(q+dq*2, r+dr*2)) === pc) s += 50;
      if (_fb.get(nkey(q-dq, r-dr)) === pc && _fb.get(nkey(q+dq, r+dr)) === pc) s += 50;
      if (_fb.get(nkey(q+dq, r+dr)) === opc && _fb.get(nkey(q+dq*2, r+dr*2)) === opc) s += 30;
      if (_fb.get(nkey(q-dq, r-dr)) === opc && _fb.get(nkey(q+dq, r+dr)) === opc) s += 30;
    }
    return s + Math.random() * 2;
  }

  function getQuickCandidates(placed) {
    const seen = new Set();
    const result = [];
    for (let pi = 0; pi < placed.length; pi++) {
      const pq = placed[pi].q, pr = placed[pi].r;
      for (let d = 0; d < 6; d++) {
        const dq = ALL_DQ[d], dr = ALL_DR[d];
        for (let dist = 1; dist <= 2; dist++) {
          const nq = pq + dq * dist, nr = pr + dr * dist;
          const nk = nkey(nq, nr);
          if (seen.has(nk)) continue;
          seen.add(nk);
          if (!_fb.has(nk)) result.push({ q: nq, r: nr });
        }
      }
    }
    // Include threat cells but NOT findMustBlocks (too expensive for deep nodes)
    const tc = getThreatCells();
    for (const c of tc) {
      const nk = nkey(c.q, c.r);
      if (!seen.has(nk) && !_fb.has(nk)) { seen.add(nk); result.push(c); }
    }
    return result;
  }

  const _placedStack = [];
  let _placedLen = 0;

  function abSearch(turnPlayer, rootPlayer, depthRemaining, movesLeftInTurn,
                    currentPly, alpha, beta) {
    const isMax = (turnPlayer === rootPlayer);
    const tp = turnPlayer;
    const opp = tp === 'X' ? 'O' : 'X';
    const pc = pCode(tp);

    if (depthRemaining <= 0) return evalBoard(rootPlayer);

    const width = currentPly <= 2 ? 7 : currentPly <= 4 ? 5 : currentPly <= 6 ? 4 : 3;
    const useQuick = currentPly >= 6;

    const placed = _placedStack.slice(0, _placedLen);
    let raw;
    if (_placedLen > 0) {
      raw = useQuick ? getQuickCandidates(placed) : mergeCandidates(getCandidatesNear(placed), []);
    } else {
      raw = getCandidates();
    }

    const scored = [];
    if (useQuick) {
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (_fb.has(nkey(c.q, c.r))) continue;
        scored.push({ q: c.q, r: c.r, s: quickScore(c.q, c.r, pc) });
      }
    } else {
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (_fb.has(nkey(c.q, c.r))) continue;
        scored.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, tp) });
      }
    }
    scored.sort((a, b) => b.s - a.s);
    const len = Math.min(scored.length, width);
    if (len === 0) return evalBoard(rootPlayer);

    let bestVal = isMax ? -Infinity : Infinity;

    for (let i = 0; i < len; i++) {
      const m = scored[i];
      _nodesSearched++;
      _placedStack[_placedLen] = m;
      _placedLen++;

      const v = simPlace(m.q, m.r, tp, () => {
        if (isWinMove(m.q, m.r, pc)) return isMax ? WIN : LOSS;
        const newML = movesLeftInTurn - 1;
        if (newML > 0) {
          return abSearch(tp, rootPlayer, depthRemaining, newML, currentPly + 1, alpha, beta);
        } else if (depthRemaining <= 1) {
          return evalBoard(rootPlayer);
        } else {
          return abSearch(opp, rootPlayer, depthRemaining - 1, 2, currentPly + 1, alpha, beta);
        }
      });

      _placedLen--;

      if (isMax) {
        if (v > bestVal) bestVal = v;
        if (bestVal > alpha) alpha = bestVal;
        if (alpha >= beta) { _pruned++; break; }
      } else {
        if (v < bestVal) bestVal = v;
        if (bestVal < beta) beta = bestVal;
        if (alpha >= beta) { _pruned++; break; }
      }
    }
    return bestVal;
  }

  function botPickMovesHard(activePlayer) {
    const player = activePlayer;
    const opponent = player === 'X' ? 'O' : 'X';
    const hasTwo = window.movesLeft >= 2;
    const pc = pCode(player);

    const winMoves = findWinningMoves(player, hasTwo);
    if (winMoves) {
      window.botNodesSearched = 0; window.botPruned = 0;
      window.botSearchDepth = 0; return winMoves;
    }

    const maxDepth = window.hardDepth || 4;
    _nodesSearched = 0;
    _pruned = 0;
    _placedLen = 0;
    window.botSearchDepth = maxDepth;

    const candidates = getCandidates();
    const scored = [];
    for (const c of candidates) scored.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, player) });
    scored.sort((a, b) => b.s - a.s);
    const topN = scored.length > 12 ? scored.slice(0, 12) : scored;

    if (!hasTwo) {
      let bestMove = topN[0];
      const withScores = topN.map(c => ({ ...c, searchScore: c.s }));

      for (let depth = 1; depth <= maxDepth; depth++) {
        withScores.sort((a, b) => b.searchScore - a.searchScore);
        let alpha = -Infinity, currentBest = withScores[0], currentBestScore = -Infinity;

        for (const c of withScores) {
          _nodesSearched++;
          _placedStack[0] = c; _placedLen = 1;
          const s = simPlace(c.q, c.r, player, () => {
            if (isWinMove(c.q, c.r, pc)) return WIN;
            if (depth <= 1) return c.s + evalBoard(player) * 0.5;
            return abSearch(opponent, player, depth - 1, 2, 2, alpha, Infinity);
          });
          _placedLen = 0;
          c.searchScore = s;
          if (s > currentBestScore) { currentBestScore = s; currentBest = c; }
          if (s > alpha) alpha = s;
          if (currentBestScore >= WIN) break;
        }
        bestMove = currentBest;
        if (currentBestScore >= WIN) break;
      }

      window.botNodesSearched = _nodesSearched;
      window.botPruned = _pruned;
      return applyMustBlock([bestMove], player, false);
    }

    // ── Two moves: iterative deepening over pairs ──
    const pairs = [];
    for (const m1 of topN) {
      simPlace(m1.q, m1.r, player, () => {
        if (isWinMove(m1.q, m1.r, pc)) {
          pairs.push({ m1, m2: m1, searchScore: WIN });
          return;
        }
        const cands2 = mergeCandidates(getCandidatesNear([m1]), topN);
        const scored2 = [];
        for (const c of cands2) {
          if (_fb.has(nkey(c.q, c.r))) continue;
          scored2.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, player) });
        }
        scored2.sort((a, b) => b.s - a.s);
        const top2 = scored2.length > 8 ? scored2.slice(0, 8) : scored2;
        for (const m2 of top2) {
          pairs.push({ m1, m2, searchScore: m1.s + m2.s });
        }
      });
    }

    let bestPair = pairs[0] ? [pairs[0].m1, pairs[0].m2] : [topN[0], topN[1] || topN[0]];

    for (let depth = 1; depth <= maxDepth; depth++) {
      pairs.sort((a, b) => b.searchScore - a.searchScore);
      let alpha = -Infinity, bestScore = -Infinity;
      const pairsToEval = depth <= 2 ? pairs.length :
        Math.min(pairs.length, Math.max(20, Math.floor(pairs.length * 0.5)));

      for (let pi = 0; pi < pairsToEval; pi++) {
        const pair = pairs[pi];
        _nodesSearched++;
        _placedStack[0] = pair.m1; _placedStack[1] = pair.m2; _placedLen = 2;

        const s = simPlace(pair.m1.q, pair.m1.r, player, () => {
          if (isWinMove(pair.m1.q, pair.m1.r, pc)) return WIN;
          return simPlace(pair.m2.q, pair.m2.r, player, () => {
            if (isWinMove(pair.m2.q, pair.m2.r, pc)) return WIN;
            if (depth <= 1) return pair.m1.s + pair.m2.s + evalBoard(player) * 0.5;
            return abSearch(opponent, player, depth - 1, 2, 3, alpha, Infinity);
          });
        });

        _placedLen = 0;
        pair.searchScore = s;
        if (s > bestScore) { bestScore = s; bestPair = [pair.m1, pair.m2]; }
        if (s > alpha) alpha = s;
        if (bestScore >= WIN) break;
      }
      if (bestScore >= WIN) break;
    }

    window.botNodesSearched = _nodesSearched;
    window.botPruned = _pruned;
    return applyMustBlock(bestPair, player, true);
  }

  // ── Bot dispatch ──
  window.botPickMoves = function(activePlayer) {
    const player = activePlayer || window.botPlayer;
    const diff = window.botDifficulty || 'medium';
    syncFastBoard(); // sync numeric board before any computation
    if (diff === 'easy') return botPickMovesGreedy(player);
    if (diff === 'medium') return botPickMovesMedium(player);
    return botPickMovesHard(player);
  };

  window.scheduleBotMove = function() {
    if (window.botThinking || window.gameOver) return;
    const activePlayer = window.currentPlayer;
    window.botThinking = true;
    const delays = { easy: [50, 50], medium: [200, 150], hard: [400, 350] };
    const diff = window.botDifficulty || 'medium';
    const [delay, delay2] = window.botVsBot ? [80, 80] : (delays[diff] || delays.medium);
    setTimeout(() => {
      if (window.gameOver || window.currentPlayer !== activePlayer) { window.botThinking = false; return; }
      const moves = window.botPickMoves(activePlayer);
      window.applyMove(moves[0].q, moves[0].r);
      if (moves.length > 1 && !window.gameOver && window.currentPlayer === activePlayer && window.movesLeft > 0) {
        setTimeout(() => {
          if (window.gameOver || window.currentPlayer !== activePlayer) { window.botThinking = false; return; }
          window.applyMove(moves[1].q, moves[1].r);
          window.botThinking = false;
          if (!window.gameOver && window.isBotTurn()) window.scheduleBotMove();
        }, delay2);
      } else {
        window.botThinking = false;
        if (!window.gameOver && window.isBotTurn()) window.scheduleBotMove();
      }
    }, delay);
  };
})();
