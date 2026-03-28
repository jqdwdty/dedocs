async function loadShowcase() {
  const response = await fetch('./assets/showcase.json');
  if (!response.ok) {
    throw new Error(`Failed to load showcase: ${response.status}`);
  }
  return response.json();
}

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizeGuideText(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function padIndex(index) {
  return String(index).padStart(4, '0');
}

function unescapeAttr(value) {
  return String(value).replace(/\\(["\\nrt])/g, (_, ch) => {
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    if (ch === 't') return '\t';
    return ch;
  });
}

function parseAttrs(source) {
  const attrs = {};
  let index = 0;

  function skipWs() {
    while (index < source.length && /\s/.test(source[index])) index += 1;
  }

  while (index < source.length) {
    skipWs();
    if (index >= source.length) break;

    const keyMatch = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(index));
    if (!keyMatch) {
      throw new Error(`Invalid attribute list near: ${source.slice(index, index + 40)}`);
    }
    const key = keyMatch[0];
    index += key.length;
    skipWs();

    if (source[index] !== '=') {
      throw new Error(`Expected '=' after attribute ${key}`);
    }
    index += 1;
    skipWs();

    if (source[index] !== '"') {
      throw new Error(`Expected quoted value for attribute ${key}`);
    }
    index += 1;

    let raw = '';
    while (index < source.length) {
      const ch = source[index];
      if (ch === '\\') {
        if (index + 1 >= source.length) {
          throw new Error(`Unterminated escape in attribute ${key}`);
        }
        raw += source.slice(index, index + 2);
        index += 2;
        continue;
      }
      if (ch === '"') break;
      raw += ch;
      index += 1;
    }

    if (source[index] !== '"') {
      throw new Error(`Unterminated quoted value for attribute ${key}`);
    }
    index += 1;
    attrs[key] = unescapeAttr(raw);

    skipWs();
    if (index >= source.length) break;
    if (source[index] !== ',') {
      throw new Error(`Expected ',' after attribute ${key}`);
    }
    index += 1;
  }

  return attrs;
}

function parseDelimitedBlock(body, label) {
  const pattern = new RegExp(`<<<${label}\\r?\\n([\\s\\S]*?)\\r?\\n${label}`);
  const match = pattern.exec(body);
  if (!match) {
    throw new Error(`Missing ${label} block`);
  }
  return match[1];
}

function parsePlaygroundCommands(text) {
  const transforms = [];
  const errors = [];
  const input = String(text || '');
  const blockRe = /\\([a-z-]+)\[([\s\S]*?)\]\s*([\s\S]*?)\\end\{\1\}/g;
  let match;
  let lastEnd = 0;

  while ((match = blockRe.exec(input)) !== null) {
    const [fullMatch, type, rawAttrs, rawBody] = match;
    const gap = input.slice(lastEnd, match.index);
    if (gap.trim()) {
      errors.push(`Unparsed content before ${type}`);
    }
    lastEnd = match.index + fullMatch.length;

    try {
      const attrs = parseAttrs(rawAttrs);
      const transform = { type, ...attrs };

      if (type === 'replace-text') {
        transform.find = parseDelimitedBlock(rawBody, 'FIND');
        transform.replace = parseDelimitedBlock(rawBody, 'WITH');
      } else if (
        type === 'insert-comment'
        || type === 'insert-footnote'
        || type === 'replace-paragraph'
        || type === 'insert-paragraph-after'
        || type === 'insert-paragraph-before'
      ) {
        transform.text = parseDelimitedBlock(rawBody, 'TEXT');
      } else if (type === 'insert-table-after') {
        transform.tsv = parseDelimitedBlock(rawBody, 'TSV');
      } else if (
        type !== 'format-text'
        && type !== 'insert-figure-after'
        && type !== 'delete-paragraph'
      ) {
        throw new Error(`Unsupported transform type: ${type}`);
      }

      transforms.push(transform);
    } catch (error) {
      errors.push(`${type}: ${error.message || error}`);
    }
  }

  if (input.slice(lastEnd).trim()) {
    errors.push('Trailing content could not be parsed');
  }

  return { transforms, errors };
}

function countLiteral(text, needle) {
  if (!needle) return 0;
  return String(text).split(needle).length - 1;
}

function replaceLiteral(text, needle, replacement) {
  return String(text).split(needle).join(replacement);
}

function createParagraph(text, style, kind, notes) {
  return {
    text: normalizeGuideText(text),
    style: style || '',
    kind: kind || '',
    notes: Array.isArray(notes) ? notes.slice() : [],
  };
}

function cloneParagraphs(baseParagraphs) {
  return baseParagraphs.map((paragraph) => ({
    text: paragraph.text,
    style: paragraph.style || '',
    kind: '',
    notes: [],
  }));
}

function addTouchedPart(changedParts, path, reason) {
  if (!changedParts.has(path)) {
    changedParts.set(path, new Set());
  }
  changedParts.get(path).add(reason);
}

function markParagraph(paragraph, kind, note) {
  if (kind === 'inserted' || paragraph.kind !== 'inserted') {
    paragraph.kind = kind;
  }
  if (note && !paragraph.notes.includes(note)) {
    paragraph.notes.push(note);
  }
}

function matchesExpectation(paragraph, transform) {
  if (transform.expectedText != null && transform.expectedText !== '') {
    if (paragraph.text !== normalizeGuideText(transform.expectedText)) return false;
  }
  if (transform.expectedStyle != null && transform.expectedStyle !== '') {
    if ((paragraph.style || '') !== transform.expectedStyle) return false;
  }
  return true;
}

function findParagraphIndex(paragraphs, transform) {
  let candidateIndex = -1;

  if (transform.index != null && transform.index !== '') {
    const numericIndex = Number(transform.index);
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < paragraphs.length) {
      candidateIndex = numericIndex;
      if (matchesExpectation(paragraphs[candidateIndex], transform)) {
        return candidateIndex;
      }
    }
  }

  if (
    (transform.expectedText != null && transform.expectedText !== '')
    || (transform.expectedStyle != null && transform.expectedStyle !== '')
  ) {
    const matches = paragraphs
      .map((paragraph, index) => ({ paragraph, index }))
      .filter(({ paragraph }) => matchesExpectation(paragraph, transform));

    if (matches.length === 1) return matches[0].index;
    if (matches.length > 1) throw new Error(`Paragraph selection is ambiguous for ${transform.type}`);
  }

  if (candidateIndex === -1) {
    throw new Error(`Paragraph ${transform.index || '?'} not found`);
  }

  throw new Error(`Paragraph ${transform.index} no longer matches its expectations`);
}

