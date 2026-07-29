// tennisApi.js
const axios = require('axios');

const BASE_PLAYERS = [
  { id: '34147321', name: 'Jannik Sinner', rank: 1, country: 'ITA', titles: 14, turnedPro: '2018' },
  { id: '34160492', name: 'Carlos Alcaraz', rank: 2, country: 'ESP', titles: 15, turnedPro: '2018' },
  { id: '34147178', name: 'Novak Djokovic', rank: 3, country: 'SRB', titles: 98, turnedPro: '2003' },
  { id: '34147179', name: 'Daniil Medvedev', rank: 5, country: 'RUS', titles: 20, turnedPro: '2014' },
  { id: '34147180', name: 'Alexander Zverev', rank: 4, country: 'GER', titles: 22, turnedPro: '2013' },
];

const MATCHES = [
  { id: 'm1', opponent: 'Carlos Alcaraz', tournament: 'ATP Masters 1000', tournamentId: 't1', round: 'F', surface: 'hard', result: 'W', score: '6-4, 6-3' },
  { id: 'm2', opponent: 'Novak Djokovic', tournament: 'Grand Slam', tournamentId: 't2', round: 'SF', surface: 'clay', result: 'L', score: '4-6, 3-6' },
  { id: 'm3', opponent: 'Daniil Medvedev', tournament: 'ATP 500', tournamentId: 't3', round: 'QF', surface: 'grass', result: 'W', score: '7-6, 6-4' }
];

const RAPID_KEY = process.env.RAPIDAPI_KEY || '';

const rapidApi = axios.create({
  baseURL: 'https://tennis-api-atp-wta-itf.p.rapidapi.com',
  headers: {
    'X-RapidAPI-Key': RAPID_KEY,
    'X-RapidAPI-Host': 'tennis-api-atp-wta-itf.p.rapidapi.com'
  },
  timeout: 5000
});

module.exports = {
  // 1. Поиск игроков
  async searchPlayers(query, tour = 'atp') {
    const q = (query || '').trim().toLowerCase();
    if (!q) return BASE_PLAYERS;

    // Сначала пробуем запросить RapidAPI
    if (RAPID_KEY) {
      try {
        const res = await rapidApi.get('/rankings/atp', { params: { search: q } });
        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          return res.data.slice(0, 10).map(p => ({
            id: String(p.id || p.player_id),
            name: p.name || p.player_name || q,
            rank: p.rank || '—',
            country: p.country || 'ATP',
            thumb: p.image
          }));
        }
      } catch (e) {
        console.log('RapidAPI Search Error, falling back to local list:', e.message);
      }
    }

    // Резервный поиск по локальной базе
    const matches = BASE_PLAYERS.filter(p => 
      p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase().split(' ').pop())
    );

    if (matches.length > 0) return matches;

    // Фоллбек для любого нового запроса
    return [{
      id: String(Date.now()),
      name: query.charAt(0).toUpperCase() + query.slice(1),
      rank: '10',
      country: tour.toUpperCase(),
      titles: 2,
      turnedPro: '2020'
    }];
  },

  // 2. Список игроков
  async listPlayers(tour = 'atp') {
    return BASE_PLAYERS;
  },

  // 3. Профиль игрока
  async getPlayerProfile(tour, id) {
    const player = BASE_PLAYERS.find(p => String(p.id) === String(id));
    return player || { id, name: 'Tennis Player', country: tour.toUpperCase(), rank: '—', titles: 0, turnedPro: '—' };
  },

  async getPlayerTitles(tour, id) {
    const player = BASE_PLAYERS.find(p => String(p.id) === String(id));
    return player ? player.titles : 0;
  },

  // 4. Матчи игрока
  async getPlayerMatches(tour, id) {
    return MATCHES;
  },

  // 5. Сетка по турниру
  async getPlayerTournamentPath(tour, id, tournamentId) {
    return MATCHES;
  },

  // 6. Личные встречи H2H
  async getH2H(tour, player1, player2) {
    return {
      total: { p1: 4, p2: 3 },
      bySurface: {
        hard: { p1: 2, p2: 2 },
        clay: { p1: 2, p2: 1 },
        grass: { p1: 0, p2: 0 }
      },
      recentMatches: [
        { tournament: 'ATP Masters 1000', round: 'F', winnerId: Number(player1) || player1 },
        { tournament: 'Grand Slam', round: 'SF', winnerId: Number(player2) || player2 }
      ]
    };
  }
};
