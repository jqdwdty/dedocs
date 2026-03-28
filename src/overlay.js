'use strict';

const path = require('path');
const {
  extractDocumentParagraphs,
  normalizeGuideText,
} = require('./guide');

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const REL_FOOTNOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const CT_COMMENTS = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const CT_FOOTNOTES = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const DEFAULT_AUTHOR = 'Dedocs';
const DEFAULT_DATE = '2000-01-01T00:00:00Z';
const EMU_PER_PIXEL = 9525;

const EMPTY_COMMENTS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + `<w:comments xmlns:w="${NS_W}"></w:comments>`;

const EMPTY_FOOTNOTES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + `<w:footnotes xmlns:w="${NS_W}">`
  + '<w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
  + '<w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
  + '</w:footnotes>';

function countLiteral(text, needle) {
  if (needle === '') {
    throw new Error('Literal match cannot be empty');
  }
  return text.split(needle).length - 1;
}

function replaceLiteral(text, needle, replacement) {
  return text.split(needle).join(replacement);
}

function clonePart(part) {
  return {
    ...part,
    buffer: Buffer.from(part.buffer),
  };
}

function escapeXmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttr(value) {
  return escapeXmlText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truthy(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function clonePackage(pkg) {
  return {
    ...pkg,
    parts: pkg.parts.map(clonePart),
  };
}

function buildRunXml(text, rPrXml = '') {
  if (text === '') return '';
  const pieces = String(text).split('\n');
  const chunks = [];

  for (let i = 0; i < pieces.length; i += 1) {
    chunks.push(`<w:r>${rPrXml}<w:t xml:space="preserve">${escapeXmlText(pieces[i])}</w:t></w:r>`);
    if (i < pieces.length - 1) {
      chunks.push('<w:r><w:br/></w:r>');
    }
  }

  return chunks.join('');
}

function buildParagraphRuns(text) {
  return buildRunXml(String(text == null ? '' : text));
}

function extractParagraphProperties(paragraphXml) {
  const match = /<w:pPr\b[\s\S]*?<\/w:pPr>|<w:pPr\b[^>]*\/>/.exec(paragraphXml || '');
  return match ? match[0] : '';
}

function withParagraphStyle(pPrXml, style) {
  if (!style) return pPrXml;

  const styleXml = `<w:pStyle w:val="${escapeXmlAttr(style)}"/>`;
  if (!pPrXml) {
    return `<w:pPr>${styleXml}</w:pPr>`;
  }

  if (/^<w:pPr\b[^>]*\/>$/.test(pPrXml)) {
    const attrs = /^<w:pPr\b([^>]*)\/>$/.exec(pPrXml);
    return `<w:pPr${attrs ? attrs[1] : ''}>${styleXml}</w:pPr>`;
  }

  if (/<w:pStyle\b/.test(pPrXml)) {
    return pPrXml.replace(/<w:pStyle\b[^>]*\/>|<w:pStyle\b[\s\S]*?<\/w:pStyle>/, styleXml);
  }

  return pPrXml.replace(/<w:pPr\b([^>]*)>/, `<w:pPr$1>${styleXml}`);
}

function buildParagraphXml(sourceParagraphXml, text, style, opts = {}) {
  const preserveProperties = opts.preserveProperties !== false;
  const openTagMatch = /^<w:p\b[^>]*>/.exec(sourceParagraphXml || '');
  const openTag = openTagMatch ? openTagMatch[0] : '<w:p>';

  let pPrXml = preserveProperties ? extractParagraphProperties(sourceParagraphXml) : '';
  if (style) {
    pPrXml = withParagraphStyle(pPrXml, style);
  }

  return `${openTag}${pPrXml}${buildParagraphRuns(text)}</w:p>`;
}

function buildParagraphXmlFromInnerXml(sourceParagraphXml, innerXml, style, opts = {}) {
  const preserveProperties = opts.preserveProperties !== false;
  const openTagMatch = /^<w:p\b[^>]*>/.exec(sourceParagraphXml || '');
  const openTag = openTagMatch ? openTagMatch[0] : '<w:p>';

  let pPrXml = preserveProperties ? extractParagraphProperties(sourceParagraphXml) : '';
  if (style) {
    pPrXml = withParagraphStyle(pPrXml, style);
  }

  return `${openTag}${pPrXml}${innerXml}</w:p>`;
}

function parseParagraphIndex(rawIndex) {
  const value = Number(rawIndex);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid paragraph index: ${rawIndex}`);
  }
  return value;
}

function assertParagraphExpectation(transform, paragraph) {
  if (transform.expectedText != null && transform.expectedText !== '') {
    const expected = normalizeGuideText(transform.expectedText);
    if (paragraph.text !== expected) {
      throw new Error(
        `Paragraph ${transform.index} text mismatch. Expected "${expected}" but found "${paragraph.text}"`
      );
    }
  }

  if (transform.expectedStyle != null && transform.expectedStyle !== '') {
    if (paragraph.style !== transform.expectedStyle) {
      throw new Error(
        `Paragraph ${transform.index} style mismatch. Expected "${transform.expectedStyle}" but found "${paragraph.style}"`
      );
    }
  }
}

function paragraphMatchesExpectation(paragraph, transform) {
  if (transform.expectedText != null && transform.expectedText !== '') {
    if (paragraph.text !== normalizeGuideText(transform.expectedText)) {
      return false;
    }
  }
  if (transform.expectedStyle != null && transform.expectedStyle !== '') {
    if (paragraph.style !== transform.expectedStyle) {
      return false;
    }
  }
  return true;
}

function documentPartPath(transform) {
  return transform.part || 'word/document.xml';
}

function getUtf8Part(pkg, partPath) {
  const part = pkg.parts.find(candidate => candidate.path === partPath);
  if (!part) {
    throw new Error(`Transform target part not found: ${partPath}`);
  }
  if (part.encoding !== 'utf8') {
    throw new Error(`Transform target must be utf8: ${partPath}`);
  }
  return part;
}

function ensureUtf8Part(pkg, partPath, mediaType, defaultText) {
  let part = pkg.parts.find(candidate => candidate.path === partPath);
  if (part) {
    if (part.encoding !== 'utf8') {
      throw new Error(`Part ${partPath} must be utf8 for semantic transforms`);
    }
    return part;
  }

  part = {
    path: partPath,
    mediaType: mediaType || 'application/xml',
    encoding: 'utf8',
    buffer: Buffer.from(defaultText, 'utf8'),
    text: defaultText,
  };
  pkg.parts.push(part);
  return part;
}

function updatePartText(part, text) {
  part.buffer = Buffer.from(text, 'utf8');
  part.text = text;
}

function findParagraph(documentXml, transform) {
  const paragraphs = extractDocumentParagraphs(documentXml);
  let paragraph = null;

  if (transform.index != null && transform.index !== '') {
    const index = parseParagraphIndex(transform.index);
    const indexed = paragraphs.find(candidate => candidate.index === index);
    if (indexed && paragraphMatchesExpectation(indexed, transform)) {
      return { paragraph: indexed, paragraphs };
    }
    paragraph = indexed || null;
  }

  if (transform.expectedText || transform.expectedStyle) {
    const matches = paragraphs.filter(candidate => paragraphMatchesExpectation(candidate, transform));
    if (matches.length === 1) {
      return { paragraph: matches[0], paragraphs };
    }
    if (matches.length > 1) {
      throw new Error(`Paragraph selection is ambiguous for transform ${transform.type}`);
    }
  }

  if (!paragraph) {
    throw new Error(`Paragraph ${transform.index} not found in word/document.xml`);
  }
  return { paragraph, paragraphs };
}

function splitParagraphMatch(transform, paragraph) {
  const match = transform.match || '';
  if (!match) {
    throw new Error(`${transform.type} requires a non-empty match`);
  }

  const rawText = paragraph.rawText;
  const actualMatches = countLiteral(rawText, match);
  const expectedCount = transform.count === '' || transform.count == null
    ? 1
    : Number(transform.count);

  if (!Number.isInteger(expectedCount) || expectedCount < 1) {
    throw new Error(`Invalid ${transform.type} count: ${transform.count}`);
  }
  if (expectedCount !== 1) {
    throw new Error(`${transform.type} currently requires exactly one match`);
  }
  if (actualMatches !== 1) {
    throw new Error(`${transform.type} expected exactly one match in paragraph ${transform.index} but found ${actualMatches}`);
  }

  const start = rawText.indexOf(match);
  const end = start + match.length;
  return {
    before: rawText.slice(0, start),
    match,
    after: rawText.slice(end),
  };
}

function buildInlineFormattedRPr(transform) {
  const parts = [];
  if (truthy(transform.bold)) parts.push('<w:b/>');
  if (truthy(transform.italic)) parts.push('<w:i/>');
  if (transform.underline) {
    const underlineValue = transform.underline === 'true' ? 'single' : transform.underline;
    parts.push(`<w:u w:val="${escapeXmlAttr(underlineValue)}"/>`);
  }
  if (transform.color) parts.push(`<w:color w:val="${escapeXmlAttr(transform.color)}"/>`);
  if (transform.highlight) parts.push(`<w:highlight w:val="${escapeXmlAttr(transform.highlight)}"/>`);
  if (truthy(transform.superscript)) parts.push('<w:vertAlign w:val="superscript"/>');
  if (truthy(transform.subscript)) parts.push('<w:vertAlign w:val="subscript"/>');
  return parts.length > 0 ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

function nextRelationshipId(relsXml) {
  let max = 0;
  const re = /Id="rId(\d+)"/g;
  let match;
  while ((match = re.exec(relsXml)) !== null) {
    max = Math.max(max, Number(match[1]));
  }
  return `rId${max + 1}`;
}

function ensureRelationship(pkg, type, target) {
  const relsPart = getUtf8Part(pkg, 'word/_rels/document.xml.rels');
  let relsXml = relsPart.buffer.toString('utf8');
  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedType = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = new RegExp(`<Relationship\\b[^>]*Id="([^"]+)"[^>]*Type="${escapedType}"[^>]*Target="${escapedTarget}"[^>]*/?>`).exec(relsXml);
  if (existing) {
    return existing[1];
  }

  const rId = nextRelationshipId(relsXml);
  const entry = `<Relationship Id="${rId}" Type="${type}" Target="${escapeXmlAttr(target)}"/>`;
  relsXml = relsXml.replace('</Relationships>', `${entry}</Relationships>`);
  updatePartText(relsPart, relsXml);
  return rId;
}

