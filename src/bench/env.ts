export interface GpuInfo {
  available: boolean;
  f16: boolean;
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallback?: boolean;
  error?: string;
}

export interface EnvInfo {
  browser: string;
  platform: string;
  userAgent: string;
  cpuThreads: number;
  /** navigator.deviceMemory is capped at 8 GB by browsers, so "8" means "8 or more". */
  deviceMemoryGB: number | null;
  crossOriginIsolated: boolean;
  /** ONNX Runtime's own default when no thread count is set. */
  autoThreads: number;
  gpu: GpuInfo;
}

interface UADataBrand {
  brand: string;
  version: string;
}
interface UAData {
  brands: UADataBrand[];
  platform: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ fullVersionList?: UADataBrand[]; platformVersion?: string }>;
}

async function detectGpu(): Promise<GpuInfo> {
  if (!('gpu' in navigator) || !navigator.gpu) return { available: false, f16: false, error: 'WebGPU not supported by this browser' };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { available: false, f16: false, error: 'No WebGPU adapter (GPU blocked or unsupported)' };
    const info = adapter.info;
    return {
      available: true,
      f16: adapter.features.has('shader-f16'),
      vendor: info?.vendor || undefined,
      architecture: info?.architecture || undefined,
      device: info?.device || undefined,
      description: info?.description || undefined,
      isFallback: (info as { isFallbackAdapter?: boolean } | undefined)?.isFallbackAdapter,
    };
  } catch (err) {
    return { available: false, f16: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function detectBrowser(): Promise<{ browser: string; platform: string }> {
  const uaData = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  if (!uaData) return { browser: navigator.userAgent, platform: navigator.platform };
  let brands = uaData.brands;
  let platform = uaData.platform;
  try {
    const high = await uaData.getHighEntropyValues?.(['fullVersionList', 'platformVersion']);
    if (high?.fullVersionList) brands = high.fullVersionList;
    if (uaData.platform === 'Windows' && high?.platformVersion) {
      // Chromium reports Windows 11 as platformVersion 13 or higher.
      platform = Number(high.platformVersion.split('.')[0]) >= 13 ? 'Windows 11' : 'Windows 10';
    }
  } catch {
    // High-entropy hints are optional.
  }
  // Drop Chromium's placeholder "Not A Brand" entry, and prefer the product (Chrome, Edge) over the engine.
  const real = brands.filter((b) => !/not.?a.?brand/i.test(b.brand));
  const product = real.find((b) => !/chromium/i.test(b.brand)) ?? real[0];
  return { browser: product ? `${product.brand} ${product.version}` : navigator.userAgent, platform };
}

export async function detectEnv(): Promise<EnvInfo> {
  const cpuThreads = navigator.hardwareConcurrency || 1;
  const [{ browser, platform }, gpu] = await Promise.all([detectBrowser(), detectGpu()]);
  return {
    browser,
    platform,
    userAgent: navigator.userAgent,
    cpuThreads,
    deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    crossOriginIsolated: self.crossOriginIsolated,
    autoThreads: self.crossOriginIsolated ? Math.min(4, Math.ceil(cpuThreads / 2)) : 1,
    gpu,
  };
}

export function gpuLabel(gpu: GpuInfo) {
  if (!gpu.available) return gpu.error ?? 'Not available';
  const name = gpu.description || [gpu.vendor, gpu.architecture, gpu.device].filter(Boolean).join(' ') || 'Unknown GPU';
  return gpu.isFallback ? `${name} (software fallback)` : name;
}
