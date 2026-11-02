/**
 * Overvix & Volatility Term Structure — Real-Time WebSocket Client & Plotly Visualizer
 */

// Global State
let soundEnabled = true;
let lastOvervixSignal = false;
let lastInversionSignal = false;
let audioCtx = null;
let currentThreshold = 2.0;
let currentTimeframe = '1D'; // '1D', '5D', '1Y'
let currentTrailMode = 'both'; // 'both', 'today', '60d'
let currentCorrMode = 'dual'; // 'dual', 'corr_only'
let currentAssetPair = 'SPX'; // 'SPX' | 'NDX'

// Historical Mode State
let currentViewMode = 'live'; // 'live' | 'historical'
let selectedHistoricalDate = null;
let cachedLiveBootstrap = null;
let cachedLiveTs = null;
let cachedLiveCorr = null;
let cachedLiveTechVol = null;
let cachedLiveCorrNdx = null;
let lastLiveUpdatePayload = null;
let cachedHistoricalData = null;

// Cached Datasets (SPX & Term Structure)
let cachedBootstrap = null;
let cachedTs = {
  '1D': { times: [], vix: [], vix3m: [], ratio: [] },
  '5D': { times: [], vix: [], vix3m: [], ratio: [] },
  '1Y': { times: [], vix: [], vix3m: [], ratio: [] }
};
let cachedTrail = { x: [], y: [], times: [] };
let cachedCorr = {
  '1D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '5D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '1Y': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  metrics: { '1D': -0.75, '5D': -0.75, '1Y': -0.75 }
};

// Cached Datasets (NDX & Tech Vol Spread)
let cachedTechVol = {
  '1D': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
  '5D': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
  '1Y': { times: [], spread: [], ratio: [], vxn: [], vix: [] }
};
let cachedCorrNdx = {
  '1D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '5D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '1Y': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  metrics: { '1D': -0.75, '5D': -0.75, '1Y': -0.75 }
};
let currentCorrTf = '1D';

// Initialize Sound Synthesizer via Web Audio API
function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
}

function playAlertSound(type = 'overvix') {
  if (!soundEnabled) return;
  try {
    initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'dual') {
      // Dual Capitulation Alert: High urgency triple chime
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1174.66, now + 0.12);
      osc.frequency.setValueAtTime(1760, now + 0.25);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    } else {
      // Single Overvix Alert: Clean ping chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.2); // A5
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    }
  } catch (err) {
    console.warn("Audio playback error:", err);
  }
}

