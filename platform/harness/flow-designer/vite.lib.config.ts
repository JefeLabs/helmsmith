import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Library build — the embeddable `<FlowDesigner>` (the app build in
 * vite.config.ts is the npx tool; both ship in one package). Only
 * react/react-dom stay external (peer deps): React Flow, dagre, and
 * flow-spec are bundled so a consumer's versions can never drift from
 * what the designer's validator expects. Tailwind runs HERE, so the
 * emitted stylesheet carries exactly the utilities the components use
 * — the reason raw-source imports could never work for consumers.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist-lib',
    sourcemap: true,
    lib: {
      entry: 'src/lib.ts',
      formats: ['es'],
      fileName: 'flow-designer',
      cssFileName: 'styles',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    },
  },
});
