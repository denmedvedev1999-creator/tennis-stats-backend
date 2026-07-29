// tennisApi.js — Работа с реальными онлайн-эндпоинтами RapidAPI
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
  // 1. Поиск игроков онлайн
  async searchPlayers(query, tour = 'atp') {
    const q = (query || '').trim();
    if (!q) return [];

    try {
      // Рабочий эндпоинт этого API для поиска/списка игроков
      const res = await rapidApi.get('/players', { params: { search: q } });
      
      console.log('Живой ответ RapidAPI Status:', res.status);

      if (res.data) {
        // Если API возвращает массив или объект с полем data/results
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
      console.error('Ошибка RapidAPI (Код):', e.response ? e.response.status : e.message);
      if (e.response && e.response.data) {
        console.error('Детали ошибки API:', JSON.stringify(e.response.data));
      }
    }

    return [];
  },

  // 2. Матчи игрока онлайн
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
      console.error('Ошибка матчей API:', e.message);
    }
    return [];
  },

  // 3. Личные встречи H2H онлайн
  async getH2H(tour, player1, player2) {
    try {
      const res = await rapidApi.get('/h2h', { params: { player1_id: player1, player2_id: player2 } });
      if (res.data) return res.data;
    } catch (e) {
      console.error('Ошибка H2H API:', e.message);
    }
    return { total: { p1: 0, p2: 0 }, bySurface: { hard: { p1: 0, p2: 0 }, clay: { p1: 0, p2: 0 }, grass: { p1: 0, p2: 0 } }, recentMatches: [] };
  },

  async listPlayers() { return []; },
  async getPlayerProfile(tour, id) { return { id, name: 'Player', rank: '—' }; },
  async getPlayerTitles() { return 0; },
  async getPlayerTournamentPath() { return []; }
};
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
