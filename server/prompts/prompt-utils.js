"use strict";

function normalizeSystemLines(lines) {
  const rows = Array.isArray(lines) ? lines : [lines];
  return rows
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}

function buildJsonPrompt({
  version = "1",
  systemLines = [],
  task = "",
  outputSchema = {},
  input = {},
  constraints = {},
  process = null
}) {
  const payload = {
    promptVersion: String(version),
    task,
    outputSchema,
    input,
    constraints
  };

  if (process && typeof process === "object" && Object.keys(process).length) {
    payload.process = process;
  }

  return {
    system: normalizeSystemLines(systemLines).join(" "),
    user: JSON.stringify(payload, null, 2)
  };
}

module.exports = {
  buildJsonPrompt
};
