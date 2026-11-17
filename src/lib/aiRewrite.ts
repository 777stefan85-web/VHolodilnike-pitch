export interface PitchRewriteRequest {
  text: string;
  speaker?: string;
  sectionTitle?: string;
  surroundingText?: string;
  mode?: 'rewrite' | 'sharpen' | 'shorten';
}

export interface PitchRewriteResult {
  phrase: string;
  alternative: string;
  deliveryTip: string;
}

export async function requestPitchRewrite(
  payload: PitchRewriteRequest
): Promise<PitchRewriteResult> {
  const res = await fetch('./api/ai/rewrite-pitch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      'AI-помощник доступен при запуске с сервером (AI Studio или Node-сервер). На статическом GitHub Pages серверный API недоступен.'
    );
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Ошибка сервера (${res.status})`);
  }

  if (!data?.phrase) {
    throw new Error('Модель не вернула готовую фразу.');
  }

  return data as PitchRewriteResult;
}
