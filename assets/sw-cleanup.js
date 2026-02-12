(function () {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  const CLEANUP_VERSION = "2026-02-12-1";
  const SESSION_KEY = `bah-sw-cleanup:${CLEANUP_VERSION}`;
  const FLAG_PARAM = "sw-cleanup";

  if (sessionStorage.getItem(SESSION_KEY) === "done") {
    return;
  }

  const url = new URL(window.location.href);
  const hasReloadFlag = url.searchParams.get(FLAG_PARAM) === "1";

  (async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();

      if (!registrations.length) {
        sessionStorage.setItem(SESSION_KEY, "done");
        if (hasReloadFlag) {
          url.searchParams.delete(FLAG_PARAM);
          window.history.replaceState({}, "", url.toString());
        }
        return;
      }

      const hadController = Boolean(navigator.serviceWorker.controller);
      await Promise.all(registrations.map((registration) => registration.unregister()));

      if ("caches" in window && typeof caches.keys === "function") {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      sessionStorage.setItem(SESSION_KEY, "done");

      if (hadController && !hasReloadFlag) {
        url.searchParams.set(FLAG_PARAM, "1");
        window.location.replace(url.toString());
      }
    } catch (_) {
      // Ignore cleanup failures so the app can continue loading.
    }
  })();
})();
