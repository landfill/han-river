// Deterministic two-cascade finite-depth Phillips spectrum, inverse FFT on CPU.
// A deliberately smaller river spectrum than the six GPU cascades in web-ocean.
export function seededRandom(seed = 821) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
export function inverseFFT(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (2 * Math.PI) / len,
      wr0 = Math.cos(angle),
      wi0 = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1,
        wi = 0;
      for (let j = 0; j < len / 2; j++) {
        let a = i + j,
          b = a + len / 2;
        const vr = re[b] * wr - im[b] * wi,
          vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const next = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0;
        wr = next;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] /= n;
  }
}
export class WaveCascade {
  constructor({ n = 64, length = 96, height = 0.065, seed = 12 } = {}) {
    Object.assign(this, { n, length, height });
    const count = n * n;
    this.h0r = new Float32Array(count);
    this.h0i = new Float32Array(count);
    this.omega = new Float32Array(count);
    this.re = new Float32Array(count);
    this.im = new Float32Array(count);
    this.rowR = new Float64Array(n);
    this.rowI = new Float64Array(n);
    this.data = new Float32Array(count * 4);
    const random = seededRandom(seed),
      L = (3.6 * 3.6) / 9.81;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const idx = j * n + i,
          kx = (2 * Math.PI * (i < n / 2 ? i : i - n)) / length,
          kz = (2 * Math.PI * (j < n / 2 ? j : j - n)) / length,
          k = Math.hypot(kx, kz);
        if (!k) continue;
        const directional = (kx * 0.86 + kz * 0.5) / k;
        const spectrum =
          (Math.exp(-1 / (k * L) ** 2) / k ** 4) *
          (0.15 + 0.85 * directional * directional) *
          Math.exp(-k * k * 0.003);
        const r = Math.sqrt(-2 * Math.log(Math.max(1e-8, random()))),
          theta = random() * Math.PI * 2,
          amplitude = Math.sqrt(spectrum * 0.5);
        this.h0r[idx] = r * Math.cos(theta) * amplitude;
        this.h0i[idx] = r * Math.sin(theta) * amplitude;
        this.omega[idx] = Math.sqrt((9.81 * k + 0.000074 * k ** 3) * Math.tanh(k * 8));
      }
    this.scale = 1;
    this.update(0);
    let rms = 0;
    for (let i = 0; i < count; i++) rms += this.re[i] ** 2;
    this.scale = height / Math.sqrt(rms / count);
    this.update(0);
  }
  update(t) {
    const { n, re, im } = this;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i,
          mirror = ((n - j) % n) * n + ((n - i) % n),
          a = this.omega[k] * t,
          c = Math.cos(a),
          s = Math.sin(a);
        re[k] = (this.h0r[k] + this.h0r[mirror]) * c - (this.h0i[k] + this.h0i[mirror]) * s;
        im[k] = (this.h0r[k] - this.h0r[mirror]) * s + (this.h0i[k] - this.h0i[mirror]) * c;
      }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.rowR[i] = re[j * n + i];
        this.rowI[i] = im[j * n + i];
      }
      inverseFFT(this.rowR, this.rowI, n);
      for (let i = 0; i < n; i++) {
        re[j * n + i] = this.rowR[i];
        im[j * n + i] = this.rowI[i];
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        this.rowR[j] = re[j * n + i];
        this.rowI[j] = im[j * n + i];
      }
      inverseFFT(this.rowR, this.rowI, n);
      for (let j = 0; j < n; j++) {
        re[j * n + i] = this.rowR[j];
        im[j * n + i] = this.rowI[j];
      }
    }
    const s = this.scale,
      step = this.length / n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        this.data[k * 4] =
          (-(re[j * n + ((i + 1) % n)] - re[j * n + ((i + n - 1) % n)]) * s) / (2 * step);
        this.data[k * 4 + 1] = 1;
        this.data[k * 4 + 2] =
          (-(re[((j + 1) % n) * n + i] - re[((j + n - 1) % n) * n + i]) * s) / (2 * step);
        this.data[k * 4 + 3] = re[k] * s;
      }
    return this.data;
  }
}
