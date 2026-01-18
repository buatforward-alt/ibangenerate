const CACHE_NAME = 'ninepacman-v-sync-final';
const ASSETS = [
    './',
    './index.html',
    './background.jpg',
    './favicon.png',
    'https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js'
];

// 1. Install Service Worker & Cache Aset
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS);
        })
    );
});

// 2. Activate & Bersihkan Cache Lama
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (key !== CACHE_NAME) return caches.delete(key);
            })
        ))
    );
    self.clients.claim();
});

// 3. Fetch Strategy (Network First, Fallback ke Cache)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Filter: Bypass cache untuk API External (Telegram & RandomUser)
    // agar data selalu fresh dari internet.
    if (url.hostname === 'api.telegram.org' || url.hostname === 'randomuser.me') {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .catch(() => {
                // Jika offline/gagal, ambil dari cache (termasuk Axios & Gambar)
                return caches.match(event.request);
            })
    );
});
