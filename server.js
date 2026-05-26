const express = require("express");
const fetch = (...a) => import("node-fetch").then(({default:f})=>f(...a));
const app = express();
app.use(express.json());
app.use(express.static("public"));
app.post("/api/chat", async (req, res) => {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {"Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
    body: JSON.stringify(req.body)
  });
  res.json(await r.json());
});
app.listen(process.env.PORT || 3000);
