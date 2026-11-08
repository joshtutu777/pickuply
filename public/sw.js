const shell = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("pickuply-shell").then((cache) => cache.add(shell)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/admin") || url.pathname.startsWith("/jobs")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(shell)));
  }
});

self.addEventListener("push", (event) => {
  let payload = { title: "Pickuply", body: "You have an update.", href: "/account/notifications", id: "" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data ? event.data.text() : payload.body;
  }
  const href = typeof payload.href === "string" && payload.href.startsWith("/") && !payload.href.startsWith("//")
    ? payload.href
    : "/account/notifications";
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.id || undefined,
      data: { href, id: payload.id },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.href ? event.notification.data.href : "/account/notifications";
  const href = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/account/notifications";
  let target = new URL("/account/notifications", self.location.origin).href;
  try {
    const url = new URL(href, self.location.origin);
    if (url.origin === self.location.origin) target = url.href;
  } catch {
    target = new URL("/account/notifications", self.location.origin).href;
  }
  event.waitUntil(self.clients.openWindow(target));
});
