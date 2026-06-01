const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const KEY = process.env.ANTHROPIC_API_KEY;

// ── Verifica se um vídeo do YouTube existe de verdade ─────────────────────
async function videoExists(id) {
  try {
    const url = `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return false;
    // YouTube retorna imagem 120x90 para vídeos inválidos (thumbnail padrão)
    // Vídeos válidos têm thumbnail mqdefault (320x180)
    const contentLength = res.headers.get("content-length");
    // Thumbnail inválida tem ~1-2kb, válida tem >5kb
    if (contentLength && parseInt(contentLength) < 3000) return false;
    return true;
  } catch {
    return false;
  }
}

// ── Proxy principal (gerar dicas) ─────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body),
    });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Busca e valida vídeos por nicho ──────────────────────────────────────
app.post("/api/videos", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });

  const { sectorLabel } = req.body;

  // Vídeos âncora garantidos (verificados manualmente)
  const ANCHOR = {
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
  };

  // Pede à IA IDs de vídeos específicos do nicho
  const prompt = `Você conhece vídeos reais do YouTube em português brasileiro.

Para o nicho "${sectorLabel}", liste IDs reais do YouTube que você conhece com CERTEZA ABSOLUTA que existem.

Retorne APENAS JSON válido, sem markdown:
{
  "marketing": [
    {"id": "XXXXXXXXXX", "title": "título exato do vídeo", "channel": "canal exato", "type": "aula"},
    {"id": "XXXXXXXXXX", "title": "título exato do vídeo", "channel": "canal exato", "type": "conteudo"}
  ],
  "vendas": [
    {"id": "XXXXXXXXXX", "title": "título exato do vídeo", "channel": "canal exato", "type": "aula"},
    {"id": "XXXXXXXXXX", "title": "título exato do vídeo", "channel": "canal exato", "type": "conteudo"}
  ],
  "network": [
    {"id": "XXXXXXXXXX", "title": "título exato do vídeo", "channel": "canal exato", "type": "aula"},
    {"id": "XXXXXXXXXX", "title": "título exato do vídeo", "channel": "canal exato", "type": "conteudo"}
  ]
}

REGRAS:
- IDs de 11 caracteres exatos
- Apenas vídeos que você tem CERTEZA que existem
- Em português brasileiro
- Relevantes para "${sectorLabel}": marketing desse setor, vendas desse setor, networking desse setor
- type "aula" = videoaula/tutorial, type "conteudo" = palestra/motivacional
- Se não tiver certeza de um ID específico para o nicho, use IDs de canais de referência como Thiago Concer, G4 Educação, Sebrae, Natanael Oliveira que sejam sobre o tema`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    const text = data.content?.map(b => b.text || "").join("") || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const suggested = JSON.parse(clean);

    // Valida cada vídeo sugerido pela IA
    const result = { marketing: [], vendas: [], network: [] };

    for (const category of ["marketing", "vendas", "network"]) {
      const candidates = suggested[category] || [];
      
      for (const video of candidates) {
        if (!video.id || video.id.length !== 11) continue;
        
        console.log(`Verificando ${category}: ${video.id} — ${video.title}`);
        const exists = await videoExists(video.id);
        
        if (exists) {
          console.log(`✅ Válido: ${video.id}`);
          result[category].push(video);
        } else {
          console.log(`❌ Inválido/inexistente: ${video.id}`);
        }

        // Máximo 2 vídeos por categoria
        if (result[category].length >= 2) break;
      }

      // Se não validou nenhum para esse nicho, usa âncora garantida
      if (result[category].length === 0) {
        console.log(`Usando âncora para ${category}`);
        result[category] = ANCHOR[category];
      }
    }

    console.log("Resultado final:", JSON.stringify(result, null, 2));
    res.json(result);

  } catch (err) {
    console.error("Erro:", err.message);
    res.json(ANCHOR);
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(process.env.PORT || 3000, () => console.log("VendaMais online"));
