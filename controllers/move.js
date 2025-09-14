const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { getDb } = require("../dbconnection");

// =================================================================================================
// SECTION: Core Game Logic & Action Resolution
// This file handles all real-time game actions, validates them, resolves their outcomes,
// and manages the AI's turn with proactive, lookahead logic and player-specific learning.
// =================================================================================================

// ------------------ Utilities ------------------

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const inBounds = (w, h, [x, y]) => x >= 0 && y >= 0 && x < w && y < h;
const sameCell = (a, b) => a[0] === b[0] && a[1] === b[1];
const manhattan = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function cellOccupied(active, cell, ignorePlayer = false, ignoreAi = false) {
  const { entities } = active;
  if (!ignorePlayer && sameCell(entities.player.pos, cell)) return true;
  if (!ignoreAi && sameCell(entities.ai.pos, cell)) return true;
  if (active.entities.walls?.some(w => sameCell(w.pos, cell))) return true;
  return false;
}

function getEntity(active, who) { return who === "player" ? active.entities.player : active.entities.ai; }
function getOpponent(active, who) { return who === "player" ? active.entities.ai : active.entities.player; }

// ------------------ Line of Sight (LOS) Helpers ------------------

function hasStraightLine([x1, y1], [x2, y2]) { return x1 === x2 || y1 === y2; }
function hasDiagonalLine([x1, y1], [x2, y2]) { return Math.abs(x1 - x2) === Math.abs(y1 - y2); }

function wallBlocksStraight(active, from, to) {
  if (!hasStraightLine(from, to)) return false;
  const [x1, y1] = from; const [x2, y2] = to;
  for (const w of active.entities.walls || []) {
    const [wx, wy] = w.pos;
    if (x1 === x2 && wx === x1) {
      if ((wy > Math.min(y1, y2)) && (wy < Math.max(y1, y2))) return true;
    }
    if (y1 === y2 && wy === y1) {
      if ((wx > Math.min(x1, x2)) && (wx < Math.max(x1, x2))) return true;
    }
  }
  return false;
}

// ------------------ Recipe & Inventory Helpers ------------------

async function loadRecipe(db, key, expectedKind) {
  const r = await db.collection("recipe").findOne({ key, enabled: true });
  if (!r) throw new Error(`recipe not found: ${key}`);
  if (expectedKind && r.kind !== expectedKind) throw new Error(`recipe kind mismatch: expected ${expectedKind}`);
  return r;
}

function payCostsOrThrow(entity, costs) {
  const inv = entity.inventory;
  for (const k of ["wood", "stone", "food"]) {
    if ((inv[k] || 0) < (costs[k] || 0)) throw new Error(`insufficient ${k}`);
  }
  for (const k of ["wood", "stone", "food"]) inv[k] = (inv[k] || 0) - (costs[k] || 0);
}

function awardWeapon(entity, weaponKey) {
  entity.weapons = entity.weapons || [];
  if (!entity.weapons.includes(weaponKey)) entity.weapons.push(weaponKey);
}

function putWall(active, pos, hp) {
  active.entities.walls = active.entities.walls || [];
  if (active.entities.walls.some(w => sameCell(w.pos, pos))) throw new Error("wall already present at target");
  active.entities.walls.push({ pos, hp });
}

// ------------------ Automatic Pickup Helpers ------------------

function tryPickupResources(active, entity) {
  const pos = entity.pos;
  const groups = [["trees", "wood"], ["stones", "stone"], ["hay", "food"]];
  let picked = null;
  for (const [coll, invKey] of groups) {
    const arr = active.resources[coll] || [];
    const idx = arr.findIndex(c => sameCell(c, pos));
    if (idx !== -1) {
      arr.splice(idx, 1);
      entity.inventory[invKey] = (entity.inventory[invKey] || 0) + 1;
      picked = picked || [];
      picked.push(invKey);
    }
  }
  return picked;
}

function tryPickupLoot(active, entity) {
  const idx = (active.loot || []).findIndex(l => sameCell(l.pos, entity.pos));
  if (idx === -1) return null;
  const item = active.loot[idx];
  active.loot.splice(idx, 1);
  if (item.key.startsWith("heal.")) {
    entity.inventory[item.key] = (entity.inventory[item.key] || 0) + 1;
  } else {
    awardWeapon(entity, item.key);
  }
  return item.key;
}


// =================================================================================================
// SECTION: Action Resolvers
// =================================================================================================

