import { queueWord, getPendingWords } from './store.js';
import { scheduleSync } from './sync.js';

export function initQueueUI(container) {
  let formOpen = false;
  let message = '';
  let messageIsError = false;

  function render() {
    const pending = getPendingWords();
    container.innerHTML = `
      <div class="queue-actions">
        <button id="queue-add-btn" class="secondary" ${formOpen ? 'hidden' : ''}>Add word</button>
      </div>
      <form id="queue-form" class="queue-form" ${formOpen ? '' : 'hidden'}>
        <input id="queue-input" type="text" placeholder="a Scrabble word" autocapitalize="off" autocorrect="off" spellcheck="false" />
        <button type="submit">Queue it</button>
      </form>
      <p id="queue-message" class="queue-message${messageIsError ? ' queue-error' : ''}">${message}</p>
      ${
        pending.length > 0
          ? `<ul class="queue-list">${pending.map((p) => `<li>${p.word}</li>`).join('')}</ul>`
          : ''
      }
    `;

    document.getElementById('queue-add-btn').addEventListener('click', () => {
      formOpen = true;
      message = '';
      render();
      document.getElementById('queue-input').focus();
    });

    document.getElementById('queue-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('queue-input');
      const result = queueWord(input.value);
      if (result.ok) {
        message = `Queued ${result.word} — it'll be added next time we earn more words.`;
        messageIsError = false;
        scheduleSync();
        render();
        document.getElementById('queue-input').focus();
      } else {
        message = result.message;
        messageIsError = true;
        render();
        document.getElementById('queue-input').select();
      }
    });
  }

  render();
}
