let resizeWait;
window.addEventListener('resize', () => {
  clearTimeout(resizeWait);
  resizeWait = setTimeout(() => {
    drawSection();
  }, 250);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('source-modal');
    if (modal && modal.classList.contains('active')) modal.classList.remove('active');
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const sectionIds = ['page-mission', 'page-timing', 'page-spectral', 'page-ml', 'page-catalog'];
  const num = parseInt(e.key);
  if (num >= 1 && num <= 5) {
    const targetId = sectionIds[num - 1];
    document.querySelectorAll('.console-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.target === targetId);
    });
    openSection(targetId);
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initApp();
  });
} else {
  initApp();
}

function tween(options) {
  const calmMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof anime !== 'undefined' && !calmMotion) {
    anime(options);
  } else {
    if (options.complete) options.complete();
    if (options.update && options.targets) {
      options.targets.v = options.v;
      options.update({ animations: [{ currentValue: options.v }] });
    }
  }
}

const archiveState = {
  data: window.ASTRO_ARCHIVE_DATA || null,
  currentPage: 'page-mission',
  currentTarget: 'Cygnus X-1',
  currentObs: 'all',
  showEventMarkers: true,
  userAnnotations: [],
  currentPhaseBin: 0
};

const theme = {
  indigo: '#aab1b8',
  cyan: '#e6e9ec',
  emerald: '#7cc49a',
  sky: '#aab1b8',
  amber: '#d6b45c',
  rose: '#e48c6e',
  grid: '#252b31',
  textDim: '#8a929a',
  textLight: '#e6e9ec',
  onStrong: '#0f1215',
  rgb: '230, 233, 236',
  accentRgb: '124, 196, 154',
  failRgb: '228, 140, 110'
};

const ARCHIVE_PALETTES = {
  dark: { indigo: '#aab1b8', cyan: '#e6e9ec', emerald: '#7cc49a', sky: '#aab1b8', amber: '#d6b45c', rose: '#e48c6e', grid: '#252b31', textDim: '#8a929a', textLight: '#e6e9ec', onStrong: '#0f1215', rgb: '230, 233, 236', accentRgb: '124, 196, 154', failRgb: '228, 140, 110' },
  light: { indigo: '#555d65', cyan: '#101418', emerald: '#2e7a4f', sky: '#555d65', amber: '#7c5d0b', rose: '#9a3b1b', grid: '#d3d9dd', textDim: '#5c646c', textLight: '#101418', onStrong: '#f3f5f6', rgb: '16, 20, 24', accentRgb: '46, 122, 79', failRgb: '154, 59, 27' }
};

function syncArchiveTheme() {
  let light = false;
  try { light = localStorage.getItem('astropulse-theme') === 'light'; } catch (e) {}
  if (light) document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  Object.assign(theme, light ? ARCHIVE_PALETTES.light : ARCHIVE_PALETTES.dark);
}

window.addEventListener('storage', (e) => {
  if (e.key !== 'astropulse-theme') return;
  syncArchiveTheme();
  if (archiveState.data) drawSection();
});

function initApp() {
  syncArchiveTheme();
  if (!archiveState.data && typeof window.ASTRO_ARCHIVE_DATA !== 'undefined') {
    archiveState.data = window.ASTRO_ARCHIVE_DATA;
  }
  if (!archiveState.data) {
    fetch('console-data.json')
      .then(res => res.json())
      .then(d => {
        archiveState.data = d;
        boot();
      })
      .catch(e => console.error(e));
    return;
  }
  boot();
}

function boot() {
  setupNavigation();
  setupObservatories();
  setupTargets();
  setupModal();
  setupSearch();
  setupPrintButton();
  setupTimingControls();
  setupSpectralControls();
  setupExportControls();
  bindArchiveKeys();
  drawSection();
}

function setupNavigation() {
  const items = document.querySelectorAll('.console-tab');
  items.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (target === archiveState.currentPage) return;
      items.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      openSection(target);
    });
  });
}

function openSection(pageId) {
  const current = document.getElementById(archiveState.currentPage);
  const next = document.getElementById(pageId);
  if (!current || !next) return;

  current.classList.remove('active');
  next.classList.add('active');
  archiveState.currentPage = pageId;
  drawSection();
}

function setupObservatories() {
  const container = document.getElementById('obs-selector-container');
  if (!container || !archiveState.data || !archiveState.data.observatories) return;
  container.innerHTML = '';

  archiveState.data.observatories.forEach((obs, idx) => {
    const btn = document.createElement('button');
    btn.className = 'obs-pill' + (obs.id === archiveState.currentObs ? ' active' : '');
    btn.textContent = obs.name;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.obs-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      archiveState.currentObs = obs.id;
      updateObsMeta(obs);
      renderKPIs();

      const observable = obs.observable_sources || [];
      if (obs.id !== 'all' && !observable.includes(archiveState.currentTarget)) {
        if (observable.length > 0) {
          archiveState.currentTarget = observable[0];
        }
      }

      if (archiveState.currentPage === 'page-timing') {
        setupTargets();
      }
      drawSection();
    });
    container.appendChild(btn);
  });

  const activeObs = archiveState.data.observatories.find(o => o.id === archiveState.currentObs) || archiveState.data.observatories[0];
  updateObsMeta(activeObs);

  const leftBtn = document.getElementById('obs-scroll-left');
  const rightBtn = document.getElementById('obs-scroll-right');
  if (leftBtn) {
    leftBtn.onclick = () => {
      container.scrollBy({ left: -160, behavior: 'smooth' });
    };
  }
  if (rightBtn) {
    rightBtn.onclick = () => {
      container.scrollBy({ left: 160, behavior: 'smooth' });
    };
  }
  container.onwheel = (e) => {
    e.preventDefault();
    container.scrollLeft += e.deltaY;
  };
}

function updateObsMeta(obs) {
  const container = document.getElementById('obs-telemetry-meta');
  if (!container || !obs) return;
  container.innerHTML = `
    <div class="meta-chip">Band: <span>${obs.energy_band_kev} keV</span></div>
    <div class="meta-chip">Res: <span>${obs.timing_resolution}</span></div>
    <div class="meta-chip">Instrument: <span>${obs.primary_instrument}</span></div>
  `;
}

function setupTargets() {
  const container = document.getElementById('target-selector-container');
  if (!container || !archiveState.data || !archiveState.data.lightcurves) return;
  container.innerHTML = '';

  const activeObs = (archiveState.data.observatories || []).find(o => o.id === archiveState.currentObs);
  const observableList = activeObs ? (activeObs.observable_sources || []) : [];

  const targets = Object.keys(archiveState.data.lightcurves.sources);
  targets.forEach(t => {
    const isObserved = (archiveState.currentObs === 'all') || observableList.includes(t);
    const btn = document.createElement('button');
    btn.className = 'target-pill' + (t === archiveState.currentTarget ? ' active' : '') + (isObserved ? '' : ' pill-dimmed');
    btn.textContent = t;
    btn.dataset.target = t;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.target-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      archiveState.currentTarget = t;
      renderTimingPage();
    });
    container.appendChild(btn);
  });
}

