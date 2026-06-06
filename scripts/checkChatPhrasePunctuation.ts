import assert from 'node:assert/strict';
import { normalizeChatPhraseForStorage } from '../src/features/rounds/chatPhrase';
import {
  composeGuessTextFromEntries,
  getGuessTargetIndexes,
  isGuessSpacer,
  isGuessTargetCharacter,
} from '../src/features/rounds/utils';

const phrase = 'Hello, how are you?🤔';
const normalizedPhrase = normalizeChatPhraseForStorage('  Hello,   how are you?🤔  ');

assert.equal(normalizedPhrase, phrase);

const phraseCharacters = Array.from(phrase);
const targetIndexes = getGuessTargetIndexes(phrase);
const fixedCharacters = phraseCharacters.filter(
  (character) => !isGuessTargetCharacter(character) && !isGuessSpacer(character),
);

assert.equal(targetIndexes.length, 14);
assert.deepEqual(fixedCharacters, [',', '?', '🤔']);
assert.equal(
  composeGuessTextFromEntries(
    phrase,
    targetIndexes.map((phraseIndex) => ({
      phraseIndex,
      value: phraseCharacters[phraseIndex] ?? '',
    })),
  ),
  phrase,
);

console.log('Chat phrase punctuation and emoji checks passed.');
