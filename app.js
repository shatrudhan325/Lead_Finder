// ─── State ───────────────────────────────────────────────────────────────────
let allLeads = JSON.parse(localStorage.getItem('lf_leads') || '[]');
let filteredLeads = [...allLeads];
let currentRating = 0;
let currentRunId = null;
let pollInterval = null;

// ─── Cost constants (Apify Google Maps Scraper pricing) ───────────────────────
const COST_PER_1K = 2.10;   // USD per 1,000 places scraped
const PLATFORM_RATE = 0.15;   // ~15% platform overhead estimate
let totalCostSpent = parseFloat(localStorage.getItem('lf_total_cost') || '0');

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  updateStats();
  renderLeads();
  renderRecentLeads();
  updateSettingsPage();
  updateCostEstimate();
  updateExportUI();
  // Close export menu on outside click
  document.addEventListener('click', e => {
    if (!document.getElementById('exportDropdown')?.contains(e.target)) {
      closeExportMenu();
    }
  });
});

// ─── Navigation ───────────────────────────────────────────────────────────────
function switchView(viewId, el) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('view-' + viewId).classList.add('active');
  if (el) el.classList.add('active');

  const titles = {
    dashboard: ['Dashboard', 'Welcome back — your lead pipeline at a glance'],
    generate: ['Find Leads', 'Configure and launch your Google Maps scraper'],
    leads: ['My Leads', `${allLeads.length} leads in your collection`],
    settings: ['Settings', 'Configure API keys and preferences']
  };
  document.getElementById('pageTitle').textContent = titles[viewId][0];
  document.getElementById('pageSubtitle').textContent = titles[viewId][1];

  if (viewId === 'leads') { filteredLeads = [...allLeads]; renderLeads(); }
  if (viewId === 'settings') updateSettingsPage();
  return false;
}

// ─── Cost Estimation ─────────────────────────────────────────────────────────
function calcCost(places) {
  const scrape = (places / 1000) * COST_PER_1K;
  const platform = scrape * PLATFORM_RATE;
  return { scrape, platform, total: scrape + platform };
}

function updateCostEstimate() {
  const max = parseInt(document.getElementById('maxResults')?.value || '50');
  const c = calcCost(max);
  const fmt = v => `~$${v.toFixed(3)}`;
  const el = id => document.getElementById(id);
  if (el('costScrape')) el('costScrape').textContent = fmt(c.scrape);
  if (el('costPlatform')) el('costPlatform').textContent = fmt(c.platform);
  if (el('costTotal')) el('costTotal').textContent = fmt(c.total);
  if (el('progressCost')) el('progressCost').textContent = fmt(c.total);
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
  const key = localStorage.getItem('lf_api_key') || '';
  const actor = localStorage.getItem('lf_actor_id') || 'compass/crawler-google-places';
  if (key) {
    document.getElementById('apiKey').value = key;
    document.getElementById('settingsApiKey').value = key;
    setApiStatus(true);
  }
  document.getElementById('actorId').value = actor;
}

function saveApiKey() {
  const key = document.getElementById('settingsApiKey').value.trim();
  if (!key) { showToast('Please enter an API key', 'error'); return; }
  localStorage.setItem('lf_api_key', key);
  document.getElementById('apiKey').value = key;
  setApiStatus(true);
  showToast('API key saved successfully', 'success');
}

function saveActorId() {
  const id = document.getElementById('actorId').value.trim() || 'compass/crawler-google-places';
  localStorage.setItem('lf_actor_id', id);
  showToast('Actor ID saved', 'success');
}

function setApiStatus(active) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  dot.className = 'status-dot ' + (active ? 'active' : 'inactive');
  text.textContent = active ? 'API Connected' : 'No API Key';
}

function updateSettingsPage() {
  document.getElementById('settingsTotalLeads').textContent = allLeads.length;
  const size = (new Blob([JSON.stringify(allLeads)]).size / 1024).toFixed(1);
  document.getElementById('settingsStorageSize').textContent = size + ' KB';
}

function toggleApiKey() {
  const el = document.getElementById('apiKey');
  el.type = el.type === 'password' ? 'text' : 'password';
}
function toggleSettingsApiKey() {
  const el = document.getElementById('settingsApiKey');
  el.type = el.type === 'password' ? 'text' : 'password';
}

