async function loadShowcase() {
  const response = await fetch('./assets/showcase.json');
  if (!response.ok) {
    throw new Error(`Failed to load showcase: ${response.status}`);
  }
  return response.json();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function padIndex(index) {
  return String(index).padStart(4, '0');
}

function normalizeGuideText(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .trim();
}

function countLiteral(text, needle) {
  if (!needle) return 0;
  return String(text).split(needle).length - 1;
}

function replaceLiteral(text, needle, replacement) {
  return String(text).split(needle).join(replacement);
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

function renderHero(data) {
  document.querySelector('#hero-snippet').textContent = data.sample.coreSnippet;

  const heroMeta = [
    `v${data.package.version}`,
    'package-exact',
    'static site',
  ];
  document.querySelector('#hero-meta').innerHTML = heroMeta
    .map((item) => `<span class="meta-pill">${escapeHtml(item)}</span>`)
    .join('');

  const proofItems = [
    {
      title: data.sample.proof.roundTripExact ? 'Exact round-trip verified' : 'Round-trip verification failed',
      detail: data.sample.proof.roundTripExact
        ? 'The bundled sample rebuilds package-equal with no content diffs.'
        : 'The bundled sample failed package-equality verification.',
    },
    {
      title: `${data.sample.stats.parts} explicit package parts`,
      detail: `${data.sample.stats.xmlParts} UTF-8 parts and ${data.sample.stats.binaryParts} binary parts are visible in one file.`,
    },
    {
      title: `${data.sample.proof.changedPartCount} parts change in the semantic demo`,
      detail: 'The authored example shows exactly which package parts are touched when transforms compile.',
    },
  ];

  document.querySelector('#hero-proof').innerHTML = proofItems
    .map((item) => `
      <div class="hero__proof-item">
        <span class="proof-mark">+</span>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.detail)}</span>
        </div>
      </div>
    `)
    .join('');
}

function renderPrinciples(data) {
  document.querySelector('#principles').innerHTML = data.principles
    .map((item) => `
      <article class="principle-strip__item">
        <h3>${escapeHtml(item)}</h3>
      </article>
    `)
    .join('');
}

function renderWorkflowBand(data) {
  const parts = [];
  data.workflowModes.forEach((item, index) => {
    parts.push(`
      <article class="workflow-band__node">
        <span class="workflow-band__ext">${escapeHtml(item.ext)}</span>
        <h3>${escapeHtml(item.label)}</h3>
      </article>
    `);
    if (index < data.workflowModes.length - 1) {
      parts.push('<div class="workflow-band__arrow" aria-hidden="true">↔</div>');
    }
  });
  document.querySelector('#workflow-band').innerHTML = parts.join('');
}

function renderUseCases(data) {
  document.querySelector('#use-cases').innerHTML = data.useCases
    .map((item) => `
      <article class="use-case-card">
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.summary)}</p>
      </article>
    `)
    .join('');
}

function renderGuarantees(data) {
  document.querySelector('#guarantees-list').innerHTML = data.guarantees
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
}

function renderMetrics(data) {
  const metrics = [
    ['Package parts', data.sample.stats.parts],
    ['Guide rows', data.sample.stats.paragraphs],
    ['Transforms', data.transforms.length],
    ['Base sample', formatBytes(data.sample.file.bytes)],
    ['Dedocs file', formatBytes(data.sample.dedocs.bytes)],
  ];

  document.querySelector('#metrics').innerHTML = metrics
    .map(([label, value]) => `
      <article class="metric-ribbon__item">
        <strong>${escapeHtml(value)}</strong>
        <span>${escapeHtml(label)}</span>
      </article>
    `)
    .join('');
}

function renderParts(data) {
  document.querySelector('#parts-body').innerHTML = data.sample.parts
    .map((part) => `
      <tr>
        <td>${escapeHtml(part.path)}</td>
        <td>${escapeHtml(part.mediaType)}</td>
        <td>${escapeHtml(part.encoding)}</td>
        <td>${escapeHtml(formatBytes(part.bytes))}</td>
      </tr>
    `)
    .join('');
}

function renderChangedParts(data) {
  document.querySelector('#changed-parts').innerHTML = data.sample.proof.changedParts
    .map((part) => `
      <li>
        <span class="delta-dot" aria-hidden="true"></span>
        <div>
          <strong>${escapeHtml(part.path)}</strong><br>
          <span>${escapeHtml(part.type)}</span>
        </div>
      </li>
    `)
    .join('');
}

function renderCommandExamples(data) {
  document.querySelector('#command-examples').innerHTML = data.commandExamples
    .map((item) => `
      <article class="demo-card">
        <p class="demo-card__label">${escapeHtml(item.label)}</p>
        <h3>${escapeHtml(item.label)}</h3>
        <pre>${escapeHtml(item.command)}</pre>
        <p>${escapeHtml(item.result)}</p>
      </article>
    `)
    .join('');
}

function renderCommands(data) {
  document.querySelector('#commands-list').innerHTML = data.commands
    .map((item) => `
      <article class="command-item">
        <code>${escapeHtml(item.usage)}</code>
        <p>${escapeHtml(item.summary)}</p>
      </article>
    `)
    .join('');

  document.querySelector('#transforms-list').innerHTML = data.transforms
    .map((item) => `
      <article class="command-item">
        <code>${escapeHtml(item.type)}</code>
        <p>${escapeHtml(item.summary)}</p>
        <p>Scope: ${escapeHtml(item.scope)} · Payload: ${escapeHtml(item.payload)}</p>
      </article>
    `)
    .join('');
}

function renderDownloads(data) {
  document.querySelector('#downloads-list').innerHTML = data.downloads
    .map((item) => `
      <article class="download-dock__item">
        <div>
          <h3>${escapeHtml(item.label)}</h3>
          <span>${escapeHtml(formatBytes(item.bytes))}</span>
        </div>
        <a href="${escapeHtml(item.href)}">Download</a>
      </article>
    `)
    .join('');
}

function renderQuickStart(data) {
  document.querySelector('#quick-start').innerHTML = data.quickStart
    .map((item) => `
      <article class="quickstart-card">
        <p class="quickstart-card__label">${escapeHtml(item.title)}</p>
        <h3>${escapeHtml(item.title)}</h3>
        <pre>${escapeHtml(item.command)}</pre>
      </article>
    `)
    .join('');
}

function setupViewer(data) {
  const views = {
    guide: {
      title: 'Generated guide preview',
      text: data.sample.guidePreview.join('\n'),
    },
    authoring: {
      title: 'Authoring commands',
      text: data.sample.authoringSnippet,
    },
    preview: {
      title: 'Guide after transforms',
      text: data.sample.guideAfterTransforms.join('\n'),
    },
    diff: {
      title: 'Changed package parts',
      text: JSON.stringify(data.sample.proof.changedParts, null, 2),
    },
  };

  const tabs = document.querySelector('#viewer-tabs');
  const title = document.querySelector('#viewer-title');
  const code = document.querySelector('#viewer-code');
  const tabOrder = [
    ['guide', 'Guide'],
    ['authoring', 'Authoring'],
    ['preview', 'Preview'],
    ['diff', 'Diff'],
  ];

  function activate(key) {
    for (const button of tabs.querySelectorAll('button')) {
      const active = button.dataset.mode === key;
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    }
    title.textContent = views[key].title;
    code.textContent = views[key].text;
  }

  tabs.innerHTML = tabOrder
    .map(([key, label], index) => `
      <button
        type="button"
        role="tab"
        data-mode="${key}"
        aria-selected="${index === 0 ? 'true' : 'false'}"
        tabindex="${index === 0 ? '0' : '-1'}"
      >${escapeHtml(label)}</button>
    `)
    .join('');

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    activate(button.dataset.mode);
  });

  activate('guide');
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

    if (matches.length === 1) {
      return matches[0].index;
    }
    if (matches.length > 1) {
      throw new Error(`Paragraph selection is ambiguous for ${transform.type}`);
    }
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
  const expectedCount = transform.count === '' || transform.count == null
    ? 1
    : Number(transform.count);

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
      if (!needle) {
        throw new Error('replace-text requires a FIND payload');
      }

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

      const formatParts = [];
      if (transform.bold === 'true') formatParts.push('bold');
      if (transform.italic === 'true') formatParts.push('italic');
      if (transform.underline) formatParts.push(`underline:${transform.underline}`);
      if (transform.color) formatParts.push(`color:${transform.color}`);
      if (transform.highlight) formatParts.push(`highlight:${transform.highlight}`);
      if (transform.superscript === 'true') formatParts.push('superscript');
      if (transform.subscript === 'true') formatParts.push('subscript');

      markParagraph(
        paragraph,
        'changed',
        `format ${transform.match}${formatParts.length ? ` (${formatParts.join(', ')})` : ''}`
      );
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
      paragraphs.splice(
        insertAt,
        0,
        createParagraph(transform.text || '', transform.style || '', 'inserted', ['inserted paragraph'])
      );
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
        .filter((row) => row.trim().length > 0)
        .map((row) => row.split('\t'));

      const inserted = [];
      if (transform.caption) {
        inserted.push(createParagraph(transform.caption, '', 'inserted', ['table caption']));
      }
      rows.forEach((row) => {
        row.forEach((cell) => {
          inserted.push(createParagraph(cell, '', 'inserted', ['table cell']));
        });
      });

      paragraphs.splice(index + 1, 0, ...inserted);
      addTouchedPart(changedParts, 'word/document.xml', 'table insertion');
      return;
    }

    if (transform.type === 'insert-figure-after') {
      const index = findParagraphIndex(paragraphs, transform);
      const caption = transform.caption || '[Figure]';
      paragraphs.splice(index + 1, 0, createParagraph(caption, '', 'inserted', ['figure caption']));
      addTouchedPart(changedParts, 'word/document.xml', 'figure insertion');
      addTouchedPart(changedParts, 'word/_rels/document.xml.rels', 'image relationship');
      addTouchedPart(changedParts, '[Content_Types].xml', 'image content type');
      if (transform.imagePart) {
        addTouchedPart(changedParts, transform.imagePart, 'image payload');
      }
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

function renderPlaygroundPreview(paragraphs) {
  return paragraphs
    .map((paragraph, index) => `
      <article class="playground-line${paragraph.kind ? ` playground-line--${paragraph.kind}` : ''}">
        <div class="playground-line__meta">
          <span class="playground-line__index">${escapeHtml(padIndex(index))}</span>
          ${paragraph.style ? `<span class="playground-line__style">${escapeHtml(paragraph.style)}</span>` : ''}
          ${paragraph.kind ? `<span class="playground-line__flag">${escapeHtml(paragraph.kind)}</span>` : ''}
        </div>
        <p>${escapeHtml(paragraph.text || '[empty paragraph]')}</p>
        ${paragraph.notes.length ? `<div class="playground-line__notes">${paragraph.notes.map((note) => `<span>${escapeHtml(note)}</span>`).join('')}</div>` : ''}
      </article>
    `)
    .join('');
}

function renderPlaygroundParts(items) {
  if (items.length === 0) {
    return '<li class="playground-empty">No package parts would change.</li>';
  }

  return items
    .map((item) => `
      <li>
        <span class="delta-dot" aria-hidden="true"></span>
        <div>
          <strong>${escapeHtml(item.path)}</strong><br>
          <span>${escapeHtml(item.reason)}</span>
        </div>
      </li>
    `)
    .join('');
}

function renderPlaygroundErrors(items) {
  if (items.length === 0) {
    return '<li class="playground-empty">No parse or anchor errors.</li>';
  }

  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

async function copyToClipboard(text, button, successLabel) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const original = button.dataset.resetHtml || button.innerHTML;
      button.dataset.resetHtml = original;
      button.textContent = successLabel;
      window.setTimeout(() => {
        button.innerHTML = original;
      }, 1400);
    }
  } catch (error) {
    if (button) {
      button.textContent = 'Copy failed';
      window.setTimeout(() => {
        button.innerHTML = button.dataset.resetHtml || 'Copy';
      }, 1400);
    }
  }
}

