const getModel = require("../models/flexibleData.model");
const { ObjectId } = require("mongodb");
const Sentiment = require('sentiment');
const sentiment = new Sentiment();

// joe's news api and sentiment pipeline
/**
 * Controller to upload news articles directly to the database.
 * Expects an array of article objects in the request body.
 */
exports.uploadNews = async (req, res) => {
    const articles = req.body;

    // Validate that the input is a non-empty array
    if (!Array.isArray(articles) || articles.length === 0) {
        return res.status(400).json({
            message: "Request body must be a non-empty array of news articles.",
        });
    }

    try {
        const NewsModel = getModel("news_raw");

        // Add metadata to each article before insertion
        const articlesToInsert = articles.map(article => ({
            ...article,
            // Ensure essential fields like publishedAt exist, defaulting if necessary
            publishedAt: article.publishedAt ? new Date(article.publishedAt) : new Date(),
            fetched_at: new Date(),
            provider: 'manual_upload',
        }));
        
        const result = await NewsModel.insertMany(articlesToInsert);

        res.status(201).json({
            message: `Successfully uploaded and inserted ${result.length} articles.`,
            insertedCount: result.length,
        });

    } catch (error) {
        console.error("[FATAL] Error uploading news:", error);
        res.status(500).json({
            message: "An internal error occurred during news upload.",
            error: error.message,
        });
    }
};

/**
 * Lists news articles from the database with pagination.
 */
exports.listNews = async (req, res) => {
  try {
    const { page = 1, limit = 20, sort = 'publishedAt', order = 'desc' } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const NewsModel = getModel("news_raw");
    const articles = await NewsModel.find()
      .sort({ [sort]: order === 'desc' ? -1 : 1 })
      .skip(skip)
      .limit(limitNum);
      
    const total = await NewsModel.countDocuments();

    res.status(200).json({
      message: "Successfully retrieved articles.",
      data: articles,
      pagination: {
        total_articles: total,
        total_pages: Math.ceil(total / limitNum),
        current_page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    console.error("[ERROR] Could not list news articles:", error);
    res.status(500).json({ message: "Failed to retrieve news articles." });
  }
};


/**
 * Deletes a single news article by its MongoDB _id.
 */
exports.deleteNews = async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid article ID format." });
        }

        const NewsModel = getModel("news_raw");
        const result = await NewsModel.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Article not found." });
        }

        res.status(200).json({ message: "Article successfully deleted." });
    } catch (error) {
        console.error("[ERROR] Could not delete news article:", error);
        res.status(500).json({ message: "Failed to delete news article." });
    }
};

/**
 * Analyzes and returns the sentiment of a single news article.
 */
exports.getArticleSentiment = async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid article ID format." });
        }

        const NewsModel = getModel("news_raw");
        const article = await NewsModel.findOne({ _id: new ObjectId(id) });

        if (!article) {
            return res.status(404).json({ message: "Article not found." });
        }

        // Combine title and description for a more comprehensive analysis
        const textToAnalyze = `${article.title || ''}. ${article.description || ''}`.trim();

        if (!textToAnalyze) {
            return res.status(400).json({ message: "Article has no text content (title/description) to analyze." });
        }

        const result = sentiment.analyze(textToAnalyze);
        
        // Optional: Update the article in the DB with the new score
        await NewsModel.updateOne(
            { _id: new ObjectId(id) },
            { 
                $set: { 
                    sentiment_score: result.score,
                    sentiment_comparative: result.comparative,
                    sentiment_analyzed_at: new Date()
                }
            }
        );

        res.status(200).json({
            message: "Sentiment analysis complete.",
            article_id: id,
            text_analyzed: textToAnalyze,
            sentiment: result
        });

    } catch (error) {
        console.error("[ERROR] Could not analyze article sentiment:", error);
        res.status(500).json({ message: "Failed to analyze article sentiment." });
    }
};


/**
 * Placeholder: Triggers the model training or inference process.
 */
exports.runForecast = async (req, res) => {
  console.log("Forecast run triggered.");
  res.status(202).json({
    message: "Forecast run initiated. Check status endpoint for results.",
  });
};

/**
 * Placeholder: Retrieves the latest forecast results.
 */
exports.getForecast = async (req, res) => {
  try {
    const ForecastModel = getModel("forecasts");
    const latestForecast = await ForecastModel.findOne().sort({ createdAt: -1 });
    if (!latestForecast) {
      return res.status(404).json({ message: "No forecast data found." });
    }
    res.status(200).json(latestForecast);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving forecast data." });
  }
};

