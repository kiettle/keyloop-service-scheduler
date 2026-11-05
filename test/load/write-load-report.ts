import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { postgresState } from '../../src/appointments/database-error';

interface VerificationResult {
  passed: boolean;
  invariants: unknown;
  queryPlans: Record<string, unknown>;
}

interface VerificationStatus {
  status: 'incomplete' | 'complete' | 'failed';
  error?: { type: string; sqlstate?: string };
}

export async function writeLoadReport(
  destination: string,
  measurements: Record<string, unknown>,
  verify: () => Promise<VerificationResult>,
) {
  const report = {
    ...measurements,
    passed: false,
    verification: { status: 'incomplete' } as VerificationStatus,
    invariants: null as unknown,
    queryPlans: {} as Record<string, unknown>,
  };
  await mkdir(dirname(destination), { recursive: true });
  // Save measurements before SQL checks, so their failure cannot discard k6 evidence.
  await writeFile(destination, JSON.stringify(report, null, 2));
  try {
    Object.assign(report, await verify());
    report.verification = { status: 'complete' };
  } catch (error) {
    report.passed = false;
    report.verification = {
      status: 'failed',
      error: {
        type: error instanceof Error ? error.name : 'UnknownError',
        sqlstate: postgresState(error),
      },
    };
  }
  await writeFile(destination, JSON.stringify(report, null, 2));
  return report;
}
