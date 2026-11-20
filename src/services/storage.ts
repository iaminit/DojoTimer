import type {
  AudioMode,
  DisciplineMode,
  DisplaySettings,
  PaletteColorKey,
  QuickSetupConfig,
  SolidColorKey,
  TimerColorMode,
  TimerLayoutMode,
  VoiceProfile,
  WorkoutProgram,
} from '../types/timer';

export const STORAGE_KEYS = {
  PROGRAMS: 'dojo_timer_programs_v1',
  ACTIVE_PROGRAM_ID: 'dojo_timer_active_program_id_v1',
  ACTIVE_PROGRAM_JUDO: 'dojo_timer_active_program_judo_v1',
  ACTIVE_PROGRAM_BJJ: 'dojo_timer_active_program_bjj_v1',
  AUDIO_MODE: 'dojo_timer_audio_mode_v1',
  AUDIO_MODE_JUDO: 'dojo_timer_audio_mode_judo_v1',
  AUDIO_MODE_BJJ: 'dojo_timer_audio_mode_bjj_v1',
  VOICE_PROFILE: 'dojo_timer_voice_profile_v1',
  DISPLAY_SETTINGS: 'dojo_timer_display_settings_v1',
  DISPLAY_SETTINGS_JUDO: 'dojo_timer_display_settings_judo_v1',
  DISPLAY_SETTINGS_BJJ: 'dojo_timer_display_settings_bjj_v1',
  WARNING_30_MIGRATED: 'dojo_timer_warning_30_migrated_v1',
  SETUP_CONFIG_JUDO: 'dojo_timer_setup_config_judo_v1',
  SETUP_CONFIG_BJJ: 'dojo_timer_setup_config_bjj_v1',
  ACTIVE_SESSION: 'dojo_timer_active_session_v1',
  BASE_PROGRAMS_V2_MIGRATED: 'dojo_timer_base_programs_v2_migrated_v1',
  EVENT_HAPTICS_ENABLED: 'dojo_timer_event_haptics_v1',
} as const;

const LEGACY_DEFAULT_PROGRAM_IDS = new Set([
  'd0j00001-0001-4000-8000-000000000001',
  'd0j00002-0002-4000-8000-000000000002',
  'd0j00003-0003-4000-8000-000000000003',
  'd0j00004-0004-4000-8000-000000000004',
  'd0j00005-0005-4000-8000-000000000005',
  'd0j00006-0006-4000-8000-000000000006',
]);

export const PROGRAM_LIMITS = {
  rounds: { min: 1, max: 99 },
  workSeconds: { min: 5, max: 7200 },
  restSeconds: { min: 0, max: 3600 },
  prepSeconds: { min: 0, max: 300 },
  warningSeconds: { min: 0, max: 120 },
} as const;

export const MAX_IMPORT_JSON_BYTES = 512 * 1024; // 512 KB max JSON import size
export const MAX_STORED_PROGRAMS = 200;

