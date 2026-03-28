'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  compareDocxPackages,
  compileDedocsText,
  dedocsFromDocx,
} = require('../src');

const BUNDLED_DOCS = [
  path.join(__dirname, 'fixtures', 'sample-report.docx'),
];

const OPTIONAL_STRESS_DOCS = (process.env.DEDOCS_STRESS_DOCS || '')
  .split(path.delimiter)
  .map(value => value.trim())
  .filter(Boolean);

const REAL_DOCS = [...BUNDLED_DOCS, ...OPTIONAL_STRESS_DOCS];

function tmpDocxPath(label) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dedocs-real-')), `${label}.docx`);
}

describe('dedocs real documents', () => {
  for (const docxPath of REAL_DOCS) {
    const exists = fs.existsSync(docxPath);
    const label = path.basename(docxPath, '.docx');

    it(`round-trips ${label} package-exactly`, { skip: !exists && `missing ${docxPath}` }, () => {
      const dedocsText = dedocsFromDocx(docxPath, { source: path.basename(docxPath) });
      assert.match(dedocsText, /\\guide\[name="document-paragraphs"/);
      const rebuiltPath = tmpDocxPath(label);
      compileDedocsText(dedocsText, rebuiltPath, { strictMetadata: true });

      const comparison = compareDocxPackages(docxPath, rebuiltPath);
      assert.equal(comparison.equal, true, JSON.stringify(comparison.diffs, null, 2));
    });
  }
});
