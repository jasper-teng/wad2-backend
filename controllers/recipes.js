// controllers/recipes.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../dbconnection');

/**
 * GET /recipes
 * Filters (all optional):
 *  - kind: weapon|wall|healing
 *  - weaponClass: straight|diag|arc|lob|melee (only for kind=weapon)
 *  - minGrade, maxGrade (ints; only for weapons)
 *  - enabled: true/false (default: true)
 */
router.get('/recipes', async (req, res, next) => {
  try {
    const db = await getDb();
    const col = db.collection('recipe');

    const {
      kind,
      weaponClass,
      minGrade,
      maxGrade,
      enabled
    } = req.query;

    const q = {};
    if (kind) q.kind = kind;
    if (enabled !== undefined) q.enabled = enabled === 'true' ? true : enabled === 'false' ? false : true;
    else q.enabled = true;

    if (weaponClass) {
      q["output.weaponClass"] = weaponClass;
      // only applies to weapons
      q.kind = "weapon";
    }

    // grade range (weapons)
    const gFilter = {};
    if (minGrade !== undefined) gFilter.$gte = parseInt(minGrade, 10);
    if (maxGrade !== undefined) gFilter.$lte = parseInt(maxGrade, 10);
    if (Object.keys(gFilter).length) {
      q["output.grade"] = gFilter;
      q.kind = "weapon";
    }

    const docs = await col.find(q, { projection: { _id: 0 } }).toArray();
    res.json({ recipes: docs });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /recipes/:key  -> fetch a single recipe by key
 */
router.get('/recipes/:key', async (req, res, next) => {
  try {
    const db = await getDb();
    const col = db.collection('recipe');
    const doc = await col.findOne({ key: req.params.key, enabled: true }, { projection: { _id: 0 } });
    if (!doc) return res.status(404).json({ message: 'recipe not found' });
    res.json({ recipe: doc });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
