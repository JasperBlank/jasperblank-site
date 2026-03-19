// ── Hex Tic Tac Toe — Bot AI (Optimized) ──
// Include this file to enable bot play. Remove it for human-vs-human tournament mode.

(function() {
  'use strict';

  // Signal to the frontend that the bot is loaded
  window.HEX_BOT_LOADED = true;

  // Depth tracking for hard mode display
  window.botSearchDepth = 0;

  // Flat direction arrays for tight loops
  const ALL_DQ = [1, -1, 0, 0, -1, 1];
  const ALL_DR = [0, 0, 1, -1, 1, -1];
  const DIR3_DQ = [1, 0, -1];
  const DIR3_DR = [0, 1, 1];

  // Numeric key for fast Set dedup (no string alloc)
  function nkey(q, r) { return (q + 10000) + (r + 10000) * 20001; }

  // Combined line length + feasibility in one pass
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

  // Simulate place + undo with comCache maintenance
  function simPlace(q, r, player, fn) {
    const board = window.board;
    const comCache = window.comCache;
    const k = q + ',' + r;
    board[k] = player;
    comCache[player].sq += q; comCache[player].sr += r; comCache[player].n++;
    const result = fn();
    delete board[k];
    comCache[player].sq -= q; comCache[player].sr -= r; comCache[player].n--;
    return result;
  }

  // Get candidates using pieceList + numeric dedup
  function getCandidates() {
    const board = window.board;
    const pieceList = window.pieceList;
    const seen = new Set();
    const result = [];
    for (let pi = 0; pi < pieceList.length; pi++) {
      const bq = pieceList[pi].q, br = pieceList[pi].r;
      for (let d = 0; d < 6; d++) {
        const dq = ALL_DQ[d], dr = ALL_DR[d];
        for (let dist = 1; dist <= 2; dist++) {
          const nq = bq + dq * dist, nr = br + dr * dist;
          const nk = nkey(nq, nr);
          if (seen.has(nk)) continue;
          seen.add(nk);
          if (!board[nq + ',' + nr]) result.push({ q: nq, r: nr });
        }
      }
    }
    // Also check sim-placed pieces (in board but not pieceList)
    const bkeys = Object.keys(board);
    for (let i = 0; i < bkeys.length; i++) {
      const k = bkeys[i];
      if (!board[k]) continue;
      const ci = k.indexOf(',');
      const bq = +k.substring(0, ci), br = +k.substring(ci + 1);
      for (let d = 0; d < 6; d++) {
        const dq = ALL_DQ[d], dr = ALL_DR[d];
        for (let dist = 1; dist <= 2; dist++) {
          const nq = bq + dq * dist, nr = br + dr * dist;
          const nk = nkey(nq, nr);
          if (seen.has(nk)) continue;
          seen.add(nk);
          if (!board[nq + ',' + nr]) result.push({ q: nq, r: nr });
        }
      }
    }
    // Always include threat completion cells (flagged 3s and 4s)
    const threatCells = getThreatCells();
    for (const c of threatCells) {
      const nk = nkey(c.q, c.r);
      if (!seen.has(nk) && !board[c.q + ',' + c.r]) { seen.add(nk); result.push(c); }
    }
    if (result.length === 0) result.push({ q: 0, r: 0 });
    return result;
  }

  // Scoped candidates near specific cells
  function getCandidatesNear(extraCells) {
    const board = window.board;
    const pieceList = window.pieceList;
    const seen = new Set();
    const result = [];
    for (let ei = 0; ei < extraCells.length; ei++) {
      const eq = extraCells[ei].q, er = extraCells[ei].r;
      for (let d = 0; d < 6; d++) {
        const dq = ALL_DQ[d], dr = ALL_DR[d];
        for (let dist = 1; dist <= 3; dist++) {
          const nq = eq + dq * dist, nr = er + dr * dist;
          const nk = nkey(nq, nr);
          if (seen.has(nk)) continue;
          seen.add(nk);
          if (!board[nq + ',' + nr]) result.push({ q: nq, r: nr });
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
          if (!board[nq + ',' + nr]) result.push({ q: nq, r: nr });
        }
      }
    }
    if (result.length === 0) result.push({ q: 0, r: 0 });
    return result;
  }

  // Playstyle multipliers: [offense, defense]
  const PLAYSTYLE_MULT = {
    aggressive:  [1.4, 0.6],
    balanced:    [1.0, 1.0],
    defensive:   [0.6, 1.4],
  };

  // ── Fork-focused scoring ──
  // Philosophy: single long lines are easy to block. FORKS win games.
  // A fork = 2+ lines of 4 that opponent can't block in one turn.
  // So we value: moves that develop MULTIPLE directions > single long lines.
  //
  // Offense tiers:
  //   Win (6+)           → 100000
  //   Fork (2× four)     → 100000  (unblockable → guaranteed win)
  //   Four + three       → 40000   (one move from fork)
  //   Two+ threes        → 20000   (pre-fork: two directions developing)
  //   Single five        → 15000   (strong but blockable)
  //   Single four        → 4000    (decent but NOT game-winning alone)
  //   Three + two        → 2000    (multi-direction development)
  //   Single three       → 600     (building block)
  //   Multi-dir twos     → 200     (early fork seeds)
  //   Single two         → 40      (early development)
  //
  // Defense tiers:
  //   Block 6+           → 95000
  //   Block 5            → 85000
  //   Block 4            → 85000
  //   Block opp fork     → 50000   (opponent has 2+ threes through this cell)
  //   Block opp 3        → 300

  function scoreMove(q, r, player) {
    const board = window.board;
    const opponent = player === 'X' ? 'O' : 'X';
    const style = window.botPlaystyle || 'balanced';
    const [offMul, defMul] = PLAYSTYLE_MULT[style] || PLAYSTYLE_MULT.balanced;

    let offScore = 0, defScore = 0;
    let myFives = 0, myFours = 0, myThrees = 0, myTwos = 0;
    let oppFours = 0, oppThrees = 0;

    for (let di = 0; di < 3; di++) {
      const dq = DIR3_DQ[di], dr = DIR3_DR[di];

      // Own lines
      const my = lineLenFeasible(q, r, dq, dr, player);
      const myLen = my & 0xFF;
      if (myLen >= 6) return 100000;  // instant win — no multiplier needed
      if (my & 0x100) {
        if (myLen === 5)      myFives++;
        else if (myLen === 4) myFours++;
        else if (myLen === 3) myThrees++;
        else if (myLen === 2) myTwos++;
      }

      // Opponent lines (blocking)
      const opp = lineLenFeasible(q, r, dq, dr, opponent);
      const oppLen = opp & 0xFF;
      if (opp & 0x100) {
        if (oppLen >= 6)      defScore += 95000;
        else if (oppLen === 5) defScore += 85000;
        else if (oppLen === 4) { defScore += 85000; oppFours++; }
        else if (oppLen === 3) { defScore += 300; oppThrees++; }
      }
    }

    // ── Offense: reward COMBINATIONS over single lines ──
    if (myFours >= 2)                          offScore += 100000;  // fork = win
    else if (myFours >= 1 && myThrees >= 1)    offScore += 40000;   // one move from fork
    else if (myThrees >= 2)                    offScore += 20000;   // pre-fork: two growing lines
    else if (myFives >= 1)                     offScore += 15000;   // five is strong but blockable
    else if (myFours >= 1)                     offScore += 4000;    // single four — decent, not decisive
    else if (myThrees >= 1 && myTwos >= 1)     offScore += 2000;    // multi-dir development
    else if (myThrees >= 1)                    offScore += 600;     // single three
    else if (myTwos >= 2)                      offScore += 200;     // early fork seeds: two directions
    else if (myTwos >= 1)                      offScore += 40;      // early development

    // ── Defense: also detect opponent fork setups ──
    if (oppFours >= 2)                         defScore += 50000;   // opponent forking through here
    else if (oppFours >= 1 && oppThrees >= 1)  defScore += 15000;   // opponent approaching fork
    else if (oppThrees >= 2)                   defScore += 5000;    // opponent pre-fork

    let score = offScore * offMul + defScore * defMul;

    // Tiny tiebreaker: slight preference for central play (no hard clustering)
    score += Math.random() * 3;
    return score;
  }

  // Check instant win
  function isWinMove(q, r, player) {
    const board = window.board;
    for (let di = 0; di < 3; di++) {
      const dq = DIR3_DQ[di], dr = DIR3_DR[di];
      let fwd = 0;
      for (let i = 1; i <= 5; i++) { if (board[(q+dq*i)+','+(r+dr*i)] === player) fwd++; else break; }
      let bwd = 0;
      for (let i = 1; i <= 5; i++) { if (board[(q-dq*i)+','+(r-dr*i)] === player) bwd++; else break; }
      if (1 + fwd + bwd >= 6) return true;
    }
    return false;
  }

  // ── Pre-search win scan ──
  // Checks ALL empty candidates for instant wins (1-move or 2-move).
  // Returns winning move(s) immediately if found. This is cheap and
  // guarantees the bot NEVER misses a win regardless of scoring or pruning.
  function findWinningMoves(player, hasTwo) {
    const board = window.board;
    const candidates = getCandidates();

    // Pass 1: any single move that wins?
    for (const c of candidates) {
      if (board[c.q + ',' + c.r]) continue;
      if (isWinMove(c.q, c.r, player)) {
        return hasTwo ? [c, c] : [c]; // just need one move
      }
    }

    if (!hasTwo) return null;

    // Pass 2: any m1 that sets up a winning m2?
    for (const m1 of candidates) {
      if (board[m1.q + ',' + m1.r]) continue;
      const win = simPlace(m1.q, m1.r, player, () => {
        // Check neighbors of m1 + all cells adjacent to existing pieces
        for (const m2 of candidates) {
          if (board[m2.q + ',' + m2.r]) continue;
          if (isWinMove(m2.q, m2.r, player)) return m2;
        }
        // Also check cells right next to m1
        for (let d = 0; d < 6; d++) {
          const nq = m1.q + ALL_DQ[d], nr = m1.r + ALL_DR[d];
          if (board[nq + ',' + nr]) continue;
          if (isWinMove(nq, nr, player)) return { q: nq, r: nr };
        }
        return null;
      });
      if (win) return [m1, win];
    }

    return null; // no win found
  }

  // Fork-aware board evaluation
  // Counts feasible lines per player, then rewards COMBINATIONS (fork potential)
  function evalBoard(player) {
    const board = window.board;
    const pieceList = window.pieceList;
    const checked = new Set();
    // Count feasible lines by player and length
    const lines = { X: { 5: 0, 4: 0, 3: 0, 2: 0 }, O: { 5: 0, 4: 0, 3: 0, 2: 0 } };

    // Scan all sources: pieceList + sim-placed pieces
    function scanPiece(pq, pr, p) {
      for (let di = 0; di < 3; di++) {
        const dq = DIR3_DQ[di], dr = DIR3_DR[di];
        let sq = pq, sr = pr;
        while (board[(sq-dq)+','+(sr-dr)] === p) { sq -= dq; sr -= dr; }
        const rk = nkey(sq, sr) * 4 + di;
        if (checked.has(rk)) continue;
        checked.add(rk);
        let len = 0, cq = sq, cr = sr;
        while (board[cq+','+cr] === p) { len++; cq += dq; cr += dr; }
        if (len < 2 || len > 5) continue;
        if (!window.hasSpaceForSix(sq, sr, dq, dr, len, p)) continue;
        lines[p][len]++;
      }
    }

    for (let pi = 0; pi < pieceList.length; pi++) {
      scanPiece(pieceList[pi].q, pieceList[pi].r, pieceList[pi].player);
    }
    const bkeys = Object.keys(board);
    for (let i = 0; i < bkeys.length; i++) {
      const k = bkeys[i];
      if (!board[k]) continue;
      const ci = k.indexOf(',');
      scanPiece(+k.substring(0, ci), +k.substring(ci + 1), board[k]);
    }

    function evalSide(s) {
      let v = 0;
      // Base line values
      v += s[5] * 8000;
      v += s[4] * 2000;
      v += s[3] * 200;
      v += s[2] * 20;
      // Fork bonuses: multiple strong lines compound massively
      if (s[4] >= 2)                    v += 50000;  // fork — nearly unblockable
      if (s[4] >= 1 && s[3] >= 1)       v += 15000;  // one move from fork
      if (s[3] >= 2)                    v += 8000;   // pre-fork setup
      if (s[3] >= 3)                    v += 20000;  // triple threat
      return v;
    }

    return evalSide(lines[player]) - evalSide(lines[player === 'X' ? 'O' : 'X']);
  }

  // ── Difficulty implementations ──

  // Get all threat completion cells (blocks & extensions for 3+ in a row)
  function getThreatCells() {
    if (!window.findThreats) return [];
    const threats = window.findThreats();
    const cells = [];
    const seen = new Set();
    for (const t of threats) {
      for (const c of t.completions) {
        const k = c.q + ',' + c.r;
        if (!seen.has(k)) { seen.add(k); cells.push(c); }
      }
    }
    return cells;
  }

  // Inject threat completions + global top candidates into a local candidate list
  function mergeCandidates(local, globalTop, board) {
    const seen = new Set();
    for (const c of local) seen.add(c.q + ',' + c.r);
    // Always include threat completion cells (blocks & extensions for flagged lines)
    const threatCells = getThreatCells();
    for (const c of threatCells) {
      const k = c.q + ',' + c.r;
      if (!seen.has(k) && !board[k]) { local.push({ q: c.q, r: c.r }); seen.add(k); }
    }
    // Also include global top-scored candidates
    for (const c of globalTop) {
      const k = c.q + ',' + c.r;
      if (!seen.has(k) && !board[k]) { local.push({ q: c.q, r: c.r }); seen.add(k); }
    }
    return local;
  }

  function botPickMovesGreedy(activePlayer) {
    const board = window.board;
    const hasTwo = window.movesLeft >= 2;
    // Always check for winning moves first
    const winMoves = findWinningMoves(activePlayer, hasTwo);
    if (winMoves) return winMoves;
    const candidates = getCandidates();
    let bestScore = -Infinity, bestMove = candidates[0];
    for (const c of candidates) {
      const s = scoreMove(c.q, c.r, activePlayer);
      if (s > bestScore) { bestScore = s; bestMove = c; }
    }
    if (!hasTwo) return [bestMove];
    return simPlace(bestMove.q, bestMove.r, activePlayer, () => {
      // Use full candidates for 2nd move so we don't miss distant blocks
      const cands2 = getCandidates();
      let best2Score = -Infinity, best2 = cands2[0];
      for (const c of cands2) {
        if (board[c.q+','+c.r]) continue;
        const s = scoreMove(c.q, c.r, activePlayer);
        if (s > best2Score) { best2Score = s; best2 = c; }
      }
      return [bestMove, best2];
    });
  }

  function botPickMovesMedium(activePlayer) {
    const board = window.board;
    const player = activePlayer;
    const opponent = player === 'X' ? 'O' : 'X';
    const hasTwo = window.movesLeft >= 2;
    // Always check for winning moves first
    const winMoves = findWinningMoves(player, hasTwo);
    if (winMoves) return winMoves;
    if (!hasTwo) {
      const candidates = getCandidates();
      let bestScore = -Infinity, bestMove = candidates[0];
      for (const c of candidates) {
        const s = scoreMove(c.q, c.r, player);
        if (s > bestScore) { bestScore = s; bestMove = c; }
      }
      return [bestMove];
    }
    const candidates = getCandidates();
    const scored = [];
    for (const c of candidates) scored.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, player) });
    scored.sort((a, b) => b.s - a.s);
    const topN = scored.length > 12 ? scored.slice(0, 12) : scored;
    let bestScore = -Infinity, bestPair = [topN[0], topN[1] || topN[0]];
    for (let i1 = 0; i1 < topN.length; i1++) {
      if (bestScore >= 200000) break;
      const m1 = topN[i1];
      // m1.s was scored BEFORE placement — captures blocking value correctly
      simPlace(m1.q, m1.r, player, () => {
        if (isWinMove(m1.q, m1.r, player)) { bestScore = 200000; bestPair = [m1]; return; }
        // Merge nearby + global top candidates so distant critical blocks aren't missed
        const cands2 = mergeCandidates(getCandidatesNear([m1]), topN, board);
        const scored2 = [];
        for (const c of cands2) { if (!board[c.q+','+c.r]) scored2.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, player) }); }
        scored2.sort((a, b) => b.s - a.s);
        const top2 = scored2.length > 10 ? scored2.slice(0, 10) : scored2;
        for (const m2 of top2) {
          const ps = simPlace(m2.q, m2.r, player, () => {
            if (isWinMove(m2.q, m2.r, player)) return 200000;
            return m1.s + m2.s + evalBoard(player) * 0.3;
          });
          if (ps > bestScore) { bestScore = ps; bestPair = [m1, m2]; }
        }
      });
    }
    return bestPair;
  }

  // ── Recursive hard bot with alpha-beta pruning ──
  //
  // Flattened: each single move is its own alpha-beta ply.
  // A turn (2 moves) = 2 consecutive plies for the same player.
  //
  // Optimizations:
  // - Tight widths: 6→5→4→3 candidates per ply
  // - Cheap move ordering at deep plies (adjacency count, not full scoreMove)
  // - No array allocations in hot path (reuse placed via stack)
  // - Aggressive alpha-beta cutoffs at every decision point

  let _nodesSearched = 0;
  let _pruned = 0;
  const WIN = 200000, LOSS = -200000;

  // Cheap heuristic for move ordering at deep plies: count adjacent friendly pieces
  // + count adjacent enemy pieces (blocking value). ~10x faster than scoreMove.
  function quickScore(q, r, player) {
    const board = window.board;
    const opp = player === 'X' ? 'O' : 'X';
    let s = 0;
    for (let d = 0; d < 6; d++) {
      const nq = q + ALL_DQ[d], nr = r + ALL_DR[d];
      const v = board[nq + ',' + nr];
      if (v === player) s += 10;
      else if (v === opp) s += 6;  // blocking adjacency
    }
    // Check 2-step neighbors too (line building)
    for (let di = 0; di < 3; di++) {
      const dq = DIR3_DQ[di], dr = DIR3_DR[di];
      if (board[(q+dq) + ',' + (r+dr)] === player && board[(q+dq*2) + ',' + (r+dr*2)] === player) s += 50;
      if (board[(q-dq) + ',' + (r-dr)] === player && board[(q+dq) + ',' + (r+dr)] === player) s += 50;
      if (board[(q+dq) + ',' + (r+dr)] === opp && board[(q+dq*2) + ',' + (r+dr*2)] === opp) s += 30;
      if (board[(q-dq) + ',' + (r-dr)] === opp && board[(q+dq) + ',' + (r+dr)] === opp) s += 30;
    }
    return s + Math.random() * 2;
  }

  // Generate candidates near recent moves only (fast for deep plies)
  function getQuickCandidates(placed, width) {
    const board = window.board;
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
          if (!board[nq + ',' + nr]) result.push({ q: nq, r: nr });
        }
      }
    }
    // Also include threat cells (critical blocks)
    const tc = getThreatCells();
    for (let i = 0; i < tc.length; i++) {
      const c = tc[i];
      const nk = nkey(c.q, c.r);
      if (!seen.has(nk) && !board[c.q + ',' + c.r]) { seen.add(nk); result.push(c); }
    }
    return result;
  }

  // The search stack for 'placed' — avoids array allocations
  const _placedStack = [];
  let _placedLen = 0;

  function abSearch(turnPlayer, rootPlayer, depthRemaining, movesLeftInTurn,
                    currentPly, alpha, beta) {
    const board = window.board;
    const isMax = (turnPlayer === rootPlayer);
    const opp = turnPlayer === 'X' ? 'O' : 'X';

    if (depthRemaining <= 0) return evalBoard(rootPlayer);

    // Width: tight and shrinks with depth
    const width = currentPly <= 2 ? 6 : currentPly <= 4 ? 5 : currentPly <= 6 ? 4 : 3;

    // Generate candidates — use quick method at deep plies
    const useQuick = currentPly >= 3;
    const placed = _placedStack.slice(0, _placedLen);
    let raw;
    if (_placedLen > 0) {
      raw = useQuick ? getQuickCandidates(placed, width) : mergeCandidates(getCandidatesNear(placed), [], board);
    } else {
      raw = getCandidates();
    }

    // Score + sort — use cheap heuristic at deep plies
    const scored = [];
    if (useQuick) {
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (board[c.q + ',' + c.r]) continue;
        scored.push({ q: c.q, r: c.r, s: quickScore(c.q, c.r, turnPlayer) });
      }
    } else {
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (board[c.q + ',' + c.r]) continue;
        scored.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, turnPlayer) });
      }
    }
    scored.sort((a, b) => b.s - a.s);
    const len = Math.min(scored.length, width);
    if (len === 0) return evalBoard(rootPlayer);

    let bestVal = isMax ? -Infinity : Infinity;

    for (let i = 0; i < len; i++) {
      const m = scored[i];
      _nodesSearched++;

      // Push to placed stack
      _placedStack[_placedLen] = m;
      _placedLen++;

      const v = simPlace(m.q, m.r, turnPlayer, () => {
        if (isWinMove(m.q, m.r, turnPlayer)) return isMax ? WIN : LOSS;

        const newMovesLeft = movesLeftInTurn - 1;
        if (newMovesLeft > 0) {
          // Same player's 2nd move
          return abSearch(turnPlayer, rootPlayer, depthRemaining, newMovesLeft,
                          currentPly + 1, alpha, beta);
        } else if (depthRemaining <= 1) {
          return evalBoard(rootPlayer);
        } else {
          // Opponent's turn
          return abSearch(opp, rootPlayer, depthRemaining - 1, 2,
                          currentPly + 1, alpha, beta);
        }
      });

      // Pop from placed stack
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
    const board = window.board;
    const player = activePlayer;
    const opponent = player === 'X' ? 'O' : 'X';
    const hasTwo = window.movesLeft >= 2;
    // Always check for winning moves first — instant, no search needed
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

    // Root candidates — use full scoreMove for best ordering
    const candidates = getCandidates();
    const scored = [];
    for (const c of candidates) scored.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, player) });
    scored.sort((a, b) => b.s - a.s);
    const topN = scored.length > 10 ? scored.slice(0, 10) : scored;

    if (!hasTwo) {
      let bestScore = -Infinity, bestMove = topN[0];
      let alpha = -Infinity;
      for (const c of topN) {
        _nodesSearched++;
        _placedStack[0] = c; _placedLen = 1;
        const s = simPlace(c.q, c.r, player, () => {
          if (isWinMove(c.q, c.r, player)) return WIN;
          if (maxDepth <= 1) return c.s + evalBoard(player) * 0.5;
          return abSearch(opponent, player, maxDepth - 1, 2, 2, alpha, Infinity);
        });
        _placedLen = 0;
        if (s > bestScore) { bestScore = s; bestMove = c; }
        if (s > alpha) alpha = s;
      }
      window.botNodesSearched = _nodesSearched;
      window.botPruned = _pruned;
      return [bestMove];
    }

    // Two moves — find best pair with alpha-beta between m2 candidates
    let bestScore = -Infinity, bestPair = [topN[0], topN[1] || topN[0]];
    let alpha = -Infinity;

    for (let i1 = 0; i1 < topN.length; i1++) {
      if (bestScore >= WIN) break;
      const m1 = topN[i1];
      _nodesSearched++;

      simPlace(m1.q, m1.r, player, () => {
        if (isWinMove(m1.q, m1.r, player)) { bestScore = WIN; bestPair = [m1]; return; }

        // m2 candidates: near m1 + global top + threats
        const cands2 = mergeCandidates(getCandidatesNear([m1]), topN, board);
        const scored2 = [];
        for (const c of cands2) {
          if (board[c.q + ',' + c.r]) continue;
          scored2.push({ q: c.q, r: c.r, s: scoreMove(c.q, c.r, player) });
        }
        scored2.sort((a, b) => b.s - a.s);
        const top2 = scored2.length > 6 ? scored2.slice(0, 6) : scored2;

        for (const m2 of top2) {
          _nodesSearched++;
          _placedStack[0] = m1; _placedStack[1] = m2; _placedLen = 2;

          const pairScore = simPlace(m2.q, m2.r, player, () => {
            if (isWinMove(m2.q, m2.r, player)) return WIN;
            if (maxDepth <= 1) return m1.s + m2.s + evalBoard(player) * 0.5;
            return abSearch(opponent, player, maxDepth - 1, 2, 3, alpha, Infinity);
          });
          _placedLen = 0;

          if (pairScore > bestScore) { bestScore = pairScore; bestPair = [m1, m2]; }
          if (pairScore > alpha) alpha = pairScore;
        }
      });
    }
    window.botNodesSearched = _nodesSearched;
    window.botPruned = _pruned;
    return bestPair;
  }

  // Register the bot dispatch function globally
  window.botPickMoves = function(activePlayer) {
    const player = activePlayer || window.botPlayer;
    const diff = window.botDifficulty || 'medium';
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
