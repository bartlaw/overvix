/**
 * Overvix & Volatility Term Structure — Real-Time WebSocket Client & Plotly Visualizer
 */

// Global State
let soundEnabled = (localStorage.getItem('overvix_voice_enabled') === 'true'); // Persisted voice alert state
let lastOvervixSignal = false;
let lastInversionSignal = false;
let currentSpxThreshold = 2.0;
let currentNdxThreshold = 2.5;
let currentThreshold = 2.0;
let currentTimeframe = '1D'; // '1D', '5D', '1Y'
let spotVolClickAction = 'anchor'; // 'anchor' | 'load'
let currentCorrMode = 'dual'; // 'dual', 'corr_only'
let isVolInverted = true; // Invert volatility axis on correlation overlay for lockstep tracking
let isBetaScaled = true;  // Beta-locked scale mode (1% Spot = |Slope| pts Vol)
let isVixHighsMarked = true; // Mark distinct VIX new highs on correlation overlay
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

// Multi-Timeframe Configuration Suite across 9 stepped horizons
const TF_STEPS = ['1D', '5D', '10D', '1M', '3M', '6M', 'YTD', '1Y', 'MAX'];

const TF_CONFIG = {
  '1D': {
    step: 0,
    label: '1D',
    badgeText: '1D &bull; Intraday (1m)',
    pillText: 'Intraday 1m',
    pillClass: 'bg-amber-950/80 text-amber-300 border-amber-800/60',
    granularity: '1m',
    tsSub: '30-Day vs. 90-Day Volatility Ratio & Inversion Monitor (1-min bars)',
    corrSub: 'Minute-by-Minute Normalized Overlay (Upper) & Instantaneous Overvix Residual (Lower)',
    corrTraceName: 'Overvix Residual',
    corrHoverLabel: 'Overvix Residual',
    liveLabel: 'Latest Residual:',
    xTitle: 'Today Intraday Time (US/Eastern)',
    tickformat: '%H:%M',
    timeHoverFmt: '%b %d, %H:%M',
    rangebreaks: [{ pattern: 'hour', bounds: [16.01, 9.5] }]
  },
  '5D': {
    step: 1,
    label: '5D',
    badgeText: '5D &bull; 1-Week (5m)',
    pillText: '1-Week 5m',
    pillClass: 'bg-blue-950/80 text-blue-300 border-blue-800/60',
    granularity: '5m',
    tsSub: '5-Day Term Structure Progression & Ratio Shifts (5-min bars)',
    corrSub: '5-Minute Normalized Overlay (Upper) & Instantaneous Overvix Residual (Lower)',
    corrTraceName: 'Overvix Residual',
    corrHoverLabel: 'Overvix Residual',
    liveLabel: 'Latest Residual:',
    xTitle: '5-Day Timeline (US/Eastern)',
    tickformat: '%b %d %H:%M',
    timeHoverFmt: '%b %d, %H:%M',
    rangebreaks: [{ pattern: 'day of week', bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.01, 9.5] }]
  },
  '10D': {
    step: 2,
    label: '10D',
    badgeText: '10D &bull; 2-Week (5m)',
    pillText: '2-Week 5m',
    pillClass: 'bg-sky-950/80 text-sky-300 border-sky-800/60',
    granularity: '5m',
    tsSub: '10-Day Term Structure Progression & Ratio Shifts (5-min bars)',
    corrSub: '5-Minute Normalized Overlay (Upper) & Instantaneous Overvix Residual (Lower)',
    corrTraceName: 'Overvix Residual',
    corrHoverLabel: 'Overvix Residual',
    liveLabel: 'Latest Residual:',
    xTitle: '10-Day Timeline (US/Eastern)',
    tickformat: '%b %d',
    timeHoverFmt: '%b %d, %H:%M',
    rangebreaks: [{ pattern: 'day of week', bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.01, 9.5] }]
  },
  '1M': {
    step: 3,
    label: '1M',
    badgeText: '1M &bull; 1-Month (5m)',
    pillText: '1-Month 5m',
    pillClass: 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60',
    granularity: '5m',
    tsSub: 'Monthly OPEX Cycle & Term Structure Inversions (5-min bars)',
    corrSub: '5-Minute Normalized Overlay (Upper) & Instantaneous Overvix Residual (Lower)',
    corrTraceName: 'Overvix Residual',
    corrHoverLabel: 'Overvix Residual',
    liveLabel: 'Latest Residual:',
    xTitle: '1-Month Timeline (US/Eastern)',
    tickformat: '%b %d',
    timeHoverFmt: '%b %d, %H:%M',
    rangebreaks: [{ pattern: 'day of week', bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.01, 9.5] }]
  },
  '3M': {
    step: 4,
    label: '3M',
    badgeText: '3M &bull; Quarterly (30m)',
    pillText: 'Quarterly 30m',
    pillClass: 'bg-purple-950/80 text-purple-300 border-purple-800/60',
    granularity: '30m',
    tsSub: 'Quarterly Term Structure & Native VIX3M Tenor Match (30-min bars)',
    corrSub: '30-Minute Normalized Overlay (Upper) & Instantaneous Overvix Residual (Lower)',
    corrTraceName: 'Overvix Residual',
    corrHoverLabel: 'Overvix Residual',
    liveLabel: 'Latest Residual:',
    xTitle: '3-Month Timeline (US/Eastern)',
    tickformat: '%b %d',
    timeHoverFmt: '%b %d, %H:%M',
    rangebreaks: [{ pattern: 'day of week', bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.01, 9.5] }]
  },
  '6M': {
    step: 5,
    label: '6M',
    badgeText: '6M &bull; Semi-Annual (30m)',
    pillText: 'Semi-Annual 30m',
    pillClass: 'bg-pink-950/80 text-pink-300 border-pink-800/60',
    granularity: '30m',
    tsSub: 'Semi-Annual Volatility Cycle & Macro Term Structure (30-min bars)',
    corrSub: '30-Minute Normalized Overlay (Upper) & Instantaneous Overvix Residual (Lower)',
    corrTraceName: 'Overvix Residual',
    corrHoverLabel: 'Overvix Residual',
    liveLabel: 'Latest Residual:',
    xTitle: '6-Month Timeline (US/Eastern)',
    tickformat: '%b %d',
    timeHoverFmt: '%b %d, %H:%M',
    rangebreaks: [{ pattern: 'day of week', bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.01, 9.5] }]
  },
  'YTD': {
    step: 6,
    label: 'YTD',
    badgeText: 'YTD &bull; Year-to-Date (1d)',
    pillText: 'YTD Daily',
    pillClass: 'bg-teal-950/80 text-teal-300 border-teal-800/60',
    granularity: '1d',
    tsSub: 'Year-to-Date Term Structure & Benchmark Performance (Daily Close)',
    corrSub: 'Daily Close Normalized Overlay (Upper) & Instantaneous Overvix Residual (Lower)',
    corrTraceName: 'Overvix Residual',
    corrHoverLabel: 'Overvix Residual',
    liveLabel: 'Latest Residual:',
    xTitle: 'Year-to-Date Timeline',
    tickformat: '%b %d',
    timeHoverFmt: '%b %d, %Y',
    rangebreaks: [{ pattern: 'day of week', bounds: ['sat', 'mon'] }]
  },
  '1Y': {
    step: 7,
    label: '1Y',
    badgeText: '1Y &bull; 1-Year Macro (1d)',
    pillText: '1-Year Daily',
    pillClass: 'bg-slate-800 text-slate-300 border-slate-700',
    granularity: '1d',
    tsSub: '1-Year Macro Volatility Regime & Historical Seasonality (Daily Close)',
    corrSub: 'Daily Close Normalized Overlay (Upper) & Instantaneous Overvix Residual (Lower)',
    corrTraceName: 'Overvix Residual',
    corrHoverLabel: 'Overvix Residual',
    liveLabel: 'Latest Residual:',
    xTitle: '1-Year Macro Date',
    tickformat: '%b %Y',
    timeHoverFmt: '%b %d, %Y',
    rangebreaks: [{ pattern: 'day of week', bounds: ['sat', 'mon'] }]
  },
  'MAX': {
    step: 8,
    label: 'MAX',
    badgeText: 'MAX &bull; 2-Year Multi-Year (1d)',
    pillText: 'MAX 2-Year',
    pillClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60',
    granularity: '1d',
    tsSub: 'Multi-Year Historical Regime & Volatility Crisis Comparison (Daily Close)',
    corrSub: 'Daily Close Normalized Overlay (Upper) & Instantaneous Overvix Residual (Lower)',
    corrTraceName: 'Overvix Residual',
    corrHoverLabel: 'Overvix Residual',
    liveLabel: 'Latest Residual:',
    xTitle: 'Multi-Year Timeline (2Y)',
    tickformat: '%b %Y',
    timeHoverFmt: '%b %d, %Y',
    rangebreaks: [{ pattern: 'day of week', bounds: ['sat', 'mon'] }]
  }
};

// Cached Datasets (SPX & Term Structure)
let cachedBootstrap = null;
let cachedTs = {
  '1D': { times: [], vix: [], vix3m: [], ratio: [] },
  '5D': { times: [], vix: [], vix3m: [], ratio: [] },
  '10D': { times: [], vix: [], vix3m: [], ratio: [] },
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
  '10D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '1M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '3M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '6M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  'YTD': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '1Y': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  'MAX': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  metrics: { '1D': -0.75, '5D': -0.75, '10D': -0.75, '1M': -0.75, '3M': -0.75, '6M': -0.75, 'YTD': -0.75, '1Y': -0.75, 'MAX': -0.75 }
};

// Cached Datasets (NDX & Tech Vol Spread)
let cachedTechVol = {
  '1D': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
  '5D': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
  '10D': { times: [], spread: [], ratio: [], vxn: [], vix: [] },
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
  '10D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '1M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '3M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '6M': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  'YTD': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  '1Y': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  'MAX': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [] },
  metrics: { '1D': -0.75, '5D': -0.75, '10D': -0.75, '1M': -0.75, '3M': -0.75, '6M': -0.75, 'YTD': -0.75, '1Y': -0.75, 'MAX': -0.75 }
};
let cachedCorrGth = {
  '1D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [], is_gth: [] },
  '5D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [], is_gth: [] },
  '10D': { times: [], spx_pct: [], vix_pt: [], rolling_corr: [], is_gth: [] },
  metrics: { '1D': -0.75, '5D': -0.75, '10D': -0.75 }
};
let cachedTrailGth = { x: [], y: [], times: [], is_gth: [], session_date: null };
let cachedLiveCorrGth = null;
let isGthEnabled = false;
let userGthOverride = null; // null = auto during GTH/overnight, 'on'/'off' once toggled
let cachedGthSessionDate = null;
let cachedGthStatus = null;
let currentCorrTf = '1D';

// Fair VIX Model & Row 3 Monitor State
let currentOvervixChartMode = 'linear'; // 'linear' | 'fair'
let currentFvTf = '1D';
let currentFvDisplayMode = 'levels'; // 'levels' | 'beta'
let showFvComponents = false;
let isMouseHoveringFvChart = false;
let pendingLiveFvRender = false;
let currentVrpMode = 'auto';
let currentVrpFixedPts = 4.0;
let currentFvBlend = 'r2_weighted';
let lastFairVixData = null;

// Recovery Anchor State for Dynamic Correlation & Divergence Monitor
let corrAnchor = {
  active: true,
  mode: 'daily_reset', // 'daily_reset' (default), 'open', 'custom'
  time: null,          // timestamp string or null
  index: -1,
  isOfficialPriorClose: true,
  targetDate: null,
  spotBase: null,
  volBase: null,
  label: 'Daily Reset (Prior Close)'
};

// Dedicated Voice Alert Subsystem via Web Speech API
const VoiceManager = {
  enabled: (localStorage.getItem('overvix_voice_enabled') === 'true'),
  pageLoadedAt: Date.now(),
  startupGracePeriodMs: 8000, // 8-second silence window on load while bootstrap & initial ticks hydrate
  lastAlertTime: Date.now(),   // Start cooldown timer at page load to prevent instant triggers
  cooldownMs: 60000,
  lastTroughKey: null,
  isInitialized: false,
  selectedVoiceURI: localStorage.getItem('overvix_voice_uri') || '',

  speak(text, force = false) {
    // Only speak if voice alerts are enabled, or if explicitly forced by direct user action (test button / voice picker)
    if (!this.enabled && !force) {
      return;
    }
    if (!('speechSynthesis' in window)) {
      console.warn("Speech Synthesis API not supported in this browser.");
      return;
    }
    try {
      window.speechSynthesis.cancel(); // Stop any pending speech immediately
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      utter.pitch = 1.0;
      utter.volume = 1.0;
      
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        if (this.selectedVoiceURI) {
          const match = voices.find(v => v.voiceURI === this.selectedVoiceURI || v.name === this.selectedVoiceURI);
          if (match) utter.voice = match;
        } else {
          const enVoice = voices.find(v => v.lang && v.lang.startsWith('en') && (
            v.name.includes('Natural') || v.name.includes('Online') || v.name.includes('Google') || 
            v.name.includes('Microsoft') || v.name.includes('David') || v.name.includes('Zira') || 
            v.name.includes('Aria') || v.name.includes('Jenny')
          ));
          if (enVoice) utter.voice = enVoice;
        }
      }
      
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn("VoiceManager speech error:", e);
    }
  },

  checkRedTriangleAlert(lowestLowEvent, assetName, assetPct, volLabel, vixLevel) {
    if (!lowestLowEvent) return;
    
    // Skip if historical session replay
    if (cachedBootstrap && cachedBootstrap.is_historical) return;

    const eventKey = `${lowestLowEvent.time}_${vixLevel.toFixed(2)}`;
    const now = Date.now();

    // During startup or initial hydration window, silently calibrate the baseline without speaking
    if (!this.isInitialized || (now - this.pageLoadedAt < this.startupGracePeriodMs)) {
      this.lastTroughKey = eventKey;
      this.isInitialized = true;
      return;
    }

    if (!this.enabled) return;

    // Only fire if a brand-new or deeper trough event occurs during active live streaming
    if (eventKey !== this.lastTroughKey) {
      if (now - this.lastAlertTime >= this.cooldownMs) {
        this.lastAlertTime = now;
        this.lastTroughKey = eventKey;
        const dir = (assetPct >= 0) ? 'up' : 'down';
        const absPct = Math.abs(assetPct).toFixed(2);
        const phrase = `New ${volLabel} high. ${assetName} ${dir} ${absPct} percent, ${volLabel} at ${vixLevel.toFixed(2)}.`;
        this.speak(phrase);
      }
    }
  }
};

// Legacy sound stub (all previous synth chimes retired in favor of VoiceManager)
function playAlertSound(type = 'overvix') {
  // Retired
}

// Formatters
const fmtNum = (n, dec = 2) => (n !== null && n !== undefined && !isNaN(n)) ? Number(n).toFixed(dec) : '--.--';
const fmtPct = (n) => (n !== null && n !== undefined && !isNaN(n)) ? (n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`) : '--.--%';
const fmtPts = (n) => (n !== null && n !== undefined && !isNaN(n)) ? (n >= 0 ? `+${n.toFixed(2)}` : `${n.toFixed(2)}`) : '--.--';
const fmtMaturity = (expStr, dte) => {
  if (!expStr || expStr.length < 8) return (dte !== null && dte !== undefined) ? `~${dte}d` : '';
  const y = expStr.slice(0, 4);
  const m = parseInt(expStr.slice(4, 6), 10) - 1;
  const d = parseInt(expStr.slice(6, 8), 10);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mName = months[m] || '';
  const dteStr = (dte !== null && dte !== undefined) ? ` (${dte}d)` : '';
  return `${d} ${mName} '${y.slice(2)}${dteStr}`;
};

// Voice Alerts Toggle Handler
const btnSound = document.getElementById('btn-sound');
const soundIcon = document.getElementById('sound-icon');
const soundText = document.getElementById('sound-text');
const cfgVoiceStatus = document.getElementById('cfg-voice-status');

function updateVoiceStatusUI() {
  if (cfgVoiceStatus) {
    if (VoiceManager.enabled) {
      cfgVoiceStatus.textContent = 'ACTIVE';
      cfgVoiceStatus.className = 'text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 cursor-pointer hover:bg-emerald-900 transition';
      cfgVoiceStatus.title = "Voice alerts ACTIVE (Click to mute)";
    } else {
      cfgVoiceStatus.textContent = 'MUTED';
      cfgVoiceStatus.className = 'text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700 cursor-pointer hover:bg-slate-700 transition';
      cfgVoiceStatus.title = "Voice alerts MUTED (Click to enable)";
    }
  }
}

function applyVoiceUI(speakFeedback = false) {
  if (VoiceManager.enabled) {
    if (soundIcon) soundIcon.textContent = '🗣️';
    if (soundText) soundText.textContent = 'Voice ON';
    if (btnSound) {
      btnSound.classList.remove('opacity-60');
      btnSound.title = "Voice alerts enabled (Click to mute)";
    }
    if (speakFeedback) {
      VoiceManager.speak("Voice alerts active", true);
    }
  } else {
    if (soundIcon) soundIcon.textContent = '🔇';
    if (soundText) soundText.textContent = 'Muted';
    if (btnSound) {
      btnSound.classList.add('opacity-60');
      btnSound.title = "Voice alerts muted (Click to enable)";
    }
    if (speakFeedback && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
  updateVoiceStatusUI();
}

function setVoiceEnabled(state, speakFeedback = false) {
  VoiceManager.enabled = !!state;
  soundEnabled = VoiceManager.enabled;
  try {
    localStorage.setItem('overvix_voice_enabled', VoiceManager.enabled ? 'true' : 'false');
  } catch (e) {
    console.warn("localStorage write error for voice enabled state:", e);
  }
  applyVoiceUI(speakFeedback);
}

if (btnSound) {
  btnSound.addEventListener('click', () => {
    setVoiceEnabled(!VoiceManager.enabled, true);
  });
}

if (cfgVoiceStatus) {
  cfgVoiceStatus.addEventListener('click', () => {
    setVoiceEnabled(!VoiceManager.enabled, true);
  });
}

// Immediately apply saved voice UI state on startup
applyVoiceUI(false);

// Populate Voice Selector Dropdown
function populateVoiceSelector() {
  const select = document.getElementById('select-voice');
  if (!select || !('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return;

  const cur = VoiceManager.selectedVoiceURI;
  select.innerHTML = '<option value="">System Default</option>';

  const sorted = [...voices].sort((a, b) => {
    const aEn = a.lang && a.lang.startsWith('en');
    const bEn = b.lang && b.lang.startsWith('en');
    if (aEn && !bEn) return -1;
    if (!aEn && bEn) return 1;
    return a.name.localeCompare(b.name);
  });

  sorted.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI || v.name;
    if (cur && (v.voiceURI === cur || v.name === cur)) {
      opt.selected = true;
    }
    opt.textContent = `${v.name} (${v.lang})${v.default ? ' — Default' : ''}`;
    select.appendChild(opt);
  });
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = populateVoiceSelector;
  populateVoiceSelector();
}

const selectVoice = document.getElementById('select-voice');
if (selectVoice) {
  selectVoice.addEventListener('change', (e) => {
    VoiceManager.selectedVoiceURI = e.target.value;
    localStorage.setItem('overvix_voice_uri', e.target.value);
    VoiceManager.speak("Voice selected.", true);
  });
}

// Test Voice Button in Config Modal
const btnTestVoice = document.getElementById('btn-test-voice');
if (btnTestVoice) {
  btnTestVoice.addEventListener('click', () => {
    const isNdx = (currentAssetPair === 'NDX');
    const asset = isNdx ? "Nasdaq" : "SPX";
    const vol = isNdx ? "VXN" : "VIX";
    VoiceManager.speak(`New ${vol} high. ${asset} down 1.45 percent, ${vol} at 24.69.`, true);
  });
}

// Settings Modal
const btnSettings = document.getElementById('btn-settings');
const modalSettings = document.getElementById('modal-settings');
const modalClose = document.getElementById('modal-close');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');

btnSettings.addEventListener('click', () => {
  const inputSpx = document.getElementById('input-spx-threshold');
  const inputNdx = document.getElementById('input-ndx-threshold');
  const selVrpMode = document.getElementById('select-vrp-mode');
  const inpVrpFixed = document.getElementById('input-vrp-fixed');
  const selFvBlend = document.getElementById('select-fv-blend');
  if (inputSpx) inputSpx.value = currentSpxThreshold;
  if (inputNdx) inputNdx.value = currentNdxThreshold;
  if (selVrpMode) selVrpMode.value = currentVrpMode;
  if (inpVrpFixed) inpVrpFixed.value = currentVrpFixedPts;
  if (selFvBlend) selFvBlend.value = currentFvBlend;
  updateVoiceStatusUI();
  populateVoiceSelector();
  modalSettings.classList.remove('hidden');
});
modalClose.addEventListener('click', () => modalSettings.classList.add('hidden'));
btnCancelSettings.addEventListener('click', () => modalSettings.classList.add('hidden'));

btnSaveSettings.addEventListener('click', async () => {
  const spxThresh = parseFloat(document.getElementById('input-spx-threshold').value) || currentSpxThreshold;
  const ndxThresh = parseFloat(document.getElementById('input-ndx-threshold').value) || currentNdxThreshold;
  const win = parseInt(document.getElementById('input-window').value, 10);
  const interval = parseFloat(document.getElementById('input-interval').value);
  const vrpModeEl = document.getElementById('select-vrp-mode');
  const vrpFixedEl = document.getElementById('input-vrp-fixed');
  const fvBlendEl = document.getElementById('select-fv-blend');
  const vrpMode = vrpModeEl ? vrpModeEl.value : currentVrpMode;
  const vrpFixed = vrpFixedEl ? parseFloat(vrpFixedEl.value) : currentVrpFixedPts;
  const fvBlend = fvBlendEl ? fvBlendEl.value : currentFvBlend;

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        spx_threshold: spxThresh,
        ndx_threshold: ndxThresh,
        window: win, 
        interval: interval,
        vrp_mode: vrpMode,
        vrp_fixed_pts: isNaN(vrpFixed) ? 4.0 : vrpFixed,
        fair_vix_blend: fvBlend
      })
    });
    if (res.ok) {
      currentSpxThreshold = spxThresh;
      currentNdxThreshold = ndxThresh;
      currentVrpMode = vrpMode;
      currentVrpFixedPts = isNaN(vrpFixed) ? 4.0 : vrpFixed;
      currentFvBlend = fvBlend;
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

// Asset Pair Switcher (SPX/VIX vs NDX/VXN) & GTH Toggle
const btnAssetSpx = document.getElementById('btn-asset-spx');
const btnAssetNdx = document.getElementById('btn-asset-ndx');
const btnGthToggle = document.getElementById('btn-gth-toggle');
const gthToggleDot = document.getElementById('gth-toggle-dot');
const gthModePill = document.getElementById('gth-mode-pill');
const gthBasisBadge = document.getElementById('gth-basis-badge');
const gthControlGroup = document.getElementById('gth-control-group');

function isGthChartActive(tf = currentCorrTf) {
  if (currentAssetPair !== 'SPX' || currentViewMode !== 'live' || !isGthEnabled) return false;
  if (!['1D', '5D', '10D'].includes(tf)) return false;
  const ds = cachedCorrGth[tf];
  return Boolean(ds && ds.times && ds.times.length > 0);
}

function getCorrDataset(isNdx, tf = currentCorrTf) {
  if (isNdx) {
    return cachedCorrNdx[tf] || cachedCorrNdx['1D'] || cachedCorrNdx;
  }
  if (isGthChartActive(tf)) {
    return cachedCorrGth[tf];
  }
  return cachedCorr[tf] || cachedCorr['1D'] || cachedCorr;
}

function applyAutoGthDefault(data) {
  if (!data || currentViewMode !== 'live') return;
  if (userGthOverride !== null) {
    isGthEnabled = (userGthOverride === 'on');
    return;
  }
  const st = data.session_status;
  const gthAvail = Boolean(data.gth && data.gth.available);
  const ts = data.timestamp || '';
  // Auto-enable GTH only during morning pre-market GTH (03:15-09:15 ET) before cash open
  if (gthAvail && st === 'GTH_ACTIVE' && ts >= '03:15' && ts < '09:15') {
    isGthEnabled = true;
  } else if (st === 'REGULAR_RTH' || st === 'OVERNIGHT_ES_ONLY' || data.is_rth_active === false) {
    isGthEnabled = false;
  }
}

function updateGthToggleUI(data = lastLiveUpdatePayload || cachedBootstrap) {
  if (!btnGthToggle) return;
  const isSpxLive = (currentAssetPair === 'SPX' && currentViewMode === 'live');
  const gth = data ? data.gth : null;
  const st = data ? data.session_status : null;

  if (gthControlGroup) {
    gthControlGroup.className = isSpxLive
      ? "flex items-center space-x-1.5 bg-slate-900/90 border border-slate-700/80 rounded-lg p-0.5 shadow-inner"
      : "flex items-center space-x-1.5 bg-slate-900/90 border border-slate-800/60 rounded-lg p-0.5 shadow-inner opacity-45 pointer-events-none";
  }

  btnGthToggle.disabled = !isSpxLive;

  if (!isSpxLive) {
    btnGthToggle.className = "px-2.5 py-1 rounded text-xs font-semibold text-slate-500 flex items-center space-x-1.5 cursor-not-allowed";
    btnGthToggle.title = "GTH ES+VIX monitoring applies to live SPX/VIX only";
    if (gthToggleDot) gthToggleDot.className = "w-2 h-2 rounded-full bg-slate-600";
    if (gthModePill) gthModePill.classList.add('hidden');
    if (gthBasisBadge) gthBasisBadge.classList.add('hidden');
    return;
  }

  btnGthToggle.title = "Toggle Global Trading Hours (ES Futures Basis-Adjusted + Spot VIX, 03:15-16:15 ET) on SPX/VIX 1D, 5D & 10D";

  if (isGthEnabled) {
    btnGthToggle.className = "px-2.5 py-1 rounded text-xs font-bold bg-indigo-500 text-white shadow-sm transition flex items-center space-x-1.5";
    if (gthToggleDot) {
      if (st === 'GTH_ACTIVE') {
        gthToggleDot.className = "w-2 h-2 rounded-full bg-emerald-300 animate-pulse";
      } else if (st === 'OVERNIGHT_ES_ONLY') {
        gthToggleDot.className = "w-2 h-2 rounded-full bg-amber-300 animate-pulse";
      } else {
        gthToggleDot.className = "w-2 h-2 rounded-full bg-cyan-200";
      }
    }
    if (gthModePill) {
      gthModePill.classList.remove('hidden');
      if (st === 'GTH_ACTIVE') {
        gthModePill.textContent = "ES+VIX LIVE";
        gthModePill.className = "text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-600/60";
      } else if (st === 'OVERNIGHT_ES_ONLY') {
        gthModePill.textContent = "ES LIVE";
        gthModePill.className = "text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-950/90 text-amber-300 border border-amber-600/60";
      } else {
        gthModePill.textContent = "ES+VIX";
        gthModePill.className = "text-[10px] font-bold px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-200 border border-indigo-400/50";
      }
    }
  } else {
    btnGthToggle.className = "px-2.5 py-1 rounded text-xs font-semibold text-slate-400 hover:text-white transition flex items-center space-x-1.5";
    if (gthToggleDot) gthToggleDot.className = (st === 'GTH_ACTIVE' || st === 'OVERNIGHT_ES_ONLY')
      ? "w-2 h-2 rounded-full bg-indigo-400 animate-pulse"
      : "w-2 h-2 rounded-full bg-slate-500";
    if (gthModePill) gthModePill.classList.add('hidden');
  }

  if (gthBasisBadge) {
    if (gth && gth.basis !== null && gth.basis !== undefined) {
      const sign = gth.basis >= 0 ? '+' : '';
      const sym = gth.es_symbol || 'ES';
      gthBasisBadge.textContent = `Basis: ${sign}${gth.basis.toFixed(2)}`;
      gthBasisBadge.title = `${sym} Settlement Basis (${gth.basis_source || 'RTH Close'} ${gth.basis_date || ''}): ${sign}${gth.basis.toFixed(2)} — Synthetic SPX = ES - Basis`;
      gthBasisBadge.classList.remove('hidden');
    } else {
      gthBasisBadge.classList.add('hidden');
    }
  }
}

function setupGthToggle() {
  if (!btnGthToggle) return;
  btnGthToggle.addEventListener('click', () => {
    if (currentAssetPair !== 'SPX' || currentViewMode !== 'live') return;
    isGthEnabled = !isGthEnabled;
    userGthOverride = isGthEnabled ? 'on' : 'off';

    if (isGthEnabled && !['1D', '5D', '10D'].includes(currentCorrTf)) {
      switchCorrTf('1D');
    }
    if (corrAnchor.active) {
      if (currentCorrTf === '1D') {
        if (corrAnchor.mode !== 'daily_reset') {
          resetCorrAnchor(false);
        }
      } else {
        syncCorrAnchorForTimeframe(currentCorrTf);
      }
    }

    const activeData = lastLiveUpdatePayload || cachedBootstrap;
    updateGthToggleUI(activeData);
    if (cachedBootstrap) {
      renderOvervixChart(cachedBootstrap);
    }
    renderCorrelationChart(currentCorrMode, currentCorrTf);
    updateCorrMetricDisplay();
    renderFairVixMonitorChart(currentFvTf);
    if (activeData) {
      updateUI(activeData);
    }
  });
}

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
    if (corrTitle) corrTitle.textContent = "SPX & VIX Spot-Vol & Overvix Residual Monitor";
    const corrSub = document.getElementById('corr-subtitle');
    if (corrSub) corrSub.textContent = "Minute-by-Minute Normalized Overlay (Upper) & Instantaneous Overvix Residual (Lower)";
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
    if (corrTitle) corrTitle.textContent = "NDX & VXN Spot-Vol & Over-VXN Residual Monitor";
    const corrSub = document.getElementById('corr-subtitle');
    if (corrSub) corrSub.textContent = "Minute-by-Minute Normalized Overlay (Upper) & Instantaneous Over-VXN Residual (Lower)";
  }

  const dispEl = document.getElementById('disp-thresh-pts');
  if (dispEl) dispEl.textContent = currentThreshold.toFixed(1);

  if (corrAnchor.active) {
    syncCorrAnchorForTimeframe(currentCorrTf);
  } else {
    updateAnchorUI();
  }
  updateVixHighsUI();

  // Re-render charts and UI immediately from cache (preserving freshest live WS snapshot in live mode)
  const activeData = (currentViewMode === 'historical' && cachedHistoricalData) ? cachedHistoricalData : cachedBootstrap;
  const liveOrActive = (currentViewMode === 'live' && lastLiveUpdatePayload) ? lastLiveUpdatePayload : activeData;
  updateGthToggleUI(liveOrActive);
  if (activeData) {
    renderOvervixChart(activeData);
    renderTermStructureChart(currentTimeframe);
    renderCorrelationChart(currentCorrMode, currentCorrTf);
    updateCorrMetricDisplay();
    renderFairVixMonitorChart(currentFvTf);
    updateUI(liveOrActive);
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
const chkSyncCorr = document.getElementById('chk-sync-corr');

function isHorizonSynced(key) {
  if (key === 'ts') return Boolean(chkSyncTimeframe && chkSyncTimeframe.checked);
  if (key === 'corr') return Boolean(chkSyncCorr && chkSyncCorr.checked);
  if (key === 'fv') {
    const chkFv = document.getElementById('chk-sync-fv');
    return Boolean(chkFv && chkFv.checked);
  }
  return false;
}

function previewHorizonSync(sourceKey, idx, tf) {
  if (!isHorizonSynced(sourceKey)) return;
  if (sourceKey !== 'ts' && isHorizonSynced('ts')) {
    if (sliderTsTimeframe) sliderTsTimeframe.value = idx;
    updateTsSliderUI(tf);
  }
  if (sourceKey !== 'corr' && isHorizonSynced('corr')) {
    if (sliderCorrTimeframe) sliderCorrTimeframe.value = idx;
    updateCorrSliderUI(tf);
  }
  if (sourceKey !== 'fv' && isHorizonSynced('fv')) {
    const sliderFv = document.getElementById('slider-fv-timeframe');
    if (sliderFv) sliderFv.value = idx;
    updateFvSliderUI(tf);
  }
}

function propagateHorizonSync(sourceKey, tf) {
  if (!isHorizonSynced(sourceKey)) return;
  if (sourceKey !== 'ts' && isHorizonSynced('ts') && currentTimeframe !== tf) {
    switchTimeframe(tf, false, false);
  }
  if (sourceKey !== 'corr' && isHorizonSynced('corr') && currentCorrTf !== tf) {
    switchCorrTf(tf, false, false);
  }
  if (sourceKey !== 'fv' && isHorizonSynced('fv') && currentFvTf !== tf) {
    switchFairVixTf(tf, false);
  }
}

function setupTimeframeSliders() {
  if (sliderTsTimeframe) {
    sliderTsTimeframe.addEventListener('input', (e) => {
      const idx = parseInt(e.target.value, 10);
      const tf = TF_STEPS[idx] || '1D';
      updateTsSliderUI(tf);
      previewHorizonSync('ts', idx, tf);
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
      previewHorizonSync('corr', idx, tf);
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
    corrSubtitle.textContent = (currentAssetPair === 'NDX') 
      ? conf.corrSub.replace('Overvix', 'Over-VXN') 
      : conf.corrSub;
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

function switchTimeframe(tf, triggeredBySlider = false, propagate = true) {
  currentTimeframe = tf;
  const conf = TF_CONFIG[tf] || TF_CONFIG['1D'];
  if (sliderTsTimeframe && sliderTsTimeframe.value != conf.step) {
    sliderTsTimeframe.value = conf.step;
  }
  updateTsSliderUI(tf);
  renderTermStructureChart(tf);

  if (propagate) {
    propagateHorizonSync('ts', tf);
  }
}

// Spot-Vol Click Action Selectors (Card 1)
const btnSpotVolClickAnchor = document.getElementById('btn-spotvol-click-anchor');
const btnSpotVolClickLoad = document.getElementById('btn-spotvol-click-load');

function setupTrailButtons() {
  setupSpotVolClickSwitch();
}

function getHistoricalDotHoverTemplate(assetLabel, volLabel) {
  const hint = (spotVolClickAction === 'load')
    ? '👉 Click to Load 1m Day Archive'
    : '👉 Click to Anchor at Prev Day Close';
  const color = (spotVolClickAction === 'load') ? '#FBBF24' : '#00E5FF';
  const isNdx = (currentAssetPair === 'NDX');
  const residLabel = isNdx ? 'Over-VXN Residual' : 'Overvix Residual';
  return `<b>%{text}</b><br>` +
         `${assetLabel}: <b>%{customdata[2]}</b> (%{x:+.2f}%)<br>` +
         `${volLabel}: <b>%{customdata[3]}</b> (%{y:+.2f} pts)<br>` +
         `${residLabel}: <b>%{customdata[0]}</b>%{customdata[1]}<br>` +
         `<span style="color:${color};font-size:10px">${hint}</span><extra></extra>`;
}

function setupSpotVolClickSwitch() {
  if (btnSpotVolClickAnchor) {
    btnSpotVolClickAnchor.addEventListener('click', () => switchSpotVolClickAction('anchor'));
  }
  if (btnSpotVolClickLoad) {
    btnSpotVolClickLoad.addEventListener('click', () => switchSpotVolClickAction('load'));
  }
}

function switchSpotVolClickAction(action) {
  spotVolClickAction = (action === 'load') ? 'load' : 'anchor';
  const activeCls = "px-1.5 py-1 rounded-md text-[10px] font-semibold bg-cyan-500 text-black shadow-sm transition whitespace-nowrap";
  const idleCls = "px-1.5 py-1 rounded-md text-[10px] font-semibold text-slate-400 hover:text-white transition whitespace-nowrap";
  if (btnSpotVolClickAnchor) {
    btnSpotVolClickAnchor.className = (spotVolClickAction === 'anchor') ? activeCls : idleCls;
  }
  if (btnSpotVolClickLoad) {
    btnSpotVolClickLoad.className = (spotVolClickAction === 'load') ? activeCls : idleCls;
  }

  const overvixEl = document.getElementById('overvix-chart');
  if (overvixEl && overvixEl.data && overvixEl.data.length > 0) {
    const isNdx = (currentAssetPair === 'NDX');
    const assetLabel = isNdx ? 'NDX' : 'SPX';
    const volLabel = isNdx ? 'VXN' : 'VIX';
    Plotly.restyle('overvix-chart', { hovertemplate: getHistoricalDotHoverTemplate(assetLabel, volLabel) }, [0]);
  }
}

function isSessionStarted(data, isGth) {
  if (!data) return false;
  if (data.is_historical) return true;
  if (isGth) {
    if (data.overvix && data.overvix.intraday_trail_gth && data.overvix.intraday_trail_gth.x && data.overvix.intraday_trail_gth.x.length > 0) return true;
    if (typeof data.gth_session_started === 'boolean') return data.gth_session_started;
    if (data.gth && typeof data.gth.session_started === 'boolean') return data.gth.session_started;
    if (data.session_status === 'GTH_ACTIVE') return true;
    if (data.is_rth_active === true || data.session_status === 'REGULAR_RTH') return true;
    if (data.gth && data.gth.is_gth_active === true) return true;
    const ts = data.timestamp || '';
    return (ts >= '03:15');
  } else {
    if (data.overvix && data.overvix.intraday_trail && data.overvix.intraday_trail.x && data.overvix.intraday_trail.x.length > 0) return true;
    if (typeof data.rth_session_started === 'boolean') return data.rth_session_started;
    if (data.is_rth_active === true || data.session_status === 'REGULAR_RTH') return true;
    const ts = data.timestamp || '';
    return (ts >= '09:30');
  }
}


// Correlation Timeframe & Display Controls
const btnCorrScale = document.getElementById('btn-corr-scale');
const corrScaleLabel = document.getElementById('corr-scale-label');
const btnCorrInvert = document.getElementById('btn-corr-invert');
const corrInvertGroup = document.getElementById('corr-invert-group');
const corrInvertIcon = document.getElementById('corr-invert-icon');
const btnCorrVixHighs = document.getElementById('btn-corr-vix-highs');
const corrVixHighsLabel = document.getElementById('corr-vix-highs-label');
const corrTfPill = document.getElementById('corr-tf-pill');
const corrSubtitle = document.getElementById('corr-subtitle');
const corrLiveLabel = document.getElementById('corr-live-label');

function setupCorrButtons() {
  if (btnCorrScale) btnCorrScale.addEventListener('click', () => toggleCorrScaleMode());
  if (btnCorrInvert) btnCorrInvert.addEventListener('click', () => toggleCorrVolInvert());
  if (btnCorrVixHighs) btnCorrVixHighs.addEventListener('click', () => toggleCorrVixHighs());
  setupAnchorButtons();
}

function setupAnchorButtons() {
  const btnOpen = document.getElementById('btn-anchor-open');
  const btnDailyReset = document.getElementById('btn-anchor-daily-reset');
  const btnCustomToggle = document.getElementById('btn-anchor-custom-toggle');
  const btnApplyCustom = document.getElementById('btn-apply-custom-time');
  const customWrapper = document.getElementById('anchor-custom-wrapper');
  const timePicker = document.getElementById('anchor-time-picker');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => setCorrAnchor('open'));
  }
  if (btnDailyReset) {
    btnDailyReset.addEventListener('click', () => {
      setCorrAnchor('daily_reset');
    });
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

  setupCorrHoverTracking();
  updateAnchorUI();
}

let isMouseHoveringCorrChart = false;
let pendingLiveCorrRender = false;

function setupCorrHoverTracking() {
  const chartEl = document.getElementById('correlation-chart');
  if (!chartEl || chartEl._hasHoverTracking) return;
  chartEl._hasHoverTracking = true;

  chartEl.addEventListener('mouseenter', () => {
    isMouseHoveringCorrChart = true;
  });

  chartEl.addEventListener('mouseleave', () => {
    isMouseHoveringCorrChart = false;
    if (pendingLiveCorrRender) {
      pendingLiveCorrRender = false;
      renderCorrelationChart(currentCorrMode, currentCorrTf);
    }
  });

  chartEl.addEventListener('mousemove', () => {
    isMouseHoveringCorrChart = true;
  });
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

function toggleCorrVixHighs() {
  const isEligibleTf = (currentCorrTf === '1D' || currentCorrTf === '5D' || currentCorrTf === '10D' || currentCorrTf === '1M');
  if (!isEligibleTf) return;
  isVixHighsMarked = !isVixHighsMarked;
  updateVixHighsUI();
  renderCorrelationChart(currentCorrMode, currentCorrTf);
}

function updateVixHighsUI(tf = currentCorrTf) {
  const btn = document.getElementById('btn-corr-vix-highs');
  const label = document.getElementById('corr-vix-highs-label');
  const volLabel = (currentAssetPair === 'NDX') ? 'VXN' : 'VIX';
  if (label) label.textContent = `${volLabel} Highs`;
  const isEligibleTf = (tf === '1D' || tf === '5D' || tf === '10D' || tf === '1M');
  if (btn) {
    if (!isEligibleTf) {
      btn.className = "px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-500 bg-slate-900/60 border border-slate-800 cursor-not-allowed opacity-50 flex items-center space-x-1 whitespace-nowrap";
      btn.title = `${volLabel} High marks are only available on 1D, 5D, 10D, and 1M horizons`;
    } else if (isVixHighsMarked) {
      btn.className = "px-2.5 py-1.5 rounded-md text-xs font-semibold bg-amber-500 text-black shadow-sm transition flex items-center space-x-1 whitespace-nowrap";
      btn.title = `Toggle marks at distinct ${volLabel} new highs across sessions (active on 1D, 5D, 10D, 1M)`;
    } else {
      btn.className = "px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-400 hover:text-white transition flex items-center space-x-1 whitespace-nowrap";
      btn.title = `Toggle marks at distinct ${volLabel} new highs across sessions (active on 1D, 5D, 10D, 1M)`;
    }
  }
}

function switchCorrMode(mode = 'dual') {
  currentCorrMode = 'dual';
  renderCorrelationChart('dual', currentCorrTf);
}

function switchCorrTf(tf, triggeredBySlider = false, propagate = true) {
  currentCorrTf = tf;
  const conf = TF_CONFIG[tf] || TF_CONFIG['1D'];
  if (sliderCorrTimeframe && sliderCorrTimeframe.value != conf.step) {
    sliderCorrTimeframe.value = conf.step;
  }
  updateCorrSliderUI(tf);

  if (tf === '1D') {
    if (corrAnchor.mode !== 'daily_reset') {
      resetCorrAnchor(false);
    }
  } else {
    syncCorrAnchorForTimeframe(tf);
  }
  updateCorrMetricDisplay();
  updateVixHighsUI(tf);
  renderCorrelationChart(currentCorrMode, tf);

  if (propagate) {
    propagateHorizonSync('corr', tf);
  }
}

function getActiveBetaAndIntercept(isNdx) {
  let rawSlope = -1.9796;
  let rawIntercept = 0.0622;
  if (cachedBootstrap) {
    if (isNdx && cachedBootstrap.ndx && cachedBootstrap.ndx.model) {
      if (typeof cachedBootstrap.ndx.model.slope === 'number') rawSlope = cachedBootstrap.ndx.model.slope;
      if (typeof cachedBootstrap.ndx.model.intercept === 'number') rawIntercept = cachedBootstrap.ndx.model.intercept;
    } else if (!isNdx && isGthChartActive() && cachedBootstrap.session_status === 'GTH_ACTIVE' && cachedBootstrap.overvix && cachedBootstrap.overvix.gth_model) {
      const gm = cachedBootstrap.overvix.gth_model;
      if (typeof gm.slope === 'number') rawSlope = gm.slope;
      if (typeof gm.intercept === 'number') rawIntercept = gm.intercept;
    } else if (cachedBootstrap.model) {
      if (typeof cachedBootstrap.model.slope === 'number') rawSlope = cachedBootstrap.model.slope;
      if (typeof cachedBootstrap.model.intercept === 'number') rawIntercept = cachedBootstrap.model.intercept;
    }
  } else if (isNdx) {
    rawSlope = -1.3712;
    rawIntercept = 0.0;
  }
  const beta = Math.abs(rawSlope) > 0.05 ? Math.abs(rawSlope) : 1.98;
  return { beta, rawSlope, rawIntercept };
}

function updateCorrMetricDisplay() {
  const isNdx = (currentAssetPair === 'NDX');
  const targetTf = currentCorrTf;
  const c = getCorrDataset(isNdx, targetTf);
  if (!c) return;
  const anchoredSeries = computeAnchoredSeries(c, isNdx, targetTf);
  const times = anchoredSeries.times || [];
  const thresh = isNdx ? currentNdxThreshold : currentThreshold;
  const el = document.getElementById('corr-live-val');
  const lbl = document.getElementById('corr-live-label');
  const corrPill = document.getElementById('corr-status-pill');

  if (lbl) lbl.textContent = "Latest Residual:";

  if (times && times.length > 0) {
    const lastIdx = times.length - 1;
    let resid;
    if (anchoredSeries.isLongDailyReset && Array.isArray(anchoredSeries.dailyResids) && typeof anchoredSeries.dailyResids[lastIdx] === 'number') {
      resid = anchoredSeries.dailyResids[lastIdx];
    } else {
      const sPct = anchoredSeries.spotPct[lastIdx] || 0;
      const vPt = anchoredSeries.volPt[lastIdx] || 0;
      const { beta, rawIntercept } = getActiveBetaAndIntercept(isNdx);
      const isSessionBaseline = (corrAnchor.mode === 'prior_close' || corrAnchor.mode === 'daily_reset' || (!anchoredSeries.isAnchored && targetTf === '1D'));
      const alpha = isSessionBaseline ? rawIntercept : 0;
      resid = vPt - alpha + beta * sPct;
    }
    const residSign = resid >= 0 ? '+' : '';
    const residStr = `${residSign}${resid.toFixed(2)} pts`;

    if (el) {
      el.textContent = residStr;
      if (resid >= thresh) {
        el.className = "text-rose-400 font-bold";
      } else if (resid <= -thresh) {
        el.className = "text-cyan-400 font-bold";
      } else {
        el.className = "text-emerald-400 font-bold";
      }
    }

    if (corrPill) {
      if (resid >= thresh) {
        corrPill.textContent = `🚨 ${isNdx ? 'Over-VXN' : 'Overvix'} Alert (+${resid.toFixed(2)} pts)`;
        corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-red-950 text-red-300 border border-red-800 animate-pulse";
        corrPill.title = `Residual exceeds +${thresh.toFixed(1)} pts alert threshold: Volatility elevated relative to spot moves`;
      } else if (resid <= -thresh) {
        corrPill.textContent = `📉 Vol Crush (${resid.toFixed(2)} pts)`;
        corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800";
        corrPill.title = `Residual below -${thresh.toFixed(1)} pts floor: Volatility crushed relative to spot moves`;
      } else {
        corrPill.textContent = `Normal Residual (${residSign}${resid.toFixed(2)} pts)`;
        corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800";
        corrPill.title = `Residual within ±${thresh.toFixed(1)} pts equilibrium band`;
      }
    }
  }
}

// ==============================================================================
// PLOTLY CHART INITIALIZATION & RENDERING
// ==============================================================================

/** Build the dotted vertical hairline and amber badge for overnight ES-only tracking on Chart 1. */
function buildOvernightEsOverlay(gthObj) {
  if (!gthObj || !gthObj.current_point || typeof gthObj.current_point.x !== 'number') {
    return { shapes: [], annotations: [] };
  }
  const esX = gthObj.current_point.x;
  const opensAt = gthObj.vix_opens_at || '03:15 ET';
  return {
    shapes: [{
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: esX,
      x1: esX,
      y0: 0,
      y1: 1,
      line: { color: 'rgba(245, 158, 11, 0.55)', width: 1.5, dash: 'dot' }
    }],
    annotations: [{
      xref: 'x',
      yref: 'paper',
      x: esX,
      y: 0.98,
      text: `Overnight ES: ${esX >= 0 ? '+' : ''}${esX.toFixed(2)}% (VIX @ ${opensAt})`,
      showarrow: false,
      font: { color: '#FBBF24', size: 10, family: 'monospace' },
      bgcolor: 'rgba(15, 23, 42, 0.9)',
      bordercolor: 'rgba(245, 158, 11, 0.5)',
      borderwidth: 1,
      borderpad: 3
    }]
  };
}

function renderOvervixChart(bootstrap) {
  if (currentOvervixChartMode === 'fair') {
    return renderFairVixScatterChart(bootstrap);
  }
  const isNdx = (currentAssetPair === 'NDX');
  const gthMode = (!isNdx && !bootstrap.is_historical && isGthEnabled);
  const hasSessionStarted = isSessionStarted(bootstrap, gthMode);
  const gthObj = (gthMode && bootstrap.gth) ? bootstrap.gth : null;
  const gthModel = (gthMode && bootstrap.session_status === 'GTH_ACTIVE' && bootstrap.overvix && bootstrap.overvix.gth_model)
    ? bootstrap.overvix.gth_model
    : null;
  const targetData = (isNdx && bootstrap.ndx && bootstrap.ndx.overvix) ? bootstrap.ndx : bootstrap;
  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';

  const xHist = gthModel
    ? (gthModel.x_history || [])
    : ((targetData.overvix && targetData.overvix.x_history) ? targetData.overvix.x_history : []);
  const yHist = gthModel
    ? (gthModel.y_history || [])
    : ((targetData.overvix && targetData.overvix.y_history) ? targetData.overvix.y_history : []);
  const dates = gthModel
    ? (gthModel.dates || [])
    : ((targetData.overvix && targetData.overvix.dates) ? targetData.overvix.dates : []);
  const spotHist = gthModel
    ? (gthModel.spot_history || [])
    : ((targetData.overvix && targetData.overvix.spot_history) ? targetData.overvix.spot_history : []);
  const volHist = gthModel
    ? (gthModel.vol_history || [])
    : ((targetData.overvix && targetData.overvix.vol_history) ? targetData.overvix.vol_history : []);
  const slope = gthModel ? (gthModel.slope || 0) : ((targetData.model && targetData.model.slope) || 0);
  const intercept = gthModel ? (gthModel.intercept || 0) : ((targetData.model && targetData.model.intercept) || 0);
  const assetDefaultThresh = isNdx ? currentNdxThreshold : currentSpxThreshold;
  const threshold = (targetData.model && targetData.model.threshold_pts) || assetDefaultThresh;

  // Intraday Trail Data (prefer GTH+RTH trail when SPX GTH mode is active and populated)
  const gthTrail = (gthMode && bootstrap.overvix && bootstrap.overvix.intraday_trail_gth) ? bootstrap.overvix.intraday_trail_gth : null;
  const rthTrail = (targetData.overvix && targetData.overvix.intraday_trail) ? targetData.overvix.intraday_trail : { x: [], y: [], times: [] };
  const trail = (gthTrail && gthTrail.x && gthTrail.x.length > 0) ? gthTrail : rthTrail;
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
  let currSpot = null;
  let currVol = null;
  const isGthLiveActive = Boolean(gthMode && bootstrap.session_status === 'GTH_ACTIVE' && gthObj && gthObj.current_point && gthObj.current_point.y !== null);
  const isOvernightEs = Boolean(gthMode && bootstrap.session_status === 'OVERNIGHT_ES_ONLY' && gthObj && gthObj.current_point);

  if (bootstrap.is_historical && trail.x && trail.x.length > 0) {
    currX = trail.x[trail.x.length - 1];
    currY = trail.y[trail.y.length - 1];
    currSpot = isNdx
      ? (targetData.market ? targetData.market.current : (trail.spot_raw ? trail.spot_raw[trail.spot_raw.length - 1] : null))
      : (targetData.market && targetData.market.spx ? targetData.market.spx.current : (trail.spot_raw ? trail.spot_raw[trail.spot_raw.length - 1] : null));
    currVol = isNdx
      ? (targetData.market && targetData.market.vxn ? targetData.market.vxn.current : (trail.vol_raw ? trail.vol_raw[trail.vol_raw.length - 1] : null))
      : (targetData.market && targetData.market.vix ? targetData.market.vix.current : (trail.vol_raw ? trail.vol_raw[trail.vol_raw.length - 1] : null));
  } else if (isGthLiveActive) {
    currX = gthObj.current_point.x;
    currY = gthObj.current_point.y;
    currSpot = gthObj.synthetic_spx;
    currVol = gthObj.vix;
  } else if ((isOvernightEs || gthMode) && trail.x && trail.x.length > 0) {
    // Overnight ES-Only or GTH closed: pin Overvix beacon to last complete session tip (never plot frozen VIX vs ES move)
    currX = trail.x[trail.x.length - 1];
    currY = trail.y[trail.y.length - 1];
    currSpot = (trail.spot_raw && trail.spot_raw.length > 0) ? trail.spot_raw[trail.spot_raw.length - 1] : (targetData.market && targetData.market.spx ? targetData.market.spx.current : null);
    currVol = (trail.vol_raw && trail.vol_raw.length > 0) ? trail.vol_raw[trail.vol_raw.length - 1] : (targetData.market && targetData.market.vix ? targetData.market.vix.current : null);
  } else if (targetData.current_point && targetData.current_point.x !== undefined && targetData.current_point.y !== undefined && targetData.current_point.y !== null) {
    currX = targetData.current_point.x;
    currY = targetData.current_point.y;
    currSpot = isNdx
      ? (targetData.market ? targetData.market.current : null)
      : (targetData.market && targetData.market.spx ? targetData.market.spx.current : null);
    currVol = isNdx
      ? (targetData.market && targetData.market.vxn ? targetData.market.vxn.current : null)
      : (targetData.market && targetData.market.vix ? targetData.market.vix.current : null);
  } else if (targetData.market && targetData.market.pct_change !== undefined) {
    currX = targetData.market.pct_change;
    currY = (targetData.market.vxn && targetData.market.vxn.pt_change !== undefined)
      ? targetData.market.vxn.pt_change
      : (targetData.market.vix ? targetData.market.vix.pt_change : 0);
    currSpot = isNdx ? targetData.market.current : (targetData.market.spx ? targetData.market.spx.current : targetData.market.current);
    currVol = isNdx ? (targetData.market.vxn ? targetData.market.vxn.current : null) : (targetData.market.vix ? targetData.market.vix.current : null);
  } else if (trail.x && trail.x.length > 0 && trail.y && trail.y.length > 0) {
    currX = trail.x[trail.x.length - 1];
    currY = trail.y[trail.y.length - 1];
    currSpot = (trail.spot_raw && trail.spot_raw.length > 0) ? trail.spot_raw[trail.spot_raw.length - 1] : null;
    currVol = (trail.vol_raw && trail.vol_raw.length > 0) ? trail.vol_raw[trail.vol_raw.length - 1] : null;
  }

  const currSpotStr = (typeof currSpot === 'number' && !isNaN(currSpot))
    ? currSpot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : (currSpot || '-');
  const currVolStr = (typeof currVol === 'number' && !isNaN(currVol))
    ? currVol.toFixed(2)
    : (currVol || '-');

  // Update subtitle & card target dynamically
  const spSub = document.getElementById('spotvol-sub');
  if (spSub) {
    spSub.textContent = gthMode
      ? `SPX (ES Adj) % vs VIX Point Move with +${threshold.toFixed(1)} pt Threshold & GTH+RTH Path`
      : `${assetLabel} % vs ${volLabel} Point Move with +${threshold.toFixed(1)} pt Threshold & Intraday Path`;
  }
  const dispEl = document.getElementById('disp-thresh-pts');
  if (dispEl) dispEl.textContent = threshold.toFixed(1);
  const isOvervixed = isGthLiveActive
    ? (gthObj.overvix ? gthObj.overvix.is_overvixed : false)
    : (targetData.overvix ? targetData.overvix.is_overvixed : false);

  const trailSessionDate = (gthMode && trail.session_date) ? trail.session_date : bootstrap.session_date;
  const showLiveBeacon = (bootstrap.is_rth_active === true) || isGthLiveActive;
  const beaconName = isGthLiveActive
    ? "Live GTH Point"
    : ((bootstrap.is_historical || !showLiveBeacon) ? "Session Close Point" : "Live Point");

  const residLabel = isNdx ? 'Over-VXN Residual' : 'Overvix Residual';

  // Calculate Overvix residuals for historical 60D points
  const histCustomdata = xHist.map((x, i) => {
    const y = yHist[i];
    if (x === null || y === null || x === undefined || y === undefined) return ['', '', '-', '-'];
    const exp = intercept + slope * x;
    const r = y - exp;
    const rSign = (r >= 0) ? '+' : '';
    const rStr = `${rSign}${r.toFixed(2)} pts`;
    const isAlert = (r >= threshold);
    const isCrush = (r <= -threshold);
    const alertTag = isAlert
      ? "  <span style='color:#FF5370;font-weight:bold'>🚨 ALERT</span>"
      : (isCrush ? "  <span style='color:#06B6D4;font-weight:bold'>📉 CRUSH</span>" : "");

    let spotNum = (spotHist && spotHist[i] !== undefined) ? spotHist[i] : null;
    let volNum = (volHist && volHist[i] !== undefined) ? volHist[i] : null;

    if ((spotNum === null || volNum === null) && dates && dates[i]) {
      const dt = dates[i];
      const c1y = getCorrDataset(isNdx, '1Y') || getCorrDataset(isNdx, 'MAX');
      if (c1y && c1y.dates && c1y.spot_raw && c1y.vol_raw) {
        const idx = c1y.dates.indexOf(dt);
        if (idx !== -1) {
          if (spotNum === null && c1y.spot_raw[idx] !== undefined) spotNum = c1y.spot_raw[idx];
          if (volNum === null && c1y.vol_raw[idx] !== undefined) volNum = c1y.vol_raw[idx];
        }
      }
    }

    const spotStr = (typeof spotNum === 'number' && !isNaN(spotNum))
      ? spotNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : (spotNum || '-');
    const volStr = (typeof volNum === 'number' && !isNaN(volNum))
      ? volNum.toFixed(2)
      : (volNum || '-');

    return [rStr, alertTag, spotStr, volStr];
  });

  // Calculate Overvix residuals for intraday trail path points
  const trailCustomdata = (trail.x || []).map((x, i) => {
    const y = (trail.y && trail.y[i] !== undefined) ? trail.y[i] : null;
    if (x === null || y === null || x === undefined || y === undefined) return ['', '', '-', '-'];
    const exp = intercept + slope * x;
    const r = y - exp;
    const rSign = (r >= 0) ? '+' : '';
    const rStr = `${rSign}${r.toFixed(2)} pts`;
    const isAlert = (r >= threshold);
    const isCrush = (r <= -threshold);
    const alertTag = isAlert
      ? "  <span style='color:#FF5370;font-weight:bold'>🚨 ALERT</span>"
      : (isCrush ? "  <span style='color:#06B6D4;font-weight:bold'>📉 CRUSH</span>" : "");

    let rawSpot = (trail.spot_raw && trail.spot_raw[i] !== undefined) ? trail.spot_raw[i] : null;
    let rawVol = (trail.vol_raw && trail.vol_raw[i] !== undefined) ? trail.vol_raw[i] : null;
    if ((rawSpot === null || rawVol === null) && i === (trail.x || []).length - 1) {
      if (rawSpot === null) rawSpot = currSpot;
      if (rawVol === null) rawVol = currVol;
    }
    const spotStr = (typeof rawSpot === 'number' && !isNaN(rawSpot))
      ? rawSpot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : (rawSpot || '-');
    const volStr = (typeof rawVol === 'number' && !isNaN(rawVol))
      ? rawVol.toFixed(2)
      : (rawVol || '-');

    return [rStr, alertTag, spotStr, volStr];
  });
  if (trail) {
    trail.customdata = trailCustomdata;
  }

  // Calculate Overvix residual for session end / live beacon point
  const beaconExp = (currX !== null && currY !== null) ? (intercept + slope * currX) : null;
  const beaconResid = (beaconExp !== null) ? (currY - beaconExp) : null;
  const beaconResidStr = (beaconResid !== null) ? `${beaconResid >= 0 ? '+' : ''}${beaconResid.toFixed(2)} pts` : 'N/A';
  const beaconTag = (beaconResid !== null && beaconResid >= threshold)
    ? "  <span style='color:#FF5370;font-weight:bold'>🚨 ALERT</span>"
    : (beaconResid !== null && beaconResid <= -threshold ? "  <span style='color:#06B6D4;font-weight:bold'>📉 CRUSH</span>" : "");

  const beaconHover = isGthLiveActive
    ? `<b>Live GTH Point (${gthObj.es_symbol || 'ES'} Adj + VIX)</b><br>` +
      `SPX (ES Adj): <b>%{customdata[2]}</b> (%{x:+.2f}%)<br>` +
      `VIX: <b>%{customdata[3]}</b> (%{y:+.2f} pts)<br>` +
      `${residLabel}: <b>%{customdata[0]}</b>%{customdata[1]}<br>` +
      `<span style="color:#00E5FF;font-size:10px">👉 Click to Anchor Latest</span><extra></extra>`
    : ((bootstrap.is_historical || !showLiveBeacon)
      ? `<b>Session Close (${trailSessionDate || 'Prior'})</b><br>` +
        `${assetLabel}: <b>%{customdata[2]}</b> (%{x:+.2f}%)<br>` +
        `${volLabel}: <b>%{customdata[3]}</b> (%{y:+.2f} pts)<br>` +
        `${residLabel}: <b>%{customdata[0]}</b>%{customdata[1]}<br>` +
        `<span style="color:#00E5FF;font-size:10px">👉 Click to Anchor Official Close</span><extra></extra>`
      : `<b>Live Current Point</b><br>` +
        `${assetLabel}: <b>%{customdata[2]}</b> (%{x:+.2f}%)<br>` +
        `${volLabel}: <b>%{customdata[3]}</b> (%{y:+.2f} pts)<br>` +
        `${residLabel}: <b>%{customdata[0]}</b>%{customdata[1]}<br>` +
        `<span style="color:#00E5FF;font-size:10px">👉 Click to Anchor Latest</span><extra></extra>`);

  // Size gradient for historical points: oldest session = 3.5px, most recent session = 9.0px (current max)
  const nHist = xHist.length;
  const histSizes = nHist <= 1
    ? (nHist === 1 ? [9] : 9)
    : xHist.map((_, i) => Number((3.5 + (9.0 - 3.5) * (i / (nHist - 1))).toFixed(2)));

  // Dark theme hoverlabel matching other charts
  const darkHoverlabel = {
    bgcolor: 'rgba(15, 23, 42, 0.95)',
    bordercolor: isNdx ? '#C084FC' : '#00E5FF',
    font: { family: 'monospace', size: 11, color: '#F8FAFC' },
    align: 'left'
  };

  const traces = [
    // 0: Historical 60D Spot-Vol Points
    {
      x: xHist,
      y: yHist,
      text: dates,
      customdata: histCustomdata,
      mode: 'markers',
      name: `${assetLabel} Historical (60D)`,
      marker: {
        color: isNdx ? '#C084FC' : '#E6D385',
        size: histSizes,
        opacity: 0.85,
        line: { color: isNdx ? '#9333EA' : '#B39F50', width: 0.75 }
      },
      hoverlabel: darkHoverlabel,
      hovertemplate: getHistoricalDotHoverTemplate(assetLabel, volLabel),
      visible: true
    },
    // 1: Regression Trendline
    {
      x: xGrid,
      y: yTrend,
      mode: 'lines',
      name: 'Expected Trendline',
      line: { color: isNdx ? '#A855F7' : '#C5BF85', width: 2 },
      hoverinfo: 'skip'
    },
    // 2: Overvix / Over-VXN Threshold Line
    {
      x: xGrid,
      y: yThreshold,
      mode: 'lines',
      name: `Threshold (+${threshold.toFixed(1)} pts)`,
      line: { color: '#FF5370', width: 1.5, dash: 'dash' },
      hoverinfo: 'skip'
    },
    // 3: Overvix Shaded Zone
    {
      x: xGrid.concat([...xGrid].reverse()),
      y: yBandTop.concat([...yThreshold].reverse()),
      fill: 'toself',
      fillcolor: 'rgba(255, 83, 112, 0.12)',
      line: { color: 'transparent' },
      name: isNdx ? 'Over-VXN Zone' : 'Overvix Zone',
      hoverinfo: 'skip'
    },
    // 4: Intraday Breadcrumb Trail
    {
      x: trail.x || [],
      y: trail.y || [],
      text: trail.times || [],
      customdata: trailCustomdata,
      mode: 'lines+markers',
      name: bootstrap.is_historical ? `${bootstrap.session_date} Path` : (trailSessionDate ? `Session ${trailSessionDate} Path${gthMode ? ' (GTH+RTH)' : ''}` : "Intraday Path"),
      line: { color: isGthLiveActive ? '#818CF8' : '#00E5FF', width: 1.8, shape: 'spline' },
      marker: { color: isGthLiveActive ? '#818CF8' : '#00E5FF', size: 4, opacity: 0.8 },
      hoverlabel: darkHoverlabel,
      hovertemplate: `<b>%{text}</b><br>` +
                     `${assetLabel}: <b>%{customdata[2]}</b> (%{x:+.2f}%)<br>` +
                     `${volLabel}: <b>%{customdata[3]}</b> (%{y:+.2f} pts)<br>` +
                     `${residLabel}: <b>%{customdata[0]}</b>%{customdata[1]}<br>` +
                     `<span style="color:#00E5FF;font-size:10px">👉 Click to Anchor Residual Monitor</span><extra></extra>`,
      visible: true
    },
    // 5: Session End / Live Current Point
    {
      x: hasSessionStarted ? [currX] : [],
      y: hasSessionStarted ? [currY] : [],
      customdata: hasSessionStarted ? [[beaconResidStr, beaconTag, currSpotStr, currVolStr]] : [],
      mode: 'markers',
      name: beaconName,
      marker: {
        color: isOvervixed ? '#FF1744' : (isGthLiveActive ? '#818CF8' : '#00E5FF'),
        size: 14,
        line: { color: '#FFFFFF', width: 2 }
      },
      hoverlabel: darkHoverlabel,
      hovertemplate: beaconHover,
      showlegend: hasSessionStarted,
      visible: hasSessionStarted
    }
  ];

  const overlay = (isOvernightEs && gthObj) ? buildOvernightEsOverlay(gthObj) : { shapes: [], annotations: [] };
  const ovShapes = overlay.shapes;
  const ovAnnotations = overlay.annotations;

  const sessionPeriodLabel = (bootstrap.is_historical && bootstrap.session_date)
    ? bootstrap.session_date
    : (isGthLiveActive ? `GTH ${trailSessionDate || 'Today'}` : (!showLiveBeacon && trailSessionDate ? trailSessionDate : 'Today'));

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    hovermode: 'closest',
    hoverdistance: 35,
    hoverlabel: darkHoverlabel,
    margin: { l: 50, r: 20, t: 25, b: 45 },
    xaxis: {
      title: { text: `${assetLabel}${gthMode ? ' (ES Adj)' : ''} % Change (${sessionPeriodLabel})`, font: { color: '#94A3B8', size: 11 } },
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
    shapes: ovShapes,
    annotations: ovAnnotations,
    showlegend: true
  };

  Plotly.newPlot('overvix-chart', traces, layout, { responsive: true, displayModeBar: false }).then(attachOvervixChartClickListener);
}

let lastOvervixClickTimestamp = 0;

function attachOvervixChartClickListener() {
  const chartEl = document.getElementById('overvix-chart');
  if (!chartEl) return;

  if (typeof chartEl.removeAllListeners === 'function') {
    chartEl.removeAllListeners('plotly_click');
  }

  chartEl.on('plotly_click', function(eventData) {
    if (Date.now() - lastOvervixClickTimestamp < 300) return;
    if (!eventData || !eventData.points || eventData.points.length === 0) return;

    const pt = eventData.points[0];
    const curveNum = pt.curveNumber;
    lastOvervixClickTimestamp = Date.now();

    // 1. Session Close Beacon (Trace 5) OR final point of Intraday Path (Trace 4 tip)
    const trailLen = (cachedTrail && cachedTrail.x) ? cachedTrail.x.length : 0;
    const isBeacon = (curveNum === 5) || (curveNum === 4 && pt.pointIndex !== undefined && pt.pointIndex >= trailLen - 1);

    if (isBeacon) {
      setCorrAnchor('prior_close');
      highlightAnchorScroll();
      return;
    }

    // 2. Intraday Path Clicked (Trace 4)
    if (curveNum === 4 && pt.text) {
      let targetTime = pt.text;
      const isNdx = (currentAssetPair === 'NDX');
      const c = getCorrDataset(isNdx, currentCorrTf);
      const times = (c && c.times) ? c.times : [];
      const sessDate = (cachedBootstrap && cachedBootstrap.session_date) 
        ? cachedBootstrap.session_date 
        : (times.length > 0 ? times[times.length - 1].slice(0, 10) : '');
      if (sessDate && targetTime.length <= 8 && !targetTime.includes('-')) {
        targetTime = `${sessDate} ${targetTime}`;
      }
      setCorrAnchor('custom', targetTime);
      highlightAnchorScroll();
      return;
    }

    // 3. Historical 60D Spot-Vol Point Clicked (Trace 0)
    if (curveNum === 0 && pt.text) {
      handleHistoricalDotClick(pt.text);
    }
  });
}

function extractIsoDate(targetStr) {
  if (typeof targetStr === 'number' && targetStr > 1e9) {
    const ms = (targetStr < 1e11) ? (targetStr * 1000) : targetStr;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof targetStr !== 'string') return null;
  const match = targetStr.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function datasetCoversDate(c, targetDate) {
  if (!c || !c.times || c.times.length === 0 || !targetDate) return false;
  const firstDate = String(c.times[0]).slice(0, 10);
  const lastDate = String(c.times[c.times.length - 1]).slice(0, 10);
  return targetDate >= firstDate && targetDate <= lastDate;
}

function findBestHorizonForDate(targetDate, isNdx) {
  if (!targetDate) return currentCorrTf;
  const currentDs = getCorrDataset(isNdx, currentCorrTf);
  if (datasetCoversDate(currentDs, targetDate)) {
    return currentCorrTf;
  }

  let bestTf = null;
  let bestFirstDate = '';
  for (const tf of TF_STEPS) {
    const ds = getCorrDataset(isNdx, tf);
    if (!datasetCoversDate(ds, targetDate)) continue;
    const firstDate = String(ds.times[0]).slice(0, 10);
    if (bestTf === null || firstDate > bestFirstDate) {
      bestTf = tf;
      bestFirstDate = firstDate;
    }
  }
  return bestTf || currentCorrTf;
}

function ensureCorrRangeCoversTarget(targetStr, isNdx) {
  const targetDate = extractIsoDate(targetStr);
  if (!targetDate) return false;

  const bestTf = findBestHorizonForDate(targetDate, isNdx);
  if (!bestTf || bestTf === currentCorrTf) return false;

  const conf = TF_CONFIG[bestTf] || TF_CONFIG['5D'];
  currentCorrTf = bestTf;
  if (sliderCorrTimeframe && sliderCorrTimeframe.value != conf.step) {
    sliderCorrTimeframe.value = conf.step;
  }
  updateCorrSliderUI(bestTf);
  updateCorrMetricDisplay();
  propagateHorizonSync('corr', bestTf);

  if (corrSliderBadge) {
    corrSliderBadge.classList.add('ring-2', 'ring-cyan-400', 'animate-pulse');
    setTimeout(() => {
      corrSliderBadge.classList.remove('ring-2', 'ring-cyan-400', 'animate-pulse');
    }, 2000);
  }
  return true;
}

function getSpotVolDates(isNdx) {
  if (cachedBootstrap) {
    if (isNdx && cachedBootstrap.ndx && cachedBootstrap.ndx.overvix && Array.isArray(cachedBootstrap.ndx.overvix.dates)) {
      return cachedBootstrap.ndx.overvix.dates;
    }
    const useGthModel = !isNdx && !cachedBootstrap.is_historical && isGthEnabled
      && cachedBootstrap.session_status === 'GTH_ACTIVE'
      && cachedBootstrap.overvix && cachedBootstrap.overvix.gth_model
      && Array.isArray(cachedBootstrap.overvix.gth_model.dates)
      && cachedBootstrap.overvix.gth_model.dates.length > 0;
    if (useGthModel) {
      return cachedBootstrap.overvix.gth_model.dates;
    }
    if (!isNdx && cachedBootstrap.overvix && Array.isArray(cachedBootstrap.overvix.dates)) {
      return cachedBootstrap.overvix.dates;
    }
  }
  const overvixEl = document.getElementById('overvix-chart');
  if (overvixEl && overvixEl.data && overvixEl.data[0] && Array.isArray(overvixEl.data[0].text)) {
    return overvixEl.data[0].text;
  }
  return [];
}

/** Resolve the immediately preceding trading session date before targetDateStr. */
function findPreviousTradingDate(targetDateStr, isNdx) {
  const isoTarget = extractIsoDate(targetDateStr);
  if (!isoTarget) return null;

  let bestPrev = null;
  const considerDateList = (list) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      const iso = extractIsoDate(String(list[i]));
      if (iso && iso < isoTarget && (!bestPrev || iso > bestPrev)) {
        bestPrev = iso;
      }
    }
  };

  considerDateList(getSpotVolDates(isNdx));
  if (cachedBootstrap && !isNdx && cachedBootstrap.overvix) {
    considerDateList(cachedBootstrap.overvix.dates);
  }
  for (const tf of TF_STEPS) {
    const ds = getCorrDataset(isNdx, tf);
    if (ds && ds.times) {
      considerDateList(ds.times);
    }
  }
  return bestPrev;
}

function handleHistoricalDotClick(dateStr) {
  if (spotVolClickAction === 'load') {
    loadHistoricalSession(dateStr);
    return;
  }

  if (currentViewMode === 'historical') {
    returnToLiveMode();
  }

  const isNdx = (currentAssetPair === 'NDX');
  const clickedDate = extractIsoDate(dateStr) || dateStr;
  // Daily Spot-Vol dots represent moves from the prior session's close to clickedDate close
  const anchorDate = findPreviousTradingDate(clickedDate, isNdx) || clickedDate;
  ensureCorrRangeCoversTarget(anchorDate, isNdx);

  setCorrAnchor('date_close', anchorDate);
  highlightAnchorScroll();
}

function highlightAnchorScroll() {
  const target = document.getElementById('correlation-chart');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const pill = document.getElementById('anchor-status-pill');
  if (pill) {
    pill.classList.add('ring-2', 'ring-cyan-400', 'animate-pulse');
    setTimeout(() => {
      pill.classList.remove('ring-2', 'ring-cyan-400', 'animate-pulse');
    }, 2000);
  }
}

// Helper functions to build customdata for Term Structure & Tech Vol charts
function buildTsCustomdata(times, vix, vix3m, ratio) {
  return times.map((t, i) => {
    const v = vix[i];
    const v3m = vix3m[i];
    const r = ratio[i];
    const v3mStr = (typeof v3m === 'number' && !isNaN(v3m)) ? v3m.toFixed(2) : '-';
    const ratioStr = (typeof r === 'number' && !isNaN(r)) ? r.toFixed(4) : '-';
    const spread = (typeof v === 'number' && typeof v3m === 'number' && !isNaN(v) && !isNaN(v3m)) ? (v - v3m) : null;
    const spreadStr = (spread !== null) ? (spread >= 0 ? `+${spread.toFixed(2)} pts` : `${spread.toFixed(2)} pts`) : '-';
    
    let regimeBadge = '';
    if (typeof r === 'number' && !isNaN(r)) {
      if (r >= 1.00) {
        regimeBadge = "  <span style='color:#EF4444;font-weight:bold'>🚨 Backwardation (≥1.00)</span>";
      } else if (r >= 0.90) {
        regimeBadge = "  <span style='color:#F59E0B;font-weight:bold'>⚠️ Flattening (0.90–1.00)</span>";
      } else {
        regimeBadge = "  <span style='color:#10B981;font-weight:bold'>🟢 Contango (&lt;0.90)</span>";
      }
    }

    return [v3mStr, ratioStr, spreadStr, regimeBadge];
  });
}

function buildTechVolCustomdata(times, vxn, vix, spread, ratio) {
  return times.map((t, i) => {
    const vx = vxn[i];
    const vi = vix[i];
    const sp = spread[i];
    const r = ratio[i];
    const viStr = (typeof vi === 'number' && !isNaN(vi)) ? vi.toFixed(2) : '-';
    const spStr = (typeof sp === 'number' && !isNaN(sp)) ? (sp >= 0 ? `+${sp.toFixed(2)} pts` : `${sp.toFixed(2)} pts`) : '-';
    const rStr = (typeof r === 'number' && !isNaN(r)) ? r.toFixed(4) : '-';
    
    let regimeBadge = '';
    if (typeof sp === 'number' && !isNaN(sp)) {
      if (sp >= 9.0) {
        regimeBadge = "  <span style='color:#EF4444;font-weight:bold'>🚨 Tech Panic (≥9.0 pts)</span>";
      } else if (sp >= 5.0) {
        regimeBadge = "  <span style='color:#F59E0B;font-weight:bold'>⚠️ Elevated Tech Vol</span>";
      } else {
        regimeBadge = "  <span style='color:#10B981;font-weight:bold'>🟢 Tech Normal (&lt;5.0 pts)</span>";
      }
    }

    return [viStr, spStr, rStr, regimeBadge];
  });
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
  const techCustomdata = buildTechVolCustomdata(times, vxn, vix, spread, ratio);

  // Unified Single Hover Tooltip on Primary Trace (VXN)
  const traceVXN = {
    x: times,
    y: vxn,
    customdata: techCustomdata,
    name: 'VXN (Tech Vol)',
    mode: 'lines',
    line: { color: '#C084FC', width: 1.8 },
    xaxis: 'x',
    yaxis: 'y',
    hovertemplate:
      `<b>%{x|${timeHoverFmt}}</b>%{customdata[3]}<br>` +
      `VXN (Tech): <b>%{y:.2f}</b> · VIX (Broad): <b>%{customdata[0]}</b><br>` +
      `Spread (VXN-VIX): <b>%{customdata[1]}</b> · Ratio: <b>%{customdata[2]}</b><extra></extra>`
  };

  const traceVIX = {
    x: times,
    y: vix,
    name: 'VIX (Broad Vol)',
    mode: 'lines',
    line: { color: '#00E5FF', width: 1.5 },
    xaxis: 'x',
    yaxis: 'y',
    hoverinfo: 'skip'
  };

  const traceSpread = {
    x: times,
    y: spread,
    name: 'Tech Spread (VXN - VIX)',
    mode: 'lines',
    line: { color: '#F59E0B', width: 2 },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'skip'
  };

  const traceEquilibrium = {
    x: hasValidDates ? [dStart, dEnd] : [],
    y: hasValidDates ? [5.0, 5.0] : [],
    mode: 'lines',
    name: 'Equilibrium Spread (+5.0 pts)',
    line: { color: '#10B981', width: 1, dash: 'dot' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'skip'
  };

  const tracePanic = {
    x: hasValidDates ? [dStart, dEnd] : [],
    y: hasValidDates ? [9.0, 9.0] : [],
    mode: 'lines',
    name: 'Tech Panic Spread (≥ +9.0 pts)',
    line: { color: '#EF4444', width: 1.5, dash: 'dash' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'skip'
  };

  const xTitle = conf.xTitle;
  const rangebreaks = conf.rangebreaks || [];

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    hovermode: 'x',
    hoverdistance: 50,
    hoverlabel: {
      bgcolor: 'rgba(15, 23, 42, 0.95)',
      bordercolor: '#C084FC',
      font: { family: 'monospace', size: 11, color: '#F8FAFC' },
      align: 'left'
    },
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
      nticks: 10,
      showspikes: true,
      spikemode: 'across',
      spikesnap: 'cursor',
      spikecolor: '#C084FC',
      spikethickness: 1,
      spikedash: 'dot'
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
  const tsCustomdata = buildTsCustomdata(times, vix, vix3m, ratio);

  // Unified Single Hover Tooltip on Primary Trace (VIX)
  const traceVIX = {
    x: times,
    y: vix,
    customdata: tsCustomdata,
    name: 'VIX (30d)',
    mode: 'lines',
    line: { color: '#00E5FF', width: 1.5 },
    xaxis: 'x',
    yaxis: 'y',
    hovertemplate:
      `<b>%{x|${timeHoverFmt}}</b>%{customdata[3]}<br>` +
      `VIX (30d): <b>%{y:.2f}</b> · VIX3M (90d): <b>%{customdata[0]}</b><br>` +
      `Ratio: <b>%{customdata[1]}</b> · Spread: <b>%{customdata[2]}</b><extra></extra>`
  };

  const traceVIX3M = {
    x: times,
    y: vix3m,
    name: 'VIX3M (90d)',
    mode: 'lines',
    line: { color: '#FFA726', width: 1.5 },
    xaxis: 'x',
    yaxis: 'y',
    hoverinfo: 'skip'
  };

  const traceRatio = {
    x: times,
    y: ratio,
    name: 'Ratio (VIX/VIX3M)',
    mode: 'lines',
    line: { color: '#E6D385', width: 2 },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'skip'
  };

  const traceFlattening = {
    x: hasValidDates ? [dStart, dEnd] : [],
    y: hasValidDates ? [0.90, 0.90] : [],
    mode: 'lines',
    name: 'Flattening (0.90)',
    line: { color: '#FFA726', width: 1, dash: 'dot' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'skip'
  };

  const traceInversion = {
    x: hasValidDates ? [dStart, dEnd] : [],
    y: hasValidDates ? [1.00, 1.00] : [],
    mode: 'lines',
    name: 'Inversion (1.00)',
    line: { color: '#EF4444', width: 1.5, dash: 'dash' },
    xaxis: 'x',
    yaxis: 'y2',
    hoverinfo: 'skip'
  };

  const xTitle = conf.xTitle;
  const rangebreaks = conf.rangebreaks || [];

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    hovermode: 'x',
    hoverdistance: 50,
    hoverlabel: {
      bgcolor: 'rgba(15, 23, 42, 0.95)',
      bordercolor: '#00E5FF',
      font: { family: 'monospace', size: 11, color: '#F8FAFC' },
      align: 'left'
    },
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
      nticks: 10,
      showspikes: true,
      spikemode: 'across',
      spikesnap: 'cursor',
      spikecolor: '#00E5FF',
      spikethickness: 1,
      spikedash: 'dot'
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

function parseTimeToUtcMs(target) {
  if (target === null || target === undefined) return NaN;
  if (typeof target === 'number') {
    return (target < 1e11) ? (target * 1000) : target;
  }
  const clean = String(target).trim();
  if (!clean) return NaN;
  const num = Number(clean);
  if (!isNaN(num) && num > 1e9) {
    return (num < 1e11) ? (num * 1000) : num;
  }
  const iso = clean.replace(' ', 'T');
  if (iso.endsWith('Z') || iso.includes('+') || (iso.includes('-') && iso.lastIndexOf('-') > 7)) {
    return Date.parse(iso);
  }
  const withZ = (iso.length === 16) ? (iso + ':00Z') : (iso.length === 10 ? (iso + 'T00:00:00Z') : (iso + 'Z'));
  const ms = Date.parse(withZ);
  if (!isNaN(ms)) return ms;
  return Date.parse(iso);
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

  // 3. Substring match (either way: times[i] inside clean or clean inside times[i], only when clean has date granularity)
  if (clean.length >= 10) {
    for (let i = 0; i < times.length; i++) {
      if (clean.includes(times[i]) || times[i].includes(clean)) return i;
    }
  }

  // 4. Prefix match up to minutes (e.g. '2026-11-06 10:45:00'[:16] === '2026-11-06 10:45')
  if (clean.length >= 16) {
    const cleanPrefix = clean.slice(0, 16).replace('T', ' ');
    for (let i = 0; i < times.length; i++) {
      const tPrefix = times[i].slice(0, 16).replace('T', ' ');
      if (tPrefix === cleanPrefix) return i;
    }
  }

  // 5. Full Timestamp / UTC Milliseconds comparison
  // Ensures numeric epoch timestamps from Plotly p2c and date strings are compared in the same UTC coordinate frame
  const targetMs = parseTimeToUtcMs(target);
  if (!isNaN(targetMs)) {
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const tMs = parseTimeToUtcMs(times[i]);
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

  // 6. Time HH:MM comparison (intraday only fallback if no date supplied)
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

function getOfficialPriorClose(isNdx) {
  if (!isNdx && isGthChartActive(currentCorrTf) && cachedBootstrap) {
    if (cachedBootstrap.gth && cachedBootstrap.gth.ref_spx && cachedBootstrap.gth.ref_vix) {
      return { spot: cachedBootstrap.gth.ref_spx, vol: cachedBootstrap.gth.ref_vix };
    }
    if (cachedBootstrap.overvix && cachedBootstrap.overvix.gth_model) {
      const gm = cachedBootstrap.overvix.gth_model;
      if (gm.ref_spx && gm.ref_vix) {
        return { spot: gm.ref_spx, vol: gm.ref_vix };
      }
    }
  }
  if (cachedBootstrap && cachedBootstrap.reference_closes) {
    const rc = cachedBootstrap.reference_closes;
    return isNdx
      ? { spot: rc.ndx, vol: rc.vxn }
      : { spot: rc.spx, vol: rc.vix };
  }
  if (cachedBootstrap) {
    if (isNdx && cachedBootstrap.ndx && cachedBootstrap.ndx.market) {
      const m = cachedBootstrap.ndx.market;
      const spot = (m.current && typeof m.pct_change === 'number') ? m.current / (1 + m.pct_change / 100) : null;
      const vol = (m.vxn && m.vxn.current && typeof m.vxn.pt_change === 'number') ? m.vxn.current - m.vxn.pt_change : null;
      return { spot, vol };
    } else if (!isNdx && cachedBootstrap.market) {
      const m = cachedBootstrap.market;
      const spot = (m.spx && m.spx.current && typeof m.spx.pct_change === 'number') ? m.spx.current / (1 + m.spx.pct_change / 100) : null;
      const vol = (m.vix && m.vix.current && typeof m.vix.pt_change === 'number') ? m.vix.current - m.vix.pt_change : null;
      return { spot, vol };
    }
  }
  return null;
}

function resetCorrAnchor(triggerRender = true) {
  corrAnchor.active = false;
  corrAnchor.mode = 'open';
  corrAnchor.time = null;
  corrAnchor.index = -1;
  corrAnchor.isOfficialPriorClose = false;
  corrAnchor.targetDate = null;
  corrAnchor.spotBase = null;
  corrAnchor.volBase = null;
  corrAnchor.label = 'Session Baseline';
  updateAnchorUI();
  if (triggerRender) {
    renderCorrelationChart(currentCorrMode, currentCorrTf);
  }
}

function setCorrAnchor(mode, targetTime = null) {
  const isNdx = (currentAssetPair === 'NDX');

  if (mode === 'open') {
    resetCorrAnchor(true);
    return;
  }

  if (mode === 'daily_reset') {
    corrAnchor.active = true;
    corrAnchor.mode = 'daily_reset';
    corrAnchor.label = 'Daily Reset (Prior Close)';
    corrAnchor.time = null;
    corrAnchor.index = -1;
    corrAnchor.isOfficialPriorClose = true;
    corrAnchor.targetDate = null;
    corrAnchor.spotBase = null;
    corrAnchor.volBase = null;
    updateAnchorUI();
    updateCorrMetricDisplay();
    renderCorrelationChart(currentCorrMode, currentCorrTf);
    return;
  }

  if ((mode === 'date_close' || mode === 'custom') && targetTime) {
    ensureCorrRangeCoversTarget(targetTime, isNdx);
  }

  const c = getCorrDataset(isNdx, currentCorrTf);
  const times = c.times || [];
  if (!times || times.length === 0) return;

  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';

  const raw = getRawSpotVolSeries(c, isNdx);
  const spotRaw = raw.spot;
  const volRaw = raw.vol;

  let chosenIdx = -1;
  let isOfficialPriorClose = false;

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
  } else if (mode === 'close') {
    chosenIdx = times.length - 1;
  } else if (mode === 'prior_close') {
    const offRef = getOfficialPriorClose(isNdx);
    if (currentCorrTf === '1D') {
      chosenIdx = 0;
    } else {
      const latestDate = times[times.length - 1].slice(0, 10);
      for (let i = times.length - 1; i >= 0; i--) {
        if (times[i].slice(0, 10) < latestDate) {
          chosenIdx = i;
          break;
        }
      }
      if (chosenIdx === -1) chosenIdx = 0;
    }
    if (offRef && offRef.spot && offRef.vol) {
      isOfficialPriorClose = true;
    }
  } else if (mode === 'date_close' && targetTime) {
    const latestDate = times.length > 0 ? times[times.length - 1].slice(0, 10) : '';
    const svDates = getSpotVolDates(isNdx);
    const lastSvDate = svDates.length > 0 ? extractIsoDate(String(svDates[svDates.length - 1])) : null;
    const isPriorSession = (targetTime < latestDate && !times.some(t => t.slice(0, 10) > targetTime && t.slice(0, 10) < latestDate))
      && (!lastSvDate || targetTime === lastSvDate);
    if (isPriorSession) {
      setCorrAnchor('prior_close');
      return;
    }
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i].startsWith(targetTime)) {
        chosenIdx = i;
        break;
      }
    }
    if (chosenIdx === -1) {
      chosenIdx = findClosestTimeIndex(times, targetTime);
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
  corrAnchor.isOfficialPriorClose = isOfficialPriorClose;
  if (isOfficialPriorClose) {
    const offRef = getOfficialPriorClose(isNdx);
    corrAnchor.spotBase = offRef.spot;
    corrAnchor.volBase = offRef.vol;
  } else {
    corrAnchor.spotBase = spotRaw[chosenIdx];
    corrAnchor.volBase = volRaw[chosenIdx];
  }
  corrAnchor.targetDate = (mode === 'date_close') ? targetTime : null;

  const is1D = (currentCorrTf === '1D');
  const timeDisplay = is1D ? (corrAnchor.time.length > 10 ? corrAnchor.time.slice(11) : corrAnchor.time) : corrAnchor.time;
  let modePrefix = '';
  if (mode === 'close') modePrefix = 'Close: ';
  else if (mode === 'prior_close') modePrefix = 'Prior Close: ';
  else if (mode === 'date_close') modePrefix = 'Session Close: ';
  else if (mode === 'spot_low') modePrefix = `${assetLabel} Low: `;
  else if (mode === 'vol_high') modePrefix = `${volLabel} High: `;

  let timeLabel = isOfficialPriorClose ? '16:00' : timeDisplay;
  if (mode === 'date_close') {
    const dStr = (targetTime && targetTime.length >= 10) ? targetTime.slice(0, 10) : (corrAnchor.time.length >= 10 ? corrAnchor.time.slice(0, 10) : corrAnchor.time);
    timeLabel = `${dStr} 16:00`;
  }
  corrAnchor.label = `${modePrefix}${timeLabel} (${assetLabel}: ${corrAnchor.spotBase.toFixed(2)}, ${volLabel}: ${corrAnchor.volBase.toFixed(2)})`;

  // Sync custom time input if available
  const timePicker = document.getElementById('anchor-time-picker');
  if (timePicker) {
    const timeVal = is1D ? (corrAnchor.time.length > 10 ? corrAnchor.time.slice(11, 16) : corrAnchor.time) : corrAnchor.time;
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
  if (corrAnchor.mode === 'daily_reset') {
    updateAnchorUI();
    return;
  }
  const isNdx = (currentAssetPair === 'NDX');
  const c = getCorrDataset(isNdx, tf);
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
  } else if (corrAnchor.mode === 'close') {
    newIdx = times.length - 1;
  } else if (corrAnchor.mode === 'prior_close') {
    const offRef = getOfficialPriorClose(isNdx);
    if (tf === '1D') {
      newIdx = 0;
    } else {
      const latestDate = times[times.length - 1].slice(0, 10);
      for (let i = times.length - 1; i >= 0; i--) {
        if (times[i].slice(0, 10) < latestDate) {
          newIdx = i;
          break;
        }
      }
      if (newIdx === -1) newIdx = 0;
    }
    if (offRef && offRef.spot && offRef.vol) {
      corrAnchor.isOfficialPriorClose = true;
      corrAnchor.spotBase = offRef.spot;
      corrAnchor.volBase = offRef.vol;
    }
  } else if (corrAnchor.mode === 'date_close' && corrAnchor.targetDate) {
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i].startsWith(corrAnchor.targetDate)) {
        newIdx = i;
        break;
      }
    }
    if (newIdx === -1) newIdx = findClosestTimeIndex(times, corrAnchor.targetDate);
    if (newIdx === -1) newIdx = 0;
  } else if (corrAnchor.time) {
    newIdx = findClosestTimeIndex(times, corrAnchor.time);
  }

  if (newIdx < 0 || newIdx >= times.length) newIdx = 0;

  corrAnchor.index = newIdx;
  corrAnchor.time = times[newIdx];
  if (!corrAnchor.isOfficialPriorClose) {
    if (spotRaw[newIdx] !== undefined) corrAnchor.spotBase = spotRaw[newIdx];
    if (volRaw[newIdx] !== undefined) corrAnchor.volBase = volRaw[newIdx];
  }

  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';
  const timeDisplay = (tf === '1D') ? (corrAnchor.time.length > 10 ? corrAnchor.time.slice(11) : corrAnchor.time) : corrAnchor.time;
  let modePrefix = '';
  if (corrAnchor.mode === 'close') modePrefix = 'Close: ';
  else if (corrAnchor.mode === 'prior_close') modePrefix = 'Prior Close: ';
  else if (corrAnchor.mode === 'daily_reset') modePrefix = 'Daily Reset: ';
  else if (corrAnchor.mode === 'date_close') modePrefix = 'Session Close: ';
  else if (corrAnchor.mode === 'spot_low') modePrefix = `${assetLabel} Low: `;
  else if (corrAnchor.mode === 'vol_high') modePrefix = `${volLabel} High: `;

  let timeLabel = corrAnchor.isOfficialPriorClose ? '16:00' : timeDisplay;
  if (corrAnchor.mode === 'date_close') {
    const dStr = corrAnchor.targetDate || (corrAnchor.time.length >= 10 ? corrAnchor.time.slice(0, 10) : corrAnchor.time);
    timeLabel = `${dStr} 16:00`;
  }
  corrAnchor.label = `${modePrefix}${timeLabel} (${assetLabel}: ${corrAnchor.spotBase ? corrAnchor.spotBase.toFixed(2) : '-'}, ${volLabel}: ${corrAnchor.volBase ? corrAnchor.volBase.toFixed(2) : '-'})`;

  updateAnchorUI();
}

function harmonizeIntradayWithSettlements(c, isNdx, targetTf = currentCorrTf) {
  const rawTimes = (c && Array.isArray(c.times)) ? c.times : [];
  const raw = getRawSpotVolSeries(c, isNdx);
  const rawSpot = Array.isArray(raw.spot) ? raw.spot : [];
  const rawVol = Array.isArray(raw.vol) ? raw.vol : [];
  const rawSpotPct = (c && (isNdx ? (c.ndx_pct || c.spx_pct) : c.spx_pct)) || [];
  const rawVolPt = (c && (isNdx ? (c.vxn_pt || c.vix_pt) : c.vix_pt)) || [];

  const isGthActive = (!isNdx && (Boolean(c && Array.isArray(c.is_gth) && c.is_gth.length > 0) || isGthChartActive(targetTf)));
  const officialCloses = {};
  let dailyDatesList = [];
  const corrSrc = isNdx
    ? (cachedBootstrap && cachedBootstrap.ndx && cachedBootstrap.ndx.intraday_correlation)
    : (cachedBootstrap && cachedBootstrap.intraday_correlation);
  if (corrSrc) {
    const dailyDs = corrSrc['MAX'] || corrSrc['1Y'] || corrSrc['YTD'];
    if (dailyDs && dailyDs.dates && dailyDs.dates.length > 0) {
      dailyDatesList = dailyDs.dates;
      const dSpot = isNdx ? (dailyDs.ndx_raw || dailyDs.spot_raw) : (dailyDs.spx_raw || dailyDs.spot_raw);
      const dVol = isNdx ? (dailyDs.vxn_raw || dailyDs.vol_raw) : (dailyDs.vix_raw || dailyDs.vol_raw);
      for (let j = 0; j < dailyDatesList.length; j++) {
        if (dSpot && dSpot[j] !== undefined && dVol && dVol[j] !== undefined) {
          officialCloses[dailyDatesList[j]] = { spot: dSpot[j], vol: dVol[j] };
        }
      }
    }
  }

  if (rawTimes.length === 0) {
    return {
      times: rawTimes,
      spotRaw: rawSpot,
      volRaw: rawVol,
      baseSpotPct: rawSpotPct,
      baseVolPt: rawVolPt,
      settlementMap: {},
      settledDays: {},
      officialCloses: officialCloses,
      dailyDatesList: dailyDatesList,
      isGthActive: isGthActive
    };
  }

  const rawDayMap = {};
  for (let i = 0; i < rawTimes.length; i++) {
    const dStr = (rawTimes[i] || '').slice(0, 10);
    if (!rawDayMap[dStr]) rawDayMap[dStr] = [];
    rawDayMap[dStr].push(i);
  }
  const days = Object.keys(rawDayMap);

  const isHistoricalView = Boolean(cachedBootstrap && cachedBootstrap.is_historical);
  const liveState = (!isHistoricalView && currentViewMode === 'live' && lastLiveUpdatePayload) ? lastLiveUpdatePayload : cachedBootstrap;
  const curSessDate = liveState ? (liveState.session_date || '') : '';
  const isLiveRth = Boolean(!isHistoricalView && liveState && liveState.is_rth_active === true);
  const isLiveGth = Boolean(!isHistoricalView && liveState && (liveState.session_status === 'GTH_ACTIVE' || (liveState.gth && liveState.gth.is_gth_active === true)));
  const isPreMarketToday = Boolean(!isHistoricalView && liveState && liveState.session_status === 'PRE_MARKET');

  function isDaySessionCompleted(d, dIndices) {
    if (!d || !dIndices || dIndices.length === 0) return false;
    if (isHistoricalView) return true;
    const lastBar = rawTimes[dIndices[dIndices.length - 1]];
    const isDailyBar = Boolean(lastBar && lastBar.length === 10);
    const hhmm = lastBar ? lastBar.slice(11, 16) : '';
    const dayK = days.indexOf(d);

    if (isDailyBar) {
      if ((curSessDate && d < curSessDate) || (dayK >= 0 && dayK < days.length - 1)) {
        return true;
      }
      if (isLiveRth || (isGthActive && isLiveGth) || (isPreMarketToday && curSessDate && d === curSessDate)) {
        return false;
      }
      return true;
    }

    if (curSessDate && d < curSessDate) {
      return hhmm >= '15:30' || Boolean(officialCloses[d]);
    }
    if (dayK >= 0 && dayK < days.length - 1) {
      return hhmm >= '15:30' || Boolean(officialCloses[d]);
    }
    if (isLiveRth) return false;
    if (isGthActive && isLiveGth) return false;
    if (isPreMarketToday && curSessDate && d === curSessDate) return false;
    return hhmm >= '15:55';
  }

  const latestDay = days[days.length - 1];
  const latestDayIndices = rawDayMap[latestDay];
  const latestDayCompleted = isDaySessionCompleted(latestDay, latestDayIndices);

  if (latestDayCompleted) {
    if (!officialCloses[latestDay] && cachedBootstrap && cachedBootstrap.reference_closes) {
      const refSpot = isNdx
        ? (cachedBootstrap.reference_closes ? cachedBootstrap.reference_closes.ndx : (cachedBootstrap.ndx && cachedBootstrap.ndx.market ? cachedBootstrap.ndx.market.current : null))
        : (cachedBootstrap.reference_closes ? cachedBootstrap.reference_closes.spx : (cachedBootstrap.market && cachedBootstrap.market.spx ? cachedBootstrap.market.spx.current : null));
      const refVol = isNdx
        ? (cachedBootstrap.reference_closes ? cachedBootstrap.reference_closes.vxn : (cachedBootstrap.ndx && cachedBootstrap.ndx.market && cachedBootstrap.ndx.market.vxn ? cachedBootstrap.ndx.market.vxn.current : null))
        : (cachedBootstrap.reference_closes ? cachedBootstrap.reference_closes.vix : (cachedBootstrap.market && cachedBootstrap.market.vix ? cachedBootstrap.market.vix.current : null));

      if (refSpot && refVol) {
        officialCloses[latestDay] = { spot: refSpot, vol: refVol };
      }
    }
  } else {
    delete officialCloses[latestDay];
  }

  // Recover exact unanchored horizon baseline (sBase, vBase) so harmonized 16:00 bars stay mathematically consistent
  let sBase = null;
  let vBase = null;
  for (let i = 0; i < rawTimes.length; i++) {
    if (sBase === null && typeof rawSpot[i] === 'number' && rawSpot[i] > 0) {
      const p0 = (typeof rawSpotPct[i] === 'number' && !isNaN(rawSpotPct[i])) ? rawSpotPct[i] : 0;
      const denom = 1.0 + p0 / 100.0;
      sBase = denom > 0.01 ? (rawSpot[i] / denom) : rawSpot[i];
    }
    if (vBase === null && typeof rawVol[i] === 'number' && !isNaN(rawVol[i])) {
      const vp0 = (typeof rawVolPt[i] === 'number' && !isNaN(rawVolPt[i])) ? rawVolPt[i] : 0;
      vBase = rawVol[i] - vp0;
    }
    if (sBase !== null && vBase !== null) break;
  }

  const outTimes = [];
  const outSpotRaw = [];
  const outVolRaw = [];
  const outSpotPct = [];
  const outVolPt = [];
  const settlementMap = {};
  const settledDays = {};
  const isDailyHorizon = Boolean(rawTimes[0] && rawTimes[0].length === 10);

  for (let k = 0; k < days.length; k++) {
    const d = days[k];
    const indices = rawDayMap[d];
    const isCompleted = isDaySessionCompleted(d, indices);
    settledDays[d] = Boolean(isCompleted);

    for (let j = 0; j < indices.length; j++) {
      const idx = indices[j];
      outTimes.push(rawTimes[idx]);
      outSpotRaw.push(rawSpot[idx]);
      outVolRaw.push(rawVol[idx]);
      outSpotPct.push(typeof rawSpotPct[idx] === 'number' ? rawSpotPct[idx] : 0);
      outVolPt.push(typeof rawVolPt[idx] === 'number' ? rawVolPt[idx] : 0);
    }

    const offSettle = officialCloses[d];
    if (!isDailyHorizon && !isGthActive && isCompleted && offSettle && offSettle.spot && offSettle.vol) {
      const s = offSettle.spot;
      const v = offSettle.vol;
      const sPct = (sBase && sBase > 0) ? Math.round(((s - sBase) / sBase * 100.0) * 10000) / 10000 : 0;
      const vPt = (vBase !== null) ? Math.round((v - vBase) * 10000) / 10000 : 0;
      const lastRawTime = rawTimes[indices[indices.length - 1]] || '';
      const has1600 = (lastRawTime.slice(11, 16) >= '16:00');

      if (!has1600) {
        const settleTime = `${d} 16:00`;
        outTimes.push(settleTime);
        outSpotRaw.push(s);
        outVolRaw.push(v);
        outSpotPct.push(sPct);
        outVolPt.push(vPt);
        settlementMap[settleTime] = true;
      } else {
        const lastOutIdx = outTimes.length - 1;
        outSpotRaw[lastOutIdx] = s;
        outVolRaw[lastOutIdx] = v;
        outSpotPct[lastOutIdx] = sPct;
        outVolPt[lastOutIdx] = vPt;
        settlementMap[outTimes[lastOutIdx]] = true;
      }
    } else if (isDailyHorizon && isCompleted && offSettle && offSettle.spot && offSettle.vol) {
      const lastOutIdx = outTimes.length - 1;
      settlementMap[outTimes[lastOutIdx]] = true;
    }
  }

  return {
    times: outTimes,
    spotRaw: outSpotRaw,
    volRaw: outVolRaw,
    baseSpotPct: outSpotPct,
    baseVolPt: outVolPt,
    settlementMap: settlementMap,
    settledDays: settledDays,
    officialCloses: officialCloses,
    dailyDatesList: dailyDatesList,
    isGthActive: isGthActive
  };
}

function buildRollingDailyBetaMap(isNdx, windowDays = 60) {
  const betaMap = {};
  const corrSrc = isNdx
    ? (cachedBootstrap && cachedBootstrap.ndx && cachedBootstrap.ndx.intraday_correlation)
    : (cachedBootstrap && cachedBootstrap.intraday_correlation);
  if (!corrSrc) return betaMap;
  const ds = corrSrc['MAX'] || corrSrc['1Y'] || corrSrc['YTD'];
  if (!ds || !Array.isArray(ds.dates) || ds.dates.length < 2) return betaMap;

  const dates = ds.dates;
  const sArr = isNdx ? (ds.ndx_raw || ds.spot_raw || []) : (ds.spx_raw || ds.spot_raw || []);
  const vArr = isNdx ? (ds.vxn_raw || ds.vol_raw || []) : (ds.vix_raw || ds.vol_raw || []);
  const fallback = getActiveBetaAndIntercept(isNdx);

  const dx = [null];
  const dy = [null];
  for (let i = 1; i < dates.length; i++) {
    const s0 = sArr[i - 1], s1 = sArr[i];
    const v0 = vArr[i - 1], v1 = vArr[i];
    if (typeof s0 === 'number' && typeof s1 === 'number' && s0 > 0 && typeof v0 === 'number' && typeof v1 === 'number') {
      dx.push((s1 - s0) / s0 * 100.0);
      dy.push(v1 - v0);
    } else {
      dx.push(null);
      dy.push(null);
    }
  }

  for (let k = 0; k < dates.length; k++) {
    const startIdx = Math.max(1, k - windowDays);
    let n = 0, sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    for (let j = startIdx; j < k; j++) {
      const xj = dx[j], yj = dy[j];
      if (xj !== null && yj !== null && !isNaN(xj) && !isNaN(yj)) {
        n++;
        sumX += xj;
        sumY += yj;
        sumXX += xj * xj;
        sumXY += xj * yj;
      }
    }
    if (n >= 15) {
      const meanX = sumX / n;
      const meanY = sumY / n;
      const varX = sumXX - n * meanX * meanX;
      if (varX > 1e-6) {
        const rawSlope = (sumXY - n * meanX * meanY) / varX;
        const slope = Math.max(-5.0, Math.min(-0.3, rawSlope));
        const intercept = meanY - slope * meanX;
        betaMap[dates[k]] = { slope, intercept, beta: Math.abs(slope) };
        continue;
      }
    }
    betaMap[dates[k]] = {
      slope: fallback.rawSlope,
      intercept: fallback.rawIntercept,
      beta: fallback.beta
    };
  }
  return betaMap;
}

function computeAnchoredSeries(c, isNdx, targetTf = currentCorrTf) {
  const h = harmonizeIntradayWithSettlements(c, isNdx, targetTf);
  const times = h.times;
  const spotRaw = h.spotRaw;
  const volRaw = h.volRaw;

  if (!corrAnchor.active || times.length === 0) {
    return {
      times: times,
      spotPct: h.baseSpotPct,
      volPt: h.baseVolPt,
      spotRaw: spotRaw,
      volRaw: volRaw,
      settlementMap: h.settlementMap,
      settledDays: h.settledDays,
      isAnchored: false,
      anchorIdx: -1,
      anchorTime: null,
      anchoredCorr: null,
      latestAnchoredCorr: null,
      returnCount: 0
    };
  }

  // Daily Reset Anchor Mode: each day anchored to its prior official close
  if (corrAnchor.mode === 'daily_reset') {
    const isGthActive = h.isGthActive;
    const officialCloses = h.officialCloses;
    const dailyDatesList = h.dailyDatesList;
    const settlementMap = h.settlementMap;
    const settledDays = h.settledDays;

    const rawDayMap = {};
    for (let i = 0; i < times.length; i++) {
      const dStr = times[i].slice(0, 10);
      if (!rawDayMap[dStr]) rawDayMap[dStr] = [];
      rawDayMap[dStr].push(i);
    }
    const days = Object.keys(rawDayMap);
    const latestDay = days[days.length - 1];

    // Determine prior close anchor for each day
    const dayPriorCloses = {};
    for (let k = 0; k < days.length; k++) {
      const d = days[k];
      if (d === latestDay && isGthActive && cachedBootstrap && cachedBootstrap.gth && cachedBootstrap.gth.ref_spx && cachedBootstrap.gth.ref_vix) {
        dayPriorCloses[d] = {
          spot: cachedBootstrap.gth.ref_spx,
          vol: cachedBootstrap.gth.ref_vix
        };
      } else if (k > 0) {
        const prevDay = days[k - 1];
        if (officialCloses[prevDay] && officialCloses[prevDay].spot && officialCloses[prevDay].vol) {
          dayPriorCloses[d] = {
            spot: officialCloses[prevDay].spot,
            vol: officialCloses[prevDay].vol
          };
        } else {
          const prevIndices = rawDayMap[prevDay];
          const lastIdx = prevIndices[prevIndices.length - 1];
          dayPriorCloses[d] = {
            spot: spotRaw[lastIdx],
            vol: volRaw[lastIdx]
          };
        }
      } else {
        // Day 0: look up latest official close prior to d
        let refSpot = null;
        let refVol = null;
        if (isGthActive && cachedBootstrap && cachedBootstrap.gth && cachedBootstrap.gth.ref_spx && cachedBootstrap.gth.ref_vix) {
          refSpot = cachedBootstrap.gth.ref_spx;
          refVol = cachedBootstrap.gth.ref_vix;
        } else {
          for (let j = dailyDatesList.length - 1; j >= 0; j--) {
            if (dailyDatesList[j] < d) {
              const entry = officialCloses[dailyDatesList[j]];
              if (entry) {
                refSpot = entry.spot;
                refVol = entry.vol;
                break;
              }
            }
          }
        }
        if (!refSpot || !refVol) {
          const firstIdx = rawDayMap[d][0];
          refSpot = spotRaw[firstIdx];
          refVol = volRaw[firstIdx];
        }
        dayPriorCloses[d] = { spot: refSpot, vol: refVol };
      }
    }

    const isLongDailyReset = ['3M', '6M', 'YTD', '1Y', 'MAX'].includes(targetTf);
    if (isLongDailyReset) {
      const rollingBetaMap = buildRollingDailyBetaMap(isNdx, 60);
      const fallbackModel = getActiveBetaAndIntercept(isNdx);
      const dailyDates = [];
      const dailySpotPct = [];
      const dailyVolPt = [];
      const dailySpotRaw = [];
      const dailyVolRaw = [];
      const dailyResids = [];
      const dailyBetas = [];
      const dailyIntercepts = [];
      const dayMap = {};

      for (let k = 0; k < days.length; k++) {
        const d = days[k];
        const indices = rawDayMap[d];
        const termIdx = indices[indices.length - 1];
        const ref = dayPriorCloses[d];
        const s0 = ref.spot;
        const v0 = ref.vol;
        const s = spotRaw[termIdx];
        const v = volRaw[termIdx];
        if (typeof s !== 'number' || isNaN(s) || typeof v !== 'number' || isNaN(v)) continue;

        const sPct = (s0 > 0) ? Math.round(((s - s0) / s0 * 100.0) * 10000) / 10000 : 0;
        const vPt = Math.round((v - v0) * 10000) / 10000;
        const m = rollingBetaMap[d] || { slope: fallbackModel.rawSlope, intercept: fallbackModel.rawIntercept, beta: fallbackModel.beta };
        const r = Math.round((vPt - (m.intercept + m.slope * sPct)) * 10000) / 10000;

        dayMap[d] = [dailyDates.length];
        dailyDates.push(d);
        dailySpotPct.push(sPct);
        dailyVolPt.push(vPt);
        dailySpotRaw.push(s);
        dailyVolRaw.push(v);
        dailyResids.push(r);
        dailyBetas.push(Number(m.beta.toFixed(2)));
        dailyIntercepts.push(m.intercept);
      }

      const lastSpot = dayPriorCloses[latestDay] ? dayPriorCloses[latestDay].spot : (dailySpotRaw[dailySpotRaw.length - 1] || 1);
      const lastVol = dayPriorCloses[latestDay] ? dayPriorCloses[latestDay].vol : (dailyVolRaw[dailyVolRaw.length - 1] || 20);
      return {
        times: dailyDates,
        spotPct: dailySpotPct,
        volPt: dailyVolPt,
        spotRaw: dailySpotRaw,
        volRaw: dailyVolRaw,
        dailyResids: dailyResids,
        dailyBetas: dailyBetas,
        dailyIntercepts: dailyIntercepts,
        isAnchored: true,
        isDailyReset: true,
        isLongDailyReset: true,
        dayMap: dayMap,
        days: dailyDates,
        settlementMap: settlementMap,
        settledDays: settledDays,
        dayPriorCloses: dayPriorCloses,
        anchorIdx: dailyDates.length > 0 ? dailyDates.length - 1 : 0,
        anchorTime: dailyDates.length > 0 ? dailyDates[dailyDates.length - 1] : null,
        s0: lastSpot,
        v0: lastVol,
        anchoredCorr: null,
        latestAnchoredCorr: null,
        returnCount: dailyDates.length
      };
    }

    const outTimes = [];
    const outSpotPct = [];
    const outVolPt = [];
    const outSpotRaw = [];
    const outVolRaw = [];
    const dayMap = {};
    const sessionStartTimes = [];

    for (let k = 0; k < days.length; k++) {
      const d = days[k];
      const indices = rawDayMap[d];
      const ref = dayPriorCloses[d];
      const s0 = ref.spot;
      const v0 = ref.vol;

      const dayIndices = [];
      sessionStartTimes.push(times[indices[0]]);

      for (let j = 0; j < indices.length; j++) {
        const idx = indices[j];
        const s = spotRaw[idx];
        const v = volRaw[idx];
        const sPct = (s0 > 0 && typeof s === 'number') ? Math.round(((s - s0) / s0 * 100.0) * 10000) / 10000 : 0;
        const vPt = (typeof v === 'number') ? Math.round((v - v0) * 10000) / 10000 : 0;

        dayIndices.push(outTimes.length);
        outTimes.push(times[idx]);
        outSpotPct.push(sPct);
        outVolPt.push(vPt);
        outSpotRaw.push(s);
        outVolRaw.push(v);
      }

      dayMap[d] = dayIndices;
    }

    const latestIndices = dayMap[latestDay];
    const latestAnchorIdx = latestIndices[0];

    return {
      times: outTimes,
      spotPct: outSpotPct,
      volPt: outVolPt,
      spotRaw: outSpotRaw,
      volRaw: outVolRaw,
      isAnchored: true,
      isDailyReset: true,
      dayMap: dayMap,
      days: days,
      settlementMap: settlementMap,
      settledDays: settledDays,
      anchorIdx: latestAnchorIdx >= 0 ? latestAnchorIdx : 0,
      anchorTime: outTimes[latestAnchorIdx],
      sessionStartTimes: sessionStartTimes,
      dayPriorCloses: dayPriorCloses,
      s0: dayPriorCloses[latestDay].spot,
      v0: dayPriorCloses[latestDay].vol,
      anchoredCorr: null,
      latestAnchoredCorr: null,
      returnCount: latestIndices.length
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
    } else if (corrAnchor.mode === 'close') {
      idx = times.length - 1;
    } else if (corrAnchor.mode === 'prior_close') {
      if (currentCorrTf === '1D') {
        idx = 0;
      } else {
        const latestDate = times[times.length - 1].slice(0, 10);
        for (let i = times.length - 1; i >= 0; i--) {
          if (times[i].slice(0, 10) < latestDate) {
            idx = i;
            break;
          }
        }
        if (idx === -1) idx = 0;
      }
      const offRef = getOfficialPriorClose(isNdx);
      if (offRef && offRef.spot && offRef.vol) {
        corrAnchor.isOfficialPriorClose = true;
        corrAnchor.spotBase = offRef.spot;
        corrAnchor.volBase = offRef.vol;
      }
    } else if (corrAnchor.time) {
      idx = findClosestTimeIndex(times, corrAnchor.time);
    }
    if (idx < 0 || idx >= times.length) idx = 0;
    corrAnchor.index = idx;
    corrAnchor.time = times[idx];
    if (!corrAnchor.isOfficialPriorClose) {
      if (spotRaw[idx] !== undefined) corrAnchor.spotBase = spotRaw[idx];
      if (volRaw[idx] !== undefined) corrAnchor.volBase = volRaw[idx];
    }
  }
  const s0 = (corrAnchor.mode === 'prior_close' && corrAnchor.isOfficialPriorClose && corrAnchor.spotBase)
    ? corrAnchor.spotBase
    : spotRaw[idx];
  const v0 = (corrAnchor.mode === 'prior_close' && corrAnchor.isOfficialPriorClose && corrAnchor.volBase)
    ? corrAnchor.volBase
    : volRaw[idx];

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
    settlementMap: h.settlementMap,
    settledDays: h.settledDays,
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
  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';
  const thresh = isNdx ? currentNdxThreshold : currentThreshold;

  if (anchoredSeries.isLongDailyReset && len > 0) {
    const lastIdx = len - 1;
    const spotNetPct = spotPct[lastIdx] || 0;
    const volNetPt = volPt[lastIdx] || 0;
    const spotNetPts = (typeof spotRaw[lastIdx] === 'number' && s0) ? (spotRaw[lastIdx] - s0) : 0;
    const netResid = (Array.isArray(anchoredSeries.dailyResids) && typeof anchoredSeries.dailyResids[lastIdx] === 'number')
      ? anchoredSeries.dailyResids[lastIdx]
      : 0;
    const settledDays = anchoredSeries.settledDays || {};
    let alertCount = 0;
    for (let i = 0; i < len; i++) {
      if (settledDays[times[i]] && anchoredSeries.dailyResids[i] >= thresh) alertCount++;
    }
    const isAlert = netResid >= thresh;
    const isCrush = netResid <= -thresh;
    return {
      isLatest: false,
      elapsedStr: `${len}d Scanner`,
      spotNetPct: spotNetPct,
      spotNetPts: spotNetPts,
      volNetPt: volNetPt,
      netResid: netResid,
      residSign: netResid >= 0 ? '+' : '',
      residStatus: isAlert ? 'OVERVIX ALERT' : (isCrush ? 'VOL CRUSH' : 'NORMAL'),
      residBadgeClass: isAlert
        ? 'bg-rose-950 text-rose-300 border border-rose-800 animate-pulse'
        : (isCrush ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-emerald-950 text-emerald-300 border border-emerald-800'),
      residColor: isAlert ? 'text-rose-400' : (isCrush ? 'text-cyan-400' : 'text-emerald-400'),
      badgeClass: 'bg-cyan-950/80 text-cyan-300 border border-cyan-800',
      tag: `${alertCount} ALERT CLOSE${alertCount === 1 ? '' : 'S'}`,
      summary: `Causal rolling 60D β daily scanner across ${len} sessions (${alertCount} settled ${isNdx ? 'Over-VXN' : 'Overvix'} alert close${alertCount === 1 ? '' : 's'}).`,
      anchorTime: times[lastIdx]
    };
  }

  if (anchorIdx >= len - 1) {
    return {
      isLatest: true,
      elapsedStr: '0m',
      spotNetPct: 0,
      spotNetPts: 0,
      volNetPt: 0,
      netResid: 0,
      residSign: '',
      residStatus: 'AT ANCHOR',
      residBadgeClass: 'bg-slate-800 text-slate-400 border-slate-700',
      residColor: 'text-slate-400',
      badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
      tag: 'ANCHOR AT LATEST BAR',
      summary: 'Anchor set at the latest bar. Monitoring incoming recovery ticks...'
    };
  }

  const lastIdx = len - 1;
  const elapsedBars = lastIdx - anchorIdx;
  const barMinutes = (['5D', '10D', '1M'].includes(currentCorrTf) ? 5 : 1);
  const elapsedMinutes = elapsedBars * barMinutes;
  const hours = Math.floor(elapsedMinutes / 60);
  const mins = elapsedMinutes % 60;
  const elapsedStr = (currentCorrTf === '1D' || anchoredSeries.isDailyReset) 
    ? (hours > 0 ? `${hours}h ${mins}m` : `${mins}m`) 
    : `${elapsedBars} bars`;

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

  // Evaluate Post-Anchor Instantaneous Overvix Residual strictly from anchor point to latest bar
  const { beta, rawIntercept } = getActiveBetaAndIntercept(isNdx);
  // When anchored to Prior Close or Daily Reset, include the model intercept (alpha) to match the official session Overvix residual
  const alpha = (corrAnchor.mode === 'prior_close' || corrAnchor.mode === 'daily_reset') ? rawIntercept : 0;
  const netResid = volNetPt - alpha + beta * spotNetPct;
  let residStatus = "NORMAL";
  let residBadgeClass = "bg-emerald-950 text-emerald-300 border border-emerald-800";
  let residColor = "text-emerald-400";
  let residSummaryPart = "";

  if (anchoredSeries.isDailyReset) {
    tag = "ACTIVE SESSION";
    badgeClass = "bg-cyan-950/80 text-cyan-300 border border-cyan-800";
  }

  if (netResid >= thresh) {
    residStatus = "OVERVIX ALERT";
    residBadgeClass = "bg-rose-950 text-rose-300 border border-rose-800 animate-pulse";
    residColor = "text-rose-400";
    residSummaryPart = ` Overvix residual is elevated (+${netResid.toFixed(2)} pts), signaling persistent hedging pressure despite spot recovery.`;
  } else if (netResid <= -thresh) {
    residStatus = "VOL CRUSH";
    residBadgeClass = "bg-cyan-950 text-cyan-300 border border-cyan-800";
    residColor = "text-cyan-400";
    residSummaryPart = ` Volatility experienced an outsized crush (${netResid.toFixed(2)} pts below expectation), signaling aggressive call buying or short covering.`;
  } else {
    residStatus = "NORMAL";
    residBadgeClass = "bg-emerald-950 text-emerald-300 border border-emerald-800";
    residColor = "text-emerald-400";
    residSummaryPart = ` Overvix residual (${netResid >= 0 ? '+' : ''}${netResid.toFixed(2)} pts) remains within spot-vol equilibrium.`;
  }

  summary += residSummaryPart;

  return {
    isLatest: false,
    elapsedStr: elapsedStr,
    spotNetPct: spotNetPct,
    spotNetPts: spotNetPts,
    volNetPt: volNetPt,
    netResid: netResid,
    residSign: netResid >= 0 ? '+' : '',
    residStatus: residStatus,
    residBadgeClass: residBadgeClass,
    residColor: residColor,
    tag: tag,
    badgeClass: badgeClass,
    summary: summary,
    anchorTime: times[anchorIdx]
  };
}

function updateAnchorUI() {
  const isNdx = (currentAssetPair === 'NDX');
  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';

  const pill = document.getElementById('anchor-status-pill');
  const banner = document.getElementById('corr-recovery-banner');
  const btnOpen = document.getElementById('btn-anchor-open');
  const btnDailyReset = document.getElementById('btn-anchor-daily-reset');
  const btnCustom = document.getElementById('btn-anchor-custom-toggle');
  const isLongHorizon = ['3M', '6M', 'YTD', '1Y', 'MAX'].includes(currentCorrTf);

  [btnOpen, btnDailyReset, btnCustom].forEach(btn => {
    if (btn) btn.className = "px-2.5 py-1 rounded text-slate-400 hover:text-white transition flex items-center space-x-1 font-semibold";
  });

  if (btnDailyReset) {
    btnDailyReset.title = isLongHorizon
      ? "Daily Reset Scanner (≥3M): plots SPX/VIX context above and color-coded settled 1-day Overvix Residuals (causal 60D β) below"
      : "Anchor each day to its prior official close (16:00 ET) so each day renders like a 1-day chart";
  }

  if (!corrAnchor.active) {
    if (pill) {
      pill.textContent = "Session Baseline";
      pill.className = "text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-medium";
    }
    if (btnOpen) btnOpen.className = "px-2 py-1 rounded text-cyan-400 font-semibold bg-slate-800 shadow-sm transition hover:text-white";
    if (banner) {
      banner.innerHTML = '';
    }
    const commentEl = document.getElementById('anchor-summary-comment');
    if (commentEl) {
      commentEl.innerHTML = `<span class="text-slate-500 text-[11px] font-sans">Baseline from session open. Select <strong>[Daily Reset]</strong> or <strong>[Custom]</strong>, or click chart to set an anchor point.</span>`;
    }
    return;
  }

  if (pill) {
    pill.textContent = corrAnchor.label;
    pill.className = "text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold";
  }

  if (corrAnchor.mode === 'daily_reset') {
    if (btnDailyReset) {
      btnDailyReset.className = "px-2 py-1 rounded text-cyan-400 font-semibold bg-cyan-950/80 border border-cyan-800 shadow-sm transition flex items-center space-x-1";
    }
    const commentEl = document.getElementById('anchor-summary-comment');
    if (commentEl) {
      commentEl.innerHTML = isLongHorizon
        ? `<span class="text-cyan-400/90 text-[11px] font-sans">Daily Reset Scanner: Upper shows ${assetLabel} &amp; ${volLabel} regime; Lower shows settled 1-day Overvix Residuals using causal rolling 60D β.</span>`
        : `<span class="text-cyan-400/90 text-[11px] font-sans">Each day anchored to its prior official close (16:00 ET). Traces display daily trajectories with overnight reset.</span>`;
    }
  } else if ((corrAnchor.mode === 'custom' || corrAnchor.mode === 'date_close') && btnCustom) {
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

function findDistinctVixHighs(times, volRaw, pullbackThresh = 0.20, clusterMinutes = 30, aggregationMode = 'intraday') {
  if (!times || !volRaw || times.length === 0 || volRaw.length === 0) return [];

  // Helper to parse ISO / date-time strings safely to milliseconds
  const parseTimeMs = (tStr) => {
    if (!tStr) return 0;
    const iso = String(tStr).replace(' ', 'T');
    const ms = new Date(iso).getTime();
    return isNaN(ms) ? 0 : ms;
  };

  // Helper to get Monday-anchored calendar week key (YYYY-WMM-DD) for weekly grouping (1M)
  const getWeekKey = (tStr) => {
    const iso = String(tStr).replace(' ', 'T');
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(tStr).slice(0, 10);
    const day = d.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
    const diffToMonday = (day === 0 ? 6 : day - 1);
    const monday = new Date(d);
    monday.setDate(d.getDate() - diffToMonday);
    const y = monday.getFullYear();
    const m = String(monday.getMonth() + 1).padStart(2, '0');
    const dt = String(monday.getDate()).padStart(2, '0');
    return `${y}-W${m}-${dt}`;
  };

  // Group point indices by session date (YYYY-MM-DD)
  const sessions = {};
  for (let i = 0; i < times.length; i++) {
    const d = String(times[i]).slice(0, 10);
    if (!sessions[d]) sessions[d] = [];
    sessions[d].push(i);
  }

  const dailyHighs = [];

  for (const dateStr of Object.keys(sessions)) {
    const idxs = sessions[dateStr];
    if (idxs.length === 0) continue;

    let candHigh = volRaw[idxs[0]];
    let candIdx = idxs[0];
    let trough = candHigh;
    let prevConfirmedHigh = -Infinity;
    const sessionHighs = [];

    for (let j = 1; j < idxs.length; j++) {
      const idx = idxs[j];
      const v = volRaw[idx];
      if (typeof v !== 'number' || isNaN(v)) continue;

      if (v > candHigh) {
        candHigh = v;
        candIdx = idx;
        trough = v;
      } else {
        if (v < trough) {
          trough = v;
        }

        // If pullback threshold exceeded from candidate high
        if ((candHigh - trough) >= pullbackThresh) {
          if (candHigh > prevConfirmedHigh) {
            sessionHighs.push({
              idx: candIdx,
              time: times[candIdx],
              vixLevel: candHigh,
              prevHigh: prevConfirmedHigh !== -Infinity ? prevConfirmedHigh : null,
              pullback: Math.round((candHigh - trough) * 100) / 100
            });
            prevConfirmedHigh = candHigh;
          }
          trough = v;
        }
      }
    }

    // Session close check: if candidate high at end of session > prevConfirmedHigh
    if (candHigh > prevConfirmedHigh && candIdx !== -1) {
      sessionHighs.push({
        idx: candIdx,
        time: times[candIdx],
        vixLevel: candHigh,
        prevHigh: prevConfirmedHigh !== -Infinity ? prevConfirmedHigh : null,
        isSessionHigh: true
      });
    }

    if (sessionHighs.length === 0) continue;

    // Daily & Weekly constraints: on >= 5D charts, extract max 1 high per day first
    if (aggregationMode === 'day' || aggregationMode === 'week' || aggregationMode === 1) {
      const dayPeak = sessionHighs.reduce((best, curr) => curr.vixLevel > best.vixLevel ? curr : best, sessionHighs[0]);
      dailyHighs.push(dayPeak);
    } else if (sessionHighs.length > 1 && clusterMinutes > 0) {
      // Intraday (1D): Suppress clustered / proximate highs with NMS
      const sorted = [...sessionHighs].sort((a, b) => b.vixLevel - a.vixLevel);
      const suppressed = new Set();
      const kept = [];

      for (let i = 0; i < sorted.length; i++) {
        if (suppressed.has(i)) continue;
        const peak = sorted[i];
        kept.push(peak);

        const tPeak = parseTimeMs(peak.time);
        for (let j = i + 1; j < sorted.length; j++) {
          if (suppressed.has(j)) continue;
          const other = sorted[j];
          const tOther = parseTimeMs(other.time);
          const diffMinutes = Math.abs(tPeak - tOther) / (60 * 1000);
          if (diffMinutes <= clusterMinutes) {
            suppressed.add(j);
          }
        }
      }

      // Re-sort kept highs chronologically by point index
      kept.sort((a, b) => a.idx - b.idx);
      dailyHighs.push(...kept);
    } else {
      dailyHighs.push(...sessionHighs);
    }
  }

  // On 1M horizon: group daily peaks by calendar week and mark max 1 high per week
  if (aggregationMode === 'week') {
    const weeklyGroups = {};
    for (const h of dailyHighs) {
      const wk = getWeekKey(h.time);
      if (!weeklyGroups[wk]) weeklyGroups[wk] = [];
      weeklyGroups[wk].push(h);
    }

    // Map each week key to its boundary indices in the times series
    const weekBounds = {};
    for (let i = 0; i < times.length; i++) {
      const wk = getWeekKey(times[i]);
      if (!weekBounds[wk]) {
        weekBounds[wk] = { firstIdx: i, lastIdx: i };
      } else {
        weekBounds[wk].lastIdx = i;
      }
    }

    const weeklyHighs = [];
    for (const wk of Object.keys(weeklyGroups)) {
      const pts = weeklyGroups[wk];
      const best = pts.reduce((b, c) => c.vixLevel > b.vixLevel ? c : b, pts[0]);
      
      const wb = weekBounds[wk];
      if (wb) {
        // Check if candidate high is on the start edge of the week (e.g. Monday morning open)
        const isStartEdge = (best.idx === wb.firstIdx || (best.idx <= wb.firstIdx + 1 && String(best.time).slice(11) <= '10:00'));
        if (isStartEdge && wb.firstIdx > 0) {
          const priorWeekClose = volRaw[wb.firstIdx - 1];
          // If high is on edge of week and <= prior close (or lower), it's a downward continuation, not a high
          if (typeof priorWeekClose === 'number' && best.vixLevel <= priorWeekClose) {
            continue;
          }
        }

        // Check if candidate high is on the end edge of the week (e.g. Friday close)
        const isEndEdge = (best.idx === wb.lastIdx);
        if (isEndEdge && wb.lastIdx < volRaw.length - 1) {
          const nextWeekOpen = volRaw[wb.lastIdx + 1];
          if (typeof nextWeekOpen === 'number' && best.vixLevel <= nextWeekOpen) {
            continue;
          }
        }
      }

      weeklyHighs.push(best);
    }
    weeklyHighs.sort((a, b) => a.idx - b.idx);
    return weeklyHighs;
  }

  return dailyHighs;
}

function buildSessionSegments(times) {
  const segments = [];
  if (!Array.isArray(times) || times.length === 0) return segments;
  let segStart = 0;
  let prevDay = (times[0] || '').slice(0, 10);
  for (let i = 1; i < times.length; i++) {
    const curDay = (times[i] || '').slice(0, 10);
    if (curDay && prevDay && curDay !== prevDay) {
      segments.push({ start: segStart, end: i, day: prevDay, startTime: times[segStart] });
      segStart = i;
      prevDay = curDay;
    }
  }
  segments.push({ start: segStart, end: times.length, day: prevDay, startTime: times[segStart] });
  return segments;
}

function renderCorrelationChart(modeOrTf = 'dual', tf = null) {
  let targetTf = currentCorrTf;
  if (tf) {
    targetTf = tf;
  } else if (modeOrTf && TF_CONFIG[modeOrTf]) {
    targetTf = modeOrTf;
  }
  updateVixHighsUI(targetTf);
  const isNdx = (currentAssetPair === 'NDX');
  const gthChartOn = (!isNdx && isGthChartActive(targetTf));
  const c = getCorrDataset(isNdx, targetTf);
  // Compute Anchored Series (or baseline if anchor not active)
  const anchoredSeries = computeAnchoredSeries(c, isNdx, targetTf);
  const times = (anchoredSeries && anchoredSeries.times) ? anchoredSeries.times : (c.times || []);
  const rollingCorr = c.rolling_corr || [];

  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';

  const assetPct = anchoredSeries.spotPct;
  const volPt = anchoredSeries.volPt;
  const isAnchored = anchoredSeries.isAnchored;

  // Evaluate Recovery Leader Diagnostics & update banner
  const diag = evaluateRecoveryLeader(anchoredSeries, isNdx);
  const banner = document.getElementById('corr-recovery-banner');
  const commentEl = document.getElementById('anchor-summary-comment');
  if (banner) {
    if (isAnchored && diag) {
      const spotSign = diag.spotNetPct >= 0 ? '+' : '';
      const volSign = diag.volNetPt >= 0 ? '+' : '';
      const spotColor = diag.spotNetPct >= 0 ? 'text-emerald-400' : 'text-rose-400';
      const volColor = diag.volNetPt <= 0 ? 'text-emerald-400' : 'text-amber-400';
      const sessionLabel = anchoredSeries.isLongDailyReset ? 'Daily Scanner' : ((corrAnchor.mode === 'daily_reset') ? 'Today / Active Session' : '⏱️ Elapsed');

      banner.innerHTML = `
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-slate-400">${sessionLabel}: <strong class="text-white">${diag.elapsedStr}</strong></span>
          <span class="text-slate-700">|</span>
          <span>${assetLabel}: <strong class="${spotColor}">${spotSign}${diag.spotNetPct.toFixed(2)}%</strong> <span class="text-slate-400 text-[10px]">(${spotSign}${diag.spotNetPts.toFixed(1)} pts)</span></span>
          <span class="text-slate-700">|</span>
          <span>${volLabel}: <strong class="${volColor}">${volSign}${diag.volNetPt.toFixed(2)} pts</strong></span>
          <span class="text-slate-700">|</span>
          <span title="Net Overvix residual calculated strictly relative to anchor point">${isNdx ? 'Over-VXN' : 'Overvix'} Residual: <strong class="${diag.residColor}">${diag.residSign}${diag.netResid.toFixed(2)} pts</strong> <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${diag.residBadgeClass}">${diag.residStatus}</span></span>
          <span class="text-slate-700">|</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${diag.badgeClass}">${diag.tag}</span>
        </div>
      `;
      if (commentEl) {
        commentEl.textContent = diag.summary ? `(${diag.summary})` : '';
      }
    } else {
      banner.innerHTML = '';
      if (commentEl) {
        commentEl.innerHTML = `<span class="text-slate-500 text-[11px] font-sans">Baseline from session open. Select <strong>[Daily Reset]</strong> or <strong>[Custom]</strong>, or click chart to set an anchor point and evaluate post-anchor Overvix residual.</span>`;
      }
    }
  }

  const dStart = times.length > 0 ? times[0] : '';
  const dEnd = times.length > 0 ? times[times.length - 1] : '';

  const conf = TF_CONFIG[targetTf] || TF_CONFIG['1D'];

  // Option A: Daily Event Scanner for >=3M horizons in Daily Reset mode
  if (anchoredSeries.isLongDailyReset && times.length > 0) {
    const { beta: activeBeta } = getActiveBetaAndIntercept(isNdx);
    if (corrScaleLabel && isBetaScaled) {
      corrScaleLabel.textContent = `Beta Scale (1:${activeBeta.toFixed(2)})`;
    }
    const thresh = isNdx ? currentNdxThreshold : currentThreshold;
    const resids = anchoredSeries.dailyResids || [];
    const betas = anchoredSeries.dailyBetas || [];
    const settledDays = anchoredSeries.settledDays || {};
    const settlementMap = anchoredSeries.settlementMap || {};
    const rawSpot = anchoredSeries.spotRaw || [];
    const rawVol = anchoredSeries.volRaw || [];

    const assetColor = isNdx ? '#C084FC' : '#10B981';
    const volColor = '#F59E0B';
    const residName = isNdx ? 'Over-VXN Residual (Daily)' : 'Overvix Residual (Daily)';

    if (corrTfPill) {
      corrTfPill.textContent = `${conf.pillText} • Daily Scanner`;
    }

    const customDaily = times.map((d, i) => {
      const s = rawSpot[i];
      const v = rawVol[i];
      const sp = assetPct[i];
      const vp = volPt[i];
      const r = resids[i];
      const b = betas[i];
      const sRawStr = (typeof s === 'number' && !isNaN(s)) ? s.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
      const vRawStr = (typeof v === 'number' && !isNaN(v)) ? v.toFixed(2) : '-';
      const spStr = (typeof sp === 'number' && !isNaN(sp)) ? `${sp >= 0 ? '+' : ''}${sp.toFixed(2)}%` : '-';
      const vpStr = (typeof vp === 'number' && !isNaN(vp)) ? `${vp >= 0 ? '+' : ''}${vp.toFixed(2)} pts` : '-';
      const rStr = (typeof r === 'number' && !isNaN(r)) ? `${r >= 0 ? '+' : ''}${r.toFixed(2)} pts` : '-';
      const bStr = (typeof b === 'number' && !isNaN(b)) ? b.toFixed(2) : '-';
      const isSettle = Boolean(settledDays[d] || settlementMap[d] || settlementMap[`${d} 16:00`]);
      const settleTag = isSettle ? "  <span style='color:#38BDF8;font-weight:bold'>🏛️ Official Close</span>" : "";
      const alertTag = (isSettle && typeof r === 'number' && r >= thresh)
        ? `  <span style='color:#FF5370;font-weight:bold'>🚨 ALERT</span>`
        : ((isSettle && typeof r === 'number' && r <= -thresh) ? `  <span style='color:#06B6D4;font-weight:bold'>📉 CRUSH</span>` : '');
      return [sRawStr, spStr, vRawStr, vpStr, rStr, bStr, settleTag + alertTag, assetLabel, volLabel];
    });

    const barColors = resids.map((r, i) => {
      const d = times[i];
      const isSettle = Boolean(settledDays[d]);
      if (isSettle && r >= thresh) return '#FF1744';
      if (isSettle && r <= -thresh) return '#06B6D4';
      if (r >= 0) return 'rgba(16, 185, 129, 0.72)';
      return 'rgba(148, 163, 184, 0.45)';
    });

    const alertTimes = [], alertVols = [], alertResids = [], alertCustom = [];
    for (let i = 0; i < times.length; i++) {
      if (settledDays[times[i]] && resids[i] >= thresh) {
        alertTimes.push(times[i]);
        alertVols.push(rawVol[i]);
        alertResids.push(resids[i]);
        alertCustom.push(customDaily[i]);
      }
    }

    let maxAbsR = thresh;
    for (let i = 0; i < resids.length; i++) {
      if (typeof resids[i] === 'number' && Math.abs(resids[i]) > maxAbsR) maxAbsR = Math.abs(resids[i]);
    }
    const y3Limit = Math.ceil((maxAbsR * 1.18) * 10) / 10;

    const longTraces = [
      {
        x: times,
        y: rawSpot,
        name: `${assetLabel} Close`,
        mode: 'lines',
        line: { color: assetColor, width: 1.8 },
        xaxis: 'x',
        yaxis: 'y',
        hoverinfo: 'skip'
      },
      {
        x: times,
        y: rawVol,
        customdata: customDaily,
        name: `${volLabel} Close (Daily Reset${isVolInverted ? ' Inv ▼' : ''})`,
        mode: 'lines',
        line: { color: volColor, width: 1.8 },
        xaxis: 'x',
        yaxis: 'y2',
        hovertemplate:
          `<b>%{x|%b %d, %Y}</b>%{customdata[6]}<br>` +
          `%{customdata[7]}: <b>%{customdata[0]}</b> (1D %{customdata[1]})<br>` +
          `%{customdata[8]}: <b>%{customdata[2]}</b> (1D %{customdata[3]}) · Resid: <b>%{customdata[4]}</b> [60D β=%{customdata[5]}]<br>` +
          `<span style="color:#00E5FF;font-size:10px">👉 Click bar/date to inspect Anchor Monitor</span><extra></extra>`
      },
      {
        x: times,
        y: resids,
        customdata: customDaily,
        type: 'bar',
        width: 18 * 3600 * 1000,
        name: residName,
        marker: { color: barColors, line: { width: 0 } },
        xaxis: 'x',
        yaxis: 'y3',
        hovertemplate:
          `<b>%{x|%b %d, %Y}</b>%{customdata[6]}<br>` +
          `${isNdx ? 'Over-VXN' : 'Overvix'} Daily Residual: <b>%{customdata[4]}</b> (60D β=%{customdata[5]})<br>` +
          `%{customdata[7]}: %{customdata[0]} (%{customdata[1]}) | %{customdata[8]}: %{customdata[2]} (%{customdata[3]})<extra></extra>`
      },
      {
        x: [dStart, dEnd],
        y: [0, 0],
        mode: 'lines',
        line: { color: 'rgba(148, 163, 184, 0.5)', width: 1.2, dash: 'dash' },
        xaxis: 'x',
        yaxis: 'y3',
        showlegend: false,
        hoverinfo: 'skip'
      },
      {
        x: [dStart, dEnd],
        y: [thresh, thresh],
        mode: 'lines',
        line: { color: '#F43F5E', width: 1.4, dash: 'dash' },
        xaxis: 'x',
        yaxis: 'y3',
        showlegend: false,
        hoverinfo: 'skip'
      },
      {
        x: [dStart, dEnd],
        y: [-thresh, -thresh],
        mode: 'lines',
        line: { color: '#06B6D4', width: 1.2, dash: 'dot' },
        xaxis: 'x',
        yaxis: 'y3',
        showlegend: false,
        hoverinfo: 'skip'
      }
    ];

    if (alertTimes.length > 0) {
      longTraces.push(
        {
          x: alertTimes,
          y: alertVols,
          mode: 'markers',
          name: `${isNdx ? 'Over-VXN' : 'Overvix'} Alert (${volLabel})`,
          marker: { color: '#FF1744', size: 7, symbol: 'diamond', line: { color: '#FFFFFF', width: 1.2 } },
          xaxis: 'x',
          yaxis: 'y2',
          showlegend: false,
          hoverinfo: 'skip'
        },
        {
          x: alertTimes,
          y: alertResids,
          customdata: alertCustom,
          mode: 'markers',
          cliponaxis: false,
          name: isNdx ? 'Over-VXN Alert Close' : 'Overvix Alert Close',
          marker: { color: '#FF1744', size: 9, symbol: 'diamond', line: { color: '#FFFFFF', width: 1.5 } },
          xaxis: 'x',
          yaxis: 'y3',
          showlegend: true,
          hoverinfo: 'skip'
        }
      );
    }

    const hasSpan = Boolean(dStart && dEnd && dStart !== dEnd);
    const longLayout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      autosize: true,
      hovermode: 'x',
      dragmode: false,
      clickmode: 'event',
      hoverdistance: 20,
      hoverlabel: {
        bgcolor: 'rgba(15, 23, 42, 0.95)',
        bordercolor: '#00E5FF',
        font: { family: 'monospace', size: 11, color: '#F8FAFC' },
        align: 'left'
      },
      margin: { l: 55, r: 60, t: 25, b: 35 },
      xaxis: {
        anchor: 'y3',
        type: 'date',
        range: hasSpan ? [dStart, dEnd] : undefined,
        autorange: !hasSpan,
        rangebreaks: [{ pattern: 'day of week', bounds: ['sat', 'mon'] }],
        tickformat: (targetTf === '1Y' || targetTf === 'MAX') ? '%b %Y' : '%b %d',
        title: { text: `${conf.label} Daily Reset Scanner — Causal Rolling 60D β`, font: { color: '#94A3B8', size: 10 } },
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
        title: { text: `${assetLabel} Level`, font: { color: assetColor, size: 10 } },
        tickformat: ',.0f',
        gridcolor: '#1e293b',
        tickfont: { color: assetColor, size: 10 },
        autorange: true,
        fixedrange: true
      },
      yaxis2: {
        domain: [0.48, 1.0],
        title: { text: `${volLabel} Level${isVolInverted ? ' (Inv ▼)' : ''}`, font: { color: volColor, size: 10 } },
        overlaying: 'y',
        side: 'right',
        gridcolor: 'transparent',
        tickfont: { color: volColor, size: 10 },
        autorange: isVolInverted ? 'reversed' : true,
        fixedrange: true
      },
      yaxis3: {
        domain: [0.0, 0.40],
        title: { text: isNdx ? 'Over-VXN Daily Resid (pts)' : 'Daily Residual (pts)', font: { color: isNdx ? '#C084FC' : '#00E5FF', size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: isNdx ? '#C084FC' : '#00E5FF', size: 10 },
        range: [-y3Limit, y3Limit],
        zeroline: false,
        fixedrange: true
      },
      legend: {
        orientation: 'h',
        x: 0,
        y: 1.12,
        font: { color: '#94A3B8', size: 10 }
      },
      bargap: 0.2,
      showlegend: true
    };

    Plotly.react('correlation-chart', longTraces, longLayout, {
      responsive: true,
      displayModeBar: false
    }).then(attachCorrelationChartClickListener);
    return;
  }
  const isMultiDayIntradayTf = (targetTf === '5D' || targetTf === '10D' || targetTf === '1M');
  const sessionSegs = isMultiDayIntradayTf ? buildSessionSegments(times) : [];
  const xTitle = gthChartOn
    ? `${conf.xTitle} — Extended GTH (ES Basis-Adj 03:15–09:15 & 16:00–16:15 ET)`
    : conf.xTitle;
  const tickformat = conf.tickformat;
  let rangebreaks = conf.rangebreaks || [];
  if (gthChartOn) {
    rangebreaks = (targetTf === '5D' || targetTf === '10D')
      ? [{ pattern: 'day of week', bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.25, 3.25] }, { pattern: 'hour', bounds: [9.25, 9.5] }]
      : [{ pattern: 'hour', bounds: [16.25, 3.25] }, { pattern: 'hour', bounds: [9.25, 9.5] }];
  }
  if (corrTfPill) {
    corrTfPill.textContent = gthChartOn ? `${conf.pillText} • ES+VIX` : conf.pillText;
  }
  const timeHoverFmt = conf.timeHoverFmt;
  let assetHoverLabel = isAnchored ? `${assetLabel} from Anchor` : `${assetLabel} Move (${conf.label})`;
  let volHoverLabel = isAnchored ? `${volLabel} from Anchor` : `${volLabel} Move (${conf.label})`;

  const assetColor = isNdx ? '#C084FC' : '#10B981';
  const volColor = '#F59E0B';
  const residColor = isNdx ? '#C084FC' : '#00E5FF';

  // Common anchor shapes & annotations (+ GTH shaded spans & 09:30 RTH dividers)
  const anchorShapes = [];
  const anchorAnnotations = [];

  if (gthChartOn && times.length > 0) {
    const byDate = {};
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const d = t.slice(0, 10);
      const hhmm = t.slice(11, 16);
      if (!byDate[d]) {
        byDate[d] = { firstPre: null, lastPre: null, firstRth: null, firstCurb: null, lastCurb: null };
      }
      const entry = byDate[d];
      if (hhmm < '09:30') {
        if (!entry.firstPre) entry.firstPre = t;
        entry.lastPre = t;
      } else if (hhmm < '16:00') {
        if (!entry.firstRth) entry.firstRth = t;
      } else {
        if (!entry.firstCurb) entry.firstCurb = t;
        entry.lastCurb = t;
      }
    }

    const datesList = Object.keys(byDate).sort();
    datesList.forEach(d => {
      const e = byDate[d];
      if (e.firstPre) {
        const preEnd = e.firstRth || e.lastPre;
        anchorShapes.push({
          type: 'rect',
          xref: 'x',
          yref: 'paper',
          x0: e.firstPre,
          x1: preEnd,
          y0: 0,
          y1: 1,
          fillcolor: 'rgba(99, 102, 241, 0.08)',
          line: { width: 0 },
          layer: 'below'
        });
        if (e.firstRth) {
          anchorShapes.push({
            type: 'line',
            xref: 'x',
            yref: 'paper',
            x0: e.firstRth,
            x1: e.firstRth,
            y0: 0,
            y1: 1,
            line: { color: 'rgba(148, 163, 184, 0.42)', width: 1, dash: 'dot' }
          });
          if (targetTf === '1D') {
            anchorAnnotations.push({
              xref: 'x',
              yref: 'paper',
              x: e.firstRth,
              y: 1.01,
              text: 'RTH Open (Cash)',
              showarrow: false,
              xanchor: 'left',
              font: { color: '#94A3B8', size: 9, family: 'monospace' },
              bgcolor: 'rgba(15, 23, 42, 0.8)'
            });
          }
        }
      }
      if (e.firstCurb && e.lastCurb) {
        anchorShapes.push({
          type: 'rect',
          xref: 'x',
          yref: 'paper',
          x0: e.firstCurb,
          x1: e.lastCurb,
          y0: 0,
          y1: 1,
          fillcolor: 'rgba(99, 102, 241, 0.08)',
          line: { width: 0 },
          layer: 'below'
        });
      }
    });
  }

  if (isAnchored && anchoredSeries.anchorTime && corrAnchor.mode !== 'daily_reset') {
    anchorShapes.push({
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
    });
  }

  // Vertical session divider lines at each day's open on multi-day intraday horizons (5D, 10D, 1M) or Daily Reset mode
  const dividerTimes = (isMultiDayIntradayTf && sessionSegs.length > 1)
    ? sessionSegs.slice(1).map(s => s.startTime)
    : ((corrAnchor.mode === 'daily_reset' && anchoredSeries.sessionStartTimes && anchoredSeries.sessionStartTimes.length > 1)
        ? anchoredSeries.sessionStartTimes.slice(1)
        : []);
  if (dividerTimes.length > 0) {
    dividerTimes.forEach(st => {
      anchorShapes.push({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: st,
        x1: st,
        y0: 0,
        y1: 1,
        line: {
          color: 'rgba(148, 163, 184, 0.22)',
          width: 1,
          dash: 'dash'
        },
        layer: 'below'
      });
    });
  }

  // Detect distinct new VIX / VXN highs across sessions (supported on 1D, 5D, 10D, 1M)
  // On 1M: max 1 high per week. On 5D/10D: max 1 high per day. On 1D: distinct intraday highs (30m NMS).
  const isEligibleTf = (targetTf === '1D' || targetTf === '5D' || targetTf === '10D' || targetTf === '1M');
  const aggregationMode = (targetTf === '1M') ? 'week' : (targetTf === '1D' ? 'intraday' : 'day');
  const rawVolSeries = (anchoredSeries && anchoredSeries.volRaw && anchoredSeries.volRaw.length === times.length)
    ? anchoredSeries.volRaw
    : getRawSpotVolSeries(c, isNdx).vol;
  const highEvents = (isVixHighsMarked && isEligibleTf && rawVolSeries && rawVolSeries.length > 0)
    ? findDistinctVixHighs(times, rawVolSeries, 0.20, 30, aggregationMode)
    : [];

  // Identify the single true lowest low on chart (maximum VIX / deepest trough)
  // Guarantees strictly at most 1 red triangle and 1 red reference line across the entire chart
  let lowestLowEventIdx = -1;
  if (isVixHighsMarked && isEligibleTf && highEvents.length > 0) {
    let maxVix = -Infinity;
    let deepestSpot = Infinity;
    for (let i = 0; i < highEvents.length; i++) {
      const h = highEvents[i];
      const sPct = (assetPct && typeof assetPct[h.idx] === 'number' && !isNaN(assetPct[h.idx]))
        ? assetPct[h.idx]
        : 0;
      if (h.vixLevel > maxVix + 1e-4) {
        maxVix = h.vixLevel;
        deepestSpot = sPct;
        lowestLowEventIdx = i;
      } else if (Math.abs(h.vixLevel - maxVix) <= 1e-4) {
        // Tie-breaker: if identical VIX level, pick deeper spot drop, then latest occurrence
        if (sPct < deepestSpot - 1e-4 || (Math.abs(sPct - deepestSpot) <= 1e-4 && i > lowestLowEventIdx)) {
          deepestSpot = sPct;
          lowestLowEventIdx = i;
        }
      }
    }

    // Trigger Voice Alert on new Red Triangle (lowest low / peak VIX)
    if (lowestLowEventIdx !== -1) {
      const lowestEvt = highEvents[lowestLowEventIdx];
      const sPct = (assetPct && typeof assetPct[lowestEvt.idx] === 'number' && !isNaN(assetPct[lowestEvt.idx]))
        ? assetPct[lowestEvt.idx]
        : 0;
      const aName = isNdx ? "Nasdaq" : "SPX";
      VoiceManager.checkRedTriangleAlert(lowestEvt, aName, sPct, volLabel, lowestEvt.vixLevel);
    }
  }

  // Map high events by timestamp index for instant lookup in unified hover
  const highEventMap = {};
  if (isVixHighsMarked && isEligibleTf && highEvents.length > 0) {
    highEvents.forEach((h, i) => {
      const isLowestLow = (i === lowestLowEventIdx);
      highEventMap[h.idx] = isLowestLow 
        ? "  <span style='color:#EF4444;font-weight:bold'>🚨 Lowest Low</span>" 
        : "  <span style='color:#F59E0B;font-weight:bold'>🔺 VIX High</span>";
    });
  }

  // Add subtle vertical dotted reference line through SPX & Overvix Residual for each VIX high
  // Only the single lowest low event is emphasized with a red dotted line; all other highs are amber
  if (isVixHighsMarked && isEligibleTf && highEvents.length > 0) {
    highEvents.forEach((h, i) => {
      const isLowestLow = (i === lowestLowEventIdx);
      anchorShapes.push({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: h.time,
        x1: h.time,
        y0: 0,
        y1: 1,
        line: {
          color: isLowestLow ? 'rgba(239, 68, 68, 0.65)' : 'rgba(245, 158, 11, 0.40)',
          width: isLowestLow ? 1.5 : 1,
          dash: 'dot'
        },
        layer: 'below'
      });
      if (isLowestLow) {
        anchorAnnotations.push({
          xref: 'x',
          yref: 'paper',
          x: h.time,
          y: 1.0,
          yanchor: 'top',
          text: `${volLabel}: ${h.vixLevel.toFixed(2)}`,
          showarrow: false,
          font: { color: '#EF4444', size: 9, family: 'monospace', weight: 'bold' },
          bgcolor: 'rgba(15, 23, 42, 0.90)',
          bordercolor: '#EF4444',
          borderwidth: 1,
          borderpad: 2
        });
      }
    });
  }

  const anchorTimeFormatted = anchoredSeries.anchorTime 
    ? (targetTf === '1D' 
        ? (anchoredSeries.anchorTime.length > 10 ? anchoredSeries.anchorTime.slice(11) : anchoredSeries.anchorTime)
        : (anchoredSeries.anchorTime.length > 10 ? anchoredSeries.anchorTime.slice(5) : anchoredSeries.anchorTime))
    : '';

  if (isAnchored && anchoredSeries.anchorTime && corrAnchor.mode !== 'daily_reset') {
    anchorAnnotations.push({
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
    });
  }

  // 60-Day Macro Baseline Spot-Vol Slope & Intercept from Overvix model
  const { beta, rawSlope, rawIntercept } = getActiveBetaAndIntercept(isNdx);

  // Sync button label with active beta
  if (corrScaleLabel && isBetaScaled) {
    corrScaleLabel.textContent = `Beta Scale (1:${beta.toFixed(2)})`;
  }

  const dualRanges = computeZeroAlignedDualRanges(assetPct, volPt, isVolInverted, isBetaScaled, beta);

  // Subplot 1: Asset % Move (left axis) vs Vol pt move (right axis)
  const assetCustomdata = times.map((t, i) => {
    const raw = (anchoredSeries.spotRaw && anchoredSeries.spotRaw[i] !== undefined && anchoredSeries.spotRaw[i] !== null)
      ? (typeof anchoredSeries.spotRaw[i] === 'number' ? anchoredSeries.spotRaw[i].toFixed(2) : anchoredSeries.spotRaw[i])
      : '-';
    const rawVol = (anchoredSeries.volRaw && anchoredSeries.volRaw[i] !== undefined && anchoredSeries.volRaw[i] !== null)
      ? (typeof anchoredSeries.volRaw[i] === 'number' ? anchoredSeries.volRaw[i].toFixed(2) : anchoredSeries.volRaw[i])
      : '-';
    const s = assetPct[i];
    const sStr = (typeof s === 'number' && !isNaN(s)) ? (s >= 0 ? `+${s.toFixed(2)}` : s.toFixed(2)) : '-';
    const gthTag = (gthChartOn && c.is_gth && c.is_gth[i] === 1) ? ' [ES-Adj]' : '';
    return [raw, sStr, gthTag, rawVol];
  });

  const traceAsset = {
    x: times,
    y: assetPct,
    customdata: assetCustomdata,
    name: isAnchored 
      ? (corrAnchor.mode === 'daily_reset' ? `${assetLabel} % (Daily Reset)` : `${assetLabel} % (Anchored)`) 
      : `${assetLabel} % Move${gthChartOn ? ' (ES-Adj+RTH)' : ''}`,
    mode: 'lines',
    line: { color: assetColor, width: 1.8 },
    xaxis: 'x',
    yaxis: 'y',
    hoverinfo: 'skip'
  };

  // Shaded Divergence Ribbon: dual-color fill area between Spot % and Vol (in % units) when Beta Scaled and Invert Vol are active
  // Green when Spot > Vol (Positive Overvix Residual: Spot outperformed / Vol crushed)
  // Red when Spot < Vol (Negative Overvix Residual: Vol spiked / panic)
  let dualRibbonTraces = null;
  if (isBetaScaled && isVolInverted && times.length > 0) {
    const isSessionBaseline = (corrAnchor.mode === 'prior_close' || corrAnchor.mode === 'daily_reset' || (!isAnchored && targetTf === '1D'));
    const alpha = isSessionBaseline ? rawIntercept : 0;
    const ribbonData = computeDualRibbonSeries(times, assetPct, volPt, beta, alpha);
    if (ribbonData && ribbonData.xArr.length > 0) {
      const traceVolRef1 = {
        x: ribbonData.xArr,
        y: ribbonData.vArr,
        mode: 'lines',
        line: { color: 'transparent', width: 0 },
        xaxis: 'x',
        yaxis: 'y',
        hoverinfo: 'skip',
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
        hoverinfo: 'skip',
        showlegend: false
      };
      const traceVolRef2 = {
        x: ribbonData.xArr,
        y: ribbonData.vArr,
        mode: 'lines',
        line: { color: 'transparent', width: 0 },
        xaxis: 'x',
        yaxis: 'y',
        hoverinfo: 'skip',
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
        hoverinfo: 'skip',
        showlegend: false
      };
      dualRibbonTraces = [traceVolRef1, traceRedRibbon, traceVolRef2, traceGreenRibbon];
    }
  }

  // Vol Customdata for Unified Single Tooltip:
  // [0: rawSpot, 1: sPctStr, 2: rawVol, 3: vPtStr, 4: residStr, 5: gthTag, 6: highTag, 7: assetLabel, 8: volLabel]
  const volCustomdata = times.map((t, i) => {
    const rawSpot = (anchoredSeries.spotRaw && anchoredSeries.spotRaw[i] !== undefined && anchoredSeries.spotRaw[i] !== null)
      ? (typeof anchoredSeries.spotRaw[i] === 'number' ? anchoredSeries.spotRaw[i].toFixed(2) : anchoredSeries.spotRaw[i])
      : '-';
    const sPct = assetPct[i];
    const sPctStr = (typeof sPct === 'number' && !isNaN(sPct)) ? (sPct >= 0 ? `+${sPct.toFixed(2)}%` : `${sPct.toFixed(2)}%`) : '-';

    const raw = (anchoredSeries.volRaw && anchoredSeries.volRaw[i] !== undefined && anchoredSeries.volRaw[i] !== null) 
      ? (typeof anchoredSeries.volRaw[i] === 'number' ? anchoredSeries.volRaw[i].toFixed(2) : anchoredSeries.volRaw[i]) 
      : '-';
    const vPt = volPt[i];
    // Expected VIX move = alpha + slope * sPct = alpha - beta * sPct
    // For Prior Close / Daily Reset anchor or 1D unanchored session baseline, alpha is the daily intercept from the baseline regression
    const isSessionBaseline = (corrAnchor.mode === 'prior_close' || corrAnchor.mode === 'daily_reset' || (!isAnchored && targetTf === '1D'));
    const alpha = isSessionBaseline ? rawIntercept : 0;
    const isNullBar = (sPct === null || vPt === null || sPct === undefined || vPt === undefined);
    const resid = isNullBar ? null : (vPt - alpha + beta * sPct);
    const residStr = (typeof resid === 'number' && !isNaN(resid)) ? (resid >= 0 ? `+${resid.toFixed(2)} pts` : `${resid.toFixed(2)} pts`) : '-';
    const vPtStr = (typeof vPt === 'number' && !isNaN(vPt)) ? (vPt >= 0 ? `+${vPt.toFixed(2)}` : vPt.toFixed(2)) : '-';
    const gthTag = (gthChartOn && c.is_gth && c.is_gth[i] === 1) ? ' [ES-Adj]' : '';
    const isSettle = Boolean(anchoredSeries.settlementMap && anchoredSeries.settlementMap[t]);
    const settleTag = isSettle ? "  <span style='color:#38BDF8;font-weight:bold'>🏛️ Official Close</span>" : "";
    const highTag = settleTag || highEventMap[i] || '';

    return [rawSpot, sPctStr, raw, vPtStr, residStr, gthTag, highTag, assetLabel, volLabel];
  });

  const traceVol = {
    x: times,
    y: volPt,
    customdata: volCustomdata,
    name: isVolInverted 
      ? (isAnchored 
          ? (corrAnchor.mode === 'daily_reset' ? `${volLabel} Pt (Daily Reset Inv ▼)` : `${volLabel} Pt (Anchored Inv)`) 
          : `${volLabel} Point Move (Inv)`) 
      : (isAnchored 
          ? (corrAnchor.mode === 'daily_reset' ? `${volLabel} Pt (Daily Reset)` : `${volLabel} Pt (Anchored)`) 
          : `${volLabel} Point Move`),
    mode: 'lines',
    line: { color: volColor, width: 1.8 },
    xaxis: 'x',
    yaxis: 'y2',
    hovertemplate: 
      `<b>%{x|${timeHoverFmt}}%{customdata[5]}</b>%{customdata[6]}<br>` +
      `%{customdata[7]}: <b>%{customdata[0]}</b> (%{customdata[1]})<br>` +
      `%{customdata[8]}: <b>%{customdata[2]}</b> (%{customdata[3]} pts) · Resid: <b>%{customdata[4]}</b><br>` +
      `<span style="color:#00E5FF;font-size:10px">👉 Click to Anchor Residual Monitor</span><extra></extra>`
  };

    // Subplot 2: Instantaneous Overvix Residual Monitor
    const thresh = isNdx ? currentNdxThreshold : currentThreshold;
    const isSessionBaseline = (corrAnchor.mode === 'prior_close' || corrAnchor.mode === 'daily_reset' || (!isAnchored && targetTf === '1D'));
    const alpha = isSessionBaseline ? rawIntercept : 0;

    // Calculate instantaneous Overvix residual series:
    // r(t) = volPt(t) - alpha + beta * assetPct(t)
    const residSeries = times.map((t, i) => {
      const sPct = assetPct[i];
      const vPt = volPt[i];
      if (sPct === null || vPt === null || sPct === undefined || vPt === undefined) {
        return null;
      }
      const r = vPt - alpha + beta * sPct;
      return Math.round(r * 10000) / 10000;
    });

    const posResid = residSeries.map(v => (v !== null ? Math.max(0, v) : null));
    const negResid = residSeries.map(v => (v !== null ? Math.min(0, v) : null));
    const residCustomdata = times.map((t, i) => {
      const r = residSeries[i];
      const rStr = (typeof r === 'number' && !isNaN(r)) ? (r >= 0 ? `+${r.toFixed(2)}` : r.toFixed(2)) : '-';
      const sRaw = (anchoredSeries.spotRaw && anchoredSeries.spotRaw[i] !== undefined && anchoredSeries.spotRaw[i] !== null)
        ? (typeof anchoredSeries.spotRaw[i] === 'number' ? anchoredSeries.spotRaw[i].toFixed(2) : anchoredSeries.spotRaw[i])
        : '-';
      const vRaw = (anchoredSeries.volRaw && anchoredSeries.volRaw[i] !== undefined && anchoredSeries.volRaw[i] !== null)
        ? (typeof anchoredSeries.volRaw[i] === 'number' ? anchoredSeries.volRaw[i].toFixed(2) : anchoredSeries.volRaw[i])
        : '-';
      const isSettle = Boolean(anchoredSeries.settlementMap && anchoredSeries.settlementMap[t]);
      const settleTag = isSettle ? "  <span style='color:#38BDF8;font-weight:bold'>🏛️ Official Close</span>" : "";
      return [rStr, sRaw, vRaw, settleTag];
    });

    // Emerald Green shading to zero when Residual > 0
    const tracePosFill = {
      x: times,
      y: posResid,
      mode: 'lines',
      line: { color: 'transparent', width: 0 },
      fill: 'tozeroy',
      fillcolor: 'rgba(16, 185, 129, 0.22)',
      xaxis: 'x',
      yaxis: 'y3',
      showlegend: false,
      hoverinfo: 'skip'
    };

    // Rose Red shading to zero when Residual < 0
    const traceNegFill = {
      x: times,
      y: negResid,
      mode: 'lines',
      line: { color: 'transparent', width: 0 },
      fill: 'tozeroy',
      fillcolor: 'rgba(244, 63, 94, 0.22)',
      xaxis: 'x',
      yaxis: 'y3',
      showlegend: false,
      hoverinfo: 'skip'
    };

    const traceResidual = {
      x: times,
      y: residSeries,
      customdata: residCustomdata,
      name: isNdx ? 'Over-VXN Residual' : 'Overvix Residual',
      mode: 'lines',
      line: { color: isNdx ? '#C084FC' : '#00E5FF', width: 1.8 },
      xaxis: 'x',
      yaxis: 'y3',
      hovertemplate: `<b>%{x|${timeHoverFmt}}</b>%{customdata[3]}<br>${isNdx ? 'Over-VXN' : 'Overvix'} Residual: %{customdata[0]} pts<br>${assetLabel}: %{customdata[1]} | ${volLabel}: %{customdata[2]}<extra></extra>`
    };

    const traceZeroLine = {
      x: [dStart, dEnd],
      y: [0.0, 0.0],
      mode: 'lines',
      name: 'Zero Baseline (0.0 pts)',
      line: { color: 'rgba(148, 163, 184, 0.5)', width: 1.2, dash: 'dash' },
      xaxis: 'x',
      yaxis: 'y3',
      showlegend: false,
      hoverinfo: 'skip'
    };

    const traceOvervixAlert = {
      x: [dStart, dEnd],
      y: [thresh, thresh],
      mode: 'lines',
      name: `${isNdx ? 'Over-VXN' : 'Overvix'} Alert (+${thresh.toFixed(1)} pts)`,
      line: { color: '#F43F5E', width: 1.5, dash: 'dash' },
      xaxis: 'x',
      yaxis: 'y3',
      showlegend: false,
      hoverinfo: 'skip'
    };

    const traceVolCrush = {
      x: [dStart, dEnd],
      y: [-thresh, -thresh],
      mode: 'lines',
      name: `Vol Crush (-${thresh.toFixed(1)} pts)`,
      line: { color: '#06B6D4', width: 1.2, dash: 'dot' },
      xaxis: 'x',
      yaxis: 'y3',
      showlegend: false,
      hoverinfo: 'skip'
    };

    const anchorSpotRawStr = (typeof corrAnchor.spotBase === 'number' && !isNaN(corrAnchor.spotBase)) ? corrAnchor.spotBase.toFixed(2) : '-';
    const anchorVolRawStr = (typeof corrAnchor.volBase === 'number' && !isNaN(corrAnchor.volBase)) ? corrAnchor.volBase.toFixed(2) : '-';

    // Anchor Origin Marker: glowing cyan dot at (anchorTime, 0.0) where both curves start
    const traceAnchorOrigin = (isAnchored && anchoredSeries.anchorTime && corrAnchor.mode !== 'daily_reset') ? {
      x: [anchoredSeries.anchorTime],
      y: [0.0],
      mode: 'markers',
      cliponaxis: false,
      name: '⚓ Anchor (0, 0)',
      marker: {
        color: '#00E5FF',
        size: 9,
        symbol: 'circle',
        line: { color: '#FFFFFF', width: 2 }
      },
      xaxis: 'x',
      yaxis: 'y',
      hovertemplate: `<b>⚓ Anchor Origin Point</b><br>Time: %{x|${timeHoverFmt}}<br>${assetLabel}: ${anchorSpotRawStr} (0.00%)<br>${volLabel}: ${anchorVolRawStr} (0.00 pts)<extra></extra>`,
      showlegend: false
    } : null;

    // Anchor Origin Marker on lower subplot: cyan glowing dot at (anchorTime, 0.0)
    const traceAnchorOriginY3 = (isAnchored && anchoredSeries.anchorTime && corrAnchor.mode !== 'daily_reset') ? {
      x: [anchoredSeries.anchorTime],
      y: [0.0],
      mode: 'markers',
      cliponaxis: false,
      name: '⚓ Anchor (0, 0)',
      marker: {
        color: '#00E5FF',
        size: 8,
        symbol: 'circle',
        line: { color: '#FFFFFF', width: 1.8 }
      },
      xaxis: 'x',
      yaxis: 'y3',
      hovertemplate: `<b>⚓ Anchor Origin Point</b><br>Time: %{x|${timeHoverFmt}}<br>Residual: 0.00 pts<br>${assetLabel}: ${anchorSpotRawStr} | ${volLabel}: ${anchorVolRawStr}<extra></extra>`,
      showlegend: false
    } : null;

    let maxAbsResid = thresh;
    for (let i = 0; i < residSeries.length; i++) {
      if (typeof residSeries[i] === 'number' && !isNaN(residSeries[i])) {
        const absVal = Math.abs(residSeries[i]);
        if (absVal > maxAbsResid) {
          maxAbsResid = absVal;
        }
      }
    }
    const y3Limit = Math.ceil((maxAbsResid * 1.18) * 10) / 10;
    const y3Range = [-y3Limit, y3Limit];

    let traceVixHighMarks = null;
    if (isVixHighsMarked && isEligibleTf && highEvents.length > 0) {
      const highX = highEvents.map(e => e.time);
      const highY = highEvents.map(e => volPt[e.idx]);
      const highColors = highEvents.map((e, i) => (i === lowestLowEventIdx ? '#EF4444' : '#F59E0B'));
      const highSizes = highEvents.map((e, i) => (i === lowestLowEventIdx ? 13 : 11));
      const highCustom = highEvents.map((e, i) => {
        const isLowestLow = (i === lowestLowEventIdx);
        const sPct = assetPct[e.idx];
        const sStr = (typeof sPct === 'number' && !isNaN(sPct)) ? (sPct >= 0 ? `+${sPct.toFixed(2)}%` : `${sPct.toFixed(2)}%`) : '-';
        const vPt = volPt[e.idx];
        const vPtStr = (typeof vPt === 'number' && !isNaN(vPt)) ? (vPt >= 0 ? `+${vPt.toFixed(2)}` : `${vPt.toFixed(2)}`) : '-';
        const rawSpot = (anchoredSeries.spotRaw && anchoredSeries.spotRaw[e.idx] !== undefined)
          ? (typeof anchoredSeries.spotRaw[e.idx] === 'number' ? anchoredSeries.spotRaw[e.idx].toFixed(2) : anchoredSeries.spotRaw[e.idx])
          : '-';
        const titleTag = isLowestLow ? `🚨 ${volLabel} High (Chart Lowest Low)` : `🔺 ${volLabel} High`;
        return [
          volLabel,                    // 0
          e.vixLevel.toFixed(2),       // 1
          assetLabel,                  // 2
          sStr,                        // 3
          vPtStr,                      // 4
          rawSpot,                     // 5
          titleTag                     // 6
        ];
      });

      traceVixHighMarks = {
        x: highX,
        y: highY,
        customdata: highCustom,
        mode: 'markers',
        name: `${volLabel} Highs`,
        marker: {
          symbol: isVolInverted ? 'triangle-down' : 'triangle-up',
          size: highSizes,
          color: highColors,
          line: { color: '#FFFFFF', width: 1.5 }
        },
        xaxis: 'x',
        yaxis: 'y2',
        hoverinfo: 'skip',
        showlegend: true
      };
    }

    const isDailyResetMultiDay = (corrAnchor.mode === 'daily_reset' && anchoredSeries.days && anchoredSeries.days.length > 1);
    const useSessionBreaks = isDailyResetMultiDay || sessionSegs.length > 1;
    const plotTraces = [];

    if (useSessionBreaks) {
      const segments = isDailyResetMultiDay
        ? anchoredSeries.days.map(d => {
            const idxs = anchoredSeries.dayMap[d];
            return { start: idxs[0], end: idxs[idxs.length - 1] + 1 };
          })
        : sessionSegs;

      // 1. Dual Ribbon Traces per session (strictly within each day's bounds)
      if (isBetaScaled && isVolInverted) {
        segments.forEach(seg => {
          const times_d = times.slice(seg.start, seg.end);
          const assetPct_d = assetPct.slice(seg.start, seg.end);
          const volPt_d = volPt.slice(seg.start, seg.end);

          const ribbonData = computeDualRibbonSeries(times_d, assetPct_d, volPt_d, beta, alpha);
          if (ribbonData && ribbonData.xArr.length > 0) {
            plotTraces.push(
              {
                x: ribbonData.xArr,
                y: ribbonData.vArr,
                mode: 'lines',
                line: { color: 'transparent', width: 0 },
                xaxis: 'x',
                yaxis: 'y',
                hoverinfo: 'skip',
                showlegend: false
              },
              {
                x: ribbonData.xArr,
                y: ribbonData.minArr,
                mode: 'lines',
                line: { color: 'transparent', width: 0 },
                fill: 'tonexty',
                fillcolor: 'rgba(244, 63, 94, 0.22)',
                xaxis: 'x',
                yaxis: 'y',
                hoverinfo: 'skip',
                showlegend: false
              },
              {
                x: ribbonData.xArr,
                y: ribbonData.vArr,
                mode: 'lines',
                line: { color: 'transparent', width: 0 },
                xaxis: 'x',
                yaxis: 'y',
                hoverinfo: 'skip',
                showlegend: false
              },
              {
                x: ribbonData.xArr,
                y: ribbonData.maxArr,
                mode: 'lines',
                line: { color: 'transparent', width: 0 },
                fill: 'tonexty',
                fillcolor: 'rgba(16, 185, 129, 0.22)',
                xaxis: 'x',
                yaxis: 'y',
                hoverinfo: 'skip',
                showlegend: false
              }
            );
          }
        });
      }

      // 2. Asset Lines per session
      segments.forEach((seg, sIdx) => {
        plotTraces.push({
          x: times.slice(seg.start, seg.end),
          y: assetPct.slice(seg.start, seg.end),
          customdata: assetCustomdata.slice(seg.start, seg.end),
          name: traceAsset.name,
          legendgroup: 'asset',
          showlegend: (sIdx === 0),
          mode: 'lines',
          line: { color: assetColor, width: 1.8 },
          xaxis: 'x',
          yaxis: 'y',
          hoverinfo: 'skip'
        });
      });

      // 3. Vol Lines per session
      segments.forEach((seg, sIdx) => {
        plotTraces.push({
          x: times.slice(seg.start, seg.end),
          y: volPt.slice(seg.start, seg.end),
          customdata: volCustomdata.slice(seg.start, seg.end),
          name: traceVol.name,
          legendgroup: 'vol',
          showlegend: (sIdx === 0),
          mode: 'lines',
          line: { color: volColor, width: 1.8 },
          xaxis: 'x',
          yaxis: 'y2',
          hoverinfo: 'skip'
        });
      });

      // Unified Constant Cursor Hover Trace (Single continuous trace across all timestamps)
      plotTraces.push({
        x: times,
        y: volPt,
        customdata: volCustomdata,
        name: traceVol.name,
        mode: 'lines',
        line: { color: 'transparent', width: 0 },
        xaxis: 'x',
        yaxis: 'y2',
        showlegend: false,
        hovertemplate: traceVol.hovertemplate
      });

      // 4. VIX Highs Markers (if any)
      if (traceVixHighMarks) {
        plotTraces.push(traceVixHighMarks);
      }

      // 5. Positive Residual Fill per session
      segments.forEach(seg => {
        plotTraces.push({
          x: times.slice(seg.start, seg.end),
          y: posResid.slice(seg.start, seg.end),
          mode: 'lines',
          line: { color: 'transparent', width: 0 },
          fill: 'tozeroy',
          fillcolor: 'rgba(16, 185, 129, 0.22)',
          xaxis: 'x',
          yaxis: 'y3',
          showlegend: false,
          hoverinfo: 'skip'
        });
      });

      // 6. Negative Residual Fill per session
      segments.forEach(seg => {
        plotTraces.push({
          x: times.slice(seg.start, seg.end),
          y: negResid.slice(seg.start, seg.end),
          mode: 'lines',
          line: { color: 'transparent', width: 0 },
          fill: 'tozeroy',
          fillcolor: 'rgba(244, 63, 94, 0.22)',
          xaxis: 'x',
          yaxis: 'y3',
          showlegend: false,
          hoverinfo: 'skip'
        });
      });

      // 7. Residual Lines per session
      segments.forEach((seg, sIdx) => {
        plotTraces.push({
          x: times.slice(seg.start, seg.end),
          y: residSeries.slice(seg.start, seg.end),
          customdata: residCustomdata.slice(seg.start, seg.end),
          name: traceResidual.name,
          legendgroup: 'resid',
          showlegend: (sIdx === 0),
          mode: 'lines',
          line: { color: isNdx ? '#C084FC' : '#00E5FF', width: 1.8 },
          xaxis: 'x',
          yaxis: 'y3',
          hoverinfo: 'skip'
        });
      });

      // Unified Constant Cursor Hover Trace on Subplot 2 (Single continuous trace across all timestamps)
      plotTraces.push({
        x: times,
        y: residSeries,
        customdata: residCustomdata,
        name: traceResidual.name,
        mode: 'lines',
        line: { color: 'transparent', width: 0 },
        xaxis: 'x',
        yaxis: 'y3',
        showlegend: false,
        hovertemplate: traceResidual.hovertemplate
      });

      // 8. Horizontal Reference Lines & Anchor Dots
      plotTraces.push(traceZeroLine, traceOvervixAlert, traceVolCrush);
      if (traceAnchorOrigin) {
        plotTraces.push(traceAnchorOrigin);
      }
      if (traceAnchorOriginY3) {
        plotTraces.push(traceAnchorOriginY3);
      }

    } else {
      if (dualRibbonTraces && dualRibbonTraces.length > 0) {
        plotTraces.push(...dualRibbonTraces);
      }
      plotTraces.push(traceAsset, traceVol);
      if (traceVixHighMarks) {
        plotTraces.push(traceVixHighMarks);
      }
      plotTraces.push(tracePosFill, traceNegFill, traceResidual, traceZeroLine, traceOvervixAlert, traceVolCrush);
      if (traceAnchorOrigin) {
        plotTraces.push(traceAnchorOrigin);
      }
      if (traceAnchorOriginY3) {
        plotTraces.push(traceAnchorOriginY3);
      }
    }

    // 9. Overvix Alert Markers on Session Close (Daily Reset mode)
    if (corrAnchor.mode === 'daily_reset' && anchoredSeries.days) {
      const alertCloseTimes = [];
      const alertCloseResids = [];
      const alertCloseCustomdata = [];
      const days = anchoredSeries.days;
      const dayMap = anchoredSeries.dayMap;
      const settledDays = anchoredSeries.settledDays || {};
      const settlementMap = anchoredSeries.settlementMap || {};

      days.forEach(d => {
        if (!settledDays[d]) return;
        const idxs = dayMap ? dayMap[d] : null;
        if (!idxs || idxs.length === 0) return;
        const termIdx = idxs[idxs.length - 1];
        const tClose = times[termIdx];
        if (tClose && tClose.length >= 16 && !settlementMap[tClose] && tClose.slice(11, 16) < '15:55') return;
        const rVal = residSeries[termIdx];

        // Trigger condition: official settled close residual >= +threshold
        if (typeof rVal === 'number' && !isNaN(rVal) && rVal >= thresh) {
          const rStr = (rVal >= 0 ? `+${rVal.toFixed(2)}` : rVal.toFixed(2)) + ' pts';

          const rawSpotNum = anchoredSeries.spotRaw ? anchoredSeries.spotRaw[termIdx] : null;
          const sRawFormatted = (typeof rawSpotNum === 'number' && !isNaN(rawSpotNum))
            ? rawSpotNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : (rawSpotNum || '-');

          const sPct = assetPct[termIdx];
          const sPctStr = (typeof sPct === 'number' && !isNaN(sPct))
            ? (sPct >= 0 ? `+${sPct.toFixed(2)}%` : `${sPct.toFixed(2)}%`)
            : '-';

          const rawVolNum = anchoredSeries.volRaw ? anchoredSeries.volRaw[termIdx] : null;
          const vRawFormatted = (typeof rawVolNum === 'number' && !isNaN(rawVolNum))
            ? rawVolNum.toFixed(2)
            : (rawVolNum || '-');

          const vPt = volPt[termIdx];
          const vPtStr = (typeof vPt === 'number' && !isNaN(vPt))
            ? (vPt >= 0 ? `+${vPt.toFixed(2)}` : `${vPt.toFixed(2)}`)
            : '-';

          alertCloseTimes.push(tClose);
          alertCloseResids.push(rVal);
          alertCloseCustomdata.push([
            rStr,           // 0: Overvix Residual
            sRawFormatted,  // 1: Spot close raw
            vRawFormatted,  // 2: Vol close raw
            sPctStr,        // 3: Spot %
            vPtStr,         // 4: Vol pt
            assetLabel,     // 5: Asset label (e.g. SPX)
            volLabel        // 6: Vol label (e.g. VIX)
          ]);
        }
      });

      if (alertCloseTimes.length > 0) {
        const traceOvervixAlertClose = {
          x: alertCloseTimes,
          y: alertCloseResids,
          customdata: alertCloseCustomdata,
          mode: 'markers',
          cliponaxis: false,
          name: isNdx ? 'Over-VXN Alert Close' : 'Overvix Alert Close',
          marker: {
            color: '#FF1744',
            size: 12,
            symbol: 'diamond',
            line: { color: '#FFFFFF', width: 2 }
          },
          hoverlabel: {
            bgcolor: 'rgba(15, 23, 42, 0.95)',
            bordercolor: '#FF1744',
            font: { family: 'monospace', size: 11, color: '#F8FAFC' },
            align: 'left'
          },
          hovertemplate:
            `<b>%{x|${timeHoverFmt}}</b>  <span style="color:#FF5370;font-weight:bold">🚨 ${isNdx ? 'OVER-VXN' : 'OVERVIX'} ALERT CLOSE</span><br>` +
            `${isNdx ? 'Over-VXN' : 'Overvix'} Residual: <b>%{customdata[0]}</b><br>` +
            `%{customdata[5]} Close: <b>%{customdata[1]} (%{customdata[3]})</b><br>` +
            `%{customdata[6]} Close: <b>%{customdata[2]} (%{customdata[4]} pts)</b><br>` +
            `<span style="color:#00E5FF;font-size:10px">👉 Click to Anchor at this Session Close</span><extra></extra>`,
          xaxis: 'x',
          yaxis: 'y3',
          showlegend: true
        };
        plotTraces.push(traceOvervixAlertClose);
      }
    }

    const hasSpan = Boolean(dStart && dEnd && dStart !== dEnd);

    const layout = {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      autosize: true,
      hovermode: 'x',
      dragmode: false,
      clickmode: 'event',
      hoverdistance: 20,
      hoverlabel: {
        bgcolor: 'rgba(15, 23, 42, 0.95)',
        bordercolor: '#00E5FF',
        font: { family: 'monospace', size: 11, color: '#F8FAFC' },
        align: 'left'
      },
      margin: { l: 55, r: 60, t: 25, b: 35 },
      xaxis: {
        anchor: 'y3',
        type: 'date',
        // Lock axis bounds to exact [dStart, dEnd] so Plotly marker-padding autorange cannot trap range into overnight/weekend rangebreaks
        range: hasSpan ? [dStart, dEnd] : undefined,
        autorange: !hasSpan,
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
        title: { text: isNdx ? 'Over-VXN Residual (pts)' : 'Residual (pts)', font: { color: isNdx ? '#C084FC' : '#00E5FF', size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: isNdx ? '#C084FC' : '#00E5FF', size: 10 },
        range: y3Range,
        zeroline: false,
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

  Plotly.react('correlation-chart', plotTraces, layout, {
    responsive: true,
    displayModeBar: false
  }).then(attachCorrelationChartClickListener);
}

let lastAnchorClickTimestamp = 0;

function attachCorrelationChartClickListener() {
  const chartEl = document.getElementById('correlation-chart');
  if (!chartEl) return;
  setupCorrHoverTracking();

  // Re-bind plotly_click on the chart element (Plotly.newPlot clears internal events on gd)
  if (typeof chartEl.removeAllListeners === 'function') {
    chartEl.removeAllListeners('plotly_click');
  }
  chartEl.on('plotly_click', function(eventData) {
    if (Date.now() - lastAnchorClickTimestamp < 300) return;
    if (!eventData || !eventData.points || eventData.points.length === 0) return;

    // Filter points to prefer full time-series data traces, avoiding 2-point boundary lines (zero line, alert, vol crush)
    const validNames = ['SPX % Move', 'SPX % Since Anchor', 'NDX % Move', 'NDX % Since Anchor',
                        'VIX Point Move', 'VIX Pt Since Anchor', 'VXN Point Move', 'VXN Pt Since Anchor',
                        'Daily Reset', 'Overvix Residual', 'Over-VXN Residual', 'VIX Highs', 'VXN Highs',
                        'Overvix Alert Close', 'Over-VXN Alert Close'];
    let chosenPt = eventData.points.find(p => p.data && validNames.some(name => p.data.name && p.data.name.includes(name)));
    if (!chosenPt) {
      // Pick any trace that is not a 2-point helper/boundary line
      chosenPt = eventData.points.find(p => p.data && p.data.x && p.data.x.length > 2);
    }
    if (!chosenPt) {
      chosenPt = eventData.points[0];
    }

    if (chosenPt && chosenPt.x !== undefined && chosenPt.x !== null) {
      lastAnchorClickTimestamp = Date.now();
      setCorrAnchor('custom', chosenPt.x);
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
        // For 1D timeframe, proportional mapping across session times is 100% direct and jitter-free
        if (currentCorrTf === '1D') {
          const isNdx = (currentAssetPair === 'NDX');
          const c = getCorrDataset(isNdx, currentCorrTf);
          const times = (c && c.times) ? c.times : [];
          if (times.length > 0) {
            lastAnchorClickTimestamp = Date.now();
            const frac = Math.max(0, Math.min(1, (clickX - xOffset) / xLength));
            const idx = Math.round(frac * (times.length - 1));
            setCorrAnchor('custom', times[idx]);
            return;
          }
        }

        // Try axis coordinate conversion first for multi-day/rangebreak horizons
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
        const c = getCorrDataset(isNdx, currentCorrTf);
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
// VIX FUTURES TERM STRUCTURE & BACKWARDATION UI ENGINE
// ==============================================================================

let lastVixFuturesData = null;
let lastSpotVixVal = null;

  // ============================================================================
  // COMPOSITE FAIR VIX ENGINE (CARD 2 POPOVER, CARD 1 TAB & ROW 3 MONITOR)
  // ============================================================================

function getActiveFairVixPayload(data) {
  if (!data) return null;
  const isNdx = (currentAssetPair === 'NDX');
  if (isNdx) {
    return (data.ndx && data.ndx.fair_vix) ? data.ndx.fair_vix : null;
  }
  if (!data.is_historical && isGthEnabled && data.session_status === 'GTH_ACTIVE' && data.gth && data.gth.fair_vix && typeof data.gth.fair_vix.combined === 'number') {
    return data.gth.fair_vix;
  }
  return data.fair_vix || null;
}

function getActiveFairVixModelBoot() {
  const isNdx = (currentAssetPair === 'NDX');
  const activeBoot = (currentViewMode === 'historical' && cachedHistoricalData) ? cachedHistoricalData : cachedBootstrap;
  if (!activeBoot) return {};
  return (isNdx ? (activeBoot.ndx && activeBoot.ndx.fair_vix) : activeBoot.fair_vix) || {};
}

function renderFairVixMiniChart(fvLive, fvBoot) {
  const chartEl = document.getElementById('pop-fair-vix-chart');
  if (!chartEl || !fvBoot) return;
  const sc = fvBoot.scatter_60d || {};
  const cv = fvBoot.curve || {};
  if (!Array.isArray(sc.spot) || sc.spot.length === 0) return;

  const isNdx = (currentAssetPair === 'NDX');
  const assetLbl = isNdx ? 'NDX' : 'SPX';
  const volLbl = isNdx ? 'VXN' : 'VIX';
  const liveSpot = fvLive.live_spot;
  const liveVol = fvLive.live_vol;

  const traces = [
    {
      x: sc.spot,
      y: sc.vol,
      text: sc.dates || [],
      mode: 'markers',
      name: '60D',
      marker: { color: isNdx ? 'rgba(192,132,252,0.55)' : 'rgba(230,211,133,0.55)', size: 5 },
      hovertemplate: `%{text}<br>${assetLbl}: %{x:,.2f}<br>${volLbl}: %{y:.2f}<extra></extra>`
    }
  ];

  if (Array.isArray(cv.spot) && cv.spot.length > 0) {
    traces.push({
      x: cv.spot,
      y: cv.vix_quad,
      mode: 'lines',
      name: 'EWM Quad',
      line: { color: '#A855F7', width: 2, shape: 'spline' },
      hovertemplate: 'EWM Quad Fair: %{y:.2f}<extra></extra>'
    });
  }

  if (typeof fvLive.fair_m2_rv_vrp === 'number') {
    const xMin = Math.min(...sc.spot, liveSpot || sc.spot[0]);
    const xMax = Math.max(...sc.spot, liveSpot || sc.spot[0]);
    traces.push({
      x: [xMin, xMax],
      y: [fvLive.fair_m2_rv_vrp, fvLive.fair_m2_rv_vrp],
      mode: 'lines',
      name: 'HAR-RV',
      line: { color: '#10B981', width: 1.5, dash: 'dash' },
      hovertemplate: `HAR-RV: %{y:.2f}<extra></extra>`
    });
  }

  if (typeof liveSpot === 'number' && typeof fvLive.combined === 'number') {
    traces.push({
      x: [liveSpot],
      y: [fvLive.combined],
      mode: 'markers',
      name: 'Composite Fair',
      marker: { color: '#F59E0B', size: 9, symbol: 'diamond', line: { color: '#0F172A', width: 1.5 } },
      hovertemplate: `<b>Composite Fair</b>: ${fvLive.combined.toFixed(2)}<extra></extra>`
    });
  }

  if (typeof liveSpot === 'number' && typeof liveVol === 'number') {
    traces.push({
      x: [liveSpot],
      y: [liveVol],
      mode: 'markers',
      name: `Live ${volLbl}`,
      marker: { color: '#00E5FF', size: 9, line: { color: '#FFFFFF', width: 1.5 } },
      hovertemplate: `<b>Live ${volLbl}</b>: ${liveVol.toFixed(2)}<extra></extra>`
    });
  }

  Plotly.react(chartEl, traces, {
    height: 140,
    margin: { l: 30, r: 10, t: 10, b: 24 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    showlegend: false,
    hovermode: 'closest',
    xaxis: {
      tickfont: { size: 9, color: '#94A3B8' },
      gridcolor: 'rgba(51, 65, 85, 0.25)',
      zeroline: false
    },
    yaxis: {
      tickfont: { size: 9, color: '#94A3B8' },
      gridcolor: 'rgba(51, 65, 85, 0.35)',
      zeroline: false
    }
  }, { displayModeBar: false, responsive: true });
}

function updateFairVixUI(data) {
  const fv = getActiveFairVixPayload(data);
  const fvBoot = getActiveFairVixModelBoot();
  lastFairVixData = fv;

  const kpiLineEl = document.getElementById('kpi-vix-fair-line');
  if (!fv || typeof fv.combined !== 'number') {
    if (kpiLineEl) kpiLineEl.textContent = 'Fair: --.-- (--.-)';
    return;
  }

  const isNdx = (currentAssetPair === 'NDX');
  const volLbl = isNdx ? 'VXN' : 'VIX';
  const gSign = fv.gap_pts >= 0 ? '+' : '';
  const gColorCls = fv.regime === 'RICH' ? 'text-rose-400' : (fv.regime === 'CHEAP' ? 'text-emerald-400' : 'text-amber-300/90');
  if (kpiLineEl) {
    kpiLineEl.textContent = `Fair: ${fv.combined.toFixed(2)} (${gSign}${fv.gap_pts.toFixed(1)})`;
    kpiLineEl.className = `text-[10px] font-mono mt-0.5 truncate ${gColorCls}`;
  }

  // Popover DOM Updates
  const popTitle = document.getElementById('pop-fv-title');
  const popBadge = document.getElementById('pop-fv-badge');
  const popCombined = document.getElementById('pop-fv-combined');
  const popBand = document.getElementById('pop-fv-band');
  const popGap = document.getElementById('pop-fv-gap');
  const popGapPct = document.getElementById('pop-fv-gap-pct');
  const popImp = document.getElementById('pop-fv-imp-move');
  const popReal = document.getElementById('pop-fv-real-move');
  const popRvTag = document.getElementById('pop-fv-rv-tag');
  const popM2Det = document.getElementById('pop-fv-m2-detail');
  const popM2Wt = document.getElementById('pop-fv-m2-wt');
  const popM2Val = document.getElementById('pop-fv-m2-val');
  const popM4Det = document.getElementById('pop-fv-m4-detail');
  const popM4Wt = document.getElementById('pop-fv-m4-wt');
  const popM4Val = document.getElementById('pop-fv-m4-val');
  const popDesc = document.getElementById('pop-fv-desc');

  if (popTitle) popTitle.innerHTML = `<span>🎯</span><span>Composite Fair ${volLbl} Model</span>`;
  if (popBadge) {
    popBadge.textContent = fv.regime || 'FAIR';
    if (fv.regime === 'RICH') {
      popBadge.className = 'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-rose-950/90 text-rose-300 border border-rose-700';
    } else if (fv.regime === 'CHEAP') {
      popBadge.className = 'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-emerald-950/90 text-emerald-300 border border-emerald-700';
    } else {
      popBadge.className = 'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-amber-950/80 text-amber-300 border border-amber-700';
    }
  }
  if (popCombined) popCombined.textContent = fv.combined.toFixed(2);
  if (popBand) popBand.textContent = `Band: ${fv.band_low.toFixed(1)}–${fv.band_high.toFixed(1)}`;
  if (popGap) {
    popGap.textContent = `${gSign}${fv.gap_pts.toFixed(2)} pts`;
    popGap.className = `text-xs font-bold font-mono ${fv.regime === 'RICH' ? 'text-rose-400' : (fv.regime === 'CHEAP' ? 'text-emerald-400' : 'text-white')}`;
  }
  if (popGapPct) popGapPct.textContent = `(${gSign}${fv.gap_pct.toFixed(1)}%)`;
  if (popImp) popImp.textContent = `±${fv.implied_daily_move_pct.toFixed(2)}%`;
  if (popReal) popReal.textContent = `Real 10D: ±${fv.realized_daily_move_pct.toFixed(2)}%`;
  if (popRvTag) popRvTag.textContent = `${fv.rv_method || 'RV'} | Exp RV: ${fv.expected_rv.toFixed(1)}%`;
  if (popM2Det) {
    if (fv.vrp_mode !== 'fixed' && typeof fv.ew_dn10 === 'number') {
      popM2Det.textContent = `EWMA 5/21/Dn10: ${fv.ew_5d.toFixed(1)}/${fv.ew_21d.toFixed(1)}/${fv.ew_dn10.toFixed(1)} | R²: ${(fv.har_r2 || 0).toFixed(2)} | Impl VRP: ${fv.vrp_base >= 0 ? '+' : ''}${fv.vrp_base.toFixed(1)}`;
    } else {
      popM2Det.textContent = `RV 5/10/21: ${fv.rv_5d.toFixed(1)}/${fv.rv_10d.toFixed(1)}/${fv.rv_21d.toFixed(1)} | VRP: +${fv.vrp_base.toFixed(1)} (Live ${fv.vrp_live >= 0 ? '+' : ''}${fv.vrp_live.toFixed(1)})`;
    }
  }
  if (popM2Wt) popM2Wt.textContent = `${Math.round((fv.w_m2 || 0.5) * 100)}%`;
  if (popM2Val) popM2Val.textContent = fv.fair_m2_rv_vrp.toFixed(2);
  if (popM4Det) popM4Det.textContent = `DD: -${fv.drawdown_pct.toFixed(2)}% (Peak ${fv.peak_60d.toLocaleString('en-US', { maximumFractionDigits: 0 })}) | R²: ${fv.quad_r2.toFixed(3)} | c2: ${fv.quad_c2.toFixed(3)}`;
  if (popM4Wt) popM4Wt.textContent = `${Math.round((fv.w_m4 || 0.5) * 100)}%`;
  if (popM4Val) popM4Val.textContent = fv.fair_m4_quad.toFixed(2);
  if (popDesc) {
    const dir = fv.gap_pts > 0.5 ? 'above' : (fv.gap_pts < -0.5 ? 'below' : 'near');
    popDesc.textContent = `${volLbl} (${fv.live_vol.toFixed(2)}) trades ${Math.abs(fv.gap_pts).toFixed(2)} pts ${dir} composite fair (${fv.combined.toFixed(2)}). Price-location (252D EWM Quad) implies ${fv.fair_m4_quad.toFixed(2)} vs realized-vol anchor (HAR-RV) at ${fv.fair_m2_rv_vrp.toFixed(2)}.`;
  }

  const popoverFv = document.getElementById('popover-fair-vix');
  if (popoverFv && !popoverFv.classList.contains('hidden')) {
    renderFairVixMiniChart(fv, fvBoot);
  }
}

function renderFairVixScatterChart(bootstrap) {
  const isNdx = (currentAssetPair === 'NDX');
  const assetLbl = isNdx ? 'NDX' : 'SPX';
  const volLbl = isNdx ? 'VXN' : 'VIX';
  const gthMode = (!isNdx && !bootstrap.is_historical && isGthEnabled);
  const fvBoot = (isNdx ? (bootstrap.ndx && bootstrap.ndx.fair_vix) : bootstrap.fair_vix) || {};
  const activePayload = lastLiveUpdatePayload || bootstrap;
  const fvLive = getActiveFairVixPayload(activePayload) || fvBoot;
  const sc = fvBoot.scatter_60d || {};
  const cv = fvBoot.curve || {};

  const spTitle = document.getElementById('spotvol-title');
  if (spTitle) spTitle.textContent = `${assetLbl} Fair ${volLbl} Curve (EWM Quad + HAR-RV)`;
  const spSub = document.getElementById('spotvol-sub');
  if (spSub && typeof fvLive.combined === 'number') {
    const rvSubTxt = (fvLive.vrp_mode === 'fixed')
      ? `${fvLive.rv_method || 'RV'} + ${fvLive.vrp_base || 4} VRP`
      : `Mean-Rev EWMA R²=${(fvLive.har_r2 || 0).toFixed(2)}`;
    spSub.textContent = `252D EWM Quad (60D DD, R²=${(fvLive.quad_r2 || 0).toFixed(2)}) + HAR-RV (${rvSubTxt}) → Fair ${fvLive.combined.toFixed(2)}`;
  }

  const targetData = (isNdx && bootstrap.ndx && bootstrap.ndx.overvix) ? bootstrap.ndx : bootstrap;
  const gthTrail = (gthMode && bootstrap.overvix && bootstrap.overvix.intraday_trail_gth) ? bootstrap.overvix.intraday_trail_gth : null;
  const rthTrail = (targetData.overvix && targetData.overvix.intraday_trail) ? targetData.overvix.intraday_trail : { spot_raw: [], vol_raw: [], times: [] };
  const trail = (gthTrail && gthTrail.x && gthTrail.x.length > 0) ? gthTrail : rthTrail;

  const spotHist = sc.spot || [];
  const volHist = sc.vol || [];
  const ddHist = sc.dd_pct || [];
  const datesHist = sc.dates || [];
  const nHist = spotHist.length;
  const histSizes = nHist <= 1 ? 8 : spotHist.map((_, i) => Number((4.0 + (8.5 - 4.0) * (i / (nHist - 1))).toFixed(2)));

  const liveSpot = (fvLive && typeof fvLive.live_spot === 'number') ? fvLive.live_spot : (trail.spot_raw && trail.spot_raw.length ? trail.spot_raw[trail.spot_raw.length - 1] : null);
  const liveVol = (fvLive && typeof fvLive.live_vol === 'number') ? fvLive.live_vol : (trail.vol_raw && trail.vol_raw.length ? trail.vol_raw[trail.vol_raw.length - 1] : null);

  const allSpots = spotHist.concat(cv.spot || []).concat(liveSpot ? [liveSpot] : []);
  const minSpot = allSpots.length ? Math.min(...allSpots) : 6000;
  const maxSpot = allSpots.length ? Math.max(...allSpots) : 7500;

  const darkHoverlabel = {
    bgcolor: 'rgba(15, 23, 42, 0.95)',
    bordercolor: '#F59E0B',
    font: { family: 'monospace', size: 11, color: '#F8FAFC' },
    align: 'left'
  };

  const traces = [
    // 0: 60D Historical Scatter (Spot vs Vol)
    {
      x: spotHist,
      y: volHist,
      text: datesHist,
      customdata: ddHist,
      mode: 'markers',
      name: `${assetLbl} 60D History`,
      marker: {
        color: isNdx ? '#C084FC' : '#E6D385',
        size: histSizes,
        opacity: 0.78,
        line: { color: isNdx ? '#9333EA' : '#B39F50', width: 0.75 }
      },
      hoverlabel: darkHoverlabel,
      hovertemplate: `<b>%{text}</b><br>${assetLbl}: <b>%{x:,.2f}</b> (-%{customdata:.2f}% DD)<br>${volLbl}: <b>%{y:.2f}</b><extra></extra>`,
      visible: true
    },
    // 1: 60D Quadratic ±1σ Band
    {
      x: (cv.spot || []).concat([...(cv.spot || [])].reverse()),
      y: (cv.upper_1sd || []).concat([...(cv.lower_1sd || [])].reverse()),
      fill: 'toself',
      fillcolor: 'rgba(168, 85, 247, 0.12)',
      line: { color: 'transparent' },
      name: 'Quad ±1σ Band',
      hoverinfo: 'skip',
      showlegend: false
    },
    // 2: 252D EWM Quadratic Drawdown Fit Curve
    {
      x: cv.spot || [],
      y: cv.vix_quad || [],
      customdata: cv.dd_pct || [],
      mode: 'lines',
      name: '252D EWM Quad Curve',
      line: { color: '#A855F7', width: 2.2, shape: 'spline' },
      hoverlabel: darkHoverlabel,
      hovertemplate: `EWM Quad Fair @ ${assetLbl} %{x:,.2f} (-%{customdata:.2f}% DD): <b>%{y:.2f}</b><extra></extra>`
    },
    // 3: HAR-RV Realized Vol Mean-Reverting Anchor Line
    {
      x: [minSpot, maxSpot],
      y: [fvLive.fair_m2_rv_vrp || null, fvLive.fair_m2_rv_vrp || null],
      mode: 'lines',
      name: `HAR-RV (${typeof fvLive.fair_m2_rv_vrp === 'number' ? fvLive.fair_m2_rv_vrp.toFixed(2) : '--'})`,
      line: { color: '#10B981', width: 1.8, dash: 'dash' },
      hovertemplate: `<b>HAR-RV Fair (${fvLive.vrp_mode === 'fixed' ? 'RV + Fixed VRP' : 'Mean-Rev EWMA'})</b>: %{y:.2f}<extra></extra>`,
      visible: typeof fvLive.fair_m2_rv_vrp === 'number'
    },
    // 4: Today's Intraday Trail (Spot vs Vol)
    {
      x: trail.spot_raw || [],
      y: trail.vol_raw || [],
      text: trail.times || [],
      mode: 'lines+markers',
      name: gthMode ? 'Today Path (GTH+RTH)' : 'Today Path',
      line: { color: '#00E5FF', width: 1.8 },
      marker: { color: '#00E5FF', size: 3.5, opacity: 0.8 },
      hoverlabel: darkHoverlabel,
      hovertemplate: `<b>%{text}</b><br>${assetLbl}: <b>%{x:,.2f}</b><br>${volLbl}: <b>%{y:.2f}</b><extra></extra>`,
      visible: true
    },
    // 5: Live / Session Vol Beacon
    {
      x: liveSpot ? [liveSpot] : [],
      y: liveVol ? [liveVol] : [],
      mode: 'markers',
      name: `Live ${volLbl} (${liveVol ? liveVol.toFixed(2) : '--'})`,
      marker: { color: '#00E5FF', size: 13, line: { color: '#FFFFFF', width: 2 } },
      hoverlabel: darkHoverlabel,
      hovertemplate: `<b>Live ${volLbl}</b>: %{y:.2f} @ ${assetLbl} %{x:,.2f}<br>Composite Fair: <b>${typeof fvLive.combined === 'number' ? fvLive.combined.toFixed(2) : '--'}</b><extra></extra>`,
      visible: Boolean(liveSpot && liveVol)
    },
    // 6: Composite Fair Target Marker at Live Spot
    {
      x: (liveSpot && typeof fvLive.combined === 'number') ? [liveSpot] : [],
      y: (liveSpot && typeof fvLive.combined === 'number') ? [fvLive.combined] : [],
      mode: 'markers',
      name: `Composite Fair (${typeof fvLive.combined === 'number' ? fvLive.combined.toFixed(2) : '--'})`,
      marker: { color: '#F59E0B', size: 12, symbol: 'diamond', line: { color: '#0F172A', width: 1.8 } },
      hoverlabel: darkHoverlabel,
      hovertemplate: `<b>Composite Fair ${volLbl}</b>: %{y:.2f}<br>Gap: <b>${typeof fvLive.gap_pts === 'number' ? (fvLive.gap_pts >= 0 ? '+' : '') + fvLive.gap_pts.toFixed(2) : '--'} pts (${fvLive.regime || 'FAIR'})</b><extra></extra>`,
      visible: Boolean(liveSpot && typeof fvLive.combined === 'number')
    }
  ];

  const shapes = [];
  if (liveSpot && liveVol && typeof fvLive.combined === 'number') {
    shapes.push({
      type: 'line',
      x0: liveSpot,
      x1: liveSpot,
      y0: fvLive.combined,
      y1: liveVol,
      line: { color: fvLive.gap_pts >= 0 ? '#FB7185' : '#34D399', width: 2, dash: 'dot' }
    });
  }

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    hovermode: 'closest',
    hoverdistance: 35,
    hoverlabel: darkHoverlabel,
    margin: { l: 50, r: 20, t: 25, b: 45 },
    xaxis: {
      title: { text: `${assetLbl} Spot Price Level (Peak: ${fvLive.peak_60d ? fvLive.peak_60d.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '--'})`, font: { color: '#94A3B8', size: 11 } },
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 },
      tickformat: ',.0f'
    },
    yaxis: {
      title: { text: `${volLbl} Level (Actual vs Fair)`, font: { color: '#94A3B8', size: 11 } },
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 }
    },
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.15,
      font: { color: '#94A3B8', size: 10 }
    },
    shapes: shapes,
    showlegend: true
  };

  Plotly.newPlot('overvix-chart', traces, layout, { responsive: true, displayModeBar: false });
}

function setupOvervixModeTabs() {
  const btnLin = document.getElementById('btn-ov-mode-linear');
  const btnFair = document.getElementById('btn-ov-mode-fair');
  const activeCls = "px-2 py-1 rounded-md text-[10px] font-semibold bg-cyan-500 text-black shadow-sm transition whitespace-nowrap";
  const activeAmberCls = "px-2 py-1 rounded-md text-[10px] font-semibold bg-amber-500 text-black shadow-sm transition whitespace-nowrap";
  const idleCls = "px-2 py-1 rounded-md text-[10px] font-semibold text-slate-400 hover:text-white transition whitespace-nowrap";

  const applyMode = (mode) => {
    currentOvervixChartMode = mode;
    if (btnLin) btnLin.className = (mode === 'linear') ? activeCls : idleCls;
    if (btnFair) btnFair.className = (mode === 'fair') ? activeAmberCls : idleCls;

    const isNdx = (currentAssetPair === 'NDX');
    const spTitle = document.getElementById('spotvol-title');
    const spSub = document.getElementById('spotvol-sub');
    if (mode === 'linear' && spTitle && spSub) {
      spTitle.textContent = isNdx ? "Nasdaq Spot-Vol Regression & Over-VXN Zone" : "Spot-Vol Regression & Overvix Zone";
      const thr = isNdx ? currentNdxThreshold : currentSpxThreshold;
      spSub.textContent = `${isNdx ? 'NDX' : 'SPX'} % vs ${isNdx ? 'VXN' : 'VIX'} Point Move with +${thr.toFixed(1)} pt Threshold & Intraday Path`;
    }
    const activeData = (currentViewMode === 'historical' && cachedHistoricalData) ? cachedHistoricalData : cachedBootstrap;
    if (activeData) {
      renderOvervixChart(activeData);
      if (mode === 'linear' && lastLiveUpdatePayload && currentViewMode === 'live') {
        updateUI(lastLiveUpdatePayload);
      }
    }
  };

  if (btnLin) btnLin.addEventListener('click', () => applyMode('linear'));
  if (btnFair) btnFair.addEventListener('click', () => applyMode('fair'));
}

function updateFvSliderUI(tf) {
  const conf = TF_CONFIG[tf] || TF_CONFIG['1D'];
  const badge = document.getElementById('fv-slider-badge');
  const pill = document.getElementById('fv-tf-pill');
  const ticks = document.getElementById('fv-tick-labels');
  if (badge) badge.innerHTML = conf.badgeText;
  if (pill) {
    pill.textContent = conf.pillText;
    pill.className = `text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${conf.pillClass}`;
  }
  if (ticks) {
    ticks.querySelectorAll('span[data-step]').forEach(span => {
      const s = parseInt(span.getAttribute('data-step'), 10);
      span.className = (s === conf.step)
        ? "cursor-pointer font-bold text-cyan-400 transition"
        : "cursor-pointer text-slate-400 hover:text-cyan-300 transition";
    });
  }
}

function switchFairVixTf(tf, propagate = true) {
  currentFvTf = tf;
  const conf = TF_CONFIG[tf] || TF_CONFIG['1D'];
  const sliderFv = document.getElementById('slider-fv-timeframe');
  if (sliderFv && sliderFv.value != conf.step) {
    sliderFv.value = conf.step;
  }
  updateFvSliderUI(tf);
  renderFairVixMonitorChart(tf);

  if (propagate) {
    propagateHorizonSync('fv', tf);
  }
}

function setupFairVixMonitorControls() {
  const sliderFv = document.getElementById('slider-fv-timeframe');
  const ticksFv = document.getElementById('fv-tick-labels');
  const btnLevels = document.getElementById('btn-fv-mode-levels');
  const btnBeta = document.getElementById('btn-fv-mode-beta');
  const btnComp = document.getElementById('btn-fv-components');
  const chartEl = document.getElementById('fair-vix-chart');

  if (sliderFv) {
    sliderFv.addEventListener('input', (e) => {
      const idx = parseInt(e.target.value, 10);
      const tf = TF_STEPS[idx] || '1D';
      updateFvSliderUI(tf);
      previewHorizonSync('fv', idx, tf);
    });
    sliderFv.addEventListener('change', (e) => {
      const idx = parseInt(e.target.value, 10);
      switchFairVixTf(TF_STEPS[idx] || '1D', true);
    });
  }

  if (ticksFv) {
    ticksFv.querySelectorAll('span[data-step]').forEach(span => {
      span.addEventListener('click', () => {
        const step = parseInt(span.getAttribute('data-step'), 10);
        switchFairVixTf(TF_STEPS[step] || '1D', true);
      });
    });
  }

  const activeAmber = "px-2.5 py-1.5 rounded-md text-xs font-semibold bg-amber-500 text-black shadow-sm transition whitespace-nowrap";
  const idleMode = "px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-400 hover:text-white transition whitespace-nowrap";

  if (btnLevels) {
    btnLevels.addEventListener('click', () => {
      currentFvDisplayMode = 'levels';
      btnLevels.className = activeAmber;
      if (btnBeta) btnBeta.className = idleMode;
      renderFairVixMonitorChart(currentFvTf);
    });
  }
  if (btnBeta) {
    btnBeta.addEventListener('click', () => {
      currentFvDisplayMode = 'beta';
      btnBeta.className = activeAmber;
      if (btnLevels) btnLevels.className = idleMode;
      renderFairVixMonitorChart(currentFvTf);
    });
  }
  if (btnComp) {
    btnComp.addEventListener('click', () => {
      showFvComponents = !showFvComponents;
      btnComp.className = showFvComponents
        ? "px-2.5 py-1.5 rounded-md text-xs font-semibold bg-purple-500 text-white shadow-sm transition whitespace-nowrap"
        : idleMode;
      renderFairVixMonitorChart(currentFvTf);
    });
  }

  if (chartEl && !chartEl._hasFvHoverTracking) {
    chartEl._hasFvHoverTracking = true;
    chartEl.addEventListener('mouseenter', () => { isMouseHoveringFvChart = true; });
    chartEl.addEventListener('mousemove', () => { isMouseHoveringFvChart = true; });
    chartEl.addEventListener('mouseleave', () => {
      isMouseHoveringFvChart = false;
      if (pendingLiveFvRender) {
        pendingLiveFvRender = false;
        renderFairVixMonitorChart(currentFvTf);
      }
    });
  }
}

function renderFairVixMonitorChart(tf = currentFvTf) {
  const chartEl = document.getElementById('fair-vix-chart');
  if (!chartEl) return;

  const targetTf = tf || currentFvTf || '1D';
  const isNdx = (currentAssetPair === 'NDX');
  const assetLabel = isNdx ? 'NDX' : 'SPX';
  const volLabel = isNdx ? 'VXN' : 'VIX';
  const ovLabel = isNdx ? 'Over-VXN' : 'Overvix';
  const thresh = isNdx ? currentNdxThreshold : currentSpxThreshold;

  const titleEl = document.getElementById('fv-monitor-title');
  if (titleEl) {
    titleEl.textContent = isNdx
      ? "Composite Fair VXN & Structural Residual Monitor"
      : "Composite Fair VIX & Structural Residual Monitor";
  }

  const c = getCorrDataset(isNdx, targetTf);
  if (!c || !Array.isArray(c.times) || c.times.length === 0) {
    return;
  }

  const h = harmonizeIntradayWithSettlements(c, isNdx, targetTf);
  const times = h.times;
  const spotRaw = h.spotRaw;
  const volRaw = h.volRaw;
  const baseSpotPct = h.baseSpotPct;
  const baseVolPt = h.baseVolPt;
  const officialCloses = h.officialCloses;
  const dailyDatesList = h.dailyDatesList;
  const settlementMap = h.settlementMap;

  const activeData = (currentViewMode === 'live' && lastLiveUpdatePayload) ? lastLiveUpdatePayload : ((currentViewMode === 'historical' && cachedHistoricalData) ? cachedHistoricalData : cachedBootstrap);
  const fvBoot = getActiveFairVixModelBoot();
  const fvLive = getActiveFairVixPayload(activeData) || fvBoot;
  const dailyParams = fvBoot.daily_params || {};
  const paramDates = Object.keys(dailyParams).sort();
  const lastSettledDate = fvBoot.last_settled_date || (paramDates.length ? paramDates[paramDates.length - 1] : '');

  const fallbackParams = {
    peak_60d: fvLive.peak_60d || fvBoot.peak_60d || (spotRaw.length ? spotRaw[0] : 1),
    c0: fvLive.quad_c0 !== undefined ? fvLive.quad_c0 : (fvBoot.c0 || 15.0),
    c1: fvLive.quad_c1 !== undefined ? fvLive.quad_c1 : (fvBoot.c1 || 1.0),
    c2: fvLive.quad_c2 !== undefined ? fvLive.quad_c2 : (fvBoot.c2 || 0.0),
    fair_m2: fvLive.fair_m2_rv_vrp !== undefined ? fvLive.fair_m2_rv_vrp : (fvBoot.fair_m2 || 20.0),
    w_m2: fvLive.w_m2 !== undefined ? fvLive.w_m2 : (fvBoot.w_m2 || 0.5),
    w_m4: fvLive.w_m4 !== undefined ? fvLive.w_m4 : (fvBoot.w_m4 || 0.5),
  };

  const getParamsForDate = (dStr) => {
    if (dailyParams[dStr]) return dailyParams[dStr];
    if (paramDates.length > 0 && dStr < paramDates[0]) return null;
    if (lastSettledDate && dStr > lastSettledDate) return fallbackParams;
    for (let j = paramDates.length - 1; j >= 0; j--) {
      if (paramDates[j] <= dStr) return dailyParams[paramDates[j]];
    }
    return fallbackParams;
  };

  const { beta, rawSlope, rawIntercept } = getActiveBetaAndIntercept(isNdx);
  const slope = rawSlope;
  const intercept = rawIntercept;
  const absBeta = Math.max(0.5, beta);
  const isIntradayTf = ['1D', '5D', '10D', '1M'].includes(targetTf);
  const isGth = (!isNdx && isGthChartActive(targetTf));

  const liveVolArr = [];
  const compFairArr = [];
  const m2Arr = [];
  const m4Arr = [];
  const compResArr = [];
  const ovResArr = [];
  const spotPctDailyArr = [];
  const volPtDailyArr = [];
  const fairPtDailyArr = [];
  const stickyX = [];
  const stickyY = [];
  const stickyCustom = [];

  const n = times.length;
  let curDay = '';
  let refSpot = (spotRaw[0] || 1);
  let refVol = (volRaw[0] || 20);
  const firstRefVol = refVol;

  for (let i = 0; i < n; i++) {
    const tStr = times[i] || '';
    const dStr = tStr.slice(0, 10);
    const sVal = (typeof spotRaw[i] === 'number' && !isNaN(spotRaw[i])) ? spotRaw[i] : null;
    const vVal = (typeof volRaw[i] === 'number' && !isNaN(volRaw[i])) ? volRaw[i] : null;

    if (isIntradayTf && dStr !== curDay) {
      curDay = dStr;
      if (isGth && cachedBootstrap && cachedBootstrap.gth && cachedBootstrap.gth.ref_spx && cachedBootstrap.gth.ref_vix && dStr >= (cachedBootstrap.gth.session_date || dStr)) {
        refSpot = cachedBootstrap.gth.ref_spx;
        refVol = cachedBootstrap.gth.ref_vix;
      } else {
        let foundPrior = false;
        for (let j = dailyDatesList.length - 1; j >= 0; j--) {
          if (dailyDatesList[j] < dStr && officialCloses[dailyDatesList[j]]) {
            refSpot = officialCloses[dailyDatesList[j]].spot;
            refVol = officialCloses[dailyDatesList[j]].vol;
            foundPrior = true;
            break;
          }
        }
        if (!foundPrior) {
          refSpot = (i > 0 && typeof spotRaw[i - 1] === 'number') ? spotRaw[i - 1] : (sVal || 1);
          refVol = (i > 0 && typeof volRaw[i - 1] === 'number') ? volRaw[i - 1] : (vVal || 20);
        }
      }
    }

    const p = getParamsForDate(dStr);
    let fM2 = null;
    let fM4 = null;
    let cFair = null;
    let cRes = null;

    if (p) {
      fM2 = p.fair_m2;
      fM4 = p.fair_m2;
      cFair = p.fair_m2;
      cRes = 0;
      if (sVal !== null && vVal !== null && p.peak_60d > 0) {
        const dd = Math.max(0.0, (p.peak_60d - sVal) / p.peak_60d * 100.0);
        fM4 = p.c0 + p.c1 * dd + p.c2 * (dd * dd);
        cFair = p.w_m2 * fM2 + p.w_m4 * fM4;
        cRes = vVal - cFair;
      }
    }

    let sPct = (typeof baseSpotPct[i] === 'number') ? baseSpotPct[i] : 0;
    let vPt = (typeof baseVolPt[i] === 'number') ? baseVolPt[i] : 0;
    if (targetTf === '1D' && typeof baseSpotPct[i] === 'number' && typeof baseVolPt[i] === 'number') {
      sPct = baseSpotPct[i];
      vPt = baseVolPt[i];
    } else if (isIntradayTf && sVal !== null && vVal !== null && refSpot > 0) {
      sPct = (sVal - refSpot) / refSpot * 100.0;
      vPt = vVal - refVol;
    } else if (!isIntradayTf && i > 0 && sVal !== null && vVal !== null && typeof spotRaw[i - 1] === 'number' && spotRaw[i - 1] > 0 && typeof volRaw[i - 1] === 'number') {
      sPct = (sVal - spotRaw[i - 1]) / spotRaw[i - 1] * 100.0;
      vPt = vVal - volRaw[i - 1];
    }

    const ovRes = vPt - (intercept + slope * sPct);

    liveVolArr.push(vVal);
    compFairArr.push(cFair !== null ? Number(cFair.toFixed(2)) : null);
    m2Arr.push(fM2 !== null ? Number(fM2.toFixed(2)) : null);
    m4Arr.push(fM4 !== null ? Number(fM4.toFixed(2)) : null);
    compResArr.push(cRes !== null ? Number(cRes.toFixed(2)) : null);
    ovResArr.push(Number(ovRes.toFixed(2)));
    spotPctDailyArr.push(typeof baseSpotPct[i] === 'number' ? baseSpotPct[i] : sPct);
    const vHorizonPt = (vVal !== null) ? (vVal - firstRefVol) : 0;
    const fHorizonPt = (cFair !== null) ? (cFair - firstRefVol) : null;
    volPtDailyArr.push(Number(vHorizonPt.toFixed(2)));
    fairPtDailyArr.push(fHorizonPt !== null ? Number(fHorizonPt.toFixed(2)) : null);

    if (cRes !== null && cRes > 0 && ovRes > 0 && sPct > 0 && vVal !== null) {
      stickyX.push(tStr);
      stickyY.push(Number(cRes.toFixed(2)));
      stickyCustom.push([sPct.toFixed(2), cRes.toFixed(2), ovRes.toFixed(2)]);
    }
  }

  // Update HUD metrics from latest point / live Fair VIX
  const latestV = (typeof fvLive.live_vol === 'number') ? fvLive.live_vol : liveVolArr[n - 1];
  const latestFair = (typeof fvLive.combined === 'number') ? fvLive.combined : compFairArr[n - 1];
  const latestM2 = (typeof fvLive.fair_m2_rv_vrp === 'number') ? fvLive.fair_m2_rv_vrp : m2Arr[n - 1];
  const latestM4 = (typeof fvLive.fair_m4_quad === 'number') ? fvLive.fair_m4_quad : m4Arr[n - 1];
  const latestCRes = (typeof fvLive.gap_pts === 'number') ? fvLive.gap_pts : compResArr[n - 1];
  const latestOvRes = ovResArr[n - 1];

  const setTxt = (id, txt, cls) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = txt;
      if (cls) el.className = cls;
    }
  };
  if (typeof latestV === 'number') setTxt('fv-hud-live', latestV.toFixed(2));
  if (typeof latestFair === 'number') setTxt('fv-hud-fair', latestFair.toFixed(2));
  if (typeof latestM2 === 'number') setTxt('fv-hud-m2', latestM2.toFixed(2));
  if (typeof latestM4 === 'number') setTxt('fv-hud-m4', latestM4.toFixed(2));
  if (typeof latestCRes === 'number') {
    const s = latestCRes >= 0 ? '+' : '';
    setTxt('fv-hud-comp-res', `${s}${latestCRes.toFixed(2)} pts`, latestCRes >= thresh ? 'text-rose-400 font-bold' : (latestCRes <= -thresh ? 'text-emerald-400 font-bold' : 'text-amber-300 font-bold'));
  }
  if (typeof latestOvRes === 'number') {
    const s = latestOvRes >= 0 ? '+' : '';
    setTxt('fv-hud-ov-res', `${s}${latestOvRes.toFixed(2)} pts`, latestOvRes >= thresh ? 'text-rose-400 font-bold' : 'text-cyan-300 font-bold');
  }

  const regimePill = document.getElementById('fv-regime-pill');
  if (regimePill && typeof latestCRes === 'number') {
    const gRegime = fvLive.regime || (latestCRes >= thresh ? 'RICH' : (latestCRes <= -thresh ? 'CHEAP' : 'FAIR'));
    const s = latestCRes >= 0 ? '+' : '';
    regimePill.textContent = `${gRegime} (${s}${latestCRes.toFixed(2)} pts)`;
    if (gRegime === 'RICH') {
      regimePill.className = 'text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-700';
    } else if (gRegime === 'CHEAP') {
      regimePill.className = 'text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-700';
    } else {
      regimePill.className = 'text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-700';
    }
  }

  const stickyPill = document.getElementById('fv-sticky-pill');
  const sumEl = document.getElementById('fv-summary-comment');
  const dualPos = (typeof latestCRes === 'number' && typeof latestOvRes === 'number' && latestCRes > 0 && latestOvRes > 0);
  const lastSpotPct = spotPctDailyArr[n - 1] || 0;
  if (stickyPill) {
    if (dualPos) stickyPill.classList.remove('hidden');
    else stickyPill.classList.add('hidden');
  }
  if (sumEl && typeof latestCRes === 'number') {
    if (dualPos && lastSpotPct > 0) {
      sumEl.textContent = `High-conviction sticky vol: Spot rallying while both Composite (+${latestCRes.toFixed(2)}) & ${ovLabel} (+${latestOvRes.toFixed(2)}) residuals stay positive.`;
      sumEl.className = 'text-[11px] text-rose-300 font-sans font-semibold';
    } else if (dualPos) {
      sumEl.textContent = `Dual positive stress: ${volLabel} rich vs both multi-week fair (+${latestCRes.toFixed(2)} pts) & intraday flow (+${latestOvRes.toFixed(2)} pts).`;
      sumEl.className = 'text-[11px] text-amber-300 font-sans font-medium';
    } else if (latestCRes <= -thresh) {
      sumEl.textContent = `${volLabel} trading ${Math.abs(latestCRes).toFixed(2)} pts below Composite Fair (${latestFair.toFixed(2)}) — realized/structural vol underpriced.`;
      sumEl.className = 'text-[11px] text-emerald-300 font-sans font-medium';
    } else {
      sumEl.textContent = `${volLabel} near Composite Fair (${latestFair ? latestFair.toFixed(2) : '--'}) | HAR-RV=${latestM2 ? latestM2.toFixed(1) : '--'}, EWM Quad=${latestM4 ? latestM4.toFixed(1) : '--'}.`;
      sumEl.className = 'text-[11px] text-slate-300 font-sans font-normal';
    }
  }

  const tfConf = TF_CONFIG[targetTf] || TF_CONFIG['1D'];
  const timeHoverFmt = tfConf.timeHoverFmt;
  const isMultiDayIntradayTf = (targetTf === '5D' || targetTf === '10D' || targetTf === '1M');
  const fvSessionSegs = isMultiDayIntradayTf ? buildSessionSegments(times) : [];
  const useFvBreaks = (fvSessionSegs.length > 1);
  const fvSegs = useFvBreaks ? fvSessionSegs : [{ start: 0, end: n, day: '', startTime: times[0] }];
  const traces = [];
  const customUpper = times.map((t, i) => [
    liveVolArr[i] !== null ? liveVolArr[i].toFixed(2) : '-',
    compFairArr[i] !== null ? compFairArr[i].toFixed(2) : '-',
    m2Arr[i] !== null ? m2Arr[i].toFixed(2) : '-',
    m4Arr[i] !== null ? m4Arr[i].toFixed(2) : '-',
    compResArr[i] !== null ? ((compResArr[i] >= 0 ? '+' : '') + compResArr[i].toFixed(2)) : '-',
    ovResArr[i] !== null ? ((ovResArr[i] >= 0 ? '+' : '') + ovResArr[i].toFixed(2)) : '-',
    settlementMap[t] ? "  <span style='color:#38BDF8;font-weight:bold'>🏛️ Official Close</span>" : ""
  ]);

  if (currentFvDisplayMode === 'beta') {
    fvSegs.forEach((seg, sIdx) => {
      const tSeg = times.slice(seg.start, seg.end);
      const cSeg = customUpper.slice(seg.start, seg.end);
      traces.push(
        {
          x: tSeg,
          y: spotPctDailyArr.slice(seg.start, seg.end),
          customdata: cSeg,
          name: `${assetLabel} %`,
          legendgroup: 'fv_spot',
          showlegend: (sIdx === 0),
          mode: 'lines',
          line: { color: '#10B981', width: 1.8 },
          xaxis: 'x',
          yaxis: 'y',
          hovertemplate: `<b>%{x|${timeHoverFmt}}</b>%{customdata[6]}<br>${assetLabel}: <b>%{y:+.2f}%</b><extra></extra>`
        },
        {
          x: tSeg,
          y: volPtDailyArr.slice(seg.start, seg.end),
          customdata: cSeg,
          name: `${volLabel} Pt (Inv ▼)`,
          legendgroup: 'fv_vpt',
          showlegend: (sIdx === 0),
          mode: 'lines',
          line: { color: '#00E5FF', width: 2.0 },
          xaxis: 'x',
          yaxis: 'y2',
          hovertemplate: `${volLabel}: <b>%{customdata[0]}</b> (%{y:+.2f} pts)<extra></extra>`
        },
        {
          x: tSeg,
          y: fairPtDailyArr.slice(seg.start, seg.end),
          customdata: cSeg,
          name: `Composite Fair ${volLabel} (Inv ▼)`,
          legendgroup: 'fv_fpt',
          showlegend: (sIdx === 0),
          mode: 'lines',
          line: { color: '#F59E0B', width: 2.2, dash: 'dash' },
          xaxis: 'x',
          yaxis: 'y2',
          hovertemplate: `Composite Fair: <b>%{customdata[1]}</b> | Gap: <b>%{customdata[4]} pts</b><extra></extra>`
        }
      );
    });
  } else {
    fvSegs.forEach((seg, sIdx) => {
      const tSeg = times.slice(seg.start, seg.end);
      const cSeg = customUpper.slice(seg.start, seg.end);
      traces.push(
        {
          x: tSeg,
          y: liveVolArr.slice(seg.start, seg.end),
          customdata: cSeg,
          name: `Live ${volLabel}`,
          legendgroup: 'fv_live',
          showlegend: (sIdx === 0),
          mode: 'lines',
          line: { color: '#00E5FF', width: 2.0 },
          xaxis: 'x',
          yaxis: 'y',
          hovertemplate: `<b>%{x|${timeHoverFmt}}</b>%{customdata[6]}<br>Live ${volLabel}: <b>%{y:.2f}</b><br>Comp Fair: <b>%{customdata[1]}</b> (Gap: <b>%{customdata[4]} pts</b>)<extra></extra>`
        },
        {
          x: tSeg,
          y: compFairArr.slice(seg.start, seg.end),
          customdata: cSeg,
          name: `Composite Fair ${volLabel}`,
          legendgroup: 'fv_fair',
          showlegend: (sIdx === 0),
          mode: 'lines',
          line: { color: '#F59E0B', width: 2.2, dash: 'dash' },
          fill: 'tonexty',
          fillcolor: 'rgba(245, 158, 11, 0.10)',
          xaxis: 'x',
          yaxis: 'y',
          hovertemplate: `Composite Fair: <b>%{y:.2f}</b> (HAR-RV: %{customdata[2]}, EWM Quad: %{customdata[3]})<extra></extra>`
        }
      );
      if (showFvComponents) {
        traces.push(
          {
            x: tSeg,
            y: m2Arr.slice(seg.start, seg.end),
            name: 'HAR-RV',
            legendgroup: 'fv_har',
            showlegend: (sIdx === 0),
            mode: 'lines',
            line: { color: '#10B981', width: 1.4, dash: 'dot' },
            xaxis: 'x',
            yaxis: 'y',
            hovertemplate: 'HAR-RV: <b>%{y:.2f}</b><extra></extra>'
          },
          {
            x: tSeg,
            y: m4Arr.slice(seg.start, seg.end),
            name: 'EWM Quad',
            legendgroup: 'fv_quad',
            showlegend: (sIdx === 0),
            mode: 'lines',
            line: { color: '#A855F7', width: 1.4, dash: 'dot' },
            xaxis: 'x',
            yaxis: 'y',
            hovertemplate: 'EWM Quad: <b>%{y:.2f}</b><extra></extra>'
          }
        );
      }
    });
  }

  // Lower Panel Traces (yaxis3): Composite Residual + Intraday Overvix Residual + Reference Lines
  fvSegs.forEach((seg, sIdx) => {
    const tSeg = times.slice(seg.start, seg.end);
    const cSeg = customUpper.slice(seg.start, seg.end);
    traces.push(
      {
        x: tSeg,
        y: compResArr.slice(seg.start, seg.end),
        customdata: cSeg,
        name: `Composite Resid (${volLabel} − Fair)`,
        legendgroup: 'fv_compres',
        showlegend: (sIdx === 0),
        mode: 'lines',
        line: { color: '#F59E0B', width: 2.0 },
        fill: 'tozeroy',
        fillcolor: 'rgba(245, 158, 11, 0.14)',
        xaxis: 'x',
        yaxis: 'y3',
        hovertemplate: `Comp Residual: <b>%{customdata[4]} pts</b><extra></extra>`
      },
      {
        x: tSeg,
        y: ovResArr.slice(seg.start, seg.end),
        customdata: cSeg,
        name: `${ovLabel} Residual (Flow)`,
        legendgroup: 'fv_ovres',
        showlegend: (sIdx === 0),
        mode: 'lines',
        line: { color: '#00E5FF', width: 1.5 },
        xaxis: 'x',
        yaxis: 'y3',
        hovertemplate: `${ovLabel} Residual: <b>%{customdata[5]} pts</b><extra></extra>`
      }
    );
  });

  traces.push(
    {
      x: [times[0], times[n - 1]],
      y: [0, 0],
      mode: 'lines',
      line: { color: '#475569', width: 1 },
      hoverinfo: 'skip',
      showlegend: false,
      xaxis: 'x',
      yaxis: 'y3'
    },
    {
      x: [times[0], times[n - 1]],
      y: [thresh, thresh],
      mode: 'lines',
      line: { color: 'rgba(255, 83, 112, 0.5)', width: 1, dash: 'dot' },
      hoverinfo: 'skip',
      showlegend: false,
      xaxis: 'x',
      yaxis: 'y3'
    },
    {
      x: [times[0], times[n - 1]],
      y: [-thresh, -thresh],
      mode: 'lines',
      line: { color: 'rgba(16, 185, 129, 0.45)', width: 1, dash: 'dot' },
      hoverinfo: 'skip',
      showlegend: false,
      xaxis: 'x',
      yaxis: 'y3'
    }
  );

  if (stickyX.length > 0) {
    traces.push({
      x: stickyX,
      y: stickyY,
      customdata: stickyCustom,
      name: 'Sticky Vol (Rally + Dual +)',
      mode: 'markers',
      marker: { color: '#FF5370', size: 5.5, opacity: 0.9 },
      xaxis: 'x',
      yaxis: 'y3',
      hovertemplate: `<b>🔥 Sticky Vol Confluence</b><br>${assetLabel} %: +%{customdata[0]}% | Comp Res: +%{customdata[1]} pts | ${ovLabel}: +%{customdata[2]} pts<extra></extra>`
    });
  }

  let rangeY = null;
  let rangeY2 = null;
  if (currentFvDisplayMode === 'beta') {
    const validS = spotPctDailyArr.filter(v => typeof v === 'number' && !isNaN(v));
    const vAll = volPtDailyArr.concat(fairPtDailyArr).filter(v => typeof v === 'number' && !isNaN(v));
    const sMin = validS.length ? Math.min(...validS) : -1;
    const sMax = validS.length ? Math.max(...validS) : 1;
    const vMin = vAll.length ? Math.min(...vAll) : -2;
    const vMax = vAll.length ? Math.max(...vAll) : 2;
    const halfS = Math.max(0.25, (sMax - sMin) / 2, (vMax - vMin) / (2 * absBeta)) * 1.15;
    const midS = (sMin + sMax) / 2;
    const midV = (vMin + vMax) / 2;
    rangeY = [midS - halfS, midS + halfS];
    rangeY2 = [midV + halfS * absBeta, midV - halfS * absBeta];
  }

  const fvShapes = [];
  if (useFvBreaks) {
    fvSessionSegs.slice(1).forEach(seg => {
      fvShapes.push({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: seg.startTime,
        x1: seg.startTime,
        y0: 0,
        y1: 1,
        line: {
          color: 'rgba(148, 163, 184, 0.22)',
          width: 1,
          dash: 'dash'
        },
        layer: 'below'
      });
    });
  }

  let fvRangebreaks = tfConf.rangebreaks || [];
  if (isGth) {
    fvRangebreaks = (targetTf === '5D' || targetTf === '10D')
      ? [{ pattern: 'day of week', bounds: ['sat', 'mon'] }, { pattern: 'hour', bounds: [16.25, 3.25] }, { pattern: 'hour', bounds: [9.25, 9.5] }]
      : [{ pattern: 'hour', bounds: [16.25, 3.25] }, { pattern: 'hour', bounds: [9.25, 9.5] }];
  }
  const hasFvSpan = Boolean(n > 1 && times[0] && times[n - 1] && times[0] !== times[n - 1]);

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    height: 410,
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: 'rgba(15, 23, 42, 0.95)',
      bordercolor: '#F59E0B',
      font: { family: 'monospace', size: 11, color: '#F8FAFC' }
    },
    margin: { l: 55, r: 58, t: 28, b: 36 },
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.07,
      font: { color: '#94A3B8', size: 10 }
    },
    xaxis: {
      type: 'date',
      range: hasFvSpan ? [times[0], times[n - 1]] : undefined,
      autorange: !hasFvSpan,
      rangebreaks: fvRangebreaks,
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 },
      fixedrange: true,
      showspikes: true,
      spikecolor: '#475569',
      spikethickness: 1,
      spikedash: 'dot'
    },
    shapes: fvShapes,
    yaxis: {
      domain: [0.43, 1.0],
      title: { text: currentFvDisplayMode === 'beta' ? `${assetLabel} %` : `${volLabel} Level`, font: { color: '#94A3B8', size: 11 } },
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 },
      range: rangeY || undefined,
      autorange: rangeY ? false : true
    },
    yaxis3: {
      domain: [0.0, 0.34],
      title: { text: 'Residual (pts)', font: { color: '#F59E0B', size: 11 } },
      gridcolor: '#1e293b',
      zeroline: true,
      zerolinecolor: '#334155',
      tickfont: { color: '#94A3B8', size: 10 }
    }
  };

  if (currentFvDisplayMode === 'beta') {
    layout.yaxis2 = {
      domain: [0.43, 1.0],
      overlaying: 'y',
      side: 'right',
      title: { text: `${volLabel} Pt (Inv ▼)`, font: { color: '#F59E0B', size: 11 } },
      tickfont: { color: '#F59E0B', size: 10 },
      showgrid: false,
      range: rangeY2,
      autorange: false
    };
  }

  Plotly.react(chartEl, traces, layout, { displayModeBar: false, responsive: true });
}

function renderVixFuturesCurveChart(vf, spotVix) {
  const chartEl = document.getElementById('pop-futures-curve-chart');
  if (!chartEl || !vf || !Array.isArray(vf.contracts) || vf.contracts.length === 0) return;

  const validContracts = vf.contracts.filter(c => typeof c.price === 'number' && !isNaN(c.price));
  if (validContracts.length === 0) return;

  const regime = vf.regime || 'CONTANGO';
  const isFullInv = (regime === 'FULL BACKWARDATION');
  const isFrontInv = (regime === 'FRONT BACKWARDATION');

  // Curve styling by regime
  let curveColor = '#38BDF8'; // Sky blue / cyan for normal Contango
  if (isFullInv) {
    curveColor = '#EF4444'; // Red for Full Backwardation
  } else if (isFrontInv) {
    curveColor = '#F59E0B'; // Amber for Front Inversion
  } else if (regime === 'BELLY INVERSION') {
    curveColor = '#FB7185'; // Rose for Belly Inversion
  } else if (regime === 'FLATTENING') {
    curveColor = '#CBD5E1'; // Slate for Flattening
  }

  const effSpot = (typeof vf.spot_vix === 'number' && vf.spot_vix > 0) ? vf.spot_vix : spotVix;
  const spotTag = vf.is_gth_spot ? ' GTH' : '';

  // Update chart legend elements
  const swatchEl = document.getElementById('pop-curve-line-swatch');
  if (swatchEl) swatchEl.style.backgroundColor = curveColor;
  const spotLblEl = document.getElementById('pop-curve-spot-lbl');
  if (spotLblEl && typeof effSpot === 'number') {
    spotLblEl.textContent = `Spot VIX (${effSpot.toFixed(2)}${spotTag})`;
  }

  // X labels: Tenor + Month (e.g. M1 Dec, M2 Jan...)
  const xLabels = validContracts.map(c => {
    const mStr = c.month_name ? c.month_name.split(' ')[0] : '';
    return `${c.tenor} ${mStr}`;
  });
  const yValues = validContracts.map(c => c.price);
  const textLabels = validContracts.map(c => c.price.toFixed(2));

  const traces = [];

  // Trace 0: Spot VIX Reference Line (horizontal dashed)
  if (typeof effSpot === 'number' && effSpot > 0) {
    traces.push({
      x: xLabels,
      y: xLabels.map(() => effSpot),
      mode: 'lines',
      name: vf.is_gth_spot ? 'Spot VIX (GTH)' : 'Spot VIX',
      line: {
        color: '#10B981', // Emerald green
        width: 1.5,
        dash: 'dash'
      },
      hovertemplate: '<b>%{fullData.name}</b>: %{y:.2f}<extra></extra>'
    });
  }

  // Trace 1: Futures Curve Line + Markers + Text Labels
  traces.push({
    x: xLabels,
    y: yValues,
    mode: 'lines+markers+text',
    name: 'Futures Curve',
    text: textLabels,
    textposition: 'top center',
    textfont: {
      family: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      size: 9,
      color: '#F8FAFC'
    },
    line: {
      color: curveColor,
      width: 2.5,
      shape: 'spline',
      smoothing: 0.6
    },
    marker: {
      color: curveColor,
      size: 6,
      line: {
        color: '#0F172A',
        width: 1.5
      }
    },
    hovertemplate: validContracts.map(c => {
      const spVal = (typeof c.diff === 'number') ? c.diff : (typeof c.spread === 'number' ? c.spread : null);
      const isInv = (spVal !== null && spVal < -0.01);
      const isFlat = (spVal !== null && Math.abs(spVal) <= 0.01);
      const spType = isInv ? 'Backwardation' : (isFlat ? 'Flat' : 'Contango');
      const spStr = (spVal !== null) ? `${spVal >= 0 ? '+' : ''}${spVal.toFixed(2)} pts` : '—';
      const pctStr = (typeof c.contango_pct === 'number') ? `${c.contango_pct >= 0 ? '+' : ''}${c.contango_pct.toFixed(2)}%` : '—';
      return `<b>${c.tenor} &bull; ${c.month_name || ''} (${c.symbol || c.localSymbol})</b><br>` +
             `Price: <b>${c.price.toFixed(2)}</b><br>` +
             `DTE: <b>${c.dte || '--'}d</b><br>` +
             `Roll: <b>${pctStr}</b> (${spStr} &bull; ${spType})` +
             `<extra></extra>`;
    })
  });

  const layout = {
    height: 140,
    margin: { l: 30, r: 16, t: 18, b: 24 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    showlegend: false,
    xaxis: {
      tickfont: {
        size: 9,
        color: '#94A3B8',
        family: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      },
      gridcolor: 'rgba(51, 65, 85, 0.25)',
      zeroline: false
    },
    yaxis: {
      tickfont: {
        size: 9,
        color: '#94A3B8',
        family: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      },
      tickformat: '.1f',
      gridcolor: 'rgba(51, 65, 85, 0.35)',
      zeroline: false,
      autorange: true
    }
  };

  const config = {
    displayModeBar: false,
    responsive: true
  };

  Plotly.react(chartEl, traces, layout, config);
}

function updateVixFuturesUI(vf, spotVix) {
  if (!vf) return;

  lastVixFuturesData = vf;
  lastSpotVixVal = spotVix;

  const tagRegime = document.getElementById('tag-futures-regime');
  const lblSpreads = document.getElementById('lbl-futures-spreads');
  const chartBadge = document.getElementById('chart-futures-badge');
  const chartSpread = document.getElementById('chart-futures-spread');

  // Popover elements
  const popBadge = document.getElementById('pop-futures-badge');
  const popM1M2 = document.getElementById('pop-futures-m1m2');
  const popM1M2Pts = document.getElementById('pop-futures-m1m2-pts');
  const popM4M7 = document.getElementById('pop-futures-m4m7');
  const popM4M7Pts = document.getElementById('pop-futures-m4m7-pts');
  const popSpotBasis = document.getElementById('pop-futures-spot-basis');
  const popInvPairs = document.getElementById('pop-futures-inv-pairs');
  const popDesc = document.getElementById('pop-futures-desc');
  const popTableBody = document.getElementById('pop-futures-table-body');

  const regime = vf.regime || 'CONTANGO';
  const isFullInv = (regime === 'FULL BACKWARDATION');
  const isFrontInv = (regime === 'FRONT BACKWARDATION');
  const isBellyInv = (regime === 'BELLY INVERSION');

  // Badge styling
  let badgeClass = 'bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold';
  let shortText = 'FUT: CONTANGO';
  if (isFullInv) {
    badgeClass = 'bg-red-950/90 text-red-300 border border-red-700 animate-pulse font-bold';
    shortText = 'FUT: FULL BACKWARDATION';
  } else if (isFrontInv) {
    badgeClass = 'bg-amber-950/80 text-amber-300 border border-amber-800 font-bold';
    shortText = 'FUT: FRONT INVERTED';
  } else if (isBellyInv) {
    badgeClass = 'bg-rose-950/80 text-rose-300 border border-rose-800 font-bold';
    shortText = 'FUT: BELLY INVERTED';
  } else if (regime === 'FLATTENING') {
    badgeClass = 'bg-slate-800 text-amber-200 border border-slate-700 font-semibold';
    shortText = 'FUT: FLATTENING';
  }

  if (tagRegime) {
    tagRegime.textContent = shortText;
    tagRegime.className = `text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap ${badgeClass}`;
  }

  // Card 5 spreads subtitle
  const m1m2PctStr = (typeof vf.m1_m2_pct === 'number') ? `${vf.m1_m2_pct >= 0 ? '+' : ''}${vf.m1_m2_pct.toFixed(2)}%` : '-.--%';
  const m4m7PctStr = (typeof vf.m4_m7_pct === 'number') ? `${vf.m4_m7_pct >= 0 ? '+' : ''}${vf.m4_m7_pct.toFixed(2)}%` : '-.--%';
  if (lblSpreads) {
    lblSpreads.textContent = `M1/M2: ${m1m2PctStr}`;
    lblSpreads.className = `font-mono text-[10px] ${vf.is_front_inverted ? 'text-red-400 font-semibold' : 'text-slate-400'}`;
  }

  // Chart strip badge & spread
  if (chartBadge) {
    chartBadge.textContent = shortText;
    chartBadge.className = `text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded ${badgeClass}`;
    chartBadge.classList.remove('hidden');
  }
  if (chartSpread) {
    chartSpread.textContent = `M1/M2: ${m1m2PctStr} | M4/M7: ${m4m7PctStr}`;
    chartSpread.className = `text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700/80 ${vf.is_front_inverted ? 'text-red-300 font-semibold' : 'text-slate-300'}`;
    chartSpread.classList.remove('hidden');
  }

  // Popover Key Metrics Grid
  if (popBadge) {
    popBadge.textContent = regime;
    popBadge.className = `text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${badgeClass}`;
  }
  if (popM1M2) {
    popM1M2.textContent = m1m2PctStr;
    popM1M2.className = `text-xs font-bold font-mono ${vf.is_front_inverted ? 'text-red-400' : 'text-emerald-400'}`;
  }
  if (popM1M2Pts) {
    const diffStr = (typeof vf.m1_m2_diff === 'number') ? `${vf.m1_m2_diff >= 0 ? '+' : ''}${vf.m1_m2_diff.toFixed(2)} pts` : '-.-- pts';
    popM1M2Pts.textContent = diffStr;
  }
  if (popM4M7) {
    popM4M7.textContent = m4m7PctStr;
    popM4M7.className = `text-xs font-bold font-mono ${vf.is_mid_inverted ? 'text-rose-400' : 'text-emerald-400'}`;
  }
  if (popM4M7Pts) {
    const diff47Str = (typeof vf.m4_m7_diff === 'number') ? `${vf.m4_m7_diff >= 0 ? '+' : ''}${vf.m4_m7_diff.toFixed(2)} pts` : '-.-- pts';
    popM4M7Pts.textContent = diff47Str;
  }
  if (popSpotBasis) {
    const bStr = (typeof vf.spot_basis === 'number') ? `${vf.spot_basis >= 0 ? '+' : ''}${vf.spot_basis.toFixed(2)} pts` : '-.-- pts';
    popSpotBasis.textContent = bStr;
  }
  if (popInvPairs) {
    popInvPairs.textContent = `${vf.inv_count || 0} / ${vf.total_pairs || 0} Inverted`;
    popInvPairs.className = `text-[9px] font-mono ${vf.inv_count >= 3 ? 'text-red-400 font-bold' : 'text-slate-400'}`;
  }
  if (popDesc) {
    popDesc.textContent = vf.description || 'Evaluating VIX futures term structure...';
  }

  // Populate M1..M8 Term Structure Table
  if (popTableBody && Array.isArray(vf.contracts)) {
    popTableBody.innerHTML = vf.contracts.map((c, i) => {
      const diffVal = (typeof c.diff === 'number') ? c.diff : (typeof c.spread === 'number' ? c.spread : null);
      const isInv = Boolean(c.is_inverted) || (diffVal !== null && diffVal < -0.01);
      const isFlat = Boolean(c.is_flat) || (diffVal !== null && Math.abs(diffVal) <= 0.01);
      const isLast = (i === vf.contracts.length - 1);
      const spreadStr = (diffVal !== null) ? `${diffVal >= 0 ? '+' : ''}${diffVal.toFixed(2)}` : (isLast ? '—' : '-');
      const pctStr = (typeof c.contango_pct === 'number') ? `${c.contango_pct >= 0 ? '+' : ''}${c.contango_pct.toFixed(2)}%` : (isLast ? '—' : '-');
      const spreadColor = isLast ? 'text-slate-500' : (isInv ? 'text-red-400 font-bold' : (isFlat ? 'text-slate-400 font-medium' : 'text-emerald-400 font-semibold'));
      const rowBg = isInv ? 'bg-red-950/20' : (isFlat ? 'bg-slate-900/40' : '');
      const expStr = c.expiry && c.expiry.length >= 10 ? c.expiry.slice(5) : (c.expiry || '-');
      const dteStr = (c.dte !== null && c.dte !== undefined) ? `(${c.dte}d)` : '';

      return `
        <tr class="hover:bg-slate-800/40 transition ${rowBg}">
          <td class="py-1 px-1.5 font-bold ${isInv ? 'text-red-300' : (isFlat ? 'text-slate-300' : 'text-white')}">${c.tenor}</td>
          <td class="py-1 px-1 text-slate-300 whitespace-nowrap">${c.month_name} <span class="text-slate-500 text-[9px]">${c.symbol}</span></td>
          <td class="py-1 px-1 text-slate-400 whitespace-nowrap">${expStr} <span class="text-cyan-400 text-[9px]">${dteStr}</span></td>
          <td class="py-1 px-1 text-right text-white font-bold">${c.price !== null ? c.price.toFixed(2) : '-.--'}</td>
          <td class="py-1 px-1 text-right font-mono ${spreadColor}">${spreadStr}</td>
          <td class="py-1 px-1.5 text-right font-mono ${spreadColor}">${pctStr}</td>
        </tr>
      `;
    }).join('');
  }

  // Update curve chart if popover is open
  const popoverTs = document.getElementById('popover-vix-futures');
  if (popoverTs && !popoverTs.classList.contains('hidden')) {
    renderVixFuturesCurveChart(vf, spotVix);
  }
}

// ==============================================================================
// REAL-TIME UPDATE DISPATCHER
// ==============================================================================

function updateUI(data) {
  // If this is a live tick from WebSocket, track it
  if (!data.is_historical) {
    lastLiveUpdatePayload = data;

    // Detect session rollover, RTH open transition, GTH session transition, or periodic historical bar update
    if (currentViewMode === 'live') {
      const incomingDate = data.session_date;
      const incomingRth = data.is_rth_active;
      const incomingHistVer = data.hist_version;
      const incomingGthDate = data.gth ? data.gth.session_date : null;
      const incomingGthStatus = data.session_status;

      const sessionRolled = cachedActiveSessionDate && incomingDate && (incomingDate !== cachedActiveSessionDate);
      const rthOpened = (cachedIsRthActive === false && incomingRth === true);
      const gthRolled = Boolean(incomingGthDate && cachedGthSessionDate && incomingGthDate !== cachedGthSessionDate);
      const gthOpened = Boolean(cachedGthStatus && cachedGthStatus !== 'GTH_ACTIVE' && incomingGthStatus === 'GTH_ACTIVE');
      const histUpdated = (cachedHistVersion !== undefined && incomingHistVer !== undefined && incomingHistVer > cachedHistVersion);

      if (sessionRolled || rthOpened || gthRolled || gthOpened || histUpdated) {
        console.log(`[Auto-Sync] Triggering dashboard refresh: sessionRolled=${sessionRolled}, rthOpened=${rthOpened}, gthRolled=${gthRolled}, gthOpened=${gthOpened}, histUpdated=${histUpdated}`);
        cachedActiveSessionDate = incomingDate;
        cachedIsRthActive = incomingRth;
        if (incomingGthDate) cachedGthSessionDate = incomingGthDate;
        if (incomingGthStatus) cachedGthStatus = incomingGthStatus;
        if (incomingHistVer !== undefined) cachedHistVersion = incomingHistVer;
        bootstrapData();
        return;
      }
      if (incomingDate) cachedActiveSessionDate = incomingDate;
      if (incomingRth !== undefined) cachedIsRthActive = incomingRth;
      if (incomingGthDate) cachedGthSessionDate = incomingGthDate;
      if (incomingGthStatus) cachedGthStatus = incomingGthStatus;
      if (incomingHistVer !== undefined) cachedHistVersion = incomingHistVer;

      applyAutoGthDefault(data);
      updateGthToggleUI(data);
    }

    // When viewing a historical session archive, maintain connection pill status but preserve historical data on charts
    if (currentViewMode === 'historical') {
      const connPill = document.getElementById('connection-pill');
      const connText = document.getElementById('connection-text');
      if (data.connection && data.connection.connected) {
        connPill.className = "flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-950/70 text-emerald-400 border border-emerald-800/60";
        connText.textContent = `IBKR [Port ${data.connection.port}]`;
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
    connPill.className = "flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-950/70 text-emerald-400 border border-emerald-800/60";
    connText.textContent = `IBKR [Port ${data.connection.port}]`;
  } else {
    connPill.className = "flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-red-950/70 text-red-400 border border-red-800/60";
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

    lastOvervixSignal = ndxOv.is_overvixed;
    lastInversionSignal = ts.is_inverted;

  } else {
    // SPX Mode Confluence & Audio
    const gth = data.gth;
    const useGthBanner = (!data.is_historical && isGthEnabled && gth && (data.session_status === 'GTH_ACTIVE' || data.session_status === 'OVERNIGHT_ES_ONLY'));

    if (useGthBanner && data.session_status === 'GTH_ACTIVE') {
      const gOv = gth.overvix || {};
      const gConf = gth.confluence || {};
      if (gOv.is_overvixed) {
        confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-950/80 border border-amber-600 beacon-alert transition duration-300";
        confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-amber-500 text-black";
        confBadge.textContent = "⚠️ GTH OVERVIX TRIGGER";
        confDesc.textContent = gConf.description || `GTH Spot-Vol Shock: VIX is ${fmtPts(gOv.residual_pts)} pts above expected trendline.`;
      } else {
        confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-indigo-950/40 border border-indigo-700/70 transition duration-300";
        confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-indigo-600 text-white";
        confBadge.textContent = "🌐 GTH LIVE (ES+VIX)";
        confDesc.textContent = gConf.description || "Extended-hours Spot-Vol monitoring live via basis-adjusted ES futures & Spot VIX.";
      }
      lastOvervixSignal = Boolean(gOv.is_overvixed);
      lastInversionSignal = false;
    } else if (useGthBanner && data.session_status === 'OVERNIGHT_ES_ONLY') {
      const gConf = gth.confluence || {};
      confBanner.className = "flex items-center justify-between px-4 py-2.5 rounded-lg bg-slate-900 border border-amber-800/60 transition duration-300";
      confBadge.className = "px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider bg-amber-950 text-amber-300 border border-amber-700/70";
      confBadge.textContent = `🌙 OVERNIGHT ES LIVE | VIX @ ${gth.vix_opens_at || '03:15 ET'}`;
      confDesc.textContent = gConf.description || `Synthetic SPX live via ${gth.es_symbol || 'ES'}. Overvix residual calculations paused while Spot VIX is closed.`;
      lastOvervixSignal = false;
      lastInversionSignal = false;
    } else if (conf.is_dual_alert) {
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

    if (!useGthBanner) {
      lastOvervixSignal = ov.is_overvixed;
      lastInversionSignal = ts.is_inverted;
    }
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
    document.getElementById('tag-kpi-asset').textContent = "Index";
    document.getElementById('kpi-spx-price').textContent = fmtNum(ndxMkt.current);
    spxPctEl.textContent = fmtPct(ndxMkt.pct_change);
    spxPctEl.className = `text-xs font-mono font-medium mt-0.5 ${ndxMkt.pct_change >= 0 ? 'text-emerald-400' : 'text-red-400'}`;
    const spxSubElNdx = document.getElementById('kpi-spx-sub');
    if (spxSubElNdx) spxSubElNdx.classList.add('hidden');

    document.getElementById('lbl-kpi-vol').textContent = "VXN (30-Day)";
    document.getElementById('tag-kpi-vol').textContent = "Spot";
    document.getElementById('kpi-vix-price').textContent = fmtNum(ndxMkt.vxn ? ndxMkt.vxn.current : 0);
    const vxnPt = ndxMkt.vxn ? ndxMkt.vxn.pt_change : 0;
    vixPtEl.textContent = `${fmtPts(vxnPt)} pts`;
    vixPtEl.className = `text-xs font-mono font-medium mt-0.5 ${vxnPt >= 0 ? 'text-red-400' : 'text-emerald-400'}`;
    const vixSubElNdx = document.getElementById('kpi-vix-sub');
    if (vixSubElNdx) vixSubElNdx.classList.add('hidden');

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

    const expLblNdx = document.getElementById('lbl-kpi-expected');
    if (expLblNdx) expLblNdx.textContent = "Exp Δ";
    const expVixNdx = document.getElementById('kpi-expected-vix');
    if (expVixNdx) expVixNdx.textContent = `${fmtPts(ndxOv.expected_vol_pt)} pts`;
    const expSubNdx = document.getElementById('lbl-kpi-exp-sub');
    if (expSubNdx) expSubNdx.textContent = "Tech Beta Model";

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
    const gth = data.gth;
    const useGthKpi = (!data.is_historical && isGthEnabled && gth && (data.session_status === 'GTH_ACTIVE' || data.session_status === 'OVERNIGHT_ES_ONLY'));
    const spxSubEl = document.getElementById('kpi-spx-sub');
    const vixSubEl = document.getElementById('kpi-vix-sub');
    const tagAssetEl = document.getElementById('tag-kpi-asset');
    const tagVolEl = document.getElementById('tag-kpi-vol');
    const tagSecVolEl = document.getElementById('tag-kpi-sec-vol');

    if (useGthKpi) {
      document.getElementById('lbl-kpi-asset').textContent = "SPX (ES Adj)";
      if (tagAssetEl) tagAssetEl.textContent = `${gth.es_symbol || 'ES'} Synth`;
      document.getElementById('kpi-spx-price').textContent = fmtNum(gth.synthetic_spx);
      spxPctEl.textContent = fmtPct(gth.spx_pct_change);
      spxPctEl.className = `text-xs font-mono font-medium mt-0.5 ${gth.spx_pct_change >= 0 ? 'text-emerald-400' : 'text-red-400'}`;
      if (spxSubEl && gth.es_price !== null && gth.basis !== null) {
        const bSign = gth.basis >= 0 ? '+' : '';
        spxSubEl.textContent = `${gth.es_symbol || 'ES'}: ${fmtNum(gth.es_price)} | Basis: ${bSign}${fmtNum(gth.basis)}`;
        spxSubEl.classList.remove('hidden');
      }

      document.getElementById('lbl-kpi-vol').textContent = "VIX (30-Day)";
      document.getElementById('kpi-vix-price').textContent = fmtNum(gth.vix);
      if (data.session_status === 'GTH_ACTIVE') {
        if (tagVolEl) tagVolEl.textContent = "GTH Live";
        vixPtEl.textContent = `${fmtPts(gth.vix_pt_change)} pts`;
        vixPtEl.className = `text-xs font-mono font-medium mt-0.5 ${gth.vix_pt_change >= 0 ? 'text-red-400' : 'text-emerald-400'}`;
        if (vixSubEl) {
          vixSubEl.textContent = "CBOE Extended Hours";
          vixSubEl.className = "text-[10px] font-mono text-indigo-300/80 mt-0.5";
          vixSubEl.classList.remove('hidden');
        }
      } else {
        if (tagVolEl) tagVolEl.textContent = "Closed";
        vixPtEl.textContent = "0.00 pts (Close)";
        vixPtEl.className = "text-xs font-mono font-medium mt-0.5 text-slate-400";
        if (vixSubEl) {
          vixSubEl.textContent = `CLOSED (Opens ${gth.vix_opens_at || '03:15 ET'})`;
          vixSubEl.className = "text-[10px] font-mono text-amber-300/90 mt-0.5";
          vixSubEl.classList.remove('hidden');
        }
      }

      document.getElementById('lbl-kpi-sec-vol').textContent = "VIX3M (90-Day)";
      if (tagSecVolEl) tagSecVolEl.textContent = "3M (RTH Close)";
    } else {
      document.getElementById('lbl-kpi-asset').textContent = "SPX 500";
      if (tagAssetEl) tagAssetEl.textContent = "Index";
      document.getElementById('kpi-spx-price').textContent = fmtNum(mkt.spx.current);
      spxPctEl.textContent = fmtPct(mkt.spx.pct_change);
      spxPctEl.className = `text-xs font-mono font-medium mt-0.5 ${mkt.spx.pct_change >= 0 ? 'text-emerald-400' : 'text-red-400'}`;
      if (spxSubEl) spxSubEl.classList.add('hidden');

      document.getElementById('lbl-kpi-vol').textContent = "VIX (30-Day)";
      if (tagVolEl) tagVolEl.textContent = "Spot";
      document.getElementById('kpi-vix-price').textContent = fmtNum(mkt.vix.current);
      vixPtEl.textContent = `${fmtPts(mkt.vix.pt_change)} pts`;
      vixPtEl.className = `text-xs font-mono font-medium mt-0.5 ${mkt.vix.pt_change >= 0 ? 'text-red-400' : 'text-emerald-400'}`;
      if (vixSubEl) vixSubEl.classList.add('hidden');

      document.getElementById('lbl-kpi-sec-vol').textContent = "VIX3M (90-Day)";
      if (tagSecVolEl) tagSecVolEl.textContent = "3M";
    }

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

    const activeMod = (useGthKpi && gth.model) ? gth.model : mod;
    if (useGthKpi && data.session_status === 'OVERNIGHT_ES_ONLY') {
      const expLblGth = document.getElementById('lbl-kpi-expected');
      if (expLblGth) expLblGth.textContent = "Exp Δ";
      const expVixGth = document.getElementById('kpi-expected-vix');
      if (expVixGth) expVixGth.textContent = "--.-- pts";
      const expSubGth = document.getElementById('lbl-kpi-exp-sub');
      if (expSubGth) expSubGth.textContent = `VIX @ ${gth.vix_opens_at || '03:15 ET'}`;

      document.getElementById('lbl-kpi-residual').textContent = "Overvix Residual";
      residualEl.textContent = "PAUSED";
      residualEl.className = 'text-xl font-bold font-mono tracking-tight text-amber-300';
      overvixStatusBadge.textContent = 'VIX CLOSED';
      overvixStatusBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-800/60 font-semibold uppercase';
      cardOvervix.className = 'bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm';
    } else {
      const activeOv = (useGthKpi && gth.overvix && gth.overvix.residual_pts !== null) ? gth.overvix : ov;
      const expLblSpx = document.getElementById('lbl-kpi-expected');
      if (expLblSpx) expLblSpx.textContent = "Exp Δ";
      const expVixSpx = document.getElementById('kpi-expected-vix');
      if (expVixSpx) expVixSpx.textContent = `${fmtPts(activeOv.expected_vix_pt)} pts`;
      const expSubSpx = document.getElementById('lbl-kpi-exp-sub');
      if (expSubSpx) expSubSpx.textContent = useGthKpi ? "GTH Spot-Vol Model" : "Spot-Vol Model";

      document.getElementById('lbl-kpi-residual').textContent = "Overvix Residual";
      residualEl.textContent = `${fmtPts(activeOv.residual_pts)} pts`;
      if (activeOv.is_overvixed) {
        residualEl.className = 'text-xl font-bold font-mono tracking-tight text-red-500 animate-pulse';
        overvixStatusBadge.textContent = '🚨 OVERVIXED';
        overvixStatusBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-red-950 text-red-300 border border-red-700 font-bold uppercase';
        cardOvervix.className = 'bg-red-950/30 border border-red-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm';
      } else {
        residualEl.className = useGthKpi ? 'text-xl font-bold font-mono tracking-tight text-indigo-300' : 'text-xl font-bold font-mono tracking-tight text-cyan-400';
        overvixStatusBadge.textContent = useGthKpi ? 'GTH NORMAL' : 'NORMAL';
        overvixStatusBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold uppercase';
        cardOvervix.className = 'bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm';
      }
    }

    const spxThresh = (activeMod && activeMod.threshold_pts) || currentSpxThreshold;
    const dispThreshSpxEl = document.getElementById('disp-thresh-pts');
    if (dispThreshSpxEl) dispThreshSpxEl.textContent = spxThresh.toFixed(1);

    // Model Parameters Strip (SPX)
    document.getElementById('param-window').textContent = activeMod.window_days;
    document.getElementById('param-r2').textContent = fmtNum(activeMod.r_squared, 4);
    document.getElementById('param-slope').textContent = fmtNum(activeMod.slope, 4);
    document.getElementById('param-volslope').textContent = fmtNum(activeMod.vol_slope, 4);
    document.getElementById('param-intercept').textContent = fmtNum(activeMod.intercept, 4);
  }

  // Card 5: COR1M (1-Month Implied Correlation)
  const cor1mData = data.cor1m;
  const cardCor1m = document.getElementById('card-cor1m');
  const cor1mValEl = document.getElementById('kpi-cor1m-val');
  const tagCor1m = document.getElementById('tag-cor1m-regime');
  const subCor1m = document.getElementById('lbl-cor1m-sub');

  if (cor1mValEl && tagCor1m) {
    if (cor1mData && cor1mData.current !== null && cor1mData.current !== undefined) {
      cor1mValEl.textContent = fmtNum(cor1mData.current, 2);
      tagCor1m.textContent = cor1mData.badge || cor1mData.regime || 'NORMAL';

      if (cor1mData.is_coiled || cor1mData.current < 8.0) {
        if (cardCor1m) cardCor1m.className = 'bg-purple-950/30 border border-purple-500 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition animate-pulse';
        tagCor1m.className = 'text-[10px] px-1.5 py-0.5 rounded bg-purple-900 text-purple-200 border border-purple-400 font-bold uppercase animate-pulse';
        cor1mValEl.className = 'text-xl font-bold font-mono tracking-tight text-purple-300';
        if (subCor1m) subCor1m.textContent = 'Coiled Dispersion (< 8.0)';
      } else if (cor1mData.current < 15.0) {
        if (cardCor1m) cardCor1m.className = 'bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition';
        tagCor1m.className = 'text-[10px] px-1.5 py-0.5 rounded bg-purple-950/70 text-purple-300 border border-purple-800/60 font-semibold uppercase';
        cor1mValEl.className = 'text-xl font-bold font-mono tracking-tight text-purple-300';
        if (subCor1m) subCor1m.textContent = 'Low Correlation (< 15.0)';
      } else if (cor1mData.current > 45.0) {
        if (cardCor1m) cardCor1m.className = 'bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition';
        tagCor1m.className = 'text-[10px] px-1.5 py-0.5 rounded bg-blue-950/70 text-blue-300 border border-blue-800/60 font-semibold uppercase';
        cor1mValEl.className = 'text-xl font-bold font-mono tracking-tight text-blue-300';
        if (subCor1m) subCor1m.textContent = 'Macro Sync (> 45.0)';
      } else {
        if (cardCor1m) cardCor1m.className = 'bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition';
        tagCor1m.className = 'text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 uppercase font-semibold';
        cor1mValEl.className = 'text-xl font-bold font-mono tracking-tight text-purple-300';
        if (subCor1m) subCor1m.textContent = 'Dispersion @ < 8.0';
      }
    } else {
      cor1mValEl.textContent = '--.--';
      tagCor1m.textContent = '---';
      tagCor1m.className = 'text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase font-semibold';
      if (cardCor1m) cardCor1m.className = 'bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition';
      if (subCor1m) subCor1m.textContent = 'Dispersion @ < 8.0';
    }
  }

  // Update VIX Futures Term Structure Badges & Popover
  if (data.vix_futures) {
    const spotVixVal = (typeof data.vix_futures.spot_vix === 'number' && data.vix_futures.spot_vix > 0)
      ? data.vix_futures.spot_vix
      : ((data.session_status === 'GTH_ACTIVE' && data.gth && typeof data.gth.vix === 'number' && data.gth.vix > 0)
        ? data.gth.vix
        : (mkt && mkt.vix ? mkt.vix.current : null));
    updateVixFuturesUI(data.vix_futures, spotVixVal);
  }

  // Update Card 2 Fair VIX sub-line & Fair VIX Popover
  updateFairVixUI(data);

  // Card 7: 25Δ Risk Reversal (Put Skew)
  const rrData = (isNdx && ndx && ndx.risk_reversal) ? ndx.risk_reversal : data.risk_reversal;
  const cardRr = document.getElementById('card-rr25');
  const lblRr = document.getElementById('lbl-kpi-rr');
  const rrValEl = document.getElementById('kpi-rr-val');
  const tagRr = document.getElementById('tag-rr-regime');
  const matRr = document.getElementById('lbl-rr-mat');
  const subRr = document.getElementById('lbl-rr-sub');

  if (lblRr) lblRr.textContent = isNdx ? "QQQ 25Δ Skew (RR)" : "SPX 25Δ Skew (RR)";

  if (matRr) {
    if (rrData && rrData.expiration) {
      matRr.textContent = `Exp: ${fmtMaturity(rrData.expiration, rrData.dte)}`;
    } else if (rrData && rrData.dte) {
      matRr.textContent = `Exp: ~${rrData.dte}d`;
    } else {
      matRr.textContent = `Exp: ~30d`;
    }
  }

  if (rrValEl && tagRr) {
    if (rrData && rrData.current !== null && rrData.current !== undefined) {
      const rrVal = rrData.current;
      rrValEl.textContent = `${fmtPts(rrVal)} pts`;
      tagRr.textContent = rrData.badge || rrData.regime || '---';

      // Subtitle: Strike Selection & Volatility Info (or P / C IVs)
      if (rrData.call_strike && rrData.put_strike && rrData.call_iv && rrData.put_iv) {
        subRr.textContent = `C${rrData.call_strike}: ${fmtNum(rrData.call_iv, 1)}% · P${rrData.put_strike}: ${fmtNum(rrData.put_iv, 1)}%`;
      } else if (rrData.put_iv !== null && rrData.call_iv !== null && rrData.put_iv !== undefined && rrData.call_iv !== undefined) {
        subRr.textContent = `P: ${fmtNum(rrData.put_iv, 1)}% · C: ${fmtNum(rrData.call_iv, 1)}%`;
      } else if (subRr) {
        subRr.textContent = 'Put IV − Call IV';
      }

      // Detailed readable popup formatting (both for title tooltip and floating popover card)
      const assetName = isNdx ? "QQQ" : "SPX";
      const matStr = rrData.expiration ? fmtMaturity(rrData.expiration, null) : '-- --- \'--';
      const dteStr = `${rrData.dte || 30} DTE`;
      const cStr = rrData.call_strike ? `${rrData.call_strike}C` : 'Call';
      const pStr = rrData.put_strike ? `${rrData.put_strike}P` : 'Put';
      const cMidStr = (rrData.call_mid !== undefined && rrData.call_mid !== null) ? `$${fmtNum(rrData.call_mid, 2)}` : '$--.--';
      const pMidStr = (rrData.put_mid !== undefined && rrData.put_mid !== null) ? `$${fmtNum(rrData.put_mid, 2)}` : '$--.--';
      const cIvStr = (rrData.call_iv !== null && rrData.call_iv !== undefined) ? `${fmtNum(rrData.call_iv, 1)}%` : '--.-%';
      const pIvStr = (rrData.put_iv !== null && rrData.put_iv !== undefined) ? `${fmtNum(rrData.put_iv, 1)}%` : '--.-%';
      const cDeltaStr = (rrData.call_delta !== null && rrData.call_delta !== undefined) ? (rrData.call_delta >= 0 ? `+${fmtNum(rrData.call_delta, 3)}` : fmtNum(rrData.call_delta, 3)) : '+0.250';
      const pDeltaStr = (rrData.put_delta !== null && rrData.put_delta !== undefined) ? (rrData.put_delta >= 0 ? `+${fmtNum(rrData.put_delta, 3)}` : fmtNum(rrData.put_delta, 3)) : '-0.250';
      const skewValStr = `${fmtPts(rrVal)} pts`;

      if (cardRr) {
        cardRr.removeAttribute('title');
      }

      // Populate interactive Floating Popover Card
      const popTitle = document.getElementById('pop-rr25-title');
      const popBadge = document.getElementById('pop-rr25-badge');
      const popSkew = document.getElementById('pop-rr25-skew');
      const popStatus = document.getElementById('pop-rr25-status');
      const popMat = document.getElementById('pop-rr25-mat');
      const popDte = document.getElementById('pop-rr25-dte');
      const popSpread = document.getElementById('pop-rr25-spread');
      const popCallStrike = document.getElementById('pop-rr25-call-strike');
      const popCallMid = document.getElementById('pop-rr25-call-mid');
      const popCallIv = document.getElementById('pop-rr25-call-iv');
      const popCallDelta = document.getElementById('pop-rr25-call-delta');
      const popPutStrike = document.getElementById('pop-rr25-put-strike');
      const popPutMid = document.getElementById('pop-rr25-put-mid');
      const popPutIv = document.getElementById('pop-rr25-put-iv');
      const popPutDelta = document.getElementById('pop-rr25-put-delta');
      const popDesc = document.getElementById('pop-rr25-desc');

      if (popTitle) popTitle.innerHTML = `<span>⚖️</span><span>${assetName} 25Δ Risk Reversal</span>`;
      if (popBadge) {
        popBadge.textContent = rrData.badge || rrData.regime || '---';
        if (rrVal >= 8.0 || rrData.badge === 'EXTREME') {
          popBadge.className = 'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-red-900 text-red-200 border border-red-500 animate-pulse';
        } else if (rrVal >= 6.0 || rrData.badge === 'STEEP') {
          popBadge.className = 'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-amber-950/70 text-amber-300 border border-amber-800/60';
        } else {
          popBadge.className = 'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-slate-800 text-slate-300 border border-slate-700';
        }
      }

      // Populate Reference Spot Bar inside #popover-rr25
      const pop25RefLabel = document.getElementById('pop-rr25-ref-label');
      const pop25RefPrice = document.getElementById('pop-rr25-ref-price');
      const pop25RefBadge = document.getElementById('pop-rr25-ref-mode-badge');
      const pop25RefSub = document.getElementById('pop-rr25-ref-sub');

      if (pop25RefLabel) pop25RefLabel.textContent = isNdx ? "QQQ Ref" : "SPX Ref";
      if (pop25RefPrice) {
        if (rrData && rrData.ref_spot) {
          pop25RefPrice.textContent = fmtNum(rrData.ref_spot, 2);
        } else {
          pop25RefPrice.textContent = isNdx ? (data.ndx && data.ndx.market ? fmtNum(data.ndx.market.ndx_close / 41.0, 2) : '---.--')
                                            : (data.reference_closes && data.reference_closes.spx ? fmtNum(data.reference_closes.spx, 2) : '-,---.--');
        }
      }
      if (pop25RefBadge && pop25RefSub) {
        const mode = (rrData && rrData.ref_mode) || 'session_close';
        const timeStr = (rrData && rrData.ref_time) ? ` @ ${rrData.ref_time}` : '';
        if (mode === 'live_spot' || mode === 'spot') {
          pop25RefBadge.textContent = 'Live Spot';
          pop25RefBadge.className = 'text-[9px] px-1 py-0.2 rounded font-semibold bg-cyan-950 text-cyan-300 border border-cyan-700';
          pop25RefSub.textContent = `Recalibrated to live spot${timeStr}`;
          pop25RefSub.className = 'text-[9px] text-cyan-400 font-mono mt-0.5';
        } else {
          pop25RefBadge.textContent = 'Close';
          pop25RefBadge.className = 'text-[9px] px-1 py-0.2 rounded font-semibold bg-slate-800 text-slate-300 border border-slate-700';
          pop25RefSub.textContent = `Session close baseline${timeStr} (strikes fixed)`;
          pop25RefSub.className = 'text-[9px] text-slate-500 font-mono mt-0.5';
        }
      }

      if (popSkew) popSkew.textContent = `${fmtPts(rrVal)} pts`;
      if (popStatus) {
        popStatus.textContent = rrVal >= 7.5 ? 'ELEVATED SKEW (Fear)' : (rrVal < 3.5 ? 'COMPLACENT (Low Skew)' : 'NORMAL SKEW');
      }
      if (popMat) popMat.textContent = matStr;
      if (popDte) popDte.textContent = `${dteStr} (~30d)`;
      if (popSpread) {
        if (rrData.net_credit !== undefined && rrData.net_credit !== null) {
          const sign = rrData.net_credit >= 0 ? '+' : '';
          popSpread.textContent = `Combo Mid: ${sign}$${fmtNum(rrData.net_credit, 2)}`;
        } else {
          popSpread.textContent = `Skew: ${fmtPts(rrVal)} pts`;
        }
      }

      if (popCallStrike) popCallStrike.textContent = cStr;
      if (popCallMid) popCallMid.textContent = cMidStr;
      if (popCallIv) popCallIv.textContent = cIvStr;
      if (popCallDelta) popCallDelta.textContent = cDeltaStr;

      if (popPutStrike) popPutStrike.textContent = pStr;
      if (popPutMid) popPutMid.textContent = pMidStr;
      if (popPutIv) popPutIv.textContent = pIvStr;
      if (popPutDelta) popPutDelta.textContent = pDeltaStr;

      if (popDesc) {
        if (rrVal >= 7.5) {
          popDesc.textContent = `25Δ Put IV exceeds Call IV by ${fmtNum(rrVal, 1)} pts. Elevated institutional downside tail hedging demand detected.`;
        } else if (rrVal < 3.5) {
          popDesc.textContent = `25Δ Put IV is compressed relative to Call IV (+${fmtNum(rrVal, 1)} pts). Market exhibits low hedging demand / complacency.`;
        } else {
          popDesc.textContent = `Standard 25Δ downside skew (+${fmtNum(rrVal, 1)} pts). Healthy baseline pricing for 30-day index options.`;
        }
      }

      // Card styling preserving relative group cursor-pointer select-none
      if (rrVal >= 8.0 || rrData.badge === 'EXTREME') {
        if (cardRr) cardRr.className = 'relative group bg-red-950/30 border border-red-700 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition cursor-pointer select-none';
        tagRr.className = 'text-[10px] px-1.5 py-0.5 rounded bg-red-900 text-red-200 border border-red-500 font-bold uppercase animate-pulse';
        rrValEl.className = 'text-xl font-bold font-mono tracking-tight text-red-400';
      } else if (rrVal >= 6.0 || rrData.badge === 'STEEP') {
        if (cardRr) cardRr.className = 'relative group bg-amber-950/20 border border-amber-800/80 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition cursor-pointer select-none';
        tagRr.className = 'text-[10px] px-1.5 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-800/60 font-semibold uppercase';
        rrValEl.className = 'text-xl font-bold font-mono tracking-tight text-amber-300';
      } else {
        if (cardRr) cardRr.className = 'relative group bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition cursor-pointer select-none';
        tagRr.className = 'text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold uppercase';
        rrValEl.className = 'text-xl font-bold font-mono tracking-tight text-emerald-400';
      }
    } else {
      rrValEl.textContent = '--.-- pts';
      tagRr.textContent = '---';
      tagRr.className = 'text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase font-semibold';
      if (cardRr) {
        cardRr.className = 'relative group bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition cursor-pointer select-none';
        cardRr.removeAttribute('title');
      }
      if (subRr) subRr.textContent = 'Put IV − Call IV';
    }
  }

  // Card 8: 4M Wing Skew / OTM Risk Reversal (10% C vs 15% P)
  const rr4mData = (isNdx && ndx && ndx.rr_4m) ? ndx.rr_4m : data.rr_4m;
  const cardRr4m = document.getElementById('card-rr4m');
  const lblRr4m = document.getElementById('lbl-kpi-rr4m');
  const rr4mValEl = document.getElementById('kpi-rr4m-val');
  const tagRr4m = document.getElementById('tag-rr4m-regime');
  const matRr4m = document.getElementById('lbl-rr4m-mat');
  const subRr4m = document.getElementById('lbl-rr4m-sub');

  if (lblRr4m) lblRr4m.textContent = isNdx ? "QQQ 4M Skew (RR)" : "SPX 4M Skew (RR)";

  if (matRr4m) {
    const expStr = (rr4mData && rr4mData.expiration) ? fmtMaturity(rr4mData.expiration, rr4mData.dte) : (rr4mData && rr4mData.dte ? `~${rr4mData.dte}d` : `~120d`);
    let crStr = '';
    if (rr4mData && rr4mData.net_credit !== null && rr4mData.net_credit !== undefined) {
      const crVal = rr4mData.net_credit;
      const isCredit = crVal >= 0;
      if (isNdx) {
        crStr = ` · ${isCredit ? '+' : ''}$${fmtNum(crVal, 2)} ${isCredit ? 'CR' : 'DB'}`;
      } else {
        crStr = ` · ${isCredit ? '+' : ''}${fmtNum(crVal, 1)}pt ${isCredit ? 'CR' : 'DB'}`;
      }
    }
    matRr4m.textContent = `Exp: ${expStr}${crStr}`;
  }

  if (rr4mValEl && tagRr4m) {
    if (rr4mData && (rr4mData.iv_skew !== null || rr4mData.net_credit !== null)) {
      const crVal = rr4mData.net_credit !== undefined ? rr4mData.net_credit : 0;
      const isCredit = crVal >= 0;

      // Main KPI value: Wing IV Skew (Put IV - Call IV)
      // Displays structural smile steepness in IV points, completely stable across spot moves
      if (rr4mData.iv_skew !== null && rr4mData.iv_skew !== undefined) {
        const skewSign = rr4mData.iv_skew >= 0 ? '+' : '';
        rr4mValEl.textContent = `${skewSign}${fmtNum(rr4mData.iv_skew, 2)} pts`;
      } else if (crVal !== null && crVal !== undefined) {
        rr4mValEl.textContent = `${fmtPts(crVal)} pts ${isCredit ? 'CR' : 'DB'}`;
      } else {
        rr4mValEl.textContent = '--.-- pts';
      }
      tagRr4m.textContent = rr4mData.badge || rr4mData.regime || '---';

      // Subtitle: Strike Selection, Volatilities & Ratio
      if (rr4mData.call_strike && rr4mData.put_strike) {
        const cIvStr = (rr4mData.call_iv !== null && rr4mData.call_iv !== undefined) ? `${fmtNum(rr4mData.call_iv, 1)}%` : '--.-%';
        const pIvStr = (rr4mData.put_iv !== null && rr4mData.put_iv !== undefined) ? `${fmtNum(rr4mData.put_iv, 1)}%` : '--.-%';
        const ratioStr = rr4mData.skew_ratio ? ` (${fmtNum(rr4mData.skew_ratio, 2)}x ratio)` : '';
        subRr4m.textContent = `C${rr4mData.call_strike}: ${cIvStr} · P${rr4mData.put_strike}: ${pIvStr}${ratioStr}`;
        subRr4m.title = `Call ${rr4mData.call_strike} IV: ${cIvStr} | Put ${rr4mData.put_strike} IV: ${pIvStr} | Wing Skew: ${rr4mData.iv_skew ? (rr4mData.iv_skew >= 0 ? '+' : '') + fmtNum(rr4mData.iv_skew, 2) + ' pts' : '--'}${rr4mData.skew_ratio ? ' (' + fmtNum(rr4mData.skew_ratio, 2) + 'x ratio)' : ''}`;
      } else if (subRr4m) {
        subRr4m.textContent = '10%C vs 15%P (4M)';
      }

      // Detailed readable popup formatting (both for title tooltip and floating popover card)
      const assetName = isNdx ? "QQQ" : "SPX";
      const multiplier = 100;
      const cashVal = Math.abs(crVal * multiplier);
      const cashStr = `${isCredit ? '+' : '-'}$${cashVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const matStr = rr4mData.expiration ? fmtMaturity(rr4mData.expiration, null) : '-- --- \'--';
      const dteStr = `${rr4mData.dte || 120} DTE`;
      const cStr = rr4mData.call_strike ? `${rr4mData.call_strike}C` : 'Call';
      const pStr = rr4mData.put_strike ? `${rr4mData.put_strike}P` : 'Put';
      const cMidStr = (rr4mData.call_mid !== undefined && rr4mData.call_mid !== null) ? `$${fmtNum(rr4mData.call_mid, 2)}` : '$--.--';
      const pMidStr = (rr4mData.put_mid !== undefined && rr4mData.put_mid !== null) ? `$${fmtNum(rr4mData.put_mid, 2)}` : '$--.--';
      const cIvStr = (rr4mData.call_iv !== null && rr4mData.call_iv !== undefined) ? `${fmtNum(rr4mData.call_iv, 1)}%` : '--.-%';
      const pIvStr = (rr4mData.put_iv !== null && rr4mData.put_iv !== undefined) ? `${fmtNum(rr4mData.put_iv, 1)}%` : '--.-%';
      const cDeltaStr = (rr4mData.call_delta !== null && rr4mData.call_delta !== undefined) ? (rr4mData.call_delta >= 0 ? `+${fmtNum(rr4mData.call_delta, 3)}` : fmtNum(rr4mData.call_delta, 3)) : '--';
      const pDeltaStr = (rr4mData.put_delta !== null && rr4mData.put_delta !== undefined) ? (rr4mData.put_delta >= 0 ? `+${fmtNum(rr4mData.put_delta, 3)}` : fmtNum(rr4mData.put_delta, 3)) : '--';
      const skewStr = (rr4mData.iv_skew !== null && rr4mData.iv_skew !== undefined) ? `${fmtPts(rr4mData.iv_skew)} pts` : '-- pts';

      if (cardRr4m) {
        cardRr4m.removeAttribute('title');
      }

      // Populate interactive Floating Popover Card
      const popTitle = document.getElementById('pop-rr4m-title');
      const popBadge = document.getElementById('pop-rr4m-badge');
      const popCredit = document.getElementById('pop-rr4m-credit');
      const popCash = document.getElementById('pop-rr4m-cash');
      const popSkewMetric = document.getElementById('pop-rr4m-skew-metric');
      const popSkewRatio = document.getElementById('pop-rr4m-skew-ratio');
      const popBuffer = document.getElementById('pop-rr4m-buffer');
      const popBufferStrike = document.getElementById('pop-rr4m-buffer-strike');
      const popMat = document.getElementById('pop-rr4m-mat');
      const popDte = document.getElementById('pop-rr4m-dte');
      const popSkew = document.getElementById('pop-rr4m-skew');
      const popCallStrike = document.getElementById('pop-rr4m-call-strike');
      const popCallMid = document.getElementById('pop-rr4m-call-mid');
      const popCallIv = document.getElementById('pop-rr4m-call-iv');
      const popCallDelta = document.getElementById('pop-rr4m-call-delta');
      const popPutStrike = document.getElementById('pop-rr4m-put-strike');
      const popPutMid = document.getElementById('pop-rr4m-put-mid');
      const popPutIv = document.getElementById('pop-rr4m-put-iv');
      const popPutDelta = document.getElementById('pop-rr4m-put-delta');
      const popDesc = document.getElementById('pop-rr4m-desc');

      const skewVal = rr4mData.iv_skew;
      const ratioVal = rr4mData.skew_ratio;

      // Statistical Skew Regimes for 4M Wing Skew (~120 DTE, similar to 25Δ Skew stats):
      // Extreme >= 12.0 pts (or ratio >= 1.65x)
      // Elevated >= 8.5 pts (or ratio >= 1.45x)
      // Complacent < 4.5 pts (or ratio < 1.30x)
      // Normal: 4.5 to 8.5 pts
      const isExtreme = (rr4mData.regime === 'EXTREME' || rr4mData.badge === 'EXTREME SKEW' || (skewVal !== null && skewVal >= 12.0) || (ratioVal && ratioVal >= 1.65));
      const isElevated = !isExtreme && (rr4mData.regime === 'ELEVATED' || rr4mData.badge === 'ELEVATED SKEW' || (skewVal !== null && skewVal >= 8.5) || (ratioVal && ratioVal >= 1.45));
      const isComplacent = !isExtreme && !isElevated && (rr4mData.regime === 'COMPLACENT' || (skewVal !== null && skewVal < 4.5) || (ratioVal && ratioVal < 1.30));

      if (popTitle) popTitle.innerHTML = `<span>🦅</span><span>${assetName} 4M Wing Risk Reversal</span>`;
      if (popBadge) {
        popBadge.textContent = rr4mData.badge || rr4mData.regime || 'NORMAL';
        if (isExtreme) {
          popBadge.className = 'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-purple-900 text-purple-200 border border-purple-500 animate-pulse';
        } else if (isElevated) {
          popBadge.className = 'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-emerald-900/90 text-emerald-200 border border-emerald-500';
        } else if (isComplacent) {
          popBadge.className = 'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-cyan-950/70 text-cyan-300 border border-cyan-800/60';
        } else {
          popBadge.className = 'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase bg-slate-800 text-slate-300 border border-slate-700';
        }
      }
      if (popCredit) {
        popCredit.textContent = `${isCredit ? '+' : ''}${fmtNum(crVal, 2)} pts ${isCredit ? 'CR' : 'DB'}`;
        popCredit.className = isCredit ? 'text-sm font-bold font-mono text-emerald-400' : 'text-sm font-bold font-mono text-slate-300';
      }
      if (popCash) popCash.textContent = `(${cashStr} / 1-lot)`;

      // Populate Reference Spot Bar inside #popover-rr4m
      const popRefLabel = document.getElementById('pop-rr4m-ref-label');
      const popRefPrice = document.getElementById('pop-rr4m-ref-price');
      const popRefBadge = document.getElementById('pop-rr4m-ref-mode-badge');
      const popRefSub = document.getElementById('pop-rr4m-ref-sub');

      if (popRefLabel) popRefLabel.textContent = isNdx ? "QQQ Ref" : "SPX Ref";
      if (popRefPrice) {
        if (rr4mData && rr4mData.ref_spot) {
          popRefPrice.textContent = fmtNum(rr4mData.ref_spot, 2);
        } else {
          popRefPrice.textContent = isNdx ? (data.ndx && data.ndx.market ? fmtNum(data.ndx.market.ndx_close / 41.0, 2) : '---.--')
                                          : (data.reference_closes && data.reference_closes.spx ? fmtNum(data.reference_closes.spx, 2) : '-,---.--');
        }
      }
      if (popRefBadge && popRefSub) {
        const mode = (rr4mData && rr4mData.ref_mode) || 'session_close';
        const timeStr = (rr4mData && rr4mData.ref_time) ? ` @ ${rr4mData.ref_time}` : '';
        if (mode === 'live_spot' || mode === 'spot') {
          popRefBadge.textContent = 'Live Spot';
          popRefBadge.className = 'text-[9px] px-1 py-0.2 rounded font-semibold bg-cyan-950 text-cyan-300 border border-cyan-700';
          popRefSub.textContent = `Recalibrated to live spot${timeStr}`;
          popRefSub.className = 'text-[9px] text-cyan-400 font-mono mt-0.5';
        } else {
          popRefBadge.textContent = 'Close';
          popRefBadge.className = 'text-[9px] px-1 py-0.2 rounded font-semibold bg-slate-800 text-slate-300 border border-slate-700';
          popRefSub.textContent = `Session close baseline${timeStr} (strikes fixed)`;
          popRefSub.className = 'text-[9px] text-slate-500 font-mono mt-0.5';
        }
      }

      if (popSkewMetric) {
        const skewSign = (rr4mData.iv_skew !== null && rr4mData.iv_skew !== undefined && rr4mData.iv_skew >= 0) ? '+' : '';
        popSkewMetric.textContent = (rr4mData.iv_skew !== null && rr4mData.iv_skew !== undefined) ? `${skewSign}${fmtNum(rr4mData.iv_skew, 1)} pts` : '-- pts';
      }
      if (popSkewRatio) {
        popSkewRatio.textContent = rr4mData.skew_ratio ? `${fmtNum(rr4mData.skew_ratio, 2)}x Skew Ratio` : 'Put/Call Skew';
      }
      if (popBuffer) {
        popBuffer.textContent = (rr4mData.put_buffer_pct !== null && rr4mData.put_buffer_pct !== undefined) ? `-${fmtNum(Math.abs(rr4mData.put_buffer_pct), 1)}% OTM` : '--.-% OTM';
      }
      if (popBufferStrike) {
        popBufferStrike.textContent = rr4mData.put_strike ? `Short Put P${rr4mData.put_strike}` : 'Short Put Wing';
      }

      if (popMat) popMat.textContent = matStr;
      if (popDte) popDte.textContent = `${dteStr} (~4M)`;
      if (popSkew) popSkew.textContent = `Skew: ${skewStr}`;

      if (popCallStrike) popCallStrike.textContent = cStr;
      if (popCallMid) popCallMid.textContent = cMidStr;
      if (popCallIv) popCallIv.textContent = cIvStr;
      if (popCallDelta) popCallDelta.textContent = cDeltaStr;

      if (popPutStrike) popPutStrike.textContent = pStr;
      if (popPutMid) popPutMid.textContent = pMidStr;
      if (popPutIv) popPutIv.textContent = pIvStr;
      if (popPutDelta) popPutDelta.textContent = pDeltaStr;

      if (popDesc) {
        if (skewVal !== null && skewVal !== undefined) {
          const ratioDesc = ratioVal ? ` (${fmtNum(ratioVal, 2)}x ratio)` : '';
          const bufferDesc = rr4mData.put_buffer_pct ? ` Short put is ${fmtNum(Math.abs(rr4mData.put_buffer_pct), 1)}% below spot.` : '';
          const crDesc = (rr4mData.net_credit !== null && rr4mData.net_credit !== undefined && rr4mData.net_credit > 0)
            ? ` Trade collects ${isNdx ? '$' + fmtNum(rr4mData.net_credit, 2) : fmtNum(rr4mData.net_credit, 1) + ' pts'} credit.`
            : '';
          if (isExtreme) {
            popDesc.textContent = `Extreme 4M Wing Skew (+${fmtNum(skewVal, 1)} pts${ratioDesc} ≥ 90th percentile). Downside put wing is severely dislocated vs calls.${crDesc}${bufferDesc}`;
          } else if (isElevated) {
            popDesc.textContent = `Elevated 4M Wing Skew (+${fmtNum(skewVal, 1)} pts${ratioDesc}). Downside put premium exceeds baseline, favoring upside financing.${crDesc}${bufferDesc}`;
          } else if (isComplacent) {
            popDesc.textContent = `Complacent 4M Wing Skew (+${fmtNum(skewVal, 1)} pts${ratioDesc}). Unusually flat downside curve indicating low institutional tail hedging demand.${bufferDesc}`;
          } else {
            popDesc.textContent = `Normal 4M Wing Skew (+${fmtNum(skewVal, 1)} pts${ratioDesc}). Standard structural term slope across ~120 DTE.${crDesc}${bufferDesc}`;
          }
        } else {
          popDesc.textContent = `Call & Put wings are monitored for asymmetric skew entry opportunities across ~120 DTE.`;
        }
      }

      // Card styling: preserving relative group cursor-pointer select-none
      if (isExtreme) {
        if (cardRr4m) cardRr4m.className = 'relative group bg-purple-950/40 border border-purple-500 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition cursor-pointer select-none';
        tagRr4m.className = 'text-[10px] px-1.5 py-0.5 rounded bg-purple-900 text-purple-200 border border-purple-500 font-bold uppercase animate-pulse';
        rr4mValEl.className = 'text-xl font-bold font-mono tracking-tight text-purple-300';
      } else if (isElevated) {
        if (cardRr4m) cardRr4m.className = 'relative group bg-emerald-950/30 border border-emerald-600 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition cursor-pointer select-none';
        tagRr4m.className = 'text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/90 text-emerald-200 border border-emerald-500 font-bold uppercase';
        rr4mValEl.className = 'text-xl font-bold font-mono tracking-tight text-emerald-300';
      } else if (isComplacent) {
        if (cardRr4m) cardRr4m.className = 'relative group bg-cyan-950/20 border border-cyan-800/80 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition cursor-pointer select-none';
        tagRr4m.className = 'text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 font-semibold uppercase';
        rr4mValEl.className = 'text-xl font-bold font-mono tracking-tight text-cyan-300';
      } else {
        if (cardRr4m) cardRr4m.className = 'relative group bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition cursor-pointer select-none';
        tagRr4m.className = 'text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold uppercase';
        rr4mValEl.className = 'text-xl font-bold font-mono tracking-tight text-slate-300';
      }
    } else {
      rr4mValEl.textContent = '--.-- pts';
      tagRr4m.textContent = '---';
      tagRr4m.className = 'text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase font-semibold';
      if (cardRr4m) {
        cardRr4m.className = 'relative group bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between shadow-sm transition cursor-pointer select-none';
        cardRr4m.removeAttribute('title');
      }
      if (subRr4m) subRr4m.textContent = '10%C vs 15%P (4M)';
    }
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
    if (corr.corr_10d !== undefined) cachedCorr.metrics['10D'] = corr.corr_10d;
    if (corr.corr_1y !== undefined) cachedCorr.metrics['1Y'] = corr.corr_1y;
  }
  if (data.gth && cachedCorrGth.metrics) {
    if (data.gth.rolling_corr !== undefined) cachedCorrGth.metrics['1D'] = data.gth.rolling_corr;
    if (data.gth.corr_5d !== undefined) cachedCorrGth.metrics['5D'] = data.gth.corr_5d;
    if (data.gth.corr_10d !== undefined) cachedCorrGth.metrics['10D'] = data.gth.corr_10d;
  }
  if (ndx && ndx.correlation && cachedCorrNdx.metrics) {
    cachedCorrNdx.metrics['1D'] = ndx.correlation.rolling_corr;
    if (ndx.correlation.corr_5d !== undefined) cachedCorrNdx.metrics['5D'] = ndx.correlation.corr_5d;
    if (ndx.correlation.corr_10d !== undefined) cachedCorrNdx.metrics['10D'] = ndx.correlation.corr_10d;
    if (ndx.correlation.corr_1y !== undefined) cachedCorrNdx.metrics['1Y'] = ndx.correlation.corr_1y;
  }

  // Update Overvix Residual Metric & Status Pill
  updateCorrMetricDisplay();

  // Time & Tags
  const now = new Date();
  const isGthUi = (!isNdx && isGthEnabled && data.gth && (data.session_status === 'GTH_ACTIVE' || data.session_status === 'OVERNIGHT_ES_ONLY'));
  if (data.is_historical) {
    document.getElementById('last-update-time').textContent = `Session: ${data.session_date}`;
  } else if (isGthUi && data.session_status === 'GTH_ACTIVE') {
    document.getElementById('last-update-time').textContent = `GTH Live: ${data.timestamp ? data.timestamp + ' ET' : now.toLocaleTimeString()} (RTH 09:30 ET)`;
  } else if (isGthUi && data.session_status === 'OVERNIGHT_ES_ONLY') {
    document.getElementById('last-update-time').textContent = `ES Live: ${data.timestamp ? data.timestamp + ' ET' : now.toLocaleTimeString()} | VIX @ ${data.gth.vix_opens_at || '03:15 ET'}`;
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
    } else if (!isNdx && isGthEnabled && data.session_status === 'GTH_ACTIVE') {
      headerModeBadge.textContent = "GTH Live (ES+VIX)";
      headerModeBadge.className = "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-950/90 text-indigo-300 border border-indigo-700/70 font-semibold";
    } else if (!isNdx && isGthEnabled && data.session_status === 'OVERNIGHT_ES_ONLY') {
      headerModeBadge.textContent = `Overnight ES (${data.gth ? (data.gth.es_symbol || 'ES') : 'ES'})`;
      headerModeBadge.className = "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 font-semibold";
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
  const isSpxGthLive = (!isNdx && isGthEnabled && data.session_status === 'GTH_ACTIVE' && data.gth && data.gth.current_point && data.gth.current_point.y !== null);
  const isOvernightEsLive = (!isNdx && isGthEnabled && data.session_status === 'OVERNIGHT_ES_ONLY' && data.gth && data.gth.current_point && typeof data.gth.current_point.x === 'number');
  const hasLiveSessionStarted = isSessionStarted(data, (!isNdx && isGthEnabled));
  const activePt = (isNdx && ndx && ndx.current_point)
    ? ndx.current_point
    : (isSpxGthLive ? data.gth.current_point : data.current_point);
  const isTargetOvervixed = (isNdx && ndx && ndx.overvix)
    ? ndx.overvix.is_overvixed
    : (isSpxGthLive && data.gth.overvix ? data.gth.overvix.is_overvixed : ov.is_overvixed);

  const ovChartEl = document.getElementById('overvix-chart');

  if (currentOvervixChartMode === 'fair') {
    const fvLive = getActiveFairVixPayload(data);
    if (fvLive && typeof fvLive.live_spot === 'number' && typeof fvLive.live_vol === 'number' && ovChartEl && ovChartEl.data && ovChartEl.data[5]) {
      Plotly.restyle('overvix-chart', {
        x: [[fvLive.live_spot]],
        y: [[fvLive.live_vol]]
      }, [5]);
      if (ovChartEl.data[6] && typeof fvLive.combined === 'number') {
        Plotly.restyle('overvix-chart', {
          x: [[fvLive.live_spot]],
          y: [[fvLive.combined]]
        }, [6]);
      }
    }
  } else if (!hasLiveSessionStarted) {
    if (ovChartEl && ovChartEl.data && ovChartEl.data[5] && ovChartEl.data[5].x && ovChartEl.data[5].x.length > 0) {
      Plotly.restyle('overvix-chart', {
        x: [[]],
        y: [[]],
        customdata: [[]],
        visible: [false],
        showlegend: [false]
      }, [5]);
    }
  } else if (isOvernightEsLive) {
    // Check OVERNIGHT_ES_ONLY before falling back to RTH data.current_point, which still holds non-null y
    const overlay = buildOvernightEsOverlay(data.gth);
    const nextAnn = overlay.annotations[0];
    const curAnn = ovChartEl && ovChartEl.layout && ovChartEl.layout.annotations ? ovChartEl.layout.annotations[0] : null;
    if (!curAnn || curAnn.x !== nextAnn.x || curAnn.text !== nextAnn.text) {
      Plotly.relayout('overvix-chart', {
        shapes: overlay.shapes,
        annotations: overlay.annotations
      });
    }

    // Pin Trace 5 (Session Close Point) to the tip of GTH trail
    const trailGth = (data.overvix && data.overvix.intraday_trail_gth && data.overvix.intraday_trail_gth.x && data.overvix.intraday_trail_gth.x.length > 0)
      ? data.overvix.intraday_trail_gth
      : ((cachedTrailGth && cachedTrailGth.x && cachedTrailGth.x.length > 0) ? cachedTrailGth : cachedTrail);

    if (trailGth && trailGth.x && trailGth.x.length > 0 && ovChartEl && ovChartEl.data && ovChartEl.data[5]) {
      const lastIdx = trailGth.x.length - 1;
      const lastX = trailGth.x[lastIdx];
      const lastY = trailGth.y[lastIdx];
      const rawSpot = (trailGth.spot_raw && trailGth.spot_raw[lastIdx] !== undefined)
        ? trailGth.spot_raw[lastIdx]
        : (data.market && data.market.spx ? data.market.spx.current : null);
      const rawVol = (trailGth.vol_raw && trailGth.vol_raw[lastIdx] !== undefined)
        ? trailGth.vol_raw[lastIdx]
        : (data.market && data.market.vix ? data.market.vix.current : null);
      const liveSpotStr = (typeof rawSpot === 'number' && !isNaN(rawSpot))
        ? rawSpot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : (rawSpot || '-');
      const liveVolStr = (typeof rawVol === 'number' && !isNaN(rawVol))
        ? rawVol.toFixed(2)
        : (rawVol || '-');

      const gthModel = (data.overvix && data.overvix.gth_model) ? data.overvix.gth_model : (data.model || {});
      const slope = gthModel.slope || (data.model ? data.model.slope : 0) || 0;
      const intercept = gthModel.intercept || (data.model ? data.model.intercept : 0) || 0;
      const thresh = (data.model && data.model.threshold_pts) || currentSpxThreshold;
      const expVal = intercept + slope * lastX;
      const residVal = lastY - expVal;
      const residStr = `${residVal >= 0 ? '+' : ''}${residVal.toFixed(2)} pts`;
      const tagStr = (residVal >= thresh)
        ? "  <span style='color:#FF5370;font-weight:bold'>🚨 ALERT</span>"
        : (residVal <= -thresh ? "  <span style='color:#06B6D4;font-weight:bold'>📉 CRUSH</span>" : "");

      Plotly.restyle('overvix-chart', {
        x: [[lastX]],
        y: [[lastY]],
        name: ['Session Close Point'],
        customdata: [[[residStr, tagStr, liveSpotStr, liveVolStr]]],
        'marker.color': ['#00E5FF'],
        'marker.size': [14],
        'marker.line': [{ color: '#FFFFFF', width: 2 }],
        visible: [true],
        showlegend: [true]
      }, [5]);
    }
  } else if (activePt && activePt.y !== null) {
    if (ovChartEl && ovChartEl.layout && ((ovChartEl.layout.shapes && ovChartEl.layout.shapes.length > 0) || (ovChartEl.layout.annotations && ovChartEl.layout.annotations.length > 0))) {
      Plotly.relayout('overvix-chart', { shapes: [], annotations: [] });
    }
    const isLivePoint = (data.is_rth_active === true) || isSpxGthLive;
    const pointLabel = isSpxGthLive ? "Live GTH Point" : (isLivePoint ? "Live Point" : "Session Close Point");
    const activeOv = (isNdx && ndx && ndx.overvix)
      ? ndx.overvix
      : (isSpxGthLive && data.gth && data.gth.overvix ? data.gth.overvix : ov);
    const liveThresh = (currentAssetPair === 'NDX') ? currentNdxThreshold : currentSpxThreshold;
    const liveResVal = (activeOv && activeOv.residual_pts !== undefined && activeOv.residual_pts !== null) ? activeOv.residual_pts : 0;
    const liveResStr = `${liveResVal >= 0 ? '+' : ''}${liveResVal.toFixed(2)} pts`;
    const liveTag = (liveResVal >= liveThresh)
      ? "  <span style='color:#FF5370;font-weight:bold'>🚨 ALERT</span>"
      : (liveResVal <= -liveThresh ? "  <span style='color:#06B6D4;font-weight:bold'>📉 CRUSH</span>" : "");

    const liveSpot = isNdx ? (data.ndx && data.ndx.market ? data.ndx.market.current : null) : (isSpxGthLive ? (data.gth ? data.gth.synthetic_spx : null) : (data.market && data.market.spx ? data.market.spx.current : null));
    const liveVol = isNdx ? (data.ndx && data.ndx.market && data.ndx.market.vxn ? data.ndx.market.vxn.current : null) : (isSpxGthLive ? (data.gth ? data.gth.vix : null) : (data.market && data.market.vix ? data.market.vix.current : null));
    const liveSpotStr = (typeof liveSpot === 'number' && !isNaN(liveSpot)) ? liveSpot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (liveSpot || '-');
    const liveVolStr = (typeof liveVol === 'number' && !isNaN(liveVol)) ? liveVol.toFixed(2) : (liveVol || '-');

    Plotly.restyle('overvix-chart', {
      x: [[activePt.x]],
      y: [[activePt.y]],
      name: [pointLabel],
      customdata: [[[liveResStr, liveTag, liveSpotStr, liveVolStr]]],
      'marker.color': [isTargetOvervixed ? '#FF1744' : (isSpxGthLive ? '#818CF8' : '#00E5FF')],
      visible: [true],
      showlegend: [true]
    }, [5]);

    // Dynamically append live point to intraday trail during RTH or GTH_ACTIVE
    if (isLivePoint && cachedTrail && data.datetime) {
      if (!cachedTrail.x) cachedTrail.x = [];
      if (!cachedTrail.y) cachedTrail.y = [];
      if (!cachedTrail.times) cachedTrail.times = [];
      if (!cachedTrail.customdata) cachedTrail.customdata = [];

      const model = (data.gth && isSpxGthLive) ? data.gth.model : (data.model || {});
      const trailSlope = model.slope || 0;
      const trailIntercept = model.intercept || 0;
      const ptExp = trailIntercept + trailSlope * activePt.x;
      const ptRes = activePt.y - ptExp;
      const ptResStr = `${ptRes >= 0 ? '+' : ''}${ptRes.toFixed(2)} pts`;
      const ptTag = (ptRes >= liveThresh)
        ? "  <span style='color:#FF5370;font-weight:bold'>🚨 ALERT</span>"
        : (ptRes <= -liveThresh ? "  <span style='color:#06B6D4;font-weight:bold'>📉 CRUSH</span>" : "");

      const liveDt = data.datetime;
      const n = cachedTrail.times.length;
      if (n > 0 && (cachedTrail.times[n - 1] === liveDt || cachedTrail.times[n - 1].slice(11, 16) === liveDt.slice(11, 16))) {
        cachedTrail.x[n - 1] = activePt.x;
        cachedTrail.y[n - 1] = activePt.y;
        cachedTrail.customdata[n - 1] = [ptResStr, ptTag, liveSpotStr, liveVolStr];
      } else {
        cachedTrail.x.push(activePt.x);
        cachedTrail.y.push(activePt.y);
        cachedTrail.times.push(liveDt);
        cachedTrail.customdata.push([ptResStr, ptTag, liveSpotStr, liveVolStr]);
      }
      Plotly.restyle('overvix-chart', {
        x: [cachedTrail.x],
        y: [cachedTrail.y],
        text: [cachedTrail.times],
        customdata: [cachedTrail.customdata]
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
        Plotly.restyle('term-structure-chart', {
          customdata: [buildTechVolCustomdata(dt.times, dt.vxn, dt.vix, dt.spread, dt.ratio)]
        }, [0]);
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
        Plotly.restyle('term-structure-chart', {
          customdata: [buildTsCustomdata(d1.times, d1.vix, d1.vix3m, d1.ratio)]
        }, [0]);
        if (d1.times.length > 0) {
          Plotly.restyle('term-structure-chart', {
            x: [[d1.times[0], liveDt], [d1.times[0], liveDt]]
          }, [3, 4]);
        }
      }
    }
  }

  // 7. Update Intraday Correlation Real-Time (for 1D, 5D, 10D, 1M when market or GTH is live)
  const isSpxGthLiveCorr = (!isNdx && data.session_status === 'GTH_ACTIVE' && data.gth && data.gth.is_gth_active && data.gth.vix_pt_change !== undefined);
  if (data.datetime && (data.is_rth_active || isSpxGthLiveCorr)) {
    const liveDt = data.datetime;
    const liveDate = liveDt.slice(0, 10);
    const activeCorrTfs = ['1D', '5D', '10D', '1M'];

    const appendCorrPoint = (crObj, rawPctVal, rawPtVal, corrVal, spotRawVal, volRawVal, gthFlag, isSingleDay = false) => {
      if (!crObj) return;
      if (!crObj.times) crObj.times = [];
      if (!crObj.spx_pct) crObj.spx_pct = [];
      if (!crObj.vix_pt) crObj.vix_pt = [];
      if (!crObj.rolling_corr) crObj.rolling_corr = [];

      let pctVal = rawPctVal;
      let ptVal = rawPtVal;

      // For multi-day horizons (5D, 10D, 1M), percentage and point changes must be calculated
      // relative to the start of the horizon (spot_raw[0] / vol_raw[0]), NOT today's single-day move!
      if (!isSingleDay) {
        if (spotRawVal !== null && spotRawVal !== undefined && Array.isArray(crObj.spot_raw) && crObj.spot_raw.length > 0) {
          const refSpot = crObj.spot_raw[0];
          if (refSpot && refSpot > 0) {
            pctVal = ((spotRawVal - refSpot) / refSpot) * 100.0;
          }
        }
        if (volRawVal !== null && volRawVal !== undefined && Array.isArray(crObj.vol_raw) && crObj.vol_raw.length > 0) {
          const refVol = crObj.vol_raw[0];
          if (refVol !== null && refVol !== undefined) {
            ptVal = volRawVal - refVol;
          }
        }
      }

      if (crObj.times.length > 0) {
        const lastT = crObj.times[crObj.times.length - 1];
        const lastDate = lastT.slice(0, 10);
        if (liveDate === lastDate) {
          if (lastT === liveDt || lastT.slice(11, 16) === liveDt.slice(11, 16)) {
            crObj.spx_pct[crObj.spx_pct.length - 1] = pctVal;
            crObj.vix_pt[crObj.vix_pt.length - 1] = ptVal;
            crObj.rolling_corr[crObj.rolling_corr.length - 1] = corrVal;
            if (crObj.spot_raw) crObj.spot_raw[crObj.spot_raw.length - 1] = spotRawVal;
            if (crObj.vol_raw) crObj.vol_raw[crObj.vol_raw.length - 1] = volRawVal;
            if (crObj.is_gth && gthFlag !== undefined) crObj.is_gth[crObj.is_gth.length - 1] = gthFlag;
          } else {
            crObj.times.push(liveDt);
            crObj.spx_pct.push(pctVal);
            crObj.vix_pt.push(ptVal);
            crObj.rolling_corr.push(corrVal);
            if (crObj.spot_raw) crObj.spot_raw.push(spotRawVal);
            if (crObj.vol_raw) crObj.vol_raw.push(volRawVal);
            if (crObj.is_gth && gthFlag !== undefined) crObj.is_gth.push(gthFlag);
          }
        } else if (isSingleDay) {
          crObj.times = [liveDt];
          crObj.spx_pct = [pctVal];
          crObj.vix_pt = [ptVal];
          crObj.rolling_corr = [corrVal];
          if (crObj.spot_raw) crObj.spot_raw = [spotRawVal];
          if (crObj.vol_raw) crObj.vol_raw = [volRawVal];
          if (crObj.is_gth && gthFlag !== undefined) crObj.is_gth = [gthFlag];
        } else {
          crObj.times.push(liveDt);
          crObj.spx_pct.push(pctVal);
          crObj.vix_pt.push(ptVal);
          crObj.rolling_corr.push(corrVal);
          if (crObj.spot_raw) crObj.spot_raw.push(spotRawVal);
          if (crObj.vol_raw) crObj.vol_raw.push(volRawVal);
          if (crObj.is_gth && gthFlag !== undefined) crObj.is_gth.push(gthFlag);
        }
      } else {
        crObj.times.push(liveDt);
        crObj.spx_pct.push(pctVal);
        crObj.vix_pt.push(ptVal);
        crObj.rolling_corr.push(corrVal);
        if (crObj.spot_raw) crObj.spot_raw.push(spotRawVal);
        if (crObj.vol_raw) crObj.vol_raw.push(volRawVal);
        if (crObj.is_gth && gthFlag !== undefined) crObj.is_gth.push(gthFlag);
      }
    };

    if (isNdx && ndx && data.is_rth_active) {
      const ndxPct = ndx.market ? ndx.market.pct_change : 0;
      const ndxCurrVal = ndx.market ? ndx.market.current : null;
      const vxnPt = (ndx.market && ndx.market.vxn) ? ndx.market.vxn.pt_change : 0;
      const vxnCurrVal = (ndx.market && ndx.market.vxn) ? ndx.market.vxn.current : null;
      const corrVal = ndx.correlation ? ndx.correlation.rolling_corr : -0.75;

      const appendNdxPoint = (cr, isSingleDay = false) => {
        if (!cr) return;
        const pctArr = cr.ndx_pct || cr.spx_pct;
        const ptArr = cr.vxn_pt || cr.vix_pt;

        let effectiveNdxPct = ndxPct;
        let effectiveVxnPt = vxnPt;

        if (!isSingleDay) {
          const spotArr = cr.ndx_raw || cr.spot_raw;
          const volArr = cr.vxn_raw || cr.vol_raw;
          if (ndxCurrVal !== null && ndxCurrVal !== undefined && Array.isArray(spotArr) && spotArr.length > 0) {
            const refSpot = spotArr[0];
            if (refSpot && refSpot > 0) {
              effectiveNdxPct = ((ndxCurrVal - refSpot) / refSpot) * 100.0;
            }
          }
          if (vxnCurrVal !== null && vxnCurrVal !== undefined && Array.isArray(volArr) && volArr.length > 0) {
            const refVol = volArr[0];
            if (refVol !== null && refVol !== undefined) {
              effectiveVxnPt = vxnCurrVal - refVol;
            }
          }
        }

        const syncRawArrays = (mode) => {
          const pairs = [
            [ndxCurrVal, ['spot_raw', 'ndx_raw']],
            [vxnCurrVal, ['vol_raw', 'vxn_raw']]
          ];
          pairs.forEach(([val, keys]) => {
            if (val === null || val === undefined) return;
            keys.forEach(k => {
              if (!Array.isArray(cr[k])) return;
              if (mode === 'reset') {
                cr[k].length = 0;
                cr[k].push(val);
              } else if (mode === 'replace' && cr[k].length > 0) {
                cr[k][cr[k].length - 1] = val;
              } else {
                cr[k].push(val);
              }
            });
          });
        };

        if (cr.times && cr.times.length > 0) {
          const lastT = cr.times[cr.times.length - 1];
          const lastDate = lastT.slice(0, 10);
          if (liveDate === lastDate) {
            if (lastT === liveDt || lastT.slice(11, 16) === liveDt.slice(11, 16)) {
              pctArr[pctArr.length - 1] = effectiveNdxPct;
              ptArr[ptArr.length - 1] = effectiveVxnPt;
              cr.rolling_corr[cr.rolling_corr.length - 1] = corrVal;
              syncRawArrays('replace');
            } else {
              cr.times.push(liveDt);
              pctArr.push(effectiveNdxPct);
              ptArr.push(effectiveVxnPt);
              cr.rolling_corr.push(corrVal);
              syncRawArrays('push');
            }
          } else if (isSingleDay) {
            cr.times = [liveDt];
            pctArr.length = 0; pctArr.push(effectiveNdxPct);
            ptArr.length = 0; ptArr.push(effectiveVxnPt);
            cr.rolling_corr = [corrVal];
            syncRawArrays('reset');
          } else {
            cr.times.push(liveDt);
            pctArr.push(effectiveNdxPct);
            ptArr.push(effectiveVxnPt);
            cr.rolling_corr.push(corrVal);
            syncRawArrays('push');
          }
        } else {
          if (!cr.times) cr.times = [];
          cr.times.push(liveDt);
          pctArr.push(effectiveNdxPct);
          ptArr.push(effectiveVxnPt);
          cr.rolling_corr.push(corrVal);
          syncRawArrays('push');
        }
      };

      activeCorrTfs.forEach(tf => {
        if (!cachedCorrNdx[tf] && tf === '1D') {
          cachedCorrNdx['1D'] = { times: [], ndx_pct: [], vxn_pt: [], rolling_corr: [], spot_raw: [], vol_raw: [], ndx_raw: [], vxn_raw: [] };
        }
        if (cachedCorrNdx[tf]) {
          appendNdxPoint(cachedCorrNdx[tf], tf === '1D');
        }
      });

      if (activeCorrTfs.includes(currentCorrTf)) {
        if (isMouseHoveringCorrChart) {
          pendingLiveCorrRender = true;
        } else {
          renderCorrelationChart('dual', currentCorrTf);
        }
      }
      if (activeCorrTfs.includes(currentFvTf)) {
        if (isMouseHoveringFvChart) {
          pendingLiveFvRender = true;
        } else {
          renderFairVixMonitorChart(currentFvTf);
        }
      }
    } else if (!isNdx) {
      if (data.is_rth_active) {
        if (!cachedCorr['1D']) cachedCorr['1D'] = { times: [], spx_pct: [], vix_pt: [], rolling_corr: [], spot_raw: [], vol_raw: [] };
        activeCorrTfs.forEach(tf => {
          if (cachedCorr[tf]) {
            appendCorrPoint(cachedCorr[tf], mkt.spx.pct_change, mkt.vix.pt_change, corr ? corr.rolling_corr : -0.75, mkt.spx.current, mkt.vix.current, undefined, tf === '1D');
          }
        });
      }
      if (!cachedCorrGth['1D']) cachedCorrGth['1D'] = { times: [], spx_pct: [], vix_pt: [], rolling_corr: [], spot_raw: [], vol_raw: [], is_gth: [] };
      activeCorrTfs.forEach(tf => {
        if (cachedCorrGth[tf]) {
          if (isSpxGthLiveCorr) {
            appendCorrPoint(cachedCorrGth[tf], data.gth.spx_pct_change, data.gth.vix_pt_change, data.gth.rolling_corr || -0.75, data.gth.synthetic_spx, data.gth.vix, 1, tf === '1D');
          } else if (data.is_rth_active) {
            appendCorrPoint(cachedCorrGth[tf], mkt.spx.pct_change, mkt.vix.pt_change, (data.gth && data.gth.rolling_corr) ? data.gth.rolling_corr : (corr ? corr.rolling_corr : -0.75), mkt.spx.current, mkt.vix.current, 0, tf === '1D');
          }
        }
      });
      if (activeCorrTfs.includes(currentCorrTf)) {
        if (isMouseHoveringCorrChart) {
          pendingLiveCorrRender = true;
        } else {
          renderCorrelationChart('dual', currentCorrTf);
        }
      }
      if (activeCorrTfs.includes(currentFvTf)) {
        if (isMouseHoveringFvChart) {
          pendingLiveFvRender = true;
        } else {
          renderFairVixMonitorChart(currentFvTf);
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
    cachedActiveSessionDate = data.session_date;
    cachedIsRthActive = data.is_rth_active;
    cachedGthSessionDate = data.gth ? data.gth.session_date : null;
    cachedGthStatus = data.session_status;
    if (data.hist_version !== undefined) cachedHistVersion = data.hist_version;
    applyAutoGthDefault(data);

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
    if (data.fair_vix && data.fair_vix.config) {
      currentVrpMode = data.fair_vix.config.vrp_mode || 'auto';
      currentVrpFixedPts = (typeof data.fair_vix.config.vrp_fixed_pts === 'number') ? data.fair_vix.config.vrp_fixed_pts : 4.0;
      currentFvBlend = data.fair_vix.config.blend_mode || 'r2_weighted';
    }

    // Cache multi-timeframe datasets across all 9 horizons (1D, 5D, 10D, 1M, 3M, 6M, YTD, 1Y, MAX)
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
    if (data.intraday_correlation) {
      if (data.intraday_correlation['1D_GTH']) cachedCorrGth['1D'] = data.intraday_correlation['1D_GTH'];
      if (data.intraday_correlation['5D_GTH']) cachedCorrGth['5D'] = data.intraday_correlation['5D_GTH'];
      if (data.intraday_correlation['10D_GTH']) cachedCorrGth['10D'] = data.intraday_correlation['10D_GTH'];
      if (data.intraday_correlation.metrics_gth) cachedCorrGth.metrics = data.intraday_correlation.metrics_gth;
    }
    if (data.overvix && data.overvix.intraday_trail_gth) {
      cachedTrailGth = data.overvix.intraday_trail_gth;
    }
    if (data.ndx && data.ndx.correlation && data.ndx.correlation.metrics) {
      cachedCorrNdx.metrics = data.ndx.correlation.metrics;
    }

    updateGthToggleUI(data);
    renderOvervixChart(data);
    renderTermStructureChart(currentTimeframe);
    renderCorrelationChart(currentCorrMode, currentCorrTf);
    updateCorrMetricDisplay();
    renderFairVixMonitorChart(currentFvTf);
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
  const btnSessionDropdown = document.getElementById('btn-session-dropdown');
  const sessionPopover = document.getElementById('session-popover');
  const btnCloseSessionPopover = document.getElementById('btn-close-session-popover');
  const btnPopoverReturnLive = document.getElementById('btn-popover-return-live');

  // Populate notable presets from API
  await refreshNotableDates();

  // Popover toggle handling
  if (btnSessionDropdown && sessionPopover) {
    btnSessionDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      sessionPopover.classList.toggle('hidden');
    });
  }

  if (btnCloseSessionPopover && sessionPopover) {
    btnCloseSessionPopover.addEventListener('click', (e) => {
      e.stopPropagation();
      sessionPopover.classList.add('hidden');
    });
  }

  if (btnPopoverReturnLive) {
    btnPopoverReturnLive.addEventListener('click', () => {
      returnToLiveMode();
      if (sessionPopover) sessionPopover.classList.add('hidden');
    });
  }

  document.addEventListener('click', (e) => {
    if (sessionPopover && !sessionPopover.classList.contains('hidden')) {
      if (!sessionPopover.contains(e.target) && (!btnSessionDropdown || !btnSessionDropdown.contains(e.target))) {
        sessionPopover.classList.add('hidden');
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sessionPopover && !sessionPopover.classList.contains('hidden')) {
      sessionPopover.classList.add('hidden');
    }
  });

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
      if (d) {
        if (sessionPopover) sessionPopover.classList.add('hidden');
        loadHistoricalSession(d);
      } else {
        alert("Please select or enter a date (YYYY-MM-DD).");
      }
    });
  }

  if (inputDate) {
    const handleDate = (e) => {
      const d = e.target.value;
      if (d && d.length === 10) {
        if (sessionPopover) sessionPopover.classList.add('hidden');
        loadHistoricalSession(d);
      }
    };
    inputDate.addEventListener('change', handleDate);
    inputDate.addEventListener('input', handleDate);
  }

  if (selectNotable) {
    selectNotable.addEventListener('change', (e) => {
      const d = e.target.value;
      if (d) {
        if (inputDate) inputDate.value = d;
        if (sessionPopover) sessionPopover.classList.add('hidden');
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
    cachedLiveCorrGth = JSON.parse(JSON.stringify(cachedCorrGth));
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

    const sessionDropdownLabel = document.getElementById('session-dropdown-label');
    const btnSessionDropdown = document.getElementById('btn-session-dropdown');
    const sessionPopover = document.getElementById('session-popover');
    const popoverLiveSection = document.getElementById('popover-live-section');

    if (sessionDropdownLabel) sessionDropdownLabel.textContent = dateStr;
    if (btnSessionDropdown) {
      btnSessionDropdown.className = "px-2 py-0.5 rounded text-xs font-semibold text-amber-300 bg-amber-950/60 border border-amber-600/70 shadow-sm transition flex items-center space-x-1 cursor-pointer";
    }
    if (popoverLiveSection) popoverLiveSection.classList.remove('hidden');
    if (sessionPopover) sessionPopover.classList.add('hidden');

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
    currentFvTf = '1D';
    if (sliderTsTimeframe) sliderTsTimeframe.value = 0;
    if (sliderCorrTimeframe) sliderCorrTimeframe.value = 0;
    const sliderFv = document.getElementById('slider-fv-timeframe');
    if (sliderFv) sliderFv.value = 0;
    updateTsSliderUI('1D');
    updateCorrSliderUI('1D');
    updateFvSliderUI('1D');
    if (corrAnchor.mode !== 'daily_reset') {
      resetCorrAnchor(false);
    } else {
      updateAnchorUI();
    }

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
    renderFairVixMonitorChart('1D');
    updateGthToggleUI(data);
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

  const sessionDropdownLabel = document.getElementById('session-dropdown-label');
  const btnSessionDropdown = document.getElementById('btn-session-dropdown');
  const sessionPopover = document.getElementById('session-popover');
  const popoverLiveSection = document.getElementById('popover-live-section');

  if (sessionDropdownLabel) sessionDropdownLabel.textContent = 'Replay';
  if (btnSessionDropdown) {
    btnSessionDropdown.className = "px-2 py-0.5 rounded text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center space-x-1 cursor-pointer";
  }
  if (popoverLiveSection) popoverLiveSection.classList.add('hidden');
  if (sessionPopover) sessionPopover.classList.add('hidden');

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
    if (cachedLiveCorrGth) cachedCorrGth = cachedLiveCorrGth;
    if (cachedLiveTechVol) cachedTechVol = cachedLiveTechVol;
    if (cachedLiveCorrNdx) cachedCorrNdx = cachedLiveCorrNdx;

    updateGthToggleUI(lastLiveUpdatePayload || cachedBootstrap);
    renderOvervixChart(cachedBootstrap);
    renderTermStructureChart(currentTimeframe);
    renderCorrelationChart(currentCorrMode, currentCorrTf);
    updateCorrMetricDisplay();
    renderFairVixMonitorChart(currentFvTf);
  }

  if (lastLiveUpdatePayload) {
    updateUI(lastLiveUpdatePayload);
  }
}

function setupRiskReversalPopovers() {
  const popover25 = document.getElementById('popover-rr25');
  const popover4m = document.getElementById('popover-rr4m');
  const popoverTs = document.getElementById('popover-vix-futures');
  const popoverFv = document.getElementById('popover-fair-vix');

  const allPopovers = [popover25, popover4m, popoverTs, popoverFv];

  const attachPopoverHandler = (cardId, popoverId, closeBtnId) => {
    const card = document.getElementById(cardId);
    const popover = document.getElementById(popoverId);
    const btnClose = document.getElementById(closeBtnId);

    if (!card || !popover) return;

    card.addEventListener('click', (e) => {
      // If click originated inside the popover (except close button), don't toggle
      if (popover.contains(e.target)) {
        if (e.target === btnClose || (btnClose && btnClose.contains(e.target))) {
          popover.classList.add('hidden');
        }
        return;
      }
      e.stopPropagation();
      const willOpen = popover.classList.contains('hidden');
      // Close other popovers
      allPopovers.forEach(p => { if (p && p !== popover) p.classList.add('hidden'); });
      if (willOpen) {
        popover.classList.remove('hidden');
        if (popoverId === 'popover-vix-futures') {
          setTimeout(() => {
            renderVixFuturesCurveChart(lastVixFuturesData, lastSpotVixVal);
          }, 30);
        } else if (popoverId === 'popover-fair-vix') {
          setTimeout(() => {
            const fvBoot = getActiveFairVixModelBoot();
            const fvLive = lastFairVixData || getActiveFairVixPayload(lastLiveUpdatePayload || cachedBootstrap) || fvBoot;
            renderFairVixMiniChart(fvLive, fvBoot);
          }, 30);
        }
      } else {
        popover.classList.add('hidden');
      }
    });

    if (btnClose) {
      btnClose.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.add('hidden');
      });
    }
  };

  attachPopoverHandler('card-rr25', 'popover-rr25', 'btn-close-rr25-popover');
  attachPopoverHandler('card-rr4m', 'popover-rr4m', 'btn-close-rr4m-popover');
  attachPopoverHandler('card-term-structure', 'popover-vix-futures', 'btn-close-futures-popover');
  attachPopoverHandler('card-vix-fair', 'popover-fair-vix', 'btn-close-fair-vix-popover');

  document.addEventListener('click', (e) => {
    const card25 = document.getElementById('card-rr25');
    const card4m = document.getElementById('card-rr4m');
    const cardTs = document.getElementById('card-term-structure');
    const cardFv = document.getElementById('card-vix-fair');
    if (popover25 && !popover25.classList.contains('hidden') && (!card25 || !card25.contains(e.target))) {
      popover25.classList.add('hidden');
    }
    if (popover4m && !popover4m.classList.contains('hidden') && (!card4m || !card4m.contains(e.target))) {
      popover4m.classList.add('hidden');
    }
    if (popoverTs && !popoverTs.classList.contains('hidden') && (!cardTs || !cardTs.contains(e.target))) {
      popoverTs.classList.add('hidden');
    }
    if (popoverFv && !popoverFv.classList.contains('hidden') && (!cardFv || !cardFv.contains(e.target))) {
      popoverFv.classList.add('hidden');
    }
  });

  // 4M Skew On-Demand Recalibration & Reset Handlers
  const btnRecalibrate = document.getElementById('btn-recalibrate-4m-spot');
  const btnReset = document.getElementById('btn-reset-4m-close');
  const spinRecalibrate = document.getElementById('spinner-recalibrate-4m');
  const iconRecalibrate = document.getElementById('icon-recalibrate-4m');

  const triggerRecalibration = async (mode) => {
    const isNdx = (currentAssetPair === 'NDX');
    const asset = isNdx ? 'NDX' : 'SPX';

    if (btnRecalibrate) btnRecalibrate.disabled = true;
    if (btnReset) btnReset.disabled = true;
    if (mode === 'spot' && spinRecalibrate && iconRecalibrate) {
      spinRecalibrate.classList.remove('hidden');
      iconRecalibrate.classList.add('hidden');
    }

    try {
      const resp = await fetch('/api/recalibrate_4m_skew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, mode })
      });
      if (resp.ok) {
        const result = await resp.json();
        if (result && result.rr_4m && lastLiveUpdatePayload) {
          if (isNdx) {
            if (!lastLiveUpdatePayload.ndx) lastLiveUpdatePayload.ndx = {};
            lastLiveUpdatePayload.ndx.rr_4m = result.rr_4m;
          } else {
            lastLiveUpdatePayload.rr_4m = result.rr_4m;
          }
          updateUI(lastLiveUpdatePayload);
        }
      } else {
        console.error('Failed to recalibrate 4M skew:', resp.statusText);
      }
    } catch (err) {
      console.error('Recalibration request error:', err);
    } finally {
      if (btnRecalibrate) btnRecalibrate.disabled = false;
      if (btnReset) btnReset.disabled = false;
      if (spinRecalibrate && iconRecalibrate) {
        spinRecalibrate.classList.add('hidden');
        iconRecalibrate.classList.remove('hidden');
      }
    }
  };

  if (btnRecalibrate) {
    btnRecalibrate.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerRecalibration('spot');
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerRecalibration('session_close');
    });
  }

  // 25Δ Skew On-Demand Recalibration & Reset Handlers
  const btnRecalibrate25 = document.getElementById('btn-recalibrate-25-spot');
  const btnReset25 = document.getElementById('btn-reset-25-close');
  const spinRecalibrate25 = document.getElementById('spinner-recalibrate-25');
  const iconRecalibrate25 = document.getElementById('icon-recalibrate-25');

  const triggerRecalibration25 = async (mode) => {
    const isNdx = (currentAssetPair === 'NDX');
    const asset = isNdx ? 'NDX' : 'SPX';

    if (btnRecalibrate25) btnRecalibrate25.disabled = true;
    if (btnReset25) btnReset25.disabled = true;
    if (mode === 'spot' && spinRecalibrate25 && iconRecalibrate25) {
      spinRecalibrate25.classList.remove('hidden');
      iconRecalibrate25.classList.add('hidden');
    }

    try {
      const resp = await fetch('/api/recalibrate_25d_skew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, mode })
      });
      if (resp.ok) {
        const result = await resp.json();
        if (result && result.risk_reversal && lastLiveUpdatePayload) {
          if (isNdx) {
            if (!lastLiveUpdatePayload.ndx) lastLiveUpdatePayload.ndx = {};
            lastLiveUpdatePayload.ndx.risk_reversal = result.risk_reversal;
          } else {
            lastLiveUpdatePayload.risk_reversal = result.risk_reversal;
          }
          updateUI(lastLiveUpdatePayload);
        }
      } else {
        console.error('Failed to recalibrate 25Δ skew:', resp.statusText);
      }
    } catch (err) {
      console.error('25Δ Recalibration request error:', err);
    } finally {
      if (btnRecalibrate25) btnRecalibrate25.disabled = false;
      if (btnReset25) btnReset25.disabled = false;
      if (spinRecalibrate25 && iconRecalibrate25) {
        spinRecalibrate25.classList.add('hidden');
        iconRecalibrate25.classList.remove('hidden');
      }
    }
  };

  if (btnRecalibrate25) {
    btnRecalibrate25.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerRecalibration25('spot');
    });
  }

  if (btnReset25) {
    btnReset25.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerRecalibration25('session_close');
    });
  }
}

// Start Dashboard on load
window.addEventListener('DOMContentLoaded', () => {
  setupTimeframeButtons();
  setupTrailButtons();
  setupCorrButtons();
  setupAssetSwitcher();
  setupGthToggle();
  setupRiskReversalPopovers();
  setupOvervixModeTabs();
  setupFairVixMonitorControls();
  initHistoricalControls();
  bootstrapData();
});
