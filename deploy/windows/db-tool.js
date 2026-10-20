// Database helper for the station deploy (StationChecks.psm1), run with the deploy's
// tools folder on NODE_PATH:
//   node db-tool.js counts <bloom.db>   prints {"<table>": <rows>, ...} as JSON
// Opens the database read-only. Leaves out SQLite's own tables and Prisma's
// _prisma_migrations, whose row count grows on purpose during an upgrade.
'use strict';
// A plain Node script run on the station from the deploy's tools folder, not part of the app build.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3');

const [command, dbPath] = process.argv.slice(2);
if (command !== 'counts' || !dbPath) {
  console.error('usage: node db-tool.js counts <bloom.db>');
  process.exit(2);
}
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations' ORDER BY name"
  )
  .all();
const counts = {};
for (const { name } of tables) {
  counts[name] = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
}
db.close();
console.log(JSON.stringify(counts));
