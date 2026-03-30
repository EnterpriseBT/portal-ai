import type { Response } from "express";

export class SseUtil {
  private res: Response;
  private closed = false;

  constructor(res: Response) {
    this.res = res;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // Disable EventSource auto-reconnect. Each reconnect would trigger a
    // brand new AI stream request, which compounds rate-limit pressure.
    res.write("retry: 0\n\n");
    res.write(": connected\n\n");
  }

  /** True if the stream has already been ended (via `end()` or `sendError()`). */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Send a named event: `event: <event>\ndata: <json>\n\n` */
  send(event: string, data: unknown): void {
    if (this.closed) return;
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** Send an unnamed data line: `data: <json>\n\n` */
  sendData(data: unknown): void {
    if (this.closed) return;
    this.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /** Send an error event and end the stream. */
  sendError(message: string): void {
    if (this.closed) return;
    this.send("stream_error", { type: "stream_error", message });
    this.end();
  }

  /** Flush and end the response. Safe to call multiple times. */
  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }
}
