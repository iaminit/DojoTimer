package it.dojotimer.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Process;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Foreground Service dedicato alla cattura audio DIGITALE interna (`AudioPlaybackCapture` / API 29+):
 * - NON apre mai il microfono fisico e NON cattura video/schermo.
 * - ZERO distorsione e ZERO overnoise anche con casse/cuffie Bluetooth A2DP.
 * - Elabora i campioni PCM solo in RAM (16 bande logaritmiche FFT 0..100), senza mai salvare
 *   o trasmettere audio.
 */
public final class DojoAudioCaptureService extends Service {
  public static final String ACTION_START_CAPTURE = "it.dojotimer.app.ACTION_AUDIO_CAPTURE_START";
  public static final String ACTION_STOP_CAPTURE = "it.dojotimer.app.ACTION_AUDIO_CAPTURE_STOP";
  public static final String ACTION_CAPTURE_STATE_CHANGED =
      "it.dojotimer.app.ACTION_AUDIO_CAPTURE_STATE_CHANGED";
  public static final String EXTRA_CAPTURE_ACTIVE = "extra_capture_active";
  public static final String EXTRA_RESULT_CODE = "extra_result_code";
  public static final String EXTRA_RESULT_DATA = "extra_result_data";

  private static final String CHANNEL_ID = "dojo_audio_capture_v1";
  private static final int NOTIFICATION_ID = 1043;
  private static final int SAMPLE_RATE = 48000;
  private static final int FFT_SIZE = 1024;
  private static final String EMPTY_P_PACKET = "P|0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0";

  private static volatile boolean captureActive = false;
  private static volatile String latestPacket = "0|";

  private MediaProjection mediaProjection;
  private volatile AudioRecord activeRecord;
  private Thread captureThread;
  private volatile boolean running = false;

  public static boolean isCaptureActive() {
    return captureActive;
  }

  public static String getLatestPacket() {
    return captureActive ? latestPacket : "0|";
  }

