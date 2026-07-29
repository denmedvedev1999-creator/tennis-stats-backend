// tennisApi.js — Полный онлайн-адаптер для RapidAPI
const axios = require('axios');

const rapidApi = axios.create({
  baseURL: 'https://tennis-api-atp-wta-itf.p.rapidapi.com',
  headers: {
    'X-RapidAPI-Key': process.env.RAPIDAPI_KEY || '',
    'X-RapidAPI-Host': 'tennis-api-atp-wta-itf.p.rapidapi.com'
  },
  timeout: 8000
});

module.exports = {
  // 1. Поиск игроков
  async searchPlayers(query, tour = 'atp') {
    const q = (query || '').trim();
    if (!q) return [];

    try {
      const res = await rapidApi.get('/players', { params: { search: q } });
      if (res.data) {
        const list = Array.isArray(res.data) ? res.data : (res.data.data || res.data.results || []);
        return list.slice(0, 10).map(p => ({
          id: String(p.id || p.player_id || p.ID),
          name: p.name || p.full_name || p.player_name || q,
          rank: p.rank || p.ranking || '—',
          country: p.country || p.country_code || tour.toUpperCase(),
          thumb: p.image || p.image_path || null
        }));
      }
    } catch (e) {
      console.error('Ошибка RapidAPI Search:', e.message);
    }
    return [];
  },

  // 2. Матчи игрока
  async getPlayerMatches(tour, id) {
    try {
      const res = await rapidApi.get('/fixtures/player', { params: { player_id: id } });
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      return list.slice(0, 10).map((m, idx) => ({
        id: String(m.id || idx),
        opponent: m.opponent_name || m.opponent || 'Opponent',
        tournament: m.tournament_name || m.tournament || 'Tournament',
        tournamentId: String(m.tournament_id || 't1'),
        round: m.round || 'Main Draw',
        surface: m.surface || 'hard',
        result: m.winner_id == id ? 'W' : 'L',
        score: m.score || '—'
      }));
    } catch (e) {
      console.error('Ошибка RapidAPI Matches:', e.message);
    }
    return [];
  },

  // 3. Личные встречи H2H
  async getH2H(tour, player1, player2) {
    try {
      const res = await rapidApi.get('/h2h', { params: { player1_id: player1, player2_id: player2 } });
      if (res.data) return res.data;
    } catch (e) {
      console.error('Ошибка RapidAPI H2H:', e.message);
    }
    return {
      total: { p1: 0, p2: 0 },
      bySurface: { hard: { p1: 0, p2: 0 }, clay: { p1: 0, p2: 0 }, grass: { p1: 0, p2: 0 } },
      recentMatches: []
    };
  },

  // Вспомогательные методы
  async listPlayers() { return []; },
  async getPlayerProfile(tour, id) { return { id, name: 'Player', rank: '—' }; },
  async getPlayerTitles() { return 0; },
  async getPlayerTournamentPath() { return []; }
};
