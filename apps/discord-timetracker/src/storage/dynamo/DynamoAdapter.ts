/**
 * DynamoDB StorageAdapter — the AWS path. Single-table design:
 *
 *   PK = USER#<userId>   SK = DAY#<date>        → a DailyActivity item
 *   PK = LINK#<provider> SK = EXT#<externalId>  → an identity-map item
 *   GSI1: gsi1pk = DAY#<date>  gsi1sk = USER#<userId>  → listDay / listRange
 *
 * Counters live as TOP-LEVEL numeric attributes (not nested under a `presence`
 * map) so `ADD` — DynamoDB's atomic increment — works without first
 * materialising a parent map. They're folded back into the nested
 * DailyActivity shape on read.
 *
 * Imported only via the storage factory's dynamic import, so the AWS SDK is
 * never loaded on the SQLite path.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DynamoStorageConfig } from '../../config/schema.js';
import { addDays } from '../../domain/dayKey.js';
import {
  type DailyActivity,
  type EndOfDay,
  emptyDay,
  type ISODate,
  type StartOfDay,
  type UserId,
} from '../../domain/types.js';
import type { PresenceState, StorageAdapter } from '../StorageAdapter.js';

const nowIso = () => new Date().toISOString();
const dayKeys = { pk: (u: UserId) => `USER#${u}`, sk: (d: ISODate) => `DAY#${d}` };

/** Optional `endpoint` lets tests point at dynamodb-local. */
export interface DynamoAdapterOptions extends DynamoStorageConfig {
  endpoint?: string;
}

export class DynamoAdapter implements StorageAdapter {
  private doc!: DynamoDBDocumentClient;
  private readonly table: string;

  constructor(private readonly opts: DynamoAdapterOptions) {
    this.table = opts.table;
  }

  async init(): Promise<void> {
    this.doc = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: this.opts.region,
        ...(this.opts.endpoint ? { endpoint: this.opts.endpoint } : {}),
      }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
    // Table + GSI are provisioned out-of-band (IaC). Nothing to create here.
  }

  async close(): Promise<void> {
    this.doc.destroy();
  }

  async getDay(userId: UserId, date: ISODate): Promise<DailyActivity | null> {
    const { Item } = await this.doc.send(
      new GetCommand({
        TableName: this.table,
        Key: { PK: dayKeys.pk(userId), SK: dayKeys.sk(date) },
      }),
    );
    return Item ? itemToActivity(Item) : null;
  }

  async upsertDay(a: DailyActivity): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: activityToItem(a) }));
  }

  async incrementCi(userId: UserId, date: ISODate, by = 1): Promise<void> {
    await this.addCounter('ciSubmissions', userId, date, by);
  }

  async incrementEngagement(userId: UserId, date: ISODate, by = 1): Promise<void> {
    await this.addCounter('engagementMessages', userId, date, by);
  }

  async incrementVoiceSamples(userId: UserId, date: ISODate, by = 1): Promise<void> {
    await this.addCounter('engagementVoiceSamples', userId, date, by);
  }

  private async addCounter(
    attr: 'ciSubmissions' | 'engagementMessages' | 'engagementVoiceSamples',
    userId: UserId,
    date: ISODate,
    by: number,
  ): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: dayKeys.pk(userId), SK: dayKeys.sk(date) },
        UpdateExpression:
          'ADD #c :by SET updatedAt = :u, gsi1pk = :g, gsi1sk = :s, userId = :uid, #d = :date',
        ExpressionAttributeNames: { '#c': attr, '#d': 'date' },
        ExpressionAttributeValues: {
          ':by': by,
          ':u': nowIso(),
          ':g': `DAY#${date}`,
          ':s': dayKeys.pk(userId),
          ':uid': userId,
          ':date': date,
        },
      }),
    );
  }

  async recordPresenceSample(
    userId: UserId,
    date: ISODate,
    state: PresenceState,
    at: string,
  ): Promise<void> {
    // Both active and idle count as "present": bump the matching counter (ADD 0
    // for the other) and advance the first/last-seen timestamps that bound span.
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: dayKeys.pk(userId), SK: dayKeys.sk(date) },
        UpdateExpression:
          'ADD presenceSamples :one, presenceOnline :active, presenceIdle :idle ' +
          'SET updatedAt = :u, gsi1pk = :g, gsi1sk = :s, userId = :uid, #d = :date, ' +
          'firstOnlineAt = if_not_exists(firstOnlineAt, :at), lastOnlineAt = :at',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':active': state === 'active' ? 1 : 0,
          ':idle': state === 'idle' ? 1 : 0,
          ':u': nowIso(),
          ':g': `DAY#${date}`,
          ':s': dayKeys.pk(userId),
          ':uid': userId,
          ':date': date,
          ':at': at,
        },
      }),
    );
  }

  async setStartOfDay(userId: UserId, date: ISODate, v: StartOfDay): Promise<void> {
    await this.setBlock(userId, date, 'startOfDay', v);
  }

  async setEndOfDay(userId: UserId, date: ISODate, v: EndOfDay): Promise<void> {
    await this.setBlock(userId, date, 'endOfDay', v);
  }

  private async setBlock(
    userId: UserId,
    date: ISODate,
    attr: 'startOfDay' | 'endOfDay',
    value: object,
  ): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: dayKeys.pk(userId), SK: dayKeys.sk(date) },
        UpdateExpression:
          'SET #b = :v, updatedAt = :u, gsi1pk = :g, gsi1sk = :s, userId = :uid, #d = :date',
        ExpressionAttributeNames: { '#b': attr, '#d': 'date' },
        ExpressionAttributeValues: {
          ':v': value,
          ':u': nowIso(),
          ':g': `DAY#${date}`,
          ':s': dayKeys.pk(userId),
          ':uid': userId,
          ':date': date,
        },
      }),
    );
  }

  async listDay(date: ISODate): Promise<DailyActivity[]> {
    const { Items = [] } = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :g',
        ExpressionAttributeValues: { ':g': `DAY#${date}` },
      }),
    );
    return Items.map(itemToActivity).sort((a, b) => a.userId.localeCompare(b.userId));
  }

  async listRange(from: ISODate, to: ISODate): Promise<DailyActivity[]> {
    // gsi1pk is per-day, so a range spans multiple partitions — query each day.
    const days: ISODate[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const perDay = await Promise.all(days.map((d) => this.listDay(d)));
    return perDay.flat();
  }

  async linkIdentity(provider: string, externalId: string, userId: UserId): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: `LINK#${provider}`, SK: `EXT#${externalId}`, userId },
      }),
    );
  }

  async resolveIdentity(provider: string, externalId: string): Promise<UserId | null> {
    const { Item } = await this.doc.send(
      new GetCommand({
        TableName: this.table,
        Key: { PK: `LINK#${provider}`, SK: `EXT#${externalId}` },
      }),
    );
    return Item ? (Item.userId as string) : null;
  }

  async listIdentities(provider: string): Promise<Array<{ externalId: string; userId: UserId }>> {
    const { Items = [] } = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'PK = :p AND begins_with(SK, :e)',
        ExpressionAttributeValues: { ':p': `LINK#${provider}`, ':e': 'EXT#' },
      }),
    );
    return Items.map((i) => ({
      externalId: String(i.SK).slice('EXT#'.length),
      userId: i.userId as string,
    }));
  }

  async setUserName(userId: UserId, displayName: string): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: 'USERNAME', SK: userId, displayName },
      }),
    );
  }

  async getUserNames(): Promise<Record<UserId, string>> {
    const { Items = [] } = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'PK = :p',
        ExpressionAttributeValues: { ':p': 'USERNAME' },
      }),
    );
    const out: Record<string, string> = {};
    for (const i of Items) out[i.SK as string] = i.displayName as string;
    return out;
  }

  async getMeta(key: string): Promise<string | null> {
    const { Item } = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { PK: 'META', SK: key } }),
    );
    return Item ? (Item.value as string) : null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.doc.send(
      new PutCommand({ TableName: this.table, Item: { PK: 'META', SK: key, value } }),
    );
  }

  async markProcessed(messageId: string): Promise<boolean> {
    try {
      // Atomic claim: the put fails if the item already exists. `ttl` lets a
      // DynamoDB TTL on the table reap old dedup markers (~7 days).
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: { PK: 'MSG', SK: messageId, ttl: Math.floor(Date.now() / 1000) + 7 * 86400 },
          ConditionExpression: 'attribute_not_exists(SK)',
        }),
      );
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }
}

