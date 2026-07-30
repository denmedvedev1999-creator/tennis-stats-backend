// tennisApi.js — слой доступа к RapidAPI "Tennis API - ATP WTA ITF"
const axios = require('axios');

const RAPID_KEY = process.env.RAPIDAPI_KEY;
if (!RAPID_KEY) {
  console.warn('[tennisApi] RAPIDAPI_KEY не задан в .env — запросы к RapidAPI будут падать с 401/403.');
}

const rapidApi = axios.create({
  baseURL: 'https://tennis-api-atp-wta-itf.p.rapidapi.com',
  timeout: 10000,
  headers: {
    'X-RapidAPI-Key': RAPID_KEY || '',
    'X-RapidAPI-Host': 'tennis-api-atp-wta-itf.p.rapidapi.com',
  },
});

function normalizeTour(tour) {
  const t = String(tour || 'atp').toLowerCase();
  return t === 'wta' ? 'wta' : 'atp';
}

function normalizePlayer(raw) {
  if (!raw) return null;
  const countryAcr =
    raw.countryAcr || (raw.country && (raw.country.acronym || raw.country.name)) || null;
  const rankValue = raw.currentRank ?? raw.rank;
  return {
    id: raw.id != null ? String(raw.id) : null,
    name: raw.name || null,
    rank: rankValue != null && rankValue !== '' ? Number(rankValue) : null,
    country: countryAcr && countryAcr !== 'N/A' ? countryAcr : null,
  };
}

function buildUnrankedId(name) {
  return `unranked_${encodeURIComponent(name)}`;
}
function parseUnrankedId(id) {
  if (typeof id !== 'string' || !id.startsWith('unranked_')) return null;
  try { return decodeURIComponent(id.slice('unranked_'.length)); } catch { return null; }
}
function isNumericId(id) {
  return typeof id === 'string' && /^\d+$/.test(id);
}

function calcAge(birthday) {
  if (!birthday) return null;
  const b = new Date(birthday);
  if (Number.isNaN(b.getTime())) return null;
  return Math.floor((Date.now() - b.getTime()) / (365.25 * 24 * 3600 * 1000));
}

function parseHand(playsStr) {
  if (!playsStr) return null;
  return /left/i.test(playsStr) ? 'слева' : 'справа';
}

// ---------- внутренний кэш индекса игроков (для обогащения поиска) ----------
const playersIndexCache = new Map();
const PLAYERS_INDEX_TTL_MS = 6 * 60 * 60 * 1000;

async function getPlayersIndex(tour) {
  const cached = playersIndexCache.get(tour);
  if (cached && Date.now() < cached.expiresAt) return cached.byName;

  const byName = new Map();
  try {
    const pages = await Promise.all(
      [1, 2, 3].map((pageNo) =>
        rapidApi
          .get(`/tennis/v2/ms-api/${tour}/player`, { params: { pageSize: 100, pageNo } })
          .then((res) => (Array.isArray(res.data) ? res.data : []))
          .catch(() => [])
      )
    );
    for (const page of pages) {
      for (const raw of page) {
        const normalized = normalizePlayer(raw);
        if (normalized?.name) byName.set(normalized.name.toLowerCase(), normalized);
      }
    }
  } catch (e) {
    console.error('[tennisApi] Не удалось построить индекс игроков:', e.message);
  }
  playersIndexCache.set(tour, { expiresAt: Date.now() + PLAYERS_INDEX_TTL_MS, byName });
  return byName;
}

