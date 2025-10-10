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
  {
    name: "gdpindustryquarterly",
    resource_id: "d_6d144381f0f4b775e29364b85f04b9af", // gdp by industry quarterly
    collectionName: "gdp_industry_qtr",
  },
  {
    name: "medianincome",
    resource_id: "d_9cd9c40f22a4e45cac8f8b9d895fd5ce", // gdp by industry quarterly
    collectionName: "median_monthly_income",
  },
];

/**
 * Fetches a dataset by its friendly name, clears the corresponding collection,
 * and inserts the new records.
 */
exports.loadDataset = async (req, res) => {
  const { datasetName } = req.params;
  const dataset = datasets.find((d) => d.name === datasetName);

  if (!dataset) {
    return res
      .status(404)
      .json({ message: "Dataset not found in the configured list." });
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
      for (
        let offset = BATCH_SIZE;
        offset < totalRecords;
        offset += BATCH_SIZE
      ) {
        const pageUrl = `${DATA_GOV_BASE_URL}${dataset.resource_id}&limit=${BATCH_SIZE}&offset=${offset}`;
        fetchPromises.push(fetch(pageUrl).then((res) => res.json()));
      }

      const additionalPages = await Promise.all(fetchPromises);
      additionalPages.forEach((pageData) => {
        if (pageData.success)
          allRecords = allRecords.concat(pageData.result.records);
      });
    }

    console.log(
      `[DEBUG] Total records fetched from API: ${allRecords.length}.`
    );

    const sanitizedRecords = allRecords.map((record) => {
      const { _id, ...rest } = record;
      return rest;
    });

    // --- ADD THIS LOG ---
    if (sanitizedRecords.length > 0) {
      console.log(
        "[DEBUG] Sample sanitized record (first one):",
        JSON.stringify(sanitizedRecords[0], null, 2)
      );
    }
    // --------------------

    const DataModel = getModel(dataset.collectionName);

    await DataModel.deleteMany({});
    console.log(
      `Cleared existing data in collection: ${dataset.collectionName}`
    );

    // --- MODIFIED INSERT AND LOGGING ---
    const insertResult = await DataModel.insertMany(sanitizedRecords);
    console.log(
      `[SUCCESS] Mongoose reported inserting ${insertResult.length} documents.`
    );

    if (insertResult.length > 0) {
      console.log(
        "[SUCCESS] The _id of the first inserted document is:",
        insertResult[0]._id
      );
    }
    // -----------------------------------

    res.status(200).json({
      message: `Successfully loaded ${sanitizedRecords.length} records for '${datasetName}' into the '${dataset.collectionName}' collection.`,
      total_records_in_dataset: totalRecords,
    });
  } catch (error) {
    console.error(`Error loading dataset '${datasetName}':`, error);
    res.status(500).json({
      message: "Failed to fetch or store data.",
      error: error.message,
    });
  }
};

// // NEWS API -----------
// const { DateTime } = require("luxon");

// // ---------- NewsAPI helpers ----------
// const NEWS_API_KEY = process.env.NEWS_API;
// const NEWS_WINDOW_DAYS = parseInt(process.env.NEWS_WINDOW_DAYS || "30", 10);
// const NEWS_PAGE_SIZE = Math.min(parseInt(process.env.NEWS_PAGE_SIZE || "100", 10), 100);
// const NEWS_MAX_PAGES = parseInt(process.env.NEWS_MAX_PAGES || "5", 10);
// const NEWS_DOMAINS = (process.env.NEWS_DOMAINS || "").split(",").map(s => s.trim()).filter(Boolean);
// const NEWS_SOURCES = (process.env.NEWS_SOURCES || "").split(",").map(s => s.trim()).filter(Boolean);

