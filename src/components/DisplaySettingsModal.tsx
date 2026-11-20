import { useRef } from 'react';
import { Volume2, X } from 'lucide-react';
import { DISCIPLINES } from '../config/disciplines';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap';
import { useNativeBackHandler } from '../hooks/useNativeBackHandler';
import { triggerButtonFeedback } from '../services/haptics';
import { soundEngine } from '../services/soundEngine';
import type {
  DisciplineMode,
  DisplaySettings,
  SolidColorKey,
  TimerLayoutMode,
  TimerPhase,
} from '../types/timer';
import { resolveProTimerPalette } from '../utils/proTimerTheme';
import { resolveVisualTheme, SOLID_COLOR_OPTIONS } from '../utils/themePalette';
import { CircularWaterTank } from './CircularWaterTank';
import { ClassicWaveBackground } from './ClassicWaveBackground';

const LAYOUT_MODE_OPTIONS: Array<{
  mode: TimerLayoutMode;
  title: string;
  subtitle: string;
}> = [
  { mode: 'CLASSIC', title: 'MODALITÀ 1', subtitle: 'CERCHIO CLASSICO' },
  { mode: 'PRO', title: 'MODALITÀ 2', subtitle: 'SCOREBOARD PRO' },
];

const SOLID_COLOR_ORDER: readonly SolidColorKey[] = ['RED', 'GREEN', 'ORANGE', 'AZURE'];
const OPACITY_QUICK_PRESETS: readonly number[] = [0, 20, 50, 100];

interface DisplaySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  discipline: DisciplineMode;
  settings: DisplaySettings;
  onUpdateSettings: (next: DisplaySettings) => void;
}

