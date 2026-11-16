import { refreshMarket, listQuotes } from "../src/lib/market";
import { createMemoryDb } from "../src/lib/db";

const db = await createMemoryDb();
const result = await refreshMarket(db, fetch, Date.now());
const quotes = await listQuotes(db);
console.log(JSON.stringify({ ok: result.ok, failed: result.failed, quotes }, null, 2));
