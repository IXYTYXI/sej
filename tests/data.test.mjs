import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const catalog = readJson('data/catalog.json');
const stats = readJson('data/stats.json');
const provenance = readJson('data/provenance.json');
const words = new Map(catalog.words.map((word) => [word.id, word]));
const stages = new Map(catalog.stages.map((stage) => [stage.id, stage]));
const courses = new Map(catalog.courses.map((course) => [course.id, course]));
const sourceIds = new Set(catalog.sources.map((source) => source.id));
const courseStages = (id) => catalog.stages.filter((stage) => stage.courseId === id);
const sha256 = (content) => createHash('sha256').update(content).digest('hex');

test('catalog contains full bilingual libraries and every promised course', () => {
  assert.deepEqual([...courses.keys()], ['en-core', 'en-cet4', 'en-cet6', 'en-ielts', 'en-toefl', 'en-gre', 'ja-n5', 'ja-n4', 'ja-n3', 'ja-n2', 'ja-n1']);
  assert.ok(stats.englishUniqueWords > 10_000);
  assert.ok(stats.japaneseUniqueWords > 10_000);
  assert.equal(courseStages('en-core').flatMap((stage) => stage.wordIds).length, 1000);
  for (const course of catalog.courses) {
    assert.ok(course.title && course.description && course.sourceUrl.startsWith('https://'));
    const courseWords = courseStages(course.id).flatMap((stage) => stage.wordIds);
    assert.equal(new Set(courseWords).size, courseWords.length, `${course.id} has repeated words`);
    assert.ok(courseWords.length >= (course.language === 'en' ? 1000 : 700), `${course.id} is incomplete`);
  }
});

test('every vocabulary item has a unique identity, Chinese gloss, attribution and clean display text', () => {
  assert.equal(words.size, catalog.words.length);
  const identities = new Set();
  for (const word of catalog.words) {
    assert.match(word.id, new RegExp(`^${word.language}-[0-9a-f]{16}$`));
    assert.ok(word.word.trim().length > 0);
    assert.match(word.meaning, /[\u3400-\u9fff]/u);
    assert.ok(sourceIds.has(word.source));
    assert.ok(Array.isArray(word.tags));
    for (const key of ['word', 'reading', 'meaning', 'example', 'exampleMeaning']) {
      assert.doesNotMatch(word[key] ?? '', /[\x00-\x1f\x7f-\x9f]|<\/?[A-Za-z][^>]*>|\[sound:/u, `${word.id}: ${key}`);
    }
    const identity = `${word.language}\0${word.word.normalize('NFKC').toLowerCase()}\0${word.language === 'ja' ? word.reading.normalize('NFKC') : ''}`;
    assert.ok(!identities.has(identity), `duplicate ${word.word}`);
    identities.add(identity);
    if (word.language === 'ja') {
      assert.ok(word.reading.length > 0);
      if (word.example) assert.match(word.exampleMeaning, /[\u3400-\u9fff]/u);
    }
  }
});

test('all stage references resolve, progress gates are acyclic and only two foundations unlock initially', () => {
  assert.equal(stages.size, catalog.stages.length);
  assert.deepEqual(catalog.stages.filter((stage) => stage.prerequisiteId === null).map((stage) => stage.id), ['en-core-001', 'ja-n5-001']);
  const placed = new Set();
  for (const stage of catalog.stages) {
    assert.ok(courses.has(stage.courseId));
    assert.equal(stage.language, courses.get(stage.courseId).language);
    assert.ok(stage.wordIds.length > 0 && stage.wordIds.length <= 100);
    assert.equal(new Set(stage.wordIds).size, stage.wordIds.length);
    for (const wordId of stage.wordIds) {
      assert.equal(words.get(wordId)?.language, stage.language);
      placed.add(wordId);
    }
    const visited = new Set([stage.id]);
    let previous = stage.prerequisiteId;
    while (previous !== null) {
      assert.ok(stages.has(previous), `missing prerequisite ${previous}`);
      assert.ok(!visited.has(previous), `cycle at ${previous}`);
      visited.add(previous);
      previous = stages.get(previous).prerequisiteId;
    }
  }
  assert.equal(placed.size, words.size, 'all shipped words must appear in a course');
});

test('course stages stay sequential, English exams branch from core and Japanese levels connect', () => {
  const coreLast = courseStages('en-core').at(-1).id;
  for (const course of catalog.courses) {
    const sequence = courseStages(course.id);
    for (const [i, stage] of sequence.entries()) {
      assert.equal(stage.index, i + 1);
      assert.equal(stage.id, `${course.id}-${String(i + 1).padStart(3, '0')}`);
      if (i > 0) assert.equal(stage.prerequisiteId, sequence[i - 1].id);
      if (i < sequence.length - 1) assert.equal(stage.wordIds.length, 100);
    }
    if (course.language === 'en' && course.id !== 'en-core') assert.equal(sequence[0].prerequisiteId, coreLast);
  }
  for (const [id, previous] of [['ja-n4', 'ja-n5'], ['ja-n3', 'ja-n4'], ['ja-n2', 'ja-n3'], ['ja-n1', 'ja-n2']]) {
    assert.equal(courseStages(id)[0].prerequisiteId, courseStages(previous).at(-1).id);
  }
});

test('authoritative stats and source provenance match the actual committed catalog and licenses', () => {
  const bytes = readFileSync(new URL('data/catalog.json', root));
  assert.equal(stats.catalogBytes, bytes.length);
  assert.equal(stats.catalogSha256, sha256(bytes));
  assert.equal(stats.uniqueWords, words.size);
  assert.equal(stats.englishUniqueWords, catalog.words.filter((word) => word.language === 'en').length);
  assert.equal(stats.japaneseUniqueWords, catalog.words.filter((word) => word.language === 'ja').length);
  assert.equal(stats.courses, courses.size);
  assert.equal(stats.stages, stages.size);
  assert.equal(stats.wordPlacements, catalog.stages.reduce((sum, stage) => sum + stage.wordIds.length, 0));
  assert.equal(stats.wordsWithExamples, catalog.words.filter((word) => word.example).length);
  for (const count of stats.byCourse) {
    assert.equal(count.words, courseStages(count.id).reduce((sum, stage) => sum + stage.wordIds.length, 0));
    assert.equal(count.stages, courseStages(count.id).length);
  }
  assert.match(provenance.snapshotDate, /^\d{4}-\d{2}-\d{2}$/);
  for (const source of provenance.sources) {
    assert.match(source.revision, /^[a-f0-9]{40}$/);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.downloadUrl.includes(source.revision));
    const licensePath = new URL(`public/licenses/${source.licenseFile}`, root);
    assert.ok(statSync(licensePath).size > 1000);
    assert.equal(sha256(readFileSync(licensePath)), source.licenseSha256);
  }
  assert.equal(catalog.sources.find((source) => source.id === 'eggrolls-jlpt').license, 'CC BY-NC 4.0');
  assert.match(catalog.sources.find((source) => source.id === 'eggrolls-jlpt').name, /egg rolls/);
});
