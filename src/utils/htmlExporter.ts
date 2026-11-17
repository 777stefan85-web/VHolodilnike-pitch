import { PitchSection, SlideThesisRow } from '../types/collaboration';

export function htmlToPlainText(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
}

export function countSpokenWords(html: string): number {
  const plain = htmlToPlainText(html);
  const spokenOnly = plain.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spokenOnly) return 0;
  return spokenOnly.split(' ').filter(Boolean).length;
}

export function formatSecondsToClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildPlainTextScript(sections: PitchSection[]): string {
  return sections
    .map((sec) => {
      const header = `[${sec.timeRange}] ${sec.number}. ${sec.title} (${sec.slides})`;
      const lines = sec.cues
        .map((cue) => `${cue.speaker}: ${htmlToPlainText(cue.html)}`)
        .join('\n\n');
      return `${header}\n${lines}`;
    })
    .join('\n\n---\n\n');
}

export function buildPlainTextTheses(rows: SlideThesisRow[]): string {
  return rows
    .map((row) => {
      const items =
        row.items.length > 0
          ? row.items.map((it, idx) => `  ${idx + 1}. ${it.text}`).join('\n')
          : '  (пока нет тезисов)';
      return `${row.slideLabel} — ${row.slideTitle}\n${items}`;
    })
    .join('\n\n');
}

export function stripAuthorMarksFromHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const marks = doc.querySelectorAll('mark.author-mark');
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  });
  return doc.body.innerHTML.replace(/\u200B/g, '');
}

export function generateStandaloneHtml(
  sections: PitchSection[],
  slideTheses: SlideThesisRow[],
  wpm: number,
  authors: Record<string, { name: string; color: string }>
): string {
  const authorCss = Object.entries(authors)
    .map(
      ([id, info]) =>
        `mark.author-mark[data-author-id="${id.replace(/[^a-zA-Z0-9_-]/g, '')}"] { background-color: ${info.color}; }`
    )
    .join('\n    ');

  const sectionsMarkup = sections
    .map((sec) => {
      const cuesMarkup = sec.cues
        .map((cue) => {
          const speakerClass =
            cue.speaker === 'Степан'
              ? 'speaker-stepan'
              : cue.speaker === 'Фёдор'
                ? 'speaker-fedor'
                : 'speaker-both';
          return `
        <div class="cue">
          <div class="cue-speaker ${speakerClass}" contenteditable="true">${escapeHtmlText(cue.speaker)}</div>
          <div class="cue-text" contenteditable="true">${cue.html}</div>
        </div>`;
        })
        .join('\n');

      return `
    <section class="block" data-id="${escapeHtmlText(sec.id)}">
      <div class="block-meta">
        <span contenteditable="true">${escapeHtmlText(sec.number)}</span>
        <span aria-hidden="true">·</span>
        <span class="mono" contenteditable="true">${escapeHtmlText(sec.timeRange)}</span>
        <span aria-hidden="true">·</span>
        <span contenteditable="true">${escapeHtmlText(sec.slides)}</span>
      </div>
      <h2 class="block-title" contenteditable="true">${escapeHtmlText(sec.title)}</h2>
      <div class="cues">
        ${cuesMarkup}
      </div>
    </section>`;
    })
    .join('\n');

  const thesesMarkup = slideTheses
    .map((row) => {
      const itemsHtml =
        row.items.length === 0
          ? '<li class="empty-thesis">Тезисы не добавлены</li>'
          : row.items
              .map(
                (item) =>
                  `<li contenteditable="true" style="margin-bottom: 8px; list-style: none;"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${escapeHtmlText(
                    item.authorColor
                  )};margin-right:8px;vertical-align:middle;"></span>${escapeHtmlText(item.text)}</li>`
              )
              .join('\n');
      return `
      <tr>
        <td class="slide-col"><strong>${escapeHtmlText(row.slideLabel)}</strong><br/><span class="muted">${escapeHtmlText(row.slideTitle)}</span></td>
        <td><ul class="thesis-list">${itemsHtml}</ul></td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ВХолодильнике — Сценарий и тезисы питча</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #f8faf8;
      --surface: #ffffff;
      --border: #dfe6e0;
      --text: #142018;
      --muted: #556b5d;
      --green: #1f6b43;
      --fedor: #1d4ed8;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Manrope', sans-serif; background: var(--bg); color: var(--text); line-height: 1.65; }
    .topbar {
      position: sticky; top: 0; z-index: 10; background: rgba(248, 250, 248, 0.94);
      backdrop-filter: blur(8px); border-bottom: 1px solid var(--border);
      padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    }
    .brand { font-weight: 700; font-size: 16px; }
    .stats { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    button { font-family: inherit; font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
    button.primary { background: var(--green); color: #fff; border-color: var(--green); }
    main { max-width: 880px; margin: 32px auto 64px; padding: 0 20px; }
    .block { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 16px; }
    .block-meta { font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .block-title { margin: 0 0 18px; font-size: 18px; font-weight: 700; }
    .cue { display: grid; grid-template-columns: 96px 1fr; gap: 16px; padding: 12px 0; border-top: 1px solid #eef2ee; }
    .cue-speaker { font-size: 13px; font-weight: 700; }
    .speaker-stepan { color: var(--green); }
    .speaker-fedor { color: var(--fedor); }
    .cue-text { font-size: 15px; outline: none; border-radius: 6px; padding: 2px 6px; margin: -2px -6px; }
    mark.author-mark { padding: 1px 3px; border-radius: 4px; color: var(--text); }
    ${authorCss}
    .stage-dir { color: var(--muted); font-style: italic; }
    table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-top: 24px; }
    th, td { padding: 14px 16px; border-top: 1px solid #eef2ee; text-align: left; vertical-align: top; font-size: 14px; }
    .slide-col { width: 260px; }
    .muted { color: var(--muted); font-size: 12px; }
    .thesis-list { margin: 0; padding-left: 16px; }
    .empty-thesis { color: #8da094; list-style: none; margin-left: -16px; }
    @media print { .topbar { display: none !important; } body { background: #fff; } }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">ВХолодильнике · Сценарий и тезисы</div>
    <div class="stats" id="stats"></div>
    <div class="actions">
      <button onclick="saveHtmlFile()" class="primary">Сохранить HTML</button>
      <button onclick="window.print()">Печать / PDF</button>
    </div>
  </header>
  <main>
    <div id="sectionsWrap">${sectionsMarkup}</div>
    <h2 style="margin-top:36px;">Тезисы по слайдам</h2>
    <table>
      <tbody>${thesesMarkup}</tbody>
    </table>
  </main>
  <script>
    const WPM = ${wpm};
    function updateStats() {
      let words = 0;
      document.querySelectorAll('.cue-text').forEach(el => {
        const clean = (el.textContent || '').replace(/\\[[^\\]]*\\]/g, ' ').replace(/\\s+/g, ' ').trim();
        if (clean) words += clean.split(' ').length;
      });
      const sec = Math.round((words / WPM) * 60) + 15;
      const m = String(Math.floor(sec / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      document.getElementById('stats').textContent = words + ' сл. · ~' + m + ':' + s;
    }
    document.addEventListener('input', updateStats);
    function saveHtmlFile() {
      const blob = new Blob(['<!doctype html>\\n' + document.documentElement.outerHTML], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'vholodilnike-pitch-edited.html';
      a.click();
      URL.revokeObjectURL(a.href);
    }
    updateStats();
  </script>
</body>
</html>`;
}
