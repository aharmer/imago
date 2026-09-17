import { create } from 'zustand';

/** Set when a newer version of imagoLabel has downloaded and is waiting to take over. */
export const useUpdate = create<{ apply: (() => void) | null }>(() => ({ apply: null }));

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const hadController = Boolean(navigator.serviceWorker.controller);

      const watch = (worker: ServiceWorker | null) => {
        worker?.addEventListener('statechange', () => {
          // Only an update over an existing install is worth telling the user about.
          if (worker.state === 'installed' && hadController) {
            useUpdate.setState({ apply: () => worker.postMessage('skip-waiting') });
          }
        });
      };
      if (registration.waiting && hadController) {
        useUpdate.setState({ apply: () => registration.waiting?.postMessage('skip-waiting') });
      }
      registration.addEventListener('updatefound', () => watch(registration.installing));

      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        location.reload();
      });
    } catch {
      // Offline support is a convenience; the app works without it.
    }
  });
}