// // ---------- Career-focused filtering ----------
// const POSITIVE_RE = new RegExp(
//   [
//     // core career / jobs
//     "\\b(job|jobs|career|careers|hiring|hire|recruit|recruitment|vacancy|vacancies|employment|workforce|placement|talent)\\b",
//     // compensation
//     "\\b(salary|salaries|wage|wages|pay|compensation|remuneration)\\b",
//     // early-career / graduate
//     "\\b(graduate|graduates|fresh\\s+grad|entry[-\\s]?level|early\\s+career|trainee|traineeship|apprenticeship|internship|internships|management\\s+associate|graduate\\s+program(me)?)\\b",
//     // campus / fairs / schemes
//     "\\b(career\\s+fair|job\\s+fair|campus\\s+(hiring|recruit(ment)?)|work[-\\s]?study|SkillsFuture)\\b"
//   ].join("|"),
//   "i"
// );

// const NEGATIVE_RE = new RegExp(
//   [
//     "\\b(sport|football|soccer|tennis|golf|F1|match|fixture|league|tournament|coach|player|wins|defeats|preview|line[-\\s]?up)\\b",
//     "\\b(entertainment|celebrity|movie|film|music|concert|K-pop|drama|idol)\\b",
//     "\\b(crypto|bitcoin|blockchain|token|NFT)\\b",
//     "\\b(weather|traffic|lottery|horoscope)\\b"
//   ].join("|"),
//   "i"
// );

// function isCareerArticle(a) {
//   const text = `${a.title || ""} ${a.description || ""}`.trim();
//   if (!text) return false;
//   if (NEGATIVE_RE.test(text)) return false;
//   return POSITIVE_RE.test(text);
// }

// // ---------- Everything query builder with batching ----------
// // Forces (Grad/Early) AND (Career/Jobs) AND (Singapore). If options.noDomains = true, it omits domains/sources.
// function buildEverythingQueries(options = {}) {
//   const GRAD_EARLY = [
//     "graduate","graduates","\"fresh grad\"","\"fresh graduate\"",
//     "\"entry level\"","\"entry-level\"","\"early career\"",
//     "trainee","traineeship","apprenticeship",
//     "\"management associate\"","internship","internships",
//     "\"graduate program\"","\"graduate programme\"",
//     "\"career fair\"","\"job fair\"","\"work-study\"","\"work study\"","SkillsFuture"
//   ];

//   const CAREER_JOBS = [
//     "career","careers","job","jobs","hiring","hire",
//     "recruit","recruitment","vacancy","vacancies",
//     "employment","workforce","placement","talent",
//     "salary","salaries","wage","wages","pay","compensation","remuneration"
//   ];

//   const GEO_TERMS = ["Singapore","SG"];

//   // Build (grad AND career AND (Singapore OR SG)) clauses, then OR them in batches
//   const pairs = [];
//   for (const grad of GRAD_EARLY) {
//     for (const career of CAREER_JOBS) {
//       pairs.push({ grad, career });
//     }
//   }

//   const MAX_Q_LEN = 480; // safety margin (< 500)
//   function groupPairs(pairsArr) {
//     const batches = [];
//     let current = [];
//     let len = 0;
//     for (const p of pairsArr) {
//       const clause = `(${p.grad}) AND (${p.career}) AND (${GEO_TERMS.join(" OR ")})`;
//       const addLen = (current.length ? 4 : 0) + clause.length; // + ' OR '
//       if (len + addLen > MAX_Q_LEN) {
//         if (current.length) batches.push(current.join(" OR "));
//         current = [clause];
//         len = clause.length;
//       } else {
//         current.push(clause);
//         len += addLen;
//       }
//     }
//     if (current.length) batches.push(current.join(" OR "));
//     return batches;
//   }

//   const qBatches = groupPairs(pairs);

//   const to = DateTime.utc().toISODate();
//   const from = DateTime.utc().minus({ days: NEWS_WINDOW_DAYS }).toISODate();

//   return qBatches.map(q => {
//     const params = new URLSearchParams({
//       q,
//       from,
//       to,
//       language: "en",
//       sortBy: "publishedAt",
//       searchIn: "title,description",
//       pageSize: String(NEWS_PAGE_SIZE),
//     });
//     params.set("qInTitle", "graduate OR graduates OR career");

