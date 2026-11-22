import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Bell,
  BookmarkPlus,
  ChevronRight,
  Download,
  FolderOpen,
  ListChecks,
  Megaphone,
  Music,
  Palette,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Smartphone,
  Trash2,
  Vibrate,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap';
import { useNativeBackHandler } from '../../hooks/useNativeBackHandler';
import { localMusicPlayer, useLocalMusicPlayer } from '../../services/musicPlayer';
import {
  getNativeMediaVolumePercent,
  isNativeAndroidRuntime,
  openNativeApkDownload,
  requestNativePlaybackCapture,
  stopNativePlaybackCapture,
  useNativePlaybackCaptureActive,
} from '../../services/nativeAndroid';
import { soundEngine } from '../../services/soundEngine';
import { checkForApkUpdate, type ApkUpdateCheckResult } from '../../services/updateChecker';
import type {
  AudioMode,
  DisciplineMode,
  TimerLayoutMode,
  VoiceProfile,
  VuMeterMode,
} from '../../types/timer';
import { APP_BUILD_NUMBER, APP_COMMIT_SHA, APP_VERSION, APP_VERSION_LABEL } from '../../utils/appVersion';
import type { VisualThemeTokens } from '../../utils/themePalette';

interface SetupOptionsModalProps {
  isOpen: boolean;
  discipline: DisciplineMode;
  audioMode: AudioMode;
  voiceProfile: VoiceProfile;
  timerLayout: TimerLayoutMode;
  eventHapticsEnabled: boolean;
  vuMeterMode: VuMeterMode;
  theme: VisualThemeTokens;
  defaultProgramName: string;
  judoCount: number;
  bjjCount: number;
  onClose: () => void;
  onChangeAudioMode: (mode: AudioMode) => void;
  onChangeVoiceProfile: (profile: VoiceProfile) => void;
  onChangeTimerLayout: (layout: TimerLayoutMode) => void;
  onChangeEventHapticsEnabled: (enabled: boolean) => void;
  onChangeVuMeterMode: (mode: VuMeterMode) => void;
  onOpenColorSettings: () => void;
  onSaveCurrentAsProgram: (customName: string) => string | null;
  onOpenSavedPrograms: () => void;
  onStartQuickPreset: (minutes: number) => void;
}

const QUICK_MINUTE_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 10];

export function resolveApkDownloadUrl(baseUrl: string = import.meta.env?.BASE_URL ?? '/'): string {
  const trimmed = baseUrl.trim();
  // Restrict strictly to safe relative/same-origin paths (reject schemes or protocol-relative //).
  if (!trimmed || trimmed.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return '/DojoTimer.apk';
  }
  const normalized = trimmed.replace(/\/?$/, '/');
  return `${normalized}DojoTimer.apk`;
}

const AUDIO_OPTIONS: Array<{
  mode: AudioMode;
  label: string;
  Icon: typeof Megaphone;
}> = [
  { mode: 'VOICE_GONG', label: 'Voce + Gong', Icon: Megaphone },
  { mode: 'GONG_ONLY', label: 'Solo Gong', Icon: Volume2 },
];

const VOICE_OPTIONS: Array<{
  profile: VoiceProfile;
  name: string;
  subtitle: string;
}> = [
  { profile: 'KENGURO', name: 'KANGARŪ', subtitle: 'MASCHILE' },
  { profile: 'ARALE', name: 'ARALE', subtitle: 'FEMMINILE' },
];

const LAYOUT_OPTIONS: Array<{
  mode: TimerLayoutMode;
  title: string;
  subtitle: string;
}> = [
  { mode: 'CLASSIC', title: 'MODALITÀ 1', subtitle: 'CERCHIO CLASSICO' },
  { mode: 'PRO', title: 'MODALITÀ 2', subtitle: 'SCOREBOARD PRO' },
];

const VU_METER_OPTIONS: Array<{
  mode: VuMeterMode;
  title: string;
  subtitle: string;
  androidOnly?: boolean;
}> = [
  { mode: 'OFF', title: 'SPENTO', subtitle: 'NESSUN VU' },
  { mode: 'LOCAL_PLAYER', title: 'PLAYER MP3', subtitle: 'BRANI LOCALI' },
  { mode: 'SESSION_VISUALIZER', title: 'SESSIONE', subtitle: 'VISUALIZER', androidOnly: true },
  { mode: 'PLAYBACK_CAPTURE', title: 'DIGITALE', subtitle: 'AUDIO ANDROID', androidOnly: true },
];

