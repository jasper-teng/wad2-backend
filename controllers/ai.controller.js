require("dotenv").config();
const { getGesSummary } = require("../services/ges.service"); // Import the (new) helper

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

// --- Maintainable list of AI "intents" or "cases" ---
const intentCases = {
  ges_routing: {
    systemPrompt: (contextString) => `
You are a specialized routing assistant for a salary forecast API. Your goal is to convert a user's natural language request into a structured JSON object.

You MUST find the *single best match* from the provided CONTEXT. The CONTEXT is a JSON array of all valid data combinations, sorted by data availability (most records first).

Your task is to:
1.  Analyze the user's prompt (e.g., "smu accountancy").
2.  Search the CONTEXT for the *single combination* that *best* matches all parts of the user's request.
3.  **CRITICAL RULE: You must prioritize specificity.** If you find multiple matches, always prefer the record that is *most complete* (i.e., has no 'null' values).
4.  For example, if the user prompt is "smu accountancy" and the CONTEXT contains these two entries:
    - {"university": "Singapore Management University", "school": "School of Accountancy", "degree": "Accountancy", "recordCount": 10}
    - {"university": "Singapore Management University", "school": null, "degree": "Accountancy", "recordCount": 11}
    You MUST choose the *first* entry ("School of Accountancy") because it is more specific, even if the recordCount is slightly lower.
5.  If a good, specific match is found, return its *exact* 'university', 'school', and 'degree' strings.
6.  If the prompt is ambiguous (e.g., just "accountancy" with no university) or doesn't match any entry, ask for more details.
7.  If the prompt is a greeting or general question, set the intent to "GENERAL_QUESTION".

CONTEXT:
${contextString}
`,
    // This schema forces Gemini to return the JSON we want
    responseSchema: {
      type: "OBJECT",
      properties: {
        intent: {
          type: "STRING",
          description: "The category of the user's request.",
          enum: ["GET_GES_HISTORY", "ASK_FOR_CLARIFICATION", "GENERAL_QUESTION"],
        },
        university: {
          type: "STRING",
          description: "The *exact* university name from the CONTEXT.",
        },
        school: {
          type: "STRING",
          description: "The *exact* school name from the CONTEXT.",
        },
        degree: {
          type: "STRING",
          description: "The *exact* degree name from the CONTEXT.",
        },
        reply_message: {
          type: "STRING",
          description:
            "A helpful, natural language reply or clarifying question.",
        },
      },
      required: ["intent", "reply_message"],
    },
  },
  // You can add more cases here in the future
  // general_chat: { ... }
};

/**
 * @desc    Analyze a user's prompt and return a structured action for the frontend.
 * @route   POST /api/ai/route-from-prompt
 */
exports.generateRouteFromPrompt = async (req, res) => {
  const { prompt, intentName = "ges_routing" } = req.body;

  if (!prompt) {
    return res.status(400).json({ message: "Prompt is required." });
  }

  try {
    // --- 1. RAG: Get fresh data from our database ---
    const gesCombinations = await getGesSummary();
    if (gesCombinations.length === 0) {
      return res.status(500).json({ message: "Failed to load AI context." });
    }

    // Convert the array of objects into a JSON string for the prompt
    const gesContextString = JSON.stringify(gesCombinations, null, 2);

    // --- 2. Select the "case" and build the payload ---
    const intentCase = intentCases[intentName];
    // Pass the new stringified context to the prompt generator
    const systemPrompt = intentCase.systemPrompt(gesContextString);

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: intentCase.responseSchema,
        temperature: 0.0, // Set to 0 for deterministic, rule-based output
      },
    };

    // --- 3. Call Gemini API ---
    const apiResponse = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error("Gemini API Error:", errorText);
      return res
        .status(500)
        .json({ message: "Error from Gemini API.", error: errorText });
    }

    const result = await apiResponse.json();
    const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      return res.status(500).json({ message: "Failed to parse AI response." });
    }

    // --- 4. Process the structured JSON response ---
    const aiData = JSON.parse(aiText);

    // This is the "second response" logic you mentioned
    switch (aiData.intent) {
      case "GET_GES_HISTORY":
        const { university, school, degree } = aiData;
        if (university && school && degree) {
          // Build the exact API route the frontend should call
          const apiRoute = `/ges/${encodeURIComponent(
            university
          )}/${encodeURIComponent(school)}/${encodeURIComponent(degree)}`;

          res.status(200).json({
            action_type: "API_CALL",
            api_route: apiRoute,
            message: aiData.reply_message,
          });
        } else {
          // AI is asking for more info
          res.status(200).json({
            action_type: "ASK_USER",
            api_route: null,
            message: aiData.reply_message,
          });
        }
        break;

      case "ASK_FOR_CLARIFICATION":
        res.status(200).json({
          action_type: "ASK_USER",
          api_route: null,
          message: aiData.reply_message,
        });
        break;

      case "GENERAL_QUESTION":
        res.status(200).json({
          action_type: "GENERAL_INFO",
          api_route: null,
          message: aiData.reply_message,
        });
        break;

      default:
        res.status(500).json({
          message: "AI returned an unknown intent.",
          data: aiData,
        });
    }
  } catch (error) {
    console.error("Error in generateRouteFromPrompt:", error);
    res
      .status(500)
      .json({ message: "Server error.", error: error.message || error });
  }
};