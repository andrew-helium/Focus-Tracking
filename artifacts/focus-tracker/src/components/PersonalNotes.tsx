import { useEffect, useRef, useState } from 'react';
import { Bold, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, Pencil, Underline } from 'lucide-react';

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'p', 'div', 'br', 'blockquote', 'h2', 'h3']);

function wrapForStyle(style: string): string {
  if (/font-weight:\s*(bold|[7-9]00)/i.test(style)) return 'b';
  if (/font-style:\s*italic/i.test(style)) return 'i';
  if (/text-decoration:[^;]*underline/i.test(style)) return 'u';
  return '';
}

export function sanitizeNotes(html: string): string {
  if (!html.trim()) return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const holder = document.createElement('div');
  const appendClean = (parent: Node, node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ''));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return;
    const styled = tag === 'span' ? wrapForStyle(el.getAttribute('style') ?? '') : '';
    const keep = ALLOWED.has(tag) ? tag : styled;
    if (!keep) {
      for (const child of [...el.childNodes]) appendClean(parent, child);
      return;
    }
    const next = document.createElement(keep);
    if (keep === 'ol') {
      const start = el.getAttribute('start');
      if (start && /^\d+$/.test(start)) next.setAttribute('start', String(Number(start)));
      const type = el.getAttribute('type');
      if (type === '1' || type === 'a' || type === 'A' || type === 'i' || type === 'I') next.setAttribute('type', type);
    }
    for (const child of [...el.childNodes]) appendClean(next, child);
    parent.appendChild(next);
  };
  for (const child of [...parsed.body.childNodes]) appendClean(holder, child);
  if (!holder.textContent?.replace(/\u00a0/g, '').trim()) return '';
  return holder.innerHTML;
}

const LIST_PREFIX = /^(?:(\d+)[.)]|[-*+•])[ \u00a0]$/;

type ListUndo = { prefix: string; li: HTMLLIElement };

function selectionIn(editor: HTMLElement): Selection | null {
  const selection = document.getSelection();
  if (!selection?.rangeCount) return null;
  const node = selection.anchorNode;
  if (!node || (node !== editor && !editor.contains(node))) return null;
  return selection;
}

function closestLi(node: Node, editor: HTMLElement): HTMLLIElement | null {
  const el = node instanceof Element ? node : node.parentElement;
  const li = el?.closest('li');
  return li instanceof HTMLLIElement && editor.contains(li) ? li : null;
}

function lineElement(editor: HTMLElement): HTMLElement | null {
  const selection = selectionIn(editor);
  if (!selection?.isCollapsed || !selection.anchorNode) return null;
  if (closestLi(selection.anchorNode, editor)) return null;
  const anchor = selection.anchorNode;
  const el = anchor instanceof Element ? anchor : anchor.parentElement;
  const block = el?.closest('p,div,h2,h3,blockquote');
  if (block instanceof HTMLElement && block !== editor && editor.contains(block)) {
    let line = block;
    while (line.parentElement && line.parentElement !== editor && !['UL', 'OL', 'LI'].includes(line.parentElement.tagName)) line = line.parentElement;
    if (line.parentElement === editor) return line;
  }
  if (anchor === editor || anchor.parentNode === editor) return editor;
  return null;
}