function parseSets(resultStr) {
  if (!resultStr) return [];
  return resultStr
    .trim()
    .split(/\s+/)
    .map((set) => set.replace(/\(\d+\)/, ''))
    .map((set) => set.split('-').map((n) => parseInt(n, 10)))
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

function computeRecentFormStats(rawMatches, playerId) {
  let totalGamesSum = 0, totalGamesCount = 0;
  let set1GamesSum = 0, set1GamesCount = 0;
  let set1Wins = 0, set1Total = 0;
  let straightSetWins = 0, threeSetWins = 0, threeSetTotal = 0;

  for (const m of rawMatches) {
    const sets = parseSets(m.result);
    if (sets.length === 0) continue;
    const iAmPlayer1 = String(m.player1Id) === String(playerId);
    const iWon = iAmPlayer1;

    sets.forEach(([g1, g2]) => { totalGamesSum += g1 + g2; totalGamesCount += 1; });
    const [s1a, s1b] = sets[0];
    set1GamesSum += s1a + s1b;
    set1GamesCount += 1;
    const myFirstSetGames = iAmPlayer1 ? s1a : s1b;
    const oppFirstSetGames = iAmPlayer1 ? s1b : s1a;
    if (myFirstSetGames !== oppFirstSetGames) {
      set1Total += 1;
      if (myFirstSetGames > oppFirstSetGames) set1Wins += 1;
    }
    if (sets.length === 2 && iWon) straightSetWins += 1;
    if (sets.length === 3) { threeSetTotal += 1; if (iWon) threeSetWins += 1; }
  }

  const totalWins = straightSetWins + threeSetWins;
  return {
    sampleSize: rawMatches.length,
    avgTotalGames: totalGamesCount ? +(totalGamesSum / totalGamesCount).toFixed(1) : null,
    avgSet1Games: set1GamesCount ? +(set1GamesSum / set1GamesCount).toFixed(1) : null,
    set1WinPct: set1Total ? Math.round((set1Wins / set1Total) * 100) : null,
    bestOf3_2_0_Pct: totalWins ? Math.round((straightSetWins / totalWins) * 100) : null,
    bestOf3_2_1_Pct: threeSetTotal ? Math.round((threeSetWins / threeSetTotal) * 100) : null,
  };
}

module.exports = {
  normalizePlayer,
  isNumericId,
  parseUnrankedId,
  computeRecentFormStats,

  async listPlayers(tour, { pageSize = 100, pageNo = 1, filter, include } = {}) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(`/tennis/v2/ms-api/${t}/player`, { params: { pageSize, pageNo, filter, include } });
    const list = Array.isArray(res.data) ? res.data : [];
    return list.map(normalizePlayer).filter((p) => p && p.id);
  },

  async searchPlayers(query, tour = 'atp') {
    const q = (query || '').trim();
    if (!q) return [];
    const t = normalizeTour(tour);

    let bucket = [];
    try {
      const res = await rapidApi.get('/tennis/v2/search', { params: { search: q } });
      const categories = res.data?.data || [];
      const wanted = categories.find((c) => c.category === `player_${t}`);
      bucket = wanted?.result || [];
    } catch (e) {
      console.error('[tennisApi] Ошибка /tennis/v2/search:', e.message);
      return [];
    }
    if (bucket.length === 0) return [];

    const index = await getPlayersIndex(t);
    return bucket.map((r) => {
      const found = r.name ? index.get(r.name.toLowerCase()) : null;
      if (found) return found;
      return { id: buildUnrankedId(r.name), name: r.name, rank: null, country: r.countryAcr && r.countryAcr !== 'N/A' ? r.countryAcr : null };
    });
  },

  async getPlayerProfile(tour, id) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(`/tennis/v2/ms-api/${t}/player/profile/${id}`, { params: { include: 'form,ranking,country' } });
    const data = res.data?.data;
    if (!data) return null;
    const info = data.information || {};
    return {
      ...normalizePlayer(data),
      birthday: data.birthday || null,
      age: calcAge(data.birthday),
      heightCm: info.height || null,
      hand: parseHand(info.plays),
      turnedPro: info.turnedPro || null,
      coach: data.coach || null,
      playerStatus: data.playerStatus || null,
      form: data.form || null,
    };
  },

  async getPlayerTitles(tour, id) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(`/tennis/v2/ms-api/${t}/player/titles/${id}`);
    return res.data?.data || [];
  },

  async getPlayerMatches(tour, id, { limit = 10 } = {}) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(`/tennis/v2/ms-api/${t}/player/past-matches/${id}`, { params: { pageSize: limit, include: 'round,tournament' } });
    const list = res.data?.data || [];
    return list.map((m) => {
      const iAmPlayer1 = String(m.player1Id) === String(id);
      const opponent = iAmPlayer1 ? m.player2 : m.player1;
      return {
        id: String(m.id),
        date: m.date || null,
        opponent: opponent ? normalizePlayer(opponent) : null,
        tournament: m.tournament ? { id: m.tournament.id, name: m.tournament.name, court: m.tournament.court || null } : { id: m.tournamentId, name: null, court: null },
        round: m.round ? m.round.name : null,
        score: m.result || null,
        outcome: iAmPlayer1 ? 'W' : 'L',
        _raw: { player1Id: m.player1Id, result: m.result },
      };
    });
  },

  // ---------- НОВОЕ: предстоящие матчи игрока (таблица Today, не архив Game) ----------
  async getPlayerFixtures(tour, id, { limit = 10 } = {}) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(`/tennis/v2/${t}/fixtures/player/${id}`, {
      params: { pageSize: limit, include: 'round,tournament,tournament.court' },
    });
    const list = res.data?.data || [];
    return list.map((f) => {
      const iAmPlayer1 = String(f.player1Id) === String(id);
      const opponent = iAmPlayer1 ? f.player2 : f.player1;
      return {
        id: String(f.id),
        date: f.date || null, // в Today-таблице часто null, пока время не назначено
        opponent: opponent ? normalizePlayer(opponent) : null,
        tournament: f.tournament ? { id: f.tournament.id, name: f.tournament.name, court: f.tournament.court || null } : { id: f.tournamentId, name: null, court: null },
        round: f.round ? f.round.name : null,
      };
    });
  },

  async getPlayerSurfaceSummary(tour, id) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(`/tennis/v2/ms-api/${t}/player/surface-summary/${id}`);
    return res.data?.data || [];
  },

  async getPlayerTournamentPath(tour, id, tournamentId) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(`/tennis/v2/ms-api/${t}/player/tournament-record/${id}/${tournamentId}`);
    return res.data?.data || [];
  },

  async getH2H(tour, player1, player2) {
    const t = normalizeTour(tour);
    const [infoRes, matchesRes, statsRes] = await Promise.allSettled([
      rapidApi.get(`/tennis/v2/${t}/h2h/info/${player1}/${player2}`),
      rapidApi.get(`/tennis/v2/${t}/h2h/matches/${player1}/${player2}`, { params: { pageSize: 10, include: 'round,tournament' } }),
      rapidApi.get(`/tennis/v2/${t}/h2h/stats/${player1}/${player2}`),
    ]);
    const info = infoRes.status === 'fulfilled' ? infoRes.value.data : null;
    const matches = matchesRes.status === 'fulfilled' ? matchesRes.value.data?.data || [] : [];
    const stats = statsRes.status === 'fulfilled' ? statsRes.value.data?.data || null : null;

    return {
      player1: info?.player1 ? normalizePlayer(info.player1) : null,
      player2: info?.player2 ? normalizePlayer(info.player2) : null,
      wins: info ? { player1: info.player1Wins ?? 0, player2: info.player2Wins ?? 0 } : null,
      matches: matches.map((m) => ({
        id: String(m.id),
        date: m.date || null,
        result: m.result || null,
        tournament: m.tournament ? { id: m.tournament.id, name: m.tournament.name } : null,
      })),
      stats,
    };
  },
};
