# Tennis stats backend

## Запуск

```bash
npm install
cp .env.example .env
# впиши свой RAPIDAPI_KEY в .env
npm start
```

Сервер поднимется на `http://localhost:3001`.

## Проверка

```bash
curl "http://localhost:3001/api/players/search?q=sinner&tour=atp"
curl "http://localhost:3001/api/players/atp/47275"
curl "http://localhost:3001/api/players/atp/47275/matches?limit=5"
curl "http://localhost:3001/api/h2h?tour=atp&player1=68074&player2=47275"
```

(68074 = Carlos Alcaraz, 47275 = Jannik Sinner — id из примеров в документации провайдера)

## Фронтенд уже подключён

`tennis-stats-prototype.jsx` больше не использует моки — он реально ходит в этот бэкенд
(`API_BASE = 'http://localhost:3001'` в начале файла). Порядок запуска:

1. `npm start` здесь (бэкенд на :3001)
2. открыть/запустить `tennis-stats-prototype.jsx` — поиск, профиль, H2H и турниры
   теперь тянут живые данные из Tennis API через твой бэкенд

CORS для локальной разработки открыт на все origin (`*`) — на проде сузь до домена фронтенда.

## Что дальше

- На проде — вынести `cache` (сейчас in-memory `Map`) в Redis, ключи и TTL уже размечены в `server.js`.
- Эндпоинт `/api/players/search` сейчас делает 2 запроса к провайдеру (search + список игроков),
  потому что `/search` не возвращает id. Для большого трафика лучше держать таблицу players
  в своей БД и синхронизировать её раз в сутки батчем — тогда поиск будет идти по своей БД, без похода к провайдеру вообще.
- "Турниры" в профиле сейчас — это агрегация уже загруженных последних матчей (провайдер не отдаёт
  отдельный список турниров игрока). Для полной истории карьеры нужно тянуть past-matches с большим pageSize
  или добавить пагинацию.
