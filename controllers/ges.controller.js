const getModel = require("../models/flexibleData.model");
const { ObjectId } = require("mongodb");
const Sentiment = require("sentiment");
const sentiment = new Sentiment();
const { MultivariateLinearRegression } = require("ml-regression");

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
    const articlesToInsert = articles.map((article) => ({
      ...article,
      // Ensure essential fields like publishedAt exist, defaulting if necessary
      publishedAt: article.publishedAt
        ? new Date(article.publishedAt)
        : new Date(),
      fetched_at: new Date(),
      provider: "manual_upload",
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
    const {
      page = 1,
      limit = 20,
      sort = "publishedAt",
      order = "desc",
    } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const NewsModel = getModel("news_raw");
    const articles = await NewsModel.find()
      .sort({ [sort]: order === "desc" ? -1 : 1 })
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
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("[ERROR] Could not list news articles:", error);
    res.status(500).json({ message: "Failed to retrieve news articles." });
  }
};

/**
 * Gets a single news article by its MongoDB _id.
 */
exports.getNewsArticleById = async (req, res) => {
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

    res.status(200).json({
      message: "Successfully retrieved article.",
      data: article,
    });
  } catch (error) {
    console.error("[ERROR] Could not fetch news article by ID:", error);
    res.status(500).json({ message: "Failed to retrieve news article." });
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
    const textToAnalyze = `${article.title || ""}. ${
      article.description || ""
    }`.trim();

    if (!textToAnalyze) {
      return res
        .status(400)
        .json({
          message:
            "Article has no text content (title/description) to analyze.",
        });
    }

    const result = sentiment.analyze(textToAnalyze);

    // Optional: Update the article in the DB with the new score
    await NewsModel.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          sentiment_score: result.score,
          sentiment_comparative: result.comparative,
          sentiment_analyzed_at: new Date(),
        },
      }
    );

    res.status(200).json({
      message: "Sentiment analysis complete.",
      article_id: id,
      text_analyzed: textToAnalyze,
      sentiment: result,
    });
  } catch (error) {
    console.error("[ERROR] Could not analyze article sentiment:", error);
    res.status(500).json({ message: "Failed to analyze article sentiment." });
  }
};

/**
 * Calculates the overall average sentiment for all analyzed articles.
 */
exports.getOverallSentiment = async (req, res) => {
  try {
    const NewsModel = getModel("news_raw");

    // Use MongoDB's aggregation pipeline to calculate the average sentiment
    // only for articles that have been analyzed (sentiment_comparative is not null).
    const aggregationResult = await NewsModel.aggregate([
      {
        $match: {
          sentiment_comparative: { $ne: null },
        },
      },
      {
        $group: {
          _id: null, // Group all matching documents together
          averageSentiment: { $avg: "$sentiment_comparative" },
          articleCount: { $sum: 1 },
        },
      },
    ]);

    if (aggregationResult.length === 0) {
      return res.status(200).json({
        message: "No analyzed articles found.",
        average_sentiment_comparative: 0,
        analyzed_article_count: 0,
      });
    }

    const data = aggregationResult[0];
    res.status(200).json({
      message: "Overall sentiment calculated successfully for all articles.",
      average_sentiment_comparative: data.averageSentiment,
      analyzed_article_count: data.articleCount,
    });
  } catch (error) {
    console.error("[ERROR] Could not calculate overall sentiment:", error);
    res
      .status(500)
      .json({
        message: "Failed to calculate overall sentiment.",
        error: error.message,
      });
  }
};

// --- GES Data Exploration ---

/**
 * Retrieves a unique, sorted list of all universities from the ges_raw collection.
 */
exports.getUniqueUniversities = async (req, res) => {
  try {
    const GESModel = getModel("ges_raw");
    const universities = await GESModel.distinct("university");
    res.status(200).json({
      message: "Successfully retrieved unique universities.",
      data: universities.sort(),
    });
  } catch (error) {
    console.error("[ERROR] Could not fetch universities:", error);
    res.status(500).json({ message: "Failed to fetch university list." });
  }
};

/**
 * Retrieves a unique, sorted list of schools for a given university.
 */
exports.getUniqueSchoolsByUniversity = async (req, res) => {
  try {
    const { university } = req.params;
    const GESModel = getModel("ges_raw");
    const schools = await GESModel.distinct("school", {
      university: university,
    });
    res.status(200).json({
      message: `Successfully retrieved schools for ${university}.`,
      data: schools.sort(),
    });
  } catch (error) {
    console.error("[ERROR] Could not fetch schools:", error);
    res.status(500).json({ message: "Failed to fetch school list." });
  }
};

