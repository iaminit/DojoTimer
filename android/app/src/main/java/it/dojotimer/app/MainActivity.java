package it.dojotimer.app;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.Notification;
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
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.audiofx.AudioEffect;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Rational;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
  private static final int REQ_POST_NOTIFICATIONS = 2042;
  private static final int REQ_RECORD_AUDIO = 2043;
  private static final String ACTION_TOGGLE_PAUSE = DojoTimerForegroundService.ACTION_TOGGLE_PAUSE;
  private static final String OFFICIAL_VERSION_MANIFEST_BASE_URL =
      "https://1ms.it/timer/version.json";
  private static final String OFFICIAL_APK_URL = "https://1ms.it/timer/DojoTimer.apk";

  private static final String VU_MODE_OFF = "OFF";
  private static final String VU_MODE_LOCAL = "LOCAL_PLAYER";
  private static final String VU_MODE_SESSION = "SESSION_VISUALIZER";
  private static final String VU_MODE_CAPTURE = "PLAYBACK_CAPTURE";

  private boolean timerActive = false;
  private boolean timerRunning = false;
  private boolean timerPaused = false;
  private String timerPhaseLabel = "";
  private String timerRoundLabel = "";
  private String timerTimeText = "00:00";
  private long timerRemainingMs = 0L;
  private int timerAccentColor = Color.parseColor("#FFD600");
  private String vuMeterMode = VU_MODE_LOCAL;
  private boolean activityVisible = false;
  private boolean notificationPermissionRequested = false;
  private boolean sessionPermissionRequested = false;
  private boolean permissionRequestInFlight = false;
  private boolean pendingPlaybackCaptureAfterPerm = false;
  private boolean pendingSessionPermAfterNotif = false;
  private boolean receiverRegistered = false;
  private boolean audioSessionReceiverRegistered = false;
  private boolean foregroundServiceRunning = false;

  private AudioManager audioManager;
  private DojoDigitalSpectrumEngine digitalSpectrumEngine;
  private AudioFocusRequest activeAudioFocusRequest;
  private ActivityResultLauncher<Intent> mediaProjectionLauncher;
  private final AtomicBoolean updateCheckInFlight = new AtomicBoolean(false);
  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final Runnable abandonDuckFocusRunnable = this::abandonAudioDuckFocus;
  private final AudioManager.OnAudioFocusChangeListener noopAudioFocusListener = focusChange -> {};

  private final BroadcastReceiver togglePauseReceiver =
      new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
          if (intent == null || !ACTION_TOGGLE_PAUSE.equals(intent.getAction())) {
            return;
          }
          runOnUiThread(
              () -> {
                WebView webView = getTrustedWebView();
                if (webView != null) {
                  webView.evaluateJavascript(
                      "(function(){ if (typeof window.__dojoNativeTogglePause === 'function') { window.__dojoNativeTogglePause(); } })()",
                      null);
                }
              });
        }
      };

  // Riceve gli `audioSessionId` esposti dai player musicali esterni (Spotify/YT Music/VLC/ecc.)
  private final BroadcastReceiver audioSessionReceiver =
      new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
          if (intent == null || digitalSpectrumEngine == null) {
            return;
          }
          String pkg = intent.getStringExtra(AudioEffect.EXTRA_PACKAGE_NAME);
          if (getPackageName().equals(pkg)) {
            return;
          }
          int sessionId = intent.getIntExtra(AudioEffect.EXTRA_AUDIO_SESSION, 0);
          if (sessionId <= 0) {
            return;
          }
          String action = intent.getAction();
          if (AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION.equals(action)) {
            digitalSpectrumEngine.setExternalAudioSessionId(sessionId);
          } else if (AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION.equals(action)) {
            digitalSpectrumEngine.clearExternalAudioSessionId(sessionId);
          }
        }
      };

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
    digitalSpectrumEngine = new DojoDigitalSpectrumEngine();

    mediaProjectionLauncher =
        registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
              if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                startPlaybackCaptureService(result.getResultCode(), result.getData());
                notifyWebCaptureState(true);
              } else {
                notifyWebCaptureState(DojoAudioCaptureService.isCaptureActive());
              }
            });

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
    DojoTimerForegroundService.ensureNotificationChannel(this);
    DojoAudioCaptureService.ensureChannel(this);
    updateRecentsTaskDescription("Dojo Timer");

    if (!receiverRegistered) {
      IntentFilter filter = new IntentFilter(ACTION_TOGGLE_PAUSE);
      ContextCompat.registerReceiver(
          this, togglePauseReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
      receiverRegistered = true;
    }

    if (!audioSessionReceiverRegistered) {
      IntentFilter sessionFilter = new IntentFilter();
      sessionFilter.addAction(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION);
      sessionFilter.addAction(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION);
      ContextCompat.registerReceiver(
          this, audioSessionReceiver, sessionFilter, ContextCompat.RECEIVER_EXPORTED);
      audioSessionReceiverRegistered = true;
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
      // Hardening difesa in profondità: nega esplicitamente qualsiasi richiesta WebView
      // (microfono/camera/MIDI/DRM) perché Dojo Timer non usa mai getUserMedia.
      webView.setWebChromeClient(
          new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
              if (request != null) {
                request.deny();
              }
            }
          });
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
                WebView webView = getTrustedWebView();
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
    activityVisible = true;
    if (getBridge() != null && getBridge().getWebView() != null) {
      getBridge().getWebView().getSettings().setTextZoom(100);
    }
    enforceKeepScreenOn();
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N || !isInPictureInPictureMode()) {
      hideSystemBars();
    }
    syncDigitalVisualizerState();
    notifyWebCaptureState(DojoAudioCaptureService.isCaptureActive());
  }

  @Override
  public void onStop() {
    activityVisible = false;
    if (digitalSpectrumEngine != null) {
      digitalSpectrumEngine.stop();
    }
    super.onStop();
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
    if (requestCode == REQ_POST_NOTIFICATIONS || requestCode == REQ_RECORD_AUDIO) {
      permissionRequestInFlight = false;
    }
    if (requestCode == REQ_POST_NOTIFICATIONS) {
      if (grantResults.length > 0
          && grantResults[0] == PackageManager.PERMISSION_GRANTED
          && timerActive) {
        updateTrayNotificationAndService();
      }
      if (pendingPlaybackCaptureAfterPerm && !hasRecordAudioPermission()) {
        maybeRequestRecordAudioPermission(true);
      } else if (pendingSessionPermAfterNotif && VU_MODE_SESSION.equals(vuMeterMode) && timerActive) {
        pendingSessionPermAfterNotif = false;
        maybeRequestRecordAudioPermission(false);
      }
    } else if (requestCode == REQ_RECORD_AUDIO) {
      if (grantResults.length == 0) {
        sessionPermissionRequested = false;
        return;
      }
      boolean granted = grantResults[0] == PackageManager.PERMISSION_GRANTED;
      if (pendingPlaybackCaptureAfterPerm) {
        pendingPlaybackCaptureAfterPerm = false;
        if (granted) {
          launchMediaProjectionConsent();
        }
      } else if (granted && VU_MODE_SESSION.equals(vuMeterMode)) {
        syncDigitalVisualizerState();
      }
    }
  }

  @Override
  public void onDestroy() {
    mainHandler.removeCallbacks(abandonDuckFocusRunnable);
    abandonAudioDuckFocus();
    if (digitalSpectrumEngine != null) {
      digitalSpectrumEngine.stop();
    }
    stopPlaybackCaptureService();
    stopTrayServiceAndNotification();
    if (receiverRegistered) {
      try {
        unregisterReceiver(togglePauseReceiver);
      } catch (IllegalArgumentException ignored) {
        // Already unregistered
      }
      receiverRegistered = false;
    }
    if (audioSessionReceiverRegistered) {
      try {
        unregisterReceiver(audioSessionReceiver);
      } catch (IllegalArgumentException ignored) {
        // Already unregistered
      }
      audioSessionReceiverRegistered = false;
    }
    super.onDestroy();
  }

  /** Restituisce la WebView solo se l'URL attivo appartiene all'origin locale dell'app Capacitor. */
  private WebView getTrustedWebView() {
    if (getBridge() == null) {
      return null;
    }
    WebView webView = getBridge().getWebView();
    if (webView == null) {
      return null;
    }
    String url = webView.getUrl();
    if (url == null) {
      return null;
    }
    boolean isLocalOrigin =
        url.equals("https://localhost")
            || url.startsWith("https://localhost/")
            || url.equals("capacitor://localhost")
            || url.startsWith("capacitor://localhost/");
    return isLocalOrigin ? webView : null;
  }

  private void notifyWebPipMode(boolean isInPip) {
    WebView webView = getTrustedWebView();
    if (webView == null) {
      return;
    }
    String js =
        "(function(){ if (typeof window.__dojoSetPipMode === 'function') { window.__dojoSetPipMode("
            + (isInPip ? "true" : "false")
            + "); } })()";
    webView.evaluateJavascript(js, null);
  }

  private void notifyWebCaptureState(boolean active) {
    WebView webView = getTrustedWebView();
    if (webView == null) {
      return;
    }
    String js =
        "(function(){ if (typeof window.__dojoSetPlaybackCaptureActive === 'function') { window.__dojoSetPlaybackCaptureActive("
            + (active ? "true" : "false")
            + "); } })()";
    webView.evaluateJavascript(js, null);
  }

  private boolean supportsSystemPip() {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        && getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
  }

  @RequiresApi(api = Build.VERSION_CODES.O)
  private PictureInPictureParams buildPictureInPictureParams() {
    PictureInPictureParams.Builder builder =
        new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 10));

    if (timerActive) {
      boolean showPause = timerRunning && !timerPaused;
      Icon icon =
          Icon.createWithResource(
              this, showPause ? R.drawable.ic_pip_pause : R.drawable.ic_pip_play);
      String label = showPause ? "Pausa" : "Riprendi";
      RemoteAction toggleAction =
          new RemoteAction(
              icon,
              label,
              label,
              DojoTimerForegroundService.createTogglePausePendingIntent(this));
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
    if (notificationPermissionRequested || permissionRequestInFlight || hasNotificationPermission()) {
      return;
    }
    notificationPermissionRequested = true;
    permissionRequestInFlight = true;
    ActivityCompat.requestPermissions(
        this, new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_POST_NOTIFICATIONS);
  }

  private boolean hasRecordAudioPermission() {
    return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
        == PackageManager.PERMISSION_GRANTED;
  }

  private void maybeRequestRecordAudioPermission(boolean forcePrompt) {
    if (hasRecordAudioPermission()) {
      return;
    }
    if (!forcePrompt && sessionPermissionRequested) {
      return;
    }
    if (permissionRequestInFlight) {
      if (!pendingPlaybackCaptureAfterPerm) {
        pendingSessionPermAfterNotif = true;
      }
      return;
    }
    sessionPermissionRequested = true;
    permissionRequestInFlight = true;
    ActivityCompat.requestPermissions(
        this, new String[] {Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
  }

  private void syncDigitalVisualizerState() {
    if (digitalSpectrumEngine == null) {
      return;
    }
    boolean shouldRun =
        VU_MODE_SESSION.equals(vuMeterMode) && timerActive && activityVisible;
    if (!shouldRun) {
      if (digitalSpectrumEngine.isRunning()) {
        digitalSpectrumEngine.stop();
      }
      return;
    }
    if (hasRecordAudioPermission()) {
      if (!digitalSpectrumEngine.isRunning()) {
        digitalSpectrumEngine.start();
      }
    } else {
      maybeRequestRecordAudioPermission(false);
    }
  }

  private void launchMediaProjectionConsent() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || mediaProjectionLauncher == null) {
      return;
    }
    try {
      MediaProjectionManager mpm =
          (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
      if (mpm != null) {
        mediaProjectionLauncher.launch(mpm.createScreenCaptureIntent());
      }
    } catch (RuntimeException ignored) {
      // Ignore if MediaProjection is unavailable on device
    }
  }

  private void startPlaybackCaptureService(int resultCode, Intent resultData) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      return;
    }
    Intent svc = new Intent(this, DojoAudioCaptureService.class);
    svc.setAction(DojoAudioCaptureService.ACTION_START_CAPTURE);
    svc.putExtra(DojoAudioCaptureService.EXTRA_RESULT_CODE, resultCode);
    svc.putExtra(DojoAudioCaptureService.EXTRA_RESULT_DATA, resultData);
    try {
      ContextCompat.startForegroundService(this, svc);
    } catch (RuntimeException ignored) {
      // Ignore if FGS start fails
    }
  }

  private void stopPlaybackCaptureService() {
    if (!DojoAudioCaptureService.isCaptureActive()) {
      return;
    }
    try {
      stopService(new Intent(this, DojoAudioCaptureService.class));
    } catch (RuntimeException ignored) {
      // Ignore
    }
    notifyWebCaptureState(false);
  }

  private void updateTrayNotificationAndService() {
    if (!timerActive) {
      stopTrayServiceAndNotification();
      return;
    }
    if (!hasNotificationPermission()) {
      maybeRequestNotificationPermission();
    }

    Intent serviceIntent = new Intent(this, DojoTimerForegroundService.class);
    serviceIntent.setAction(DojoTimerForegroundService.ACTION_START_OR_UPDATE);
    serviceIntent.putExtra(DojoTimerForegroundService.EXTRA_RUNNING, timerRunning);
    serviceIntent.putExtra(DojoTimerForegroundService.EXTRA_PAUSED, timerPaused);
    serviceIntent.putExtra(DojoTimerForegroundService.EXTRA_PHASE_LABEL, timerPhaseLabel);
    serviceIntent.putExtra(DojoTimerForegroundService.EXTRA_ROUND_LABEL, timerRoundLabel);
    serviceIntent.putExtra(DojoTimerForegroundService.EXTRA_TIME_TEXT, timerTimeText);
    serviceIntent.putExtra(DojoTimerForegroundService.EXTRA_REMAINING_MS, timerRemainingMs);
    serviceIntent.putExtra(DojoTimerForegroundService.EXTRA_ACCENT_COLOR, timerAccentColor);

    try {
      ContextCompat.startForegroundService(this, serviceIntent);
      foregroundServiceRunning = true;
      return;
    } catch (IllegalStateException | SecurityException ignored) {
      // Fallback to standard notification if background FGS launch is restricted
    }

    if (!hasNotificationPermission()) {
      return;
    }
    Notification fallbackNotification =
        DojoTimerForegroundService.buildLiveNotification(
            this,
            timerRunning,
            timerPaused,
            timerPhaseLabel,
            timerRoundLabel,
            timerTimeText,
            timerRemainingMs,
            timerAccentColor);
    try {
      NotificationManagerCompat.from(this)
          .notify(DojoTimerForegroundService.LIVE_NOTIFICATION_ID, fallbackNotification);
    } catch (SecurityException ignored) {
      // Ignore if notification permission was revoked at runtime
    }
  }

  private void stopTrayServiceAndNotification() {
    if (foregroundServiceRunning) {
      try {
        stopService(new Intent(this, DojoTimerForegroundService.class));
      } catch (IllegalStateException | SecurityException ignored) {
        // Ignore service stop failures during teardown
      }
      foregroundServiceRunning = false;
    }
    NotificationManagerCompat.from(this).cancel(DojoTimerForegroundService.LIVE_NOTIFICATION_ID);
  }

  @SuppressWarnings("deprecation")
  private void requestAudioDuckFocus(int durationMs) {
    if (audioManager == null) {
      return;
    }
    int safeDurationMs = Math.max(300, Math.min(8000, durationMs));
    mainHandler.removeCallbacks(abandonDuckFocusRunnable);

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        if (activeAudioFocusRequest == null) {
          AudioAttributes attrs =
              new AudioAttributes.Builder()
                  .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                  .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                  .build();
          activeAudioFocusRequest =
              new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                  .setAudioAttributes(attrs)
                  .setOnAudioFocusChangeListener(noopAudioFocusListener)
                  .build();
        }
        audioManager.requestAudioFocus(activeAudioFocusRequest);
      } else {
        audioManager.requestAudioFocus(
            noopAudioFocusListener,
            AudioManager.STREAM_MUSIC,
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
      }
      mainHandler.postDelayed(abandonDuckFocusRunnable, safeDurationMs);
    } catch (RuntimeException ignored) {
      // Never disrupt timer playback if AudioManager fails
    }
  }

  @SuppressWarnings("deprecation")
  private void abandonAudioDuckFocus() {
    if (audioManager == null) {
      return;
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        if (activeAudioFocusRequest != null) {
          audioManager.abandonAudioFocusRequest(activeAudioFocusRequest);
        }
      } else {
        audioManager.abandonAudioFocus(noopAudioFocusListener);
      }
    } catch (RuntimeException ignored) {
      // Ignore release errors
    }
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

  private static String sanitizeVuMode(String raw) {
    if (VU_MODE_OFF.equals(raw)
        || VU_MODE_LOCAL.equals(raw)
        || VU_MODE_SESSION.equals(raw)
        || VU_MODE_CAPTURE.equals(raw)) {
      return raw;
    }
    return VU_MODE_LOCAL;
  }

  private static String resolveSafeOfficialApkUrl(String rawUrl) {
    if (rawUrl != null) {
      try {
        Uri parsed = Uri.parse(rawUrl.trim());
        String scheme = parsed.getScheme();
        String host = parsed.getHost();
        String path = parsed.getPath();
        if ("https".equalsIgnoreCase(scheme)
            && "1ms.it".equalsIgnoreCase(host)
            && parsed.getUserInfo() == null
            && parsed.getPort() == -1
            && path != null
            && path.startsWith("/timer/")
            && path.endsWith(".apk")
            && !path.contains("..")) {
          return OFFICIAL_APK_URL;
        }
      } catch (RuntimeException ignored) {
        // Fallback below
      }
    }
    return OFFICIAL_APK_URL;
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
            if (isFinishing() || isDestroyed() || getTrustedWebView() == null) {
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
            updateTrayNotificationAndService();
            syncDigitalVisualizerState();
          });
    }

    @JavascriptInterface
    public void setVuMeterMode(String mode) {
      final String safeMode = sanitizeVuMode(mode);
      runOnUiThread(
          () -> {
            if (isFinishing() || isDestroyed() || getTrustedWebView() == null) {
              return;
            }
            vuMeterMode = safeMode;
            if (!VU_MODE_CAPTURE.equals(vuMeterMode)) {
              stopPlaybackCaptureService();
            }
            syncDigitalVisualizerState();
          });
    }

    @JavascriptInterface
    public void requestPlaybackCapture() {
      runOnUiThread(
          () -> {
            if (isFinishing() || isDestroyed() || getTrustedWebView() == null) {
              return;
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
              notifyWebCaptureState(false);
              return;
            }
            if (DojoAudioCaptureService.isCaptureActive()) {
              notifyWebCaptureState(true);
              return;
            }
            if (!hasRecordAudioPermission()) {
              pendingPlaybackCaptureAfterPerm = true;
              maybeRequestRecordAudioPermission(true);
              return;
            }
            launchMediaProjectionConsent();
          });
    }

    @JavascriptInterface
    public void stopPlaybackCapture() {
      runOnUiThread(
          () -> {
            if (!isFinishing() && !isDestroyed() && getTrustedWebView() != null) {
              stopPlaybackCaptureService();
            }
          });
    }

    @JavascriptInterface
    public boolean isPlaybackCaptureActive() {
      return DojoAudioCaptureService.isCaptureActive();
    }

    @JavascriptInterface
    public boolean isExternalMusicActive() {
      if (audioManager == null) {
        return false;
      }
      try {
        return audioManager.isMusicActive();
      } catch (RuntimeException ignored) {
        return false;
      }
    }

    @JavascriptInterface
    public String getAudioSpectrumCsv() {
      if (VU_MODE_CAPTURE.equals(vuMeterMode) && DojoAudioCaptureService.isCaptureActive()) {
        return DojoAudioCaptureService.getLatestPacket();
      }
      if (VU_MODE_SESSION.equals(vuMeterMode)
          && digitalSpectrumEngine != null
          && digitalSpectrumEngine.isRunning()) {
        return digitalSpectrumEngine.getLatestPacket();
      }
      return "0|";
    }

    @JavascriptInterface
    public void requestAudioDucking(int durationMs) {
      runOnUiThread(
          () -> {
            if (!isFinishing() && !isDestroyed() && getTrustedWebView() != null) {
              requestAudioDuckFocus(durationMs);
            }
          });
    }

    @JavascriptInterface
    public int getMediaVolumePercent() {
      if (audioManager == null) {
        return -1;
      }
      try {
        int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        if (max <= 0) {
          return -1;
        }
        int current = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        return Math.max(0, Math.min(100, Math.round((current * 100f) / max)));
      } catch (RuntimeException ignored) {
        return -1;
      }
    }

    @JavascriptInterface
    public void fetchVersionManifestAsync(int reqId, int currentBuild, String currentVersion) {
      if (!updateCheckInFlight.compareAndSet(false, true)) {
        return;
      }
      final int safeBuild = Math.max(0, currentBuild);
      final String safeVersion =
          currentVersion != null && currentVersion.matches("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,5}$")
              ? currentVersion
              : "0.0.0";
      Thread worker =
          new Thread(
              () -> {
                String payload = null;
                try {
                  payload = fetchOfficialManifestJson(safeBuild, safeVersion);
                } finally {
                  updateCheckInFlight.set(false);
                }
                final String finalPayload = payload;
                runOnUiThread(
                    () -> {
                      if (isFinishing() || isDestroyed()) {
                        return;
                      }
                      WebView webView = getTrustedWebView();
                      if (webView == null) {
                        return;
                      }
                      String jsArg = finalPayload != null ? JSONObject.quote(finalPayload) : "null";
                      webView.evaluateJavascript(
                          "(function(){ if (typeof window.__dojoOnUpdateManifest === 'function') { window.__dojoOnUpdateManifest("
                              + reqId
                              + ", "
                              + jsArg
                              + "); } })()",
                          null);
                    });
              },
              "DojoUpdateCheck");
      worker.setDaemon(true);
      worker.start();
    }

    @JavascriptInterface
    public void openOfficialApkDownload(String rawUrl) {
      final String finalUrl = resolveSafeOfficialApkUrl(rawUrl);
      runOnUiThread(
          () -> {
            if (isFinishing() || isDestroyed() || getTrustedWebView() == null) {
              return;
            }
            try {
              Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(finalUrl));
              intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
              startActivity(intent);
            } catch (RuntimeException ignored) {
              // Ignore if no browser/handler available
            }
          });
    }
  }

  private static String fetchOfficialManifestJson(int currentBuild, String currentVersion) {
    HttpsURLConnection conn = null;
    try {
      String queryUrl =
          OFFICIAL_VERSION_MANIFEST_BASE_URL
              + "?v="
              + Uri.encode(currentVersion)
              + "&build="
              + currentBuild
              + "&t="
              + System.currentTimeMillis();
      conn = (HttpsURLConnection) new URL(queryUrl).openConnection();
      conn.setRequestMethod("GET");
      conn.setInstanceFollowRedirects(false);
      conn.setConnectTimeout(5000);
      conn.setReadTimeout(5000);
      conn.setUseCaches(false);
      conn.setRequestProperty("Accept", "application/json");
      conn.setRequestProperty("Cache-Control", "no-cache");

      if (conn.getResponseCode() != HttpsURLConnection.HTTP_OK) {
        return null;
      }

      StringBuilder sb = new StringBuilder(256);
      try (BufferedReader reader =
          new BufferedReader(
              new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
        char[] buf = new char[1024];
        int n;
        while ((n = reader.read(buf)) != -1) {
          if (sb.length() + n > 8192) {
            return null;
          }
          sb.append(buf, 0, n);
        }
      }
      return sb.toString();
    } catch (Exception ignored) {
      return null;
    } finally {
      if (conn != null) {
        conn.disconnect();
      }
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
