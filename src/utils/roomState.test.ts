import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMutation, createInitialRoomState } from './roomState';
import { formatSecondsToClock } from './htmlExporter';

test('createInitialRoomState seeds sections and slide theses', () => {
  const state = createInitialRoomState('test-room');
  assert.equal(state.roomId, 'test-room');
  assert.equal(state.sections.length, 8);
  assert.equal(state.slideTheses.length, 10);
});

test('cue:update updates html and records author color', () => {
  const s0 = createInitialRoomState('r1');
  const firstCue = s0.sections[0].cues[0];
  const s1 = applyMutation(s0, {
    type: 'cue:update',
    sectionId: s0.sections[0].id,
    cueId: firstCue.id,
    html: '<b>Тест</b> <mark class="author-mark" data-author-id="u1">правка</mark>',
    author: { id: 'u1', name: 'Фёдор', color: '#BFDBFE' },
    clientOpId: 'op-1',
  });

  assert.equal(
    s1.sections[0].cues[0].html,
    '<b>Тест</b> <mark class="author-mark" data-author-id="u1">правка</mark>'
  );
  assert.deepEqual(s1.authors.u1, { name: 'Фёдор', color: '#BFDBFE' });
});

test('author:color updates dynamic color entry for existing author', () => {
  const s0 = createInitialRoomState('r1');
  const s1 = applyMutation(s0, {
    type: 'author:color',
    userId: 'u1',
    name: 'Степан',
    color: '#BBF7D0',
    clientOpId: 'op-c1',
  });
  assert.deepEqual(s1.authors.u1, { name: 'Степан', color: '#BBF7D0' });
});

test('thesis:add is idempotent and thesis:update / thesis:delete work cleanly', () => {
  const s0 = createInitialRoomState('r1');
  const item = {
    id: 'th-test-1',
    text: '42 млн тонн еды ежегодно',
    authorId: 'u1',
    authorName: 'Фёдор',
    authorColor: '#BFDBFE',
    sourceSectionTitle: 'Хук',
    createdAt: 1700000005000,
  };

  const s1 = applyMutation(s0, {
    type: 'thesis:add',
    slideId: 'slide-2',
    item,
    clientOpId: 'op-t1',
  });
  const s2 = applyMutation(s1, {
    type: 'thesis:add',
    slideId: 'slide-2',
    item,
    clientOpId: 'op-t2',
  });

  const slide2 = s2.slideTheses.find((r) => r.id === 'slide-2');
  assert.equal(slide2?.items.length, 1);

  const s3 = applyMutation(s2, {
    type: 'thesis:update',
    slideId: 'slide-2',
    itemId: 'th-test-1',
    text: '42 млн тонн еды ежегодно (2,88 трлн ₽)',
    clientOpId: 'op-t3',
  });
  assert.equal(
    s3.slideTheses.find((r) => r.id === 'slide-2')?.items[0].text,
    '42 млн тонн еды ежегодно (2,88 трлн ₽)'
  );

  const s4 = applyMutation(s3, {
    type: 'thesis:delete',
    slideId: 'slide-2',
    itemId: 'th-test-1',
    clientOpId: 'op-t4',
  });
  assert.equal(s4.slideTheses.find((r) => r.id === 'slide-2')?.items.length, 0);
});

test('formatSecondsToClock formats mm:ss accurately', () => {
  assert.equal(formatSecondsToClock(0), '00:00');
  assert.equal(formatSecondsToClock(240), '04:00');
  assert.equal(formatSecondsToClock(65), '01:05');
});
