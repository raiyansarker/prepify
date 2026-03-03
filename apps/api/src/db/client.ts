import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";
import { env } from "#/lib/env";

const sql = neon(env().database.url);

export const db = drizzle({ client: sql, schema });

export type Database = typeof db;
