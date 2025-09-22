const mongoose = require('mongoose');

// This schema is intentionally flexible to accommodate various dataset structures.
// `strict: false` allows any fields to be saved.
const flexibleSchema = new mongoose.Schema({}, { strict: false });

/**
 * Gets or creates a Mongoose model for a given collection name.
 * This prevents recompiling the model if it already exists.
 * @param {string} collectionName - The name of the MongoDB collection.
 * @returns {mongoose.Model} The Mongoose model for the specified collection.
 */
const getModel = (collectionName) => {
  // If the model doesn't exist, create it.
  if (!mongoose.models[collectionName]) {
    // Pass the collectionName as the THIRD argument to prevent pluralization.
    // mongoose.model('ModelName', schema, 'collectionName')
    return mongoose.model(collectionName, flexibleSchema, collectionName);
  }
  return mongoose.models[collectionName];
};

module.exports = getModel;