import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  BookmarkPlus,
  Eraser,
  Highlighter,
  MessageSquarePlus,
  Trash2,
} from 'lucide-react';
import { AuthorProfile, PitchCue, Speaker } from '../types/collaboration';
import { countSpokenWords } from '../utils/htmlExporter';

export interface TextSelectionPayload {
  cueId: string;
  sectionId: string;
  sectionTitle: string;
  defaultSlideId: string;
  speaker: Speaker;
  surroundingText: string;
  text: string;
  top: number;
  left: number;
  replaceSelection: (newText: string) => void;
}

interface EditableCueProps {
  cue: PitchCue;
  sectionId: string;
  sectionTitle: string;
  defaultSlideId: string;
  index: number;
  total: number;
  resetVersion: number;
  dimmed: boolean;
  currentUser: { id: string; name: string; color: string };
  typingUsers: AuthorProfile[];
  onChangeHtml: (id: string, newHtml: string) => void;
  onCycleSpeaker: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
  onPresenceChange: (cueId: string | null, isTyping: boolean) => void;
  onSelectionReport: (payload: TextSelectionPayload | null) => void;
  onQuickAddThesis: (text: string) => void;
}

const SPEAKER_STYLES: Record<Speaker, string> = {
  Степан: 'text-[#1F6B43] hover:bg-[#EDF5F0]',
  Фёдор: 'text-[#1D4ED8] hover:bg-[#EFF4FF]',
  Вместе: 'text-[#142018] hover:bg-[#F0F2F0]',
};

function findClosestMark(node: Node | null, root: HTMLElement): HTMLElement | null {
  let curr: Node | null = node;
  while (curr && curr !== root) {
    if (curr instanceof HTMLElement && curr.tagName === 'MARK' && curr.classList.contains('author-mark')) {
      return curr;
    }
    curr = curr.parentNode;
  }
  return null;
}

function createAuthorMark(user: { id: string; name: string }, text: string): HTMLElement {
  const mark = document.createElement('mark');
  mark.className = 'author-mark';
  mark.dataset.authorId = user.id;
  mark.dataset.authorName = user.name;
  mark.appendChild(document.createTextNode(text));
  return mark;
}