function resolveMove(active, actor, params) {
  const ent = getEntity(active, actor);
  const { w, h } = active.gridSize;
  let target;
  if (params.to) target = params.to;
  else if (typeof params.dx === "number" && typeof params.dy === "number")
    target = [ent.pos[0] + params.dx, ent.pos[1] + params.dy];
  else throw new Error("invalid move params");

  const isTargetInBounds = inBounds(w, h, target);
  console.log(`[MOVE VALIDATION] Actor: ${actor}, Target: [${target}], InBounds: ${isTargetInBounds}`);
  if (!isTargetInBounds) throw new Error(`out of bounds: target [${target}] is outside grid [${w},${h}]`);

  const maxStep = ent.effects?.move2 ? 2 : 1;
  if (manhattan(ent.pos, target) > maxStep) throw new Error("move too far");
  if (cellOccupied(active, target)) throw new Error("cell occupied");
  ent.pos = target;
  const resPicked = tryPickupResources(active, ent);
  const lootPicked = tryPickupLoot(active, ent);
  return { consumeTurn: true, meta: { pickupResources: resPicked || null, pickupLoot: lootPicked || null } };
}

async function resolveShoot(db, active, actor, params) {
  const ent = getEntity(active, actor);
  const opp = getOpponent(active, actor);
  const { weaponKey, target } = params || {};
  const { w, h } = active.gridSize;
  if (!weaponKey) throw new Error("weaponKey required");
  if (!Array.isArray(target)) throw new Error("target required");
  if (!ent.weapons || !ent.weapons.includes(weaponKey)) throw new Error("weapon not equipped");
  if (!inBounds(w, h, target)) throw new Error("target is out of bounds");
  const rec = await loadRecipe(db, weaponKey, "weapon");
  const { weaponClass, range, shootsOverWalls, damage } = rec.output;
  const dist = manhattan(ent.pos, target);
  if (dist < 1 || dist > range) throw new Error(`target out of range (dist: ${dist}, range: ${range})`);
  let ok = false;
  if (weaponClass === "straight") {
    ok = hasStraightLine(ent.pos, target);
    if (ok && !shootsOverWalls && wallBlocksStraight(active, ent.pos, target)) ok = false;
  } else if (weaponClass === "diag") {
    ok = hasDiagonalLine(ent.pos, target);
  } else if (weaponClass === "lob") {
    ok = true;
  } else if (weaponClass === "arc") {
    ok = dist >= 2 && dist <= range;
  } else if (weaponClass === "melee") {
    ok = dist === 1;
  }
  if (!ok) throw new Error("no valid trajectory");
  let hit = false;
  if (sameCell(opp.pos, target)) {
    hit = true;
    opp.hp = clamp(opp.hp - damage, 0, 100);
  }
  let ended = false, winner = null;
  if (opp.hp <= 0) {
    active.status = "ended";
    ended = true;
    winner = (actor === "player")
      ? { userId: active.players[0].userId, handle: active.players[0].handle, isAI: false }
      : { userId: null, handle: "AI", isAI: true };
    active.winner = winner;
  }
  return { consumeTurn: true, meta: { damage: hit ? damage : 0, hit, ended, winner } };
}

async function resolveCraftWeapon(db, active, actor, params) {
  const ent = getEntity(active, actor);
  const { key } = params || {};
  if (!key) throw new Error("key required");
  const rec = await loadRecipe(db, key, "weapon");
  payCostsOrThrow(ent, rec.costs);
  awardWeapon(ent, key);
  return { consumeTurn: false, meta: { craft: key } };
}

async function resolveCraftWall(db, active, actor, params) {
  const ent = getEntity(active, actor);
  const { key, pos } = params || {};
  const { w, h } = active.gridSize;
  if (!key || !Array.isArray(pos)) throw new Error("key and pos required");
  if (!inBounds(w, h, pos)) throw new Error("position is out of bounds");
  const rec = await loadRecipe(db, key, "wall");
  payCostsOrThrow(ent, rec.costs);
  const maxD = rec.output.wall?.maxPlaceDistance ?? 1;
  if (manhattan(ent.pos, pos) > maxD) throw new Error("too far to place wall");
  if (cellOccupied(active, pos)) throw new Error("cell occupied");
  const hp = rec.output.wall?.hp ?? 20;
  putWall(active, pos, hp);
  return { consumeTurn: true, meta: { wall: { pos, hp, key } } };
}

