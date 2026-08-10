# sandbox-app-template

Monorepo: Bun workspaces + Turborepo.

## Commands

The root `package.json` scripts are the external contract — deployment and tooling only ever
call these named verbs. Never rename or remove them; their internals are free to change.

| Command | Purpose |
| --- | --- |
| `bun run dev` / `dev:desktop` / `dev:mobile` | Start dev server per platform |
| `bun run build` | Build all packages |
| `bun run start` | Start (or restart) the production server under pm2 (idempotent) |
| `bun run stop` | Stop the production server |
| `bun run lint` | Releases + conventions + oxlint |
| `bun run typecheck` | Typecheck all packages |
| `bun run db:generate` / `db:migrate` / `db:push` | Database workflows |

Fixed conventions the contract relies on: server listens on `$PORT` (default `4200`), health
endpoint at `/api/health`, secrets in the root `.env`, pm2 app name `web-app`.

Scripts prefixed `internal:` are template maintenance helpers, not part of the contract.

## Project Structure

```
.env                         Secrets (gitignored), loaded via Vite's loadEnv
packages/
  web/                       Unified server (API + web frontend via Vite)
    vite.config.ts           Vite 7 config — loads .env, sets port, registers plugins
    index.html               Frontend HTML entry
    vite/__plugins/
      hono-dev-plugin.ts     Intercepts /api/* in dev, forwards to Hono via SSR
      runable-analytics-plugin.ts
    src/
      api/
        __core/
          app.ts             oRPC base + createApp() Hono mount (/api/rpc/*, /api/health) — core, do not edit
        routes/              Feature routers, one file per feature (max 500 lines each)
        index.ts             Composes feature routers + AppRouter export
        database/
          __client.ts        Database client (Turso/LibSQL) — template-managed
          index.ts           Re-exports db from __client
          schema.ts          Drizzle schema
      web/
        __main.tsx           Bootstrap (mount + Router) — template-managed
        main.tsx             Entry (composition only)
        app.tsx              Root component + Wouter routing
        pages/               Page components
        queries/             Query/mutation options (one file per feature)
        components/          UI components
        hooks/
          use-desktop.ts     Desktop detection
        lib/
          api.ts             Typed API client (oRPC + TanStack Query utils)
          desktop.ts         Electron API types
          utils.ts           Shared utilities
        styles.css           Tailwind CSS entry
  mobile/                    Expo + React Native + expo-router (thin client, no server/db)
    app/                     File-based routing
      (tabs)/                Default themed tab navigator + screens
    constants/theme.ts       Color tokens (light/dark) + Fonts — recolor to brand
    hooks/                   use-colors, use-color-scheme (+ .web)
    queries/                 Data hooks (useX), one file per feature
    lib/
      api.ts                 Typed API client (oRPC → @template/web)
  desktop/                   Electron shell (loads web app from server)
    electron/
      main.ts                Editable main process (window, lifecycle) + managed deep-link attach
      ipc.ts                 Starter IPC handlers (dialog/fs/notification/window) — editable
      preload.ts             contextBridge API + managed-auth bridge
    vite.config.ts           Vite config
```

## Environment Variables

Secrets and credentials live in `.env` at the project root (gitignored). Vite's `loadEnv` loads them into `process.env` at dev/build time (configured in `packages/web/vite.config.ts`). In API code (Hono), use `process.env.YOUR_VAR`. In browser code, only `VITE_`-prefixed vars are exposed via `import.meta.env.VITE_YOUR_VAR`. Drizzle scripts use `bun --env-file=../../.env` to load env vars directly.

## Desktop UI

The desktop app has no separate renderer by default. It loads the web app from `packages/web`; desktop-specific UI should live in `packages/web/src/web/` and be gated with `useDesktop()` / `window.electronAPI`. Keep `packages/desktop` for Electron window setup, menus/tray/shortcuts, IPC handlers, native OS APIs, and packaging. Only add a separate desktop renderer when the product intentionally needs a different desktop-only UI architecture.

## Servers

Dev servers are started and managed automatically — no need to run them manually.

## Database

```sh
cd packages/web
bun run db:push        # Push schema to database
bun run db:generate    # Generate migration files
bun run db:migrate     # Run migrations
```
