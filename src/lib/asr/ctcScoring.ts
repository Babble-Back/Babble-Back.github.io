const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;

let blankTokenId = 0;

function logAddExp(a: number, b: number) {
  if (a === NEGATIVE_INFINITY) {
    return b;
  }

  if (b === NEGATIVE_INFINITY) {
    return a;
  }

  const max = Math.max(a, b);
  const min = Math.min(a, b);

  return max + Math.log1p(Math.exp(min - max));
}

function buildExtendedTokens(tokens: number[]) {
  const extended = new Array<number>(tokens.length * 2 + 1).fill(blankTokenId);

  for (let index = 0; index < tokens.length; index += 1) {
    extended[index * 2 + 1] = tokens[index];
  }

  return extended;
}

export function setCTCBlankTokenId(tokenId: number) {
  blankTokenId = Number.isInteger(tokenId) && tokenId >= 0 ? tokenId : 0;
}

export function ctcScore(logProbs: number[][], tokens: number[]): number {
  if (!logProbs.length || !tokens.length) {
    return NEGATIVE_INFINITY;
  }

  const timeSteps = logProbs.length;
  const extendedTokens = buildExtendedTokens(tokens);
  const stateCount = extendedTokens.length;
  const previous = new Float64Array(stateCount).fill(NEGATIVE_INFINITY);
  const current = new Float64Array(stateCount).fill(NEGATIVE_INFINITY);

  previous[0] = logProbs[0]?.[blankTokenId] ?? NEGATIVE_INFINITY;
  if (stateCount > 1) {
    previous[1] = logProbs[0]?.[extendedTokens[1]] ?? NEGATIVE_INFINITY;
  }

  for (let timeIndex = 1; timeIndex < timeSteps; timeIndex += 1) {
    current.fill(NEGATIVE_INFINITY);

    const row = logProbs[timeIndex];
    const remainingTimeSteps = timeSteps - timeIndex;
    const startState = Math.max(0, stateCount - remainingTimeSteps * 2);
    const endState = Math.min(stateCount - 1, timeIndex * 2 + 1);

    for (let stateIndex = startState; stateIndex <= endState; stateIndex += 1) {
      const tokenId = extendedTokens[stateIndex];
      let total = previous[stateIndex];

      if (stateIndex > 0) {
        total = logAddExp(total, previous[stateIndex - 1] ?? NEGATIVE_INFINITY);
      }

      if (
        stateIndex > 1 &&
        tokenId !== blankTokenId &&
        tokenId !== extendedTokens[stateIndex - 2]
      ) {
        total = logAddExp(total, previous[stateIndex - 2] ?? NEGATIVE_INFINITY);
      }

      if (total !== NEGATIVE_INFINITY) {
        current[stateIndex] = total + (row?.[tokenId] ?? NEGATIVE_INFINITY);
      }
    }

    previous.set(current);
  }

  const finalLogProb = logAddExp(
    previous[stateCount - 1] ?? NEGATIVE_INFINITY,
    previous[stateCount - 2] ?? NEGATIVE_INFINITY,
  );

  if (!Number.isFinite(finalLogProb)) {
    return NEGATIVE_INFINITY;
  }

  return finalLogProb / tokens.length;
}
