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
  const { name, empresa, phone, email, nicho, city } = req.body;
  if (!name || !email) return res.status(400).json({ error: "Dados incompletos." });

  const date = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  await appendToSheet([date, name, empresa || "", phone || "", email, nicho || "", city || ""]);

  // Notifica dono no WhatsApp
  notifyWhatsApp(`🆕 Novo lead VendaMais!\nNome: ${name}\nEmpresa: ${empresa||"?"}\nWhatsApp: ${phone||"?"}\nEmail: ${email}\nNicho: ${nicho||"?"}\nCidade: ${city||"?"}`);

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
const YOUTUBE_KEY = process.env.YOUTUBE_API_KEY || "AIzaSyDXAR1E-XfTiIl1x-u5WW7VP6Xd_O6a58Y";

// Busca vídeos reais no YouTube pela API oficial
async function searchYouTube(query, maxResults = 3) {
  try {
    const q = encodeURIComponent(query);
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&videoCategoryId=27&relevanceLanguage=pt&regionCode=BR&maxResults=${maxResults}&key=${YOUTUBE_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    
    if (!data.items) {
      console.log("YouTube API erro:", JSON.stringify(data));
      return [];
    }

    // Filtra músicas e entretenimento
    const blocked = [
      // Música e entretenimento
      "música","music","song","letra","lyric","clipe","mc ","funk","sertanejo","pagode","gospel",
      "novela","série","filme","trailer","gameplay","minecraft","roblox","shorts","cover",
      // Conteúdo médico clínico (não é de vendas)
      "caso clínico","relato de caso","cirurgia","procedimento","anatomia","diagnóstico",
      "patologia","histologia","biópsia","laparoscopia","endoscopia","radiologia",
      "ependimoma","holocorde","glioma","tumor","câncer","cancer","oncologia",
      // Outros irrelevantes
      "receita","culinária","viagem","moda","beleza tutorial","maquiagem tutorial"
    ];
    
    return data.items
      .filter(item => {
        const title = (item.snippet.title || "").toLowerCase();
        const channel = (item.snippet.channelTitle || "").toLowerCase();
        return !blocked.some(kw => title.includes(kw) || channel.includes(kw));
      })
      .map(item => ({
        id: item.id.videoId,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
      }));
  } catch(e) {
    console.log("YouTube search erro:", e.message);
    return [];
  }
}

app.post("/api/videos", async (req, res) => {
  const { sectorLabel, city, dicas } = req.body;

  const FALLBACK = [
    { id: "aZG9j4eqG3E", title: "Quando o Cliente Diz 'Tá Caro'", channel: "Thiago Concer", role: "principal" },
    { id: "RAOppNOpNUI", title: "5 Técnicas de Persuasão — Vendas", channel: "Thiago Concer", role: "complementar1" },
    { id: "irTe2XF4s8k", title: "Como Fazer Network", channel: "Empreender é Mais", role: "complementar2" },
  ];

  try {
    const result = { dica1: [], dica2: [], dica3: [] };
    const roles = ["principal", "complementar1", "complementar2"];

    for (let i = 0; i < dicas.length; i++) {
      const key = "dica" + (i + 1);
      const dica = dicas[i];

      // Monta queries específicas para cada papel do vídeo
      const queries = [
        // Principal: direto ao tema da dica + nicho + vendas
        `como vender ${sectorLabel} ${dica.tema} estratégia`,
        // Complementar 1: técnica de vendas relacionada
        `técnica vendas ${dica.tema} empreendedorismo negócios Brasil`,
        // Complementar 2: case de sucesso empresarial
        `empreendedor ${sectorLabel} case sucesso negócios crescimento`,
      ];

      const usedIds = new Set();

      for (let q = 0; q < queries.length; q++) {
        const videos = await searchYouTube(queries[q], 5);
        const filtered = videos.filter(v => !usedIds.has(v.id));

        if (filtered.length > 0) {
          const v = filtered[0];
          v.role = roles[q];
          usedIds.add(v.id);
          result[key].push(v);
          console.log(`✅ ${key} [${roles[q]}]: ${v.title} — ${v.channel}`);
        }
      }

      // Completa com fallback se necessário
      while (result[key].length < 3) {
        const fb = {...FALLBACK[result[key].length]};
        if (!usedIds.has(fb.id)) {
          result[key].push(fb);
          usedIds.add(fb.id);
        } else {
          break;
        }
      }
    }

    res.json(result);
  } catch (err) {
    console.error("Erro vídeos:", err.message);
    res.json({ dica1: FALLBACK, dica2: FALLBACK, dica3: FALLBACK });
  }
});

// ── NOTIFICAÇÃO WHATSAPP ──────────────────────────────────────────────────
const OWNER_WHATSAPP = "5581997914939";

async function notifyWhatsApp(msg) {
  try {
    const instanceId = process.env.ULTRAMSG_INSTANCE || "instance179480";
    const token = process.env.ULTRAMSG_TOKEN || "4cnb765o5tjxyyyp";
    const url = `https://api.ultramsg.com/${instanceId}/messages/chat`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        to: OWNER_WHATSAPP,
        body: msg.replace(/\\n/g, "\n"),
      }).toString(),
    });
    console.log("✅ WhatsApp enviado para", OWNER_WHATSAPP);
  } catch(e) { console.log("WhatsApp notify erro:", e.message); }
}

// ── SALVAR LEAD (atualizado com notificação) ──────────────────────────────
// (já existe o /api/lead acima, vamos sobrescrever via middleware)