// ─── Rating Selector ──────────────────────────────────────────────────────────
function setRating(val, btn) {
  currentRating = val;
  document.getElementById('minRating').value = val;
  document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ─── Generate Leads ───────────────────────────────────────────────────────────
async function generateLeads(e) {
  e.preventDefault();

  const apiKey = document.getElementById('apiKey').value.trim();
  const query = document.getElementById('searchQuery').value.trim();
  const loc = document.getElementById('location').value.trim();
  const max = parseInt(document.getElementById('maxResults').value);
  const lang = document.getElementById('language').value;
  const minRat = parseFloat(document.getElementById('minRating').value) || 0;
  const doScrapeContacts = document.getElementById('scrapeContacts')?.checked || false;
  const actorId = localStorage.getItem('lf_actor_id') || 'compass/crawler-google-places';

  if (!apiKey) { showToast('Please enter your Apify API key', 'error'); return; }
  localStorage.setItem('lf_api_key', apiKey);
  setApiStatus(true);

  setGenerateLoading(true);
  showProgress(true, 'Starting scraper on Apify...');

  const input = {
    searchStringsArray: [query],
    locationQuery: loc,
    maxCrawledPlacesPerSearch: max,
    language: lang,
    scrapeContacts: doScrapeContacts
  };

  try {
    // Start the actor run
    const startRes = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }
    );

    if (!startRes.ok) {
      const err = await startRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${startRes.status}`);
    }

    const startData = await startRes.json();
    currentRunId = startData.data.id;
    const datasetId = startData.data.defaultDatasetId;

    updateProgress(10, 'Scraping Google Maps...', 0);
    startElapsedTimer();

    // Update Apify console link to the specific run
    const consoleLink = document.getElementById('apifyConsoleLink');
    if (consoleLink) consoleLink.href = `https://console.apify.com/actors/runs/${currentRunId}`;

    pollForResults(apiKey, currentRunId, datasetId, max, minRat);

  } catch (err) {
    stopElapsedTimer();
    setGenerateLoading(false);
    showProgress(false);
    showToast('Error: ' + err.message, 'error');
    console.error(err);
  }
}

// ─── Elapsed Timer ───────────────────────────────────────────────────────────
let elapsedInterval = null;
let elapsedSecs = 0;

function startElapsedTimer() {
  elapsedSecs = 0;
  clearInterval(elapsedInterval);
  const el = document.getElementById('progressTimer');
  if (el) el.textContent = '0s';
  elapsedInterval = setInterval(() => {
    elapsedSecs++;
    if (!el) return;
    if (elapsedSecs < 60) el.textContent = elapsedSecs + 's';
    else el.textContent = Math.floor(elapsedSecs / 60) + 'm ' + (elapsedSecs % 60) + 's';
  }, 1000);
}

function stopElapsedTimer() {
  clearInterval(elapsedInterval);
}