/**
 * Retrieves the most recent record for each unique degree within a given university and school.
 */
exports.getDegreesBySchoolForLatestYear = async (req, res) => {
  try {
    const { university, school } = req.params;
    const GESModel = getModel("ges_raw");

    const latestDegrees = await GESModel.aggregate([
      // 1. Filter for the specified university and school first for efficiency
      { $match: { university, school } },

      // 2. Sort by degree, then by year descending to get the latest year on top for each degree
      { $sort: { degree: 1, year: -1 } },

      // 3. Group by degree and take the first document (which is the latest year's record)
      {
        $group: {
          _id: "$degree",
          latestRecord: { $first: "$$ROOT" },
        },
      },

      // 4. Promote the nested latestRecord object to the root level of the document
      { $replaceRoot: { newRoot: "$latestRecord" } },

      // 5. Sort the final list alphabetically by degree name for a clean output
      { $sort: { degree: 1 } },
    ]);

    if (latestDegrees.length === 0) {
      return res
        .status(404)
        .json({
          message: `No degree data found for ${school} at ${university}.`,
        });
    }

    res.status(200).json({
      message: `Successfully retrieved the most recent data for each degree.`,
      data: latestDegrees,
    });
  } catch (error) {
    console.error("[ERROR] Could not fetch latest degrees by school:", error);
    res.status(500).json({ message: "Failed to fetch degree list." });
  }
};

/**
 * Retrieves the complete historical data for a specific degree, sorted by year.
 */
exports.getDegreeHistory = async (req, res) => {
  try {
    const { university, school, degree } = req.params;
    const GESModel = getModel("ges_raw");

    const history = await GESModel.find({ university, school, degree }).sort({
      year: "asc",
    });

    if (history.length === 0) {
      return res
        .status(404)
        .json({
          message: "No historical data found for the specified degree.",
        });
    }

    res.status(200).json({
      message: "Successfully retrieved historical data.",
      data: history,
    });
  } catch (error) {
    console.error("[ERROR] Could not fetch degree history:", error);
    res.status(500).json({ message: "Failed to fetch degree history." });
  }
};

// --- Forecasting Pipeline ---

