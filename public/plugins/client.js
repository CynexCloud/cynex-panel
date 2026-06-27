// Native Plugins Client Controller
let currentTab = 'marketplace';
let searchQuery = '';
let searchOffset = 0;
const searchLimit = 9;
let activeJobId = null;
let jobPollInterval = null;

// Initialize Client
document.addEventListener('DOMContentLoaded', () => {
  // Setup search debouncer
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      searchQuery = e.target.value;
      debounceTimer = setTimeout(() => {
        searchOffset = 0;
        fetchMarketplace();
      }, 500);
    });
  }

  // Setup category and provider filter changes
  const categoryFilter = document.getElementById('filter-category');
  const providerFilter = document.getElementById('filter-provider');
  if (categoryFilter) categoryFilter.addEventListener('change', () => { searchOffset = 0; fetchMarketplace(); });
  if (providerFilter) providerFilter.addEventListener('change', () => { searchOffset = 0; fetchMarketplace(); });

  // Setup server selector change
  const serverSelector = document.getElementById('server-selector');
  if (serverSelector) {
    serverSelector.addEventListener('change', (e) => {
      window.selectedServerUuid = e.target.value;
      refreshCurrentTab();
    });
  }

  // Setup pagination buttons
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  if (prevBtn) prevBtn.addEventListener('click', () => { if (searchOffset > 0) { searchOffset -= searchLimit; fetchMarketplace(); } });
  if (nextBtn) nextBtn.addEventListener('click', () => { searchOffset += searchLimit; fetchMarketplace(); });

  // Setup Drag-and-Drop Upload Zone
  setupUploadZone();

  // Load Initial Data
  fetchMarketplace();
  checkAvailableUpdatesCount();
});

function refreshCurrentTab() {
  if (currentTab === 'marketplace') {
    fetchMarketplace();
  } else if (currentTab === 'installed') {
    fetchInstalledPlugins();
  } else if (currentTab === 'updates') {
    fetchAvailableUpdates();
  } else if (currentTab === 'logs') {
    fetchJobsList();
  } else if (currentTab === 'telemetry') {
    fetchTelemetryMetrics();
  }
}

// =============================================================================
// TAB NAVIGATION
// =============================================================================
function switchTab(tabId) {
  currentTab = tabId;
  
  // Update Tab Button Styles
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.className = 'tab-btn pb-4 text-sm font-medium border-b-2 border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300';
  });
  
  const activeBtn = document.getElementById(`tab-${tabId}`);
  if (activeBtn) {
    activeBtn.className = 'tab-btn pb-4 text-sm font-medium border-b-2 border-neutral-900 dark:border-white text-neutral-900 dark:text-white';
  }

  // Toggle Tab Contents
  document.querySelectorAll('.tab-content').forEach((content) => {
    content.classList.add('hidden');
    content.classList.remove('block');
  });

  const activeContent = document.getElementById(`content-${tabId}`);
  if (activeContent) {
    activeContent.classList.remove('hidden');
    activeContent.classList.add('block');
  }

  refreshCurrentTab();
}

