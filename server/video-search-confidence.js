"use strict";

/**
 * Factory for video-search confidence scoring and uncertainty UX rules.
 *
 * Separating this from route handlers lets us tune confidence behavior without
 * touching API orchestration code.
 */
function createVideoSearchConfidenceTools(utils) {
  const cleanString = utils && typeof utils.cleanString === "function"
    ? utils.cleanString
    : (value, fallback = "") => String(value || fallback || "").trim();
  const cleanArray = utils && typeof utils.cleanArray === "function"
    ? utils.cleanArray
    : (value, max = 8) => (Array.isArray(value) ? value.map((item) => cleanString(item)).filter(Boolean).slice(0, max) : []);
  const tokenize = utils && typeof utils.tokenize === "function"
    ? utils.tokenize
    : (text) => String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  function assessVideoSearchConfidence({ query, queryTerms, results, topRows, stats, semanticEnabled }) {
    const rows = Array.isArray(results) ? results : [];
    const ranked = Array.isArray(topRows) ? topRows : [];
    const normalizedTerms = Array.isArray(queryTerms) && queryTerms.length
      ? queryTerms
      : tokenize(query);

    const topScore = rows.length
      ? Math.max(0, Number(rows[0].score || 0)) / 100
      : 0;
    const avgTop3 = rows.length
      ? rows.slice(0, 3).reduce((sum, row) => sum + (Number(row.score || 0) / 100), 0) / Math.min(rows.length, 3)
      : 0;
    const uniqueVideos = new Set(rows.map((row) => cleanString(row.videoId)).filter(Boolean)).size;

    const overlapRatios = rows.slice(0, 5).map((row) => {
      const haystack = [
        cleanString(row.title),
        cleanString(row.topic),
        cleanString(row.category),
        cleanArray(row.tags, 20).join(" ")
      ].join(" ").toLowerCase();
      if (!normalizedTerms.length || !haystack) {
        return 0;
      }
      const overlap = normalizedTerms.filter((term) => haystack.includes(term)).length;
      return overlap / normalizedTerms.length;
    });
    const termOverlap = overlapRatios.length
      ? overlapRatios.reduce((sum, value) => sum + value, 0) / overlapRatios.length
      : 0;

    const totalVideos = Math.max(1, Number(stats && stats.totalVideos || 0));
    const transcribedVideos = Number(stats && stats.transcribedVideos || 0);
    const transcriptCoverage = transcribedVideos / totalVideos;

    const reasonCodes = [];
    if (topScore < 0.42) {
      reasonCodes.push("low_top_score");
    }
    if (avgTop3 < 0.36) {
      reasonCodes.push("weak_top_result_cluster");
    }
    if (uniqueVideos <= 1 && rows.length >= 3) {
      reasonCodes.push("single_video_dominance");
    }
    if (termOverlap < 0.18) {
      reasonCodes.push("weak_query_overlap");
    }
    if (transcriptCoverage < 0.45) {
      reasonCodes.push("limited_transcript_coverage");
    }
    if (!semanticEnabled) {
      reasonCodes.push("semantic_ranker_unavailable");
    }

    let tier = "high";
    if (
      reasonCodes.length >= 4
      || topScore < 0.35
      || avgTop3 < 0.3
      || (topScore < 0.45 && termOverlap < 0.2)
      || (avgTop3 < 0.45 && termOverlap < 0.12)
    ) {
      tier = "low";
    } else if (reasonCodes.length >= 2 || topScore < 0.62 || termOverlap < 0.26) {
      tier = "medium";
    }

    const confidenceScore = Math.max(0, Math.min(100, Math.round((topScore * 0.5 + avgTop3 * 0.25 + termOverlap * 0.15 + transcriptCoverage * 0.1) * 100)));
    const summary = tier === "low"
      ? "Search confidence is low for this query in the current library."
      : tier === "medium"
        ? "Search confidence is moderate. Validate clip relevance before relying on it."
        : "Search confidence is high for this query and current filters.";

    return {
      tier,
      score: confidenceScore,
      reasonCodes,
      summary,
      diagnostics: {
        topScore: Number((topScore * 100).toFixed(2)),
        avgTop3Score: Number((avgTop3 * 100).toFixed(2)),
        termOverlap: Number((termOverlap * 100).toFixed(2)),
        transcriptCoverage: Number((transcriptCoverage * 100).toFixed(2)),
        uniqueVideos,
        topRowCount: ranked.length
      }
    };
  }

  function shouldUseLowConfidenceGuidancePrefix(confidence) {
    const payload = confidence && typeof confidence === "object" ? confidence : {};
    const tier = cleanString(payload.tier).toLowerCase();
    if (tier === "low") {
      return true;
    }
    const reasonCodes = cleanArray(payload.reasonCodes, 8);
    return tier === "medium"
      && reasonCodes.includes("low_top_score")
      && reasonCodes.includes("weak_query_overlap");
  }

  function buildLowConfidenceGuidancePrefix(confidence, guidanceText) {
    const base = cleanString(guidanceText);
    const summary = cleanString(confidence && confidence.summary, "Search confidence is low.");
    const reasons = cleanArray(confidence && confidence.reasonCodes, 4);
    const reasonText = reasons.length ? ` Signals: ${reasons.join(", ")}.` : "";
    return `${summary}${reasonText} Treat these clips as exploratory and refine your query before making ministry decisions.${base ? ` ${base}` : ""}`.trim();
  }

  return {
    assessVideoSearchConfidence,
    shouldUseLowConfidenceGuidancePrefix,
    buildLowConfidenceGuidancePrefix
  };
}

module.exports = {
  createVideoSearchConfidenceTools
};

