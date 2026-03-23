// ── Hex Tic Tac Toe — Bot AI (v6 — Deep Search + MCTS) ──
// Include this file to enable bot play. Remove it for human-vs-human tournament mode.
//
// v6 improvements:
//  - Quiescence search — extends search in tactical positions (no horizon effect)
//  - Aspiration windows — narrow search windows for faster iterative deepening
//  - Better TT replacement — depth-preferred, keeps valuable entries
//  - Dynamic move width — adapts candidate count to tactical complexity
//  - Opening book — pre-computed strong opening moves
//  - Improved threat cost — shared blocker detection (proper set cover)
//  - Monte Carlo Tree Search (MCTS) — alternative search engine
//    Set window.botSearchMethod = 'mcts' to use
// v5 base:
//  - Transposition table (Zobrist hashing), killer moves, history heuristic
//  - Late Move Reduction (LMR), must-block detection
//  - Fast numeric board, combined lineScan, iterative deepening
//  - Distilled shape patterns + spatial features (51 parameters)

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

  // ── Zobrist hashing (lazy-generated per cell×player) ──
  const _zobristCache = new Map();
  let _boardHash = 0;

  function getZobrist(q, r, pc) {
    const key = nkey(q, r) * 3 + pc; // pc is 1 or 2
    let v = _zobristCache.get(key);
    if (v === undefined) {
      v = (Math.random() * 0xFFFFFFFF) >>> 0;
      _zobristCache.set(key, v);
    }
    return v;
  }

  // Turn hashes: encode whose-turn + moves-left into the hash
  const _turnHash = [];
  for (let p = 0; p < 3; p++) {
    _turnHash[p] = [];
    for (let m = 0; m < 3; m++) {
      _turnHash[p][m] = (Math.random() * 0xFFFFFFFF) >>> 0;
    }
  }

  // ── Transposition table ──
  const _tt = new Map();
  const TT_MAX = 200000;
  const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

  // ── Killer moves (2 per ply level) ──
  const _killers = [];
  for (let i = 0; i < 30; i++) _killers.push([-1, -1]);

  // ── History heuristic (move → accumulated score) ──
  const _history = new Map();

  // Sync _fb from window.board at the start of each bot turn
  function syncFastBoard() {
    _fb.clear();
    _boardHash = 0;
    const board = window.board;
    const keys = Object.keys(board);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = board[k];
      if (!v) continue;
      const ci = k.indexOf(',');
      const q = +k.substring(0, ci), r = +k.substring(ci + 1);
      const pc = v === 'X' ? P_X : P_O;
      _fb.set(nkey(q, r), pc);
      _boardHash ^= getZobrist(q, r, pc);
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

  // Simulate place + undo — maintains BOTH boards + comCache + Zobrist hash
  function simPlace(q, r, player, fn) {
    const board = window.board;
    const comCache = window.comCache;
    const k = q + ',' + r;
    const nk = nkey(q, r);
    const pc = pCode(player);
    const zh = getZobrist(q, r, pc);
    board[k] = player;
    _fb.set(nk, pc);
    _boardHash ^= zh;
    comCache[player].sq += q; comCache[player].sr += r; comCache[player].n++;
    const result = fn();
    delete board[k];
    _fb.delete(nk);
    _boardHash ^= zh;
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
  // Returns { critical: [...], urgent: [...] }
  // critical = opponent has 4+ in-a-row (MUST block NOW or lose)
  // urgent = opponent has 3-in-a-row with both ends open (can reach 5 in one turn)
  function findMustBlocks(opponent) {
    const pc = pCode(opponent);
    const pieceList = window.pieceList;
    const checked = new Set();
    const critical = []; // 4+ in-a-row blocks
    const urgent = [];   // 3-in-a-row with both ends open (can become 5 in one turn)
    const seenCrit = new Set();
    const seenUrg = new Set();

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
        if (len < 3) continue;
        if (!window.hasSpaceForSix(sq, sr, dq, dr, len, opponent)) continue;

        const beforeQ = sq - dq, beforeR = sr - dr;
        const afterQ = cq, afterR = cr;
        const beforeOpen = !_fb.has(nkey(beforeQ, beforeR));
        const afterOpen = !_fb.has(nkey(afterQ, afterR));

        if (len >= 4) {
          // CRITICAL: must block immediately
          if (beforeOpen) {
            const k = nkey(beforeQ, beforeR);
            if (!seenCrit.has(k)) { seenCrit.add(k); critical.push({ q: beforeQ, r: beforeR, severity: len }); }
          }
          if (afterOpen) {
            const k = nkey(afterQ, afterR);
            if (!seenCrit.has(k)) { seenCrit.add(k); critical.push({ q: afterQ, r: afterR, severity: len }); }
          }
        } else if (len === 3 && beforeOpen && afterOpen) {
          // URGENT: opponent can extend to 5 with 2 moves (both ends open)
          // Also check if there's room beyond the ends for further extension
          const beforeOpen2 = !_fb.has(nkey(beforeQ - dq, beforeR - dr));
          const afterOpen2 = !_fb.has(nkey(afterQ + dq, afterR + dr));
          // If at least one side has 2+ open cells, opponent can reach 5 in one turn
          if (beforeOpen2 || afterOpen2) {
            if (!seenUrg.has(nkey(beforeQ, beforeR))) {
              seenUrg.add(nkey(beforeQ, beforeR));
              urgent.push({ q: beforeQ, r: beforeR, severity: 3 });
            }
            if (!seenUrg.has(nkey(afterQ, afterR))) {
              seenUrg.add(nkey(afterQ, afterR));
              urgent.push({ q: afterQ, r: afterR, severity: 3 });
            }
          }
        }
      }
    }

    for (let pi = 0; pi < pieceList.length; pi++) {
      if (pieceList[pi].player === opponent) scan(pieceList[pi].q, pieceList[pi].r);
    }
    for (const [nk, v] of _fb) {
      if (v !== pc) continue;
      const r = Math.floor(nk / 20001) - 10000;
      const q = (nk % 20001) - 10000;
      scan(q, r);
    }
    return { critical, urgent };
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

  // ══════════════════════════════════════════════════════════════
  // ── TUNABLE WEIGHTS (all distillable) ──
  // Every parameter here can be overridden via window._tuneWeights.
  // The distiller searches for optimal values.
  // ══════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════
  // DISTILLED WEIGHTS — v5 (threat cost + TT/killers/history/LMR)
  // 50 positions, depth-4 ground truth, 51 params
  // Result: 40.0% → 52.0% agreement (+12.0pp)
  // ══════════════════════════════════════════════════════
  const DEFAULTS = {
    // ── Line-based (offense) ──
    five: 13821,
    four: 5033,
    three: 851,
    two: 99.2,
    openBonus: 2.8,

    // ── Combination bonuses (offense) ──
    fork: 372914,
    fourThree: 71263,
    preFork: 100000,
    tripleThreat: 2000,

    // ── Defense (blocking) ──
    block6: 50000,
    block5: 83697,
    block4: 59736,
    block3: 74.6,
    oppFork: 5579,
    opp43: 3443,
    oppPreFork: 711,

    // ── SPATIAL: neighbor composition ──
    ownAdj: 68.6,
    oppAdj: 276,
    emptyAdj: -86.3,

    // ── SPATIAL: distances ──
    minDistOwn: -256,
    minDistOpp: -51,
    minDistAny: -200,
    distOwnCOM: -8.1,
    distOppCOM: 14.1,

    // ── SPATIAL: directional diversity ──
    feasibleDirs: 1175,
    openDirs: 324,

    // ── SPATIAL: spread metrics ──
    openSpace: 23.6,
    islandBonus: 4513,
    bridgeBonus: 5000,
    newQuadrant: 496,
    spreadBonus: -4.6,

    // ── SHAPE PATTERNS (distilled v5) ──
    pat_inline: 500,
    pat_lineExtend: 97.2,
    pat_gapBridge: -369,
    pat_adjOppLine: -202,
    pat_openReach: 451,
    pat_ownThenOpp: 1658,
    pat_skipAttack: -500,
    pat_longReach: 689,

    // Cross-direction:
    pat_vShape: -33.5,
    pat_oppV: -486,
    pat_trident: -1356,
    pat_clamp: 1686,

    // Diagonal/knight neighbors:
    pat_diagOwn: -500,
    pat_diagOpp: 16.3,
    pat_knightOwn: 8.1,
    pat_knightOpp: 1000,

    // Aggregate:
    pat_ownAdj1: 8.7,
    pat_oppAdj1: 7.8,
    pat_isolated: -810,
    pat_surrounded: -2095,

    // ── THREAT COST (forcing analysis) ──
    threatCostGain: 17403,
    threatCostBlock: 80000,
  };

  function w(name) {
    const tw = window._tuneWeights;
    if (tw && tw[name] !== undefined) return tw[name];
    return DEFAULTS[name];
  }

  // ══════════════════════════════════════════════════════════════
  // ── OPENING BOOK ──
  // Pre-computed strong opening moves for the first few moves.
  // Key = normalized board state, Value = array of good move options.
  // The bot picks randomly from top options for variety.
  // ══════════════════════════════════════════════════════════════

  // Normalize position: translate so piece centroid is near origin,
  // return a canonical key string
  function normalizeForBook(pieceList) {
    if (pieceList.length === 0) return 'empty';
    // Center on first piece
    const oq = pieceList[0].q, or2 = pieceList[0].r;
    const pieces = pieceList.map(p => ({
      q: p.q - oq, r: p.r - or2, player: p.player
    }));
    pieces.sort((a, b) => a.q !== b.q ? a.q - b.q : a.r !== b.r ? a.r - b.r : (a.player < b.player ? -1 : 1));
    return pieces.map(p => `${p.player}:${p.q},${p.r}`).join(';');
  }

  // Opening book: maps normalized position → [[q_offset, r_offset], ...]
  // Offsets are relative to first piece's position
  const OPENING_BOOK = {
    // Empty board → first move: center
    'empty': [[0, 0]],

    // X played center. O responds: develop along multiple directions
    'X:0,0': [
      [1, 0],   // adjacent — pressure
      [0, 1],   // adjacent different axis
      [-1, 1],  // adjacent third axis
      [2, 0],   // spaced — build own line
      [0, 2],   // spaced different axis
    ],

    // X center, O at (1,0) — O's second move (still O's turn, 2 moves)
    'O:0,0;X:-1,0': [  // normalized: O first at origin
      [0, 1],   // spread to second axis (creates V shape)
      [-1, 1],  // third axis
      [1, 0],   // extend own line
      [0, -1],  // opposite direction
    ],

    // X center, O at (0,1)
    'O:0,0;X:0,-1': [
      [1, 0],   // spread to second axis
      [-1, 1],  // third axis
      [0, 1],   // extend
    ],
  };

  function lookupBook(player) {
    const key = normalizeForBook(window.pieceList);
    const options = OPENING_BOOK[key];
    if (!options || options.length === 0) return null;

    const oq = window.pieceList.length > 0 ? window.pieceList[0].q : 0;
    const or2 = window.pieceList.length > 0 ? window.pieceList[0].r : 0;

    // Filter to unoccupied cells
    const valid = options.filter(([dq, dr]) => {
      const q = oq + dq, r = or2 + dr;
      return !window.board[q + ',' + r];
    });

    if (valid.length === 0) return null;
    // Pick randomly from top options for variety
    const pick = valid[Math.floor(Math.random() * Math.min(valid.length, 3))];
    return { q: oq + pick[0], r: or2 + pick[1] };
  }

  // ── Accumulative scoring with spatial features ──
  // skipThreatCost: if true, skip expensive threat cost delta (used in deep search)
  function scoreMove(q, r, player, skipThreatCost) {
    const opponent = player === 'X' ? 'O' : 'X';
    const pc = pCode(player);
    const opc = pCode(opponent);
    const style = window.botPlaystyle || 'balanced';
    const [offMul, defMul] = PLAYSTYLE_MULT[style] || PLAYSTYLE_MULT.balanced;

    let offScore = 0, defScore = 0;
    let myFives = 0, myFours = 0, myThrees = 0, myTwos = 0;
    let oppFours = 0, oppThrees = 0;
    let feasibleDirCount = 0, openDirCount = 0;

    const wFour = w('four'), wThree = w('three'), wFork = w('fork');
    const wBlock4 = w('block4'), wOppFork = w('oppFork');
    const openMulVal = w('openBonus');

    for (let di = 0; di < 3; di++) {
      const dq = DIR3_DQ[di], dr = DIR3_DR[di];

      // Own lines
      const my = lineScan(q, r, dq, dr, pc);
      const myLen = my & 0xFF;
      if (myLen >= 6) return 9999999; // instant win — effectively infinite
      if (my & 0x100) {
        const open = (my >> 9) & 0x3;
        const oMul = open === 2 ? openMulVal : 1.0;
        if (myLen === 5)      { myFives++; offScore += w('five') * oMul; }
        else if (myLen === 4) { myFours++; offScore += wFour * oMul; }
        else if (myLen === 3) { myThrees++; offScore += wThree * oMul; }
        else if (myLen === 2) { myTwos++; offScore += w('two'); feasibleDirCount++; }
        if (myLen >= 2) feasibleDirCount++;
        if (open === 2) openDirCount++;
      }

      // Opponent lines
      const opp = lineScan(q, r, dq, dr, opc);
      const oppLen = opp & 0xFF;
      if (opp & 0x100) {
        if (oppLen >= 6)      defScore += w('block6');
        else if (oppLen === 5) defScore += w('block5');
        else if (oppLen === 4) { oppFours++; defScore += wBlock4; }
        else if (oppLen === 3) { oppThrees++; defScore += w('block3'); }
      }
    }

    // Offense combos (stack)
    if (myFours >= 2)                       offScore += wFork;
    if (myFours >= 1 && myThrees >= 1)      offScore += w('fourThree');
    if (myThrees >= 2)                      offScore += w('preFork');
    if (myThrees >= 3)                      offScore += w('tripleThreat');

    // Defense combos
    if (oppFours >= 2)                      defScore += wOppFork;
    if (oppFours >= 1 && oppThrees >= 1)    defScore += w('opp43');
    if (oppThrees >= 2)                     defScore += w('oppPreFork');

    let score = offScore * offMul + defScore * defMul;

    // ══════════════════════════════════════════════
    // ── SPATIAL FEATURES ──
    // ══════════════════════════════════════════════

    // Neighbor scan (radius 1)
    let ownAdj = 0, oppAdj = 0, emptyAdj = 0;
    for (let d = 0; d < 6; d++) {
      const v = _fb.get(nkey(q + ALL_DQ[d], r + ALL_DR[d]));
      if (v === pc) ownAdj++;
      else if (v === opc) oppAdj++;
      else emptyAdj++;
    }
    score += ownAdj * w('ownAdj');
    score += oppAdj * w('oppAdj');
    score += emptyAdj * w('emptyAdj');

    // Nearest piece distances (scan radius 1-5)
    let minDistOwn = 99, minDistOpp = 99, minDistAny = 99;
    for (let dist = 1; dist <= 5; dist++) {
      for (let d = 0; d < 6; d++) {
        const v = _fb.get(nkey(q + ALL_DQ[d] * dist, r + ALL_DR[d] * dist));
        if (v !== undefined) {
          if (dist < minDistAny) minDistAny = dist;
          if (v === pc && dist < minDistOwn) minDistOwn = dist;
          if (v === opc && dist < minDistOpp) minDistOpp = dist;
        }
      }
      if (minDistOwn < 99 && minDistOpp < 99) break; // found both
    }
    if (minDistOwn < 99) score += minDistOwn * w('minDistOwn');
    if (minDistOpp < 99) score += minDistOpp * w('minDistOpp');
    if (minDistAny < 99) score += minDistAny * w('minDistAny');

    // Center of mass distances
    const com = window.comCache;
    if (com[player].n > 0) {
      const cx = com[player].sq / com[player].n;
      const cy = com[player].sr / com[player].n;
      const distOwn = Math.abs(q - cx) + Math.abs(r - cy);
      score += distOwn * w('distOwnCOM');
    }
    if (com[opponent].n > 0) {
      const cx = com[opponent].sq / com[opponent].n;
      const cy = com[opponent].sr / com[opponent].n;
      const distOpp = Math.abs(q - cx) + Math.abs(r - cy);
      score += distOpp * w('distOppCOM');
    }

    // Directional diversity
    score += feasibleDirCount * w('feasibleDirs');
    score += openDirCount * w('openDirs');

    // Open space (radius 2) — count empty cells
    let openSpace = 0;
    for (let d = 0; d < 6; d++) {
      const dq = ALL_DQ[d], dr = ALL_DR[d];
      if (!_fb.has(nkey(q + dq, r + dr))) openSpace++;
      if (!_fb.has(nkey(q + dq * 2, r + dr * 2))) openSpace++;
    }
    score += openSpace * w('openSpace');

    // Island detection: no own piece within radius 3
    let hasOwnNearby = false;
    outer: for (let dist = 1; dist <= 3; dist++) {
      for (let d = 0; d < 6; d++) {
        if (_fb.get(nkey(q + ALL_DQ[d] * dist, r + ALL_DR[d] * dist)) === pc) {
          hasOwnNearby = true; break outer;
        }
      }
    }
    if (!hasOwnNearby && com[player].n >= 3) score += w('islandBonus');

    // Bridge detection: connects two separate own clusters
    // Simple heuristic: count own neighbors in different hex directions
    // If they're in opposite/non-adjacent directions, this might bridge
    if (ownAdj >= 2) {
      const ownDirs = [];
      for (let d = 0; d < 6; d++) {
        if (_fb.get(nkey(q + ALL_DQ[d], r + ALL_DR[d])) === pc) ownDirs.push(d);
      }
      // Check if any two own-neighbors are far apart (not adjacent directions)
      let isBridge = false;
      for (let i = 0; i < ownDirs.length && !isBridge; i++) {
        for (let j = i + 1; j < ownDirs.length; j++) {
          const gap = Math.abs(ownDirs[i] - ownDirs[j]);
          if (gap >= 3 && gap <= 4) { isBridge = true; break; } // opposite-ish
        }
      }
      if (isBridge) score += w('bridgeBonus');
    }

    // New quadrant: is this in a direction from COM that has few own pieces?
    if (com[player].n >= 4) {
      const cx = com[player].sq / com[player].n;
      const cy = com[player].sr / com[player].n;
      const dq = q - cx, dr = r - cy;
      // Count how many own pieces are in the same "half" (dot product > 0)
      let sameHalf = 0;
      const pl = window.pieceList;
      for (let i = 0; i < pl.length; i++) {
        if (pl[i].player !== player) continue;
        const pdq = pl[i].q - cx, pdr = pl[i].r - cy;
        if (dq * pdq + dr * pdr > 0) sameHalf++;
      }
      // If less than 30% of own pieces are in this direction, it's underrepresented
      if (sameHalf < com[player].n * 0.3) score += w('newQuadrant');
    }

    // Spread bonus: how much does this move increase the spread of our pieces?
    if (com[player].n >= 3) {
      const cx = com[player].sq / com[player].n;
      const cy = com[player].sr / com[player].n;
      const distFromCOM = Math.sqrt((q - cx) * (q - cx) + (r - cy) * (r - cy));
      // Pieces far from COM increase spread — use distance as proxy
      score += distFromCOM * w('spreadBonus');
    }

    // ══════════════════════════════════════════════
    // ── SHAPE PATTERN FEATURES ──
    // Geometric patterns in local neighborhood.
    // All init to 0 — distillation discovers which matter.
    // ══════════════════════════════════════════════

    let ownAt1 = 0, oppAt1 = 0;
    const dirState = []; // what's at +1 in each of 3 directions: 0=empty, 1=opp, 2=own

    for (let di = 0; di < 3; di++) {
      const ddq = DIR3_DQ[di], ddr = DIR3_DR[di];
      const f1 = _fb.get(nkey(q + ddq, r + ddr));       // +1
      const f2 = _fb.get(nkey(q + ddq * 2, r + ddr * 2)); // +2
      const f3 = _fb.get(nkey(q + ddq * 3, r + ddr * 3)); // +3
      const b1 = _fb.get(nkey(q - ddq, r - ddr));       // -1
      const b2 = _fb.get(nkey(q - ddq * 2, r - ddr * 2)); // -2

      const f1c = f1 === pc ? 2 : f1 === opc ? 1 : 0;
      const f2c = f2 === pc ? 2 : f2 === opc ? 1 : 0;
      const b1c = b1 === pc ? 2 : b1 === opc ? 1 : 0;
      const b2c = b2 === pc ? 2 : b2 === opc ? 1 : 0;

      dirState[di] = f1c;
      if (f1c === 2) ownAt1++;
      if (f1c === 1) oppAt1++;

      // Inline: own at both -1 and +1 (fills gap in own line)
      if (b1c === 2 && f1c === 2) score += w('pat_inline');

      // Line extend: own at +1 and +2 (extending existing line)
      if (f1c === 2 && f2c === 2) score += w('pat_lineExtend');
      if (b1c === 2 && b2c === 2) score += w('pat_lineExtend');

      // Gap bridge: empty at +1, own at +2 (creates potential with a gap)
      if (f1c === 0 && f2c === 2) score += w('pat_gapBridge');
      if (b1c === 0 && b2c === 2) score += w('pat_gapBridge');

      // Adjacent to opponent line: opp at +1 and +2
      if (f1c === 1 && f2c === 1) score += w('pat_adjOppLine');
      if (b1c === 1 && b2c === 1) score += w('pat_adjOppLine');

      // Open reach: both +1 and +2 empty
      if (f1c === 0 && f2c === 0) score += w('pat_openReach');

      // Contested extension: own then opp
      if (f1c === 2 && f2c === 1) score += w('pat_ownThenOpp');
      if (b1c === 2 && b2c === 1) score += w('pat_ownThenOpp');

      // Skip attack: opp then own (leaping over opponent)
      if (f1c === 1 && f2c === 2) score += w('pat_skipAttack');
      if (b1c === 1 && b2c === 2) score += w('pat_skipAttack');

      // Long reach: own at +3, empty at +1 and +2
      const f3c = f3 === pc ? 2 : 0;
      if (f1c === 0 && f2c === 0 && f3c === 2) score += w('pat_longReach');
    }

    // Cross-direction patterns
    let vShapeCount = 0, oppVCount = 0;
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        if (dirState[a] === 2 && dirState[b] === 2) vShapeCount++;
        if (dirState[a] === 1 && dirState[b] === 1) oppVCount++;
      }
    }
    score += vShapeCount * w('pat_vShape');
    score += oppVCount * w('pat_oppV');

    // Trident: own at +1 in all 3 directions
    if (ownAt1 === 3) score += w('pat_trident');

    // Clamp: own in 2 dirs, opp in 3rd
    if (ownAt1 === 2 && oppAt1 === 1) score += w('pat_clamp');

    // Diagonal neighbors: cells at (dir_a + dir_b) — the "between" hex cells
    let diagOwn = 0, diagOpp = 0;
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        const cq = DIR3_DQ[a] + DIR3_DQ[b], cr = DIR3_DR[a] + DIR3_DR[b];
        const v1 = _fb.get(nkey(q + cq, r + cr));
        if (v1 === pc) diagOwn++;
        else if (v1 === opc) diagOpp++;
        // Also check the negative combined direction
        const v2 = _fb.get(nkey(q - cq, r - cr));
        if (v2 === pc) diagOwn++;
        else if (v2 === opc) diagOpp++;
      }
    }
    score += diagOwn * w('pat_diagOwn');
    score += diagOpp * w('pat_diagOpp');

    // Knight moves: 2 steps in one dir, 1 step in another (hex "L" shape)
    let knightOwn = 0, knightOpp = 0;
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        if (a === b) continue;
        const kq = DIR3_DQ[a] * 2 + DIR3_DQ[b];
        const kr = DIR3_DR[a] * 2 + DIR3_DR[b];
        const v = _fb.get(nkey(q + kq, r + kr));
        if (v === pc) knightOwn++;
        else if (v === opc) knightOpp++;
      }
    }
    score += knightOwn * w('pat_knightOwn');
    score += knightOpp * w('pat_knightOpp');

    // Aggregate counts
    score += ownAt1 * w('pat_ownAdj1');
    score += oppAt1 * w('pat_oppAdj1');

    // Isolated: no pieces at +1 in any direction
    if (ownAt1 === 0 && oppAt1 === 0) score += w('pat_isolated');

    // Surrounded: 4+ neighbors occupied (tight space, limited growth)
    if (ownAdj + oppAdj >= 4) score += w('pat_surrounded');

    // ══════════════════════════════════════════════
    // ── THREAT COST DELTA ──
    // How much does this move change the forcing balance?
    // A move that increases our threat cost or decreases opponent's is golden.
    // Only computed at shallow plies (expensive — scans all pieces).
    // ══════════════════════════════════════════════
    if (!skipThreatCost) {
      const tcBefore = computeThreatCost(player);
      const tcOppBefore = computeThreatCost(opponent);

      // Temporarily place and measure
      const tcK = q + ',' + r;
      const tcNk = nkey(q, r);
      window.board[tcK] = player;
      _fb.set(tcNk, pc);

      const tcAfter = computeThreatCost(player);
      const tcOppAfter = computeThreatCost(opponent);

      delete window.board[tcK];
      _fb.delete(tcNk);

      const myDelta = tcAfter.cost - tcBefore.cost;
      const oppDelta = tcOppBefore.cost - tcOppAfter.cost;

      // Crossing the threshold of 2 is CRITICAL — opponent has 2 moves/turn,
      // so 3+ threats they must respond to = forced win
      if (tcAfter.cost > 2 && tcBefore.cost <= 2) {
        score += 5000000; // this move creates unstoppable threats — near instant win
      } else if (tcAfter.cost === 2 && tcBefore.cost < 2) {
        score += 200000; // one more threat and we win
      }

      // Reducing opponent from >2 to <=2 is life-saving
      if (tcOppBefore.cost > 2 && tcOppAfter.cost <= 2) {
        score += 4000000; // saved ourselves from forced loss — near-critical
      } else if (tcOppBefore.cost === 2 && tcOppAfter.cost < 2) {
        score += 100000;
      }

      // General delta bonuses
      score += myDelta * w('threatCostGain');
      score += oppDelta * w('threatCostBlock');
    }

    score += Math.random() * 3;
    return score;
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

  // ══════════════════════════════════════════════════════════════
  // ── THREAT COST ANALYSIS ──
  // Computes the total "forcing cost" — how many moves the opponent
  // must spend to block ALL of a player's threats.
  // If cost > 2, opponent can't block everything → forced win!
  //
  // Threat costs:
  //  _OOOO_  (4 contiguous, both ends open) → cost 2
  //  OO__OO  (gapped, blocks with 1 internal) → cost 1
  //  _OOOOO  (5, one end open) → cost 1
  //  _OOOOO_ (5, both ends open) → cost 2
  //  OOO_OO  (5 in 6-window with gap) → cost 1
  // ══════════════════════════════════════════════════════════════

  function computeThreatCost(player) {
    const pc = pCode(player);
    const threats = []; // { blockCells: [nkey...], cost: number }
    const windowChecked = new Set();

    // Scan all 6-cell windows along each of 3 hex directions
    // A window is a threat if it has 4+ own pieces and 0 opponent pieces
    for (const [nk, v] of _fb) {
      if (v !== pc) continue;
      const pr = Math.floor(nk / 20001) - 10000;
      const pq = (nk % 20001) - 10000;

      for (let di = 0; di < 3; di++) {
        const dq = DIR3_DQ[di], dr = DIR3_DR[di];

        // This piece can be in positions 0-5 of a 6-cell window
        for (let offset = 0; offset < 6; offset++) {
          const wq = pq - offset * dq, wr = pr - offset * dr;
          const wk = nkey(wq, wr) * 4 + di;
          if (windowChecked.has(wk)) continue;
          windowChecked.add(wk);

          // Count pieces in this 6-cell window
          let ownCount = 0, blocked = false;
          const emptyCells = []; // positions (0-5) of empty cells

          for (let i = 0; i < 6; i++) {
            const cell = _fb.get(nkey(wq + dq * i, wr + dr * i));
            if (cell === pc) {
              ownCount++;
            } else if (cell !== undefined) {
              blocked = true; break; // opponent piece = can never complete
            } else {
              emptyCells.push(i);
            }
          }

          if (blocked || ownCount < 4) continue;

          if (ownCount >= 5) {
            // 5+ in window, 1 empty — win-in-1, cost 1 per gap
            for (const pos of emptyCells) {
              const bk = nkey(wq + dq * pos, wr + dr * pos);
              threats.push({ blockCells: [bk], cost: 1 });
            }
          } else if (ownCount === 4) {
            // 4 in window, 2 empty
            const blockKeys = emptyCells.map(pos => nkey(wq + dq * pos, wr + dr * pos));
            if (emptyCells[0] === 0 && emptyCells[1] === 5) {
              // Both empties at the ends — must block BOTH → cost 2
              threats.push({ blockCells: blockKeys, cost: 2 });
            } else {
              // At least one gap is internal — block any ONE gap → cost 1
              threats.push({ blockCells: blockKeys, cost: 1 });
            }
          }
        }
      }
    }

    if (threats.length === 0) return { cost: 0, threats: [] };

    // ── Improved set cover with shared blocker awareness ──
    // Build a map: blockCell → which threats it covers
    const cellToThreats = new Map(); // nkey → [threatIndex...]
    for (let ti = 0; ti < threats.length; ti++) {
      for (const bk of threats[ti].blockCells) {
        if (!cellToThreats.has(bk)) cellToThreats.set(bk, []);
        cellToThreats.get(bk).push(ti);
      }
    }

    // Greedy set cover: pick the blocking cell that covers the most uncovered threats
    const covered = new Set(); // threat indices that are neutralized
    const activeThreats = [];
    let totalCost = 0;

    // First pass: handle cost-2 threats (both ends must be blocked)
    for (let ti = 0; ti < threats.length; ti++) {
      if (threats[ti].cost === 2 && !covered.has(ti)) {
        // Both cells must be blocked for this threat
        activeThreats.push(threats[ti]);
        totalCost += 2;
        for (const bk of threats[ti].blockCells) {
          // Blocking this cell also covers other threats that share it
          const shared = cellToThreats.get(bk) || [];
          for (const si of shared) covered.add(si);
        }
      }
    }

    // Second pass: greedily cover remaining cost-1 threats
    let remaining = threats.filter((t, i) => t.cost === 1 && !covered.has(i));
    while (remaining.length > 0) {
      // Find the blocking cell that covers the most remaining threats
      let bestCell = -1, bestCount = 0;
      const remIndices = new Set(remaining.map((_, i) => {
        // Find original index
        for (let ti = 0; ti < threats.length; ti++) {
          if (threats[ti] === remaining[i] && !covered.has(ti)) return ti;
        }
        return -1;
      }));

      for (const [cellNk, threatIndices] of cellToThreats) {
        let count = 0;
        for (const ti of threatIndices) {
          if (!covered.has(ti) && threats[ti].cost === 1) count++;
        }
        if (count > bestCount) { bestCount = count; bestCell = cellNk; }
      }

      if (bestCell === -1 || bestCount === 0) break;

      // Use this cell — costs 1 move, covers all threats it touches
      totalCost += 1;
      const coveredByThis = cellToThreats.get(bestCell) || [];
      for (const ti of coveredByThis) {
        if (!covered.has(ti)) {
          covered.add(ti);
          activeThreats.push(threats[ti]);
        }
      }

      remaining = threats.filter((t, i) => t.cost === 1 && !covered.has(i));
    }

    return { cost: totalCost, threats: activeThreats };
  }

  // ══════════════════════════════════════════════════════════════
  // ── FORCING SEARCH ──
  // Narrow but DEEP search over only forcing moves (threat-creating)
  // and responses (blocking). Branching factor ~5-15 vs ~50 for full search.
  // Can detect forced wins 6-10 turns ahead.
  // ══════════════════════════════════════════════════════════════

  // Find moves that create or extend threats (4+ in a row with space)
  function getForcingMoves(player) {
    const pc = pCode(player);
    const candidates = getCandidates();
    const fiveExtends = []; // moves that create 5+
    const fourExtends = []; // moves that create 4

    for (const c of candidates) {
      if (_fb.has(nkey(c.q, c.r))) continue;
      let best = 0;
      for (let di = 0; di < 3; di++) {
        const scan = lineScan(c.q, c.r, DIR3_DQ[di], DIR3_DR[di], pc);
        const len = scan & 0xFF;
        const feasible = scan & 0x100;
        if (feasible) {
          if (len >= 5 && len > best) best = 5;
          else if (len >= 4 && best < 5) best = 4;
          else if (len >= 3 && best < 4) best = 3;
        }
      }
      if (best >= 5) fiveExtends.push(c);
      else if (best >= 4) fourExtends.push(c);
      else if (best >= 3) fourExtends.push(c); // 3s are pre-threats
    }
    return [...fiveExtends, ...fourExtends]; // prioritized: 5s first
  }

  // Get blocking moves against opponent threats
  function getBlockingMoves(opponent) {
    const { critical, urgent } = findMustBlocks(opponent);
    const seen = new Set();
    const blocks = [];
    for (const b of critical) {
      const bk = nkey(b.q, b.r);
      if (!seen.has(bk) && !_fb.has(bk)) { seen.add(bk); blocks.push(b); }
    }
    for (const b of urgent) {
      const bk = nkey(b.q, b.r);
      if (!seen.has(bk) && !_fb.has(bk)) { seen.add(bk); blocks.push(b); }
    }
    return blocks;
  }

  let _forcingNodes = 0;

  // Forcing search: alternating attacker (forcing moves) / defender (blocks)
  // Returns score: WIN if forced win found, LOSS if opponent has forced win
  function forcingSearch(attacker, turnPlayer, movesLeft, depth) {
    if (depth <= 0) return 0;
    _forcingNodes++;
    if (_forcingNodes > 50000) return 0; // safety cutoff

    const pc = pCode(turnPlayer);
    const opp = turnPlayer === 'X' ? 'O' : 'X';
    const isAttacker = (turnPlayer === attacker);

    // Check if current player can win immediately
    const winCands = getCandidates();
    for (const c of winCands) {
      if (_fb.has(nkey(c.q, c.r))) continue;
      if (isWinMove(c.q, c.r, pc) && movesLeft >= 1) return isAttacker ? WIN : LOSS;
    }

    // At turn boundary (movesLeft = 0 equivalent → we're at the start of this turn)
    // Check threat cost
    const atkCost = computeThreatCost(attacker);
    if (atkCost.cost > 2) return WIN; // attacker has unstoppable threats

    const defPlayer = attacker === 'X' ? 'O' : 'X';
    const defCost = computeThreatCost(defPlayer);
    if (defCost.cost > 2) return LOSS; // defender has unstoppable counter-threats

    // Get moves to try
    let moves;
    if (isAttacker) {
      moves = getForcingMoves(turnPlayer);
      if (moves.length > 12) moves = moves.slice(0, 12);
    } else {
      // Defender: blocks first, then counter-forcing moves
      const blocks = getBlockingMoves(turnPlayer === 'X' ? 'O' : 'X');
      const counterForcing = getForcingMoves(turnPlayer);
      const seen = new Set(blocks.map(b => nkey(b.q, b.r)));
      for (const m of counterForcing) {
        const mk = nkey(m.q, m.r);
        if (!seen.has(mk)) { seen.add(mk); blocks.push(m); }
      }
      moves = blocks;
      if (moves.length > 10) moves = moves.slice(0, 10);
    }

    if (moves.length === 0) return 0; // no forcing moves

    let bestVal = isAttacker ? -Infinity : Infinity;

    for (const m of moves) {
      if (_fb.has(nkey(m.q, m.r))) continue;

      const v = simPlace(m.q, m.r, turnPlayer, () => {
        if (isWinMove(m.q, m.r, pc)) return isAttacker ? WIN : LOSS;

        const newML = movesLeft - 1;
        if (newML > 0) {
          // Same player's turn continues
          return forcingSearch(attacker, turnPlayer, newML, depth - 1);
        } else {
          // Turn switches
          return forcingSearch(attacker, opp, 2, depth - 1);
        }
      });

      if (isAttacker) {
        if (v > bestVal) bestVal = v;
        if (bestVal >= WIN) return WIN; // found forced win, stop
      } else {
        if (v < bestVal) bestVal = v;
        if (bestVal <= LOSS) return LOSS; // defender can force counter-win
      }
    }

    return bestVal;
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
      // Forced wins: 3+ independent threats that opponent can't all block (max 2 moves/turn)
      if (s[4] >= 2)                    return 5000000; // fork = forced win
      if (s[3] >= 3)                    return 4500000; // triple threat = forced win
      if (s[4] >= 1 && s[3] >= 2)      return 4800000; // four + 2 threes = forced win
      let v = 0;
      v += s[5] * 20000;
      v += s[4] * 7500;
      v += s[3] * 4000;   // threes are fork builders
      v += s[2] * 30;
      if (s[4] >= 1 && s[3] >= 1)      v += 50000;    // four-three combo (dangerous)
      if (s[3] >= 2)                    v += 25000;    // pre-fork (building toward forced win)
      return v;
    }

    let base = evalSide(lines[pc]) - evalSide(lines[opc]);

    // ── Threat cost bonus (forcing analysis) ──
    // MASSIVE bonus when threat cost > 2 (unstoppable position)
    const myPlayer = pc === P_X ? 'X' : 'O';
    const oppPlayer = myPlayer === 'X' ? 'O' : 'X';
    const myTC = computeThreatCost(myPlayer);
    const oppTC = computeThreatCost(oppPlayer);

    if (myTC.cost > 2) base += 5000000;   // forced win — unstoppable threats
    else if (myTC.cost === 2) base += 200000; // very threatening
    else if (myTC.cost === 1) base += 20000;

    if (oppTC.cost > 2) base -= 5000000;   // forced loss — can't block everything
    else if (oppTC.cost === 2) base -= 200000;
    else if (oppTC.cost === 1) base -= 20000;

    return base;
  }

  // ── Must-block safety (root only) ──
  // Uses BOTH moves for blocking if there are multiple critical threats.
  function applyMustBlock(moves, player, hasTwo) {
    const opponent = player === 'X' ? 'O' : 'X';
    const { critical, urgent } = findMustBlocks(opponent);

    // Combine: critical blocks take absolute priority, then urgent
    const allBlocks = [...critical, ...urgent];
    if (allBlocks.length === 0) return moves;

    const moveKeys = new Set(moves.map(m => nkey(m.q, m.r)));

    // Count how many critical threats are NOT already addressed by our moves
    const unblockedCritical = critical.filter(b => !moveKeys.has(nkey(b.q, b.r)));
    const unblockedUrgent = urgent.filter(b => !moveKeys.has(nkey(b.q, b.r)));

    // If all critical threats are already blocked by our moves, check urgent
    if (unblockedCritical.length === 0 && unblockedUrgent.length === 0) return moves;

    // If we only have 1 move, use it for the most severe block
    if (!hasTwo || moves.length < 2) {
      const bestBlock = unblockedCritical[0] || unblockedUrgent[0];
      if (!bestBlock) return moves;
      return [bestBlock];
    }

    // We have 2 moves. Prioritize blocking.
    if (unblockedCritical.length >= 2) {
      // TWO+ critical threats unblocked: use BOTH moves to block!
      // Sort by severity (5-in-a-row > 4-in-a-row)
      unblockedCritical.sort((a, b) => b.severity - a.severity);
      return [unblockedCritical[0], unblockedCritical[1]];
    }

    if (unblockedCritical.length === 1) {
      // One critical threat: block it + keep our best other move
      const blockCell = unblockedCritical[0];
      const s0 = scoreMove(moves[0].q, moves[0].r, player);
      const s1 = scoreMove(moves[1].q, moves[1].r, player);
      // Check if there's also an urgent threat to block with the second move
      if (unblockedUrgent.length > 0) {
        return [blockCell, unblockedUrgent[0]];
      }
      return s0 >= s1 ? [moves[0], blockCell] : [blockCell, moves[1]];
    }

    // No critical but urgent threats exist
    if (unblockedUrgent.length >= 2) {
      // Multiple urgent threats: block the 2 most important
      return [unblockedUrgent[0], unblockedUrgent[1]];
    }

    if (unblockedUrgent.length === 1) {
      const blockCell = unblockedUrgent[0];
      const s0 = scoreMove(moves[0].q, moves[0].r, player);
      const s1 = scoreMove(moves[1].q, moves[1].r, player);
      return s0 >= s1 ? [moves[0], blockCell] : [blockCell, moves[1]];
    }

    return moves;
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
    // Opening book: use pre-computed moves for first few moves
    if (window.pieceList.length <= 5) {
      const bookMove = lookupBook(player);
      if (bookMove) return hasTwo ? [bookMove] : [bookMove]; // single book move, let second be scored
    }
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
      if (bestScore >= WIN) break;
      const m1 = topN[i1];
      simPlace(m1.q, m1.r, player, () => {
        if (isWinMove(m1.q, m1.r, pc)) { bestScore = WIN; bestPair = [m1]; return; }
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
            if (isWinMove(m2.q, m2.r, pc)) return WIN;
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
  const WIN = 9999999, LOSS = -9999999;

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

  // ── Quiescence search: extend search in tactical positions ──
  // Only considers win moves, must-blocks, and 4+-creating moves.
  // Prevents horizon effect where search stops right before a forced sequence.
  function qSearch(turnPlayer, rootPlayer, qDepth, movesLeftInTurn, alpha, beta) {
    const standPat = evalBoard(rootPlayer);
    const isMax = (turnPlayer === rootPlayer);

    // Stand-pat cutoff
    if (isMax) {
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
    } else {
      if (standPat <= alpha) return standPat;
      if (standPat < beta) beta = standPat;
    }

    if (qDepth <= 0) return standPat;

    const pc = pCode(turnPlayer);
    const opp = turnPlayer === 'X' ? 'O' : 'X';

    // Check if position is "noisy" — only extend if there are active threats
    // Gather only tactical moves: win moves, must-blocks, and 4-creators
    const tacticalMoves = [];
    const seen = new Set();

    // Win moves
    for (const [nk, v] of _fb) {
      if (v !== pc) continue;
      const pr = Math.floor(nk / 20001) - 10000;
      const pq = (nk % 20001) - 10000;
      for (let d = 0; d < 6; d++) {
        const nq = pq + ALL_DQ[d], nr = pr + ALL_DR[d];
        const cnk = nkey(nq, nr);
        if (seen.has(cnk) || _fb.has(cnk)) continue;
        seen.add(cnk);
        if (isWinMove(nq, nr, pc)) tacticalMoves.push({ q: nq, r: nr, priority: 10000 });
      }
    }

    // Must-block cells (critical only — 4+ in a row threats)
    const opc = pCode(opp);
    const critBlocks = [];
    const checked = new Set();
    for (const [nk, v] of _fb) {
      if (v !== opc) continue;
      const pr = Math.floor(nk / 20001) - 10000;
      const pq = (nk % 20001) - 10000;
      for (let di = 0; di < 3; di++) {
        const dq = DIR3_DQ[di], dr = DIR3_DR[di];
        let sq = pq, sr = pr;
        while (_fb.get(nkey(sq - dq, sr - dr)) === opc) { sq -= dq; sr -= dr; }
        const rk = nkey(sq, sr) * 4 + di;
        if (checked.has(rk)) continue;
        checked.add(rk);
        let len = 0, cq = sq, cr = sr;
        while (_fb.get(nkey(cq, cr)) === opc) { len++; cq += dq; cr += dr; }
        if (len < 4) continue;
        const bk1 = nkey(sq - dq, sr - dr);
        if (!_fb.has(bk1) && !seen.has(bk1)) { seen.add(bk1); critBlocks.push({ q: sq - dq, r: sr - dr }); }
        const bk2 = nkey(cq, cr);
        if (!_fb.has(bk2) && !seen.has(bk2)) { seen.add(bk2); critBlocks.push({ q: cq, r: cr }); }
      }
    }
    for (const b of critBlocks) tacticalMoves.push({ q: b.q, r: b.r, priority: 5000 });

    // Moves creating 4+ in own lines
    for (const [nk, v] of _fb) {
      if (v !== pc) continue;
      const pr = Math.floor(nk / 20001) - 10000;
      const pq = (nk % 20001) - 10000;
      for (let d = 0; d < 6; d++) {
        const nq = pq + ALL_DQ[d], nr = pr + ALL_DR[d];
        const cnk = nkey(nq, nr);
        if (seen.has(cnk) || _fb.has(cnk)) continue;
        // Quick check: does placing here create a line of 4+?
        let dominated = false;
        for (let di = 0; di < 3; di++) {
          const scan = lineScan(nq, nr, DIR3_DQ[di], DIR3_DR[di], pc);
          if ((scan & 0xFF) >= 4 && (scan & 0x100)) { dominated = true; break; }
        }
        if (dominated) { seen.add(cnk); tacticalMoves.push({ q: nq, r: nr, priority: 2000 }); }
      }
    }

    // If no tactical moves, position is quiet — return stand-pat
    if (tacticalMoves.length === 0) return standPat;

    // Sort by priority
    tacticalMoves.sort((a, b) => b.priority - a.priority);
    const maxMoves = Math.min(tacticalMoves.length, 6); // cap width

    let bestVal = standPat;

    for (let i = 0; i < maxMoves; i++) {
      const m = tacticalMoves[i];
      _nodesSearched++;

      const v = simPlace(m.q, m.r, turnPlayer, () => {
        if (isWinMove(m.q, m.r, pc)) return isMax ? WIN : LOSS;
        const newML = movesLeftInTurn - 1;
        if (newML > 0) {
          return qSearch(turnPlayer, rootPlayer, qDepth - 1, newML, alpha, beta);
        } else {
          return qSearch(opp, rootPlayer, qDepth - 1, 2, alpha, beta);
        }
      });

      if (isMax) {
        if (v > bestVal) bestVal = v;
        if (bestVal > alpha) alpha = bestVal;
        if (alpha >= beta) break;
      } else {
        if (v < bestVal) bestVal = v;
        if (bestVal < beta) beta = bestVal;
        if (alpha >= beta) break;
      }
    }

    return bestVal;
  }

  function abSearch(turnPlayer, rootPlayer, depthRemaining, movesLeftInTurn,
                    currentPly, alpha, beta) {
    const isMax = (turnPlayer === rootPlayer);
    const tp = turnPlayer;
    const opp = tp === 'X' ? 'O' : 'X';
    const pc = pCode(tp);

    if (depthRemaining <= 0) {
      // ── Quiescence search: don't stop in noisy positions ──
      return qSearch(turnPlayer, rootPlayer, 4, movesLeftInTurn, alpha, beta);
    }

    // ── Transposition table lookup ──
    const ttKey = _boardHash ^ _turnHash[pc][movesLeftInTurn];
    const ttEntry = _tt.get(ttKey);
    let ttBestNk = -1;
    if (ttEntry && ttEntry.depth >= depthRemaining) {
      if (ttEntry.flag === TT_EXACT) return ttEntry.value;
      if (ttEntry.flag === TT_LOWER && ttEntry.value >= beta) return ttEntry.value;
      if (ttEntry.flag === TT_UPPER && ttEntry.value <= alpha) return ttEntry.value;
      // Even if we can't use the value, use the best move for ordering
      ttBestNk = ttEntry.bestNk;
    } else if (ttEntry) {
      ttBestNk = ttEntry.bestNk;
    }

    const baseWidth = currentPly <= 2 ? 7 : currentPly <= 4 ? 5 : currentPly <= 6 ? 4 : 3;
    const useQuick = currentPly >= 8;

    const placed = _placedStack.slice(0, _placedLen);
    let raw;
    if (_placedLen > 0) {
      raw = useQuick ? getQuickCandidates(placed) : mergeCandidates(getCandidatesNear(placed), []);
    } else {
      raw = getCandidates();
    }

    const scored = [];
    const k1 = _killers[currentPly] ? _killers[currentPly][0] : -1;
    const k2 = _killers[currentPly] ? _killers[currentPly][1] : -1;

    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      const cnk = nkey(c.q, c.r);
      if (_fb.has(cnk)) continue;
      // Move ordering: TT best move > killers > history, then eval score
      // Priority is ONLY for sort ordering, NOT mixed into eval
      let priority = 0;
      if (cnk === ttBestNk) priority = 1000000;
      else if (cnk === k1) priority = 500000;
      else if (cnk === k2) priority = 400000;
      else priority = (_history.get(cnk) || 0);
      const evalScore = useQuick ? quickScore(c.q, c.r, pc) : scoreMove(c.q, c.r, tp, currentPly >= 3);
      scored.push({ q: c.q, r: c.r, s: evalScore, order: evalScore + priority });
    }
    scored.sort((a, b) => b.order - a.order);
    // Dynamic width: count high-priority tactical moves, always include them
    let tacticalCount = 0;
    for (let i = 0; i < scored.length && i < 12; i++) {
      if (scored[i].order >= 500000) tacticalCount++; // TT best + killers
    }
    const width = Math.max(baseWidth, Math.min(tacticalCount + 2, 10));
    const len = Math.min(scored.length, width);
    if (len === 0) return evalBoard(rootPlayer);

    const origAlpha = alpha;
    let bestVal = isMax ? -Infinity : Infinity;
    let bestMoveNk = -1;

    for (let i = 0; i < len; i++) {
      const m = scored[i];
      const mnk = nkey(m.q, m.r);
      _nodesSearched++;
      _placedStack[_placedLen] = m;
      _placedLen++;

      // ── Late Move Reduction: reduce depth for later moves at deep plies ──
      let reduction = 0;
      if (i >= 3 && currentPly >= 3 && depthRemaining >= 2 && movesLeftInTurn <= 1) {
        reduction = 1; // search 1 ply shallower
      }

      let v = simPlace(m.q, m.r, tp, () => {
        if (isWinMove(m.q, m.r, pc)) return isMax ? WIN : LOSS;
        const newML = movesLeftInTurn - 1;
        if (newML > 0) {
          return abSearch(tp, rootPlayer, depthRemaining - reduction, newML, currentPly + 1, alpha, beta);
        } else if (depthRemaining - reduction <= 1) {
          return qSearch(opp, rootPlayer, 4, 2, alpha, beta);
        } else {
          return abSearch(opp, rootPlayer, depthRemaining - 1 - reduction, 2, currentPly + 1, alpha, beta);
        }
      });

      // Re-search at full depth if reduced search found something interesting
      if (reduction > 0) {
        if ((isMax && v > alpha) || (!isMax && v < beta)) {
          v = simPlace(m.q, m.r, tp, () => {
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
        }
      }

      _placedLen--;

      if (isMax) {
        if (v > bestVal) { bestVal = v; bestMoveNk = mnk; }
        if (bestVal > alpha) alpha = bestVal;
        if (alpha >= beta) {
          _pruned++;
          // Store killer move
          if (currentPly < _killers.length && mnk !== _killers[currentPly][0]) {
            _killers[currentPly][1] = _killers[currentPly][0];
            _killers[currentPly][0] = mnk;
          }
          // Update history
          _history.set(mnk, (_history.get(mnk) || 0) + depthRemaining * depthRemaining);
          break;
        }
      } else {
        if (v < bestVal) { bestVal = v; bestMoveNk = mnk; }
        if (bestVal < beta) beta = bestVal;
        if (alpha >= beta) {
          _pruned++;
          if (currentPly < _killers.length && mnk !== _killers[currentPly][0]) {
            _killers[currentPly][1] = _killers[currentPly][0];
            _killers[currentPly][0] = mnk;
          }
          _history.set(mnk, (_history.get(mnk) || 0) + depthRemaining * depthRemaining);
          break;
        }
      }
    }

    // ── Store in transposition table (depth-preferred replacement) ──
    const flag = bestVal <= origAlpha ? TT_UPPER : bestVal >= beta ? TT_LOWER : TT_EXACT;
    const existing = _tt.get(ttKey);
    if (!existing || existing.depth <= depthRemaining || existing.flag !== TT_EXACT) {
      if (_tt.size >= TT_MAX) {
        // Evict ~25% of entries (prefer keeping deep ones)
        let evicted = 0;
        for (const [k, e] of _tt) {
          if (evicted >= TT_MAX / 4) break;
          if (e.depth <= 1) { _tt.delete(k); evicted++; }
        }
        if (_tt.size >= TT_MAX) {
          // Still full — evict more aggressively
          for (const [k] of _tt) {
            if (_tt.size < TT_MAX * 0.75) break;
            _tt.delete(k);
          }
        }
      }
      _tt.set(ttKey, { depth: depthRemaining, value: bestVal, flag, bestNk: bestMoveNk });
    }

    return bestVal;
  }

  function botPickMovesHard(activePlayer) {
    const player = activePlayer;
    const opponent = player === 'X' ? 'O' : 'X';
    const hasTwo = window.movesLeft >= 2;
    const pc = pCode(player);

    // Opening book for early game
    if (window.pieceList.length <= 5) {
      const bookMove = lookupBook(player);
      if (bookMove) return [bookMove]; // use book for first move of pair, let search handle second
    }

    const winMoves = findWinningMoves(player, hasTwo);
    if (winMoves) {
      window.botNodesSearched = 0; window.botPruned = 0;
      window.botSearchDepth = 0; return winMoves;
    }

    // ── Forcing search: detect forced wins/losses deep in threat space ──
    // Search depth 16 = ~4 full turns of forcing moves (way deeper than alpha-beta)
    _forcingNodes = 0;
    const forcingResult = forcingSearch(player, player, hasTwo ? 2 : 1, 16);

    if (forcingResult >= WIN) {
      // We have a forced win via threats! Find the best forcing move pair.
      const forcing = getForcingMoves(player);
      if (forcing.length > 0) {
        // Pick the forcing moves that lead to the highest threat cost
        let bestForcing = null, bestTC = -1;
        for (const m1 of forcing.slice(0, 8)) {
          const tc = simPlace(m1.q, m1.r, player, () => {
            if (isWinMove(m1.q, m1.r, pc)) return 999;
            return computeThreatCost(player).cost;
          });
          if (tc > bestTC) { bestTC = tc; bestForcing = m1; }
        }
        if (bestForcing) {
          if (!hasTwo) {
            window.botNodesSearched = _forcingNodes; window.botPruned = 0;
            window.botSearchDepth = 0;
            return [bestForcing];
          }
          // Find best second forcing move
          const result = simPlace(bestForcing.q, bestForcing.r, player, () => {
            if (isWinMove(bestForcing.q, bestForcing.r, pc)) return bestForcing;
            const forcing2 = getForcingMoves(player);
            let best2 = null, best2TC = -1;
            for (const m2 of forcing2.slice(0, 8)) {
              if (_fb.has(nkey(m2.q, m2.r))) continue;
              const tc2 = simPlace(m2.q, m2.r, player, () => {
                if (isWinMove(m2.q, m2.r, pc)) return 999;
                return computeThreatCost(player).cost;
              });
              if (tc2 > best2TC) { best2TC = tc2; best2 = m2; }
            }
            return best2;
          });
          if (result) {
            window.botNodesSearched = _forcingNodes; window.botPruned = 0;
            window.botSearchDepth = 0;
            return [bestForcing, result];
          }
        }
      }
    }

    // If opponent has a forced win via threats, we'll rely on the must-block system
    // (the regular search + must-block will handle defensive play)

    const maxDepth = window.hardDepth || 4;
    _nodesSearched = 0;
    _pruned = 0;
    _placedLen = 0;
    window.botSearchDepth = maxDepth;

    // Clear search tables for fresh search
    _tt.clear();
    _history.clear();
    for (let i = 0; i < _killers.length; i++) { _killers[i][0] = -1; _killers[i][1] = -1; }

    // Inject block cells into candidates so the search considers them
    const candidates = getCandidates();
    const { critical: critBlocks, urgent: urgBlocks } = findMustBlocks(opponent);
    const candSeen = new Set(candidates.map(c => nkey(c.q, c.r)));
    for (const b of critBlocks) {
      const bk = nkey(b.q, b.r);
      if (!candSeen.has(bk) && !_fb.has(bk)) { candSeen.add(bk); candidates.push(b); }
    }
    for (const b of urgBlocks) {
      const bk = nkey(b.q, b.r);
      if (!candSeen.has(bk) && !_fb.has(bk)) { candSeen.add(bk); candidates.push(b); }
    }

    const scored = [];
    for (const c of candidates) scored.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, player) });
    scored.sort((a, b) => b.s - a.s);
    const topN = scored.length > 12 ? scored.slice(0, 12) : scored;

    if (!hasTwo) {
      let bestMove = topN[0];
      const withScores = topN.map(c => ({ ...c, searchScore: c.s }));

      let prevBestScore = 0;
      for (let depth = 1; depth <= maxDepth; depth++) {
        withScores.sort((a, b) => b.searchScore - a.searchScore);

        // Aspiration window: start with narrow window around previous best
        let aspAlpha = depth >= 3 ? prevBestScore - 300 : -Infinity;
        let aspBeta = depth >= 3 ? prevBestScore + 300 : Infinity;
        let currentBest = withScores[0], currentBestScore = -Infinity;
        let needResearch = false;

        for (let attempt = 0; attempt < 2; attempt++) {
          let alpha = aspAlpha;
          currentBest = withScores[0]; currentBestScore = -Infinity;

          for (const c of withScores) {
            _nodesSearched++;
            _placedStack[0] = c; _placedLen = 1;
            const s = simPlace(c.q, c.r, player, () => {
              if (isWinMove(c.q, c.r, pc)) return WIN;
              if (depth <= 1) return c.s + evalBoard(player) * 0.5;
              return abSearch(opponent, player, depth - 1, 2, 2, alpha, aspBeta);
            });
            _placedLen = 0;
            c.searchScore = s;
            if (s > currentBestScore) { currentBestScore = s; currentBest = c; }
            if (s > alpha) alpha = s;
            if (currentBestScore >= WIN) break;
          }

          // Check if aspiration window failed
          if (currentBestScore <= aspAlpha || currentBestScore >= aspBeta) {
            if (attempt === 0 && currentBestScore < WIN) {
              aspAlpha = -Infinity; aspBeta = Infinity; // re-search with full window
              continue;
            }
          }
          break;
        }

        bestMove = currentBest;
        prevBestScore = currentBestScore;
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
    let prevPairBest = 0;

    for (let depth = 1; depth <= maxDepth; depth++) {
      pairs.sort((a, b) => b.searchScore - a.searchScore);
      let aspAlpha = depth >= 3 ? prevPairBest - 300 : -Infinity;
      let aspBeta = depth >= 3 ? prevPairBest + 300 : Infinity;
      const pairsToEval = depth <= 2 ? pairs.length :
        Math.min(pairs.length, Math.max(20, Math.floor(pairs.length * 0.5)));

      for (let attempt = 0; attempt < 2; attempt++) {
        let alpha = aspAlpha, bestScore = -Infinity;

        for (let pi = 0; pi < pairsToEval; pi++) {
          const pair = pairs[pi];
          _nodesSearched++;
          _placedStack[0] = pair.m1; _placedStack[1] = pair.m2; _placedLen = 2;

          const s = simPlace(pair.m1.q, pair.m1.r, player, () => {
            if (isWinMove(pair.m1.q, pair.m1.r, pc)) return WIN;
            return simPlace(pair.m2.q, pair.m2.r, player, () => {
              if (isWinMove(pair.m2.q, pair.m2.r, pc)) return WIN;
              if (depth <= 1) return pair.m1.s + pair.m2.s + evalBoard(player) * 0.5;
              return abSearch(opponent, player, depth - 1, 2, 3, alpha, aspBeta);
            });
          });

          _placedLen = 0;
          pair.searchScore = s;
          if (s > bestScore) { bestScore = s; bestPair = [pair.m1, pair.m2]; }
          if (s > alpha) alpha = s;
          if (bestScore >= WIN) break;
        }

        prevPairBest = bestScore;
        if ((bestScore <= aspAlpha || bestScore >= aspBeta) && attempt === 0 && bestScore < WIN) {
          aspAlpha = -Infinity; aspBeta = Infinity; continue;
        }
        break;
      }
      if (prevPairBest >= WIN) break;
    }

    window.botNodesSearched = _nodesSearched;
    window.botPruned = _pruned;
    return applyMustBlock(bestPair, player, true);
  }

  // ══════════════════════════════════════════════════════════════
  // ── MONTE CARLO TREE SEARCH (MCTS) ──
  // Alternative search method: uses random rollouts guided by evaluation
  // to explore the game tree. Excels in positions where alpha-beta's
  // narrow width misses creative moves.
  // ══════════════════════════════════════════════════════════════

  class MCTSNode {
    constructor(move, parent, turnPlayer, movesLeftInTurn) {
      this.move = move; // {q, r} or null for root
      this.parent = parent;
      this.children = [];
      this.visits = 0;
      this.totalValue = 0;
      this.turnPlayer = turnPlayer;
      this.movesLeft = movesLeftInTurn;
      this.untriedMoves = null; // lazy init
      this.isTerminal = false;
    }

    ucb1(parentVisits, explorationC) {
      if (this.visits === 0) return Infinity;
      return (this.totalValue / this.visits) +
        explorationC * Math.sqrt(Math.log(parentVisits) / this.visits);
    }

    bestChild(explorationC) {
      let best = null, bestUCB = -Infinity;
      for (const c of this.children) {
        const u = c.ucb1(this.visits, explorationC);
        if (u > bestUCB) { bestUCB = u; best = c; }
      }
      return best;
    }
  }

  function mctsGetMoves(turnPlayer) {
    const pc = pCode(turnPlayer);
    // Get candidates and score top ones quickly
    const cands = getCandidates();
    const moves = [];
    for (const c of cands) {
      if (_fb.has(nkey(c.q, c.r))) continue;
      moves.push({ q: c.q, r: c.r, qs: quickScore(c.q, c.r, pc) });
    }
    moves.sort((a, b) => b.qs - a.qs);
    return moves.slice(0, 15); // top 15 candidates
  }

  // Weighted random move selection for rollouts
  function rolloutMove(turnPlayer) {
    const pc = pCode(turnPlayer);
    const cands = [];
    // Quick scan of neighbors of existing pieces
    for (const [nk, v] of _fb) {
      const pr = Math.floor(nk / 20001) - 10000;
      const pq = (nk % 20001) - 10000;
      for (let d = 0; d < 6; d++) {
        const nq = pq + ALL_DQ[d], nr = pr + ALL_DR[d];
        const cnk = nkey(nq, nr);
        if (_fb.has(cnk)) continue;
        // Check for win
        if (isWinMove(nq, nr, pc)) return { q: nq, r: nr, isWin: true };
        cands.push({ q: nq, r: nr, nk: cnk });
      }
    }
    if (cands.length === 0) return null;
    // Dedup
    const seen = new Set();
    const unique = [];
    for (const c of cands) {
      if (seen.has(c.nk)) continue;
      seen.add(c.nk);
      unique.push(c);
    }
    // Weighted random: score top moves, softmax selection
    const scored = unique.slice(0, 20).map(c => ({
      ...c, s: quickScore(c.q, c.r, pc)
    }));
    const maxS = Math.max(...scored.map(c => c.s));
    const temp = 50; // temperature for softmax
    let totalW = 0;
    for (const c of scored) { c.w = Math.exp((c.s - maxS) / temp); totalW += c.w; }
    let r = Math.random() * totalW;
    for (const c of scored) { r -= c.w; if (r <= 0) return c; }
    return scored[scored.length - 1];
  }

  // Run a rollout from current board state, return score [-1, 1] for rootPlayer
  function mctsRollout(turnPlayer, rootPlayer, movesLeft, maxMoves) {
    let depth = 0;
    let cp = turnPlayer, ml = movesLeft;
    const undoStack = [];

    while (depth < maxMoves) {
      const pc = pCode(cp);
      const move = rolloutMove(cp);
      if (!move) break;

      const k = move.q + ',' + move.r;
      const nk = nkey(move.q, move.r);
      const zh = getZobrist(move.q, move.r, pc);
      window.board[k] = cp;
      _fb.set(nk, pc);
      _boardHash ^= zh;
      window.comCache[cp].sq += move.q; window.comCache[cp].sr += move.r; window.comCache[cp].n++;
      undoStack.push({ q: move.q, r: move.r, k, nk, pc, zh, player: cp });
      depth++;

      if (move.isWin || isWinMove(move.q, move.r, pc)) {
        // Winner found
        const result = (cp === rootPlayer) ? 1 : -1;
        // Undo all
        for (let i = undoStack.length - 1; i >= 0; i--) {
          const u = undoStack[i];
          delete window.board[u.k];
          _fb.delete(u.nk);
          _boardHash ^= u.zh;
          window.comCache[u.player].sq -= u.q; window.comCache[u.player].sr -= u.r; window.comCache[u.player].n--;
        }
        return result;
      }

      ml--;
      if (ml <= 0) {
        cp = cp === 'X' ? 'O' : 'X';
        ml = 2;
      }
    }

    // No winner in maxMoves — use eval
    const evalVal = evalBoard(rootPlayer);
    const normalized = Math.max(-1, Math.min(1, evalVal / 50000)); // normalize to [-1, 1]

    // Undo all
    for (let i = undoStack.length - 1; i >= 0; i--) {
      const u = undoStack[i];
      delete window.board[u.k];
      _fb.delete(u.nk);
      _boardHash ^= u.zh;
      window.comCache[u.player].sq -= u.q; window.comCache[u.player].sr -= u.r; window.comCache[u.player].n--;
    }
    return normalized;
  }

  function mctsSearch(rootPlayer, timeBudgetMs) {
    const hasTwo = window.movesLeft >= 2;
    const root = new MCTSNode(null, null, rootPlayer, hasTwo ? 2 : 1);
    const explorationC = 1.4;
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const getTime = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
    let iterations = 0;

    while (getTime() - startTime < timeBudgetMs) {
      iterations++;

      // ── Selection: walk down tree using UCB1 ──
      let node = root;
      const moveStack = []; // track placed moves for undo

      while (node.children.length > 0 && (node.untriedMoves === null || node.untriedMoves.length === 0)) {
        // Pick child by UCB1 — maximize for root player, minimize for opponent
        const isMax = (node.turnPlayer === rootPlayer);
        if (isMax) {
          node = node.bestChild(explorationC);
        } else {
          // For opponent nodes, pick the child with LOWEST value (best for opponent)
          let worst = null, worstUCB = Infinity;
          for (const c of node.children) {
            const u = c.visits === 0 ? -Infinity :
              -(c.totalValue / c.visits) + explorationC * Math.sqrt(Math.log(node.visits) / c.visits);
            if (u < worstUCB || c.visits === 0) { worstUCB = u; worst = c; }
          }
          node = worst || node.bestChild(explorationC);
        }

        if (node.move) {
          const pc = pCode(node.parent.turnPlayer);
          const k = node.move.q + ',' + node.move.r;
          const nk = nkey(node.move.q, node.move.r);
          const zh = getZobrist(node.move.q, node.move.r, pc);
          window.board[k] = node.parent.turnPlayer;
          _fb.set(nk, pc);
          _boardHash ^= zh;
          window.comCache[node.parent.turnPlayer].sq += node.move.q;
          window.comCache[node.parent.turnPlayer].sr += node.move.r;
          window.comCache[node.parent.turnPlayer].n++;
          moveStack.push({ q: node.move.q, r: node.move.r, k, nk, pc, zh, player: node.parent.turnPlayer });
        }

        if (node.isTerminal) break;
      }

      // ── Expansion: add one untried move ──
      if (!node.isTerminal) {
        if (node.untriedMoves === null) {
          node.untriedMoves = mctsGetMoves(node.turnPlayer);
          // Remove moves that are already children
          const childKeys = new Set(node.children.map(c => c.move ? nkey(c.move.q, c.move.r) : -1));
          node.untriedMoves = node.untriedMoves.filter(m => !childKeys.has(nkey(m.q, m.r)));
        }

        if (node.untriedMoves.length > 0) {
          const move = node.untriedMoves.pop();
          const newML = node.movesLeft - 1;
          let nextPlayer = node.turnPlayer;
          let nextML = newML;
          if (newML <= 0) {
            nextPlayer = node.turnPlayer === 'X' ? 'O' : 'X';
            nextML = 2;
          }

          const child = new MCTSNode(move, node, nextPlayer, nextML);
          node.children.push(child);

          // Place this move
          const pc = pCode(node.turnPlayer);
          const k = move.q + ',' + move.r;
          const nk = nkey(move.q, move.r);
          const zh = getZobrist(move.q, move.r, pc);
          window.board[k] = node.turnPlayer;
          _fb.set(nk, pc);
          _boardHash ^= zh;
          window.comCache[node.turnPlayer].sq += move.q;
          window.comCache[node.turnPlayer].sr += move.r;
          window.comCache[node.turnPlayer].n++;
          moveStack.push({ q: move.q, r: move.r, k, nk, pc, zh, player: node.turnPlayer });

          // Check if terminal
          if (isWinMove(move.q, move.r, pc)) {
            child.isTerminal = true;
          }

          node = child;
        }
      }

      // ── Simulation: rollout from current position ──
      let value;
      if (node.isTerminal) {
        // The move that got us here was a win for the parent's turn player
        value = (moveStack.length > 0 && moveStack[moveStack.length - 1].player === rootPlayer) ? 1 : -1;
      } else {
        value = mctsRollout(node.turnPlayer, rootPlayer, node.movesLeft, 30);
      }

      // ── Backpropagation ──
      let n = node;
      while (n !== null) {
        n.visits++;
        n.totalValue += value;
        n = n.parent;
      }

      // ── Undo all placed moves ──
      for (let i = moveStack.length - 1; i >= 0; i--) {
        const u = moveStack[i];
        delete window.board[u.k];
        _fb.delete(u.nk);
        _boardHash ^= u.zh;
        window.comCache[u.player].sq -= u.q;
        window.comCache[u.player].sr -= u.r;
        window.comCache[u.player].n--;
      }
    }

    // Pick best move(s) by visit count
    root.children.sort((a, b) => b.visits - a.visits);

    const moves = [];
    if (root.children.length > 0) {
      const best = root.children[0];
      moves.push(best.move);

      // If we need 2 moves, find best second move from that child's children
      if (hasTwo && best.children.length > 0) {
        best.children.sort((a, b) => b.visits - a.visits);
        moves.push(best.children[0].move);
      } else if (hasTwo) {
        // Fallback: use scoreMove for second move
        const m1 = best.move;
        simPlace(m1.q, m1.r, rootPlayer, () => {
          const cands = getCandidates();
          let bestS = -Infinity, bestM = cands[0];
          for (const c of cands) {
            if (_fb.has(nkey(c.q, c.r))) continue;
            const s = scoreMove(c.q, c.r, rootPlayer, true);
            if (s > bestS) { bestS = s; bestM = c; }
          }
          moves.push(bestM);
        });
      }
    }

    window.botNodesSearched = iterations;
    window.botPruned = 0;
    window.botSearchDepth = 0;
    return moves;
  }

  function botPickMovesMCTS(activePlayer) {
    const player = activePlayer;
    const hasTwo = window.movesLeft >= 2;

    // Check for instant wins first
    const winMoves = findWinningMoves(player, hasTwo);
    if (winMoves) return winMoves;

    // Time budget based on difficulty
    const timeBudgets = { easy: 200, medium: 1000, hard: 3000 };
    const diff = window.botDifficulty || 'medium';
    const budget = timeBudgets[diff] || 1000;

    const result = mctsSearch(player, budget);
    return applyMustBlock(result, player, hasTwo);
  }

  // ── Bot dispatch ──
  window.botPickMoves = function(activePlayer) {
    const player = activePlayer || window.botPlayer;
    const diff = window.botDifficulty || 'medium';
    const searchMethod = window.botSearchMethod || 'ab'; // 'ab', 'mcts', 'hybrid'
    syncFastBoard(); // sync numeric board before any computation
    if (diff === 'easy') return botPickMovesGreedy(player);
    if (searchMethod === 'mcts') return botPickMovesMCTS(player);
    if (diff === 'medium') return botPickMovesMedium(player);
    return botPickMovesHard(player);
  };

  // Expose threat cost analysis for UI
  window.computeThreatCost = function(player) {
    syncFastBoard();
    return computeThreatCost(player);
  };

  // ══════════════════════════════════════════════════════════════
  // ── FORCED WIN / CHECKMATE ANALYSIS ──
  // Detects mate-in-1, mate-in-2, and unstoppable threat positions.
  // Called after each move to display position evaluation.
  // ══════════════════════════════════════════════════════════════

  // Count cells where placing a piece would complete 6-in-a-row
  function countWinCells(player) {
    const pc = pCode(player);
    const checked = new Set();
    const winCells = [];
    const seen = new Set();

    for (const [nk, v] of _fb) {
      if (v !== pc) continue;
      const pr = Math.floor(nk / 20001) - 10000;
      const pq = (nk % 20001) - 10000;

      for (let di = 0; di < 3; di++) {
        const dq = DIR3_DQ[di], dr = DIR3_DR[di];
        let sq = pq, sr = pr;
        while (_fb.get(nkey(sq - dq, sr - dr)) === pc) { sq -= dq; sr -= dr; }
        const rk = nkey(sq, sr) * 4 + di;
        if (checked.has(rk)) continue;
        checked.add(rk);
        let len = 0, cq = sq, cr = sr;
        while (_fb.get(nkey(cq, cr)) === pc) { len++; cq += dq; cr += dr; }
        if (len < 5) continue;
        // Each open end is a win-in-one cell
        const bk = nkey(sq - dq, sr - dr);
        if (!_fb.has(bk) && !seen.has(bk)) { seen.add(bk); winCells.push({ q: sq - dq, r: sr - dr }); }
        const ak = nkey(cq, cr);
        if (!_fb.has(ak) && !seen.has(ak)) { seen.add(ak); winCells.push({ q: cq, r: cr }); }
      }
    }
    return winCells;
  }

  // Count lines of 4 with open completion cells (each completion → potential 5)
  function countFourThreats(player) {
    const pc = pCode(player);
    const checked = new Set();
    const threatCells = [];
    const seen = new Set();

    for (const [nk, v] of _fb) {
      if (v !== pc) continue;
      const pr = Math.floor(nk / 20001) - 10000;
      const pq = (nk % 20001) - 10000;

      for (let di = 0; di < 3; di++) {
        const dq = DIR3_DQ[di], dr = DIR3_DR[di];
        let sq = pq, sr = pr;
        while (_fb.get(nkey(sq - dq, sr - dr)) === pc) { sq -= dq; sr -= dr; }
        const rk = nkey(sq, sr) * 4 + di;
        if (checked.has(rk)) continue;
        checked.add(rk);
        let len = 0, cq = sq, cr = sr;
        while (_fb.get(nkey(cq, cr)) === pc) { len++; cq += dq; cr += dr; }
        if (len !== 4) continue;
        if (!window.hasSpaceForSix(sq, sr, dq, dr, len, player)) continue;
        const bk = nkey(sq - dq, sr - dr);
        if (!_fb.has(bk) && !seen.has(bk)) { seen.add(bk); threatCells.push({ q: sq - dq, r: sr - dr, dir: di }); }
        const ak = nkey(cq, cr);
        if (!_fb.has(ak) && !seen.has(ak)) { seen.add(ak); threatCells.push({ q: cq, r: cr, dir: di }); }
      }
    }
    return threatCells;
  }

  window.analyzePosition = function() {
    if (window.gameOver) return null;
    syncFastBoard();

    const cp = window.currentPlayer;
    const opp = cp === 'X' ? 'O' : 'X';
    const hasTwo = window.movesLeft >= 2;

    // ── Mate-in-1: current player can win this turn ──
    const winMoves = findWinningMoves(cp, hasTwo);
    if (winMoves) return { player: cp, mateIn: 1, moves: winMoves, type: 'win' };

    // ── Check existing threats (no hypothetical moves) ──
    const cpWinCells = countWinCells(cp);
    const oppWinCells = countWinCells(opp);

    // If opponent already has 3+ win cells, current player can't block all
    // (they have at most 2 moves). Opponent wins next turn.
    if (oppWinCells.length >= 3) {
      return { player: opp, mateIn: 2, threats: oppWinCells, type: 'unstoppable' };
    }

    // If current player has 3+ win cells AND it's about to be opponent's turn
    // after current player finishes, opponent can't block all → mate-in-2
    if (cpWinCells.length >= 3) {
      return { player: cp, mateIn: 2, threats: cpWinCells, type: 'unstoppable' };
    }

    // ── Mate-in-2: after current player's moves, create unstoppable threats ──
    // Try top candidate moves and check if resulting position has 3+ win threats
    const candidates = getCandidates();
    const scored = [];
    for (const c of candidates) {
      if (_fb.has(nkey(c.q, c.r))) continue;
      scored.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, cp) });
    }
    scored.sort((a, b) => b.s - a.s);
    const topN = scored.slice(0, 12);

    if (hasTwo) {
      // Try pairs of moves
      for (const m1 of topN) {
        const found = simPlace(m1.q, m1.r, cp, () => {
          if (isWinMove(m1.q, m1.r, pCode(cp))) return { player: cp, mateIn: 1, moves: [m1], type: 'win' };
          // Check if m1 alone creates 3+ five-threats
          const wc = countWinCells(cp);
          if (wc.length >= 3) return { player: cp, mateIn: 2, moves: [m1], threats: wc, type: 'setup' };

          const cands2 = getCandidates();
          const scored2 = [];
          for (const c of cands2) {
            if (_fb.has(nkey(c.q, c.r))) continue;
            scored2.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, cp) });
          }
          scored2.sort((a, b) => b.s - a.s);
          const top2 = scored2.slice(0, 8);

          for (const m2 of top2) {
            const r2 = simPlace(m2.q, m2.r, cp, () => {
              if (isWinMove(m2.q, m2.r, pCode(cp))) return true;
              const wc2 = countWinCells(cp);
              return wc2.length >= 3 ? wc2 : null;
            });
            if (r2 === true) return { player: cp, mateIn: 2, moves: [m1, m2], type: 'setup' };
            if (r2) return { player: cp, mateIn: 2, moves: [m1, m2], threats: r2, type: 'setup' };
          }
          return null;
        });
        if (found) return found;
      }
    } else {
      // Try single moves
      for (const m1 of topN) {
        const found = simPlace(m1.q, m1.r, cp, () => {
          if (isWinMove(m1.q, m1.r, pCode(cp))) return { player: cp, mateIn: 1, moves: [m1], type: 'win' };
          const wc = countWinCells(cp);
          if (wc.length >= 3) return { player: cp, mateIn: 2, moves: [m1], threats: wc, type: 'setup' };
          return null;
        });
        if (found) return found;
      }
    }

    // ── Threat cost analysis ──
    const cpTC = computeThreatCost(cp);
    const oppTC = computeThreatCost(opp);

    // If current player has threat cost > 2: unstoppable after their turn ends
    if (cpTC.cost > 2) {
      return { player: cp, mateIn: 2, threats: cpTC.threats, type: 'unstoppable_threats',
               detail: `Threat cost ${cpTC.cost} > 2 moves — opponent can't block all` };
    }
    if (oppTC.cost > 2) {
      return { player: opp, mateIn: 2, threats: oppTC.threats, type: 'unstoppable_threats',
               detail: `Threat cost ${oppTC.cost} > 2 moves — can't block all` };
    }

    // ── Forcing search: detect deep forced wins (up to ~4 turns ahead) ──
    _forcingNodes = 0;
    const cpForcing = forcingSearch(cp, cp, hasTwo ? 2 : 1, 12);
    if (cpForcing >= WIN) {
      return { player: cp, mateIn: 3, type: 'forcing',
               detail: 'Forced win via threat sequence' };
    }

    _forcingNodes = 0;
    const oppForcing = forcingSearch(opp, opp, 2, 12);
    if (oppForcing >= WIN) {
      return { player: opp, mateIn: 3, type: 'forcing',
               detail: 'Opponent has forced win via threat sequence' };
    }

    // ── Check four-threat forks (mate-in-3 heuristic) ──
    const cpFours = countFourThreats(cp);
    const oppFours = countFourThreats(opp);

    if (cpFours.length >= 4) {
      return { player: cp, mateIn: 3, threats: cpFours, type: 'fork' };
    }
    if (oppFours.length >= 4) {
      return { player: opp, mateIn: 3, threats: oppFours, type: 'fork' };
    }

    // ── Report high threat cost (not yet forced, but dangerous) ──
    if (cpTC.cost === 2) {
      return { player: cp, mateIn: 4, type: 'high_threat',
               detail: `Threat cost 2 — one more threat and it's over` };
    }
    if (oppTC.cost === 2) {
      return { player: opp, mateIn: 4, type: 'high_threat',
               detail: `Opponent threat cost 2 — dangerous` };
    }

    return null;
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
