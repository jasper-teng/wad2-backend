const express = require('express');
const router = express.Router();
// --- Import Controllers ---
const apiController = require('../controllers/api.controller');
const gesController = require('../controllers/ges.controller');
// --- Import Middleware ---
const jwtauth = require('../middleware/jwtauth');

// =================================================================
// --- ETL & Data Loading Routes ---
// =================================================================
// Loads a dataset from data.gov.sg into the respective collection
router.post('/etl/load/:datasetName', jwtauth, apiController.loadDataset);


// =================================================================
// --- News Management Routes (Joe)---
// =================================================================
// Upload one or more news articles directly to the database
router.post('/news/upload', jwtauth, gesController.uploadNews);

// Get a paginated list of all news articles in the database
router.get('/news', jwtauth, gesController.listNews);

// Delete a specific news article by its ID
router.delete('/news/:id', jwtauth, gesController.deleteNews);

// =================================================================
// --- NLP & Sentiment Routes (Joe)---
// =================================================================
// Analyze the sentiment for a specific news article by its ID
router.get('/sentiment/analyze/:id', jwtauth, gesController.getArticleSentiment);

// =================================================================
// --- Forecasting Routes (Joe) ---
// =================================================================
// Trigger a new forecast model run
router.post('/forecast/run', jwtauth, gesController.runForecast);

// Retrieve the latest forecast results
router.get('/forecast/view', jwtauth, gesController.getForecast);


module.exports = router;