async function resolveHeal(db, active, actor, params) {
  const ent = getEntity(active, actor);
  const { key } = params || {};
  if (!key) throw new Error("key required");
  if (key.startsWith("heal.") && (ent.inventory[key] || 0) > 0) {
    const amounts = { "heal.small": 10, "heal.medium": 20, "heal.large": 30, "heal.major": 50 };
    const heal = amounts[key];
    if (heal) {
      ent.inventory[key] -= 1;
      ent.hp = clamp(ent.hp + heal, 0, 100);
      return { consumeTurn: false, meta: { heal, consumable: true } };
    }
  }
  const rec = await loadRecipe(db, key, "healing");
  payCostsOrThrow(ent, rec.costs);
  const heal = rec.output.heal || 0;
  ent.hp = clamp(ent.hp + heal, 0, 100);
  return { consumeTurn: false, meta: { heal, consumable: false } };
}

function resolveInteract(active, actor, params) {
  const ent = getEntity(active, actor);
  const { pos, type } = params || {};
  if (!Array.isArray(pos) || !["tree", "stone", "hay"].includes(type)) throw new Error("invalid interact params");
  if (manhattan(ent.pos, pos) > 1) throw new Error("interact target too far");
  const key = type === "tree" ? "trees" : type === "stone" ? "stones" : "hay";
  const arr = active.resources[key] || [];
  const idx = arr.findIndex(c => sameCell(c, pos));
  if (idx === -1) throw new Error("no such resource at pos");
  arr.splice(idx, 1);
  if (key === "trees") ent.inventory.wood = (ent.inventory.wood || 0) + 1;
  if (key === "stones") ent.inventory.stone = (ent.inventory.stone || 0) + 1;
  if (key === "hay") ent.inventory.food = (ent.inventory.food || 0) + 1;
  return { consumeTurn: true, meta: { gathered: key } };
}

function resolveSkipTurn() {
  return { consumeTurn: true, meta: { skipped: true } };
}


// =================================================================================================
// SECTION: AI Logic & Game Archiving
// =================================================================================================

function astar(active, start, end) {
  const { w, h } = active.gridSize;
  const openSet = [];
  const closedSet = new Set();
  const nodes = Array(w).fill(null).map(() => Array(h).fill(null));

  class Node {
    constructor(x, y, g = Infinity, h = 0, parent = null) {
      this.x = x; this.y = y; this.g = g; this.h = h; this.f = g + h; this.parent = parent;
    }
    get pos() { return [this.x, this.y]; }
  }

  const startNode = new Node(start[0], start[1], 0, manhattan(start, end));
  nodes[start[0]][start[1]] = startNode;
  openSet.push(startNode);

  while (openSet.length > 0) {
    openSet.sort((a, b) => a.f - b.f);
    const currentNode = openSet.shift();

    if (sameCell(currentNode.pos, end)) {
      const path = [];
      let temp = currentNode;
      while (temp) {
        path.push(temp.pos);
        temp = temp.parent;
      }
      return path.reverse();
    }

    closedSet.add(`${currentNode.x},${currentNode.y}`);

    for (const [dx, dy] of dirs4) {
      const neighborPos = [currentNode.x + dx, currentNode.y + dy];
      const [nx, ny] = neighborPos;

      if (!inBounds(w, h, neighborPos) || closedSet.has(`${nx},${ny}`)) {
        continue;
      }

      if (cellOccupied(active, neighborPos, false, true)) {
        continue;
      }

      const gScore = currentNode.g + 1;
      let neighborNode = nodes[nx][ny];

      if (!neighborNode) {
        neighborNode = new Node(nx, ny);
        nodes[nx][ny] = neighborNode;
      }

      if (gScore < neighborNode.g) {
        neighborNode.parent = currentNode;
        neighborNode.g = gScore;
        neighborNode.h = manhattan(neighborPos, end);
        neighborNode.f = neighborNode.g + neighborNode.h;
        if (!openSet.some(n => sameCell(n.pos, neighborPos))) {
          openSet.push(neighborNode);
        }
      }
    }
  }

  return null;
}

const DEFAULT_AI = {
  epsilon: 0.12,
  actions: {
    MOVE: { w: [0.5, 0.4, 1.5, 1.2, 5.0] },
    SHOOT: { w: [2.5, -0.2, 4.0, 0.5] },
    CRAFT_WALL: { w: [1.5, 0.8, 0.3] },
    CRAFT_WEAPON: { w: [1.2, 0.5] },
    HEAL: { w: [2.0, 0.5] },
    INTERACT: { w: [0.8, 0.6] }
  }
};