function setupInstallCopy() {
  const button = document.querySelector('#install-command');
  if (!button) return;
  button.addEventListener('click', () => {
    const code = button.querySelector('code');
    copyToClipboard(code ? code.textContent : '', button, 'Copied install command');
  });
}

function setupPlayground(data) {
  const source = data.playground || {};
  const input = document.querySelector('#playground-input');
  const preview = document.querySelector('#playground-preview');
  const parts = document.querySelector('#playground-parts');
  const errors = document.querySelector('#playground-errors');
  const status = document.querySelector('#playground-status');
  const templates = document.querySelector('#playground-templates');
  const note = document.querySelector('#playground-note');
  const reset = document.querySelector('#playground-reset');
  const copy = document.querySelector('#playground-copy');

  if (!input || !preview || !parts || !errors || !status || !templates) return;

  const baseParagraphs = Array.isArray(source.baseParagraphs) ? source.baseParagraphs : [];
  const initialAuthoring = source.initialAuthoring || '';
  input.value = initialAuthoring;
  note.textContent = source.note || '';

  templates.innerHTML = (source.templates || [])
    .map((item, index) => `
      <button
        type="button"
        class="tool-button tool-button--ghost"
        data-template-index="${index}"
      >${escapeHtml(item.label)}</button>
    `)
    .join('');

  function runPlayground() {
    const parsed = parsePlaygroundCommands(input.value);
    const applied = applyPlaygroundTransforms(baseParagraphs, parsed.transforms);
    const allErrors = parsed.errors.concat(applied.errors);

    preview.innerHTML = renderPlaygroundPreview(applied.paragraphs);
    parts.innerHTML = renderPlaygroundParts(applied.changedParts);
    errors.innerHTML = renderPlaygroundErrors(allErrors);
    status.innerHTML = [
      `<span class="meta-pill">${escapeHtml(`${parsed.transforms.length} transforms`)}</span>`,
      `<span class="meta-pill">${escapeHtml(`${applied.changedParts.length} touched parts`)}</span>`,
      `<span class="meta-pill${allErrors.length ? ' meta-pill--warn' : ' meta-pill--ok'}">${escapeHtml(allErrors.length ? `${allErrors.length} issues` : 'valid preview')}</span>`,
    ].join('');
  }

  templates.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-template-index]');
    if (!button) return;

    const template = source.templates[Number(button.dataset.templateIndex)];
    if (!template) return;

    const current = input.value.trim();
    input.value = current ? `${current}\n\n${template.snippet}` : template.snippet;
    runPlayground();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  reset.addEventListener('click', () => {
    input.value = initialAuthoring;
    runPlayground();
  });

  copy.addEventListener('click', () => {
    copyToClipboard(input.value, copy, 'Copied commands');
  });

  input.addEventListener('input', runPlayground);
  runPlayground();
}

function enableEntranceMotion() {
  requestAnimationFrame(() => {
    document.body.classList.add('is-ready');
  });
}

async function main() {
  const data = await loadShowcase();
  renderHero(data);
  renderWorkflowBand(data);
  renderPrinciples(data);
  renderUseCases(data);
  renderGuarantees(data);
  renderMetrics(data);
  renderParts(data);
  renderChangedParts(data);
  renderCommandExamples(data);
  renderCommands(data);
  renderDownloads(data);
  renderQuickStart(data);
  setupViewer(data);
  setupPlayground(data);
  setupInstallCopy();
  enableEntranceMotion();
}

main().catch((error) => {
  const target = document.querySelector('#viewer-code');
  if (target) {
    target.textContent = String(error.message || error);
  }
});
