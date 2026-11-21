package it.dojotimer.app;

import android.media.audiofx.Visualizer;
import android.os.SystemClock;

/**
 * Motore di analisi spettrale 100% digitale (ZERO microfono fisico, ZERO distorsione):
 * - Aggancia `Visualizer(sessionId)` allo specifico `audioSessionId` esposto dai player musicali
 *   tramite `AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION`.
 * - Se nessuna sessione esterna è nota (o se il player non ha inviato broadcast), usa `Visualizer(0)`.
 * - Fornisce inoltre l'utility condivisa FFT radix-2 a 1024 punti + normalizzazione logaritmica
 *   a 16 bande usata anche da `DojoAudioCaptureService` (`AudioPlaybackCapture`).
 */
public final class DojoDigitalSpectrumEngine {
  public static final int BAND_COUNT = 16;
  private static final long RESTART_COOLDOWN_MS = 2000L;
  private static final String EMPTY_V_PACKET = "V|0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0";

  // Confini logaritmici per 16 bande su Visualizer (128 bin)
  private static final int[] LOG_BIN_EDGES_128 = {
    1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36, 48, 63, 81, 102, 120, 127
  };

  // Confini logaritmici musicali (60 Hz .. 16 kHz) per FFT 1024 punti @ 48 kHz (512 bin)
  public static final int[] LOG_BIN_EDGES_512 = {
    1, 2, 3, 5, 7, 10, 14, 20, 28, 39, 54, 75, 104, 144, 198, 272, 360
  };

  private Visualizer visualizer;
  private byte[] fftBuffer;
  private int attachedSessionId = -1;
  private volatile int preferredSessionId = 0;
  private volatile boolean running = false;
  private volatile String latestPacket = "0|";
  private int consecutiveReadErrors = 0;
  private long lastRestartAttemptMs = 0L;

  private float rollingAgcPeak = 14f;
  private final float[] smoothBands = new float[BAND_COUNT];

  public synchronized boolean isRunning() {
    return running;
  }

  public synchronized void setExternalAudioSessionId(int sessionId) {
    int safeId = sessionId > 0 ? sessionId : 0;
    if (preferredSessionId == safeId) {
      return;
    }
    preferredSessionId = safeId;
    if (running && attachedSessionId != preferredSessionId) {
      tryAttachBestVisualizerLocked();
    }
  }

  public synchronized void clearExternalAudioSessionId(int sessionId) {
    if (sessionId > 0 && preferredSessionId == sessionId) {
      preferredSessionId = 0;
      if (running && attachedSessionId != 0) {
        tryAttachBestVisualizerLocked();
      }
    }
  }

  public synchronized void start() {
    if (running) {
      return;
    }
    running = true;
    consecutiveReadErrors = 0;
    rollingAgcPeak = 14f;
    for (int i = 0; i < BAND_COUNT; i++) {
      smoothBands[i] = 0f;
    }
    if (tryAttachBestVisualizerLocked()) {
      latestPacket = EMPTY_V_PACKET;
    } else {
      running = false;
      latestPacket = "0|";
    }
  }

  public synchronized void stop() {
    running = false;
    consecutiveReadErrors = 0;
    releaseVisualizerLocked();
    latestPacket = "0|";
  }

  public synchronized String getLatestPacket() {
    if (!running) {
      return "0|";
    }
    if (visualizer == null || fftBuffer == null) {
      long now = SystemClock.elapsedRealtime();
      if (now - lastRestartAttemptMs >= RESTART_COOLDOWN_MS) {
        lastRestartAttemptMs = now;
        tryAttachBestVisualizerLocked();
      }
      return latestPacket;
    }

    try {
      int status = visualizer.getFft(fftBuffer);
      if (status != Visualizer.SUCCESS) {
        consecutiveReadErrors++;
        if (consecutiveReadErrors >= 3) {
          long now = SystemClock.elapsedRealtime();
          if (now - lastRestartAttemptMs >= RESTART_COOLDOWN_MS) {
            lastRestartAttemptMs = now;
            consecutiveReadErrors = 0;
            tryAttachBestVisualizerLocked();
          }
        }
        return latestPacket;
      }
      consecutiveReadErrors = 0;
      processVisualizerFftLocked(fftBuffer);
      return latestPacket;
    } catch (RuntimeException ignored) {
      releaseVisualizerLocked();
      latestPacket = "0|";
      return latestPacket;
    }
  }

  private boolean tryAttachBestVisualizerLocked() {
    releaseVisualizerLocked();
    int target = preferredSessionId;
    if (target > 0 && tryOpenVisualizerForSessionLocked(target)) {
      return true;
    }
    return tryOpenVisualizerForSessionLocked(0);
  }