/**
 * NEW: Updates the player's ELO in the `users` collection.
 * @param {Db} db - The database instance.
 * @param {object} finishedGame - The final state of the game.
 */
async function updatePlayerElo(db, finishedGame) {
  const usersCol = db.collection("users");
  const player = finishedGame.players.find(p => p.role === 'player');
  if (!player || !player.userId) {
    console.log(`[ELO UPDATE] Skipping ELO update for anonymous player.`);
    return;
  }

  const playerId = player.userId;
  const playerWon = finishedGame.winner && finishedGame.winner.isAI === false;
  const eloChange = playerWon ? 10 : -10;

  console.log(`[ELO UPDATE] Player ${playerId} ${playerWon ? 'won' : 'lost'}. Adjusting ELO by ${eloChange}.`);

  try {
    const result = await usersCol.updateOne(
      { _id: new ObjectId(playerId) },
      { $inc: { elo: eloChange } }
    );
    if (result.modifiedCount > 0) {
      console.log(`[ELO UPDATE] Successfully updated ELO for player ${playerId}.`);
    } else {
      console.log(`[ELO UPDATE] WARNING: Could not find user ${playerId} to update ELO.`);
    }
  } catch (err) {
    console.error(`[ELO UPDATE] CRITICAL ERROR during ELO update:`, err);
  }
}