function splitParagraphMatch(paragraph, transform) {
  const match = transform.match || '';
  if (!match) {
    throw new Error(`${transform.type} requires a non-empty match`);
  }

  const actualMatches = countLiteral(paragraph.text, match);
  const expectedCount = transform.count === '' || transform.count == null ? 1 : Number(transform.count);
  if (!Number.isInteger(expectedCount) || expectedCount < 1) {
    throw new Error(`Invalid match count for ${transform.type}`);
  }
  if (actualMatches !== expectedCount) {
    throw new Error(`${transform.type} expected ${expectedCount} match(es) but found ${actualMatches}`);
  }
}

function applyPlaygroundTransforms(baseParagraphs, transforms) {
  const paragraphs = cloneParagraphs(baseParagraphs);
  const changedParts = new Map();
  const errors = [];

  function applyOne(transform) {
    if (transform.type === 'replace-text') {
      const needle = transform.find || '';
      const replacement = transform.replace || '';
      const expectedCount = transform.count === '' || transform.count == null ? 1 : Number(transform.count);
      if (!needle) throw new Error('replace-text requires a FIND payload');

      let matchCount = 0;
      paragraphs.forEach((paragraph) => {
        matchCount += countLiteral(paragraph.text, needle);
      });
      if (!Number.isInteger(expectedCount) || expectedCount < 1) {
        throw new Error('replace-text requires a valid count');
      }
      if (matchCount !== expectedCount) {
        throw new Error(`replace-text expected ${expectedCount} match(es) but found ${matchCount}`);
      }

      paragraphs.forEach((paragraph) => {
        if (paragraph.text.includes(needle)) {
          paragraph.text = replaceLiteral(paragraph.text, needle, replacement);
          markParagraph(paragraph, 'changed', 'text replacement');
        }
      });
      addTouchedPart(changedParts, 'word/document.xml', 'literal text edit');
      return;
    }

    if (transform.type === 'format-text') {
      const index = findParagraphIndex(paragraphs, transform);
      const paragraph = paragraphs[index];
      splitParagraphMatch(paragraph, transform);

      const tokens = [];
      if (transform.bold === 'true') tokens.push('bold');
      if (transform.italic === 'true') tokens.push('italic');
      if (transform.color) tokens.push(`color:${transform.color}`);
      if (transform.highlight) tokens.push(`highlight:${transform.highlight}`);
      markParagraph(paragraph, 'changed', `format ${transform.match}${tokens.length ? ` (${tokens.join(', ')})` : ''}`);
      addTouchedPart(changedParts, 'word/document.xml', 'inline formatting');
      return;
    }

    if (transform.type === 'insert-comment') {
      const index = findParagraphIndex(paragraphs, transform);
      const paragraph = paragraphs[index];
      splitParagraphMatch(paragraph, transform);
      markParagraph(paragraph, 'changed', `comment: ${normalizeGuideText(transform.text || '')}`);
      addTouchedPart(changedParts, 'word/document.xml', 'comment anchors');
      addTouchedPart(changedParts, 'word/comments.xml', 'comment body');
      addTouchedPart(changedParts, 'word/_rels/document.xml.rels', 'comment relationship');
      addTouchedPart(changedParts, '[Content_Types].xml', 'comment content type');
      return;
    }

    if (transform.type === 'insert-footnote') {
      const index = findParagraphIndex(paragraphs, transform);
      const paragraph = paragraphs[index];
      splitParagraphMatch(paragraph, transform);
      markParagraph(paragraph, 'changed', `footnote: ${normalizeGuideText(transform.text || '')}`);
      addTouchedPart(changedParts, 'word/document.xml', 'footnote reference');
      addTouchedPart(changedParts, 'word/footnotes.xml', 'footnote body');
      addTouchedPart(changedParts, 'word/_rels/document.xml.rels', 'footnote relationship');
      addTouchedPart(changedParts, '[Content_Types].xml', 'footnote content type');
      return;
    }

    if (transform.type === 'replace-paragraph') {
      const index = findParagraphIndex(paragraphs, transform);
      const paragraph = paragraphs[index];
      paragraph.text = normalizeGuideText(transform.text || '');
      if (transform.style) paragraph.style = transform.style;
      markParagraph(paragraph, 'changed', 'paragraph replaced');
      addTouchedPart(changedParts, 'word/document.xml', 'paragraph replacement');
      return;
    }

    if (transform.type === 'insert-paragraph-before' || transform.type === 'insert-paragraph-after') {
      const index = findParagraphIndex(paragraphs, transform);
      const insertAt = transform.type === 'insert-paragraph-before' ? index : index + 1;
      paragraphs.splice(insertAt, 0, createParagraph(transform.text || '', transform.style || '', 'inserted', ['inserted paragraph']));
      addTouchedPart(changedParts, 'word/document.xml', 'paragraph insertion');
      return;
    }

    if (transform.type === 'delete-paragraph') {
      const index = findParagraphIndex(paragraphs, transform);
      paragraphs.splice(index, 1);
      addTouchedPart(changedParts, 'word/document.xml', 'paragraph deletion');
      return;
    }

    if (transform.type === 'insert-table-after') {
      const index = findParagraphIndex(paragraphs, transform);
      const rows = String(transform.tsv || '')
        .split(/\r?\n/)
        .filter((row) => row.trim())
        .map((row) => row.split('\t'));
      const inserted = [];
      if (transform.caption) inserted.push(createParagraph(transform.caption, '', 'inserted', ['table caption']));
      rows.forEach((row) => row.forEach((cell) => inserted.push(createParagraph(cell, '', 'inserted', ['table cell']))));
      paragraphs.splice(index + 1, 0, ...inserted);
      addTouchedPart(changedParts, 'word/document.xml', 'table insertion');
      return;
    }

    if (transform.type === 'insert-figure-after') {
      const index = findParagraphIndex(paragraphs, transform);
      paragraphs.splice(index + 1, 0, createParagraph(transform.caption || '[Figure]', '', 'inserted', ['figure caption']));
      addTouchedPart(changedParts, 'word/document.xml', 'figure insertion');
      addTouchedPart(changedParts, 'word/_rels/document.xml.rels', 'image relationship');
      addTouchedPart(changedParts, '[Content_Types].xml', 'image content type');
      if (transform.imagePart) addTouchedPart(changedParts, transform.imagePart, 'image payload');
      return;
    }

    throw new Error(`Unsupported transform type: ${transform.type}`);
  }

  transforms.forEach((transform) => {
    try {
      applyOne(transform);
    } catch (error) {
      errors.push(`${transform.type}: ${error.message || error}`);
    }
  });

  return {
    paragraphs,
    errors,
    changedParts: Array.from(changedParts.entries()).map(([path, reasons]) => ({
      path,
      reason: Array.from(reasons).join(' · '),
    })),
  };
}