export function SetupOptionsModal({
  isOpen,
  discipline,
  audioMode,
  voiceProfile,
  timerLayout,
  eventHapticsEnabled,
  vuMeterMode,
  theme,
  defaultProgramName,
  judoCount,
  bjjCount,
  onClose,
  onChangeAudioMode,
  onChangeVoiceProfile,
  onChangeTimerLayout,
  onChangeEventHapticsEnabled,
  onChangeVuMeterMode,
  onOpenColorSettings,
  onSaveCurrentAsProgram,
  onOpenSavedPrograms,
  onStartQuickPreset,
}: SetupOptionsModalProps) {
  const [saveName, setSaveName] = useState('');
  const [menuSavedFeedback, setMenuSavedFeedback] = useState<string | null>(null);
  const [mediaVolumePct, setMediaVolumePct] = useState<number | null>(null);
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);
  const [updateResult, setUpdateResult] = useState<ApkUpdateCheckResult | null>(null);
  const musicSnap = useLocalMusicPlayer();
  const isCaptureActive = useNativePlaybackCaptureActive();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMenuSavedFeedback(null);
    if (isOpen) {
      setMediaVolumePct(getNativeMediaVolumePercent());
    }
  }, [discipline, isOpen]);

  useNativeBackHandler(
    isOpen,
    () => {
      onClose();
      return true;
    },
    55,
  );

  useDialogFocusTrap({
    isOpen,
    containerRef: dialogRef,
    initialFocusRef: closeBtnRef,
    onEscape: onClose,
  });

  if (!isOpen) {
    return null;
  }

  const isCapacitorNative = isNativeAndroidRuntime();
  const apkDownloadUrl = resolveApkDownloadUrl();

  const handleSave = () => {
    const savedDisplayName = onSaveCurrentAsProgram(saveName);
    if (!savedDisplayName) {
      setMenuSavedFeedback('Limite massimo raggiunto (200 programmi). Elimina un programma prima di salvarne uno nuovo.');
      return;
    }
    setSaveName('');
    setMenuSavedFeedback(`Salvato "${savedDisplayName}" in ${discipline}`);
  };

  const handleQuickGongTest = () => {
    soundEngine.unlock();
    setMediaVolumePct(getNativeMediaVolumePercent());
    soundEngine.playHajime();
  };

  const handleCheckUpdate = async () => {
    if (updateCheckBusy) return;
    setUpdateCheckBusy(true);
    try {
      const res = await checkForApkUpdate(APP_BUILD_NUMBER, APP_VERSION, APP_COMMIT_SHA);
      setUpdateResult(res);
    } finally {
      setUpdateCheckBusy(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col overflow-hidden bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`Opzioni ${discipline}`}
    >
      {/* Fixed Full-Width Top Bar matching DisplaySettingsModal */}
      <header className="shrink-0 border-b border-white/12 bg-black pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] pb-3.5 pl-[max(1.25rem,env(safe-area-inset-left,0px))] pr-[max(1.25rem,env(safe-area-inset-right,0px))]">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="whitespace-nowrap text-[11px] font-bold tracking-[0.16em] text-slate-400 uppercase">
              PARAMETRI &amp; PRESET
            </span>
            <h2
              className="whitespace-nowrap text-base font-extrabold tracking-[0.1em] uppercase sm:text-xl"
              style={{ color: theme.hex }}
            >
              OPZIONI {discipline}
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Chiudi opzioni"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-neutral-950 text-slate-200 transition-colors hover:border-white/50 hover:text-white active:scale-95 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="dojo-scroll min-h-0 flex-1 overflow-y-auto pl-[max(1.25rem,env(safe-area-inset-left,0px))] pr-[max(1.25rem,env(safe-area-inset-right,0px))] pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-5">
          {/* 1. Audio Mode & Voice Controls (BJJ enforces shared bells/gong only) */}
          {discipline === 'JUDO' ? (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="whitespace-nowrap text-xs font-extrabold tracking-[0.08em] text-slate-400 uppercase">
                    MODALITÀ AUDIO
                  </span>
                  <div className="flex items-center gap-2">
                    {mediaVolumePct === 0 && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-400/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-extrabold text-amber-300 uppercase">
                        <VolumeX className="h-3 w-3 shrink-0" />
                        VOL 0%
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleQuickGongTest}
                      className="inline-flex min-h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 bg-neutral-950 px-3 text-[11px] font-extrabold tracking-[0.08em] text-white uppercase transition-colors hover:border-white/50 active:scale-95 cursor-pointer"
                    >
                      <Bell className="h-3.5 w-3.5 shrink-0" style={{ color: theme.hex }} />
                      <span>TEST GONG</span>
                    </button>
                  </div>
                </div>
                <div
                  className="grid grid-cols-2 rounded-xl border border-white/15 bg-black p-1"
                  role="group"
                  aria-label="Modalità Audio"
                >
                  {AUDIO_OPTIONS.map(({ mode, label, Icon }) => {
                    const active = audioMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onChangeAudioMode(mode)}
                        aria-pressed={active}
                        className={`flex min-h-[46px] items-center justify-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-xs font-extrabold tracking-[0.06em] uppercase transition-all sm:text-sm cursor-pointer ${
                          active ? 'text-black shadow-sm' : 'text-slate-300 hover:text-white'
                        }`}
                        style={active ? { backgroundColor: theme.hex } : undefined}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 1b. Voice Profile: Male (Kangarū) | Female (Arale) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="whitespace-nowrap text-xs font-extrabold tracking-[0.08em] text-slate-400 uppercase">
                    VOCE ANNUNCI
                  </span>
                  {audioMode === 'GONG_ONLY' && (
                    <span className="whitespace-nowrap text-[11px] font-semibold text-slate-500">
                      Tocca per attivare Voce + Gong
                    </span>
                  )}
                </div>
                <div
                  className="grid grid-cols-2 rounded-xl border border-white/15 bg-black p-1"
                  role="group"
                  aria-label="Voce Annunci"
                >
                  {VOICE_OPTIONS.map(({ profile, name, subtitle }) => {
                    const active = voiceProfile === profile;
                    return (
                      <button
                        key={profile}
                        type="button"
                        onClick={() => {
                          onChangeVoiceProfile(profile);
                          soundEngine.setVoiceProfile(profile);
                          soundEngine.playVoicePreview();
                        }}
                        aria-pressed={active}
                        className={`flex min-h-[50px] flex-col items-center justify-center rounded-lg px-2.5 py-1.5 transition-all cursor-pointer ${
                          active ? 'text-black shadow-sm' : 'text-slate-300 hover:text-white'
                        }`}
                        style={active ? { backgroundColor: theme.hex } : undefined}
                      >
                        <span className="whitespace-nowrap text-xs font-extrabold tracking-[0.06em] uppercase sm:text-sm">
                          {name}
                        </span>
                        <span
                          className={`whitespace-nowrap text-[10px] font-bold tracking-[0.12em] uppercase ${
                            active ? 'text-black/75' : 'text-slate-400'
                          }`}
                        >
                          {subtitle}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="whitespace-nowrap text-xs font-extrabold tracking-[0.08em] text-slate-400 uppercase">
                  MODALITÀ AUDIO
                </span>
                <div className="flex items-center gap-2">
                  {mediaVolumePct === 0 && (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-400/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-extrabold text-amber-300 uppercase">
                      <VolumeX className="h-3 w-3 shrink-0" />
                      VOL 0%
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleQuickGongTest}
                    className="inline-flex min-h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 bg-neutral-950 px-3 text-[11px] font-extrabold tracking-[0.08em] text-white uppercase transition-colors hover:border-white/50 active:scale-95 cursor-pointer"
                  >
                    <Bell className="h-3.5 w-3.5 shrink-0" style={{ color: theme.hex }} />
                    <span>TEST GONG</span>
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-black px-4 py-3">
                <span className="flex items-center gap-2 whitespace-nowrap text-xs font-extrabold tracking-[0.06em] text-white uppercase sm:text-sm">
                  <Volume2 className="h-4 w-4 shrink-0" style={{ color: theme.hex }} />
                  Solo Campanella &amp; Gong
                </span>
                <span className="whitespace-nowrap text-[11px] font-semibold text-slate-400">
                  Solo segnali acustici
                </span>
              </div>
            </div>
          )}

          {/* 1c. VU Meter & Musica senza distorsione (3 modalità digitali + Spento) */}
          <div className="flex flex-col gap-2.5 rounded-2xl border border-white/15 bg-black p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 whitespace-nowrap text-xs font-extrabold tracking-[0.08em] text-slate-300 uppercase">
                <AudioLines className="h-4 w-4 shrink-0" style={{ color: theme.hex }} />
                VU METER &amp; MUSICA
              </span>
              <span className="text-[10px] font-bold tracking-[0.06em] text-emerald-400 uppercase">
                ZERO MICROFONO
              </span>
            </div>

            <div
              className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
              role="group"
              aria-label="Modalità VU Meter"
            >
              {VU_METER_OPTIONS.map(({ mode, title, subtitle, androidOnly }) => {
                const disabled = Boolean(androidOnly && !isCapacitorNative);
                const active = vuMeterMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChangeVuMeterMode(mode)}
                    aria-pressed={active}
                    className={`flex min-h-[46px] flex-col items-center justify-center rounded-xl border px-2 py-1.5 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-35 ${
                      active
                        ? 'border-transparent text-black shadow-sm'
                        : 'border-white/15 bg-neutral-950 text-slate-300 hover:border-white/35 hover:text-white'
                    }`}
                    style={active ? { backgroundColor: theme.hex } : undefined}
                  >
                    <span className="whitespace-nowrap text-[11px] font-extrabold tracking-[0.05em] uppercase">
                      {title}
                    </span>
                      <span
                        className={`whitespace-nowrap text-[9px] font-bold tracking-[0.08em] uppercase ${
                          active ? 'text-black/75' : 'text-slate-400'
                        }`}
                      >
                        {disabled ? 'SOLO APP ANDROID' : subtitle}
                      </span>
                    </button>
                  );
                })}
              </div>

              {!isCapacitorNative && (
                <p className="rounded-xl border border-white/10 bg-neutral-950 px-3 py-2 text-[11px] leading-snug font-medium text-slate-400">
                  Nel browser Web/PWA usa il <strong className="text-slate-200">Player MP3</strong>{' '}
                  integrato. Le modalità <strong className="text-slate-200">Sessione</strong> e{' '}
                  <strong className="text-slate-200">Digitale</strong> (YouTube, YouTube Music, VLC,
                  ecc.) si attivano automaticamente nell&apos;app Android (DojoTimer.apk).
                </p>
              )}

            {/* Opzione 1: Cattura Digitale Interna Android (`AudioPlaybackCapture` / MediaProjection solo audio) */}
            {vuMeterMode === 'PLAYBACK_CAPTURE' && (
              <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-neutral-950 p-3">
                <p className="text-[11px] leading-snug font-medium text-slate-400">
                  Cattura il flusso audio digitale interno (YouTube, YouTube Music, VLC, browser)
                  anche su Bluetooth A2DP senza microfono e senza distorsione. Spotify può bloccare
                  questa API su alcune versioni.
                </p>
                {isCapacitorNative && (
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[11px] font-extrabold uppercase ${
                        isCaptureActive ? 'text-emerald-400' : 'text-slate-400'
                      }`}
                    >
                      {isCaptureActive ? '● CATTURA ATTIVA' : '○ NON ANCORA ATTIVATA'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        isCaptureActive
                          ? stopNativePlaybackCapture()
                          : requestNativePlaybackCapture()
                      }
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 text-[11px] font-extrabold tracking-[0.08em] uppercase active:scale-95 cursor-pointer"
                      style={
                        isCaptureActive
                          ? {
                              backgroundColor: 'rgba(255,255,255,0.12)',
                              color: '#FFFFFF',
                            }
                          : { backgroundColor: theme.hex, color: '#000000' }
                      }
                    >
                      <AudioLines className="h-3.5 w-3.5 shrink-0" />
                      <span>{isCaptureActive ? 'DISATTIVA' : 'ATTIVA CATTURA'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Opzione 2: Aggancio Sessione Player (`OPEN_AUDIO_EFFECT_CONTROL_SESSION` + `Visualizer(sessionId)`) */}
            {vuMeterMode === 'SESSION_VISUALIZER' && (
              <p className="rounded-xl border border-white/10 bg-neutral-950 p-3 text-[11px] leading-snug font-medium text-slate-400">
                Aggancia automaticamente la sessione audio digitale del player (senza microfono, zero
                distorsione). Su casse Bluetooth potrebbe richiedere di disattivare «Offload
                hardware Bluetooth A2DP» nelle Opzioni Sviluppatore Android.
              </p>
            )}

            {/* Opzione 3: Player MP3 / Audio Locale Integrato (FFT 100% perfetta, zero permessi, ducking auto) */}
            {vuMeterMode === 'LOCAL_PLAYER' && (
              <div className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-neutral-950 p-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      localMusicPlayer.addFiles(e.target.files, true);
                    }
                    e.target.value = '';
                  }}
                />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Music className="h-4 w-4 shrink-0" style={{ color: theme.hex }} />
                    <span className="truncate text-xs font-bold text-white">
                      {musicSnap.tracks.length > 0
                        ? musicSnap.tracks[musicSnap.currentIndex]?.name ?? 'Playlist pronta'
                        : 'Nessun brano caricato'}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full px-3 text-[10px] font-extrabold tracking-[0.08em] text-black uppercase active:scale-95 cursor-pointer"
                      style={{ backgroundColor: theme.hex }}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                      <span>SCEGLI MP3</span>
                    </button>
                    {musicSnap.tracks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => localMusicPlayer.clearPlaylist()}
                        aria-label="Svuota playlist locale"
                        className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/15 bg-black text-slate-400 hover:border-red-400/50 hover:text-red-300 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {musicSnap.tracks.length > 0 ? (
                  <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => localMusicPlayer.prevTrack()}
                        aria-label="Brano precedente"
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black text-white active:scale-95 cursor-pointer"
                      >
                        <SkipBack className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => localMusicPlayer.togglePlayPause()}
                        aria-label={musicSnap.isPlaying ? 'Pausa musica' : 'Avvia musica'}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-black active:scale-95 cursor-pointer"
                        style={{ backgroundColor: theme.hex }}
                      >
                        {musicSnap.isPlaying ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4 translate-x-0.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => localMusicPlayer.nextTrack()}
                        aria-label="Brano successivo"
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black text-white active:scale-95 cursor-pointer"
                      >
                        <SkipForward className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-1 items-center gap-2">
                      <Volume2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={musicSnap.volume}
                        onChange={(e) => localMusicPlayer.setVolume(Number(e.target.value))}
                        aria-label="Volume musica locale"
                        className="h-2 w-full cursor-pointer"
                        style={{ accentColor: theme.hex }}
                      />
                      <span className="tabular-digits w-8 text-right text-[10px] font-bold text-slate-400">
                        {musicSnap.volume}%
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] leading-snug font-medium text-slate-400">
                    Riproduzione MP3 nativa senza distorsione, VU meter FFT in tempo reale, zero
                    permessi e ducking automatico quando suona il gong.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 1d. Timer Visual Layout Mode (Modalità 1 Classic vs Modalità 2 Pro) */}
          <div className="flex flex-col gap-2">
            <span className="whitespace-nowrap text-xs font-extrabold tracking-[0.08em] text-slate-400 uppercase">
              STILE TIMER
            </span>
            <div
              className="grid grid-cols-2 rounded-xl border border-white/15 bg-black p-1"
              role="group"
              aria-label="Stile Timer"
            >
              {LAYOUT_OPTIONS.map(({ mode, title, subtitle }) => {
                const active = timerLayout === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onChangeTimerLayout(mode)}
                    aria-pressed={active}
                    className={`flex min-h-[50px] flex-col items-center justify-center rounded-lg px-2.5 py-1.5 transition-all cursor-pointer ${
                      active ? 'text-black shadow-sm' : 'text-slate-300 hover:text-white'
                    }`}
                    style={active ? { backgroundColor: theme.hex } : undefined}
                  >
                    <span className="whitespace-nowrap text-xs font-extrabold tracking-[0.06em] uppercase sm:text-sm">
                      {title}
                    </span>
                    <span
                      className={`whitespace-nowrap text-[10px] font-bold tracking-[0.12em] uppercase ${
                        active ? 'text-black/75' : 'text-slate-400'
                      }`}
                    >
                      {subtitle}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 1d. Vibration & Haptic Feedback on Timer Sound Events */}
          <div className="flex flex-col gap-2">
            <span className="whitespace-nowrap text-xs font-extrabold tracking-[0.08em] text-slate-400 uppercase">
              VIBRAZIONE &amp; FEEDBACK APTICO
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={eventHapticsEnabled}
              onClick={() => {
                soundEngine.unlock();
                onChangeEventHapticsEnabled(!eventHapticsEnabled);
              }}
              className="flex min-h-[62px] items-center justify-between gap-3 rounded-2xl border bg-black px-4 py-3 text-left transition-colors hover:border-white/40 cursor-pointer"
              style={{
                borderColor: eventHapticsEnabled
                  ? `rgba(${theme.rgb}, 0.6)`
                  : 'rgba(255, 255, 255, 0.15)',
                boxShadow: eventHapticsEnabled
                  ? `0 0 18px rgba(${theme.rgb}, 0.16)`
                  : undefined,
              }}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Vibrate
                  className="h-5 w-5 shrink-0"
                  style={{ color: eventHapticsEnabled ? theme.hex : '#64748B' }}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-xs font-extrabold tracking-[0.06em] text-white uppercase sm:text-sm">
                    EVENTI SONORI DEL TIMER
                  </span>
                  <span className="truncate text-[11px] font-bold tracking-[0.08em] text-slate-400 uppercase sm:text-xs">
                    GONG INIZIO, PREAVVISO 30S E 3 RINTOCCHI FINALI
                  </span>
                </span>
              </span>
              <span
                className={`flex h-7 w-[72px] shrink-0 items-center rounded-full border p-1 transition-colors ${
                  eventHapticsEnabled ? 'justify-end' : 'justify-start'
                }`}
                style={{
                  borderColor: eventHapticsEnabled ? theme.hex : 'rgba(255, 255, 255, 0.25)',
                  backgroundColor: eventHapticsEnabled ? theme.hex : '#171717',
                }}
              >
                <span
                  className={`flex h-5 min-w-[38px] items-center justify-center rounded-full px-1.5 text-[9px] font-extrabold tracking-tight ${
                    eventHapticsEnabled ? 'bg-black text-white' : 'bg-neutral-700 text-slate-200'
                  }`}
                >
                  {eventHapticsEnabled ? 'ATTIVO' : 'OFF'}
                </span>
              </span>
            </button>
          </div>

          {/* 2. Colors & Display Settings */}
          <button
            type="button"
            onClick={onOpenColorSettings}
            className="flex min-h-[62px] items-center justify-between gap-3 rounded-2xl border border-white/15 bg-black px-4 py-3 text-left transition-colors hover:border-white/40 cursor-pointer"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Palette className="h-5 w-5 shrink-0" style={{ color: theme.hex }} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-xs font-extrabold tracking-[0.06em] text-white uppercase sm:text-sm">
                  DISPLAY &amp; TEST AUDIO
                </span>
                <span className="truncate text-[11px] font-bold tracking-[0.08em] text-slate-400 uppercase sm:text-xs">
                  OPACITÀ SFONDO, COLORI PIENI E SUONI
                </span>
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>

          {/* 3. Save current 5 settings as a reusable Program */}
          <div className="flex flex-col gap-2 rounded-2xl border border-white/15 bg-black p-3.5 sm:p-4">
            <span className="whitespace-nowrap text-[11px] font-extrabold tracking-[0.08em] text-slate-400 uppercase sm:text-xs">
              SALVA SETTAGGI NEI PROGRAMMI
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={saveName}
                maxLength={80}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={defaultProgramName}
                className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-white/20 bg-neutral-900 px-3 text-sm font-semibold text-white outline-none focus:border-yellow-400"
              />
              <button
                type="button"
                onClick={handleSave}
                className="flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-4 text-xs font-extrabold tracking-[0.08em] text-black uppercase active:scale-95 cursor-pointer"
                style={{ backgroundColor: theme.hex }}
              >
                <BookmarkPlus className="h-4 w-4 shrink-0" />
                <span>SALVA</span>
              </button>
            </div>
            {menuSavedFeedback && (
              <span className="truncate text-xs font-semibold text-emerald-300">
                {menuSavedFeedback}
              </span>
            )}
          </div>

          {/* 4. Saved Programs View */}
          <button
            type="button"
            onClick={onOpenSavedPrograms}
            className="flex min-h-[62px] items-center justify-between gap-3 rounded-2xl border border-white/15 bg-black px-4 py-3 text-left transition-colors hover:border-white/40 cursor-pointer"
          >
            <span className="flex min-w-0 items-center gap-3">
              <ListChecks className="h-5 w-5 shrink-0" style={{ color: theme.hex }} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-xs font-extrabold tracking-[0.06em] text-white uppercase sm:text-sm">
                  PROGRAMMI SALVATI
                </span>
                <span className="tabular-digits truncate text-[11px] font-bold tracking-[0.08em] text-slate-400 uppercase sm:text-xs">
                  JUDO ({judoCount}) • BJJ ({bjjCount})
                </span>
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>

          {/* 5. Quick Start (1 Round) */}
          <div className="flex flex-col gap-2">
            <span className="whitespace-nowrap text-[11px] font-extrabold tracking-[0.08em] text-slate-400 uppercase sm:text-xs">
              AVVIO RAPIDO (1 ROUND)
            </span>
            <div className="grid grid-cols-4 gap-2">
              {QUICK_MINUTE_OPTIONS.map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => onStartQuickPreset(mins)}
                  className="tabular-digits whitespace-nowrap min-h-[46px] rounded-xl border border-white/20 bg-black text-xs font-extrabold tracking-[0.06em] text-white uppercase transition-colors hover:border-white/50 active:scale-95 cursor-pointer"
                  style={{ borderColor: `rgba(${theme.rgb}, 0.45)`, color: theme.hex }}
                >
                  {mins} MIN
                </button>
              ))}
            </div>
          </div>

          {/* 6. Download Android App (APK) — shown on Web/PWA only */}
          {!isCapacitorNative && (
            <a
              href={apkDownloadUrl}
              download="DojoTimer.apk"
              className="flex min-h-[62px] items-center justify-between gap-3 rounded-2xl border border-white/15 bg-black px-4 py-3 text-left transition-colors hover:border-white/40 active:scale-[0.99] cursor-pointer"
            >
              <span className="flex min-w-0 items-center gap-3">
                <Smartphone className="h-5 w-5 shrink-0" style={{ color: theme.hex }} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-xs font-extrabold tracking-[0.06em] text-white uppercase sm:text-sm">
                    SCARICA APP ANDROID
                  </span>
                  <span className="truncate text-[11px] font-bold tracking-[0.08em] text-slate-400 uppercase sm:text-xs">
                    DOJOTIMER.APK — INSTALLA SUL TELEFONO
                  </span>
                </span>
              </span>
              <Download className="h-4 w-4 shrink-0 text-slate-400" />
            </a>
          )}

          {/* 7. Progressive App Version, APK Update Checker (Android) & Build Footer */}
          <footer
            className="mt-1 flex flex-col gap-3 border-t border-white/10 pt-4 text-[11px] font-bold tracking-[0.1em] text-slate-500 uppercase"
            aria-label={`Versione applicazione ${APP_VERSION_LABEL}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span>VERSIONE</span>
              <span className="tabular-digits font-mono text-slate-400 normal-case">
                {APP_VERSION_LABEL}
              </span>
            </div>

            {isCapacitorNative && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void handleCheckUpdate()}
                  disabled={updateCheckBusy}
                  className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-white/18 bg-neutral-950 px-3.5 text-[11px] font-extrabold tracking-[0.08em] text-slate-200 uppercase transition-colors hover:border-white/45 hover:text-white active:scale-95 disabled:opacity-60 cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 shrink-0 ${updateCheckBusy ? 'animate-spin' : ''}`}
                    style={{ color: theme.hex }}
                  />
                  <span>
                    {updateCheckBusy ? 'CONTROLLO...' : 'CONTROLLA AGGIORNAMENTI'}
                  </span>
                </button>

                {updateResult?.status === 'up-to-date' && (
                  <span className="text-[11px] font-bold text-emerald-400 normal-case">
                    App aggiornata (v{updateResult.latestVersion} • #{updateResult.latestBuildNumber})
                  </span>
                )}
                {updateResult?.status === 'offline' && (
                  <span className="text-[11px] font-bold text-slate-400 normal-case">
                    Offline — riprova connesso
                  </span>
                )}
                {updateResult?.status === 'update-available' && (
                  <a
                    href={updateResult.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (openNativeApkDownload(updateResult.downloadUrl)) {
                        e.preventDefault();
                      }
                    }}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3.5 text-[11px] font-extrabold tracking-[0.08em] text-black uppercase active:scale-95 cursor-pointer"
                    style={{ backgroundColor: theme.hex }}
                  >
                    <Download className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      SCARICA v{updateResult.latestVersion} • #{updateResult.latestBuildNumber}
                    </span>
                  </a>
                )}
              </div>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}