// Formatters
const fmtNum = (n, dec = 2) => (n !== null && n !== undefined && !isNaN(n)) ? Number(n).toFixed(dec) : '--.--';
const fmtPct = (n) => (n !== null && n !== undefined && !isNaN(n)) ? (n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`) : '--.--%';
const fmtPts = (n) => (n !== null && n !== undefined && !isNaN(n)) ? (n >= 0 ? `+${n.toFixed(2)}` : `${n.toFixed(2)}`) : '--.--';

// Sound Toggle Handler
const btnSound = document.getElementById('btn-sound');
const soundIcon = document.getElementById('sound-icon');
const soundText = document.getElementById('sound-text');

btnSound.addEventListener('click', () => {
  initAudio();
  soundEnabled = !soundEnabled;
  if (soundEnabled) {
    soundIcon.textContent = '🔊';
    soundText.textContent = 'Sound ON';
    btnSound.classList.remove('opacity-60');
    playAlertSound('test');
  } else {
    soundIcon.textContent = '🔇';
    soundText.textContent = 'Muted';
    btnSound.classList.add('opacity-60');
  }
});

// Settings Modal
const btnSettings = document.getElementById('btn-settings');
const modalSettings = document.getElementById('modal-settings');
const modalClose = document.getElementById('modal-close');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');

btnSettings.addEventListener('click', () => modalSettings.classList.remove('hidden'));
modalClose.addEventListener('click', () => modalSettings.classList.add('hidden'));
btnCancelSettings.addEventListener('click', () => modalSettings.classList.add('hidden'));

btnSaveSettings.addEventListener('click', async () => {
  const thresh = parseFloat(document.getElementById('input-threshold').value);
  const win = parseInt(document.getElementById('input-window').value, 10);
  const interval = parseFloat(document.getElementById('input-interval').value);

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold: thresh, window: win, interval: interval })
    });
    if (res.ok) {
      currentThreshold = thresh;
      document.getElementById('disp-thresh-pts').textContent = thresh.toFixed(1);
      modalSettings.classList.add('hidden');
      bootstrapData();
    }
  } catch (e) {
    alert("Error updating settings: " + e);
  }
});

// Regime Guide & Playbook Modal
const btnGuide = document.getElementById('btn-guide');
const btnCorrGuide = document.getElementById('btn-corr-guide');
const modalGuide = document.getElementById('modal-guide');
const guideModalClose = document.getElementById('guide-modal-close');
const btnCloseGuide = document.getElementById('btn-close-guide');

function openGuideModal() {
  if (modalGuide) modalGuide.classList.remove('hidden');
}

function closeGuideModal() {
  if (modalGuide) modalGuide.classList.add('hidden');
}

if (btnGuide) btnGuide.addEventListener('click', openGuideModal);
if (btnCorrGuide) btnCorrGuide.addEventListener('click', openGuideModal);
if (guideModalClose) guideModalClose.addEventListener('click', closeGuideModal);
if (btnCloseGuide) btnCloseGuide.addEventListener('click', closeGuideModal);

// Close modals when clicking backdrop
if (modalGuide) {
  modalGuide.addEventListener('click', (e) => {
    if (e.target === modalGuide) closeGuideModal();
  });
}
if (modalSettings) {
  modalSettings.addEventListener('click', (e) => {
    if (e.target === modalSettings) modalSettings.classList.add('hidden');
  });
}

// Global Escape Key listener
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeGuideModal();
    if (modalSettings) modalSettings.classList.add('hidden');
  }
});

// Asset Pair Switcher (SPX/VIX vs NDX/VXN)
const btnAssetSpx = document.getElementById('btn-asset-spx');
const btnAssetNdx = document.getElementById('btn-asset-ndx');

function setupAssetSwitcher() {
  if (btnAssetSpx) btnAssetSpx.addEventListener('click', () => switchAssetPair('SPX'));
  if (btnAssetNdx) btnAssetNdx.addEventListener('click', () => switchAssetPair('NDX'));
}

function switchAssetPair(pair) {
  if (currentAssetPair === pair) return;
  currentAssetPair = pair;

  if (pair === 'SPX') {
    if (btnAssetSpx) btnAssetSpx.className = "px-2.5 py-1 rounded text-xs font-bold bg-cyan-500 text-black shadow-sm transition flex items-center space-x-1.5";
    if (btnAssetNdx) btnAssetNdx.className = "px-2.5 py-1 rounded text-xs font-semibold text-slate-400 hover:text-white transition flex items-center space-x-1.5";

    const spTitle = document.getElementById('spotvol-title');
    if (spTitle) spTitle.textContent = "Spot-Vol Regression & Overvix Zone";
    const spSub = document.getElementById('spotvol-sub');
    if (spSub) spSub.textContent = "SPX % vs VIX Point Move with +2.0 pt Threshold & Today's Intraday Path";

    const tsTitle = document.getElementById('ts-title');
    if (tsTitle) tsTitle.textContent = "Volatility Term Structure (VIX / VIX3M)";
    const tsSub = document.getElementById('ts-sub');
    if (tsSub) tsSub.textContent = "30-Day vs. 90-Day Volatility Ratio & Inversion Monitor";

    const corrTitle = document.getElementById('corr-title');
    if (corrTitle) corrTitle.textContent = "SPX & VIX Dynamic Correlation & Divergence Monitor";
    const corrSub = document.getElementById('corr-subtitle');
    if (corrSub) corrSub.textContent = "Minute-by-Minute Normalized Overlay (Upper) & Rolling 30-Minute Pearson Correlation ρ(ΔSPX, ΔVIX) (Lower)";
  } else {
    if (btnAssetNdx) btnAssetNdx.className = "px-2.5 py-1 rounded text-xs font-bold bg-purple-500 text-white shadow-sm transition flex items-center space-x-1.5";
    if (btnAssetSpx) btnAssetSpx.className = "px-2.5 py-1 rounded text-xs font-semibold text-slate-400 hover:text-white transition flex items-center space-x-1.5";

    const spTitle = document.getElementById('spotvol-title');
    if (spTitle) spTitle.textContent = "Nasdaq Spot-Vol Regression & Over-VXN Zone";
    const spSub = document.getElementById('spotvol-sub');
    if (spSub) spSub.textContent = "NDX % vs VXN Point Move with +2.0 pt Threshold & Intraday Path";

    const tsTitle = document.getElementById('ts-title');
    if (tsTitle) tsTitle.textContent = "Tech Vol Premium (VXN vs VIX Spread & Ratio)";
    const tsSub = document.getElementById('ts-sub');
    if (tsSub) tsSub.textContent = "Tech Vol Spread (VXN - VIX) & Skew Ratio Monitor";

    const corrTitle = document.getElementById('corr-title');
    if (corrTitle) corrTitle.textContent = "NDX & VXN Dynamic Correlation & Divergence Monitor";
    const corrSub = document.getElementById('corr-subtitle');
    if (corrSub) corrSub.textContent = "Minute-by-Minute Normalized Overlay (Upper) & Rolling 30-Minute Pearson Correlation ρ(ΔNDX, ΔVXN) (Lower)";
  }

  // Re-render charts and UI immediately from cache
  const activeData = (currentViewMode === 'historical' && cachedHistoricalData) ? cachedHistoricalData : cachedBootstrap;
  if (activeData) {
    renderOvervixChart(activeData);
    renderTermStructureChart(currentTimeframe);
    renderCorrelationChart(currentCorrMode, currentCorrTf);
    updateCorrMetricDisplay();
    updateUI(activeData);
  }
}

// Timeframe Selector Buttons
const btnTf1D = document.getElementById('btn-tf-1d');
const btnTf5D = document.getElementById('btn-tf-5d');
const btnTf1Y = document.getElementById('btn-tf-1y');
const tsLivePill = document.getElementById('ts-live-pill');

function setupTimeframeButtons() {
  btnTf1D.addEventListener('click', () => switchTimeframe('1D'));
  btnTf5D.addEventListener('click', () => switchTimeframe('5D'));
  btnTf1Y.addEventListener('click', () => switchTimeframe('1Y'));
}

function switchTimeframe(tf) {
  currentTimeframe = tf;

  const allBtns = [btnTf1D, btnTf5D, btnTf1Y];
  allBtns.forEach(btn => {
    btn.className = "px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white transition";
  });

  if (tf === '1D') {
    btnTf1D.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition";
    tsLivePill.textContent = "Intraday 1m";
    tsLivePill.className = "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60";
  } else if (tf === '5D') {
    btnTf5D.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition";
    tsLivePill.textContent = "Recent 15m";
    tsLivePill.className = "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/60";
  } else if (tf === '1Y') {
    btnTf1Y.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition";
    tsLivePill.textContent = "Daily Close";
    tsLivePill.className = "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700";
  }

  renderTermStructureChart(tf);
}

// Trail Mode Selector (Overvix Chart)
const btnTrailBoth = document.getElementById('btn-trail-both');
const btnTrailToday = document.getElementById('btn-trail-today');
const btnTrail60D = document.getElementById('btn-trail-60d');
const trailLivePill = document.getElementById('trail-live-pill');

function setupTrailButtons() {
  btnTrailBoth.addEventListener('click', () => switchTrailMode('both'));
  btnTrailToday.addEventListener('click', () => switchTrailMode('today'));
  btnTrail60D.addEventListener('click', () => switchTrailMode('60d'));
}

function switchTrailMode(mode) {
  currentTrailMode = mode;
  const allTrailBtns = [btnTrailBoth, btnTrailToday, btnTrail60D];
  allTrailBtns.forEach(btn => {
    btn.className = "px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white transition";
  });

  if (mode === 'both') {
    btnTrailBoth.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition";
    trailLivePill.textContent = "+ Intraday Trail";
    Plotly.restyle('overvix-chart', { visible: [true, true, true, true, true, true] });
  } else if (mode === 'today') {
    btnTrailToday.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition";
    trailLivePill.textContent = "Today Trail Only";
    Plotly.restyle('overvix-chart', { visible: [false, true, true, true, true, true] });
  } else if (mode === '60d') {
    btnTrail60D.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition";
    trailLivePill.textContent = "60D Scatter Only";
    Plotly.restyle('overvix-chart', { visible: [true, true, true, true, false, true] });
  }
}

// Correlation Mode & Timeframe Selector
const btnCorrDual = document.getElementById('btn-corr-dual');
const btnCorrOnly = document.getElementById('btn-corr-only');
const btnCorrTf1D = document.getElementById('btn-corr-tf-1d');
const btnCorrTf5D = document.getElementById('btn-corr-tf-5d');
const btnCorrTf1Y = document.getElementById('btn-corr-tf-1y');
const corrTfPill = document.getElementById('corr-tf-pill');
const corrSubtitle = document.getElementById('corr-subtitle');
const corrLiveLabel = document.getElementById('corr-live-label');

function setupCorrButtons() {
  btnCorrDual.addEventListener('click', () => switchCorrMode('dual'));
  btnCorrOnly.addEventListener('click', () => switchCorrMode('corr_only'));

  if (btnCorrTf1D) btnCorrTf1D.addEventListener('click', () => switchCorrTf('1D'));
  if (btnCorrTf5D) btnCorrTf5D.addEventListener('click', () => switchCorrTf('5D'));
  if (btnCorrTf1Y) btnCorrTf1Y.addEventListener('click', () => switchCorrTf('1Y'));
}

function switchCorrMode(mode) {
  currentCorrMode = mode;
  if (mode === 'dual') {
    btnCorrDual.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition";
    btnCorrOnly.className = "px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white transition";
  } else {
    btnCorrOnly.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition";
    btnCorrDual.className = "px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white transition";
  }
  renderCorrelationChart(mode, currentCorrTf);
}

function switchCorrTf(tf) {
  currentCorrTf = tf;
  const allBtns = [btnCorrTf1D, btnCorrTf5D, btnCorrTf1Y];
  allBtns.forEach(btn => {
    if (btn) btn.className = "px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white transition";
  });

  if (tf === '1D') {
    if (btnCorrTf1D) btnCorrTf1D.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition";
    if (corrTfPill) {
      corrTfPill.textContent = "Intraday 1M";
      corrTfPill.className = "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60";
    }
    if (corrSubtitle) corrSubtitle.textContent = "Minute-by-Minute Normalized Overlay (Upper) & Rolling 30-Minute Pearson Correlation ρ(ΔSPX, ΔVIX) (Lower)";
    if (corrLiveLabel) corrLiveLabel.textContent = "Current 30m ρ:";
  } else if (tf === '5D') {
    if (btnCorrTf5D) btnCorrTf5D.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition";
    if (corrTfPill) {
      corrTfPill.textContent = "Recent 15M";
      corrTfPill.className = "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/60";
    }
    if (corrSubtitle) corrSubtitle.textContent = "5-Day 15-Minute Normalized Overlay (Upper) & Rolling 1-Day Pearson Correlation ρ(ΔSPX, ΔVIX) (Lower)";
    if (corrLiveLabel) corrLiveLabel.textContent = "Current 1D ρ:";
  } else if (tf === '1Y') {
    if (btnCorrTf1Y) btnCorrTf1Y.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition";
    if (corrTfPill) {
      corrTfPill.textContent = "Daily Macro";
      corrTfPill.className = "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700";
    }
    if (corrSubtitle) corrSubtitle.textContent = "1-Year Daily Normalized Overlay (Upper) & Rolling 20-Day Pearson Correlation ρ(ΔSPX, ΔVIX) (Lower)";
    if (corrLiveLabel) corrLiveLabel.textContent = "Current 20D ρ:";
  }

  updateCorrMetricDisplay();
  renderCorrelationChart(currentCorrMode, tf);
}

function updateCorrMetricDisplay() {
  const isNdx = (currentAssetPair === 'NDX');
  const c = isNdx ? cachedCorrNdx : cachedCorr;
  const metrics = c.metrics || {};
  let val = metrics[currentCorrTf];
  if (val === undefined || val === null) {
    const ds = c[currentCorrTf];
    if (ds && ds.rolling_corr && ds.rolling_corr.length > 0) {
      val = ds.rolling_corr[ds.rolling_corr.length - 1];
    }
  }
  if (val !== undefined && val !== null) {
    const el = document.getElementById('corr-live-val');
    if (el) el.textContent = fmtNum(val, 3);
  }
}

// ==============================================================================
// PLOTLY CHART INITIALIZATION & RENDERING
// ==============================================================================

function renderOvervixChart(bootstrap) {
  const isNdx = (currentAssetPair === 'NDX');
  const targetData = (isNdx && bootstrap.ndx && bootstrap.ndx.overvix) ? bootstrap.ndx : bootstrap;
  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';

  const xHist = (targetData.overvix && targetData.overvix.x_history) ? targetData.overvix.x_history : [];
  const yHist = (targetData.overvix && targetData.overvix.y_history) ? targetData.overvix.y_history : [];
  const dates = (targetData.overvix && targetData.overvix.dates) ? targetData.overvix.dates : [];
  const slope = (targetData.model && targetData.model.slope) || 0;
  const intercept = (targetData.model && targetData.model.intercept) || 0;
  const threshold = (targetData.model && targetData.model.threshold_pts) || currentThreshold;

  // Intraday Trail Data
  const trail = (targetData.overvix && targetData.overvix.intraday_trail) ? targetData.overvix.intraday_trail : { x: [], y: [], times: [] };
  cachedTrail = trail;

  // Compute Trendline & Overvix Band
  const allX = xHist.concat(trail.x || []);
  const minX = Math.min(-3.5, ...allX) - 0.4;
  const maxX = Math.max(3.5, ...allX) + 0.4;
  const xGrid = [minX, maxX];
  const yTrend = xGrid.map(x => intercept + slope * x);
  const yThreshold = yTrend.map(y => y + threshold);
  const yBandTop = yThreshold.map(y => y + 2.5);

  let currX = 0;
  let currY = 0;
  if (targetData.current_point && targetData.current_point.x !== undefined && targetData.current_point.y !== undefined) {
    currX = targetData.current_point.x;
    currY = targetData.current_point.y;
  } else if (targetData.market && targetData.market.pct_change !== undefined) {
    currX = targetData.market.pct_change;
    currY = (targetData.market.vxn && targetData.market.vxn.pt_change !== undefined)
      ? targetData.market.vxn.pt_change
      : (targetData.market.vix ? targetData.market.vix.pt_change : 0);
  } else if (trail.x && trail.x.length > 0 && trail.y && trail.y.length > 0) {
    currX = trail.x[trail.x.length - 1];
    currY = trail.y[trail.y.length - 1];
  }
  const isOvervixed = targetData.overvix ? targetData.overvix.is_overvixed : false;

  const traces = [
    // 0: Historical 60D Spot-Vol Points
    {
      x: xHist,
      y: yHist,
      text: dates,
      mode: 'markers',
      name: `${assetLabel} Historical (60D)`,
      marker: {
        color: isNdx ? '#C084FC' : '#E6D385',
        size: 7,
        opacity: 0.75,
        line: { color: isNdx ? '#9333EA' : '#B39F50', width: 0.5 }
      },
      hovertemplate: `<b>%{text}</b><br>${assetLabel} Move: %{x:+.2f}%<br>${volLabel} Move: %{y:+.2f} pts<extra></extra>`,
      visible: currentTrailMode === 'today' ? false : true
    },
    // 1: Regression Trendline
    {
      x: xGrid,
      y: yTrend,
      mode: 'lines',
      name: 'Expected Trendline',
      line: { color: isNdx ? '#A855F7' : '#C5BF85', width: 2 },
      hoverinfo: 'none'
    },
    // 2: Overvix / Over-VXN Threshold Line
    {
      x: xGrid,
      y: yThreshold,
      mode: 'lines',
      name: `Threshold (+${threshold.toFixed(1)} pts)`,
      line: { color: '#FF5370', width: 1.5, dash: 'dash' },
      hoverinfo: 'none'
    },
    // 3: Overvix Shaded Zone
    {
      x: xGrid.concat([...xGrid].reverse()),
      y: yBandTop.concat([...yThreshold].reverse()),
      fill: 'toself',
      fillcolor: 'rgba(255, 83, 112, 0.12)',
      line: { color: 'transparent' },
      name: isNdx ? 'Over-VXN Zone' : 'Overvix Zone',
      hoverinfo: 'none'
    },
    // 4: Intraday Breadcrumb Trail
    {
      x: trail.x || [],
      y: trail.y || [],
      text: trail.times || [],
      mode: 'lines+markers',
      name: bootstrap.is_historical ? `${bootstrap.session_date} Path` : (bootstrap.session_date ? `Session ${bootstrap.session_date} Path` : "Intraday Path"),
      line: { color: isNdx ? '#C084FC' : '#00E5FF', width: 1.8, shape: 'spline' },
      marker: { color: isNdx ? '#C084FC' : '#00E5FF', size: 4, opacity: 0.8 },
      hovertemplate: `<b>%{text}</b><br>${assetLabel}: %{x:+.2f}%<br>${volLabel}: %{y:+.2f} pts<extra></extra>`,
      visible: currentTrailMode === '60d' ? false : true
    },
    // 5: Session End / Live Current Point
    {
      x: [currX],
      y: [currY],
      mode: 'markers',
      name: (bootstrap.is_historical || bootstrap.is_rth_active === false) ? "Session Close Point" : "Live Point",
      marker: {
        color: isOvervixed ? '#FF1744' : (isNdx ? '#C084FC' : '#00E5FF'),
        size: 14,
        line: { color: '#FFFFFF', width: 2 }
      },
      hovertemplate: (bootstrap.is_historical || bootstrap.is_rth_active === false)
        ? `<b>Session Close (${bootstrap.session_date || 'Prior'})</b><br>${assetLabel}: %{x:+.2f}%<br>${volLabel}: %{y:+.2f} pts<extra></extra>`
        : `<b>Live Current Point</b><br>${assetLabel}: %{x:+.2f}%<br>${volLabel}: %{y:+.2f} pts<extra></extra>`
    }
  ];

  const sessionPeriodLabel = (bootstrap.is_historical && bootstrap.session_date) 
    ? bootstrap.session_date 
    : (bootstrap.is_rth_active === false && bootstrap.session_date ? bootstrap.session_date : 'Today');

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    margin: { l: 50, r: 20, t: 25, b: 45 },
    xaxis: {
      title: { text: `${assetLabel} % Change (${sessionPeriodLabel})`, font: { color: '#94A3B8', size: 11 } },
      gridcolor: '#1e293b',
      zerolinecolor: '#334155',
      zerolinewidth: 1,
      tickfont: { color: '#94A3B8', size: 10 }
    },
    yaxis: {
      title: { text: `${volLabel} Point Move (${sessionPeriodLabel})`, font: { color: '#94A3B8', size: 11 } },
      gridcolor: '#1e293b',
      zerolinecolor: '#334155',
      zerolinewidth: 1,
      tickfont: { color: '#94A3B8', size: 10 }
    },
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.15,
      font: { color: '#94A3B8', size: 10 }
    },
    showlegend: true
  };

  Plotly.newPlot('overvix-chart', traces, layout, { responsive: true, displayModeBar: false });
}

function renderTechVolChart(tf = currentTimeframe) {
  const data = cachedTechVol[tf] || cachedTechVol['1D'] || {};
  const times = data.times || [];
  const vxn = data.vxn || [];
  const vix = data.vix || [];
  const spread = data.spread || [];
  const ratio = data.ratio || [];

  const dStart = times.length > 0 ? times[0] : '';
  const dEnd = times.length > 0 ? times[times.length - 1] : '';
  const timeHoverFmt = (tf === '1Y') ? '%b %d, %Y' : '%b %d, %H:%M';

  const traceVXN = {
    x: times,
    y: vxn,
    name: 'VXN (Tech Vol)',
    mode: 'lines',
    line: { color: '#C084FC', width: 1.8 },
    xaxis: 'x',
    yaxis: 'y1',
    hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>VXN: %{y:.2f}<extra></extra>`
  };

  const traceVIX = {
    x: times,
    y: vix,
    name: 'VIX (Broad Vol)',
    mode: 'lines',
    line: { color: '#00E5FF', width: 1.5 },
    xaxis: 'x',
    yaxis: 'y1',
    hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>VIX: %{y:.2f}<extra></extra>`
  };

  const traceSpread = {
    x: times,
    y: spread,
    name: 'Tech Spread (VXN - VIX)',
    mode: 'lines',
    line: { color: '#F59E0B', width: 2 },
    xaxis: 'x',
    yaxis: 'y2',
    hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>Spread: %{y:+.2f} pts<extra></extra>`
  };

  const traceEquilibrium = {
    x: [dStart, dEnd],
    y: [3.0, 3.0],
    mode: 'lines',
    name: 'Normal Spread (+3.0 pts)',
    line: { color: '#10B981', width: 1, dash: 'dot' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'none'
  };

  const tracePanic = {
    x: [dStart, dEnd],
    y: [6.0, 6.0],
    mode: 'lines',
    name: 'Tech Panic Spread (+6.0 pts)',
    line: { color: '#EF4444', width: 1.5, dash: 'dash' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'none'
  };

  const latestSpread = spread.length > 0 ? spread[spread.length - 1] : null;
  const latestTime = times.length > 0 ? times[times.length - 1] : null;

  const traceLivePoint = {
    x: latestTime ? [latestTime] : [],
    y: latestSpread !== null ? [latestSpread] : [],
    mode: 'markers',
    name: 'Live Spread',
    marker: {
      color: (latestSpread !== null && latestSpread >= 6.0) ? '#EF4444' : '#F59E0B',
      size: 10,
      line: { color: '#FFFFFF', width: 1.5 }
    },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'none'
  };

  const xTitle = (tf === '1D') ? 'Today Intraday Time (US/Eastern)' : ((tf === '5D') ? '5-Day Timeline' : '1-Year Daily Date');
  let rangebreaks = [];
  if (tf === '1D') {
    rangebreaks = [{ pattern: 'hour', bounds: [16.25, 9.5] }];
  } else if (tf === '5D') {
    rangebreaks = [{ bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.25, 9.5] }];
  } else if (tf === '1Y') {
    rangebreaks = [{ bounds: ['sat', 'mon'] }];
  }

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    margin: { l: 50, r: 20, t: 25, b: 40 },
    xaxis: {
      anchor: 'y2',
      type: 'date',
      rangebreaks: rangebreaks,
      tickformat: (tf === '1D') ? '%H:%M' : ((tf === '5D') ? '%b %d %H:%M' : '%b %Y'),
      title: { text: xTitle, font: { color: '#94A3B8', size: 10 } },
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 },
      showgrid: true,
      nticks: 10
    },
    yaxis: {
      domain: [0.48, 1.0],
      title: { text: 'Vol Level (VXN & VIX)', font: { color: '#94A3B8', size: 10 } },
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 }
    },
    yaxis2: {
      domain: [0.0, 0.40],
      title: { text: 'Tech Spread (pts)', font: { color: '#F59E0B', size: 10 } },
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 }
    },
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.1,
      font: { color: '#94A3B8', size: 10 }
    },
    showlegend: true
  };

  Plotly.newPlot('term-structure-chart', [traceVXN, traceVIX, traceSpread, traceEquilibrium, tracePanic, traceLivePoint], layout, {
    responsive: true,
    displayModeBar: false
  });
}

