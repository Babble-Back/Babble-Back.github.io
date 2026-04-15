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
