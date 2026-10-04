import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import type { IncomingHttpHeaders } from "node:http";

export const MAX_ARTICLE_BYTES = 3 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 12_000;

export class SafeFetchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeHttpResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  finalUrl: string;
  pinnedAddresses: string[];
}

export interface AddressRecord {
  address: string;
  family: number;
}

export type ResolveAll = (hostname: string) => Promise<AddressRecord[]>;

export interface SafeFetchOptions {
  env?: NodeJS.ProcessEnv;
  resolveAll?: ResolveAll;
  requestTimeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
  proxySupportEnabled?: boolean;
  transport?: (
    url: URL,
    pinnedAddress: string,
    options: { useProxy: boolean; proxyUrl?: string; timeoutMs: number; maxBodyBytes: number },
  ) => Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: Buffer }>;
}

function parseIpv4(address: string): number[] | null {
  if (net.isIP(address) !== 4) return null;
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => part >= 0 && part <= 255)
    ? parts
    : null;
}

function parseIpv6(address: string): bigint | null {
  if (net.isIP(address) !== 6 || address.includes("%")) return null;
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length === 1
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8) return null;
  try {
    return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
  } catch {
    return null;
  }
}

export function isPublicAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) {
    const [a, b, c] = ipv4;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    ) {
      return false;
    }
    return true;
  }

  const ipv6 = parseIpv6(address);
  if (ipv6 === null) return false;
  const first = Number((ipv6 >> 112n) & 0xffffn);
  // Only global-unicast 2000::/3 is accepted. This excludes unspecified,
  // loopback, link-local, ULA, multicast, mapped and translation ranges.
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001) {
    const second = Number((ipv6 >> 96n) & 0xffffn);
    if (second <= 0x01ff || second === 0x0db8) return false;
  }
  if (first === 0x2002) return false; // 6to4 can embed private IPv4.
  if (first === 0x3fff) return false; // Documentation-only prefix.
  return true;
}

function isInIpv4Range(address: string, range: string): boolean {
  const [lowText, highText] = range.split("-");
  const candidate = parseIpv4(address);
  const low = parseIpv4(lowText);
  const high = parseIpv4(highText);
  if (!candidate || !low || !high) return false;
  const number = (parts: number[]) =>
    parts.reduce((value, part) => value * 256 + part, 0);
  return number(candidate) >= number(low) && number(candidate) <= number(high);
}

export function matchesNoProxy(
  hostname: string,
  port: string,
  noProxyValue: string | undefined,
): boolean {
  if (!noProxyValue) return false;
  const normalizedHost = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  for (const rawEntry of noProxyValue.split(",")) {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) continue;
    if (entry === "*") return true;
    const lastColon = entry.lastIndexOf(":");
    const hasPort = lastColon > -1 && !entry.startsWith("[");
    const entryPort = hasPort ? entry.slice(lastColon + 1) : "";
    const hostPattern = hasPort ? entry.slice(0, lastColon) : entry;
    if (hasPort && entryPort !== port) continue;
    if (hostPattern.includes("-") && isInIpv4Range(normalizedHost, hostPattern)) {
      return true;
    }
    const trimmedPattern = hostPattern.replace(/^\*\./, ".");
    if (
      normalizedHost === trimmedPattern.replace(/^\./, "") ||
      (trimmedPattern.startsWith(".") &&
        normalizedHost.endsWith(trimmedPattern) &&
        normalizedHost.length > trimmedPattern.length - 1) ||
      (!trimmedPattern.startsWith(".") && normalizedHost === trimmedPattern)
    ) {
      return true;
    }
  }
  return false;
}

function getProxyValue(url: URL, env: NodeJS.ProcessEnv): string | undefined {
  if (url.protocol === "https:") {
    return env.https_proxy || env.HTTPS_PROXY;
  }
  return env.http_proxy || env.HTTP_PROXY;
}

function noProxyValue(env: NodeJS.ProcessEnv): string | undefined {
  return env.no_proxy || env.NO_PROXY;
}

function parseSafeUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeFetchError("invalid_url", "The article source URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    url.hostname === "" ||
    url.hostname.includes("%")
  ) {
    throw new SafeFetchError(
      "unsafe_url",
      "Only public HTTPS article sources can be checked.",
    );
  }
  url.hash = "";
  return url;
}

async function systemResolve(hostname: string): Promise<AddressRecord[]> {
  const result = await dns.lookup(hostname, { all: true, verbatim: true });
  return result.map((item) => ({ address: item.address, family: item.family }));
}

