import { gpuLabel, type EnvInfo } from './env';
import { MODELS, deviceLabel } from './models';
import type { BenchResult } from './protocol';

export type Verdict = 'smooth' | 'usable' | 'slow';

/**
 * How the model would feel in imago. Encoding happens once per image and can run in the
 * background while the user works on the previous image; each click must feel instant.
 */
export function verdict(r: BenchResult): Verdict {
  const encode = r.encodeMedianMs ?? r.encodeFirstMs;
  const click = r.decodeMedianMs ?? r.decodeFirstMs;
  if (encode <= 2000 && click <= 200) return 'smooth';
  if (encode <= 6000 && click <= 500) return 'usable';
  return 'slow';
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  smooth: 'Smooth',
  usable: 'Usable with pre-encoding',
  slow: 'Too slow',
};

export const ms = (v: number | null) => (v == null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

export interface ImageSummary {
  name: string;
  width: number;
  height: number;
  bytes: number;
}

export interface Report {
  label: string;
  date: string;
  env: EnvInfo;
  image: ImageSummary;
  settings: { threads: number | 'auto'; encodeRuns: number; decodeRuns: number };
  results: BenchResult[];
}

export function toJson(report: Report) {
  const results = report.results.map((r) => {
    const m = MODELS.find((x) => x.key === r.key)!;
    return { model: m.family, device: deviceLabel(m), precision: m.dtype, repo: m.repo, verdict: verdict(r), ...r };
  });
  return JSON.stringify({ app: 'imago-benchmark', schema: 1, ...report, results }, null, 2);
}

export function toMarkdown(report: Report) {
  const { env, image } = report;
  const lines = [
    `### imago segmentation benchmark${report.label ? ` — ${report.label}` : ''}`,
    '',
    `- **Date:** ${new Date(report.date).toLocaleString()}`,
    `- **Browser:** ${env.browser} on ${env.platform}`,
    `- **CPU threads:** ${env.cpuThreads} (inference threads: ${report.settings.threads === 'auto' ? `auto = ${env.autoThreads}` : report.settings.threads})`,
    `- **Memory:** ${env.deviceMemoryGB == null ? 'unknown' : `${env.deviceMemoryGB >= 8 ? '8+' : env.deviceMemoryGB} GB`}`,
    `- **GPU:** ${gpuLabel(env.gpu)}${env.gpu.available ? ` (fp16: ${env.gpu.f16 ? 'yes' : 'no'})` : ''}`,
    `- **Image:** ${image.width}×${image.height} (${(image.width * image.height / 1e6).toFixed(1)} MP, ${(image.bytes / 1048576).toFixed(1)} MB)`,
    '',
    '| Model | Device | Precision | Load | Encode (first) | Encode (typical) | Click | Full-res mask | Verdict |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of report.results) {
    const m = MODELS.find((x) => x.key === r.key)!;
    lines.push(
      `| ${m.family} | ${deviceLabel(m)} | ${m.dtype} | ${ms(r.loadMs)}${r.cachedBeforeRun ? ' (cached)' : ''} | ${ms(r.encodeFirstMs)} | ${ms(r.encodeMedianMs)} | ${ms(r.decodeMedianMs ?? r.decodeFirstMs)} | ${ms(r.fullResMaskMs)} | ${VERDICT_TEXT[verdict(r)]} |`,
    );
  }
  return lines.join('\n');
}
