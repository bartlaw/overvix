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

// Cached Datasets
let cachedBootstrap = null;
let cachedTs = {
  '1D': { times: [], vix: [], vix3m: [], ratio: [] },
  '5D': { times: [], vix: [], vix3m: [], ratio: [] },
  '1Y': { times: [], vix: [], vix3m: [], ratio: [] }
};
let cachedTrail = { x: [], y: [], times: [] };
let cachedCorr = { times: [], spx_pct: [], vix_pt: [], rolling_corr: [], current_corr: -0.75 };

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

// Correlation Mode Selector
const btnCorrDual = document.getElementById('btn-corr-dual');
const btnCorrOnly = document.getElementById('btn-corr-only');

function setupCorrButtons() {
  btnCorrDual.addEventListener('click', () => switchCorrMode('dual'));
  btnCorrOnly.addEventListener('click', () => switchCorrMode('corr_only'));
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
  renderCorrelationChart(mode);
}

// ==============================================================================
// PLOTLY CHART INITIALIZATION & RENDERING
// ==============================================================================

function renderOvervixChart(bootstrap) {
  const xHist = (bootstrap.overvix && bootstrap.overvix.x_history) ? bootstrap.overvix.x_history : [];
  const yHist = (bootstrap.overvix && bootstrap.overvix.y_history) ? bootstrap.overvix.y_history : [];
  const dates = (bootstrap.overvix && bootstrap.overvix.dates) ? bootstrap.overvix.dates : [];
  const slope = (bootstrap.model && bootstrap.model.slope) || 0;
  const intercept = (bootstrap.model && bootstrap.model.intercept) || 0;
  const threshold = (bootstrap.model && bootstrap.model.threshold_pts) || currentThreshold;

  // Intraday Trail Data
  const trail = (bootstrap.overvix && bootstrap.overvix.intraday_trail) ? bootstrap.overvix.intraday_trail : { x: [], y: [], times: [] };
  cachedTrail = trail;

  // Compute Trendline & Overvix Band
  const allX = xHist.concat(trail.x || []);
  const minX = Math.min(-3.5, ...allX) - 0.4;
  const maxX = Math.max(3.5, ...allX) + 0.4;
  const xGrid = [minX, maxX];
  const yTrend = xGrid.map(x => intercept + slope * x);
  const yThreshold = yTrend.map(y => y + threshold);
  const yBandTop = yThreshold.map(y => y + 2.5);

  const currX = (bootstrap.current_point && bootstrap.current_point.x !== undefined) ? bootstrap.current_point.x : 0;
  const currY = (bootstrap.current_point && bootstrap.current_point.y !== undefined) ? bootstrap.current_point.y : 0;
  const isOvervixed = bootstrap.overvix ? bootstrap.overvix.is_overvixed : false;

  const traces = [
    // 0: Historical 60D Spot-Vol Points
    {
      x: xHist,
      y: yHist,
      text: dates,
      mode: 'markers',
      name: 'Historical (60D)',
      marker: {
        color: '#E6D385',
        size: 7,
        opacity: 0.75,
        line: { color: '#B39F50', width: 0.5 }
      },
      hovertemplate: '<b>%{text}</b><br>SPX Move: %{x:+.2f}%<br>VIX Move: %{y:+.2f} pts<extra></extra>',
      visible: currentTrailMode === 'today' ? false : true
    },
    // 1: Regression Trendline
    {
      x: xGrid,
      y: yTrend,
      mode: 'lines',
      name: 'Expected Trendline',
      line: { color: '#C5BF85', width: 2 },
      hoverinfo: 'none'
    },
    // 2: Overvix Threshold Line
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
      name: 'Overvix Zone',
      hoverinfo: 'none'
    },
    // 4: Today's Intraday Breadcrumb Trail
    {
      x: trail.x || [],
      y: trail.y || [],
      text: trail.times || [],
      mode: 'lines+markers',
      name: "Today's Intraday Path",
      line: { color: '#00E5FF', width: 1.8, shape: 'spline' },
      marker: { color: '#00E5FF', size: 4, opacity: 0.8 },
      hovertemplate: '<b>%{text} (Today)</b><br>SPX: %{x:+.2f}%<br>VIX: %{y:+.2f} pts<extra></extra>',
      visible: currentTrailMode === '60d' ? false : true
    },
    // 5: Live Current Point
    {
      x: [currX],
      y: [currY],
      mode: 'markers',
      name: 'Live Point',
      marker: {
        color: isOvervixed ? '#FF1744' : '#00E5FF',
        size: 14,
        line: { color: '#FFFFFF', width: 2 }
      },
      hovertemplate: '<b>Live Current Point</b><br>SPX: %{x:+.2f}%<br>VIX: %{y:+.2f} pts<extra></extra>'
    }
  ];

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    margin: { l: 50, r: 20, t: 25, b: 45 },
    xaxis: {
      title: { text: 'SPX % Change (Today)', font: { color: '#94A3B8', size: 11 } },
      gridcolor: '#1e293b',
      zerolinecolor: '#334155',
      zerolinewidth: 1,
      tickfont: { color: '#94A3B8', size: 10 }
    },
    yaxis: {
      title: { text: 'VIX Point Change (Today)', font: { color: '#94A3B8', size: 11 } },
      gridcolor: '#1e293b',
      zerolinecolor: '#334155',
      zerolinewidth: 1,
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

  Plotly.newPlot('overvix-chart', traces, layout, { responsive: true, displayModeBar: false });
}

