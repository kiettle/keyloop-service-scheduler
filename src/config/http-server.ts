import { Server } from 'node:http';

export function configureHttpServer(server: Server): void {
  // Keep persistent connections longer than a typical 60-second upstream idle timeout.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}
