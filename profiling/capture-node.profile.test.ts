import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../src/protocols';
import { openCaptureFile } from '../src/core/capture';
import {
  CAPTURE_PHASES,
  withCaptureProfile,
  type CapturePhase,
  type CaptureProfile,
} from '../src/core/captureProfile';
import { captureProfileFixture } from './captureFixture';

const WARMUPS = 5;
const SAMPLES = Math.max(30, Number(process.env.CAPTURE_PROFILE_SAMPLES) || 30);

const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1]!;
};

const stats = (values: number[]) => ({
  median: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  min: Math.min(...values),
  max: Math.max(...values),
});

describe('Node capture profile', () => {
  it(`reports ${SAMPLES} samples for the 2,000-packet TCP/DNS mix`, () => {
    const bytes = captureProfileFixture();
    const registry = createBuiltinRegistry();
    const run = () => openCaptureFile(bytes, registry, 'capture-profile.pcap');
    for (let i = 0; i < WARMUPS; i++) run();

    const profiles: CaptureProfile[] = [];
    for (let i = 0; i < SAMPLES; i++) profiles.push(withCaptureProfile(run).profile);
    const rows = [...CAPTURE_PHASES, 'total' as const].map((phase) => {
      const values = profiles.map((profile) =>
        phase === 'total' ? profile.totalMilliseconds : profile.phases[phase].milliseconds,
      );
      const invocations =
        phase === 'total'
          ? 1
          : profiles[0]!.phases[phase as CapturePhase].invocations;
      return { phase, ...stats(values), invocations };
    });

    console.log('\nCapture profile (milliseconds per 2,000 packets)');
    console.table(rows);
    expect(run().packets).toHaveLength(2_000);
  }, 120_000);
});
