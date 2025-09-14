// controllers/activegame.js
const express = require("express");
const router = express.Router();
const { getDb } = require("../dbconnection");
const { ObjectId } = require("mongodb"); // << NEW: for _id handling

const SEEDING_VERSION = "v1.1";

// ---------- tiny deterministic PRNG helpers ----------
function hashString32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFromSeed(seedStr, ns) {
  const s = hashString32(seedStr + "::" + ns);
  return mulberry32(s);
}
const choice = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function weightedChoice(rng, entries) {
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [v, w] of entries) {
    if ((r -= w) <= 0) return v;
  }
  return entries[entries.length - 1][0];
}
function shuffleInPlace(rng, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- grid helpers ----------
const manhattan = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const sameRow = (a, b) => a[1] === b[1];
function ringCells(w, h, cx, cy, d) {
  const cells = [];
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++)
      if (manhattan([x, y], [cx, cy]) === d) cells.push([x, y]);
  return cells;
}
function allCells(w, h) {
  const out = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) out.push([x, y]);
  return out;
}
function placeWithMinSpacing(rng, candidates, existing, minDist) {
  const list = shuffleInPlace(rng, candidates.slice());
  for (const cell of list) {
    if (existing.every(e => manhattan(e, cell) >= minDist)) return cell;
  }
  return null;
}

// ---------- seeding logic (updated rules) ----------
function computeResourceTotals(w, h) {
  // more resources than before
  const total = w * h;
  return {
    trees: Math.max(1, Math.round(0.18 * total)),
    stones: Math.max(1, Math.round(0.14 * total)),
    hay:    Math.max(1, Math.round(0.08 * total)),
  };
}

// blue-noise-ish greedy placer with min separation & forbidden cells
function blueNoisePlace(rng, w, h, count, minSep, forbidden = new Set()) {
  const cells = shuffleInPlace(rng, allCells(w, h));
  const placed = [];
  for (const c of cells) {
    const key = `${c[0]},${c[1]}`;
    if (forbidden.has(key)) continue;
    if (placed.every(p => manhattan(p, c) >= minSep)) {
      placed.push(c);
      if (placed.length >= count) break;
    }
  }
  return placed;
}

// Spawn selection: ensure |ax - px| >= 10 (column difference), avoid same row
function pickSpawnPositions(rngSpawn, w, h, elo) {
  // candidates away from the outer border
  const candidates = [];
  for (let x = 1; x < w - 1; x++) for (let y = 1; y < h - 1; y++) candidates.push([x, y]);

  // centrality score
  candidates.sort((a, b) => {
    const da = Math.min(a[0], w - 1 - a[0]) + Math.min(a[1], h - 1 - a[1]);
    const db = Math.min(b[0], w - 1 - b[0]) + Math.min(b[1], h - 1 - b[1]);
    return db - da; // prefer more central first
  });

  const topPct = elo <= 800 ? 0.1 : 0.3;
  const pickFrom = candidates.slice(0, Math.max(1, Math.floor(candidates.length * topPct)));
  const P = choice(rngSpawn, pickFrom);

  // AI spawn constraint: column separation >= 10 and not same row
  const aiCandidates = candidates.filter(A => Math.abs(A[0] - P[0]) >= 10 && !sameRow(P, A));
  const A = aiCandidates.length ? choice(rngSpawn, aiCandidates) : choice(rngSpawn, candidates);

  const colSeparationOK = Math.abs(A[0] - P[0]) >= 10;
  const initialStraightLOS = false; // we already forced not same row; columns are far apart

  return { player: P, ai: A, colSeparationOK, initialStraightLOS };
}

