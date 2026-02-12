(function () {
  const STOP_WORDS = new Set([
    "the", "and", "for", "that", "with", "this", "from", "have", "your", "you", "our",
    "are", "was", "were", "their", "will", "into", "about", "there", "what", "when",
    "where", "which", "while", "been", "being", "them", "they", "then", "than", "does",
    "did", "done", "through", "these", "those", "after", "before", "because", "under",
    "over", "within", "without", "would", "could", "should", "may", "might", "must",
    "unto", "upon", "said", "says", "his", "her", "him", "she", "has", "had", "not",
    "but", "all", "any", "each", "every", "who", "whom", "whose", "how", "why", "can",
    "also", "therefore", "thus", "therein", "thereof", "it", "its"
  ]);

  const FALLBACK_PASSAGES = {
    "john 3:16": {
      reference: "John 3:16",
      text: "For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life.",
      translation_name: "WEB"
    },
    "romans 12:1-2": {
      reference: "Romans 12:1-2",
      text: "I urge you therefore, brothers, by the mercies of God, to present your bodies a living sacrifice, holy, acceptable to God, which is your spiritual service. Don't be conformed to this world, but be transformed by the renewing of your mind, so that you may prove what is the good, well-pleasing, and perfect will of God.",
      translation_name: "WEB"
    },
    "psalm 23": {
      reference: "Psalm 23",
      text: "The LORD is my shepherd: I shall lack nothing. He makes me lie down in green pastures. He leads me beside still waters. He restores my soul.",
      translation_name: "WEB"
    }
  };
  const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";
  disableLegacyServiceWorkers();

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeReference(reference) {
    return String(reference || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function parseChapterRangeReference(reference) {
    const clean = String(reference || "").trim();
    if (!clean || clean.includes(":")) {
      return null;
    }

    const match = clean.match(/^(.+?)\s+(\d{1,3})\s*-\s*(\d{1,3})$/i);
    if (!match) {
      return null;
    }

    const book = match[1].trim();
    const start = Number(match[2]);
    const end = Number(match[3]);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return null;
    }

    const span = end - start + 1;
    if (span < 2) {
      return null;
    }

    if (span > 12) {
      return {
        book,
        start,
        end,
        references: [],
        tooLarge: true
      };
    }

    const references = [];
    for (let chapter = start; chapter <= end; chapter += 1) {
      references.push(`${book} ${chapter}`);
    }

    return {
      book,
      start,
      end,
      references,
      tooLarge: false
    };
  }

  async function fetchBibleApiPassage(reference) {
    const clean = String(reference || "").trim();
    const url = `https://bible-api.com/${encodeURIComponent(clean)}?translation=web`;

    let response;
    try {
      response = await fetch(url);
    } catch (_) {
      throw new Error("Unable to reach Bible API right now.");
    }

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (!response.ok || data.error) {
      const detail = cleanString(data.detail);
      const apiError = cleanString(data.error);
      const message =
        detail
        || apiError
        || `Unable to fetch passage right now (HTTP ${response.status}).`;
      const error = new Error(message);
      error.apiError = apiError;
      error.detail = detail;
      throw error;
    }

    return {
      reference: cleanString(data.reference, clean),
      text: cleanString(data.text).replace(/\s+/g, " "),
      translation_name: cleanString(data.translation_name, "WEB")
    };
  }

  async function fetchWholeChapterRange(range) {
    const passages = [];
    for (const chapterRef of range.references) {
      const passage = await fetchBibleApiPassage(chapterRef);
      passages.push(passage);
    }

    return {
      reference: `${range.book} ${range.start}-${range.end}`,
      text: passages.map((passage) => cleanString(passage.text)).join("\n\n"),
      translation_name: passages[0] ? passages[0].translation_name : "WEB"
    };
  }

  async function fetchBiblePassage(reference) {
    const clean = String(reference || "").trim();
    if (!clean) {
      throw new Error("Enter a passage reference first.");
    }

    try {
      return await fetchBibleApiPassage(clean);
    } catch (error) {
      const chapterRange = parseChapterRangeReference(clean);
      if (chapterRange) {
        if (chapterRange.tooLarge) {
          throw new Error("That chapter range is too large. Please request 12 chapters or fewer at a time.");
        }

        try {
          return await fetchWholeChapterRange(chapterRange);
        } catch (_) {
          // fall through to fallback + original error below
        }
      }

      const fallback = FALLBACK_PASSAGES[normalizeReference(clean)];
      if (fallback) {
        return fallback;
      }

      throw error;
    }
  }

  async function apiPost(url, payload) {
    let response;
    try {
      response = await fetch(`${API_BASE}${url}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload || {})
      });
    } catch (_) {
      throw new Error("Cannot reach local AI API. Start the app with `npm start` and open http://localhost:3000/ai/.");
    }

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (!response.ok) {
      const message = data && data.error ? data.error : `Request failed (${response.status})`;
      throw new Error(message);
    }

    return data;
  }

  async function apiPostForm(url, formData) {
    let response;
    try {
      response = await fetch(`${API_BASE}${url}`, {
        method: "POST",
        body: formData
      });
    } catch (_) {
      throw new Error("Cannot reach local AI API. Start the app with `npm start` and open http://localhost:3000/ai/.");
    }

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (!response.ok) {
      const message = data && data.error ? data.error : `Request failed (${response.status})`;
      throw new Error(message);
    }

    return data;
  }

  function splitSentences(text) {
    return String(text || "")
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  function tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1);
  }

  function topKeywords(text, max = 8) {
    const tokens = tokenize(text).filter((token) => !STOP_WORDS.has(token));
    const counts = new Map();

    for (const token of tokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([word, count]) => ({ word, count }));
  }

  function countSyllables(word) {
    const clean = String(word || "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");

    if (!clean) {
      return 0;
    }

    const stripped = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const groups = stripped.match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  function textMetrics(text) {
    const words = tokenize(text);
    const sentences = splitSentences(text);
    const wordCount = words.length;
    const sentenceCount = Math.max(1, sentences.length);
    const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);

    const avgSentenceLength = wordCount / sentenceCount;
    const flesch = 206.835 - 1.015 * avgSentenceLength - 84.6 * (syllables / Math.max(wordCount, 1));

    return {
      wordCount,
      sentenceCount,
      avgSentenceLength: Number(avgSentenceLength.toFixed(1)),
      readability: Number(flesch.toFixed(1)),
      readabilityBand: flesch >= 70 ? "Easy" : flesch >= 55 ? "Moderate" : flesch >= 40 ? "Challenging" : "Dense"
    };
  }

  function estimatePassiveVoice(text) {
    const sentences = splitSentences(text);
    const passivePattern = /\b(am|is|are|was|were|be|been|being)\s+\w+(ed|en)\b/i;
    const matches = sentences.filter((sentence) => passivePattern.test(sentence));

    return {
      count: matches.length,
      ratio: sentences.length ? matches.length / sentences.length : 0,
      examples: matches.slice(0, 3)
    };
  }

  function findScriptureReferences(text) {
    const pattern = /\b(?:[1-3]\s*)?[A-Z][a-z]+\s+\d{1,3}(?::\d{1,3}(?:-\d{1,3})?)?/g;
    return String(text || "").match(pattern) || [];
  }

  function toScoreClass(score) {
    if (score >= 8) return "high";
    if (score >= 5) return "mid";
    return "low";
  }

  function renderScore(score) {
    const bounded = Math.max(0, Math.min(10, Number(score || 0))).toFixed(1);
    return `<span class="score ${toScoreClass(Number(bounded))}">${bounded}/10</span>`;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function summarizeKeywords(keywords) {
    return keywords
      .map((item) => `${item.word} (${item.count})`)
      .join(", ");
  }

  function highlightTerms(text, terms) {
    let output = String(text || "");
    const uniqueTerms = Array.from(new Set((terms || []).filter(Boolean))).sort((a, b) => b.length - a.length);

    for (const term of uniqueTerms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      output = output.replace(new RegExp(`(${escaped})`, "ig"), "<mark class=\"highlight\">$1</mark>");
    }

    return output;
  }

  function createEl(tag, className, html) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (typeof html === "string") element.innerHTML = html;
    return element;
  }

  function setBusy(button, busyText, isBusy) {
    if (!button) {
      return;
    }

    if (!button.dataset.originalLabel) {
      button.dataset.originalLabel = button.textContent || "";
    }

    button.disabled = Boolean(isBusy);
    button.textContent = isBusy ? busyText : button.dataset.originalLabel;
  }

  function cleanString(value, fallback = "") {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || fallback;
    }

    if (value === null || value === undefined) {
      return fallback;
    }

    const asText = String(value).trim();
    return asText || fallback;
  }

  function cleanArray(value, max = 8) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => cleanString(item))
      .filter(Boolean)
      .slice(0, max);
  }

  async function disableLegacyServiceWorkers() {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      if (!registrations.length) {
        return;
      }

      await Promise.all(registrations.map((registration) => registration.unregister()));

      if ("caches" in window && typeof caches.keys === "function") {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (_) {
      // Ignore SW cleanup failures; app should continue normally.
    }
  }

  window.AIBible = {
    $, $all, escapeHtml, fetchBiblePassage, apiPost, apiPostForm, splitSentences, tokenize, topKeywords,
    textMetrics, estimatePassiveVoice, findScriptureReferences, renderScore, clamp,
    summarizeKeywords, highlightTerms, createEl, setBusy, cleanString, cleanArray
  };
})();