function renderWordPreview(paragraphs, limit) {
  return paragraphs.slice(0, limit).map((paragraph, index) => {
    const text = escapeHtml(paragraph.text || '');
    const style = paragraph.style || '';
    if (style === 'Heading1') {
      const tag = index === 0 ? 'h1' : 'h2';
      return `<${tag}>${text}</${tag}>`;
    }
    if (style === 'Heading2') return `<h3>${text}</h3>`;
    return `<p>${text}</p>`;
  }).join('');
}

function renderTransformList(items) {
  return items.map((item) => `
    <li>
      <strong>${escapeHtml(item.type)}</strong><br>
      <span>${escapeHtml(item.summary)}</span>
    </li>
  `).join('');
}

function renderPreviewLines(paragraphs, limit) {
  return paragraphs.slice(0, limit).map((paragraph, index) => `
    <div class="preview-line${paragraph.kind ? ` ${paragraph.kind}` : ''}">
      <div class="preview-meta">
        <span class="preview-chip">${escapeHtml(padIndex(index))}</span>
        ${paragraph.style ? `<span class="preview-chip">${escapeHtml(paragraph.style)}</span>` : ''}
        ${paragraph.kind ? `<span class="preview-chip">${escapeHtml(paragraph.kind)}</span>` : ''}
      </div>
      <p>${escapeHtml(paragraph.text || '[empty paragraph]')}</p>
      ${paragraph.notes && paragraph.notes.length ? `<div class="preview-notes">${paragraph.notes.map((note) => `<span>${escapeHtml(note)}</span>`).join('')}</div>` : ''}
    </div>
  `).join('');
}