async function archiveGame(db, finishedGame) {
  console.log(`[GAME LOGIC] Archiving game ${finishedGame._id}...`);
  const histCol = db.collection("historical_game");
  const activeCol = db.collection("active_game");

  const playerEntity = finishedGame.entities.player;
  const aiEntity = finishedGame.entities.ai;

  const history = finishedGame.actionHistory || [];
  const playerActions = history.filter(a => a.actor === 'player').reduce((acc, a) => {
    acc[a.action] = (acc[a.action] || 0) + 1;
    return acc;
  }, {});
  const aiActions = history.filter(a => a.actor === 'ai').reduce((acc, a) => {
    acc[a.action] = (acc[a.action] || 0) + 1;
    return acc;
  }, {});

  const historicalDoc = {
    matchKey: String(finishedGame._id),
    seed: finishedGame.seed,
    gridSize: finishedGame.gridSize,
    startedAt: finishedGame.createdAt,
    endedAt: new Date(),
    durationTurns: finishedGame.turnIndex,
    players: [
      {
        userId: playerEntity.userId,
        handle: playerEntity.handle,
        isAI: false,
        finalHP: playerEntity.hp,
        actionsHistogram: playerActions,
      },
      {
        userId: null,
        handle: "AI",
        isAI: true,
        finalHP: aiEntity.hp,
        actionsHistogram: aiActions,
      }
    ],
    winner: finishedGame.winner,
    outcome: finishedGame.winner ? 'KO' : 'Draw',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  try {
    const insertResult = await histCol.insertOne(historicalDoc);
    console.log(`[GAME LOGIC] Successfully inserted historical game with ID: ${insertResult.insertedId}`);
    // BUG FIX: The _id from the copied 'next' object is a string. It must be converted back to an ObjectId for deletion.
    const deleteResult = await activeCol.deleteOne({ _id: new ObjectId(finishedGame._id) });
    console.log(`[GAME LOGIC] Successfully deleted active game. Count: ${deleteResult.deletedCount}`);
  } catch (err) {
    console.error(`[GAME LOGIC] CRITICAL ERROR during game archiving:`, err);
  }
}

async function updateAiPolicyForPlayer(db, finishedGame) {
  const policyCol = db.collection("ai_policy");
  const player = finishedGame.players.find(p => p.role === 'player');
  if (!player || !player.userId) return;
  const playerId = player.userId;
  console.log(`[AI LEARNING] Game ended. Updating AI policy for player: ${playerId} in collection 'ai_policy'`);
  const existingPolicy = await policyCol.findOne({ scope: 'player', playerId });
  
  if (existingPolicy) {
      console.log(`[AI LEARNING] Found existing policy for player. It will be updated.`);
  } else {
      console.log(`[AI LEARNING] No policy found for player. A new one will be created.`);
  }

  const newPolicy = existingPolicy || {
    ...JSON.parse(JSON.stringify(DEFAULT_AI)),
    scope: 'player',
    playerId,
    gamesPlayed: 0,
    wins: 0,
  };
  
  const aiWon = finishedGame.winner && finishedGame.winner.handle === 'AI';
  const learningRate = 0.05;
  newPolicy.gamesPlayed += 1;
  if (aiWon) newPolicy.wins += 1;
  const aiActions = (finishedGame.actionHistory || []).filter(a => a.actor === 'ai');
  if (aiActions.length > 0) {
    const actionCounts = aiActions.reduce((acc, a) => {
      acc[a.action] = (acc[a.action] || 0) + 1;
      return acc;
    }, {});
    console.log(`[AI LEARNING] AI actions this game:`, actionCounts);
    console.log(`[AI LEARNING] Outcome: ${aiWon ? 'AI Won' : 'AI Lost'}. Adjusting weights...`);
    for (const actionType in actionCounts) {
      if (newPolicy.actions[actionType]) {
        const adjustment = learningRate * (aiWon ? 1 : -1);
        newPolicy.actions[actionType].w[0] += adjustment;
        newPolicy.actions[actionType].w[0] = clamp(newPolicy.actions[actionType].w[0], 0.1, 5.0);
      }
    }
    console.log(`[AI LEARNING] New 'SHOOT' weight [0]: ${newPolicy.actions.SHOOT?.w[0].toFixed(4)}`);
  }

  // BUG FIX: Construct a clean update payload without the _id field to ensure the update/upsert works correctly.
  const { _id, ...updatePayload } = newPolicy;

  const updateResult = await policyCol.updateOne(
    { scope: 'player', playerId },
    { $set: updatePayload },
    { upsert: true }
  );
  console.log(`[AI LEARNING] Policy for player ${playerId} saved. Result:`, { matched: updateResult.matchedCount, modified: updateResult.modifiedCount, upsertedId: updateResult.upsertedId });
}

function buildFeaturesFor(actionType, ctx) {
  const { ai, opp, active, elo, optimalPath } = ctx;
  const dist = manhattan(ai.pos, opp.pos);
  const hasLOS = hasStraightLine(ai.pos, opp.pos) && !wallBlocksStraight(active, ai.pos, opp.pos);
  const aiLowHP = ai.hp <= (elo > 1500 ? 70 : 60);

  switch (actionType) {
    case "MOVE": {
      const { to } = ctx.candidate;
      const newDist = manhattan(to, opp.pos);
      const approach = (dist - newDist);
      const getCover = (active.entities.walls || []).some(w => manhattan(w.pos, to) === 1) ? 1 : 0;
      const retreat = (aiLowHP && newDist > dist) ? 1 : 0;
      const lootHere = (active.loot || []).some(l => sameCell(l.pos, to));
      const resHere = ["trees", "stones", "hay"].some(k => (active.resources[k] || []).some(c => sameCell(c, to)));
      const getPickup = (lootHere || resHere) ? 1 : 0;
      const isOnPath = (optimalPath && optimalPath.length > 1 && sameCell(to, optimalPath[1])) ? 1 : 0;
      console.log(`[AI DEBUG] Move to [${to}] Features: { approach: ${approach}, getCover: ${getCover}, retreat: ${retreat}, getPickup: ${getPickup}, isOnPath: ${isOnPath} }`);
      return [approach, getCover, retreat, getPickup, isOnPath];
    }
    case "SHOOT": {
      const canKill = ctx.candidate?.damage ? (ctx.candidate.damage >= opp.hp ? 1 : 0) : 0;
      return [ctx.candidate?.damage || 0, dist / 16, canKill, hasLOS ? 1 : 0];
    }
    case "CRAFT_WALL": {
      const underThreat = hasLOS && dist <= 6 ? 1 : 0;
      return [underThreat, hasLOS ? 1 : 0, 0];
    }
    default:
      return [];
  }
}

function dot(a, b) { let s = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i]; return s; }

