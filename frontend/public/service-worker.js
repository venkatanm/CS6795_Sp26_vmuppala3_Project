/**
 * Service Worker for SAT Prep Platform
 * 
 * Implements offline-first caching strategy:
 * - App Shell: Pre-caches critical app files with StaleWhileRevalidate
 * - Exam Assets: Dynamically caches exam images and passages
 * 
 * Note: This is a vanilla JavaScript service worker (no ES6 imports)
 * Workbox modules would require bundling. For simplicity, we use native
 * Cache API and Fetch API directly.
 */

const CACHE_VERSION = 'v2';
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const EXAM_ASSETS_CACHE = 'exam-assets-v1';

// App shell files to pre-cache
const APP_SHELL_FILES = [
  '/',
  '/dashboard',
];

// Install event - pre-cache app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Service Worker installing...');
  
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      console.log('[SW] Pre-caching app shell files...');
      return cache.addAll(APP_SHELL_FILES).catch((error) => {
        console.warn('[SW] Some app shell files failed to cache:', error);
        // Don't fail installation if some files can't be cached
      });
    })
  );
  
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete old app shell caches
          if (cacheName.startsWith('app-shell-') && cacheName !== APP_SHELL_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  
  // Take control of all clients immediately
  return self.clients.claim();
});

// Handle fetch events - serve from cache when network fails
// Strategy: Cache-first ONLY for explicit exam assets (images, audio, passages)
// All other requests (pages, API, JS chunks) pass through to network unmodified
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Only intercept explicit exam asset paths — skip everything else
  // (page navigations, API routes, _next static chunks, etc.)
  const isExamAsset = url.pathname.startsWith('/exam-assets/') ||
                      url.pathname.startsWith('/passages/') ||
                      /\.(png|jpg|jpeg|gif|webp|svg|mp3|mp4)$/.test(url.pathname);

  if (!isExamAsset) {
    // Let the browser handle normally — no SW interception
    return;
  }

  // For exam assets, use CacheFirst strategy (check cache first, then network)
  // This ensures cached assets are served even when offline
  event.respondWith(
    caches.open(EXAM_ASSETS_CACHE).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // Serve from cache immediately
          return cachedResponse;
        }

        // Not in cache, try network
        return fetch(event.request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }

            // Cache successful responses for future offline use
            const responseToCache = response.clone();
            cache.put(event.request, responseToCache).catch((error) => {
              console.warn('[SW] Failed to cache response:', error);
            });

            return response;
          })
          .catch((error) => {
            // Network failed - try to serve from any cache as last resort
            console.warn('[SW] Network failed, checking all caches for:', event.request.url);
            return caches.match(event.request).then((cached) => {
              if (cached) return cached;
              // Nothing in cache either - return a proper network error response
              return new Response('Network error', { status: 503, statusText: 'Service Unavailable' });
            });
          });
      });
    })
  );
});

// Handle messages from the main thread to cache exam assets
self.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'CACHE_ASSETS') {
    const assetUrls = event.data.payload;
    
    if (!Array.isArray(assetUrls)) {
      console.error('[SW] CACHE_ASSETS: payload must be an array of URLs');
      event.ports[0]?.postMessage({ success: false, error: 'Invalid payload' });
      return;
    }

    console.log(`[SW] Caching ${assetUrls.length} exam assets...`);

    try {
      const cache = await caches.open(EXAM_ASSETS_CACHE);
      const cachePromises = assetUrls.map(async (url) => {
        try {
          // Validate URL
          const urlObj = new URL(url, self.location.origin);
          
          // Fetch and cache the asset
          const response = await fetch(urlObj.toString());
          
          if (response.ok) {
            await cache.put(urlObj.toString(), response.clone());
            console.log(`[SW] ✅ Cached: ${urlObj.toString()}`);
            return { url: urlObj.toString(), success: true };
          } else {
            console.warn(`[SW] ⚠️ Failed to cache (${response.status}): ${urlObj.toString()}`);
            return { url: urlObj.toString(), success: false, status: response.status };
          }
        } catch (error) {
          console.error(`[SW] ❌ Error caching ${url}:`, error);
          return { url, success: false, error: error.message };
        }
      });

      const results = await Promise.allSettled(cachePromises);
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.length - successful;

      console.log(`[SW] Cache complete: ${successful} successful, ${failed} failed`);

      // Send response back to main thread
      event.ports[0]?.postMessage({
        success: true,
        cached: successful,
        failed: failed,
        results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason }),
      });
    } catch (error) {
      console.error('[SW] Error in CACHE_ASSETS handler:', error);
      event.ports[0]?.postMessage({
        success: false,
        error: error.message,
      });
    }
  } else if (event.data && event.data.type === 'SKIP_WAITING') {
    // Allow service worker to skip waiting and activate immediately
    self.skipWaiting();
  }
});