// ─── Manual status check ───────────────────────────────────────────────────
let _manualCheckApiKey, _manualCheckRunId, _manualCheckDatasetId, _manualCheckMax, _manualCheckMinRat;
async function checkStatusNow() {
  if (!_manualCheckRunId) return;
  const btn = document.getElementById('checkNowBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
  try {
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${_manualCheckRunId}?token=${_manualCheckApiKey}`);
    const statusData = await statusRes.json();
    const status = statusData.data.status;
    const itemCount = statusData.data.stats?.itemCount || 0;
    updateProgress(Math.min(90, 10 + (itemCount / Math.max(_manualCheckMax, 1)) * 80),
      `Status: ${status} — Found ${itemCount} places`, itemCount);
    showToast(`Status: ${status} · ${itemCount} leads so far`, 'info');
    if (status === 'SUCCEEDED') {
      clearInterval(pollInterval);
      stopElapsedTimer();
      const itemsRes = await fetch(
        `https://api.apify.com/v2/datasets/${_manualCheckDatasetId}/items?token=${_manualCheckApiKey}&clean=true&format=json`
      );
      const items = await itemsRes.json();
      finishScrape(items, _manualCheckMinRat);
    }
  } catch (e) {
    showToast('Could not fetch status: ' + e.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Check Now'; }
}

function pollForResults(apiKey, runId, datasetId, max, minRat) {
  // Store for manual check
  _manualCheckApiKey = apiKey;
  _manualCheckRunId = runId;
  _manualCheckDatasetId = datasetId;
  _manualCheckMax = max;
  _manualCheckMinRat = minRat;
  let attempts = 0;
  const maxAttempts = 180; // 15 min timeout at 5s intervals

  pollInterval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(pollInterval);
      stopElapsedTimer();
      setGenerateLoading(false);
      showToast('Timed out after 15 min. Use "Check Now" or view Apify Console.', 'error');
      return;
    }

    try {
      // Check run status
      const statusRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${apiKey}`
      );
      const statusData = await statusRes.json();
      const status = statusData.data.status;
      const itemCount = statusData.data.stats?.itemCount || 0;

      const pct = Math.min(90, 10 + (itemCount / Math.max(max, 1)) * 80);
      updateProgress(pct, `Status: ${status} — Found ${itemCount} places...`, itemCount);

      if (status === 'SUCCEEDED') {
        clearInterval(pollInterval);
        stopElapsedTimer();
        // Fetch dataset items
        const itemsRes = await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiKey}&clean=true&format=json`
        );
        const items = await itemsRes.json();
        finishScrape(items, minRat);
      } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT' || status === 'TIMING-OUT') {
        clearInterval(pollInterval);
        stopElapsedTimer();
        setGenerateLoading(false);
        showProgress(false);
        showToast(`Scrape ${status}. Check Apify Console for details.`, 'error');
      }
    } catch (err) {
      console.warn('Poll error:', err);
    }
  }, 5000);
}

