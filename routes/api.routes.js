const express = require('express');
const router = express.Router();
const apiController = require('../controllers/api.controller');
const jwtauth = require('../middleware/jwtauth'); // 1. Import the middleware

// Defines a POST route to trigger the data loading process.
// 2. Add 'jwtauth' middleware here
router.post('/etl/load/:datasetName', jwtauth, apiController.loadDataset);
router.post("/news/fetch", jwtauth, apiController.fetchSingaporeJobNews);


module.exports = router;