function ensureContentTypeOverride(pkg, partName, contentType) {
  const ctPart = getUtf8Part(pkg, '[Content_Types].xml');
  let ctXml = ctPart.buffer.toString('utf8');
  if (ctXml.includes(`PartName="${partName}"`) || ctXml.includes(`ContentType="${contentType}"`)) {
    return;
  }
  const entry = `<Override PartName="${escapeXmlAttr(partName)}" ContentType="${escapeXmlAttr(contentType)}"/>`;
  ctXml = ctXml.replace('</Types>', `${entry}</Types>`);
  updatePartText(ctPart, ctXml);
}

function ensureDefaultContentType(pkg, extension, contentType) {
  const ctPart = getUtf8Part(pkg, '[Content_Types].xml');
  let ctXml = ctPart.buffer.toString('utf8');
  if (ctXml.includes(`Extension="${extension}"`)) return;
  const entry = `<Default Extension="${escapeXmlAttr(extension)}" ContentType="${escapeXmlAttr(contentType)}"/>`;
  ctXml = ctXml.replace('</Types>', `${entry}</Types>`);
  updatePartText(ctPart, ctXml);
}

function nextCommentId(commentsXml) {
  let max = -1;
  const re = /<w:comment\b[^>]*w:id="(\d+)"/g;
  let match;
  while ((match = re.exec(commentsXml)) !== null) {
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function nextFootnoteId(footnotesXml) {
  let max = 1;
  const re = /<w:footnote\b[^>]*w:id="(\d+)"/g;
  let match;
  while ((match = re.exec(footnotesXml)) !== null) {
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function ensureCommentsInfrastructure(pkg) {
  const commentsPart = ensureUtf8Part(pkg, 'word/comments.xml', 'application/xml', EMPTY_COMMENTS_XML);
  ensureRelationship(pkg, REL_COMMENTS, 'comments.xml');
  ensureContentTypeOverride(pkg, '/word/comments.xml', CT_COMMENTS);
  return commentsPart;
}

function ensureFootnotesInfrastructure(pkg) {
  const footnotesPart = ensureUtf8Part(pkg, 'word/footnotes.xml', 'application/xml', EMPTY_FOOTNOTES_XML);
  ensureRelationship(pkg, REL_FOOTNOTES, 'footnotes.xml');
  ensureContentTypeOverride(pkg, '/word/footnotes.xml', CT_FOOTNOTES);
  return footnotesPart;
}

function addCommentRecord(pkg, text, author, date) {
  const commentsPart = ensureCommentsInfrastructure(pkg);
  let commentsXml = commentsPart.buffer.toString('utf8');
  const id = nextCommentId(commentsXml);
  const commentXml = `<w:comment w:id="${id}" w:author="${escapeXmlAttr(author)}" w:date="${escapeXmlAttr(date)}"><w:p><w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p></w:comment>`;
  commentsXml = commentsXml.replace('</w:comments>', `${commentXml}</w:comments>`);
  updatePartText(commentsPart, commentsXml);
  return id;
}

function addFootnoteRecord(pkg, text) {
  const footnotesPart = ensureFootnotesInfrastructure(pkg);
  let footnotesXml = footnotesPart.buffer.toString('utf8');
  const id = nextFootnoteId(footnotesXml);
  const footnoteXml = `<w:footnote w:id="${id}"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${escapeXmlText(text)}</w:t></w:r></w:p></w:footnote>`;
  footnotesXml = footnotesXml.replace('</w:footnotes>', `${footnoteXml}</w:footnotes>`);
  updatePartText(footnotesPart, footnotesXml);
  return id;
}

function splitRows(tsv) {
  return String(tsv || '')
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.split('\t'));
}

function buildTableXml(tsv, opts = {}) {
  const rows = splitRows(tsv);
  if (rows.length === 0) {
    throw new Error('insert-table-after requires at least one TSV row');
  }

  const headers = opts.headers !== 'false';
  const style = opts.style || 'plain';
  const columnCount = Math.max(...rows.map(row => row.length));
  const tableWidth = 9360;
  const columnWidth = Math.floor(tableWidth / columnCount);

  let tblPr = '<w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/>';
  if (style === 'plain') {
    tblPr += '<w:tblBorders>'
      + '<w:top w:val="single" w:sz="4" w:color="000000"/>'
      + '<w:left w:val="single" w:sz="4" w:color="000000"/>'
      + '<w:bottom w:val="single" w:sz="4" w:color="000000"/>'
      + '<w:right w:val="single" w:sz="4" w:color="000000"/>'
      + '<w:insideH w:val="single" w:sz="4" w:color="000000"/>'
      + '<w:insideV w:val="single" w:sz="4" w:color="000000"/>'
      + '</w:tblBorders>';
  } else {
    tblPr += '<w:tblBorders>'
      + '<w:top w:val="single" w:sz="12" w:color="000000"/>'
      + '<w:left w:val="none" w:sz="0" w:color="auto"/>'
      + '<w:bottom w:val="single" w:sz="12" w:color="000000"/>'
      + '<w:right w:val="none" w:sz="0" w:color="auto"/>'
      + '<w:insideH w:val="none" w:sz="0" w:color="auto"/>'
      + '<w:insideV w:val="none" w:sz="0" w:color="auto"/>'
      + '</w:tblBorders>';
  }
  tblPr += '</w:tblPr>';

  let grid = '<w:tblGrid>';
  for (let i = 0; i < columnCount; i += 1) {
    grid += `<w:gridCol w:w="${columnWidth}"/>`;
  }
  grid += '</w:tblGrid>';

  const rowsXml = rows.map((row, rowIndex) => {
    const isHeader = headers && rowIndex === 0;
    const cells = [];
    for (let col = 0; col < columnCount; col += 1) {
      const cellText = row[col] || '';
      const rPr = isHeader ? '<w:rPr><w:b/></w:rPr>' : '';
      const tcBorders = style === 'plain'
        ? ''
        : '<w:tcBorders>'
            + (isHeader ? '<w:bottom w:val="single" w:sz="6" w:color="000000"/>' : '<w:bottom w:val="none" w:sz="0" w:color="auto"/>')
            + '<w:left w:val="none" w:sz="0" w:color="auto"/>'
            + '<w:right w:val="none" w:sz="0" w:color="auto"/>'
            + '<w:top w:val="none" w:sz="0" w:color="auto"/>'
          + '</w:tcBorders>';
      cells.push(
        '<w:tc>'
          + `<w:tcPr><w:tcW w:w="${columnWidth}" w:type="dxa"/>${tcBorders}</w:tcPr>`
          + `<w:p>${buildRunXml(cellText, rPr)}</w:p>`
        + '</w:tc>'
      );
    }
    return `<w:tr>${isHeader ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`;
  }).join('');

  return `<w:tbl>${tblPr}${grid}${rowsXml}</w:tbl>`;
}

function buildCaptionParagraph(caption) {
  if (!caption) return '';
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
    + `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${escapeXmlText(caption)}</w:t></w:r>`
    + '</w:p>';
}

function detectImageDimensions(buffer, imagePart) {
  const lower = imagePart.toLowerCase();
  if (lower.endsWith('.png')) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xFF) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      const isSOF = marker >= 0xC0 && marker <= 0xC3;
      if (isSOF) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }

  return { width: 320, height: 180 };
}

function imageContentType(imagePart) {
  const ext = path.extname(imagePart).toLowerCase().replace('.', '');
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  };
  return {
    extension: ext,
    contentType: map[ext] || `image/${ext}`,
  };
}