export function DisplaySettingsModal({
  isOpen,
  onClose,
  discipline,
  settings,
  onUpdateSettings,
}: DisplaySettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useNativeBackHandler(
    isOpen,
    () => {
      onClose();
      return true;
    },
    60,
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

  const accentHex = discipline === 'BJJ' ? '#FF9100' : '#FFD600';
  const labels = DISCIPLINES[discipline].labels;
  const opacityAlpha = (Math.min(100, Math.max(0, settings.backgroundOpacity)) / 100).toFixed(2);
  const colorOverride = { colorMode: settings.colorMode, solidColor: settings.solidColor };

  const exampleClassicTokens = resolveVisualTheme('WORK', settings, discipline, 0.55);
  const exampleProPalette = resolveProTimerPalette('WORK', 161, 0.55, colorOverride);

  const solidLabel = SOLID_COLOR_OPTIONS[settings.solidColor]?.label ?? 'VERDE';

  const rawSnapshots: Array<{
    key: string;
    label: string;
    time: string;
    seconds: number;
    fill: number;
    phase: TimerPhase;
    visualState: 'WORK' | 'REST';
  }> =
    settings.colorMode === 'SOLID'
      ? [
          {
            key: 'solid-start',
            label: `${solidLabel} • 20%`,
            time: '04:20',
            seconds: 260,
            fill: 0.2,
            phase: 'WORK',
            visualState: 'WORK',
          },
          {
            key: 'solid-mid',
            label: `${solidLabel} • 55%`,
            time: '02:30',
            seconds: 150,
            fill: 0.55,
            phase: 'WORK',
            visualState: 'WORK',
          },
          {
            key: 'solid-end',
            label: `${solidLabel} • 90%`,
            time: '00:45',
            seconds: 45,
            fill: 0.9,
            phase: 'WORK',
            visualState: 'WORK',
          },
        ]
      : [
          {
            key: 'work-green',
            label: `${labels.work} • Verde`,
            time: '04:59',
            seconds: 299,
            fill: 0.15,
            phase: 'WORK',
            visualState: 'WORK',
          },
          {
            key: 'work-orange',
            label: `${labels.work} • Arancione`,
            time: '02:30',
            seconds: 150,
            fill: 0.5,
            phase: 'WORK',
            visualState: 'WORK',
          },
          {
            key: 'work-red',
            label: `${labels.work} • Rosso`,
            time: '00:45',
            seconds: 45,
            fill: 0.9,
            phase: 'WORK',
            visualState: 'WORK',
          },
          {
            key: 'rest-blue',
            label: `${labels.rest} • Blu`,
            time: '00:55',
            seconds: 55,
            fill: 0.25,
            phase: 'REST',
            visualState: 'REST',
          },
          {
            key: 'rest-azure',
            label: `${labels.rest} • Azzurro`,
            time: '00:20',
            seconds: 20,
            fill: 0.8,
            phase: 'REST',
            visualState: 'REST',
          },
        ];

  const previewItems = rawSnapshots.map((snap) => ({
    ...snap,
    classicTokens: resolveVisualTheme(snap.visualState, settings, discipline, snap.fill),
    proPalette: resolveProTimerPalette(snap.phase, snap.seconds, snap.fill, colorOverride),
  }));

  const selectLayout = (timerLayout: TimerLayoutMode) => {
    soundEngine.unlock();
    triggerButtonFeedback('soft');
    onUpdateSettings({ ...settings, timerLayout });
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col overflow-hidden bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Personalizzazione Display e Test Audio"
    >
      {/* Fixed Full-Width Top Bar with X close */}
      <header className="shrink-0 border-b border-white/12 bg-black pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] pb-3.5 pl-[max(1.25rem,env(safe-area-inset-left,0px))] pr-[max(1.25rem,env(safe-area-inset-right,0px))]">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="whitespace-nowrap text-[11px] font-bold tracking-[0.16em] text-slate-400 uppercase">
              PERSONALIZZAZIONE
            </span>
            <h2
              className="whitespace-nowrap text-base font-extrabold tracking-[0.1em] uppercase sm:text-xl"
              style={{ color: accentHex }}
            >
              DISPLAY &amp; TEST AUDIO
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-neutral-950 text-slate-200 transition-colors hover:border-white/50 hover:text-white active:scale-95 cursor-pointer"
            aria-label="Chiudi Personalizzazione"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="dojo-scroll min-h-0 flex-1 overflow-y-auto pl-[max(1.25rem,env(safe-area-inset-left,0px))] pr-[max(1.25rem,env(safe-area-inset-right,0px))] pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-5">
          {/* 1. Timer Layout Selector: Modalità 1 vs Modalità 2 */}
          <div className="flex flex-col gap-3 rounded-2xl border border-white/15 bg-neutral-900/75 p-4 sm:p-5">
            <h3 className="whitespace-nowrap text-center text-sm font-extrabold tracking-[0.12em] text-white uppercase sm:text-base">
              STILE TIMER
            </h3>
            <div
              className="grid grid-cols-2 rounded-xl border border-white/15 bg-black p-1"
              role="group"
              aria-label="Stile Timer"
            >
              {LAYOUT_MODE_OPTIONS.map(({ mode, title, subtitle }) => {
                const active = settings.timerLayout === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => selectLayout(mode)}
                    aria-pressed={active}
                    className={`flex min-h-[52px] flex-col items-center justify-center rounded-lg px-2.5 py-1.5 transition-all cursor-pointer ${
                      active ? 'text-black shadow-sm' : 'text-slate-300 hover:text-white'
                    }`}
                    style={active ? { backgroundColor: accentHex } : undefined}
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

          {/* 2. Background Opacity Slider + Live Side-by-Side Examples (Classic & Scoreboard Pro) */}
          <div className="flex flex-col gap-4 rounded-2xl border border-white/15 bg-neutral-900/75 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <h3 className="whitespace-nowrap text-xs font-extrabold tracking-[0.1em] text-white uppercase sm:text-sm">
                  OPACITÀ SFONDO
                </h3>
                <span className="text-[11px] font-medium text-slate-400">
                  Valida su Modalità 1 e Modalità 2 (predefinita 50%)
                </span>
              </div>
              <span
                className="tabular-digits rounded-full border border-white/15 bg-black px-3 py-1 text-sm font-extrabold"
                style={{ color: accentHex }}
              >
                {settings.backgroundOpacity}%
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.backgroundOpacity}
              onChange={(e) => {
                soundEngine.unlock();
                onUpdateSettings({
                  ...settings,
                  backgroundOpacity: Number(e.target.value),
                });
              }}
              className="h-2.5 w-full cursor-pointer accent-yellow-400"
              aria-label="Opacità Sfondo"
              style={{ accentColor: accentHex }}
            />

            <div className="grid grid-cols-4 gap-2">
              {OPACITY_QUICK_PRESETS.map((pct) => {
                const isPresetActive = settings.backgroundOpacity === pct;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      soundEngine.unlock();
                      triggerButtonFeedback('soft');
                      onUpdateSettings({ ...settings, backgroundOpacity: pct });
                    }}
                    className={`tabular-digits min-h-[34px] rounded-lg border text-xs font-extrabold tracking-[0.06em] transition-colors cursor-pointer ${
                      isPresetActive
                        ? 'border-white/70 bg-white text-black'
                        : 'border-white/15 bg-black text-slate-300 hover:border-white/35 hover:text-white'
                    }`}
                  >
                    {pct}%{pct === 50 ? ' • DEFAULT' : ''}
                  </button>
                );
              })}
            </div>

            {/* Side-by-side Live Examples */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              {/* Example 1: Modalità 1 Cerchio Classico */}
              <button
                type="button"
                onClick={() => selectLayout('CLASSIC')}
                aria-label="Esempio Modalità 1 Cerchio Classico"
                className={`group flex flex-col gap-2 rounded-2xl border p-2.5 text-left transition-all cursor-pointer ${
                  settings.timerLayout === 'CLASSIC'
                    ? 'border-white/70 bg-black shadow-[0_0_20px_rgba(255,255,255,0.12)]'
                    : 'border-white/15 bg-black/75 hover:border-white/35'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[10px] font-extrabold tracking-[0.08em] text-white uppercase">
                    MODALITÀ 1 • CLASSICO
                  </span>
                  {settings.timerLayout === 'CLASSIC' && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold text-black uppercase"
                      style={{ backgroundColor: accentHex }}
                    >
                      ATTIVA
                    </span>
                  )}
                </div>

                <div className="relative flex h-40 w-full items-center justify-center overflow-hidden rounded-xl border border-white/12 bg-black sm:h-44">
                  {/* Opacity-controlled mirrored wave background behind circle */}
                  <ClassicWaveBackground
                    rgb={exampleClassicTokens.rgb}
                    opacity={Number(opacityAlpha)}
                    fillProgress={0.55}
                    referenceCircleSizeCss="96px"
                    supportLandscapeHorizontal={false}
                  />

                  {/* Mini black circle with water tank & ring */}
                  <div
                    className="relative z-10 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-[3px] bg-black"
                    style={{
                      borderColor: exampleClassicTokens.hex,
                      boxShadow: `0 0 14px rgba(${exampleClassicTokens.rgb}, 0.35)`,
                    }}
                  >
                    <CircularWaterTank rgb={exampleClassicTokens.rgb} fillProgress={0.55} />
                    <span
                      className="font-timer tabular-digits timer-digits-luminescent relative z-10 text-xl font-extrabold leading-none tracking-[-0.02em] text-white"
                      style={{ ['--digit-stroke' as string]: '1.8px' }}
                    >
                      02:41
                    </span>
                  </div>
                </div>
              </button>

              {/* Example 2: Modalità 2 Scoreboard Pro */}
              <button
                type="button"
                onClick={() => selectLayout('PRO')}
                aria-label="Esempio Modalità 2 Scoreboard Pro"
                className={`group flex flex-col gap-2 rounded-2xl border p-2.5 text-left transition-all cursor-pointer ${
                  settings.timerLayout === 'PRO'
                    ? 'border-white/70 bg-black shadow-[0_0_20px_rgba(255,255,255,0.12)]'
                    : 'border-white/15 bg-black/75 hover:border-white/35'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[10px] font-extrabold tracking-[0.08em] text-white uppercase">
                    MODALITÀ 2 • PRO
                  </span>
                  {settings.timerLayout === 'PRO' && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold text-black uppercase"
                      style={{ backgroundColor: accentHex }}
                    >
                      ATTIVA
                    </span>
                  )}
                </div>

                <div className="font-timer-pro relative flex h-40 w-full flex-col justify-between overflow-hidden rounded-xl border border-white/12 bg-black sm:h-44">
                  {/* Altimeter @ configured backgroundOpacity */}
                  <div
                    className="pointer-events-none absolute right-0 bottom-6 left-0 transition-all duration-150"
                    style={{
                      height: '52%',
                      backgroundColor: `rgba(${exampleProPalette.rgb}, ${opacityAlpha})`,
                      backgroundImage:
                        'repeating-linear-gradient(to top, rgba(0, 0, 0, 0.22) 0 1px, transparent 1px 6px)',
                    }}
                    aria-hidden="true"
                  >
                    <div
                      className="h-[1.5px] w-full"
                      style={{
                        backgroundColor: `rgba(${exampleProPalette.rgb}, 0.85)`,
                        boxShadow: `0 0 8px rgba(${exampleProPalette.rgb}, 0.6)`,
                      }}
                    />
                    <span
                      className="absolute top-[-1.5px] left-0 h-[3px] w-2.5 rounded-r-full"
                      style={{ backgroundColor: exampleProPalette.hex }}
                    />
                    <span
                      className="absolute top-[-1.5px] right-0 h-[3px] w-2.5 rounded-l-full"
                      style={{ backgroundColor: exampleProPalette.hex }}
                    />
                  </div>

                  {/* Axially Centered Minutes (Hollow) + Negative Bar + Solid Seconds */}
                  <div className="relative z-10 mx-auto flex w-full max-w-[116px] flex-1 flex-col items-center justify-center gap-1.5 px-2">
                    <div className="grid w-full grid-cols-[12px_1fr_12px] items-baseline">
                      <span aria-hidden="true" />
                      <span
                        className="tabular-digits justify-self-center text-[30px] font-bold leading-[0.8] tracking-[0.02em]"
                        style={{
                          color: 'rgba(255, 255, 255, 0.1)',
                          WebkitTextFillColor: 'rgba(255, 255, 255, 0.1)',
                          WebkitTextStroke: '1.5px rgba(255, 255, 255, 0.94)',
                          filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.95)) drop-shadow(0 0 6px rgba(255,255,255,0.4))',
                        }}
                      >
                        02
                      </span>
                      <span
                        className="justify-self-end text-[8px] font-bold"
                        style={{ color: exampleProPalette.hex }}
                      >
                        M
                      </span>
                    </div>

                    <div
                      className="flex h-[2px] w-full justify-start overflow-hidden rounded-full"
                      style={{ backgroundColor: exampleProPalette.hex }}
                    >
                      <div className="h-full w-[32%] bg-black" />
                    </div>

                    <div className="grid w-full grid-cols-[12px_1fr_12px] items-baseline">
                      <span aria-hidden="true" />
                      <span
                        className="tabular-digits justify-self-center text-[38px] font-bold leading-[0.8] tracking-[0.015em] text-white"
                        style={{
                          paintOrder: 'stroke fill',
                          WebkitTextStroke: '2.2px rgba(0, 0, 0, 0.95)',
                          filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.92)) drop-shadow(0 0 8px rgba(255,255,255,0.45))',
                        }}
                      >
                        41
                      </span>
                      <span
                        className="justify-self-end text-[8px] font-bold"
                        style={{ color: exampleProPalette.hex }}
                      >
                        S
                      </span>
                    </div>
                  </div>

                  {/* Vivid Mini Gradient Footer */}
                  <div
                    className="relative z-10 flex h-6 w-full items-center justify-between border-t border-white/55 px-2.5"
                    style={{
                      background: `linear-gradient(to bottom, ${exampleProPalette.footerTopHex}, ${exampleProPalette.hex} 45%)`,
                    }}
                    aria-hidden="true"
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: exampleProPalette.footerControlBg }}
                    />
                    <div
                      className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5"
                      style={{ backgroundColor: exampleProPalette.footerControlBg }}
                    >
                      <span className="h-1 w-2.5 rounded-full bg-white" />
                      <span className="h-1 w-1 rounded-full bg-white/30" />
                      <span className="h-1 w-1 rounded-full bg-white/30" />
                    </div>
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: exampleProPalette.footerControlBg }}
                    />
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* 3. Colors Selector: Automatico vs 4 Solid Colors (ROSSO, VERDE, ARANCIO, AZZURRO) */}
          <div className="flex flex-col gap-4 rounded-2xl border border-white/15 bg-neutral-900/75 p-4 sm:p-5">
            <h3 className="whitespace-nowrap text-center text-sm font-extrabold tracking-[0.12em] text-white uppercase sm:text-base">
              COLORI TIMER
            </h3>

            {/* Option A: Automatico (Proportional Phases) */}
            <button
              type="button"
              onClick={() => {
                soundEngine.unlock();
                triggerButtonFeedback('soft');
                onUpdateSettings({ ...settings, colorMode: 'AUTO' });
              }}
              aria-pressed={settings.colorMode === 'AUTO'}
              className={`flex flex-col gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                settings.colorMode === 'AUTO'
                  ? 'border-white/75 bg-black shadow-[0_0_20px_rgba(255,255,255,0.12)]'
                  : 'border-white/12 bg-black/70 opacity-75 hover:opacity-100'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold tracking-[0.08em] text-white uppercase sm:text-sm">
                  AUTOMATICO (PROGRESSIVO FASI)
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                    settings.colorMode === 'AUTO'
                      ? 'text-black'
                      : 'border border-white/20 text-slate-300'
                  }`}
                  style={
                    settings.colorMode === 'AUTO' ? { backgroundColor: accentHex } : undefined
                  }
                >
                  {settings.colorMode === 'AUTO' ? 'ATTIVO' : 'SELEZIONA'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-neutral-950 p-2.5">
                  <span className="text-[11px] font-extrabold tracking-[0.05em] text-slate-200 uppercase">
                    Round ({labels.work}) • 3 Fasi
                  </span>
                  <div
                    className="h-2.5 w-full rounded-full"
                    style={{
                      background:
                        'linear-gradient(to right, #00E676 0% 30%, #FF9100 36% 64%, #FF3B30 70% 100%)',
                    }}
                    aria-hidden="true"
                  />
                  <div className="grid grid-cols-3 text-center text-[10px] font-bold uppercase">
                    <span style={{ color: '#00E676' }}>Verde</span>
                    <span style={{ color: '#FF9100' }}>Arancio</span>
                    <span style={{ color: '#FF3B30' }}>Rosso</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-neutral-950 p-2.5">
                  <span className="text-[11px] font-extrabold tracking-[0.05em] text-slate-200 uppercase">
                    Recupero ({labels.rest})
                  </span>
                  <div
                    className="h-2.5 w-full rounded-full"
                    style={{
                      background: 'linear-gradient(to right, #2979FF 0% 45%, #00E5FF 55% 100%)',
                    }}
                    aria-hidden="true"
                  />
                  <div className="grid grid-cols-2 text-center text-[10px] font-bold uppercase">
                    <span style={{ color: '#2979FF' }}>Blu</span>
                    <span style={{ color: '#00E5FF' }}>Azzurro</span>
                  </div>
                </div>
              </div>
            </button>

            {/* Option B: Solid Colors for Both Modes */}
            <div className="flex flex-col gap-2">
              <span className="text-center text-[11px] font-extrabold tracking-[0.1em] text-slate-300 uppercase">
                COLORE PIENO (ENTRAMBE LE MODALITÀ)
              </span>
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                role="group"
                aria-label="Colore pieno fisso"
              >
                {SOLID_COLOR_ORDER.map((key) => {
                  const opt = SOLID_COLOR_OPTIONS[key];
                  const active = settings.colorMode === 'SOLID' && settings.solidColor === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        soundEngine.unlock();
                        triggerButtonFeedback('soft');
                        onUpdateSettings({
                          ...settings,
                          colorMode: 'SOLID',
                          solidColor: key,
                        });
                      }}
                      aria-pressed={active}
                      className={`flex min-h-[54px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-extrabold tracking-[0.08em] uppercase transition-all cursor-pointer ${
                        active
                          ? 'bg-black text-white'
                          : 'border-white/15 bg-black/75 text-slate-300 hover:border-white/40 hover:text-white'
                      }`}
                      style={
                        active
                          ? {
                              borderColor: opt.hex,
                              boxShadow: `0 0 18px rgba(${opt.rgb}, 0.32)`,
                            }
                          : undefined
                      }
                    >
                      <span
                        className="h-4 w-4 shrink-0 rounded-full"
                        style={{
                          backgroundColor: opt.hex,
                          boxShadow: `0 0 10px rgba(${opt.rgb}, 0.75)`,
                        }}
                        aria-hidden="true"
                      />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 4. Contrast / Glow Level Slider */}
          <div className="rounded-2xl border border-white/15 bg-black px-4 py-3.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="whitespace-nowrap text-xs font-extrabold tracking-[0.06em] text-slate-200 uppercase sm:text-sm">
                Contrasto &amp; Bagliore
              </span>
              <span className="tabular-digits whitespace-nowrap text-sm font-bold" style={{ color: accentHex }}>
                {settings.contrastLevel}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.contrastLevel}
              onChange={(e) => {
                soundEngine.unlock();
                triggerButtonFeedback('soft');
                onUpdateSettings({ ...settings, contrastLevel: Number(e.target.value) });
              }}
              className="h-2.5 w-full cursor-pointer accent-yellow-400"
              aria-label="Livello Contrasto e Bagliore"
            />
          </div>

          {/* 5. Audio Signals Test Strip */}
          <div className="rounded-2xl border border-white/15 bg-black px-4 py-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-2 whitespace-nowrap text-xs font-extrabold tracking-[0.06em] text-white uppercase sm:text-sm">
                <Volume2 className="h-4 w-4 shrink-0" style={{ color: accentHex }} />
                Test Segnali Audio
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <button
                type="button"
                onClick={() => {
                  soundEngine.unlock();
                  soundEngine.playPrepCountdownPreview();
                }}
                className="whitespace-nowrap min-h-[44px] rounded-xl border border-white/20 bg-neutral-900 px-2.5 text-xs font-extrabold tracking-[0.05em] uppercase text-white hover:border-white/50 cursor-pointer"
              >
                Conteggio Prep
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.unlock();
                  soundEngine.playHajime();
                }}
                className="whitespace-nowrap min-h-[44px] rounded-xl border border-white/20 bg-neutral-900 px-2.5 text-xs font-extrabold tracking-[0.05em] uppercase text-white hover:border-white/50 cursor-pointer"
              >
                Hajime + Gong
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.unlock();
                  soundEngine.playWarningBell();
                }}
                className="whitespace-nowrap min-h-[44px] rounded-xl border border-white/20 bg-neutral-900 px-2.5 text-xs font-extrabold tracking-[0.05em] uppercase text-white hover:border-white/50 cursor-pointer"
              >
                Preavviso
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.unlock();
                  soundEngine.playMate();
                }}
                className="whitespace-nowrap min-h-[44px] rounded-xl border border-white/20 bg-neutral-900 px-2.5 text-xs font-extrabold tracking-[0.05em] uppercase text-white hover:border-white/50 cursor-pointer"
              >
                Campana + Mate
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.unlock();
                  soundEngine.playSoremade();
                }}
                className="whitespace-nowrap col-span-2 sm:col-span-1 min-h-[44px] rounded-xl border border-white/20 bg-neutral-900 px-2.5 text-xs font-extrabold tracking-[0.05em] uppercase text-white hover:border-white/50 cursor-pointer"
              >
                Campana finale
              </button>
            </div>
          </div>

          {/* 6. Live PREVIEW Section */}
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/15 bg-black p-4">
            <span className="text-xs font-bold tracking-[0.18em] text-slate-300 uppercase">
              PREVIEW ({settings.timerLayout === 'PRO' ? 'SCOREBOARD PRO' : 'CERCHIO CLASSICO'})
            </span>

            <div className="flex flex-wrap items-center justify-center gap-5">
              {previewItems.map((item) => {
                const [mm, ss] = item.time.split(':');
                const secElapsedPct = (((60 - (Number(ss) % 60)) % 60) / 60) * 100;
                const classic = item.classicTokens;
                const pro = item.proPalette;
                return (
                  <div key={item.key} className="flex flex-col items-center gap-1.5">
                    {settings.timerLayout === 'PRO' ? (
                      <div
                        className="font-timer-pro relative flex h-34 w-24 flex-col justify-between overflow-hidden rounded-2xl border bg-black"
                        style={{
                          borderColor: `rgba(${pro.rgb}, 0.55)`,
                          boxShadow: `0 0 ${Math.round(8 + (settings.contrastLevel / 100) * 18)}px rgba(${pro.rgb}, 0.35)`,
                        }}
                      >
                        <div
                          className="pointer-events-none absolute right-0 bottom-5 left-0"
                          style={{
                            height: `${Math.round(item.fill * 78)}%`,
                            backgroundColor: `rgba(${pro.rgb}, ${opacityAlpha})`,
                            backgroundImage:
                              'repeating-linear-gradient(to top, rgba(0, 0, 0, 0.22) 0 1px, transparent 1px 6px)',
                          }}
                          aria-hidden="true"
                        >
                          <div
                            className="h-[1.5px] w-full"
                            style={{
                              backgroundColor: `rgba(${pro.rgb}, 0.85)`,
                              boxShadow: `0 0 8px rgba(${pro.rgb}, 0.6)`,
                            }}
                          />
                          <span
                            className="absolute top-[-1.5px] left-0 h-[3px] w-2 rounded-r-full"
                            style={{ backgroundColor: pro.hex }}
                          />
                          <span
                            className="absolute top-[-1.5px] right-0 h-[3px] w-2 rounded-l-full"
                            style={{ backgroundColor: pro.hex }}
                          />
                        </div>

                        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-1 px-2">
                          <div className="grid w-full grid-cols-[10px_1fr_10px] items-baseline">
                            <span aria-hidden="true" />
                            <span
                              className="tabular-digits justify-self-center text-[24px] font-bold leading-[0.8] tracking-[0.02em]"
                              style={{
                                color: 'rgba(255, 255, 255, 0.1)',
                                WebkitTextFillColor: 'rgba(255, 255, 255, 0.1)',
                                WebkitTextStroke: '1.4px rgba(255, 255, 255, 0.92)',
                                filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.95)) drop-shadow(0 0 6px rgba(255,255,255,0.4))',
                              }}
                            >
                              {mm}
                            </span>
                            <span
                              className="justify-self-end text-[7px] font-bold"
                              style={{ color: pro.hex }}
                            >
                              M
                            </span>
                          </div>
                          <div
                            className="flex h-[2px] w-full justify-start overflow-hidden rounded-full"
                            style={{ backgroundColor: pro.hex }}
                          >
                            <div
                              className="h-full bg-black"
                              style={{ width: `${secElapsedPct.toFixed(1)}%` }}
                            />
                          </div>
                          <div className="grid w-full grid-cols-[10px_1fr_10px] items-baseline">
                            <span aria-hidden="true" />
                            <span
                              className="tabular-digits justify-self-center text-[30px] font-bold leading-[0.8] tracking-[0.015em] text-white"
                              style={{
                                paintOrder: 'stroke fill',
                                WebkitTextStroke: '2px rgba(0, 0, 0, 0.95)',
                                filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.92)) drop-shadow(0 0 8px rgba(255,255,255,0.45))',
                              }}
                            >
                              {ss}
                            </span>
                            <span
                              className="justify-self-end text-[7px] font-bold"
                              style={{ color: pro.hex }}
                            >
                              S
                            </span>
                          </div>
                        </div>

                        <div
                          className="relative z-10 flex h-5 w-full items-center justify-center border-t border-white/55 px-2"
                          style={{
                            background: `linear-gradient(to bottom, ${pro.footerTopHex}, ${pro.hex} 45%)`,
                          }}
                          aria-hidden="true"
                        >
                          <div
                            className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5"
                            style={{ backgroundColor: pro.footerControlBg }}
                          >
                            <span className="h-1 w-2 rounded-full bg-white" />
                            <span className="h-1 w-1 rounded-full bg-white/30" />
                            <span className="h-1 w-1 rounded-full bg-white/30" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="relative flex h-34 w-24 items-center justify-center overflow-hidden rounded-2xl border bg-black"
                        style={{
                          borderColor: `rgba(${classic.rgb}, 0.5)`,
                          boxShadow: `0 0 ${Math.round(8 + (settings.contrastLevel / 100) * 18)}px rgba(${classic.rgb}, 0.35)`,
                        }}
                      >
                        <ClassicWaveBackground
                          rgb={classic.rgb}
                          opacity={Number(opacityAlpha)}
                          fillProgress={item.fill}
                          referenceCircleSizeCss="80px"
                          supportLandscapeHorizontal={false}
                        />

                        <div
                          className="relative z-10 flex h-20 w-20 flex-col items-center justify-center overflow-hidden rounded-full border-[3px] bg-black"
                          style={{
                            borderColor: classic.hex,
                            boxShadow: `0 0 12px rgba(${classic.rgb}, 0.4)`,
                          }}
                        >
                          <CircularWaterTank rgb={classic.rgb} fillProgress={item.fill} />
                          <span
                            className="font-timer tabular-digits timer-digits-luminescent relative z-10 text-lg font-extrabold leading-none tracking-[-0.02em] text-white"
                            style={{
                              color: '#FFFFFF',
                              ['--digit-stroke' as string]: '1.6px',
                            }}
                          >
                            {item.time}
                          </span>
                        </div>
                      </div>
                    )}
                    <span
                      className="text-[10px] font-bold tracking-wider uppercase"
                      style={{ color: settings.timerLayout === 'PRO' ? pro.hex : classic.hex }}
                    >
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
