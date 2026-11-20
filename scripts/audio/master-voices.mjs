#!/usr/bin/env node
/**
 * Mastering delle clip vocali del Dojo Timer.
 *
 * Sorgenti:  audio-src/voice/<nome>.(wav|aif|aiff|flac|m4a|mp3)
 * Output:    public/audio/<profilo>/<nome>.mp3  (profilo: kenguro | arale)
 *
 * Catena: taglio silenzi -> passa-alto 90 Hz -> pulizia "boxiness" 250 Hz ->
 * presenza 3 kHz -> compressione morbida -> normalizzazione RMS uniforme ->
 * limiter -1 dBFS -> micro-fade -> coda di 80 ms.
 *
 * Uso:  npm run audio:master -- --profile kenguro
 *       npm run audio:master -- --profile arale hajime
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

const VALID_PROFILES = new Set(['kenguro', 'arale']);

function parseCliArgs(argv) {
  let profile = null;
  const clipNames = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--profile') {
      profile = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
    } else {
      clipNames.push(arg);
    }
  }
  if (!profile || !VALID_PROFILES.has(profile)) {
    console.error('Specifica il profilo vocale di destinazione: --profile kenguro | arale');
    process.exit(1);
  }
  return { profile, only: new Set(clipNames) };
}

const { profile: TARGET_PROFILE, only: CLI_ONLY } = parseCliArgs(process.argv.slice(2));
const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC_DIR = join(ROOT, 'audio-src', 'voice');
const OUT_DIR = join(ROOT, 'public', 'audio', TARGET_PROFILE);
const SOURCE_EXTS = new Set(['.wav', '.aif', '.aiff', '.flac', '.m4a', '.mp3']);

/** Livello medio (RMS) a cui portare ogni parola: tutte le clip suonano uguali. */
const TARGET_MEAN_DB = -15;
/** Tetto massimo dopo il limiter (0.89 lineare ≈ -1 dBFS): niente clipping. */
const LIMITER_CEILING = 0.89;
const TAIL_PAD_SEC = 0.08;
const FADE_OUT_SEC = 0.015;

const CLEAN_CHAIN = [
  // Taglio silenzio iniziale e finale (doppio reverse per la coda)
  'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.005',
  'areverse',
  'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02',
  'areverse',
  'highpass=f=90:poles=2',
  'equalizer=f=250:t=q:w=1.0:g=-2.5',
  'equalizer=f=3000:t=q:w=1.2:g=3',
  'acompressor=threshold=-20dB:ratio=3:attack=4:release=90:makeup=1',
  'afade=t=in:d=0.006',
].join(',');

function run(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** volumedetect scrive le statistiche su stderr: serve spawnSync per leggerle. */
function volumeStats(file) {
  const res = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) {
    throw new Error(`ffmpeg ha fallito su ${file}: ${res.stderr}`);
  }
  const mean = Number(/mean_volume:\s*(-?[\d.]+)/.exec(res.stderr)?.[1]);
  const max = Number(/max_volume:\s*(-?[\d.]+)/.exec(res.stderr)?.[1]);
  if (!Number.isFinite(mean) || !Number.isFinite(max)) {
    throw new Error(`Impossibile misurare il volume di ${file}`);
  }
  return { mean, max };
}

function durationSec(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  const d = Number(out.trim());
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`Durata non valida per ${file}`);
  }
  return d;
}

function masterClip(srcFile, workDir) {
  const name = basename(srcFile, extname(srcFile));
  const cleaned = join(workDir, `${name}.clean.wav`);
  const outFile = join(OUT_DIR, `${name}.mp3`);

  run(['-i', srcFile, '-af', CLEAN_CHAIN, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', cleaned]);

  const before = volumeStats(cleaned);
  const gainDb = TARGET_MEAN_DB - before.mean;
  const voicedDur = durationSec(cleaned);
  const totalDur = voicedDur + TAIL_PAD_SEC;

  const finalChain = [
    `volume=${gainDb.toFixed(2)}dB`,
    `alimiter=limit=${LIMITER_CEILING}:attack=1:release=40:level=disabled`,
    `afade=t=out:st=${(voicedDur - FADE_OUT_SEC).toFixed(3)}:d=${FADE_OUT_SEC}`,
    `apad=pad_dur=${TAIL_PAD_SEC}`,
  ].join(',');

  run([
    '-i', cleaned,
    '-af', finalChain,
    '-ac', '1', '-ar', '48000',
    '-c:a', 'libmp3lame', '-q:a', '2',
    '-map_metadata', '-1',
    outFile,
  ]);

  const after = volumeStats(outFile);
  return { name, voicedDur, totalDur, gainDb, mean: after.mean, peak: after.max };
}

function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`Cartella sorgenti mancante: ${SRC_DIR}`);
    process.exit(1);
  }
  const sources = readdirSync(SRC_DIR)
    .filter((f) => SOURCE_EXTS.has(extname(f).toLowerCase()))
    .filter((f) => CLI_ONLY.size === 0 || CLI_ONLY.has(basename(f, extname(f))))
    .sort();

  if (sources.length === 0) {
    console.error('Nessuna clip sorgente trovata.');
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'dojo-voice-'));

  try {
    console.log('clip            parlato  gain     media    picco');
    for (const file of sources) {
      const r = masterClip(join(SRC_DIR, file), workDir);
      console.log(
        `${r.name.padEnd(14)}  ${r.voicedDur.toFixed(2)}s   ${r.gainDb >= 0 ? '+' : ''}${r.gainDb.toFixed(1)}dB  ${r.mean.toFixed(1)}dB  ${r.peak.toFixed(1)}dB`,
      );
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();
