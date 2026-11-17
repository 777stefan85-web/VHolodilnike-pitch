import React, { useState } from 'react';
import { ArrowLeft, Check, Copy, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { SlideThesisRow } from '../types/collaboration';
import { buildPlainTextTheses } from '../utils/htmlExporter';
import { PitchRewriteResult, requestPitchRewrite } from '../lib/aiRewrite';

interface ThesesPageProps {
  slideTheses: SlideThesisRow[];
  authors: Record<string, { name: string; color: string }>;
  onAddThesis: (slideId: string, text: string) => void;
  onUpdateThesis: (slideId: string, itemId: string, text: string) => void;
  onDeleteThesis: (slideId: string, itemId: string) => void;
  onAddSlideRow: (slideLabel: string, slideTitle: string) => void;
  onInsertPhraseIntoScript: (slideId: string, phrase: string) => void;
  onBackToScript: () => void;
}

export const ThesesPage: React.FC<ThesesPageProps> = ({
  slideTheses,
  authors,
  onAddThesis,
  onUpdateThesis,
  onDeleteThesis,
  onAddSlideRow,
  onInsertPhraseIntoScript,
  onBackToScript,
}) => {
  const [draftBySlide, setDraftBySlide] = useState<Record<string, string>>({});
  const [newSlideLabel, setNewSlideLabel] = useState('');
  const [newSlideTitle, setNewSlideTitle] = useState('');
  const [copied, setCopied] = useState(false);

  // Per-thesis AI rewrite state
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [aiResultByItem, setAiResultByItem] = useState<Record<string, PitchRewriteResult>>({});
  const [aiErrorByItem, setAiErrorByItem] = useState<Record<string, string>>({});
  const [copiedAiId, setCopiedAiId] = useState<string | null>(null);

  const totalTheses = slideTheses.reduce((acc, row) => acc + row.items.length, 0);

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(buildPlainTextTheses(slideTheses));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleSubmitDraft = (slideId: string, e: React.FormEvent) => {
    e.preventDefault();
    const text = (draftBySlide[slideId] || '').trim();
    if (!text) return;
    onAddThesis(slideId, text);
    setDraftBySlide((prev) => ({ ...prev, [slideId]: '' }));
  };

  const handleCreateSlideRow = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newSlideLabel.trim();
    const title = newSlideTitle.trim();
    if (!label || !title) return;
    onAddSlideRow(label, title);
    setNewSlideLabel('');
    setNewSlideTitle('');
  };

  const handleAiRewriteThesis = async (
    itemId: string,
    text: string,
    row: SlideThesisRow
  ) => {
    setAiLoadingId(itemId);
    setAiErrorByItem((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    try {
      const result = await requestPitchRewrite({
        text,
        sectionTitle: `${row.slideLabel} — ${row.slideTitle}`,
        mode: 'rewrite',
      });
      setAiResultByItem((prev) => ({ ...prev, [itemId]: result }));
    } catch (err) {
      setAiErrorByItem((prev) => ({
        ...prev,
        [itemId]: err instanceof Error ? err.message : 'Ошибка AI-переписывания',
      }));
    } finally {
      setAiLoadingId(null);
    }
  };

  const handleCopyPhrase = async (itemId: string, phrase: string) => {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopiedAiId(itemId);
      window.setTimeout(() => setCopiedAiId(null), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <section className="space-y-6" aria-label="Тезисы к слайдам">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-xs font-medium text-[#556B5D] mb-1.5">
            Структура слайдов · Переносите фразы из сценария и дорабатывайте с ИИ
          </p>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#142018]">
            Тезисы к слайдам презентации
          </h1>
          <p className="mt-2 text-sm text-[#47594E] leading-relaxed">
            Каждая строка соответствует слайду колоды. Вы можете превратить любой сухой тезис в
            полноценную фразу в стиле питча кнопкой «Переписать в фразу» и сразу вставить её в
            сценарий.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onBackToScript}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#142018] bg-white border border-[#DFE6E0] hover:border-[#1F6B43] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Вернуться к сценарию</span>
          </button>

          <button
            type="button"
            onClick={handleCopyAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#1F6B43] hover:bg-[#185435] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Тезисы скопированы' : `Копировать все (${totalTheses})`}</span>
          </button>
        </div>
      </div>

      {/* Slide rows table */}
      <div className="bg-white border border-[#DFE6E0] rounded-xl overflow-hidden divide-y divide-[#EBF0EC]">
        {slideTheses.map((row) => (
          <div
            key={row.id}
            data-testid={`thesis-row-${row.id}`}
            className="p-5 md:p-6 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 lg:gap-8"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono-tabular text-xs font-semibold text-[#1F6B43]">
                  {row.slideLabel}
                </span>
                <span className="text-[#C5D1C8]" aria-hidden="true">
                  ·
                </span>
                <span className="font-mono-tabular text-xs text-[#6B7D72]">
                  {row.items.length} тез.
                </span>
              </div>
              <h2 className="text-[15px] font-bold text-[#142018] leading-snug">
                {row.slideTitle}
              </h2>
            </div>

            <div className="space-y-3 min-w-0">
              {row.items.length === 0 ? (
                <p className="text-sm text-[#7A8C81]">
                  Пока нет тезисов — выделите фрагмент в сценарии или добавьте строку ниже.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {row.items.map((item) => {
                    const liveColor = authors[item.authorId]?.color || item.authorColor;
                    const liveName = authors[item.authorId]?.name || item.authorName;
                    const aiRes = aiResultByItem[item.id];
                    const aiErr = aiErrorByItem[item.id];
                    const isAiLoading = aiLoadingId === item.id;

                    return (
                      <li
                        key={item.id}
                        className="group p-3 rounded-lg border border-[#EBF0EC] bg-[#FAFBF9] focus-within:border-[#1F6B43]/50 focus-within:bg-white transition-colors space-y-2.5"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                            style={{ backgroundColor: liveColor }}
                            title={`Автор: ${liveName}`}
                          />

                          <div className="flex-1 min-w-0 space-y-1">
                            <textarea
                              rows={Math.max(1, Math.ceil(item.text.length / 72))}
                              value={item.text}
                              onChange={(e) => onUpdateThesis(row.id, item.id, e.target.value)}
                              aria-label={`Редактировать тезис для ${row.slideLabel}`}
                              className="w-full resize-none bg-transparent text-sm text-[#142018] leading-relaxed focus:outline-none"
                            />
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#6B7D72]">
                                <span>{liveName}</span>
                                {item.sourceSectionTitle && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>Из блока «{item.sourceSectionTitle}»</span>
                                  </>
                                )}
                              </div>

                              <button
                                type="button"
                                disabled={isAiLoading}
                                onClick={() => handleAiRewriteThesis(item.id, item.text, row)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-[#1F6B43] hover:bg-[#EDF5F0] rounded transition-colors cursor-pointer disabled:opacity-60"
                              >
                                {isAiLoading ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Sparkles className="w-3 h-3" />
                                )}
                                <span>
                                  {isAiLoading ? 'Переписываю…' : 'Переписать в фразу'}
                                </span>
                              </button>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => onDeleteThesis(row.id, item.id)}
                            aria-label={`Удалить тезис «${item.text.slice(0, 24)}»`}
                            title="Удалить тезис"
                            className="p-1 text-[#7D4E4E] hover:text-[#B91C1C] hover:bg-[#FEF2F2] rounded opacity-70 group-hover:opacity-100 transition-colors cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {aiErr && (
                          <div className="text-xs text-[#B91C1C] bg-[#FEF2F2] rounded-md px-3 py-2">
                            {aiErr}
                          </div>
                        )}

                        {aiRes && (
                          <div className="bg-white border border-[#D4E2D7] rounded-lg p-3 space-y-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-[#1F6B43] inline-flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>Готовая фраза для выступления</span>
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setAiResultByItem((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  })
                                }
                                aria-label="Скрыть вариант фразы"
                                className="text-[#6B7D72] hover:text-[#142018] cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <p className="text-sm text-[#142018] leading-relaxed">{aiRes.phrase}</p>
                            <p className="text-[11px] text-[#556B5D]">
                              Совет: {aiRes.deliveryTip}
                            </p>

                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => onInsertPhraseIntoScript(row.id, aiRes.phrase)}
                                className="px-2.5 py-1 text-xs font-semibold bg-[#1F6B43] hover:bg-[#185435] text-white rounded-md cursor-pointer"
                              >
                                Вставить в сценарий
                              </button>
                              <button
                                type="button"
                                onClick={() => onUpdateThesis(row.id, item.id, aiRes.phrase)}
                                className="px-2.5 py-1 text-xs font-medium bg-[#F2F5F2] hover:bg-[#E4EBE5] text-[#142018] rounded-md cursor-pointer"
                              >
                                Заменить тезис
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopyPhrase(item.id, aiRes.phrase)}
                                className="px-2.5 py-1 text-xs font-medium text-[#556B5D] hover:text-[#142018] cursor-pointer"
                              >
                                {copiedAiId === item.id ? 'Скопировано' : 'Копировать'}
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <form
                onSubmit={(e) => handleSubmitDraft(row.id, e)}
                className="flex items-center gap-2 pt-1"
              >
                <input
                  type="text"
                  value={draftBySlide[row.id] || ''}
                  onChange={(e) =>
                    setDraftBySlide((prev) => ({ ...prev, [row.id]: e.target.value }))
                  }
                  placeholder={`Добавить тезис для «${row.slideLabel}»…`}
                  aria-label={`Новый тезис для ${row.slideLabel}`}
                  className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-[#F8FAF8] border border-[#DFE6E0] rounded-lg focus:outline-none focus:border-[#1F6B43] focus:bg-white transition-colors"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#1F6B43] bg-[#EDF5F0] hover:bg-[#DFECE3] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Добавить</span>
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>

      {/* Add new slide row */}
      <form
        onSubmit={handleCreateSlideRow}
        className="bg-white border border-[#DFE6E0] rounded-xl p-5 flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
      >
        <div className="sm:w-44">
          <label className="block text-xs font-medium text-[#556B5D] mb-1">
            Номер / метка слайда
          </label>
          <input
            type="text"
            value={newSlideLabel}
            onChange={(e) => setNewSlideLabel(e.target.value)}
            placeholder="Например: Слайд 16"
            className="w-full px-3 py-2 text-sm bg-[#F8FAF8] border border-[#DFE6E0] rounded-lg focus:outline-none focus:border-[#1F6B43] focus:bg-white"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-[#556B5D] mb-1">
            Название слайда
          </label>
          <input
            type="text"
            value={newSlideTitle}
            onChange={(e) => setNewSlideTitle(e.target.value)}
            placeholder="Например: Дорожная карта 2027–2029"
            className="w-full px-3 py-2 text-sm bg-[#F8FAF8] border border-[#DFE6E0] rounded-lg focus:outline-none focus:border-[#1F6B43] focus:bg-white"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#1F6B43] hover:bg-[#185435] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Добавить строку слайда</span>
        </button>
      </form>
    </section>
  );
};
