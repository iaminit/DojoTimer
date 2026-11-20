import { useEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  ChevronRight,
  Download,
  ListChecks,
  Megaphone,
  Palette,
  Smartphone,
  Vibrate,
  Volume2,
  X,
} from 'lucide-react';
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap';
import { useNativeBackHandler } from '../../hooks/useNativeBackHandler';
import { soundEngine } from '../../services/soundEngine';
import type { AudioMode, DisciplineMode, TimerLayoutMode, VoiceProfile } from '../../types/timer';
import { APP_VERSION_LABEL } from '../../utils/appVersion';
import type { VisualThemeTokens } from '../../utils/themePalette';

interface SetupOptionsModalProps {
  isOpen: boolean;
  discipline: DisciplineMode;
  audioMode: AudioMode;
  voiceProfile: VoiceProfile;
  timerLayout: TimerLayoutMode;
  eventHapticsEnabled: boolean;
  theme: VisualThemeTokens;
  defaultProgramName: string;
  judoCount: number;
  bjjCount: number;
  onClose: () => void;
  onChangeAudioMode: (mode: AudioMode) => void;
  onChangeVoiceProfile: (profile: VoiceProfile) => void;
  onChangeTimerLayout: (layout: TimerLayoutMode) => void;
  onChangeEventHapticsEnabled: (enabled: boolean) => void;
  onOpenColorSettings: () => void;
  onSaveCurrentAsProgram: (customName: string) => string;
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
  { profile: 'KENGURO', name: 'KENGURO', subtitle: 'MASCHILE' },
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

export function SetupOptionsModal({
  isOpen,
  discipline,
  audioMode,
  voiceProfile,
  timerLayout,
  eventHapticsEnabled,
  theme,
  defaultProgramName,
  judoCount,
  bjjCount,
  onClose,
  onChangeAudioMode,
  onChangeVoiceProfile,
  onChangeTimerLayout,
  onChangeEventHapticsEnabled,
  onOpenColorSettings,
  onSaveCurrentAsProgram,
  onOpenSavedPrograms,
  onStartQuickPreset,
}: SetupOptionsModalProps) {
  const [saveName, setSaveName] = useState('');
  const [menuSavedFeedback, setMenuSavedFeedback] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMenuSavedFeedback(null);
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

  const isCapacitorNative =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
        ?.isNativePlatform?.(),
    );
  const apkDownloadUrl = resolveApkDownloadUrl();

  const handleSave = () => {
    const savedDisplayName = onSaveCurrentAsProgram(saveName);
    setSaveName('');
    setMenuSavedFeedback(`Salvato "${savedDisplayName}" in ${discipline}`);
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
                <span className="whitespace-nowrap text-xs font-extrabold tracking-[0.08em] text-slate-400 uppercase">
                  MODALITÀ AUDIO
                </span>
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

              {/* 1b. Voice Profile: Male (Kenguro) | Female (Arale) */}
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
              <span className="whitespace-nowrap text-xs font-extrabold tracking-[0.08em] text-slate-400 uppercase">
                MODALITÀ AUDIO
              </span>
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

          {/* 1c. Timer Visual Layout Mode (Modalità 1 Classic vs Modalità 2 Pro) */}
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

          {/* 7. Progressive App Version & Build Footer */}
          <footer
            className="mt-1 flex items-center justify-between gap-2 border-t border-white/10 pt-4 text-[11px] font-bold tracking-[0.1em] text-slate-500 uppercase"
            aria-label={`Versione applicazione ${APP_VERSION_LABEL}`}
          >
            <span>VERSIONE</span>
            <span className="tabular-digits font-mono text-slate-400 normal-case">
              {APP_VERSION_LABEL}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
