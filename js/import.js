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

document.addEventListener('click', e => {
  const wrap = document.getElementById('importWrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('importMenu').style.display = 'none';
    document.getElementById('importBtn').classList.remove('open');
  }
});

// ── File Parsing ──────────────────────────────────────

function stripMarkdown(md) {
  return md
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

async function extractPdf(file) {
  if (!window.pdfjsLib) {
    await loadScript('https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (item.str) text += item.str;
      if (item.hasEOL) text += '\n';
    }
    if (text.trim()) pageTexts.push(text.trim());
  }
  return pageTexts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractEpub(file) {
  if (!window.JSZip) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const parser = new DOMParser();

  const containerXml = await zip.file('META-INF/container.xml').async('string');
  const opfPath = parser.parseFromString(containerXml, 'application/xml')
    .querySelector('rootfile').getAttribute('full-path');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const opf = parser.parseFromString(await zip.file(opfPath).async('string'), 'application/xml');
  const title = opf.querySelector('title')?.textContent?.trim() || file.name.replace(/\.[^.]+$/, '');

  const manifest = {};
  opf.querySelectorAll('item').forEach(item => {
    manifest[item.getAttribute('id')] = item.getAttribute('href');
  });

  const chapters = [];
  for (const ref of opf.querySelectorAll('itemref')) {
    const href = manifest[ref.getAttribute('idref')];
    if (!href) continue;
    const cleanHref = href.split('#')[0];
    const entry = zip.file(opfDir + cleanHref) || zip.file(cleanHref);
    if (!entry) continue;
    const doc = parser.parseFromString(await entry.async('string'), 'text/html');
    doc.querySelectorAll('nav, script, style').forEach(el => el.remove());
    const text = extractTextFromDoc(doc.body).trim();
    if (text.length > 50) chapters.push(text);
  }

  return { text: chapters.join('\n\n'), title };
}

async function extractDocx(file) {
  if (!window.JSZip) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const parser = new DOMParser();
  const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  let title = file.name.replace(/\.[^.]+$/, '');
  const coreEntry = zip.file('docProps/core.xml');
  if (coreEntry) {
    const core = parser.parseFromString(await coreEntry.async('string'), 'application/xml');
    const t = core.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]
           || core.querySelector('title');
    if (t?.textContent?.trim()) title = t.textContent.trim();
  }

  const docXml = parser.parseFromString(
    await zip.file('word/document.xml').async('string'), 'application/xml'
  );
  const paragraphs = [];
  for (const p of docXml.getElementsByTagNameNS(WNS, 'p')) {
    let text = '';
    for (const t of p.getElementsByTagNameNS(WNS, 't')) text += t.textContent;
    if (text.trim()) paragraphs.push(text.trim());
  }
  return { text: paragraphs.join('\n\n'), title };
}

function handleFileUpload(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const ext = file.name.split('.').pop().toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, '');

  function setResult(text, title) {
    setTextValue(text);
    document.getElementById('textInput').dataset.title = title;
    onTextInput();
  }

  if (ext === 'pdf') {
    extractPdf(file)
      .then(text => setResult(text, baseName))
      .catch(err => showError('Could not read PDF: ' + err.message));
    return;
  }

  if (ext === 'docx') {
    extractDocx(file)
      .then(({ text, title }) => setResult(text, title))
      .catch(err => showError('Could not read DOCX: ' + err.message));
    return;
  }

  if (ext === 'doc') {
    showError('Legacy .doc format is not supported. Open it in Word and save as .docx first.');
    return;
  }

  if (ext === 'epub') {
    extractEpub(file)
      .then(({ text, title }) => setResult(text, title))
      .catch(err => showError('Could not read EPUB: ' + err.message));
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    const raw = e.target.result;
    let text, title;
    if (ext === 'html' || ext === 'htm') {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      title = doc.querySelector('h1')?.textContent?.trim() || doc.title || baseName;
      text = extractTextFromDoc(extractArticle(doc));
    } else if (ext === 'md' || ext === 'markdown') {
      title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || baseName;
      text = stripMarkdown(raw);
    } else {
      title = baseName;
      text = raw;
    }
    setResult(text, title);
  };
  reader.readAsText(file);
}

// ── URL Fetch ─────────────────────────────────────────

function extractTextFromDoc(el) {
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
  ['script','style','nav','header','footer','aside','form','noscript','iframe',
   'button','select','svg','canvas','video','audio'].forEach(tag => {
    doc.querySelectorAll(tag).forEach(el => el.remove());
  });

  const NOISE = /\b(ad|ads|advert|advertisement|banner|promo|sponsor|social|share|sharing|related|recommend|trending|popular|comment|discuss|cookie|gdpr|consent|newsletter|subscribe|signup|sidebar|widget|flyout|popup|modal|overlay|toolbar|breadcrumb|pagination|tag-cloud|author-bio|bio-box|read-next|also-read|more-from|outbrain|taboola|sticky|masthead)\b/i;
  doc.querySelectorAll('[class],[id]').forEach(el => {
    const str = (el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '');
    if (NOISE.test(str)) el.remove();
  });

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
    const res = await fetch('https://r.jina.ai/' + url, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error('Failed to fetch page');
    const data = await res.json();
    const title = data.data?.title || url;
    const text = stripMarkdown(data.data?.content || '');
    if (text.length < 100) throw new Error('Could not extract article text from this page');
    setTextValue(text);
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
