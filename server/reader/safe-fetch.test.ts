import { createConnection, type Server } from "node:net";
import http from "node:http";
import https from "node:https";
import tls, { rootCertificates } from "node:tls";
import { describe, expect, it, vi } from "vitest";
import {
  testOriginCertificate,
  testOriginPrivateKey,
  testRootCa,
} from "./safe-fetch-test-cert";
import {
  enableProxyFromEnvironment,
  isPublicAddress,
  matchesNoProxy,
  safeFetchArticle,
} from "./safe-fetch";

function fakeResponse(
  statusCode = 200,
  headers: Record<string, string> = {},
) {
  return { statusCode, headers, body: Buffer.from("ok") };
}

describe("Reader safe source fetching", () => {
  it.each([
    ["127.0.0.1", false],
    ["10.20.30.40", false],
    ["169.254.2.3", false],
    ["172.31.255.1", false],
    ["192.0.2.4", false],
    ["198.18.1.1", false],
    ["224.0.0.1", false],
    ["8.8.8.8", true],
    ["2606:4700:4700::1111", true],
    ["::1", false],
    ["fc00::1", false],
    ["fe80::1", false],
    ["2001:db8::1", false],
    ["::ffff:127.0.0.1", false],
  ])("classifies %s as public=%s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it("rejects a hostname if any DNS answer is private", async () => {
    const transport = vi.fn(async () => fakeResponse());
    await expect(
      safeFetchArticle("https://news.example/article", {
        env: {},
        resolveAll: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "10.0.0.9", family: 4 },
        ],
        transport,
      }),
    ).rejects.toMatchObject({ code: "unsafe_source_address" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("re-resolves each redirect and rejects DNS variation to a private address", async () => {
    let calls = 0;
    const transport = vi.fn(async () =>
      fakeResponse(302, { location: "https://news.example/second" }),
    );
    await expect(
      safeFetchArticle("https://news.example/first", {
        env: {},
        resolveAll: async () => {
          calls += 1;
          return [{ address: calls === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }];
        },
        transport,
      }),
    ).rejects.toMatchObject({ code: "unsafe_source_address" });
    expect(calls).toBe(2);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect to a private IP before making another request", async () => {
    const transport = vi.fn(async () =>
      fakeResponse(301, { location: "https://127.0.0.1/private" }),
    );
    await expect(
      safeFetchArticle("https://news.example/article", {
        env: {},
        resolveAll: async () => [{ address: "1.1.1.1", family: 4 }],
        transport,
      }),
    ).rejects.toMatchObject({ code: "unsafe_source_address" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("uses the vetted IP for direct NO_PROXY requests", async () => {
    const transport = vi.fn(async () => fakeResponse());
    const result = await safeFetchArticle("https://news.example/article", {
      env: {
        HTTPS_PROXY: "http://proxy.invalid:8080",
        NO_PROXY: "news.example",
      },
      proxySupportEnabled: true,
      resolveAll: async () => [{ address: "8.8.4.4", family: 4 }],
      transport,
    });
    expect(result.statusCode).toBe(200);
    expect(transport).toHaveBeenCalledWith(
      new URL("https://news.example/article"),
      "8.8.4.4",
      expect.objectContaining({ useProxy: false }),
    );
  });

  it("fails closed when a proxy is configured but not safely supported", async () => {
    await expect(
      safeFetchArticle("https://news.example/article", {
        env: { HTTPS_PROXY: "ftp://proxy.invalid:8080" },
        proxySupportEnabled: false,
        resolveAll: async () => [{ address: "8.8.8.8", family: 4 }],
      }),
    ).rejects.toMatchObject({ code: "proxy_unsupported", retryable: true });
  });

  it("matches documented host, suffix, wildcard, port and IPv4 range bypasses", () => {
    expect(matchesNoProxy("localhost", "443", "localhost")).toBe(true);
    expect(matchesNoProxy("api.example.com", "443", ".example.com")).toBe(true);
    expect(matchesNoProxy("api.example.com", "443", "*.example.com")).toBe(true);
    expect(matchesNoProxy("news.example", "8443", "news.example:443")).toBe(false);
    expect(matchesNoProxy("192.168.1.20", "443", "192.168.1.1-192.168.1.100")).toBe(true);
  });
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("Reader pinned-IP HTTPS proxy transport", () => {
  it("sends CONNECT to the vetted IP and preserves origin TLS SNI and HTTP Host", async () => {
    const originalEnv = {
      httpProxy: process.env.HTTP_PROXY,
      lowerHttpProxy: process.env.http_proxy,
      httpsProxy: process.env.HTTPS_PROXY,
      lowerHttpsProxy: process.env.https_proxy,
      noProxy: process.env.NO_PROXY,
      lowerNoProxy: process.env.no_proxy,
    };
    const connectTargets: string[] = [];
    let originRequest: { servername: string | false | null; host: string | undefined } | null = null;
    let secureConnections = 0;
    const tlsErrors: string[] = [];
    const sockets = new Set<import("node:stream").Duplex>();
    let resolveOriginRequest: (() => void) | undefined;
    const originRequestSeen = new Promise<void>((resolve) => (resolveOriginRequest = resolve));
    const origin = https.createServer(
      { key: testOriginPrivateKey, cert: testOriginCertificate },
      (request, response) => {
        originRequest = {
          servername: (request.socket as tls.TLSSocket).servername,
          host: request.headers.host,
        };
        resolveOriginRequest?.();
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<!doctype html><html><body><article>Proxy transport test</article></body></html>");
      },
    );
    const originPort = await listen(origin);
    origin.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    origin.on("secureConnection", () => { secureConnections += 1; });
    origin.on("tlsClientError", (error) => { tlsErrors.push(error.message); });
    const proxy = http.createServer();
    proxy.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    proxy.on("connect", (request, client, head) => {
      connectTargets.push(request.url ?? "");
      const upstream = createConnection(originPort, "127.0.0.1");
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      sockets.add(client);
      client.on("close", () => sockets.delete(client));
      upstream.on("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.byteLength > 0) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    });
    const proxyPort = await listen(proxy);
    const originalTlsConnect = tls.connect;
    const testTlsConnect = ((...args: unknown[]) => {
      const options = args[0] as tls.ConnectionOptions;
      return originalTlsConnect(
        { ...options, ca: [...rootCertificates, testRootCa] },
        args[1] as never,
      );
    }) as typeof tls.connect;
    const tlsConnectSpy = vi.spyOn(tls, "connect").mockImplementation(testTlsConnect);
    let restoreTestProxy: (() => void) | undefined;
    try {
      process.env.HTTPS_PROXY = `http://127.0.0.1:${proxyPort}`;
      process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
      delete process.env.http_proxy;
      delete process.env.https_proxy;
      process.env.NO_PROXY = "127.0.0.1,localhost";
      process.env.no_proxy = "127.0.0.1,localhost";
      // Refresh Node's global dispatcher after setting the test proxy. Production
      // still performs normal certificate and hostname verification.
      restoreTestProxy = enableProxyFromEnvironment();
      const responsePromise = safeFetchArticle("https://article.example/read", {
        env: {
          https_proxy: `http://127.0.0.1:${proxyPort}`,
          no_proxy: "",
        },
        resolveAll: async () => [{ address: "8.8.8.8", family: 4 }],
      });
      let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        responsePromise,
        new Promise<never>((_, reject) => {
          diagnosticTimer = setTimeout(
            () => reject(new Error("fetch stalled: " + JSON.stringify({ connectTargets, secureConnections, originRequest, tlsErrors, socketCount: sockets.size }))),
            5_000,
          );
        }),
      ]).finally(() => clearTimeout(diagnosticTimer));
      await Promise.race([
        originRequestSeen,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("HTTPS origin request was not observed")), 2_000),
        ),
      ]);
      expect(connectTargets).toEqual(["8.8.8.8:443"]);
      expect(originRequest).toEqual({ servername: "article.example", host: "article.example" });
      expect(result.statusCode).toBe(200);
      expect(result.body.toString("utf8")).toContain("Proxy transport test");
    } finally {
      tlsConnectSpy.mockRestore();
      restoreTestProxy?.();
      for (const [key, value] of Object.entries({
        HTTP_PROXY: originalEnv.httpProxy,
        http_proxy: originalEnv.lowerHttpProxy,
        HTTPS_PROXY: originalEnv.httpsProxy,
        https_proxy: originalEnv.lowerHttpsProxy,
        NO_PROXY: originalEnv.noProxy,
        no_proxy: originalEnv.lowerNoProxy,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      for (const socket of sockets) socket.destroy();
      await Promise.all([close(proxy), close(origin)]);
    }
  }, 20_000);
});
