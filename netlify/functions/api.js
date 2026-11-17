const templeModelControl = require("../../temple-model-control.cjs");templeModelControl.configure({ appId: "905bf94ab81fa3e920f9c9bb92ce0d6e" });const serverless = require("serverless-http");
const { app } = require("../../server");

const handler = serverless(app, {
  basePath: "/.netlify/functions/api"
});

exports.handler = templeModelControl.wrap(async (event, context) => handler(event, context));
