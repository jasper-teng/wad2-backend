const getModel = require("../models/flexibleData.model");

/**
 * Retrieves a structured list of all unique GES combinations
 * (university, school, degree) and the count of records for each,
 * sorted by the most available data.
 */
exports.getGesSummary = async () => {
  try {
    const GESModel = getModel("ges_raw");

    const combinations = await GESModel.aggregate([
      // 1. Group documents by the unique combination of uni, school, and degree
      {
        $group: {
          _id: {
            university: "$university",
            school: "$school",
            degree: "$degree",
          },
          recordCount: { $sum: 1 }, // Count how many records exist for this combo
        },
      },
      // 2. Clean up the output format
      {
        $project: {
          _id: 0, // Remove the complex _id object
          university: "$_id.university",
          school: "$_id.school",
          degree: "$_id.degree",
          recordCount: 1, // Keep the new recordCount field
        },
      },
      // 3. Sort by the highest recordCount first
      {
        $sort: {
          recordCount: -1,
        },
      },
    ]);

    return combinations; // This will be an array of objects
  } catch (error) {
    console.error("Error in getGesSummary (aggregation):", error);
    return []; // Return empty array on error
  }
};

