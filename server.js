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

const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) { cache.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value, ttlSeconds) { cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 }); }
function cacheDelete(key) { cache.delete(key); }
function cacheClearExpired() {
  const now = Date.now();
  for (const [key, hit] of cache.entries()) if (now > hit.expiresAt) cache.delete(key);
}
async function cached(key, ttlSeconds, fn) {
  const hit = cacheGet(key);
  if (hit) return hit;
  const value = await fn();
  cacheSet(key, value, ttlSeconds);
  return value;
}
setInterval(cacheClearExpired, 5 * 60 * 1000).unref();

const TTL = {
  SEARCH: 60 * 60,
  PROFILE: 60 * 60 * 6,
  MATCHES: 60 * 60,
  FIXTURES: 60 * 15, // расписание меняется чаще всего остального
  TOURNAMENT_PATH: 60 * 60 * 24,
  H2H: 60 * 60 * 24,
  H2H_SUMMARY: 60 * 60,
};

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => { console.error(err); res.status(500).json({ error: err.message }); });
}

app.get('/api/players/search', asyncRoute(async (req, res) => {
  const { q = '', tour = 'atp' } = req.query;
  if (!q.trim()) return res.json([]);
  const key = `search:${tour}:${q.trim().toLowerCase()}`;
  res.json(await cached(key, TTL.SEARCH, () => tennisApi.searchPlayers(q, tour)));
}));

app.get('/api/players/:tour/:id', asyncRoute(async (req, res) => {
  const { tour, id } = req.params;
  const unrankedName = tennisApi.parseUnrankedId(id);
  if (unrankedName) {
    return res.json({ id, name: unrankedName, rank: null, country: null, dynamic: true,
      message: 'Игрок не найден в базе рейтингов ATP/WTA — расширенный профиль недоступен.' });
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

app.get('/api/players/:tour/:id/matches', asyncRoute(async (req, res) => {
  const { tour, id } = req.params;
  const limit = Number(req.query.limit) || 10;
  if (tennisApi.parseUnrankedId(id)) return res.json([]);
  const key = `matches:${tour}:${id}:${limit}`;
  res.json(await cached(key, TTL.MATCHES, () => tennisApi.getPlayerMatches(tour, id, { limit })));
}));

// ---------- НОВОЕ: предстоящие матчи игрока ----------
app.get('/api/players/:tour/:id/fixtures', asyncRoute(async (req, res) => {
  const { tour, id } = req.params;
  const limit = Number(req.query.limit) || 10;
  if (tennisApi.parseUnrankedId(id)) return res.json([]);
  const key = `fixtures:${tour}:${id}:${limit}`;
  res.json(await cached(key, TTL.FIXTURES, () => tennisApi.getPlayerFixtures(tour, id, { limit })));
}));

app.get('/api/players/:tour/:id/tournaments/:tournamentId', asyncRoute(async (req, res) => {
  const { tour, id, tournamentId } = req.params;
  if (tennisApi.parseUnrankedId(id)) return res.json([]);
  const key = `tpath:${tour}:${id}:${tournamentId}`;
  res.json(await cached(key, TTL.TOURNAMENT_PATH, () => tennisApi.getPlayerTournamentPath(tour, id, tournamentId)));
}));

app.get('/api/h2h', asyncRoute(async (req, res) => {
  const { tour = 'atp', player1, player2 } = req.query;
  if (!player1 || !player2) return res.status(400).json({ error: 'Нужны player1 и player2' });
  if (!tennisApi.isNumericId(String(player1)) || !tennisApi.isNumericId(String(player2))) {
    return res.json({ player1: null, player2: null, wins: null, matches: [], stats: null,
      message: 'Для одного из игроков нет числового id — H2H недоступен.' });
  }
  const key = `h2h:${tour}:${player1}:${player2}`;
  res.json(await cached(key, TTL.H2H, () => tennisApi.getH2H(tour, Number(player1), Number(player2))));
}));

app.get('/api/h2h/summary', asyncRoute(async (req, res) => {
  const { tour = 'atp', player1, player2 } = req.query;
  if (!player1 || !player2) return res.status(400).json({ error: 'Нужны player1 и player2' });

  if (!tennisApi.isNumericId(String(player1)) || !tennisApi.isNumericId(String(player2))) {
    return res.json({ available: false, message: 'Сравнение доступно только для игроков с числовым id.' });
  }

  const key = `h2hsummary:${tour}:${player1}:${player2}`;
  const result = await cached(key, TTL.H2H_SUMMARY, async () => {
    async function buildPlayerBlock(id) {
      const [profile, matches, surfaceSummary] = await Promise.all([
        tennisApi.getPlayerProfile(tour, id),
        tennisApi.getPlayerMatches(tour, id, { limit: 20 }),
        tennisApi.getPlayerSurfaceSummary(tour, id).catch(() => []),
      ]);
      const form = tennisApi.computeRecentFormStats(matches.map((m) => m._raw), id);
      const currentYear = String(new Date().getFullYear());
      const yearRow = surfaceSummary.find((s) => s.year === currentYear) || null;
      return {
        profile,
        last5: matches.slice(0, 5).map((m) => m.outcome),
        recentMatches: matches.slice(0, 5).map(({ _raw, ...m }) => m),
        form,
        surfaces: yearRow ? yearRow.surfaces : [],
      };
    }

    const [p1, p2, h2h] = await Promise.all([
      buildPlayerBlock(player1),
      buildPlayerBlock(player2),
      tennisApi.getH2H(tour, Number(player1), Number(player2)),
    ]);

    return { available: true, wins: h2h.wins, player1: p1, player2: p2 };
  });

  res.json(result);
}));

app.delete('/api/cache/:key', (req, res) => { cacheDelete(req.params.key); res.json({ ok: true }); });
app.get('/health', (req, res) => res.json({ ok: true, cacheSize: cache.size }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Tennis stats backend on http://localhost:${PORT}`));