function buildDrawingXml(rId, widthPx, heightPx, name, descr) {
  const cx = Math.round(widthPx * EMU_PER_PIXEL);
  const cy = Math.round(heightPx * EMU_PER_PIXEL);
  const idBase = Number(String(rId).replace(/\D/g, '')) || 1;

  return '<wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${cx}" cy="${cy}"/>`
    + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
    + `<wp:docPr id="${1000 + idBase}" name="${escapeXmlAttr(name)}" descr="${escapeXmlAttr(descr)}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:nvPicPr><pic:cNvPr id="${2000 + idBase}" name="${escapeXmlAttr(name)}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr><pic:nvPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic>'
    + '</a:graphicData>'
    + '</a:graphic>'
    + '</wp:inline>';
}

function sortedDiffPaths(diffs) {
  return diffs
    .map(diff => `${diff.path}:${diff.type}`)
    .sort();
}

function applyReplaceText(part, transform) {
  const currentText = part.buffer.toString('utf8');
  const matches = countLiteral(currentText, transform.find);
  const expected = transform.count === '' || transform.count == null
    ? null
    : Number(transform.count);

  if (expected !== null && (!Number.isInteger(expected) || expected < 0)) {
    throw new Error(`Invalid replace-text count for ${transform.part}: ${transform.count}`);
  }
  if (expected !== null && matches !== expected) {
    throw new Error(`replace-text expected ${expected} matches in ${transform.part} but found ${matches}`);
  }
  if (matches === 0) {
    throw new Error(`replace-text found no matches in ${transform.part}`);
  }

  updatePartText(part, replaceLiteral(currentText, transform.find, transform.replace));
}

function applyReplaceParagraph(part, transform) {
  const documentXml = part.buffer.toString('utf8');
  const { paragraph } = findParagraph(documentXml, transform);
  assertParagraphExpectation(transform, paragraph);

  const replacementXml = buildParagraphXml(
    paragraph.xml,
    transform.text || '',
    transform.style || '',
    { preserveProperties: true }
  );

  updatePartText(part, documentXml.slice(0, paragraph.start) + replacementXml + documentXml.slice(paragraph.end));
}

function applyInsertParagraph(part, transform, where) {
  const documentXml = part.buffer.toString('utf8');
  const { paragraph } = findParagraph(documentXml, transform);
  assertParagraphExpectation(transform, paragraph);

  const paragraphXml = buildParagraphXml('', transform.text || '', transform.style || '', {
    preserveProperties: false,
  });
  const insertionPoint = where === 'before' ? paragraph.start : paragraph.end;

  updatePartText(part, documentXml.slice(0, insertionPoint) + paragraphXml + documentXml.slice(insertionPoint));
}

function applyDeleteParagraph(part, transform) {
  const documentXml = part.buffer.toString('utf8');
  const { paragraph, paragraphs } = findParagraph(documentXml, transform);
  assertParagraphExpectation(transform, paragraph);

  if (paragraphs.length <= 1) {
    throw new Error('Cannot delete the only paragraph in word/document.xml');
  }

  updatePartText(part, documentXml.slice(0, paragraph.start) + documentXml.slice(paragraph.end));
}

function applyFormatText(part, transform) {
  const documentXml = part.buffer.toString('utf8');
  const { paragraph } = findParagraph(documentXml, transform);
  assertParagraphExpectation(transform, paragraph);
  const split = splitParagraphMatch(transform, paragraph);

  const formattedRPr = buildInlineFormattedRPr(transform);
  const innerXml = [
    buildRunXml(split.before),
    buildRunXml(split.match, formattedRPr),
    buildRunXml(split.after),
  ].join('');

  const paragraphXml = buildParagraphXmlFromInnerXml(paragraph.xml, innerXml, transform.style || '', {
    preserveProperties: true,
  });

  updatePartText(part, documentXml.slice(0, paragraph.start) + paragraphXml + documentXml.slice(paragraph.end));
}

function applyInsertComment(pkg, part, transform) {
  const documentXml = part.buffer.toString('utf8');
  const { paragraph } = findParagraph(documentXml, transform);
  assertParagraphExpectation(transform, paragraph);
  const split = splitParagraphMatch(transform, paragraph);
  const commentId = addCommentRecord(pkg, transform.text || '', transform.author || DEFAULT_AUTHOR, transform.date || DEFAULT_DATE);

  const innerXml = [
    buildRunXml(split.before),
    `<w:commentRangeStart w:id="${commentId}"/>`,
    buildRunXml(split.match),
    `<w:commentRangeEnd w:id="${commentId}"/>`,
    `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${commentId}"/></w:r>`,
    buildRunXml(split.after),
  ].join('');

  const paragraphXml = buildParagraphXmlFromInnerXml(paragraph.xml, innerXml, transform.style || '', {
    preserveProperties: true,
  });
  updatePartText(part, documentXml.slice(0, paragraph.start) + paragraphXml + documentXml.slice(paragraph.end));
}