const SAFE_PROGRAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DISALLOWED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_CHARS_RE = /[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeTextInput(raw: string, maxLength = 80): string {
  return raw.replace(UNSAFE_TEXT_CHARS_RE, '').trim().slice(0, maxLength);
}

function sanitizeProgramId(raw: unknown): string {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (SAFE_PROGRAM_ID_RE.test(trimmed) && !DISALLOWED_KEYS.has(trimmed)) {
      return trimmed;
    }
  }
  return generateUuid();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getDefaultDisplaySettings(discipline: DisciplineMode = 'JUDO'): DisplaySettings {
  return {
    activeColor: 'YELLOW',
    useSelectedForWork: true,
    useComplementaryForRest: false,
    contrastLevel: 80,
    timerLayout: discipline === 'BJJ' ? 'PRO' : 'CLASSIC',
    backgroundOpacity: 50,
    colorMode: 'AUTO',
    solidColor: 'GREEN',
  };
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = getDefaultDisplaySettings('JUDO');

export const DEFAULT_AUDIO_MODE: AudioMode = 'VOICE_GONG';
export const DEFAULT_VOICE_PROFILE: VoiceProfile = 'KENGURO';

const VALID_PALETTE_COLORS: readonly PaletteColorKey[] = ['YELLOW', 'GREEN', 'RED', 'ORANGE'];
const VALID_TIMER_LAYOUTS: readonly TimerLayoutMode[] = ['CLASSIC', 'PRO'];
const VALID_COLOR_MODES: readonly TimerColorMode[] = ['AUTO', 'SOLID'];
const VALID_SOLID_COLORS: readonly SolidColorKey[] = ['RED', 'GREEN', 'ORANGE', 'AZURE'];
const VALID_AUDIO_MODES: readonly AudioMode[] = ['VOICE_GONG', 'GONG_ONLY'];
const VALID_VOICE_PROFILES: readonly VoiceProfile[] = ['KENGURO', 'ARALE'];

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function createDefaultPrograms(now = Date.now()): WorkoutProgram[] {
  return [
    {
      id: 'd0j00002-0002-4000-8000-000000000002',
      name: 'Randori Judo',
      discipline: 'JUDO',
      rounds: 6,
      workSeconds: 180,
      restSeconds: 60,
      prepSeconds: 10,
      warningSeconds: 30,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'd0j00003-0003-4000-8000-000000000003',
      name: 'Sparring BJJ',
      discipline: 'BJJ',
      rounds: 6,
      workSeconds: 240,
      restSeconds: 60,
      prepSeconds: 10,
      warningSeconds: 30,
      createdAt: now + 1,
      updatedAt: now + 1,
    },
  ];
}

export function resolveLandingProgramForDiscipline(
  programs: WorkoutProgram[],
  discipline: DisciplineMode,
  savedProgramId?: string | null,
): WorkoutProgram {
  const modePrograms = programs.filter((p) => p.discipline === discipline);
  const preferredKeyword = discipline === 'BJJ' ? 'bjj' : 'judo';

  const matched =
    (savedProgramId ? modePrograms.find((p) => p.id === savedProgramId) : undefined) ??
    modePrograms.find((p) => p.name.toLowerCase().includes(preferredKeyword)) ??
    modePrograms[0];

  if (matched) {
    return matched;
  }

  const defaults = createDefaultPrograms();
  return defaults.find((p) => p.discipline === discipline) ?? defaults[0];
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function inferDisciplineFromName(name: string): DisciplineMode {
  return /bjj|gracie|rolling|no-?gi|submission/i.test(name) ? 'BJJ' : 'JUDO';
}

export function sanitizeWorkoutProgram(raw: unknown): WorkoutProgram | null {
  if (!isPlainRecord(raw)) {
    return null;
  }
  const obj = raw;
  const nameRaw = typeof obj.name === 'string' ? sanitizeTextInput(obj.name, 80) : '';
  if (!nameRaw) {
    return null;
  }

  // Require workSeconds and rounds to be valid finite numbers
  if (typeof obj.rounds !== 'number' || !Number.isFinite(obj.rounds)) {
    return null;
  }
  if (typeof obj.workSeconds !== 'number' || !Number.isFinite(obj.workSeconds)) {
    return null;
  }

  const now = Date.now();
  const id = sanitizeProgramId(obj.id);
  const discipline: DisciplineMode =
    obj.discipline === 'JUDO' || obj.discipline === 'BJJ'
      ? obj.discipline
      : inferDisciplineFromName(nameRaw);

  return {
    id,
    name: nameRaw,
    discipline,
    rounds: clampInt(obj.rounds, PROGRAM_LIMITS.rounds.min, PROGRAM_LIMITS.rounds.max, 5),
    workSeconds: clampInt(
      obj.workSeconds,
      PROGRAM_LIMITS.workSeconds.min,
      PROGRAM_LIMITS.workSeconds.max,
      300,
    ),
    restSeconds: clampInt(
      obj.restSeconds,
      PROGRAM_LIMITS.restSeconds.min,
      PROGRAM_LIMITS.restSeconds.max,
      60,
    ),
    prepSeconds: clampInt(
      obj.prepSeconds,
      PROGRAM_LIMITS.prepSeconds.min,
      PROGRAM_LIMITS.prepSeconds.max,
      10,
    ),
    warningSeconds: clampInt(
      obj.warningSeconds,
      PROGRAM_LIMITS.warningSeconds.min,
      PROGRAM_LIMITS.warningSeconds.max,
      30,
    ),
    createdAt:
      typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt) ? obj.createdAt : now,
    updatedAt:
      typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : now,
  };
}

function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota or private mode failures
  }
}

