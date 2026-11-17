import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesContent = fs.readFileSync(path.resolve('firestore.rules'), 'utf-8');
const blueprint = JSON.parse(fs.readFileSync(path.resolve('firebase-blueprint.json'), 'utf-8'));

test('firestore.rules enforces Eight Pillars security gates', () => {
  assert.match(rulesContent, /rules_version\s*=\s*'2'/);
  assert.match(rulesContent, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  assert.match(rulesContent, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesContent, /function isValidId\(/);
  assert.match(rulesContent, /function isValidPitchRoom\(/);
  assert.match(rulesContent, /function isValidRoomMember\(/);
  assert.match(rulesContent, /affectedKeys\(\)\.hasOnly\(/);
  assert.match(rulesContent, /allow list:\s*if isVerified\(\) && existing\(\)\.ownerUid == request\.auth\.uid/);
  assert.match(rulesContent, /allow list:\s*if false/);
  assert.match(rulesContent, /getAfter\(/);
});

test('blueprint and firestore.rules declare matching collections and keys', () => {
  assert.ok(blueprint.firestore['/rooms/{roomId}']);
  assert.ok(blueprint.firestore['/rooms/{roomId}/members/{memberUid}']);
  for (const field of blueprint.entities.PitchRoom.required) {
    assert.ok(rulesContent.includes(`'${field}'`), `Missing PitchRoom field ${field} in rules`);
  }
  for (const field of blueprint.entities.RoomMember.required) {
    assert.ok(rulesContent.includes(`'${field}'`), `Missing RoomMember field ${field} in rules`);
  }
});