async function enumerateAiCandidates(db, active, ai, opp) {
  const { w, h } = active.gridSize;
  const cands = [];
  
  if (inBounds(w, h, opp.pos)) {
    for (const key of (ai.weapons || [])) { try { const rec = await loadRecipe(db, key, "weapon"); const { weaponClass, range, shootsOverWalls, damage } = rec.output; const dist = manhattan(ai.pos, opp.pos); let ok = false; if (weaponClass === "straight") { ok = hasStraightLine(ai.pos, opp.pos) && dist >= 1 && dist <= range; if (ok && !shootsOverWalls && wallBlocksStraight(active, ai.pos, opp.pos)) ok = false; } else if (weaponClass === "diag") { ok = hasDiagonalLine(ai.pos, opp.pos) && dist >= 1 && dist <= range; } else if (weaponClass === "lob") { ok = dist >= 1 && dist <= range; } else if (weaponClass === "arc") { ok = dist >= 2 && dist <= range; } else if (weaponClass === "melee") { ok = dist === 1; } if (ok) { cands.push({ type: "SHOOT", params: { weaponKey: key, target: opp.pos }, _meta: { damage } }); } } catch (_) { } }
  } else {
    console.log(`[AI DEBUG] Opponent at [${opp.pos}] is out of bounds. Skipping SHOOT actions.`);
  }

  for (const [dx, dy] of dirs4) { const to = [ai.pos[0] + dx, ai.pos[1] + dy]; if (!inBounds(w, h, to)) continue; if (cellOccupied(active, to, false, true)) continue; cands.push({ type: "MOVE", params: { to } }); }
  const healKeys = ["heal.major", "heal.large", "heal.medium", "heal.small"]; const healKey = healKeys.find(k => (ai.inventory[k] || 0) > 0); if (healKey && ai.hp <= 70) { cands.push({ type: "HEAL", params: { key: healKey } }); }
  const underThreat = hasStraightLine(ai.pos, opp.pos) && !wallBlocksStraight(active, ai.pos, opp.pos) && manhattan(ai.pos, opp.pos) <= 6; if (underThreat) { const woodWall = await db.collection("recipe").findOne({ key: "wall.wood.short", enabled: true }); if (woodWall) { const canPay = (ai.inventory.wood || 0) >= (woodWall.costs.wood || 0) && (ai.inventory.stone || 0) >= (woodWall.costs.stone || 0); if (canPay) { const step = [Math.sign(opp.pos[0] - ai.pos[0]), Math.sign(opp.pos[1] - ai.pos[1])]; const candidate = [ai.pos[0] + step[0], ai.pos[1] + step[1]]; const maxD = woodWall.output.wall?.maxPlaceDistance ?? 1; if (manhattan(ai.pos, candidate) <= maxD && inBounds(w, h, candidate) && !cellOccupied(active, candidate)) { cands.push({ type: "CRAFT_WALL", params: { key: "wall.wood.short", pos: candidate } }); } } } }
  const hasRanged = (ai.weapons || []).some(k => !k.includes(".melee.")); if (!hasRanged) { const r = await db.collection("recipe").findOne({ key: "weapon.straight.t1", enabled: true }); if (r) { const canPay = (ai.inventory.wood || 0) >= (r.costs.wood || 0) && (ai.inventory.stone || 0) >= (r.costs.stone || 0); if (canPay) cands.push({ type: "CRAFT_WEAPON", params: { key: "weapon.straight.t1" }, _meta: { upgrade: 1 } }); } }
  const needMats = ((ai.inventory.wood || 0) + (ai.inventory.stone || 0) < 3); if (needMats) { for (const [dx, dy] of dirs4) { const p = [ai.pos[0] + dx, ai.pos[1] + dy]; if (!inBounds(w, h, p)) continue; for (const t of ["tree", "stone", "hay"]) { const key = t === "tree" ? "trees" : t === "stone" ? "stones" : "hay"; if ((active.resources[key] || []).some(c => sameCell(c, p))) { cands.push({ type: "INTERACT", params: { pos: p, type: t } }); } } } }
  return cands;
}

async function loadAiWeights(db, playerId) {
  const policyCol = db.collection("ai_policy");
  if (playerId) {
    const playerPolicy = await policyCol.findOne({ scope: 'player', playerId });
    if (playerPolicy) {
      console.log(`[AI DEBUG] Found and loaded custom policy for player ${playerId}`);
      return playerPolicy;
    }
  }
  console.log(`[AI DEBUG] No custom player policy found. Loading global default policy.`);
  const globalPolicy = await policyCol.findOne({ scope: "global", version: "bandit-v1" });
  if (!globalPolicy) return DEFAULT_AI;
  const epsilon = globalPolicy.epsilon ?? DEFAULT_AI.epsilon;
  const actions = {};
  for (const k of Object.keys(DEFAULT_AI.actions)) {
    actions[k] = { w: (globalPolicy.actions[k]?.w || DEFAULT_AI.actions[k].w) };
  }
  return { epsilon, actions };
}

