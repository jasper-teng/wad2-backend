require("dotenv").config();
const { getGesSummary, getSchoolSummaryList, getSchoolSummaryNames, getSchoolCoordinatesNames  } = require("../services/ges.service");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

// --- STEP 1: Meta-Intent Router (Context-Free) ---
// This AI call classifies the user's goal *before* we fetch any data.
const metaIntentRouter = {
  systemPrompt: `
You are a high-level routing assistant for an API. Your ONLY job is to classify the user's prompt into one of the following categories, based on their goal.

- "ges_routing": The user is asking about salary, jobs, pay, or a specific university degree (e.g., "smu accountancy", "how much does info systems make?", "NUS computer science salary").
- "school_comparison": The user is asking to compare 2 or more schools (e.g., "compare admiralty primary and ai tong", "admiralty vs ahmad ibrahim primary school").
- "distinct_programme_comparison": The user is asking to compare distinct programmes, CCAs, or special offerings between 2 or more schools (e.g., "compare distinct programmes between Admiralty and Ahmad Ibrahim", "what are the differences in CCAs?").
- "general_question": The user is asking a general question, making small talk, or saying hello (e.g., "hi", "how are you?", "what is this site?").

You must pick only one category.
`,
  responseSchema: {
    type: "OBJECT",
    properties: {
      intent: {
        type: "STRING",
        description: "The single best category for the user's prompt.",
        enum: [
          "ges_routing",
          "school_comparison",
          "distinct_programme_comparison",
          "map_lookup",
          "general_question",
        ],
      },
      // We ask for a reply_message here in case it's a general question,
      // so we can answer in one call.
      reply_message: {
        type: "STRING",
        description:
          "A helpful, natural language reply. If intent is 'general_question', this is the final answer.",
      },
    },
    required: ["intent", "reply_message"],
  },
};

// --- STEP 2: Executor Cases (Context-Aware) ---
// These are the specific, RAG-powered handlers for each intent.
const executorCases = {
  ges_routing: {
    // This prompt is now injected with GES data
    systemPrompt: (contextString) => `
You are a specialized routing assistant for a salary forecast API. Your goal is to convert a user's natural language request into a structured JSON object.

You MUST find the *single best match* from the provided CONTEXT. The CONTEXT is a JSON array of all valid data combinations (university, school, degree).

Your task is to:
1.  Analyze the user's prompt (e.g., "smu accountancy").
2.  Search the CONTEXT for the *single combination* that *best* matches all parts of the user's request.
3.  **CRITICAL RULE: You must prioritize specificity.** Always prefer the record that is *most complete* (i.e., has no 'null' values).
4.  If a good, specific match is found, return its *exact* 'university', 'school', and 'degree' strings.
5.  If the prompt is ambiguous (e.g., "accountancy") or doesn't match, ask for more details.

CONTEXT:
${contextString}
`,
    responseSchema: {
      type: "OBJECT",
      properties: {
        intent: {
          type: "STRING",
          description: "The category of the user's request.",
          enum: ["GET_GES_HISTORY", "ASK_FOR_CLARIFICATION"],
        },
        university: { type: "STRING" },
        school: { type: "STRING" },
        degree: { type: "STRING" },
        reply_message: { type: "STRING" },
      },
      required: ["intent", "reply_message"],
    },
  },
  school_comparison: {
    // This prompt is now injected with School List data
    systemPrompt: (contextString) => `
You are a routing assistant for a school comparison website. Your goal is to identify which schools a user wants to compare for their *general details*.

The CONTEXT is a JSON array of all *valid school names*.

Your task is to:
1.  Analyze the user's prompt (e.g., "compare admiralty primary and ai tong school").
2.  Identify all school names mentioned in the prompt that *exactly match* a name in the CONTEXT.
3.  Collect these matched names into an array.
4.  **CRITICAL RULES:**
    - You MUST find at least 2 schools.
    - You MUST NOT include more than 4 schools.
    - The school names in your response MUST be the *exact* string from the CONTEXT.
5.  If the user asks to compare 2, 3, or 4 valid schools, set the intent to "COMPARE_SCHOOLS".
6.  If the user provides 0, 1, or more than 4 schools, ask for clarification (e.g., "Please tell me which 2 to 4 schools you'd like to compare."). Set intent to "ASK_FOR_CLARIFICATION".

CONTEXT:
${contextString}
`,
    responseSchema: {
      type: "OBJECT",
      properties: {
        intent: {
          type: "STRING",
          enum: ["COMPARE_SCHOOLS", "ASK_FOR_CLARIFICATION"],
        },
        schools_to_compare: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
        reply_message: { type: "STRING" },
      },
      required: ["intent", "reply_message"],
    },
  },
  // --- NEW CASE ADDED HERE ---
  distinct_programme_comparison: {
    // This prompt is also injected with School List data
    systemPrompt: (contextString) => `
You are a routing assistant for a school comparison website. Your goal is to identify which schools a user wants to compare for their *distinct programmes or CCAs*.

The CONTEXT is a JSON array of all *valid school names*.

Your task is to:
1.  Analyze the user's prompt (e.g., "compare distinct programmes between Admiralty and Ai Tong School").
2.  Identify all school names mentioned in the prompt that *exactly match* a name in the CONTEXT.
3.  Collect these matched names into an array.
4.  **CRITICAL RULES:**
    - You MUST find exactly 2 schools.
    - The school names in your response MUST be the *exact* string from the CONTEXT.
5.  If the user asks to compare exactly 2 valid schools, set the intent to "COMPARE_DISTINCT_PROGRAMMES".
6.  If the user provides 0, 1, or more than 2 schools, ask for clarification (e.g., "Please tell me which 2 schools you'd like to compare for their distinct programmes."). Set intent to "ASK_FOR_CLARIFICATION".

CONTEXT:
${contextString}
`,
    responseSchema: {
      type: "OBJECT",
      properties: {
        intent: {
          type: "STRING",
          enum: ["COMPARE_DISTINCT_PROGRAMMES", "ASK_FOR_CLARIFICATION"],
        },
        schools_to_compare: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
        reply_message: { type: "STRING" },
      },
      required: ["intent", "reply_message"],
    },
  },
  map_lookup: {
    systemPrompt: (contextString) => `
You are a routing assistant for a map page. Identify which single school the user wants to view on the map.

The CONTEXT is a JSON array of all *valid school names* (from schoolCoordinates.json).

Your task:
1. Analyze the user's prompt (e.g., "show me ai tong on the map").
2. Identify the single school name that exactly matches a name in the CONTEXT.
3. **CRITICAL RULES:**
   - You MUST return exactly one school if you find a valid match.
   - The school in your response MUST be the exact string from the CONTEXT.
4. If you cannot confidently find exactly one valid school, ask for clarification.

CONTEXT:
${contextString}
`,
    responseSchema: {
      type: "OBJECT",
      properties: {
        intent: {
          type: "STRING",
          enum: ["OPEN_MAP", "ASK_FOR_CLARIFICATION"],
        },
        school: { type: "STRING" },
        reply_message: { type: "STRING" },
      },
      required: ["intent", "reply_message"],
    },
  },
};

