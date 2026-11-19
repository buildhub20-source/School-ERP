import fs from "node:fs";
import path from "node:path";
// Tests run against the JSON data engine on a throwaway copy of the mock data (never the app's .poc/data.json).
// Each test file starts again from data/demo-data.json; each test creates its own data with unique names.
process.env.TZ = "UTC";
process.env.JSON_DB_FILE = path.resolve(".poc/test-data.json");
fs.rmSync(process.env.JSON_DB_FILE, { force: true });
