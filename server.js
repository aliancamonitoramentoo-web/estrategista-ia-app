const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ── PROXY PRINCIPAL (gerar dicas) ─────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── BUSCA DE VÍDEOS POR NICHO ─────────────────────────────────────────────
app.post("/api/videos", async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });

  const { sector, sectorLabel } = req.body;

  const prompt = `Você é um especialista em conteúdo educativo brasileiro no YouTube.

Preciso de 4 vídeos reais do YouTube em PORTUGUÊS BRASILEIRO para o nicho: "${sectorLabel}"

Retorne EXATAMENTE um JSON válido neste formato (sem markdown, sem explicação, só o JSON):
{
  "marketing": [
    {"id": "ID_DO_VIDEO_YOUTUBE", "title": "Título do vídeo", "channel": "Nome do canal", "type": "aula"},
    {"id": "ID_DO_VIDEO_YOUTUBE", "title": "Título do vídeo", "channel": "Nome do canal", "type": "conteudo"}
  ],
  "vendas": [
    {"id": "ID_DO_VIDEO_YOUTUBE", "title": "Título do vídeo", "channel": "Nome do canal", "type": "aula"},
    {"id": "ID_DO_VIDEO_YOUTUBE", "title": "Título do vídeo", "channel": "Nome do canal", "type": "conteudo"}
  ],
  "network": [
    {"id": "ID_DO_VIDEO_YOUTUBE", "title": "Título do vídeo", "channel": "Nome do canal", "type": "aula"},
    {"id": "ID_DO_VIDEO_YOUTUBE", "title": "Título do vídeo", "channel": "Nome do canal", "type": "conteudo"}
  ]
}

REGRAS OBRIGATÓRIAS:
- Todos os vídeos em PORTUGUÊS BRASILEIRO
- IDs reais e válidos do YouTube (11 caracteres)
- "type": "aula" para videoaulas/tutoriais, "type": "conteudo" para palestras/motivacional
- Para marketing: foco em marketing digital para ${sectorLabel}
- Para vendas: foco em técnicas de vendas para ${sectorLabel}  
- Para network: foco em networking e parcerias para ${sectorLabel}
- Priorize canais conhecidos: Thiago Concer, Natanael Oliveira, Flávio Augusto, Joel Jota, G4 Educação, Sebrae, canais especializados no setor
- Use IDs reais que você conhece com certeza — não invente IDs`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json();
    const text = data.content?.map(b => b.text || "").join("") || "{}";

    // Parse JSON safely
    const clean = text.replace(/```json|```/g, "").trim();
    const videos = JSON.parse(clean);
    res.json(videos);
  } catch (err) {
    console.error("Erro ao buscar vídeos:", err.message);
    // Fallback com vídeos garantidos
    res.json({
      marketing: [
        { id: "3466p8uVwEQ", title: "Marketing Digital para Iniciantes e Avançados", channel: "Natanael Oliveira", type: "aula" },
        { id: "38gX3WT5mqk", title: "Marketing Digital 2026: Tendências", channel: "Natanael Oliveira", type: "conteudo" },
      ],
      vendas: [
        { id: "aZG9j4eqG3E", title: "Quando o Cliente Diz 'Tá Caro' — O Maior Vídeo de Vendas do Brasil", channel: "Thiago Concer", type: "aula" },
        { id: "dQOXsn7kKyo", title: "O Que Todo Vendedor Precisa Saber", channel: "Thiago Concer", type: "conteudo" },
      ],
      network: [
        { id: "irTe2XF4s8k", title: "Como Fazer Network — Pablo Marçal", channel: "Empreender é Mais", type: "aula" },
        { id: "s4tU92xq5Os", title: "Joel Jota, Caio Carneiro e Flávio Augusto sobre Negócios", channel: "Inteligência Ltda", type: "conteudo" },
      ],
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(process.env.PORT || 3000, () => console.log("VendaMais online"));
