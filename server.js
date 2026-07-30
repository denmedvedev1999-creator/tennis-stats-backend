// server.js
require('dotenv').config();
const express = require('express');
const tennisApi = require('./tennisApi');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
  next();
});

// ---------- in-memory кэш с TTL ----------
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value, ttlSeconds) {
  cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000, createdAt: Date.now() });
}
function cacheDelete(key) {
  cache.delete(key);
}
function cacheClearExpired() {
  const now = Date.now();
  for (const [key, hit] of cache.entries()) {
    if (now > hit.expiresAt) cache.delete(key);
  }
}
async function cached(key, ttlSeconds, fn) {
  const hit = cacheGet(key);
  if (hit) return hit;
  const value = await fn();
  cacheSet(key, value, ttlSeconds);
  return value;
}
// периодическая очистка протухших записей, чтобы Map не разрасталась бесконечно
setInterval(cacheClearExpired, 5 * 60 * 1000).unref();

const TTL = {
  SEARCH: 60 * 60,       // час — рейтинги/составы меняются нечасто, но поиск чаще, чем раз в сутки
  PROFILE: 60 * 60 * 6,
  MATCHES: 60 * 60,
  TOURNAMENT_PATH: 60 * 60 * 24,
  H2H: 60 * 60 * 24,
};

function asyncRoute(fn) {
  return (req, res) =>
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: err.message });
    });
}

// ---------- 1. Поиск игрока ----------
// Никакой сверки/фильтрации через listPlayers на этом уровне — вся логика
// (обогащение + честный fallback без потери результатов) уже внутри tennisApi.searchPlayers.
app.get('/api/players/search', asyncRoute(async (req, res) => {
  const { q = '', tour = 'atp' } = req.query;
  if (!q.trim()) return res.json([]);

  const key = `search:${tour}:${q.trim().toLowerCase()}`;
  const result = await cached(key, TTL.SEARCH, () => tennisApi.searchPlayers(q, tour));
  res.json(result);
}));

// ---------- 2. Профиль игрока ----------
app.get('/api/players/:tour/:id', asyncRoute(async (req, res) => {
  const { tour, id } = req.params;

  // Игрок без записи в рейтинговой базе (динамическая карточка из поиска) —
  // полного профиля по RapidAPI для него не существует, отвечаем честно, без фейков.
  const unrankedName = tennisApi.parseUnrankedId(id);
  if (unrankedName) {
    return res.json({
      id,
      name: unrankedName,
      rank: null,
      country: null,
      dynamic: true,
      message: 'Игрок не найден в базе рейтингов ATP/WTA — расширенный профиль недоступен.',
    });
  }

  const key = `profile:${tour}:${id}`;
  const result = await cached(key, TTL.PROFILE, async () => {
    const [profile, titles] = await Promise.all([
      tennisApi.getPlayerProfile(tour, id),
      tennisApi.getPlayerTitles(tour, id).catch(() => []),
    ]);
    if (!profile) return null;
    return { ...profile, titles };
  });

  if (!result) return res.status(404).json({ error: 'Игрок не найден' });
  res.json(result);
}));

// ---------- 3. Последние матчи игрока ----------
app.get('/api/players/:tour/:id/matches', asyncRoute(async (req, res) => {
  const { tour, id } = req.params;
  const limit = Number(req.query.limit) || 10;

  if (tennisApi.parseUnrankedId(id)) return res.json([]); // нет числового id — нет и матчей

  const key = `matches:${tour}:${id}:${limit}`;
  const result = await cached(key, TTL.MATCHES, () => tennisApi.getPlayerMatches(tour, id, { limit }));
  res.json(result);
}));

// ---------- 4. Путь игрока по турниру ----------
app.get('/api/players/:tour/:id/tournaments/:tournamentId', asyncRoute(async (req, res) => {
  const { tour, id, tournamentId } = req.params;
  if (tennisApi.parseUnrankedId(id)) return res.json([]);

  const key = `tpath:${tour}:${id}:${tournamentId}`;
  const result = await cached(key, TTL.TOURNAMENT_PATH, () =>
    tennisApi.getPlayerTournamentPath(tour, id, tournamentId)
  );
  res.json(result);
}));

// ---------- 5. H2H ----------
app.get('/api/h2h', asyncRoute(async (req, res) => {
  const { tour = 'atp', player1, player2 } = req.query;
  if (!player1 || !player2) {
    return res.status(400).json({ error: 'Нужны query-параметры player1 и player2 (числовые id игроков)' });
  }
  if (!tennisApi.isNumericId(String(player1)) || !tennisApi.isNumericId(String(player2))) {
    return res.json({
      player1: null,
      player2: null,
      wins: null,
      matches: [],
      stats: null,
      message: 'Для одного из игроков нет числового id (не найден в базе рейтингов) — H2H недоступен.',
    });
  }

  const key = `h2h:${tour}:${player1}:${player2}`;
  const result = await cached(key, TTL.H2H, () => tennisApi.getH2H(tour, Number(player1), Number(player2)));
  res.json(result);
}));

// ---------- служебное: ручная инвалидация кэша ----------
app.delete('/api/cache/:key', (req, res) => {
  cacheDelete(req.params.key);
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true, cacheSize: cache.size }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Tennis stats backend on http://localhost:${PORT}`));