function applyInsertFootnote(pkg, part, transform) {
  const documentXml = part.buffer.toString('utf8');
  const { paragraph } = findParagraph(documentXml, transform);
  assertParagraphExpectation(transform, paragraph);
  const split = splitParagraphMatch(transform, paragraph);
  const footnoteId = addFootnoteRecord(pkg, transform.text || '');

  const innerXml = [
    buildRunXml(split.before),
    buildRunXml(split.match),
    `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${footnoteId}"/></w:r>`,
    buildRunXml(split.after),
  ].join('');

  const paragraphXml = buildParagraphXmlFromInnerXml(paragraph.xml, innerXml, transform.style || '', {
    preserveProperties: true,
  });
  updatePartText(part, documentXml.slice(0, paragraph.start) + paragraphXml + documentXml.slice(paragraph.end));
}

function applyInsertTableAfter(part, transform) {
  const documentXml = part.buffer.toString('utf8');
  const { paragraph } = findParagraph(documentXml, transform);
  assertParagraphExpectation(transform, paragraph);

  const newXml = buildCaptionParagraph(transform.caption || '') + buildTableXml(transform.tsv || '', {
    headers: transform.headers,
    style: transform.style,
  });

  updatePartText(part, documentXml.slice(0, paragraph.end) + newXml + documentXml.slice(paragraph.end));
}