function setupNav() {
  const toggle = qs('.nav-toggle');
  const links = qs('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  const current = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  qsa('.nav-links a').forEach((link) => {
    const href = (link.getAttribute('href') || '').replace('./', '');
    if (href.toLowerCase() === current) {
      link.classList.add('active');
    }
  });
}

function setupReveal() {
  const items = qsa('.reveal');
  if (items.length === 0) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -48px 0px' });

  items.forEach((item) => observer.observe(item));
}

async function copyText(text, button, label) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.dataset.resetText || button.textContent;
    button.dataset.resetText = original;
    button.textContent = label;
    window.setTimeout(() => {
      button.textContent = original;
    }, 1400);
  } catch {
    const original = button.dataset.resetText || button.textContent;
    button.textContent = 'Copy failed';
    window.setTimeout(() => {
      button.textContent = original;
    }, 1400);
  }
}

function setupCopyButtons() {
  qsa('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = qs(button.getAttribute('data-copy'));
      if (!target) return;
      copyText(target.textContent || '', button, 'Copied');
    });
  });
}

function setupTabs() {
  const buttons = qsa('[data-tab]');
  if (buttons.length === 0) return;

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.getAttribute('data-tab');
      buttons.forEach((other) => other.classList.toggle('active', other === button));
      qsa('[data-panel]').forEach((panel) => {
        panel.classList.toggle('active', panel.getAttribute('data-panel') === name);
      });
    });
  });
}

