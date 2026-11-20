package it.dojotimer.app;

import android.Manifest;
import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.Collections;

public class MainActivity extends BridgeActivity {
  private static final String LIVE_CHANNEL_ID = "dojo_timer_live_v1";
  private static final int LIVE_NOTIFICATION_ID = 1042;
  private static final int REQ_POST_NOTIFICATIONS = 2042;
  private static final String ACTION_TOGGLE_PAUSE = "it.dojotimer.app.ACTION_TOGGLE_PAUSE";

  private boolean timerActive = false;
  private boolean timerRunning = false;
  private boolean timerPaused = false;
  private String timerPhaseLabel = "";
  private String timerRoundLabel = "";
  private String timerTimeText = "00:00";
  private long timerRemainingMs = 0L;
  private int timerAccentColor = Color.parseColor("#FFD600");
  private boolean notificationPermissionRequested = false;
  private boolean receiverRegistered = false;

  private final BroadcastReceiver togglePauseReceiver =
      new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
          if (intent == null || !ACTION_TOGGLE_PAUSE.equals(intent.getAction())) {
            return;
          }
          runOnUiThread(
              () -> {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null) {
                  webView.evaluateJavascript(
                      "(function(){ if (typeof window.__dojoNativeTogglePause === 'function') { window.__dojoNativeTogglePause(); } })()",
                      null);
                }
              });
        }
      };

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      WindowManager.LayoutParams lp = getWindow().getAttributes();
      lp.layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      getWindow().setAttributes(lp);
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
    }
    enforceKeepScreenOn();
    getWindow().setStatusBarColor(Color.BLACK);
    getWindow().setNavigationBarColor(Color.BLACK);
    hideSystemBars();
    ensureLiveNotificationChannel();
    updateRecentsTaskDescription("Dojo Timer");

    if (!receiverRegistered) {
      IntentFilter filter = new IntentFilter(ACTION_TOGGLE_PAUSE);
      ContextCompat.registerReceiver(
          this, togglePauseReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
      receiverRegistered = true;
    }

    if (getBridge() != null && getBridge().getWebView() != null) {
      boolean isDebuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
      WebView.setWebContentsDebuggingEnabled(isDebuggable);
      WebView webView = getBridge().getWebView();
      WebSettings settings = webView.getSettings();
      settings.setTextZoom(100);
      settings.setMediaPlaybackRequiresUserGesture(false);
      settings.setAllowFileAccess(false);
      settings.setAllowFileAccessFromFileURLs(false);
      settings.setAllowUniversalAccessFromFileURLs(false);
      settings.setGeolocationEnabled(false);
      settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
      webView.addJavascriptInterface(new DojoNativeBridge(), "DojoNative");
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      updatePictureInPictureParams();
    }

    getOnBackPressedDispatcher()
        .addCallback(
            this,
            new OnBackPressedCallback(true) {
              @Override
              public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                  moveTaskToBack(true);
                  return;
                }
                webView.evaluateJavascript(
                    "(function(){ return typeof window.__dojoHandleNativeBack === 'function' && window.__dojoHandleNativeBack() === true; })()",
                    value -> {
                      if (!"true".equals(value)) {
                        moveTaskToBack(true);
                      }
                    });
              }
            });
  }

  @Override
  public void onResume() {
    super.onResume();
    if (getBridge() != null && getBridge().getWebView() != null) {
      getBridge().getWebView().getSettings().setTextZoom(100);
    }
    enforceKeepScreenOn();
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N || !isInPictureInPictureMode()) {
      hideSystemBars();
    }
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      enforceKeepScreenOn();
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N || !isInPictureInPictureMode()) {
        hideSystemBars();
      }
    }
  }

  @Override
  protected void onUserLeaveHint() {
    super.onUserLeaveHint();
    // On Android 8..11 (API 26..30), enter PiP explicitly when leaving with an active timer.
    // On Android 12+ (API 31+), setAutoEnterEnabled(true) handles smooth gesture-driven PiP.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        && Build.VERSION.SDK_INT < Build.VERSION_CODES.S
        && timerActive
        && !isInPictureInPictureMode()
        && supportsSystemPip()) {
      try {
        enterPictureInPictureMode(buildPictureInPictureParams());
      } catch (IllegalStateException ignored) {
        // Ignore if activity state does not allow PiP transition
      }
    }
  }

  @Override
  public void onPictureInPictureModeChanged(
      boolean isInPictureInPictureMode, @NonNull Configuration newConfig) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
    notifyWebPipMode(isInPictureInPictureMode);
    if (!isInPictureInPictureMode) {
      enforceKeepScreenOn();
      hideSystemBars();
    }
  }

  @Override
  public void onRequestPermissionsResult(
      int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode == REQ_POST_NOTIFICATIONS
        && grantResults.length > 0
        && grantResults[0] == PackageManager.PERMISSION_GRANTED
        && timerActive) {
      updateTrayNotification();
    }
  }

  @Override
  public void onDestroy() {
    cancelTrayNotification();
    if (receiverRegistered) {
      try {
        unregisterReceiver(togglePauseReceiver);
      } catch (IllegalArgumentException ignored) {
        // Already unregistered
      }
      receiverRegistered = false;
    }
    super.onDestroy();
  }

  private void notifyWebPipMode(boolean isInPip) {
    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
    if (webView == null) {
      return;
    }
    String js =
        "(function(){ if (typeof window.__dojoSetPipMode === 'function') { window.__dojoSetPipMode("
            + (isInPip ? "true" : "false")
            + "); } })()";
    webView.evaluateJavascript(js, null);
  }

  private boolean supportsSystemPip() {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        && getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
  }

  private PendingIntent createTogglePausePendingIntent() {
    Intent intent = new Intent(ACTION_TOGGLE_PAUSE);
    intent.setPackage(getPackageName());
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getBroadcast(this, 101, intent, flags);
  }

  private PendingIntent createOpenAppPendingIntent() {
    Intent intent = new Intent(this, MainActivity.class);
    intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getActivity(this, 102, intent, flags);
  }

  @RequiresApi(api = Build.VERSION_CODES.O)
  private PictureInPictureParams buildPictureInPictureParams() {
    PictureInPictureParams.Builder builder =
        new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 10));

    if (timerActive) {
      boolean showPause = timerRunning && !timerPaused;
      Icon icon =
          Icon.createWithResource(this, showPause ? R.drawable.ic_pip_pause : R.drawable.ic_pip_play);
      String label = showPause ? "Pausa" : "Riprendi";
      RemoteAction toggleAction =
          new RemoteAction(icon, label, label, createTogglePausePendingIntent());
      builder.setActions(Collections.singletonList(toggleAction));
    } else {
      builder.setActions(Collections.emptyList());
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setAutoEnterEnabled(timerActive && !isFinishing());
      builder.setSeamlessResizeEnabled(true);
    }

    return builder.build();
  }

  @RequiresApi(api = Build.VERSION_CODES.O)
  private void updatePictureInPictureParams() {
    if (!supportsSystemPip() || isFinishing() || isDestroyed()) {
      return;
    }
    try {
      setPictureInPictureParams(buildPictureInPictureParams());
    } catch (IllegalStateException | IllegalArgumentException ignored) {
      // Ignore transient window states while transitioning
    }
  }

  private void ensureLiveNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return;
    }
    NotificationManager manager = getSystemService(NotificationManager.class);
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

  private boolean hasNotificationPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return true;
    }
    return ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
        == PackageManager.PERMISSION_GRANTED;
  }

  private void maybeRequestNotificationPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return;
    }
    if (notificationPermissionRequested || hasNotificationPermission()) {
      return;
    }
    notificationPermissionRequested = true;
    ActivityCompat.requestPermissions(
        this, new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_POST_NOTIFICATIONS);
  }

  private void updateTrayNotification() {
    if (!timerActive) {
      cancelTrayNotification();
      return;
    }
    if (!hasNotificationPermission()) {
      maybeRequestNotificationPermission();
      return;
    }

    String title =
        timerRoundLabel.isEmpty()
            ? (timerPhaseLabel.isEmpty() ? "Dojo Timer" : timerPhaseLabel)
            : (timerPhaseLabel.isEmpty()
                ? timerRoundLabel
                : timerPhaseLabel + " • " + timerRoundLabel);

    NotificationCompat.Builder builder =
        new NotificationCompat.Builder(this, LIVE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_dojo_timer)
            .setContentTitle(title)
            .setColor(timerAccentColor)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(createOpenAppPendingIntent());

    if (timerRunning && !timerPaused && timerRemainingMs > 0L) {
      builder
          .setShowWhen(true)
          .setWhen(System.currentTimeMillis() + timerRemainingMs)
          .setUsesChronometer(true)
          .setChronometerCountDown(true)
          .setContentText("Sessione in corso");
    } else if (timerPaused) {
      builder
          .setShowWhen(false)
          .setUsesChronometer(false)
          .setContentText("In pausa • " + timerTimeText);
    } else {
      builder
          .setShowWhen(false)
          .setUsesChronometer(false)
          .setContentText(timerTimeText);
    }

    boolean showPause = timerRunning && !timerPaused;
    builder.addAction(
        showPause ? R.drawable.ic_pip_pause : R.drawable.ic_pip_play,
        showPause ? "Pausa" : "Riprendi",
        createTogglePausePendingIntent());

    try {
      NotificationManagerCompat.from(this).notify(LIVE_NOTIFICATION_ID, builder.build());
    } catch (SecurityException ignored) {
      // Ignore if notification permission was revoked at runtime
    }
  }

  private void cancelTrayNotification() {
    NotificationManagerCompat.from(this).cancel(LIVE_NOTIFICATION_ID);
  }

  @SuppressWarnings("deprecation")
  private void updateRecentsTaskDescription(String label) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      setTaskDescription(
          new ActivityManager.TaskDescription.Builder()
              .setLabel(label)
              .setPrimaryColor(Color.BLACK)
              .build());
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      setTaskDescription(
          new ActivityManager.TaskDescription(label, R.mipmap.ic_launcher, Color.BLACK));
    }
  }

  private static String sanitizeShortText(String raw, int maxLen) {
    if (raw == null) {
      return "";
    }
    String cleaned = raw.replaceAll("[\\p{Cntrl}]", "").trim();
    return cleaned.length() > maxLen ? cleaned.substring(0, maxLen) : cleaned;
  }

  private static int parseSafeHexColor(String raw) {
    if (raw != null && raw.matches("^#[0-9A-Fa-f]{6}$")) {
      try {
        return Color.parseColor(raw);
      } catch (IllegalArgumentException ignored) {
        // Fallback below
      }
    }
    return Color.parseColor("#FFD600");
  }

  private final class DojoNativeBridge {
    @JavascriptInterface
    public void syncTimerState(
        boolean active,
        boolean running,
        boolean paused,
        String phaseLabel,
        String roundLabel,
        String timeText,
        long remainingMs,
        String colorHex) {
      final String safePhase = sanitizeShortText(phaseLabel, 32);
      final String safeRound = sanitizeShortText(roundLabel, 24);
      final String safeTime = sanitizeShortText(timeText, 12);
      final long safeRemaining = Math.max(0L, Math.min(86_400_000L, remainingMs));
      final int safeColor = parseSafeHexColor(colorHex);

      runOnUiThread(
          () -> {
            if (isFinishing() || isDestroyed()) {
              return;
            }
            timerActive = active;
            timerRunning = running;
            timerPaused = paused;
            timerPhaseLabel = safePhase;
            timerRoundLabel = safeRound;
            timerTimeText = safeTime.isEmpty() ? "00:00" : safeTime;
            timerRemainingMs = safeRemaining;
            timerAccentColor = safeColor;

            updateRecentsTaskDescription(
                timerActive && !timerPhaseLabel.isEmpty()
                    ? "Dojo Timer • " + timerPhaseLabel
                    : "Dojo Timer");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
              updatePictureInPictureParams();
            }
            updateTrayNotification();
          });
    }
  }

  private void enforceKeepScreenOn() {
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    getWindow().getDecorView().setKeepScreenOn(true);
    if (getBridge() != null && getBridge().getWebView() != null) {
      getBridge().getWebView().setKeepScreenOn(true);
    }
  }

  private void hideSystemBars() {
    WindowInsetsControllerCompat controller =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    if (controller != null) {
      controller.setSystemBarsBehavior(
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      controller.hide(WindowInsetsCompat.Type.systemBars());
    }
  }
}