// =============================================================================
// MARKETPLACE MODULE
// =============================================================================
async function fetchMarketplace() {
  const grid = document.getElementById('plugin-grid');
  if (!grid) return;

  // Show Skeleton Loaders
  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="bg-white dark:bg-neutral-900/40 p-6 border border-neutral-200 dark:border-white/5 rounded-2xl shadow-sm">
      <div class="flex gap-4">
        <div class="w-12 h-12 rounded-xl bg-neutral-200 dark:bg-neutral-800 skeleton-icon shrink-0"></div>
        <div class="flex-1 space-y-2">
          <div class="h-4 bg-neutral-200 dark:bg-neutral-800 rounded skeleton-text w-2/3"></div>
          <div class="h-3 bg-neutral-200 dark:bg-neutral-800 rounded skeleton-text w-1/2"></div>
        </div>
      </div>
      <div class="mt-4 h-12 bg-neutral-200 dark:bg-neutral-800 rounded skeleton-text"></div>
    </div>
  `).join('');

  const q = searchQuery;
  const category = document.getElementById('filter-category')?.value || '';
  const provider = document.getElementById('filter-provider')?.value || 'modrinth';

  try {
    const res = await fetch(`/api/plugins/search?q=${encodeURIComponent(q)}&category=${category}&provider=${provider}&limit=${searchLimit}&offset=${searchOffset}`);
    const data = await res.json();

    if (!data.success || data.results.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full text-center py-12 text-neutral-500">
          <svg class="w-12 h-12 mx-auto text-neutral-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          No plugins found matching filters.
        </div>
      `;
      document.getElementById('next-page').disabled = true;
      return;
    }

    grid.innerHTML = data.results.map((plugin) => `
      <div class="bg-white dark:bg-neutral-900/40 p-6 border border-neutral-200 dark:border-white/5 rounded-2xl shadow-sm plugin-card flex flex-col justify-between">
        <div>
          <div class="flex gap-4 mb-4">
            <img src="${plugin.iconUrl || '/assets/logo.png'}" onerror="this.src='/assets/logo.png'" alt="" class="w-12 h-12 rounded-xl object-cover shrink-0 bg-neutral-100 dark:bg-neutral-800">
            <div class="min-w-0">
              <h3 class="font-semibold text-neutral-800 dark:text-white truncate" title="${plugin.name}">${plugin.name}</h3>
              <p class="text-xs text-neutral-500 truncate">by ${plugin.author}</p>
            </div>
          </div>
          <p class="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2 leading-relaxed mb-4">${plugin.description}</p>
        </div>

        <div class="border-t border-neutral-200 dark:border-white/5 pt-4 flex items-center justify-between">
          <div class="flex items-center gap-1 text-xs text-neutral-500">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            <span>${formatNumber(plugin.downloads)}</span>
          </div>
          
          <div class="flex items-center gap-2">
            <button onclick="openDetails('${plugin.id}', '${plugin.provider}')" class="px-3 py-1.5 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 text-xs font-semibold rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 transition">
              Details
            </button>
            <button onclick="quickInstall('${plugin.id}', '${plugin.latestVersion}', '${plugin.provider}', '${plugin.name}')" class="px-3 py-1.5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-semibold rounded-lg hover:bg-neutral-700 dark:hover:bg-neutral-200 transition">
              Install
            </button>
          </div>
        </div>
      </div>
    `).join('');

    // Pagination Checks
    document.getElementById('prev-page').disabled = searchOffset === 0;
    document.getElementById('next-page').disabled = data.results.length < searchLimit;
    document.getElementById('page-indicator').innerText = `Page ${Math.floor(searchOffset / searchLimit) + 1}`;

  } catch (err) {
    grid.innerHTML = `<div class="col-span-full text-center py-12 text-red-500">Error connecting to provider: ${err.message}</div>`;
  }
}

// =============================================================================
// DETAILS MODAL
// =============================================================================
async function openDetails(pluginId, provider) {
  const modal = document.getElementById('details-modal');
  const loader = document.getElementById('modal-loader');
  const content = document.getElementById('modal-content');
  if (!modal) return;

  modal.classList.add('ov-open');
  modal.classList.remove('pointer-events-none');
  modal.style.opacity = '1';
  loader.classList.remove('hidden');
  content.classList.add('hidden');

  try {
    const res = await fetch(`/api/plugins/details?pluginId=${pluginId}&provider=${provider}`);
    const data = await res.json();

    if (!data.success) throw new Error(data.error);

    const details = data.details;
    
    // Set Fields
    document.getElementById('modal-icon').src = details.iconUrl || '/assets/logo.png';
    document.getElementById('modal-name').innerText = details.name;
    document.getElementById('modal-author').innerText = `by ${details.author}`;
    document.getElementById('modal-description').innerText = details.longDescription || details.description;
    document.getElementById('modal-downloads').innerText = formatNumber(details.downloads);
    document.getElementById('modal-platforms').innerText = details.supportedPlatforms.join(', ');
    document.getElementById('modal-mc-versions').innerText = details.supportedVersions.slice(0, 8).join(', ') + (details.supportedVersions.length > 8 ? '...' : '');
    
    // Changelog / Readme
    const changelogBox = document.getElementById('modal-changelog-box');
    changelogBox.innerHTML = details.versions[0]?.changelog 
      ? details.versions[0].changelog.replace(/\n/g, '<br>')
      : 'No release notes available for this version.';

    // Populate versions selector
    const verSelect = document.getElementById('modal-version-select');
    verSelect.innerHTML = details.versions.map(v => `
      <option value="${v.versionId}">${v.versionNumber} [${v.releaseType}]</option>
    `).join('');

    // Setup Install Button
    const installBtn = document.getElementById('modal-install-btn');
    installBtn.onclick = () => {
      const selectedVerId = verSelect.value;
      closeDetailsModal();
      quickInstall(pluginId, selectedVerId, provider, details.name);
    };

    // Badges
    document.getElementById('modal-verified-badge').classList.toggle('hidden', !details.isVerified);
    document.getElementById('modal-premium-badge').classList.toggle('hidden', !details.isPremium);
    document.getElementById('modal-license-badge').innerText = details.license || 'Proprietary';

    loader.classList.add('hidden');
    content.classList.remove('hidden');

  } catch (err) {
    loader.innerHTML = `<div class="text-red-500">Failed to load details: ${err.message}</div>`;
  }
}