function initHome(data) {
  if (document.body.dataset.page !== 'home') return;

  const heroCode = qs('#heroCode');
  const heroPreview = qs('#heroPreview');
  const formatCode = qs('#formatCode');
  const formatPreview = qs('#formatPreview');
  const transformsList = qs('#homeTransforms');

  if (heroCode) heroCode.textContent = data.sample.coreSnippet;
  if (heroPreview) heroPreview.innerHTML = renderWordPreview(data.playground.baseParagraphs, 6);
  if (formatCode) formatCode.textContent = data.sample.authoringSnippet;

  if (formatPreview) {
    const parsed = parsePlaygroundCommands(data.playground.initialAuthoring);
    const applied = applyPlaygroundTransforms(data.playground.baseParagraphs, parsed.transforms);
    formatPreview.innerHTML = renderPreviewLines(applied.paragraphs, 8);
  }

  if (transformsList) {
    transformsList.innerHTML = renderTransformList(data.transforms.slice(0, 6));
  }
}

function initExamples(data) {
  if (document.body.dataset.page !== 'examples') return;

  const tags = qs('#examplesTags');
  const sampleCode = qs('#examplesSampleCode');
  const samplePreview = qs('#examplesSamplePreview');
  const authoringCode = qs('#examplesAuthoringCode');
  const authoringPreview = qs('#examplesAuthoringPreview');
  const partsBody = qs('#examplesPartsBody');
  const changedParts = qs('#examplesChangedParts');
  const downloads = qs('#examplesDownloads');

  if (tags) {
    tags.innerHTML = [
      `<span class="tag tag-green">${escapeHtml(`${data.sample.stats.parts} parts`)}</span>`,
      `<span class="tag tag-teal">${escapeHtml(`${data.sample.stats.paragraphs} guide rows`)}</span>`,
      `<span class="tag tag-amber">${escapeHtml(`${data.sample.proof.changedPartCount} changed parts`)}</span>`,
      `<span class="tag tag-green">${escapeHtml(data.sample.proof.roundTripExact ? 'round-trip exact' : 'round-trip differs')}</span>`,
    ].join('');
  }

  if (sampleCode) sampleCode.textContent = data.sample.coreSnippet;
  if (samplePreview) samplePreview.innerHTML = renderWordPreview(data.playground.baseParagraphs, 7);
  if (authoringCode) authoringCode.textContent = data.sample.authoringSnippet;

  if (authoringPreview) {
    const parsed = parsePlaygroundCommands(data.playground.initialAuthoring);
    const applied = applyPlaygroundTransforms(data.playground.baseParagraphs, parsed.transforms);
    authoringPreview.innerHTML = renderPreviewLines(applied.paragraphs, 12);
  }

  if (partsBody) {
    partsBody.innerHTML = data.sample.parts.map((part) => `
      <tr>
        <td>${escapeHtml(part.path)}</td>
        <td>${escapeHtml(part.mediaType)}</td>
        <td>${escapeHtml(part.encoding)}</td>
        <td>${escapeHtml(formatBytes(part.bytes))}</td>
      </tr>
    `).join('');
  }

  if (changedParts) {
    changedParts.innerHTML = data.sample.proof.changedParts.map((part) => `
      <li>
        <strong>${escapeHtml(part.path)}</strong><br>
        <span>${escapeHtml(part.type)}</span>
      </li>
    `).join('');
  }

  if (downloads) {
    downloads.innerHTML = data.downloads.map((item) => `
      <li>
        <a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a><br>
        <span>${escapeHtml(formatBytes(item.bytes))}</span>
      </li>
    `).join('');
  }
}

function initCli(data) {
  if (document.body.dataset.page !== 'cli') return;

  const commandList = qs('#cliCommands');
  const transformList = qs('#cliTransforms');

  if (commandList) {
    commandList.innerHTML = data.commands.map((item) => `
      <section class="api-entry" id="${escapeHtml(item.name)}">
        <div class="api-entry-header">${escapeHtml(item.usage)}</div>
        <div class="api-entry-body">
          <p>${escapeHtml(item.summary)}</p>
        </div>
      </section>
    `).join('');
  }

  if (transformList) {
    transformList.innerHTML = data.transforms.map((item) => `
      <div class="feature-cell">
        <span class="feature-tag">${escapeHtml(item.scope)}</span>
        <h3>${escapeHtml(item.type)}</h3>
        <p>${escapeHtml(item.summary)}</p>
      </div>
    `).join('');
  }
}

