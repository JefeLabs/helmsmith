/**
 * DynamoDB contract test — OPT-IN. The exact same contract that SQLite passes,
 * pointed at a local DynamoDB. It is skipped unless `DDB_ENDPOINT` is set, so
 * `pnpm test` stays green without Docker. To run it:
 *
 *   docker run -p 8000:8000 amazon/dynamodb-local
 *   DDB_ENDPOINT=http://localhost:8000 AWS_ACCESS_KEY_ID=x \
 *     AWS_SECRET_ACCESS_KEY=x pnpm test
 *
 * The beforeAll provisions the single table + GSI1 the adapter expects.
 */
import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import { beforeAll, describe, it } from 'vitest';
import { storageContract } from '../contract.js';
import { DynamoAdapter } from './DynamoAdapter.js';

const endpoint = process.env.DDB_ENDPOINT;
const TABLE = process.env.DDB_TABLE ?? 'timetracker_test';
const REGION = process.env.AWS_REGION ?? 'us-east-1';

async function ensureTable(): Promise<void> {
  const client = new DynamoDBClient({ region: REGION, endpoint });
  try {
    await client.send(
      new CreateTableCommand({
        TableName: TABLE,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'gsi1pk', AttributeType: 'S' },
          { AttributeName: 'gsi1sk', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'gsi1pk', KeyType: 'HASH' },
              { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }),
    );
  } catch (err) {
    if (!(err instanceof ResourceInUseException)) throw err; // already exists → fine
  } finally {
    client.destroy();
  }
}

if (endpoint) {
  beforeAll(ensureTable);
  storageContract('DynamoAdapter (dynamodb-local)', async () => {
    const adapter = new DynamoAdapter({
      backend: 'dynamodb',
      table: TABLE,
      region: REGION,
      endpoint,
    });
    await adapter.init();
    return adapter;
  });
} else {
  describe('DynamoAdapter (dynamodb-local)', () => {
    it.skip('set DDB_ENDPOINT (+ run dynamodb-local) to exercise the Dynamo contract', () => {});
  });
}
