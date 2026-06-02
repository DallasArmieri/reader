// ── Voice+ State ──────────────────────────────────────
let voicePlusEnabled = false;
let parsedEmotionChunks = null;  // final merged chunks used for generation
let parsedEmotionData = null;    // { segments: [], results: [] } from parseEmotion
let parsedVoiceData = null;      // { segments: [], annotations: [] } from parseVoice
let voiceMode = 'narrator';
let speakerMap = {};

const VOICE_OPTIONS = ['alloy','echo','fable','onyx','nova','shimmer','coral','sage'];
const VOICE_LABELS = { alloy:'Alloy',echo:'Echo',fable:'Fable',onyx:'Onyx',nova:'Nova',shimmer:'Shimmer',coral:'Coral',sage:'Sage' };
const VOICE_COLORS = { alloy:'#8a877f',echo:'#6e9bc9',fable:'#c96e9b',onyx:'#4a4845',nova:'#c9a96e',shimmer:'#9bc96e',coral:'#c9756e',sage:'#6ec9b8' };

// ── UI Helpers ────────────────────────────────────────

function voiceSelectHTML(id, selected) {
  return `<select class="speaker-voice-select" id="${id}" onchange="updateSpeakerVoice('${id}',this.value)">
    ${VOICE_OPTIONS.map(v => `<option value="${v}"${v===selected?' selected':''}>${VOICE_LABELS[v]}</option>`).join('')}
  </select>`;
}

function updateSpeakerVoice(id, val) {
  speakerMap[id] = val;
}

function getGranularity() {
  const el = document.getElementById('parseGranularity');
  return el ? el.value : 'line';
}

function updateGranularityHint() {
  const hints = {
    line:  'Each line gets its own emotion + TTS call. Most expressive, slowest to generate.',
    beat:  'Groups 2-3 lines per call. Good balance for most fiction chapters.',
    block: 'Groups 4-6 lines per call. Faster generation, coarser emotion shifts.',
    chunk: 'Splits every ~4000 characters. Fastest, least expressive.'
  };
  const hint = document.getElementById('granularityHint');
  if (hint) hint.textContent = hints[getGranularity()] || '';
}

function updateParseVoiceBtnVisibility() {
  const multiOn = document.getElementById('multiVoiceToggle')?.checked;
  const wrapper = document.getElementById('parseVoiceShortcut');
  if (wrapper) wrapper.style.display = multiOn ? 'block' : 'none';
}

// ── Toggles ───────────────────────────────────────────

function toggleVoicePlus(enabled) {
  voicePlusEnabled = enabled;
  document.getElementById('parseSection').style.display = enabled ? 'block' : 'none';
  document.getElementById('parseShortcut').style.display = enabled ? 'flex' : 'none';
  if (!enabled) {
    parsedEmotionData = null;
    rebuildAndRender();
  }
}

function toggleMultiVoiceSection(enabled) {
  document.getElementById('multiVoiceContent').style.display = enabled ? 'block' : 'none';
  if (enabled) {
    document.getElementById('narratorModeUI').style.display = voiceMode === 'narrator' ? 'block' : 'none';
    document.getElementById('voiceModeUI').style.display = voiceMode === 'voice' ? 'block' : 'none';
  } else {
    parsedVoiceData = null;
    speakerMap = {};
    rebuildAndRender();
  }
  updateParseVoiceBtnVisibility();
}

function setVoiceMode(mode) {
  voiceMode = mode;
  document.getElementById('modeNarrator')?.classList.toggle('selected', mode === 'narrator');
  document.getElementById('modeVoice')?.classList.toggle('selected', mode === 'voice');
  const narratorUI = document.getElementById('narratorModeUI');
  const voiceUI = document.getElementById('voiceModeUI');
  if (narratorUI) narratorUI.style.display = mode === 'narrator' ? 'block' : 'none';
  if (voiceUI) voiceUI.style.display = mode === 'voice' ? 'block' : 'none';
  if (mode === 'narrator') {
    const table = document.getElementById('speakerTable');
    if (table) { table.style.display = 'none'; table.innerHTML = ''; }
    speakerMap = {};
    parsedVoiceData = null;
    rebuildAndRender();
  }
  updateParseVoiceBtnVisibility();
}

