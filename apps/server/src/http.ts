/**
 * Request plumbing shared by the admin and portal servers.
 *
 * Split out of server.ts so it can be tested: that module is the composition
 * root — it builds the container, opens ports and starts the job engine as
 * soon as it is imported — so nothing inside it is reachable from a unit
 * test.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createLogger, errorMessage } from "@tinkerbell/core";

export function toFetchRequest(req: IncomingMessage): Request {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  return new Request(url.toString(), {
    method: req.method,
    headers: Object.entries(req.headers).reduce(
      (h, [k, v]) => {
        if (v) h[k] = Array.isArray(v) ? v.join(", ") : v;
        return h;
      },
      {} as Record<string, string>,
    ),
    body: req.method !== "GET" && req.method !== "HEAD" ? (req as unknown as ReadableStream) : undefined,
    // @ts-expect-error duplex is required for streaming request bodies
    duplex: "half",
  });
}

/**
 * A client that went away mid-request. Routine on a UI that navigates while a
 * slow query is still running — not a fault, and not worth a log line at error
 * level. `ERR_STREAM_UNABLE_TO_PIPE` is what Node raises when `pipeline`'s
 * destination is already destroyed by the time we reach it.
 */
export function isClientDisconnect(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return (
    code === "ERR_STREAM_UNABLE_TO_PIPE" ||
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    code === "ERR_STREAM_WRITE_AFTER_END" ||
    code === "ECONNRESET" ||
    code === "EPIPE"
  );
}

export async function sendFetchResponse(fetchRes: Response, res: ServerResponse): Promise<void> {
  // The handler that produced this response may have taken a while — rendering
  // a collection poster runs the better part of a second — and the client is
  // free to navigate away in the meantime. Writing to the socket it left behind
  // throws, so there is nothing to send the response to and nothing to do.
  if (res.destroyed || res.writableEnded) return;

  const headers = Object.fromEntries(fetchRes.headers.entries());
  // `writeHead` replaces a header set earlier rather than merging it, and tRPC
  // sends its own `Vary` — which would drop the `Vary: Origin` CORS set
  // (`cors.ts`) and let a cache serve one origin's answer to another.
  const vary = res.getHeader("Vary");
  if (vary && headers.vary) headers.vary = `${String(vary)}, ${headers.vary}`;
  res.writeHead(fetchRes.status, headers);
  if (!fetchRes.body) {
    res.end();
    return;
  }
  // `pipeline` honours Node's HTTP backpressure (the previous hand-rolled
  // loop ignored `res.write()`'s return value and buffered without bound)
  // and tears down the upstream reader on error.
  await pipeline(Readable.fromWeb(fetchRes.body as never), res);
}

/**
 * Wraps an async request handler so a rejection lands here rather than on
 * `process.on("unhandledRejection")`.
 *
 * `createServer` takes the handler's returned promise and drops it, so before
 * this every unguarded `await` in a route was one disconnect away from a
 * process-level rejection — which without the safety net in server.ts is a
 * killed container, and with it is a stack-less error line nobody can trace
 * back to a route.
 */
export function guarded(
  logger: Pick<ReturnType<typeof createLogger>, "error">,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handler(req, res).catch((err: unknown) => {
      if (!isClientDisconnect(err)) {
        logger.error("request failed", { method: req.method, path: req.url, err: errorMessage(err) });
      }
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request failed" }));
    });
  };
}
