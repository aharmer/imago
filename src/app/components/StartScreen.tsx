import { useEffect, useState } from 'react';
import { forgetFolder, isBrave, listRecentFolders, requestPermission, supportsFolderAccess, type RecentFolder } from '../project/folder';
import { useStore } from '../store';

function ago(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 90) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hours ago`;
  return new Date(iso).toLocaleDateString();
}

export function StartScreen() {
  const openFolder = useStore((s) => s.openFolder);
  const [supported] = useState(supportsFolderAccess);
  const [brave, setBrave] = useState(false);
  const [recent, setRecent] = useState<RecentFolder[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    isBrave().then(setBrave);
    if (supported) listRecentFolders().then(setRecent);
  }, [supported]);

  async function open(handle: FileSystemDirectoryHandle) {
    setBusy(true);
    setMessage(null);
    try {
      let result = await openFolder(handle);
      if (!result.ok && result.reason === 'locked') {
        const proceed = window.confirm(
          `“${handle.name}” looks like it's open in another window or on another computer (last active ${ago(result.lock.heartbeat)}).\n\n` +
            'Annotating the same folder in two places at once can lose work. Open it anyway?',
        );
        result = proceed ? await openFolder(handle, { force: true }) : { ok: true };
      }
      if (!result.ok && result.reason === 'empty') {
        setMessage(`No images found in “${handle.name}”. imago looks for JPEG, PNG, WebP, BMP and GIF files directly inside the folder you choose.`);
      }
    } catch (err) {
      setMessage(`Couldn't open “${handle.name}”: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function pickFolder() {
    try {
      const handle = await window.showDirectoryPicker({ id: 'imago', mode: 'readwrite' });
      await open(handle);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function openRecent(folder: RecentFolder) {
    try {
      // Browsers forget folder permission between visits; this asks again (one click).
      if (!(await requestPermission(folder.handle))) {
        setMessage(`Permission to edit “${folder.name}” wasn't granted.`);
        return;
      }
      await open(folder.handle);
    } catch {
      setMessage(`“${folder.name}” is no longer available. It may have been moved, renamed or deleted.`);
    }
  }

  async function forget(folder: RecentFolder) {
    await forgetFolder(folder);
    setRecent(await listRecentFolders());
  }

  return (
    <main className="start">
      <div className="start-inner">
        <h1 className="brand">imago</h1>
        <p className="tagline">Free image annotation with one-click segmentation, for training deep learning models. Your images never leave this computer.</p>

        {supported ? (
          <>
            <button className="primary big" onClick={pickFolder} disabled={busy}>
              Open image folder…
            </button>
            <p className="muted small">imago saves your annotations in a hidden <code>.imago</code> folder inside the image folder, so you can stop and pick up where you left off.</p>

            {recent.length > 0 && (
              <section className="recent">
                <h2>Recent folders</h2>
                <ul>
                  {recent.map((folder) => (
                    <li key={folder.openedAt}>
                      <button className="recent-open" onClick={() => openRecent(folder)} disabled={busy}>
                        <span className="recent-name">{folder.name}</span>
                        <span className="muted small">{ago(folder.openedAt)}</span>
                      </button>
                      <button className="icon" title="Remove from list" aria-label={`Remove ${folder.name} from recent folders`} onClick={() => forget(folder)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : brave ? (
          <section className="notice-box">
            <h2>One-time setup for Brave</h2>
            <p>imago needs to read and save files in your image folder. Brave switches that feature off by default. To turn it on:</p>
            <ol>
              <li>
                Copy this address into a new tab: <code className="copyable">brave://flags/#file-system-access-api</code>
              </li>
              <li>
                Set <strong>File System Access API</strong> to <strong>Enabled</strong>.
              </li>
              <li>Click <strong>Relaunch</strong>, then come back to this page.</li>
            </ol>
            <p className="muted small">This only lets sites use folders you explicitly choose; imago can't see anything else.</p>
          </section>
        ) : (
          <section className="notice-box">
            <h2>Please use Chrome or Microsoft Edge</h2>
            <p>imago saves annotations directly into your image folder, which this browser doesn't support yet.</p>
          </section>
        )}

        {message && <p className="error">{message}</p>}

        <footer className="start-footer muted small">
          <a href="./bench/">Segmentation benchmark</a> · <a href="https://github.com/aharmer/imago">Source on GitHub</a>
        </footer>
      </div>
    </main>
  );
}
