import { useState } from 'react';
import { useStore } from '../store';
import type { ClassDef } from '../project/types';

function ClassRow({ cls, index, count }: { cls: ClassDef; index: number; count: number }) {
  const activeClassId = useStore((s) => s.activeClassId);
  const selectedId = useStore((s) => s.selectedId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cls.name);
  const { setActiveClass, setAnnotationClass, updateClass, deleteClass } = useStore.getState();

  function choose() {
    setActiveClass(cls.id);
    if (selectedId) setAnnotationClass(selectedId, cls.id);
  }

  function commitName() {
    setEditing(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== cls.name) updateClass(cls.id, { name: trimmed });
    else setName(cls.name);
  }

  function remove() {
    if (window.confirm(`Delete the class “${cls.name}”? Annotations using it, in every image, become unlabelled.`)) deleteClass(cls.id);
  }

  return (
    <li className={`class-row${cls.id === activeClassId ? ' active' : ''}`}>
      <kbd className={index < 9 ? undefined : 'invisible'} title={index < 9 ? `Press ${index + 1} to use this class` : undefined}>
        {index < 9 ? index + 1 : ''}
      </kbd>
      <input
        type="color"
        className="swatch"
        value={cls.color}
        onChange={(e) => updateClass(cls.id, { color: e.target.value })}
        aria-label={`Colour for ${cls.name}`}
      />
      {editing ? (
        <input
          className="class-name-input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
            if (e.key === 'Escape') {
              setName(cls.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button className="class-name" onClick={choose} onDoubleClick={() => setEditing(true)} title="Click to use · double-click to rename">
          {cls.name}
        </button>
      )}
      {count > 0 && (
        <span className="count" title={`${count} on this image`}>
          {count}
        </span>
      )}
      <button className="icon" onClick={remove} title="Delete class" aria-label={`Delete class ${cls.name}`}>
        ×
      </button>
    </li>
  );
}

export function SidePanel() {
  const classes = useStore((s) => s.project.classes);
  const doc = useStore((s) => s.doc);
  const selectedId = useStore((s) => s.selectedId);
  const [newName, setNewName] = useState('');
  const { addClass, select, setTool, setAnnotationClass, deleteAnnotation } = useStore.getState();

  const counts = new Map<string, number>();
  for (const a of doc?.annotations ?? []) if (a.classId) counts.set(a.classId, (counts.get(a.classId) ?? 0) + 1);
  const classById = new Map(classes.map((c) => [c.id, c]));

  function submitClass(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (classes.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
    addClass(name);
    setNewName('');
  }

  return (
    <aside className="panel side-panel">
      <section>
        <h2>Classes</h2>
        {classes.length === 0 && <p className="muted small">Add the classes you want to label, e.g. “specimen”, “label”, “scale bar”.</p>}
        <ul className="class-list">
          {classes.map((cls, i) => (
            <ClassRow key={cls.id} cls={cls} index={i} count={counts.get(cls.id) ?? 0} />
          ))}
        </ul>
        <form className="add-class" onSubmit={submitClass}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New class name" aria-label="New class name" />
          <button type="submit" disabled={!newName.trim()}>
            Add
          </button>
        </form>
      </section>

      <section className="annotations">
        <h2>
          This image <span className="muted">({doc?.annotations.length ?? 0})</span>
        </h2>
        {doc && doc.annotations.length === 0 && <p className="muted small">No annotations yet. Draw a box (B) or polygon (P).</p>}
        <ul className="annotation-list">
          {doc?.annotations.map((a, i) => {
            const cls = a.classId ? classById.get(a.classId) : undefined;
            return (
              <li key={a.id} className={a.id === selectedId ? 'selected' : undefined}>
                <button
                  className="annotation-pick"
                  onClick={() => {
                    setTool('select');
                    select(a.id);
                  }}
                >
                  <span className="dot" style={{ background: cls?.color ?? '#9ca3af' }} />
                  <span>{a.shape.type === 'box' ? 'Box' : 'Polygon'} {i + 1}</span>
                </button>
                <select
                  value={a.classId ?? ''}
                  onChange={(e) => setAnnotationClass(a.id, e.target.value || null)}
                  aria-label={`Class for annotation ${i + 1}`}
                  className={cls ? undefined : 'unlabelled'}
                >
                  <option value="">Unlabelled</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button className="icon" onClick={() => deleteAnnotation(a.id)} title="Delete" aria-label={`Delete annotation ${i + 1}`}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
