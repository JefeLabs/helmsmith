/** The smallest manifest `validateManifest` accepts; tests spread over it. */
export const minimal = {
  project: 'demo',
  baseBranch: 'develop',
  ports: { services: { frontend: { base: 3000 }, backend: { base: 8443 } } },
  services: {
    backend: { start: 'echo start', stop: 'echo stop', health: 'true' },
    frontend: { start: 'echo start', stop: 'echo stop', health: 'true' },
  },
  scopes: { frontend: ['app-ui/app/{group}/{section}/**'], backend: ['svc/{module}/**'] },
  areas: { 'shop/cart': { module: 'cart' } },
};
