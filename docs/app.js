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

function renderPrinciples(data) {
  const container = document.querySelector('#principles');
  container.innerHTML = data.principles.map((item) => `
    <article class="card">
      <h3>${item}</h3>
    </article>
  `).join('');
}

function renderGuarantees(data) {
  const list = document.querySelector('#guarantees-list');
  list.innerHTML = data.guarantees.map((item) => `<li>${item}</li>`).join('');
}

function renderMetrics(data) {
  const metrics = [
    ['Package parts', data.sample.stats.parts],
    ['UTF-8 parts', data.sample.stats.xmlParts],
    ['Binary parts', data.sample.stats.binaryParts],
    ['Guide paragraphs', data.sample.stats.paragraphs],
    ['Transforms in demo', data.transforms.length],
  ];

  document.querySelector('#metrics').innerHTML = metrics.map(([label, value]) => `
    <article class="metric card">
      <strong>${value}</strong>
      <span>${label}</span>
    </article>
  `).join('');
}

function renderParts(data) {
  document.querySelector('#parts-body').innerHTML = data.sample.parts.map((part) => `
    <tr>
      <td>${part.path}</td>
      <td>${part.mediaType}</td>
      <td>${part.encoding}</td>
      <td>${formatBytes(part.bytes)}</td>
    </tr>
  `).join('');
}

function renderDownloads(data) {
  document.querySelector('#downloads-list').innerHTML = data.downloads.map((item) => `
    <article class="download-card card">
      <div>
        <h3>${item.label}</h3>
        <span>${formatBytes(item.bytes)}</span>
      </div>
      <a href="${item.href}">Download</a>
    </article>
  `).join('');
}

function renderCommands(data) {
  document.querySelector('#commands-list').innerHTML = data.commands.map((item) => `
    <article class="command-item">
      <code>${item.usage}</code>
      <p>${item.summary}</p>
    </article>
  `).join('');

  document.querySelector('#transforms-list').innerHTML = data.transforms.map((item) => `
    <article class="transform-item">
      <code>${item.type}</code>
      <p>${item.summary}</p>
      <p>Scope: ${item.scope} · Payload: ${item.payload}</p>
    </article>
  `).join('');
}

function renderHero(data) {
  document.querySelector('#hero-snippet').textContent = data.sample.coreSnippet;
}

function setupViewer(data) {
  const modes = {
    guide: {
      title: 'Generated guide preview',
      text: data.sample.guidePreview.join('\n'),
    },
    authoring: {
      title: 'Authoring layer preview',
      text: data.sample.authoringSnippet,
    },
    transformedGuide: {
      title: 'Guide preview after semantic transforms',
      text: data.sample.guideAfterTransforms.join('\n'),
    },
    diff: {
      title: 'Package parts changed by the demo transforms',
      text: JSON.stringify(data.sample.changedParts, null, 2),
    },
  };

  const tabs = document.querySelector('#viewer-tabs');
  const title = document.querySelector('#viewer-title');
  const code = document.querySelector('#viewer-code');
  const order = [
    ['guide', 'Guide'],
    ['authoring', 'Authoring'],
    ['transformedGuide', 'Preview'],
    ['diff', 'Diff'],
  ];

  function activate(key) {
    for (const button of tabs.querySelectorAll('button')) {
      button.classList.toggle('active', button.dataset.mode === key);
    }
    title.textContent = modes[key].title;
    code.textContent = modes[key].text;
  }

  tabs.innerHTML = order.map(([key, label]) => `
    <button type="button" data-mode="${key}">${label}</button>
  `).join('');

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    activate(button.dataset.mode);
  });

  activate('guide');
}

async function main() {
  const data = await loadShowcase();
  renderHero(data);
  renderPrinciples(data);
  renderGuarantees(data);
  renderMetrics(data);
  renderParts(data);
  renderDownloads(data);
  renderCommands(data);
  setupViewer(data);
}

main().catch((error) => {
  const target = document.querySelector('#viewer-code');
  if (target) {
    target.textContent = String(error.message || error);
  }
});