function closeDetailsModal() {
  const modal = document.getElementById('details-modal');
  if (modal) {
    modal.classList.remove('ov-open');
    modal.classList.add('pointer-events-none');
    modal.style.opacity = '0';
  }
}

// =============================================================================
// INSTALL QUEUE PIPELINE OVERLAY
// =============================================================================
async function quickInstall(pluginId, versionId, provider, name) {
  if (!window.selectedServerUuid) {
    alert('Please select a target server from the top selector first.');
    return;
  }

  // Show installation progress overlay
  openInstallOverlay(name, provider);

  try {
    const res = await fetch('/api/plugins/install', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': window.csrfToken
      },
      body: JSON.stringify({
        serverId: window.selectedServerUuid,
        pluginId,
        versionId,
        provider,
        name
      })
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.error);

    activeJobId = data.jobId;
    startJobPolling(data.jobId);

  } catch (err) {
    document.getElementById('overlay-stage-text').innerText = 'Error Enqueuing Installation';
    document.getElementById('overlay-logs').innerText = err.message;
    document.getElementById('overlay-cancel-btn').classList.add('hidden');
    document.getElementById('overlay-done-btn').classList.remove('hidden');
  }
}

function openInstallOverlay(name, provider) {
  const overlay = document.getElementById('install-overlay');
  if (!overlay) return;

  overlay.classList.add('ov-open');
  overlay.classList.remove('pointer-events-none');
  overlay.style.opacity = '1';

  document.getElementById('overlay-title').innerText = `Installing ${name}`;
  document.getElementById('overlay-provider').innerText = provider;
  document.getElementById('overlay-stage-text').innerText = 'Connecting to job scheduler...';
  document.getElementById('overlay-percent-text').innerText = '0%';
  document.getElementById('overlay-progress-bar').style.width = '0%';
  document.getElementById('overlay-logs').innerText = 'Job enqueued. Waiting for free queue worker...';

  document.getElementById('overlay-cancel-btn').classList.remove('hidden');
  document.getElementById('overlay-done-btn').classList.add('hidden');
  
  // Cancel Action
  document.getElementById('overlay-cancel-btn').onclick = () => {
    cancelActiveJob();
  };
}

function closeInstallOverlay() {
  const overlay = document.getElementById('install-overlay');
  if (overlay) {
    overlay.classList.remove('ov-open');
    overlay.classList.add('pointer-events-none');
    overlay.style.opacity = '0';
  }
  stopJobPolling();
  refreshCurrentTab();
}

function startJobPolling(jobId) {
  stopJobPolling();
  
  jobPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/plugins/jobs/${jobId}`);
      const data = await res.json();

      if (!data.success) return;

      const job = data.job;
      
      // Update UI elements
      document.getElementById('overlay-stage-text').innerText = job.status.toUpperCase();
      document.getElementById('overlay-percent-text').innerText = `${Math.round(job.progress)}%`;
      document.getElementById('overlay-progress-bar').style.width = `${job.progress}%`;
      document.getElementById('overlay-logs').innerText = job.logs;

      // Handle termination
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        stopJobPolling();
        document.getElementById('overlay-cancel-btn').classList.add('hidden');
        document.getElementById('overlay-done-btn').classList.remove('hidden');
      }

    } catch (err) {
      logger.error('Error polling installation job:', err);
    }
  }, 1000);
}

function stopJobPolling() {
  if (jobPollInterval) {
    clearInterval(jobPollInterval);
    jobPollInterval = null;
  }
}

async function cancelActiveJob() {
  if (!activeJobId) return;
  try {
    await fetch(`/api/plugins/jobs/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': window.csrfToken
      },
      body: JSON.stringify({ jobId: activeJobId })
    });
  } catch (err) {
    logger.error('Cancel job failed:', err);
  }
  closeInstallOverlay();
}

