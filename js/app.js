// ── Core State ────────────────────────────────────────
let OPENAI_KEY = localStorage.getItem('openai_key') || '';
let selectedVoice = 'alloy';
let selectedModel = 'tts-1-hd';
let playbackSpeed = 1.0;
let currentAudioUrl = null;
let currentArticleId = null;
const CHUNK_SIZE = 4000;

// ── Init ──────────────────────────────────────────────
if (OPENAI_KEY) {
  document.getElementById('keyHint').textContent = '✓ Key saved on this device';
  document.getElementById('keyHint').className = 'key-hint saved';
}

document.getElementById('writeTime').textContent = 'Generated ' + new Date(document.lastModified).toLocaleString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true
});

// Bookmarklet
const APP_URL = 'https://dallasarmieri.github.io/reader';
const bookmarkletFn = `(function(){
  var el=document.querySelector('.chapter-inner.chapter-content')||document.querySelector('article')||document.querySelector('main')||document.body;
  var title=document.querySelector('h1')?document.querySelector('h1').innerText.trim():document.title;
  var text=el.innerText.replace(/\\n{3,}/g,'\\n\\n').trim();
  if(text.length<50){alert('Could not find chapter text.');return;}
  var payload=JSON.stringify({title:title.slice(0,200),text:text});
  window.location.href='${APP_URL}#incoming='+encodeURIComponent(payload);
})();`;
const bookmarklet = 'javascript:' + bookmarkletFn.replace(/\s+/g,' ');
document.getElementById('bookmarkletCode').textContent = bookmarklet;

// Handle incoming bookmarklet text
(function() {
  const hash = window.location.hash;
  if (hash.startsWith('#incoming=')) {
    try {
      const payload = JSON.parse(decodeURIComponent(hash.slice('#incoming='.length)));
      if (payload.text) {
        document.getElementById('textInput').value = payload.text;
        if (payload.title) document.getElementById('textInput').dataset.title = payload.title;
        updateCount();
      }
    } catch(e) {}
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

// Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/reader/sw.js').catch(() => {});
  });
}

// Restore persisted settings on load
loadSettings();
initPlayer();

// ── Tabs ──────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tab[onclick="switchTab('${tab}')"]`).classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
  if (tab === 'history') renderHistory();
}

// ── Settings ──────────────────────────────────────────
function saveKey() {
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val) return;
  OPENAI_KEY = val;
  localStorage.setItem('openai_key', val);
  document.getElementById('apiKeyInput').value = '';
  document.getElementById('keyHint').textContent = '✓ Key saved on this device';
  document.getElementById('keyHint').className = 'key-hint saved';
}

function selectModel(el, model) {
  document.querySelectorAll('.model-btn').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedModel = model;
  updateCount();
  saveSettings();
}

// ── Speed ─────────────────────────────────────────────
function updateSpeed(val) {
  playbackSpeed = parseFloat(val);
  const display = playbackSpeed % 1 === 0 ? playbackSpeed.toFixed(1) : playbackSpeed.toFixed(2).replace(/0+$/, '');
  document.getElementById('speedDisplayRead').textContent = display + '×';
  updateCount();
  saveSettings();
}

function updateSpeedRead(val) { updateSpeed(val); }

function updatePlaybackSpeed(val) {
  const speed = parseFloat(val);
  const display = speed % 1 === 0 ? speed.toFixed(1) : speed.toFixed(2).replace(/0+$/, '');
  document.getElementById('playbackDisplay').textContent = display + '×';
  const audio = document.getElementById('audioPlayer');
  if (audio) audio.playbackRate = speed;
}

function skipAudio(seconds) {
  const audio = document.getElementById('audioPlayer');
  if (!audio) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds));
}

// ── Custom Player ─────────────────────────────────────

