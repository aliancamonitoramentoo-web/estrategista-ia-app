const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());
app.use(express.static('.'));

// Banco de dados simples em memória (persiste enquanto o servidor rodar)
// Para persistência real, adicionar PostgreSQL depois
const users = new Map();
const sessions = new Map();
const userPlans = new Map();

// Funções auxiliares
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'estrategista_salt_2025').digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getUser(token) {
  const email = sessions.get(token);
  if (!email) return null;
  return users.get(email) || null;
}

// ==================== AUTH ROUTES ====================

// Cadastro
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Preencha todos os campos.' });
  if (users.has(email)) return res.status(400).json({ error: 'Email já cadastrado.' });
  if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' });

  const user = {
    name,
    email,
    password: hashPassword(password),
    createdAt: new Date().toISOString(),
    plansGenerated: 0
  };
  users.set(email, user);
  userPlans.set(email, []);

  const token = generateToken();
  sessions.set(token, email);

  res.json({ token, user: { name, email, plansGenerated: 0 } });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Preencha email e senha.' });

  const user = users.get(email);
  if (!user) return res.status(401).json({ error: 'Email não encontrado.' });
  if (user.password !== hashPassword(password)) return res.status(401).json({ error: 'Senha incorreta.' });

  const token = generateToken();
  sessions.set(token, email);

  res.json({ token, user: { name: user.name, email, plansGenerated: user.plansGenerated } });
});

// Verificar sessão
app.get('/api/auth/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUser(token);
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });
  res.json({ name: user.name, email: user.email, plansGenerated: user.plansGenerated });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  sessions.delete(token);
  res.json({ ok: true });
});

// ==================== PLANS ROUTES ====================

// Salvar plano
app.post('/api/plans/save', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUser(token);
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });

  const plan = { ...req.body, id: 'plan_' + Date.now(), createdAt: new Date().toISOString() };
  const plans = userPlans.get(user.email) || [];
  plans.unshift(plan);
  userPlans.set(user.email, plans);

  user.plansGenerated = (user.plansGenerated || 0) + 1;
  users.set(user.email, user);

  res.json({ ok: true, plan });
});

// Buscar planos
app.get('/api/plans', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUser(token);
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });

  const plans = userPlans.get(user.email) || [];
  res.json(plans);
});

// Deletar plano
app.delete('/api/plans/:id', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUser(token);
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });

  const plans = (userPlans.get(user.email) || []).filter(p => p.id !== req.params.id);
  userPlans.set(user.email, plans);
  res.json({ ok: true });
});

// Atualizar progresso das tarefas
app.put('/api/plans/:id/progress', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUser(token);
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });

  const plans = userPlans.get(user.email) || [];
  const plan = plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plano não encontrado.' });

  plan.taskProgress = req.body.taskProgress;
  userPlans.set(user.email, plans);
  res.json({ ok: true });
});

// ==================== GENERATE ROUTE ====================

app.post('/api/generate', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = getUser(token);
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
app.listen(PORT, () => console.log(`Estrategista IA rodando na porta ${PORT}`));
