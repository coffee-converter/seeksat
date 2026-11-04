// public/sw.js - kill switch. A rollback to this build removes the service
// worker that the any-satellite release installed: it deletes the seeksat-*
// caches, unregisters itself and reloads open windows from the network.
// See docs/ops/service-worker.md on develop. Keep it deployed for a few weeks
// after a rollback, until traffic from old workers dies down.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('seeksat-')).map((n) => caches.delete(n)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map((c) => c.navigate(c.url).catch(() => {})));
  })());
});
