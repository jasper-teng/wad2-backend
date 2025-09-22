const getModel = require("../models/flexibleData.model");

// Base URL for the data.gov.sg datastore API
const DATA_GOV_BASE_URL =
  "https://data.gov.sg/api/action/datastore_search?resource_id=";

// List of all target datasets, mapping a friendly name to its resource_id and target collection
const datasets = [
  {
    name: "ges",
    resource_id: "d_3c55210de27fcccda2ed0c63fdd2b352", // Graduate Employment Survey
    collectionName: "ges_raw",
  },
  {
    name: "cpi",
    resource_id: "d_bdaff844e3ef89d39fceb962ff8f0791", // Consumer Price Index (Monthly) 2024 base year
    collectionName: "cpi_monthly",
  },
//   {
//     name: "gdp",
//     resource_id: "d_0a62357c3c88469d70051a44300431e5", // GDP Growth (Quarterly) - need to find the correct one
//     collectionName: "gdp_qtr",
//   },
  {
    name: "unemployment",
    resource_id: "d_95d364f9050bce1c834390ceed366b93", // Unemployment Rate (Annual)
    collectionName: "unemp_ann",
  },
  {
    name: "vacancies",
    resource_id: "d_f3bbdfbf92b811fff364aeed23b5e0bb", // Job Vacancies (Quarterly)
    collectionName: "job_vacancies_qtr",
  },
];

/**
 * Fetches a dataset by its friendly name, clears the corresponding collection,
 * and inserts the new records.
 */
exports.loadDataset = async (req, res) => {
    const { datasetName } = req.params;
    const dataset = datasets.find(d => d.name === datasetName);

    if (!dataset) {
        return res.status(404).json({ message: "Dataset not found in the configured list." });
    }

    const BATCH_SIZE = 1000;
    const initialUrl = `${DATA_GOV_BASE_URL}${dataset.resource_id}&limit=${BATCH_SIZE}`;
    console.log(`Fetching data for '${datasetName}' from ${dataset.resource_id}`);

    try {
        const initialResponse = await fetch(initialUrl);
        const initialData = await initialResponse.json();

        if (!initialData.success) throw new Error("Initial API call failed.");

        const totalRecords = initialData.result.total;
        let allRecords = initialData.result.records;
        
        console.log(`[DEBUG] API reported a total of ${totalRecords} records.`);

        if (totalRecords > BATCH_SIZE) {
            const fetchPromises = [];
            for (let offset = BATCH_SIZE; offset < totalRecords; offset += BATCH_SIZE) {
                const pageUrl = `${DATA_GOV_BASE_URL}${dataset.resource_id}&limit=${BATCH_SIZE}&offset=${offset}`;
                fetchPromises.push(fetch(pageUrl).then(res => res.json()));
            }

            const additionalPages = await Promise.all(fetchPromises);
            additionalPages.forEach(pageData => {
                if (pageData.success) allRecords = allRecords.concat(pageData.result.records);
            });
        }
        
        console.log(`[DEBUG] Total records fetched from API: ${allRecords.length}.`);

        const sanitizedRecords = allRecords.map(record => {
            const { _id, ...rest } = record;
            return rest;
        });

        // --- ADD THIS LOG ---
        if (sanitizedRecords.length > 0) {
            console.log('[DEBUG] Sample sanitized record (first one):', JSON.stringify(sanitizedRecords[0], null, 2));
        }
        // --------------------

        const DataModel = getModel(dataset.collectionName);

        await DataModel.deleteMany({});
        console.log(`Cleared existing data in collection: ${dataset.collectionName}`);

        // --- MODIFIED INSERT AND LOGGING ---
        const insertResult = await DataModel.insertMany(sanitizedRecords);
        console.log(`[SUCCESS] Mongoose reported inserting ${insertResult.length} documents.`);
        
        if (insertResult.length > 0) {
            console.log('[SUCCESS] The _id of the first inserted document is:', insertResult[0]._id);
        }
        // -----------------------------------

        res.status(200).json({
            message: `Successfully loaded ${sanitizedRecords.length} records for '${datasetName}' into the '${dataset.collectionName}' collection.`,
            total_records_in_dataset: totalRecords,
        });

    } catch (error) {
        console.error(`Error loading dataset '${datasetName}':`, error);
        res.status(500).json({ message: "Failed to fetch or store data.", error: error.message });
    }
};