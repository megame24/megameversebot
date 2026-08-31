/**
 * Assertions over the scheduling arithmetic. No network, no credentials.
 *
 *   npm run check
 *
 * Not a test framework — just enough to catch the jitter maths drifting.
 */

import { formatMinutes, MIN_INTERVAL_MS, nextIntervalMs, pollIntervalMs } from './schedule.ts';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures += 1;
  }
}

console.log('\nSchedule arithmetic\n');

// Zero jitter must be exact — this is what --jitter=0 relies on when testing.
const exact = nextIntervalMs({ intervalMinutes: 30, jitterMinutes: 0 });
check('zero jitter returns the interval exactly', exact === 30 * 60_000, `got ${exact}`);

// random() = 0.5 is the midpoint, so jitter cancels out.
const midpoint = nextIntervalMs({ intervalMinutes: 30, jitterMinutes: 2 }, () => 0.5);
check('jitter centres on the interval', midpoint === 30 * 60_000, `got ${midpoint}`);

const low = nextIntervalMs({ intervalMinutes: 30, jitterMinutes: 2 }, () => 0);
const high = nextIntervalMs({ intervalMinutes: 30, jitterMinutes: 2 }, () => 1);
check('lower bound is interval − jitter', low === 28 * 60_000, `got ${formatMinutes(low)}`);
check('upper bound is interval + jitter', high === 32 * 60_000, `got ${formatMinutes(high)}`);

// Jitter larger than the interval must not produce a zero or negative gap.
const clamped = nextIntervalMs({ intervalMinutes: 1, jitterMinutes: 10 }, () => 0);
check('clamps to the floor when jitter exceeds interval', clamped === MIN_INTERVAL_MS, `got ${clamped}`);

// 1000 random draws must all stay inside the band and above the floor.
let outOfBand = 0;
for (let i = 0; i < 1000; i += 1) {
  const value = nextIntervalMs({ intervalMinutes: 30, jitterMinutes: 2 });
  if (value < 28 * 60_000 || value > 32 * 60_000) outOfBand += 1;
}
check('1000 draws stay within ±jitter', outOfBand === 0, `${outOfBand} outside`);

console.log('\nPoll interval\n');

check('30m interval polls every 60s', pollIntervalMs({ intervalMinutes: 30 }) === 60_000);
check('1m interval polls every 15s', pollIntervalMs({ intervalMinutes: 1 }) === 15_000);
check(
  'very short interval still respects the 5s floor',
  pollIntervalMs({ intervalMinutes: 0.1 }) === 5_000,
);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