export function loadPrograms(): WorkoutProgram[] {
  const raw = safeGetItem(STORAGE_KEYS.PROGRAMS);
  if (raw === null) {
    const seeded = createDefaultPrograms();
    savePrograms(seeded);
    safeSetItem(STORAGE_KEYS.WARNING_30_MIGRATED, '1');
    safeSetItem(STORAGE_KEYS.BASE_PROGRAMS_V2_MIGRATED, '1');
    return seeded;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      const seeded = createDefaultPrograms();
      savePrograms(seeded);
      safeSetItem(STORAGE_KEYS.WARNING_30_MIGRATED, '1');
      safeSetItem(STORAGE_KEYS.BASE_PROGRAMS_V2_MIGRATED, '1');
      return seeded;
    }

    const rawHadMissingDiscipline = parsed.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        (item as Record<string, unknown>).discipline !== 'JUDO' &&
        (item as Record<string, unknown>).discipline !== 'BJJ',
    );

    const valid = parsed
      .slice(0, MAX_STORED_PROGRAMS)
      .map(sanitizeWorkoutProgram)
      .filter((item): item is WorkoutProgram => item !== null);

    let result = valid;
    let shouldPersist = false;

    if (rawHadMissingDiscipline) {
      const defaults = createDefaultPrograms();
      const existingIds = new Set(valid.map((p) => p.id));
      const existingNames = new Set(valid.map((p) => p.name.toLowerCase()));
      const missingDefaults = defaults.filter(
        (d) => !existingIds.has(d.id) && !existingNames.has(d.name.toLowerCase()),
      );
      result = [...valid, ...missingDefaults];
      shouldPersist = true;
    }

    if (safeGetItem(STORAGE_KEYS.WARNING_30_MIGRATED) !== '1') {
      let migratedWarning = false;
      result = result.map((p) => {
        if (p.warningSeconds === 10) {
          migratedWarning = true;
          return { ...p, warningSeconds: 30 };
        }
        return p;
      });
      if (migratedWarning) {
        shouldPersist = true;
      }
      safeSetItem(STORAGE_KEYS.WARNING_30_MIGRATED, '1');
    }

    if (safeGetItem(STORAGE_KEYS.BASE_PROGRAMS_V2_MIGRATED) !== '1') {
      if (result.some((p) => LEGACY_DEFAULT_PROGRAM_IDS.has(p.id))) {
        const customPrograms = result.filter((p) => !LEGACY_DEFAULT_PROGRAM_IDS.has(p.id));
        result = [...createDefaultPrograms(), ...customPrograms];
        shouldPersist = true;
      }
      safeSetItem(STORAGE_KEYS.BASE_PROGRAMS_V2_MIGRATED, '1');
    }

    if (shouldPersist) {
      savePrograms(result);
    }

    return result;
  } catch {
    const seeded = createDefaultPrograms();
    savePrograms(seeded);
    safeSetItem(STORAGE_KEYS.WARNING_30_MIGRATED, '1');
    safeSetItem(STORAGE_KEYS.BASE_PROGRAMS_V2_MIGRATED, '1');
    return seeded;
  }
}

export function getDefaultSetupConfig(discipline: DisciplineMode): QuickSetupConfig {
  return {
    workSeconds: discipline === 'BJJ' ? 240 : 180,
    restSeconds: 60,
    rounds: 6,
    prepSeconds: 10,
    warningSeconds: 30,
  };
}