// ── Clear & Text Input ────────────────────────────────

function clearParse() {
  parsedEmotionChunks = null;
  parsedEmotionData = null;
  parsedVoiceData = null;
  speakerMap = {};
  const av = document.getElementById('annotatedView');
  if (av) { av.style.display = 'none'; av.innerHTML = ''; }
  const ti = document.getElementById('textInput');
  if (ti) ti.style.display = '';
  const ep = document.getElementById('emotionPreview');
  if (ep) { ep.style.display = 'none'; ep.innerHTML = ''; }
}

function onTextInput() {
  // Only clear parse if text actually changed (user typed/pasted)
  if (parsedEmotionData || parsedVoiceData) {
    parsedEmotionData = null;
    parsedVoiceData = null;
    parsedEmotionChunks = null;
    const av = document.getElementById('annotatedView');
    if (av) { av.style.display = 'none'; av.innerHTML = ''; }
    document.getElementById('textInput').style.display = '';
  }
  updateCount();
}

// ── Merge & Rebuild ───────────────────────────────────

// Merge emotion and voice parse results into parsedEmotionChunks and re-render
function rebuildAndRender() {
  const hasEmotion = !!parsedEmotionData;
  const hasVoice = !!parsedVoiceData;

  if (!hasEmotion && !hasVoice) {
    parsedEmotionChunks = null;
    const av = document.getElementById('annotatedView');
    if (av) { av.style.display = 'none'; av.innerHTML = ''; }
    document.getElementById('textInput').style.display = '';
    return;
  }

  // Use whichever has segments as the base
  const base = hasEmotion ? parsedEmotionData.results : parsedVoiceData.annotations.map(a => ({
    text: a.text, emotion: null, instruction: null, voice: a.voice, speaker: a.speaker
  }));

  const merged = base.map((chunk, i) => {
    const result = { ...chunk };
    // Overlay voice data if available
    if (hasVoice && parsedVoiceData.annotations[i]) {
      result.voice = parsedVoiceData.annotations[i].voice;
      result.speaker = parsedVoiceData.annotations[i].speaker;
    }
    // Overlay emotion data if available
    if (hasEmotion && parsedEmotionData.results[i]) {
      result.emotion = parsedEmotionData.results[i].emotion;
      result.instruction = parsedEmotionData.results[i].instruction;
    }
    return result;
  });

  parsedEmotionChunks = merged;
  renderMerged(merged, hasEmotion, hasVoice);
}

// ── Render ────────────────────────────────────────────

