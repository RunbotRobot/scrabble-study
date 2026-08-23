import { getSyncId, generateSyncId, isValidSyncId, setSyncId, forgetSyncId, onStatusChange } from './sync.js';

// Only ever shows something for a genuine, ongoing problem — not
// "Syncing…"/"Synced 3s ago" churn on every routine round trip, which is
// just noise once sync is working.
function statusLine(status) {
  return status.state === 'error' ? `Sync error (will retry): ${status.lastError}` : '';
}

export function initSyncUI(container) {
  function render() {
    const syncId = getSyncId();
    if (!syncId) {
      container.innerHTML = `
        <p class="sync-blurb">
          Back this device's progress up to the cloud, and/or pull existing progress down onto a
          new device. This app has no accounts — a random code is the key. Save it somewhere
          you'll have it if you lose this device.
        </p>
        <div class="sync-actions">
          <button id="sync-new-btn">Start cloud sync</button>
        </div>
        <details class="sync-existing">
          <summary>I already have a sync code</summary>
          <form id="sync-existing-form">
            <input id="sync-existing-input" type="text" placeholder="paste your sync code" autocapitalize="off" autocorrect="off" spellcheck="false" />
            <button type="submit">Connect</button>
          </form>
          <p id="sync-existing-error" class="sync-error"></p>
        </details>
      `;
      document.getElementById('sync-new-btn').addEventListener('click', async () => {
        const id = generateSyncId();
        await setSyncId(id);
        render();
      });
      document.getElementById('sync-existing-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('sync-existing-input');
        const errorEl = document.getElementById('sync-existing-error');
        const id = input.value.trim();
        if (!isValidSyncId(id)) {
          errorEl.textContent = 'That doesn’t look like a valid sync code.';
          return;
        }
        errorEl.textContent = '';
        await setSyncId(id);
        render();
      });
      return;
    }

    container.innerHTML = `
      <div class="sync-code-row">
        <code id="sync-code">${syncId}</code>
        <button id="sync-copy-btn" class="secondary">Copy</button>
      </div>
      <p id="sync-status" class="sync-status"></p>
      <button id="sync-forget-btn" class="secondary">Forget on this device</button>
    `;
    document.getElementById('sync-copy-btn').addEventListener('click', async () => {
      await navigator.clipboard.writeText(syncId);
      const btn = document.getElementById('sync-copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    });
    document.getElementById('sync-forget-btn').addEventListener('click', () => {
      if (!confirm('Forget this sync code on this device? Your cloud data is untouched — reconnect with the same code to pick it back up.')) return;
      forgetSyncId();
      render();
    });

    const statusEl = document.getElementById('sync-status');
    if (statusEl) statusEl.textContent = statusLine(latestStatus);
  }

  let latestStatus = { state: 'idle', lastSyncAt: null, lastError: null };
  onStatusChange((status) => {
    latestStatus = status;
    const el = document.getElementById('sync-status');
    if (el) el.textContent = statusLine(status);
  });

  render();
}
