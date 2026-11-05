import { fork } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoadMessage } from '../load/server';
import { createTestDatabase } from '../helpers/test-database';

describe('isolated load worker lifecycle', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => database?.close());

  it('serves requests on the fixture-owned listener and stops cleanly', async () => {
    const child = fork('test/load/server.ts', [], {
      execArgv: ['--require', 'ts-node/register'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: database.url,
        LOAD_DATABASE_URL: database.url,
        REDIS_URL: '',
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );
    let stopTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Load worker readiness timed out.')),
          20000,
        );
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`Load worker exited before readiness (${code}): ${stderr}`));
        });
        child.on('message', (message: LoadMessage) => {
          if (message.type === 'ready') {
            clearTimeout(timer);
            resolve(message.url);
          }
        });
      });
      expect(new URL(url).hostname).toBe('127.0.0.1');
      for (let i = 0; i < 2; i++) {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
      }
      stopTimeout = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.send('stop');
      expect(await exited).toEqual({ code: 0, signal: null });
      expect(stderr).toBe('');
    } finally {
      clearTimeout(stopTimeout);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  });
});
