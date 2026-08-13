import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FlowDesigner } from './App.tsx';
import './styles.css';
import './app.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <FlowDesigner />
  </StrictMode>,
);
