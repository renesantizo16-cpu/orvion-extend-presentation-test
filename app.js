'use strict';

const stage = document.querySelector('#stage');
const desktop = document.querySelector('#desktop');
const overlay = document.querySelector('#overlay');
const diagnostics = document.querySelector('#diagnostics');
const connect = document.querySelector('#connect');
const exit = document.querySelector('#exit');
const details = document.querySelector('#details');
const reveal = document.querySelector('#reveal');
const status = document.querySelector('#status');
let hideTimer;
let active = false;
let wakeLock = null;
let wakePending = false;
let wakeResult = 'Not requested';
let orientationResult = 'Not requested';
let fullscreenResult = 'Not requested';
let attempt = 0;
let keyboardInteraction = false;

document.addEventListener('keydown', () => { keyboardInteraction = true; });
document.addEventListener('pointerdown', () => { keyboardInteraction = false; });

function errorText(error) {
  return `${error?.name || 'Error'}: ${error?.message || String(error)}`;
}

function updateDiagnostics() {
  const viewport = window.visualViewport;
  const rect = desktop.getBoundingClientRect();
  const styles = getComputedStyle(overlay);
  const modes = ['fullscreen', 'standalone', 'minimal-ui', 'browser']
    .filter(mode => matchMedia(`(display-mode: ${mode})`).matches);
  diagnostics.textContent = [
    `Secure context: ${window.isSecureContext}`,
    `Viewport: ${innerWidth} × ${innerHeight} CSS px; DPR ${devicePixelRatio}`,
    `Visual viewport: ${viewport ? `${viewport.width.toFixed(1)} × ${viewport.height.toFixed(1)}; scale ${viewport.scale}` : 'unavailable'}`,
    `Screen: ${screen.width} × ${screen.height}; available ${screen.availWidth} × ${screen.availHeight}`,
    `Desktop: ${rect.width.toFixed(1)} × ${rect.height.toFixed(1)}; ratio ${(rect.width / rect.height).toFixed(4)}`,
    `Display mode: ${modes.join(', ') || 'unknown'}; Apple standalone: ${navigator.standalone === true}`,
    `Fullscreen supported/enabled: ${typeof stage.requestFullscreen === 'function'} / ${document.fullscreenEnabled === true}`,
    `Fullscreen element: ${document.fullscreenElement?.id || 'none'}; result: ${fullscreenResult}`,
    `Orientation: ${screen.orientation?.type || 'unavailable'}; angle ${screen.orientation?.angle ?? window.orientation ?? 'unavailable'}`,
    `Landscape lock API: ${typeof screen.orientation?.lock === 'function'}; result: ${orientationResult}`,
    `Wake lock API: ${'wakeLock' in navigator}; held: ${Boolean(wakeLock && !wakeLock.released)}; result: ${wakeResult}`,
    `Visibility: ${document.visibilityState}; presentation active: ${active}`,
    `Control padding T/R/B/L: ${styles.paddingTop} / ${styles.paddingRight} / ${styles.paddingBottom} / ${styles.paddingLeft}`,
    'System indicators cannot be detected reliably by this page. Inspect visually.',
    'No capture, media stream, server connection, storage or service worker.'
  ].join('\n');
}

function scheduleHide() {
  clearTimeout(hideTimer);
  if (!active || !diagnostics.hidden) return;
  hideTimer = setTimeout(() => {
    // Keep keyboard users on a reachable control when hiding the panel.
    if (overlay.contains(document.activeElement)) {
      if (keyboardInteraction) reveal.focus({ preventScroll: true });
      else document.activeElement.blur();
    }
    overlay.classList.add('is-hidden');
    overlay.inert = true;
  }, 3000);
}

function showControls() {
  overlay.classList.remove('is-hidden');
  overlay.inert = false;
  updateDiagnostics();
  scheduleHide();
}

