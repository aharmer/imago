import { SCHEMA_VERSION, type ImageDoc, type ProjectFile } from './types';

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|bmp|gif)$/i;
const META_DIR = '.imago';
const ANNOTATIONS_DIR = 'annotations';
/** A lock whose heartbeat is older than this is treated as abandoned (browser closed, crash). */
export const LOCK_STALE_MS = 2 * 60 * 1000;

export interface ImageEntry {
  name: string;
  handle: FileSystemFileHandle;
}

export interface LockFile {
  sessionId: string;
  openedAt: string;
  heartbeat: string;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const supportsFolderAccess = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function isBrave() {
  const brave = (navigator as Navigator & { brave?: { isBrave(): Promise<boolean> } }).brave;
  try {
    return Boolean(brave && (await brave.isBrave()));
  } catch {
    return false;
  }
}

export async function hasPermission(handle: FileSystemDirectoryHandle) {
  return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
}

/** Must be called from a user gesture (click, key press). */
export async function requestPermission(handle: FileSystemDirectoryHandle) {
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

function isNotFound(err: unknown) {
  return err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError');
}

async function readJson<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  let file: File;
  try {
    file = await (await dir.getFileHandle(name)).getFile();
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  const text = await file.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${name} is not valid JSON. It may have been edited by hand or partially synced.`);
  }
}

async function writeJson(dir: FileSystemDirectoryHandle, name: string, value: unknown) {
  const handle = await dir.getFileHandle(name, { create: true });
  // Chromium writes to a swap file and replaces the original on close, so a crash can't leave half a file.
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(value, null, 1));
  await writable.close();
}

/** Reads and writes imago's files inside one image folder. The `.imago` folder is only created on first save. */
export class FolderStore {
  constructor(readonly root: FileSystemDirectoryHandle) {}

  get name() {
    return this.root.name;
  }

  private async metaDir(create: boolean) {
    try {
      return await this.root.getDirectoryHandle(META_DIR, { create });
    } catch (err) {
      if (!create && isNotFound(err)) return null;
      throw err;
    }
  }

  private async annotationsDir(create: boolean) {
    const meta = await this.metaDir(create);
    if (!meta) return null;
    try {
      return await meta.getDirectoryHandle(ANNOTATIONS_DIR, { create });
    } catch (err) {
      if (!create && isNotFound(err)) return null;
      throw err;
    }
  }

  async listImages(): Promise<ImageEntry[]> {
    const images: ImageEntry[] = [];
    for await (const handle of this.root.values()) {
      if (handle.kind === 'file' && IMAGE_EXTENSIONS.test(handle.name)) images.push({ name: handle.name, handle });
    }
    return images.sort((a, b) => collator.compare(a.name, b.name));
  }

  async readProject() {
    const meta = await this.metaDir(false);
    const project = meta ? await readJson<ProjectFile>(meta, 'project.json') : null;
    if (project && project.schema > SCHEMA_VERSION) {
      throw new Error('This folder was annotated with a newer version of imago. Reload the page to update.');
    }
    return project;
  }

  async writeProject(project: ProjectFile) {
    await writeJson((await this.metaDir(true))!, 'project.json', project);
  }

  async readImageDoc(imageName: string) {
    const dir = await this.annotationsDir(false);
    return dir ? readJson<ImageDoc>(dir, `${imageName}.json`) : null;
  }

  async writeImageDoc(doc: ImageDoc) {
    await writeJson((await this.annotationsDir(true))!, `${doc.image.name}.json`, doc);
  }

  async readLock() {
    const meta = await this.metaDir(false);
    return meta ? readJson<LockFile>(meta, 'lock.json') : null;
  }

  async writeLock(lock: LockFile) {
    await writeJson((await this.metaDir(true))!, 'lock.json', lock);
  }

  async removeLock(sessionId: string) {
    const meta = await this.metaDir(false);
    if (!meta) return;
    const lock = await readJson<LockFile>(meta, 'lock.json').catch(() => null);
    if (lock?.sessionId === sessionId) await meta.removeEntry('lock.json').catch(() => undefined);
  }
}

// Recently opened folders, remembered in IndexedDB (directory handles can be stored there, not in localStorage).

export interface RecentFolder {
  name: string;
  handle: FileSystemDirectoryHandle;
  openedAt: string;
}

const DB_NAME = 'imago';
const STORE = 'recent-folders';

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listRecentFolders(): Promise<RecentFolder[]> {
  try {
    const all = await tx<RecentFolder[]>('readonly', (s) => s.getAll() as IDBRequest<RecentFolder[]>);
    return all.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  } catch {
    return [];
  }
}

export async function rememberFolder(handle: FileSystemDirectoryHandle) {
  try {
    // Replace any existing entry for the same folder.
    for (const recent of await listRecentFolders()) {
      if (await recent.handle.isSameEntry(handle)) await tx('readwrite', (s) => s.delete(recent.openedAt));
    }
    const openedAt = new Date().toISOString();
    await tx('readwrite', (s) => s.put({ name: handle.name, handle, openedAt } satisfies RecentFolder, openedAt));
    const all = await listRecentFolders();
    for (const old of all.slice(8)) await tx('readwrite', (s) => s.delete(old.openedAt));
  } catch {
    // Remembering folders is a convenience only.
  }
}

export async function forgetFolder(recent: RecentFolder) {
  try {
    await tx('readwrite', (s) => s.delete(recent.openedAt));
  } catch {
    // Ignore.
  }
}
