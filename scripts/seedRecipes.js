// scripts/seedRecipes.js
require("dotenv").config();
const { getDb, getClient } = require("../dbconnection");

async function main() {
  const db = await getDb();
  const col = db.collection("recipe");

  // indexes (idempotent)
  await col.createIndex({ key: 1 }, { unique: true });
  await col.createIndex({ kind: 1 });
  await col.createIndex({ "output.weaponClass": 1, "output.grade": 1 });

  const now = new Date();

  const recipes = [
    // ===== paste the same recipe docs you defined earlier =====
    // tip: keep this list as a single source of truth (could move to JSON)
    // ===== WEAPONS: Straight (line shots) =====
    {
      kind: "weapon",
      key: "weapon.straight.t1",
      name: "Straight Shot T1",
      description: "Fires a straight projectile up to 6 tiles.",
      output: {
        weaponClass: "straight",
        grade: 1,
        damage: 10,
        range: 6,
        shootsOverWalls: false,
        pattern: "line",
      },
      costs: { wood: 3, stone: 1, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.straight.t2",
      name: "Straight Shot T2",
      description: "Improved straight projectile.",
      output: {
        weaponClass: "straight",
        grade: 2,
        damage: 20,
        range: 6,
        shootsOverWalls: false,
        pattern: "line",
      },
      costs: { wood: 5, stone: 2, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.straight.t3",
      name: "Straight Shot T3",
      description: "High-power straight projectile.",
      output: {
        weaponClass: "straight",
        grade: 3,
        damage: 30,
        range: 7,
        shootsOverWalls: false,
        pattern: "line",
      },
      costs: { wood: 8, stone: 3, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.straight.t4",
      name: "Straight Shot T4",
      description: "Elite straight projectile.",
      output: {
        weaponClass: "straight",
        grade: 4,
        damage: 40,
        range: 7,
        shootsOverWalls: false,
        pattern: "line",
      },
      costs: { wood: 12, stone: 5, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.straight.t5",
      name: "Straight Shot T5",
      description: "Masterwork straight projectile.",
      output: {
        weaponClass: "straight",
        grade: 5,
        damage: 50,
        range: 8,
        shootsOverWalls: false,
        pattern: "line",
      },
      costs: { wood: 16, stone: 7, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },

    // ===== WEAPONS: Diagonal =====
    {
      kind: "weapon",
      key: "weapon.diag.t1",
      name: "Diagonal Shot T1",
      description: "Fires diagonally; niche angles to bypass cover.",
      output: {
        weaponClass: "diag",
        grade: 1,
        damage: 10,
        range: 6,
        shootsOverWalls: false,
        pattern: "diagonal",
      },
      costs: { wood: 3, stone: 2, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.diag.t2",
      name: "Diagonal Shot T2",
      description: "Improved diagonal power.",
      output: {
        weaponClass: "diag",
        grade: 2,
        damage: 20,
        range: 6,
        shootsOverWalls: false,
        pattern: "diagonal",
      },
      costs: { wood: 6, stone: 3, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.diag.t3",
      name: "Diagonal Shot T3",
      description: "Advanced diagonal power.",
      output: {
        weaponClass: "diag",
        grade: 3,
        damage: 30,
        range: 7,
        shootsOverWalls: false,
        pattern: "diagonal",
      },
      costs: { wood: 9, stone: 4, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },

    // ===== WEAPONS: Arc (crescent) =====
    {
      kind: "weapon",
      key: "weapon.arc.t1",
      name: "Arc Shot T1",
      description: "Crescent arc; hits in a spread.",
      output: {
        weaponClass: "arc",
        grade: 1,
        damage: 10,
        range: 5,
        shootsOverWalls: false,
        pattern: "arc",
      },
      costs: { wood: 2, stone: 1, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.arc.t2",
      name: "Arc Shot T2",
      description: "Wider, stronger arc.",
      output: {
        weaponClass: "arc",
        grade: 2,
        damage: 20,
        range: 5,
        shootsOverWalls: false,
        pattern: "arc",
      },
      costs: { wood: 4, stone: 2, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.arc.t3",
      name: "Arc Shot T3",
      description: "High-power arc.",
      output: {
        weaponClass: "arc",
        grade: 3,
        damage: 30,
        range: 6,
        shootsOverWalls: false,
        pattern: "arc",
      },
      costs: { wood: 6, stone: 3, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },

    // ===== WEAPONS: Lob (can shoot over walls) =====
    {
      kind: "weapon",
      key: "weapon.lob.t1",
      name: "Lob Shot T1",
      description: "Arced lob that clears walls.",
      output: {
        weaponClass: "lob",
        grade: 1,
        damage: 10,
        range: 6,
        shootsOverWalls: true,
        pattern: "lob",
      },
      costs: { wood: 2, stone: 3, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.lob.t2",
      name: "Lob Shot T2",
      description: "Heavier lob payload.",
      output: {
        weaponClass: "lob",
        grade: 2,
        damage: 20,
        range: 6,
        shootsOverWalls: true,
        pattern: "lob",
      },
      costs: { wood: 3, stone: 6, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.lob.t3",
      name: "Lob Shot T3",
      description: "Advanced lob payload.",
      output: {
        weaponClass: "lob",
        grade: 3,
        damage: 30,
        range: 7,
        shootsOverWalls: true,
        pattern: "lob",
      },
      costs: { wood: 4, stone: 9, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },

    // ===== WEAPONS: Melee =====
    {
      kind: "weapon",
      key: "weapon.melee.t1",
      name: "Melee T1",
      description: "Close-range strike (adjacent).",
      output: {
        weaponClass: "melee",
        grade: 1,
        damage: 10,
        range: 1,
        shootsOverWalls: false,
        pattern: "adjacent",
      },
      costs: { wood: 1, stone: 1, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.melee.t2",
      name: "Melee T2",
      description: "Sharper edge.",
      output: {
        weaponClass: "melee",
        grade: 2,
        damage: 20,
        range: 1,
        shootsOverWalls: false,
        pattern: "adjacent",
      },
      costs: { wood: 2, stone: 2, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "weapon",
      key: "weapon.melee.t3",
      name: "Melee T3",
      description: "Heavy strike.",
      output: {
        weaponClass: "melee",
        grade: 3,
        damage: 30,
        range: 1,
        shootsOverWalls: false,
        pattern: "adjacent",
      },
      costs: { wood: 3, stone: 3, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },

    // ===== WALLS =====
    {
      kind: "wall",
      key: "wall.wood.short",
      name: "Wooden Wall (Short)",
      description: "Light cover; place up to 2 tiles away.",
      output: { wall: { hp: 20, maxPlaceDistance: 2 } },
      costs: { wood: 4, stone: 0, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "wall",
      key: "wall.stone.short",
      name: "Stone Wall (Short)",
      description: "Heavy cover; place up to 2 tiles away.",
      output: { wall: { hp: 40, maxPlaceDistance: 2 } },
      costs: { wood: 2, stone: 6, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "wall",
      key: "wall.stone.mid",
      name: "Stone Wall (Mid)",
      description: "Heavier cover; place up to 3 tiles away.",
      output: { wall: { hp: 50, maxPlaceDistance: 3 } },
      costs: { wood: 3, stone: 8, food: 0 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },

    // ===== HEALING (food-driven) =====
    {
      kind: "healing",
      key: "heal.small",
      name: "Small Meal",
      description: "Restore 10 HP.",
      output: { heal: 10 },
      costs: { wood: 0, stone: 0, food: 3 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "healing",
      key: "heal.medium",
      name: "Hearty Meal",
      description: "Restore 20 HP.",
      output: { heal: 20 },
      costs: { wood: 0, stone: 0, food: 6 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "healing",
      key: "heal.large",
      name: "Feast",
      description: "Restore 30 HP.",
      output: { heal: 30 },
      costs: { wood: 0, stone: 0, food: 9 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
    {
      kind: "healing",
      key: "heal.major",
      name: "Banquet",
      description: "Restore 50 HP.",
      output: { heal: 50 },
      costs: { wood: 0, stone: 0, food: 16 },
      craftTimeMs: 0,
      cooldownMs: 0,
      prerequisites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    },
  ];

  for (const raw of recipes) {
    const now = new Date();

    // make copies so we don't mutate your source array
    const r = { ...raw, updatedAt: now, enabled: raw.enabled !== false };
    // ensure createdAt exists for new docs, but DO NOT put in $set
    const createdAt = raw.createdAt || now;

    // never put createdAt inside $set — only on insert
    const { createdAt: _drop, _id, ...toSet } = r;

    await col.updateOne(
      { key: r.key },
      {
        $set: toSet, // everything EXCEPT createdAt
        $setOnInsert: { createdAt }, // only when inserting a new doc
      },
      { upsert: true }
    );
  }

  console.log(`Seeded/updated ${recipes.length} recipes.`);
}

main()
  .then(() => getClient().then((c) => c.close()))
  .catch(async (e) => {
    console.error(e);
    const c = await getClient();
    c.close();
    process.exit(1);
  });
