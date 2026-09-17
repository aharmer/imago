import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store';
import './styles.css';

// Lets automated tests drive the app from the console during development.
if (import.meta.env.DEV) Object.assign(window, { __imago: useStore });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
