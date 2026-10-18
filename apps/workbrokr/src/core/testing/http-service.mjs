#!/usr/bin/env node
// A tiny HTTP "service" for runner tests and the workbrokr e2e fixture:
//   node http-service.mjs --port N --name X   →  GET /health answers "200 ok X".
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const port = Number(arg('--port', process.env.PORT ?? '0'));
const name = arg('--name', 'service');

createServer((req, res) => {
  res.statusCode = 200;
  res.end(`ok ${name} ${req.url}\n`);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`${name} listening on ${port}\n`);
});
