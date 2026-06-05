const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const KEY = process.env.ANTHROPIC_API_KEY;

// ── Google Sheets config ──────────────────────────────────────────────────
const SHEET_ID = "1YTuFKECrTdgmfHruO2eCbvDT0O3DKZmwm5dGKDWUYSY";
const SHEET_NAME = "Página1";
const SA_EMAIL = process.env.GOOGLE_SA_EMAIL;
const SA_KEY = process.env.GOOGLE_SA_KEY;

async function getGoogleToken() {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(JSON.stringify({
    iss: SA_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })).toString("base64url");

  const { createSign, createPrivateKey } = await import("node:crypto");

  // Normaliza a chave — suporta \n literal ou quebras reais
  const rawKey = SA_KEY.replace(/\\n/g, "\n").replace(/\n/g, "\n");
  const privateKey = createPrivateKey({
    key: rawKey,
    format: "pem",
    type: "pkcs8",
  });

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${claim}`);
  const sig = sign.sign(privateKey, "base64url");
  const jwt = `${header}.${claim}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token inválido: " + JSON.stringify(data));
  return data.access_token;
}

async function appendToSheet(row) {
  if (!SA_EMAIL || !SA_KEY) {
    console.log("Google Sheets não configurado — pulando.");
    return;
  }
  try {
    const token = await getGoogleToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}:append?valueInputOption=USER_ENTERED`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ values: [row] }),
    });
    console.log("✅ Lead salvo no Sheets:", row[1]);
  } catch (err) {
    console.error("❌ Erro ao salvar no Sheets:", err.message);
  }
}

// ── SALVAR LEAD ───────────────────────────────────────────────────────────
app.post("/api/lead", async (req, res) => {
  const { name, phone, email, nicho, city } = req.body;
  if (!name || !email) return res.status(400).json({ error: "Dados incompletos." });

  const date = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  await appendToSheet([date, name, phone || "", email, nicho || "", city || ""]);
  res.json({ ok: true });
});

// ── ANTHROPIC PROXY ───────────────────────────────────────────────────────
async function callAI(messages, system, maxTokens = 1200) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages }),
  });
  return r.json();
}

app.post("/api/chat", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
  try {
    const data = await callAI(req.body.messages, req.body.system, req.body.max_tokens || 1400);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SUGESTÃO DE NICHOS VIA IA ─────────────────────────────────────────────
app.post("/api/nichos", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
  const { query } = req.body;
  if (!query || query.length < 2) return res.json({ nichos: [] });
  const prompt = `Liste até 8 tipos de negócios ou nichos de mercado brasileiros que correspondam à busca: "${query}". Retorne APENAS JSON válido sem markdown: {"nichos":[{"icon":"emoji","label":"nome do negócio"},...]}`; 
  try {
    const data = await callAI([{ role: "user", content: prompt }], "", 300);
    const text = data.content?.map(b => b.text || "").join("") || '{"nichos":[]}';
    res.json(JSON.parse(text.replace(/```json|```/g, "").trim()));
  } catch { res.json({ nichos: [] }); }
});

// ── BUSCAR E VALIDAR VÍDEOS ───────────────────────────────────────────────
async function videoExists(id) {
  try {
    const r = await fetch(`https://img.youtube.com/vi/${id}/mqdefault.jpg`, { method: "HEAD" });
    if (!r.ok) return false;
    const len = r.headers.get("content-length");
    return !len || parseInt(len) > 3000;
  } catch { return false; }
}

app.post("/api/videos", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
  const { sectorLabel, city, dicas } = req.body;
  const FALLBACK = [
    { id: "aZG9j4eqG3E", title: "Quando o Cliente Diz 'Tá Caro'", channel: "Thiago Concer", role: "principal" },
    { id: "RAOppNOpNUI", title: "5 Técnicas de Persuasão para Fechar Vendas", channel: "Thiago Concer", role: "complementar1" },
    { id: "irTe2XF4s8k", title: "Como Fazer Network", channel: "Pablo Marçal", role: "complementar2" },
  ];
  // Monta referências de grandes marcas do nicho para contextualizar
  const prompt = `Você é especialista em conteúdo educativo do YouTube brasileiro.

NICHO: "${sectorLabel}" | CIDADE: "${city||"Brasil"}"
DICAS GERADAS:
${dicas.map((d,i)=>`${i+1}. [${d.tema}] ${d.resumo}`).join("\n")}

TAREFA: Para cada dica, indique 3 vídeos reais do YouTube em PORTUGUÊS BRASILEIRO.
- Use cases de GRANDES EMPRESAS/MARCAS reais do nicho quando possível
  Ex: roupa → Renner, C&A, Zara Brasil | chocolate → Cacau Show, Kopenhagen | farmácia → Drogasil, Ultrafarma
  Ex: academia → Smart Fit | hamburguer → Madero, Bob's | pizzaria → Domino's, Pizza Hut Brasil
  Ex: odontologia → Dr. Consulta | imóveis → QuintoAndar, Loft | beleza → Boticário, Natura
- Priorize canais DIFERENTES em cada dica para evitar repetição
- Canais válidos: G4 Educação, Thiago Concer, Natanael Oliveira, Joel Jota, Flávio Augusto, Sebrae, Conquer, Me Poupe, Primo Rico, Leandro Ladeira, Pablo Marçal, Camila Porto, canais especializados no nicho
- role "principal": vídeo diretamente sobre o tema da dica
- role "complementar1": técnica ou psicologia por trás
- role "complementar2": mentalidade ou case de sucesso do setor

Retorne APENAS JSON válido sem markdown:
{"dica1":[{"id":"XXXXXXXXXXX","title":"título exato","channel":"canal exato","role":"principal"},{"id":"XXXXXXXXXXX","title":"título exato","channel":"canal exato","role":"complementar1"},{"id":"XXXXXXXXXXX","title":"título exato","channel":"canal exato","role":"complementar2"}],"dica2":[...],"dica3":[...]}

REGRAS ABSOLUTAS:
- IDs de EXATAMENTE 11 caracteres
- Apenas vídeos que você tem CERTEZA que existem
- Canais DIFERENTES entre as 3 dicas sempre que possível
- Se não tiver vídeo específico do nicho, use Thiago Concer, G4 Educação ou Sebrae`;
  try {
    const data = await callAI([{ role: "user", content: prompt }], "", 1000);
    const text = data.content?.map(b => b.text || "").join("") || "{}";
    const suggested = JSON.parse(text.replace(/```json|```/g, "").trim());
    const result = { dica1: [], dica2: [], dica3: [] };
    for (const key of ["dica1", "dica2", "dica3"]) {
      for (const v of (suggested[key] || [])) {
        if (!v.id || v.id.length !== 11) continue;
        if (await videoExists(v.id)) result[key].push(v);
        if (result[key].length >= 3) break;
      }
      if (result[key].length < 3) result[key].push(...FALLBACK.slice(0, 3 - result[key].length));
    }
    res.json(result);
  } catch (err) {
    res.json({ dica1: FALLBACK, dica2: FALLBACK, dica3: FALLBACK });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(process.env.PORT || 3000, () => console.log("VendaMais online"));
