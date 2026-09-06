import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
    },
  },
});

// HeroUI v3 needs no provider: components read theme variables from <html>,
// which index.html ships with class="dark".
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <main className="text-foreground bg-background min-h-screen">
          <App />
        </main>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