async function aiTakeTurn(db, next) {
  console.log(`[AI DEBUG] --- AI Turn Start (Turn Index: ${next.turnIndex}) ---`);
  if (next.status !== "active") {
    console.log("[AI DEBUG] Game not active, AI skipping turn.");
    return { took: false };
  }

  const ai = next.entities.ai;
  const opp = next.entities.player;
  const elo = next.elo || 1200;

  const policy = await loadAiWeights(db, opp.userId);

  if (ai.hp <= 60) {
    console.log(`[AI DEBUG] AI Strategy: Defensive/Retreat (HP is low at ${ai.hp})`);
  } else if ((ai.inventory.wood || 0) < 3 && (ai.weapons || []).length === 0) {
    console.log(`[AI DEBUG] AI Strategy: Seeking Resources (No weapons and low on materials)`);
  } else {
    console.log(`[AI DEBUG] AI Strategy: Aggressive (HP is healthy at ${ai.hp})`);
  }

  let maxFreeActions = 2;
  while (next.currentActor === 'ai' && next.status === 'active' && maxFreeActions > 0) {
    const candidates = await enumerateAiCandidates(db, next, ai, opp);
    console.log(`[AI DEBUG] Found ${candidates.length} possible actions.`);

    if (!candidates.length) {
      console.log("[AI DEBUG] AI is stuck, no valid actions found. Skipping turn.");
      return { took: false, result: { consumeTurn: true } };
    }

    let optimalPath = null;
    let shortestPathLength = Infinity;
    if (inBounds(next.gridSize.w, next.gridSize.h, opp.pos)) {
      for (const [dx, dy] of dirs4) {
        const targetTile = [opp.pos[0] + dx, opp.pos[1] + dy];
        if (inBounds(next.gridSize.w, next.gridSize.h, targetTile) && !cellOccupied(next, targetTile, false, true)) {
          const path = astar(next, ai.pos, targetTile);
          if (path && path.length < shortestPathLength) {
            shortestPathLength = path.length;
            optimalPath = path;
          }
        }
      }
    }
    if (optimalPath && optimalPath.length > 1) {
      console.log(`[AI DEBUG] Optimal path to player found. Next step: [${optimalPath[1]}]`);
    } else {
      console.log(`[AI DEBUG] No optimal path to player found.`);
    }

    let best = null, bestScore = -Infinity;
    for (const cand of candidates) {
      const ctx = { ai, opp, active: next, candidate: cand, elo, optimalPath };
      const feats = buildFeaturesFor(cand.type, ctx);
      const w = policy.actions[cand.type]?.w || [];
      const score = dot(w, feats);
      cand._score = score;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    const scoredCandidates = candidates.map(c => ({ action: c.type, params: c.params, score: c._score.toFixed(4) }));
    console.table(scoredCandidates);

    if (Math.random() < policy.epsilon && candidates.length > 1) {
      const others = candidates.filter(c => c !== best);
      best = others[Math.floor(Math.random() * others.length)];
      console.log(`[AI DEBUG] Epsilon-greedy exploration triggered! Choosing a random action.`);
    }

    console.log(`[AI DEBUG] FINAL DECISION: ${best.type} with score ${best._score.toFixed(4)}`, best.params);

    let result;
    switch (best.type) {
      case "MOVE": result = resolveMove(next, "ai", best.params || {}); break;
      case "SHOOT": result = await resolveShoot(db, next, "ai", best.params || {}); break;
      case "CRAFT_WALL": result = await resolveCraftWall(db, next, "ai", best.params || {}); break;
      case "CRAFT_WEAPON": result = await resolveCraftWeapon(db, next, "ai", best.params || {}); break;
      case "HEAL": result = await resolveHeal(db, next, "ai", best.params || {}); break;
      case "INTERACT": result = await resolveInteract(db, next, "ai", best.params || {}); break;
      default: throw new Error(`AI chose unknown action ${best.type}`);
    }

    next.actionHistory = next.actionHistory || [];
    next.actionHistory.push({ actor: 'ai', action: best.type });

    if (result.meta.ended) {
      console.log("[GAME LOGIC] Game ended by AI's action.");
      return { took: true, result };
    }

    if (result.consumeTurn) {
      console.log(`[AI DEBUG] AI performed turn-consuming action: ${best.type}. Ending turn.`);
      return { took: true, result };
    } else {
      maxFreeActions--;
      console.log(`[AI DEBUG] AI performed free action: ${best.type}. Selecting another action... (${maxFreeActions} free actions remaining)`);
    }
  }

  console.log(`[AI DEBUG] --- AI Turn End ---`);
  return { took: true, result: { consumeTurn: true } };
}


// =================================================================================================
// SECTION: Main API Endpoint
// =================================================================================================

router.post("/update", async (req, res) => {
  const db = await getDb();
  const col = db.collection("active_game");

  try {
    const { matchId, actor, action, snapshotVersion } = req.body || {};
    if (!matchId || !actor || !action?.type) {
      return res.status(400).json({ message: "matchId, actor, and action.type are required" });
    }

    const filter = { _id: new ObjectId(matchId) };
    if (typeof snapshotVersion === "number") filter.version = snapshotVersion;
    const active = await col.findOne(filter);
    if (!active) return res.status(404).json({ message: "active match not found or version mismatch" });

    if (active.status !== 'active') {
        return res.status(409).json({ message: "match has already ended" });
    }

    const isTurnConsuming = (t) => ["MOVE", "SHOOT", "CRAFT_WALL", "INTERACT", "SKIP_TURN"].includes(t);
    if (isTurnConsuming(action.type) && active.currentActor !== actor) {
      return res.status(409).json({ message: `not ${actor}'s turn` });
    }

    const next = JSON.parse(JSON.stringify(active));
    next.actionHistory = next.actionHistory || [];

    console.log(`[GAME LOGIC] Resolving ${actor} action: ${action.type}`, action.params);
    let playerResult;
    switch (action.type) {
      case "MOVE": playerResult = resolveMove(next, actor, action.params || {}); break;
      case "SHOOT": playerResult = await resolveShoot(db, next, actor, action.params || {}); break;
      case "CRAFT_WEAPON": playerResult = await resolveCraftWeapon(db, next, actor, action.params || {}); break;
      case "CRAFT_WALL": playerResult = await resolveCraftWall(db, next, actor, action.params || {}); break;
      case "HEAL": playerResult = await resolveHeal(db, next, actor, action.params || {}); break;
      case "INTERACT": playerResult = await resolveInteract(next, actor, action.params || {}); break;
      case "SKIP_TURN": playerResult = resolveSkipTurn(); break;
      default: return res.status(400).json({ message: `unknown action.type: ${action.type}` });
    }
    console.log(`[GAME LOGIC] Action resolved. Outcome:`, playerResult.meta);

    next.actionHistory.push({ actor, action: action.type });

    if (playerResult.meta.ended) {
      console.log("[GAME LOGIC] Game ended by player's action.");
      await updatePlayerElo(db, next);
      await updateAiPolicyForPlayer(db, next);
      await archiveGame(db, next);
      return res.json({ snapshot: { ...next, _id: active._id, status: 'ended' } });
    }

    if (playerResult.consumeTurn && next.status === "active") {
      console.log(`[GAME LOGIC] Player's turn consumed. Advancing turn index.`);
      next.turnIndex = (next.turnIndex || 0) + 1;
      next.currentActor = actor === "player" ? "ai" : "player";
    }

    if (next.status === "active" && next.currentActor === "ai") {
      const aiStep = await aiTakeTurn(db, next);

      if (aiStep.result && aiStep.result.meta.ended) {
        console.log("[GAME LOGIC] Game ended by AI's action.");
        await updatePlayerElo(db, next);
        await updateAiPolicyForPlayer(db, next);
        await archiveGame(db, next);
        return res.json({ snapshot: { ...next, _id: active._id, status: 'ended' } });
      }

      if (aiStep.took && aiStep.result && aiStep.result.consumeTurn && next.status === 'active') {
        console.log(`[GAME LOGIC] AI's final action consumed turn. Advancing turn index.`);
        next.turnIndex = (next.turnIndex || 0) + 1;
        next.currentActor = "player";
      }
    }

    next.version = (next.version || 0) + 1;
    next.updatedAt = new Date();

    const updateFilter = { _id: active._id };
    if (typeof snapshotVersion === "number") updateFilter.version = active.version;

    const { matchedCount } = await col.updateOne(updateFilter, {
      $set: {
        entities: next.entities,
        resources: next.resources,
        loot: next.loot,
        turnIndex: next.turnIndex,
        currentActor: next.currentActor,
        status: next.status,
        winner: next.winner || null,
        version: next.version,
        updatedAt: next.updatedAt,
        actionHistory: next.actionHistory
      }
    });

    if (!matchedCount) {
      return res.status(409).json({ message: "concurrent update; please reload snapshot" });
    }

    console.log(`[GAME LOGIC] Successfully updated game state to version ${next.version}.`);
    res.json({ snapshot: { ...next, _id: active._id } });

  } catch (err) {
    console.error("Error during /update:", err);
    res.status(400).json({ message: err.message || "bad request" });
  }
});

module.exports = router;