/**
 * @desc    Analyze a user's prompt and return a structured action.
 * This now uses a 2-step AI process.
 * @route   POST /api/ai/prompt
 */
exports.generateRouteFromPrompt = async (req, res) => {
  // The frontend ONLY needs to send the prompt.
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ message: "Prompt is required." });
  }

  try {
    // --- STEP 1: Call the Meta-Intent Router ---
    console.log(`[AI Step 1] Routing prompt: "${prompt}"`);
    const routerPayload = {
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: metaIntentRouter.systemPrompt }],
      },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: metaIntentRouter.responseSchema,
        temperature: 0.0,
      },
    };

    const routerApiResponse = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(routerPayload),
    });

    if (!routerApiResponse.ok) {
      throw new Error(
        `[AI Step 1] Gemini API Error: ${await routerApiResponse.text()}`
      );
    }

    const routerResult = await routerApiResponse.json();
    const routerText = routerResult.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!routerText) {
      throw new Error("[AI Step 1] Failed to parse router response.");
    }

    const routerData = JSON.parse(routerText);
    const detectedIntent = routerData.intent;
    console.log(`[AI Step 1] Detected intent: ${detectedIntent}`);

    // --- Handle "general_question" immediately (no 2nd call needed) ---
    if (detectedIntent === "general_question") {
      return res.status(200).json({
        action_type: "GENERAL_INFO",
        api_route: null,
        message: routerData.reply_message, // Use the reply from Step 1
      });
    }

    // --- STEP 2: Fetch Context & Call Specific Executor ---

    // 2a. Select the correct executor and fetch its RAG context
    const executorCase = executorCases[detectedIntent];
    let contextData;

    if (detectedIntent === "ges_routing") {
      contextData = await getGesSummary();
    } else if (detectedIntent === "school_comparison") {
      contextData = await getSchoolSummaryList();
    } else if (detectedIntent === "distinct_programme_comparison") {
      contextData = await getSchoolSummaryNames();
    } else if (detectedIntent === "map_lookup") {
      contextData = await getSchoolCoordinatesNames();
    }

    if (!contextData || contextData.length === 0) {
      throw new Error(`[AI Step 2] Failed to load RAG context for ${detectedIntent}`);
    }

    const contextString = JSON.stringify(contextData, null, 2);

    // 2b. Build and send the second, context-aware payload
    console.log(`[AI Step 2] Executing intent: ${detectedIntent}`);
    const executorPayload = {
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: executorCase.systemPrompt(contextString) }],
      },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: executorCase.responseSchema,
        temperature: 0.0,
      },
    };

    const executorApiResponse = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(executorPayload),
    });

    if (!executorApiResponse.ok) {
      throw new Error(
        `[AI Step 2] Gemini API Error: ${await executorApiResponse.text()}`
      );
    }

    const executorResult = await executorApiResponse.json();
    const executorText =
      executorResult.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!executorText) {
      throw new Error("[AI Step 2] Failed to parse executor response.");
    }

    // 2c. Process the FINAL structured response
    const aiData = JSON.parse(executorText);
    console.log(`[AI Step 2] Final action: ${aiData.intent}`);

    switch (aiData.intent) {
      case "GET_GES_HISTORY":
        const { university, school, degree } = aiData;
        if (university && school && degree) {
          const apiRoute = `/ges/${encodeURIComponent(
            university
          )}/${encodeURIComponent(school)}/${encodeURIComponent(degree)}`;
          res.status(200).json({
            action_type: "API_CALL",
            api_route: apiRoute,
            message: aiData.reply_message,
          });
        } else {
          // This shouldn't happen if the prompt is good, but it's a fallback.
          res.status(200).json({
            action_type: "ASK_USER",
            api_route: null,
            message: aiData.reply_message,
          });
        }
        break;

      case "COMPARE_SCHOOLS":
        const schoolsToCompare = aiData.schools_to_compare;
        if (
          Array.isArray(schoolsToCompare) &&
          schoolsToCompare.length >= 2 &&
          schoolsToCompare.length <= 4
        ) {
          // Build the query string with custom formatting
          const queryString = schoolsToCompare
            .map((name, index) => {
              // 1. Uppercase, 2. URL encode, 3. Replace %20 with +
              const formattedName = encodeURIComponent(
                name.toUpperCase()
              ).replace(/%20/g, "+");
              return `school${index + 1}=${formattedName}`;
            })
            .join("&");
          res.status(200).json({
            action_type: "API_CALL",
            api_route: `/comparison?${queryString}`,
            message: aiData.reply_message,
          });
        } else {
          // Fallback if AI executor fails
          res.status(200).json({
            action_type: "ASK_USER",
            api_route: null,
            message: "I seem to have an error. Which 2 to 4 schools would you like to compare?",
          });
        }
        break;

      // --- NEW SWITCH CASE ADDED HERE ---
      case "COMPARE_DISTINCT_PROGRAMMES":
        const schools = aiData.schools_to_compare;
        if (
          Array.isArray(schools) &&
          schools.length === 2
        ) {
          // Build the query string with custom formatting
          const queryString = schools
            .map((name, index) => {
              // 1. Uppercase, 2. URL encode, 3. Replace %20 with +
              const formattedName = encodeURIComponent(
                name.toUpperCase()
              ).replace(/%20/g, "+");
              return `school${index + 1}=${formattedName}`;
            })
            .join("&");
          res.status(200).json({
            action_type: "API_CALL",
            api_route: `/distinctProgramme?${queryString}`, // <-- NEW API ROUTE
            message: aiData.reply_message,
          });
        } else {
          // Fallback if AI executor fails
          res.status(200).json({
            action_type: "ASK_USER",
            api_route: null,
            message: "I seem to have an error. Which 2 schools would you like to compare for their distinct programmes?",
          });
        }
        break;
      case "OPEN_MAP": {
        const { school } = aiData;
        if (school) {
          const schoolParam = encodeURIComponent(school.toUpperCase()).replace(/%20/g, "+");
          return res.status(200).json({
            action_type: "API_CALL",
            api_route: `/map?school=${schoolParam}`, // caller can append &source=380124
            message: aiData.reply_message,
          });
        } else {
          return res.status(200).json({
            action_type: "ASK_USER",
            api_route: null,
            message: "Which school would you like to view on the map?",
          });
        }
      }

      case "ASK_FOR_CLARIFICATION":
        res.status(200).json({
          action_type: "ASK_USER",
          api_route: null,
          message: aiData.reply_message,
        });
        break;

      default:
        res.status(500).json({
          message: "AI returned an unknown final intent.",
          data: aiData,
        });
    }
  } catch (error) {
    console.error("Error in generateRouteFromPrompt:", error);
    let rawResponse = "No raw response captured";
    if (error instanceof SyntaxError && error.message.includes("JSON")) {
      // This error doesn't have access to the 'text' variable from the try block
      // so we rely on the console log.
      rawResponse = "See console for raw text that caused JSON parse error.";
    }
    res
      .status(500)
      .json({
        message: "Server error.",
        error: error.message || error,
        raw_response: rawResponse,
      });
  }
};