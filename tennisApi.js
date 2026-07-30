// tennisApi.js — слой доступа к RapidAPI "Tennis API - ATP WTA ITF"
// Реальная схема (проверено по официальной документации провайдера):
//   GET /tennis/v2/ms-api/{tour}/player                          -> [ {id, name, countryAcr, currentRank, points, ...} ]  (сырой массив, без обёртки data)
//   GET /tennis/v2/ms-api/{tour}/player/profile/{id}             -> { data: {id, name, countryAcr, currentRank, country:{...}, information:{...}} }
//   GET /tennis/v2/ms-api/{tour}/player/past-matches/{id}        -> { data: [...], hasNextPage }
//   GET /tennis/v2/ms-api/{tour}/player/titles/{id}              -> { data: [...] }
//   GET /tennis/v2/{tour}/h2h/info/{p1}/{p2}                     -> { player1Wins, player2Wins, player1:{...}, player2:{...} }
//   GET /tennis/v2/{tour}/h2h/matches/{p1}/{p2}                  -> { data: [...], hasNextPage }
//   GET /tennis/v2/{tour}/h2h/stats/{p1}/{p2}                    -> { data: { player1Stats, player2Stats, matchesCount } }
//   GET /tennis/v2/search?search=<q>                             -> { data: [ {category:'player_atp'|'player_wta'|'tournament_atp'|'tournament_wta', total, result:[...]} ] }
//     ВАЖНО: result-объекты игроков из /search содержат ТОЛЬКО { name, birthday, countryAcr } — без id и без ранга!

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
  return t === 'wta' ? 'wta' : 'atp'; // API принимает только atp/wta, itf не существует как отдельный tourType
}

// ---------- Единый формат игрока: { id, name, rank, country } ----------
function normalizePlayer(raw) {
  if (!raw) return null;
  const countryAcr =
    raw.countryAcr ||
    (raw.country && (raw.country.acronym || raw.country.name)) ||
    null;

  const rankValue = raw.currentRank ?? raw.rank;

  return {
    id: raw.id != null ? String(raw.id) : null,
    name: raw.name || null,
    rank: rankValue != null && rankValue !== '' ? Number(rankValue) : null,
    country: countryAcr || null,
  };
}

// Стабильный псевдо-id для игрока, которого нет в рейтинговой базе (нашли только по имени через /search).
// Используется вместо фейковых заглушек вида "TENNIS PLAYER" / rank: 1.
function buildUnrankedId(name) {
  return `unranked_${encodeURIComponent(name)}`;
}
function parseUnrankedId(id) {
  if (typeof id !== 'string' || !id.startsWith('unranked_')) return null;
  try {
    return decodeURIComponent(id.slice('unranked_'.length));
  } catch {
    return null;
  }
}
function isNumericId(id) {
  return typeof id === 'string' && /^\d+$/.test(id);
}

// ---------- Внутренний кэш индекса игроков (для обогащения результатов поиска id/rank'ом) ----------
// Это НЕ кэш на уровне server.js — это отдельный служебный кэш конкретно для enrichment.
const playersIndexCache = new Map(); // tour -> { expiresAt, byName: Map<lowerName, normalizedPlayer> }
const PLAYERS_INDEX_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов

async function getPlayersIndex(tour) {
  const cached = playersIndexCache.get(tour);
  if (cached && Date.now() < cached.expiresAt) return cached.byName;

  const byName = new Map();
  try {
    // Тянем несколько страниц топ-игроков (300 шт.), этого достаточно для подавляющего
    // большинства обычных поисковых запросов (топ-уровень ATP/WTA).
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

module.exports = {
  normalizePlayer,
  isNumericId,
  parseUnrankedId,

  // 1. Список игроков тура (реальная реализация, не заглушка)
  async listPlayers(tour, { pageSize = 100, pageNo = 1, filter, include } = {}) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(`/tennis/v2/ms-api/${t}/player`, {
      params: { pageSize, pageNo, filter, include },
    });
    const list = Array.isArray(res.data) ? res.data : [];
    return list.map(normalizePlayer).filter((p) => p && p.id);
  },

  // 2. Поиск игроков. НИКОГДА не отбрасывает найденное через .filter(Boolean).
  // Если игрок не входит в топ рейтинговых списков — возвращается динамическая карточка
  // с реальным именем/страной из /search, rank: null (без навязанного "1"), без фейковых надписей.
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

    // Каждый результат из /search обязательно попадает в ответ — либо обогащённый
    // реальными id/rank из индекса, либо как динамическая карточка.
    return bucket.map((r) => {
      const name = r.name;
      const found = name ? index.get(name.toLowerCase()) : null;
      if (found) return found;

      return {
        id: buildUnrankedId(name),
        name,
        rank: null, // честно "нет данных о ранге", а не фейковая единица
        country: r.countryAcr || null,
      };
    });
  },

  // 3. Профиль игрока
  async getPlayerProfile(tour, id) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(`/tennis/v2/ms-api/${t}/player/profile/${id}`, {
      params: { include: 'form,ranking,country' },
    });
    const data = res.data?.data;
    if (!data) return null;
    return {
      ...normalizePlayer(data),
      birthday: data.birthday || null,
      coach: data.coach || null,
      playerStatus: data.playerStatus || null,
      information: data.information || null,
      form: data.form || null,
    };
  },

  // 4. Титулы игрока
  async getPlayerTitles(tour, id) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(`/tennis/v2/ms-api/${t}/player/titles/${id}`);
    return res.data?.data || [];
  },

  // 5. Последние матчи игрока
  async getPlayerMatches(tour, id, { limit = 10 } = {}) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(`/tennis/v2/ms-api/${t}/player/past-matches/${id}`, {
      params: { pageSize: limit, include: 'round,tournament' },
    });
    const list = res.data?.data || [];
    return list.map((m) => {
      const iAmPlayer1 = String(m.player1Id) === String(id);
      const opponent = iAmPlayer1 ? m.player2 : m.player1;
      return {
        id: String(m.id),
        date: m.date || null,
        opponent: opponent ? normalizePlayer(opponent) : null,
        tournament: m.tournament
          ? { id: m.tournament.id, name: m.tournament.name, court: m.tournament.court || null }
          : { id: m.tournamentId, name: null, court: null },
        round: m.round ? m.round.name : null,
        result: m.result || null, // счёт как есть, без выдумывания "6-4, 6-3"
      };
    });
  },

  // 6. Путь игрока по турниру (career record) — реальная реализация
  async getPlayerTournamentPath(tour, id, tournamentId) {
    const t = normalizeTour(tour);
    const res = await rapidApi.get(
      `/tennis/v2/ms-api/${t}/player/tournament-record/${id}/${tournamentId}`
    );
    return res.data?.data || [];
  },

  // 7. H2H — сводка + список матчей + агрегированная статистика
  async getH2H(tour, player1, player2) {
    const t = normalizeTour(tour);
    const [infoRes, matchesRes, statsRes] = await Promise.allSettled([
      rapidApi.get(`/tennis/v2/${t}/h2h/info/${player1}/${player2}`),
      rapidApi.get(`/tennis/v2/${t}/h2h/matches/${player1}/${player2}`, {
        params: { pageSize: 10, include: 'round,tournament' },
      }),
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