async function vetAndPin(hostname: string, resolveAll: ResolveAll): Promise<string[]> {
  const family = net.isIP(hostname);
  const records = family
    ? [{ address: hostname, family }]
    : await resolveAll(hostname);
  const addresses = [...new Set(records.map((record) => record.address))];
  if (addresses.length === 0) {
    throw new SafeFetchError(
      "source_dns_failed",
      "The article source could not be resolved.",
      true,
    );
  }
  if (
    records.some((record) => !isPublicAddress(record.address)) ||
    addresses.some((address) => !isPublicAddress(address))
  ) {
    throw new SafeFetchError(
      "unsafe_source_address",
      "The article source resolved to a restricted network address.",
    );
  }
  return addresses;
}

function systemPinnedTransport(
  url: URL,
  pinnedAddress: string,
  options: { useProxy: boolean; proxyUrl?: string; timeoutMs: number; maxBodyBytes: number },
): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: Buffer }> {
  if (url.protocol !== "https:") {
    return Promise.reject(new SafeFetchError("unsafe_url", "Only HTTPS is allowed."));
  }
  const hostHeader = url.host;
  const family = net.isIP(pinnedAddress);
  const connectHost = family === 6 ? `[${pinnedAddress}]` : pinnedAddress;
  const connectTarget = `${connectHost}:443`;
  let socket: net.Socket | tls.TLSSocket | null = null;
  let settled = false;
  const deadline = Date.now() + options.timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());

  const transport = async () => {
    if (options.useProxy) {
      if (!options.proxyUrl) {
        throw new SafeFetchError("proxy_unsupported", "The configured proxy could not be validated.", true);
      }
      socket = await connectProxyTunnel(options.proxyUrl, connectTarget, remaining());
    } else {
      socket = net.connect({ host: pinnedAddress, port: 443, family });
      socket.setTimeout(remaining(), () => socket?.destroy(new Error("timeout")));
      await once(socket, "connect");
    }

    const tlsSocket = tls.connect({
      socket,
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      rejectUnauthorized: true,
    });
    socket = tlsSocket;
    tlsSocket.setTimeout(remaining(), () => tlsSocket.destroy(new Error("timeout")));
    await once(tlsSocket, "secureConnect");

    return await new Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const agent = new http.Agent({ keepAlive: false });
      agent.createConnection = ((_requestOptions, callback) => {
        if (callback) callback(null, tlsSocket);
        return tlsSocket;
      }) as typeof agent.createConnection;
      const request = http.request(
        {
          hostname: pinnedAddress,
          port: 443,
          method: "GET",
          path: `${url.pathname}${url.search}`,
          headers: {
            Host: hostHeader,
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            "Accept-Encoding": "identity",
            "User-Agent": "SayItReader/1.0 (local reading workspace)",
            Connection: "close",
          },
          agent,
          timeout: remaining(),
        },
        (response) => {
          const contentLength = Number(response.headers["content-length"] || 0);
          if (contentLength > options.maxBodyBytes) {
            response.destroy();
            agent.destroy();
            reject(new SafeFetchError("source_too_large", "The article page is too large."));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.byteLength;
            if (size > options.maxBodyBytes) {
              response.destroy();
              request.destroy();
              agent.destroy();
              reject(new SafeFetchError("source_too_large", "The article page is too large."));
              return;
            }
            chunks.push(buffer);
          });
          response.on("end", () => {
            agent.destroy();
            resolve({
              statusCode: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
            });
          });
          response.on("error", () => {
            agent.destroy();
            reject(new SafeFetchError("source_read_failed", "The article source response was interrupted.", true));
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("timeout")));
      request.on("error", (error) => {
        agent.destroy();
        reject(
          new SafeFetchError(
            error.message === "timeout" ? "source_timeout" : "source_unavailable",
            error.message === "timeout"
              ? "The article source took too long to respond."
              : "The article source could not be reached.",
            true,
          ),
        );
      });
      request.end();
    });
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket?.destroy(new Error("timeout"));
      if (!settled) {
        settled = true;
        reject(new SafeFetchError("source_timeout", "The article source took too long to respond.", true));
      }
    }, options.timeoutMs);
    void transport()
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket?.destroy();
        resolve(value);
      })
      .catch((error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket?.destroy();
        reject(
          error instanceof SafeFetchError
            ? error
            : new SafeFetchError("source_unavailable", "The article source could not be reached.", true),
        );
      });
  });
}

