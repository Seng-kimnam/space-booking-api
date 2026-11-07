# Infrastructure

Local services for development: **PostgreSQL**, **pgAdmin**, **Redis**, **Mailpit**.
The API itself runs on your machine with `npm run start:dev`.

## Setup

```bash
cp .env.example .env   # then fill in the values
```

Variables used by compose: `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`,
`PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD`, `PGADMIN_PORT`,
`REDIS_PORT`, `MAIL_PORT`, `MAILPIT_UI_PORT`.

Since the API runs on the host, use `DB_HOST=localhost`, `REDIS_HOST=localhost` and `MAIL_HOST=localhost` in `.env`.

## Commands (from the repo root)

```bash
COMPOSE="docker compose --env-file .env -f infrastructure/docker/development/docker-compose.yml"

$COMPOSE up -d      # start
$COMPOSE ps         # status
$COMPOSE logs -f db # logs
$COMPOSE stop       # stop
$COMPOSE down       # stop and remove containers (data is kept)
```

Then start the API:

```bash
npm run start:dev
```

API: http://localhost:3000/api/v1. Swagger: http://localhost:3000/api/docs (disabled when `NODE_ENV=production`).

## Migrations

Config lives in `src/database/data-source.ts`. Entities (`*.entity.ts`) are picked up by path.

```bash
npm run migration:generate -- src/database/migrations/CreateUsers   # diff entities vs DB
npm run migration:create -- src/database/migrations/AddSomething    # empty migration
npm run migration:run
npm run migration:show
npm run migration:revert   # local dev DB only
```

## URLs

| Service | URL |
|---|---|
| PostgreSQL | `localhost:5432` (or your `DB_PORT`) |
| pgAdmin | http://localhost:5050. Log in, then add a server with host `db`, port `5432` |
| Redis | `localhost:6379` (or your `REDIS_PORT`) |
| Mailpit UI | http://localhost:8025 |
| Mailpit SMTP | `localhost:1025` |

## Docker image (optional)

```bash
docker build --target production -t space-booking-api .
```

> `docker compose ... down -v` deletes the database volume. Only use it if you want a fresh database.