function formatTime(sec) {
  if (!isFinite(sec) || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function togglePlayPause() {
  const audio = document.getElementById('audioPlayer');
  if (audio.paused) audio.play(); else audio.pause();
}

function updatePlayerProgress() {
  const audio = document.getElementById('audioPlayer');
  const fill = document.getElementById('playerScrubberFill');
  const elapsed = document.getElementById('playerElapsed');
  const dur = document.getElementById('playerDuration');
  if (!fill || !elapsed || !dur) return;
  if (audio.duration) {
    fill.style.width = (audio.currentTime / audio.duration * 100) + '%';
    dur.textContent = formatTime(audio.duration);
  }
  elapsed.textContent = formatTime(audio.currentTime);
}

function initPlayer() {
  const audio = document.getElementById('audioPlayer');

  audio.addEventListener('timeupdate', () => {
    updatePlayerProgress();
    if (currentArticleId) savePosition(currentArticleId, Math.floor(audio.currentTime));
    if ('mediaSession' in navigator && audio.duration) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime
        });
      } catch(e) {}
    }
  });

  audio.addEventListener('loadedmetadata', () => {
    updatePlayerProgress();
    if (currentArticleId) saveDuration(currentArticleId, audio.duration);
  });

  audio.addEventListener('play', () => {
    const btn = document.getElementById('playPauseBtn');
    if (btn) btn.textContent = '⏸';
  });

  audio.addEventListener('pause', () => {
    const btn = document.getElementById('playPauseBtn');
    if (btn) btn.textContent = '▶';
  });

  document.getElementById('playerScrubberTrack').addEventListener('click', e => {
    if (!audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  });
}

function setupMediaSession(title) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: title,
    artist: 'Reader',
    artwork: [
      { src: '/reader/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/reader/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });
  const audio = document.getElementById('audioPlayer');
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('seekbackward', ({ seekOffset } = {}) => skipAudio(-(seekOffset || 15)));
  navigator.mediaSession.setActionHandler('seekforward', ({ seekOffset } = {}) => skipAudio(seekOffset || 15));
}

// ── Char count & read time ────────────────────────────
function updateCount() {
  const text = document.getElementById('textInput').value;
  const len = text.length;
  document.getElementById('charCount').textContent = len.toLocaleString() + ' characters';
  const rate = selectedModel === 'tts-1-hd' ? 0.030 : 0.015;
  document.getElementById('costEst').textContent = '~$' + (len / 1000 * rate).toFixed(3);
  const readTimeEl = document.getElementById('readTime');
  if (len > 0) {
    const words = text.trim().split(/\s+/).length;
    const mins = words / 150 / playbackSpeed;
    const spDisplay = playbackSpeed % 1 === 0 ? playbackSpeed.toFixed(1) : playbackSpeed;
    if (mins < 1) {
      readTimeEl.textContent = '~' + Math.round(mins * 60) + 's at ' + spDisplay + '×';
    } else {
      readTimeEl.textContent = '~' + (mins < 1.5 ? '1 min' : Math.round(mins) + ' min') + ' at ' + spDisplay + '×';
    }
  } else {
    readTimeEl.textContent = '';
  }
}

// ── Import Menu ───────────────────────────────────────

function toggleImportMenu() {
  const menu = document.getElementById('importMenu');
  const btn = document.getElementById('importBtn');
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  btn.classList.toggle('open', !isOpen);
}

function selectImportOption(type) {
  document.getElementById('importMenu').style.display = 'none';
  document.getElementById('importBtn').classList.remove('open');
  if (type === 'link') {
    const row = document.getElementById('urlInputRow');
    row.style.display = 'flex';
    document.getElementById('urlInput').focus();
  } else {
    document.getElementById('fileInput').click();
  }
}

function handleFileUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('textInput').value = e.target.result;
    document.getElementById('textInput').dataset.title = file.name.replace(/\.[^.]+$/, '');
    onTextInput();
  };
  reader.readAsText(file);
  input.value = '';
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('importWrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('importMenu').style.display = 'none';
    document.getElementById('importBtn').classList.remove('open');
  }
});

// ── URL Fetch ─────────────────────────────────────────

async function fetchHtmlViaProxy(url) {
  // Try allorigins first, fall back to corsproxy.io
  try {
    const res = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url));
    if (res.ok) {
      const data = await res.json();
      if (data.contents && data.contents.length > 100) return data.contents;
    }
  } catch(e) {}
  const res = await fetch('https://corsproxy.io/?' + encodeURIComponent(url));
  if (!res.ok) throw new Error('Failed to fetch page');
  return await res.text();
}

