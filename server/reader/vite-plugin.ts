import type { Plugin } from "vite";
import { createReaderHandler } from "./api";
import { enableProxyFromEnvironment } from "./safe-fetch";
import { ReaderService, type ReaderServiceOptions } from "./service";

export interface ReaderServicePluginOptions {
  service?: ReaderService;
  serviceOptions?: ReaderServiceOptions;
  enableProxy?: () => () => void;
}

/**
 * Starts the local Reader service with the SayIt Vite service, independent of
 * whether the Reader workspace is mounted or visible in the browser.
 *
 * This process is NOT the scheduler: future scheduled runs belong to the
 * Windows scheduled task (`server/reader/scheduler-main.ts`). The service here
 * still recovers interrupted runs, still catches up an already-overdue date at
 * startup, and still serves manual runs, but it never arms a competing timer, so
 * a merely open browser neither blocks nor duplicates the daily collection.
 */
export function readerServicePlugin(options: ReaderServicePluginOptions = {}): Plugin {
  const service =
    options.service ??
    new ReaderService({ scheduleRuns: false, ...options.serviceOptions });
  const handleReader = createReaderHandler(service);
  const enableProxy = options.enableProxy ?? enableProxyFromEnvironment;

  return {
    name: "sayit-reader-service",
    async configureServer(server) {
      const restoreProxy = enableProxy();
      try {
        await service.start();
      } catch {
        server.config.logger.error("SayIt Reader service could not start.");
      }

      // Register at the raw Connect root so api.ts sees the complete URL path.
      server.middlewares.use((request, response, next) => {
        let pathname = "";
        try {
          pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        } catch {
          next();
          return;
        }
        if (pathname !== "/api/reader" && !pathname.startsWith("/api/reader/")) {
          next();
          return;
        }
        // Another process (the scheduled task) may have committed since this
        // server last read the state, so every Reader request adopts it first.
        void service
          .reload()
          .catch(() => undefined)
          .then(() => handleReader(request, response));
      });

      server.httpServer?.once("close", () => {
        void service.stop().finally(() => restoreProxy());
      });
    },
  };
}
