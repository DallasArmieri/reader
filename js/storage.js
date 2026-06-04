// ── Concurrency helper ────────────────────────────────
async function withConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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

function saveDuration(id, duration) {
  const history = getHistory();
  const item = history.find(h => h.id === id);
  if (item && duration > 0) { item.duration = Math.floor(duration); saveHistory(history); }
}

function renameHistory(e, id) {
  e.stopPropagation();
  const history = getHistory();
  const item = history.find(h => h.id === id);
  if (!item) return;
  const newTitle = prompt('Rename:', item.title);
  if (newTitle === null || !newTitle.trim()) return;
  item.title = newTitle.trim().slice(0, 200);
  saveHistory(history);
  renderHistory();
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
  const query = (document.getElementById('historySearch')?.value || '').toLowerCase().trim();
  const items = query ? history.filter(h => h.title.toLowerCase().includes(query)) : history;

  if (items.length === 0) {
    list.innerHTML = '<div class="history-empty">' + (query ? 'No matches.' : 'No titles yet.<br>Generate audio to see it here.') + '</div>';
    return;
  }
  list.innerHTML = items.map(item => {
    const date = new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let resumeHtml = '';
    if (item.position > 0) {
      if (item.duration > 0) {
        const pctDone = Math.round(item.position / item.duration * 100);
        const pctLeft = 100 - pctDone;
        const minsLeft = Math.round((item.duration - item.position) / 60);
        resumeHtml = `<div class="history-resume">${pctDone}% · ${minsLeft} min left</div>`;
      } else {
        const m = Math.floor(item.position / 60);
        const s = Math.floor(item.position % 60);
        resumeHtml = `<div class="history-resume">Resume at ${m}m ${s}s</div>`;
      }
    }
    return `
      <div class="history-item" onclick="loadFromHistory('${item.id}')">
        <div class="history-item-header">
          <div class="history-item-title">${escHtml(item.title)}</div>
          <div style="display:flex;gap:2px;flex-shrink:0;">
            <button class="history-item-rename" onclick="renameHistory(event, '${item.id}')">✎</button>
            <button class="history-item-delete" onclick="deleteHistory(event, '${item.id}')">×</button>
          </div>
        </div>
        <div class="history-item-meta">
          <span>${date}</span>
          <span>${item.snippet.length} chars</span>
        </div>
        ${resumeHtml}
      </div>`;
  }).join('');
}

function loadFromHistory(id) {
  const history = getHistory();
  const item = history.find(h => h.id === id);
  if (!item) return;

  clearParse();

  const storedAudio = localStorage.getItem('reader_audio_' + id);
  const storedText = localStorage.getItem('reader_text_' + id);

  switchTab('read');

  if (storedText) {
    setTextValue(storedText);
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
      const dl = document.getElementById('downloadLink');
      dl.download = item.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) + '.mp3';
      dl.href = currentAudioUrl;
      document.getElementById('playerBox').className = 'player visible';

      audio.addEventListener('loadedmetadata', () => {
        if (item.position > 0) audio.currentTime = item.position;
      }, { once: true });
      setupMediaSession(item.title);
    } catch(e) {}
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Persistent Settings ───────────────────────────────

function saveSettings() {
  const settings = {
    voice: selectedVoice,
    model: selectedModel,
    speed: playbackSpeed,
    voicePlusEnabled: voicePlusEnabled,
    multiVoiceEnabled: document.getElementById('multiVoiceToggle')?.checked || false,
    voiceMode: voiceMode,
    granularity: document.getElementById('parseGranularity')?.value || 'line',
    genreTone: document.getElementById('genreToneInput')?.value || '',
    narratorVoice: document.getElementById('narratorVoice')?.value || 'onyx',
    dialogueVoice: document.getElementById('dialogueVoice')?.value || 'nova',
    autoDownload: autoDownload
  };
  localStorage.setItem('reader_settings', JSON.stringify(settings));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('reader_settings');
    if (!raw) return;
    const s = JSON.parse(raw);

    if (s.voice) {
      selectedVoice = s.voice;
      const el = document.getElementById('voiceSelect');
      if (el) el.value = s.voice;
    }

    if (s.model) {
      selectedModel = s.model;
      const el = document.getElementById('modelSelect');
      if (el) el.value = s.model;
    }

    if (s.speed != null) {
      playbackSpeed = parseFloat(s.speed);
      const slider = document.getElementById('speedSliderRead');
      if (slider) slider.value = s.speed;
      const display = playbackSpeed % 1 === 0 ? playbackSpeed.toFixed(1) : playbackSpeed.toFixed(2).replace(/0+$/, '');
      const el = document.getElementById('speedBtnRead');
      if (el) el.textContent = display + '×';
    }

    if (s.granularity) {
      const el = document.getElementById('parseGranularity');
      if (el) { el.value = s.granularity; updateGranularityHint(); }
    }

    if (s.genreTone) {
      const el = document.getElementById('genreToneInput');
      if (el) el.value = s.genreTone;
    }

    if (s.narratorVoice) {
      const el = document.getElementById('narratorVoice');
      if (el) el.value = s.narratorVoice;
    }

    if (s.dialogueVoice) {
      const el = document.getElementById('dialogueVoice');
      if (el) el.value = s.dialogueVoice;
    }

    if (s.multiVoiceEnabled) {
      const el = document.getElementById('multiVoiceToggle');
      if (el) { el.checked = true; toggleMultiVoiceSection(true); }
    }

    if (s.voiceMode && s.multiVoiceEnabled) {
      setVoiceMode(s.voiceMode);
    }

    if (s.voicePlusEnabled) {
      const el = document.getElementById('voicePlusToggle');
      if (el) { el.checked = true; toggleVoicePlus(true); }
    }

    if (s.autoDownload) {
      autoDownload = true;
      const el = document.getElementById('autoDownloadToggle');
      if (el) el.checked = true;
    }

  } catch(e) {}
  updateCount();
}
