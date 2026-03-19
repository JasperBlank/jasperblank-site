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

  // ══════════════════════════════════════════════════════════════
  // ── TUNABLE WEIGHTS (all distillable) ──
  // Every parameter here can be overridden via window._tuneWeights.
  // The distiller searches for optimal values.
  // ══════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════
  // DISTILLED WEIGHTS — v4 (shape patterns + random + hill + coord descent)
  // 80 positions, depth-4 ground truth, 46 params
  // Result: 18.8% → 40.0% agreement (+21.3pp)
  // ══════════════════════════════════════════════════════
  const DEFAULTS = {
    // ── Line-based (offense) — all roughly equal now ──
    five: 20104,
    four: 20165,
    three: 20000,
    two: 8.7,
    openBonus: 2.8,      // big open-end multiplier

    // ── Combination bonuses (offense) ──
    fork: 34721,         // double fours
    fourThree: 147861,   // four+three is THE combo (nearly guaranteed win)
    preFork: 5440,       // two threes
    tripleThreat: 13533, // three+ threes

    // ── Defense (blocking) ──
    block6: 95000,
    block5: 85000,
    block4: 50838,
    block3: 3907,        // block threes much more aggressively
    oppFork: 5313,
    opp43: 7500,
    oppPreFork: 2500,

    // ── SPATIAL: neighbor composition ──
    ownAdj: -392,        // HEAVY anti-cluster penalty
    oppAdj: 409,         // pressure near opponent is great
    emptyAdj: 56.8,

    // ── SPATIAL: distances ──
    minDistOwn: 185,     // prefer bridging distance (flipped from v3!)
    minDistOpp: 300,     // max flanking distance bonus
    minDistAny: 0,
    distOwnCOM: -33.3,   // slight pull toward own center
    distOppCOM: -24.3,   // approach opponent center

    // ── SPATIAL: directional diversity ──
    feasibleDirs: 954,   // HUGE — feasible development directions matter!
    openDirs: 66.4,

    // ── SPATIAL: spread metrics ──
    openSpace: 44.1,
    islandBonus: 2495,   // ISLANDS ARE GREAT (flipped from -500!)
    bridgeBonus: 1531,   // connecting clusters still great
    newQuadrant: -186,   // flipped — concentrating is sometimes better
    spreadBonus: 139,

    // ── SHAPE PATTERNS (distilled v4) ──
    // Per-direction line context:
    pat_inline: 1243,    // filling gap in own line
    pat_lineExtend: 1651,// extending existing line (top pattern!)
    pat_gapBridge: 1091, // bridging a gap
    pat_adjOppLine: -500,// placing next to opp line (BAD — gets blocked)
    pat_openReach: 426,  // open extension space
    pat_ownThenOpp: 998, // contested extension
    pat_skipAttack: 482, // leaping over opponent
    pat_longReach: 72.8, // long-range connection (minor)

    // Cross-direction:
    pat_vShape: 700,     // fork foundation
    pat_oppV: 1685,      // blocking opp fork foundation (BIG!)
    pat_trident: -1000,  // own in all 3 dirs is BAD (too spread thin)
    pat_clamp: 2275,     // #1 PATTERN: clamping opponent from 2 sides!

    // Diagonal/knight neighbors:
    pat_diagOwn: 47.6,   // minor
    pat_diagOpp: 751,    // opp at diagonal = worth blocking
    pat_knightOwn: 960,  // knight-move connections are great!
    pat_knightOpp: -250, // opp at knight = less concerning

    // Aggregate:
    pat_ownAdj1: 8.7,    // minor
    pat_oppAdj1: 7.8,    // minor
    pat_isolated: 847,   // isolated moves can be strategic!
    pat_surrounded: -2000,// tight space is TERRIBLE
  };

  function w(name) {
    const tw = window._tuneWeights;
    if (tw && tw[name] !== undefined) return tw[name];
    return DEFAULTS[name];
  }

  // ── Accumulative scoring with spatial features ──
  function scoreMove(q, r, player) {
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
