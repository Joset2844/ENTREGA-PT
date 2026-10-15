/* Service worker de Control de Entregas.
   - La app (index.html) va primero por red para que siempre veas la última versión; si no hay internet, usa la copia guardada.
   - Íconos y manifest: copia guardada primero.
   - Librería de Excel y tipografías: se guardan para poder usarlas sin conexión.
   - Sheets, Apps Script y los CSV publicados NUNCA se guardan: siempre van directo a la red. */
var VERSION = "entregas-v2";
var SHELL = ["./", "index.html", "manifest.json", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"];
var CDN = ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: "reload" })).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function guardar(req, res) {
  if (res && (res.ok || res.type === "opaque")) { var copia = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copia); }); }
  return res;
}
function redPrimero(req) {
  return fetch(req).then(function (res) { return guardar(req, res); }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match("index.html") || caches.match("./"); });
  });
}
function cachePrimero(req) {
  return caches.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { return guardar(req, res); }); });
}
function rapidoYActualiza(req) {
  return caches.match(req).then(function (hit) {
    var red = fetch(req).then(function (res) { return guardar(req, res); }).catch(function () { return hit; });
    return hit || red;
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var u = new URL(req.url);
  if (u.origin === self.location.origin) {
    var esPagina = req.mode === "navigate" || /\/$|\/index\.html$/.test(u.pathname);
    e.respondWith(esPagina ? redPrimero(req) : cachePrimero(req));
    return;
  }
  if (CDN.indexOf(u.hostname) !== -1) { e.respondWith(rapidoYActualiza(req)); }
  /* cualquier otro origen (Google Sheets, Apps Script...) no se intercepta */
});