export function programToSetupConfig(
  program: Pick<
    WorkoutProgram,
    'workSeconds' | 'restSeconds' | 'rounds' | 'prepSeconds' | 'warningSeconds'
  >,
): QuickSetupConfig {
  return {
    workSeconds: clampInt(
      program.workSeconds,
      PROGRAM_LIMITS.workSeconds.min,
      PROGRAM_LIMITS.workSeconds.max,
      300,
    ),
    restSeconds: clampInt(
      program.restSeconds,
      PROGRAM_LIMITS.restSeconds.min,
      PROGRAM_LIMITS.restSeconds.max,
      60,
    ),
    rounds: clampInt(program.rounds, PROGRAM_LIMITS.rounds.min, PROGRAM_LIMITS.rounds.max, 5),
    prepSeconds: clampInt(
      program.prepSeconds,
      PROGRAM_LIMITS.prepSeconds.min,
      PROGRAM_LIMITS.prepSeconds.max,
      10,
    ),
    warningSeconds: clampInt(
      program.warningSeconds,
      PROGRAM_LIMITS.warningSeconds.min,
      PROGRAM_LIMITS.warningSeconds.max,
      30,
    ),
  };
}

export function loadSetupConfig(discipline: DisciplineMode): QuickSetupConfig {
  const defaults = getDefaultSetupConfig(discipline);
  const key =
    discipline === 'BJJ' ? STORAGE_KEYS.SETUP_CONFIG_BJJ : STORAGE_KEYS.SETUP_CONFIG_JUDO;
  const raw = safeGetItem(key);
  if (!raw) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<QuickSetupConfig>;
    return {
      workSeconds: clampInt(
        parsed.workSeconds,
        PROGRAM_LIMITS.workSeconds.min,
        PROGRAM_LIMITS.workSeconds.max,
        defaults.workSeconds,
      ),
      restSeconds: clampInt(
        parsed.restSeconds,
        PROGRAM_LIMITS.restSeconds.min,
        PROGRAM_LIMITS.restSeconds.max,
        defaults.restSeconds,
      ),
      rounds: clampInt(
        parsed.rounds,
        PROGRAM_LIMITS.rounds.min,
        PROGRAM_LIMITS.rounds.max,
        defaults.rounds,
      ),
      prepSeconds: clampInt(
        parsed.prepSeconds,
        PROGRAM_LIMITS.prepSeconds.min,
        PROGRAM_LIMITS.prepSeconds.max,
        defaults.prepSeconds,
      ),
      warningSeconds: clampInt(
        parsed.warningSeconds,
        PROGRAM_LIMITS.warningSeconds.min,
        PROGRAM_LIMITS.warningSeconds.max,
        defaults.warningSeconds,
      ),
    };
  } catch {
    return defaults;
  }
}

export function saveSetupConfig(discipline: DisciplineMode, config: QuickSetupConfig): void {
  const key =
    discipline === 'BJJ' ? STORAGE_KEYS.SETUP_CONFIG_BJJ : STORAGE_KEYS.SETUP_CONFIG_JUDO;
  safeSetItem(key, JSON.stringify(config));
}

export function savePrograms(programs: WorkoutProgram[]): void {
  safeSetItem(STORAGE_KEYS.PROGRAMS, JSON.stringify(programs));
}

export function loadActiveProgramId(): string | null {
  return safeGetItem(STORAGE_KEYS.ACTIVE_PROGRAM_ID);
}

export function saveActiveProgramId(id: string): void {
  safeSetItem(STORAGE_KEYS.ACTIVE_PROGRAM_ID, id);
}

export function loadActiveProgramIdForDiscipline(discipline: DisciplineMode): string | null {
  return safeGetItem(
    discipline === 'BJJ' ? STORAGE_KEYS.ACTIVE_PROGRAM_BJJ : STORAGE_KEYS.ACTIVE_PROGRAM_JUDO,
  );
}

export function saveActiveProgramIdForDiscipline(discipline: DisciplineMode, id: string): void {
  safeSetItem(
    discipline === 'BJJ' ? STORAGE_KEYS.ACTIVE_PROGRAM_BJJ : STORAGE_KEYS.ACTIVE_PROGRAM_JUDO,
    id,
  );
}

export function resolveEffectiveAudioMode(
  discipline: DisciplineMode,
  preferred: AudioMode,
): AudioMode {
  return discipline === 'BJJ' ? 'GONG_ONLY' : preferred;
}

