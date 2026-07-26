import { describe, expect, it, vi } from 'vitest';
import { measureCapturePhase, withCaptureProfile } from './captureProfile';

describe('capture profiler', () => {
  it('aggregates invocation counts and exclusive nested timing', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const { result, profile } = withCaptureProfile(() =>
      measureCapturePhase('decode', () => {
        now += 3;
        measureCapturePhase('serialize', () => {
          now += 5;
          measureCapturePhase('checksums', () => {
            now += 2;
          });
          now += 1;
        });
        measureCapturePhase('serialize', () => {
          now += 4;
        });
        now += 2;
        return 42;
      }),
    );

    expect(result).toBe(42);
    expect(profile.totalMilliseconds).toBe(17);
    expect(profile.phases.decode).toEqual({ milliseconds: 5, invocations: 1 });
    expect(profile.phases.serialize).toEqual({ milliseconds: 10, invocations: 2 });
    expect(profile.phases.checksums).toEqual({ milliseconds: 2, invocations: 1 });
  });

  it('is inactive outside a session and clears state after success and failure', () => {
    expect(measureCapturePhase('search', () => 'plain')).toBe('plain');
    expect(withCaptureProfile(() => 'first').result).toBe('first');
    expect(() =>
      withCaptureProfile(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(withCaptureProfile(() => 'after').result).toBe('after');
  });

  it('clears a measured frame when its callback throws', () => {
    expect(() =>
      withCaptureProfile(() => measureCapturePhase('container', () => { throw new Error('bad'); })),
    ).toThrow('bad');
    expect(withCaptureProfile(() => 1).result).toBe(1);
  });
});
