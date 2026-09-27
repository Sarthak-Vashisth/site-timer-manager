const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  let now = new Date(2026, 8, 27, 12).getTime();
  const local = {};
  const sync = { limitMinutes: 30 };
  const alarms = new Map();
  const removed = [];
  const event = () => ({ addListener(fn) { this.listener = fn; } });
  const area = (data) => ({
    async get() { return structuredClone(data); },
    async set(values) { Object.assign(data, structuredClone(values)); }
  });
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const chrome = {
    runtime: { onInstalled: event(), onMessage: event() },
    storage: { sync: area(sync), local: area(local), onChanged: event() },
    tabs: {
      onUpdated: event(), onActivated: event(), onRemoved: event(),
      async sendMessage() {}, async remove(id) { removed.push(id); }
    },
    alarms: {
      onAlarm: event(),
      async clear(name) { alarms.delete(name); },
      create(name, info) { alarms.set(name, info); }
    }
  };
  const ctx = vm.createContext({ chrome, Date: Clock, URL });
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), ctx);
  return { ctx, local, chrome, alarms, removed,
    advance(minutes) { now += minutes * 60000; },
    session(id = 1) { return local.watchLimitSessions[String(id)]; },
    start(id = 1, resume = false) { return ctx.trackTab(id, 'https://www.youtube.com/watch?v=test', { resume }); },
    pause(id = 1) { return ctx.updateSessions(() => ctx.stopTimerForTab(id)); }
  };
}

test('excluded time is paused, then resumes the original remaining budget', async () => {
  const h = setup();
  await h.start();
  h.advance(5);
  await h.pause();
  assert.equal(h.session().remainingMs, 25 * 60000);
  assert.equal(h.alarms.size, 0);
  h.advance(40);
  await h.start(); // A passive tab update must not resume an excluded page.
  await h.pause(); // Repeated exclusion messages must not reduce the budget.
  assert.equal(h.session().paused, true);
  assert.equal((await h.ctx.getTodaysWatchtime()).sites['youtube.com'].totalMs, 5 * 60000);
  await h.start(1, true);
  assert.equal(h.session().endsAt - h.session().startedAt, 25 * 60000);
  h.advance(2);
  await h.pause();
  assert.equal(h.session().remainingMs, 23 * 60000);
  assert.equal((await h.ctx.getTodaysWatchtime()).sites['youtube.com'].totalMs, 7 * 60000);
});

test('shared tabs preserve one budget and count watchtime once', async () => {
  const h = setup();
  await Promise.all([h.start(1), h.start(2)]);
  h.advance(5);
  await h.pause(1);
  h.advance(3);
  await h.pause(2);
  assert.equal(h.session(1).remainingMs, 22 * 60000);
  assert.equal(h.session(2).remainingMs, 22 * 60000);
  h.advance(10);
  await h.start(1, true);
  h.advance(2);
  await h.start(2, true);
  assert.equal(h.session(1).endsAt, h.session(2).endsAt);
  assert.equal((await h.ctx.getTodaysWatchtime()).sites['youtube.com'].totalMs, 10 * 60000);
});

test('queued alarms do not close a paused or newly resumed tab', async () => {
  const h = setup();
  await h.start();
  h.advance(5);
  await h.pause();
  await h.chrome.alarms.onAlarm.listener({ name: 'close-tab-1' });
  h.advance(40);
  await h.start(1, true);
  await h.chrome.alarms.onAlarm.listener({ name: 'close-tab-1' });
  assert.equal(h.removed.length, 0);
  h.advance(25);
  await h.chrome.alarms.onAlarm.listener({ name: 'close-tab-1' });
  assert.deepEqual(h.removed, [1]);
});

test('closing the last active tab updates the paused tab budget', async () => {
  const h = setup();
  await h.start(1);
  await h.start(2);
  h.advance(5);
  await h.pause(1);
  h.advance(3);
  await h.chrome.tabs.onRemoved.listener(2);
  assert.equal(h.session(1).remainingMs, 22 * 60000);
  await h.start(1, true);
  assert.equal(h.session(1).endsAt - h.session(1).startedAt, 22 * 60000);
});
