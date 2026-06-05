export const failedGuessMistakeCount = 5;
export const maxGuessMistakesForStars = failedGuessMistakeCount - 1;

export function normalizeGuess(value: string) {
  return value
    .trim()
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u2032\u0060]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

export function isGuessSpacer(value: string) {
  return /^\s$/u.test(value);
}

export function normalizeGuessCharacter(value: string) {
  const normalizedValue = value
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u2032\u0060]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .toLocaleLowerCase();

  return Array.from(normalizedValue)[0] ?? '';
}

export function isGuessCharacterCorrect(value: string, expected: string) {
  return normalizeGuessCharacter(value) === normalizeGuessCharacter(expected);
}

export function getGuessTargetIndexes(correctPhrase: string) {
  return Array.from(correctPhrase).reduce<number[]>((indexes, character, index) => {
    if (!isGuessSpacer(character)) {
      indexes.push(index);
    }

    return indexes;
  }, []);
}

export function extractGuessCharacters(value: string) {
  return Array.from(value).filter((character) => !isGuessSpacer(character));
}

export function composeGuessTextFromEntries(
  correctPhrase: string,
  entries: readonly { value: string }[],
) {
  let entryIndex = 0;

  return Array.from(correctPhrase)
    .map((character) => {
      if (isGuessSpacer(character)) {
        return character;
      }

      const entry = entries[entryIndex];
      entryIndex += 1;

      return entry?.value ?? '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function composeGuessTextFromEvents(
  correctPhrase: string,
  events: readonly { index: number; value: string }[],
) {
  const latestValuesByIndex = new Map<number, string>();

  for (const event of events) {
    latestValuesByIndex.set(event.index, event.value);
  }

  return Array.from(correctPhrase)
    .map((character, index) => {
      if (isGuessSpacer(character)) {
        return character;
      }

      return latestValuesByIndex.get(index) ?? '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getCorrectGuessLetterCount(
  correctPhrase: string,
  events: readonly { index: number; value: string }[],
) {
  const phraseCharacters = Array.from(correctPhrase);
  const targetIndexes = new Set(getGuessTargetIndexes(correctPhrase));
  const correctIndexes = new Set<number>();

  for (const event of events) {
    if (!targetIndexes.has(event.index)) {
      continue;
    }

    if (isGuessCharacterCorrect(event.value, phraseCharacters[event.index] ?? '')) {
      correctIndexes.add(event.index);
    }
  }

  return correctIndexes.size;
}

export function starsFromGuessTrace(
  correctPhrase: string,
  events: readonly { index: number; value: string }[],
  mistakeCount: number,
) {
  const targetLetterCount = getGuessTargetIndexes(correctPhrase).length;
  const correctLetterCount = getCorrectGuessLetterCount(correctPhrase, events);

  if (targetLetterCount === 0) {
    return mistakeCount === 0 ? 3 : 0;
  }

  if (correctLetterCount === targetLetterCount) {
    if (mistakeCount === 0) {
      return 3;
    }

    if (mistakeCount < 3) {
      return 2;
    }

    if (mistakeCount < failedGuessMistakeCount) {
      return 1;
    }

    return 0;
  }

  if (mistakeCount >= failedGuessMistakeCount) {
    const correctRatio = correctLetterCount / targetLetterCount;

    if (correctRatio > 0.75) {
      return 2;
    }

    if (correctRatio > 0.5) {
      return 1;
    }
  }

  return 0;
}

export function scoreGuessByTrace(
  correctPhrase: string,
  events: readonly { index: number; value: string }[],
  mistakeCount: number,
) {
  const stars = starsFromGuessTrace(correctPhrase, events, mistakeCount);

  if (stars === 3) {
    return 10;
  }

  if (stars === 2) {
    return 8;
  }

  if (stars === 1) {
    return 5;
  }

  return 0;
}

export function calculateGuessSimilarity(guess: string, correctPhrase: string) {
  const normalizedGuess = normalizeGuess(guess);
  const normalizedCorrectPhrase = normalizeGuess(correctPhrase);
  const guessWords = normalizedGuess ? normalizedGuess.split(' ') : [];
  const correctWords = normalizedCorrectPhrase ? normalizedCorrectPhrase.split(' ') : [];
  const maxWordLength = Math.max(guessWords.length, correctWords.length);
  const shouldUseWordErrorRate = maxWordLength > 2;

  const maxLength = shouldUseWordErrorRate
    ? maxWordLength
    : Math.max(normalizedGuess.length, normalizedCorrectPhrase.length);

  if (maxLength === 0) {
    return 1;
  }

  const distance = shouldUseWordErrorRate
    ? wordEditDistance(guessWords, correctWords)
    : wassersteinEditDistance(normalizedGuess, normalizedCorrectPhrase);

  return Math.max(0, 1 - distance / maxLength);
}

function wassersteinEditDistance(a: string, b: string) {
  const source = normalizeGuess(a);
  const target = normalizeGuess(b);

  if (!source.length) {
    return target.length;
  }

  if (!target.length) {
    return source.length;
  }

  const rows = source.length + 1;
  const cols = target.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    matrix[rowIndex][0] = rowIndex;
  }

  for (let colIndex = 0; colIndex < cols; colIndex += 1) {
    matrix[0][colIndex] = colIndex;
  }

  for (let rowIndex = 1; rowIndex < rows; rowIndex += 1) {
    for (let colIndex = 1; colIndex < cols; colIndex += 1) {
      const substitutionCost = source[rowIndex - 1] === target[colIndex - 1] ? 0 : 1;
      matrix[rowIndex][colIndex] = Math.min(
        matrix[rowIndex - 1][colIndex] + 1,
        matrix[rowIndex][colIndex - 1] + 1,
        matrix[rowIndex - 1][colIndex - 1] + substitutionCost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function wordEditDistance(a: string[], b: string[]) {
  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    matrix[rowIndex][0] = rowIndex;
  }

  for (let colIndex = 0; colIndex < cols; colIndex += 1) {
    matrix[0][colIndex] = colIndex;
  }

  for (let rowIndex = 1; rowIndex < rows; rowIndex += 1) {
    for (let colIndex = 1; colIndex < cols; colIndex += 1) {
      const substitutionCost = a[rowIndex - 1] === b[colIndex - 1] ? 0 : 1;
      matrix[rowIndex][colIndex] = Math.min(
        matrix[rowIndex - 1][colIndex] + 1,
        matrix[rowIndex][colIndex - 1] + 1,
        matrix[rowIndex - 1][colIndex - 1] + substitutionCost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

export function scoreGuess(guess: string, correctPhrase: string) {
  return Math.max(0, Math.round(calculateGuessSimilarity(guess, correctPhrase) * 10));
}