function applyInsertFigureAfter(pkg, part, transform) {
  const documentXml = part.buffer.toString('utf8');
  const { paragraph } = findParagraph(documentXml, transform);
  assertParagraphExpectation(transform, paragraph);

  const imagePart = pkg.parts.find(candidate => candidate.path === transform.imagePart);
  if (!imagePart) {
    throw new Error(`insert-figure-after imagePart not found: ${transform.imagePart}`);
  }

  const { extension, contentType } = imageContentType(transform.imagePart);
  if (extension) {
    ensureDefaultContentType(pkg, extension, contentType);
  }

  const target = `media/${path.basename(transform.imagePart)}`;
  const rId = ensureRelationship(pkg, REL_IMAGE, target);
  const dims = detectImageDimensions(imagePart.buffer, transform.imagePart);
  const widthPx = transform.widthPx === '' || transform.widthPx == null ? dims.width : Number(transform.widthPx);
  const heightPx = transform.heightPx === '' || transform.heightPx == null ? dims.height : Number(transform.heightPx);
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    throw new Error(`insert-figure-after requires positive widthPx/heightPx or a detectable image size for ${transform.imagePart}`);
  }

  const drawingXml = buildDrawingXml(
    rId,
    widthPx,
    heightPx,
    path.basename(transform.imagePart),
    transform.altText || path.basename(transform.imagePart)
  );

  const figureParagraph = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>'
    + drawingXml
    + '</w:drawing></w:r></w:p>';
  const newXml = figureParagraph + buildCaptionParagraph(transform.caption || '');

  updatePartText(part, documentXml.slice(0, paragraph.end) + newXml + documentXml.slice(paragraph.end));
}

