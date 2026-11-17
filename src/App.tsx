import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bold,
  BookmarkPlus,
  Check,
  Cloud,
  Code2,
  Copy,
  Download,
  Eraser,
  FolderArchive,
  HelpCircle,
  Link2,
  Loader2,
  LogIn,
  LogOut,
  Pause,
  Play,
  Plus,
  Printer,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  HIGHLIGHT_COLORS,
  INITIAL_SECTIONS,
  OPENING_VARIANTS,
  QA_CHEATSHEET,
} from './data/initialPitch';
import { PitchSection, Speaker } from './types/collaboration';
import {
  buildPlainTextScript,
  countSpokenWords,
  formatSecondsToClock,
  generateStandaloneHtml,
  stripAuthorMarksFromHtml,
} from './utils/htmlExporter';
import { EditableCue, TextSelectionPayload } from './components/EditableCue';
import { ThesesPage } from './components/ThesesPage';
import { useRealtimeRoom } from './hooks/useRealtimeRoom';
import { PitchRewriteResult, requestPitchRewrite } from './lib/aiRewrite';

const VIDEO_PAUSE_SECONDS = 15;
const TARGET_SECONDS = 240;

function makeOpId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function getRoomIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('room')?.trim();
  if (raw) return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'vholodilnike';
  return 'vholodilnike';
}

