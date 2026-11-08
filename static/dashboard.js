/**
 * Overvix & Volatility Term Structure — Real-Time WebSocket Client & Plotly Visualizer
 */

// Global State
let soundEnabled = false; // Muted by default
let lastOvervixSignal = false;
let lastInversionSignal = false;
let audioCtx = null;
let currentSpxThreshold = 2.0;
let currentNdxThreshold = 2.5;
let currentThreshold = 2.0;
let currentTimeframe = '1D'; // '1D', '5D', '1Y'
let currentTrailMode = 'both'; // 'both', 'today', '60d'
let currentCorrMode = 'dual'; // 'dual', 'corr_only'
let isVolInverted = true; // Invert volatility axis on correlation overlay for lockstep tracking
let isBetaScaled = true;  // Beta-locked scale mode (1% Spot = |Slope| pts Vol)
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
let cachedActiveSessionDate = null;
let cachedIsRthActive = null;
let cachedHistVersion = 0;
let activeSocket = null;

// Multi-Timeframe Configuration Suite across 8 stepped horizons
const TF_STEPS = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', 'MAX'];

const TF_CONFIG = {
  '1D': {
    step: 0,
    label: '1D',
    badgeText: '1D &bull; Intraday (1m)',
    pillText: 'Intraday 1m',
    pillClass: 'bg-amber-950/80 text-amber-300 border-amber-800/60',
    granularity: '1m',
    tsSub: '30-Day vs. 90-Day Volatility Ratio & Inversion Monitor (1-min bars)',
    corrSub: 'Minute-by-Minute Normalized Overlay (Upper) & Rolling 30-Minute Pearson Correlation ρ(Δln S, Δln Vol) (Lower)',
    corrTraceName: 'Rolling 30m Correlation (ρ)',
    corrHoverLabel: 'Rolling 30m ρ',
    liveLabel: 'Current 30m ρ:',
    xTitle: 'Today Intraday Time (US/Eastern)',
    tickformat: '%H:%M',
    timeHoverFmt: '%b %d, %H:%M',
    rangebreaks: [{ pattern: 'hour', bounds: [16.25, 9.5] }]
  },
  '5D': {
    step: 1,
    label: '5D',
    badgeText: '5D &bull; 1-Week (5m)',
    pillText: '1-Week 5m',
    pillClass: 'bg-blue-950/80 text-blue-300 border-blue-800/60',
    granularity: '5m',
    tsSub: '5-Day Term Structure Progression & Ratio Shifts (5-min bars)',
    corrSub: '5-Minute Normalized Overlay (Upper) & Rolling 1-Day Pearson Correlation ρ(Δln S, Δln Vol) (Lower)',
    corrTraceName: 'Rolling 1D Correlation (ρ)',
    corrHoverLabel: 'Rolling 1D ρ',
    liveLabel: 'Current 1D ρ:',
    xTitle: '5-Day Timeline (US/Eastern)',
    tickformat: '%b %d %H:%M',
    timeHoverFmt: '%b %d, %H:%M',
    rangebreaks: [{ bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.25, 9.5] }]
  },
  '1M': {
    step: 2,
    label: '1M',
    badgeText: '1M &bull; 1-Month (30m)',
    pillText: '1-Month 30m',
    pillClass: 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60',
    granularity: '30m',
    tsSub: 'Monthly OPEX Cycle & Term Structure Inversions (30-min bars)',
    corrSub: '30-Minute Normalized Overlay (Upper) & Rolling 3-Day Pearson Correlation ρ(Δln S, Δln Vol) (Lower)',
    corrTraceName: 'Rolling 3D Correlation (ρ)',
    corrHoverLabel: 'Rolling 3D ρ',
    liveLabel: 'Current 3D ρ:',
    xTitle: '1-Month Timeline (US/Eastern)',
    tickformat: '%b %d %H:%M',
    timeHoverFmt: '%b %d, %H:%M',
    rangebreaks: [{ bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.25, 9.5] }]
  },
  '3M': {
    step: 3,
    label: '3M',
    badgeText: '3M &bull; Quarterly (30m)',
    pillText: 'Quarterly 30m',
    pillClass: 'bg-purple-950/80 text-purple-300 border-purple-800/60',
    granularity: '30m',
    tsSub: 'Quarterly Term Structure & Native VIX3M Tenor Match (30-min bars)',
    corrSub: '30-Minute Normalized Overlay (Upper) & Rolling 10-Day Pearson Correlation ρ(Δln S, Δln Vol) (Lower)',
    corrTraceName: 'Rolling 10D Correlation (ρ)',
    corrHoverLabel: 'Rolling 10D ρ',
    liveLabel: 'Current 10D ρ:',
    xTitle: '3-Month Timeline (US/Eastern)',
    tickformat: '%b %d',
    timeHoverFmt: '%b %d, %H:%M',
    rangebreaks: [{ bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.25, 9.5] }]
  },
  '6M': {
    step: 4,
    label: '6M',
    badgeText: '6M &bull; Semi-Annual (30m)',
    pillText: 'Semi-Annual 30m',
    pillClass: 'bg-pink-950/80 text-pink-300 border-pink-800/60',
    granularity: '30m',
    tsSub: 'Semi-Annual Volatility Cycle & Macro Term Structure (30-min bars)',
    corrSub: '30-Minute Normalized Overlay (Upper) & Rolling 15-Day Pearson Correlation ρ(Δln S, Δln Vol) (Lower)',
    corrTraceName: 'Rolling 15D Correlation (ρ)',
    corrHoverLabel: 'Rolling 15D ρ',
    liveLabel: 'Current 15D ρ:',
    xTitle: '6-Month Timeline (US/Eastern)',
    tickformat: '%b %d',
    timeHoverFmt: '%b %d, %H:%M',
    rangebreaks: [{ bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.25, 9.5] }]
  },
  'YTD': {
    step: 5,
    label: 'YTD',
    badgeText: 'YTD &bull; Year-to-Date (1d)',
    pillText: 'YTD Daily',
    pillClass: 'bg-teal-950/80 text-teal-300 border-teal-800/60',
    granularity: '1d',
    tsSub: 'Year-to-Date Term Structure & Benchmark Performance (Daily Close)',
    corrSub: 'Daily Close Normalized Overlay (Upper) & Rolling 20-Day Pearson Correlation ρ(Δln S, Δln Vol) (Lower)',
    corrTraceName: 'Rolling 20D Correlation (ρ)',
    corrHoverLabel: 'Rolling 20D ρ',
    liveLabel: 'Current 20D ρ:',
    xTitle: 'Year-to-Date Timeline',
    tickformat: '%b %d',
    timeHoverFmt: '%b %d, %Y',
    rangebreaks: [{ bounds: ['sat', 'mon'] }]
  },
  '1Y': {
    step: 6,
    label: '1Y',
    badgeText: '1Y &bull; 1-Year Macro (1d)',
    pillText: '1-Year Daily',
    pillClass: 'bg-slate-800 text-slate-300 border-slate-700',
    granularity: '1d',
    tsSub: '1-Year Macro Volatility Regime & Historical Seasonality (Daily Close)',
    corrSub: 'Daily Close Normalized Overlay (Upper) & Rolling 60-Day Pearson Correlation ρ(Δln S, Δln Vol) (Lower)',
    corrTraceName: 'Rolling 60D Correlation (ρ)',
    corrHoverLabel: 'Rolling 60D ρ',
    liveLabel: 'Current 60D ρ:',
    xTitle: '1-Year Macro Date',
    tickformat: '%b %Y',
    timeHoverFmt: '%b %d, %Y',
    rangebreaks: [{ bounds: ['sat', 'mon'] }]
  },
  'MAX': {
    step: 7,
    label: 'MAX',
    badgeText: 'MAX &bull; 2-Year Multi-Year (1d)',
    pillText: 'MAX 2-Year',
    pillClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60',
    granularity: '1d',
    tsSub: 'Multi-Year Historical Regime & Volatility Crisis Comparison (Daily Close)',
    corrSub: 'Daily Close Normalized Overlay (Upper) & Rolling 60-Day Pearson Correlation ρ(Δln S, Δln Vol) (Lower)',
    corrTraceName: 'Rolling 60D Correlation (ρ)',
    corrHoverLabel: 'Rolling 60D ρ',
    liveLabel: 'Current 60D ρ:',
    xTitle: 'Multi-Year Timeline (2Y)',
    tickformat: '%b %Y',
    timeHoverFmt: '%b %d, %Y',
    rangebreaks: [{ bounds: ['sat', 'mon'] }]
  }
};

// Cached Datasets (SPX & Term Structure)
let cachedBootstrap = null;
let cachedTs = {
  '1D': { times: [], vix: [], vix3m: [], ratio: [] },
  '5D': { times: [], vix: [], vix3m: [], ratio: [] },
  '1M': { times: [], vix: [], vix3m: [], ratio: [] },
  '3M': { times: [], vix: [], vix3m: [], ratio: [] },
  '6M': { times: [], vix: [], vix3m: [], ratio: [] },
  'YTD': { times: [], vix: [], vix3m: [], ratio: [] },
  '1Y': { times: [], vix: [], vix3m: [], ratio: [] },
  'MAX': { times: [], vix: [], vix3m: [], ratio: [] }
};
let cachedTrail = { x: [], y: [], times: [] };
let cachedCorr = {
  '1D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '5D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '1M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '3M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '6M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  'YTD': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '1Y': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  'MAX': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  metrics: { '1D': -0.75, '5D': -0.75, '1M': -0.75, '3M': -0.75, '6M': -0.75, 'YTD': -0.75, '1Y': -0.75, 'MAX': -0.75 }
};

// Cached Datasets (NDX & Tech Vol Spread)
let cachedTechVol = {
  '1D': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
  '5D': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
  '1M': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
  '3M': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
  '6M': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
  'YTD': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
  '1Y': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
  'MAX': { times: [], spread: [], ratio: [], vxn: [], vix: [] }
};
let cachedCorrNdx = {
  '1D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '5D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '1M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '3M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '6M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  'YTD': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '1Y': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  'MAX': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  metrics: { '1D': -0.75, '5D': -0.75, '1M': -0.75, '3M': -0.75, '6M': -0.75, 'YTD': -0.75, '1Y': -0.75, 'MAX': -0.75 }
};
let currentCorrTf = '1D';

// Recovery Anchor State for Dynamic Correlation & Divergence Monitor
let corrAnchor = {
  active: false,
  mode: 'open',       // 'open' (default), 'spot_low', 'vol_high', 'custom'
  time: null,         // timestamp string or null
  index: -1,
  spotBase: null,
  volBase: null,
  label: 'Session Baseline'
};

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

btnSettings.addEventListener('click', () => {
  const inputSpx = document.getElementById('input-spx-threshold');
  const inputNdx = document.getElementById('input-ndx-threshold');
  if (inputSpx) inputSpx.value = currentSpxThreshold;
  if (inputNdx) inputNdx.value = currentNdxThreshold;
  modalSettings.classList.remove('hidden');
});
modalClose.addEventListener('click', () => modalSettings.classList.add('hidden'));
btnCancelSettings.addEventListener('click', () => modalSettings.classList.add('hidden'));

