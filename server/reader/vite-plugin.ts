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
 * Starts the local Reader scheduler with the SayIt Vite service, independent of
 * whether the Reader workspace is mounted or visible in the browser.
 */
export function readerServicePlugin(options: ReaderServicePluginOptions = {}): Plugin {
  const service = options.service ?? new ReaderService(options.serviceOptions);
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
        void handleReader(request, response);
      });

      server.httpServer?.once("close", () => {
        void service.stop().finally(() => restoreProxy());
      });
    },
  };
}
