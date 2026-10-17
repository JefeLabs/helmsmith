// e2e fixture: two tiny HTTP services stand in for a backend and a frontend.
export default {
  project: 'fixture',
  baseBranch: 'develop',
  ports: { services: { backend: { base: 45100 }, frontend: { base: 45200 } } },
  services: {
    backend: {
      start: 'node services/http.mjs --port $PORT_BACKEND --name backend',
      stop: 'true',
      health: 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT_BACKEND/health',
      healthyCodes: [200],
      healthTimeoutMs: 20000,
    },
    frontend: {
      start: 'node services/http.mjs --port $PORT_FRONTEND --name frontend',
      stop: 'true',
      health: 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT_FRONTEND/',
      healthyCodes: [200],
      healthTimeoutMs: 20000,
    },
  },
  logs: { dir: '.logs' },
  env: {
    file: '.env.slot',
    template: {
      SLOT: '${SLOT}',
      PORT_BACKEND: '${PORT_BACKEND}',
      PORT_FRONTEND: '${PORT_FRONTEND}',
      LOG_DIR: '${LOG_DIR}',
    },
  },
  refresh: [{ always: true, run: 'mkdir -p .logs && echo refreshed >> .logs/refresh.marker' }],
  scopes: {
    frontend: [
      'app/{group}/{section}/**',
      'components/{group}/{section}/**',
      'app/api/{section}/**',
    ],
    backend: ['svc/{module}/**'],
  },
  areas: { 'shop/cart': { module: 'cart' }, 'platform/auth': { commons: ['auth'] } },
  commons: { auth: ['api/auth/**'] },
};
