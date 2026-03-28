# Dedocs

`dedocs` is a single-file source format for `.docx`.

It exists for one specific reason: raw OOXML is exact, but it is a poor working
surface for AI and a clumsy one for humans. `dedocs` keeps the exact package as
the source of truth, then layers readable guides and explicit authoring
commands on top.

That gives you:

- one text file for the whole document package
- exact package-part round-trips for untouched content
- explicit semantic edits instead of ad hoc XML surgery
- deterministic diffs, review, and versioning
- a static showcase site with no app server

The public website is built from the package itself at
[jqdwdty.github.io/dedocs](https://jqdwdty.github.io/dedocs/).

## What Dedocs Is

`dedocs` is not trying to replace OOXML with a lossy pretty syntax.

It is a layered system:

1. `dedocs core`
   The exact `.docx` package, flattened into a single text file.
2. `dedocs guides`
   Generated structure summaries that help humans and AI orient quickly.
3. `dedocs transforms`
   Intent-level commands that compile down onto the exact package parts.

That split is the whole point. The core keeps fidelity. The upper layer keeps
editing sane.

## Why Not Just Use OOXML?

Because OOXML already solves fidelity, but not workflow.

Unpacked OOXML gives you:

- many files
- archive plumbing
- awkward diff review
- poor prompt context for AI
- fragile manual edits

`dedocs` gives you:

- one file
- explicit part boundaries
- a stable guide layer
- exact package verification
- a growing authoring language on top

## What It Guarantees

- `.docx -> .dedocs -> .docx` preserves package part bytes exactly
- guides are advisory only and can always be regenerated
- untouched XML is never normalized or reserialized
- binary parts are preserved as base64 payloads
- `normalize` refreshes metadata and guide previews after hand edits

Non-goal:

- zip container metadata is not preserved

That means no promise about zip timestamps, compression choices, or entry
ordering. The fidelity target is the document package itself.

## Shape

```text
\dedocs[version="1", package="docx", fidelity="package-exact", source="sample-report.docx"]

\guide[name="document-paragraphs", part="word/document.xml", format="paragraphs", boundary=":::DEDOCS_GUIDE_1_abc:::"]
:::DEDOCS_GUIDE_1_abc:::
\p[index="0000", style="Heading1"] Introduction
\p[index="0001"] This is the first paragraph of the introduction.
:::DEDOCS_GUIDE_1_abc:::
\end{guide}

\replace-text[part="word/document.xml", count="1"]
<<<FIND
platform governance and political advertising.
FIND
<<<WITH
platform governance, political advertising, and auditability.
WITH
\end{replace-text}

\part[path="word/document.xml", mediaType="application/xml", encoding="utf8", bytes="1234", sha256="...", boundary=":::DEDOCS_PART_1_def:::"]
:::DEDOCS_PART_1_def:::
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document>...</w:document>
:::DEDOCS_PART_1_def:::
\end{part}

\end{dedocs}
```

## Supported Commands

Current semantic commands:

- `\replace-text`
- `\format-text`
- `\insert-comment`
- `\insert-footnote`
- `\replace-paragraph`
- `\insert-paragraph-before`
- `\insert-paragraph-after`
- `\delete-paragraph`
- `\insert-table-after`
- `\insert-figure-after`

These commands are intentionally strict. They target the package explicitly and
fail loudly when anchors drift or expectations stop matching.

## CLI

```bash
dedocs decompile input.docx output.dedocs
dedocs compile input.dedocs output.docx
dedocs normalize input.dedocs [output.dedocs]
dedocs verify left.docx right.docx
```

Typical loop:

```bash
dedocs decompile sample-report.docx sample-report.dedocs
# edit sample-report.dedocs
dedocs normalize sample-report.dedocs
dedocs compile sample-report.dedocs sample-report-edited.docx
dedocs verify sample-report.docx sample-report-edited.docx
```

## Quick Start

```bash
git clone https://github.com/jqdwdty/dedocs.git
cd dedocs
npm test
npm run build:site
```

The static showcase is emitted to [docs/](/mnt/storage/dedocs/docs). Example
artifacts are emitted to [examples/](/mnt/storage/dedocs/examples).

## Public Examples

Public example files are generated from the bundled fixture:

- [examples/sample-report.docx](/mnt/storage/dedocs/examples/sample-report.docx)
- [examples/sample-report.dedocs](/mnt/storage/dedocs/examples/sample-report.dedocs)
- [examples/sample-authoring.dedocs](/mnt/storage/dedocs/examples/sample-authoring.dedocs)
- [examples/sample-authoring.docx](/mnt/storage/dedocs/examples/sample-authoring.docx)

The site build regenerates these so the repo and Pages site stay aligned.

## Development

Useful commands:

```bash
npm test
npm run build:site
node bin/dedocs.js decompile input.docx output.dedocs
node bin/dedocs.js compile input.dedocs output.docx
```

Optional stress suite:

```bash
DEDOCS_STRESS_DOCS="/path/to/doc1.docx:/path/to/doc2.docx" npm test
```

That lets you throw nastier local fixtures at the exact round-trip path without
shipping private documents in the public repo.