// =============================================================================
// INSTALLED PLUGINS LIST
// =============================================================================
async function fetchInstalledPlugins() {
  const body = document.getElementById('installed-table-body');
  if (!body) return;

  if (!window.selectedServerUuid) {
    body.innerHTML = `<tr><td colspan="6" class="px-6 py-12 text-center text-neutral-400">Please select a server first.</td></tr>`;
    return;
  }

  body.innerHTML = `<tr><td colspan="6" class="px-6 py-12 text-center text-neutral-400"><div class="animate-spin inline-block w-6 h-6 border-2 border-neutral-400 border-t-transparent rounded-full mb-2"></div><br>Reading installed plugins...</td></tr>`;

  try {
    const res = await fetch(`/api/plugins/installed/${window.selectedServerUuid}`);
    const data = await res.json();

    if (!data.success || data.installed.length === 0) {
      body.innerHTML = `<tr><td colspan="6" class="px-6 py-12 text-center text-neutral-400">No plugins installed. Browse the Marketplace to add plugins!</td></tr>`;
      return;
    }

    body.innerHTML = data.installed.map((item) => `
      <tr class="hover:bg-neutral-50 dark:hover:bg-neutral-800/10 transition-colors">
        <td class="px-6 py-4 flex items-center gap-3">
          <img src="${item.plugin.iconUrl || '/assets/logo.png'}" alt="" class="w-8 h-8 rounded-lg object-cover">
          <div>
            <div class="font-semibold text-neutral-900 dark:text-white">${item.plugin.name}</div>
            <div class="text-xs text-neutral-400">by ${item.plugin.author || 'Registry'}</div>
          </div>
        </td>
        <td class="px-6 py-4 font-mono text-xs">${item.installedVersion}</td>
        <td class="px-6 py-4 font-mono text-xs text-neutral-500">${item.latestVersion || 'Unknown'}</td>
        <td class="px-6 py-4 uppercase text-xs font-semibold text-neutral-400">${item.provider}</td>
        <td class="px-6 py-4">
          <span class="px-2 py-0.5 text-xs font-semibold rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Enabled</span>
        </td>
        <td class="px-6 py-4 text-right">
          <button onclick="uninstallPlugin('${item.plugin.pluginId}', '${item.plugin.name}.jar')" class="text-xs font-semibold text-red-500 hover:text-red-700 transition">
            Uninstall
          </button>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="px-6 py-12 text-center text-red-500">Failed to load installed plugins: ${err.message}</td></tr>`;
  }
}

async function uninstallPlugin(pluginId, fileName) {
  if (!confirm(`Are you sure you want to uninstall this plugin? This will delete the plugin file (${fileName}) immediately.`)) return;

  try {
    const res = await fetch('/api/plugins/uninstall', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': window.csrfToken
      },
      body: JSON.stringify({
        serverId: window.selectedServerUuid,
        fileName,
        pluginId
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    alert('Plugin uninstalled successfully.');
    fetchInstalledPlugins();
  } catch (err) {
    alert(`Uninstall failed: ${err.message}`);
  }
}

// =============================================================================
// FILE UPLOADER
// =============================================================================
function setupUploadZone() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-upload-input');
  
  if (!dropZone || !fileInput) return;

  // Clicking dropzone triggers file picker
  dropZone.addEventListener('click', () => fileInput.click());

  // Prevent default drag behaviours
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // Visual highlights
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('border-neutral-500', 'bg-neutral-100/50'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('border-neutral-500', 'bg-neutral-100/50'), false);
  });

  // Handle dropped files
  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) handleFileUpload(files[0]);
  });

  // Handle selected files
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFileUpload(e.target.files[0]);
  });
}

async function handleFileUpload(file) {
  if (!window.selectedServerUuid) {
    alert('Please select a target server from the top selector first.');
    return;
  }

  const progressContainer = document.getElementById('upload-progress-container');
  const filenameEl = document.getElementById('upload-filename');
  const percentEl = document.getElementById('upload-percent');
  const progressBar = document.getElementById('upload-progress-bar');
  const statusEl = document.getElementById('upload-status');

  progressContainer.classList.remove('hidden');
  filenameEl.innerText = file.name;
  percentEl.innerText = '0%';
  progressBar.style.width = '0%';
  statusEl.innerText = 'Uploading file to server...';

  const formData = new FormData();
  formData.append('file', file);
  formData.append('serverId', window.selectedServerUuid);

  try {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        percentEl.innerText = `${percent}%`;
        progressBar.style.width = `${percent}%`;
      }
    });

    xhr.addEventListener('load', () => {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && data.success) {
        statusEl.innerText = 'File uploaded and bytecode scans passed successfully!';
        setTimeout(() => progressContainer.classList.add('hidden'), 3000);
      } else {
        statusEl.innerText = `Upload failed: ${data.error || 'Unknown error'}`;
      }
    });

    xhr.addEventListener('error', () => {
      statusEl.innerText = 'Connection lost during file upload. Try again.';
    });

    xhr.open('POST', '/api/plugins/upload');
    xhr.setRequestHeader('X-CSRF-Token', window.csrfToken);
    xhr.send(formData);

  } catch (err) {
    statusEl.innerText = `Upload failed: ${err.message}`;
  }
}