function renderTermStructureChart(tf = '1D') {
  if (currentAssetPair === 'NDX') {
    renderTechVolChart(tf);
    return;
  }
  const data = cachedTs[tf] || cachedTs['1D'];
  const times = data.times || [];
  const vix = data.vix || [];
  const vix3m = data.vix3m || [];
  const ratio = data.ratio || [];

  const dStart = times.length > 0 ? times[0] : '';
  const dEnd = times.length > 0 ? times[times.length - 1] : '';

  const timeHoverFmt = (tf === '1Y') ? '%b %d, %Y' : '%b %d, %H:%M';

  const traceVIX = {
    x: times,
    y: vix,
    name: 'VIX (30d)',
    mode: 'lines',
    line: { color: '#00E5FF', width: 1.5 },
    xaxis: 'x',
    yaxis: 'y1',
    hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>VIX (30d): %{y:.2f}<extra></extra>`
  };

  const traceVIX3M = {
    x: times,
    y: vix3m,
    name: 'VIX3M (90d)',
    mode: 'lines',
    line: { color: '#FFA726', width: 1.5 },
    xaxis: 'x',
    yaxis: 'y1',
    hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>VIX3M (90d): %{y:.2f}<extra></extra>`
  };

  const traceRatio = {
    x: times,
    y: ratio,
    name: 'Ratio (VIX/VIX3M)',
    mode: 'lines',
    line: { color: '#E6D385', width: 2 },
    xaxis: 'x',
    yaxis: 'y2',
    hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>Ratio: %{y:.4f}<extra></extra>`
  };

  const traceFlattening = {
    x: [dStart, dEnd],
    y: [0.90, 0.90],
    mode: 'lines',
    name: 'Flattening (0.90)',
    line: { color: '#FFA726', width: 1, dash: 'dot' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'none'
  };

  const traceInversion = {
    x: [dStart, dEnd],
    y: [1.00, 1.00],
    mode: 'lines',
    name: 'Inversion (1.00)',
    line: { color: '#EF4444', width: 1.5, dash: 'dash' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'none'
  };

  const latestRatio = ratio.length > 0 ? ratio[ratio.length - 1] : null;
  const latestTime = times.length > 0 ? times[times.length - 1] : null;
  const isInv = latestRatio !== null && latestRatio >= 1.00;

  const traceLivePoint = {
    x: latestTime ? [latestTime] : [],
    y: latestRatio !== null ? [latestRatio] : [],
    mode: 'markers',
    name: 'Live Ratio',
    marker: {
      color: isInv ? '#EF4444' : '#00E5FF',
      size: 10,
      line: { color: '#FFFFFF', width: 1.5 }
    },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'none'
  };

  const xTitle = (tf === '1D') ? 'Today Intraday Time (US/Eastern)' : ((tf === '5D') ? '5-Day Timeline' : '1-Year Daily Date');

  let rangebreaks = [];
  if (tf === '1D') {
    rangebreaks = [
      { pattern: 'hour', bounds: [16.25, 9.5] }
    ];
  } else if (tf === '5D') {
    rangebreaks = [
      { bounds: ['sat', 'mon'] },
      { pattern: 'hour', bounds: [16.25, 9.5] }
    ];
  } else if (tf === '1Y') {
    rangebreaks = [
      { bounds: ['sat', 'mon'] }
    ];
  }

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    margin: { l: 50, r: 20, t: 25, b: 40 },
    xaxis: {
      anchor: 'y2',
      type: 'date',
      rangebreaks: rangebreaks,
      tickformat: (tf === '1D') ? '%H:%M' : ((tf === '5D') ? '%b %d %H:%M' : '%b %Y'),
      title: { text: xTitle, font: { color: '#94A3B8', size: 10 } },
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 },
      showgrid: true,
      nticks: 10
    },
    yaxis: {
      domain: [0.48, 1.0],
      title: { text: 'Index Level', font: { color: '#94A3B8', size: 10 } },
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 }
    },
    yaxis2: {
      domain: [0.0, 0.40],
      title: { text: 'Ratio', font: { color: '#94A3B8', size: 10 } },
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 }
    },
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.1,
      font: { color: '#94A3B8', size: 10 }
    },
    showlegend: true
  };

  Plotly.newPlot('term-structure-chart', [traceVIX, traceVIX3M, traceRatio, traceFlattening, traceInversion, traceLivePoint], layout, {
    responsive: true,
    displayModeBar: false
  });
}

function renderCorrelationChart(mode = currentCorrMode, tf = currentCorrTf) {
  const isNdx = (currentAssetPair === 'NDX');
  const c = isNdx ? (cachedCorrNdx[tf] || cachedCorrNdx['1D'] || cachedCorrNdx) : (cachedCorr[tf] || cachedCorr['1D'] || cachedCorr);
  const times = c.times || [];
  const assetPct = c.spx_pct || c.ndx_pct || [];
  const volPt = c.vix_pt || c.vxn_pt || [];
  const rollingCorr = c.rolling_corr || [];

  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';

  const dStart = times.length > 0 ? times[0] : '';
  const dEnd = times.length > 0 ? times[times.length - 1] : '';

  // Dynamic Pearson upper bound: 0.05 by default (framing 0.0 Decoupling line at top), expanding only if ρ > 0
  const validCorrs = rollingCorr.filter(v => typeof v === 'number' && !isNaN(v));
  const maxCorrVal = validCorrs.length > 0 ? Math.max(...validCorrs) : -0.7;
  const upperY = maxCorrVal > 0 ? Math.min(1.05, Math.ceil((maxCorrVal + 0.05) * 10) / 10) : 0.05;

  let xTitle = 'Today Intraday Time (US/Eastern)';
  let tickformat = '%H:%M';
  let rangebreaks = [];
  let corrTraceName = `Rolling 30m Correlation (ρ)`;
  let corrHoverLabel = `Rolling 30m ρ`;

  if (tf === '1D') {
    xTitle = 'Today Intraday Time (US/Eastern)';
    tickformat = '%H:%M';
    rangebreaks = [
      { pattern: 'hour', bounds: [16.25, 9.5] }
    ];
    corrTraceName = `Rolling 30m Correlation (ρ)`;
    corrHoverLabel = `Rolling 30m ρ`;
  } else if (tf === '5D') {
    xTitle = '5-Day Timeline (US/Eastern)';
    tickformat = '%b %d %H:%M';
    rangebreaks = [
      { bounds: ['sat', 'mon'] },
      { pattern: 'hour', bounds: [16.25, 9.5] }
    ];
    corrTraceName = `Rolling 1D Correlation (ρ)`;
    corrHoverLabel = `Rolling 1D ρ`;
  } else if (tf === '1Y') {
    xTitle = '1-Year Daily Date';
    tickformat = '%b %Y';
    rangebreaks = [
      { bounds: ['sat', 'mon'] }
    ];
    corrTraceName = `Rolling 20D Correlation (ρ)`;
    corrHoverLabel = `Rolling 20D ρ`;
  }

  const timeHoverFmt = (tf === '1Y') ? '%b %d, %Y' : '%b %d, %H:%M';
  let assetHoverLabel = (tf === '1D') ? `${assetLabel} Day Move` : ((tf === '5D') ? `${assetLabel} 5D Move` : `${assetLabel} 1Y Move`);
  let volHoverLabel = (tf === '1D') ? `${volLabel} Day Move` : ((tf === '5D') ? `${volLabel} 5D Move` : `${volLabel} 1Y Move`);

  const assetColor = isNdx ? '#C084FC' : '#10B981';
  const volColor = '#F59E0B';
  const corrColor = isNdx ? '#A855F7' : '#00E5FF';

  if (mode === 'dual') {
    // Subplot 1: Asset % Move (left axis) vs Vol pt move (right axis)
    const traceAsset = {
      x: times,
      y: assetPct,
      name: `${assetLabel} % Move`,
      mode: 'lines',
      line: { color: assetColor, width: 1.8 },
      xaxis: 'x',
      yaxis: 'y1',
      hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>${assetHoverLabel}: %{y:+.2f}%<extra></extra>`
    };

    const traceVol = {
      x: times,
      y: volPt,
      name: `${volLabel} Point Move`,
      mode: 'lines',
      line: { color: volColor, width: 1.8 },
      xaxis: 'x',
      yaxis: 'y2',
      hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>${volHoverLabel}: %{y:+.2f} pts<extra></extra>`
    };

    // Subplot 2: Rolling Pearson Correlation
    const traceCorr = {
      x: times,
      y: rollingCorr,
      name: corrTraceName,
      mode: 'lines',
      line: { color: corrColor, width: 2 },
      xaxis: 'x',
      yaxis: 'y3',
      hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>${corrHoverLabel}: %{y:.3f}<extra></extra>`
    };

    const traceZero = {
      x: [dStart, dEnd],
      y: [0.0, 0.0],
      mode: 'lines',
      name: 'Decoupling Line (0.0)',
      line: { color: '#EF4444', width: 1.5, dash: 'dash' },
      xaxis: 'x',
      yaxis: 'y3',
      hoverinfo: 'none'
    };

    const traceNormal = {
      x: [dStart, dEnd],
      y: [-0.40, -0.40],
      mode: 'lines',
      name: 'Normal Inverse (-0.40)',
      line: { color: '#10B981', width: 1, dash: 'dot' },
      xaxis: 'x',
      yaxis: 'y3',
      hoverinfo: 'none'
    };

    const layout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      autosize: true,
      margin: { l: 50, r: 50, t: 25, b: 40 },
      xaxis: {
        anchor: 'y3',
        type: 'date',
        rangebreaks: rangebreaks,
        tickformat: tickformat,
        title: { text: xTitle, font: { color: '#94A3B8', size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: '#94A3B8', size: 10 },
        showgrid: true,
        nticks: 10
      },
      yaxis: {
        domain: [0.48, 1.0],
        title: { text: `${assetLabel} % Move`, font: { color: assetColor, size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: assetColor, size: 10 }
      },
      yaxis2: {
        domain: [0.48, 1.0],
        title: { text: `${volLabel} Point Move`, font: { color: volColor, size: 10 } },
        overlaying: 'y',
        side: 'right',
        gridcolor: 'transparent',
        tickfont: { color: volColor, size: 10 }
      },
      yaxis3: {
        domain: [0.0, 0.40],
        title: { text: 'Rolling ρ', font: { color: corrColor, size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: '#94A3B8', size: 10 },
        range: [-1.05, upperY]
      },
      legend: {
        orientation: 'h',
        x: 0,
        y: 1.12,
        font: { color: '#94A3B8', size: 10 }
      },
      showlegend: true
    };

    Plotly.newPlot('correlation-chart', [traceAsset, traceVol, traceCorr, traceZero, traceNormal], layout, {
      responsive: true,
      displayModeBar: false
    });
  } else {
    // Correlation Only mode (single large plot)
    const traceCorr = {
      x: times,
      y: rollingCorr,
      name: corrTraceName,
      mode: 'lines',
      line: { color: corrColor, width: 2.2 },
      hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>${corrHoverLabel}: %{y:.3f}<extra></extra>`
    };

    const traceZero = {
      x: [dStart, dEnd],
      y: [0.0, 0.0],
      mode: 'lines',
      name: 'Decoupling (0.0)',
      line: { color: '#EF4444', width: 1.5, dash: 'dash' },
      hoverinfo: 'none'
    };

    const traceNormal = {
      x: [dStart, dEnd],
      y: [-0.40, -0.40],
      mode: 'lines',
      name: 'Normal Inverse (-0.40)',
      line: { color: '#10B981', width: 1, dash: 'dot' },
      hoverinfo: 'none'
    };

    const layout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      autosize: true,
      margin: { l: 50, r: 20, t: 25, b: 40 },
      xaxis: {
        type: 'date',
        rangebreaks: rangebreaks,
        tickformat: tickformat,
        title: { text: xTitle, font: { color: '#94A3B8', size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: '#94A3B8', size: 10 },
        showgrid: true,
        nticks: 10
      },
      yaxis: {
        title: { text: `Rolling Pearson ρ(${assetLabel}, ${volLabel})`, font: { color: corrColor, size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: '#94A3B8', size: 10 },
        range: [-1.05, upperY]
      },
      legend: {
        orientation: 'h',
        x: 0,
        y: 1.1,
        font: { color: '#94A3B8', size: 10 }
      },
      showlegend: true
    };

    Plotly.newPlot('correlation-chart', [traceCorr, traceZero, traceNormal], layout, {
      responsive: true,
      displayModeBar: false
    });
  }
}

// ==============================================================================
// REAL-TIME UPDATE DISPATCHER
// ==============================================================================

function updateUI(data) {
  // If this is a live tick from WebSocket, track it
  if (!data.is_historical) {
    lastLiveUpdatePayload = data;
    // When viewing a historical session archive, maintain connection pill status but preserve historical data on charts
    if (currentViewMode === 'historical') {
      const connPill = document.getElementById('connection-pill');
      const connText = document.getElementById('connection-text');
      if (data.connection && data.connection.connected) {
        connPill.className = "flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/70 text-emerald-400 border border-emerald-800/60";
        connText.textContent = `IBKR Connected [Port ${data.connection.port}]`;
      }
      return;
    }
  }

  const mkt = data.market;
  const ov = data.overvix;
  const ts = data.term_structure;
  const mod = data.model;
  const conf = data.confluence;
  const corr = data.correlation;
  const ndx = data.ndx;
  const techVol = data.tech_vol;
  const isNdx = (currentAssetPair === 'NDX');

  // 1. Connection Pill
  const connPill = document.getElementById('connection-pill');
  const connText = document.getElementById('connection-text');
  if (data.connection && data.connection.connected) {
    connPill.className = "flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/70 text-emerald-400 border border-emerald-800/60";
    connText.textContent = `IBKR Connected [Port ${data.connection.port}]`;
  } else {
    connPill.className = "flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium bg-red-950/70 text-red-400 border border-red-800/60";
    connText.textContent = "IBKR Disconnected";
  }

  // 2. Always-On Tech Vol Premium Strip
  if (techVol) {
    const stripSpread = document.getElementById('strip-tech-spread');
    const stripRatio = document.getElementById('strip-tech-ratio');
    if (stripSpread) {
      stripSpread.textContent = `${fmtPts(techVol.spread)} pts`;
      stripSpread.className = (techVol.spread >= 6.0) ? "text-red-400 font-bold animate-pulse" : (techVol.spread >= 4.0 ? "text-amber-400 font-bold" : "text-emerald-400 font-bold");
    }
    if (stripRatio) {
      stripRatio.textContent = `(${fmtNum(techVol.ratio, 3)}x)`;
    }
  }

  // 3. Confluence Banner & Audio Alerts
  const confBanner = document.getElementById('confluence-banner');
  const confBadge = document.getElementById('confluence-badge');
  const confDesc = document.getElementById('confluence-desc');

  if (isNdx && ndx) {
    const ndxOv = ndx.overvix || { is_overvixed: false, residual_pts: 0 };
    const isTechSpreadPanic = (techVol && techVol.spread >= 6.0);
    const isDualNdx = (ndxOv.is_overvixed && ts.is_inverted);

    if (isDualNdx) {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-red-950/90 border border-red-700 beacon-alert transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-black uppercase tracking-wider bg-red-600 text-white animate-pulse";
      confBadge.textContent = "🚨 TECH CAPITULATION ALERT";
      confDesc.textContent = `Over-VXN Triggered (${fmtPts(ndxOv.residual_pts)} pts) + Inverted Term Structure (${fmtNum(ts.ratio, 4)}) — Extreme Tech Panic / Favorable Reversal`;
    } else if (ndxOv.is_overvixed) {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-purple-950/80 border border-purple-700 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-purple-600 text-white";
      confBadge.textContent = "⚠️ OVER-VXN TRIGGER";
      confDesc.textContent = `Tech Spot-Vol Shock: VXN is ${fmtPts(ndxOv.residual_pts)} pts above NDX regression trendline.`;
    } else if (isTechSpreadPanic) {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-950/80 border border-amber-700 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-amber-600 text-black";
      confBadge.textContent = "⚠️ TECH PANIC SPREAD";
      confDesc.textContent = `Elevated Tech Vol Premium: VXN - VIX spread is ${fmtPts(techVol.spread)} pts (≥ +6.0 pts panic threshold).`;
    } else if (ts.is_inverted) {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-950/80 border border-amber-700 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-amber-600 text-black";
      confBadge.textContent = "⚠️ BACKWARDATION";
      confDesc.textContent = `Macro Vol Term Structure Inverted: VIX / VIX3M (${fmtNum(ts.ratio, 4)}) ≥ 1.00.`;
    } else {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-purple-950 text-purple-300 border border-purple-800";
      confBadge.textContent = "🟢 NORMAL TECH REGIME";
      confDesc.textContent = `Normal tech spot-vol pricing (${fmtPts(ndxOv.residual_pts)} pts). Tech vol spread: ${fmtPts(techVol ? techVol.spread : 0)} pts.`;
    }

    if (isDualNdx && (!lastOvervixSignal || !lastInversionSignal)) {
      playAlertSound('dual');
    } else if (ndxOv.is_overvixed && !lastOvervixSignal) {
      playAlertSound('overvix');
    }
    lastOvervixSignal = ndxOv.is_overvixed;
    lastInversionSignal = ts.is_inverted;

  } else {
    // SPX Mode Confluence & Audio
    if (conf.is_dual_alert) {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-red-950/90 border border-red-700 beacon-alert transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-black uppercase tracking-wider bg-red-600 text-white animate-pulse";
      confBadge.textContent = "🚨 CAPITULATION ALERT";
      confDesc.textContent = `Overvix Triggered (${fmtPts(ov.residual_pts)} pts) + Inverted Term Structure (${fmtNum(ts.ratio, 4)}) — Favorable Swing Long / Mean Reversion`;
    } else if (conf.is_overvix_alert) {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-950/80 border border-amber-700 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-amber-600 text-black";
      confBadge.textContent = "⚠️ OVERVIX TRIGGER";
      confDesc.textContent = `Spot-Vol Overreaction: VIX is ${fmtPts(ov.residual_pts)} pts above regression trendline.`;
    } else if (conf.is_inversion_alert) {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-950/80 border border-amber-700 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-amber-600 text-black";
      confBadge.textContent = "⚠️ BACKWARDATION";
      confDesc.textContent = `Term Structure Inversion: VIX / VIX3M Ratio (${fmtNum(ts.ratio, 4)}) >= 1.00. Front-month acute hedging.`;
    } else if (ts.is_flattening) {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-amber-950 text-amber-300 border border-amber-800";
      confBadge.textContent = "⚠️ CURVE FLATTENING";
      confDesc.textContent = `Volatility term structure flattening towards 1.00 (${fmtNum(ts.ratio, 4)}).`;
    } else {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-800";
      confBadge.textContent = "🟢 NORMAL REGIME";
      confDesc.textContent = `Volatility term structure in contango (${fmtNum(ts.ratio, 4)}). Normal spot-vol pricing (${fmtPts(ov.residual_pts)} pts).`;
    }

    if (conf.is_dual_alert && (!lastOvervixSignal || !lastInversionSignal)) {
      playAlertSound('dual');
    } else if (ov.is_overvixed && !lastOvervixSignal) {
      playAlertSound('overvix');
    }
    lastOvervixSignal = ov.is_overvixed;
    lastInversionSignal = ts.is_inverted;
  }

  // 4. KPI Cards
  const cardOvervix = document.getElementById('card-overvix-residual');
  const overvixStatusBadge = document.getElementById('kpi-overvix-status');
  const residualEl = document.getElementById('kpi-residual-pts');
  const spxPctEl = document.getElementById('kpi-spx-pct');
  const vixPtEl = document.getElementById('kpi-vix-pt');
  const ratioBadge = document.getElementById('kpi-ratio-badge');

  if (isNdx && ndx) {
    const ndxMkt = ndx.market || { current: 0, pct_change: 0, vxn: { current: 0, pt_change: 0 } };
    const ndxOv = ndx.overvix || { expected_vol_pt: 0, residual_pts: 0, is_overvixed: false };
    const ndxMod = ndx.model || mod;

    document.getElementById('lbl-kpi-asset').textContent = "NASDAQ 100";
    document.getElementById('kpi-spx-price').textContent = fmtNum(ndxMkt.current);
    spxPctEl.textContent = fmtPct(ndxMkt.pct_change);
    spxPctEl.className = `text-xs font-mono font-medium mt-0.5 ${ndxMkt.pct_change >= 0 ? 'text-emerald-400' : 'text-red-400'}`;

    document.getElementById('lbl-kpi-vol').textContent = "VXN (30-Day)";
    document.getElementById('kpi-vix-price').textContent = fmtNum(ndxMkt.vxn ? ndxMkt.vxn.current : 0);
    const vxnPt = ndxMkt.vxn ? ndxMkt.vxn.pt_change : 0;
    vixPtEl.textContent = `${fmtPts(vxnPt)} pts`;
    vixPtEl.className = `text-xs font-mono font-medium mt-0.5 ${vxnPt >= 0 ? 'text-red-400' : 'text-emerald-400'}`;

    document.getElementById('lbl-kpi-sec-vol').textContent = "Tech Spread (VXN-VIX)";
    document.getElementById('tag-kpi-sec-vol').textContent = "Spread";
    const spreadVal = techVol ? techVol.spread : 0;
    const spreadChg = techVol && techVol.change_pts !== undefined ? techVol.change_pts : 0;
    document.getElementById('kpi-vix3m-price').textContent = `${fmtPts(spreadVal)} pts`;
    const vix3mPtEl = document.getElementById('kpi-vix3m-pt');
    vix3mPtEl.textContent = `${fmtPts(spreadChg)} pts`;
    vix3mPtEl.className = `text-xs font-mono font-medium mt-0.5 ${spreadVal >= 6.0 ? 'text-red-400' : (spreadVal >= 4.0 ? 'text-amber-400' : 'text-emerald-400')}`;

    document.getElementById('lbl-kpi-ratio').textContent = "VXN / VIX";
    const techRatioVal = techVol ? techVol.ratio : 1.0;
    document.getElementById('kpi-ratio-val').textContent = fmtNum(techRatioVal, 4);
    document.getElementById('lbl-kpi-ratio-sub').textContent = "Equilibrium ~ 1.15x";
    if (spreadVal >= 6.0) {
      ratioBadge.textContent = 'TECH PANIC';
      ratioBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-red-900/80 text-red-200 uppercase font-semibold border border-red-700';
    } else if (spreadVal >= 4.0) {
      ratioBadge.textContent = 'ELEVATED';
      ratioBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-amber-900/80 text-amber-200 uppercase font-semibold border border-amber-700';
    } else {
      ratioBadge.textContent = 'NORMAL SPREAD';
      ratioBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 uppercase font-semibold border border-emerald-800';
    }

    document.getElementById('lbl-kpi-expected').textContent = "Expected ΔVXN";
    document.getElementById('kpi-expected-vix').textContent = `${fmtPts(ndxOv.expected_vol_pt)} pts`;
    document.getElementById('lbl-kpi-exp-sub').textContent = "Tech Beta Model";

    document.getElementById('lbl-kpi-residual').textContent = "Over-VXN Residual";
    residualEl.textContent = `${fmtPts(ndxOv.residual_pts)} pts`;
    if (ndxOv.is_overvixed) {
      residualEl.className = 'text-xl font-bold font-mono tracking-tight text-red-500 animate-pulse';
      overvixStatusBadge.textContent = '🚨 OVER-VXN';
      overvixStatusBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-red-950 text-red-300 border border-red-700 font-bold uppercase';
      cardOvervix.className = 'bg-red-950/30 border border-red-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm';
    } else {
      residualEl.className = 'text-xl font-bold font-mono tracking-tight text-purple-400';
      overvixStatusBadge.textContent = 'NORMAL';
      overvixStatusBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold uppercase';
      cardOvervix.className = 'bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm';
    }

    // Model Parameters Strip (NDX)
    document.getElementById('param-window').textContent = ndxMod.window_days;
    document.getElementById('param-r2').textContent = fmtNum(ndxMod.r_squared, 4);
    document.getElementById('param-slope').textContent = fmtNum(ndxMod.slope, 4);
    document.getElementById('param-volslope').textContent = fmtNum(ndxMod.vol_slope, 4);
    document.getElementById('param-intercept').textContent = fmtNum(ndxMod.intercept, 4);

  } else {
    // SPX Mode
    document.getElementById('lbl-kpi-asset').textContent = "SPX 500";
    document.getElementById('kpi-spx-price').textContent = fmtNum(mkt.spx.current);
    spxPctEl.textContent = fmtPct(mkt.spx.pct_change);
    spxPctEl.className = `text-xs font-mono font-medium mt-0.5 ${mkt.spx.pct_change >= 0 ? 'text-emerald-400' : 'text-red-400'}`;

    document.getElementById('lbl-kpi-vol').textContent = "VIX (30-Day)";
    document.getElementById('kpi-vix-price').textContent = fmtNum(mkt.vix.current);
    vixPtEl.textContent = `${fmtPts(mkt.vix.pt_change)} pts`;
    vixPtEl.className = `text-xs font-mono font-medium mt-0.5 ${mkt.vix.pt_change >= 0 ? 'text-red-400' : 'text-emerald-400'}`;

    document.getElementById('lbl-kpi-sec-vol').textContent = "VIX3M (90-Day)";
    document.getElementById('tag-kpi-sec-vol').textContent = "3M";
    document.getElementById('kpi-vix3m-price').textContent = fmtNum(mkt.vix3m.current);
    const vix3mPtEl = document.getElementById('kpi-vix3m-pt');
    vix3mPtEl.textContent = `${fmtPts(mkt.vix3m.pt_change)} pts`;
    vix3mPtEl.className = 'text-xs font-mono font-medium text-slate-400 mt-0.5';

    document.getElementById('lbl-kpi-ratio').textContent = "VIX / VIX3M";
    document.getElementById('kpi-ratio-val').textContent = fmtNum(ts.ratio, 4);
    document.getElementById('lbl-kpi-ratio-sub').textContent = "Inversion @ ≥ 1.00";
    if (ts.ratio >= 1.0) {
      ratioBadge.textContent = 'BACKWARDATION';
      ratioBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-red-900/80 text-red-200 uppercase font-semibold border border-red-700';
    } else if (ts.ratio >= 0.90) {
      ratioBadge.textContent = 'FLATTENING';
      ratioBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-amber-900/80 text-amber-200 uppercase font-semibold border border-amber-700';
    } else {
      ratioBadge.textContent = 'CONTANGO';
      ratioBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 uppercase font-semibold border border-emerald-800';
    }

    document.getElementById('lbl-kpi-expected').textContent = "Expected ΔVIX";
    document.getElementById('kpi-expected-vix').textContent = `${fmtPts(ov.expected_vix_pt)} pts`;
    document.getElementById('lbl-kpi-exp-sub').textContent = "Spot-Vol Model";

    document.getElementById('lbl-kpi-residual').textContent = "Overvix Residual";
    residualEl.textContent = `${fmtPts(ov.residual_pts)} pts`;
    if (ov.is_overvixed) {
      residualEl.className = 'text-xl font-bold font-mono tracking-tight text-red-500 animate-pulse';
      overvixStatusBadge.textContent = '🚨 OVERVIXED';
      overvixStatusBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-red-950 text-red-300 border border-red-700 font-bold uppercase';
      cardOvervix.className = 'bg-red-950/30 border border-red-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm';
    } else {
      residualEl.className = 'text-xl font-bold font-mono tracking-tight text-cyan-400';
      overvixStatusBadge.textContent = 'NORMAL';
      overvixStatusBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold uppercase';
      cardOvervix.className = 'bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm';
    }

    // Model Parameters Strip (SPX)
    document.getElementById('param-window').textContent = mod.window_days;
    document.getElementById('param-r2').textContent = fmtNum(mod.r_squared, 4);
    document.getElementById('param-slope').textContent = fmtNum(mod.slope, 4);
    document.getElementById('param-volslope').textContent = fmtNum(mod.vol_slope, 4);
    document.getElementById('param-intercept').textContent = fmtNum(mod.intercept, 4);
  }

  // Intraday Session Stats for middle chart (Term Structure or Tech Vol)
  if (isNdx) {
    const dTech = cachedTechVol['1D'];
    const spreads = (dTech && dTech.spread && dTech.spread.length > 0) ? dTech.spread : [];
    const minSpread = spreads.length > 0 ? Math.min(...spreads) : ((techVol && techVol.intraday) ? techVol.intraday.low : 0);
    const maxSpread = spreads.length > 0 ? Math.max(...spreads) : ((techVol && techVol.intraday) ? techVol.intraday.high : 0);
    
    document.getElementById('ts-day-low').textContent = fmtPts(minSpread);
    document.getElementById('ts-day-high').textContent = fmtPts(maxSpread);
    const deltaEl = document.getElementById('ts-day-delta');
    const deltaPctEl = document.getElementById('ts-day-deltapct');
    const spreadChg = (techVol && techVol.change_pts !== undefined) ? techVol.change_pts : (spreads.length > 1 ? spreads[spreads.length - 1] - spreads[0] : 0);
    deltaEl.textContent = `${fmtPts(spreadChg)} pts`;
    deltaPctEl.textContent = (spreads.length > 0 && spreads[0] !== 0) ? fmtPct((spreadChg / Math.abs(spreads[0])) * 100) : '';
    if (spreadChg >= 0) {
      deltaEl.className = "font-mono text-red-400";
      deltaPctEl.className = "font-mono text-red-400";
    } else {
      deltaEl.className = "font-mono text-emerald-400";
      deltaPctEl.className = "font-mono text-emerald-400";
    }
  } else if (ts && ts.intraday) {
    document.getElementById('ts-day-low').textContent = fmtNum(ts.intraday.low, 4);
    document.getElementById('ts-day-high').textContent = fmtNum(ts.intraday.high, 4);
    const deltaEl = document.getElementById('ts-day-delta');
    const deltaPctEl = document.getElementById('ts-day-deltapct');
    deltaEl.textContent = fmtPts(ts.intraday.change_pts);
    deltaPctEl.textContent = fmtPct(ts.intraday.change_pct);
    if (ts.intraday.change_pts >= 0) {
      deltaEl.className = "font-mono text-red-400";
      deltaPctEl.className = "font-mono text-red-400";
    } else {
      deltaEl.className = "font-mono text-emerald-400";
      deltaPctEl.className = "font-mono text-emerald-400";
    }
  }

  // Correlation Strip
  if (corr && cachedCorr.metrics) {
    cachedCorr.metrics['1D'] = corr.rolling_corr;
    if (corr.corr_5d !== undefined) cachedCorr.metrics['5D'] = corr.corr_5d;
    if (corr.corr_1y !== undefined) cachedCorr.metrics['1Y'] = corr.corr_1y;
  }
  if (ndx && ndx.correlation && cachedCorrNdx.metrics) {
    cachedCorrNdx.metrics['1D'] = ndx.correlation.rolling_corr;
    if (ndx.correlation.corr_5d !== undefined) cachedCorrNdx.metrics['5D'] = ndx.correlation.corr_5d;
    if (ndx.correlation.corr_1y !== undefined) cachedCorrNdx.metrics['1Y'] = ndx.correlation.corr_1y;
  }
  updateCorrMetricDisplay();

  const activeCorrObj = (isNdx && ndx && ndx.correlation) ? ndx.correlation : corr;
  if (activeCorrObj) {
    const corrVal = (currentCorrTf === '1D') ? activeCorrObj.rolling_corr : ((currentCorrTf === '5D') ? (activeCorrObj.corr_5d || activeCorrObj.rolling_corr) : (activeCorrObj.corr_1y || activeCorrObj.rolling_corr));
    const corrPill = document.getElementById('corr-status-pill');
    if (corrPill) {
      if (corrVal < -0.40) {
        corrPill.textContent = `Normal Inverse (ρ = ${fmtNum(corrVal, 3)})`;
        corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800";
      } else if (corrVal < 0.0) {
        corrPill.textContent = `Weakening (ρ = ${fmtNum(corrVal, 3)})`;
        corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800";
      } else {
        corrPill.textContent = `Positive Decoupling (ρ = ${fmtNum(corrVal, 3)})`;
        corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-red-950 text-red-400 border border-red-800 animate-pulse";
      }
    }
  }

  // Time & Tags
  const now = new Date();
  if (data.is_historical) {
    document.getElementById('last-update-time').textContent = `Session: ${data.session_date}`;
  } else if (data.premarket && data.premarket.is_premarket) {
    const gthVix = (data.premarket.gth_vix !== undefined) ? ` | GTH VIX: ${data.premarket.gth_vix}` : '';
    document.getElementById('last-update-time').textContent = `Pre-Market (RTH 09:30 ET)${gthVix}`;
  } else if (data.is_rth_active === false) {
    document.getElementById('last-update-time').textContent = `Market Closed (${data.session_date || 'Prior Close'})`;
  } else {
    document.getElementById('last-update-time').textContent = `Updated: ${now.toLocaleTimeString()}`;
  }

  // Header Mode Badge
  const headerModeBadge = document.getElementById('header-mode-badge');
  if (headerModeBadge && currentViewMode === 'live') {
    if (data.is_rth_active) {
      headerModeBadge.textContent = "IBKR Live";
      headerModeBadge.className = "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 font-semibold";
    } else if (data.premarket && data.premarket.is_premarket) {
      headerModeBadge.textContent = `PRE-MARKET (${data.session_date || 'Prior'})`;
      headerModeBadge.className = "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 font-semibold";
    } else {
      headerModeBadge.textContent = `CLOSED (${data.session_date || 'Prior'})`;
      headerModeBadge.className = "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-700/60 font-semibold";
    }
  }

  document.getElementById('chart-ratio-tag').textContent = isNdx && techVol ? `Spread: ${fmtPts(techVol.spread)} pts` : `Ratio: ${fmtNum(ts.ratio, 4)}`;

  // If this is a historical replay dataset, charts were already fully plotted by render functions
  if (data.is_historical) {
    return;
  }

  // Real-Time Plotly Chart Updates
  // 5. Update Overvix / Over-VXN Plotly Chart Real-Time
  const activePt = (isNdx && ndx && ndx.current_point) ? ndx.current_point : data.current_point;
  const isTargetOvervixed = (isNdx && ndx && ndx.overvix) ? ndx.overvix.is_overvixed : ov.is_overvixed;
  if (activePt) {
    const isLiveRth = (data.is_rth_active === true);
    const pointLabel = isLiveRth ? "Live Point" : "Session Close Point";
    Plotly.restyle('overvix-chart', {
      x: [[activePt.x]],
      y: [[activePt.y]],
      name: [pointLabel],
      'marker.color': [isTargetOvervixed ? '#FF1744' : (isNdx ? '#C084FC' : '#00E5FF')]
    }, [5]);
  }

  // 6. Update Intraday Term Structure / Tech Vol Real-Time (when 1D is active)
  if (currentTimeframe === '1D') {
    const liveDt = data.datetime || (new Date().toISOString().slice(0, 10) + ' ' + now.toTimeString().slice(0, 5));
    const liveDate = liveDt.slice(0, 10);

    if (isNdx && techVol) {
      const dt = cachedTechVol['1D'];
      if (dt && dt.times && dt.times.length > 0) {
        const lastT = dt.times[dt.times.length - 1];
        const lastDate = lastT.slice(0, 10);
        if (liveDate === lastDate) {
          const vxnVal = (ndx && ndx.market && ndx.market.vxn) ? ndx.market.vxn.current : 0;
          if (lastT === liveDt || lastT.slice(11, 16) === liveDt.slice(11, 16)) {
            dt.vxn[dt.vxn.length - 1] = vxnVal;
            dt.vix[dt.vix.length - 1] = mkt.vix.current;
            dt.spread[dt.spread.length - 1] = techVol.spread;
            dt.ratio[dt.ratio.length - 1] = techVol.ratio;
          } else {
            dt.times.push(liveDt);
            dt.vxn.push(vxnVal);
            dt.vix.push(mkt.vix.current);
            dt.spread.push(techVol.spread);
            dt.ratio.push(techVol.ratio);
          }
          Plotly.restyle('term-structure-chart', {
            x: [dt.times, dt.times, dt.times],
            y: [dt.vxn, dt.vix, dt.spread]
          }, [0, 1, 2]);
          Plotly.restyle('term-structure-chart', {
            x: [[liveDt]],
            y: [[techVol.spread]],
            'marker.color': [(techVol.spread >= 6.0) ? '#EF4444' : '#F59E0B']
          }, [5]);
        }
      }
    } else {
      const d1 = cachedTs['1D'];
      if (d1 && d1.times && d1.times.length > 0) {
        const lastT = d1.times[d1.times.length - 1];
        const lastDate = lastT.slice(0, 10);
        if (liveDate === lastDate) {
          if (lastT === liveDt || lastT.slice(11, 16) === liveDt.slice(11, 16)) {
            d1.vix[d1.vix.length - 1] = mkt.vix.current;
            d1.vix3m[d1.vix3m.length - 1] = mkt.vix3m.current;
            d1.ratio[d1.ratio.length - 1] = ts.ratio;
          } else {
            d1.times.push(liveDt);
            d1.vix.push(mkt.vix.current);
            d1.vix3m.push(mkt.vix3m.current);
            d1.ratio.push(ts.ratio);
          }
          Plotly.restyle('term-structure-chart', {
            x: [d1.times, d1.times, d1.times],
            y: [d1.vix, d1.vix3m, d1.ratio]
          }, [0, 1, 2]);
          Plotly.restyle('term-structure-chart', {
            x: [[liveDt]],
            y: [[ts.ratio]],
            'marker.color': [ts.is_inverted ? '#EF4444' : '#00E5FF']
          }, [5]);
        }
      }
    }
  }

  // 7. Update Intraday Correlation Real-Time (when 1D is active)
  if (currentCorrTf === '1D') {
    const liveDt = data.datetime || (new Date().toISOString().slice(0, 10) + ' ' + now.toTimeString().slice(0, 5));
    const liveDate = liveDt.slice(0, 10);

    if (isNdx && ndx) {
      const cr = cachedCorrNdx['1D'];
      if (cr && cr.times && cr.times.length > 0) {
        const lastT = cr.times[cr.times.length - 1];
        const lastDate = lastT.slice(0, 10);
        if (liveDate === lastDate) {
          const ndxPct = ndx.market ? ndx.market.pct_change : 0;
          const vxnPt = (ndx.market && ndx.market.vxn) ? ndx.market.vxn.pt_change : 0;
          const corrVal = ndx.correlation ? ndx.correlation.rolling_corr : -0.75;

          const pctArr = cr.ndx_pct || cr.spx_pct;
          const ptArr = cr.vxn_pt || cr.vix_pt;

          if (lastT === liveDt || lastT.slice(11, 16) === liveDt.slice(11, 16)) {
            pctArr[pctArr.length - 1] = ndxPct;
            ptArr[ptArr.length - 1] = vxnPt;
            cr.rolling_corr[cr.rolling_corr.length - 1] = corrVal;
          } else {
            cr.times.push(liveDt);
            pctArr.push(ndxPct);
            ptArr.push(vxnPt);
            cr.rolling_corr.push(corrVal);
          }

          if (currentCorrMode === 'dual') {
            Plotly.restyle('correlation-chart', {
              x: [cr.times, cr.times, cr.times],
              y: [pctArr, ptArr, cr.rolling_corr]
            }, [0, 1, 2]);
          } else {
            Plotly.restyle('correlation-chart', {
              x: [cr.times],
              y: [cr.rolling_corr]
            }, [0]);
          }
        }
      }
    } else {
      const cr = cachedCorr['1D'];
      if (cr && cr.times && cr.times.length > 0) {
        const lastT = cr.times[cr.times.length - 1];
        const lastDate = lastT.slice(0, 10);
        if (liveDate === lastDate) {
          if (lastT === liveDt || lastT.slice(11, 16) === liveDt.slice(11, 16)) {
            cr.spx_pct[cr.spx_pct.length - 1] = mkt.spx.pct_change;
            cr.vix_pt[cr.vix_pt.length - 1] = mkt.vix.pt_change;
            if (corr) cr.rolling_corr[cr.rolling_corr.length - 1] = corr.rolling_corr;
          } else {
            cr.times.push(liveDt);
            cr.spx_pct.push(mkt.spx.pct_change);
            cr.vix_pt.push(mkt.vix.pt_change);
            if (corr) cr.rolling_corr.push(corr.rolling_corr);
          }

          if (currentCorrMode === 'dual') {
            Plotly.restyle('correlation-chart', {
              x: [cr.times, cr.times, cr.times],
              y: [cr.spx_pct, cr.vix_pt, cr.rolling_corr]
            }, [0, 1, 2]);
          } else {
            Plotly.restyle('correlation-chart', {
              x: [cr.times],
              y: [cr.rolling_corr]
            }, [0]);
          }
        }
      }
    }
  }
}

// ==============================================================================
// DATA BOOTSTRAP & WEBSOCKET CONNECTION
// ==============================================================================

async function bootstrapData() {
  try {
    const res = await fetch('/api/bootstrap');
    if (!res.ok) throw new Error("Bootstrap endpoint failed");
    const data = await res.json();
    cachedBootstrap = data;

    currentThreshold = data.model.threshold_pts;
    document.getElementById('disp-thresh-pts').textContent = currentThreshold.toFixed(1);
    document.getElementById('input-threshold').value = currentThreshold;
    document.getElementById('input-window').value = data.model.window_days;

    // Cache SPX Term Structure datasets
    if (data.term_structure.intraday_1d) {
      cachedTs['1D'] = data.term_structure.intraday_1d;
    }
    if (data.term_structure.intraday_5d) {
      cachedTs['5D'] = data.term_structure.intraday_5d;
    }
    if (data.term_structure.history_1y) {
      cachedTs['1Y'] = {
        times: data.term_structure.history_1y.dates,
        vix: data.term_structure.history_1y.vix,
        vix3m: data.term_structure.history_1y.vix3m,
        ratio: data.term_structure.history_1y.ratio
      };
    }

    // Cache SPX Dynamic Correlation datasets
    if (data.intraday_correlation) {
      if (data.intraday_correlation['1D']) {
        cachedCorr['1D'] = data.intraday_correlation['1D'];
        cachedCorr['5D'] = data.intraday_correlation['5D'] || { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] };
        cachedCorr['1Y'] = data.intraday_correlation['1Y'] || { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] };
        cachedCorr.metrics = data.intraday_correlation.metrics || {};
      } else {
        cachedCorr['1D'] = data.intraday_correlation;
        cachedCorr['5D'] = { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] };
        cachedCorr['1Y'] = { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] };
      }
    }

    // Cache Tech Vol Premium datasets (Spread & Ratio across 1D, 5D, 1Y)
    if (data.tech_vol) {
      if (data.tech_vol.intraday_1d) cachedTechVol['1D'] = data.tech_vol.intraday_1d;
      if (data.tech_vol.intraday_5d) cachedTechVol['5D'] = data.tech_vol.intraday_5d;
      if (data.tech_vol.history_1y) cachedTechVol['1Y'] = data.tech_vol.history_1y;
    }

    // Cache NDX / VXN Dynamic Correlation datasets
    if (data.ndx && data.ndx.correlation) {
      if (data.ndx.correlation['1D']) {
        cachedCorrNdx['1D'] = data.ndx.correlation['1D'];
        cachedCorrNdx['5D'] = data.ndx.correlation['5D'] || { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] };
        cachedCorrNdx['1Y'] = data.ndx.correlation['1Y'] || { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] };
        cachedCorrNdx.metrics = data.ndx.correlation.metrics || {};
      }
    }

    renderOvervixChart(data);
    renderTermStructureChart(currentTimeframe);
    renderCorrelationChart(currentCorrMode, currentCorrTf);
    updateCorrMetricDisplay();
    updateUI(data);

    connectWebSocket();
  } catch (err) {
    console.error("Bootstrap error:", err);
    setTimeout(bootstrapData, 3000);
  }
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/live`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[WebSocket] Connected to live IBKR market stream.");
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      updateUI(payload);
    } catch (e) {
      console.error("[WebSocket] Failed to parse message:", e);
    }
  };

  ws.onclose = () => {
    console.warn("[WebSocket] Connection lost. Reconnecting in 2 seconds...");
    document.getElementById('connection-text').textContent = "Reconnecting...";
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (err) => {
    console.error("[WebSocket] Error:", err);
    ws.close();
  };
}

// ==============================================================================
// HISTORICAL INTRADAY SESSION REPLAY ENGINE
// ==============================================================================

async function refreshNotableDates(selectedDateToFocus = null) {
  const inputDate = document.getElementById('input-session-date');
  const selectNotable = document.getElementById('select-notable-date');
  if (!selectNotable) return;

  try {
    const res = await fetch('/api/available-dates');
    if (res.ok) {
      const data = await res.json();
      if (inputDate) {
        if (data.min_date) inputDate.min = data.min_date;
        if (data.max_date) inputDate.max = data.max_date;
      }

      selectNotable.innerHTML = '<option value="">Historical Sessions...</option>';
      if (data.notable && data.notable.length > 0) {
        data.notable.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.date;
          opt.textContent = p.label;
          if (selectedDateToFocus && p.date === selectedDateToFocus) {
            opt.selected = true;
          }
          selectNotable.appendChild(opt);
        });
      }

      if (data.cached && data.cached.length > 0) {
        const group = document.createElement('optgroup');
        group.label = '⚡ Cached on Disk';
        data.cached.forEach(d => {
          if (!data.notable || !data.notable.some(p => p.date === d)) {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = `${d} (Cached)`;
            group.appendChild(opt);
          }
        });
        if (group.children.length > 0) selectNotable.appendChild(group);
      }
    }
  } catch (e) {
    console.warn("Failed refreshing notable dates:", e);
  }
}