exports.runForecast = async (req, res) => {
  try {
    const { university, school, degree } = req.body;

    if (!university || !school || !degree) {
      return res
        .status(400)
        .json({
          message: "Request body must contain university, school, and degree.",
        });
    }
    console.log(`--- Starting Forecast Pipeline for: ${degree} ---`);

    // Fetch all data sources in parallel
    const GESModel = getModel("ges_raw");
    const MedianIncomeModel = getModel("median_monthly_income");
    const UnemploymentModel = getModel("unemp_ann");
    const NewsModel = getModel("news_raw");
    const GdpModel = getModel("gdp_industry_qtr");
    const CpiModel = getModel("cpi_monthly");
    const JobVacanciesModel = getModel("job_vacancies_qtr");

    const [
      degreeHistory,
      medianIncomeRecords,
      unemploymentRecord,
      gdpRecord,
      cpiRecord,
      jobVacanciesRecord,
    ] = await Promise.all([
      GESModel.find({ university, school, degree })
        .sort({ year: "asc" })
        .lean(),
      MedianIncomeModel.find({}).lean(),
      UnemploymentModel.findOne({ DataSeries: "Total" }).lean(),
      GdpModel.findOne({ DataSeries: "GDP In Chained (2015) Dollars" }).lean(),
      CpiModel.findOne({ DataSeries: "All Items" }).lean(),
      JobVacanciesModel.findOne({ DataSeries: "Total" }).lean(),
    ]);

    if (degreeHistory.length < 3) {
      return res
        .status(400)
        .json({
          message:
            "Not enough historical data (< 3 years) for this degree to create a forecast.",
        });
    }

    console.log(
      "\n--- Phase 1: Preparing Historical Data for Model Training ---"
    );

    const getAnnualGdp = (year) => {
      const values = [
        gdpRecord[`${year}1Q`],
        gdpRecord[`${year}2Q`],
        gdpRecord[`${year}3Q`],
        gdpRecord[`${year}4Q`],
      ];
      if (values.some((v) => v === undefined)) return null;
      return values
        .map((v) => parseFloat(v || 0))
        .reduce((sum, v) => sum + v, 0);
    };
    const getAnnualAvgVacancies = (year) => {
      const values = [
        jobVacanciesRecord[`${year}1Q`],
        jobVacanciesRecord[`${year}2Q`],
        jobVacanciesRecord[`${year}3Q`],
        jobVacanciesRecord[`${year}4Q`],
      ];
      if (values.some((v) => v === undefined)) return null;
      return (
        values.map((v) => parseFloat(v || 0)).reduce((sum, v) => sum + v, 0) / 4
      );
    };
    const getAnnualInflation = (year) => {
      const currentDec = parseFloat(cpiRecord[`${year}Dec`]);
      const prevDec = parseFloat(cpiRecord[`${year - 1}Dec`]);
      if (isNaN(currentDec) || isNaN(prevDec)) return null;
      return (currentDec - prevDec) / prevDec;
    };

    const medianIncomesByYear = medianIncomeRecords.reduce((acc, doc) => {
      acc[doc.year] = doc.med_income_incl_empcpf;
      return acc;
    }, {});

    const historicalData = [];
    for (const record of degreeHistory) {
      const year = record.year;
      if (parseInt(year) < 2013) continue;

      const dataPoint = {
        year: parseInt(year),
        median_salary: parseFloat(record.gross_monthly_median),
        national_median: parseFloat(medianIncomesByYear[year]),
        unemployment: parseFloat(unemploymentRecord[year]),
        annual_gdp: getAnnualGdp(year),
        avg_job_vacancies: getAnnualAvgVacancies(year),
        yoy_inflation_rate: getAnnualInflation(year),
      };

      if (Object.values(dataPoint).every((v) => v !== null && !isNaN(v))) {
        historicalData.push(dataPoint);
      } else {
        console.log(
          `[WARN] Skipping year ${year} due to missing or invalid macroeconomic data.`
        );
      }
    }
    console.log("Cleaned historical data for training:");
    console.table(historicalData);

    console.log("\n--- Phase 2: Training Multiple Linear Regression Model ---");
    const features = [
      "national_median",
      "unemployment",
      "annual_gdp",
      "avg_job_vacancies",
      "yoy_inflation_rate",
    ];
    const X_train = historicalData.map((d) => features.map((f) => d[f]));
    const y_train = historicalData.map((d) => [d.median_salary]);
    const regression = new MultivariateLinearRegression(X_train, y_train);
    console.log("Model trained successfully.");

    // Add model predictions on historical data to check accuracy
    historicalData.forEach((dataPoint, index) => {
      const prediction = regression.predict(X_train[index]);
      dataPoint.model_prediction = Math.round(prediction[0]);
    });
    console.log("Historical data with model predictions:");
    console.table(
      historicalData.map((d) => ({
        year: d.year,
        actual_salary: d.median_salary,
        predicted_salary: d.model_prediction,
      }))
    );

    const weights = regression.weights;
    const intercept = weights[features.length][0];
    const coefficients = features.reduce(
      (obj, feature, i) => ({ ...obj, [feature]: weights[i][0] }),
      {}
    );
    const modelEquation = { coefficients, intercept };
    console.log("Model Equation:", modelEquation);

    console.log(
      "\n--- Phase 3: Projecting Future Inputs and Forecasting Salary ---"
    );

    const projectLinearTrend = (data, yearsToProject) => {
      const keys = Object.keys(data)
        .filter((k) => /^\d{4}$/.test(k))
        .sort();
      const values = keys.map((k) => parseFloat(data[k]));
      if (values.length < 2) {
        const lastKnownValue =
          values.length > 0 ? values[values.length - 1] : 0;
        const projections = { ...data };
        for (let i = 1; i <= yearsToProject; i++) {
          projections[
            parseInt(keys[keys.length - 1] || new Date().getFullYear()) + i
          ] = lastKnownValue;
        }
        return projections;
      }
      const avgChange =
        (values[values.length - 1] - values[0]) / (values.length - 1);
      let lastValue = values[values.length - 1];
      const projections = { ...data };
      for (let i = 1; i <= yearsToProject; i++) {
        lastValue += avgChange;
        projections[parseInt(keys[keys.length - 1]) + i] = lastValue;
      }
      return projections;
    };

    const currentYear = new Date().getFullYear();
    const finalForecastYear = currentYear + 3;

    const createAnnualHistory = (record, aggregator) => {
      const history = {};
      Object.keys(record)
        .filter((key) => /^\d{4}/.test(key))
        .forEach((key) => {
          const year = key.substring(0, 4);
          if (!history[year]) history[year] = [];
          history[year].push(parseFloat(record[key]));
        });
      return Object.entries(history).reduce((acc, [year, values]) => {
        if (values.length === 4) acc[year] = aggregator(values);
        return acc;
      }, {});
    };

    const annualGdpHistory = createAnnualHistory(gdpRecord, (values) =>
      values.reduce((s, v) => s + v, 0)
    );
    const annualVacanciesHistory = createAnnualHistory(
      jobVacanciesRecord,
      (values) => values.reduce((s, v) => s + v, 0) / 4
    );

    const annualInflationHistory = {};
    Object.keys(cpiRecord)
      .filter((k) => k.includes("Dec"))
      .forEach((k) => {
        const year = parseInt(k.substring(0, 4));
        if (year > 2012) {
          const rate = getAnnualInflation(year);
          if (rate !== null) annualInflationHistory[year] = rate;
        }
      });

    const projectToFinalYear = (history) => {
      const lastYear = parseInt(
        Object.keys(history)
          .filter((k) => !isNaN(k))
          .sort()
          .pop() || currentYear
      );
      return projectLinearTrend(history, finalForecastYear - lastYear);
    };

    const projectedNationalMedians = projectToFinalYear(medianIncomesByYear);
    const projectedUnemployment = projectToFinalYear(unemploymentRecord);
    const projectedGdp = projectToFinalYear(annualGdpHistory);
    const projectedVacancies = projectToFinalYear(annualVacanciesHistory);
    const projectedInflation = projectToFinalYear(annualInflationHistory);

    const sentimentAggregation = await NewsModel.aggregate([
      { $match: { sentiment_comparative: { $ne: null } } },
      {
        $group: {
          _id: null,
          averageSentiment: { $avg: "$sentiment_comparative" },
        },
      },
    ]);
    const sentimentAdjustment =
      sentimentAggregation.length > 0
        ? sentimentAggregation[0].averageSentiment
        : 0;
    console.log(
      `Sentiment Adjustment Factor: ${sentimentAdjustment.toFixed(4)}`
    );

    const forecastResults = [];
    for (let i = 1; i <= 3; i++) {
      const forecastYear = currentYear + i;
      const futureFeatures = [
        projectedNationalMedians[forecastYear],
        projectedUnemployment[forecastYear],
        projectedGdp[forecastYear],
        projectedVacancies[forecastYear],
        projectedInflation[forecastYear],
      ];

      if (futureFeatures.some((v) => v === undefined)) {
        throw new Error(
          `Cannot make prediction for ${forecastYear}. One or more projected features are missing.`
        );
      }

      const predictedSalary = regression.predict(futureFeatures);
      const adjustedSalary = predictedSalary[0] * (1 + sentimentAdjustment);
      forecastResults.push({
        year: forecastYear,
        predicted_median_salary: Math.round(adjustedSalary),
        projected_inputs: {
          national_median_income: projectedNationalMedians[forecastYear],
          unemployment_rate: projectedUnemployment[forecastYear],
          annual_gdp: projectedGdp[forecastYear],
          avg_job_vacancies: projectedVacancies[forecastYear],
          yoy_inflation_rate: projectedInflation[forecastYear],
        },
      });
    }
    console.log("\n--- Final Forecast Results (Sentiment Adjusted) ---");
    console.table(
      forecastResults.map((r) => ({
        year: r.year,
        predicted_median_salary: r.predicted_median_salary,
      }))
    );

    // --- FINAL ENHANCED RESPONSE ---
    res.status(200).json({
      message: `Successfully generated 3-year salary forecast for ${degree}.`,
      forecast: forecastResults,
      historical_data: historicalData,
      model_details: {
        equation: modelEquation,
        features: features.map((f) => f.replace(/_/g, " ")),
        sentiment_adjustment_factor: sentimentAdjustment,
      },
      // NEW: Add full historical and projected trends for macroeconomic data
      macroeconomic_trends: {
        national_median_income: projectedNationalMedians,
        unemployment_rate: projectedUnemployment,
        annual_gdp: projectedGdp,
        avg_job_vacancies: projectedVacancies,
        yoy_inflation_rate: projectedInflation,
      },
    });
  } catch (error) {
    console.error("[ERROR] Forecast pipeline failed:", error);
    res
      .status(500)
      .json({
        message: "Failed to execute forecast pipeline.",
        error: error.message,
      });
  }
};
