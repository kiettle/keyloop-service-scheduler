export interface HttpRequest {
  method: string;
  url: string;
  requestId?: string;
}

export interface HttpResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  status(code: number): HttpResponse;
  json(body: unknown): void;
}