function extractTextFromDoc(el) {
  // innerText doesn't work on DOMParser documents (not rendered), so walk the tree manually
  const BLOCK = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','TD','TH',
    'BLOCKQUOTE','PRE','SECTION','ARTICLE','MAIN','FIGURE','FIGCAPTION','BR']);
  let out = '';
  (function walk(node) {
    if (node.nodeType === 3) {
      out += node.textContent;
    } else if (node.nodeType === 1) {
      if (BLOCK.has(node.tagName)) out += '\n';
      node.childNodes.forEach(walk);
      if (BLOCK.has(node.tagName)) out += '\n';
    }
  })(el);
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function extractArticle(doc) {
  // Remove structural noise tags
  ['script','style','nav','header','footer','aside','form','noscript','iframe',
   'button','select','svg','canvas','video','audio'].forEach(tag => {
    doc.querySelectorAll(tag).forEach(el => el.remove());
  });

  // Remove elements whose class/id suggests ads, sidebars, or other non-content
  const NOISE = /\b(ad|ads|advert|advertisement|banner|promo|sponsor|social|share|sharing|related|recommend|trending|popular|comment|discuss|cookie|gdpr|consent|newsletter|subscribe|signup|sidebar|widget|flyout|popup|modal|overlay|toolbar|breadcrumb|pagination|tag-cloud|author-bio|bio-box|read-next|also-read|more-from|outbrain|taboola|sticky|masthead)\b/i;
  doc.querySelectorAll('[class],[id]').forEach(el => {
    const str = (el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '');
    if (NOISE.test(str)) el.remove();
  });

  // Try semantic and common article selectors in priority order
  const CONTENT_SELECTORS = [
    'article',
    '[itemprop="articleBody"]',
    '[class*="article__body"]', '[class*="article-body"]', '[class*="article-content"]',
    '[class*="story-body"]',    '[class*="story-content"]',
    '[class*="post-body"]',     '[class*="post-content"]',  '[class*="post__content"]',
    '[class*="entry-content"]', '[class*="content-body"]',
    '[class*="chapter-content"]','[class*="chapter-inner"]',
    'main', '[role="main"]',
  ];
  for (const sel of CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && el.textContent.trim().length > 200) return el;
  }

  // Fallback: score divs by text density (link-heavy = nav/ads, text-heavy = content)
  let best = doc.body, bestScore = 0;
  doc.querySelectorAll('div, section').forEach(el => {
    const text = el.textContent.trim();
    if (text.length < 200) return;
    const linkChars = [...el.querySelectorAll('a')].reduce((n, a) => n + a.textContent.length, 0);
    const score = text.length * (1 - linkChars / text.length);
    if (score > bestScore) { bestScore = score; best = el; }
  });
  return best;
}

async function fetchUrl() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) return;
  const btn = document.getElementById('fetchBtn');
  const content = document.getElementById('fetchBtnContent');
  btn.disabled = true;
  content.innerHTML = '<div class="spinner-sm"></div>';
  try {
    const html = await fetchHtmlViaProxy(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const title = doc.querySelector('h1')?.textContent?.trim() || doc.title || url;
    const articleEl = extractArticle(doc);
    const text = extractTextFromDoc(articleEl);
    if (text.length < 100) throw new Error('Could not extract article text from this page');
    document.getElementById('textInput').value = text;
    document.getElementById('urlInput').value = '';
    document.getElementById('urlInputRow').style.display = 'none';
    document.getElementById('textInput').dataset.title = title;
    updateCount();
  } catch (err) {
    showError('Could not fetch URL: ' + err.message + '. Try pasting the text manually instead.');
  } finally {
    btn.disabled = false;
    content.textContent = 'Fetch';
  }
}

// ── Chunking ──────────────────────────────────────────
function splitIntoChunks(text, maxLen) {
  const chunks = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let cutAt = maxLen;
    const sentenceEnd = remaining.lastIndexOf('. ', maxLen);
    const newline = remaining.lastIndexOf('\n', maxLen);
    const best = Math.max(sentenceEnd, newline);
    if (best > maxLen * 0.5) cutAt = best + 1;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  return chunks;
}

