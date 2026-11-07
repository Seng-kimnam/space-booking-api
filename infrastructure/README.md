# Infrastructure

Local services for development: **PostgreSQL**, **pgAdmin**, **Redis**, **Mailpit**,
plus logging with **Loki**, **Grafana Alloy** and **Grafana** (see [Logging & monitoring](#logging--monitoring)).
The API itself runs on your machine with `npm run start:dev`.

```text
infrastructure/
├── docker/
│   ├── development/docker-compose.yml   # services for local dev (API runs on host)
│   └── production/docker-compose.yml    # API in Docker + db, redis, monitoring
└── monitoring/
    ├── alloy/config.development.alloy   # tails ./logs/*.log
    ├── alloy/config.production.alloy    # reads Docker container logs
    ├── loki/loki-config.yml
    └── grafana/provisioning/datasources/loki.yml
```

## Setup

```bash
cp .env.example .env   # then fill in the values
```

Variables used by compose: `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`,
`PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD`, `PGADMIN_PORT`,
`REDIS_PORT`, `MAIL_PORT`, `MAILPIT_UI_PORT`,
`GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_PORT`, `LOKI_PORT`, `LOKI_RETENTION_PERIOD`, `ALLOY_PORT`.

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
| Grafana | http://localhost:3001 (`GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`) |
| Loki API | http://localhost:3100/ready |
| Alloy UI | http://localhost:12345 (pipeline graph and component health) |

## Logging & monitoring

**Loki** stores logs, **Grafana Alloy** collects and ships them (Alloy replaces the deprecated Promtail),
and **Grafana** queries them. The Loki data source is provisioned automatically.

The API keeps NestJS's built-in `Logger` (`@nestjs/common`). `src/logger/app-logger.ts` is a thin
`ConsoleLogger` subclass that can additionally write each line as JSON to a file. Use `new Logger(MyService.name)` as usual.

| | Development | Production |
|---|---|---|
| API runs | on the host (`npm run start:dev`) | in Docker |
| Console format | `LOG_FORMAT=pretty` (readable) | `LOG_FORMAT=json` |
| How Alloy gets logs | tails `./logs/app.log` (`LOG_FILE`), mounted read-only | reads container stdout via the Docker socket |
| Labels | `service_name="space-booking-api"`, `env`, `level` | `service_name="<compose service>"`, `container`, `env`, `level` |

Each JSON line looks like `{"level":"log","pid":1,"timestamp":1794061700946,"message":"...","context":"Bootstrap"}`.
Alloy turns `level` into a label, stores `context` as structured metadata, and uses `timestamp` as the log time.

### Development

```bash
mkdir -p logs   # create it yourself so Docker doesn't create it owned by root
$COMPOSE up -d loki alloy grafana   # or just `$COMPOSE up -d` for everything
npm run start:dev                   # with LOG_FILE=logs/app.log in .env
```

Open Grafana → **Explore** → data source **Loki**, and query for example:

```logql
{service_name="space-booking-api"}
{service_name="space-booking-api", level="error"}
{service_name="space-booking-api"} | json | context="Bootstrap"
```

`logs/` is git-ignored. The file is not rotated; delete it whenever you like.

### Production

```bash
PROD="docker compose --env-file .env -f infrastructure/docker/production/docker-compose.yml"

$PROD up -d --build   # API + db + redis + loki + alloy + grafana
$PROD ps
$PROD logs -f api
$PROD down            # stop (data volumes kept)
```

- `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`, `DB_USERNAME`, `DB_PASSWORD` and `DB_NAME` are **required**; compose refuses to start without them.
- Grafana stores the admin password on **first start**. Changing `GRAFANA_ADMIN_PASSWORD` later has no effect; change it in the Grafana UI instead.
- Only the API (`PORT`) and Grafana (`GRAFANA_PORT`) are published. Postgres, Redis and Loki stay on the internal compose network.
- Query: `{env="production", service_name="api"}`. Logs from db/redis/loki/alloy/grafana are collected too.
- Alloy mounts `/var/run/docker.sock` read-only to discover containers. Docker socket access is powerful, so only run trusted images.
- Retention: `LOKI_RETENTION_PERIOD` (default `720h` = 30 days in production, `168h` = 7 days in dev).

## Docker image (optional)

```bash
docker build --target production -t space-booking-api .
```

> `docker compose ... down -v` deletes all data volumes (database, Grafana, Loki). Only use it if you want a fresh start.
