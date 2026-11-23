const pendingKey = 'focus-tracker-pending-run';
const notifiedKey = 'focus-tracker-notified';
const runAlarm = 'focus-run-end';

function notifyOnce(token, title, message) {
  chrome.storage.local.get(notifiedKey, (data) => {
    const seen = data[notifiedKey] && typeof data[notifiedKey] === 'object' ? data[notifiedKey] : {};
    if (seen[token]) return;
    const next = { [token]: Date.now() };
    for (const [key, when] of Object.entries(seen)) {
      if (Date.now() - Number(when) < 24 * 60 * 60 * 1000 && Object.keys(next).length < 30) next[key] = when;
    }
    chrome.storage.local.set({ [notifiedKey]: next });
    chrome.notifications.create(`focus-${token}`.slice(0, 480), {
      type: 'basic',
      iconUrl: 'icon128.png',
      title,
      message,
      priority: 2,
    });
  });
}

function runLimit(run) {
  return run.mode === 'timer' ? Math.max(1, Number(run.total) || 0) : 240 * 60;
}

function schedule(run) {
  chrome.alarms.clear(runAlarm);
  if (!run || run.tombstone || !run.runStarted || run.finished) return;
  const elapsed = Number(run.base || 0) + Math.floor((Date.now() - Number(run.runStarted)) / 1000);
  const remain = runLimit(run) - elapsed;
  if (run.mode !== 'timer' && run.mode !== 'stopwatch') return;
  if (remain <= 0) {
    finish(run);
    return;
  }
  chrome.alarms.create(runAlarm, { when: Date.now() + remain * 1000 });
}

const finishing = new Set();

function markFinished(run, limit, chimePlayed, done) {
  chrome.storage.local.get(pendingKey, (data) => {
    const current = data[pendingKey];
    if (!current || current.tombstone || current.finished || !current.runStarted) {
      if (done) done();
      return;
    }
    if ((current.startedAt || current.runStarted) !== (run.startedAt || run.runStarted)) {
      if (done) done();
      return;
    }
    chrome.storage.local.set({
      [pendingKey]: {
        ...current,
        runStarted: 0,
        base: limit,
        elapsed: limit,
        finished: true,
        chimePlayed: Boolean(chimePlayed),
        savedAt: Date.now(),
      },
    }, () => done && done());
  });
}

async function playBell() {
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  } catch {}
  return new Promise((resolve) => {
    let settled = false;
    const finish = (played) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve(played);
    };
    const onMessage = (message) => {
      if (!message) return;
      if (message.type === 'focus-bell-started') finish(true);
      else if (message.type === 'focus-bell-done') finish(message.played === true);
    };
    const timer = setTimeout(() => {
      chrome.offscreen.closeDocument().catch(() => {});
      finish(false);
    }, 4000);
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play the bell when a countdown ends',
    }).catch(() => finish(false));
  });
}

async function openMini() {
  try {
    await chrome.action.openPopup();
    return;
  } catch (error) {
    const message = String(error && error.message ? error.message : error || '');
    if (/already open/i.test(message)) return;
  }
  try {
    await chrome.windows.create({
      url: chrome.runtime.getURL('index.html?mini=1#/'),
      type: 'popup',
      width: 520,
      height: 640,
      focused: true,
    });
  } catch {}
}

async function presentMiniCountdown(run, limit) {
  let popupOpen = false;
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['POPUP'] });
    popupOpen = Array.isArray(contexts) && contexts.length > 0;
  } catch {}
  const chimed = run.mini && !popupOpen ? await playBell() : false;
  await new Promise((resolve) => {
    markFinished(run, limit, chimed, () => {
      if (!(run.mini && !popupOpen)) {
        resolve();
        return;
      }
      openMini().then(resolve, resolve);
    });
  });
}

function finish(run) {
  if (!run || run.tombstone || !run.runStarted || run.finished) return;
  const limit = runLimit(run);
  const category = run.categoryName ? ` · ${run.categoryName}` : '';
  if (run.mode === 'timer') {
    const token = String(run.startedAt || run.runStarted);
    if (finishing.has(token)) return;
    finishing.add(token);
    notifyOnce(`countdown-${token}`, "Time's up — keep going?", `${formatDuration(limit)} · Countdown${category}`);
    void presentMiniCountdown(run, limit).finally(() => finishing.delete(token));
    return;
  }
  if (run.mode !== 'stopwatch') return;
  notifyOnce(`stopwatch-${run.startedAt || run.runStarted}`, 'Stopwatch hit 4 hours', `${formatDuration(limit)} · Stopwatch${category}`);
  markFinished(run, limit, false);
}

function formatDuration(total) {
  const safe = Math.max(0, Math.floor(Number(total) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function readAndSchedule() {
  chrome.storage.local.get(pendingKey, (data) => schedule(data[pendingKey] || null));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[pendingKey]) return;
  schedule(changes[pendingKey].newValue || null);
});

chrome.runtime.onInstalled.addListener(readAndSchedule);
chrome.runtime.onStartup.addListener(readAndSchedule);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== runAlarm) return;
  chrome.storage.local.get(pendingKey, (data) => finish(data[pendingKey] || null));
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'focus-bell-done') {
    chrome.offscreen.closeDocument().catch(() => {});
    return;
  }
  if (!message || message.type !== 'focus-notify') return;
  if (!message.title || !message.body) return;
  notifyOnce(String(message.token || message.title), String(message.title), String(message.body));
});

chrome.notifications.onClicked.addListener(() => {
  const full = chrome.runtime.getURL('index.html#/');
  chrome.tabs.query({ url: chrome.runtime.getURL('index.html*') }, (tabs) => {
    const open = (tabs || []).find((tab) => tab.url && !tab.url.includes('mini=1'));
    if (open && open.id != null) {
      chrome.tabs.update(open.id, { active: true });
      if (open.windowId != null) chrome.windows.update(open.windowId, { focused: true });
      return;
    }
    chrome.tabs.create({ url: full });
  });
});
