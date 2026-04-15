const BUILD_VERSION = 'dev';
const PRECACHE_CORE = `precache-core-${BUILD_VERSION}`;
const PRECACHE_CARD = `precache-card-${BUILD_VERSION}`;
const RUNTIME_CACHE = `runtime-${BUILD_VERSION}`;
const CACHE_PREFIXES = ['precache-core-', 'precache-card-', 'runtime-'];

const CORE_ASSETS = ['./', './manifest.json', './icon-192.png', './icon-512.png'];
const CARD_ASSETS = ['./newIcon.png', './bbcoin.png'];

function getScopedUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(PRECACHE_CORE).then((cache) => cache.addAll(CORE_ASSETS)),
      caches.open(PRECACHE_CARD).then((cache) => cache.addAll(CARD_ASSETS)),
    ]).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          const shouldDelete =
            CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix)) &&
            ![PRECACHE_CORE, PRECACHE_CARD, RUNTIME_CACHE].includes(cacheName);

          return shouldDelete ? caches.delete(cacheName) : Promise.resolve(false);
        }),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  const shouldRuntimeCache = ['script', 'style', 'image', 'font'].includes(
    event.request.destination,
  );
  if (!shouldRuntimeCache) {
    return;
  }

  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }

      const networkResponse = await fetch(event.request);
      if (!networkResponse.ok || networkResponse.type !== 'basic') {
        return networkResponse;
      }

      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(event.request, networkResponse.clone());
      return networkResponse;
    })(),
  );
});

self.addEventListener('push', (event) => {
  const defaultUrl = getScopedUrl('./');
  const defaultIcon = getScopedUrl('icon-192.png');
  let data = {
    title: 'Your turn!',
    body: 'Your friend sent you a clip \uD83C\uDFA4',
    icon: defaultIcon,
    badge: defaultIcon,
    url: defaultUrl,
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      try {
        data = { ...data, body: event.data.text() || data.body };
      } catch {
        // Keep the default payload.
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || defaultIcon,
      badge: data.badge || defaultIcon,
      data: {
        url: data.url || defaultUrl,
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || getScopedUrl('./');

  event.waitUntil(
    (async () => {
      const windowClients = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const windowClient of windowClients) {
        if (windowClient.url.startsWith(self.registration.scope)) {
          await windowClient.focus();
          if ('navigate' in windowClient) {
            await windowClient.navigate(targetUrl);
          }
          return;
        }
      }

      await clients.openWindow(targetUrl);
    })(),
  );
});
