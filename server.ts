import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import JSZip from 'jszip';
import { AuthorProfile, RoomState, SyncMessage } from './src/types/collaboration';
import { applyMutation, createInitialRoomState } from './src/utils/roomState';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const PORT = Number(process.env.PORT || 3000);

const rooms = new Map<string, RoomState>();
const roomClients = new Map<string, Map<WebSocket, AuthorProfile>>();

function loadRoomsFromDisk() {
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      const raw = fs.readFileSync(ROOMS_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, RoomState>;
      for (const [id, state] of Object.entries(parsed)) {
        if (state && Array.isArray(state.sections)) {
          rooms.set(id, state);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load rooms from disk:', err);
  }
}

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const obj: Record<string, RoomState> = {};
      for (const [id, state] of rooms.entries()) {
        obj[id] = state;
      }
      fs.writeFileSync(ROOMS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist rooms:', err);
    }
  }, 350);
}

function getOrCreateRoom(roomId: string): RoomState {
  const safeId = roomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'vholodilnike';
  let state = rooms.get(safeId);
  if (!state) {
    state = createInitialRoomState(safeId);
    rooms.set(safeId, state);
    scheduleSave();
  }
  return state;
}

function broadcastToRoom(roomId: string, payload: SyncMessage, exclude?: WebSocket) {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  const serialized = JSON.stringify(payload);
  for (const [ws] of clients.entries()) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

function getActiveUsers(roomId: string): AuthorProfile[] {
  const clients = roomClients.get(roomId);
  if (!clients) return [];
  const byId = new Map<string, AuthorProfile>();
  for (const profile of clients.values()) {
    byId.set(profile.id, profile);
  }
  return Array.from(byId.values());
}

async function startServer() {
  loadRoomsFromDisk();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: 'server', aiEnabled: Boolean(process.env.GEMINI_API_KEY) });
  });

  app.get('/api/export-github-zip', async (_req, res) => {
    try {
      const zip = new JSZip();
      const ignoredRelDirs = new Set([
        'node_modules',
        'dist',
        'build',
        'coverage',
        '.git',
        '.aistudio',
        '.playwright-cli',
        'data',
        'public/assets/aistudio',
      ]);
      const ignoredFiles = new Set(['.DS_Store', 'vholodilnike-github-repo.zip']);

      const walk = (dir: string, relBase = '') => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || ignoredRelDirs.has(relPath)) {
              continue;
            }
            walk(fullPath, relPath);
          } else if (entry.isFile()) {
            if (
              ignoredFiles.has(entry.name) ||
              entry.name.endsWith('.log') ||
              (entry.name.startsWith('.env') && entry.name !== '.env.example')
            ) {
              continue;
            }
            zip.file(relPath, fs.readFileSync(fullPath));
          }
        }
      };

      walk(__dirname);

      if (!fs.existsSync(path.join(__dirname, 'README.md'))) {
        zip.file(
          'README.md',
          [
            '# ВХолодильнике — Совместный редактор питча',
            '',
            '## Быстрая публикация на GitHub Pages',
            '',
            '1. Загрузите все файлы (включая скрытую папку `.github/workflows/deploy.yml` и `.gitignore`) в ветку `main`.',
            '2. Откройте в репозитории **Settings → Pages → Build and deployment → Source** и выберите **GitHub Actions**.',
            '3. После сборки сайт откроется по адресу `https://<username>.github.io/<repo>/?room=vholodilnike`.',
            '4. Для входа через Google (облако Firestore 24/7) добавьте `<username>.github.io` в Authorized Domains в настройках Firebase Authentication.',
            '',
          ].join('\n')
        );
      }

      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="vholodilnike-github-repo.zip"'
      );
      res.send(buffer);
    } catch (error) {
      console.error('Failed to build GitHub ZIP:', error);
      res.status(500).json({ error: 'Не удалось собрать архив проекта.' });
    }
  });

  app.post('/api/ai/rewrite-pitch', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: 'GEMINI_API_KEY не настроен на сервере (Settings > Secrets).',
      });
      return;
    }

    const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const speaker = typeof req.body?.speaker === 'string' ? req.body.speaker.trim() : '';
    const sectionTitle =
      typeof req.body?.sectionTitle === 'string' ? req.body.sectionTitle.trim() : '';
    const surroundingText =
      typeof req.body?.surroundingText === 'string' ? req.body.surroundingText.trim() : '';
    const mode =
      req.body?.mode === 'sharpen' || req.body?.mode === 'shorten' ? req.body.mode : 'rewrite';

    if (!rawText) {
      res.status(400).json({ error: 'Выделите тезис или фрагмент текста перед запросом.' });
      return;
    }

    const modeHint =
      mode === 'shorten'
        ? 'Сделай максимально ёмко и коротко для быстрого темпа (на 20–30% короче исходного).'
        : mode === 'sharpen'
          ? 'Усиль инвесторский хук и контраст, сохранив все точные цифры.'
          : 'Перепиши сухой тезис или черновик в живую, убедительную фразу для устного 4-минутного питча перед инвесторами.';

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const promptParts = [
        `Исходный тезис / фрагмент: """${rawText}"""`,
        speaker ? `Спикер: ${speaker} (дуэт основателей «ВХолодильнике» — Фёдор Поляков CEO и Степан Розанов COO).` : '',
        sectionTitle ? `Раздел / слайд выступления: ${sectionTitle}.` : '',
        surroundingText ? `Контекст абзаца: """${surroundingText.slice(0, 600)}"""` : '',
        `Задача: ${modeHint}`,
      ]
        .filter(Boolean)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: promptParts,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Ты — редактор и питч-коуч стартапа «ВХолодильнике» (ИИ-контроль запасов холодильника и быстрые рецепты за 15–20 минут). Переписывай сырые тезисы в естественные, сильные устные фразы для 4-минутного инвесторского питча на русском языке. Сохраняй все точные цифры и факты без выдумывания новых. Пиши живо, без канцелярита («является», «осуществляет», «в рамках»), короткими ритмичными предложениями.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              phrase: {
                type: Type.STRING,
                description:
                  'Полноценная готовая фраза для произнесения со сцены, соответствующая стилю инвесторского питча «ВХолодильнике».',
              },
              alternative: {
                type: Type.STRING,
                description: 'Более короткий или острый альтернативный вариант формулировки.',
              },
              deliveryTip: {
                type: Type.STRING,
                description: 'Короткая подсказка по интонации или паузе (до 12 слов).',
              },
            },
            required: ['phrase', 'alternative', 'deliveryTip'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        phrase?: string;
        alternative?: string;
        deliveryTip?: string;
      };

      if (!parsed.phrase) {
        res.status(502).json({ error: 'Модель вернула пустой ответ.' });
        return;
      }

      res.json({
        phrase: parsed.phrase,
        alternative: parsed.alternative || parsed.phrase,
        deliveryTip: parsed.deliveryTip || 'Сделайте короткую паузу перед ключевой цифрой.',
      });
    } catch (error) {
      console.error('Gemini rewrite error:', error);
      const message =
        error instanceof Error ? error.message : 'Не удалось обратиться к Gemini API.';
      res.status(500).json({ error: message });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const roomId =
      (url.searchParams.get('room') || 'vholodilnike')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 64) || 'vholodilnike';

    let currentProfile: AuthorProfile | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as SyncMessage;
        const roomState = getOrCreateRoom(roomId);

        if (msg.type === 'room:join') {
          currentProfile = {
            ...msg.user,
            lastSeen: Date.now(),
          };
          if (!roomClients.has(roomId)) {
            roomClients.set(roomId, new Map());
          }
          roomClients.get(roomId)!.set(ws, currentProfile);

          // Record author color in room registry
          roomState.authors[currentProfile.id] = {
            name: currentProfile.name,
            color: currentProfile.color,
          };

          ws.send(
            JSON.stringify({
              type: 'room:state',
              state: roomState,
              activeUsers: getActiveUsers(roomId),
            } satisfies SyncMessage)
          );

          broadcastToRoom(
            roomId,
            { type: 'presence:list', activeUsers: getActiveUsers(roomId) },
            ws
          );
          return;
        }

        if (msg.type === 'presence:update') {
          currentProfile = {
            ...msg.user,
            lastSeen: Date.now(),
          };
          roomClients.get(roomId)?.set(ws, currentProfile);
          broadcastToRoom(
            roomId,
            { type: 'presence:list', activeUsers: getActiveUsers(roomId) },
            ws
          );
          return;
        }

        if (
          msg.type === 'cue:update' ||
          msg.type === 'cue:add' ||
          msg.type === 'cue:delete' ||
          msg.type === 'cue:move' ||
          msg.type === 'cue:speaker' ||
          msg.type === 'section:update' ||
          msg.type === 'section:add' ||
          msg.type === 'section:delete' ||
          msg.type === 'script:replace' ||
          msg.type === 'thesis:add' ||
          msg.type === 'thesis:update' ||
          msg.type === 'thesis:delete' ||
          msg.type === 'thesis:rowAdd' ||
          msg.type === 'author:color'
        ) {
          const updated = applyMutation(roomState, msg);
          rooms.set(roomId, updated);
          scheduleSave();

          broadcastToRoom(roomId, msg, ws);
          if (msg.type === 'author:color' && currentProfile) {
            currentProfile = { ...currentProfile, name: msg.name, color: msg.color };
            roomClients.get(roomId)?.set(ws, currentProfile);
            broadcastToRoom(roomId, {
              type: 'presence:list',
              activeUsers: getActiveUsers(roomId),
            });
          }
        }
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    });

    ws.on('close', () => {
      const clients = roomClients.get(roomId);
      if (clients) {
        clients.delete(ws);
        broadcastToRoom(roomId, {
          type: 'presence:list',
          activeUsers: getActiveUsers(roomId),
        });
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Pitch Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
