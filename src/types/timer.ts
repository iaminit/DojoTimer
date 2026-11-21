export type DisciplineMode = 'JUDO' | 'BJJ';

export interface WorkoutProgram {
  id: string; // UUID v4
  name: string;
  discipline: DisciplineMode;
  rounds: number; // 1-99
  workSeconds: number;
  restSeconds: number;
  prepSeconds: number; // default 10s
  warningSeconds: number; // default 30s
  createdAt: number;
  updatedAt: number;
}

export interface QuickSetupConfig {
  workSeconds: number;
  restSeconds: number;
  rounds: number;
  prepSeconds: number;
  warningSeconds: number; // default 30s
}

export type TimerPhase = 'IDLE' | 'PREP' | 'WORK' | 'REST' | 'FINISHED';

export type VisualTimerState =
  | 'IDLE'
  | 'PREP'
  | 'WORK'
  | 'WARNING'
  | 'REST'
  | 'PAUSED'
  | 'FINISHED';

export type AudioMode = 'VOICE_GONG' | 'GONG_ONLY';

export type VoiceProfile = 'KENGURO' | 'ARALE';

export type VuMeterMode = 'OFF' | 'LOCAL_PLAYER' | 'SESSION_VISUALIZER' | 'PLAYBACK_CAPTURE';

export type PaletteColorKey = 'YELLOW' | 'GREEN' | 'RED' | 'ORANGE';

export type TimerLayoutMode = 'CLASSIC' | 'PRO';

export type TimerColorMode = 'AUTO' | 'SOLID';

export type SolidColorKey = 'RED' | 'GREEN' | 'ORANGE' | 'AZURE';

export interface DisplaySettings {
  activeColor: PaletteColorKey;
  useSelectedForWork: boolean;
  useComplementaryForRest: boolean;
  contrastLevel: number; // 0-100
  timerLayout: TimerLayoutMode;
  backgroundOpacity: number; // 0-100 (default 50)
  digitScale: number; // 70-135 (default 100; portrait applies -5%)
  colorMode: TimerColorMode;
  solidColor: SolidColorKey;
}