async function bookmarkCurrentDate() {
  const inputDate = document.getElementById('input-session-date');
  const d = selectedHistoricalDate || (inputDate ? inputDate.value : null);
  if (!d || d.length !== 10) {
    alert("Please select or load a valid date first (YYYY-MM-DD).");
    return;
  }

  const defaultLabel = `${d} (Custom Regime)`;
  const label = prompt(`Enter a descriptive label for preset ${d}:`, defaultLabel);
  if (!label || !label.trim()) return;

  try {
    const res = await fetch('/api/notable-dates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: d, label: label.trim() })
    });
    if (res.ok) {
      await refreshNotableDates(d);
      alert(`Saved "${label.trim()}" to notable presets!`);
    } else {
      const err = await res.json();
      alert(`Failed saving preset: ${err.detail || 'Unknown error'}`);
    }
  } catch (e) {
    alert(`Error saving preset: ${e.message}`);
  }
}

async function initHistoricalControls() {
  const btnLive = document.getElementById('btn-mode-live');
  const btnReturnLive = document.getElementById('btn-return-live');
  const btnBannerReturnLive = document.getElementById('btn-banner-return-live');
  const btnBookmark = document.getElementById('btn-bookmark-date');
  const btnBannerBookmark = document.getElementById('btn-banner-bookmark');
  const inputDate = document.getElementById('input-session-date');
  const selectNotable = document.getElementById('select-notable-date');

  // Populate notable presets from API
  await refreshNotableDates();

  // Event handlers
  if (btnLive) btnLive.addEventListener('click', returnToLiveMode);
  if (btnReturnLive) btnReturnLive.addEventListener('click', returnToLiveMode);
  if (btnBannerReturnLive) btnBannerReturnLive.addEventListener('click', returnToLiveMode);
  if (btnBookmark) btnBookmark.addEventListener('click', bookmarkCurrentDate);
  if (btnBannerBookmark) btnBannerBookmark.addEventListener('click', bookmarkCurrentDate);

  const btnLoadDate = document.getElementById('btn-load-date');
  if (btnLoadDate) {
    btnLoadDate.addEventListener('click', () => {
      const d = inputDate ? inputDate.value : null;
      if (d) loadHistoricalSession(d);
      else alert("Please select or enter a date (YYYY-MM-DD).");
    });
  }

  if (inputDate) {
    const handleDate = (e) => {
      const d = e.target.value;
      if (d && d.length === 10) loadHistoricalSession(d);
    };
    inputDate.addEventListener('change', handleDate);
    inputDate.addEventListener('input', handleDate);
  }

  if (selectNotable) {
    selectNotable.addEventListener('change', (e) => {
      const d = e.target.value;
      if (d) {
        if (inputDate) inputDate.value = d;
        loadHistoricalSession(d);
      }
    });
  }
}

