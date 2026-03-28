'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CLI_COMMANDS,
  DESIGN_PILLARS,
  FIDELITY_GUARANTEES,
  TRANSFORM_CATALOG,
  compareDocxPackages,
  compileDedocsText,
  dedocsFromDocx,
  normalizeDedocsText,
  parsePackage,
  serializePackage,
} = require('../src');

const rootDir = path.resolve(__dirname, '..');
const fixtureDocx = path.join(rootDir, 'test', 'fixtures', 'sample-report.docx');
const fixtureImage = path.join(rootDir, 'test', 'fixtures', 'test-image.png');
const examplesDir = path.join(rootDir, 'examples');
const docsDir = path.join(rootDir, 'docs');
const docsAssetsDir = path.join(docsDir, 'assets');
const docsDownloadsDir = path.join(docsDir, 'downloads');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function writeText(targetPath, text) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, text, 'utf8');
}

function writeJson(targetPath, value) {
  writeText(targetPath, JSON.stringify(value, null, 2) + '\n');
}

function fileSize(filePath) {
  return fs.statSync(filePath).size;
}

function splitLines(text) {
  return String(text).split('\n');
}

function leadingSnippet(text, lineCount) {
  return splitLines(text).slice(0, lineCount).join('\n').trim();
}

function authoringSnippet(text) {
  const start = text.indexOf('\n\\replace-text[');
  const end = text.indexOf('\n\\part[');
  if (start === -1 || end === -1 || end <= start) {
    return leadingSnippet(text, 80);
  }
  return text.slice(start + 1, end).trim();
}

function guidePreview(pkg, count = 10) {
  if (!pkg.guides || pkg.guides.length === 0) return [];
  return splitLines(pkg.guides[0].text).slice(0, count);
}

function packagePartSummary(pkg) {
  return pkg.parts.map(part => ({
    path: part.path,
    mediaType: part.mediaType,
    encoding: part.encoding,
    bytes: part.buffer.length,
  }));
}

function commandExamples() {
  return [
    {
      label: 'Decompile a real document',
      command: 'dedocs decompile input.docx output.dedocs',
      result: 'Flatten the package into one source file with guides and explicit parts.',
    },
    {
      label: 'Normalize after hand edits',
      command: 'dedocs normalize output.dedocs',
      result: 'Refresh guide previews, hashes, byte counts, and safe boundaries.',
    },
    {
      label: 'Compile back to .docx',
      command: 'dedocs compile output.dedocs rebuilt.docx',
      result: 'Rebuild a real Word package from the single-file source.',
    },
    {
      label: 'Verify package equality',
      command: 'dedocs verify input.docx rebuilt.docx',
      result: 'See exactly which package parts differ, or get a clean exact-match result.',
    },
  ];
}

function useCases() {
  return [
    {
      title: 'AI-facing source artifact',
      summary: 'Give an agent one file instead of a zip archive and a directory tree of OOXML parts.',
    },
    {
      title: 'Versionable document workflow',
      summary: 'Review document changes as text with explicit commands instead of archive churn.',
    },
    {
      title: 'Exact package preservation',
      summary: 'Keep untouched package parts byte-exact while still exposing readable guides and transforms.',
    },
  ];
}

function workflowModes() {
  return [
    {
      ext: '.docx',
      label: 'Word package',
    },
    {
      ext: '.dedocs',
      label: 'single-file source',
    },
    {
      ext: 'git + AI',
      label: 'review and editing surface',
    },
  ];
}

function quickStart() {
  return [
    {
      title: 'Clone and verify',
      command: 'git clone https://github.com/jqdwdty/dedocs.git\ncd dedocs\nnpm test',
    },
    {
      title: 'Build the static showcase',
      command: 'npm run build:site',
    },
    {
      title: 'Run the document loop',
      command: 'dedocs decompile input.docx output.dedocs\ndedocs normalize output.dedocs\ndedocs compile output.dedocs rebuilt.docx\ndedocs verify input.docx rebuilt.docx',
    },
  ];
}

