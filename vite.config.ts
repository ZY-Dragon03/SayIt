import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRetrieveHandler } from "./server/api";
import { createDeepSeekProvider } from "./server/provider";

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

  return {
    plugins: [
      react(),
      sayItApiPlugin({
        apiKey: env.DEEPSEEK_API_KEY,
        model: env.DEEPSEEK_MODEL,
        baseUrl: env.DEEPSEEK_BASE_URL,
        diagnostics: mode === "development",
      }),
    ],
  };
});