function finishScrape(items, minRat) {
  // Filter by min rating
  let results = Array.isArray(items) ? items : [];
  if (minRat > 0) {
    results = results.filter(p => (p.totalScore || 0) >= minRat);
  }

  updateProgress(100, `Done! Found ${results.length} leads.`, results.length);
  stopElapsedTimer();

  // Track cost
  const max = parseInt(document.getElementById('maxResults')?.value || '50');
  const c = calcCost(max);
  totalCostSpent += c.total;
  localStorage.setItem('lf_total_cost', totalCostSpent.toFixed(4));

  // Increment run counter
  const runs = parseInt(localStorage.getItem('lf_runs') || '0') + 1;
  localStorage.setItem('lf_runs', runs);

  // Add to storage with timestamp
  const newLeads = results.map(p => ({ ...p, _savedAt: Date.now() }));
  allLeads = [...newLeads, ...allLeads];
  filteredLeads = [...allLeads];
  localStorage.setItem('lf_leads', JSON.stringify(allLeads));

  // Update UI
  updateStats();
  renderRecentLeads();
  renderGenerateResults(results);
  showToast(`✅ ${results.length} leads saved — est. cost $${c.total.toFixed(3)}`, 'success');
  setGenerateLoading(false);
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function setGenerateLoading(loading) {
  const btn = document.getElementById('generateBtn');
  btn.disabled = loading;
  document.querySelector('.btn-text').classList.toggle('hidden', loading);
  document.querySelector('.btn-loading').classList.toggle('hidden', !loading);
}

function showProgress(show, msg = '') {
  const sec = document.getElementById('progressSection');
  sec.classList.toggle('hidden', !show);
  if (show && msg) document.getElementById('progressStatus').textContent = msg;
}

function updateProgress(pct, msg, count) {
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressStatus').textContent = msg;
  document.getElementById('progressCount').textContent = count;
  document.getElementById('progressEta').textContent = pct < 100 ? 'Running...' : 'Complete!';
  showProgress(true);
}

// ─── Helper: resolve email from multiple possible fields ─────────────────────
function getEmail(p) {
  if (p.email) return p.email;
  if (Array.isArray(p.emails) && p.emails.length) return p.emails[0];
  if (p.scrapedContacts && p.scrapedContacts.emails && p.scrapedContacts.emails.length)
    return p.scrapedContacts.emails[0];
  return null;
}

function renderGenerateResults(leads) {
  const preview = document.getElementById('resultsPreview');
  if (!leads.length) {
    preview.innerHTML = `<div class="idle-state"><h3>No results found</h3><p>Try adjusting your search query or location.</p></div>`;
    return;
  }

  const cards = leads.slice(0, 20).map(p => buildMiniCard(p)).join('');
  preview.innerHTML = `
    <div style="padding:14px 16px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
      <span style="font-size:0.82rem; color:var(--text2)">Showing ${Math.min(20, leads.length)} of ${leads.length} leads</span>
      <button class="btn-ghost" onclick="switchView('leads', document.querySelector('[data-view=leads]'))">View All →</button>
    </div>
    <div class="lead-mini-grid">${cards}</div>
  `;
}

function buildMiniCard(p) {
  const emoji = getCategoryEmoji(p.categoryName);
  const rating = p.totalScore ? `<span class="lead-rating">⭐ ${p.totalScore}</span>` : '';
  const phone = p.phone ? `<span class="lead-tag">📞 ${p.phone}</span>` : '';
  const web = p.website ? `<span class="lead-tag">🌐 Website</span>` : '';
  return `
    <div class="lead-mini-card" onclick='openModal(${JSON.stringify(p).replace(/'/g, "&#39;")})'>
      <div class="lead-mini-avatar">${emoji}</div>
      <div class="lead-mini-info">
        <div class="lead-mini-name">${escHtml(p.title || 'Unknown')}</div>
        <div class="lead-mini-cat">${escHtml(p.categoryName || '')}</div>
        <div class="lead-mini-meta">${rating}${phone}${web}</div>
      </div>
      <button class="btn-detail">View</button>
    </div>`;
}

// ─── Leads Collection ─────────────────────────────────────────────────────────
function renderLeads() {
  const container = document.getElementById('leadsContainer');
  if (!filteredLeads.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
      <h3>${allLeads.length ? 'No matching leads' : 'No leads yet'}</h3>
      <p>${allLeads.length ? 'Try a different search term' : 'Generate your first batch of leads'}</p>
      ${!allLeads.length ? '<button class="btn-primary" onclick="switchView(\'generate\', document.querySelector(\'[data-view=generate]\'))">Find Leads Now</button>' : ''}
    </div>`;
    return;
  }

  const cards = filteredLeads.map((p, i) => buildLeadCard(p, i)).join('');
  container.innerHTML = `<div class="leads-grid">${cards}</div>`;
}

function buildLeadCard(p, idx) {
  const emoji = getCategoryEmoji(p.categoryName);
  const email = getEmail(p);
  const stars = p.totalScore ? `<span class="star-rating">⭐ ${p.totalScore} <span style="color:var(--text3);font-weight:400">(${p.reviewsCount || 0})</span></span>` : '';
  const phone = p.phone ? `<div class="lead-info-row"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.69h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l.81-.81a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span>${escHtml(p.phone)}</span></div>` : '';
  const addr = p.address ? `<div class="lead-info-row"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span>${escHtml(p.address)}</span></div>` : '';
  const web = p.website ? `<div class="lead-info-row"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>${escHtml(p.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</span></div>` : '';
  const emailRow = email ? `<div class="lead-info-row email-row"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><span>${escHtml(email)}</span></div>` : '';
  const safeP = JSON.stringify(p).replace(/'/g, "&#39;").replace(/"/g, '&quot;');

  return `<div class="lead-card" onclick="openModal(JSON.parse(this.dataset.lead))" data-lead="${safeP}">
    <div class="lead-card-top">
      <div class="lead-avatar">${emoji}</div>
      <div style="flex:1;min-width:0">
        <div class="lead-name">${escHtml(p.title || 'Unknown')}</div>
        <div class="lead-category">${escHtml(p.categoryName || '')}</div>
        <div style="margin-top:5px">${stars}</div>
      </div>
    </div>
    <div class="lead-card-body">${phone}${emailRow}${addr}${web}</div>
    <div class="lead-card-foot">
      ${p.phone ? `<button class="btn-sm primary" onclick="event.stopPropagation();window.open('tel:${p.phone}')">Call</button>` : ''}
      ${email ? `<button class="btn-sm primary" onclick="event.stopPropagation();window.open('mailto:${email}')">Email</button>` : ''}
      ${p.website ? `<button class="btn-sm" onclick="event.stopPropagation();window.open('${p.website}','_blank')">Website</button>` : ''}
      <button class="btn-sm" onclick="event.stopPropagation();openModal(JSON.parse(this.closest('.lead-card').dataset.lead))">Details</button>
    </div>
  </div>`;
}

function renderRecentLeads() {
  const el = document.getElementById('recentLeadsContent');
  if (!allLeads.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></div>
      <h3>No leads yet</h3><p>Run your first lead generation to see results here</p>
      <button class="btn-primary" onclick="switchView('generate', document.querySelector('[data-view=generate]'))">Start Finding Leads</button>
    </div>`;
    return;
  }
  const cards = allLeads.slice(0, 6).map(p => buildMiniCard(p)).join('');
  el.innerHTML = `<div class="lead-mini-grid">${cards}</div>`;
}

// ─── Filter & Sort ────────────────────────────────────────────────────────────
function filterLeads() {
  const q = document.getElementById('leadsSearch').value.toLowerCase();
  filteredLeads = allLeads.filter(p => {
    const email = getEmail(p) || '';
    return (
      (p.title || '').toLowerCase().includes(q) ||
      (p.categoryName || '').toLowerCase().includes(q) ||
      (p.address || '').toLowerCase().includes(q) ||
      (p.phone || '').includes(q) ||
      email.toLowerCase().includes(q)
    );
  });
  // Update search badge
  const badge = document.getElementById('searchBadge');
  if (badge) badge.textContent = filteredLeads.length;
  renderLeads();
}

function sortLeadsData() {
  const val = document.getElementById('sortLeads').value;
  filteredLeads = [...filteredLeads].sort((a, b) => {
    if (val === 'rating') return (b.totalScore || 0) - (a.totalScore || 0);
    if (val === 'name') return (a.title || '').localeCompare(b.title || '');
    return (b._savedAt || 0) - (a._savedAt || 0);
  });
  renderLeads();
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('totalLeads').textContent = allLeads.length;
  const runs = parseInt(localStorage.getItem('lf_runs') || '0');
  document.getElementById('totalRuns').textContent = runs;
  const ratings = allLeads.filter(p => p.totalScore).map(p => p.totalScore);
  document.getElementById('avgRating').textContent = ratings.length
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : '—';
  document.getElementById('withPhone').textContent = allLeads.filter(p => p.phone).length;
  // Cost spent
  const spent = parseFloat(localStorage.getItem('lf_total_cost') || '0');
  const costEl = document.getElementById('totalCostSpent');
  if (costEl) costEl.textContent = `$${spent.toFixed(3)}`;
  const subtitle = `${allLeads.length} leads in your collection`;
  const el = document.getElementById('pageSubtitle');
  if (document.getElementById('view-leads').classList.contains('active')) el.textContent = subtitle;
  updateExportUI();
}

// ─── Export Dropdown ─────────────────────────────────────────────────────────
function toggleExportMenu() {
  const dd = document.getElementById('exportDropdown');
  const menu = document.getElementById('exportMenu');
  const isOpen = dd.classList.contains('open');
  if (isOpen) { closeExportMenu(); } else {
    dd.classList.add('open');
    menu.classList.remove('hidden');
    updateExportUI();
  }
}

function closeExportMenu() {
  document.getElementById('exportDropdown')?.classList.remove('open');
  document.getElementById('exportMenu')?.classList.add('hidden');
}

function updateExportUI() {
  const count = allLeads.length;
  // Update count badge in button
  const ec = document.getElementById('exportCount');
  if (ec) ec.textContent = count;
  // Update search badge
  const sb = document.getElementById('searchBadge');
  if (sb) sb.textContent = filteredLeads.length || count;

  if (!count) return;
  // Build CSV to measure size
  const headers = ['Name', 'Category', 'Address', 'Phone', 'Email', 'Website', 'Rating', 'Reviews', 'City', 'State'];
  const csvRows = allLeads.map(p => [
    p.title, p.categoryName, p.address, p.phone, getEmail(p), p.website,
    p.totalScore, p.reviewsCount, p.city, p.state
  ].map(v => `"${(v || '').toString().replace(/"/g, '""')}"`));
  const csvStr = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
  const csvKb = (new Blob([csvStr]).size / 1024).toFixed(1);
  const jsonKb = (new Blob([JSON.stringify(allLeads)]).size / 1024).toFixed(1);
  const cs = document.getElementById('csvSize');
  const js = document.getElementById('jsonSize');
  if (cs) cs.textContent = csvKb + ' KB';
  if (js) js.textContent = jsonKb + ' KB';
}

// ─── Export ───────────────────────────────────────────────────────────────────
function exportLeads(format) {

  console.log('Exporting..')

  closeExportMenu();
  if (!allLeads.length) { showToast('No leads to export', 'error'); return; }

  // Show download overlay
  const overlay = document.getElementById('dlOverlay');
  const bar = document.getElementById('dlProgressBar');
  const iconWrap = document.getElementById('dlIconWrap');
  const title = document.getElementById('dlTitle');
  const subtitle = document.getElementById('dlSubtitle');
  const dlRows = document.getElementById('dlRows');
  const dlSize = document.getElementById('dlSize');
  const dlFormat = document.getElementById('dlFormat');

  overlay.classList.remove('hidden');
  iconWrap.classList.remove('done');
  bar.classList.remove('done');
  bar.style.width = '0%';
  title.textContent = `Preparing ${format.toUpperCase()} file...`;
  subtitle.textContent = `Processing ${allLeads.length} leads`;
  dlRows.textContent = allLeads.length + ' leads';
  dlFormat.textContent = format.toUpperCase();

  // Animate progress in steps
  let pct = 0;
  const tick = setInterval(() => {
    pct = Math.min(pct + (Math.random() * 20 + 10), 90);
    bar.style.width = pct + '%';
  }, 120);

  // Small async delay so animation is visible
  setTimeout(() => {
    let content, filename, type;

    if (format === 'csv') {
      const headers = ['Name', 'Category', 'Address', 'Phone', 'Email', 'Website', 'Rating', 'Reviews', 'City', 'State'];
      const rows = allLeads.map(p => [
        p.title, p.categoryName, p.address, p.phone, getEmail(p), p.website,
        p.totalScore, p.reviewsCount, p.city, p.state
      ].map(v => `"${(v || '').toString().replace(/"/g, '""')}"`));
      content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      filename = `leads_${allLeads.length}_${Date.now()}.csv`;
      type = 'text/csv';
    } else {
      content = JSON.stringify(allLeads, null, 2);
      filename = `leads_${allLeads.length}_${Date.now()}.json`;
      type = 'application/json';
    }

    const sizeKb = (new Blob([content]).size / 1024).toFixed(1);
    dlSize.textContent = sizeKb + ' KB';

    clearInterval(tick);
    bar.style.width = '100%';
    bar.classList.add('done');
    iconWrap.classList.add('done');
    iconWrap.innerHTML = '<svg class="dl-icon-svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    title.textContent = 'Download ready!';
    subtitle.textContent = `${allLeads.length} leads · ${sizeKb} KB · ${format.toUpperCase()}`;

    setTimeout(() => {
      downloadFile(content, filename, type);
      setTimeout(() => {
        overlay.classList.add('hidden');
        // Reset icon for next time
        iconWrap.innerHTML = '<svg class="dl-icon-svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      }, 1200);
    }, 400);

    showToast(`✅ ${allLeads.length} leads exported as ${format.toUpperCase()}`, 'success');
  }, 600);
}

function downloadFile(content, filename, type) {
  // Add UTF-8 BOM for CSV so Mac Excel/Numbers opens it correctly
  const bom = (type === 'text/csv') ? '\uFEFF' : '';
  const blob = new Blob([bom + content], { type: type + ';charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);   // must be in DOM for Safari/Mac
  a.click();
  document.body.removeChild(a);
  // Delay revoke so browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ─── Clear ────────────────────────────────────────────────────────────────────
function clearAllLeads() {
  if (!confirm('Clear ALL leads? This cannot be undone.')) return;
  allLeads = []; filteredLeads = [];
  localStorage.removeItem('lf_leads');
  updateStats(); renderLeads(); renderRecentLeads(); updateSettingsPage();
  showToast('All leads cleared', 'info');
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(p) {
  const emoji = getCategoryEmoji(p.categoryName);
  const email = getEmail(p);
  const allEmails = [
    ...(p.email ? [p.email] : []),
    ...(Array.isArray(p.emails) ? p.emails : []),
    ...(p.scrapedContacts?.emails || [])
  ].filter((e, i, a) => e && a.indexOf(e) === i);  // unique
  const hours = p.openingHours ? p.openingHours.map(h => `${h.day}: ${h.hours}`).join('<br>') : null;

  const emailFieldHtml = allEmails.length
    ? `<div class="modal-field email-modal-field">
        <span class="modal-field-icon">✉️</span>
        <div style="flex:1;min-width:0">
          <div class="modal-field-label">Email${allEmails.length > 1 ? 's' : ''}</div>
          ${allEmails.map(e => `
            <div class="email-modal-row">
              <a href="mailto:${e}" class="modal-field-value email-link">${escHtml(e)}</a>
              <button class="btn-copy-email" onclick="copyEmail('${e}', this)" title="Copy email">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Copy
              </button>
            </div>`).join('')}
        </div>
      </div>`
    : '';

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-header">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
        <span style="font-size:2rem">${emoji}</span>
        <div>
          <div class="modal-title">${escHtml(p.title || 'Unknown')}</div>
          <div class="modal-category">${escHtml(p.categoryName || '')} ${p.city ? '· ' + escHtml(p.city) : ''}</div>
          ${p.totalScore ? `<div class="modal-rating"><span style="color:var(--gold);font-size:0.9rem">★ ${p.totalScore}</span><span style="font-size:0.78rem;color:var(--text3)">(${p.reviewsCount || 0} reviews)</span></div>` : ''}
        </div>
      </div>
    </div>
    <div class="modal-body">
      ${p.address ? field('📍', 'Address', escHtml(p.address)) : ''}
      ${p.phone ? field('📞', 'Phone', `<a href="tel:${p.phone}">${escHtml(p.phone)}</a>`) : ''}
      ${emailFieldHtml}
      ${p.website ? field('🌐', 'Website', `<a href="${p.website}" target="_blank">${escHtml(p.website)}</a>`) : ''}
      ${p.description ? field('📝', 'Description', escHtml(p.description)) : ''}
      ${hours ? field('🕒', 'Hours', hours) : ''}
      ${p.price ? field('💰', 'Price Range', escHtml(p.price)) : ''}
      ${p.plusCode ? field('📌', 'Plus Code', escHtml(p.plusCode)) : ''}
      ${!allEmails.length ? '<div class="no-email-notice">📭 No email found — enable contact scraping in Apify or check the website manually</div>' : ''}
      ${p.url ? `<a href="${p.url}" target="_blank" class="btn-primary" style="margin-top:6px;text-decoration:none;display:inline-flex">View on Google Maps ↗</a>` : ''}
    </div>`;

  document.getElementById('modalOverlay').classList.remove('hidden');
}

function copyEmail(email, btn) {
  navigator.clipboard.writeText(email).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Copied!';
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
  }).catch(() => showToast('Could not copy — please copy manually', 'error'));
}

function field(icon, label, value) {
  return `<div class="modal-field">
    <span class="modal-field-icon">${icon}</span>
    <div>
      <div class="modal-field-label">${label}</div>
      <div class="modal-field-value">${value}</div>
    </div>
  </div>`;
}

function closeModal(e) {
  if (!e || e.target === document.getElementById('modalOverlay') || !e.target.closest) {
    document.getElementById('modalOverlay').classList.add('hidden');
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCategoryEmoji(cat) {
  const c = (cat || '').toLowerCase();
  if (c.includes('restaurant') || c.includes('food') || c.includes('cafe') || c.includes('bar')) return '🍽️';
  if (c.includes('doctor') || c.includes('medical') || c.includes('health') || c.includes('clinic')) return '🏥';
  if (c.includes('dentist')) return '🦷';
  if (c.includes('lawyer') || c.includes('law') || c.includes('attorney')) return '⚖️';
  if (c.includes('hotel') || c.includes('motel') || c.includes('lodging')) return '🏨';
  if (c.includes('gym') || c.includes('fitness')) return '💪';
  if (c.includes('salon') || c.includes('barber') || c.includes('beauty')) return '💇';
  if (c.includes('auto') || c.includes('car') || c.includes('garage')) return '🚗';
  if (c.includes('real estate') || c.includes('realty')) return '🏠';
  if (c.includes('school') || c.includes('university') || c.includes('college')) return '🎓';
  if (c.includes('store') || c.includes('shop') || c.includes('retail')) return '🛍️';
  if (c.includes('plumber') || c.includes('plumbing')) return '🔧';
  if (c.includes('electric')) return '⚡';
  if (c.includes('pharmacy') || c.includes('drug')) return '💊';
  if (c.includes('bank') || c.includes('finance')) return '🏦';
  return '🏢';
}
