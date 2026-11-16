# Space Booking API

Backend for the **Online Space Booking System**: browse places (libraries, cafes, coworking), see live seat availability, reserve a seat before arriving, check in with a QR code, and get booking alerts by Telegram or email. It also integrates with the LibraFlow library system (LMS) over REST and RabbitMQ.

Built with NestJS 12, TypeORM, PostgreSQL 17, Redis, RabbitMQ and Mailpit (local email).

## Requirements

| Tool | Version | Why |
|---|---|---|
| **Node.js** | **24.9 or newer** (Node 24 LTS) | See below. Pinned in `.nvmrc` and `package.json` → `engines` |
| npm | 11+ (ships with Node 24) | The project uses `package-lock.json`; don't use yarn/pnpm |
| Docker + Docker Compose v2 | recent | Runs PostgreSQL, pgAdmin, Redis, Mailpit, RabbitMQ and Grafana/Loki locally |

### Why Node 24.9+?

NestJS 12 packages are published as **ES modules only**. The app itself runs on any Node ≥ 20, but **Jest can only load ES modules from Node 24.9 onward** (with the `--experimental-vm-modules` flag, which the `npm test` scripts already pass). On Node 20 or 22 every test fails with:

```text
Must use import to load ES Module: .../node_modules/@nestjs/testing/index.js
```

Using one Node version for running, testing and Docker (`node:24-bookworm-slim`) keeps everything consistent.

### Install the right Node version

With [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install        # reads .nvmrc → installs Node 24
nvm use            # run this in every new terminal, or:
nvm alias default 24
node -v            # should print v24.9.0 or newer
```

> **WSL / Windows users:** run `npm install` **from WSL only**, never from Windows (PowerShell, IDE terminal on Windows).
> npm installs platform-specific native binaries (e.g. for `oxlint`, `argon2`, `bcrypt`). Installing from Windows puts
> Windows binaries in `node_modules`, and lint/tests then fail in WSL with errors like `Cannot find native binding`.
> If that happens, run `npm install` again from WSL.

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file and fill in values
cp .env.example .env

# 3. Start PostgreSQL, pgAdmin, Redis, Mailpit, RabbitMQ and monitoring
docker compose --env-file .env -f infrastructure/docker/development/docker-compose.yml up -d

# 3b. First start only: create the RabbitMQ vhost and app users
docker compose --env-file .env -f infrastructure/docker/development/docker-compose.yml exec rabbitmq sh /setup-dev.sh

# 4. Apply database migrations, then load demo data (places, seats, users, the SUPER_ADMIN)
npm run migration:run
npm run seed

# 5. Start the API in watch mode
npm run start:dev
```

RabbitMQ is optional: leave `RABBITMQ_URL` empty and the API runs without publishing or consuming events (outbox rows stay queued).

| URL | What |
|---|---|
| http://localhost:3000/api/v1/health | Health check |
| http://localhost:3000/api/docs | Swagger UI (disabled when `NODE_ENV=production`) |
| http://localhost:5050 | pgAdmin (server host: `db`, port `5432`) |
| http://localhost:8025 | Mailpit inbox |
| http://localhost:15672 | RabbitMQ management UI |
| http://localhost:3001 | Grafana: logs via Loki (Explore → `{service_name="space-booking-api"}`) |

### Logs (Grafana + Loki + Alloy)

The API uses NestJS's built-in `Logger`. In development, set `LOG_FILE=logs/app.log` in `.env` (and run `mkdir -p logs` once):
the console stays readable, and a JSON copy goes to `logs/app.log`, which Grafana Alloy ships to Loki.
In production the API logs JSON to stdout (`LOG_FORMAT=json`) and Alloy reads the container logs.
Setup and queries: [`infrastructure/README.md#logging--monitoring`](infrastructure/README.md#logging--monitoring).

Full infrastructure details (start/stop, volumes, ports, production stack): [`infrastructure/README.md`](infrastructure/README.md).

## Scripts

```bash
# run
npm run start:dev        # watch mode
npm run start:debug      # watch mode + debugger
npm run build            # compile to dist/
npm run start:prod       # run the compiled app

# quality
npm run lint
npm test                 # unit tests
npm run test:e2e         # integration tests (needs the database running)
npm run test:cov         # unit tests with coverage

# database (TypeORM, config in src/database/data-source.ts)
npm run migration:generate -- src/database/migrations/CreateUsers
npm run migration:create -- src/database/migrations/AddSomething
npm run migration:run
npm run migration:show
npm run migration:revert # local dev database only
npm run seed             # demo data; each seeds/sql file runs once; refused in production

# dev helpers
npm run telegram:poll    # forward Telegram bot updates to the local webhook (no public tunnel needed)
npm run format           # prettier
```

## Project structure

```text
src/
├── auth/                # register, OTP, login, refresh, Google/Facebook sign-in, admin approval
├── users/               # /users/me and /admin/users (account management)
├── roles/               # roles table, /admin/roles
├── places/ areas/ seats/
├── bookings/            # booking, QR check-in/out, availability (no_double_booking constraint)
├── notifications/       # alerts by Telegram and email
├── telegram/            # bot linking and webhook
├── jobs/                # expire bookings, overdue checkouts, notification sender, outbox relay
├── messaging/           # RabbitMQ: outbox (publish), inbox (consume), message contract
├── api-clients/         # API keys for other systems (X-API-Key + scopes)
├── external-identities/ # user ↔ LMS member links and member standing
├── integrations/        # LMS: place sync, account linking, HTTP client
├── common/              # guards, decorators, DTO bases, enums, pagination
├── configuration/       # registerAs configs + env validation, loaded globally
├── logger/              # AppLogger: built-in ConsoleLogger + optional JSON file output
├── database/
│   ├── migrations/      # TypeORM migrations (never edited after merge)
│   ├── seeds/           # demo data (npm run seed)
│   └── data-source.ts   # shared by the app and the TypeORM CLI
├── app.controller.ts    # GET /health
├── app.module.ts
└── main.ts              # global prefix /api/v1, Swagger
infrastructure/
├── docker/{development,production}/docker-compose.yml
├── rabbitmq/            # setup-dev.sh (vhost and users)
└── monitoring/          # Loki, Alloy and Grafana config
```

## Documentation

| File | What |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Team rules and domain rules (no double-booking, UTC timestamps, ...) |
| [`docs/api-endpoints.md`](docs/api-endpoints.md) | Every endpoint, who can call it, async events, jobs |
| [`docs/erd.md`](docs/erd.md), [`docs/schema/db.sql`](docs/schema/db.sql) | Database schema |
| [`docs/project-structure.md`](docs/project-structure.md) | Module map and dependency rules |
| [`docs/integration/summary.md`](docs/integration/summary.md) | One-page summary of the LMS integration (details in [`docs/integration/`](docs/integration/README.md)) |

## Known dependency advisories

`npm audit` reports a few **low** severity advisories from `deepmerge`, which is used only inside Jest (dev dependency, never shipped). No patched `deepmerge` release exists yet. **Do not run `npm audit fix --force`**: it "fixes" this by downgrading Jest to v25, which breaks the test setup.