btnSaveSettings.addEventListener('click', async () => {
  const spxThresh = parseFloat(document.getElementById('input-spx-threshold').value) || currentSpxThreshold;
  const ndxThresh = parseFloat(document.getElementById('input-ndx-threshold').value) || currentNdxThreshold;
  const win = parseInt(document.getElementById('input-window').value, 10);
  const interval = parseFloat(document.getElementById('input-interval').value);

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        spx_threshold: spxThresh,
        ndx_threshold: ndxThresh,
        window: win, 
        interval: interval 
      })
    });
    if (res.ok) {
      currentSpxThreshold = spxThresh;
      currentNdxThreshold = ndxThresh;
      currentThreshold = (currentAssetPair === 'NDX') ? currentNdxThreshold : currentSpxThreshold;
      const dispEl = document.getElementById('disp-thresh-pts');
      if (dispEl) dispEl.textContent = currentThreshold.toFixed(1);
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
    currentThreshold = currentSpxThreshold;
    if (btnAssetSpx) btnAssetSpx.className = "px-2.5 py-1 rounded text-xs font-bold bg-cyan-500 text-black shadow-sm transition flex items-center space-x-1.5";
    if (btnAssetNdx) btnAssetNdx.className = "px-2.5 py-1 rounded text-xs font-semibold text-slate-400 hover:text-white transition flex items-center space-x-1.5";

    const spTitle = document.getElementById('spotvol-title');
    if (spTitle) spTitle.textContent = "Spot-Vol Regression & Overvix Zone";
    const spSub = document.getElementById('spotvol-sub');
    if (spSub) spSub.textContent = `SPX % vs VIX Point Move with +${currentSpxThreshold.toFixed(1)} pt Threshold & Intraday Path`;

    const tsTitle = document.getElementById('ts-title');
    if (tsTitle) tsTitle.textContent = "Volatility Term Structure (VIX / VIX3M)";
    const tsSub = document.getElementById('ts-sub');
    if (tsSub) tsSub.textContent = "30-Day vs. 90-Day Volatility Ratio & Inversion Monitor";

    const corrTitle = document.getElementById('corr-title');
    if (corrTitle) corrTitle.textContent = "SPX & VIX Dynamic Correlation & Divergence Monitor";
    const corrSub = document.getElementById('corr-subtitle');
    if (corrSub) corrSub.textContent = "Minute-by-Minute Normalized Overlay (Upper) & Rolling 30-Minute Pearson Correlation ρ(ΔSPX, ΔVIX) (Lower)";
  } else {
    currentThreshold = currentNdxThreshold;
    if (btnAssetNdx) btnAssetNdx.className = "px-2.5 py-1 rounded text-xs font-bold bg-purple-500 text-white shadow-sm transition flex items-center space-x-1.5";
    if (btnAssetSpx) btnAssetSpx.className = "px-2.5 py-1 rounded text-xs font-semibold text-slate-400 hover:text-white transition flex items-center space-x-1.5";

    const spTitle = document.getElementById('spotvol-title');
    if (spTitle) spTitle.textContent = "Nasdaq Spot-Vol Regression & Over-VXN Zone";
    const spSub = document.getElementById('spotvol-sub');
    if (spSub) spSub.textContent = `NDX % vs VXN Point Move with +${currentNdxThreshold.toFixed(1)} pt Threshold & Intraday Path`;

    const tsTitle = document.getElementById('ts-title');
    if (tsTitle) tsTitle.textContent = "Tech Vol Premium (VXN vs VIX Spread & Ratio)";
    const tsSub = document.getElementById('ts-sub');
    if (tsSub) tsSub.textContent = "Tech Vol Spread (VXN - VIX) & Skew Ratio Monitor";

    const corrTitle = document.getElementById('corr-title');
    if (corrTitle) corrTitle.textContent = "NDX & VXN Dynamic Correlation & Divergence Monitor";
    const corrSub = document.getElementById('corr-subtitle');
    if (corrSub) corrSub.textContent = "Minute-by-Minute Normalized Overlay (Upper) & Rolling 30-Minute Pearson Correlation ρ(ΔNDX, ΔVXN) (Lower)";
  }

  const dispEl = document.getElementById('disp-thresh-pts');
  if (dispEl) dispEl.textContent = currentThreshold.toFixed(1);

  updateAnchorUI();

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
// Timeframe Stepped Slider Elements (Card 2 & Card 3)
const sliderTsTimeframe = document.getElementById('slider-ts-timeframe');
const tsSliderBadge = document.getElementById('ts-slider-badge');
const tsTickLabels = document.getElementById('ts-tick-labels');
const chkSyncTimeframe = document.getElementById('chk-sync-timeframe');
const tsLivePill = document.getElementById('ts-live-pill');

const sliderCorrTimeframe = document.getElementById('slider-corr-timeframe');
const corrSliderBadge = document.getElementById('corr-slider-badge');
const corrTickLabels = document.getElementById('corr-tick-labels');

function setupTimeframeSliders() {
  if (sliderTsTimeframe) {
    sliderTsTimeframe.addEventListener('input', (e) => {
      const idx = parseInt(e.target.value, 10);
      const tf = TF_STEPS[idx] || '1D';
      updateTsSliderUI(tf);
      if (chkSyncTimeframe && chkSyncTimeframe.checked) {
        if (sliderCorrTimeframe) sliderCorrTimeframe.value = idx;
        updateCorrSliderUI(tf);
      }
    });

    sliderTsTimeframe.addEventListener('change', (e) => {
      const idx = parseInt(e.target.value, 10);
      const tf = TF_STEPS[idx] || '1D';
      switchTimeframe(tf, true);
    });
  }

  if (tsTickLabels) {
    tsTickLabels.querySelectorAll('span[data-step]').forEach(span => {
      span.addEventListener('click', () => {
        const step = parseInt(span.getAttribute('data-step'), 10);
        const tf = TF_STEPS[step] || '1D';
        if (sliderTsTimeframe) sliderTsTimeframe.value = step;
        switchTimeframe(tf, true);
      });
    });
  }

  if (sliderCorrTimeframe) {
    sliderCorrTimeframe.addEventListener('input', (e) => {
      const idx = parseInt(e.target.value, 10);
      const tf = TF_STEPS[idx] || '1D';
      updateCorrSliderUI(tf);
      if (chkSyncTimeframe && chkSyncTimeframe.checked) {
        if (sliderTsTimeframe) sliderTsTimeframe.value = idx;
        updateTsSliderUI(tf);
      }
    });

    sliderCorrTimeframe.addEventListener('change', (e) => {
      const idx = parseInt(e.target.value, 10);
      const tf = TF_STEPS[idx] || '1D';
      switchCorrTf(tf, true);
    });
  }

  if (corrTickLabels) {
    corrTickLabels.querySelectorAll('span[data-step]').forEach(span => {
      span.addEventListener('click', () => {
        const step = parseInt(span.getAttribute('data-step'), 10);
        const tf = TF_STEPS[step] || '1D';
        if (sliderCorrTimeframe) sliderCorrTimeframe.value = step;
        switchCorrTf(tf, true);
      });
    });
  }
}

// Backward-compatible alias
function setupTimeframeButtons() {
  setupTimeframeSliders();
}

function updateTsSliderUI(tf) {
  const conf = TF_CONFIG[tf] || TF_CONFIG['1D'];
  if (tsSliderBadge) {
    tsSliderBadge.innerHTML = conf.badgeText;
  }
  if (tsLivePill) {
    tsLivePill.textContent = conf.pillText;
    tsLivePill.className = `text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${conf.pillClass}`;
  }
  const tsSub = document.getElementById('ts-sub');
  if (tsSub && conf.tsSub) {
    tsSub.textContent = conf.tsSub;
  }
  if (tsTickLabels) {
    tsTickLabels.querySelectorAll('span[data-step]').forEach(span => {
      const s = parseInt(span.getAttribute('data-step'), 10);
      if (s === conf.step) {
        span.className = "cursor-pointer font-bold text-cyan-400 transition";
      } else {
        span.className = "cursor-pointer text-slate-400 hover:text-cyan-300 transition";
      }
    });
  }
}

function updateCorrSliderUI(tf) {
  const conf = TF_CONFIG[tf] || TF_CONFIG['1D'];
  if (corrSliderBadge) {
    corrSliderBadge.innerHTML = conf.badgeText;
  }
  if (corrTfPill) {
    corrTfPill.textContent = conf.pillText;
    corrTfPill.className = `text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${conf.pillClass}`;
  }
  if (corrSubtitle && conf.corrSub) {
    corrSubtitle.textContent = conf.corrSub;
  }
  if (corrLiveLabel && conf.liveLabel) {
    corrLiveLabel.textContent = conf.liveLabel;
  }
  if (corrTickLabels) {
    corrTickLabels.querySelectorAll('span[data-step]').forEach(span => {
      const s = parseInt(span.getAttribute('data-step'), 10);
      if (s === conf.step) {
        span.className = "cursor-pointer font-bold text-cyan-400 transition";
      } else {
        span.className = "cursor-pointer text-slate-400 hover:text-cyan-300 transition";
      }
    });
  }
}

function switchTimeframe(tf, triggeredBySlider = false) {
  currentTimeframe = tf;
  const conf = TF_CONFIG[tf] || TF_CONFIG['1D'];
  if (sliderTsTimeframe && sliderTsTimeframe.value != conf.step) {
    sliderTsTimeframe.value = conf.step;
  }
  updateTsSliderUI(tf);

  if (chkSyncTimeframe && chkSyncTimeframe.checked) {
    currentCorrTf = tf;
    if (sliderCorrTimeframe && sliderCorrTimeframe.value != conf.step) {
      sliderCorrTimeframe.value = conf.step;
    }
    updateCorrSliderUI(tf);
    syncCorrAnchorForTimeframe(tf);
    renderCorrelationChart(currentCorrMode, tf);
    updateCorrMetricDisplay();
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

// Correlation Timeframe & Display Controls
const btnCorrScale = document.getElementById('btn-corr-scale');
const corrScaleLabel = document.getElementById('corr-scale-label');
const btnCorrInvert = document.getElementById('btn-corr-invert');
const corrInvertGroup = document.getElementById('corr-invert-group');
const corrInvertIcon = document.getElementById('corr-invert-icon');
const corrTfPill = document.getElementById('corr-tf-pill');
const corrSubtitle = document.getElementById('corr-subtitle');
const corrLiveLabel = document.getElementById('corr-live-label');

function setupCorrButtons() {
  if (btnCorrScale) btnCorrScale.addEventListener('click', () => toggleCorrScaleMode());
  if (btnCorrInvert) btnCorrInvert.addEventListener('click', () => toggleCorrVolInvert());
  setupAnchorButtons();
}

function setupAnchorButtons() {
  const btnOpen = document.getElementById('btn-anchor-open');
  const btnSpotLow = document.getElementById('btn-anchor-spot-low');
  const btnVolHigh = document.getElementById('btn-anchor-vol-high');
  const btnCustomToggle = document.getElementById('btn-anchor-custom-toggle');
  const btnApplyCustom = document.getElementById('btn-apply-custom-time');
  const btnReset = document.getElementById('btn-anchor-reset');
  const customWrapper = document.getElementById('anchor-custom-wrapper');
  const timePicker = document.getElementById('anchor-time-picker');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => setCorrAnchor('open'));
  }
  if (btnSpotLow) {
    btnSpotLow.addEventListener('click', () => setCorrAnchor('spot_low'));
  }
  if (btnVolHigh) {
    btnVolHigh.addEventListener('click', () => setCorrAnchor('vol_high'));
  }
  if (btnCustomToggle) {
    btnCustomToggle.addEventListener('click', () => {
      if (customWrapper) {
        customWrapper.classList.toggle('hidden');
        customWrapper.classList.toggle('flex');
        if (!customWrapper.classList.contains('hidden') && timePicker) {
          timePicker.focus();
          timePicker.select();
        }
      }
    });
  }
  if (btnApplyCustom) {
    btnApplyCustom.addEventListener('click', () => {
      if (timePicker && timePicker.value) {
        setCorrAnchor('custom', timePicker.value.trim());
      }
    });
  }
  if (timePicker) {
    timePicker.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (timePicker.value) {
          setCorrAnchor('custom', timePicker.value.trim());
        }
      }
    });
  }
  if (btnReset) {
    btnReset.addEventListener('click', () => setCorrAnchor('open'));
  }
}

function toggleCorrScaleMode() {
  isBetaScaled = !isBetaScaled;
  if (btnCorrScale && corrScaleLabel) {
    if (isBetaScaled) {
      btnCorrScale.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-500 text-black shadow-sm transition flex items-center space-x-1";
      corrScaleLabel.textContent = "Beta Scaled";
      btnCorrScale.title = "Lock dual axes to Spot-Vol Slope (1% Spot = |Slope| pts Vol). Click to switch to Auto Fit.";
    } else {
      btnCorrScale.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700 transition flex items-center space-x-1";
      corrScaleLabel.textContent = "Auto Fit";
      btnCorrScale.title = "Independent min-max scale auto-fit. Click to lock dual axes to Spot-Vol Slope.";
    }
  }
  renderCorrelationChart('dual', currentCorrTf);
}

function toggleCorrVolInvert() {
  isVolInverted = !isVolInverted;
  if (btnCorrInvert) {
    if (isVolInverted) {
      btnCorrInvert.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500 text-black shadow-sm transition flex items-center space-x-1";
      if (corrInvertIcon) corrInvertIcon.textContent = "▼";
    } else {
      btnCorrInvert.className = "px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-white transition flex items-center space-x-1";
      if (corrInvertIcon) corrInvertIcon.textContent = "▲";
    }
  }
  renderCorrelationChart(currentCorrMode, currentCorrTf);
}

function switchCorrMode(mode = 'dual') {
  currentCorrMode = 'dual';
  renderCorrelationChart('dual', currentCorrTf);
}