async function loadHistoricalSession(dateStr) {
  if (!dateStr) return;

  const banner = document.getElementById('historical-archive-banner');
  const bannerText = document.getElementById('historical-banner-text');
  const cacheTag = document.getElementById('historical-cache-tag');
  const btnLive = document.getElementById('btn-mode-live');
  const btnReturnLive = document.getElementById('btn-return-live');
  const headerModeBadge = document.getElementById('header-mode-badge');

  // Save current live state snapshot before switching
  if (currentViewMode === 'live' && cachedBootstrap) {
    cachedLiveBootstrap = JSON.parse(JSON.stringify(cachedBootstrap));
    cachedLiveTs = JSON.parse(JSON.stringify(cachedTs));
    cachedLiveCorr = JSON.parse(JSON.stringify(cachedCorr));
    cachedLiveTechVol = JSON.parse(JSON.stringify(cachedTechVol));
    cachedLiveCorrNdx = JSON.parse(JSON.stringify(cachedCorrNdx));
  }

  banner.classList.remove('hidden');
  bannerText.textContent = `Loading ${dateStr} from IBKR / disk cache...`;
  cacheTag.textContent = '⏳ FETCHING BARS';
  cacheTag.className = 'text-[10px] text-amber-400 font-mono px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-800/40 animate-pulse';

  try {
    const res = await fetch(`/api/session?date=${dateStr}`);
    if (!res.ok) {
      const err = await res.json();
      alert(`Could not load session for ${dateStr}: ${err.detail || 'Market may have been closed or holiday.'}`);
      if (currentViewMode === 'live') {
        banner.classList.add('hidden');
      }
      return;
    }

    const data = await res.json();
    currentViewMode = 'historical';
    selectedHistoricalDate = dateStr;
    cachedHistoricalData = data;
    cachedBootstrap = data;

    // Update banner & controls
    bannerText.textContent = `Viewing Historical Session: ${dateStr} (${data.session_bars} 1-min bars)`;
    cacheTag.textContent = '⚡ ARCHIVE LOADED';
    cacheTag.className = 'text-[10px] text-emerald-400 font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/40';

    btnLive.className = "px-2.5 py-1 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center space-x-1.5 cursor-pointer";
    btnReturnLive.classList.remove('hidden');

    if (headerModeBadge) {
      headerModeBadge.textContent = `ARCHIVE: ${dateStr}`;
      headerModeBadge.className = "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 font-semibold";
    }

    // Cache intraday series for the charts
    if (data.term_structure && data.term_structure.intraday_1d) {
      cachedTs['1D'] = data.term_structure.intraday_1d;
    }
    if (data.intraday_correlation && data.intraday_correlation['1D']) {
      cachedCorr['1D'] = data.intraday_correlation['1D'];
      cachedCorr.metrics['1D'] = data.intraday_correlation.metrics ? data.intraday_correlation.metrics['1D'] : -0.75;
    }
    if (data.tech_vol && data.tech_vol.intraday_1d) {
      cachedTechVol['1D'] = data.tech_vol.intraday_1d;
    }
    if (data.ndx && data.ndx.intraday_correlation && data.ndx.intraday_correlation['1D']) {
      cachedCorrNdx['1D'] = data.ndx.intraday_correlation['1D'];
      cachedCorrNdx.metrics['1D'] = data.ndx.correlation ? data.ndx.correlation.rolling_corr : -0.75;
    }

    // Force timeframe to 1D to inspect that day's intraday bars
    currentTimeframe = '1D';
    currentCorrTf = '1D';

    if (tsLivePill) {
      tsLivePill.textContent = `${dateStr} 1m`;
      tsLivePill.className = "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60";
    }
    if (corrTfPill) {
      corrTfPill.textContent = `${dateStr} 1M`;
      corrTfPill.className = "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60";
    }

    // Render charts
    renderOvervixChart(data);
    renderTermStructureChart('1D');
    renderCorrelationChart(currentCorrMode, '1D');
    updateCorrMetricDisplay();
    updateUI(data);

  } catch (e) {
    console.error("Historical session fetch error:", e);
    alert(`Error loading historical session for ${dateStr}: ${e.message}`);
    if (currentViewMode === 'live') banner.classList.add('hidden');
  }
}

