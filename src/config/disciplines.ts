import type { AudioMode, DisciplineMode } from '../types/timer';

const BASE_URL = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');

export interface DisciplineConfig {
  id: DisciplineMode;
  title: string;
  clubSubtitle: string;
  modeDescription: string;
  logoSrc: string;
  logoShape: 'rounded-card' | 'circle-crop';
  defaultAudioMode: AudioMode;
  preferredProgramKeyword: string;
  labels: {
    work: string;
    rest: string;
    finished: string;
  };
}

export const DISCIPLINES: Record<DisciplineMode, DisciplineConfig> = {
  JUDO: {
    id: 'JUDO',
    title: 'JUDO',
    clubSubtitle: 'Judo / Jujitsu Feltre',
    modeDescription: 'Conteggio Giapponese 10→1 • Hajime • Matte • Soremade + Gong',
    logoSrc: `${BASE_URL}logos/judo-logo.jpg`,
    logoShape: 'rounded-card',
    defaultAudioMode: 'VOICE_GONG',
    preferredProgramKeyword: 'judo',
    labels: {
      work: 'HAJIME',
      rest: 'MATTE',
      finished: 'SOREMADE',
    },
  },
  BJJ: {
    id: 'BJJ',
    title: 'BJJ',
    clubSubtitle: 'Rilion Gracie Jiu-Jitsu • Feltre',
    modeDescription: 'Solo Gong, Clapper & Segnali Acustici',
    logoSrc: `${BASE_URL}logos/bjj-logo.png`,
    logoShape: 'circle-crop',
    defaultAudioMode: 'GONG_ONLY',
    preferredProgramKeyword: 'bjj',
    labels: {
      work: 'COMBATTIMENTO',
      rest: 'RECUPERO',
      finished: 'FINE SESSIONE',
    },
  },
};