//     if (!options.noDomains) {
//       if (NEWS_DOMAINS.length) params.set("domains", NEWS_DOMAINS.join(","));
//       if (NEWS_SOURCES.length) params.set("sources", NEWS_SOURCES.join(","));
//     }
//     return params;
//   });
// }

// // A looser fallback query: (graduate OR internship OR traineeship) AND (Singapore)
// function buildFallbackQueries(options = {}) {
//   const TERMS = [
//     "graduate","graduates","internship","internships",
//     "\"fresh grad\"","\"fresh graduate\"","traineeship","trainee",
//     "\"entry level\"","\"entry-level\"","\"early career\"","SkillsFuture"
//   ];
//   const GEO_TERMS = ["Singapore","SG"];

//   // Split the TERMS list into a few manageable OR-batches
//   const MAX_Q_LEN = 480;
//   const batches = [];
//   let current = [];
//   let len = 0;
//   for (const t of TERMS) {
//     const addLen = (current.length ? 4 : 0) + t.length; // ' OR '
//     if (len + addLen > MAX_Q_LEN) {
//       batches.push(current.join(" OR "));
//       current = [t];
//       len = t.length;
//     } else {
//       current.push(t);
//       len += addLen;
//     }
//   }
//   if (current.length) batches.push(current.join(" OR "));

//   const to = DateTime.utc().toISODate();
//   const from = DateTime.utc().minus({ days: NEWS_WINDOW_DAYS }).toISODate();

//   return batches.map(orStr => {
//     const q = `(${orStr}) AND (${GEO_TERMS.join(" OR ")})`;
//     const params = new URLSearchParams({
//       q,
//       from,
//       to,
//       language: "en",
//       sortBy: "publishedAt",
//       searchIn: "title,description",
//       pageSize: String(NEWS_PAGE_SIZE),
//     });
//     params.set("qInTitle", "graduate OR graduates OR internship");
//     if (!options.noDomains) {
//       if (NEWS_DOMAINS.length) params.set("domains", NEWS_DOMAINS.join(","));
//       if (NEWS_SOURCES.length) params.set("sources", NEWS_SOURCES.join(","));
//     }
//     return params;
//   });
// }

// function buildTopHeadlinesQuery(page = 1) {
//   const params = new URLSearchParams({
//     country: "sg",
//     category: "business",
//     pageSize: String(NEWS_PAGE_SIZE),
//     page: String(page),
//   });
//   return params;
// }

// // Normalizer to keep only what we need + a few NLP-ready fields
// function normalizeArticle(a) {
//   return {
//     source_id: a.source?.id || null,
//     source_name: a.source?.name || null,
//     author: a.author || null,
//     title: a.title || null,
//     description: a.description || null,
//     url: a.url,
//     urlToImage: a.urlToImage || null,
//     publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
//     content: a.content || null,
//     // Derived fields to fill later during NLP:
//     sector_tags: [],
//     sentiment_score: null,
//     policy_flag: false,
//     fetched_at: new Date(),
//     provider: "newsapi",
//   };
// }

// // Upsert by (url + publishedAt) to avoid duplicates
// function toUpsertOps(collectionName, articles) {
//   return articles.map(doc => ({
//     updateOne: {
//       filter: { url: doc.url, publishedAt: doc.publishedAt },
//       update: { $set: doc },
//       upsert: true,
//     }
//   }));
// }

// // ---------- Controller: fetch Singapore job news ----------
// exports.fetchSingaporeJobNews = async (req, res) => {
//   if (!NEWS_API_KEY) {
//     return res.status(400).json({ message: "NEWS_API not configured in environment." });
//   }

//   const NewsModel = getModel("news_raw");

//   async function runBatches(paramSets, label) {
//     let affected = 0;
//     let candidates = 0;

//     for (const params of paramSets) {
//       for (let page = 1; page <= NEWS_MAX_PAGES; page++) {
//         const url = `https://newsapi.org/v2/everything?${params.toString()}&page=${page}`;
//         const r = await fetch(url, { headers: { "X-Api-Key": NEWS_API_KEY } });
//         const json = await r.json();

