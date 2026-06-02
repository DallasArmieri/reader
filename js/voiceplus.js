// ── Voice+ State ──────────────────────────────────────
let voicePlusEnabled = false;
let parsedEmotionChunks = null;
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
  parsedEmotionChunks = null;
  speakerMap = {};
  document.getElementById('parseSection').style.display = enabled ? 'block' : 'none';
  document.getElementById('parseShortcut').style.display = enabled ? 'flex' : 'none';
  if (!enabled) clearParse();
}

function toggleMultiVoiceSection(enabled) {
  document.getElementById('multiVoiceContent').style.display = enabled ? 'block' : 'none';
  if (enabled) {
    document.getElementById('narratorModeUI').style.display = voiceMode === 'narrator' ? 'block' : 'none';
    document.getElementById('voiceModeUI').style.display = voiceMode === 'voice' ? 'block' : 'none';
  } else {
    parsedEmotionChunks = null;
    speakerMap = {};
    clearParse();
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
  }
  parsedEmotionChunks = null;
  clearParse();
  updateParseVoiceBtnVisibility();
}

// ── Clear & Text Input ────────────────────────────────

function clearParse() {
  parsedEmotionChunks = null;
  const av = document.getElementById('annotatedView');
  if (av) { av.style.display = 'none'; av.innerHTML = ''; }
  const ti = document.getElementById('textInput');
  if (ti) ti.style.display = '';
  const ep = document.getElementById('emotionPreview');
  if (ep) { ep.style.display = 'none'; ep.innerHTML = ''; }
}

function onTextInput() {
  const av = document.getElementById('annotatedView');
  if (av && av.style.display !== 'none') {
    av.style.display = 'none';
    av.innerHTML = '';
    document.getElementById('textInput').style.display = '';
    parsedEmotionChunks = null;
  }
  updateCount();
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
        content: `Identify all distinct speakers in this text. Include "Narrator" for non-dialogue. For each speaker, guess their gender/personality from context.

Reply with JSON only, no markdown:
{"speakers": [{"name": "Narrator", "hint": "calm authoritative male"}, {"name": "Character Name", "hint": "young energetic female"}]}

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
  if (map['Narrator']) map['Narrator'] = 'onyx';
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
      const isNarr = s.name === 'Narrator';
      return `<div class="speaker-row">
        <div class="speaker-dot" style="background:${color};"></div>
        <div class="speaker-name${isNarr ? ' is-narrator' : ''}">${s.name}</div>
        ${voiceSelectHTML(s.name, voice)}
      </div>`;
    }).join('')
  }</div>`;
}

// ── Render Annotated Views ────────────────────────────

