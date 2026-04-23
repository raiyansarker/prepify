# Prepify

Prepify is an AI-powered study platform designed to help students prepare for exams more efficiently. It features automated document processing, exam generation, flashcard creation, and an AI-powered chat interface.

## Tech Stack

- **Monorepo:** [Turborepo](https://turbo.build/repo)
- **Runtime:** [Bun](https://bun.sh/)
- **Frontend:** [React](https://react.dev/), [Vite](https://vitejs.dev/), [TanStack Router](https://tanstack.com/router)
- **API:** [ElysiaJS](https://elysiajs.com/), [Drizzle ORM](https://orm.drizzle.team/)
- **Database:** [PostgreSQL](https://www.postgresql.org/)
- **Queue/Workers:** [Redis](https://redis.io/), [BullMQ](https://docs.bullmq.io/)
- **Auth:** [Clerk](https://clerk.com/)
- **AI/LLMs:** [Groq](https://groq.com/), [Google Gemini](https://ai.google.dev/)
- **Storage:** [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/)

## Prerequisites

- [Bun](https://bun.sh/docs/installation) (recommended)
- [PostgreSQL](https://www.postgresql.org/download/)
- [Redis](https://redis.io/download/)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-username/prepify.git
cd prepify
```

### 2. Install dependencies

```bash
bun install
```

### 3. Environment Variables

Copy the `.env.example` files to `.env` in both the `apps/api` and `apps/web` directories.

#### API (`apps/api/.env`)

```bash
cp apps/api/.env.example apps/api/.env
```

You'll need to fill in:
- `DATABASE_URL`: Your PostgreSQL connection string.
- `CLERK_SECRET_KEY` & `CLERK_PUBLISHABLE_KEY`: From your [Clerk Dashboard](https://dashboard.clerk.com/).
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, etc.: For Cloudflare R2 storage.
- `GROQ_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`: For AI features.
- `REDIS_URL`: Your Redis connection string.

#### Web (`apps/web/.env`)

```bash
cp apps/web/.env.example apps/web/.env
```

- `VITE_CLERK_PUBLISHABLE_KEY`: Must match the API key.
- `VITE_API_URL`: Should point to `http://localhost:3001` for local development.

### 4. Database Setup

Run the following command from the root to push the schema to your database:

```bash
bun run db:push
```

### 5. Start Development Servers

You'll need to start both the main applications and the background workers.

In one terminal, start the frontend and API:

```bash
bun run dev
```

This will start:
- Frontend at `http://localhost:3000`
- API at `http://localhost:3001`

In a second terminal, start the background workers:

```bash
bun run worker:dev
```

## Project Structure

- `apps/api`: ElysiaJS backend with BullMQ workers and Drizzle ORM.
- `apps/web`: React frontend using TanStack Router and Vite.
- `packages/shared`: Shared types and constants.
- `packages/ui`: Shared React components (not used by all apps yet).
- `packages/typescript-config`: Shared `tsconfig.json`s.
- `packages/eslint-config`: Shared ESLint configurations.

## Useful Commands

- `bun run dev`: Start all apps in development mode.
- `bun run build`: Build all apps and packages.
- `bun run lint`: Lint all packages.
- `bun run check-types`: Run TypeScript type checking.
- `bun run db:studio`: Open Drizzle Studio to inspect your database.

## Troubleshooting

- **Redis Connection:** Ensure Redis is running and reachable via the `REDIS_URL`.
- **Clerk Auth:** If you're having issues with authentication, double-check your Clerk keys and ensure the `FRONTEND_URL` in the API env matches your web app URL.
- **AI Generation:** Ensure you have provided a valid API key for either Groq or Google Gemini.
