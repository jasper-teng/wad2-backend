// controllers/user.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getDb } = require("../dbconnection");
require("dotenv").config();

const JWT_SECRET = process.env.jwtsecret;
const JWT_TTL = process.env.jwt_ttl || "365d";

// normalize strings for case-insensitive uniqueness
const norm = (s) => (s || "").trim();

router.post("/signup", async (req, res, next) => {
  try {
    const { email, handle, password } = req.body || {};
    if (!email || !handle || !password) {
      return res.status(400).json({ message: "email, handle, and password are required" });
    }

    const db = await getDb();
    const users = db.collection("users");

    // ensure uniqueness (case-insensitive via collation)
    const existing = await users.findOne(
      { $or: [ { email: norm(email) }, { handle: norm(handle) } ] },
      { collation: { locale: "en", strength: 2 } }
    );
    if (existing) {
      return res.status(409).json({ message: "email or handle already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = {
      email: norm(email),
      handle: norm(handle),
      passwordHash,
      elo: 1200,
      createdAt: new Date(),
      lastLoginAt: null,
      prefs: {},
      stats: { wins: 0, losses: 0 }
    };

    const { insertedId } = await users.insertOne(doc);
    const token = jwt.sign({ userId: insertedId.toString(), handle: doc.handle }, JWT_SECRET, { expiresIn: JWT_TTL });

    return res.status(201).json({
      user: { id: insertedId, email: doc.email, handle: doc.handle, elo: doc.elo },
      token
    });
  } catch (err) {
    next(err);
  }
});

router.post("/signin", async (req, res, next) => {
  try {
    const { emailOrHandle, password } = req.body || {};
    if (!emailOrHandle || !password) {
      return res.status(400).json({ message: "emailOrHandle and password are required" });
    }

    const db = await getDb();
    const users = db.collection("users");

    const user = await users.findOne(
      { $or: [ { email: norm(emailOrHandle) }, { handle: norm(emailOrHandle) } ] },
      { collation: { locale: "en", strength: 2 } }
    );
    if (!user) return res.status(401).json({ message: "invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "invalid credentials" });

    await users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    const token = jwt.sign({ userId: user._id.toString(), handle: user.handle }, JWT_SECRET, { expiresIn: JWT_TTL });

    return res.json({
      user: { id: user._id, email: user.email, handle: user.handle, elo: user.elo },
      token
    });
  } catch (err) {
    next(err);
  }
});

// simple protected endpoint to verify auth + req.userId wiring
router.get("/me", async (req, res, next) => {
  try {
    const db = await getDb();
    const users = db.collection("users");
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: "unauthorized" });

    const user = await users.findOne({ _id: new (require("mongodb").ObjectId)(userId) }, { projection: { passwordHash: 0 } });
    if (!user) return res.status(404).json({ message: "user not found" });

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
