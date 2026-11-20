import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Node 22.18+ e FFmpeg. Analizza gli asset reali in public/audio/ senza toccarli e rigenera le demo.
const root = fileURLToPath(new URL('../', import.meta.url));
const rate = 44100;
const publicAudio = join(root, 'public/audio');
const masters = join(root, 'doc/audio-masters');
const previews = join(root, 'doc/audio-previews');
for (const directory of [masters, previews]) mkdirSync(directory, { recursive: true });

for (const stale of ['gong-finale.wav', 'preavviso.wav', 'ultimi-cinque.wav']) {
  const path = join(previews, stale);
  if (existsSync(path)) rmSync(path);
}

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}

function decodeMono(path) {
  const raw = ffmpeg([
    '-i',
    path,
    '-af',
    'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1',
    '-ar',
    String(rate),
    '-f',
    'f32le',
    'pipe:1',
  ]);
  const samples = new Float32Array(raw.length / 4);
  for (let i = 0; i < samples.length; i += 1) samples[i] = raw.readFloatLE(i * 4);
  return samples;
}

function measure(samples) {
  let peak = 0;
  let sum = 0;
  for (const s of samples) {
    peak = Math.max(peak, Math.abs(s));
    sum += s * s;
  }
  return {
    duration: Number((samples.length / rate).toFixed(3)),
    peak: Number(peak.toFixed(3)),
    rms: Number(Math.sqrt(sum / Math.max(1, samples.length)).toFixed(4)),
  };
}

function writeWav(path, samples) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  writeFileSync(path, data);
}

function mix(events, duration) {
  const output = new Float32Array(Math.ceil(duration * rate));
  for (const [seconds, samples, gain = 1] of events) {
    const offset = Math.round(seconds * rate);
    for (let i = 0; i < samples.length && i + offset < output.length; i += 1) {
      output[offset + i] += samples[i] * gain;
    }
  }
  for (let i = 0; i < output.length; i += 1) output[i] *= 0.9;
  return output;
}

const gong = decodeMono(join(publicAudio, 'gong.mp3'));
const warningBell = decodeMono(join(publicAudio, 'campanella-preavviso.mp3'));
const endBell = decodeMono(join(publicAudio, 'campanella-fine.mp3'));

const voiceKeys = ['hajime', 'matte', 'soremade', ...Array.from({ length: 10 }, (_, i) => `count-${i + 1}`)];
const analysis = {
  generatedAt: new Date().toISOString(),
  shared: {
    'gong.mp3': measure(gong),
    'campanella-preavviso.mp3': measure(warningBell),
    'campanella-fine.mp3': measure(endBell),
  },
  profiles: {},
};

writeWav(join(previews, 'gong-inizio.wav'), mix([[0, gong]], Math.ceil((gong.length / rate + 0.1) * 10) / 10));

function audibleDuration(samples) {
  let end = samples.length - 1;
  while (end > 0 && Math.abs(samples[end]) < 0.01) end -= 1;
  return (end + 1) / rate;
}

for (const profile of ['kenguro', 'arale']) {
  const clips = {};
  analysis.profiles[profile] = {};
  for (const key of voiceKeys) {
    const decoded = decodeMono(join(publicAudio, profile, `${key}.mp3`));
    clips[key] = decoded;
    analysis.profiles[profile][key] = measure(decoded);
  }

  const events = [];
  // 0..9s: solo conteggio vocale 10 -> 1 in preparazione (nessun bip elettronico)
  for (let second = 10; second >= 1; second -= 1) {
    events.push([10 - second, clips[`count-${second}`]]);
  }
  // 10s: Hajime + 400ms -> gong iniziale
  events.push([10, clips.hajime]);
  events.push([10 + audibleDuration(clips.hajime) + 0.4, gong]);
  // 14s: preavviso a campana singola
  events.push([14, warningBell]);
  // 17s: fine round con campanella tripla + Mate dopo 820ms
  events.push([17, endBell]);
  events.push([17.82, clips.matte, 1.35]);
  // 22s: fine sessione con campanella tripla + Soremade dopo 820ms
  events.push([22, endBell]);
  events.push([22.82, clips.soremade, 1.35]);

  const demoName = profile === 'kenguro' ? 'demo-judo' : 'demo-judo-arale';
  const wav = join(previews, `${demoName}.wav`);
  const samples = mix(events, 25);
  writeWav(wav, samples);
  ffmpeg(['-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '192k', join(previews, `${demoName}.mp3`)]);
}

// Demo BJJ: solo effetti (preparazione silenziosa, gong iniziale, preavviso, fine round, fine sessione)
{
  const events = [
    [1, gong],
    [5, warningBell],
    [8, endBell],
    [11, endBell],
  ];
  const wav = join(previews, 'demo-bjj.wav');
  writeWav(wav, mix(events, 13.5));
  ffmpeg(['-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '192k', join(previews, 'demo-bjj.mp3')]);
}

writeFileSync(join(masters, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
console.log('Rigenerate demo audio reali in doc/audio-previews/ e analisi in doc/audio-masters/analysis.json');
