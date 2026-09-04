const CACHE_NAME = 'azimuth-lblx-v0.2.0';
const CACHE_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './manifest.json',
    './app.js',
    './azm-parser.js',
    './vlbl-manager.js',
    './vlbl-solver.js',
    './vlbl-worker.js',
    './measurements-store.js',
    './gnss-parser.js',
    './serial-bridge.js',
    './logger.js',
    './log-analyzer.js',
    './log-storage.js',
    './geo-utils.js',
    './vincenty.js',
    './haversine.js',
    './median.js',
    './smoother.js',
    './sound-speed.js',
    './export.js',
    './emulator.js',
    './poi-manager.js',
    './webview-stub.js',
    './modules/ui-themes.js',
    './modules/ui-settings.js',
    './modules/ui-canvas.js',
    './modules/ui-vlbl.js',
    './modules/ui-ruler.js',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png'
];

// Установка — кэшируем все ассеты
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(CACHE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Активация — удаляем старые кэши
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Перехват запросов — кэш-first для статики
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    
    event.respondWith(
        caches.match(event.request)
            .then((cached) => {
                if (cached) return cached;
                
                return fetch(event.request)
                    .then((response) => {
                        if (response.status === 200) {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME).then((cache) => {
                                cache.put(event.request, responseClone);
                            });
                        }
                        return response;
                    })
                    .catch(() => {
                        if (event.request.mode === 'navigate') {
                            return caches.match('./index.html');
                        }
                        return null;
                    });
            })
    );
});