// ELO → type/class/grade weights (weapon grade T1-only at 1200)
function makeLootTable(elo) {
  // base
  let typeW = [["weapon", 0.7], ["healing", 0.3]];
  let classW = [
    ["straight", 0.28], ["diag", 0.18], ["arc", 0.22], ["lob", 0.22], ["melee", 0.10]
  ];
  let gradeW = [[1, 0.55], [2, 0.35], [3, 0.10]];

  if (elo <= 800) {
    typeW = [["weapon", 0.6], ["healing", 0.4]];
    classW = [["straight", 0.23], ["diag", 0.18], ["arc", 0.22], ["lob", 0.27], ["melee", 0.10]];
    gradeW = [[1, 0.40], [2, 0.45], [3, 0.15]];
  } else if (elo >= 1800) {
    typeW = [["weapon", 0.75], ["healing", 0.25]];
    classW = [["straight", 0.33], ["diag", 0.23], ["arc", 0.19], ["lob", 0.19], ["melee", 0.06]];
    gradeW = [[1, 0.60], [2, 0.30], [3, 0.10]];
  }

  // strict rule: at 1200 → grade 1 only
  if (elo === 1200) {
    gradeW = [[1, 1.0]];
  }

  return { typeW, classW, gradeW };
}

function pickLootKey(rng, elo) {
  const { typeW, classW, gradeW } = makeLootTable(elo);
  const t = weightedChoice(rng, typeW);
  if (t === "healing") {
    const heals = [["heal.small", 1], ["heal.medium", 1], ["heal.large", 1], ["heal.major", 0.6]];
    return weightedChoice(rng, heals);
  } else {
    const cls = weightedChoice(rng, classW);
    const g = weightedChoice(rng, gradeW);
    // melee counts as weapon but is adjacent; okay for variety
    return `weapon.${cls}.t${g}`;
  }
}

// place loot with weapon cap (max 2)
function placeLoot(rngLoot, w, h, P, A, elo, totalLoot, maxWeapons) {
  const loot = [];
  const used = new Set();
  const usedList = [];
  const occupy = (c) => { used.add(`${c[0]},${c[1]}`); usedList.push(c); };

  const targetMode = elo <= 800 ? "player" : (elo >= 1800 ? "ai" : "neutral");
  function pickNear(target, dMin, dMax) {
    for (let d = dMin; d <= dMax; d++) {
      const ring = ringCells(w, h, target[0], target[1], d)
        .filter(([x, y]) => !used.has(`${x},${y}`));
      shuffleInPlace(rngLoot, ring);
      const picked = placeWithMinSpacing(rngLoot, ring, usedList, 2);
      if (picked) return picked;
    }
    const any = allCells(w, h).filter(([x, y]) => !used.has(`${x},${y}`));
    return placeWithMinSpacing(rngLoot, any, usedList, 2);
  }

  // ensure at least one heal overall
  let ensuredHeal = false;
  let weaponCount = 0;

  for (let i = 0; i < totalLoot; i++) {
    let pos;
    if (targetMode === "player") pos = pickNear(P, 2, 4);
    else if (targetMode === "ai") pos = pickNear(A, 2, 4);
    else {
      const mid = [Math.floor(w / 2), Math.floor(h / 2)];
      pos = pickNear(mid, 4, 6);
    }
    if (!pos) break;

    let key = pickLootKey(rngLoot, elo);
    // enforce weapon cap
    if (key.startsWith("weapon.")) {
      if (weaponCount >= maxWeapons) {
        // switch to a heal if we've hit the cap
        key = "heal.small";
      } else {
        weaponCount++;
      }
    } else {
      ensuredHeal = true;
    }

    loot.push({ pos, key });
    occupy(pos);
  }

  // pity: ensure at least one heal exists
  if (!ensuredHeal) {
    // try to add one more heal somewhere with spacing
    const any = allCells(w, h).filter(([x, y]) => !used.has(`${x},${y}`));
    const pos = placeWithMinSpacing(rngLoot, any, usedList, 2);
    if (pos) loot.push({ pos, key: "heal.small" });
  }

  return loot;
}

function seedResources(rngRes, w, h, P, A) {
  const totals = computeResourceTotals(w, h);
  const forbidden = new Set();
  const mark = (c) => forbidden.add(`${c[0]},${c[1]}`);

  // avoid overlap on spawn tiles
  mark(P); mark(A);

  const trees  = blueNoisePlace(rngRes, w, h, totals.trees, 1, forbidden);
  trees.forEach(mark);
  const stones = blueNoisePlace(rngRes, w, h, totals.stones, 2, forbidden);
  stones.forEach(mark);
  const hay    = blueNoisePlace(rngRes, w, h, totals.hay,   1, forbidden);
  hay.forEach(mark);

  return { trees, stones, hay };
}

