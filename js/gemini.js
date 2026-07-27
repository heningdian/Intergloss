/**
 * Autogloss — Gemini client.
 *
 * Calls the Gemini API directly from the browser using a key the visitor
 * supplies themselves. The key is kept in localStorage on their device and is
 * sent only to generativelanguage.googleapis.com; this project has no backend
 * and never sees it.
 */

const GEMINI_KEY_STORAGE = "autogloss:apiKey";
const GEMINI_MODEL_STORAGE = "autogloss:model";
const DEFAULT_MODEL = "gemini-2.5-flash";

const GEMINI_MODELS = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash — fast, free tier friendly" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro — slower, best for hard languages" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash — older, widely available" },
];

// Response shape we ask Gemini to conform to. Segmentation comes back as a
// delimiter-bearing string so the app's own parser stays the single source of
// truth for how morphemes are split.
const GLOSS_SCHEMA = {
  type: "OBJECT",
  properties: {
    detectedLanguage: { type: "STRING" },
    words: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          segmented: { type: "STRING" },
          glosses: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["segmented", "glosses"],
      },
    },
    translation: { type: "STRING" },
    note: { type: "STRING" },
  },
  required: ["words", "translation"],
};

function buildSystemInstruction() {
  const abbrevs = LEIPZIG_ABBREVIATIONS.map((a) => a.abbr).join(", ");
  return [
    "You are a descriptive linguist producing interlinear morpheme glosses that follow the Leipzig Glossing Rules.",
    "",
    "For the sentence you are given:",
    "1. Split it into orthographic words, preserving their original order.",
    "2. Within each word, mark morpheme boundaries: '-' for affix boundaries and '=' for clitic boundaries. Leave a word unsegmented if it is monomorphemic.",
    "3. Give exactly one gloss per morpheme, in order, in the 'glosses' array. The number of glosses MUST equal the number of morphemes produced by your segmentation.",
    "4. Gloss lexical morphemes with a lowercase English word (e.g. read, house, big).",
    "5. Gloss grammatical morphemes with an uppercase Leipzig abbreviation. Join categories that share one morpheme with a dot, e.g. 3SG.POSS.",
    "6. Provide a natural English free translation of the whole sentence.",
    "",
    `Prefer these standard abbreviations where they apply: ${abbrevs}.`,
    "",
    "Be accurate rather than confident: if the language is under-documented or the analysis is uncertain, still give your best segmentation, and explain the uncertainty briefly in 'note'. Never invent morpheme boundaries that the language does not have.",
  ].join("\n");
}

function buildUserPrompt(sentence, languageHint) {
  const lines = [];
  if (languageHint && languageHint.trim()) {
    lines.push(`Language: ${languageHint.trim()}`);
  } else {
    lines.push("Language: not specified — identify it yourself and report it in 'detectedLanguage'.");
  }
  lines.push("");
  lines.push("Sentence to gloss:");
  lines.push(sentence.trim());
  return lines.join("\n");
}

/** Turns a Gemini error payload into something a human can act on. */
function describeApiError(status, payload) {
  const raw = payload && payload.error && payload.error.message ? payload.error.message : "";
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(raw)) {
    return "That API key was rejected. Check you copied the whole key from Google AI Studio.";
  }
  if (status === 403) {
    return "Access denied for this key. Make sure the Generative Language API is enabled for it, and that any HTTP-referrer restriction allows this site.";
  }
  if (status === 429) {
    return "Rate limit or quota reached for this key. Wait a moment and try again, or switch to a lighter model.";
  }
  if (status === 404) {
    return "That model isn't available to this key. Try a different model from the dropdown.";
  }
  if (status >= 500) {
    return "Google's servers returned an error. This is usually temporary — try again shortly.";
  }
  return raw || `Request failed (HTTP ${status}).`;
}

/**
 * Sends the sentence to Gemini and returns the parsed draft.
 * @returns {Promise<{words: Array<{segmented: string, glosses: string[]}>, translation: string, detectedLanguage?: string, note?: string}>}
 */
async function requestGloss({ apiKey, model, sentence, languageHint, signal }) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: buildSystemInstruction() }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(sentence, languageHint) }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: GLOSS_SCHEMA,
    },
  };

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    throw new Error("Could not reach Google. Check your internet connection and try again.");
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    throw new Error(`Unexpected response from Google (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(describeApiError(response.status, payload));
  }

  if (payload.promptFeedback && payload.promptFeedback.blockReason) {
    throw new Error(`Gemini declined to process this sentence (${payload.promptFeedback.blockReason}).`);
  }

  const candidate = payload.candidates && payload.candidates[0];
  if (!candidate) {
    throw new Error("Gemini returned no result. Try rephrasing or try again.");
  }
  if (candidate.finishReason && !["STOP", "MAX_TOKENS"].includes(candidate.finishReason)) {
    throw new Error(`Gemini stopped early (${candidate.finishReason}). Try again or use a different model.`);
  }

  const text =
    candidate.content &&
    candidate.content.parts &&
    candidate.content.parts.map((p) => p.text || "").join("");
  if (!text) {
    throw new Error("Gemini returned an empty result. Try again.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error("Gemini's response wasn't valid JSON. Try again, or switch models.");
  }

  if (!parsed || !Array.isArray(parsed.words) || parsed.words.length === 0) {
    throw new Error("Gemini's response didn't contain any glossed words. Try again.");
  }

  return parsed;
}

/**
 * Converts a Gemini draft into the snapshot shape the editor loads.
 * Glosses are zipped onto morphemes by position; any length mismatch degrades
 * gracefully (extra morphemes get an empty gloss, extra glosses are dropped)
 * so a slightly off response still yields an editable draft.
 */
function draftToSnapshot(draft, originalSentence) {
  const words = draft.words
    .filter((w) => w && typeof w.segmented === "string" && w.segmented.trim() !== "")
    .map((w) => {
      const segText = w.segmented.trim();
      const morphemes = window.GlossApp.parseSegText(segText);
      const glosses = Array.isArray(w.glosses) ? w.glosses : [];
      morphemes.forEach((m, i) => {
        m.gloss = typeof glosses[i] === "string" ? glosses[i].trim() : "";
      });
      return { segText, morphemes };
    });

  return {
    sentence: originalSentence,
    words,
    translation: typeof draft.translation === "string" ? draft.translation.trim() : "",
  };
}

function loadStoredKey() {
  try {
    return localStorage.getItem(GEMINI_KEY_STORAGE) || "";
  } catch (err) {
    return "";
  }
}

function storeKey(key) {
  try {
    if (key) localStorage.setItem(GEMINI_KEY_STORAGE, key);
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch (err) {
    /* storage unavailable — key simply won't persist */
  }
}

function loadStoredModel() {
  try {
    return localStorage.getItem(GEMINI_MODEL_STORAGE) || DEFAULT_MODEL;
  } catch (err) {
    return DEFAULT_MODEL;
  }
}

function storeModel(model) {
  try {
    localStorage.setItem(GEMINI_MODEL_STORAGE, model);
  } catch (err) {
    /* storage unavailable */
  }
}