  private boolean tryOpenVisualizerForSessionLocked(int sessionId) {
    try {
      Visualizer vis = new Visualizer(sessionId);
      int[] range = Visualizer.getCaptureSizeRange();
      int captureSize = Math.min(Math.max(256, range[0]), range[1]);
      vis.setCaptureSize(captureSize);
      vis.setScalingMode(Visualizer.SCALING_MODE_NORMALIZED);
      vis.setEnabled(true);
      this.visualizer = vis;
      this.fftBuffer = new byte[captureSize];
      this.attachedSessionId = sessionId;
      return true;
    } catch (RuntimeException ignored) {
      releaseVisualizerLocked();
      return false;
    }
  }

  private void processVisualizerFftLocked(byte[] fft) {
    int binCount = fft.length / 2;
    if (binCount < 16) {
      return;
    }
    float[] raw = new float[BAND_COUNT];
    float maxBinMag = 0f;

    for (int b = 0; b < BAND_COUNT; b++) {
      int start = Math.max(1, (LOG_BIN_EDGES_128[b] * binCount) / 128);
      int end =
          Math.min(
              binCount - 1, Math.max(start + 1, (LOG_BIN_EDGES_128[b + 1] * binCount) / 128));
      float sum = 0f;
      int count = 0;
      for (int k = start; k < end; k++) {
        float re = fft[2 * k];
        float im = fft[2 * k + 1];
        float mag = (float) Math.hypot(re, im);
        sum += mag;
        count++;
        if (mag > maxBinMag) {
          maxBinMag = mag;
        }
      }
      raw[b] = count > 0 ? (sum / count) : 0f;
    }

    boolean silent = maxBinMag < 0.8f;
    float[] agcState = new float[] {rollingAgcPeak};
    latestPacket = formatNormalizedPacket('V', raw, silent, 8f, agcState, smoothBands);
    rollingAgcPeak = agcState[0];
  }

  private void releaseVisualizerLocked() {
    if (visualizer != null) {
      try {
        visualizer.setEnabled(false);
      } catch (RuntimeException ignored) {
        // Ignore
      }
      try {
        visualizer.release();
      } catch (RuntimeException ignored) {
        // Ignore
      }
      visualizer = null;
    }
    fftBuffer = null;
    attachedSessionId = -1;
  }

  public static String formatNormalizedPacket(
      char modeChar,
      float[] raw,
      boolean silentFrame,
      float agcFloor,
      float[] rollingAgcPeakRef,
      float[] smoothBands) {
    float frameMax = 0f;
    for (int i = 0; i < BAND_COUNT; i++) {
      if (raw[i] > frameMax) {
        frameMax = raw[i];
      }
    }

    float agc = rollingAgcPeakRef[0];
    if (!silentFrame && frameMax > agc) {
      agc = agc * 0.65f + frameMax * 0.35f;
    } else {
      agc = Math.max(agcFloor, agc * 0.985f);
    }
    rollingAgcPeakRef[0] = agc;

    StringBuilder sb = new StringBuilder(64);
    sb.append(modeChar).append('|');
    float denom = (float) Math.log1p(agc * 1.15f);
    for (int i = 0; i < BAND_COUNT; i++) {
      float norm =
          (!silentFrame && denom > 0.001f) ? (float) (Math.log1p(raw[i] * 1.4f) / denom) : 0f;
      if (norm < 0.05f) {
        norm = 0f;
      } else if (norm > 1f) {
        norm = 1f;
      }
      float prev = smoothBands[i];
      float next = norm > prev ? prev + (norm - prev) * 0.72f : Math.max(0f, prev - 0.14f);
      smoothBands[i] = next;

      if (i > 0) {
        sb.append(',');
      }
      sb.append(Math.round(next * 100f));
    }
    return sb.toString();
  }

  public static void fftRadix2(float[] re, float[] im) {
    int n = re.length;
    for (int i = 1, j = 0; i < n; i++) {
      int bit = n >> 1;
      for (; (j & bit) != 0; bit >>= 1) {
        j ^= bit;
      }
      j ^= bit;
      if (i < j) {
        float tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        float ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }

    for (int len = 2; len <= n; len <<= 1) {
      double angle = -2.0 * Math.PI / len;
      float wLenRe = (float) Math.cos(angle);
      float wLenIm = (float) Math.sin(angle);
      int half = len >> 1;
      for (int i = 0; i < n; i += len) {
        float wRe = 1f;
        float wIm = 0f;
        for (int j = 0; j < half; j++) {
          int u = i + j;
          int v = u + half;
          float tRe = re[v] * wRe - im[v] * wIm;
          float tIm = re[v] * wIm + im[v] * wRe;
          re[v] = re[u] - tRe;
          im[v] = im[u] - tIm;
          re[u] += tRe;
          im[u] += tIm;
          float nextWRe = wRe * wLenRe - wIm * wLenIm;
          wIm = wRe * wLenIm + wIm * wLenRe;
          wRe = nextWRe;
        }
      }
    }
  }
}