  public static void ensureChannel(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return;
    }
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm == null) {
      return;
    }
    NotificationChannel ch =
        new NotificationChannel(CHANNEL_ID, "VU Meter audio digitale", NotificationManager.IMPORTANCE_LOW);
    ch.setDescription("Analisi spettro digitale in tempo reale senza microfono per il VU meter.");
    ch.setShowBadge(false);
    ch.setSound(null, null);
    ch.enableVibration(false);
    nm.createNotificationChannel(ch);
  }

  private Notification buildCaptureNotification() {
    Intent stopIntent = new Intent(this, DojoAudioCaptureService.class);
    stopIntent.setAction(ACTION_STOP_CAPTURE);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    PendingIntent stopPi = PendingIntent.getService(this, 103, stopIntent, flags);

    return new NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_dojo_timer)
        .setContentTitle("Dojo Timer • VU Meter digitale")
        .setContentText("Analisi spettro audio digitale attiva (senza microfono)")
        .setOngoing(true)
        .setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setContentIntent(DojoTimerForegroundService.createOpenAppPendingIntent(this))
        .addAction(R.drawable.ic_pip_pause, "Ferma", stopPi)
        .build();
  }

  @Override
  public void onCreate() {
    super.onCreate();
    ensureChannel(this);
  }

  @Override
  @SuppressWarnings("deprecation")
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null
        || ACTION_STOP_CAPTURE.equals(intent.getAction())
        || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      teardownAndStop();
      return START_NOT_STICKY;
    }

    int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED);
    Intent resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
    if (resultCode != Activity.RESULT_OK || resultData == null) {
      teardownAndStop();
      return START_NOT_STICKY;
    }

    // Android 14+: startForeground con FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION PRIMA di getMediaProjection
    try {
      ServiceCompat.startForeground(
          this,
          NOTIFICATION_ID,
          buildCaptureNotification(),
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
    } catch (RuntimeException ignored) {
      teardownAndStop();
      return START_NOT_STICKY;
    }

    stopCaptureResourcesOnly();

    try {
      MediaProjectionManager mpm =
          (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
      if (mpm == null) {
        teardownAndStop();
        return START_NOT_STICKY;
      }
      MediaProjection projection = mpm.getMediaProjection(resultCode, resultData);
      if (projection == null) {
        teardownAndStop();
        return START_NOT_STICKY;
      }
      projection.registerCallback(
          new MediaProjection.Callback() {
            @Override
            public void onStop() {
              teardownAndStop();
            }
          },
          new Handler(Looper.getMainLooper()));

      mediaProjection = projection;
      running = true;
      captureActive = true;
      latestPacket = EMPTY_P_PACKET;
      broadcastCaptureState(true);

      Thread worker =
          new Thread(
              () -> {
                Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
                runDigitalCaptureLoop(projection);
              },
              "DojoDigitalCapture");
      worker.setDaemon(true);
      captureThread = worker;
      worker.start();
    } catch (RuntimeException ignored) {
      teardownAndStop();
    }

    return START_NOT_STICKY;
  }

  private void runDigitalCaptureLoop(MediaProjection projection) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      return;
    }
    AudioRecord record = null;
    try {
      AudioPlaybackCaptureConfiguration config =
          new AudioPlaybackCaptureConfiguration.Builder(projection)
              .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
              .addMatchingUsage(AudioAttributes.USAGE_GAME)
              .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
              .build();

      int minBuf =
          AudioRecord.getMinBufferSize(
              SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
      if (minBuf <= 0) {
        return;
      }
      int bufSize = Math.max(minBuf * 2, FFT_SIZE * 4);

      record =
          new AudioRecord.Builder()
              .setAudioFormat(
                  new AudioFormat.Builder()
                      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                      .setSampleRate(SAMPLE_RATE)
                      .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                      .build())
              .setBufferSizeInBytes(bufSize)
              .setAudioPlaybackCaptureConfig(config)
              .build();

      if (record.getState() != AudioRecord.STATE_INITIALIZED) {
        return;
      }
      activeRecord = record;

      short[] pcm = new short[FFT_SIZE];
      float[] re = new float[FFT_SIZE];
      float[] im = new float[FFT_SIZE];
      float[] hann = new float[FFT_SIZE];
      for (int i = 0; i < FFT_SIZE; i++) {
        hann[i] = (float) (0.5 * (1.0 - Math.cos(2.0 * Math.PI * i / (FFT_SIZE - 1))));
      }
      float[] rawBands = new float[DojoDigitalSpectrumEngine.BAND_COUNT];
      float[] smoothBands = new float[DojoDigitalSpectrumEngine.BAND_COUNT];
      float[] agcRef = new float[] {6f};

      record.startRecording();
      while (running) {
        int read = record.read(pcm, 0, FFT_SIZE);
        if (read < FFT_SIZE) {
          if (read < 0) {
            break;
          }
          continue;
        }

        double energy = 0.0;
        for (int i = 0; i < FFT_SIZE; i++) {
          float sample = (pcm[i] / 32768f) * hann[i];
          re[i] = sample;
          im[i] = 0f;
          energy += sample * sample;
        }
        float rms = (float) Math.sqrt(energy / FFT_SIZE);
        if (rms < 0.0008f) {
          for (int b = 0; b < DojoDigitalSpectrumEngine.BAND_COUNT; b++) {
            rawBands[b] = 0f;
          }
          latestPacket =
              DojoDigitalSpectrumEngine.formatNormalizedPacket(
                  'P', rawBands, true, 3.5f, agcRef, smoothBands);
          continue;
        }

        DojoDigitalSpectrumEngine.fftRadix2(re, im);

        int half = FFT_SIZE / 2;
        for (int b = 0; b < DojoDigitalSpectrumEngine.BAND_COUNT; b++) {
          int start = DojoDigitalSpectrumEngine.LOG_BIN_EDGES_512[b];
          int end = Math.min(half, Math.max(start + 1, DojoDigitalSpectrumEngine.LOG_BIN_EDGES_512[b + 1]));
          float sum = 0f;
          int count = 0;
          for (int k = start; k < end; k++) {
            sum += (float) Math.hypot(re[k], im[k]);
            count++;
          }
          float tilt = 1f + (b / (float) DojoDigitalSpectrumEngine.BAND_COUNT) * 1.5f;
          rawBands[b] = (count > 0 ? (sum / count) : 0f) * tilt;
        }
        latestPacket =
            DojoDigitalSpectrumEngine.formatNormalizedPacket(
                'P', rawBands, false, 3.5f, agcRef, smoothBands);
      }
    } catch (RuntimeException ignored) {
      // Cattura interrotta o permesso revocato
    } finally {
      activeRecord = null;
      if (record != null) {
        try {
          record.stop();
        } catch (RuntimeException ignored) {
          // Ignore
        }
        try {
          record.release();
        } catch (RuntimeException ignored) {
          // Ignore
        }
      }
      if (running) {
        new Handler(Looper.getMainLooper()).post(this::teardownAndStop);
      }
    }
  }

  private void broadcastCaptureState(boolean active) {
    try {
      Intent stateIntent = new Intent(ACTION_CAPTURE_STATE_CHANGED);
      stateIntent.setPackage(getPackageName());
      stateIntent.putExtra(EXTRA_CAPTURE_ACTIVE, active);
      sendBroadcast(stateIntent);
    } catch (RuntimeException ignored) {
      // Ignore broadcast errors during teardown
    }
  }

  private void stopCaptureResourcesOnly() {
    running = false;
    captureActive = false;
    latestPacket = "0|";

    AudioRecord rec = activeRecord;
    if (rec != null) {
      try {
        rec.stop();
      } catch (RuntimeException ignored) {
        // Ignore
      }
    }
    Thread t = captureThread;
    captureThread = null;
    if (t != null) {
      t.interrupt();
    }
    MediaProjection proj = mediaProjection;
    mediaProjection = null;
    if (proj != null) {
      try {
        proj.stop();
      } catch (RuntimeException ignored) {
        // Ignore
      }
    }
  }

  private void teardownAndStop() {
    stopCaptureResourcesOnly();
    broadcastCaptureState(false);
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
    } catch (RuntimeException ignored) {
      // Ignore
    }
    stopSelf();
  }

  @Override
  public void onDestroy() {
    stopCaptureResourcesOnly();
    broadcastCaptureState(false);
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
    } catch (RuntimeException ignored) {
      // Ignore
    }
    super.onDestroy();
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    teardownAndStop();
    super.onTaskRemoved(rootIntent);
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
