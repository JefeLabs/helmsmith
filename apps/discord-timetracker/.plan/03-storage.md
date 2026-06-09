# 03 — Pluggable Storage

The whole point of this layer: the bot picks SQLite **or** DynamoDB from config,
and no feature/UI code knows which is live.

## The port (interface)

```ts
// src/storage/StorageAdapter.ts
import type { DailyActivity, ISODate, UserId } from '../domain/types';

export interface StorageAdapter {
  init(): Promise<void>;                 // create tables / verify table exists
  close(): Promise<void>;

  // --- daily activity (the hot path) ---
  getDay(userId: UserId, date: ISODate): Promise<DailyActivity | null>;
  upsertDay(activity: DailyActivity): Promise<void>;

  // atomic counter bumps — avoid read-modify-write races on the gateway
  incrementCi(userId: UserId, date: ISODate, by?: number): Promise<void>;
  incrementEngagement(userId: UserId, date: ISODate, by?: number): Promise<void>;
  recordPresenceSample(userId: UserId, date: ISODate, online: boolean): Promise<void>;
  setStartOfDay(userId: UserId, date: ISODate, v: DailyActivity['startOfDay']): Promise<void>;
  setEndOfDay(userId: UserId, date: ISODate, v: DailyActivity['endOfDay']): Promise<void>;

  // --- reporting reads (used by ReportService → Discord + TUI) ---
  listDay(date: ISODate): Promise<DailyActivity[]>;
  listRange(from: ISODate, to: ISODate): Promise<DailyActivity[]>;

  // --- identity mapping (CI attribution) ---
  linkIdentity(provider: string, externalId: string, userId: UserId): Promise<void>;
  resolveIdentity(provider: string, externalId: string): Promise<UserId | null>;
}
```

Design notes:
- **Counter methods are explicit** (`incrementCi`, …) rather than only
  `upsertDay`, so each adapter can do the bump atomically — SQLite in a single
  `UPDATE … SET ci = ci + 1`, DynamoDB with an `ADD` UpdateExpression. This
  avoids lost updates when several messages land in the same 5 minutes.
- The read methods (`listDay`/`listRange`) are what the **TUI viewer** and the
  **Discord report** both call (through `ReportService`).

## The factory

```ts
// src/storage/factory.ts
import type { Config } from '../config/schema';
import type { StorageAdapter } from './StorageAdapter';

export async function createStorage(cfg: Config): Promise<StorageAdapter> {
  const adapter =
    cfg.storage.backend === 'dynamodb'
      ? new (await import('./dynamo/DynamoAdapter')).DynamoAdapter(cfg.storage.dynamo)
      : new (await import('./sqlite/SqliteAdapter')).SqliteAdapter(cfg.storage.sqlite);
  await adapter.init();
  return adapter;
}
```

Dynamic `import()` keeps the AWS SDK out of the bundle/startup path when running
on SQLite locally, and vice-versa.

## Adapter A — SQLite (`bun:sqlite`, default for v1)

```ts
// src/storage/sqlite/SqliteAdapter.ts
import { Database } from 'bun:sqlite';   // built-in, no native compile

export class SqliteAdapter implements StorageAdapter {
  private db: Database;
  constructor(private opts: { path: string }) { this.db = new Database(opts.path); }

  async init() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS daily_activity (
        user_id TEXT NOT NULL,
        date    TEXT NOT NULL,
        start_at TEXT, start_msg_id TEXT, goals TEXT,
        end_at   TEXT, end_msg_id   TEXT, summary TEXT,
        presence_samples INTEGER NOT NULL DEFAULT 0,
        presence_online  INTEGER NOT NULL DEFAULT 0,
        first_online_at TEXT, last_online_at TEXT,
        ci_submissions   INTEGER NOT NULL DEFAULT 0,
        engagement_msgs  INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, date)
      );
      CREATE TABLE IF NOT EXISTS identity_map (
        provider TEXT NOT NULL, external_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (provider, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_day ON daily_activity(date);
    `);
  }

  async incrementCi(userId: string, date: string, by = 1) {
    this.db.run(
      `INSERT INTO daily_activity (user_id,date,ci_submissions,updated_at)
       VALUES (?1,?2,?3,?4)
       ON CONFLICT(user_id,date) DO UPDATE SET
         ci_submissions = ci_submissions + ?3, updated_at = ?4`,
      [userId, date, by, new Date().toISOString()],
    );
  }
  // …other methods analogous (UPSERT + atomic SET col = col + n)…
}
```

`bun:sqlite` is **synchronous** — fine here (a long-running gateway process has
no per-request latency budget) and it keeps the adapter simple. The `async`
signatures are kept for interface symmetry with DynamoDB.

## Adapter B — DynamoDB (`@aws-sdk/lib-dynamodb`, AWS path)

Single-table design keyed for the per-user-per-day access pattern:

```
PK = USER#<userId>        SK = DAY#<date>          → one DailyActivity item
PK = LINK#<provider>      SK = EXT#<externalId>    → identity map item
GSI1: PK = DAY#<date>     SK = USER#<userId>       → listDay() / listRange()
```

```ts
// src/storage/dynamo/DynamoAdapter.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

export class DynamoAdapter implements StorageAdapter {
  private doc: DynamoDBDocumentClient;
  constructor(private opts: { table: string; region: string }) {
    this.doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: opts.region }));
  }
  async init() { /* assume table provisioned via IaC; optionally describe to verify */ }

  async incrementCi(userId: string, date: string, by = 1) {
    await this.doc.send(new UpdateCommand({
      TableName: this.opts.table,
      Key: { PK: `USER#${userId}`, SK: `DAY#${date}` },
      UpdateExpression: 'ADD ci_submissions :n SET updated_at = :u, gsi1pk = :g, gsi1sk = :s',
      ExpressionAttributeValues: {
        ':n': by, ':u': new Date().toISOString(),
        ':g': `DAY#${date}`, ':s': `USER#${userId}`,
      },
    }));
  }
  // listDay/listRange → Query on GSI1 by DAY#<date>
}
```

`ADD` is DynamoDB's atomic counter — same race-free guarantee as SQLite's
`col = col + n`. Table + GSI created via IaC (CDK/Terraform) at AWS time, not by
the app.

## Switching backends

`.env` (or config file):

```bash
# local v1
STORAGE_BACKEND=sqlite
SQLITE_PATH=./data/timetracker.db

# later, on AWS
STORAGE_BACKEND=dynamodb
DDB_TABLE=timetracker
AWS_REGION=us-east-1
```

No code change — `createStorage()` returns the right adapter. Both pass the same
adapter contract test suite (see build sequence M2), which is the real guarantee
that the swap is safe.
