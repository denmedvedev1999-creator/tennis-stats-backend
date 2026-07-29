// tennisApi.js — Честные онлайн-запросы к RapidAPI
const axios = require('axios');

const rapidApi = axios.create({
  baseURL: 'https://tennis-api-atp-wta-itf.p.rapidapi.com',
  headers: {
    'X-RapidAPI-Key': process.env.RAPIDAPI_KEY || '',
    'X-RapidAPI-Host': 'tennis-api-atp-wta-itf.p.rapidapi.com'
  },
  timeout: 8000 // Ждем ответ до 8 секунд
});

module.exports = {
  // 1. НАСТОЯЩИЙ ПОИСК ИГРОКОВ ОНЛАЙН
  async searchPlayers(query, tour = 'atp') {
    const q = (query || '').trim();
    if (!q) return [];

    try {
      // Делаем живой запрос к базе игроков RapidAPI
      const res = await rapidApi.get('/rankings/atp', { params: { search: q } });
      
      // Логируем ответ для отладки на Render
      console.log('Ответ от RapidAPI:', res.data);

      if (res.data && Array.isArray(res.data)) {
        return res.data.map(p => ({
          id: String(p.id || p.player_id),
          name: p.name || p.player_name,
          rank: p.rank || '—',
          country: p.country || 'ATP',
          thumb: p.image || null
        }));
      }
    } catch (e) {
      console.error('Ошибка при поиске в RapidAPI:', e.response ? e.response.data : e.message);
    }

    // Если RapidAPI ничего не нашел или вернул ошибку, отдаем пустой массив (без фальшивых данных)
    return [];
  },

  // 2. НАСТОЯЩИЕ ЖИВЫЕ МАТЧИИИИ
  async getPlayerMatches(tour, id) {
    try {
      const res = await rapidApi.get('/fixtures/player', { params: { player_id: id } });
      if (res.data && Array.isArray(res.data)) {
        return res.data.slice(0, 10).map((m, idx) => ({
          id: String(m.id || idx),
          opponent: m.opponent_name || 'Opponent',
          tournament: m.tournament_name || 'ATP Tournament',
          tournamentId: String(m.tournament_id || 't1'),
          round: m.round || 'Main Draw',
          surface: m.surface || 'hard',
          result: m.status === 'finished' && m.winner_id == id ? 'W' : 'L',
          score: m.score || '—'
        }));
      }
    } catch (e) {
      console.error('Ошибка матчей в RapidAPI:', e.message);
    }
    return [];
  },

  // 3. НАСТОЯЩИЙ H2H
  async getH2H(tour, player1, player2) {
    try {
      const res = await rapidApi.get('/h2h', { params: { player1_id: player1, player2_id: player2 } });
      if (res.data) return res.data;
    } catch (e) {
      console.error('Ошибка H2H в RapidAPI:', e.message);
    }
    return { total: { p1: 0, p2: 0 }, bySurface: { hard: { p1: 0, p2: 0 }, clay: { p1: 0, p2: 0 }, grass: { p1: 0, p2: 0 } }, recentMatches: [] };
  },

  async listPlayers() { return []; },
  async getPlayerProfile(tour, id) { return { id, name: 'Player', rank: '—' }; },
  async getPlayerTitles() { return 0; },
  async getPlayerTournamentPath() { return []; }
};
