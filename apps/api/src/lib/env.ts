import { Config, Effect, Layer, Context, Option } from "effect";

// ============================================
// Environment Configuration with Effect Config
// ============================================
// All environment variables are validated at startup.
// Missing required vars will cause a clear, immediate failure.

// --- Database ---

export class DatabaseConfig extends Context.Tag("DatabaseConfig")<
  DatabaseConfig,
  {
    readonly url: string;
  }
>() {}

const databaseConfig = Config.all({
  url: Config.string("DATABASE_URL"),
});

export const DatabaseConfigLive = Layer.effect(
  DatabaseConfig,
  Effect.map(databaseConfig, (cfg) => cfg),
);

// --- Clerk Auth ---

export class ClerkConfig extends Context.Tag("ClerkConfig")<
  ClerkConfig,
  {
    readonly secretKey: string;
    readonly publishableKey: string;
    readonly jwtKey: string | undefined;
    readonly authorizedParties: string[] | undefined;
  }
>() {}

const clerkConfig = Config.all({
  secretKey: Config.string("CLERK_SECRET_KEY"),
  publishableKey: Config.string("CLERK_PUBLISHABLE_KEY"),
  jwtKey: Config.option(Config.string("CLERK_JWT_KEY")),
  authorizedParties: Config.option(Config.string("CLERK_AUTHORIZED_PARTIES")),
});

export const ClerkConfigLive = Layer.effect(
  ClerkConfig,
  Effect.map(clerkConfig, (cfg) => ({
    secretKey: cfg.secretKey,
    publishableKey: cfg.publishableKey,
    jwtKey: Option.getOrUndefined(cfg.jwtKey),
    authorizedParties: Option.match(cfg.authorizedParties, {
      onNone: () => undefined,
      onSome: (v) => v.split(","),
    }),
  })),
);

// --- Cloudflare R2 / Storage ---

export class StorageConfig extends Context.Tag("StorageConfig")<
  StorageConfig,
  {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly accountId: string;
    readonly bucket: string;
    readonly accessUrl: string;
  }
>() {}

const storageConfig = Config.all({
  accessKeyId: Config.string("R2_ACCESS_KEY_ID"),
  secretAccessKey: Config.string("R2_SECRET_ACCESS_KEY"),
  accountId: Config.string("R2_ACCOUNT_ID"),
  bucket: Config.string("R2_BUCKET"),
  accessUrl: Config.string("R2_ACCESS_URL"),
});

export const StorageConfigLive = Layer.effect(
  StorageConfig,
  Effect.map(storageConfig, (cfg) => cfg),
);

// --- AI Providers ---

export class AiConfig extends Context.Tag("AiConfig")<
  AiConfig,
  {
    readonly groqApiKey: string;
    readonly googleApiKey: string;
    readonly huggingFaceApiKey: string;
  }
>() {}

const aiConfig = Config.all({
  groqApiKey: Config.string("GROQ_API_KEY"),
  googleApiKey: Config.string("GOOGLE_GENERATIVE_AI_API_KEY"),
  huggingFaceApiKey: Config.string("HUGGINGFACE_API_KEY"),
});

export const AiConfigLive = Layer.effect(
  AiConfig,
  Effect.map(aiConfig, (cfg) => cfg),
);

// --- Redis ---

export class RedisConfig extends Context.Tag("RedisConfig")<
  RedisConfig,
  {
    readonly url: string;
  }
>() {}

const redisConfig = Config.all({
  url: Config.withDefault(Config.string("REDIS_URL"), "redis://localhost:6379"),
});

export const RedisConfigLive = Layer.effect(
  RedisConfig,
  Effect.map(redisConfig, (cfg) => cfg),
);

// --- Server / App ---

export class ServerConfig extends Context.Tag("ServerConfig")<
  ServerConfig,
  {
    readonly port: number;
    readonly nodeEnv: string;
    readonly frontendUrl: string;
    readonly logLevel: string;
  }
>() {}

const serverConfig = Config.all({
  port: Config.withDefault(Config.integer("PORT"), 3001),
  nodeEnv: Config.withDefault(Config.string("NODE_ENV"), "development"),
  frontendUrl: Config.string("FRONTEND_URL"),
  logLevel: Config.withDefault(Config.string("LOG_LEVEL"), "info"),
});

export const ServerConfigLive = Layer.effect(
  ServerConfig,
  Effect.map(serverConfig, (cfg) => cfg),
);

// ============================================
// Merged Config Layer
// ============================================

export const EnvConfigLayer = Layer.mergeAll(
  DatabaseConfigLive,
  ClerkConfigLive,
  StorageConfigLive,
  AiConfigLive,
  RedisConfigLive,
  ServerConfigLive,
);

// ============================================
// Eagerly resolved config for module-level use
// ============================================
// Some modules (db/client.ts, upload.ts, redis.ts) run at import time
// and cannot use Effect context. We resolve all config once at startup
// and export a plain object for those cases.

export interface ResolvedEnv {
  database: { url: string };
  clerk: {
    secretKey: string;
    publishableKey: string;
    jwtKey: string | undefined;
    authorizedParties: string[] | undefined;
  };
  storage: {
    accessKeyId: string;
    secretAccessKey: string;
    accountId: string;
    bucket: string;
    accessUrl: string;
  };
  ai: {
    groqApiKey: string;
    googleApiKey: string;
    huggingFaceApiKey: string;
  };
  redis: { url: string };
  server: {
    port: number;
    nodeEnv: string;
    frontendUrl: string;
    logLevel: string;
  };
}

/**
 * Load and validate all environment variables synchronously.
 * Call this once at the top of your entry point before any other imports
 * that depend on env vars. Throws with a clear message on failure.
 */
const loadEnv = (): ResolvedEnv => {
  const program = Effect.all({
    database: databaseConfig,
    storage: storageConfig,
    ai: aiConfig,
    redis: redisConfig,
    server: serverConfig,
    clerkRaw: clerkConfig,
  }).pipe(
    Effect.map(({ database, storage, ai, redis, server, clerkRaw }) => ({
      database,
      storage,
      ai,
      redis,
      server,
      clerk: {
        secretKey: clerkRaw.secretKey,
        publishableKey: clerkRaw.publishableKey,
        jwtKey: Option.getOrUndefined(clerkRaw.jwtKey),
        authorizedParties: Option.match(clerkRaw.authorizedParties, {
          onNone: () => undefined as string[] | undefined,
          onSome: (v: string) => v.split(","),
        }),
      },
    })),
  );

  return Effect.runSync(program);
};

// ============================================
// Singleton — populated lazily on first access
// ============================================

let _env: ResolvedEnv | null = null;

/**
 * Get the validated environment config.
 * On first call, validates all env vars and caches the result.
 * Throws a ConfigError with details on any missing/invalid vars.
 */
export const env = (): ResolvedEnv => {
  if (!_env) {
    _env = loadEnv();
  }
  return _env;
};