function switchCorrTf(tf, triggeredBySlider = false) {
  currentCorrTf = tf;
  const conf = TF_CONFIG[tf] || TF_CONFIG['1D'];
  if (sliderCorrTimeframe && sliderCorrTimeframe.value != conf.step) {
    sliderCorrTimeframe.value = conf.step;
  }
  updateCorrSliderUI(tf);

  if (chkSyncTimeframe && chkSyncTimeframe.checked) {
    currentTimeframe = tf;
    if (sliderTsTimeframe && sliderTsTimeframe.value != conf.step) {
      sliderTsTimeframe.value = conf.step;
    }
    updateTsSliderUI(tf);
    renderTermStructureChart(tf);
  }

  syncCorrAnchorForTimeframe(tf);
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
  const assetDefaultThresh = isNdx ? currentNdxThreshold : currentSpxThreshold;
  const threshold = (targetData.model && targetData.model.threshold_pts) || assetDefaultThresh;

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
  if (bootstrap.is_historical && trail.x && trail.x.length > 0) {
    currX = trail.x[trail.x.length - 1];
    currY = trail.y[trail.y.length - 1];
  } else if (targetData.current_point && targetData.current_point.x !== undefined && targetData.current_point.y !== undefined) {
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

  // Update subtitle & card target dynamically
  const spSub = document.getElementById('spotvol-sub');
  if (spSub) {
    spSub.textContent = `${assetLabel} % vs ${volLabel} Point Move with +${threshold.toFixed(1)} pt Threshold & Intraday Path`;
  }
  const dispEl = document.getElementById('disp-thresh-pts');
  if (dispEl) dispEl.textContent = threshold.toFixed(1);
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
      hovertemplate: `<b>%{text}</b><br>${assetLabel} Move: %{x:.2f}%<br>${volLabel} Move: %{y:.2f} pts<extra></extra>`,
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
      line: { color: '#00E5FF', width: 1.8, shape: 'spline' },
      marker: { color: '#00E5FF', size: 4, opacity: 0.8 },
      hovertemplate: `<b>%{text}</b><br>${assetLabel}: %{x:.2f}%<br>${volLabel}: %{y:.2f} pts<extra></extra>`,
      visible: currentTrailMode === '60d' ? false : true
    },
    // 5: Session End / Live Current Point
    {
      x: [currX],
      y: [currY],
      mode: 'markers',
      name: (bootstrap.is_historical || bootstrap.is_rth_active === false) ? "Session Close Point" : "Live Point",
      marker: {
        color: isOvervixed ? '#FF1744' : '#00E5FF',
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
  const conf = TF_CONFIG[tf] || TF_CONFIG['1D'];
  const data = cachedTechVol[tf] || cachedTechVol['1D'] || {};
  const times = data.times || [];
  const vxn = data.vxn || [];
  const vix = data.vix || [];
  const spread = data.spread || [];
  const ratio = data.ratio || [];

  const dStart = times.length > 0 ? times[0] : null;
  const dEnd = times.length > 0 ? times[times.length - 1] : null;
  const hasValidDates = Boolean(dStart && dEnd);
  const timeHoverFmt = conf.timeHoverFmt;

  const traceVXN = {
    x: times,
    y: vxn,
    name: 'VXN (Tech Vol)',
    mode: 'lines',
    line: { color: '#C084FC', width: 1.8 },
    xaxis: 'x',
    yaxis: 'y',
    hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>VXN: %{y:.2f}<extra></extra>`
  };

  const traceVIX = {
    x: times,
    y: vix,
    name: 'VIX (Broad Vol)',
    mode: 'lines',
    line: { color: '#00E5FF', width: 1.5 },
    xaxis: 'x',
    yaxis: 'y',
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
    hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>Spread: %{y:.2f} pts<extra></extra>`
  };

  const traceEquilibrium = {
    x: hasValidDates ? [dStart, dEnd] : [],
    y: hasValidDates ? [5.0, 5.0] : [],
    mode: 'lines',
    name: 'Equilibrium Spread (+5.0 pts)',
    line: { color: '#10B981', width: 1, dash: 'dot' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'none'
  };

  const tracePanic = {
    x: hasValidDates ? [dStart, dEnd] : [],
    y: hasValidDates ? [9.0, 9.0] : [],
    mode: 'lines',
    name: 'Tech Panic Spread (≥ +9.0 pts)',
    line: { color: '#EF4444', width: 1.5, dash: 'dash' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'none'
  };

  const xTitle = conf.xTitle;
  const rangebreaks = conf.rangebreaks || [];

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    margin: { l: 50, r: 20, t: 25, b: 40 },
    xaxis: {
      anchor: 'y2',
      type: 'date',
      rangebreaks: rangebreaks,
      tickformat: conf.tickformat,
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

  Plotly.newPlot('term-structure-chart', [traceVXN, traceVIX, traceSpread, traceEquilibrium, tracePanic], layout, {
    responsive: true,
    displayModeBar: false
  });
}

function renderTermStructureChart(tf = '1D') {
  if (currentAssetPair === 'NDX') {
    renderTechVolChart(tf);
    return;
  }
  const conf = TF_CONFIG[tf] || TF_CONFIG['1D'];
  const data = cachedTs[tf] || cachedTs['1D'];
  const times = data.times || [];
  const vix = data.vix || [];
  const vix3m = data.vix3m || [];
  const ratio = data.ratio || [];

  const dStart = times.length > 0 ? times[0] : null;
  const dEnd = times.length > 0 ? times[times.length - 1] : null;
  const hasValidDates = Boolean(dStart && dEnd);

  const timeHoverFmt = conf.timeHoverFmt;

  const traceVIX = {
    x: times,
    y: vix,
    name: 'VIX (30d)',
    mode: 'lines',
    line: { color: '#00E5FF', width: 1.5 },
    xaxis: 'x',
    yaxis: 'y',
    hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>VIX (30d): %{y:.2f}<extra></extra>`
  };

  const traceVIX3M = {
    x: times,
    y: vix3m,
    name: 'VIX3M (90d)',
    mode: 'lines',
    line: { color: '#FFA726', width: 1.5 },
    xaxis: 'x',
    yaxis: 'y',
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
    x: hasValidDates ? [dStart, dEnd] : [],
    y: hasValidDates ? [0.90, 0.90] : [],
    mode: 'lines',
    name: 'Flattening (0.90)',
    line: { color: '#FFA726', width: 1, dash: 'dot' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'none'
  };

  const traceInversion = {
    x: hasValidDates ? [dStart, dEnd] : [],
    y: hasValidDates ? [1.00, 1.00] : [],
    mode: 'lines',
    name: 'Inversion (1.00)',
    line: { color: '#EF4444', width: 1.5, dash: 'dash' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'none'
  };

  const xTitle = conf.xTitle;
  const rangebreaks = conf.rangebreaks || [];

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    margin: { l: 50, r: 20, t: 25, b: 40 },
    xaxis: {
      anchor: 'y2',
      type: 'date',
      rangebreaks: rangebreaks,
      tickformat: conf.tickformat,
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

  Plotly.newPlot('term-structure-chart', [traceVIX, traceVIX3M, traceRatio, traceFlattening, traceInversion], layout, {
    responsive: true,
    displayModeBar: false
  });
}

// ==============================================================================
// RECOVERY ANCHOR & LEADER DIAGNOSTIC ENGINE (DYNAMIC CORRELATION)
// ==============================================================================

function getRawSpotVolSeries(c, isNdx) {
  const times = c.times || [];
  const len = times.length;
  let spot = [];
  let vol = [];

  if (isNdx) {
    if (c.ndx_raw && c.ndx_raw.length === len) spot = c.ndx_raw.slice();
    else if (c.spot_raw && c.spot_raw.length === len) spot = c.spot_raw.slice();
    if (c.vxn_raw && c.vxn_raw.length === len) vol = c.vxn_raw.slice();
    else if (c.vol_raw && c.vol_raw.length === len) vol = c.vol_raw.slice();
  } else {
    if (c.spx_raw && c.spx_raw.length === len) spot = c.spx_raw.slice();
    else if (c.spot_raw && c.spot_raw.length === len) spot = c.spot_raw.slice();
    if (c.vix_raw && c.vix_raw.length === len) vol = c.vix_raw.slice();
    else if (c.vol_raw && c.vol_raw.length === len) vol = c.vol_raw.slice();
  }

  const spotPcts = isNdx ? (c.ndx_pct || c.spx_pct || []) : (c.spx_pct || []);
  const volPts = isNdx ? (c.vxn_pt || c.vix_pt || []) : (c.vix_pt || []);

  if (spot.length !== len) {
    let refSpot = 100.0;
    if (cachedBootstrap) {
      if (isNdx && cachedBootstrap.ndx && cachedBootstrap.ndx.market && cachedBootstrap.ndx.market.current) {
        const curr = cachedBootstrap.ndx.market.current;
        const lastPct = spotPcts.length > 0 ? spotPcts[spotPcts.length - 1] : 0;
        refSpot = curr / (1 + (lastPct || 0) / 100);
      } else if (cachedBootstrap.market && cachedBootstrap.market.spx && cachedBootstrap.market.spx.current) {
        const curr = cachedBootstrap.market.spx.current;
        const lastPct = spotPcts.length > 0 ? spotPcts[spotPcts.length - 1] : 0;
        refSpot = curr / (1 + (lastPct || 0) / 100);
      }
    }
    spot = spotPcts.map(pct => refSpot * (1 + (pct || 0) / 100));
  }

  if (vol.length !== len) {
    let refVol = 20.0;
    if (cachedBootstrap) {
      if (isNdx && cachedBootstrap.ndx && cachedBootstrap.ndx.market && cachedBootstrap.ndx.market.vxn && cachedBootstrap.ndx.market.vxn.current) {
        const curr = cachedBootstrap.ndx.market.vxn.current;
        const lastPt = volPts.length > 0 ? volPts[volPts.length - 1] : 0;
        refVol = curr - lastPt;
      } else if (cachedBootstrap.market && cachedBootstrap.market.vix && cachedBootstrap.market.vix.current) {
        const curr = cachedBootstrap.market.vix.current;
        const lastPt = volPts.length > 0 ? volPts[volPts.length - 1] : 0;
        refVol = curr - lastPt;
      }
    }
    vol = volPts.map(pt => refVol + (pt || 0));
  }

  return { spot, vol };
}

function findClosestTimeIndex(times, target) {
  if (!times || times.length === 0 || target === null || target === undefined) return -1;
  
  // 1. If target is already a valid index number
  if (typeof target === 'number' && Number.isInteger(target) && target >= 0 && target < times.length) {
    return target;
  }

  const clean = String(target).trim();
  if (!clean) return -1;

  // 2. Exact match
  for (let i = 0; i < times.length; i++) {
    if (times[i] === clean) return i;
  }

  // 3. Substring match (either way: times[i] inside clean or clean inside times[i])
  for (let i = 0; i < times.length; i++) {
    if (clean.includes(times[i]) || times[i].includes(clean)) return i;
  }

  // 4. Prefix match up to minutes (e.g. '2026-11-06 10:45:00'[:16] === '2026-11-06 10:45')
  if (clean.length >= 16) {
    const cleanPrefix = clean.slice(0, 16).replace('T', ' ');
    for (let i = 0; i < times.length; i++) {
      const tPrefix = times[i].slice(0, 16).replace('T', ' ');
      if (tPrefix === cleanPrefix) return i;
    }
  }

  // 5. Full Timestamp / Date comparison (Chronological Distance in ms)
  // Must execute BEFORE stripping time-of-day so multi-month dates are never confused
  const parsedTarget = Date.parse(clean.replace(' ', 'T'));
  if (!isNaN(parsedTarget)) {
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const tMs = Date.parse(times[i].replace(' ', 'T'));
      if (!isNaN(tMs)) {
        const diff = Math.abs(tMs - parsedTarget);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
    }
    return closestIdx;
  }

  // 6. Epoch timestamp comparison (if numeric string or number > 1e9)
  const num = Number(clean);
  if (!isNaN(num) && num > 1e9) {
    const targetMs = (num < 1e11) ? (num * 1000) : num;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const tMs = Date.parse(times[i].replace(' ', 'T'));
      if (!isNaN(tMs)) {
        const diff = Math.abs(tMs - targetMs);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
    }
    return closestIdx;
  }

  // 7. Time HH:MM comparison (intraday only fallback if no date supplied)
  let cleanTime = clean;
  if (clean.includes(' ')) {
    cleanTime = clean.split(' ')[1];
  } else if (clean.includes('T')) {
    cleanTime = clean.split('T')[1];
  }

  if (cleanTime && cleanTime.includes(':')) {
    const parts = cleanTime.split(':');
    const targetMins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    if (!isNaN(targetMins)) {
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < times.length; i++) {
        const tStr = times[i].includes(' ') ? times[i].split(' ')[1] : times[i];
        if (tStr && tStr.includes(':')) {
          const tParts = tStr.split(':');
          const tMins = parseInt(tParts[0], 10) * 60 + parseInt(tParts[1], 10);
          if (!isNaN(tMins)) {
            const diff = Math.abs(tMins - targetMins);
            if (diff < minDiff) {
              minDiff = diff;
              closestIdx = i;
            }
          }
        }
      }
      return closestIdx;
    }
  }

  return times.length - 1;
}

function setCorrAnchor(mode, targetTime = null) {
  const isNdx = (currentAssetPair === 'NDX');
  const c = isNdx ? (cachedCorrNdx[currentCorrTf] || cachedCorrNdx['1D'] || cachedCorrNdx) : (cachedCorr[currentCorrTf] || cachedCorr['1D'] || cachedCorr);
  const times = c.times || [];
  if (!times || times.length === 0) return;

  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';

  if (mode === 'open') {
    corrAnchor.active = false;
    corrAnchor.mode = 'open';
    corrAnchor.time = null;
    corrAnchor.index = -1;
    corrAnchor.spotBase = null;
    corrAnchor.volBase = null;
    corrAnchor.label = 'Session Baseline';
    updateAnchorUI();
    renderCorrelationChart(currentCorrMode, currentCorrTf);
    return;
  }

  const raw = getRawSpotVolSeries(c, isNdx);
  const spotRaw = raw.spot;
  const volRaw = raw.vol;

  let chosenIdx = -1;

  if (mode === 'spot_low') {
    let minVal = Infinity;
    for (let i = 0; i < spotRaw.length; i++) {
      if (typeof spotRaw[i] === 'number' && !isNaN(spotRaw[i]) && spotRaw[i] < minVal) {
        minVal = spotRaw[i];
        chosenIdx = i;
      }
    }
    if (chosenIdx === -1) chosenIdx = 0;
  } else if (mode === 'vol_high') {
    let maxVal = -Infinity;
    for (let i = 0; i < volRaw.length; i++) {
      if (typeof volRaw[i] === 'number' && !isNaN(volRaw[i]) && volRaw[i] > maxVal) {
        maxVal = volRaw[i];
        chosenIdx = i;
      }
    }
    if (chosenIdx === -1) chosenIdx = 0;
  } else if (mode === 'custom') {
    chosenIdx = findClosestTimeIndex(times, targetTime);
    if (chosenIdx === -1) chosenIdx = 0;
  }

  if (chosenIdx < 0 || chosenIdx >= times.length) chosenIdx = 0;

  corrAnchor.active = true;
  corrAnchor.mode = mode;
  corrAnchor.time = times[chosenIdx];
  corrAnchor.index = chosenIdx;
  corrAnchor.spotBase = spotRaw[chosenIdx];
  corrAnchor.volBase = volRaw[chosenIdx];

  const timeDisplay = (currentCorrTf === '1D') ? (corrAnchor.time.length > 10 ? corrAnchor.time.slice(11) : corrAnchor.time) : corrAnchor.time;
  corrAnchor.label = `${timeDisplay} (${assetLabel}: ${corrAnchor.spotBase.toFixed(2)}, ${volLabel}: ${corrAnchor.volBase.toFixed(2)})`;

  // Sync custom time input if available
  const timePicker = document.getElementById('anchor-time-picker');
  if (timePicker) {
    const timeVal = (currentCorrTf === '1D') ? (corrAnchor.time.length > 10 ? corrAnchor.time.slice(11, 16) : corrAnchor.time) : corrAnchor.time;
    timePicker.value = timeVal;
  }

  updateAnchorUI();
  renderCorrelationChart(currentCorrMode, currentCorrTf);
}

function computeAnchoredCorrelation(spotRaw, volRaw, anchorIdx) {
  const len = spotRaw ? spotRaw.length : 0;
  const series = new Array(len).fill(null);
  if (!spotRaw || !volRaw || anchorIdx < 0 || anchorIdx >= len - 2) {
    return { series: series, latestCorr: null, count: 0 };
  }

  // Calculate stationary log returns for spot and vol: Δ ln(S) vs Δ ln(Vol)
  const sLog = [];
  const vLog = [];
  for (let i = 1; i < len; i++) {
    const sPrev = spotRaw[i - 1];
    const sCurr = spotRaw[i];
    const vPrev = volRaw[i - 1];
    const vCurr = volRaw[i];
    sLog.push((sPrev > 0 && sCurr > 0) ? Math.log(sCurr / sPrev) : 0);
    vLog.push((vPrev > 0 && vCurr > 0) ? Math.log(vCurr / vPrev) : 0);
  }

  let sumS = 0, sumV = 0, sumS2 = 0, sumV2 = 0, sumSV = 0;
  let count = 0;

  for (let i = anchorIdx; i < len - 1; i++) {
    const rs = sLog[i];
    const rv = vLog[i];
    sumS += rs;
    sumV += rv;
    sumS2 += rs * rs;
    sumV2 += rv * rv;
    sumSV += rs * rv;
    count++;

    // Suppress rendering during the first 10 bars post-anchor where statistical confidence is too low
    if (count > 10) {
      const meanS = sumS / count;
      const meanV = sumV / count;
      const varS = (sumS2 / count) - (meanS * meanS);
      const varV = (sumV2 / count) - (meanV * meanV);

      if (varS > 1e-12 && varV > 1e-12) {
        const cov = (sumSV / count) - (meanS * meanV);
        const r = cov / Math.sqrt(varS * varV);
        const clampedR = Math.max(-1.0, Math.min(1.0, r));
        series[i + 1] = Math.round(clampedR * 1000) / 1000;
      }
    }
  }

  let latestCorr = null;
  for (let i = len - 1; i >= anchorIdx; i--) {
    if (series[i] !== null && series[i] !== undefined) {
      latestCorr = series[i];
      break;
    }
  }

  return { series: series, latestCorr: latestCorr, count: count };
}

function syncCorrAnchorForTimeframe(tf) {
  if (!corrAnchor.active) return;
  const isNdx = (currentAssetPair === 'NDX');
  const c = isNdx ? (cachedCorrNdx[tf] || cachedCorrNdx['1D'] || cachedCorrNdx) : (cachedCorr[tf] || cachedCorr['1D'] || cachedCorr);
  const times = c.times || [];
  if (!times || times.length === 0) return;

  const raw = getRawSpotVolSeries(c, isNdx);
  const spotRaw = raw.spot;
  const volRaw = raw.vol;

  let newIdx = -1;
  if (corrAnchor.mode === 'spot_low') {
    let minVal = Infinity;
    for (let i = 0; i < spotRaw.length; i++) {
      if (typeof spotRaw[i] === 'number' && !isNaN(spotRaw[i]) && spotRaw[i] < minVal) {
        minVal = spotRaw[i];
        newIdx = i;
      }
    }
  } else if (corrAnchor.mode === 'vol_high') {
    let maxVal = -Infinity;
    for (let i = 0; i < volRaw.length; i++) {
      if (typeof volRaw[i] === 'number' && !isNaN(volRaw[i]) && volRaw[i] > maxVal) {
        maxVal = volRaw[i];
        newIdx = i;
      }
    }
  } else if (corrAnchor.time) {
    newIdx = findClosestTimeIndex(times, corrAnchor.time);
  }

  if (newIdx < 0 || newIdx >= times.length) newIdx = 0;

  corrAnchor.index = newIdx;
  corrAnchor.time = times[newIdx];
  if (spotRaw[newIdx] !== undefined) corrAnchor.spotBase = spotRaw[newIdx];
  if (volRaw[newIdx] !== undefined) corrAnchor.volBase = volRaw[newIdx];

  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';
  const timeDisplay = (tf === '1D') ? (corrAnchor.time.length > 10 ? corrAnchor.time.slice(11) : corrAnchor.time) : corrAnchor.time;
  corrAnchor.label = `${timeDisplay} (${assetLabel}: ${corrAnchor.spotBase ? corrAnchor.spotBase.toFixed(2) : '-'}, ${volLabel}: ${corrAnchor.volBase ? corrAnchor.volBase.toFixed(2) : '-'})`;

  updateAnchorUI();
}

function computeAnchoredSeries(c, isNdx) {
  const times = c.times || [];
  const raw = getRawSpotVolSeries(c, isNdx);
  const spotRaw = raw.spot;
  const volRaw = raw.vol;

  if (!corrAnchor.active || times.length === 0) {
    return {
      times: times,
      spotPct: isNdx ? (c.ndx_pct || c.spx_pct || []) : (c.spx_pct || []),
      volPt: isNdx ? (c.vxn_pt || c.vix_pt || []) : (c.vix_pt || []),
      spotRaw: spotRaw,
      volRaw: volRaw,
      isAnchored: false,
      anchorIdx: -1,
      anchorTime: null,
      anchoredCorr: null,
      latestAnchoredCorr: null,
      returnCount: 0
    };
  }

  // Ensure index is valid and in sync for this specific dataset
  let idx = corrAnchor.index;
  if (idx < 0 || idx >= times.length || (corrAnchor.time && times[idx] !== corrAnchor.time)) {
    if (corrAnchor.mode === 'spot_low') {
      let minVal = Infinity;
      for (let i = 0; i < spotRaw.length; i++) {
        if (typeof spotRaw[i] === 'number' && !isNaN(spotRaw[i]) && spotRaw[i] < minVal) {
          minVal = spotRaw[i];
          idx = i;
        }
      }
    } else if (corrAnchor.mode === 'vol_high') {
      let maxVal = -Infinity;
      for (let i = 0; i < volRaw.length; i++) {
        if (typeof volRaw[i] === 'number' && !isNaN(volRaw[i]) && volRaw[i] > maxVal) {
          maxVal = volRaw[i];
          idx = i;
        }
      }
    } else if (corrAnchor.time) {
      idx = findClosestTimeIndex(times, corrAnchor.time);
    }
    if (idx < 0 || idx >= times.length) idx = 0;
    corrAnchor.index = idx;
    corrAnchor.time = times[idx];
    if (spotRaw[idx] !== undefined) corrAnchor.spotBase = spotRaw[idx];
    if (volRaw[idx] !== undefined) corrAnchor.volBase = volRaw[idx];
  }
  const s0 = spotRaw[idx];
  const v0 = volRaw[idx];

  const anchoredSpotPct = spotRaw.map(s => (s0 > 0 ? Math.round(((s - s0) / s0 * 100.0) * 10000) / 10000 : 0));
  const anchoredVolPt = volRaw.map(v => Math.round((v - v0) * 10000) / 10000);

  // Compute post-anchor expanding Pearson correlation on log returns strictly from anchorIdx to latest
  const corrRes = computeAnchoredCorrelation(spotRaw, volRaw, idx);

  return {
    times: times,
    spotPct: anchoredSpotPct,
    volPt: anchoredVolPt,
    spotRaw: spotRaw,
    volRaw: volRaw,
    isAnchored: true,
    anchorIdx: idx,
    anchorTime: times[idx],
    s0: s0,
    v0: v0,
    anchoredCorr: corrRes.series,
    latestAnchoredCorr: corrRes.latestCorr,
    returnCount: corrRes.count
  };
}

function evaluateRecoveryLeader(anchoredSeries, isNdx) {
  if (!anchoredSeries.isAnchored || anchoredSeries.anchorIdx < 0) {
    return null;
  }

  const { times, spotPct, volPt, spotRaw, volRaw, anchorIdx, s0, v0 } = anchoredSeries;
  const len = times.length;
  if (anchorIdx >= len - 1) {
    return {
      isLatest: true,
      elapsedStr: '0m',
      spotNetPct: 0,
      spotNetPts: 0,
      volNetPt: 0,
      corrStr: '---',
      corrRegime: 'AT ANCHOR',
      corrBadgeClass: 'bg-slate-800 text-slate-400 border-slate-700',
      corrColor: 'text-slate-400',
      corrVal: null,
      badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
      tag: 'ANCHOR AT LATEST BAR',
      summary: 'Anchor set at the latest bar. Monitoring incoming recovery ticks...'
    };
  }

  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';

  const lastIdx = len - 1;
  const elapsedMinutes = lastIdx - anchorIdx;
  const hours = Math.floor(elapsedMinutes / 60);
  const mins = elapsedMinutes % 60;
  const elapsedStr = (currentCorrTf === '1D') 
    ? (hours > 0 ? `${hours}h ${mins}m` : `${mins}m`) 
    : `${elapsedMinutes} bars`;

  const spotNetPct = spotPct[lastIdx];
  const volNetPt = volPt[lastIdx];
  const spotNetPts = spotRaw[lastIdx] - s0;

  // Scan post-anchor bars [anchorIdx .. lastIdx] for first meaningful recovery turning points:
  let spotTurnIdx = -1;
  let volTurnIdx = -1;

  for (let i = anchorIdx + 1; i <= lastIdx; i++) {
    if (spotTurnIdx === -1 && spotPct[i] >= 0.25) {
      spotTurnIdx = i;
    }
    if (volTurnIdx === -1 && volPt[i] <= -0.50) {
      volTurnIdx = i;
    }
  }

  let maxSpotPct = -Infinity;
  let minVolPt = Infinity;

  for (let i = anchorIdx; i <= lastIdx; i++) {
    if (spotPct[i] > maxSpotPct) maxSpotPct = spotPct[i];
    if (volPt[i] < minVolPt) minVolPt = volPt[i];
  }

  let tag = "";
  let badgeClass = "";
  let summary = "";

  const spotRecovering = (spotNetPct > 0.15 || maxSpotPct >= 0.35);
  const volCrushing = (volNetPt < -0.30 || minVolPt <= -0.60);

  if (volTurnIdx !== -1 && (spotTurnIdx === -1 || volTurnIdx < spotTurnIdx)) {
    const leadMins = (spotTurnIdx !== -1) ? (spotTurnIdx - volTurnIdx) : (lastIdx - volTurnIdx);
    tag = `${volLabel} CRUSH LEADING RECOVERY`;
    badgeClass = "bg-emerald-950 text-emerald-400 border border-emerald-800";
    const leadTimeStr = (currentCorrTf === '1D') ? `${leadMins}m` : `${leadMins} bars`;
    summary = `${volLabel} crushed first (${volNetPt >= 0 ? '+' : ''}${volNetPt.toFixed(2)} pts) leading by ~${leadTimeStr} before ${assetLabel} rallied (${spotNetPct >= 0 ? '+' : ''}${spotNetPct.toFixed(2)}%).`;
  } else if (spotTurnIdx !== -1 && (volTurnIdx === -1 || spotTurnIdx < volTurnIdx)) {
    const leadMins = (volTurnIdx !== -1) ? (volTurnIdx - spotTurnIdx) : (lastIdx - spotTurnIdx);
    tag = `${assetLabel} LEADING (VOL STICKY)`;
    badgeClass = "bg-cyan-950 text-cyan-400 border border-cyan-800";
    const leadTimeStr = (currentCorrTf === '1D') ? `${leadMins}m` : `${leadMins} bars`;
    summary = `${assetLabel} rebounded first (${spotNetPct >= 0 ? '+' : ''}${spotNetPct.toFixed(2)}%) by ~${leadTimeStr} while ${volLabel} remained sticky (${volNetPt >= 0 ? '+' : ''}${volNetPt.toFixed(2)} pts).`;
  } else if (spotRecovering && volCrushing) {
    tag = "SYNCHRONOUS RECOVERY";
    badgeClass = "bg-purple-950 text-purple-300 border border-purple-800";
    summary = `${assetLabel} and ${volLabel} recovering concurrently in lockstep (${assetLabel}: ${spotNetPct >= 0 ? '+' : ''}${spotNetPct.toFixed(2)}%, ${volLabel}: ${volNetPt >= 0 ? '+' : ''}${volNetPt.toFixed(2)} pts).`;
  } else if (spotNetPct < -0.20 && volNetPt > 0.30) {
    tag = "FLUSH CONTINUATION";
    badgeClass = "bg-rose-950 text-rose-400 border border-rose-800";
    summary = `Selling pressure continued post-anchor: ${assetLabel} ${spotNetPct.toFixed(2)}%, ${volLabel} +${volNetPt.toFixed(2)} pts.`;
  } else {
    tag = "CONSOLIDATION POST-ANCHOR";
    badgeClass = "bg-slate-800 text-slate-300 border border-slate-700";
    summary = `Mild fluctuations since anchor: ${assetLabel} ${spotNetPct >= 0 ? '+' : ''}${spotNetPct.toFixed(2)}%, ${volLabel} ${volNetPt >= 0 ? '+' : ''}${volNetPt.toFixed(2)} pts.`;
  }

  // Evaluate Post-Anchor Expanding Pearson Correlation Diagnostic strictly from anchorIdx to latest
  let corrStr = "---";
  let corrRegime = "N/A";
  let corrBadgeClass = "bg-slate-800 text-slate-400 border-slate-700";
  let corrColor = "text-slate-400";
  let corrSummaryPart = "";
  const corrVal = anchoredSeries.latestAnchoredCorr;

  if (corrVal !== null && corrVal !== undefined) {
    corrStr = fmtNum(corrVal, 3);
    if (corrVal <= -0.70) {
      corrRegime = "HEALTHY INVERSE";
      corrBadgeClass = "bg-emerald-950 text-emerald-400 border border-emerald-800";
      corrColor = "text-emerald-400";
      corrSummaryPart = ` Post-anchor recovery correlation is strongly inverse (ρ = ${corrStr}), confirming healthy institutional volatility unwinding.`;
    } else if (corrVal <= -0.50) {
      corrRegime = "NORMAL INVERSE";
      corrBadgeClass = "bg-teal-950 text-teal-300 border border-teal-800";
      corrColor = "text-teal-300";
      corrSummaryPart = ` Post-anchor recovery correlation is normal (ρ = ${corrStr}).`;
    } else if (corrVal < 0.0) {
      corrRegime = "VOL STICKY / STRESS";
      corrBadgeClass = "bg-amber-950 text-amber-300 border border-amber-800";
      corrColor = "text-amber-400";
      corrSummaryPart = ` Post-anchor recovery correlation broke above -0.50 (ρ = ${corrStr}), indicating lingering tail hedging or vol-of-vol stress.`;
    } else {
      corrRegime = "POSITIVE DECOUPLING";
      corrBadgeClass = "bg-rose-950 text-rose-300 border border-rose-800 animate-pulse";
      corrColor = "text-rose-400";
      corrSummaryPart = ` Post-anchor correlation turned positive (ρ = ${corrStr})! Spot and volatility are moving in tandem.`;
    }
  } else if (anchoredSeries.returnCount <= 10) {
    corrStr = "Calibrating (≤ 10 bars)";
    corrRegime = "CALIBRATING";
    corrBadgeClass = "bg-slate-800 text-slate-400 border border-slate-700";
    corrColor = "text-slate-400";
    corrSummaryPart = ` Post-anchor correlation is calibrating (first 10 bars post-anchor suppressed for statistical confidence).`;
  }

  summary += corrSummaryPart;

  return {
    isLatest: false,
    elapsedStr: elapsedStr,
    spotNetPct: spotNetPct,
    spotNetPts: spotNetPts,
    volNetPt: volNetPt,
    tag: tag,
    badgeClass: badgeClass,
    summary: summary,
    anchorTime: times[anchorIdx],
    corrStr: corrStr,
    corrRegime: corrRegime,
    corrBadgeClass: corrBadgeClass,
    corrColor: corrColor,
    corrVal: corrVal
  };
}

function updateAnchorUI() {
  const isNdx = (currentAssetPair === 'NDX');
  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';

  const spotLowLabel = document.getElementById('anchor-spot-low-label');
  if (spotLowLabel) spotLowLabel.textContent = `${assetLabel} Low`;
  const volHighLabel = document.getElementById('anchor-vol-high-label');
  if (volHighLabel) volHighLabel.textContent = `${volLabel} High`;

  const pill = document.getElementById('anchor-status-pill');
  const banner = document.getElementById('corr-recovery-banner');
  const btnOpen = document.getElementById('btn-anchor-open');
  const btnSpotLow = document.getElementById('btn-anchor-spot-low');
  const btnVolHigh = document.getElementById('btn-anchor-vol-high');
  const btnCustom = document.getElementById('btn-anchor-custom-toggle');

  [btnOpen, btnSpotLow, btnVolHigh, btnCustom].forEach(btn => {
    if (btn) btn.className = "px-2 py-1 rounded text-slate-400 hover:text-white transition flex items-center space-x-1";
  });

  if (!corrAnchor.active) {
    if (pill) {
      pill.textContent = "Session Baseline";
      pill.className = "text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-medium";
    }
    if (btnOpen) btnOpen.className = "px-2 py-1 rounded text-cyan-400 font-semibold bg-slate-800 shadow-sm transition hover:text-white";
    if (banner) {
      banner.innerHTML = `<span class="text-slate-500 text-[11px] font-sans">Baseline from open. Select <strong>[${assetLabel} Low]</strong> or <strong>[${volLabel} High]</strong>, or click chart to analyze recovery leader.</span>`;
    }
    return;
  }

  if (pill) {
    pill.textContent = corrAnchor.label;
    pill.className = "text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold";
  }

  if (corrAnchor.mode === 'spot_low' && btnSpotLow) {
    btnSpotLow.className = "px-2 py-1 rounded text-emerald-400 font-semibold bg-emerald-950/80 border border-emerald-800 shadow-sm transition flex items-center space-x-1";
  } else if (corrAnchor.mode === 'vol_high' && btnVolHigh) {
    btnVolHigh.className = "px-2 py-1 rounded text-amber-400 font-semibold bg-amber-950/80 border border-amber-800 shadow-sm transition flex items-center space-x-1";
  } else if (corrAnchor.mode === 'custom' && btnCustom) {
    btnCustom.className = "px-2 py-1 rounded text-cyan-400 font-semibold bg-cyan-950/80 border border-cyan-800 shadow-sm transition flex items-center space-x-1";
  }
}

function computeZeroAlignedDualRanges(assetPct, volPt, isVolInverted, isBeta = isBetaScaled, beta = 1.98) {
  let y1Min = 0, y1Max = 0;
  for (let i = 0; i < assetPct.length; i++) {
    const v = assetPct[i];
    if (typeof v === 'number' && !isNaN(v)) {
      if (v < y1Min) y1Min = v;
      if (v > y1Max) y1Max = v;
    }
  }

  let y2Min = 0, y2Max = 0;
  for (let i = 0; i < volPt.length; i++) {
    const v = volPt[i];
    if (typeof v === 'number' && !isNaN(v)) {
      if (v < y2Min) y2Min = v;
      if (v > y2Max) y2Max = v;
    }
  }

  const pad = 1.15;
  // Extent above and below zero for Axis 1 (Spot %: normal upright orientation)
  const e1Up = Math.max(y1Max, 0.05) * pad;
  const e1Dn = Math.max(-y1Min, 0.05) * pad;

  // Extent above and below zero for Axis 2 (Vol pt)
  // When inverted: negative values (vol crush) go UP, positive values (vol spike) go DOWN
  const e2Up = isVolInverted ? Math.max(-y2Min, 0.1) * pad : Math.max(y2Max, 0.1) * pad;
  const e2Dn = isVolInverted ? Math.max(y2Max, 0.1) * pad : Math.max(-y2Min, 0.1) * pad;

  // Determine balanced zero position alpha in (0, 1), representing fraction from bottom of subplot
  const alpha1 = e1Dn / (e1Dn + e1Up);
  const alpha2 = e2Dn / (e2Dn + e2Up);
  let alpha = (alpha1 + alpha2) / 2.0;
  alpha = Math.max(0.15, Math.min(0.85, alpha));

  // Determine total span for each axis to ensure neither clips data
  let R1 = Math.max(e1Up / (1.0 - alpha), e1Dn / alpha);
  let R2 = Math.max(e2Up / (1.0 - alpha), e2Dn / alpha);

  // If Beta Scaled: couple the spans so 1% Spot equals beta points of Vol
  if (isBeta && typeof beta === 'number' && beta > 0.1) {
    const R_master = Math.max(R1, R2 / beta);
    R1 = R_master;
    R2 = R_master * beta;
  }

  // Left axis (Spot %): bottom is negative, top is positive
  let range1 = [-R1 * alpha, R1 * (1.0 - alpha)];

  // Right axis (Vol pt):
  // If inverted: bottom is positive (panic), top is negative (crush)
  // If normal: bottom is negative, top is positive
  let range2 = isVolInverted 
    ? [R2 * alpha, -R2 * (1.0 - alpha)] 
    : [-R2 * alpha, R2 * (1.0 - alpha)];

  // Guard against non-finite bounds
  if (!isFinite(range1[0]) || !isFinite(range1[1])) range1 = [-5, 5];
  if (!isFinite(range2[0]) || !isFinite(range2[1])) range2 = isVolInverted ? [10, -10] : [-10, 10];

  return { range1, range2, alpha };
}

function computeDualRibbonSeries(times, assetPct, volPt, beta, alpha = 0) {
  if (!times || times.length === 0 || !assetPct || !volPt) return null;

  const vScaled = volPt.map(v => (typeof v === 'number' && !isNaN(v)) ? ((-v + alpha) / beta) : null);

  const vArr = [];
  const minArr = [];
  const maxArr = [];

  for (let i = 0; i < times.length; i++) {
    const s = assetPct[i];
    const v = vScaled[i];

    vArr.push(v);
    if (typeof s === 'number' && !isNaN(s) && typeof v === 'number' && !isNaN(v)) {
      minArr.push(Math.min(s, v));
      maxArr.push(Math.max(s, v));
    } else {
      minArr.push(null);
      maxArr.push(null);
    }
  }

  return { xArr: times, vArr, minArr, maxArr };
}

function renderCorrelationChart(modeOrTf = 'dual', tf = null) {
  let targetTf = currentCorrTf;
  if (tf) {
    targetTf = tf;
  } else if (modeOrTf && TF_CONFIG[modeOrTf]) {
    targetTf = modeOrTf;
  }
  const isNdx = (currentAssetPair === 'NDX');
  const c = isNdx ? (cachedCorrNdx[targetTf] || cachedCorrNdx['1D'] || cachedCorrNdx) : (cachedCorr[targetTf] || cachedCorr['1D'] || cachedCorr);
  const times = c.times || [];
  const rollingCorr = c.rolling_corr || [];

  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';

  // Compute Anchored Series (or baseline if anchor not active)
  const anchoredSeries = computeAnchoredSeries(c, isNdx);
  const assetPct = anchoredSeries.spotPct;
  const volPt = anchoredSeries.volPt;
  const isAnchored = anchoredSeries.isAnchored;

  // Evaluate Recovery Leader Diagnostics & update banner
  const diag = evaluateRecoveryLeader(anchoredSeries, isNdx);
  const banner = document.getElementById('corr-recovery-banner');
  if (banner) {
    if (isAnchored && diag) {
      const spotSign = diag.spotNetPct >= 0 ? '+' : '';
      const volSign = diag.volNetPt >= 0 ? '+' : '';
      const spotColor = diag.spotNetPct >= 0 ? 'text-emerald-400' : 'text-rose-400';
      const volColor = diag.volNetPt <= 0 ? 'text-emerald-400' : 'text-amber-400';

      banner.innerHTML = `
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-slate-400">⏱️ Elapsed: <strong class="text-white">${diag.elapsedStr}</strong></span>
          <span class="text-slate-700">|</span>
          <span>${assetLabel}: <strong class="${spotColor}">${spotSign}${diag.spotNetPct.toFixed(2)}%</strong> <span class="text-slate-400 text-[10px]">(${spotSign}${diag.spotNetPts.toFixed(1)} pts)</span></span>
          <span class="text-slate-700">|</span>
          <span>${volLabel}: <strong class="${volColor}">${volSign}${diag.volNetPt.toFixed(2)} pts</strong></span>
          <span class="text-slate-700">|</span>
          <span title="Post-anchor cumulative Pearson correlation on log returns strictly since anchor point">⚓ Recovery ρ: <strong class="${diag.corrColor}">${diag.corrStr}</strong> <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${diag.corrBadgeClass}">${diag.corrRegime}</span></span>
          <span class="text-slate-700">|</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${diag.badgeClass}">${diag.tag}</span>
          <span class="text-[10px] text-slate-300 font-sans hidden lg:inline font-normal">(${diag.summary})</span>
        </div>
      `;
    } else {
      banner.innerHTML = `<span class="text-slate-500 text-[11px] font-sans">Baseline from open. Select <strong>[${assetLabel} Low]</strong> or <strong>[${volLabel} High]</strong>, or click chart to analyze recovery leader &amp; post-anchor correlation.</span>`;
    }
  }

  const dStart = times.length > 0 ? times[0] : '';
  const dEnd = times.length > 0 ? times[times.length - 1] : '';

  // Dynamic Pearson upper bound: 0.05 by default (framing 0.0 Decoupling line at top), expanding only if ρ > 0
  let maxCorrVal = -0.7;
  for (let i = 0; i < rollingCorr.length; i++) {
    const v = rollingCorr[i];
    if (typeof v === 'number' && !isNaN(v) && v > maxCorrVal) maxCorrVal = v;
  }
  if (isAnchored && anchoredSeries.anchoredCorr) {
    const ac = anchoredSeries.anchoredCorr;
    for (let i = 0; i < ac.length; i++) {
      const v = ac[i];
      if (typeof v === 'number' && !isNaN(v) && v > maxCorrVal) maxCorrVal = v;
    }
  }
  const upperY = maxCorrVal > 0 ? Math.min(1.05, Math.ceil((maxCorrVal + 0.05) * 10) / 10) : 0.05;

  const conf = TF_CONFIG[targetTf] || TF_CONFIG['1D'];
  const xTitle = conf.xTitle;
  const tickformat = conf.tickformat;
  const rangebreaks = conf.rangebreaks || [];
  const corrTraceName = conf.corrTraceName;
  const corrHoverLabel = conf.corrHoverLabel;
  const timeHoverFmt = conf.timeHoverFmt;
  let assetHoverLabel = isAnchored ? `${assetLabel} from Anchor` : `${assetLabel} Move (${conf.label})`;
  let volHoverLabel = isAnchored ? `${volLabel} from Anchor` : `${volLabel} Move (${conf.label})`;

  const assetColor = isNdx ? '#C084FC' : '#10B981';
  const volColor = '#F59E0B';
  const corrColor = isNdx ? '#A855F7' : '#00E5FF';

  // Common anchor shapes & annotations
  const anchorShapes = isAnchored && anchoredSeries.anchorTime ? [
    {
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: anchoredSeries.anchorTime,
      x1: anchoredSeries.anchorTime,
      y0: 0,
      y1: 1,
      line: {
        color: '#00E5FF',
        width: 2,
        dash: 'dashdot'
      }
    }
  ] : [];

  const anchorTimeFormatted = anchoredSeries.anchorTime 
    ? (targetTf === '1D' 
        ? (anchoredSeries.anchorTime.length > 10 ? anchoredSeries.anchorTime.slice(11) : anchoredSeries.anchorTime)
        : (anchoredSeries.anchorTime.length > 10 ? anchoredSeries.anchorTime.slice(5) : anchoredSeries.anchorTime))
    : '';

  const anchorAnnotations = isAnchored && anchoredSeries.anchorTime ? [
    {
      xref: 'x',
      yref: 'paper',
      x: anchoredSeries.anchorTime,
      y: 1.05,
      text: `⚓ Anchor: ${anchorTimeFormatted}`,
      showarrow: false,
      font: { color: '#00E5FF', size: 10, family: 'monospace' },
      bgcolor: 'rgba(15, 23, 42, 0.9)',
      bordercolor: '#00E5FF',
      borderwidth: 1,
      borderpad: 3
    }
  ] : [];

  // 60-Day Macro Baseline Spot-Vol Slope & Intercept from Overvix model
  let rawSlope = -1.9796;
  let rawIntercept = 0.0622;
  if (cachedBootstrap) {
    if (isNdx && cachedBootstrap.ndx && cachedBootstrap.ndx.model) {
      if (typeof cachedBootstrap.ndx.model.slope === 'number') rawSlope = cachedBootstrap.ndx.model.slope;
      if (typeof cachedBootstrap.ndx.model.intercept === 'number') rawIntercept = cachedBootstrap.ndx.model.intercept;
    } else if (cachedBootstrap.model) {
      if (typeof cachedBootstrap.model.slope === 'number') rawSlope = cachedBootstrap.model.slope;
      if (typeof cachedBootstrap.model.intercept === 'number') rawIntercept = cachedBootstrap.model.intercept;
    }
  } else if (isNdx) {
    rawSlope = -1.3712;
    rawIntercept = 0.0;
  }
  const beta = Math.abs(rawSlope) > 0.05 ? Math.abs(rawSlope) : 1.98;

  // Sync button label with active beta
  if (corrScaleLabel && isBetaScaled) {
    corrScaleLabel.textContent = `Beta Scale (1:${beta.toFixed(2)})`;
  }

  const dualRanges = computeZeroAlignedDualRanges(assetPct, volPt, isVolInverted, isBetaScaled, beta);

  // Subplot 1: Asset % Move (left axis) vs Vol pt move (right axis)
  const assetCustomdata = times.map((t, i) => {
    const raw = (anchoredSeries.spotRaw && anchoredSeries.spotRaw[i] !== undefined)
      ? (typeof anchoredSeries.spotRaw[i] === 'number' ? anchoredSeries.spotRaw[i].toFixed(2) : anchoredSeries.spotRaw[i])
      : '-';
    const s = assetPct[i];
    const sStr = (typeof s === 'number' && !isNaN(s)) ? (s >= 0 ? `+${s.toFixed(2)}` : s.toFixed(2)) : '-';
    return [raw, sStr];
  });

  const traceAsset = {
    x: times,
    y: assetPct,
    customdata: assetCustomdata,
    name: isAnchored ? `${assetLabel} % (Anchored)` : `${assetLabel} % Move`,
    mode: 'lines',
    line: { color: assetColor, width: 1.8 },
    xaxis: 'x',
    yaxis: 'y',
    hovertemplate: isAnchored 
      ? `<b>%{x|${timeHoverFmt}}</b><br>${assetHoverLabel}: %{customdata[1]}%<br>Price: %{customdata[0]}<extra></extra>`
      : `<b>%{x|${timeHoverFmt}}</b><br>${assetHoverLabel}: %{customdata[1]}%<extra></extra>`
  };

  // Shaded Divergence Ribbon: dual-color fill area between Spot % and Vol (in % units) when Beta Scaled and Invert Vol are active
  // Green when Spot > Vol (Positive Overvix Residual: Spot outperformed / Vol crushed)
  // Red when Spot < Vol (Negative Overvix Residual: Vol spiked / panic)
  let dualRibbonTraces = null;
  if (isBetaScaled && isVolInverted && times.length > 0) {
    const alpha = (!isAnchored && targetTf === '1D') ? rawIntercept : 0;
    const ribbonData = computeDualRibbonSeries(times, assetPct, volPt, beta, alpha);
    if (ribbonData && ribbonData.xArr.length > 0) {
      const traceVolRef1 = {
        x: ribbonData.xArr,
        y: ribbonData.vArr,
        mode: 'lines',
        line: { color: 'transparent', width: 0 },
        xaxis: 'x',
        yaxis: 'y',
        hoverinfo: 'none',
        showlegend: false
      };
      const traceRedRibbon = {
        x: ribbonData.xArr,
        y: ribbonData.minArr,
        mode: 'lines',
        line: { color: 'transparent', width: 0 },
        fill: 'tonexty',
        fillcolor: 'rgba(244, 63, 94, 0.22)', // Red when Spot < Vol (Negative Overvix residual)
        xaxis: 'x',
        yaxis: 'y',
        hoverinfo: 'none',
        showlegend: false
      };
      const traceVolRef2 = {
        x: ribbonData.xArr,
        y: ribbonData.vArr,
        mode: 'lines',
        line: { color: 'transparent', width: 0 },
        xaxis: 'x',
        yaxis: 'y',
        hoverinfo: 'none',
        showlegend: false
      };
      const traceGreenRibbon = {
        x: ribbonData.xArr,
        y: ribbonData.maxArr,
        mode: 'lines',
        line: { color: 'transparent', width: 0 },
        fill: 'tonexty',
        fillcolor: 'rgba(16, 185, 129, 0.22)', // Green when Spot > Vol (Positive Overvix residual)
        xaxis: 'x',
        yaxis: 'y',
        hoverinfo: 'none',
        showlegend: false
      };
      dualRibbonTraces = [traceVolRef1, traceRedRibbon, traceVolRef2, traceGreenRibbon];
    }
  }

  // Vol Customdata: [volRaw, instantaneous Overvix residual, volPtStr]
  const volCustomdata = times.map((t, i) => {
    const raw = (anchoredSeries.volRaw && anchoredSeries.volRaw[i] !== undefined) 
      ? (typeof anchoredSeries.volRaw[i] === 'number' ? anchoredSeries.volRaw[i].toFixed(2) : anchoredSeries.volRaw[i]) 
      : '-';
    const sPct = assetPct[i] || 0;
    const vPt = volPt[i] || 0;
    // Expected VIX move = alpha + slope * sPct = alpha - beta * sPct
    // For 1D unanchored session baseline, alpha is the daily intercept from the baseline regression
    const alpha = (!isAnchored && targetTf === '1D') ? rawIntercept : 0;
    // Overvix residual = vPt - (alpha - beta * sPct) = vPt - alpha + beta * sPct
    const resid = vPt - alpha + beta * sPct;
    const residStr = (resid >= 0 ? `+${resid.toFixed(2)}` : resid.toFixed(2));
    const vPtStr = (typeof vPt === 'number' && !isNaN(vPt)) ? (vPt >= 0 ? `+${vPt.toFixed(2)}` : vPt.toFixed(2)) : '-';
    return [raw, residStr, vPtStr];
  });

  const traceVol = {
    x: times,
    y: volPt,
    customdata: volCustomdata,
    name: isVolInverted 
      ? (isAnchored ? `${volLabel} Pt (Anchored Inv)` : `${volLabel} Point Move (Inv)`) 
      : (isAnchored ? `${volLabel} Pt (Anchored)` : `${volLabel} Point Move`),
    mode: 'lines',
    line: { color: volColor, width: 1.8 },
    xaxis: 'x',
    yaxis: 'y2',
    hovertemplate: isBetaScaled
      ? (isAnchored 
          ? `<b>%{x|${timeHoverFmt}}</b><br>${volHoverLabel}: %{customdata[2]} pts<br>Level: %{customdata[0]}<br>Overvix Residual: %{customdata[1]} pts<extra></extra>`
          : `<b>%{x|${timeHoverFmt}}</b><br>${volHoverLabel}: %{customdata[2]} pts<br>Overvix Residual: %{customdata[1]} pts<extra></extra>`)
      : (isAnchored 
          ? `<b>%{x|${timeHoverFmt}}</b><br>${volHoverLabel}: %{customdata[2]} pts<br>Level: %{customdata[0]}<extra></extra>`
          : `<b>%{x|${timeHoverFmt}}</b><br>${volHoverLabel}: %{customdata[2]} pts<extra></extra>`)
  };

    // Subplot 2: Rolling Pearson Correlation (Background context when anchored)
    const traceCorr = {
      x: times,
      y: rollingCorr,
      name: isAnchored ? `Rolling Context (${corrTraceName})` : corrTraceName,
      mode: 'lines',
      line: { 
        color: isAnchored ? (isNdx ? 'rgba(168, 85, 247, 0.40)' : 'rgba(0, 229, 255, 0.40)') : corrColor, 
        width: isAnchored ? 1.5 : 2,
        dash: isAnchored ? 'dot' : 'solid'
      },
      xaxis: 'x',
      yaxis: 'y3',
      hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>${corrHoverLabel}: %{y:.3f}<extra></extra>`
    };

    // Anchored Recovery Correlation (Foreground recovery trajectory strictly since anchor)
    // Suppressed during first 10 bars post-anchor where statistical confidence is low
    const hasAnchoredCorr = isAnchored && anchoredSeries.anchoredCorr && (anchoredSeries.latestAnchoredCorr !== null);
    const traceAnchoredCorr = hasAnchoredCorr ? {
      x: times,
      y: anchoredSeries.anchoredCorr,
      name: `Anchored Recovery ρ (${assetLabel}, ${volLabel})`,
      mode: 'lines',
      line: { color: '#F59E0B', width: 2.8 },
      xaxis: 'x',
      yaxis: 'y3',
      hovertemplate: `<b>%{x|${timeHoverFmt}}</b><br>⚓ Anchored Recovery ρ: %{y:.3f}<extra></extra>`
    } : null;

    const traceZero = {
      x: [dStart, dEnd],
      y: [0.0, 0.0],
      mode: 'lines',
      name: 'Decoupling Line (0.0)',
      line: { color: '#EF4444', width: 1.5, dash: 'dash' },
      xaxis: 'x',
      yaxis: 'y3',
      showlegend: false,
      hoverinfo: 'none'
    };

    const traceStress = {
      x: [dStart, dEnd],
      y: [-0.50, -0.50],
      mode: 'lines',
      name: 'Regime Shift (-0.50)',
      line: { color: '#F59E0B', width: 1.5, dash: 'dot' },
      xaxis: 'x',
      yaxis: 'y3',
      showlegend: false,
      hoverinfo: 'none'
    };

    const traceBaseline = {
      x: [dStart, dEnd],
      y: [-0.75, -0.75],
      mode: 'lines',
      name: 'Normal Band (-0.70 to -0.85)',
      line: { color: '#10B981', width: 1, dash: 'dot' },
      xaxis: 'x',
      yaxis: 'y3',
      showlegend: false,
      hoverinfo: 'none'
    };

    // Anchor Origin Marker: glowing cyan dot at (anchorTime, 0.0) where both curves start
    const traceAnchorOrigin = (isAnchored && anchoredSeries.anchorTime) ? {
      x: [anchoredSeries.anchorTime],
      y: [0.0],
      mode: 'markers',
      name: '⚓ Anchor (0, 0)',
      marker: {
        color: '#00E5FF',
        size: 9,
        symbol: 'circle',
        line: { color: '#FFFFFF', width: 2 }
      },
      xaxis: 'x',
      yaxis: 'y',
      hovertemplate: `<b>⚓ Anchor Origin Point</b><br>Time: %{x|${timeHoverFmt}}<br>${assetLabel}: 0.00%<br>${volLabel}: 0.00 pts<extra></extra>`,
      showlegend: false
    } : null;

    const plotTraces = [];
    if (dualRibbonTraces && dualRibbonTraces.length > 0) {
      plotTraces.push(...dualRibbonTraces);
    }
    plotTraces.push(traceAsset, traceVol, traceCorr);
    if (traceAnchoredCorr) {
      plotTraces.push(traceAnchoredCorr);
    }
    plotTraces.push(traceZero, traceStress, traceBaseline);
    if (traceAnchorOrigin) {
      plotTraces.push(traceAnchorOrigin);
    }

    const layout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      autosize: true,
      hovermode: 'x',
      dragmode: false,
      clickmode: 'event',
      hoverdistance: 50,
      margin: { l: 55, r: 60, t: 25, b: 35 },
      xaxis: {
        anchor: 'y3',
        type: 'date',
        rangebreaks: rangebreaks,
        tickformat: tickformat,
        title: { text: xTitle, font: { color: '#94A3B8', size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: '#94A3B8', size: 10 },
        showgrid: true,
        nticks: 10,
        fixedrange: true,
        showspikes: true,
        spikemode: 'across',
        spikesnap: 'cursor',
        spikecolor: '#00E5FF',
        spikethickness: 1,
        spikedash: 'dot'
      },
      yaxis: {
        domain: [0.48, 1.0],
        title: { 
          text: isAnchored ? `${assetLabel} % Since Anchor` : `${assetLabel} % Move`, 
          font: { color: assetColor, size: 10 } 
        },
        range: dualRanges.range1,
        autorange: false,
        zeroline: true,
        zerolinecolor: 'rgba(148, 163, 184, 0.4)',
        zerolinewidth: 1,
        zerolinedash: 'dash',
        gridcolor: '#1e293b',
        tickfont: { color: assetColor, size: 10 },
        fixedrange: true
      },
      yaxis2: {
        domain: [0.48, 1.0],
        title: { 
          text: isAnchored 
            ? (isVolInverted 
                ? `${volLabel} Pt Since Anchor (Inv ▼)${isBetaScaled ? ` [β=${beta.toFixed(2)}]` : ''}` 
                : `${volLabel} Pt Since Anchor${isBetaScaled ? ` [β=${beta.toFixed(2)}]` : ''}`)
            : (isVolInverted 
                ? `${volLabel} Point Move (Inv ▼)${isBetaScaled ? ` [β=${beta.toFixed(2)}]` : ''}` 
                : `${volLabel} Point Move${isBetaScaled ? ` [β=${beta.toFixed(2)}]` : ''}`), 
          font: { color: volColor, size: 10 } 
        },
        overlaying: 'y',
        side: 'right',
        range: dualRanges.range2,
        autorange: false,
        zeroline: false,
        gridcolor: 'transparent',
        tickfont: { color: volColor, size: 10 },
        fixedrange: true
      },
      yaxis3: {
        domain: [0.0, 0.40],
        title: { text: 'Rolling ρ', font: { color: corrColor, size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: '#94A3B8', size: 10 },
        range: [-1.05, upperY],
        fixedrange: true
      },
      legend: {
        orientation: 'h',
        x: 0,
        y: 1.12,
        font: { color: '#94A3B8', size: 10 }
      },
      shapes: anchorShapes,
      annotations: anchorAnnotations,
      showlegend: true
    };

  Plotly.newPlot('correlation-chart', plotTraces, layout, {
    responsive: true,
    displayModeBar: false
  }).then(attachCorrelationChartClickListener);
}

let lastAnchorClickTimestamp = 0;

function attachCorrelationChartClickListener() {
  const chartEl = document.getElementById('correlation-chart');
  if (!chartEl) return;

  // Re-bind plotly_click on the chart element (Plotly.newPlot clears internal events on gd)
  if (typeof chartEl.removeAllListeners === 'function') {
    chartEl.removeAllListeners('plotly_click');
  }
  chartEl.on('plotly_click', function(eventData) {
    if (Date.now() - lastAnchorClickTimestamp < 300) return;
    if (eventData && eventData.points && eventData.points.length > 0) {
      const pt = eventData.points[0];
      if (pt && pt.x !== undefined && pt.x !== null) {
        lastAnchorClickTimestamp = Date.now();
        setCorrAnchor('custom', pt.x);
      }
    }
  });

  // Attach native DOM click listener to chart container once as bulletproof fallback
  if (!chartEl._hasDomClickListener) {
    chartEl._hasDomClickListener = true;
    chartEl.addEventListener('click', function(e) {
      if (Date.now() - lastAnchorClickTimestamp < 300) return;

      // Ignore clicks on legend items or plotly modebar controls
      if (e.target && (e.target.closest('.legend') || e.target.closest('.modebar') || e.target.closest('.hovertext'))) {
        return;
      }

      const fl = chartEl._fullLayout;
      if (!fl || !fl.xaxis) return;

      const rect = chartEl.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const xaxis = fl.xaxis;

      const xOffset = (xaxis._offset !== undefined) ? xaxis._offset : 50;
      const xLength = (xaxis._length !== undefined) ? xaxis._length : (rect.width - 100);

      if (clickX >= xOffset && clickX <= xOffset + xLength) {
        // Try axis coordinate conversion first
        if (typeof xaxis.p2c === 'function') {
          const dataCoord = xaxis.p2c(clickX - xOffset);
          if (dataCoord !== undefined && dataCoord !== null) {
            lastAnchorClickTimestamp = Date.now();
            setCorrAnchor('custom', dataCoord);
            return;
          }
        }

        // Secondary fallback: proportional index across session times
        const isNdx = (currentAssetPair === 'NDX');
        const c = isNdx ? (cachedCorrNdx[currentCorrTf] || cachedCorrNdx['1D'] || cachedCorrNdx) : (cachedCorr[currentCorrTf] || cachedCorr['1D'] || cachedCorr);
        const times = (c && c.times) ? c.times : [];
        if (times.length > 0) {
          lastAnchorClickTimestamp = Date.now();
          const frac = Math.max(0, Math.min(1, (clickX - xOffset) / xLength));
          const idx = Math.round(frac * (times.length - 1));
          setCorrAnchor('custom', times[idx]);
        }
      }
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

    // Detect session rollover, RTH open transition, or periodic historical bar update
    if (currentViewMode === 'live') {
      const incomingDate = data.session_date;
      const incomingRth = data.is_rth_active;
      const incomingHistVer = data.hist_version;

      const sessionRolled = cachedActiveSessionDate && incomingDate && (incomingDate !== cachedActiveSessionDate);
      const rthOpened = (cachedIsRthActive === false && incomingRth === true);
      const histUpdated = (cachedHistVersion !== undefined && incomingHistVer !== undefined && incomingHistVer > cachedHistVersion);

      if (sessionRolled || rthOpened || histUpdated) {
        console.log(`[Auto-Sync] Triggering dashboard refresh: sessionRolled=${sessionRolled}, rthOpened=${rthOpened}, histUpdated=${histUpdated}`);
        cachedActiveSessionDate = incomingDate;
        cachedIsRthActive = incomingRth;
        if (incomingHistVer !== undefined) cachedHistVersion = incomingHistVer;
        bootstrapData();
        return;
      }
      if (incomingDate) cachedActiveSessionDate = incomingDate;
      if (incomingRth !== undefined) cachedIsRthActive = incomingRth;
      if (incomingHistVer !== undefined) cachedHistVersion = incomingHistVer;
    }

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
      stripSpread.className = (techVol.spread >= 9.0) ? "text-red-400 font-bold animate-pulse" : (techVol.spread >= 6.5 ? "text-amber-400 font-bold" : "text-emerald-400 font-bold");
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
    const isTechSpreadPanic = (techVol && (techVol.spread >= 9.0 || techVol.ratio >= 1.50));
    const isTechSpreadElevated = (techVol && (techVol.spread >= 6.5 || techVol.ratio >= 1.35));
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
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-red-950/80 border border-red-700 beacon-alert transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-red-600 text-white animate-pulse";
      confBadge.textContent = "🚨 TECH PANIC SPREAD";
      confDesc.textContent = `Acute Tech Vol Shock: VXN - VIX spread is ${fmtPts(techVol.spread)} pts (${fmtNum(techVol.ratio, 3)}x ≥ 95th percentile panic threshold).`;
    } else if (isTechSpreadElevated) {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-950/80 border border-amber-700 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-amber-600 text-black";
      confBadge.textContent = "⚠️ ELEVATED TECH VOL";
      confDesc.textContent = `Elevated Tech Vol Premium: VXN - VIX spread is ${fmtPts(techVol.spread)} pts (${fmtNum(techVol.ratio, 3)}x vs ~1.28x equilibrium).`;
    } else if (ts.is_inverted) {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-950/80 border border-amber-700 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-amber-600 text-black";
      confBadge.textContent = "⚠️ BACKWARDATION";
      confDesc.textContent = `Macro Vol Term Structure Inverted: VIX / VIX3M (${fmtNum(ts.ratio, 4)}) ≥ 1.00.`;
    } else {
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-purple-950 text-purple-300 border border-purple-800";
      confBadge.textContent = "🟢 NORMAL TECH REGIME";
      confDesc.textContent = `Normal tech spot-vol pricing (${fmtPts(ndxOv.residual_pts)} pts). Tech vol spread: ${fmtPts(techVol ? techVol.spread : 0)} pts (${fmtNum(techVol ? techVol.ratio : 1.0, 3)}x).`;
    }

    if ((isDualNdx || isTechSpreadPanic) && (!lastOvervixSignal || !lastInversionSignal)) {
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
    vix3mPtEl.className = `text-xs font-mono font-medium mt-0.5 ${spreadVal >= 9.0 ? 'text-red-400 font-bold' : (spreadVal >= 6.5 ? 'text-amber-400 font-bold' : 'text-emerald-400')}`;

    document.getElementById('lbl-kpi-ratio').textContent = "VXN / VIX";
    const techRatioVal = techVol ? techVol.ratio : 1.0;
    document.getElementById('kpi-ratio-val').textContent = fmtNum(techRatioVal, 4);
    document.getElementById('lbl-kpi-ratio-sub').textContent = "Equilibrium ~ 1.25x – 1.30x";
    if (spreadVal >= 9.0 || techRatioVal >= 1.50) {
      ratioBadge.textContent = 'TECH PANIC';
      ratioBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-red-900/80 text-red-200 uppercase font-semibold border border-red-700 animate-pulse';
    } else if (spreadVal >= 6.5 || techRatioVal >= 1.35) {
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

    const ndxThresh = (ndxMod && ndxMod.threshold_pts) || currentNdxThreshold;
    const dispThreshNdxEl = document.getElementById('disp-thresh-pts');
    if (dispThreshNdxEl) dispThreshNdxEl.textContent = ndxThresh.toFixed(1);

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

    const spxThresh = (mod && mod.threshold_pts) || currentSpxThreshold;
    const dispThreshSpxEl = document.getElementById('disp-thresh-pts');
    if (dispThreshSpxEl) dispThreshSpxEl.textContent = spxThresh.toFixed(1);

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
    let corrVal = null;
    const m = (isNdx && cachedCorrNdx.metrics) ? cachedCorrNdx.metrics : (cachedCorr.metrics || {});
    if (m[currentCorrTf] !== undefined && m[currentCorrTf] !== null) {
      corrVal = m[currentCorrTf];
    } else {
      const c = isNdx ? cachedCorrNdx : cachedCorr;
      const ds = c[currentCorrTf];
      if (ds && ds.rolling_corr && ds.rolling_corr.length > 0) {
        corrVal = ds.rolling_corr[ds.rolling_corr.length - 1];
      }
    }
    if (corrVal === null || corrVal === undefined) {
      corrVal = (currentCorrTf === '1D') ? activeCorrObj.rolling_corr : ((currentCorrTf === '5D') ? (activeCorrObj.corr_5d || activeCorrObj.rolling_corr) : (activeCorrObj.corr_1y || activeCorrObj.rolling_corr));
    }
    const corrPill = document.getElementById('corr-status-pill');
    if (corrPill) {
      if (corrVal <= -0.50) {
        corrPill.textContent = `Normal Inverse (ρ = ${fmtNum(corrVal, 3)})`;
        corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800";
        corrPill.title = "Typical baseline oscillating between -0.70 and -0.85 (Regime Indicator)";
      } else if (corrVal < 0.0) {
        corrPill.textContent = `Stress / Shift (ρ = ${fmtNum(corrVal, 3)})`;
        corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 animate-pulse";
        corrPill.title = "Broke above -0.50: Vol-of-vol stress, call-buying frenzy, or dealer repositioning";
      } else {
        corrPill.textContent = `Positive Decoupling (ρ = ${fmtNum(corrVal, 3)})`;
        corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-red-950 text-red-400 border border-red-800 animate-pulse";
        corrPill.title = "Positive correlation: Spot and Vol moving in tandem (extreme stress / frenzy)";
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
    document.getElementById('last-update-time').textContent = `Updated: ${data.timestamp ? data.timestamp + ' ET' : now.toLocaleTimeString()}`;
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
      'marker.color': [isTargetOvervixed ? '#FF1744' : '#00E5FF']
    }, [5]);

    // Dynamically append live point to intraday trail during RTH
    if (isLiveRth && cachedTrail && data.datetime) {
      if (!cachedTrail.x) cachedTrail.x = [];
      if (!cachedTrail.y) cachedTrail.y = [];
      if (!cachedTrail.times) cachedTrail.times = [];

      const liveDt = data.datetime;
      const n = cachedTrail.times.length;
      if (n > 0 && (cachedTrail.times[n - 1] === liveDt || cachedTrail.times[n - 1].slice(11, 16) === liveDt.slice(11, 16))) {
        cachedTrail.x[n - 1] = activePt.x;
        cachedTrail.y[n - 1] = activePt.y;
      } else {
        cachedTrail.x.push(activePt.x);
        cachedTrail.y.push(activePt.y);
        cachedTrail.times.push(liveDt);
      }
      Plotly.restyle('overvix-chart', {
        x: [cachedTrail.x],
        y: [cachedTrail.y],
        text: [cachedTrail.times]
      }, [4]);
    }
  }

  // 6. Update Intraday Term Structure / Tech Vol Real-Time (when 1D is active)
  if (currentTimeframe === '1D' && data.datetime) {
    const liveDt = data.datetime;
    const isLiveRth = (data.is_rth_active === true);

    if (isLiveRth) {
      const liveDate = liveDt.slice(0, 10);
      if (isNdx && techVol) {
        let dt = cachedTechVol['1D'];
        if (!dt || !dt.times) {
          cachedTechVol['1D'] = { times: [], vxn: [], vix: [], spread: [], ratio: [] };
          dt = cachedTechVol['1D'];
        }
        const vxnVal = (ndx && ndx.market && ndx.market.vxn) ? ndx.market.vxn.current : 0;
        if (dt.times.length > 0) {
          const lastT = dt.times[dt.times.length - 1];
          const lastDate = lastT.slice(0, 10);
          if (liveDate === lastDate) {
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
          } else {
            // New date session: reset 1D to today
            dt.times = [liveDt];
            dt.vxn = [vxnVal];
            dt.vix = [mkt.vix.current];
            dt.spread = [techVol.spread];
            dt.ratio = [techVol.ratio];
          }
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
        if (dt.times.length > 0) {
          Plotly.restyle('term-structure-chart', {
            x: [[dt.times[0], liveDt], [dt.times[0], liveDt]]
          }, [3, 4]);
        }
      } else {
        let d1 = cachedTs['1D'];
        if (!d1 || !d1.times) {
          cachedTs['1D'] = { times: [], vix: [], vix3m: [], ratio: [] };
          d1 = cachedTs['1D'];
        }
        if (d1.times.length > 0) {
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
          } else {
            // New date session: reset 1D to today
            d1.times = [liveDt];
            d1.vix = [mkt.vix.current];
            d1.vix3m = [mkt.vix3m.current];
            d1.ratio = [ts.ratio];
          }
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
        if (d1.times.length > 0) {
          Plotly.restyle('term-structure-chart', {
            x: [[d1.times[0], liveDt], [d1.times[0], liveDt]]
          }, [3, 4]);
        }
      }
    }
  }

  // 7. Update Intraday Correlation Real-Time (when 1D is active and market is open)
  if (currentCorrTf === '1D' && data.datetime && data.is_rth_active) {
    const liveDt = data.datetime;
    const liveDate = liveDt.slice(0, 10);

    if (isNdx && ndx) {
      let cr = cachedCorrNdx['1D'];
      if (!cr || !cr.times) {
        cachedCorrNdx['1D'] = { times: [], ndx_pct: [], vxn_pt: [], rolling_corr: [] };
        cr = cachedCorrNdx['1D'];
      }
      const ndxPct = ndx.market ? ndx.market.pct_change : 0;
      const vxnPt = (ndx.market && ndx.market.vxn) ? ndx.market.vxn.pt_change : 0;
      const corrVal = ndx.correlation ? ndx.correlation.rolling_corr : -0.75;

      const pctArr = cr.ndx_pct || cr.spx_pct;
      const ptArr = cr.vxn_pt || cr.vix_pt;

      if (cr.times.length > 0) {
        const lastT = cr.times[cr.times.length - 1];
        const lastDate = lastT.slice(0, 10);
        if (liveDate === lastDate) {
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
        } else {
          // New date session: reset 1D to today
          cr.times = [liveDt];
          pctArr.length = 0; pctArr.push(ndxPct);
          ptArr.length = 0; ptArr.push(vxnPt);
          cr.rolling_corr = [corrVal];
        }
      } else {
        cr.times.push(liveDt);
        pctArr.push(ndxPct);
        ptArr.push(vxnPt);
        cr.rolling_corr.push(corrVal);
      }

      renderCorrelationChart('dual', currentCorrTf);
    } else {
      let cr = cachedCorr['1D'];
      if (!cr || !cr.times) {
        cachedCorr['1D'] = { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] };
        cr = cachedCorr['1D'];
      }
      if (cr.times.length > 0) {
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
        } else {
          // New date session: reset 1D to today
          cr.times = [liveDt];
          cr.spx_pct = [mkt.spx.pct_change];
          cr.vix_pt = [mkt.vix.pt_change];
          cr.rolling_corr = [corr ? corr.rolling_corr : -0.75];
        }
      } else {
        cr.times.push(liveDt);
        cr.spx_pct.push(mkt.spx.pct_change);
        cr.vix_pt.push(mkt.vix.pt_change);
        if (corr) cr.rolling_corr.push(corr.rolling_corr);
      }

      renderCorrelationChart('dual', currentCorrTf);
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
    cachedActiveSessionDate = data.session_date;
    cachedIsRthActive = data.is_rth_active;
    if (data.hist_version !== undefined) cachedHistVersion = data.hist_version;

    if (data.model && data.model.threshold_pts) {
      currentSpxThreshold = data.model.threshold_pts;
    }
    if (data.ndx && data.ndx.model && data.ndx.model.threshold_pts) {
      currentNdxThreshold = data.ndx.model.threshold_pts;
    }
    currentThreshold = (currentAssetPair === 'NDX') ? currentNdxThreshold : currentSpxThreshold;

    const dispThreshEl = document.getElementById('disp-thresh-pts');
    if (dispThreshEl) dispThreshEl.textContent = currentThreshold.toFixed(1);
    const inputSpx = document.getElementById('input-spx-threshold');
    if (inputSpx) inputSpx.value = currentSpxThreshold;
    const inputNdx = document.getElementById('input-ndx-threshold');
    if (inputNdx) inputNdx.value = currentNdxThreshold;
    const inputWin = document.getElementById('input-window');
    if (inputWin && data.model) inputWin.value = data.model.window_days;

    // Cache multi-timeframe datasets across all 8 horizons (1D, 5D, 1M, 3M, 6M, YTD, 1Y, MAX)
    TF_STEPS.forEach(tf => {
      if (data.term_structure && data.term_structure[tf]) {
        cachedTs[tf] = data.term_structure[tf];
      }
      if (data.intraday_correlation && data.intraday_correlation[tf]) {
        cachedCorr[tf] = data.intraday_correlation[tf];
      }
      if (data.tech_vol && data.tech_vol[tf]) {
        cachedTechVol[tf] = data.tech_vol[tf];
      }
      if (data.ndx && data.ndx.correlation && data.ndx.correlation[tf]) {
        cachedCorrNdx[tf] = data.ndx.correlation[tf];
      }
    });

    // Fallbacks for legacy payload structures if present
    if (data.term_structure && data.term_structure.intraday_1d && (!cachedTs['1D'].times || !cachedTs['1D'].times.length)) {
      cachedTs['1D'] = data.term_structure.intraday_1d;
    }
    if (data.term_structure && data.term_structure.intraday_5d && (!cachedTs['5D'].times || !cachedTs['5D'].times.length)) {
      cachedTs['5D'] = data.term_structure.intraday_5d;
    }
    if (data.term_structure && data.term_structure.history_1y && (!cachedTs['1Y'].times || !cachedTs['1Y'].times.length)) {
      cachedTs['1Y'] = {
        times: data.term_structure.history_1y.dates || data.term_structure.history_1y.times || [],
        vix: data.term_structure.history_1y.vix || [],
        vix3m: data.term_structure.history_1y.vix3m || [],
        ratio: data.term_structure.history_1y.ratio || []
      };
    }

    if (data.intraday_correlation && data.intraday_correlation.metrics) {
      cachedCorr.metrics = data.intraday_correlation.metrics;
    }
    if (data.ndx && data.ndx.correlation && data.ndx.correlation.metrics) {
      cachedCorrNdx.metrics = data.ndx.correlation.metrics;
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
  if (activeSocket && (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/live`;
  const ws = new WebSocket(wsUrl);
  activeSocket = ws;

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
    activeSocket = null;
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
    if (sliderTsTimeframe) sliderTsTimeframe.value = 0;
    if (sliderCorrTimeframe) sliderCorrTimeframe.value = 0;
    updateTsSliderUI('1D');
    updateCorrSliderUI('1D');

    if (tsLivePill) {
      tsLivePill.textContent = `${dateStr} 1m`;
      tsLivePill.className = "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60";
    }
    if (corrTfPill) {
      corrTfPill.textContent = `${dateStr} 1M`;
      corrTfPill.className = "text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60";
    }

    // Render charts
    if (data.model && data.model.threshold_pts) {
      currentSpxThreshold = data.model.threshold_pts;
    }
    if (data.ndx && data.ndx.model && data.ndx.model.threshold_pts) {
      currentNdxThreshold = data.ndx.model.threshold_pts;
    }
    currentThreshold = (currentAssetPair === 'NDX') ? currentNdxThreshold : currentSpxThreshold;

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

  updateTsSliderUI(currentTimeframe);
  updateCorrSliderUI(currentCorrTf);

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
