'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

describe('site build', () => {
  it('builds the static showcase and example downloads', () => {
    execFileSync('node', ['scripts/build-site.js'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const root = path.resolve(__dirname, '..');
    const showcasePath = path.join(root, 'docs', 'assets', 'showcase.json');
    const downloads = [
      'sample-report.docx',
      'sample-report.dedocs',
      'sample-authoring.dedocs',
      'sample-authoring.docx',
    ];

    assert.equal(fs.existsSync(showcasePath), true);
    for (const name of downloads) {
      assert.equal(fs.existsSync(path.join(root, 'docs', 'downloads', name)), true, `${name} missing`);
      assert.equal(fs.existsSync(path.join(root, 'examples', name)), true, `${name} example missing`);
    }

    const showcase = JSON.parse(fs.readFileSync(showcasePath, 'utf8'));
    assert.equal(showcase.package.name, 'dedocs');
    assert.equal(showcase.sample.parts.length > 0, true);
    assert.equal(showcase.transforms.length >= 10, true);
    assert.equal(showcase.commands.length >= 4, true);
    assert.match(showcase.sample.guidePreview.join('\n'), /Introduction/);
  });
});
