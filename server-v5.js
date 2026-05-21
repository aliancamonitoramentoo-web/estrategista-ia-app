const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());
app.use(express.static('.'));

const users = new Map();
const sessions = new Map();
const userPlans = new Map();

function hashPassword(p) {
  return crypto.createHash('sha256').update(p + 'estrategista_salt_2025').digest('hex');
}
function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function getUser(token) {
  const email = sessions.get(token);
  return email ? users.get(email) || null : null;
}

// ── CRM SYNC ──────────────────────────────────────────
async function sendToCRM(userData) {
  const JB_KEY = '$2a$10$hVdT1fgXeYtrZdl2D1AX9uirosaAYDz7m5nlYUOkDI9OtZJ2G4qwa';
  const JB_BIN = '69f53df9856a6821899751fd';
  try {
    const getRes = await fetch(`https://api.jsonbin.io/v3/b/${JB_BIN}/latest`, {
      headers: { 'X-Master-Key': JB_KEY }
    });
    const getData = await getRes.json();
    const dados = getData.record || {};
    if (!dados.empresas) dados.empresas = [];
    if (!dados.contatos) dados.contatos = [];
    if (!dados.notifs)   dados.notifs   = [];

    const jaExiste = dados.empresas.find(e => e.nome === userData.name || e.email === userData.email);
    if (!jaExiste) {
      const id = Date.now();
      const cores = ['#f5a623','#3d9bff','#00d97e','#b08fff','#ff8c42'];
      const cor = cores[id % cores.length];
      const porte = userData.porte || 'micro';
      const obs = `Lead captado pelo Estrategista IA | Segmento: ${userData.segmento||'—'} | Porte: ${porte} | Faturamento: R$${userData.faturamento||0} | Cidade: ${userData.cidade||'—'} — ${new Date().toLocaleDateString('pt-BR')}`;

      dados.empresas.push({
        id, nome: userData.name, tipo: 'pf',
        email: userData.email, tel: userData.tel||'',
        bairro: userData.cidade||'', s: 'pr',
        val: 0, cor, tag: 'mo', contato: userData.name, obs
      });
      dados.contatos.push({
        id: id+1, tipo: 'pf', nome: userData.name,
        email: userData.email, tel: userData.tel||'',
        s: 'pr', emp: userData.name, cargo: 'Empreendedor', obs
      });
      dados.notifs.unshift({
        ic: '🤖', t: 'Novo lead: ' + userData.name,
        sub: `${userData.segmento||'—'} | ${porte} | R$${userData.faturamento||0} | Estrategista IA`,
        time: new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),
        tipo: 'unread'
      });
      dados._ts = Date.now();

      await fetch(`https://api.jsonbin.io/v3/b/${JB_BIN}`, {
        method: 'PUT',
        headers: { 'X-Master-Key': JB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
      console.log('✅ Lead enviado ao CRM:', userData.name, '|', porte);
    }
  } catch(e) {
    console.log('CRM sync error:', e.message);
  }
}

// ── AUTH ──────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, segmento, cidade, faturamento, tel } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Preencha todos os campos.' });
  if (users.has(email)) return res.status(400).json({ error: 'Email já cadastrado.' });
  if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' });

  const fat = parseInt(faturamento) || 0;
  const porte = fat === 0 ? 'iniciante' : fat <= 3000 ? 'micro' : fat <= 15000 ? 'pequeno' : fat <= 60000 ? 'medio' : 'grande';

  const user = {
    name, email, password: hashPassword(password),
    segmento: segmento||'', cidade: cidade||'',
    faturamento: fat, tel: tel||'', porte,
    createdAt: new Date().toISOString(),
    plansGenerated: 0
  };
  users.set(email, user);
  userPlans.set(email, []);

  const token = generateToken();
  sessions.set(token, email);

  sendToCRM({ name, email, segmento, cidade, faturamento: fat, tel, porte }).catch(() => {});

  res.json({ token, user: { name, email, segmento, cidade, faturamento: fat, porte, plansGenerated: 0 } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Preencha email e senha.' });
  const user = users.get(email);
  if (!user) return res.status(401).json({ error: 'Email não encontrado.' });
  if (user.password !== hashPassword(password)) return res.status(401).json({ error: 'Senha incorreta.' });
  const token = generateToken();
  sessions.set(token, email);
  res.json({ token, user: { name: user.name, email, segmento: user.segmento, cidade: user.cidade, faturamento: user.faturamento, porte: user.porte, plansGenerated: user.plansGenerated } });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUser(token);
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });
  res.json({ name: user.name, email: user.email, segmento: user.segmento, cidade: user.cidade, faturamento: user.faturamento, porte: user.porte, plansGenerated: user.plansGenerated });
});

app.post('/api/auth/logout', (req, res) => {
  sessions.delete(req.headers.authorization?.replace('Bearer ', ''));
  res.json({ ok: true });
});

// ── PLANS ─────────────────────────────────────────────
app.post('/api/plans/save', (req, res) => {
  const user = getUser(req.headers.authorization?.replace('Bearer ', ''));
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });
  const plan = { ...req.body, id: 'plan_' + Date.now(), createdAt: new Date().toISOString() };
  const plans = userPlans.get(user.email) || [];
  plans.unshift(plan);
  userPlans.set(user.email, plans);
  user.plansGenerated = (user.plansGenerated || 0) + 1;
  users.set(user.email, user);
  res.json({ ok: true, plan });
});

app.get('/api/plans', (req, res) => {
  const user = getUser(req.headers.authorization?.replace('Bearer ', ''));
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });
  res.json(userPlans.get(user.email) || []);
});

app.delete('/api/plans/:id', (req, res) => {
  const user = getUser(req.headers.authorization?.replace('Bearer ', ''));
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });
  userPlans.set(user.email, (userPlans.get(user.email)||[]).filter(p => p.id !== req.params.id));
  res.json({ ok: true });
});

app.put('/api/plans/:id/progress', (req, res) => {
  const user = getUser(req.headers.authorization?.replace('Bearer ', ''));
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });
  const plans = userPlans.get(user.email) || [];
  const plan = plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plano não encontrado.' });
  plan.taskProgress = req.body.taskProgress;
  userPlans.set(user.email, plans);
  res.json({ ok: true });
});

// ── GENERATE ──────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const user = getUser(req.headers.authorization?.replace('Bearer ', ''));
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'API key não configurada.' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 6000,
        system: req.body.system,
        messages: req.body.messages,
        tools: [{ type: "web_search_20250305", name: "web_search" }]
      })
    });
    const text = await response.text();
    res.status(response.status).send(text);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Estrategista IA v5 rodando na porta ${PORT}`));