function withSampleImage(pkg) {
  pkg.parts.push({
    path: 'word/media/showcase-image.png',
    mediaType: 'image/png',
    encoding: 'base64',
    buffer: fs.readFileSync(fixtureImage),
  });
}

function buildAuthoringDedocs(sourceDedocsText) {
  const pkg = parsePackage(sourceDedocsText, { strictMetadata: true });
  withSampleImage(pkg);

  pkg.transforms = [
    {
      type: 'replace-text',
      part: 'word/document.xml',
      count: 1,
      find: 'platform governance and political advertising.',
      replace: 'platform governance, political advertising, and auditability.',
    },
    {
      type: 'format-text',
      index: '0002',
      match: 'Meta',
      expectedText: "The second paragraph discusses Meta's advertising ban and its consequences for electoral transparency.",
      bold: 'true',
      italic: 'true',
      color: '0F766E',
    },
    {
      type: 'insert-comment',
      index: '0001',
      match: 'platform governance',
      expectedText: 'This is the first paragraph of the introduction. It contains some text about platform governance, political advertising, and auditability.',
      author: 'Dedocs',
      text: 'Clarify the exact policy boundary here.',
    },
    {
      type: 'insert-footnote',
      index: '0004',
      match: '268,635 advertisements',
      expectedText: 'We developed an automated monitoring system that collected 268,635 advertisements from the Meta Ad Library.',
      text: 'Synthetic note inserted through the semantic layer.',
    },
    {
      type: 'insert-paragraph-after',
      index: '0003',
      expectedText: 'Methods',
      expectedStyle: 'Heading1',
      text: 'This inserted paragraph shows how dedocs adds body text without raw XML edits.',
    },
    {
      type: 'insert-paragraph-before',
      index: '0005',
      expectedText: 'Results',
      expectedStyle: 'Heading1',
      text: 'This inserted paragraph lands before Results and stays anchored by expectations.',
    },
    {
      type: 'insert-table-after',
      index: '0003',
      expectedText: 'Methods',
      expectedStyle: 'Heading1',
      caption: 'Table 1. Example metrics',
      tsv: 'Metric\tValue\nAds collected\t268,635\nConfirmed advertisers\t192',
    },
    {
      type: 'insert-figure-after',
      index: '0005',
      expectedText: 'Results',
      expectedStyle: 'Heading1',
      imagePart: 'word/media/showcase-image.png',
      widthPx: '120',
      heightPx: '90',
      caption: 'Figure 1. Synthetic reference image',
      altText: 'Synthetic reference image',
    },
  ];

  return normalizeDedocsText(serializePackage(pkg));
}