function initUserProfile(): { id: string; name: string; color: string } {
  const params = new URLSearchParams(window.location.search);
  const roleHint = params.get('as')?.toLowerCase();
  if (roleHint === 'stepan') {
    return { id: 'author-stepan', name: 'Степан', color: HIGHLIGHT_COLORS[0].bg };
  }
  if (roleHint === 'fedor') {
    return { id: 'author-fedor', name: 'Фёдор', color: HIGHLIGHT_COLORS[1].bg };
  }

  try {
    const tabSaved = sessionStorage.getItem('vh_tab_profile_v1');
    if (tabSaved) {
      const parsed = JSON.parse(tabSaved);
      if (parsed?.id && parsed?.name && parsed?.color) return parsed;
    }

    const lastPing = Number(localStorage.getItem('vh_active_tab_ping') || '0');
    const anotherTabActive = Date.now() - lastPing < 6000;

    if (!anotherTabActive) {
      const deviceSaved = localStorage.getItem('vh_device_profile_v1');
      if (deviceSaved) {
        const parsed = JSON.parse(deviceSaved);
        if (parsed?.id && parsed?.name && parsed?.color) {
          sessionStorage.setItem('vh_tab_profile_v1', JSON.stringify(parsed));
          return parsed;
        }
      }
    }

    // Either first visit or a 2nd tab opened in the same browser -> assign distinct collaborator identity
    const idx = anotherTabActive ? 0 : 1;
    const defaultProfile = {
      id: `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      name: anotherTabActive ? 'Степан' : 'Фёдор',
      color: HIGHLIGHT_COLORS[idx].bg,
    };
    sessionStorage.setItem('vh_tab_profile_v1', JSON.stringify(defaultProfile));
    if (!anotherTabActive) {
      localStorage.setItem('vh_device_profile_v1', JSON.stringify(defaultProfile));
    }
    return defaultProfile;
  } catch {
    return {
      id: `u-${Date.now().toString(36)}`,
      name: 'Фёдор',
      color: HIGHLIGHT_COLORS[1].bg,
    };
  }
}

function parseRangeToSeconds(range: string): { start: number; end: number } | null {
  const match = range.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return { start, end };
}

export default function App() {
  const [roomId] = useState<string>(getRoomIdFromUrl);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; color: string }>(
    initUserProfile
  );
  const [activePage, setActivePage] = useState<'script' | 'theses'>('script');

  const {
    roomState,
    activeUsers,
    transport,
    firebaseUser,
    shareToken,
    cloudError,
    cloudSaving,
    signInWithGoogle,
    signOutGoogle,
    dispatchMutation,
    sendPresence,
  } = useRealtimeRoom({
    roomId,
    user: currentUser,
  });

  const sections = roomState.sections;
  const slideTheses = roomState.slideTheses;

  const [resetVersion, setResetVersion] = useState(0);
  const [wpm, setWpm] = useState<115 | 130 | 145>(130);
  const [speakerFilter, setSpeakerFilter] = useState<'Все' | 'Степан' | 'Фёдор'>('Все');
  const [openingId, setOpeningId] = useState<'year' | 'month'>('year');

  // Rehearsal stopwatch
  const [elapsedSec, setElapsedSec] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);

  // Selection -> Thesis transfer + Quick AI Rewrite bar
  const [selectionPayload, setSelectionPayload] = useState<TextSelectionPayload | null>(null);
  const [targetSlideId, setTargetSlideId] = useState<string>('slide-1-3');
  const [thesisFeedback, setThesisFeedback] = useState<string | null>(null);
  const [scriptFeedback, setScriptFeedback] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<PitchRewriteResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [copiedAiPhrase, setCopiedAiPhrase] = useState(false);

  // UI feedback states
  const [copiedType, setCopiedType] = useState<'text' | 'html' | 'link' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClearMarks, setConfirmClearMarks] = useState(false);
  const [showHtmlSource, setShowHtmlSource] = useState(false);
  const [showDeployHelp, setShowDeployHelp] = useState(true);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  // Keep active tab heartbeat in localStorage so a 2nd tab gets a separate collaborator ID
  useEffect(() => {
    const ping = () => {
      try {
        localStorage.setItem('vh_active_tab_ping', String(Date.now()));
      } catch {
        // ignore
      }
    };
    ping();
    const timer = window.setInterval(ping, 2500);
    return () => window.clearInterval(timer);
  }, []);

  // Persist profile edits
  useEffect(() => {
    try {
      sessionStorage.setItem('vh_tab_profile_v1', JSON.stringify(currentUser));
      localStorage.setItem('vh_device_profile_v1', JSON.stringify(currentUser));
    } catch {
      // ignore
    }
  }, [currentUser]);

  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  // Ensure URL carries ?room=... so copying the browser address always shares the same room
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.get('room')) {
      url.searchParams.set('room', roomId);
      window.history.replaceState(null, '', url.toString());
    }
  }, [roomId]);

  // Merged dictionary of all authors -> colors for dynamic <style> injection
  const mergedAuthors = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = { ...roomState.authors };
    for (const u of activeUsers) {
      map[u.id] = { name: u.name, color: u.color };
    }
    map[currentUser.id] = { name: currentUser.name, color: currentUser.color };
    return map;
  }, [roomState.authors, activeUsers, currentUser]);

  const dynamicAuthorCss = useMemo(() => {
    return Object.entries(mergedAuthors)
      .map(([id, info]) => {
        const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
        return `.editable-cue mark.author-mark[data-author-id="${safeId}"] { background-color: ${info.color}; }`;
      })
      .join('\n');
  }, [mergedAuthors]);

  const metrics = useMemo(() => {
    let totalWords = 0;
    let stepanWords = 0;
    let fedorWords = 0;

    for (const sec of sections) {
      for (const cue of sec.cues) {
        const words = countSpokenWords(cue.html);
        totalWords += words;
        if (cue.speaker === 'Степан') stepanWords += words;
        else if (cue.speaker === 'Фёдор') fedorWords += words;
        else {
          stepanWords += Math.round(words / 2);
          fedorWords += Math.round(words / 2);
        }
      }
    }

    const speechSeconds = Math.round((totalWords / wpm) * 60);
    const estimatedTotalSeconds = speechSeconds + VIDEO_PAUSE_SECONDS;
    const stepanPct = totalWords > 0 ? Math.round((stepanWords / totalWords) * 100) : 50;
    const fedorPct = totalWords > 0 ? 100 - stepanPct : 50;

    return {
      totalWords,
      estimatedTotalSeconds,
      stepanPct,
      fedorPct,
      overBy: estimatedTotalSeconds - TARGET_SECONDS,
    };
  }, [sections, wpm]);

  const totalThesesCount = useMemo(
    () => slideTheses.reduce((acc, row) => acc + row.items.length, 0),
    [slideTheses]
  );

  const standaloneHtml = useMemo(
    () => generateStandaloneHtml(sections, slideTheses, wpm, mergedAuthors),
    [sections, slideTheses, wpm, mergedAuthors]
  );

  const handleUserNameChange = (name: string) => {
    const next = { ...currentUser, name };
    setCurrentUser(next);
    dispatchMutation({
      type: 'author:color',
      userId: next.id,
      name: next.name || 'Соавтор',
      color: next.color,
      clientOpId: makeOpId(),
    });
  };

  const handleUserColorChange = (color: string) => {
    const next = { ...currentUser, color };
    setCurrentUser(next);
    dispatchMutation({
      type: 'author:color',
      userId: next.id,
      name: next.name,
      color,
      clientOpId: makeOpId(),
    });
  };

  const handleSelectOpeningVariant = (variantId: 'year' | 'month') => {
    const variant = OPENING_VARIANTS.find((v) => v.id === variantId);
    if (!variant || sections.length === 0 || sections[0].cues.length === 0) return;
    setOpeningId(variantId);
    dispatchMutation({
      type: 'cue:update',
      sectionId: sections[0].id,
      cueId: sections[0].cues[0].id,
      html: variant.html,
      author: currentUser,
      clientOpId: makeOpId(),
    });
  };

  const updateCueHtml = useCallback(
    (sectionId: string, cueId: string, newHtml: string) => {
      dispatchMutation({
        type: 'cue:update',
        sectionId,
        cueId,
        html: newHtml,
        author: currentUser,
        clientOpId: makeOpId(),
      });
    },
    [currentUser, dispatchMutation]
  );

  const cycleSpeaker = (sectionId: string, cueId: string) => {
    const order: Speaker[] = ['Степан', 'Фёдор', 'Вместе'];
    const sec = sections.find((s) => s.id === sectionId);
    const cue = sec?.cues.find((c) => c.id === cueId);
    if (!cue) return;
    const next = order[(order.indexOf(cue.speaker) + 1) % order.length];
    dispatchMutation({
      type: 'cue:speaker',
      sectionId,
      cueId,
      speaker: next,
      clientOpId: makeOpId(),
    });
  };

  const moveCue = (sectionId: string, cueId: string, dir: -1 | 1) => {
    dispatchMutation({
      type: 'cue:move',
      sectionId,
      cueId,
      dir,
      clientOpId: makeOpId(),
    });
  };

  const deleteCue = (sectionId: string, cueId: string) => {
    dispatchMutation({
      type: 'cue:delete',
      sectionId,
      cueId,
      clientOpId: makeOpId(),
    });
  };

  const addCue = (sectionId: string) => {
    const sec = sections.find((s) => s.id === sectionId);
    const lastSpeaker = sec?.cues[sec.cues.length - 1]?.speaker;
    const nextSpeaker: Speaker = lastSpeaker === 'Степан' ? 'Фёдор' : 'Степан';
    dispatchMutation({
      type: 'cue:add',
      sectionId,
      cue: {
        id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        speaker: nextSpeaker,
        html: `<mark class="author-mark" data-author-id="${currentUser.id}" data-author-name="${currentUser.name}">Новая реплика — нажмите сюда, чтобы вписать текст.</mark>`,
      },
      clientOpId: makeOpId(),
    });
  };

  const updateSectionField = (
    sectionId: string,
    field: 'title' | 'timeRange' | 'slides' | 'insightNote' | 'defaultSlideId',
    value: string
  ) => {
    dispatchMutation({
      type: 'section:update',
      sectionId,
      field,
      value,
      clientOpId: makeOpId(),
    });
  };

  const addSection = () => {
    const nextNum = String(sections.length + 1).padStart(2, '0');
    const newSec: PitchSection = {
      id: `sec-${Date.now()}`,
      number: nextNum,
      timeRange: '04:00 – 04:15',
      slides: 'Новый слайд',
      defaultSlideId: slideTheses[0]?.id || 'slide-1-3',
      title: 'Новый раздел выступления',
      insightNote: 'Краткая задача блока и переход к следующему слайду.',
      cues: [
        {
          id: `cue-${Date.now()}`,
          speaker: 'Степан',
          html: `<mark class="author-mark" data-author-id="${currentUser.id}" data-author-name="${currentUser.name}">Текст нового блока — нажмите, чтобы редактировать.</mark>`,
        },
      ],
    };
    dispatchMutation({
      type: 'section:add',
      section: newSec,
      clientOpId: makeOpId(),
    });
  };

  const deleteSection = (sectionId: string) => {
    if (sections.length <= 1) return;
    dispatchMutation({
      type: 'section:delete',
      sectionId,
      clientOpId: makeOpId(),
    });
  };

  const handleSelectionReport = useCallback(
    (payload: TextSelectionPayload | null) => {
      setSelectionPayload((prev) => {
        if (!payload) {
          setAiResult(null);
          setAiError(null);
          setAiLoading(false);
          return null;
        }
        if (prev && prev.cueId === payload.cueId && prev.text === payload.text) {
          return payload;
        }
        setAiResult(null);
        setAiError(null);
        return payload;
      });
      if (payload) {
        const exists = slideTheses.some((r) => r.id === payload.defaultSlideId);
        setTargetSlideId(exists ? payload.defaultSlideId : slideTheses[0]?.id || 'slide-1-3');
      }
    },
    [slideTheses]
  );

  const addThesisItem = useCallback(
    (slideId: string, text: string, sourceSectionTitle?: string) => {
      const clean = text.trim();
      if (!clean) return;
      dispatchMutation({
        type: 'thesis:add',
        slideId,
        item: {
          id: `th-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: clean,
          authorId: currentUser.id,
          authorName: currentUser.name,
          authorColor: currentUser.color,
          sourceSectionTitle,
          createdAt: Date.now(),
        },
        clientOpId: makeOpId(),
      });
      const slide = slideTheses.find((r) => r.id === slideId);
      setThesisFeedback(`Добавлено в «${slide?.slideLabel || 'слайд'}»`);
      window.setTimeout(() => setThesisFeedback(null), 3500);
    },
    [currentUser, dispatchMutation, slideTheses]
  );

  const handleInsertPhraseIntoScript = useCallback(
    (slideId: string, phrase: string) => {
      const clean = phrase.trim();
      if (!clean || sections.length === 0) return;
      const targetSec = sections.find((s) => s.defaultSlideId === slideId) || sections[0];
      const lastSpeaker = targetSec.cues[targetSec.cues.length - 1]?.speaker;
      const nextSpeaker: Speaker = lastSpeaker === 'Степан' ? 'Фёдор' : 'Степан';
      const safeName = currentUser.name.replace(/"/g, '&quot;');
      const escapedText = clean
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      dispatchMutation({
        type: 'cue:add',
        sectionId: targetSec.id,
        cue: {
          id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          speaker: nextSpeaker,
          html: `<mark class="author-mark" data-author-id="${currentUser.id}" data-author-name="${safeName}">${escapedText}</mark>`,
        },
        clientOpId: makeOpId(),
      });
      setScriptFeedback(`Фраза добавлена в блок «${targetSec.title}»`);
      window.setTimeout(() => setScriptFeedback(null), 4000);
    },
    [currentUser, dispatchMutation, sections]
  );

  const handleTransferSelectionToThesis = () => {
    if (!selectionPayload) return;
    addThesisItem(targetSlideId, selectionPayload.text, selectionPayload.sectionTitle);
    window.getSelection()?.removeAllRanges();
    setSelectionPayload(null);
    setAiResult(null);
    setAiError(null);
  };

  const handleAiRewriteSelection = async (mode: 'rewrite' | 'sharpen' | 'shorten' = 'rewrite') => {
    if (!selectionPayload) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await requestPitchRewrite({
        text: selectionPayload.text,
        speaker: selectionPayload.speaker,
        sectionTitle: selectionPayload.sectionTitle,
        surroundingText: selectionPayload.surroundingText,
        mode,
      });
      setAiResult(res);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Не удалось обратиться к ИИ.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiPhrase = (newText: string) => {
    if (!selectionPayload) return;
    selectionPayload.replaceSelection(newText);
    window.getSelection()?.removeAllRanges();
    setSelectionPayload(null);
    setAiResult(null);
    setAiError(null);
  };

  const handleBoldFromFloatingBar = () => {
    document.execCommand('bold');
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.classList.contains('editable-cue')) {
      active.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  const handleClearAllMarks = () => {
    if (!confirmClearMarks) {
      setConfirmClearMarks(true);
      window.setTimeout(() => setConfirmClearMarks(false), 4000);
      return;
    }
    const cleaned = sections.map((sec) => ({
      ...sec,
      cues: sec.cues.map((cue) => ({
        ...cue,
        html: stripAuthorMarksFromHtml(cue.html),
      })),
    }));
    dispatchMutation({
      type: 'script:replace',
      sections: cleaned,
      clientOpId: makeOpId(),
    });
    setResetVersion((v) => v + 1);
    setConfirmClearMarks(false);
  };

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      window.setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    dispatchMutation({
      type: 'script:replace',
      sections: structuredClone(INITIAL_SECTIONS),
      clientOpId: makeOpId(),
    });
    setOpeningId('year');
    setResetVersion((v) => v + 1);
    setConfirmReset(false);
  };

  const handleDownloadHtml = () => {
    const blob = new Blob([standaloneHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vholodilnike-pitch-editable.html';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadGithubZip = async () => {
    setZipLoading(true);
    setZipError(null);
    try {
      const res = await fetch('./api/export-github-zip');
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/zip')) {
        throw new Error(
          'Архив репозитория собирается сервером (доступно при запуске в AI Studio или локально).'
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'vholodilnike-github-repo.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : 'Не удалось скачать архив.');
    } finally {
      setZipLoading(false);
    }
  };

  const handleCopy = async (type: 'text' | 'html' | 'link') => {
    let payload = '';
    if (type === 'html') payload = standaloneHtml;
    else if (type === 'text') payload = buildPlainTextScript(sections);
    else {
      const shareUrl = new URL(window.location.href);
      shareUrl.searchParams.set('room', roomId);
      if (shareToken) {
        shareUrl.searchParams.set('key', shareToken);
      }
      payload = shareUrl.toString();
    }
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedType(type);
      window.setTimeout(() => setCopiedType(null), 2200);
    } catch {
      // Fallback ignored if clipboard denied
    }
  };

  const handleCreateFreshRoom = () => {
    const nextId = `vh-${Date.now().toString(36)}`;
    const url = new URL(window.location.href);
    url.searchParams.set('room', nextId);
    url.searchParams.delete('key');
    window.location.assign(url.toString());
  };

  const navigateToSection = (hashId: string) => {
    setActivePage('script');
    window.requestAnimationFrame(() => {
      document.getElementById(hashId)?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  const transportLabel =
    transport === 'firebase'
      ? cloudSaving
        ? 'Онлайн · Firestore (сохраняю…)'
        : 'Онлайн · Облако Firestore'
      : transport === 'websocket'
        ? 'Онлайн · Сервер WS'
        : transport === 'p2p-host'
          ? 'Онлайн · P2P Хост'
          : transport === 'p2p-guest'
            ? 'Онлайн · P2P Гость'
            : transport === 'connecting'
              ? 'Подключение…'
              : 'Локально (откройте ссылку вдвоём)';

  return (
    <div className="min-h-screen bg-[#F8FAF8] text-[#142018]">
      <style>{dynamicAuthorCss}</style>

      {/* Strict 3-zone Top Bar Contract (single row on md+, clean 2-row stack on mobile) */}
      <header className="no-print sticky top-0 z-30 bg-[#F8FAF8]/95 backdrop-blur-sm border-b border-[#DFE6E0]">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-3 md:py-3.5 flex flex-wrap md:flex-nowrap items-center justify-between gap-x-4 gap-y-2.5 md:gap-8">
          <button
            type="button"
            onClick={() => setActivePage('script')}
            className="order-1 text-lg font-bold tracking-tight text-[#142018] whitespace-nowrap shrink-0 cursor-pointer"
          >
            ВХолодильнике
          </button>

          <nav className="order-3 md:order-2 w-full md:w-auto flex items-center gap-5 md:gap-6 text-sm font-medium text-[#556B5D] border-t border-[#EBF0EC] pt-2 md:border-t-0 md:pt-0">
            <button
              type="button"
              onClick={() => setActivePage('script')}
              className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                activePage === 'script'
                  ? 'text-[#142018] font-semibold border-b-2 border-[#1F6B43]'
                  : 'hover:text-[#142018]'
              }`}
            >
              Сценарий
            </button>
            <button
              type="button"
              onClick={() => setActivePage('theses')}
              className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                activePage === 'theses'
                  ? 'text-[#142018] font-semibold border-b-2 border-[#1F6B43]'
                  : 'hover:text-[#142018]'
              }`}
            >
              Тезисы к слайдам{' '}
              <span className="font-mono-tabular">({totalThesesCount})</span>
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('html-code')}
              className="hidden md:inline-block hover:text-[#142018] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Экспорт HTML
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('cheatsheet')}
              className="hidden md:inline-block hover:text-[#142018] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Шпаргалка Q&A
            </button>
          </nav>

          <div className="order-2 md:order-3 flex items-center shrink-0">
            <button
              type="button"
              onClick={() => handleCopy('link')}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-[#1F6B43] hover:bg-[#185435] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedType === 'link' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Link2 className="w-3.5 h-3.5" />
              )}
              <span>{copiedType === 'link' ? 'Ссылка скопирована' : 'Ссылка другу'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="print-container max-w-5xl mx-auto px-6 py-7 md:py-9 space-y-7">
        {/* Collaboration Profile, Color Picker & Firebase Cloud Sync Bar */}
        <section
          aria-label="Настройки соавтора и синхронизации"
          className="no-print bg-white border border-[#DFE6E0] rounded-xl p-4 space-y-3"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="author-name-input" className="text-xs font-medium text-[#556B5D]">
                Ваше имя:
              </label>
              <input
                id="author-name-input"
                type="text"
                value={currentUser.name}
                onChange={(e) => handleUserNameChange(e.target.value)}
                maxLength={24}
                className="w-32 px-2.5 py-1.5 text-sm font-semibold text-[#142018] bg-[#F8FAF8] border border-[#DFE6E0] rounded-lg focus:outline-none focus:border-[#1F6B43]"
              />

              <span className="text-xs font-medium text-[#556B5D] ml-1">Цвет ваших правок:</span>
              <div className="flex items-center gap-1.5" role="group" aria-label="Цвет выделения правок">
                {HIGHLIGHT_COLORS.map((c) => {
                  const selected = currentUser.color === c.bg;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleUserColorChange(c.bg)}
                      title={c.label}
                      aria-label={`Цвет правок: ${c.label}`}
                      aria-pressed={selected}
                      className={`w-6 h-6 rounded-full cursor-pointer transition-transform border ${
                        selected
                          ? 'scale-110 ring-2 ring-[#142018] ring-offset-1 border-black/20'
                          : 'border-black/15 hover:scale-105'
                      }`}
                      style={{ backgroundColor: c.bg }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 text-xs text-[#556B5D]">
              <div className="flex items-center gap-2">
                {transport === 'firebase' ? (
                  <Cloud className="w-3.5 h-3.5 text-[#1F6B43]" />
                ) : (
                  <Users className="w-3.5 h-3.5 text-[#1F6B43]" />
                )}
                <span className="font-medium text-[#142018]">
                  {transportLabel} · В комнате: {Math.max(1, activeUsers.length)}
                </span>
              </div>

              {firebaseUser ? (
                <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-[#F2F5F2] rounded-lg">
                  <span className="text-[#142018] font-medium truncate max-w-[160px]">
                    {firebaseUser.displayName || firebaseUser.email}
                  </span>
                  <button
                    type="button"
                    onClick={signOutGoogle}
                    className="inline-flex items-center gap-1 text-[#556B5D] hover:text-[#142018] cursor-pointer"
                    title="Выйти из Google-аккаунта"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Выйти</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={signInWithGoogle}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1F6B43] bg-[#EDF5F0] hover:bg-[#DFECE3] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Войти через Google (облако 24/7)</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F0F4F1] text-xs text-[#556B5D]">
            <div className="flex flex-wrap items-center gap-3">
              {Object.entries(mergedAuthors).map(([id, info]) => (
                <span key={id} className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block border border-black/15"
                    style={{ backgroundColor: info.color }}
                  />
                  <span className={id === currentUser.id ? 'font-semibold text-[#142018]' : ''}>
                    {info.name}
                    {id === currentUser.id ? ' (вы)' : ''}
                  </span>
                </span>
              ))}
            </div>

            {firebaseUser && shareToken && (
              <span className="text-[11px] text-[#556B5D]">
                Комната сохраняется в Firebase — кнопка «Ссылка другу» уже содержит ключ доступа.
              </span>
            )}
          </div>

          {cloudError && (
            <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#991B1B]">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{cloudError}</span>
              </div>
              <button
                type="button"
                onClick={handleCreateFreshRoom}
                className="px-2.5 py-1 font-semibold bg-white border border-[#FCA5A5] text-[#991B1B] hover:bg-[#FEE2E2] rounded-md cursor-pointer whitespace-nowrap"
              >
                Создать новую комнату
              </button>
            </div>
          )}
        </section>

        {/* Inline Toast for transferred thesis */}
        {thesisFeedback && (
          <div className="no-print fixed bottom-5 right-5 z-40 bg-[#142018] text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 text-xs font-medium">
            <Check className="w-4 h-4 text-[#4ADE80]" />
            <span>{thesisFeedback}</span>
            <button
              type="button"
              onClick={() => {
                setActivePage('theses');
                setThesisFeedback(null);
              }}
              className="underline text-[#BBF7D0] hover:text-white cursor-pointer"
            >
              Открыть тезисы
            </button>
          </div>
        )}

        {/* Inline Toast for phrase inserted from Theses page */}
        {scriptFeedback && (
          <div className="no-print fixed bottom-5 right-5 z-40 bg-[#142018] text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 text-xs font-medium">
            <Check className="w-4 h-4 text-[#4ADE80]" />
            <span>{scriptFeedback}</span>
            <button
              type="button"
              onClick={() => {
                setActivePage('script');
                setScriptFeedback(null);
              }}
              className="underline text-[#BBF7D0] hover:text-white cursor-pointer"
            >
              Открыть сценарий
            </button>
          </div>
        )}

        {/* Contextual Selection Bar: Bold + Transfer to Slide Theses + Quick AI Rewrite */}
        {activePage === 'script' && selectionPayload && (
          <div
            role="region"
            aria-label="Действия с выделенным фрагментом"
            className="no-print sticky top-[62px] z-20 bg-[#142018] text-white rounded-xl px-4 py-3 shadow-md space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="text-xs text-[#A7BDB0] shrink-0">Выделено:</span>
                <span className="text-xs font-medium truncate max-w-[240px] sm:max-w-[340px]">
                  «{selectionPayload.text}»
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleBoldFromFloatingBar}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Bold className="w-3.5 h-3.5" />
                  <span>Жирный</span>
                </button>

                <select
                  value={targetSlideId}
                  onChange={(e) => setTargetSlideId(e.target.value)}
                  aria-label="Целевой слайд для тезиса"
                  className="px-2.5 py-1.5 text-xs bg-white/10 border border-white/20 text-white rounded-lg focus:outline-none max-w-[210px]"
                >
                  {slideTheses.map((row) => (
                    <option key={row.id} value={row.id} className="text-[#142018]">
                      {row.slideLabel} — {row.slideTitle}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleTransferSelectionToThesis}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#1F6B43] hover:bg-[#268453] text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>Перенести в тезисы</span>
                </button>

                <button
                  type="button"
                  disabled={aiLoading}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleAiRewriteSelection('rewrite')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#F5F9F6] hover:bg-white text-[#142018] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  {aiLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-[#1F6B43]" />
                  )}
                  <span>{aiLoading ? 'Пишу фразу…' : 'Переписать для речи (ИИ)'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectionPayload(null);
                    setAiResult(null);
                    setAiError(null);
                  }}
                  aria-label="Закрыть панель выделения"
                  className="p-1 text-[#A7BDB0] hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {aiError && (
              <div className="bg-[#451A1A] border border-[#7F1D1D] text-[#FECACA] rounded-lg px-3 py-2 text-xs">
                {aiError}
              </div>
            )}

            {aiResult && (
              <div className="bg-[#1E2E24] border border-white/15 rounded-lg p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#BBF7D0]">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Готовая фраза для выступления ({selectionPayload.speaker})</span>
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={aiLoading}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleAiRewriteSelection('shorten')}
                      className="px-2 py-0.5 text-[11px] bg-white/10 hover:bg-white/20 rounded cursor-pointer"
                    >
                      Короче
                    </button>
                    <button
                      type="button"
                      disabled={aiLoading}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleAiRewriteSelection('sharpen')}
                      className="px-2 py-0.5 text-[11px] bg-white/10 hover:bg-white/20 rounded cursor-pointer"
                    >
                      Острее
                    </button>
                  </div>
                </div>

                <p className="text-sm text-white leading-relaxed">{aiResult.phrase}</p>

                {aiResult.alternative && (
                  <p className="text-xs text-[#C7D7CC]">
                    Короткий вариант: {aiResult.alternative}
                  </p>
                )}

                {aiResult.deliveryTip && (
                  <p className="text-[11px] text-[#9BB2A3]">Подача: {aiResult.deliveryTip}</p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleApplyAiPhrase(aiResult.phrase)}
                    className="px-3 py-1.5 text-xs font-semibold bg-[#1F6B43] hover:bg-[#268453] text-white rounded-md cursor-pointer"
                  >
                    Заменить в сценарии
                  </button>
                  {aiResult.alternative && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleApplyAiPhrase(aiResult.alternative)}
                      className="px-2.5 py-1.5 text-xs font-medium bg-white/15 hover:bg-white/25 text-white rounded-md cursor-pointer"
                    >
                      Заменить коротким
                    </button>
                  )}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      addThesisItem(targetSlideId, aiResult.phrase, selectionPayload.sectionTitle)
                    }
                    className="px-2.5 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 text-white rounded-md cursor-pointer"
                  >
                    Добавить в тезисы
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(aiResult.phrase);
                        setCopiedAiPhrase(true);
                        window.setTimeout(() => setCopiedAiPhrase(false), 1800);
                      } catch {
                        // ignore
                      }
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium text-[#C7D7CC] hover:text-white cursor-pointer"
                  >
                    {copiedAiPhrase ? 'Скопировано' : 'Копировать'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activePage === 'theses' ? (
          <ThesesPage
            slideTheses={slideTheses}
            authors={mergedAuthors}
            onAddThesis={(slideId, text) => addThesisItem(slideId, text)}
            onUpdateThesis={(slideId, itemId, text) =>
              dispatchMutation({
                type: 'thesis:update',
                slideId,
                itemId,
                text,
                clientOpId: makeOpId(),
              })
            }
            onDeleteThesis={(slideId, itemId) =>
              dispatchMutation({
                type: 'thesis:delete',
                slideId,
                itemId,
                clientOpId: makeOpId(),
              })
            }
            onAddSlideRow={(slideLabel, slideTitle) =>
              dispatchMutation({
                type: 'thesis:rowAdd',
                row: {
                  id: `slide-${Date.now()}`,
                  slideLabel,
                  slideTitle,
                  items: [],
                },
                clientOpId: makeOpId(),
              })
            }
            onInsertPhraseIntoScript={handleInsertPhraseIntoScript}
            onBackToScript={() => setActivePage('script')}
          />
        ) : (
          <>
            {/* Hero / Manuscript Intro */}
            <section className="no-print space-y-6">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div className="max-w-2xl">
                  <p className="text-xs font-medium text-[#556B5D] mb-2">
                    Совместный редактор питча · Дуэт: Фёдор Поляков и Степан Розанов
                  </p>
                  <h1
                    className="text-3xl md:text-4xl font-bold tracking-tight text-[#142018] leading-tight"
                    style={{ textWrap: 'balance' }}
                  >
                    Редактируемый питч на 4 минуты
                  </h1>
                  <p className="mt-3 text-[15px] text-[#47594E] leading-relaxed">
                    Правьте текст прямо здесь — ваши новые слова автоматически подсвечиваются
                    выбранным цветом и сразу видны напарнику. Выделите любой фрагмент, чтобы сделать
                    его <b>жирным</b> или отправить в тезисы к слайдам.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5 shrink-0">
                  <span className="text-xs font-medium text-[#556B5D]">
                    Вариант первой фразы (факт про отходы):
                  </span>
                  <div className="inline-flex items-center gap-1 p-1 bg-[#EBF0EC] rounded-lg">
                    {OPENING_VARIANTS.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => handleSelectOpeningVariant(v.id)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          openingId === v.id
                            ? 'bg-white text-[#142018] shadow-xs'
                            : 'text-[#556B5D] hover:text-[#142018]'
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 4-column Pacing & Telemetry Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 bg-white border border-[#DFE6E0] rounded-xl p-4 md:p-5">
                <div>
                  <div className="text-xs text-[#556B5D]">Произносимых слов</div>
                  <div className="mt-1 text-2xl font-bold font-mono-tabular text-[#142018]">
                    {metrics.totalWords}
                  </div>
                  <div className="mt-0.5 text-xs text-[#6B7D72]">Без ремарок в [скобках]</div>
                </div>

                <div>
                  <div className="text-xs text-[#556B5D]">Расчётное время</div>
                  <div
                    className={`mt-1 text-2xl font-bold font-mono-tabular ${
                      metrics.overBy > 0 ? 'text-[#B45309]' : 'text-[#1F6B43]'
                    }`}
                  >
                    {formatSecondsToClock(metrics.estimatedTotalSeconds)}
                  </div>
                  <div className="mt-0.5 text-xs text-[#6B7D72]">
                    {metrics.overBy > 0
                      ? `Длиннее 04:00 на ${metrics.overBy} сек`
                      : `Запас ${Math.abs(metrics.overBy)} сек (включая видео)`}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-[#556B5D]">Баланс дуэта</div>
                  <div className="mt-1 text-2xl font-bold font-mono-tabular text-[#142018]">
                    {metrics.stepanPct}% / {metrics.fedorPct}%
                  </div>
                  <div className="mt-0.5 text-xs text-[#6B7D72]">Степан · Фёдор</div>
                </div>

                <div>
                  <div className="text-xs text-[#556B5D]">Тезисы к слайдам</div>
                  <div className="mt-1 text-2xl font-bold font-mono-tabular text-[#142018]">
                    {totalThesesCount} шт.
                  </div>
                  <button
                    type="button"
                    onClick={() => setActivePage('theses')}
                    className="mt-0.5 text-xs font-semibold text-[#1F6B43] hover:underline cursor-pointer"
                  >
                    Открыть таблицу слайдов →
                  </button>
                </div>
              </div>
            </section>

            {/* Rehearsal & Action Toolbar */}
            <section
              id="rehearsal"
              className="no-print bg-white border border-[#DFE6E0] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`font-mono-tabular text-lg font-bold ${
                      elapsedSec > TARGET_SECONDS ? 'text-[#B91C1C]' : 'text-[#142018]'
                    }`}
                  >
                    {formatSecondsToClock(elapsedSec)}
                  </span>
                  <span className="text-xs font-mono-tabular text-[#6B7D72]">/ 04:00</span>

                  <button
                    type="button"
                    onClick={() => setTimerRunning((r) => !r)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1F6B43] text-white hover:bg-[#185435] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {timerRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{timerRunning ? 'Пауза' : 'Прогон'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTimerRunning(false);
                      setElapsedSec(0);
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium text-[#556B5D] hover:text-[#142018] hover:bg-[#EFF4F0] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Сброс
                  </button>
                </div>

                <span className="hidden sm:inline text-[#DFE6E0]" aria-hidden="true">
                  |
                </span>

                <div className="inline-flex items-center gap-1 p-1 bg-[#F2F5F2] rounded-lg">
                  {(['Все', 'Степан', 'Фёдор'] as const).map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => setSpeakerFilter(sp)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        speakerFilter === sp
                          ? 'bg-white text-[#142018] shadow-xs'
                          : 'text-[#556B5D] hover:text-[#142018]'
                      }`}
                    >
                      {sp}
                    </button>
                  ))}
                </div>

                <div className="inline-flex items-center gap-1 p-1 bg-[#F2F5F2] rounded-lg">
                  {([115, 130, 145] as const).map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setWpm(rate)}
                      className={`px-2 py-1 text-xs font-mono-tabular font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        wpm === rate
                          ? 'bg-white text-[#142018] shadow-xs'
                          : 'text-[#556B5D] hover:text-[#142018]'
                      }`}
                    >
                      {rate}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy('text')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#142018] bg-[#F2F5F2] hover:bg-[#E4EBE5] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedType === 'text' ? (
                    <Check className="w-3.5 h-3.5 text-[#1F6B43]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedType === 'text' ? 'Текст скопирован' : 'Копировать текст'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearAllMarks}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    confirmClearMarks
                      ? 'bg-[#FEF3C7] text-[#92400E]'
                      : 'text-[#556B5D] hover:text-[#142018] hover:bg-[#F2F5F2]'
                  }`}
                  title="Убрать цветную подсветку правок со всего сценария (текст и жирный шрифт останутся)"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>{confirmClearMarks ? 'Подтвердить очистку' : 'Принять правки'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#142018] bg-[#F2F5F2] hover:bg-[#E4EBE5] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Печать / PDF</span>
                </button>

                <button
                  type="button"
                  onClick={handleReset}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    confirmReset
                      ? 'bg-[#FEF2F2] text-[#B91C1C]'
                      : 'text-[#556B5D] hover:text-[#142018] hover:bg-[#F2F5F2]'
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{confirmReset ? 'Нажмите ещё раз' : 'Оригинал'}</span>
                </button>
              </div>
            </section>

            {/* Print Header */}
            <div className="hidden print:block pb-4 border-b border-black">
              <h1 className="text-xl font-bold">ВХолодильнике — Сценарий питча (4 минуты)</h1>
              <p className="text-xs mt-1">
                Спикеры: Фёдор Поляков (CEO) и Степан Розанов (COO) · {metrics.totalWords} сл. · ~
                {formatSecondsToClock(metrics.estimatedTotalSeconds)}
              </p>
            </div>

            {/* Editable Script Sections */}
            <section id="script" className="space-y-5">
              {sections.map((sec) => {
                const secWords = sec.cues.reduce((sum, c) => sum + countSpokenWords(c.html), 0);
                const secSeconds = Math.round((secWords / wpm) * 60);
                const range = parseRangeToSeconds(sec.timeRange);
                const isActiveInTimer =
                  timerRunning || elapsedSec > 0
                    ? Boolean(range && elapsedSec >= range.start && elapsedSec < range.end)
                    : false;

                return (
                  <article
                    key={sec.id}
                    className={`print-block bg-white rounded-xl p-5 md:p-7 transition-colors ${
                      isActiveInTimer ? 'border-2 border-[#1F6B43]' : 'border border-[#DFE6E0]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#556B5D] w-full md:w-auto">
                        <span className="font-mono-tabular font-semibold text-[#1F6B43]">
                          {sec.number}
                        </span>
                        <span aria-hidden="true">·</span>
                        <input
                          type="text"
                          value={sec.timeRange}
                          onChange={(e) => updateSectionField(sec.id, 'timeRange', e.target.value)}
                          aria-label={`Таймкод раздела ${sec.number}`}
                          className="font-mono-tabular w-28 bg-transparent text-[#142018] font-medium focus:outline-none focus:bg-[#F5F9F6] rounded px-1 -mx-1"
                        />
                        <span aria-hidden="true">·</span>
                        <input
                          type="text"
                          value={sec.slides}
                          size={Math.min(72, Math.max(20, sec.slides.length))}
                          onChange={(e) => updateSectionField(sec.id, 'slides', e.target.value)}
                          aria-label={`Слайды раздела ${sec.number}`}
                          className="max-w-full bg-transparent text-[#556B5D] focus:text-[#142018] focus:outline-none focus:bg-[#F5F9F6] rounded px-1 -mx-1"
                        />
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular text-[#6B7D72]">
                          {secWords} сл. (~{secSeconds} сек)
                        </span>
                      </div>

                      {sections.length > 1 && (
                        <button
                          type="button"
                          onClick={() => deleteSection(sec.id)}
                          className="no-print p-1 text-[#7D4E4E] hover:text-[#B91C1C] hover:bg-[#FEF2F2] rounded transition-colors cursor-pointer"
                          title="Удалить весь блок"
                          aria-label={`Удалить раздел ${sec.number}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <input
                      type="text"
                      value={sec.title}
                      onChange={(e) => updateSectionField(sec.id, 'title', e.target.value)}
                      aria-label={`Заголовок раздела ${sec.number}`}
                      className="w-full text-lg md:text-xl font-bold tracking-tight text-[#142018] bg-transparent focus:outline-none focus:bg-[#F5F9F6] rounded px-1.5 py-0.5 -mx-1.5"
                    />

                    <input
                      type="text"
                      value={sec.insightNote}
                      onChange={(e) => updateSectionField(sec.id, 'insightNote', e.target.value)}
                      aria-label={`Заметка для спикеров раздела ${sec.number}`}
                      className="no-print mt-1 mb-3 w-full text-xs text-[#6B7D72] bg-transparent focus:outline-none focus:bg-[#F5F9F6] rounded px-1.5 py-0.5 -mx-1.5"
                    />

                    <div className="mt-2">
                      {sec.cues.map((cue, idx) => {
                        const dimmed =
                          speakerFilter !== 'Все' &&
                          cue.speaker !== speakerFilter &&
                          cue.speaker !== 'Вместе';
                        return (
                          <EditableCue
                            key={cue.id}
                            cue={cue}
                            sectionId={sec.id}
                            sectionTitle={sec.title}
                            defaultSlideId={sec.defaultSlideId}
                            index={idx}
                            total={sec.cues.length}
                            resetVersion={resetVersion}
                            dimmed={dimmed}
                            currentUser={currentUser}
                            typingUsers={activeUsers}
                            onChangeHtml={(cId, html) => updateCueHtml(sec.id, cId, html)}
                            onCycleSpeaker={(cId) => cycleSpeaker(sec.id, cId)}
                            onMove={(cId, dir) => moveCue(sec.id, cId, dir)}
                            onDelete={(cId) => deleteCue(sec.id, cId)}
                            onPresenceChange={sendPresence}
                            onSelectionReport={handleSelectionReport}
                            onQuickAddThesis={(text) =>
                              addThesisItem(sec.defaultSlideId, text, sec.title)
                            }
                          />
                        );
                      })}
                    </div>

                    <div className="no-print pt-3 border-t border-[#EBF0EC] mt-1">
                      <button
                        type="button"
                        onClick={() => addCue(sec.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1F6B43] hover:text-[#14452B] py-1 px-2 -ml-2 rounded-md hover:bg-[#EDF5F0] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Добавить реплику</span>
                      </button>
                    </div>
                  </article>
                );
              })}

              <div className="no-print flex justify-center pt-2">
                <button
                  type="button"
                  onClick={addSection}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#142018] bg-white border border-[#DFE6E0] hover:border-[#1F6B43] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-[#1F6B43]" />
                  <span>Добавить новый раздел</span>
                </button>
              </div>
            </section>

            {/* Standalone HTML Code Viewer & Exporter */}
            <section
              id="html-code"
              className="no-print bg-white border border-[#DFE6E0] rounded-xl p-6 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-[#142018]">
                    Автономная HTML-страница (сценарий + тезисы)
                  </h2>
                  <p className="text-sm text-[#556B5D] mt-0.5">
                    Сохраняет цветовые правки, жирный шрифт и таблицу тезисов в одном файле без
                    интернета.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowHtmlSource((s) => !s)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#142018] bg-[#F2F5F2] hover:bg-[#E4EBE5] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>{showHtmlSource ? 'Скрыть код' : 'Показать HTML-код'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopy('html')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#142018] bg-[#F2F5F2] hover:bg-[#E4EBE5] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedType === 'html' ? (
                      <Check className="w-3.5 h-3.5 text-[#1F6B43]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedType === 'html' ? 'HTML скопирован' : 'Скопировать HTML'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadHtml}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1F6B43] hover:bg-[#185435] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать .html</span>
                  </button>

                  <button
                    type="button"
                    disabled={zipLoading}
                    onClick={handleDownloadGithubZip}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#142018] bg-[#EDF5F0] border border-[#C6DBC9] hover:bg-[#DFECE3] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    {zipLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1F6B43]" />
                    ) : (
                      <FolderArchive className="w-3.5 h-3.5 text-[#1F6B43]" />
                    )}
                    <span>{zipLoading ? 'Собираю архив…' : 'Скачать файлы для GitHub (.zip)'}</span>
                  </button>
                </div>
              </div>

              {zipError && (
                <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] rounded-lg px-3 py-2 text-xs">
                  {zipError}
                </div>
              )}

              {showHtmlSource && (
                <pre className="p-4 bg-[#142018] text-[#E6EFE9] rounded-lg text-xs font-mono-tabular overflow-x-auto max-h-80 leading-relaxed">
                  <code>{standaloneHtml}</code>
                </pre>
              )}
            </section>

            {/* Q&A Cheatsheet */}
            <section id="cheatsheet" className="no-print space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#142018]">
                  Шпаргалка к вопросам жюри (расхождения в цифрах отчёта и слайдов)
                </h2>
                <p className="text-sm text-[#556B5D] mt-0.5">
                  Чтобы не растеряться на Q&A, держите под рукой точные объяснения четырёх спорных
                  мест.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {QA_CHEATSHEET.map((item) => (
                  <div
                    key={item.q}
                    className="bg-white border border-[#DFE6E0] rounded-xl p-5 space-y-2"
                  >
                    <h3 className="text-sm font-bold text-[#142018]">{item.q}</h3>
                    <p className="text-sm text-[#47594E] leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* GitHub Pages Deployment & Archive Download */}
            <section className="no-print bg-white border border-[#DFE6E0] rounded-xl p-5 pb-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeployHelp((v) => !v)}
                  className="inline-flex items-center gap-2 text-left cursor-pointer"
                >
                  <HelpCircle className="w-4 h-4 text-[#1F6B43] shrink-0" />
                  <span className="text-sm font-bold text-[#142018]">
                    Как загрузить сайт на GitHub Pages и редактировать вдвоём по ссылке
                  </span>
                  <span className="text-xs font-medium text-[#556B5D] ml-1">
                    ({showDeployHelp ? 'свернуть' : 'развернуть'})
                  </span>
                </button>

                <button
                  type="button"
                  disabled={zipLoading}
                  onClick={handleDownloadGithubZip}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#1F6B43] hover:bg-[#185435] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  {zipLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FolderArchive className="w-3.5 h-3.5" />
                  )}
                  <span>{zipLoading ? 'Собираю архив…' : 'Скачать файлы для GitHub (.zip)'}</span>
                </button>
              </div>

              {showDeployHelp && (
                <ol className="space-y-2 text-sm text-[#47594E] list-decimal list-inside leading-relaxed">
                  <li>
                    Нажмите <b>«Скачать файлы для GitHub (.zip)»</b> и распакуйте архив — внутри уже есть весь код, конфиг Firebase и скрытая папка{' '}
                    <code className="font-mono-tabular text-xs bg-[#F2F5F2] px-1.5 py-0.5 rounded">.github/workflows/deploy.yml</code>.
                  </li>
                  <li>
                    Создайте пустой репозиторий на GitHub и залейте распакованные файлы в ветку{' '}
                    <code className="font-mono-tabular text-xs bg-[#F2F5F2] px-1.5 py-0.5 rounded">main</code>{' '}
                    (при загрузке через браузер включите отображение скрытых файлов, чтобы не потерять{' '}
                    <code className="font-mono-tabular text-xs bg-[#F2F5F2] px-1.5 py-0.5 rounded">.github</code> и{' '}
                    <code className="font-mono-tabular text-xs bg-[#F2F5F2] px-1.5 py-0.5 rounded">.gitignore</code>).
                  </li>
                  <li>
                    Откройте в репозитории <b>Settings → Pages → Build and deployment → Source</b> и выберите <b>GitHub Actions</b>. Через минуту сайт откроется по вашему адресу{' '}
                    <code className="font-mono-tabular text-xs bg-[#F2F5F2] px-1.5 py-0.5 rounded">username.github.io/repo/?room=vholodilnike</code>.
                  </li>
                </ol>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