function renderTermStructureChart(tf = '1D') {
  const data = cachedTs[tf] || cachedTs['1D'];
  const times = data.times || [];
  const vix = data.vix || [];
  const vix3m = data.vix3m || [];
  const ratio = data.ratio || [];

  const dStart = times.length > 0 ? times[0] : '';
  const dEnd = times.length > 0 ? times[times.length - 1] : '';

  const traceVIX = {
    x: times,
    y: vix,
    name: 'VIX (30d)',
    mode: 'lines',
    line: { color: '#00E5FF', width: 1.5 },
    xaxis: 'x',
    yaxis: 'y1',
    hovertemplate: '<b>VIX</b>: %{y:.2f}<extra></extra>'
  };

  const traceVIX3M = {
    x: times,
    y: vix3m,
    name: 'VIX3M (90d)',
    mode: 'lines',
    line: { color: '#FFA726', width: 1.5 },
    xaxis: 'x',
    yaxis: 'y1',
    hovertemplate: '<b>VIX3M</b>: %{y:.2f}<extra></extra>'
  };

  const traceRatio = {
    x: times,
    y: ratio,
    name: 'Ratio (VIX/VIX3M)',
    mode: 'lines',
    line: { color: '#E6D385', width: 2 },
    xaxis: 'x',
    yaxis: 'y2',
    hovertemplate: '<b>Ratio</b>: %{y:.4f}<extra></extra>'
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

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    autosize: true,
    margin: { l: 50, r: 20, t: 25, b: 40 },
    grid: {
      rows: 2,
      columns: 1,
      pattern: 'independent',
      roworder: 'top to bottom'
    },
    xaxis: {
      title: { text: xTitle, font: { color: '#94A3B8', size: 10 } },
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 },
      showgrid: true,
      nticks: 10
    },
    yaxis: {
      domain: [0.50, 1.0],
      title: { text: 'Index Level', font: { color: '#94A3B8', size: 10 } },
      gridcolor: '#1e293b',
      tickfont: { color: '#94A3B8', size: 10 }
    },
    yaxis2: {
      domain: [0.0, 0.42],
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

function renderCorrelationChart(mode = 'dual') {
  const c = cachedCorr;
  const times = c.times || [];
  const spxPct = c.spx_pct || [];
  const vixPt = c.vix_pt || [];
  const rollingCorr = c.rolling_corr || [];

  const dStart = times.length > 0 ? times[0] : '';
  const dEnd = times.length > 0 ? times[times.length - 1] : '';

  if (mode === 'dual') {
    // Subplot 1: SPX % Move (left axis) vs VIX pt move (right axis)
    const traceSPX = {
      x: times,
      y: spxPct,
      name: 'SPX % Move',
      mode: 'lines',
      line: { color: '#10B981', width: 1.8 },
      xaxis: 'x',
      yaxis: 'y1',
      hovertemplate: '<b>SPX Move</b>: %{y:+.2f}%<extra></extra>'
    };

    const traceVIX = {
      x: times,
      y: vixPt,
      name: 'VIX Point Move',
      mode: 'lines',
      line: { color: '#F59E0B', width: 1.8 },
      xaxis: 'x',
      yaxis: 'y2',
      hovertemplate: '<b>VIX Move</b>: %{y:+.2f} pts<extra></extra>'
    };

    // Subplot 2: Rolling 30-min Pearson Correlation
    const traceCorr = {
      x: times,
      y: rollingCorr,
      name: 'Rolling 30m Correlation (&rho;)',
      mode: 'lines',
      line: { color: '#00E5FF', width: 2 },
      xaxis: 'x',
      yaxis: 'y3',
      hovertemplate: '<b>Rolling &rho;</b>: %{y:.3f}<extra></extra>'
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
      grid: {
        rows: 2,
        columns: 1,
        pattern: 'independent',
        roworder: 'top to bottom'
      },
      xaxis: {
        title: { text: 'Today Intraday Time (US/Eastern)', font: { color: '#94A3B8', size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: '#94A3B8', size: 10 },
        showgrid: true,
        nticks: 10
      },
      yaxis: {
        domain: [0.52, 1.0],
        title: { text: 'SPX % Move', font: { color: '#10B981', size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: '#10B981', size: 10 }
      },
      yaxis2: {
        domain: [0.52, 1.0],
        title: { text: 'VIX Point Move', font: { color: '#F59E0B', size: 10 } },
        overlaying: 'y',
        side: 'right',
        gridcolor: 'transparent',
        tickfont: { color: '#F59E0B', size: 10 }
      },
      yaxis3: {
        domain: [0.0, 0.42],
        title: { text: 'Rolling 30m &rho;', font: { color: '#00E5FF', size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: '#94A3B8', size: 10 },
        range: [-1.05, 1.05]
      },
      legend: {
        orientation: 'h',
        x: 0,
        y: 1.12,
        font: { color: '#94A3B8', size: 10 }
      },
      showlegend: true
    };

    Plotly.newPlot('correlation-chart', [traceSPX, traceVIX, traceCorr, traceZero, traceNormal], layout, {
      responsive: true,
      displayModeBar: false
    });
  } else {
    // Correlation Only mode (single large plot)
    const traceCorr = {
      x: times,
      y: rollingCorr,
      name: 'Rolling 30m Correlation (&rho;)',
      mode: 'lines',
      line: { color: '#00E5FF', width: 2.2 },
      hovertemplate: '<b>Rolling &rho;</b>: %{y:.3f}<extra></extra>'
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
        title: { text: 'Today Intraday Time (US/Eastern)', font: { color: '#94A3B8', size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: '#94A3B8', size: 10 },
        showgrid: true
      },
      yaxis: {
        title: { text: 'Rolling 30-Minute Pearson &rho;', font: { color: '#00E5FF', size: 10 } },
        gridcolor: '#1e293b',
        tickfont: { color: '#94A3B8', size: 10 },
        range: [-1.05, 1.05]
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
  const mkt = data.market;
  const ov = data.overvix;
  const ts = data.term_structure;
  const mod = data.model;
  const conf = data.confluence;
  const corr = data.correlation;

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

  // 2. Confluence Banner
  const confBanner = document.getElementById('confluence-banner');
  const confBadge = document.getElementById('confluence-badge');
  const confDesc = document.getElementById('confluence-desc');

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

  // Audio Alerts on State Changes
  if (conf.is_dual_alert && (!lastOvervixSignal || !lastInversionSignal)) {
    playAlertSound('dual');
  } else if (ov.is_overvixed && !lastOvervixSignal) {
    playAlertSound('overvix');
  }
  lastOvervixSignal = ov.is_overvixed;
  lastInversionSignal = ts.is_inverted;

  // 3. KPI Cards
  document.getElementById('kpi-spx-price').textContent = fmtNum(mkt.spx.current);
  const spxPctEl = document.getElementById('kpi-spx-pct');
  spxPctEl.textContent = fmtPct(mkt.spx.pct_change);
  spxPctEl.className = `text-xs font-mono font-medium mt-0.5 ${mkt.spx.pct_change >= 0 ? 'text-emerald-400' : 'text-red-400'}`;

  document.getElementById('kpi-vix-price').textContent = fmtNum(mkt.vix.current);
  const vixPtEl = document.getElementById('kpi-vix-pt');
  vixPtEl.textContent = `${fmtPts(mkt.vix.pt_change)} pts`;
  vixPtEl.className = `text-xs font-mono font-medium mt-0.5 ${mkt.vix.pt_change >= 0 ? 'text-red-400' : 'text-emerald-400'}`;

  document.getElementById('kpi-vix3m-price').textContent = fmtNum(mkt.vix3m.current);
  const vix3mPtEl = document.getElementById('kpi-vix3m-pt');
  vix3mPtEl.textContent = `${fmtPts(mkt.vix3m.pt_change)} pts`;

  // Ratio Card
  document.getElementById('kpi-ratio-val').textContent = fmtNum(ts.ratio, 4);
  const ratioBadge = document.getElementById('kpi-ratio-badge');
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

  // Intraday Session Stats
  if (ts.intraday) {
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

  // Expected VIX & Residual
  document.getElementById('kpi-expected-vix').textContent = `${fmtPts(ov.expected_vix_pt)} pts`;
  
  const residualEl = document.getElementById('kpi-residual-pts');
  residualEl.textContent = `${fmtPts(ov.residual_pts)} pts`;
  
  const cardOvervix = document.getElementById('card-overvix-residual');
  const overvixStatusBadge = document.getElementById('kpi-overvix-status');
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

  // Model Parameters Strip
  document.getElementById('param-window').textContent = mod.window_days;
  document.getElementById('param-r2').textContent = fmtNum(mod.r_squared, 4);
  document.getElementById('param-slope').textContent = fmtNum(mod.slope, 4);
  document.getElementById('param-volslope').textContent = fmtNum(mod.vol_slope, 4);
  document.getElementById('param-intercept').textContent = fmtNum(mod.intercept, 4);

  // Correlation Strip
  if (corr) {
    document.getElementById('corr-live-val').textContent = fmtNum(corr.rolling_corr, 3);
    const corrPill = document.getElementById('corr-status-pill');
    if (corr.rolling_corr < -0.40) {
      corrPill.textContent = `Normal Inverse (\u03c1 = ${fmtNum(corr.rolling_corr, 3)})`;
      corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800";
    } else if (corr.rolling_corr < 0.0) {
      corrPill.textContent = `Weakening (\u03c1 = ${fmtNum(corr.rolling_corr, 3)})`;
      corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800";
    } else {
      corrPill.textContent = `Positive Decoupling (\u03c1 = ${fmtNum(corr.rolling_corr, 3)})`;
      corrPill.className = "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-red-950 text-red-400 border border-red-800 animate-pulse";
    }
  }

  // Time & Tags
  const now = new Date();
  document.getElementById('last-update-time').textContent = `Updated: ${now.toLocaleTimeString()}`;
  document.getElementById('chart-ratio-tag').textContent = `Ratio: ${fmtNum(ts.ratio, 4)}`;

  // 4. Update Overvix Plotly Chart Real-Time
  const currX = data.current_point.x;
  const currY = data.current_point.y;
  Plotly.restyle('overvix-chart', {
    x: [[currX]],
    y: [[currY]],
    'marker.color': [ov.is_overvixed ? '#FF1744' : '#00E5FF']
  }, [5]);

  // 5. Update Intraday Term Structure Curve Real-Time (when 1D is active)
  if (currentTimeframe === '1D') {
    const d1 = cachedTs['1D'];
    const liveTime = ts.intraday ? ts.intraday.latest_time : now.toTimeString().slice(0, 5);

    if (d1.times.length > 0) {
      const lastT = d1.times[d1.times.length - 1];
      if (lastT === liveTime) {
        d1.vix[d1.vix.length - 1] = mkt.vix.current;
        d1.vix3m[d1.vix3m.length - 1] = mkt.vix3m.current;
        d1.ratio[d1.ratio.length - 1] = ts.ratio;
      } else {
        d1.times.push(liveTime);
        d1.vix.push(mkt.vix.current);
        d1.vix3m.push(mkt.vix3m.current);
        d1.ratio.push(ts.ratio);
      }

      Plotly.restyle('term-structure-chart', {
        x: [d1.times, d1.times, d1.times],
        y: [d1.vix, d1.vix3m, d1.ratio]
      }, [0, 1, 2]);

      Plotly.restyle('term-structure-chart', {
        x: [[liveTime]],
        y: [[ts.ratio]],
        'marker.color': [ts.is_inverted ? '#EF4444' : '#00E5FF']
      }, [5]);
    }
  }

  // 6. Update Intraday Correlation Chart Real-Time
  const cr = cachedCorr;
  const liveTime = now.toTimeString().slice(0, 5);
  if (cr.times.length > 0) {
    const lastT = cr.times[cr.times.length - 1];
    if (lastT === liveTime) {
      cr.spx_pct[cr.spx_pct.length - 1] = mkt.spx.pct_change;
      cr.vix_pt[cr.vix_pt.length - 1] = mkt.vix.pt_change;
      if (corr) cr.rolling_corr[cr.rolling_corr.length - 1] = corr.rolling_corr;
    } else {
      cr.times.push(liveTime);
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

    // Cache datasets
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

    if (data.intraday_correlation) {
      cachedCorr = data.intraday_correlation;
    }

    renderOvervixChart(data);
    renderTermStructureChart(currentTimeframe);
    renderCorrelationChart(currentCorrMode);
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

// Start Dashboard on load
window.addEventListener('DOMContentLoaded', () => {
  setupTimeframeButtons();
  setupTrailButtons();
  setupCorrButtons();
  bootstrapData();
});
