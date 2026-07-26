import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureProfileFixture } from './captureFixture';

const TRIALS = Math.max(1, Number(process.env.CAPTURE_BROWSER_TRIALS) || 15);

const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1]!;
};

test(`production capture profile (${TRIALS} trials)`, async ({ page }) => {
  await page.route('**/sw.js', (route) => route.abort());
  await page.goto('/?captureProfile=1#/capture');
  const bytes = captureProfileFixture();
  const trials: Array<Record<string, unknown>> = [];

  for (let trial = 0; trial < TRIALS; trial++) {
    const events = page.evaluate(async () => {
      const longTasks: Array<{ startTime: number; duration: number }> = [];
      const observer = new PerformanceObserver((entries) => {
        longTasks.push(
          ...entries.getEntries().map((entry) => ({
            startTime: entry.startTime,
            duration: entry.duration,
          })),
        );
      });
      observer.observe({ type: 'longtask', buffered: false });
      const [worker, marks] = await Promise.all([
        new Promise<unknown>((resolveEvent) =>
          window.addEventListener('capture-profile:worker', (event) =>
            resolveEvent((event as CustomEvent).detail), { once: true }),
        ),
        new Promise<Record<string, number>>((resolveEvent) =>
          window.addEventListener('capture-profile:render', (event) =>
            resolveEvent((event as CustomEvent<Record<string, number>>).detail), { once: true }),
        ),
      ]);
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
      longTasks.push(
        ...observer.takeRecords().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })),
      );
      observer.disconnect();
      const profile = worker as { responseDispatchMilliseconds: number };
      const responseAt = marks['capture-profile:response-received']!;
      const stateAt = marks['capture-profile:state-updated']!;
      const renderAt = marks['capture-profile:first-useful-render']!;
      const responseStartedAt = responseAt - profile.responseDispatchMilliseconds;
      const overlaps = (start: number, end: number, intervalStart: number, intervalEnd: number) =>
        start < intervalEnd && end > intervalStart;
      const tasks = longTasks.map((task) => {
        const endTime = task.startTime + task.duration;
        return {
          ...task,
          endTime,
          overlaps: {
            responseDispatch: overlaps(task.startTime, endTime, responseStartedAt, responseAt),
            stateUpdate: overlaps(task.startTime, endTime, responseAt, stateAt),
            render: overlaps(task.startTime, endTime, stateAt, renderAt),
          },
        };
      });
      return {
        worker,
        marks,
        longTasks: {
          count: tasks.length,
          maxMilliseconds: Math.max(0, ...tasks.map((task) => task.duration)),
          totalMilliseconds: tasks.reduce((total, task) => total + task.duration, 0),
          tasks,
        },
      };
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: 'capture-profile.pcap',
      mimeType: 'application/vnd.tcpdump.pcap',
      buffer: Buffer.from(bytes),
    });
    const { worker, marks, longTasks } = await events;
    await expect(page.getByText(/2000 packets · classic pcap/)).toBeVisible();
    const start = marks['capture-profile:start']!;
    trials.push({
      trial: trial + 1,
      worker,
      marks,
      longTasks,
      endToEndWorkerMilliseconds: marks['capture-profile:response-received']! - start,
      firstUsefulRenderMilliseconds: marks['capture-profile:first-useful-render']! - start,
    });
    if (trial + 1 < TRIALS) await page.getByRole('button', { name: 'Close capture' }).click();
  }

  const endToEnd = trials.map((trial) => trial.endToEndWorkerMilliseconds as number);
  const render = trials.map((trial) => trial.firstUsefulRenderMilliseconds as number);
  const longTaskCounts = trials.map(
    (trial) => (trial.longTasks as { count: number }).count,
  );
  const longTaskMax = trials.map(
    (trial) => (trial.longTasks as { maxMilliseconds: number }).maxMilliseconds,
  );
  const longTaskTotal = trials.map(
    (trial) => (trial.longTasks as { totalMilliseconds: number }).totalMilliseconds,
  );
  const report = {
    packetCount: 2_000,
    trials,
    summary: {
      endToEndWorkerMilliseconds: { median: percentile(endToEnd, 0.5), p95: percentile(endToEnd, 0.95) },
      firstUsefulRenderMilliseconds: { median: percentile(render, 0.5), p95: percentile(render, 0.95) },
      longTasks: {
        count: { median: percentile(longTaskCounts, 0.5), p95: percentile(longTaskCounts, 0.95) },
        maxMilliseconds: { median: percentile(longTaskMax, 0.5), p95: percentile(longTaskMax, 0.95) },
        totalMilliseconds: { median: percentile(longTaskTotal, 0.5), p95: percentile(longTaskTotal, 0.95) },
      },
    },
  };
  mkdirSync(resolve('test-results'), { recursive: true });
  writeFileSync(resolve('test-results/capture-profile.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  expect(trials).toHaveLength(TRIALS);
});