function initFormat(data) {
  if (document.body.dataset.page !== 'format') return;

  const shape = qs('#formatShape');
  const transforms = qs('#formatTransforms');
  const guarantees = qs('#formatGuarantees');

  if (shape) shape.textContent = data.sample.coreSnippet;

  if (transforms) {
    transforms.innerHTML = data.transforms.map((item) => `
      <div class="feature-cell">
        <span class="feature-tag">${escapeHtml(item.payload)}</span>
        <h3>${escapeHtml(item.type)}</h3>
        <p>${escapeHtml(item.summary)}</p>
      </div>
    `).join('');
  }

  if (guarantees) {
    guarantees.innerHTML = data.guarantees.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  }
}

function initPlayground(data) {
  if (document.body.dataset.page !== 'playground') return;

  const input = qs('#playgroundInput');
  const preview = qs('#playgroundPreview');
  const parts = qs('#playgroundParts');
  const errors = qs('#playgroundErrors');
  const status = qs('#playgroundStatus');
  const note = qs('#playgroundNote');
  const templateButtons = qs('#templateButtons');
  const resetButton = qs('#resetPlayground');
  const copyButton = qs('#copyPlayground');

  if (!input || !preview || !parts || !errors || !status || !templateButtons) return;

  const baseParagraphs = Array.isArray(data.playground.baseParagraphs) ? data.playground.baseParagraphs : [];
  const initialText = data.playground.initialAuthoring || '';
  input.value = initialText;
  if (note) note.textContent = data.playground.note || '';

  templateButtons.innerHTML = data.playground.templates.map((item, index) => `
    <button type="button" class="btn btn-secondary btn-small" data-template-index="${index}">${escapeHtml(item.label)}</button>
  `).join('');

  function render() {
    const parsed = parsePlaygroundCommands(input.value);
    const applied = applyPlaygroundTransforms(baseParagraphs, parsed.transforms);
    const allErrors = parsed.errors.concat(applied.errors);

    preview.innerHTML = renderPreviewLines(applied.paragraphs, applied.paragraphs.length);
    parts.innerHTML = applied.changedParts.length === 0
      ? '<li class="playground-empty">No package parts would change.</li>'
      : applied.changedParts.map((item) => `
          <li>
            <strong>${escapeHtml(item.path)}</strong><br>
            <span>${escapeHtml(item.reason)}</span>
          </li>
        `).join('');

    errors.innerHTML = allErrors.length === 0
      ? '<li class="playground-empty">No parse or anchor errors.</li>'
      : allErrors.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

    status.innerHTML = [
      `<span class="status-chip">${escapeHtml(`${parsed.transforms.length} transforms`)}</span>`,
      `<span class="status-chip">${escapeHtml(`${applied.changedParts.length} touched parts`)}</span>`,
      `<span class="status-chip ${allErrors.length ? 'warn' : 'ok'}">${escapeHtml(allErrors.length ? `${allErrors.length} issues` : 'valid preview')}</span>`,
    ].join('');
  }

  templateButtons.addEventListener('click', (event) => {
    const button = event.target.closest('[data-template-index]');
    if (!button) return;
    const template = data.playground.templates[Number(button.dataset.templateIndex)];
    if (!template) return;
    const current = input.value.trim();
    input.value = current ? `${current}\n\n${template.snippet}` : template.snippet;
    render();
    input.focus();
  });

  resetButton.addEventListener('click', () => {
    input.value = initialText;
    render();
  });

  copyButton.addEventListener('click', () => {
    copyText(input.value, copyButton, 'Copied');
  });

  input.addEventListener('input', render);
  render();
}

async function main() {
  setupNav();
  setupReveal();
  setupCopyButtons();
  setupTabs();

  const data = await loadShowcase();
  initHome(data);
  initExamples(data);
  initCli(data);
  initFormat(data);
  initPlayground(data);
}

main().catch((error) => {
  console.error(error);
});
