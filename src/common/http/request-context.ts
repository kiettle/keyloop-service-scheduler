export interface HttpRequest {
  method: string;
  url: string;
  requestId?: string;
  rawHeaders: string[];
}

export interface HttpResponse {
  statusCode: number;
  writableEnded: boolean;
  on(event: 'close', listener: () => void): void;
  off(event: 'close', listener: () => void): void;
  setHeader(name: string, value: string): void;
  status(code: number): HttpResponse;
  json(body: unknown): void;
}
