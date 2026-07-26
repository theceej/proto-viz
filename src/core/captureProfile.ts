export const CAPTURE_PHASES = [
  'container',
  'decode',
  'stack',
  'serialize',
  'checksums',
  'identity',
  'search',
] as const;

export type CapturePhase = (typeof CAPTURE_PHASES)[number];

export interface CapturePhaseProfile {
  milliseconds: number;
  invocations: number;
}

export interface CaptureProfile {
  totalMilliseconds: number;
  phases: Record<CapturePhase, CapturePhaseProfile>;
}

interface Frame {
  started: number;
  childMilliseconds: number;
}

interface Session {
  started: number;
  frames: Frame[];
  phases: CaptureProfile['phases'];
}

let active: Session | null = null;

export function isCaptureProfileActive(): boolean {
  return active !== null;
}

const emptyPhases = (): CaptureProfile['phases'] =>
  Object.fromEntries(
    CAPTURE_PHASES.map((phase) => [phase, { milliseconds: 0, invocations: 0 }]),
  ) as CaptureProfile['phases'];

/** Run one synchronous capture operation with exclusive nested phase timing. */
export function withCaptureProfile<T>(run: () => T): { result: T; profile: CaptureProfile } {
  if (active) throw new Error('capture profiling is already active');
  const session: Session = { started: performance.now(), frames: [], phases: emptyPhases() };
  active = session;
  try {
    const result = run();
    return {
      result,
      profile: {
        totalMilliseconds: performance.now() - session.started,
        phases: session.phases,
      },
    };
  } finally {
    active = null;
  }
}

/** Time a synchronous phase when profiling is active; otherwise call it directly. */
export function measureCapturePhase<T>(phase: CapturePhase, run: () => T): T {
  const session = active;
  if (!session) return run();

  const frame: Frame = { started: performance.now(), childMilliseconds: 0 };
  session.frames.push(frame);
  try {
    return run();
  } finally {
    const elapsed = performance.now() - frame.started;
    session.frames.pop();
    const aggregate = session.phases[phase];
    aggregate.milliseconds += elapsed - frame.childMilliseconds;
    aggregate.invocations += 1;
    const parent = session.frames[session.frames.length - 1];
    if (parent) parent.childMilliseconds += elapsed;
  }
}
