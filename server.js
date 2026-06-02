const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const KEY = process.env.ANTHROPIC_API_KEY;

async function callAI(messages, system, maxTokens = 1200) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages }),
  });
  return r.json();
}

async function videoExists(id) {
  try {
    const r = await fetch(`https://img.youtube.com/vi/${id}/mqdefault.jpg`, { method: "HEAD" });
    if (!r.ok) return false;
    const len = r.headers.get("content-length");
    return !len || parseInt(len) > 3000;
  } catch { return false; }
}

// ── GERAR DICAS ───────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
  try {
    const data = await callAI(req.body.messages, req.body.system, req.body.max_tokens || 1400);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── BUSCAR E VALIDAR VÍDEOS POR DICA ─────────────────────────────────────
app.post("/api/videos", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });

  const { sectorLabel, city, dicas } = req.body;

  const FALLBACK = [
    { id: "aZG9j4eqG3E", title: "Quando o Cliente Diz 'Tá Caro'", channel: "Thiago Concer", role: "principal" },
    { id: "RAOppNOpNUI", title: "5 Técnicas de Persuasão para Fechar Vendas", channel: "Thiago Concer", role: "complementar" },
    { id: "irTe2XF4s8k", title: "Como Fazer Network", channel: "Pablo Marçal", role: "complementar" },
  ];

  const prompt = `Você conhece vídeos reais do YouTube em português brasileiro.

Para uma empresa do nicho "${sectorLabel}" na cidade "${city || "Brasil"}", preciso de vídeos para aprofundar cada uma das 3 dicas abaixo.

DICAS GERADAS:
${dicas.map((d, i) => `${i + 1}. Tema: ${d.tema} — ${d.resumo}`).join("\n")}

Para cada dica, sugira 3 vídeos reais do YouTube:
- "principal": vídeo diretamente sobre o tema da dica
- "complementar1": aprofunda a técnica ou psicologia por trás
- "complementar2": mentalidade ou hábito que sustenta a prática

Retorne APENAS JSON válido sem markdown:
{
  "dica1": [
    {"id":"XXXXXXXXXXX","title":"título exato","channel":"canal exato","role":"principal"},
    {"id":"XXXXXXXXXXX","title":"título exato","channel":"canal exato","role":"complementar1"},
    {"id":"XXXXXXXXXXX","title":"título exato","channel":"canal exato","role":"complementar2"}
  ],
  "dica2": [...],
  "dica3": [...]
}

REGRAS ABSOLUTAS:
- IDs de exatamente 11 caracteres
- Apenas vídeos que você tem CERTEZA que existem no YouTube
- Todos em português brasileiro
- Canais de referência: Thiago Concer, G4 Educação, Natanael Oliveira, Joel Jota, Flávio Augusto, Sebrae, Pablo Marçal, Leandro Ladeira, Conquer, Me Poupe
- Se não tiver certeza do ID, use um desses IDs garantidos: aZG9j4eqG3E, RAOppNOpNUI, dQOXsn7kKyo, irTe2XF4s8k, 3466p8uVwEQ, s4tU92xq5Os`;

  try {
    const data = await callAI([{ role: "user", content: prompt }], "", 1000);
    const text = data.content?.map(b => b.text || "").join("") || "{}";
    const suggested = JSON.parse(text.replace(/```json|```/g, "").trim());

    const result = { dica1: [], dica2: [], dica3: [] };

    for (const key of ["dica1", "dica2", "dica3"]) {
      const candidates = suggested[key] || [];
      for (const v of candidates) {
        if (!v.id || v.id.length !== 11) continue;
        const ok = await videoExists(v.id);
        console.log(`${ok ? "✅" : "❌"} ${key} ${v.id} — ${v.title}`);
        if (ok) result[key].push(v);
      }
      if (result[key].length < 3) {
        const missing = 3 - result[key].length;
        result[key].push(...FALLBACK.slice(0, missing));
      }
    }

    res.json(result);
  } catch (err) {
    console.error("Erro vídeos:", err.message);
    res.json({ dica1: FALLBACK, dica2: FALLBACK, dica3: FALLBACK });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(process.env.PORT || 3000, () => console.log("VendaMais online"));
