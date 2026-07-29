// server.js
const express = require('express');
const cors = require('cors');
const tennisApi = require('./tennisApi');

const app = express();
app.use(cors());
app.use(express.json());

// Простой хелпер для асинхронных роутов
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Простейший In-Memory Кэш
const cacheStore = new Map();
const TTL = { SEARCH: 300, PROFILE: 600, MATCHES: 300, TOURNAMENT_PATH: 600, H2H: 600 };

async function cached(key, ttlSeconds, fetcher) {
  const now = Date.now();
  if (cacheStore.has(key)) {
    const item = cacheStore.get(key);
    if (now < item.expiresAt && item.data && item.data.length > 0) {
      return item.data;
    }
  }
  const data = await fetcher();
  if (data) {
    cacheStore.set(key, { data, expiresAt: now + ttlSeconds * 1000 });
  }
  return data;
}

// 1. Поиск игрока
app.get('/api/players/search', asyncRoute(async (req, res) => {
  const { q = '', tour = 'atp' } = req.query;
  if (!q.trim()) return res.json([]);

  const key = `search:${tour}:${q.toLowerCase()}`;
  
  const result = await cached(key, TTL.SEARCH, async () => {
    return await tennisApi.searchPlayers(q, tour);
  });

  res.json(result);
}));

// 2. Профиль игрока
app.get('/api/players/:tour/:id', asyncRoute(async (req, res) => {
  const { tour, id } = req.params;
  const key = `profile:${tour}:${id}`;
  const result = await cached(key, TTL.PROFILE, async () => {
    const [profile, titles] = await Promise.all([
      tennisApi.getPlayerProfile(tour, id),
      tennisApi.getPlayerTitles(tour, id).catch(() => null),
    ]);
    return { ...profile, titles };
  });
  res.json(result);
}));

// 3. Последние матчи игрока
app.get('/api/players/:tour/:id/matches', asyncRoute(async (req, res) => {
  const { tour, id } = req.params;
  const limit = Number(req.query.limit) || 10;
  const key = `matches:${tour}:${id}:${limit}`;
  const result = await cached(key, TTL.MATCHES, () =>
    tennisApi.getPlayerMatches(tour, id, { limit })
  );
  res.json(result);
}));

// 4. Путь игрока по турниру
app.get('/api/players/:tour/:id/tournaments/:tournamentId', asyncRoute(async (req, res) => {
  const { tour, id, tournamentId } = req.params;
  const key = `tpath:${tour}:${id}:${tournamentId}`;
  const result = await cached(key, TTL.TOURNAMENT_PATH, () =>
    tennisApi.getPlayerTournamentPath(tour, id, tournamentId)
  );
  res.json(result);
}));

// 5. H2H Сравнение
app.get('/api/h2h', asyncRoute(async (req, res) => {
  const { tour = 'atp', player1, player2 } = req.query;
  if (!player1 || !player2) {
    return res.status(400).json({ error: 'Нужны query-параметры player1 и player2 (id игроков)' });
  }
  const key = `h2h:${tour}:${player1}:${player2}`;
  const result = await cached(key, TTL.H2H, () =>
    tennisApi.getH2H(tour, player1, player2)
  );
  res.json(result);
}));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Tennis stats backend on http://localhost:${PORT}`));
