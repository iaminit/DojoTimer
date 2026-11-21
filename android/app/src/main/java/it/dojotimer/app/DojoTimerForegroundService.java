package it.dojotimer.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Foreground Service dedicato alle sessioni timer attive su Android:
 * - Mostra il logo Dojo Timer nella tray bar + notifica live con Chronometer nativo.
 * - Mantiene un PARTIAL_WAKE_LOCK solo mentre il timer scorre (rilasciato in pausa o chiusura)
 *   così i segnali audio/gong scattano puntuali anche a schermo spento o con cassa Bluetooth.
 */
public class DojoTimerForegroundService extends Service {
  public static final String LIVE_CHANNEL_ID = "dojo_timer_live_v1";
  public static final int LIVE_NOTIFICATION_ID = 1042;
  public static final String ACTION_TOGGLE_PAUSE = "it.dojotimer.app.ACTION_TOGGLE_PAUSE";

  public static final String ACTION_START_OR_UPDATE = "it.dojotimer.app.ACTION_TIMER_SERVICE_UPDATE";
  public static final String ACTION_STOP = "it.dojotimer.app.ACTION_TIMER_SERVICE_STOP";

  public static final String EXTRA_RUNNING = "extra_running";
  public static final String EXTRA_PAUSED = "extra_paused";
  public static final String EXTRA_PHASE_LABEL = "extra_phase_label";
  public static final String EXTRA_ROUND_LABEL = "extra_round_label";
  public static final String EXTRA_TIME_TEXT = "extra_time_text";
  public static final String EXTRA_REMAINING_MS = "extra_remaining_ms";
  public static final String EXTRA_ACCENT_COLOR = "extra_accent_color";

  private static final long MAX_WAKELOCK_MS = 4L * 60L * 60L * 1000L; // 4h safety cap

  private PowerManager.WakeLock partialWakeLock;

  public static void ensureNotificationChannel(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return;
    }
    NotificationManager manager = context.getSystemService(NotificationManager.class);
    if (manager == null) {
      return;
    }
    NotificationChannel channel =
        new NotificationChannel(
            LIVE_CHANNEL_ID, "Timer attivo", NotificationManager.IMPORTANCE_LOW);
    channel.setDescription("Mostra l'icona Dojo Timer nella barra di stato e il timer in corso.");
    channel.setShowBadge(false);
    channel.setSound(null, null);
    channel.enableVibration(false);
    channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
    manager.createNotificationChannel(channel);
  }

  public static PendingIntent createTogglePausePendingIntent(Context context) {
    Intent intent = new Intent(ACTION_TOGGLE_PAUSE);
    intent.setPackage(context.getPackageName());
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getBroadcast(context, 101, intent, flags);
  }

  public static PendingIntent createOpenAppPendingIntent(Context context) {
    Intent intent = new Intent(context, MainActivity.class);
    intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getActivity(context, 102, intent, flags);
  }

  public static Notification buildLiveNotification(
      Context context,
      boolean running,
      boolean paused,
      String phaseLabel,
      String roundLabel,
      String timeText,
      long remainingMs,
      int accentColor) {
    String safePhase = phaseLabel != null ? phaseLabel : "";
    String safeRound = roundLabel != null ? roundLabel : "";
    String safeTime = (timeText != null && !timeText.isEmpty()) ? timeText : "00:00";

    String title =
        safeRound.isEmpty()
            ? (safePhase.isEmpty() ? "Dojo Timer" : safePhase)
            : (safePhase.isEmpty() ? safeRound : safePhase + " • " + safeRound);

    NotificationCompat.Builder builder =
        new NotificationCompat.Builder(context, LIVE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_dojo_timer)
            .setContentTitle(title)
            .setColor(accentColor)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(createOpenAppPendingIntent(context));

    if (running && !paused && remainingMs > 0L) {
      builder
          .setShowWhen(true)
          .setWhen(System.currentTimeMillis() + remainingMs)
          .setUsesChronometer(true)
          .setChronometerCountDown(true)
          .setContentText("Sessione in corso");
    } else if (paused) {
      builder
          .setShowWhen(false)
          .setUsesChronometer(false)
          .setContentText("In pausa • " + safeTime);
    } else {
      builder
          .setShowWhen(false)
          .setUsesChronometer(false)
          .setContentText(safeTime);
    }

    boolean showPause = running && !paused;
    builder.addAction(
        showPause ? R.drawable.ic_pip_pause : R.drawable.ic_pip_play,
        showPause ? "Pausa" : "Riprendi",
        createTogglePausePendingIntent(context));

    return builder.build();
  }

  @Override
  public void onCreate() {
    super.onCreate();
    ensureNotificationChannel(this);
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null || ACTION_STOP.equals(intent.getAction())) {
      releasePartialWakeLock();
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
      stopSelf();
      return START_NOT_STICKY;
    }

    boolean running = intent.getBooleanExtra(EXTRA_RUNNING, false);
    boolean paused = intent.getBooleanExtra(EXTRA_PAUSED, false);
    String phaseLabel = intent.getStringExtra(EXTRA_PHASE_LABEL);
    String roundLabel = intent.getStringExtra(EXTRA_ROUND_LABEL);
    String timeText = intent.getStringExtra(EXTRA_TIME_TEXT);
    long remainingMs = Math.max(0L, intent.getLongExtra(EXTRA_REMAINING_MS, 0L));
    int accentColor = intent.getIntExtra(EXTRA_ACCENT_COLOR, Color.parseColor("#FFD600"));

    Notification notification =
        buildLiveNotification(
            this, running, paused, phaseLabel, roundLabel, timeText, remainingMs, accentColor);

    int fgsType =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            : 0;
    ServiceCompat.startForeground(this, LIVE_NOTIFICATION_ID, notification, fgsType);

    if (running && !paused) {
      acquirePartialWakeLock();
    } else {
      releasePartialWakeLock();
    }

    return START_NOT_STICKY;
  }

  @Override
  public void onDestroy() {
    releasePartialWakeLock();
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
    super.onDestroy();
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    releasePartialWakeLock();
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
    stopSelf();
    super.onTaskRemoved(rootIntent);
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  private void acquirePartialWakeLock() {
    try {
      if (partialWakeLock == null) {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
          partialWakeLock =
              pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DojoTimer:ActiveSession");
          partialWakeLock.setReferenceCounted(false);
        }
      }
      if (partialWakeLock != null && !partialWakeLock.isHeld()) {
        partialWakeLock.acquire(MAX_WAKELOCK_MS);
      }
    } catch (RuntimeException ignored) {
      // Gracefully continue if WakeLock cannot be acquired
    }
  }

  private void releasePartialWakeLock() {
    try {
      if (partialWakeLock != null && partialWakeLock.isHeld()) {
        partialWakeLock.release();
      }
    } catch (RuntimeException ignored) {
      // Ignore already released WakeLock
    }
  }
}
