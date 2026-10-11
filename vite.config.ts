import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRetrieveHandler } from "./server/api";
import { createDeepSeekJsonCompletionClient, createDeepSeekProvider } from "./server/provider";
import { readerServicePlugin } from "./server/reader/vite-plugin";

interface ApiPluginOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  diagnostics?: boolean;
}

function sayItApiPlugin(options: ApiPluginOptions): Plugin {
  return {
    name: "sayit-api",
    configureServer(server) {
      const provider = createDeepSeekProvider(options);
      const handleRetrieve = createRetrieveHandler(provider);
      server.middlewares.use("/api/retrieve", (request, response) => {
        void handleRetrieve(request, response);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const providerConfig = {
    apiKey: env.DEEPSEEK_API_KEY,
    model: env.DEEPSEEK_MODEL,
    baseUrl: env.DEEPSEEK_BASE_URL,
  };

  return {
    plugins: [
      react(),
      ...(mode === "development"
        ? [readerServicePlugin({
            serviceOptions: {
              semanticClient: createDeepSeekJsonCompletionClient(providerConfig),
            },
          })]
        : []),
      sayItApiPlugin({
        ...providerConfig,
        diagnostics: mode === "development",
      }),
    ],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
    optimizeDeps: {
      // `phonemize` ships an English exception table that contains the word
      // "await". esbuild's JSON-to-ESM helper names an export after each key, so
      // pre-bundling emits `await: () => await`, which is a syntax error in a
      // module and makes the whole IPA engine fail to load in the browser. Left
      // out of the optimizer, Vite serves the engine's own ESM entry and
      // transforms its JSON imports instead. Only affects the dev server.
      exclude: ["phonemize"],
    },
  };
});
