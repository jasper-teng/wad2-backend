// middleware/jwtauth.js
const jwt = require("jsonwebtoken");
require("dotenv").config();
const secret = process.env.jwtsecret;

const tokenverification = (req, res, next) => {
  const nonSecurePaths = ["/", "/dbconntest", "/signin", "/signup", "/testCRUD", "/slave","/recipes", "/recipes/"];
  if (nonSecurePaths.includes(req.path)) return next();

  let token = null;
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) token = h.slice(7);
  if (!token && req.headers["x-auth-token"]) token = req.headers["x-auth-token"];
  if (!token && req.cookies?.authToken) token = req.cookies.authToken;

  if (!token) return res.status(401).send({ message: "No token provided." });

  jwt.verify(token, secret, (err, decoded) => {
    if (err) return res.status(401).send({ message: "Authentication failed! Please try again :(" });
    req.userId = decoded.userId;   // our token uses userId
    req.handle = decoded.handle;
    next();
  });
};

module.exports = tokenverification;