function setupModal() {
  const modal = document.getElementById('source-modal');
  const dismissBtn = document.getElementById('modal-close');
  if (dismissBtn && modal) {
    dismissBtn.addEventListener('click', () => {
      modal.classList.remove('active');
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  const timingBtn = document.getElementById('modal-btn-timing');
  if (timingBtn) {
    timingBtn.addEventListener('click', () => {
      if (modal) modal.classList.remove('active');
      document.querySelectorAll('.console-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.target === 'page-timing');
      });
      openSection('page-timing');
      const pill = document.querySelector(`.target-pill[data-target="${archiveState.currentTarget}"]`);
      setupTargets();
    });
  }

  const spectralBtn = document.getElementById('modal-btn-spectral');
  if (spectralBtn) {
    spectralBtn.addEventListener('click', () => {
      if (modal) modal.classList.remove('active');
      document.querySelectorAll('.console-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.target === 'page-spectral');
      });
      openSection('page-spectral');
    });
  }
}

function openSourceModal(source) {
  const modal = document.getElementById('source-modal');
  if (!modal || !source) return;

  archiveState.currentTarget = source.name;

  document.getElementById('modal-title').textContent = source.name;
  document.getElementById('modal-type-badge').textContent = source.type;
  document.getElementById('modal-ra').textContent = source.ra;
  document.getElementById('modal-dec').textContent = source.dec;
  document.getElementById('modal-dist').textContent = source.distance;
  document.getElementById('modal-period').textContent = source.period;
  document.getElementById('modal-state').textContent = source.state;
  document.getElementById('modal-gamma').textContent = source.gamma;
  document.getElementById('modal-desc').textContent = source.description;

  modal.classList.add('active');
}

function setupSearch() {
  const input = document.getElementById('catalog-search');
  if (!input) return;
  input.addEventListener('input', () => {
    renderCatalogTable();
  });
}

function drawSection() {
  renderKPIs();
  if (archiveState.currentPage === 'page-mission') {
    renderMissionPage();
  } else if (archiveState.currentPage === 'page-timing') {
    renderTimingPage();
  } else if (archiveState.currentPage === 'page-spectral') {
    renderSpectralPage();
  } else if (archiveState.currentPage === 'page-ml') {
    renderMLPage();
  } else if (archiveState.currentPage === 'page-catalog') {
    renderCatalogPage();
  } else if (archiveState.currentPage === 'page-constellation') {
    renderConstellationPage();
  }
}

function renderKPIs() {
  if (!archiveState.data || !archiveState.data.observatories) return;
  const obs = (archiveState.data.observatories || []).find(o => o.id === archiveState.currentObs) || archiveState.data.observatories[0];
  if (!obs) return;

  const realMissions = (archiveState.data.observatories || []).filter(o => o.id !== 'all');
  const sourcesSub = document.getElementById('kpi-sources-sub');
  const rateSub = document.getElementById('kpi-rate-sub');

  if (obs.id === 'all') {
    const totalMonitoredSum = realMissions.reduce((sum, o) => sum + (o.observable_sources || []).length, 0);
    const totalRateSum = realMissions.reduce((sum, o) => sum + (parseFloat(o.telemetry_rate) || 0), 0);
    const totalAlertsSum = realMissions.reduce((sum, o) => sum + (parseInt(o.alerts, 10) || 0), 0);
    const totalObsCount = realMissions.length;

    animateCount('kpi-sources', totalMonitoredSum);
    animateCount('kpi-rate', totalRateSum, true);
    animateCount('kpi-obs', totalObsCount);
    animateCount('kpi-alerts', totalAlertsSum);

    if (sourcesSub) sourcesSub.textContent = 'Active tracking channels (10 unique sources)';
    if (rateSub) rateSub.textContent = 'Constellation combined stream rate';
  } else {
    const activeSources = (obs.observable_sources || []).length;
    animateCount('kpi-sources', activeSources);
    animateCount('kpi-rate', obs.telemetry_rate || 1.24, true);
    animateCount('kpi-obs', 1);
    animateCount('kpi-alerts', obs.alerts || 1);

    if (sourcesSub) sourcesSub.textContent = `${obs.name} monitored sources`;
    if (rateSub) rateSub.textContent = `${obs.name} downlink stream rate`;
  }
}

function animateCount(id, val, isFloat) {
  const el = document.getElementById(id);
  if (!el) return;
  tween({
    targets: { v: parseFloat(el.textContent) || 0 },
    v: val,
    duration: 800,
    easing: 'easeOutExpo',
    update: (a) => {
      const cur = a.animations[0].currentValue;
      el.textContent = isFloat ? cur.toFixed(2) : Math.round(cur);
    }
  });
}

function renderMissionPage() {
  renderTargetRoster();
  renderTargetStage();
}

function renderTargetRoster() {
  const container = document.getElementById('source-roster-container');
  if (!container || !archiveState.data || !archiveState.data.catalog) return;
  container.innerHTML = '';

  const activeObs = (archiveState.data.observatories || []).find(o => o.id === archiveState.currentObs);
  const observableList = activeObs ? (activeObs.observable_sources || []) : [];

  archiveState.data.catalog.forEach(s => {
    const item = document.createElement('div');
    const isActive = s.name === archiveState.currentTarget;
    const isObserved = (archiveState.currentObs === 'all') || observableList.includes(s.name);

    item.className = 'roster-item' + (isActive ? ' active' : '') + (isObserved ? ' in-band' : ' out-band');
    if (!isObserved) {
      item.style.opacity = '0.5';
    } else {
      item.style.opacity = '1';
    }

    item.innerHTML = `
      <div class="roster-row-top">
        <span class="roster-name">${s.name}</span>
        <span class="roster-status-chip ${isObserved ? 'status-tracked' : 'status-offaxis'}">${isObserved ? 'Tracked' : 'Off axis'}</span>
      </div>
      <div class="roster-row-sub">
        <span class="roster-type-chip">${s.type.split(' ')[0]}</span>
        <span class="roster-period">${s.period}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      archiveState.currentTarget = s.name;
      container.querySelectorAll('.roster-item').forEach(r => r.classList.remove('active'));
      item.classList.add('active');
      renderTargetStage();
    });

    container.appendChild(item);
  });
}

function renderTargetStage() {
  const panel = document.getElementById('target-stage-panel');
  if (!panel || !archiveState.data || !archiveState.data.catalog) return;

  const source = archiveState.data.catalog.find(s => s.name === archiveState.currentTarget) || archiveState.data.catalog[0];
  if (!source) return;

  document.getElementById('stage-target-name').textContent = source.name;
  document.getElementById('stage-badge').textContent = source.type;
  document.getElementById('stage-coords').textContent = `RA ${source.ra} / Dec ${source.dec} - Dist: ${source.distance}`;
  document.getElementById('stage-period').textContent = source.period;
  document.getElementById('stage-state').textContent = source.state;
  document.getElementById('stage-gamma').textContent = source.gamma;
  document.getElementById('stage-flux').textContent = source.flux;
  document.getElementById('stage-desc').textContent = source.description;

  const obsContainer = document.getElementById('stage-obs-badges');
  if (obsContainer) {
    obsContainer.innerHTML = '';
    (source.observatories || []).forEach(oId => {
      const chip = document.createElement('span');
      const isCurrent = (archiveState.currentObs === oId);
      chip.className = 'stage-obs-chip' + (isCurrent ? ' active-obs-highlight' : '');
      const obsObj = (archiveState.data.observatories || []).find(o => o.id === oId);
      chip.textContent = obsObj ? obsObj.name : oId.toUpperCase();
      obsContainer.appendChild(chip);
    });
  }

  renderStageMiniChart(source.name);

  const timingBtn = document.getElementById('stage-btn-timing');
  if (timingBtn) {
    timingBtn.onclick = () => {
      document.querySelectorAll('.console-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.target === 'page-timing');
      });
      openSection('page-timing');
      setupTargets();
    };
  }

  const spectralBtn = document.getElementById('stage-btn-spectral');
  if (spectralBtn) {
    spectralBtn.onclick = () => {
      document.querySelectorAll('.console-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.target === 'page-spectral');
      });
      openSection('page-spectral');
    };
  }
}

function renderStageMiniChart(targetName) {
  const container = document.getElementById('stage-mini-chart');
  if (!container || !archiveState.data || !archiveState.data.lightcurves) return;
  container.innerHTML = '';

  const lc = archiveState.data.lightcurves;
  const time = lc.time;
  const rates = lc.sources[targetName] || lc.sources['Cygnus X-1'];

  const w = container.clientWidth || 550;
  const h = 120;
  const padL = 35;
  const padR = 20;
  const padT = 15;
  const padB = 25;

  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const minT = time[0];
  const maxT = time[time.length - 1];
  const minR = Math.min(...rates) * 0.9;
  const maxR = Math.max(...rates) * 1.1;

  const svg = svgNode('svg', { viewBox: `0 0 ${w} ${h}`, class: 'figure-svg' });

  for (let i = 0; i <= 2; i++) {
    const yPos = padT + (i / 2) * plotH;
    const rVal = maxR - (i / 2) * (maxR - minR);

    const line = svgNode('line', {
      x1: padL, y1: yPos, x2: w - padR, y2: yPos,
      stroke: 'rgba(' + theme.rgb + ', 0.06)',
      'stroke-dasharray': '3,3'
    });
    svg.appendChild(line);

    const lbl = svgNode('text', {
      x: padL - 6, y: yPos + 3,
      'text-anchor': 'end',
      fill: theme.textDim,
      'font-size': '8.5px',
      'font-family': 'monospace'
    });
    lbl.textContent = Math.round(rVal);
    svg.appendChild(lbl);
  }

  const getX = (t) => padL + ((t - minT) / (maxT - minT)) * plotW;
  const getY = (r) => padT + ((maxR - r) / (maxR - minR)) * plotH;

  const pathCoords = time.map((t, idx) => `${getX(t)},${getY(rates[idx])}`);
  const poly = svgNode('polyline', {
    points: pathCoords.join(' '),
    fill: 'none',
    stroke: theme.cyan,
    'stroke-width': '1.6'
  });
  svg.appendChild(poly);

  container.appendChild(svg);
}

function renderTimingPage() {
  setupTargets();
  const title = document.getElementById('lc-chart-title');
  if (title) {
    title.textContent = `${archiveState.currentTarget} - Photon Event Light Curve`;
  }
  renderLightCurveChart();
  renderPsdChart();
  renderLombScargleChart();
  renderFoldedProfileChart();
}

function renderLightCurveChart() {
  const container = document.getElementById('chart-lc');
  if (!container || !archiveState.data || !archiveState.data.lightcurves) return;
  container.innerHTML = '';

  const lc = archiveState.data.lightcurves;
  const time = lc.time;
  const rates = lc.sources[archiveState.currentTarget] || lc.sources['Cygnus X-1'];

  const w = container.clientWidth || 900;
  const h = 290;
  const padL = 60;
  const padR = 25;
  const padT = 25;
  const padB = 45;

  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const minT = time[0];
  const maxT = time[time.length - 1];
  const minR = Math.min(...rates) * 0.85;
  const maxR = Math.max(...rates) * 1.15;

  const svg = svgNode('svg', { viewBox: `0 0 ${w} ${h}`, class: 'figure-svg' });

  for (let i = 0; i <= 4; i++) {
    const yPos = padT + (i / 4) * plotH;
    const rVal = maxR - (i / 4) * (maxR - minR);

    const line = svgNode('line', {
      x1: padL, y1: yPos, x2: w - padR, y2: yPos,
      stroke: theme.grid,
      'stroke-dasharray': '3,3'
    });
    svg.appendChild(line);

    const lbl = svgNode('text', {
      x: padL - 8, y: yPos + 4,
      'text-anchor': 'end',
      fill: theme.textDim,
      'font-size': '10px',
      'font-family': 'monospace'
    });
    lbl.textContent = Math.round(rVal);
    svg.appendChild(lbl);
  }

  for (let i = 0; i <= 5; i++) {
    const xPos = padL + (i / 5) * plotW;
    const tVal = minT + (i / 5) * (maxT - minT);

    const lbl = svgNode('text', {
      x: xPos, y: padT + plotH + 16,
      'text-anchor': 'middle',
      fill: theme.textDim,
      'font-size': '9.5px',
      'font-family': 'monospace'
    });
    lbl.textContent = tVal.toFixed(0) + 's';
    svg.appendChild(lbl);
  }

  const yTitle = svgNode('text', {
    x: -h / 2 + 10,
    y: 16,
    transform: 'rotate(-90)',
    'text-anchor': 'middle',
    fill: theme.textDim,
    'font-size': '10px'
  });
  yTitle.textContent = 'Count Rate (ct / s)';
  svg.appendChild(yTitle);

  const xTitle = svgNode('text', {
    x: padL + plotW / 2,
    y: padT + plotH + 34,
    'text-anchor': 'middle',
    fill: theme.textDim,
    'font-size': '10px'
  });
  xTitle.textContent = 'Mission Elapsed Time (seconds)';
  svg.appendChild(xTitle);

  const getX = (t) => padL + ((t - minT) / (maxT - minT)) * plotW;
  const getY = (r) => padT + ((maxR - r) / (maxR - minR)) * plotH;

  const step = Math.max(1, Math.floor(time.length / 70));
  for (let i = 0; i < time.length; i += step) {
    const r = rates[i];
    const err = Math.sqrt(r);
    const cx = getX(time[i]);
    const y1 = getY(r - err);
    const y2 = getY(r + err);

    const errLine = svgNode('line', {
      x1: cx, y1: y1, x2: cx, y2: y2,
      stroke: 'rgba(' + theme.rgb + ', 0.35)',
      'stroke-width': '1'
    });
    svg.appendChild(errLine);
  }

  const pathCoords = time.map((t, idx) => `${getX(t)},${getY(rates[idx])}`);
  const poly = svgNode('polyline', {
    points: pathCoords.join(' '),
    fill: 'none',
    stroke: theme.cyan,
    'stroke-width': '1.8'
  });
  svg.appendChild(poly);

  for (let i = 0; i < time.length; i += step) {
    const cx = getX(time[i]);
    const cy = getY(rates[i]);
    const dot = svgNode('circle', {
      cx: cx, cy: cy, r: 2.5,
      fill: theme.textLight,
      style: 'cursor:pointer;'
    });
    dot.addEventListener('mouseenter', (ev) => {
      showFigureTip(ev, `
        <strong>${archiveState.currentTarget}</strong><br>
        Time: ${time[i].toFixed(1)} s<br>
        Count Rate: ${rates[i].toFixed(1)} ct/s<br>
        Poisson Error: +/- ${Math.sqrt(rates[i]).toFixed(1)}
      `);
    });
    dot.addEventListener('mouseleave', hideFigureTip);
    svg.appendChild(dot);
  }

  container.appendChild(svg);
}

function renderPsdChart() {
  const container = document.getElementById('chart-psd');
  if (!container || !archiveState.data || !archiveState.data.power_spectrum) return;
  container.innerHTML = '';

  const psd = archiveState.data.power_spectrum;
  const freq = psd.freq;
  const power = psd.power[archiveState.currentTarget] || psd.power['Cygnus X-1'];

  const w = container.clientWidth || 450;
  const h = 290;
  const padL = 55;
  const padR = 25;
  const padT = 25;
  const padB = 45;

  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const minF = Math.log10(freq[0]);
  const maxF = Math.log10(freq[freq.length - 1]);
  const minP = Math.log10(0.5);
  const maxP = Math.log10(Math.max(...power) * 1.1);

  const svg = svgNode('svg', { viewBox: `0 0 ${w} ${h}`, class: 'figure-svg' });

  for (let i = 0; i <= 4; i++) {
    const yPos = padT + (i / 4) * plotH;
    const pVal = maxP - (i / 4) * (maxP - minP);

    const line = svgNode('line', {
      x1: padL, y1: yPos, x2: w - padR, y2: yPos,
      stroke: theme.grid,
      'stroke-dasharray': '3,3'
    });
    svg.appendChild(line);

    const lbl = svgNode('text', {
      x: padL - 8, y: yPos + 4,
      'text-anchor': 'end',
      fill: theme.textDim,
      'font-size': '10px',
      'font-family': 'monospace'
    });
    lbl.textContent = pVal.toFixed(1);
    svg.appendChild(lbl);
  }

  for (let i = 0; i <= 4; i++) {
    const xPos = padL + (i / 4) * plotW;
    const fVal = minF + (i / 4) * (maxF - minF);

    const lbl = svgNode('text', {
      x: xPos, y: padT + plotH + 16,
      'text-anchor': 'middle',
      fill: theme.textDim,
      'font-size': '9.5px',
      'font-family': 'monospace'
    });
    lbl.textContent = fVal.toFixed(1);
    svg.appendChild(lbl);
  }

  const yTitle = svgNode('text', {
    x: -h / 2 + 10,
    y: 15,
    transform: 'rotate(-90)',
    'text-anchor': 'middle',
    fill: theme.textDim,
    'font-size': '10px'
  });
  yTitle.textContent = 'log Leahy Power';
  svg.appendChild(yTitle);

  const xTitle = svgNode('text', {
    x: padL + plotW / 2,
    y: padT + plotH + 34,
    'text-anchor': 'middle',
    fill: theme.textDim,
    'font-size': '10px'
  });
  xTitle.textContent = 'log Frequency (Hz)';
  svg.appendChild(xTitle);

  const getX = (f) => padL + ((Math.log10(f) - minF) / (maxF - minF)) * plotW;
  const getY = (p) => padT + ((maxP - Math.log10(p)) / (maxP - minP)) * plotH;

  const noiseY = getY(2.0);
  const noiseLine = svgNode('line', {
    x1: padL, y1: noiseY, x2: w - padR, y2: noiseY,
    stroke: theme.rose,
    'stroke-dasharray': '4,3',
    'stroke-width': '1.5'
  });
  svg.appendChild(noiseLine);

  const noiseLbl = svgNode('text', {
    x: w - padR - 6,
    y: noiseY - 6,
    'text-anchor': 'end',
    fill: theme.rose,
    'font-size': '9px',
    'font-family': 'monospace'
  });
  noiseLbl.textContent = 'Poisson Noise Floor (P = 2.0)';
  svg.appendChild(noiseLbl);

  const pathCoords = freq.map((f, idx) => `${getX(f)},${getY(power[idx])}`);
  const poly = svgNode('polyline', {
    points: pathCoords.join(' '),
    fill: 'none',
    stroke: theme.indigo,
    'stroke-width': '1.8'
  });
  svg.appendChild(poly);

  container.appendChild(svg);
}

function renderLombScargleChart() {
  const container = document.getElementById('chart-ls');
  if (!container || !archiveState.data || !archiveState.data.lomb_scargle) return;
  container.innerHTML = '';

  const ls = archiveState.data.lomb_scargle;
  const periods = ls.periods;
  const power = ls.power;

  const w = container.clientWidth || 450;
  const h = 290;
  const padL = 55;
  const padR = 25;
  const padT = 25;
  const padB = 45;

  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const minP = periods[0];
  const maxP = periods[periods.length - 1];
  const maxPower = Math.max(...power) * 1.15;

  const svg = svgNode('svg', { viewBox: `0 0 ${w} ${h}`, class: 'figure-svg' });

  for (let i = 0; i <= 4; i++) {
    const yPos = padT + (i / 4) * plotH;
    const pVal = maxPower - (i / 4) * maxPower;

    const line = svgNode('line', {
      x1: padL, y1: yPos, x2: w - padR, y2: yPos,
      stroke: theme.grid,
      'stroke-dasharray': '3,3'
    });
    svg.appendChild(line);

    const lbl = svgNode('text', {
      x: padL - 8, y: yPos + 4,
      'text-anchor': 'end',
      fill: theme.textDim,
      'font-size': '10px',
      'font-family': 'monospace'
    });
    lbl.textContent = Math.round(pVal);
    svg.appendChild(lbl);
  }

  for (let i = 0; i <= 4; i++) {
    const xPos = padL + (i / 4) * plotW;
    const pVal = minP + (i / 4) * (maxP - minP);

    const lbl = svgNode('text', {
      x: xPos, y: padT + plotH + 16,
      'text-anchor': 'middle',
      fill: theme.textDim,
      'font-size': '9.5px',
      'font-family': 'monospace'
    });
    lbl.textContent = pVal.toFixed(1) + 's';
    svg.appendChild(lbl);
  }

  const yTitle = svgNode('text', {
    x: -h / 2 + 10,
    y: 15,
    transform: 'rotate(-90)',
    'text-anchor': 'middle',
    fill: theme.textDim,
    'font-size': '10px'
  });
  yTitle.textContent = 'Scargle Spectral Power';
  svg.appendChild(yTitle);

  const xTitle = svgNode('text', {
    x: padL + plotW / 2,
    y: padT + plotH + 34,
    'text-anchor': 'middle',
    fill: theme.textDim,
    'font-size': '10px'
  });
  xTitle.textContent = 'Trial Period (seconds)';
  svg.appendChild(xTitle);

  const getX = (p) => padL + ((p - minP) / (maxP - minP)) * plotW;
  const getY = (pow) => padT + ((maxPower - pow) / maxPower) * plotH;

  const fapY = getY(ls.fap_99 || 14.5);
  const fapLine = svgNode('line', {
    x1: padL, y1: fapY, x2: w - padR, y2: fapY,
    stroke: theme.amber,
    'stroke-dasharray': '4,3',
    'stroke-width': '1.5'
  });
  svg.appendChild(fapLine);

  const fapLbl = svgNode('text', {
    x: w - padR - 6,
    y: fapY - 6,
    'text-anchor': 'end',
    fill: theme.amber,
    'font-size': '9px',
    'font-family': 'monospace'
  });
  fapLbl.textContent = '99% FAP Threshold (14.5)';
  svg.appendChild(fapLbl);

  const pathCoords = periods.map((p, idx) => `${getX(p)},${getY(power[idx])}`);
  const poly = svgNode('polyline', {
    points: pathCoords.join(' '),
    fill: 'none',
    stroke: theme.sky,
    'stroke-width': '1.8'
  });
  svg.appendChild(poly);

  container.appendChild(svg);
}

function renderFoldedProfileChart() {
  const container = document.getElementById('chart-folded');
  if (!container || !archiveState.data || !archiveState.data.folded_profile) return;
  container.innerHTML = '';

  const fp = archiveState.data.folded_profile;
  const phase = fp.phase;
  const counts = fp.counts;
  const errs = fp.errors;

  const w = container.clientWidth || 900;
  const h = 290;
  const padL = 60;
  const padR = 25;
  const padT = 25;
  const padB = 45;

  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const minC = Math.min(...counts) * 0.85;
  const maxC = Math.max(...counts) * 1.15;

  const svg = svgNode('svg', { viewBox: `0 0 ${w} ${h}`, class: 'figure-svg' });

  for (let i = 0; i <= 4; i++) {
    const yPos = padT + (i / 4) * plotH;
    const cVal = maxC - (i / 4) * (maxC - minC);

    const line = svgNode('line', {
      x1: padL, y1: yPos, x2: w - padR, y2: yPos,
      stroke: theme.grid,
      'stroke-dasharray': '3,3'
    });
    svg.appendChild(line);

    const lbl = svgNode('text', {
      x: padL - 8, y: yPos + 4,
      'text-anchor': 'end',
      fill: theme.textDim,
      'font-size': '10px',
      'font-family': 'monospace'
    });
    lbl.textContent = Math.round(cVal);
    svg.appendChild(lbl);
  }

  for (let i = 0; i <= 4; i++) {
    const xPos = padL + (i / 4) * plotW;
    const phVal = (i / 4) * 2.0;

    const lbl = svgNode('text', {
      x: xPos, y: padT + plotH + 16,
      'text-anchor': 'middle',
      fill: theme.textDim,
      'font-size': '9.5px',
      'font-family': 'monospace'
    });
    lbl.textContent = phVal.toFixed(2);
    svg.appendChild(lbl);
  }

  const yTitle = svgNode('text', {
    x: -h / 2 + 10,
    y: 16,
    transform: 'rotate(-90)',
    'text-anchor': 'middle',
    fill: theme.textDim,
    'font-size': '10px'
  });
  yTitle.textContent = 'Folded Counts / Bin';
  svg.appendChild(yTitle);

  const xTitle = svgNode('text', {
    x: padL + plotW / 2,
    y: padT + plotH + 34,
    'text-anchor': 'middle',
    fill: theme.textDim,
    'font-size': '10px'
  });
  xTitle.textContent = 'Rotational Phase (2.0 Cycles)';
  svg.appendChild(xTitle);

  const getX = (p) => padL + (p / 2.0) * plotW;
  const getY = (c) => padT + ((maxC - c) / (maxC - minC)) * plotH;

  for (let i = 0; i < phase.length; i += 2) {
    const cx = getX(phase[i]);
    const cy1 = getY(counts[i] - errs[i]);
    const cy2 = getY(counts[i] + errs[i]);

    const errLine = svgNode('line', {
      x1: cx, y1: cy1, x2: cx, y2: cy2,
      stroke: 'rgba(' + theme.accentRgb + ', 0.4)',
      'stroke-width': '1'
    });
    svg.appendChild(errLine);
  }

  const pathCoords = phase.map((p, idx) => `${getX(p)},${getY(counts[idx])}`);
  const poly = svgNode('polyline', {
    points: pathCoords.join(' '),
    fill: 'none',
    stroke: theme.emerald,
    'stroke-width': '2'
  });
  svg.appendChild(poly);

  container.appendChild(svg);
}

function renderSpectralPage() {
  const source = archiveState.data.catalog.find(s => s.name === archiveState.currentTarget) || {name: archiveState.currentTarget, type: 'Compact Object'};
  const header = document.getElementById('spectral-target-header');
  if (header) header.textContent = source.name;
  const typeBadge = document.getElementById('spectral-target-type');
  if (typeBadge) typeBadge.textContent = source.type;

  const phaseBtns = document.querySelectorAll('.phase-pill');
  if (phaseBtns.length > 0) {
    phaseBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        phaseBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        archiveState.currentPhaseBin = parseInt(btn.dataset.phase);
        renderEnergySpectrumChart();
        renderFitParamsTable();
      });
      btn.classList.toggle('active', parseInt(btn.dataset.phase) === archiveState.currentPhaseBin);
    });
  }

  renderEnergySpectrumChart();
  renderFitParamsTable();
}

function renderEnergySpectrumChart() {
  const container = document.getElementById('chart-energy');
  if (!container || !archiveState.data || !archiveState.data.energy_spectrum) return;
  container.innerHTML = '';

  const obs = (archiveState.data.observatories || []).find(o => o.id === archiveState.currentObs) || archiveState.data.observatories[0];
  const badge = document.getElementById('spectral-obs-badge');
  if (badge && obs) {
    badge.textContent = `Active Mission: ${obs.name} (${obs.energy_band_kev} keV)`;
  }

  const bandParts = (obs.energy_band_kev || '0.1-150').split('-');
  const obsMinE = parseFloat(bandParts[0]) || 0.1;
  const obsMaxE = parseFloat(bandParts[1]) || 150.0;

  const rateMult = obs.telemetry_rate ? (obs.telemetry_rate / 1.24) : 1.0;
  let phaseMultPL = 1.0;
  let phaseMultBB = 1.0;
  if (archiveState.currentPhaseBin === 0) {
    phaseMultPL = 1.35;
  } else if (archiveState.currentPhaseBin === 2) {
    phaseMultPL = 0.70;
    phaseMultBB = 1.25;
  }

  const spec = archiveState.data.energy_spectrum;
  const energy = spec.energy;
  const rawData = spec.data;
  const rawModel = spec.model;
  const rawResiduals = spec.residuals;

  const es = spec;
  const comp_pl = es.comp_pl ? es.comp_pl.map(v => v * rateMult * phaseMultPL) : null;
  const comp_bb = es.comp_bb ? es.comp_bb.map(v => v * rateMult * phaseMultBB) : null;
  const comp_fe = es.comp_fe ? es.comp_fe.map(v => v * rateMult) : null;

  const data = rawData.map((v, i) => {
    let nv = v * rateMult;
    if (archiveState.currentPhaseBin === 0) nv *= 1.2;
    if (archiveState.currentPhaseBin === 2) nv *= 0.85;
    return nv;
  });
  const model = rawModel.map((v, i) => {
    let nv = v * rateMult;
    if (archiveState.currentPhaseBin === 0) nv *= 1.2;
    if (archiveState.currentPhaseBin === 2) nv *= 0.85;
    return nv;
  });
  const residuals = rawResiduals;

  const w = container.clientWidth || 500;
  const h = 340;
  const padL = 55;
  const padR = 25;
  const padT = 25;
  const padB = 40;
  const splitH = 210;

  const plotW = w - padL - padR;
  const topH = splitH - padT;
  const botH = h - splitH - padB;

  const minE = energy[0];
  const maxE = energy[energy.length - 1];
  const maxFlux = Math.max(...data, ...model) * 1.15;

  const svg = svgNode('svg', { viewBox: `0 0 ${w} ${h}`, class: 'figure-svg' });

  for (let i = 0; i <= 4; i++) {
    const yPos = padT + (i / 4) * topH;
    const fVal = maxFlux - (i / 4) * maxFlux;

    const line = svgNode('line', {
      x1: padL, y1: yPos, x2: w - padR, y2: yPos,
      stroke: theme.grid,
      'stroke-dasharray': '3,3'
    });
    svg.appendChild(line);

    const lbl = svgNode('text', {
      x: padL - 8, y: yPos + 4,
      'text-anchor': 'end',
      fill: theme.textDim,
      'font-size': '10px',
      'font-family': 'monospace'
    });
    lbl.textContent = Math.round(fVal);
    svg.appendChild(lbl);
  }

  const yTitle = svgNode('text', {
    x: -splitH / 2,
    y: 15,
    transform: 'rotate(-90)',
    'text-anchor': 'middle',
    fill: theme.textDim,
    'font-size': '9.5px'
  });
  yTitle.textContent = 'Normalized Counts (s-1 keV-1)';
  svg.appendChild(yTitle);

  const getX = (eVal) => {
    const logMin = Math.log10(minE);
    const logMax = Math.log10(maxE);
    const logE = Math.log10(eVal);
    return padL + ((logE - logMin) / (logMax - logMin)) * plotW;
  };

  const getYTop = (fVal) => padT + (1 - fVal / maxFlux) * topH;

  const modelPts = energy.map((eVal, i) => `${getX(eVal)},${getYTop(model[i])}`);
  const modelPath = svgNode('polyline', {
    points: modelPts.join(' '),
    fill: 'none',
    stroke: theme.indigo,
    'stroke-width': '2'
  });
  svg.appendChild(modelPath);

  energy.forEach((eVal, i) => {
    const inBand = (obs.id === 'all') || (eVal >= obsMinE * 0.7 && eVal <= obsMaxE * 1.3);
    const cx = getX(eVal);
    const cy = getYTop(data[i]);
    const err = Math.sqrt(Math.max(1, data[i])) * 0.45;
    const yTop = getYTop(data[i] + err);
    const yBot = getYTop(Math.max(0, data[i] - err));

    const errLine = svgNode('line', {
      x1: cx, y1: yTop, x2: cx, y2: yBot,
      stroke: inBand ? 'rgba(' + theme.rgb + ', 0.7)' : 'rgba(' + theme.rgb + ', 0.12)',
      'stroke-width': '1.2'
    });
    svg.appendChild(errLine);

    const circle = svgNode('circle', {
      cx: cx, cy: cy,
      r: inBand ? 3.5 : 2,
      fill: inBand ? theme.cyan : 'rgba(' + theme.rgb + ', 0.25)',
      stroke: inBand ? theme.textLight : 'none',
      'stroke-width': inBand ? 1 : 0,
      style: 'cursor:pointer;'
    });

    circle.addEventListener('mouseenter', (ev) => {
      showFigureTip(ev, `
        <strong>Energy: ${eVal.toFixed(2)} keV</strong><br>
        Counts: ${data[i].toFixed(1)} s-1 keV-1<br>
        Model Fit: ${model[i].toFixed(1)} s-1 keV-1<br>
        Residual: ${residuals[i].toFixed(2)} sigma<br>
        Status: ${inBand ? 'Observed in Instrument Band' : 'Off-bandpass'}
      `);
    });
    circle.addEventListener('mouseleave', hideFigureTip);

    svg.appendChild(circle);
  });

  const splitLine = svgNode('line', {
    x1: padL, y1: splitH + 5, x2: w - padR, y2: splitH + 5,
    stroke: 'rgba(' + theme.rgb + ', 0.25)'
  });
  svg.appendChild(splitLine);

  const zeroY = splitH + 10 + botH / 2;
  const zeroLine = svgNode('line', {
    x1: padL, y1: zeroY, x2: w - padR, y2: zeroY,
    stroke: theme.grid,
    'stroke-dasharray': '2,2'
  });
  svg.appendChild(zeroLine);

  const resYTitle = svgNode('text', {
    x: -(splitH + 10 + botH / 2),
    y: 15,
    transform: 'rotate(-90)',
    'text-anchor': 'middle',
    fill: theme.textDim,
    'font-size': '8.5px'
  });
  resYTitle.textContent = 'Residuals (sigma)';
  svg.appendChild(resYTitle);

  residuals.forEach((res, i) => {
    const cx = getX(energy[i]);
    const cy = zeroY - (res / 4) * (botH / 2 - 5);
    const circle = svgNode('circle', {
      cx: cx, cy: cy,
      r: 2.5,
      fill: Math.abs(res) > 2 ? theme.amber : theme.sky,
      style: 'cursor:pointer;'
    });
    svg.appendChild(circle);
  });

  const xTicks = [0.5, 1.0, 2.0, 5.0, 10.0, 20.0];
  xTicks.forEach(eVal => {
    if (eVal >= minE && eVal <= maxE) {
      const x = getX(eVal);
      const lbl = svgNode('text', {
        x: x,
        y: h - 14,
        'text-anchor': 'middle',
        fill: theme.textDim,
        'font-size': '9.5px',
        'font-family': 'monospace'
      });
      lbl.textContent = eVal.toFixed(1);
      svg.appendChild(lbl);
    }
  });

  const xTitle = svgNode('text', {
    x: padL + plotW / 2,
    y: h - 2,
    'text-anchor': 'middle',
    fill: theme.textDim,
    'font-size': '10px'
  });
  xTitle.textContent = 'Photon Energy (keV)';
  svg.appendChild(xTitle);

  container.appendChild(svg);
}

function renderFitParamsTable() {
  const tbody = document.getElementById('fit-params-tbody');
  if (!tbody || !archiveState.data) return;
  tbody.innerHTML = '';

  const obs = (archiveState.data.observatories || []).find(o => o.id === archiveState.currentObs) || archiveState.data.observatories[0];

  let gammaVal = (1.76 + (obs.alerts || 1) * 0.04);
  let diskTemp = (0.88 + (obs.id.length % 3) * 0.11);
  if (archiveState.currentPhaseBin === 0) {
    gammaVal *= 1.35;
  } else if (archiveState.currentPhaseBin === 2) {
    gammaVal *= 0.70;
    diskTemp *= 1.25;
  }

  const paramsList = [
    {
      param: 'Active Mission / Instrument',
      value: `${obs.name} (${obs.primary_instrument})`,
      error: 'Calibrated',
      desc: `Instrument band: ${obs.energy_band_kev} keV with ${obs.timing_resolution} resolution.`
    },
    {
      param: 'Photon Index (Gamma)',
      value: gammaVal.toFixed(2),
      error: '+/- 0.03',
      desc: 'Power-law continuum photon index characterizing nonthermal inverse Comptonization.'
    },
    {
      param: 'Disk Temperature (Tin)',
      value: `${diskTemp.toFixed(2)} keV`,
      error: '+/- 0.04 keV',
      desc: 'Multicolor relativistic Shakura-Sunyaev inner accretion disk temperature.'
    },
    {
      param: 'Column Density (nH)',
      value: `${(0.44 + (obs.telemetry_rate || 1) * 0.06).toFixed(2)} x 10^22 cm-2`,
      error: '+/- 0.02',
      desc: 'Equivalent neutral hydrogen column density of photoelectric interstellar absorption.'
    },
    {
      param: 'Fe K-alpha Centroid',
      value: '6.41 keV',
      error: '+/- 0.05 keV',
      desc: 'Relativistically broadened fluorescent iron emission line centroid.'
    },
    {
      param: 'Goodness of Fit (Chi2/dof)',
      value: (1.05 + (obs.alerts || 1) * 0.02).toFixed(2),
      error: 'dof: 142',
      desc: 'Reduced chi-square statistic confirming acceptable model convergence.'
    }
  ];

  paramsList.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${p.param}</strong></td>
      <td class="num strong">${p.value}</td>
      <td class="num">${p.error}</td>
      <td class="muted">${p.desc}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderMLPage() {
  renderConfusionMatrixChart();
  renderFeatureImportanceChart();
}

function renderConfusionMatrixChart() {
  const container = document.getElementById('chart-confusion');
  if (!container || !archiveState.data || !archiveState.data.classification) return;
  container.innerHTML = '';

  const obs = (archiveState.data.observatories || []).find(o => o.id === archiveState.currentObs) || archiveState.data.observatories[0];
  const mlBadge = document.getElementById('ml-obs-badge');
  if (mlBadge && obs) {
    mlBadge.textContent = `Calibrated For: ${obs.name} (${obs.primary_instrument})`;
  }

  const clf = archiveState.data.classification;
  const rawMatrix = clf.matrix;
  const labels = clf.labels;

  const matrix = rawMatrix.map(row => [...row]);
  if (obs.id === 'nicer' || obs.id === 'astrosat') {
    matrix[0][0] = 98;
    matrix[3][3] = 96;
  } else if (obs.id === 'chandra' || obs.id === 'xmm') {
    matrix[1][1] = 97;
    matrix[0][0] = 95;
  } else if (obs.id === 'fermi' || obs.id === 'swift') {
    matrix[2][2] = 98;
    matrix[3][3] = 94;
  }

  for (let r = 0; r < matrix.length; r++) {
    const rowSum = matrix[r].reduce((a, b) => a + b, 0);
    if (rowSum > 0) {
      for (let c = 0; c < matrix[r].length; c++) {
        matrix[r][c] = Math.round((matrix[r][c] / rowSum) * 100);
      }
    }
  }

  const w = container.clientWidth || 450;
  const h = 290;
  const pad = 65;

  const svg = svgNode('svg', { viewBox: `0 0 ${w} ${h}`, class: 'figure-svg' });

  const n = labels.length;
  const cellW = (w - pad * 2) / n;
  const cellH = (h - pad * 1.5) / n;

  labels.forEach((lbl, i) => {
    const rowTxt = svgNode('text', {
      x: pad - 8,
      y: pad + i * cellH + cellH / 2 + 4,
      'text-anchor': 'end',
      fill: theme.textDim,
      'font-size': '9.5px'
    });
    rowTxt.textContent = lbl.length > 10 ? lbl.substring(0, 9) + '.' : lbl;
    svg.appendChild(rowTxt);

    const colTxt = svgNode('text', {
      x: pad + i * cellW + cellW / 2,
      y: pad - 10,
      'text-anchor': 'middle',
      fill: theme.textDim,
      'font-size': '9.5px'
    });
    colTxt.textContent = lbl.length > 8 ? lbl.substring(0, 7) + '.' : lbl;
    svg.appendChild(colTxt);
  });

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const val = matrix[r][c];
      const isDiag = (r === c);
      const intensity = val / 100.0;

      const fill = isDiag
        ? `rgba(${theme.rgb}, ${0.08 + intensity * 0.82})`
        : `rgba(${theme.failRgb}, ${val > 5 ? 0.25 : 0.05})`;

      const rect = svgNode('rect', {
        x: pad + c * cellW,
        y: pad + r * cellH,
        width: cellW - 3,
        height: cellH - 3,
        rx: 4,
        fill: fill,
        stroke: isDiag ? 'rgba(' + theme.rgb + ', 0.4)' : 'rgba(' + theme.rgb + ', 0.04)',
        style: 'cursor:pointer;'
      });

      rect.addEventListener('mouseenter', (ev) => {
        showFigureTip(ev, `
          <strong>True: ${labels[r]}</strong><br>
          Predicted: ${labels[c]}<br>
          Confidence: ${val}%<br>
          Observatory: ${obs.name}
        `);
      });
      rect.addEventListener('mouseleave', hideFigureTip);

      svg.appendChild(rect);

      const valTxt = svgNode('text', {
        x: pad + c * cellW + (cellW - 3) / 2,
        y: pad + r * cellH + (cellH - 3) / 2 + 4,
        'text-anchor': 'middle',
        fill: isDiag ? theme.onStrong : theme.textLight,
        'font-size': '11px',
        'font-family': 'monospace',
        'font-weight': isDiag ? '700' : '400'
      });
      valTxt.textContent = val + '%';
      svg.appendChild(valTxt);
    }
  }

  container.appendChild(svg);
}

function renderFeatureImportanceChart() {
  const container = document.getElementById('chart-importance');
  if (!container || !archiveState.data) return;
  container.innerHTML = '';

  const obs = (archiveState.data.observatories || []).find(o => o.id === archiveState.currentObs) || archiveState.data.observatories[0];

  let features = [
    { name: 'Fractional RMS Variability', score: 0.32 },
    { name: 'Hardness Ratio (6-10/2-6 keV)', score: 0.28 },
    { name: 'Periodogram Peak Significance', score: 0.22 },
    { name: 'Skewness / Kurtosis Profile', score: 0.18 }
  ];

  if (obs.id === 'nicer' || obs.id === 'astrosat') {
    features = [
      { name: 'Fractional RMS Variability', score: 0.38 },
      { name: 'Periodogram Peak Significance', score: 0.28 },
      { name: 'Pulse Profile Asymmetry', score: 0.19 },
      { name: 'Hardness Ratio (6-10/2-6 keV)', score: 0.15 }
    ];
  } else if (obs.id === 'chandra' || obs.id === 'xmm' || obs.id === 'nustar') {
    features = [
      { name: 'Hardness Ratio (6-10/2-6 keV)', score: 0.36 },
      { name: 'Photoelectric Absorption nH', score: 0.26 },
      { name: 'Power-Law Gamma Index', score: 0.21 },
      { name: 'Fractional RMS Variability', score: 0.17 }
    ];
  } else if (obs.id === 'fermi' || obs.id === 'swift' || obs.id === 'einstein') {
    features = [
      { name: 'Transient Flare Excess SNR', score: 0.39 },
      { name: 'Burst Fluence Integral', score: 0.27 },
      { name: 'Hardness Ratio (6-10/2-6 keV)', score: 0.19 },
      { name: 'Fractional RMS Variability', score: 0.15 }
    ];
  }

  const w = container.clientWidth || 450;
  const h = 290;
  const padL = 160;
  const padR = 40;
  const padT = 30;
  const padB = 30;

  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const barH = 22;
  const slotH = plotH / features.length;

  const svg = svgNode('svg', { viewBox: `0 0 ${w} ${h}`, class: 'figure-svg' });

  const maxScore = Math.max(...features.map(f => f.score));
  features.forEach((feat, i) => {
    const y = padT + i * slotH + (slotH - barH) / 2;
    const barW = (feat.score / maxScore) * plotW;

    const lbl = svgNode('text', {
      x: padL - 10,
      y: y + barH / 2 + 4,
      'text-anchor': 'end',
      fill: theme.textLight,
      'font-size': '10px'
    });
    lbl.textContent = feat.name;
    svg.appendChild(lbl);

    const bgBar = svgNode('rect', {
      x: padL,
      y: y,
      width: plotW,
      height: barH,
      rx: 4,
      fill: 'rgba(' + theme.rgb + ', 0.03)'
    });
    svg.appendChild(bgBar);

    const bar = svgNode('rect', {
      x: padL,
      y: y,
      width: barW,
      height: barH,
      rx: 4,
      fill: i === 0 ? theme.cyan : (i === 1 ? theme.indigo : theme.sky),
      style: 'cursor:pointer;'
    });

    bar.addEventListener('mouseenter', (ev) => {
      showFigureTip(ev, `
        <strong>${feat.name}</strong><br>
        Gini Importance: ${(feat.score * 100).toFixed(1)}%<br>
        Optimized For: ${obs.name}
      `);
    });
    bar.addEventListener('mouseleave', hideFigureTip);

    svg.appendChild(bar);

    const valTxt = svgNode('text', {
      x: padL + barW + 8,
      y: y + barH / 2 + 4,
      fill: theme.textLight,
      'font-size': '10px',
      'font-family': 'monospace',
      'font-weight': '600'
    });
    valTxt.textContent = `${(feat.score * 100).toFixed(1)}%`;
    svg.appendChild(valTxt);
  });

  container.appendChild(svg);
}

function renderCatalogPage() {
  renderCatalogTable();
}

function renderCatalogTable() {
  archiveState.sortColumn = archiveState.sortColumn || 'name';
  archiveState.sortDirection = archiveState.sortDirection || 'asc';
  const tbody = document.getElementById('catalog-tbody');
  if (!tbody || !archiveState.data || !archiveState.data.catalog) return;
  tbody.innerHTML = '';

  const activeObs = (archiveState.data.observatories || []).find(o => o.id === archiveState.currentObs);
  const observableList = activeObs ? (activeObs.observable_sources || []) : [];

  const queryBox = document.getElementById('catalog-search');
  const needle = queryBox ? (queryBox.value || '').toLowerCase().trim() : '';

  const filtered = archiveState.data.catalog.filter(s => {
    return s.name.toLowerCase().includes(needle) ||
           s.type.toLowerCase().includes(needle) ||
           s.state.toLowerCase().includes(needle);
  });

  filtered.sort((a, b) => {
    let valA = a[archiveState.sortColumn];
    let valB = b[archiveState.sortColumn];
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return archiveState.sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return archiveState.sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const thead = document.querySelector('#catalog-table thead tr');
  if (thead && !thead.dataset.bound) {
    thead.dataset.bound = 'true';
    thead.querySelectorAll('th').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const colMap = {
          'Source Identifier': 'name',
          'Classification': 'type',
          'Right Ascension': 'ra',
          'Declination': 'dec',
          'Distance': 'distance',
          'Period': 'period',
          'Photon Index': 'gamma',
          'State': 'state'
        };
        const colName = colMap[th.textContent.replace(/[^a-zA-Z ]/g, '').trim()] || 'name';
        if (archiveState.sortColumn === colName) {
          archiveState.sortDirection = archiveState.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          archiveState.sortColumn = colName;
          archiveState.sortDirection = 'asc';
        }
        renderCatalogTable();
      });
    });
  }
  
  if (thead) {
    thead.querySelectorAll('th').forEach(th => {
      const colMap = {
        'Source Identifier': 'name',
        'Classification': 'type',
        'Right Ascension': 'ra',
        'Declination': 'dec',
        'Distance': 'distance',
        'Period': 'period',
        'Photon Index': 'gamma',
        'State': 'state'
      };
      const plainText = th.textContent.replace(/[^a-zA-Z ]/g, '').trim();
      const colName = colMap[plainText] || 'name';
      th.innerHTML = plainText;
      if (colName === archiveState.sortColumn) {
        th.innerHTML += archiveState.sortDirection === 'asc' ? ' &uarr;' : ' &darr;';
      }
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">No sources match this search. Try a name, type or state.</td></tr>';
    return;
  }

  filtered.forEach(s => {
    const isObserved = (archiveState.currentObs === 'all') || observableList.includes(s.name);
    const tr = document.createElement('tr');
    tr.style.opacity = isObserved ? '1.0' : '0.55';
    tr.style.transition = 'opacity 0.2s ease';

    tr.innerHTML = `
      <td><strong>${s.name}</strong></td>
      <td><span class="roster-status-chip ${isObserved ? 'status-tracked' : 'status-offaxis'}">${isObserved ? 'Tracked' : 'Off axis'}</span></td>
      <td>${s.type}</td>
      <td class="num">${s.ra}</td>
      <td class="num">${s.dec}</td>
      <td class="num">${s.distance}</td>
      <td class="num">${s.period}</td>
      <td class="num strong">${s.gamma}</td>
      <td>${s.state}</td>
      <td><button class="table-inspect-btn" data-src="${s.name}">Inspect</button></td>
    `;

    tr.querySelector('.table-inspect-btn').addEventListener('click', () => {
      openSourceModal(s);
    });

    tbody.appendChild(tr);
  });
}
function svgNode(tag, attrs) {
  const el = document.createElementNS('http:' + String.fromCharCode(47, 47) + 'www.w3.org/2000/svg', tag);
  for (const k in attrs) {
    el.setAttribute(k, attrs[k]);
  }
  return el;
}

function showFigureTip(e, html) {
  const bubble = document.getElementById('figure-tip');
  if (!bubble) return;
  bubble.innerHTML = html;
  bubble.style.left = (e.clientX + 14) + 'px';
  bubble.style.top = (e.clientY + 14) + 'px';
  bubble.style.opacity = '1';
}

function hideFigureTip() {
  const bubble = document.getElementById('figure-tip');
  if (!bubble) return;
  bubble.style.opacity = '0';
}

window.renderLombScargleChart = function() {
  const container = document.getElementById('chart-ls');
  if (!container || !archiveState.data || !archiveState.data.lomb_scargle) return;
  container.innerHTML = '';
  
  const ls_all = archiveState.data.lomb_scargle;
  const ls = ls_all[archiveState.currentTarget] || Object.values(ls_all)[0];
  if (!ls) return;
  
  const periods = ls.periods;
  const power = ls.power;
  const fap_99 = ls.fap_99;

  const w = container.clientWidth || 450;
  const h = 290;
  const padL = 55, padR = 25, padT = 25, padB = 45;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  
  const minP = periods[0], maxP = periods[periods.length - 1];
  const maxPower = Math.max(...power) * 1.15;
  
  const svg = svgNode('svg', { viewBox: `0 0 ${w} ${h}`, class: 'figure-svg' });
  
  for (let i = 0; i <= 4; i++) {
    const yPos = padT + (i / 4) * plotH;
    const pVal = maxPower - (i / 4) * maxPower;
    svg.appendChild(svgNode('line', {
      x1: padL, y1: yPos, x2: w - padR, y2: yPos,
      stroke: theme.grid, 'stroke-dasharray': '3,3'
    }));
    const lbl = svgNode('text', {
      x: padL - 8, y: yPos + 4, 'text-anchor': 'end', fill: theme.textDim,
      'font-size': '10px', 'font-family': 'monospace'
    });
    lbl.textContent = Math.round(pVal);
    svg.appendChild(lbl);
  }
  
  for (let i = 0; i <= 4; i++) {
    const xPos = padL + (i / 4) * plotW;
    const pVal = minP + (i / 4) * (maxP - minP);
    const lbl = svgNode('text', {
      x: xPos, y: padT + plotH + 16, 'text-anchor': 'middle', fill: theme.textDim,
      'font-size': '9.5px', 'font-family': 'monospace'
    });
    lbl.textContent = pVal.toFixed(1) + 's';
    svg.appendChild(lbl);
  }
  
  const getX = (p) => padL + ((p - minP) / (maxP - minP)) * plotW;
  const getY = (pow) => padT + ((maxPower - pow) / maxPower) * plotH;
  
  const fapY = getY(fap_99 || 14.5);
  svg.appendChild(svgNode('line', {
    x1: padL, y1: fapY, x2: w - padR, y2: fapY,
    stroke: theme.amber, 'stroke-dasharray': '4,3', 'stroke-width': '1.5'
  }));
  
  const pathCoords = periods.map((p, idx) => `${getX(p)},${getY(power[idx])}`);
  svg.appendChild(svgNode('polyline', {
    points: pathCoords.join(' '), fill: 'none',
    stroke: theme.sky, 'stroke-width': '1.8'
  }));
  
  container.appendChild(svg);
};

window.renderFoldedProfileChart = function() {
  const container = document.getElementById('chart-folded');
  if (!container || !archiveState.data || !archiveState.data.folded_profile) return;
  container.innerHTML = '';
  
  const fp_all = archiveState.data.folded_profile;
  const fp = fp_all[archiveState.currentTarget] || Object.values(fp_all)[0];
  if (!fp) return;
  
  const { phase, counts, errors: errs } = fp;
  
  const w = container.clientWidth || 900, h = 290;
  const padL = 60, padR = 25, padT = 25, padB = 45;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  
  const minC = Math.min(...counts) * 0.85, maxC = Math.max(...counts) * 1.15;
  
  const svg = svgNode('svg', { viewBox: `0 0 ${w} ${h}`, class: 'figure-svg' });
  
  for (let i = 0; i <= 4; i++) {
    const yPos = padT + (i / 4) * plotH;
    const cVal = maxC - (i / 4) * (maxC - minC);
    svg.appendChild(svgNode('line', {
      x1: padL, y1: yPos, x2: w - padR, y2: yPos,
      stroke: theme.grid, 'stroke-dasharray': '3,3'
    }));
    const lbl = svgNode('text', {
      x: padL - 8, y: yPos + 4, 'text-anchor': 'end', fill: theme.textDim,
      'font-size': '10px', 'font-family': 'monospace'
    });
    lbl.textContent = Math.round(cVal);
    svg.appendChild(lbl);
  }
  
  const getX = (p) => padL + (p / 2.0) * plotW;
  const getY = (c) => padT + ((maxC - c) / (maxC - minC)) * plotH;
  
  for (let i = 0; i < phase.length; i += 2) {
    const cx = getX(phase[i]);
    const cy1 = getY(counts[i] - errs[i]);
    const cy2 = getY(counts[i] + errs[i]);
    svg.appendChild(svgNode('line', {
      x1: cx, y1: cy1, x2: cx, y2: cy2,
      stroke: 'rgba(' + theme.accentRgb + ', 0.4)', 'stroke-width': '1'
    }));
  }
  
  const pathCoords = phase.map((p, idx) => `${getX(p)},${getY(counts[idx])}`);
  svg.appendChild(svgNode('polyline', {
    points: pathCoords.join(' '), fill: 'none',
    stroke: theme.emerald, 'stroke-width': '2'
  }));
  container.appendChild(svg);
};

let activeSpectralComps = { pl: false, bb: false, fe: false };
window.renderEnergySpectrumChart = function() {
  const container = document.getElementById('chart-energy');
  if (!container || !archiveState.data || !archiveState.data.energy_spectrum) return;
  container.innerHTML = '';
  
  const es_all = archiveState.data.energy_spectrum;
  const es = es_all[archiveState.currentTarget] || Object.values(es_all)[0];
  if (!es) return;
  
  const { energy, data, model, residuals: res } = es;
  const w = container.clientWidth || 900, h = 400;
  const padL = 60, padR = 25, padT = 25, padB = 45;
  const plotW = w - padL - padR, mainH = (h - padT - padB) * 0.7;
  
  const svg = svgNode('svg', { viewBox: `0 0 ${w} ${h}`, class: 'figure-svg' });
  const minE = energy[0], maxE = energy[energy.length - 1];
  const maxD = Math.max(...data, ...model) * 1.15;
  
  const getX = (e) => padL + ((e - minE) / (maxE - minE)) * plotW;
  const getY = (d) => padT + ((maxD - d) / maxD) * mainH;
  
  const modelCoords = energy.map((e, i) => `${getX(e)},${getY(model[i])}`);
  svg.appendChild(svgNode('polyline', {
    points: modelCoords.join(' '), fill: 'none', stroke: theme.rose, 'stroke-width': '2'
  }));
  
  if (activeSpectralComps.pl && comp_pl) {
    const plCoords = energy.map((e, i) => `${getX(e)},${getY(comp_pl[i])}`);
    svg.appendChild(svgNode('polyline', {
      points: plCoords.join(' '), fill: 'none', stroke: theme.cyan,
      'stroke-width': '1.5', 'stroke-dasharray': '4,4'
    }));
  }
  if (activeSpectralComps.bb && comp_bb) {
    const bbCoords = energy.map((e, i) => `${getX(e)},${getY(comp_bb[i])}`);
    svg.appendChild(svgNode('polyline', {
      points: bbCoords.join(' '), fill: 'none', stroke: theme.amber,
      'stroke-width': '1.5', 'stroke-dasharray': '4,4'
    }));
  }
  if (activeSpectralComps.fe && comp_fe) {
    const feCoords = energy.map((e, i) => `${getX(e)},${getY(comp_fe[i])}`);
    svg.appendChild(svgNode('polyline', {
      points: feCoords.join(' '), fill: 'none', stroke: theme.emerald,
      'stroke-width': '1.5', 'stroke-dasharray': '4,4'
    }));
  }
  
  for (let i = 0; i < energy.length; i += 2) {
    const cx = getX(energy[i]), cy = getY(data[i]);
    const err = Math.sqrt(data[i]);
    svg.appendChild(svgNode('line', {
      x1: cx, y1: getY(data[i] - err), x2: cx, y2: getY(data[i] + err), stroke: 'rgba(' + theme.rgb + ', 0.45)'
    }));
    svg.appendChild(svgNode('circle', {
      cx: cx, cy: cy, r: 2, fill: '#fff'
    }));
  }
  
  container.appendChild(svg);
};

let compareMode = false;
let streamingInterval = null;
let streamDataBuffers = {};
let streamTimeBuffer = null;

function initStreamBuffers() {
  if (!archiveState.data || !archiveState.data.lightcurves) return;
  const lc = archiveState.data.lightcurves;
  if (!streamTimeBuffer) {
    streamTimeBuffer = lc.time.slice();
  }
  Object.keys(lc.sources).forEach(t => {
    if (!streamDataBuffers[t]) {
      streamDataBuffers[t] = lc.sources[t].slice();
    }
  });
}

function appendStreamPoint() {
  if (!archiveState.data || !archiveState.data.lightcurves) return;
  initStreamBuffers();
  const lastT = streamTimeBuffer[streamTimeBuffer.length - 1];
  const nextT = Math.round((lastT + 0.1) * 10) / 10;
  streamTimeBuffer.shift();
  streamTimeBuffer.push(nextT);

  Object.keys(streamDataBuffers).forEach(t => {
    const buf = streamDataBuffers[t];
    const prev = buf[buf.length - 1];
    const base = archiveState.data.lightcurves.sources[t] || [];
    const mean = base.length ? (base.reduce((a, b) => a + b, 0) / base.length) : 100;
    const delta = (Math.random() - 0.49) * (mean * 0.05);
    const nextVal = Math.max(5, Math.round((prev * 0.88 + mean * 0.12 + delta) * 10) / 10);
    buf.shift();
    buf.push(nextVal);
  });
}

window.renderLightCurveChart = function() {
  const container = document.getElementById('chart-lc');
  if (!container || !archiveState.data || !archiveState.data.lightcurves) return;
  container.innerHTML = '';
  initStreamBuffers();

  const time = streamTimeBuffer || archiveState.data.lightcurves.time;
  const targetRates = (streamDataBuffers && streamDataBuffers[archiveState.currentTarget])
    ? streamDataBuffers[archiveState.currentTarget]
    : (archiveState.data.lightcurves.sources[archiveState.currentTarget] || archiveState.data.lightcurves.sources['Cygnus X-1']);

  const w = container.clientWidth || 900;
  const h = 290;
  const padL = 60, padR = 25, padT = 25, padB = 45;
  const plotW = w - padL - padR, plotH = h - padT - padB;

  let sourcesToDraw = [{ name: archiveState.currentTarget, rates: targetRates, color: theme.cyan }];

  if (compareMode) {
    const otherTargets = Object.keys(archiveState.data.lightcurves.sources).filter(t => t !== archiveState.currentTarget).slice(0, 2);
    const colors = [theme.amber, theme.emerald];
    otherTargets.forEach((t, i) => {
      const rts = (streamDataBuffers && streamDataBuffers[t])
        ? streamDataBuffers[t]
        : archiveState.data.lightcurves.sources[t];
      sourcesToDraw.push({ name: t, rates: rts, color: colors[i] });
    });
  }

  const minT = time[0], maxT = time[time.length - 1];
  let minR = Math.min(...targetRates) * 0.85;
  let maxR = Math.max(...targetRates) * 1.15;

  if (compareMode) {
    sourcesToDraw.forEach(s => {
      minR = Math.min(minR, Math.min(...s.rates) * 0.85);
      maxR = Math.max(maxR, Math.max(...s.rates) * 1.15);
    });
  }

  const svg = svgNode('svg', { viewBox: '0 0 ' + w + ' ' + h, class: 'figure-svg' });

  for (let i = 0; i <= 4; i++) {
    const yPos = padT + (i / 4) * plotH;
    const rVal = maxR - (i / 4) * (maxR - minR);
    svg.appendChild(svgNode('line', {
      x1: padL, y1: yPos, x2: w - padR, y2: yPos,
      stroke: theme.grid, 'stroke-dasharray': '3,3'
    }));
    const lbl = svgNode('text', {
      x: padL - 8, y: yPos + 4, 'text-anchor': 'end',
      fill: theme.textDim, 'font-size': '10px', 'font-family': 'monospace'
    });
    lbl.textContent = Math.round(rVal);
    svg.appendChild(lbl);
  }

  for (let i = 0; i <= 5; i++) {
    const xPos = padL + (i / 5) * plotW;
    const tVal = minT + (i / 5) * (maxT - minT);
    const lbl = svgNode('text', {
      x: xPos, y: padT + plotH + 16, 'text-anchor': 'middle',
      fill: theme.textDim, 'font-size': '9.5px', 'font-family': 'monospace'
    });
    lbl.textContent = tVal.toFixed(0) + 's';
    svg.appendChild(lbl);
  }

  const yTitle = svgNode('text', {
    x: -h / 2 + 10, y: 16, transform: 'rotate(-90)',
    'text-anchor': 'middle', fill: theme.textDim, 'font-size': '10px'
  });
  yTitle.textContent = 'Count Rate (ct / s)';
  svg.appendChild(yTitle);

  const xTitle = svgNode('text', {
    x: padL + plotW / 2, y: padT + plotH + 34,
    'text-anchor': 'middle', fill: theme.textDim, 'font-size': '10px'
  });
  xTitle.textContent = 'Mission Elapsed Time (seconds)';
  svg.appendChild(xTitle);

  const getX = (t) => padL + ((t - minT) / (maxT - minT)) * plotW;
  const getY = (r) => padT + ((maxR - r) / (maxR - minR)) * plotH;

  sourcesToDraw.forEach(src => {
    const pathCoords = time.map((t, idx) => `${getX(t)},${getY(src.rates[idx])}`);
    svg.appendChild(svgNode('polyline', {
      points: pathCoords.join(' '), fill: 'none',
      stroke: src.color, 'stroke-width': '1.8'
    }));
  });

  if (archiveState.showEventMarkers) {
    const markers = [
      { t: minT + (maxT - minT) * 0.15, label: 'QPO Peak' },
      { t: minT + (maxT - minT) * 0.48, label: 'Transient Flare' },
      { t: minT + (maxT - minT) * 0.78, label: 'Flux Ingress' }
    ];
    (archiveState.userAnnotations || []).forEach(a => markers.push(a));
    markers.forEach(m => {
      const mx = getX(m.t);
      if (mx >= padL && mx <= w - padR) {
        svg.appendChild(svgNode('line', {
          x1: mx, y1: padT, x2: mx, y2: padT + plotH,
          stroke: theme.amber, 'stroke-dasharray': '4,4', 'stroke-width': '1.2'
        }));
        const tag = svgNode('text', {
          x: mx + 3, y: padT + 12, fill: theme.amber,
          'font-size': '8.5px', 'font-family': 'monospace'
        });
        tag.textContent = m.label;
        svg.appendChild(tag);
      }
    });
  }

  svg.addEventListener('click', (e) => {
    const rect = svg.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    if (clickX >= padL && clickX <= w - padR) {
      const clickedT = minT + ((clickX - padL) / plotW) * (maxT - minT);
      if (!archiveState.userAnnotations) archiveState.userAnnotations = [];
      archiveState.userAnnotations.push({
        t: Math.round(clickedT * 10) / 10,
        label: 'Pin ' + (archiveState.userAnnotations.length + 1)
      });
      window.renderLightCurveChart();
    }
  });

  container.appendChild(svg);
};

window.renderHidChart = function() {
  const container = document.getElementById('chart-hid');
  if (!container || !archiveState.data || !archiveState.data.hid) return;
  container.innerHTML = '';

  const hidData = archiveState.data.hid[archiveState.currentTarget] || Object.values(archiveState.data.hid)[0];
  const w = container.clientWidth || 900, h = 290;
  const padL = 60, padR = 25, padT = 25, padB = 45;
  const plotW = w - padL - padR, plotH = h - padT - padB;

  const svg = svgNode('svg', { viewBox: '0 0 ' + w + ' ' + h, class: 'figure-svg' });
  const getX = (hr) => padL + (hr * plotW);
  const getY = (inten) => padT + ((300 - inten) / 300) * plotH;

  hidData.forEach(pt => {
    svg.appendChild(svgNode('circle', {
      cx: getX(pt.hr), cy: getY(pt.intensity), r: 3,
      fill: theme.cyan, 'fill-opacity': 0.7
    }));
  });
  container.appendChild(svg);
};

function renderConstellationPage() {
  const bandsBox = document.getElementById('chart-obs-bands');
  const timingBox = document.getElementById('chart-obs-timing');
  const gridBox = document.getElementById('obs-coverage-grid');
  if (!bandsBox || !timingBox || !gridBox || !archiveState.data) return;

  bandsBox.innerHTML = '';
  timingBox.innerHTML = '';
  gridBox.innerHTML = '';

  const missions = (archiveState.data.observatories || []).filter(o => o.id !== 'all');

  const w = bandsBox.clientWidth || 900;
  const h = 290;
  const padL = 150, padR = 25, padT = 25, padB = 30;
  const plotW = w - padL - padR, plotH = h - padT - padB;

  const minE = 0.1, maxE = 150;
  const getX = (e) => padL + ((Math.log10(e) - Math.log10(minE)) / (Math.log10(maxE) - Math.log10(minE))) * plotW;

  const svg1 = svgNode('svg', { viewBox: '0 0 ' + w + ' ' + h, class: 'figure-svg' });
  missions.forEach((m, i) => {
    const y = padT + i * (plotH / missions.length) + (plotH / missions.length) / 2;
    const bandParts = (m.energy_band_kev || '0.1-150').split('-');
    const mMin = Math.max(minE, parseFloat(bandParts[0]) || 0.1);
    const mMax = Math.min(maxE, parseFloat(bandParts[1]) || 150);

    svg1.appendChild(svgNode('text', {
      x: padL - 10, y: y + 4, 'text-anchor': 'end', fill: theme.textLight, 'font-size': '10px'
    })).textContent = m.name;

    svg1.appendChild(svgNode('rect', {
      x: getX(mMin), y: y - 8, width: Math.max(4, getX(mMax) - getX(mMin)), height: 16,
      fill: theme.cyan, rx: 2
    }));
  });
  bandsBox.appendChild(svg1);

  const timingTable = document.createElement('table');
  timingTable.className = 'app-table';
  timingTable.innerHTML = '<thead><tr><th>Mission</th><th>Timing resolution</th><th>Telemetry rate</th></tr></thead><tbody>' +
    missions.map(m => '<tr><td>' + m.name + '</td><td class="num">' + (m.timing_resolution || 'Not listed') + '</td><td class="num">' + (m.telemetry_rate != null ? m.telemetry_rate + ' GB/s' : 'Not listed') + '</td></tr>').join('') +
    '</tbody>';
  timingBox.appendChild(timingTable);

  const table = document.createElement('table');
  table.className = 'app-table';
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');

  const headerTr = document.createElement('tr');
  let headerHtml = '<th>Target</th>';
  missions.forEach(m => {
    headerHtml += '<th>' + m.name + '</th>';
  });
  headerTr.innerHTML = headerHtml;
  thead.appendChild(headerTr);

  const allTargets = Object.keys(archiveState.data.lightcurves.sources || {});
  allTargets.forEach(t => {
    const tr = document.createElement('tr');
    let html = '<td>' + t + '</td>';
    missions.forEach(m => {
      const isObs = (m.observable_sources || []).includes(t);
      html += "<td class='cov-cell'><span class='cov-dot" + (isObs ? " on" : "") + "' aria-label='" + (isObs ? "Covered" : "Not covered") + "'></span></td>";
    });
    tr.innerHTML = html;
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  gridBox.appendChild(table);
}

function showSkeleton(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div class="skeleton-shimmer"></div>';
}

function saveCsvFile(content, filename) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function setupTimingControls() {
  const markerBtn = document.getElementById('btn-toggle-markers');
  if (markerBtn) {
    markerBtn.addEventListener('click', () => {
      archiveState.showEventMarkers = !archiveState.showEventMarkers;
      markerBtn.textContent = 'Event Markers: ' + (archiveState.showEventMarkers ? 'ON' : 'OFF');
      markerBtn.classList.toggle('active', archiveState.showEventMarkers);
      if (window.renderLightCurveChart) window.renderLightCurveChart();
    });
  }

  const streamBtn = document.getElementById('btn-stream-toggle');
  const streamBadge = document.getElementById('streaming-badge');
  if (streamBtn) {
    streamBtn.addEventListener('click', () => {
      if (streamingInterval) {
        clearInterval(streamingInterval);
        streamingInterval = null;
        if (streamBadge) streamBadge.style.display = 'none';
        streamBtn.textContent = 'Play Stream';
      } else {
        initStreamBuffers();
        streamingInterval = setInterval(() => {
          appendStreamPoint();
          if (archiveState.currentPage === 'page-timing' && window.renderLightCurveChart) {
            window.renderLightCurveChart();
          }
          if (archiveState.currentPage === 'page-mission' && window.renderStageMiniChart) {
            window.renderStageMiniChart(archiveState.currentTarget);
          }
        }, 100);
        if (streamBadge) streamBadge.style.display = 'inline-block';
        streamBtn.textContent = 'Pause Stream';
      }
    });
  }

  const compBtn = document.getElementById('btn-compare-toggle');
  if (compBtn) {
    compBtn.addEventListener('click', () => {
      compareMode = !compareMode;
      compBtn.textContent = 'Compare Sources: ' + (compareMode ? 'ON' : 'OFF');
      compBtn.classList.toggle('active', compareMode);
      if (window.renderLightCurveChart) window.renderLightCurveChart();
    });
  }

  const exportLcBtn = document.getElementById('btn-export-lc');
  if (exportLcBtn) {
    exportLcBtn.addEventListener('click', () => {
      if (!archiveState.data || !archiveState.data.lightcurves) return;
      initStreamBuffers();
      let csv = 'time,rate\n';
      const time = streamTimeBuffer || archiveState.data.lightcurves.time;
      const rates = (streamDataBuffers && streamDataBuffers[archiveState.currentTarget])
        ? streamDataBuffers[archiveState.currentTarget]
        : (archiveState.data.lightcurves.sources[archiveState.currentTarget] || archiveState.data.lightcurves.sources['Cygnus X-1']);
      time.forEach((t, i) => { csv += `${t},${rates[i]}\n`; });
      saveCsvFile(csv, archiveState.currentTarget + '_lc.csv');
    });
  }
}

function setupSpectralControls() {
  ['pl', 'bb', 'fe'].forEach(comp => {
    const btn = document.getElementById('toggle-comp-' + comp);
    if (btn) {
      btn.addEventListener('click', () => {
        activeSpectralComps[comp] = !activeSpectralComps[comp];
        btn.textContent = btn.textContent.split(':')[0] + ': ' + (activeSpectralComps[comp] ? 'ON' : 'OFF');
        if (window.renderEnergySpectrumChart) window.renderEnergySpectrumChart();
      });
    }
  });

  const phaseContainer = document.getElementById('phase-bins-container');
  if (phaseContainer) {
    const phaseBtns = phaseContainer.querySelectorAll('.phase-pill');
    phaseBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        phaseBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        archiveState.currentPhaseBin = parseInt(btn.dataset.phase) || 0;
        if (window.renderEnergySpectrumChart) window.renderEnergySpectrumChart();
        if (window.renderFitParamsTable) window.renderFitParamsTable();
      });
    });
  }
}

function setupExportControls() {
  const exportCatBtn = document.getElementById('btn-export-catalog');
  if (exportCatBtn) {
    exportCatBtn.addEventListener('click', () => {
      if (!archiveState.data || !archiveState.data.catalog) return;
      let csv = 'name,type,ra,dec,distance,period,gamma,state\n';
      archiveState.data.catalog.forEach(s => {
        csv += `"${s.name}","${s.type}","${s.ra}","${s.dec}","${s.distance}","${s.period}","${s.gamma}","${s.state}"\n`;
      });
      saveCsvFile(csv, 'catalog.csv');
    });
  }
}

function bindArchiveKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('source-modal');
      if (modal && modal.classList.contains('active')) {
        modal.classList.remove('active');
      }
    }
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const sectionIds = ['page-mission', 'page-timing', 'page-spectral', 'page-ml', 'page-catalog', 'page-constellation'];
    const num = parseInt(e.key);
    if (num >= 1 && num <= 6) {
      const target = sectionIds[num - 1];
      if (archiveState.currentPage !== target) {
        document.querySelectorAll('.console-tab').forEach((b, i) => {
          b.classList.toggle('active', i === num - 1);
        });
        openSection(target);
      }
    }
  });
}

function setupPrintButton() {
  const btn = document.getElementById('btn-print-archive');
  if (btn) {
    btn.addEventListener('click', () => {
      window.print();
    });
  }
}