async function connectProxyTunnel(
  proxyValue: string,
  connectTarget: string,
  timeoutMs: number,
): Promise<net.Socket | tls.TLSSocket> {
  let proxy: URL;
  try {
    proxy = new URL(proxyValue);
  } catch {
    throw new SafeFetchError("proxy_unsupported", "The configured proxy URL is invalid.", true);
  }
  if (proxy.protocol !== "http:" && proxy.protocol !== "https:") {
    throw new SafeFetchError("proxy_unsupported", "Only HTTP and HTTPS proxies can be used safely.", true);
  }
  if (proxy.hostname === "" || proxy.pathname !== "/" || proxy.search || proxy.hash) {
    throw new SafeFetchError("proxy_unsupported", "The configured proxy URL is unsupported.", true);
  }
  const isTlsProxy = proxy.protocol === "https:";
  const proxyPort = Number(proxy.port || (isTlsProxy ? 443 : 80));
  const auth =
    proxy.username || proxy.password
      ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`
      : undefined;
  const requestOptions = {
    hostname: proxy.hostname,
    port: proxyPort,
    method: "CONNECT",
    path: connectTarget,
    headers: {
      Host: connectTarget,
      ...(auth ? { "Proxy-Authorization": auth } : {}),
      Connection: "keep-alive",
    },
    agent: isTlsProxy ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false }),
    timeout: timeoutMs,
  };

  return new Promise((resolve, reject) => {
    const request = (isTlsProxy ? https.request : http.request)(requestOptions);
    request.on("connect", (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(
          new SafeFetchError(
            "proxy_connect_failed",
            `The configured proxy rejected the pinned article connection (HTTP ${response.statusCode ?? 0}).`,
            response.statusCode === 407 || (response.statusCode ?? 0) >= 500,
            response.statusCode ?? null,
          ),
        );
        return;
      }
      if (head.byteLength > 0) socket.unshift(head);
      resolve(socket);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("timeout")));
    request.on("error", (error) => {
      reject(
        new SafeFetchError(
          error.message === "timeout" ? "proxy_timeout" : "proxy_unavailable",
          error.message === "timeout"
            ? "The configured proxy took too long to establish a secure article connection."
            : "The configured proxy could not establish a secure article connection.",
          true,
        ),
      );
    });
    request.end();
  });
}

export async function safeFetchArticle(
  inputUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeHttpResponse> {
  const env = options.env ?? process.env;
  const resolveAll = options.resolveAll ?? systemResolve;
  const transport = options.transport ?? systemPinnedTransport;
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? MAX_ARTICLE_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let current = parseSafeUrl(inputUrl);
  const pinnedAddresses: string[] = [];

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const addresses = await vetAndPin(current.hostname, resolveAll);
    // Every DNS answer is vetted. Pin one answer for this hop so variation
    // between lookup and connect cannot rebind the request destination.
    const pinnedAddress = addresses[0];
    pinnedAddresses.push(pinnedAddress);
    const proxy = getProxyValue(current, env);
    const bypass = matchesNoProxy(
      current.hostname,
      current.port || "443",
      noProxyValue(env),
    );
    const response = await transport(current, pinnedAddress, {
      useProxy: Boolean(proxy && !bypass),
      ...(proxy && !bypass ? { proxyUrl: proxy } : {}),
      timeoutMs,
      maxBodyBytes,
    });
    const status = response.statusCode;
    const location = response.headers.location;
    if (status >= 300 && status < 400 && typeof location === "string") {
      if (redirects === maxRedirects) {
        throw new SafeFetchError("too_many_redirects", "The article source redirected too many times.");
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new SafeFetchError("invalid_redirect", "The article source returned an invalid redirect.");
      }
      current = parseSafeUrl(next.toString());
      continue;
    }
    return {
      statusCode: status,
      headers: response.headers,
      body: response.body,
      finalUrl: current.toString(),
      pinnedAddresses,
    };
  }
  throw new SafeFetchError("too_many_redirects", "The article source redirected too many times.");
}

export function enableProxyFromEnvironment(): () => void {
  const proxyApi = (
    http as typeof http & {
      setGlobalProxyFromEnv?: () => () => void;
    }
  ).setGlobalProxyFromEnv;
  if (typeof proxyApi !== "function") return () => undefined;
  const restore = proxyApi.call(http);
  return typeof restore === "function" ? restore : () => undefined;
}
