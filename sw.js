// Service worker: keeps a copy of every game file on the device, so the
// installed app also works without internet, or when the website is switched
// off. It fetches the newest files first (so updates arrive) and falls back
// to the saved copy.

const CACHE = 'maxiween-v18';
const FILES = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './vendor/three.module.js',
  './src/main.js', './src/audio.js', './src/room.js', './src/textures.js', './src/ghost.js', './src/hud.js',
  './src/trail.js', './src/fx.js', './src/vrmenu.js', './src/shield.js', './src/movement.js', './src/scares.js',
  './src/horror.js', './src/potion.js', './src/wand.js', './src/house.js', './src/key.js', './src/powerup.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // throw away copies saved by older versions
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const saved = () => caches.match(event.request, { ignoreSearch: true });
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        // keep the newest copy (also the spooky font from Google Fonts)
        if (response.ok || response.type === 'opaque') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        }
        // the site answered with an error (e.g. it was switched off): use the saved copy if there is one
        return (await saved()) || response;
      })
      .catch(saved),
  );
});
