#!/usr/bin/env node
"use strict";

const { listPromptMetadata } = require("../server/prompts");

for (const row of listPromptMetadata()) {
  console.log(`${row.id} | v${row.version} | ${row.task}`);
}
