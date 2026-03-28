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

function renderHero(data) {
  document.querySelector('#hero-snippet').textContent = data.sample.coreSnippet;

  const heroMeta = [
    `v${data.package.version}`,
    'package-exact',
    'static site',
  ];
  document.querySelector('#hero-meta').innerHTML = heroMeta
    .map((item) => `<span class="meta-pill">${item}</span>`)
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
          <strong>${item.title}</strong>
          <span>${item.detail}</span>
        </div>
      </div>
    `)
    .join('');
}

function renderPrinciples(data) {
  document.querySelector('#principles').innerHTML = data.principles
    .map((item) => `
      <article class="principle-strip__item">
        <h3>${item}</h3>
      </article>
    `)
    .join('');
}

function renderGuarantees(data) {
  document.querySelector('#guarantees-list').innerHTML = data.guarantees
    .map((item) => `<li>${item}</li>`)
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
        <strong>${value}</strong>
        <span>${label}</span>
      </article>
    `)
    .join('');
}

function renderParts(data) {
  document.querySelector('#parts-body').innerHTML = data.sample.parts
    .map((part) => `
      <tr>
        <td>${part.path}</td>
        <td>${part.mediaType}</td>
        <td>${part.encoding}</td>
        <td>${formatBytes(part.bytes)}</td>
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
          <strong>${part.path}</strong><br>
          <span>${part.type}</span>
        </div>
      </li>
    `)
    .join('');
}

function renderCommands(data) {
  document.querySelector('#commands-list').innerHTML = data.commands
    .map((item) => `
      <article class="command-item">
        <code>${item.usage}</code>
        <p>${item.summary}</p>
      </article>
    `)
    .join('');

  document.querySelector('#transforms-list').innerHTML = data.transforms
    .map((item) => `
      <article class="command-item">
        <code>${item.type}</code>
        <p>${item.summary}</p>
        <p>Scope: ${item.scope} · Payload: ${item.payload}</p>
      </article>
    `)
    .join('');
}

function renderDownloads(data) {
  document.querySelector('#downloads-list').innerHTML = data.downloads
    .map((item) => `
      <article class="download-dock__item">
        <div>
          <h3>${item.label}</h3>
          <span>${formatBytes(item.bytes)}</span>
        </div>
        <a href="${item.href}">Download</a>
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
      >${label}</button>
    `)
    .join('');

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    activate(button.dataset.mode);
  });

  activate('guide');
}

function enableEntranceMotion() {
  requestAnimationFrame(() => {
    document.body.classList.add('is-ready');
  });
}

async function main() {
  const data = await loadShowcase();
  renderHero(data);
  renderPrinciples(data);
  renderGuarantees(data);
  renderMetrics(data);
  renderParts(data);
  renderChangedParts(data);
  renderCommands(data);
  renderDownloads(data);
  setupViewer(data);
  enableEntranceMotion();
}

main().catch((error) => {
  const target = document.querySelector('#viewer-code');
  if (target) {
    target.textContent = String(error.message || error);
  }
});
