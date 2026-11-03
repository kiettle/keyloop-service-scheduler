import { ConsoleLogger } from '@nestjs/common';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createBookingApp } from '../helpers/booking-app';
import { validateEnvironment } from '../../src/config/environment';
import { BookingCapacity } from '../../src/appointments/booking-capacity';

export interface LoadSample {
  activeBookings: number;
  pendingBookings: number;
  cpuPercent: number;
  eventLoopDelayMs: number;
  rssMiB: number;
}
export type LoadMessage = { type: 'ready'; url: string } | { type: 'sample'; sample: LoadSample };

async function main() {
  const url = process.env.LOAD_DATABASE_URL;
  if (!url) throw new Error('LOAD_DATABASE_URL is required by the isolated load worker.');
  const app = await createBookingApp(
    url,
    validateEnvironment({ ...process.env, DATABASE_URL: url, NODE_ENV: 'production' }),
  );
  app.app.useLogger(new ConsoleLogger({ json: true }));
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let previousCpu = process.cpuUsage();
  let previousTime = performance.now();
  const sample = setInterval(() => {
    const cpu = process.cpuUsage();
    const now = performance.now();
    const value: LoadSample = {
      activeBookings: app.app.get(BookingCapacity).counts.active,
      pendingBookings: app.app.get(BookingCapacity).counts.pending,
      cpuPercent:
        ((cpu.user - previousCpu.user + cpu.system - previousCpu.system) /
          ((now - previousTime) * 1000)) *
        100,
      eventLoopDelayMs: Number.isFinite(loop.mean) ? loop.mean / 1e6 : 0,
      rssMiB: process.memoryUsage().rss / 1024 ** 2,
    };
    previousCpu = cpu;
    previousTime = now;
    loop.reset();
    process.send?.({ type: 'sample', sample: value } satisfies LoadMessage);
  }, 1000);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(sample);
    loop.disable();
    await app.close();
    if (process.connected) process.disconnect();
  };
  const shutdown = () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  };
  process.on('message', (message: unknown) => {
    if (message === 'stop') shutdown();
  });
  process.once('SIGTERM', shutdown);
  process.once('disconnect', shutdown);
  await app.app.listen(0, '127.0.0.1');
  const address = (app.app.getHttpServer() as Server).address() as AddressInfo;
  process.send?.({ type: 'ready', url: `http://127.0.0.1:${address.port}` } satisfies LoadMessage);
}
void main().catch(() => {
  console.error('Load worker startup failed.');
  process.exitCode = 1;
  process.disconnect?.();
});
