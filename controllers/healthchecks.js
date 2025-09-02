const express = require("express");
const router = express.Router();
const { mongodbHealthCheck } = require("../dbconnection");

// This is the general health check bullshit yeah u get it

router.get("/", (req, res) => {
    console.log("it works");
    res.send("wallahi it works");
});

router.get("/dbconntest", (req, res) => {
    mongodbHealthCheck();
    res.send();
});


module.exports = router;
