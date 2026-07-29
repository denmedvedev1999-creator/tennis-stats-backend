// tennisApi.js — Рабочий маппинг под реальную структуру RapidAPI
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
  // 1. Поиск игроков с фильтрацией по name
  async searchPlayers(query, tour = 'atp') {
    const q = (query || '').trim().toLowerCase();
    const currentTour = (tour || 'atp').toLowerCase();

    try {
      const res = await rapidApi.get(`/tennis/v2/${currentTour}/player/`);
      
      if (res.data && Array.isArray(res.data.data)) {
        let players = res.data.data;

        if (q) {
          players = players.filter(p => p.name && p.name.toLowerCase().includes(q));
        }

        return players.slice(0, 15).map(p => ({
          id: String(p.id),
          name: p.name || 'Unknown Player',
          rank: p.currentRank ? String(p.currentRank) : '—',
          country: p.countryAcr || (p.country && p.country.acronym) || currentTour.toUpperCase(),
          thumb: null
        }));
      }
    } catch (e) {
      console.error('Ошибка RapidAPI Search:', e.message);
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