//         if (json.status !== "ok") {
//           console.error(`[NewsAPI everything ${label}] error payload:`, json);
//           break; // go to next batch
//         }

//         const rawCount = (json.articles || []).length;
//         const filtered = (json.articles || []).map(normalizeArticle).filter(isCareerArticle);
//         candidates += rawCount;

//         console.log(`[DEBUG][${label}] page=${page} raw=${rawCount} kept=${filtered.length}`);

//         if (!filtered.length) {
//           if (rawCount < NEWS_PAGE_SIZE) break; // no more pages
//           continue; // next page
//         }

//         const ops = toUpsertOps("news_raw", filtered);
//         if (ops.length) {
//           const result = await NewsModel.bulkWrite(ops, { ordered: false });
//           const upserts = result.upsertedCount || 0;
//           const mods = result.modifiedCount || 0;
//           affected += upserts + mods;
//         }

//         if (rawCount < NEWS_PAGE_SIZE) break; // end of pages for this batch
//       }
//     }

//     return { affected, candidates };
//   }

//   try {
//     let totalAffected = 0;
//     let totalCandidates = 0;

//     // Pass 1: strict career AND grad, with domains (if provided)
//     const strictWithDomains = buildEverythingQueries({ noDomains: false });
//     const r1 = await runBatches(strictWithDomains, "strict+domains");
//     totalAffected += r1.affected; totalCandidates += r1.candidates;

//     // If nothing, Pass 2: strict career AND grad, but WITHOUT domains (wider sources)
//     if (totalAffected === 0) {
//       const strictNoDomains = buildEverythingQueries({ noDomains: true });
//       const r2 = await runBatches(strictNoDomains, "strict-noDomains");
//       totalAffected += r2.affected; totalCandidates += r2.candidates;
//     }

//     // If still nothing, Pass 3: fallback (grad-ish) WITHOUT domains
//     if (totalAffected === 0) {
//       const fallbackNoDomains = buildFallbackQueries({ noDomains: true });
//       const r3 = await runBatches(fallbackNoDomains, "fallback-noDomains");
//       totalAffected += r3.affected; totalCandidates += r3.candidates;
//     }

//     // Top-Headlines (country=sg) also benefits from post-filter; keep it last
//     for (let page = 1; page <= NEWS_MAX_PAGES; page++) {
//       const params = buildTopHeadlinesQuery(page);
//       const url = `https://newsapi.org/v2/top-headlines?${params.toString()}`;
//       const r = await fetch(url, { headers: { "X-Api-Key": NEWS_API_KEY } });
//       const json = await r.json();

//       if (json.status !== "ok") {
//         console.error("[NewsAPI top-headlines] error payload:", json);
//         break;
//       }

//       const rawCount = (json.articles || []).length;
//       const articles = (json.articles || []).map(normalizeArticle).filter(isCareerArticle);
//       totalCandidates += rawCount;

//       console.log(`[DEBUG][top-headlines] page=${page} raw=${rawCount} kept=${articles.length}`);

//       if (!articles.length) {
//         if (rawCount < NEWS_PAGE_SIZE) break;
//         continue;
//       }

//       const ops = toUpsertOps("news_raw", articles);
//       if (ops.length) {
//         const result = await NewsModel.bulkWrite(ops, { ordered: false });
//         const upserts = result.upsertedCount || 0;
//         const mods = result.modifiedCount || 0;
//         totalAffected += upserts + mods;
//       }

//       if (rawCount < NEWS_PAGE_SIZE) break;
//     }

//     return res.status(200).json({
//       message: "Fetched Singapore graduate/career news from NewsAPI.",
//       affected: totalAffected,
//       examined_articles: totalCandidates
//     });
//   } catch (err) {
//     console.error("fetchSingaporeJobNews error:", err);
//     return res.status(500).json({ message: "Failed to fetch or store news.", error: String(err?.message || err) });
//   }
// };
