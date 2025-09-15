const bcrypt = require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
require('dotenv').config();

const secret = process.env.jwtsecret;

const tokenverification = (req, res, next) => {
    const nonSecurePaths = ["/healthcheck","/dbconntest","/signin", "/testCRUD", "/slave"];
    //console.log(req.cookies);

    //const { authToken } = req.cookies;

    const {authToken} = "";

    console.log(req.url);
    console.log(req.path);
    
    if(nonSecurePaths.includes(req.path)){ return next();}

    // verify the token
    jwt.verify(authToken, secret, function (err, decoded) {
        if (err) {
            return res
                .status(401)
                .send({ message: "Authentication failed! Please try again :(" });
        }
        // save to request object for later use

        req.userId = decoded.id;

        next();
    });
};

module.exports = tokenverification;