function renderMerged(chunks, hasEmotion, hasVoice) {
  const textarea = document.getElementById('textInput');
  const av = document.getElementById('annotatedView');
  textarea.style.display = 'none';
  av.style.display = 'block';
  av.innerHTML = `<div class="annotated-view">${
    chunks.map(c => {
      let pills = '';

      // Emotion pill
      if (hasEmotion && c.emotion) {
        pills += `<span class="emotion-pill">✦ ${c.emotion.toUpperCase()}</span> `;
      }

      // Voice/speaker pill
      if (hasVoice && voiceMode === 'voice') {
        if (c.speaker) {
          const color = VOICE_COLORS[c.voice] || '#8a877f';
          const voiceName = VOICE_LABELS[c.voice] || c.voice;
          pills += `<span class="emotion-pill" style="color:${color};border-color:${color}33;background:${color}11;">◆ ${c.speaker} <span style="opacity:0.6;font-size:9px;">· ${voiceName}</span></span>`;
        }
      } else if (voiceMode === 'narrator' && document.getElementById('multiVoiceToggle')?.checked) {
        const isD = isDialogue(c.text);
        pills += `<span style="font-family:'DM Mono',monospace;font-size:9px;color:${isD?'var(--accent)':'var(--text-muted)'};">${isD?'◆ SPEAKER':'○ NARRATOR'}</span>`;
      }

      return `
      <div class="annotated-chunk">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;">${pills}</div>
        ${hasEmotion && c.instruction ? `<div class="emotion-instr">${c.instruction}</div>` : ''}
        <div class="annotated-text">${c.text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
      </div>`;
    }).join('')
  }</div>
  <button class="clear-parse" onclick="clearParse()">× Clear &amp; edit text</button>`;
}

// ── Dialogue Detection ────────────────────────────────

function isDialogue(text) {
  const t = text.trim();
  if (/^["""'']/.test(t)) return true;
  if (/["""'']/.test(t)) {
    const quoteContent = (t.match(/["""''][^"""'']+["""'']/g) || []).join('');
    return quoteContent.length > t.length * 0.25;
  }
  return false;
}

// ── Splitting ─────────────────────────────────────────

function splitByGranularity(text, mode) {
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);

  if (mode === 'chunk') {
    return splitIntoChunks(text, 4000).map(t => ({ text: t }));
  }

  const merged = [];
  let buffer = '';
  for (const line of lines) {
    if (buffer && buffer.length < 60) {
      buffer += ' ' + line;
    } else {
      if (buffer) merged.push(buffer);
      buffer = line;
    }
  }
  if (buffer) merged.push(buffer);

  const groupSize = mode === 'line' ? 1 : mode === 'beat' ? 3 : 5;
  const groups = [];
  for (let i = 0; i < merged.length; i += groupSize) {
    const group = merged.slice(i, i + groupSize).join('\n');
    if (group.trim().length > 0) groups.push(group);
  }
  return groups;
}

// ── Speaker Detection ─────────────────────────────────

async function detectSpeakers(fullText) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Identify all distinct character speakers in this text. Do not include a Narrator — only named or identifiable characters who speak dialogue. For each speaker, guess their gender/personality from context.

Reply with JSON only, no markdown:
{"speakers": [{"name": "Character Name", "hint": "young energetic female"}]}

Text (first 2000 chars):
${fullText.slice(0, 2000)}`
      }]
    })
  });
  if (!res.ok) throw new Error('Speaker detection failed');
  const data = await res.json();
  const raw = data.choices[0].message.content.trim().replace(/```json|```/g, '');
  const parsed = JSON.parse(raw);
  return parsed.speakers || [];
}

function autoAssignVoices(speakers) {
  const malePool = ['onyx','echo','fable','sage','alloy'];
  const femalePool = ['nova','shimmer','coral','alloy','fable'];
  const femaleHints = ['female','woman','girl','she','her'];
  const map = {};
  let mi = 0, fi = 0;
  speakers.forEach(s => {
    const hint = (s.hint || '').toLowerCase();
    const isFemale = femaleHints.some(h => hint.includes(h));
    map[s.name] = isFemale ? femalePool[fi++ % femalePool.length] : malePool[mi++ % malePool.length];
  });
  return map;
}

function renderSpeakerTable(speakers, map) {
  if (voiceMode !== 'voice') return;
  const voiceModeUI = document.getElementById('voiceModeUI');
  if (voiceModeUI) voiceModeUI.style.display = 'block';
  const table = document.getElementById('speakerTable');
  if (!table) return;
  table.style.display = 'block';
  table.innerHTML = `<div class="speaker-table-wrap">${
    speakers.map(s => {
      const voice = map[s.name] || 'alloy';
      const color = VOICE_COLORS[voice] || '#8a877f';
      return `<div class="speaker-row">
        <div class="speaker-dot" style="background:${color};"></div>
        <div class="speaker-name">${s.name}</div>
        ${voiceSelectHTML(s.name, voice)}
      </div>`;
    }).join('')
  }</div>`;
}

// ── Emotion Analysis (single segment) ────────────────

async function analyseEmotion(text, prevText, nextText, genre) {
  const ctx = [];
  if (genre) ctx.push(`Genre/tone: ${genre}`);
  if (prevText) ctx.push(`Previous passage: "${prevText.slice(0, 200)}"`);
  ctx.push(`Current passage: "${text.slice(0, 600)}"`);
  if (nextText) ctx.push(`Next passage: "${nextText.slice(0, 200)}"`);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `You are directing a voice actor recording an audiobook. Analyse the emotional tone of the current passage in context and write a performance instruction for text-to-speech.

${ctx.join('\n')}

Reply with JSON only, no markdown:
{"emotion": "<one word>", "instruction": "<1-2 sentence performance direction covering tone, pacing, and any words to emphasise>"}`
      }]
    })
  });
  if (!res.ok) throw new Error('API error ' + res.status);
  const data = await res.json();
  try {
    const raw = data.choices[0].message.content.trim().replace(/```json|```/g, '');
    return JSON.parse(raw);
  } catch(e) {
    return { emotion: 'neutral', instruction: 'Read naturally and clearly.' };
  }
}

// ── Speaker Assignment (single segment) ──────────────

async function assignSpeaker(text, speakerNames, lastSpeaker) {
  const carryHint = lastSpeaker ? `\nThe previous line was spoken by ${lastSpeaker}.` : '';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 40,
      messages: [{
        role: 'user',
        content: `Who is the primary speaker in this passage? Choose from: ${speakerNames}. If it is narration with no clear speaker, reply null.${carryHint}\n\nReply with JSON only: {"speaker": "Name or null"}\n\nText: ${text.slice(0, 400)}`
      }]
    })
  });
  if (!res.ok) return null;
  try {
    const d = await res.json();
    const sp = JSON.parse(d.choices[0].message.content.trim().replace(/```json|```/g,''));
    return speakerMap[sp.speaker] ? sp.speaker : null;
  } catch(e) { return null; }
}

// ── Parse Emotion ─────────────────────────────────────

async function parseEmotion() {
  const text = document.getElementById('textInput').value.trim();
  if (!text) { alert('Paste some text on the Read tab first.'); return; }
  if (!OPENAI_KEY) { alert('No API key — add it in Settings.'); return; }

  const btn = document.getElementById('parseShortcutBtn');
  const content = document.getElementById('parseShortcutContent');
  if (btn) btn.disabled = true;
  parsedEmotionData = null;

  const mode = getGranularity();
  const segments = splitByGranularity(text, mode).map(s => typeof s === 'string' ? s : s.text);

  try {
    let done = 0;
    const genre = document.getElementById('genreToneInput')?.value.trim();
    const results = await withConcurrency(segments, 5, async (seg, i) => {
      const parsed = await analyseEmotion(seg, segments[i - 1], segments[i + 1], genre);
      done++;
      if (content) content.innerHTML = `<div class="spinner-sm"></div> ${done}/${segments.length}`;

      let segVoice = selectedVoice;
      const multiVoiceOn = document.getElementById('multiVoiceToggle')?.checked;
      if (multiVoiceOn && voiceMode === 'narrator') {
        const nv = document.getElementById('narratorVoice')?.value || selectedVoice;
        const dv = document.getElementById('dialogueVoice')?.value || selectedVoice;
        segVoice = isDialogue(seg) ? dv : nv;
      }

      return { text: seg, emotion: parsed.emotion || 'neutral', instruction: parsed.instruction || 'Read naturally.', voice: segVoice, speaker: null };
    });

    parsedEmotionData = { segments, results };
    rebuildAndRender();

  } catch(err) {
    alert('Parse failed: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (content) content.textContent = '✦ Parse Emotion';
  }
}

// ── Parse Voice ───────────────────────────────────────

async function parseVoice() {
  const text = document.getElementById('textInput').value.trim();
  if (!text) { alert('Paste some text on the Read tab first.'); return; }
  if (!OPENAI_KEY) { alert('No API key — add it in Settings.'); return; }

  const btn = document.getElementById('parseVoiceBtn');
  const content = document.getElementById('parseVoiceBtnContent');
  btn.disabled = true;
  content.innerHTML = '<div class="spinner-sm"></div> Detecting…';
  parsedVoiceData = null;
  speakerMap = {};

  const mode = getGranularity();
  const segments = splitByGranularity(text, mode).map(s => typeof s === 'string' ? s : s.text);

  try {
    const speakers = await detectSpeakers(text);
    const autoMap = autoAssignVoices(speakers);
    speakerMap = { ...autoMap };
    renderSpeakerTable(speakers, speakerMap);

    content.innerHTML = '<div class="spinner-sm"></div> Assigning…';
    const speakerNames = Object.keys(speakerMap).join(', ');

    let lastSpeaker = null;
    let done = 0;
    const annotations = [];
    for (let i = 0; i < segments.length; i++) {
      const speaker = await assignSpeaker(segments[i], speakerNames, lastSpeaker);
      done++;
      if (content) content.innerHTML = `<div class="spinner-sm"></div> ${done}/${segments.length}`;
      if (speaker) lastSpeaker = speaker;
      const voice = speaker ? speakerMap[speaker] : selectedVoice;
      annotations.push({ text: segments[i], speaker, voice });
    }

    parsedVoiceData = { segments, annotations };
    rebuildAndRender();

  } catch(err) {
    alert('Voice parse failed: ' + err.message);
  } finally {
    btn.disabled = false;
    content.textContent = '◆ Parse Voice';
  }
}

// ── Parse Both Simultaneously ─────────────────────────

async function parseBoth() {
  const text = document.getElementById('textInput').value.trim();
  if (!text) { alert('Paste some text on the Read tab first.'); return; }
  if (!OPENAI_KEY) { alert('No API key — add it in Settings.'); return; }

  const emotionBtn = document.getElementById('parseShortcutBtn');
  const emotionContent = document.getElementById('parseShortcutContent');
  const voiceBtn = document.getElementById('parseVoiceBtn');
  const voiceContent = document.getElementById('parseVoiceBtnContent');

  if (emotionBtn) emotionBtn.disabled = true;
  if (voiceBtn) voiceBtn.disabled = true;
  parsedEmotionData = null;
  parsedVoiceData = null;
  speakerMap = {};

  const mode = getGranularity();
  const segments = splitByGranularity(text, mode).map(s => typeof s === 'string' ? s : s.text);

  try {
    // Detect speakers first (needed for voice assignment)
    if (voiceContent) voiceContent.innerHTML = '<div class="spinner-sm"></div> Detecting…';
    const speakers = await detectSpeakers(text);
    const autoMap = autoAssignVoices(speakers);
    speakerMap = { ...autoMap };
    renderSpeakerTable(speakers, speakerMap);
    const speakerNames = Object.keys(speakerMap).join(', ');

    // Run emotion and voice assignment in parallel per segment
    const emotionResults = [];
    const voiceAnnotations = [];

    if (emotionContent) emotionContent.innerHTML = `<div class="spinner-sm"></div> 0/${segments.length}`;
    if (voiceContent) voiceContent.innerHTML = `<div class="spinner-sm"></div> 0/${segments.length}`;

    let lastSpeaker = null;
    let done = 0;
    const genre = document.getElementById('genreToneInput')?.value.trim();

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const [emotionParsed, speaker] = await Promise.all([
        analyseEmotion(seg, segments[i - 1], segments[i + 1], genre),
        assignSpeaker(seg, speakerNames, lastSpeaker)
      ]);

      done++;
      if (speaker) lastSpeaker = speaker;
      if (emotionContent) emotionContent.innerHTML = `<div class="spinner-sm"></div> ${done}/${segments.length}`;
      if (voiceContent) voiceContent.innerHTML = `<div class="spinner-sm"></div> ${done}/${segments.length}`;

      const segVoice = speaker ? speakerMap[speaker] : selectedVoice;
      emotionResults[i] = { text: seg, emotion: emotionParsed.emotion || 'neutral', instruction: emotionParsed.instruction || 'Read naturally.', voice: segVoice, speaker };
      voiceAnnotations[i] = { text: seg, speaker, voice: segVoice };
    }

    parsedEmotionData = { segments, results: emotionResults };
    parsedVoiceData = { segments, annotations: voiceAnnotations };
    rebuildAndRender();

  } catch(err) {
    alert('Parse failed: ' + err.message);
  } finally {
    if (emotionBtn) emotionBtn.disabled = false;
    if (voiceBtn) voiceBtn.disabled = false;
    if (emotionContent) emotionContent.textContent = '✦ Parse Emotion';
    if (voiceContent) voiceContent.textContent = '◆ Parse Voice';
  }
}