// =============================================================================
// TELEMETRY & OBSERVABILITY
// =============================================================================
async function fetchTelemetryMetrics() {
  const installs = document.getElementById('metric-total-installs');
  const success = document.getElementById('metric-success-rate');
  const avgTime = document.getElementById('metric-avg-time');
  const healthList = document.getElementById('provider-health-list');
  const popularList = document.getElementById('popular-plugins-list');
  
  if (!installs) return;

  try {
    const res = await fetch('/api/plugins/metrics');
    const data = await res.json();
    if (!data.success) return;

    const m = data.metrics;
    
    // Update basic stats
    installs.innerText = m.totalInstalls;
    success.innerText = `${m.installSuccessRate}%`;
    avgTime.innerText = `${(m.averageInstallDurationMs / 1000).toFixed(1)}s`;

    // Render health status list
    healthList.innerHTML = m.providerMetrics.map(p => `
      <div class="flex items-center justify-between border-b border-neutral-200 dark:border-white/5 pb-3 last:border-0 last:pb-0">
        <div class="flex items-center gap-2">
          <span class="status-dot ${p.status}"></span>
          <span class="text-sm font-semibold text-neutral-800 dark:text-white">${p.name}</span>
        </div>
        <div class="text-xs text-neutral-400 font-medium">
          Latency: <span class="font-semibold text-neutral-700 dark:text-neutral-200">${p.latencyMs}ms</span> |
          Success: <span class="font-semibold text-neutral-700 dark:text-neutral-200">${p.successRate}%</span>
        </div>
      </div>
    `).join('');

    // Render popular list
    if (m.popularPlugins.length === 0) {
      popularList.innerHTML = `<p class="text-xs text-neutral-400">No telemetry data recorded yet.</p>`;
    } else {
      popularList.innerHTML = m.popularPlugins.map((p, idx) => `
        <div class="flex items-center justify-between py-2 text-xs border-b border-neutral-200 dark:border-white/5 last:border-0">
          <span class="text-neutral-600 dark:text-neutral-300 font-medium">${idx + 1}. ${p.name} (${p.version})</span>
          <span class="font-bold text-neutral-900 dark:text-white">${p.installCount} installs</span>
        </div>
      `).join('');
    }

  } catch (err) {
    logger.error('Error fetching telemetry metrics:', err);
  }
}

// =============================================================================
// LOGS STREAM VIEWER
// =============================================================================
async function fetchJobsList() {
  const listEl = document.getElementById('jobs-list');
  if (!listEl) return;

  try {
    const serverParam = window.selectedServerUuid ? `?serverId=${window.selectedServerUuid}` : '';
    const res = await fetch(`/api/plugins/jobs${serverParam}`);
    const data = await res.json();

    if (!data.success || data.jobs.length === 0) {
      listEl.innerHTML = `<p class="text-xs text-neutral-400 py-4 text-center">No installation logs found.</p>`;
      return;
    }

    listEl.innerHTML = data.jobs.map(job => `
      <button onclick="viewJobLogs('${job.id}')" class="w-full text-left p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/20 transition-all flex flex-col gap-1 focus:outline-none">
        <div class="flex justify-between items-center">
          <span class="font-bold text-xs text-neutral-800 dark:text-neutral-200 truncate max-w-[120px]">${job.name}</span>
          <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${getJobStatusBadgeClass(job.status)}">${job.status}</span>
        </div>
        <div class="text-[9px] text-neutral-400">${new Date(job.createdAt).toLocaleString()}</div>
      </button>
    `).join('');

  } catch (err) {
    listEl.innerHTML = `<p class="text-xs text-red-500 py-4">Failed to load jobs.</p>`;
  }
}