// ---------- /seed endpoint ----------
router.post("/seed", async (req, res, next) => {
  try {
    const {
      seed: providedSeed,
      elo: providedElo,
      width,
      height
    } = req.body || {};

    const w = Number.isInteger(width) ? Math.max(5, width) : 16;  // default 16x16
    const h = Number.isInteger(height) ? Math.max(5, height) : 16;
    const elo = typeof providedElo === "number" ? providedElo : 1200;

    const baseSeed = providedSeed || (`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    const seedKey = `S:${baseSeed}|W:${w}|H:${h}|V:${SEEDING_VERSION}`;

    const R_res   = rngFromSeed(seedKey, "resources");
    const R_loot  = rngFromSeed(seedKey, "loot");
    const R_spawn = rngFromSeed(seedKey, "spawn");

    const { player: P, ai: A, colSeparationOK, initialStraightLOS } = pickSpawnPositions(R_spawn, w, h, elo);

    const resources = seedResources(R_res, w, h, P, A);

    // loot rules: max 2 weapons total; overall loot slots small
    const TOTAL_LOOT = 4;     // e.g., 2 heals + up to 2 weapons
    const MAX_WEAPONS = 2;

    const loot = placeLoot(R_loot, w, h, P, A, elo, TOTAL_LOOT, MAX_WEAPONS);

    const payload = {
      seedingVersion: SEEDING_VERSION,
      seed: baseSeed,
      seedKey,
      gridSize: { w, h },
      elo,
      spawn: { player: P, ai: A },
      constraints: {
        minColumnSeparation: 10,
        columnSeparationOK: colSeparationOK,
        initialStraightLOS
      },
      resources: {
        trees: resources.trees,
        stones: resources.stones,
        hay: resources.hay
      },
      loot
    };

    res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

// ------------------- helpers to build initial game snapshot -------------------
function buildInitialEntities(seedPayload, userId, handle) {
  const { spawn } = seedPayload;

  // Base inventories; tweak starting resources if you like
  const baseInv = { wood: 0, stone: 0, food: 0 };

  return {
    player: {
      userId, handle,
      pos: spawn.player,           // [x,y]
      hp: 100,
      inventory: { ...baseInv },
      weapons: [],                 // empty; can pick up loot or craft
      effects: {},                 // e.g., { extraAction: 0, move2: false, rangeBonus: 0 }
      lastAction: null
    },
    ai: {
      userId: null,
      handle: "AI",
      pos: spawn.ai,
      hp: 100,
      inventory: { ...baseInv },
      weapons: [],
      effects: {},
      lastAction: null
    },
    walls: []                      // array of { pos:[x,y], hp:number }
  };
}

function makeActiveGameDoc(seedPayload, userId, handle) {
  const now = new Date();

  const doc = {
    // seed & map
    seedingVersion: seedPayload.seedingVersion,
    seed: seedPayload.seed,
    seedKey: seedPayload.seedKey,
    gridSize: seedPayload.gridSize,
    elo: seedPayload.elo,

    // world placement
    spawn: seedPayload.spawn,
    resources: seedPayload.resources,  // { trees: [[x,y],...], stones: [...], hay: [...] }
    loot: seedPayload.loot,            // [{ pos:[x,y], key }]
    constraints: seedPayload.constraints,

    // entities (live/mutable)
    entities: null, // filled below

    // turn loop bookkeeping
    players: [
      { slot: "A", role: "player", userId, handle },
      { slot: "B", role: "ai",     userId: null, handle: "AI" }
    ],
    turnIndex: 0,
    currentActor: "player",            // player starts; change if you prefer
    status: "active",                  // active | ended

    // guards & meta
    version: 1,
    createdAt: now,
    updatedAt: now
  };

  doc.entities = buildInitialEntities(seedPayload, userId, handle);
  return doc;
}

// ------------------- POST /initiate_game -------------------
/**
 * POST /initiate_game
 * Body:
 *  {
 *    seed?: string,
 *    elo?: number,
 *    width?: number, height?: number,
 *    firstActor?: "player"|"ai"
 *  }
 * Auth: expects req.userId / req.handle from your JWT middleware
 */
router.post("/initiate_game", async (req, res, next) => {
  try {
    // 1) seed
    const { seed, elo, width, height, firstActor } = req.body || {};
    const w = Number.isInteger(width) ? Math.max(5, width) : 16;
    const h = Number.isInteger(height) ? Math.max(5, height) : 16;
    const ELO = typeof elo === "number" ? elo : 1200;

    const baseSeed = seed || (`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    const seedKey = `S:${baseSeed}|W:${w}|H:${h}|V:${SEEDING_VERSION}`;

    const R_res   = rngFromSeed(seedKey, "resources");
    const R_loot  = rngFromSeed(seedKey, "loot");
    const R_spawn = rngFromSeed(seedKey, "spawn");

    const { player: P, ai: A, colSeparationOK, initialStraightLOS } = pickSpawnPositions(R_spawn, w, h, ELO);
    const resources = seedResources(R_res, w, h, P, A);

    const TOTAL_LOOT = 4;
    const MAX_WEAPONS = 2;
    const loot = placeLoot(R_loot, w, h, P, A, ELO, TOTAL_LOOT, MAX_WEAPONS);

    const seedPayload = {
      seedingVersion: SEEDING_VERSION,
      seed: baseSeed,
      seedKey,
      gridSize: { w, h },
      elo: ELO,
      spawn: { player: P, ai: A },
      constraints: {
        minColumnSeparation: 10,
        columnSeparationOK: colSeparationOK,
        initialStraightLOS
      },
      resources: { trees: resources.trees, stones: resources.stones, hay: resources.hay },
      loot
    };

    // 2) build snapshot
    const userId = req.userId || null;
    const handle = req.handle || "player";
    const activeDoc = makeActiveGameDoc(seedPayload, userId, handle);
    if (firstActor === "ai") activeDoc.currentActor = "ai";

    // 3) persist
    const db = await getDb();
    const col = db.collection("active_game");
    const result = await col.insertOne(activeDoc);

    // 4) return
    res.status(201).json({
      matchId: result.insertedId,
      snapshot: { ...activeDoc, _id: result.insertedId }
    });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------------------------------------------------
   NEW: POST /end_game
   Archives an active match into `historical_game` and deletes the active doc.

   Request body:
   {
     matchId: "<active_game _id>",              // required
     reason?: "player_win"|"ai_win"|"resign"|"timeout"|"admin"|"draw",
     winner?: { side: "player"|"ai", userId?: string, handle?: string }
   }

   Behavior:
   - Loads the active match.
   - If not already ended, stamps status=ended and sets winner/reason.
   - Builds a compact historical summary (turns, duration, remaining loot/resources).
   - Inserts into `historical_game`.
   - Deletes from `active_game`.
   - Uses a transaction when available; otherwise falls back to 2-step.
--------------------------------------------------------------------------- */
router.post("/end_game", async (req, res, next) => {
  const { matchId, reason, winner } = req.body || {};
  if (!matchId) return res.status(400).json({ message: "matchId is required" });

  const db = await getDb();
  const activeCol = db.collection("active_game");
  const histCol = db.collection("historical_game");

  // helper: build the historical record from the active snapshot
  function buildHistoricalFromActive(active, endedReason, overrideWinner) {
    const now = new Date();
    const createdAt = active.createdAt ? new Date(active.createdAt) : now;
    const durationMs = Math.max(0, now - createdAt);

    // winner determination: prefer override, else active.winner if exists
    let histWinner = overrideWinner || active.winner || null;
    if (!histWinner && endedReason === "player_win") {
      histWinner = { side: "player", userId: active.players?.[0]?.userId || null, handle: active.players?.[0]?.handle || "player", isAI: false };
    } else if (!histWinner && endedReason === "ai_win") {
      histWinner = { side: "ai", userId: null, handle: "AI", isAI: true };
    }

    // counts to keep historical doc small
    const resCounts = {
      trees: active.resources?.trees?.length || 0,
      stones: active.resources?.stones?.length || 0,
      hay: active.resources?.hay?.length || 0
    };
    const lootCounts = {
      total: active.loot?.length || 0,
      heals: (active.loot || []).filter(l => l.key.startsWith("heal.")).length,
      weapons: (active.loot || []).filter(l => l.key.startsWith("weapon.")).length
    };

    return {
      // link back to the active match id for traceability
      activeId: active._id,
      matchKey: String(active._id), // convenient as a stable key

      // immutable seed + map config
      seedingVersion: active.seedingVersion,
      seed: active.seed,
      seedKey: active.seedKey,
      gridSize: active.gridSize,
      elo: active.elo,
      constraints: active.constraints,
      spawn: active.spawn,

      // participants
      players: active.players,

      // final state snapshot (minimal but useful)
      final: {
        entities: {
          player: {
            pos: active.entities?.player?.pos,
            hp: active.entities?.player?.hp,
            inventory: active.entities?.player?.inventory,
            weapons: active.entities?.player?.weapons
          },
          ai: {
            pos: active.entities?.ai?.pos,
            hp: active.entities?.ai?.hp,
            inventory: active.entities?.ai?.inventory,
            weapons: active.entities?.ai?.weapons
          },
          walls: active.entities?.walls || []
        },
        resourcesRemaining: resCounts,
        lootRemaining: lootCounts
      },

      // summary & result
      summary: {
        turns: active.turnIndex || 0,
        winner: histWinner,        // { side, userId?, handle?, isAI? } | null
        reason: endedReason || active.reason || null,
        createdAt: active.createdAt || null,
        endedAt: now,
        durationMs
      },

      // meta
      createdAt: active.createdAt || now,
      endedAt: now,
      version: 1
    };
  }

  // load the active document first
  const active = await activeCol.findOne({ _id: new ObjectId(matchId) });
  if (!active) return res.status(404).json({ message: "active match not found" });

  // sanitize & lock in end state locally
  const endReason = reason || (active.status === "ended" ? (active.reason || "end_game") : "end_game");
  const histDoc = buildHistoricalFromActive(active, endReason, winner);

  // Update active doc to 'ended' (local copy for archive; we also try to persist before archive)
  active.status = "ended";
  active.reason = endReason;
  if (winner) active.winner = winner;

  // Try a transaction first (requires replica set)
  const session = db.client?.startSession ? db.client.startSession() : null;

  try {
    if (session) await session.withTransaction(async () => {
      // 1) insert historical
      await histCol.insertOne(histDoc, { session });

      // 2) delete active
      await activeCol.deleteOne({ _id: active._id }, { session });
    }, {
      readConcern: { level: "local" },
      writeConcern: { w: "majority" }
    });
    if (session) await session.endSession();

    return res.status(200).json({
      message: "match archived",
      historicalId: histDoc._id,
      summary: histDoc.summary
    });
  } catch (txErr) {
    if (session) {
      try { await session.endSession(); } catch (_) {}
    }
    // Fallback (non-transactional): best-effort insert then delete
    try {
      const ins = await histCol.insertOne(histDoc);
      await activeCol.deleteOne({ _id: active._id });
      return res.status(200).json({
        message: "match archived (no transaction)",
        historicalId: ins.insertedId,
        summary: histDoc.summary
      });
    } catch (fallbackErr) {
      // If fallback also fails, stop and report
      return res.status(500).json({ message: "failed to archive match", detail: String(fallbackErr) });
    }
  }
});

/**
 * POST /matches/:id/resign
 * Body (optional):
 *   { side?: "player" | "ai" }   // default: "player" (the human resigns)
 *
 * Auth:
 *   - If side === "player", require req.userId to be in match.players.
 *   - If side === "ai", allow (used for debug/admin).
 *
 * Behavior:
 *   - If match is already ended: 200 no-op with summary.
 *   - Else: winner = opposite of `side`, reason = "resign".
 *   - Archive to `historical_game`, delete from `active_game`.
 */
router.post("/matches/:id/resign", async (req, res) => {
  const db = await getDb();
  const activeCol = db.collection("active_game");
  const histCol = db.collection("historical_game");

  const matchId = req.params.id;
  const side = (req.body && req.body.side) === "ai" ? "ai" : "player";

  // 1) Load active match
  const active = await activeCol.findOne({ _id: new ObjectId(matchId) });
  if (!active) return res.status(404).json({ message: "active match not found" });

  // 2) Basic auth check (player resign)
  if (side === "player") {
    const me = req.userId || null;
    const isParticipant = !!active.players?.some(p => String(p.userId || "") === String(me || ""));
    if (!isParticipant) return res.status(403).json({ message: "forbidden: not your match" });
  }

  // 3) If already ended, return its archived-style summary
  if (active.status === "ended") {
    return res.status(200).json({
      message: "match already ended",
      summary: active.summary || {
        turns: active.turnIndex || 0,
        winner: active.winner || null,
        reason: active.reason || "ended",
        createdAt: active.createdAt || null,
        endedAt: active.updatedAt || new Date()
      }
    });
  }

  // 4) Winner is the opposite of the side that resigned
  const winner =
    side === "player"
      ? { side: "ai", userId: null, handle: "AI", isAI: true }
      : { side: "player", userId: active.players?.[0]?.userId || null, handle: active.players?.[0]?.handle || "player", isAI: false };

  const now = new Date();
  const createdAt = active.createdAt ? new Date(active.createdAt) : now;
  const durationMs = Math.max(0, now - createdAt);

  // Compact historical doc (same shape as /end_game)
  const histDoc = {
    activeId: active._id,
    matchKey: String(active._id),
    seedingVersion: active.seedingVersion,
    seed: active.seed,
    seedKey: active.seedKey,
    gridSize: active.gridSize,
    elo: active.elo,
    constraints: active.constraints,
    spawn: active.spawn,
    players: active.players,
    final: {
      entities: {
        player: {
          pos: active.entities?.player?.pos,
          hp: active.entities?.player?.hp,
          inventory: active.entities?.player?.inventory,
          weapons: active.entities?.player?.weapons
        },
        ai: {
          pos: active.entities?.ai?.pos,
          hp: active.entities?.ai?.hp,
          inventory: active.entities?.ai?.inventory,
          weapons: active.entities?.ai?.weapons
        },
        walls: active.entities?.walls || []
      },
      resourcesRemaining: {
        trees: active.resources?.trees?.length || 0,
        stones: active.resources?.stones?.length || 0,
        hay: active.resources?.hay?.length || 0
      },
      lootRemaining: {
        total: active.loot?.length || 0,
        heals: (active.loot || []).filter(l => l.key.startsWith("heal.")).length,
        weapons: (active.loot || []).filter(l => l.key.startsWith("weapon.")).length
      }
    },
    summary: {
      turns: active.turnIndex || 0,
      winner,
      reason: "resign",
      createdAt: active.createdAt || null,
      endedAt: now,
      durationMs
    },
    createdAt: active.createdAt || now,
    endedAt: now,
    version: 1
  };

  // 5) Try transaction; fallback to two-step
  const session = db.client?.startSession ? db.client.startSession() : null;
  try {
    if (session) await session.withTransaction(async () => {
      await histCol.insertOne(histDoc, { session });
      await activeCol.deleteOne({ _id: active._id }, { session });
    }, { readConcern: { level: "local" }, writeConcern: { w: "majority" } });
    if (session) await session.endSession();

    return res.status(200).json({
      message: "match resigned & archived",
      historicalId: histDoc._id,
      summary: histDoc.summary
    });
  } catch (txErr) {
    if (session) { try { await session.endSession(); } catch (_) {} }
    try {
      const ins = await histCol.insertOne(histDoc);
      await activeCol.deleteOne({ _id: active._id });
      return res.status(200).json({
        message: "match resigned & archived (no transaction)",
        historicalId: ins.insertedId,
        summary: histDoc.summary
      });
    } catch (fallbackErr) {
      return res.status(500).json({ message: "failed to archive match", detail: String(fallbackErr) });
    }
  }
});


module.exports = router;
