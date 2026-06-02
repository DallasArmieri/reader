// ── Storage & History ─────────────────────────────────

const MAX_HISTORY = 20;

function getHistory() {
  try { return JSON.parse(localStorage.getItem('reader_history') || '[]'); } catch { return []; }
}

function saveHistory(history) {
  localStorage.setItem('reader_history', JSON.stringify(history));
}

function addToHistory(id, title, textSnippet) {
  const history = getHistory();
  const filtered = history.filter(h => h.id !== id);
  filtered.unshift({ id, title, snippet: textSnippet.slice(0, 120), date: Date.now(), position: 0 });
  saveHistory(filtered.slice(0, MAX_HISTORY));
}

function savePosition(id, position) {
  const history = getHistory();
  const item = history.find(h => h.id === id);
  if (item) { item.position = position; saveHistory(history); }
}

function deleteHistory(e, id) {
  e.stopPropagation();
  const history = getHistory().filter(h => h.id !== id);
  saveHistory(history);
  localStorage.removeItem('reader_audio_' + id);
  localStorage.removeItem('reader_text_' + id);
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('historyList');
  const history = getHistory();
  if (history.length === 0) {
    list.innerHTML = '<div class="history-empty">No history yet.<br>Generate audio to see it here.</div>';
    return;
  }
  list.innerHTML = history.map(item => {
    const date = new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const mins = item.position > 0 ? Math.floor(item.position / 60) + 'm ' + Math.floor(item.position % 60) + 's' : null;
    return `
      <div class="history-item" onclick="loadFromHistory('${item.id}')">
        <div class="history-item-header">
          <div class="history-item-title">${escHtml(item.title)}</div>
          <button class="history-item-delete" onclick="deleteHistory(event, '${item.id}')">×</button>
        </div>
        <div class="history-item-meta">
          <span>${date}</span>
          <span>${item.snippet.length} chars</span>
        </div>
        ${mins ? `<div class="history-resume">Resume at ${mins}</div>` : ''}
      </div>`;
  }).join('');
}

function loadFromHistory(id) {
  const history = getHistory();
  const item = history.find(h => h.id === id);
  if (!item) return;

  const storedAudio = localStorage.getItem('reader_audio_' + id);
  const storedText = localStorage.getItem('reader_text_' + id);

  switchTab('read');

  if (storedText) {
    document.getElementById('textInput').value = storedText;
    document.getElementById('textInput').dataset.title = item.title;
    updateCount();
  }

  if (storedAudio) {
    try {
      const binary = atob(storedAudio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = URL.createObjectURL(blob);
      currentArticleId = id;

      const audio = document.getElementById('audioPlayer');
      audio.src = currentAudioUrl;
      audio.playbackRate = playbackSpeed;
      document.getElementById('playerTitle').textContent = item.title;
      document.getElementById('downloadLink').href = currentAudioUrl;
      document.getElementById('playerBox').className = 'player visible';

      audio.addEventListener('loadedmetadata', () => {
        if (item.position > 0) audio.currentTime = item.position;
      }, { once: true });
    } catch(e) {}
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