function returnToLiveMode() {
  if (currentViewMode === 'live') return;

  currentViewMode = 'live';
  selectedHistoricalDate = null;
  cachedHistoricalData = null;

  const banner = document.getElementById('historical-archive-banner');
  const btnLive = document.getElementById('btn-mode-live');
  const btnReturnLive = document.getElementById('btn-return-live');
  const headerModeBadge = document.getElementById('header-mode-badge');
  const inputDate = document.getElementById('input-session-date');
  const selectNotable = document.getElementById('select-notable-date');

  banner.classList.add('hidden');
  btnLive.className = "px-2.5 py-1 rounded text-xs font-semibold bg-emerald-500 text-black shadow-sm transition flex items-center space-x-1.5";
  btnReturnLive.classList.add('hidden');

  if (headerModeBadge) {
    if (cachedBootstrap && cachedBootstrap.is_rth_active) {
      headerModeBadge.textContent = "IBKR Live";
      headerModeBadge.className = "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 font-semibold";
    } else if (cachedBootstrap && cachedBootstrap.premarket && cachedBootstrap.premarket.is_premarket) {
      headerModeBadge.textContent = `PRE-MARKET (${cachedBootstrap.session_date || 'Prior'})`;
      headerModeBadge.className = "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 font-semibold";
    } else {
      headerModeBadge.textContent = `CLOSED (${cachedBootstrap ? cachedBootstrap.session_date : 'Prior'})`;
      headerModeBadge.className = "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-700/60 font-semibold";
    }
  }

  if (inputDate) inputDate.value = '';
  if (selectNotable) selectNotable.value = '';

  if (tsLivePill) {
    tsLivePill.textContent = (currentTimeframe === '1D') ? "Intraday 1m" : ((currentTimeframe === '5D') ? "Recent 15m" : "Daily Close");
    tsLivePill.className = (currentTimeframe === '1D') ? "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60" : "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/60";
  }
  if (corrTfPill) {
    corrTfPill.textContent = (currentCorrTf === '1D') ? "Intraday 1M" : ((currentCorrTf === '5D') ? "Recent 15M" : "Daily Macro");
    corrTfPill.className = (currentCorrTf === '1D') ? "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60" : "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/60";
  }

  // Restore live datasets
  if (cachedLiveBootstrap) {
    cachedBootstrap = cachedLiveBootstrap;
    cachedTs = cachedLiveTs;
    cachedCorr = cachedLiveCorr;
    if (cachedLiveTechVol) cachedTechVol = cachedLiveTechVol;
    if (cachedLiveCorrNdx) cachedCorrNdx = cachedLiveCorrNdx;

    renderOvervixChart(cachedBootstrap);
    renderTermStructureChart(currentTimeframe);
    renderCorrelationChart(currentCorrMode, currentCorrTf);
    updateCorrMetricDisplay();
  }

  if (lastLiveUpdatePayload) {
    updateUI(lastLiveUpdatePayload);
  }
}

// Start Dashboard on load
window.addEventListener('DOMContentLoaded', () => {
  setupTimeframeButtons();
  setupTrailButtons();
  setupCorrButtons();
  setupAssetSwitcher();
  initHistoricalControls();
  bootstrapData();
});
