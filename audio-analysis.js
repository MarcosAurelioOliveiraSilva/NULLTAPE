/* ============================================================
   MΛLΛK — audio-analysis.js
   Detecção de TOM e BPM direto no navegador, sem servidor.
   São estimativas (heurísticas de DSP), não um valor "oficial" —
   funcionam bem pra maioria das faixas eletrônicas/trap/hip-hop,
   mas podem errar em faixas com tempo muito variável, a capella,
   ou com muito ruído/distorção.
   ============================================================ */
const MalakAnalysis = (() => {

  /* ---------------- FFT (Cooley-Tukey, radix-2, in-place) ---------------- */
  function fft(real, imag) {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = real[i]; real[i] = real[j]; real[j] = t;
        t = imag[i]; imag[i] = imag[j]; imag[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr0 = Math.cos(ang), wi0 = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curWr = 1, curWi = 0;
        const half = len >> 1;
        for (let j = 0; j < half; j++) {
          const ur = real[i + j], ui = imag[i + j];
          const vr = real[i + j + half] * curWr - imag[i + j + half] * curWi;
          const vi = real[i + j + half] * curWi + imag[i + j + half] * curWr;
          real[i + j] = ur + vr; imag[i + j] = ui + vi;
          real[i + j + half] = ur - vr; imag[i + j + half] = ui - vi;
          const nWr = curWr * wr0 - curWi * wi0;
          const nWi = curWr * wi0 + curWi * wr0;
          curWr = nWr; curWi = nWi;
        }
      }
    }
  }

  function hannWindow(size) {
    const w = new Float64Array(size);
    for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    return w;
  }

  /* ---------------- Key detection (chroma + Krumhansl-Kessler) ---------------- */
  const NOTE_NAMES = ["Dó", "Dó#", "Ré", "Ré#", "Mi", "Fá", "Fá#", "Sol", "Sol#", "Lá", "Lá#", "Si"];
  const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function computeChroma(samples, sampleRate) {
    const fftSize = 4096;
    const hop = 2048;
    const window = hannWindow(fftSize);
    const chroma = new Array(12).fill(0);
    const half = fftSize / 2;

    for (let start = 0; start + fftSize <= samples.length; start += hop) {
      const real = new Float64Array(fftSize);
      const imag = new Float64Array(fftSize);
      for (let i = 0; i < fftSize; i++) real[i] = samples[start + i] * window[i];
      fft(real, imag);
      for (let bin = 1; bin < half; bin++) {
        const freq = (bin * sampleRate) / fftSize;
        if (freq < 60 || freq > 4000) continue; // faixa útil pra afinação musical
        const mag = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
        const midi = 69 + 12 * Math.log2(freq / 440);
        const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
        chroma[pitchClass] += mag;
      }
    }
    return chroma;
  }

  function correlate(a, b) {
    const meanA = a.reduce((s, v) => s + v, 0) / a.length;
    const meanB = b.reduce((s, v) => s + v, 0) / b.length;
    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < a.length; i++) {
      const da = a[i] - meanA, db = b[i] - meanB;
      num += da * db; denA += da * da; denB += db * db;
    }
    const den = Math.sqrt(denA * denB);
    return den === 0 ? 0 : num / den;
  }

  function rotate(profile, steps) {
    const out = new Array(12);
    for (let i = 0; i < 12; i++) out[i] = profile[(i - steps + 12) % 12];
    return out;
  }

  function detectKeyFromChroma(chroma) {
    const total = chroma.reduce((s, v) => s + v, 0);
    if (total <= 0) return null;
    let best = { score: -Infinity, name: null };
    for (let root = 0; root < 12; root++) {
      const sMaj = correlate(chroma, rotate(MAJOR_PROFILE, root));
      const sMin = correlate(chroma, rotate(MINOR_PROFILE, root));
      if (sMaj > best.score) best = { score: sMaj, name: `${NOTE_NAMES[root]} maior` };
      if (sMin > best.score) best = { score: sMin, name: `${NOTE_NAMES[root]} menor` };
    }
    return best.name;
  }

  /* ---------------- BPM detection (energy-peak interval histogram) ---------------- */
  function detectBPM(samples, sampleRate) {
    const winSamples = Math.max(1, Math.floor(sampleRate * 0.01)); // janelas de 10ms
    const winMs = (winSamples / sampleRate) * 1000;
    const energies = [];
    for (let i = 0; i + winSamples <= samples.length; i += winSamples) {
      let sum = 0;
      for (let j = 0; j < winSamples; j++) { const v = samples[i + j]; sum += v * v; }
      energies.push(sum / winSamples);
    }
    if (energies.length < 50) return null;

    const localSpan = Math.max(4, Math.round(430 / winMs)); // ~430ms de contexto local
    const peaks = [];
    for (let i = 0; i < energies.length; i++) {
      const start = Math.max(0, i - localSpan);
      const end = Math.min(energies.length, i + localSpan);
      let avg = 0;
      for (let k = start; k < end; k++) avg += energies[k];
      avg /= (end - start);
      if (energies[i] > avg * 1.3 && energies[i] > 1e-7) peaks.push(i);
    }
    if (peaks.length < 4) return null;

    const minGap = Math.max(1, Math.round(250 / winMs)); // no mínimo 250ms entre batidas (240 BPM teto)
    const filtered = [];
    let last = -Infinity;
    for (const idx of peaks) {
      if (idx - last >= minGap) { filtered.push(idx); last = idx; }
    }
    if (filtered.length < 4) return null;

    const bpmVotes = {};
    for (let i = 1; i < filtered.length; i++) {
      const ms = (filtered[i] - filtered[i - 1]) * winMs;
      if (ms <= 0) continue;
      let bpm = 60000 / ms;
      while (bpm < 70) bpm *= 2;
      while (bpm > 185) bpm /= 2;
      const bucket = Math.round(bpm);
      bpmVotes[bucket] = (bpmVotes[bucket] || 0) + 1;
    }
    let bestBpm = null, bestVotes = 0;
    for (const [bpm, votes] of Object.entries(bpmVotes)) {
      if (votes > bestVotes) { bestVotes = votes; bestBpm = Number(bpm); }
    }
    return bestBpm;
  }

  /* ---------------- entry point ---------------- */
  async function analyze(fileOrBlob) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("Web Audio API indisponível neste navegador.");
    const arrayBuffer = await fileOrBlob.arrayBuffer();
    const ctx = new AudioCtx();
    let audioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    } finally {
      ctx.close().catch(() => {});
    }

    const sampleRate = audioBuffer.sampleRate;
    const numCh = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const mono = new Float32Array(length);
    for (let c = 0; c < numCh; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += data[i] / numCh;
    }

    // limita a análise aos primeiros ~60s (suficiente pra estimar tom/BPM e mais rápido)
    const maxSeconds = 60;
    const maxSamples = Math.min(mono.length, Math.floor(sampleRate * maxSeconds));
    const analysisSamples = maxSamples < mono.length ? mono.subarray(0, maxSamples) : mono;

    const bpm = detectBPM(analysisSamples, sampleRate);
    const chroma = computeChroma(analysisSamples, sampleRate);
    const key = detectKeyFromChroma(chroma);

    return { bpm, key };
  }

  return { analyze };
})();