// ── API Call ──────────────────────────────────────────
async function fetchChunk(text, voiceInstruction, voiceOverride) {
  const apiSpeed = Math.min(4.0, Math.max(0.25, playbackSpeed));
  const body = {
    model: voicePlusEnabled ? 'gpt-4o-mini-tts' : selectedModel,
    input: text,
    voice: voiceOverride || selectedVoice,
    response_format: 'mp3',
    speed: apiSpeed
  };
  if (voicePlusEnabled && voiceInstruction) {
    body.instructions = voiceInstruction;
  }
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    let msg = 'API error ' + response.status;
    try { const e = await response.json(); msg = e.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  return await response.arrayBuffer();
}

// ── Generate ──────────────────────────────────────────
async function generateAudio() {
  const text = document.getElementById('textInput').value.trim();
  const title = document.getElementById('textInput').dataset.title || text.slice(0, 60) + (text.length > 60 ? '…' : '');
  const btn = document.getElementById('generateBtn');
  const errorBox = document.getElementById('errorBox');
  const playerBox = document.getElementById('playerBox');
  const progressBox = document.getElementById('progressBox');

  errorBox.className = 'error-box';
  playerBox.className = 'player';
  progressBox.className = 'progress-box';

  if (!OPENAI_KEY) { showError('No API key — go to Settings and add your OpenAI key.'); return; }
  if (!text) { showError('Please paste some text first.'); return; }

  const rate = selectedModel === 'tts-1-hd' ? 0.030 : 0.015;
  const estimatedCost = text.length / 1000 * rate;
  if (estimatedCost > 0.10 && !confirm(`Estimated cost: $${estimatedCost.toFixed(3)}. Generate audio?`)) return;

  const multiVoiceOn = document.getElementById('multiVoiceToggle')?.checked;

  // Build chunks
  let chunks;
  if (parsedEmotionChunks) {
    chunks = parsedEmotionChunks;
  } else if (multiVoiceOn && voiceMode === 'narrator') {
    const nv = document.getElementById('narratorVoice')?.value || selectedVoice;
    const dv = document.getElementById('dialogueVoice')?.value || selectedVoice;
    const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
    chunks = lines.map(line => ({ text: line, instruction: null, voice: isDialogue(line) ? dv : nv }));
  } else {
    chunks = splitIntoChunks(text, CHUNK_SIZE).map(t => ({ text: t, instruction: null, voice: selectedVoice }));
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Generating…';
  if (chunks.length > 1) progressBox.className = 'progress-box visible';

  try {
    let done = 0;
    const buffers = await withConcurrency(chunks, 5, async (chunk) => {
      const buf = await fetchChunk(chunk.text, chunk.instruction, chunk.voice);
      done++;
      document.getElementById('progressLabel').textContent = chunks.length > 1 ? `Generating… ${done}/${chunks.length}` : 'Generating audio…';
      document.getElementById('progressFill').style.width = (done / chunks.length * 100) + '%';
      return buf;
    });
    document.getElementById('progressFill').style.width = '100%';

    const totalLen = buffers.reduce((s, b) => s + b.byteLength, 0);
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const buf of buffers) { combined.set(new Uint8Array(buf), offset); offset += buf.byteLength; }

    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    const blob = new Blob([combined], { type: 'audio/mpeg' });
    currentAudioUrl = URL.createObjectURL(blob);

    const id = 'art_' + Date.now();
    currentArticleId = id;
    addToHistory(id, title, text);
    localStorage.setItem('reader_text_' + id, text);

    if (totalLen < 4 * 1024 * 1024) {
      try {
        let binary = '';
        combined.forEach(b => binary += String.fromCharCode(b));
        localStorage.setItem('reader_audio_' + id, btoa(binary));
      } catch(e) {}
    }

    const audio = document.getElementById('audioPlayer');
    audio.src = currentAudioUrl;
    audio.playbackRate = playbackSpeed;
    document.getElementById('playerTitle').textContent = title;
    document.getElementById('downloadLink').href = currentAudioUrl;
    playerBox.className = 'player visible';
    progressBox.className = 'progress-box';
    audio.play();
    setupMediaSession(title);

  } catch (err) {
    showError(err.message);
    progressBox.className = 'progress-box';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '▶ &nbsp;Generate Audio';
  }
}

function showError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = msg;
  box.className = 'error-box visible';
}

// ── Parse Dispatchers ─────────────────────────────────
function bothParsesActive() {
  return document.getElementById('voicePlusToggle')?.checked &&
         document.getElementById('multiVoiceToggle')?.checked &&
         voiceMode === 'voice';
}

function handleParseEmotion() {
  if (bothParsesActive()) { parseBoth(); } else { parseEmotion(); }
}

function handleParseVoice() {
  if (bothParsesActive()) { parseBoth(); } else { parseVoice(); }
}