export function loadAudioMode(): AudioMode {
  const raw = safeGetItem(STORAGE_KEYS.AUDIO_MODE);
  if (raw && (VALID_AUDIO_MODES as readonly string[]).includes(raw)) {
    return raw as AudioMode;
  }
  return DEFAULT_AUDIO_MODE;
}

export function saveAudioMode(mode: AudioMode): void {
  safeSetItem(STORAGE_KEYS.AUDIO_MODE, mode);
}

export function loadAudioModeForDiscipline(discipline: DisciplineMode): AudioMode {
  if (discipline === 'BJJ') {
    return 'GONG_ONLY';
  }
  const perDisc = safeGetItem(STORAGE_KEYS.AUDIO_MODE_JUDO);
  if (perDisc && (VALID_AUDIO_MODES as readonly string[]).includes(perDisc)) {
    return perDisc as AudioMode;
  }
  const legacy = safeGetItem(STORAGE_KEYS.AUDIO_MODE);
  if (legacy && (VALID_AUDIO_MODES as readonly string[]).includes(legacy)) {
    return legacy as AudioMode;
  }
  return DEFAULT_AUDIO_MODE;
}

export function saveAudioModeForDiscipline(discipline: DisciplineMode, mode: AudioMode): void {
  const effective = resolveEffectiveAudioMode(discipline, mode);
  if (discipline === 'BJJ') {
    safeSetItem(STORAGE_KEYS.AUDIO_MODE_BJJ, effective);
    return;
  }
  safeSetItem(STORAGE_KEYS.AUDIO_MODE_JUDO, effective);
  safeSetItem(STORAGE_KEYS.AUDIO_MODE, effective);
}

export function loadVoiceProfile(): VoiceProfile {
  const raw = safeGetItem(STORAGE_KEYS.VOICE_PROFILE);
  if (raw && (VALID_VOICE_PROFILES as readonly string[]).includes(raw)) {
    return raw as VoiceProfile;
  }
  return DEFAULT_VOICE_PROFILE;
}

export function saveVoiceProfile(profile: VoiceProfile): void {
  safeSetItem(STORAGE_KEYS.VOICE_PROFILE, profile);
}

function sanitizeDisplaySettings(raw: string | null, defaults: DisplaySettings): DisplaySettings {
  if (!raw) {
    return { ...defaults };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DisplaySettings>;
    const activeColor =
      parsed.activeColor && (VALID_PALETTE_COLORS as readonly string[]).includes(parsed.activeColor)
        ? parsed.activeColor
        : defaults.activeColor;
    const timerLayout =
      parsed.timerLayout &&
      (VALID_TIMER_LAYOUTS as readonly string[]).includes(parsed.timerLayout)
        ? parsed.timerLayout
        : defaults.timerLayout;
    const colorMode =
      parsed.colorMode && (VALID_COLOR_MODES as readonly string[]).includes(parsed.colorMode)
        ? parsed.colorMode
        : defaults.colorMode;
    const solidColor =
      parsed.solidColor && (VALID_SOLID_COLORS as readonly string[]).includes(parsed.solidColor)
        ? parsed.solidColor
        : defaults.solidColor;
    return {
      activeColor,
      useSelectedForWork:
        typeof parsed.useSelectedForWork === 'boolean'
          ? parsed.useSelectedForWork
          : defaults.useSelectedForWork,
      useComplementaryForRest:
        typeof parsed.useComplementaryForRest === 'boolean'
          ? parsed.useComplementaryForRest
          : defaults.useComplementaryForRest,
      contrastLevel: clampInt(parsed.contrastLevel, 0, 100, defaults.contrastLevel),
      timerLayout,
      backgroundOpacity: clampInt(
        parsed.backgroundOpacity,
        0,
        100,
        defaults.backgroundOpacity,
      ),
      colorMode,
      solidColor,
    };
  } catch {
    return { ...defaults };
  }
}

export function loadDisplaySettings(): DisplaySettings {
  return sanitizeDisplaySettings(
    safeGetItem(STORAGE_KEYS.DISPLAY_SETTINGS),
    DEFAULT_DISPLAY_SETTINGS,
  );
}

