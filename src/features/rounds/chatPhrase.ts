export const maxChatPhraseLength = 80;

export function normalizeChatPhraseForStorage(phrase: string) {
  const normalizedPhrase = phrase
    .trim()
    .normalize('NFKC')
    .replace(/\s+/g, ' ');

  if (!normalizedPhrase) {
    throw new Error('Type what you are going to say before recording.');
  }

  if (normalizedPhrase.length > maxChatPhraseLength) {
    throw new Error(`Keep chat phrases to ${maxChatPhraseLength} characters or fewer.`);
  }

  return normalizedPhrase;
}