function placeCaretAtEnd(node: Node) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (node.nodeType === Node.TEXT_NODE) {
    const len = (node.textContent || '').length;
    range.setStart(node, len);
    range.setEnd(node, len);
  } else {
    range.selectNodeContents(node);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

export const EditableCue: React.FC<EditableCueProps> = ({
  cue,
  sectionId,
  sectionTitle,
  defaultSlideId,
  index,
  total,
  resetVersion,
  dimmed,
  currentUser,
  typingUsers,
  onChangeHtml,
  onCycleSpeaker,
  onMove,
  onDelete,
  onPresenceChange,
  onSelectionReport,
  onQuickAddThesis,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [hasRemotePending, setHasRemotePending] = useState(false);

  // Sync external resets cleanly
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== cue.html) {
      editorRef.current.innerHTML = cue.html;
      setHasRemotePending(false);
    }
  }, [resetVersion, cue.id]);

  // Sync incoming remote HTML when not actively editing this cue
  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML === cue.html) {
      setHasRemotePending(false);
      return;
    }
    if (document.activeElement !== editorRef.current) {
      editorRef.current.innerHTML = cue.html;
      setHasRemotePending(false);
    } else {
      setHasRemotePending(true);
    }
  }, [cue.html]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    };
  }, []);

  const emitHtml = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML.replace(/\u200B/g, '');
    onChangeHtml(cue.id, html);
    onPresenceChange(cue.id, true);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      onPresenceChange(document.activeElement === editorRef.current ? cue.id : null, false);
    }, 1400);
  }, [cue.id, onChangeHtml, onPresenceChange]);

  const insertMarkedTextRef = useRef<(text: string) => void>(() => {});
  const currentUserIdRef = useRef(currentUser.id);
  currentUserIdRef.current = currentUser.id;

  const insertMarkedText = useCallback(
    (text: string) => {
      const root = editorRef.current;
      if (!root) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;

      if (!range.collapsed) {
        range.deleteContents();
      }

      const outerMark = findClosestMark(range.startContainer, root);
      const newMark = createAuthorMark(currentUser, text);

      if (outerMark && outerMark.dataset.authorId !== currentUser.id) {
        // Split the other author's mark cleanly around the cursor
        const afterRange = document.createRange();
        afterRange.setStart(range.startContainer, range.startOffset);
        afterRange.setEndAfter(outerMark.lastChild || outerMark);
        const afterFragment = afterRange.extractContents();

        const parent = outerMark.parentNode;
        if (parent) {
          parent.insertBefore(newMark, outerMark.nextSibling);
          if (afterFragment.textContent && afterFragment.textContent.length > 0) {
            const trailingMark = document.createElement('mark');
            trailingMark.className = 'author-mark';
            trailingMark.dataset.authorId = outerMark.dataset.authorId || '';
            trailingMark.dataset.authorName = outerMark.dataset.authorName || '';
            trailingMark.appendChild(afterFragment);
            parent.insertBefore(trailingMark, newMark.nextSibling);
          }
          if (!outerMark.textContent) {
            parent.removeChild(outerMark);
          }
        }
      } else {
        range.insertNode(newMark);
      }

      if (newMark.firstChild) {
        placeCaretAtEnd(newMark.firstChild);
      }
      emitHtml();
    },
    [currentUser, emitHtml]
  );

  insertMarkedTextRef.current = insertMarkedText;

  // Attach native DOM beforeinput listener (React's onBeforeInput doesn't expose InputEvent.inputType consistently)
  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;

    const handleNativeBeforeInput = (ev: InputEvent) => {
      if (
        (ev.inputType === 'insertText' || ev.inputType === 'insertReplacementText') &&
        typeof ev.data === 'string' &&
        ev.data.length > 0
      ) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return;

        const existingMark = findClosestMark(range.startContainer, root);
        if (range.collapsed && existingMark && existingMark.dataset.authorId === currentUserIdRef.current) {
          // Already inside current user's mark -> native input appends directly inside it
          return;
        }

        ev.preventDefault();
        insertMarkedTextRef.current(ev.data);
      }
    };

    root.addEventListener('beforeinput', handleNativeBeforeInput);
    return () => {
      root.removeEventListener('beforeinput', handleNativeBeforeInput);
    };
  }, []);

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    insertMarkedText(text);
  };

  const applyBold = () => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    document.execCommand('bold');
    emitHtml();
  };

  const highlightSelectionWithMyColor = () => {
    const root = editorRef.current;
    if (!root) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;

    const selectedText = range.toString();
    if (!selectedText.trim()) return;

    const fragment = range.extractContents();
    // Strip nested marks inside fragment before wrapping with current user's mark
    const nestedMarks = fragment.querySelectorAll('mark.author-mark');
    nestedMarks.forEach((m) => {
      const p = m.parentNode;
      if (!p) return;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
    });

    const mark = document.createElement('mark');
    mark.className = 'author-mark';
    mark.dataset.authorId = currentUser.id;
    mark.dataset.authorName = currentUser.name;
    mark.appendChild(fragment);
    range.insertNode(mark);
    sel.removeAllRanges();
    emitHtml();
  };

  const clearColorInSelection = () => {
    const root = editorRef.current;
    if (!root) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;

    if (range.collapsed) {
      const mark = findClosestMark(range.startContainer, root);
      if (mark && mark.parentNode) {
        while (mark.firstChild) mark.parentNode.insertBefore(mark.firstChild, mark);
        mark.parentNode.removeChild(mark);
        emitHtml();
      }
      return;
    }

    const fragment = range.extractContents();
    const nestedMarks = fragment.querySelectorAll('mark.author-mark');
    nestedMarks.forEach((m) => {
      const p = m.parentNode;
      if (!p) return;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
    });
    range.insertNode(fragment);
    sel.removeAllRanges();
    emitHtml();
  };

  const insertStageNote = () => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    const noteHtml = ' <span class="stage-dir">[пауза 1 сек, взгляд в зал]</span>&nbsp;';
    document.execCommand('insertHTML', false, noteHtml);
    emitHtml();
  };

  const reportSelection = () => {
    const root = editorRef.current;
    if (!root) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      onSelectionReport(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;

    const selectedText = sel.toString().replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
    if (selectedText.length < 2) {
      onSelectionReport(null);
      return;
    }

    const savedRange = range.cloneRange();
    const rect = range.getBoundingClientRect();
    const surroundingText = (root.textContent || '').replace(/\u200B/g, '').trim();

    onSelectionReport({
      cueId: cue.id,
      sectionId,
      sectionTitle,
      defaultSlideId,
      speaker: cue.speaker,
      surroundingText,
      text: selectedText,
      top: rect.top,
      left: rect.left + rect.width / 2,
      replaceSelection: (newText: string) => {
        const clean = newText.trim();
        if (!clean || !editorRef.current) return;
        const activeRoot = editorRef.current;
        const mark = createAuthorMark(currentUser, clean);
        if (
          activeRoot.contains(savedRange.startContainer) &&
          activeRoot.contains(savedRange.endContainer)
        ) {
          savedRange.deleteContents();
          savedRange.insertNode(mark);
        } else {
          activeRoot.appendChild(document.createTextNode(' '));
          activeRoot.appendChild(mark);
        }
        emitHtml();
      },
    });
  };

  const sendSelectionOrWholeCueToThesis = () => {
    const root = editorRef.current;
    if (!root) return;
    const sel = window.getSelection();
    let text = '';
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && root.contains(sel.anchorNode)) {
      text = sel.toString().replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
    }
    if (!text) {
      text = (root.textContent || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (text) {
      onQuickAddThesis(text);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'и')) {
      e.preventDefault();
      applyBold();
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    onPresenceChange(cue.id, false);
  };

  const handleBlur = () => {
    setIsFocused(false);
    onPresenceChange(null, false);
    if (editorRef.current && hasRemotePending) {
      editorRef.current.innerHTML = cue.html;
      setHasRemotePending(false);
    }
  };

  const words = countSpokenWords(cue.html);
  const activeTyping = typingUsers.filter((u) => u.id !== currentUser.id && u.activeCueId === cue.id);

  return (
    <div
      className={`group grid grid-cols-1 md:grid-cols-[120px_1fr] gap-3 md:gap-5 py-4 border-t border-[#EBF0EC] transition-opacity duration-200 ${
        dimmed ? 'opacity-35' : 'opacity-100'
      }`}
    >
      <div className="flex md:flex-col items-center md:items-start justify-between gap-1.5">
        <button
          type="button"
          onClick={() => onCycleSpeaker(cue.id)}
          title="Нажмите, чтобы переключить спикера"
          className={`px-2 py-1 -ml-2 rounded-md text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${SPEAKER_STYLES[cue.speaker]}`}
        >
          {cue.speaker}
        </button>
        <span className="font-mono-tabular text-xs text-[#6B7D72]">{words} сл.</span>
      </div>

      <div className="min-w-0">
        {activeTyping.length > 0 && (
          <div className="no-print mb-1.5 flex items-center gap-2 text-xs text-[#47594E]">
            {activeTyping.map((u) => (
              <span key={u.id} className="inline-flex items-center gap-1.5 font-medium">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: u.color }}
                />
                <span>
                  {u.name} {u.isTyping ? 'печатает…' : 'в этом блоке'}
                </span>
              </span>
            ))}
          </div>
        )}

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={emitHtml}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onKeyUp={reportSelection}
          onMouseUp={reportSelection}
          onFocus={handleFocus}
          onBlur={handleBlur}
          aria-label={`Реплика ${cue.speaker} (${sectionTitle})`}
          className={`editable-cue text-[15px] leading-[1.7] text-[#142018] rounded-lg px-2.5 py-1.5 -mx-2.5 -my-1.5 transition-colors ${
            isFocused ? 'bg-[#F5F9F6] ring-1 ring-[#1F6B43]/30' : ''
          }`}
        />

        {hasRemotePending && isFocused && (
          <div className="no-print mt-1.5 text-xs text-[#1D4ED8]">
            Партнёр обновил этот абзац — его версия применится, когда снимете курсор.
          </div>
        )}

        <div className="no-print mt-2.5 flex flex-wrap items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={applyBold}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#47594E] hover:text-[#142018] hover:bg-[#EFF4F0] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Выделить жирным (Ctrl+B)"
          >
            <Bold className="w-3.5 h-3.5" />
            <span>Жирный</span>
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={highlightSelectionWithMyColor}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#47594E] hover:text-[#142018] hover:bg-[#EFF4F0] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Пометить выделенный фрагмент вашим цветом"
          >
            <Highlighter className="w-3.5 h-3.5" />
            <span>Моим цветом</span>
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clearColorInSelection}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#47594E] hover:text-[#142018] hover:bg-[#EFF4F0] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Снять цветное выделение"
          >
            <Eraser className="w-3.5 h-3.5" />
            <span>Снять цвет</span>
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={sendSelectionOrWholeCueToThesis}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#1F6B43] hover:text-[#14452B] hover:bg-[#EDF5F0] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Перенести выделенный текст (или всю реплику) в тезисы слайда"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            <span>В тезисы</span>
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={insertStageNote}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#47594E] hover:text-[#142018] hover:bg-[#EFF4F0] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Вставить актёрскую ремарку в [скобках]"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>+ Ремарка</span>
          </button>

          <span className="mx-1 text-[#D1DBD4]" aria-hidden="true">
            |
          </span>

          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(cue.id, -1)}
            className="p-1 text-[#556B5D] hover:text-[#142018] hover:bg-[#EFF4F0] rounded disabled:opacity-30 cursor-pointer disabled:cursor-default"
            title="Поднять реплику"
            aria-label={`Поднять реплику ${index + 1}`}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onMove(cue.id, 1)}
            className="p-1 text-[#556B5D] hover:text-[#142018] hover:bg-[#EFF4F0] rounded disabled:opacity-30 cursor-pointer disabled:cursor-default"
            title="Опустить реплику"
            aria-label={`Опустить реплику ${index + 1}`}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={total <= 1}
            onClick={() => onDelete(cue.id)}
            className="p-1 text-[#7D4E4E] hover:text-[#B91C1C] hover:bg-[#FEF2F2] rounded disabled:opacity-30 cursor-pointer disabled:cursor-default"
            title="Удалить реплику"
            aria-label={`Удалить реплику ${index + 1}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