function renderEmotionPreview(chunks) {
  const textarea = document.getElementById('textInput');
  const av = document.getElementById('annotatedView');
  textarea.style.display = 'none';
  av.style.display = 'block';
  av.innerHTML = `<div class="annotated-view">${
    chunks.map(c => {
      let tag = '';
      if (voicePlusEnabled && voiceMode === 'voice' && c.speaker) {
        const color = VOICE_COLORS[c.voice] || '#8a877f';
        tag = `<span style="font-family:'DM Mono',monospace;font-size:9px;color:${color};margin-left:6px;">◆ ${c.speaker}</span>`;
      } else if (voicePlusEnabled && voiceMode === 'narrator') {
        const isD = isDialogue(c.text);
        tag = `<span style="font-family:'DM Mono',monospace;font-size:9px;color:${isD?'var(--accent)':'var(--text-muted)'};margin-left:6px;">${isD?'◆ DIALOGUE':'○ NARRATOR'}</span>`;
      }
      return `
      <div class="annotated-chunk">
        <div class="emotion-pill">✦ ${c.emotion.toUpperCase()}${tag}</div>
        <div class="emotion-instr">${c.instruction}</div>
        <div class="annotated-text">${c.text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
      </div>`;
    }).join('')
  }</div>
  <button class="clear-parse" onclick="clearParse()">× Clear &amp; edit text</button>`;
}

function renderVoiceAnnotation(segments) {
  const textarea = document.getElementById('textInput');
  const av = document.getElementById('annotatedView');
  textarea.style.display = 'none';
  av.style.display = 'block';
  av.innerHTML = `<div class="annotated-view">${
    segments.map(s => {
      const color = VOICE_COLORS[s.voice] || '#8a877f';
      const voiceName = VOICE_LABELS[s.voice] || s.voice;
      return `
      <div class="annotated-chunk">
        <div class="emotion-pill" style="color:${color};border-color:${color}33;background:${color}11;">
          ◆ ${s.speaker} <span style="opacity:0.6;font-size:9px;">· ${voiceName}</span>
        </div>
        <div class="annotated-text">${s.text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
      </div>`;
    }).join('')
  }</div>
  <button class="clear-parse" onclick="clearParse()">× Clear &amp; edit text</button>`;
}

// ── Parse Emotion ─────────────────────────────────────

async function parseEmotion() {
  const text = document.getElementById('textInput').value.trim();
  if (!text) { alert('Paste some text on the Read tab first.'); return; }
  if (!OPENAI_KEY) { alert('No API key — add it in Settings.'); return; }

  const btn = document.getElementById('parseShortcutBtn');
  const content = document.getElementById('parseShortcutContent');
  if (btn) btn.disabled = true;
  parsedEmotionChunks = null;

  const mode = getGranularity();
  const rawSegments = splitByGranularity(text, mode);
  const segments = rawSegments.map(s => typeof s === 'string' ? s : s.text);
  const multiVoiceOn = document.getElementById('multiVoiceToggle')?.checked;

  try {
    // Speaker detection first if in voice mode
    if (multiVoiceOn && voiceMode === 'voice') {
      if (content) content.innerHTML = `<div class="spinner-sm"></div> Detecting speakers…`;
      const speakers = await detectSpeakers(text);
      const autoMap = autoAssignVoices(speakers);
      speakerMap = { ...autoMap, ...speakerMap };
      renderSpeakerTable(speakers, speakerMap);
    }

    const results = [];
    for (let i = 0; i < segments.length; i++) {
      if (content) content.innerHTML = `<div class="spinner-sm"></div> ${i+1}/${segments.length}`;

      // Determine voice
      let segVoice = selectedVoice;
      if (multiVoiceOn) {
        if (voiceMode === 'narrator') {
          const nv = document.getElementById('narratorVoice')?.value || selectedVoice;
          const dv = document.getElementById('dialogueVoice')?.value || selectedVoice;
          segVoice = isDialogue(segments[i]) ? dv : nv;
        } else if (voiceMode === 'voice') {
          const speakerNames = Object.keys(speakerMap).join(', ');
          const speakerRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              max_tokens: 60,
              messages: [{
                role: 'user',
                content: `Who is the primary speaker in this passage? Choose from: ${speakerNames}. Reply with JSON only: {"speaker": "Name", "emotion": "<one word>", "instruction": "<TTS voice instruction max 10 words>"}

Text: ${segments[i].slice(0, 400)}`
              }]
            })
          });
          if (speakerRes.ok) {
            try {
              const sd = await speakerRes.json();
              const sp = JSON.parse(sd.choices[0].message.content.trim().replace(/```json|```/g,''));
              const assignedSpeaker = sp.speaker || 'Narrator';
              segVoice = speakerMap[assignedSpeaker] || selectedVoice;
              results.push({ text: segments[i], emotion: sp.emotion || 'neutral', instruction: sp.instruction || 'read naturally', voice: segVoice, speaker: assignedSpeaker });
              continue;
            } catch(e) {}
          }
        }
      }

      // Standard emotion analysis
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 80,
          messages: [{
            role: 'user',
            content: `Analyse the emotional tone of this passage. Reply with JSON only, no markdown:
{"emotion": "<one word>", "instruction": "<TTS voice instruction, max 12 words>"}

Text: ${segments[i].slice(0, 600)}`
          }]
        })
      });
      if (!res.ok) throw new Error('API error ' + res.status);
      const data = await res.json();
      let parsed;
      try {
        const raw = data.choices[0].message.content.trim().replace(/```json|```/g, '');
        parsed = JSON.parse(raw);
      } catch(e) {
        parsed = { emotion: 'neutral', instruction: 'read naturally and clearly' };
      }
      results.push({ text: segments[i], emotion: parsed.emotion || 'neutral', instruction: parsed.instruction || 'read naturally', voice: segVoice, speaker: null });
    }

    parsedEmotionChunks = results;
    renderEmotionPreview(results);

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
  speakerMap = {};

  try {
    const speakers = await detectSpeakers(text);
    const autoMap = autoAssignVoices(speakers);
    speakerMap = { ...autoMap };
    renderSpeakerTable(speakers, speakerMap);

    content.innerHTML = '<div class="spinner-sm"></div> Assigning…';
    const mode = getGranularity();
    const rawSegments = splitByGranularity(text, mode);
    const segments = rawSegments.map(s => typeof s === 'string' ? s : s.text);
    const speakerNames = Object.keys(speakerMap).join(', ');

    const voiceAnnotations = [];
    for (let i = 0; i < segments.length; i++) {
      content.innerHTML = `<div class="spinner-sm"></div> ${i+1}/${segments.length}`;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 40,
          messages: [{
            role: 'user',
            content: `Who is the primary speaker in this passage? Choose from: ${speakerNames}. Reply with JSON only: {"speaker": "Name"}

Text: ${segments[i].slice(0, 400)}`
          }]
        })
      });
      let speaker = 'Narrator';
      if (res.ok) {
        try {
          const d = await res.json();
          const sp = JSON.parse(d.choices[0].message.content.trim().replace(/```json|```/g,''));
          speaker = sp.speaker || 'Narrator';
        } catch(e) {}
      }
      const voice = speakerMap[speaker] || selectedVoice;
      voiceAnnotations.push({ text: segments[i], speaker, voice });
    }

    parsedEmotionChunks = voiceAnnotations.map(a => ({ text: a.text, emotion: null, instruction: null, voice: a.voice, speaker: a.speaker }));
    renderVoiceAnnotation(voiceAnnotations);

  } catch(err) {
    alert('Voice parse failed: ' + err.message);
  } finally {
    btn.disabled = false;
    content.textContent = '◆ Parse Voice';
  }
}
