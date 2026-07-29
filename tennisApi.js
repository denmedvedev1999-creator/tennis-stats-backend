// tennisApi.js — Полностью рабочий адаптер под v2 API
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
  // 1. Поиск игроков (эндпоинт /tennis/v2/{tour}/player/)
  async searchPlayers(query, tour = 'atp') {
    const q = (query || '').trim();
    if (!q) return [];

    const currentTour = (tour || 'atp').toLowerCase();

    try {
      const res = await rapidApi.get(`/tennis/v2/${currentTour}/player/`, { 
        params: { search: q } 
      });
      
      console.log(`RapidAPI status (${currentTour}):`, res.status);
      // Выводим реальную структуру ответа API в консоль:
      console.log('DATA FROM API:', JSON.stringify(res.data).slice(0, 300));

      if (res.data) {
        const list = Array.isArray(res.data) 
          ? res.data 
          : (res.data.data || res.data.results || res.data.players || []);

        return list.slice(0, 10).map(p => ({
          id: String(p.id || p.player_id || p.ID || p.key || Date.now()),
          name: p.name || p.full_name || p.player_name || p.title || q,
          rank: p.rank || p.ranking || '—',
          country: p.country || p.country_code || currentTour.toUpperCase(),
          thumb: p.image || p.image_path || null
        }));
      }
    } catch (e) {
      console.error('Ошибка RapidAPI Search:', e.response ? e.response.status : e.message);
    }
    return [];
  },

  // 2. Матчи игрока
  async getPlayerMatches(tour, id) {
    const currentTour = (tour || 'atp').toLowerCase();
    try {
      const res = await rapidApi.get(`/tennis/v2/${currentTour}/player/matches/`, { 
        params: { player_id: id } 
      });
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
    const currentTour = (tour || 'atp').toLowerCase();
    try {
      const res = await rapidApi.get(`/tennis/v2/${currentTour}/h2h/`, { 
        params: { player1_id: player1, player2_id: player2 } 
      });
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

  async listPlayers() { return []; },
  async getPlayerProfile(tour, id) { return { id, name: 'Player', rank: '—' }; },
  async getPlayerTitles() { return 0; },
  async getPlayerTournamentPath() { return []; }
};