function applyTransform(nextPkg, transform) {
  if (!transform || typeof transform !== 'object') {
    throw new Error('Transform must be an object');
  }

  if (transform.type === 'replace-text') {
    applyReplaceText(getUtf8Part(nextPkg, transform.part), transform);
    return;
  }

  if (transform.type === 'format-text') {
    applyFormatText(getUtf8Part(nextPkg, documentPartPath(transform)), transform);
    return;
  }

  if (transform.type === 'insert-comment') {
    applyInsertComment(nextPkg, getUtf8Part(nextPkg, documentPartPath(transform)), transform);
    return;
  }

  if (transform.type === 'insert-footnote') {
    applyInsertFootnote(nextPkg, getUtf8Part(nextPkg, documentPartPath(transform)), transform);
    return;
  }

  if (transform.type === 'replace-paragraph') {
    applyReplaceParagraph(getUtf8Part(nextPkg, documentPartPath(transform)), transform);
    return;
  }

  if (transform.type === 'insert-paragraph-after') {
    applyInsertParagraph(getUtf8Part(nextPkg, documentPartPath(transform)), transform, 'after');
    return;
  }

  if (transform.type === 'insert-paragraph-before') {
    applyInsertParagraph(getUtf8Part(nextPkg, documentPartPath(transform)), transform, 'before');
    return;
  }

  if (transform.type === 'delete-paragraph') {
    applyDeleteParagraph(getUtf8Part(nextPkg, documentPartPath(transform)), transform);
    return;
  }

  if (transform.type === 'insert-table-after') {
    applyInsertTableAfter(getUtf8Part(nextPkg, documentPartPath(transform)), transform);
    return;
  }

  if (transform.type === 'insert-figure-after') {
    applyInsertFigureAfter(nextPkg, getUtf8Part(nextPkg, documentPartPath(transform)), transform);
    return;
  }

  throw new Error(`Unsupported transform type: ${transform.type}`);
}

function applyTransforms(pkg) {
  const transforms = Array.isArray(pkg.transforms) ? pkg.transforms : [];
  if (transforms.length === 0) return pkg;

  const nextPkg = clonePackage(pkg);
  for (const transform of transforms) {
    applyTransform(nextPkg, transform);
  }
  return nextPkg;
}

module.exports = {
  applyTransforms,
  sortedDiffPaths,
};
