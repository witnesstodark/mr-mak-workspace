/* Cache the application shell only. Chats, images, reports and API replies never enter this cache. */
const CACHE = 'mrmak-mobile-shell-0.5';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.add('/mobile/'))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('mrmak-mobile-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !(url.pathname === '/mobile/' || url.pathname.startsWith('/assets/'))) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || Response.error()));
});

/* A chat waiting for you: one notification per chat, replaced while it waits. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* An unreadable push still tells the person to look. */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Mr. Mak', { body: data.body || 'A chat is waiting for you.', tag: data.chat ? `chat-${data.chat}` : 'mrmak', renotify: true, icon: '/assets/mak-mobile-192.png', data: { chat: data.chat || null } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const chat = event.notification.data?.chat;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(client => new URL(client.url).pathname.startsWith('/mobile'));
    if (open) { if (chat) open.postMessage({ type: 'open-chat', chat }); return open.focus(); }
    return self.clients.openWindow(chat ? `/mobile/#chat=${encodeURIComponent(chat)}` : '/mobile/');
  }));
});
