import { Context, Effect, Layer } from "effect";
import { db, type Database } from "#/db";

// ============================================
// Database Service
// ============================================

export class DatabaseService extends Context.Tag("DatabaseService")<
  DatabaseService,
  { readonly client: Database }
>() {}

export const DatabaseServiceLive = Layer.succeed(DatabaseService, {
  client: db,
});
