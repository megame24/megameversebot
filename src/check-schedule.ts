/**
 * Assertions over the scheduling arithmetic. No network, no credentials.
 *
 *   npm run check
 *
 * Not a test framework — just enough to catch the jitter maths drifting.
 */

import {
  formatMinutes,
  MIN_INTERVAL_MS,
  nextIntervalMs,
  nextPost,
  pollIntervalMs,
} from './schedule.ts';

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

console.log('\nOpening verse\n');

const MIN = 60_000;
const wentLive = Date.parse('2026-09-28T19:00:00Z');
const stream = { id: 'broadcast-1', startedAt: wentLive };
const timing = { intervalMs: 30 * MIN, openingVerseMinutes: 5 };

// Last post hours ago, so the interval is long overdue — the opener must still wait.
const overdue = nextPost({
  ...timing,
  stream,
  openedStreamId: null,
  lastPostAt: wentLive - 3 * 60 * MIN,
});
check(
  'new stream opens 5m after going live, even with the interval overdue',
  overdue.isOpening && overdue.at === wentLive + 5 * MIN,
  `got ${JSON.stringify(overdue)}`,
);

// Last post a moment ago — the opener must not be pushed back by the interval.
const recent = nextPost({
  ...timing,
  stream,
  openedStreamId: null,
  lastPostAt: wentLive + 4 * MIN,
});
check(
  'new stream opens 5m after going live, even with the interval not yet elapsed',
  recent.isOpening && recent.at === wentLive + 5 * MIN,
  `got ${JSON.stringify(recent)}`,
);

const opened = nextPost({
  ...timing,
  stream,
  openedStreamId: 'broadcast-1',
  lastPostAt: wentLive + 5 * MIN,
});
check(
  'once opened, the interval takes over from the opening verse',
  !opened.isOpening && opened.at === wentLive + 35 * MIN,
  `got ${JSON.stringify(opened)}`,
);

const nextBroadcast = nextPost({
  ...timing,
  stream: { id: 'broadcast-2', startedAt: wentLive + 24 * 60 * MIN },
  openedStreamId: 'broadcast-1',
  lastPostAt: wentLive + 2 * 60 * MIN,
});
check(
  'the next broadcast gets its own opening verse',
  nextBroadcast.isOpening && nextBroadcast.at === wentLive + 24 * 60 * MIN + 5 * MIN,
  `got ${JSON.stringify(nextBroadcast)}`,
);

const ungated = nextPost({ ...timing, stream: null, openedStreamId: null, lastPostAt: wentLive });
check(
  'without live-gating there is no opener, only the interval',
  !ungated.isOpening && ungated.at === wentLive + 30 * MIN,
  `got ${JSON.stringify(ungated)}`,
);

console.log('\nPoll interval\n');

check('30m interval polls every 60s', pollIntervalMs({ intervalMinutes: 30 }) === 60_000);
check('1m interval polls every 15s', pollIntervalMs({ intervalMinutes: 1 }) === 15_000);
check(
  'very short interval still respects the 5s floor',
  pollIntervalMs({ intervalMinutes: 0.1 }) === 5_000,
);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
