import { useEffect } from 'react';
import { ImageList } from './components/ImageList';
import { SidePanel } from './components/SidePanel';
import { StartScreen } from './components/StartScreen';
import { Toolbar } from './components/Toolbar';
import { Viewer } from './components/Viewer';
import { isTyping } from './keyboard';
import { hasUnsavedChanges, useStore } from './store';

function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const s = useStore.getState();
      if (!s.folder) return;
      if (isTyping(event)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'z') s[event.shiftKey ? 'redo' : 'undo']();
      else if (mod && key === 'y') s.redo();
      else if (mod) return;
      else if (key === 's') s.setTool('segment');
      else if (key === 'v') s.setTool('select');
      else if (key === 'b') s.setTool('box');
      else if (key === 'p') s.setTool('polygon');
      else if (/^[1-9]$/.test(key)) {
        const cls = s.project.classes[Number(key) - 1];
        if (!cls) return;
        s.setActiveClass(cls.id);
        if (s.selectedId) s.setAnnotationClass(s.selectedId, cls.id);
      } else if ((key === 'delete' || key === 'backspace') && s.selectedId) s.deleteAnnotation(s.selectedId);
      else if (key === 'arrowright') void s.goRelative(1);
      else if (key === 'arrowleft') void s.goRelative(-1);
      else if (key === 'enter' && s.doc) {
        s.setStatus('done');
        void s.goRelative(1);
      } else if (key === 'escape') s.select(null);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

function useSaveOnExit() {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      void useStore.getState().flushSaves();
      event.preventDefault();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') void useStore.getState().flushSaves();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);
}

export function App() {
  const hasFolder = useStore((s) => s.folder !== null);
  useShortcuts();
  useSaveOnExit();

  if (!hasFolder) return <StartScreen />;
  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <ImageList />
        <Viewer />
        <SidePanel />
      </div>
    </div>
  );
}