export function saveDisplaySettings(settings: DisplaySettings): void {
  safeSetItem(STORAGE_KEYS.DISPLAY_SETTINGS, JSON.stringify(settings));
}

export function loadDisplaySettingsForDiscipline(discipline: DisciplineMode): DisplaySettings {
  const key =
    discipline === 'BJJ' ? STORAGE_KEYS.DISPLAY_SETTINGS_BJJ : STORAGE_KEYS.DISPLAY_SETTINGS_JUDO;
  return sanitizeDisplaySettings(safeGetItem(key), getDefaultDisplaySettings(discipline));
}

export function saveDisplaySettingsForDiscipline(
  discipline: DisciplineMode,
  settings: DisplaySettings,
): void {
  const key =
    discipline === 'BJJ' ? STORAGE_KEYS.DISPLAY_SETTINGS_BJJ : STORAGE_KEYS.DISPLAY_SETTINGS_JUDO;
  safeSetItem(key, JSON.stringify(settings));
}

export const DEFAULT_EVENT_HAPTICS_ENABLED = true;

export function loadEventHapticsEnabled(): boolean {
  const raw = safeGetItem(STORAGE_KEYS.EVENT_HAPTICS_ENABLED);
  if (raw === '0' || raw === 'false') {
    return false;
  }
  return DEFAULT_EVENT_HAPTICS_ENABLED;
}

export function saveEventHapticsEnabled(enabled: boolean): void {
  safeSetItem(STORAGE_KEYS.EVENT_HAPTICS_ENABLED, enabled ? '1' : '0');
}

export interface ExportPayload {
  version: number;
  exportedAt: string;
  programs: WorkoutProgram[];
}

export function exportProgramsJson(programs: WorkoutProgram[]): string {
  const payload: ExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    programs,
  };
  return JSON.stringify(payload, null, 2);
}

export type ImportProgramsResult =
  | {
      ok: true;
      programs: WorkoutProgram[];
      importedCount: number;
      skippedCount: number;
    }
  | {
      ok: false;
      error: string;
    };

export function parseImportProgramsJson(
  jsonText: string,
  existingPrograms: WorkoutProgram[],
): ImportProgramsResult {
  if (jsonText.length > MAX_IMPORT_JSON_BYTES) {
    return {
      ok: false,
      error: 'File JSON troppo grande: dimensione massima consentita 512 KB.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'File JSON non valido: errore di sintassi.' };
  }

  let rawList: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (
    isPlainRecord(parsed) &&
    Object.prototype.hasOwnProperty.call(parsed, 'programs') &&
    Array.isArray(parsed.programs)
  ) {
    rawList = parsed.programs as unknown[];
  }

  if (!rawList) {
    return {
      ok: false,
      error: 'Formato non riconosciuto: atteso array di programmi o oggetto { programs: [...] }.',
    };
  }

  const availableSlots = Math.max(0, MAX_STORED_PROGRAMS - existingPrograms.length);
  if (availableSlots === 0) {
    return {
      ok: false,
      error: `Limite massimo raggiunto (${MAX_STORED_PROGRAMS} programmi salvati). Elimina qualche programma prima di importare.`,
    };
  }

  const existingIds = new Set(existingPrograms.map((p) => p.id));
  const imported: WorkoutProgram[] = [];
  let skippedCount = 0;

  for (const item of rawList) {
    if (imported.length >= availableSlots) {
      skippedCount += 1;
      continue;
    }
    const clean = sanitizeWorkoutProgram(item);
    if (!clean) {
      skippedCount += 1;
      continue;
    }
    let finalId = clean.id;
    while (existingIds.has(finalId)) {
      finalId = generateUuid();
    }
    existingIds.add(finalId);
    imported.push({
      ...clean,
      id: finalId,
      updatedAt: Date.now(),
    });
  }

  if (imported.length === 0) {
    return {
      ok: false,
      error: 'Nessun programma valido trovato nel file selezionato.',
    };
  }

  return {
    ok: true,
    programs: [...existingPrograms, ...imported],
    importedCount: imported.length,
    skippedCount,
  };
}