function textBeforeCaret(line: HTMLElement): { text: string; range: Range } | null {
  const selection = document.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed || !selection.anchorNode) return null;
  if (line !== selection.anchorNode && !line.contains(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(line);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return { text: range.toString(), range };
}

function placeCaret(node: Node, atEnd: boolean) {
  const selection = document.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(!atEnd);
  selection.removeAllRanges();
  selection.addRange(range);
}

function emptyListItem(li: HTMLElement): boolean {
  return !(li.textContent ?? '').replace(/\u00a0/g, '').trim();
}

function fillItem(li: HTMLElement) {
  if (!emptyListItem(li)) return;
  li.replaceChildren(document.createElement('br'));
}

function wrapLine(line: HTMLElement, editor: HTMLElement, ordered: boolean, start?: number): HTMLLIElement {
  const list = document.createElement(ordered ? 'ol' : 'ul');
  if (ordered && start && start > 1) list.setAttribute('start', String(start));
  const li = document.createElement('li');
  const kids = [...line.childNodes];
  for (const kid of kids) li.appendChild(kid);
  fillItem(li);
  list.appendChild(li);
  if (line === editor) editor.appendChild(list);
  else line.replaceWith(list);
  placeCaret(li, false);
  return li;
}

function tryAutoList(editor: HTMLElement): ListUndo | null {
  const line = lineElement(editor);
  if (!line) return null;
  const before = textBeforeCaret(line);
  if (!before || !LIST_PREFIX.test(before.text)) return null;
  const prefix = before.text;
  const ordered = /^\d/.test(prefix);
  const start = Number(/^(\d+)/.exec(prefix)?.[1] ?? '1');
  before.range.deleteContents();
  const li = wrapLine(line, editor, ordered, start);
  return { prefix, li };
}

function restorePrefix(undo: ListUndo) {
  const { li, prefix } = undo;
  const list = li.parentElement;
  if (!list) return;
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(prefix));
  for (const child of [...li.childNodes]) {
    if (child.nodeName === 'BR' && emptyListItem(li)) continue;
    div.appendChild(child);
  }
  if (list.childElementCount === 1) list.replaceWith(div);
  else li.replaceWith(div);
  const text = div.firstChild;
  const selection = document.getSelection();
  if (!selection || !text) return;
  const range = document.createRange();
  range.setStart(text, prefix.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function hasVisibleNotes(editor: HTMLElement): boolean {
  if (editor.querySelector('ul, ol')) return true;
  return Boolean(sanitizeNotes(editor.innerHTML));
}

function applyList(editor: HTMLElement, ordered: boolean) {
  editor.focus();
  const before = document.getSelection()?.anchorNode;
  const existing = before ? closestLi(before, editor) : null;
  const turningOff = existing?.parentElement?.tagName === (ordered ? 'OL' : 'UL');
  document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList');
  const node = document.getSelection()?.anchorNode;
  if (node && closestLi(node, editor)) return;
  if (turningOff) return;
  const line = lineElement(editor) ?? editor;
  wrapLine(line, editor, ordered);
}

const TOOLS: { command: string; label: string; icon: typeof Bold; testId: string }[] = [
  { command: 'bold', label: 'Bold', icon: Bold, testId: 'button-notes-bold' },
  { command: 'italic', label: 'Italic', icon: Italic, testId: 'button-notes-italic' },
  { command: 'underline', label: 'Underline', icon: Underline, testId: 'button-notes-underline' },
  { command: 'insertUnorderedList', label: 'Bulleted list', icon: List, testId: 'button-notes-bullets' },
  { command: 'insertOrderedList', label: 'Numbered list', icon: ListOrdered, testId: 'button-notes-numbers' },
  { command: 'outdent', label: 'Decrease indent', icon: IndentDecrease, testId: 'button-notes-outdent' },
  { command: 'indent', label: 'Increase indent', icon: IndentIncrease, testId: 'button-notes-indent' },
];

export function PersonalNotes({ html, onSave }: { html: string; onSave: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<ListUndo | null>(null);
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const htmlRef = useRef(html);
  htmlRef.current = html;

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const next = html || '';
    if (editor.innerHTML !== next) editor.innerHTML = next;
    editor.dataset.empty = hasVisibleNotes(editor) ? 'false' : 'true';
  }, [html]);

  useEffect(() => {
    const sync = () => {
      const editor = editorRef.current;
      if (!editor || !editor.contains(document.activeElement)) return;
      const marks: Record<string, boolean> = {};
      for (const tool of TOOLS) {
        try { marks[tool.command] = document.queryCommandState(tool.command); } catch { marks[tool.command] = false; }
      }
      setActive(marks);
    };
    document.addEventListener('selectionchange', sync);
    return () => document.removeEventListener('selectionchange', sync);
  }, []);

  const currentHtml = () => sanitizeNotes(editorRef.current?.innerHTML ?? '');

  const markDirty = () => {
    const editor = editorRef.current;
    if (editor) editor.dataset.empty = hasVisibleNotes(editor) ? 'false' : 'true';
  };

  const save = () => {
    const next = currentHtml();
    const editor = editorRef.current;
    if (editor) {
      editor.innerHTML = next;
      editor.dataset.empty = hasVisibleNotes(editor) ? 'false' : 'true';
    }
    if (next !== htmlRef.current) onSave(next);
  };

  const finish = () => {
    save();
    setEditing(false);
  };

  useEffect(() => {
    if (!editing) return;
    editorRef.current?.focus();
  }, [editing]);

  const format = (command: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    undoRef.current = null;
    if (command === 'insertUnorderedList' || command === 'insertOrderedList') applyList(editor, command === 'insertOrderedList');
    else {
      editor.focus();
      document.execCommand(command);
    }
    markDirty();
  };

  const onInput = (event: React.FormEvent<HTMLDivElement>) => {
    markDirty();
    const native = event.nativeEvent as InputEvent;
    if (native.inputType !== 'insertText' || (native.data !== ' ' && native.data !== '\u00a0')) return;
    const editor = editorRef.current;
    if (!editor) return;
    undoRef.current = tryAutoList(editor);
    if (undoRef.current) markDirty();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key !== 'Backspace') {
      if (event.key.length === 1 || event.key === 'Enter') undoRef.current = null;
      return;
    }
    const undo = undoRef.current;
    if (!undo?.li.isConnected || !emptyListItem(undo.li)) {
      undoRef.current = null;
      return;
    }
    event.preventDefault();
    restorePrefix(undo);
    undoRef.current = null;
    markDirty();
  };

  return (
    <section className="panel section-card personal-notes" aria-label="Personal notes" data-testid="personal-notes">
      <div className="section-heading">
        <h2>Personal notes</h2>
        {editing
          ? <button type="button" className="btn btn-small" onClick={finish} data-testid="button-save-notes">Save notes</button>
          : <button type="button" className="btn btn-quiet btn-small" aria-label="Edit notes" onClick={() => setEditing(true)} data-testid="button-edit-notes"><Pencil size={14} /></button>}
      </div>
      {editing && (
        <div className="personal-notes-toolbar" role="toolbar" aria-label="Note formatting">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.command}
                type="button"
                className={`btn btn-quiet btn-small${active[tool.command] ? ' is-on' : ''}`}
                aria-label={tool.label}
                aria-pressed={Boolean(active[tool.command])}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format(tool.command)}
                data-testid={tool.testId}
              >
                <Icon size={14} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
      <div
        ref={editorRef}
        className={`personal-notes-body${editing ? ' is-editing' : ''}`}
        contentEditable={editing}
        role={editing ? 'textbox' : undefined}
        aria-multiline={editing ? true : undefined}
        aria-label="Personal notes"
        data-empty={html ? 'false' : 'true'}
        data-testid="input-personal-notes"
        onInput={onInput}
        onKeyDown={onKeyDown}
        onBlur={save}
        suppressContentEditableWarning
      />
    </section>
  );
}