function activityToItem(a: DailyActivity): Record<string, unknown> {
  return {
    PK: dayKeys.pk(a.userId),
    SK: dayKeys.sk(a.date),
    gsi1pk: `DAY#${a.date}`,
    gsi1sk: dayKeys.pk(a.userId),
    userId: a.userId,
    date: a.date,
    ciSubmissions: a.ciSubmissions,
    engagementMessages: a.engagementMessages,
    engagementVoiceSamples: a.engagementVoiceSamples,
    presenceSamples: a.presence.samples,
    presenceOnline: a.presence.online,
    presenceIdle: a.presence.idle,
    firstOnlineAt: a.presence.firstOnlineAt,
    lastOnlineAt: a.presence.lastOnlineAt,
    startOfDay: a.startOfDay,
    endOfDay: a.endOfDay,
    updatedAt: a.updatedAt,
  };
}

function itemToActivity(i: Record<string, unknown>): DailyActivity {
  const a = emptyDay(i.userId as string, i.date as string, (i.updatedAt as string) ?? nowIso());
  a.presence = {
    samples: Number(i.presenceSamples ?? 0),
    online: Number(i.presenceOnline ?? 0),
    idle: Number(i.presenceIdle ?? 0),
    firstOnlineAt: (i.firstOnlineAt as string) ?? undefined,
    lastOnlineAt: (i.lastOnlineAt as string) ?? undefined,
  };
  a.ciSubmissions = Number(i.ciSubmissions ?? 0);
  a.engagementMessages = Number(i.engagementMessages ?? 0);
  a.engagementVoiceSamples = Number(i.engagementVoiceSamples ?? 0);
  if (i.startOfDay) a.startOfDay = i.startOfDay as StartOfDay;
  if (i.endOfDay) a.endOfDay = i.endOfDay as EndOfDay;
  return a;
}
