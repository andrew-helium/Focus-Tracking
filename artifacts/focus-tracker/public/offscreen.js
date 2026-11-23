function notify(type, played) {
  try {
    chrome.runtime.sendMessage({ type, played: Boolean(played) });
  } catch {}
}

function ring(context) {
  const start = context.currentTime;
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
  master.gain.exponentialRampToValueAtTime(0.0001, start + 1.45);
  master.connect(context.destination);
  for (const [frequency, level] of [[880, 1], [1320, 0.55], [1760, 0.25]]) {
    const oscillator = context.createOscillator();
    const partial = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    partial.gain.setValueAtTime(level, start);
    oscillator.connect(partial);
    partial.connect(master);
    oscillator.start(start);
    oscillator.stop(start + 1.5);
  }
}

try {
  const context = new AudioContext();
  const start = () => {
    try {
      ring(context);
    } catch {
      notify('focus-bell-done', false);
      return;
    }
    notify('focus-bell-started', true);
    setTimeout(() => notify('focus-bell-done', true), 1700);
  };
  if (context.state === 'running') start();
  else context.resume().then(start).catch(() => notify('focus-bell-done', false));
} catch {
  notify('focus-bell-done', false);
}