async function acquireWakeLock() {
  if (!active || document.visibilityState !== 'visible' || wakeLock || wakePending) return;
  if (!('wakeLock' in navigator)) {
    wakeResult = 'Unsupported';
    updateDiagnostics();
    return;
  }
  wakePending = true;
  try {
    const candidate = await navigator.wakeLock.request('screen');
    if (!active || document.visibilityState !== 'visible') {
      await candidate.release();
      wakeResult = 'Released: presentation inactive or hidden';
    } else {
      wakeLock = candidate;
      wakeResult = 'Acquired (OS may release it)';
      candidate.addEventListener('release', () => {
        if (wakeLock === candidate) wakeLock = null;
        wakeResult = 'Released by browser, OS or Exit';
        updateDiagnostics();
      });
    }
  } catch (error) {
    wakeResult = errorText(error);
  } finally {
    wakePending = false;
    updateDiagnostics();
  }
}

async function releaseWakeLock() {
  const candidate = wakeLock;
  wakeLock = null;
  if (candidate && !candidate.released) {
    try { await candidate.release(); }
    catch (error) { wakeResult = errorText(error); }
  }
  updateDiagnostics();
}

connect.addEventListener('click', async () => {
  const current = ++attempt;
  active = true;
  connect.textContent = 'Retry fullscreen / wake';
  showControls();
  // Invoke directly in the click handler, before awaiting another API.
  let fullscreenRequest;
  try {
    if (document.fullscreenElement === stage) fullscreenResult = 'Already fullscreen';
    else if (typeof stage.requestFullscreen === 'function') {
      fullscreenResult = 'Requested';
      fullscreenRequest = stage.requestFullscreen();
    } else fullscreenResult = 'Unsupported; standalone layout retained';
  } catch (error) { fullscreenResult = errorText(error); }
  void acquireWakeLock();
  try {
    if (fullscreenRequest) {
      await fullscreenRequest;
      fullscreenResult = 'Entered';
    }
  } catch (error) { fullscreenResult = errorText(error); }
  if (current !== attempt || !active) return;
  try {
    if (typeof screen.orientation?.lock === 'function') {
      await screen.orientation.lock('landscape');
      orientationResult = 'Landscape lock accepted';
    } else orientationResult = 'Unsupported; rotate device manually';
  } catch (error) { orientationResult = errorText(error); }
  if (current !== attempt || !active) {
    try { screen.orientation?.unlock?.(); } catch (_) { /* Best effort only. */ }
    return;
  }
  status.textContent = `Simulation active. Fullscreen: ${fullscreenResult}. Landscape: ${orientationResult}.`;
  updateDiagnostics();
  scheduleHide();
});

exit.addEventListener('click', async () => {
  ++attempt;
  active = false;
  clearTimeout(hideTimer);
  try { screen.orientation?.unlock?.(); }
  catch (error) { orientationResult = errorText(error); }
  await releaseWakeLock();
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch (error) { fullscreenResult = errorText(error); }
  connect.textContent = 'Connect';
  status.textContent = 'Presentation stopped. No network connection was made.';
  showControls();
});

details.addEventListener('click', () => {
  diagnostics.hidden = !diagnostics.hidden;
  details.setAttribute('aria-expanded', String(!diagnostics.hidden));
  showControls();
});
reveal.addEventListener('click', showControls);
stage.addEventListener('click', event => {
  if (!event.target.closest('.controls, #reveal')) showControls();
});
overlay.addEventListener('pointerdown', () => clearTimeout(hideTimer));
overlay.addEventListener('pointerup', scheduleHide);
overlay.addEventListener('keydown', scheduleHide);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && active) {
    status.textContent = 'Fullscreen exited. Standalone layout retained; tap Connect to retry.';
    showControls();
  }
  updateDiagnostics();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void acquireWakeLock();
    showControls();
  } else void releaseWakeLock();
  updateDiagnostics();
});
window.addEventListener('pagehide', () => {
  ++attempt;
  active = false;
  void releaseWakeLock();
});
window.addEventListener('pageshow', showControls);
window.addEventListener('resize', updateDiagnostics);
window.visualViewport?.addEventListener('resize', updateDiagnostics);
screen.orientation?.addEventListener('change', updateDiagnostics);
window.addEventListener('orientationchange', updateDiagnostics);
setInterval(() => { if (!diagnostics.hidden) updateDiagnostics(); }, 1000);
updateDiagnostics();
