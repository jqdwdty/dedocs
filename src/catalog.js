'use strict';

const CLI_COMMANDS = [
  {
    name: 'decompile',
    usage: 'dedocs decompile input.docx output.dedocs',
    summary: 'Flatten a .docx package into one dedocs file.',
  },
  {
    name: 'compile',
    usage: 'dedocs compile input.dedocs output.docx',
    summary: 'Rebuild a .docx package from the single-file source.',
  },
  {
    name: 'normalize',
    usage: 'dedocs normalize input.dedocs [output.dedocs]',
    summary: 'Refresh hashes, boundaries, and generated guides after hand edits.',
  },
  {
    name: 'verify',
    usage: 'dedocs verify left.docx right.docx',
    summary: 'Compare two .docx packages part-by-part and report exact diffs.',
  },
];

const TRANSFORM_CATALOG = [
  {
    type: 'replace-text',
    summary: 'Apply a literal replacement inside one UTF-8 package part.',
    scope: 'package part',
    payload: 'FIND/WITH',
  },
  {
    type: 'format-text',
    summary: 'Apply inline formatting to a matched span inside one document paragraph.',
    scope: 'document paragraph',
    payload: 'attributes only',
  },
  {
    type: 'insert-comment',
    summary: 'Attach a Word comment to a matched text span.',
    scope: 'document paragraph',
    payload: 'TEXT',
  },
  {
    type: 'insert-footnote',
    summary: 'Insert a footnote reference and create the footnote entry.',
    scope: 'document paragraph',
    payload: 'TEXT',
  },
  {
    type: 'replace-paragraph',
    summary: 'Replace an entire paragraph while preserving paragraph properties by default.',
    scope: 'document paragraph',
    payload: 'TEXT',
  },
  {
    type: 'insert-paragraph-before',
    summary: 'Insert a new paragraph before an anchored paragraph.',
    scope: 'document paragraph',
    payload: 'TEXT',
  },
  {
    type: 'insert-paragraph-after',
    summary: 'Insert a new paragraph after an anchored paragraph.',
    scope: 'document paragraph',
    payload: 'TEXT',
  },
  {
    type: 'delete-paragraph',
    summary: 'Delete an anchored paragraph from the document body.',
    scope: 'document paragraph',
    payload: 'none',
  },
  {
    type: 'insert-table-after',
    summary: 'Insert a block table after an anchored paragraph from TSV content.',
    scope: 'document paragraph',
    payload: 'TSV',
  },
  {
    type: 'insert-figure-after',
    summary: 'Insert a block figure after an anchored paragraph using an existing image part.',
    scope: 'document paragraph',
    payload: 'attributes only',
  },
];

const DESIGN_PILLARS = [
  'One text file contains the whole .docx package.',
  'The exact package core stays the source of truth.',
  'Generated guides help orientation but never affect fidelity.',
  'Semantic transforms stay explicit and fail loudly on anchor drift.',
  'Untouched package parts are preserved byte-for-byte.',
];

const FIDELITY_GUARANTEES = [
  '.docx -> .dedocs -> .docx preserves package part bytes exactly.',
  'Guides are advisory only and can be regenerated at any time.',
  'Untouched XML is not normalized or reserialized.',
  'Binary parts stay intact as base64 payload blocks.',
  'Zip container timestamps and compression metadata are intentionally out of scope.',
];

module.exports = {
  CLI_COMMANDS,
  DESIGN_PILLARS,
  FIDELITY_GUARANTEES,
  TRANSFORM_CATALOG,
};
