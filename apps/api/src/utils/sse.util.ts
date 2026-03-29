import type { Response } from "express";

export class SseUtil {
  private res: Response;

  constructor(res: Response) {
    this.res = res;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
  }

  /** Send a named event: `event: <event>\ndata: <json>\n\n` */
  send(event: string, data: unknown): void {
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** Send an unnamed data line: `data: <json>\n\n` */
  sendData(data: unknown): void {
    this.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /** Send an error event and end the stream. */
  sendError(message: string): void {
    this.send("stream_error", { type: "stream_error", message });
    this.res.end();
  }

  /** Flush and end the response */
  end(): void {
    this.res.end();
  }
}
