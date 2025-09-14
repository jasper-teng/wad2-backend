// controllers/profile.js
const express = require("express");
const router = express.Router();
const { getDb } = require("../dbconnection");

/**
 * NOTE:
 * - These routes expect req.userId to be set by your JWT middleware.
 * - Keep them behind auth (do NOT add to your nonSecurePaths list).
 */

/**
 * GET /profile/active-matches
 * Query params:
 *   - limit (default 20, max 100)
 *   - skip  (default 0)
 * Returns the caller's active matches from `active_game`.
 */
router.get("/profile/active-matches", async (req, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const skip  = Math.max(parseInt(req.query.skip || "0", 10), 0);

    const db = await getDb();
    const col = db.collection("active_game");

    const filter = { status: "active", "players.userId": userId };
    const projection = {
      // minimal fields for a lobby/list UI
      seed: 1, gridSize: 1, elo: 1, turnIndex: 1, currentActor: 1,
      players: 1, createdAt: 1, updatedAt: 1
    };

    const [items, total] = await Promise.all([
      col.find(filter).project(projection).sort({ updatedAt: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments(filter)
    ]);

    res.json({ total, limit, skip, items });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /profile/historic-matches
 * Query params:
 *   - limit (default 20, max 100)
 *   - skip  (default 0)
 * Returns the caller's historical matches from `historical_game`.
 */
router.get("/profile/historic-matches", async (req, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const skip  = Math.max(parseInt(req.query.skip || "0", 10), 0);

    const db = await getDb();
    const col = db.collection("historical_game");

    const filter = { "players.userId": userId };
    const projection = {
      // summary-oriented fields
      matchKey: 1,
      gridSize: 1, elo: 1,
      summary: 1,               // { turns, winner, reason, createdAt, endedAt, durationMs }
      createdAt: 1, endedAt: 1
    };

    const [items, total] = await Promise.all([
      col.find(filter).project(projection).sort({ endedAt: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments(filter)
    ]);

    res.json({ total, limit, skip, items });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
