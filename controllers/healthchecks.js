const express = require("express");
const router = express.Router();
const { mongodbHealthCheck } = require("../dbconnection");
const jwt = require("jsonwebtoken")
require('dotenv').config();


// This is the general health check bullshit yeah u get it

router.get("/", (req, res) => {
    console.log("it works");
    res.send("wallahi it works");
});

router.get("/dbconntest", (req, res) => {
    mongodbHealthCheck();
    res.send("My database connection works");
});

router.get("/signin", (req,res) => {
    var token = jwt.sign({"userId" : 1},process.env.jwtsecret, {expiresIn: "365d"});
    res.send({"You dropped this king" : token});
})


module.exports = router;