// ── CHAT DO CONSULTOR ─────────────────────────────────────────────────────
app.post("/api/consult", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
  const { messages, nicho, city, userName, empresa, profile } = req.body;
  const firstName = (userName||"").split(" ")[0] || "amigo";

  const businessContext = `PERFIL: Nome: ${firstName} | Empresa: ${empresa||"?"} | Nicho: ${nicho||"?"} | Cidade: ${city||"Brasil"} | Porte: ${profile?.size||"?"} | Ticket: ${profile?.ticket||"?"} | Modelo: ${profile?.model||"?"} | Desafios: ${profile?.challenges||"?"}`;

  const sys = `Você é um consultor especialista em vendas para "${nicho||"negócios"}" em "${city||"Brasil"}". Trate SEMPRE por: ${firstName}. ${empresa?`Empresa: "${empresa}".`:""}

${businessContext}

Você conhece profundamente o mercado brasileiro de ${nicho||"negócios"} e usa esse conhecimento para dar respostas específicas sobre concorrentes, preços e tendências de ${city||"Brasil"}.

Responda APENAS com JSON válido:
{"texto":"resposta aqui máx 3 parágrafos diretos e práticos","chart":null,"video":null,"oferecer_pdf":false}

chart quando tiver dados numéricos: {"tipo":"bar","titulo":"título","labels":["A","B","C"],"valores":[10,20,30]}
video quando relevante: {"id":"ID11CHARS","titulo":"título exato","canal":"canal"}
oferecer_pdf: true se for relatório extenso`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: sys,
        messages: messages,
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("API error:", r.status, err);
      return res.status(500).json({ error: "Erro API: " + r.status });
    }

    const data = await r.json();
    let rawText = data.content?.map(b => b.text || "").join("") || "";

    if (!rawText) {
      return res.status(500).json({ error: "Resposta vazia da API" });
    }

    // Parse JSON
    let parsed = null;
    try {
      const clean = rawText.split("```json").join("").split("```").join("").trim();
      const jsonStr = clean.startsWith("{") ? clean : (clean.match(/\{[\s\S]*\}/) || ["{}"])[0];
      parsed = JSON.parse(jsonStr);
    } catch(e) {
      parsed = { texto: rawText, chart: null, video: null, oferecer_pdf: false };
    }

    // Validate video ID
    if (parsed.video?.id && parsed.video.id.length === 11) {
      try {
        const vr = await fetch(`https://img.youtube.com/vi/${parsed.video.id}/mqdefault.jpg`, { method: "HEAD" });
        const len = parseInt(vr.headers.get("content-length") || "9999");
        if (!vr.ok || len < 3000) parsed.video = null;
      } catch { parsed.video = null; }
    } else { parsed.video = null; }

    const lastMsg = (messages[messages.length-1]?.content || "").substring(0, 80);
    notifyWhatsApp(`💬 ${firstName} (${empresa||nicho||"?"}) perguntou: "${lastMsg}"`).catch(()=>{});

    res.json({ ...parsed, searchUsed: false });
  } catch (err) {
    console.error("Consult error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── GERAR PDF DO CONSULTOR ────────────────────────────────────────────────
app.post("/api/consult-pdf", async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." });
  const { content, userName, empresa, nicho, city } = req.body;

  const prompt = `Formate o seguinte conteúdo como um relatório executivo profissional em texto corrido, bem estruturado com seções claras, pronto para ser exportado como PDF. Inclua um título, data e contexto da empresa. Conteúdo: ${content}`;

  try {
    const data = await callAI([{ role: "user", content: prompt }], "", 1500);
    const text = data.content?.map(b => b.text || "").join("") || content;
    res.json({ text });
  } catch (err) {
    res.json({ text: content });
  }
});


// ── NOTIFICAR PROGRESSO ───────────────────────────────────────────────────
app.post("/api/notify", async (req, res) => {
  const { type, userName, nicho, city, detail, profile } = req.body;

  let msg = "";
  if (type === "perfil_completo") {
    const p = profile || {};
    const empresa = profile?.empresa || "";
    msg = `🎯 *VendaMais — Novo Lead Completo!*
━━━━━━━━━━━━━━━━━━━
👤 Nome: ${userName}
🏪 Empresa: ${empresa||"Não informada"}
📍 Cidade: ${city||"Não informada"}
🏢 Nicho: ${nicho||"?"}
👥 Porte: ${p.size||"?"}
💰 Ticket médio: ${p.ticket||"?"}
🤝 Modelo de venda: ${p.model||"?"}
🎯 Desafios: ${p.challenges||"?"}
📝 Contexto: ${p.extra||"Não informado"}
━━━━━━━━━━━━━━━━━━━
⚡ Momento ideal para contato!`;
  } else if (type === "cadastro") {
    msg = `🆕 *Novo cadastro VendaMais!*
Nome: ${userName}
Nicho: ${nicho||"?"}
Cidade: ${city||"?"}`;
  } else if (type === "concluiu") {
    msg = `✅ *${userName}* concluiu uma dica!
Nicho: ${nicho||"?"}
Dica: "${detail||""}"`;
  } else if (type === "chat") {
    msg = `💬 *${userName}* está no chat!
Nicho: ${nicho||"?"}
Pergunta: "${detail||""}"`;
  } else {
    msg = `⚡ VendaMais: ${type} — ${userName}`;
  }

  await notifyWhatsApp(msg);
  res.json({ ok: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(process.env.PORT || 3000, () => console.log("VendaMais online"));