async function viewJobLogs(jobId) {
  const term = document.getElementById('job-terminal-output');
  if (!term) return;

  term.innerText = 'Reading job logs stream...';

  try {
    const res = await fetch(`/api/plugins/jobs/${jobId}`);
    const data = await res.json();

    if (!data.success) throw new Error(data.error);

    term.innerText = data.job.logs || 'No logs recorded for this job.';
  } catch (err) {
    term.innerText = `Error: ${err.message}`;
  }
}

function getJobStatusBadgeClass(status) {
  switch (status) {
    case 'completed': return 'bg-emerald-500/10 text-emerald-500';
    case 'failed': return 'bg-red-500/10 text-red-500';
    case 'cancelled': return 'bg-neutral-500/10 text-neutral-500';
    default: return 'bg-amber-500/10 text-amber-500';
  }
}

// =============================================================================
// UPDATES MANAGER
// =============================================================================
async function fetchAvailableUpdates() {
  const container = document.getElementById('updates-list-container');
  const updateAllBtn = document.getElementById('update-all-btn');
  if (!container) return;

  if (!window.selectedServerUuid) {
    container.innerHTML = `<div class="text-center py-12 text-neutral-400">Please select a server first.</div>`;
    return;
  }

  try {
    const res = await fetch(`/api/plugins/installed/${window.selectedServerUuid}`);
    const data = await res.json();
    if (!data.success) return;

    // Filter plugins with updates
    const updates = data.installed.filter(item => item.latestVersion && item.installedVersion !== item.latestVersion);

    if (updates.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-2xl text-neutral-500">
          <svg class="w-10 h-10 text-emerald-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          All plugins are fully up to date!
        </div>
      `;
      updateAllBtn.classList.add('hidden');
      document.getElementById('update-badge').classList.add('hidden');
      return;
    }

    // Show update all button and update tab badge count
    updateAllBtn.classList.remove('hidden');
    document.getElementById('update-badge').classList.remove('hidden');
    document.getElementById('update-badge').innerText = updates.length;

    // Setup update all action
    updateAllBtn.onclick = async () => {
      const pluginIds = updates.map(u => u.plugin.pluginId);
      updateAllBtn.disabled = true;
      updateAllBtn.innerText = 'Enqueuing Updates...';

      try {
        const updateRes = await fetch('/api/plugins/update-batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': window.csrfToken
          },
          body: JSON.stringify({
            serverId: window.selectedServerUuid,
            pluginIds
          })
        });
        const updateData = await updateRes.json();
        
        alert(`Successfully enqueued ${updateData.enqueued.length} updates!`);
        switchTab('logs');
      } catch (err) {
        alert(`Failed to run updates: ${err.message}`);
      } finally {
        updateAllBtn.disabled = false;
        updateAllBtn.innerText = 'Update All Selected';
      }
    };

    container.innerHTML = updates.map(item => `
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/5 rounded-2xl p-6 flex justify-between items-center shadow-sm">
        <div class="flex items-center gap-4">
          <img src="${item.plugin.iconUrl || '/assets/logo.png'}" alt="" class="w-10 h-10 rounded-xl object-cover shrink-0">
          <div>
            <h4 class="font-bold text-neutral-800 dark:text-white">${item.plugin.name}</h4>
            <div class="text-xs text-neutral-400 mt-1">
              Installed: <span class="font-mono">${item.installedVersion}</span> |
              Latest: <span class="font-mono text-emerald-500">${item.latestVersion}</span>
            </div>
          </div>
        </div>

        <button onclick="quickInstall('${item.plugin.pluginId}', '${item.latestVersion}', '${item.provider}', '${item.plugin.name}')" class="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg shadow-sm transition">
          Update Version
        </button>
      </div>
    `).join('');

  } catch (err) {
    container.innerHTML = `<div class="text-center py-12 text-red-500">Failed to fetch updates list: ${err.message}</div>`;
  }
}

async function checkAvailableUpdatesCount() {
  if (!window.selectedServerUuid) return;
  try {
    const res = await fetch(`/api/plugins/installed/${window.selectedServerUuid}`);
    const data = await res.json();
    if (!data.success) return;

    const updates = data.installed.filter(item => item.latestVersion && item.installedVersion !== item.latestVersion);
    const badge = document.getElementById('update-badge');
    if (badge) {
      if (updates.length > 0) {
        badge.classList.remove('hidden');
        badge.innerText = updates.length;
      } else {
        badge.classList.add('hidden');
      }
    }
  } catch {
    // Suppress background errors
  }
}

// =============================================================================
// UTILITIES
// =============================================================================
function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}
