// controllers/historicalgame.js
const express = require('express');
const { getDb } = require('../dbconnection');
const { ObjectId } = require('mongodb');

const router = express.Router();

// CREATE (archive a finished match)
// Body should provide the document fields (server may add/override some)
router.post('/historical-game', async (req, res, next) => {
  try {
    const db = await getDb();
    const col = db.collection('historical_game');

    const now = new Date();

    // Destructure body and ignore potentially conflicting fields from client
    const {
      matchKey,
      seed,
      gridSize,
      startedAt,
      endedAt,
      durationTurns,
      players,
      winner,
      outcome,
      notes,
      ai,
      terminalStateHash,
      mapSummary
    } = req.body || {};

    if (!matchKey || !seed || !gridSize || !endedAt || !players || !winner || !outcome) {
      return res.status(400).json({ message: "missing required fields" });
    }

    const _endedAt = new Date(endedAt);
    const _startedAt = startedAt ? new Date(startedAt) : _endedAt;
    const _durationTurns = Number.isInteger(durationTurns)
      ? durationTurns
      : (players?.[0]?.actionsHistogram
          ? Object.values(players[0].actionsHistogram).reduce((a,b)=>a+b,0)
          : 0);

    // Build the object we want to $set (NO createdAt here)
    const toSet = {
      matchKey,
      seed,
      gridSize,
      startedAt: _startedAt,
      endedAt: _endedAt,
      durationTurns: _durationTurns,
      players,
      winner,
      outcome,
      notes: notes || "",
      ai: ai || null,
      terminalStateHash: terminalStateHash || null,
      mapSummary: mapSummary || null,
      updatedAt: now
    };

    // Upsert with createdAt only on insert
    const result = await col.updateOne(
      { matchKey },
      {
        $set: toSet,
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );

    return res
      .status(result.upsertedCount ? 201 : 200)
      .json({ ok: true, upserted: !!result.upsertedCount });
  } catch (err) {
    next(err);
  }
});


// READ one
router.get('/historical-game/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const col = db.collection('historical_game');

    let filter;
    // allow fetching by ObjectId or by matchKey if not a valid ObjectId
    if (ObjectId.isValid(req.params.id)) {
      filter = { _id: new ObjectId(req.params.id) };
    } else {
      filter = { matchKey: req.params.id };
    }

    const doc = await col.findOne(filter);
    if (!doc) return res.status(404).json({ message: "not found" });

    // Optional: auth check — only return if user participated
    // If you want this restriction, uncomment:
    // const userId = req.userId && new ObjectId(req.userId);
    // const participated = doc.players.some(p => p.userId && userId && p.userId.equals(userId));
    // if (!participated) return res.status(403).json({ message: "forbidden" });

    res.json({ historicalGame: doc });
  } catch (err) {
    next(err);
  }
});

// LIST mine (with filters)
// GET /historical-game?limit=20&skip=0&outcome=KO
router.get('/historical-game', async (req, res, next) => {
  try {
    const db = await getDb();
    const col = db.collection('historical_game');

    const userId = req.userId ? new ObjectId(req.userId) : null;
    if (!userId) return res.status(401).json({ message: "unauthorized" });

    const { limit = 20, skip = 0, outcome, seed } = req.query;
    const q = {
      "players.userId": userId
    };
    if (outcome) q.outcome = outcome;
    if (seed) q.seed = seed;

    const docs = await col.find(q).sort({ endedAt: -1 }).skip(parseInt(skip,10)).limit(parseInt(limit,10)).toArray();
    res.json({ count: docs.length, items: docs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