function buildRoundTripProof(dedocsText, sourceDocxPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedocs-site-'));
  const rebuiltPath = path.join(tempDir, 'roundtrip.docx');

  try {
    compileDedocsText(dedocsText, rebuiltPath, { strictMetadata: true });
    return compareDocxPackages(sourceDocxPath, rebuiltPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  ensureDir(examplesDir);
  ensureDir(docsAssetsDir);
  ensureDir(docsDownloadsDir);

  const sampleDocxOut = path.join(examplesDir, 'sample-report.docx');
  const sampleDedocsOut = path.join(examplesDir, 'sample-report.dedocs');
  const sampleAuthoringOut = path.join(examplesDir, 'sample-authoring.dedocs');
  const sampleAuthoringDocxOut = path.join(examplesDir, 'sample-authoring.docx');
  const sampleImageOut = path.join(examplesDir, 'showcase-image.png');

  copyFile(fixtureDocx, sampleDocxOut);
  copyFile(fixtureImage, sampleImageOut);

  const sampleDedocsText = dedocsFromDocx(fixtureDocx, { source: 'sample-report.docx' });
  writeText(sampleDedocsOut, sampleDedocsText);

  const samplePkg = parsePackage(sampleDedocsText, { strictMetadata: true });
  const authoredDedocsText = buildAuthoringDedocs(sampleDedocsText);
  writeText(sampleAuthoringOut, authoredDedocsText);
  compileDedocsText(authoredDedocsText, sampleAuthoringDocxOut, { strictMetadata: true });

  copyFile(sampleDocxOut, path.join(docsDownloadsDir, 'sample-report.docx'));
  copyFile(sampleDedocsOut, path.join(docsDownloadsDir, 'sample-report.dedocs'));
  copyFile(sampleAuthoringOut, path.join(docsDownloadsDir, 'sample-authoring.dedocs'));
  copyFile(sampleAuthoringDocxOut, path.join(docsDownloadsDir, 'sample-authoring.docx'));

  const authoredPkg = parsePackage(authoredDedocsText, { strictMetadata: true });
  const diff = compareDocxPackages(sampleDocxOut, sampleAuthoringDocxOut);
  const roundTrip = buildRoundTripProof(sampleDedocsText, sampleDocxOut);
  const xmlParts = samplePkg.parts.filter(part => part.encoding === 'utf8').length;
  const binaryParts = samplePkg.parts.length - xmlParts;

  const showcase = {
    generatedAt: new Date().toISOString(),
    package: {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      repository: packageJson.repository.url.replace(/\.git$/, ''),
      homepage: packageJson.homepage,
    },
    principles: DESIGN_PILLARS,
    guarantees: FIDELITY_GUARANTEES,
    commands: CLI_COMMANDS,
    transforms: TRANSFORM_CATALOG,
    useCases: useCases(),
    workflowModes: workflowModes(),
    commandExamples: commandExamples(),
    quickStart: quickStart(),
    sample: {
      file: {
        name: 'sample-report.docx',
        bytes: fileSize(sampleDocxOut),
      },
      dedocs: {
        name: 'sample-report.dedocs',
        bytes: fileSize(sampleDedocsOut),
      },
      authoring: {
        name: 'sample-authoring.dedocs',
        bytes: fileSize(sampleAuthoringOut),
      },
      rebuilt: {
        name: 'sample-authoring.docx',
        bytes: fileSize(sampleAuthoringDocxOut),
      },
      stats: {
        parts: samplePkg.parts.length,
        xmlParts,
        binaryParts,
        guides: samplePkg.guides.length,
        paragraphs: guidePreview(samplePkg, 9999).length,
      },
      proof: {
        roundTripExact: roundTrip.equal,
        roundTripDiffs: roundTrip.diffs,
        changedPartCount: diff.diffs.length,
        changedParts: diff.diffs,
      },
      guidePreview: guidePreview(samplePkg, 10),
      guideAfterTransforms: guidePreview(authoredPkg, 12),
      parts: packagePartSummary(samplePkg),
      coreSnippet: leadingSnippet(sampleDedocsText, 34),
      authoringSnippet: authoringSnippet(authoredDedocsText),
    },
    downloads: [
      {
        label: 'Sample .docx',
        href: './downloads/sample-report.docx',
        bytes: fileSize(path.join(docsDownloadsDir, 'sample-report.docx')),
      },
      {
        label: 'Sample .dedocs',
        href: './downloads/sample-report.dedocs',
        bytes: fileSize(path.join(docsDownloadsDir, 'sample-report.dedocs')),
      },
      {
        label: 'Authoring example .dedocs',
        href: './downloads/sample-authoring.dedocs',
        bytes: fileSize(path.join(docsDownloadsDir, 'sample-authoring.dedocs')),
      },
      {
        label: 'Compiled authoring .docx',
        href: './downloads/sample-authoring.docx',
        bytes: fileSize(path.join(docsDownloadsDir, 'sample-authoring.docx')),
      },
    ],
  };

  writeJson(path.join(docsAssetsDir, 'showcase.json'), showcase);
  writeText(path.join(docsDir, '.nojekyll'), '');
}

main();
