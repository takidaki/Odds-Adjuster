
export interface Team {
  id: string;
  name: string;
}

export interface Match {
  id: string;
  team1Id: string;
  team2Id: string;
  odds1: number;
  oddsX: number;
  odds2: number;
  totalLine?: number;
  overOdds?: number;
  underOdds?: number;
  lambda1?: number; // Expected goals for team 1
  lambda2?: number; // Expected goals for team 2
  locked?: boolean; // If true, odds are locked and not adjusted by alignment
  adjLambda1?: number; // Aligned expected goals for team 1
  adjLambda2?: number; // Aligned expected goals for team 2
  // Adjusted "Fair" odds (no vig) after iteration
  fair1?: number;
  fairX?: number;
  fair2?: number;
  // Final odds after margin application
  adj1?: number;
  adjX?: number;
  adj2?: number;
}

export interface Outright {
  teamId: string;
  odds: number;
  fairOdds?: number; // No-vig outright odds
}

/**
 * Converts decimal odds to fair probabilities using Shin's method.
 * Shin's method assumes the existence of informed traders and solves for a 
 * parameter 'z' representing the proportion of insider knowledge.
 */
export function oddsToProbs(o1: number, oX: number, o2: number): [number, number, number] {
  if (o1 <= 1 || oX <= 1 || o2 <= 1) return [1/3, 1/3, 1/3];
  
  const recips = [1/o1, 1/oX, 1/o2];
  const sumRecips = recips.reduce((a, b) => a + b, 0);
  
  if (Math.abs(sumRecips - 1.0) < 0.0001) return [recips[0], recips[1], recips[2]] as [number, number, number];

  // Solve for z using Newton's method or binary search
  // f(z) = sum( (sqrt(z^2 + 4(1-z)recip) - z) / 2(1-z) ) - 1 = 0
  let z = 0;
  let lower = 0;
  let upper = 1;
  const iterations = 40;

  for (let i = 0; i < iterations; i++) {
    z = (lower + upper) / 2;
    let sumP = 0;
    for (const r of recips) {
      const p = (Math.sqrt(z * z + 4 * (1 - z) * r) - z) / (2 * (1 - z));
      sumP += p;
    }
    
    if (sumP > 1) {
      lower = z;
    } else {
      upper = z;
    }
  }

  const finalProbs = recips.map(r => (Math.sqrt(z * z + 4 * (1 - z) * r) - z) / (2 * (1 - z)));
  return [finalProbs[0], finalProbs[1], finalProbs[2]] as [number, number, number];
}

/**
 * Converts probability back to decimal odds, optionally applying a margin.
 * Margin of 0.05 = 5% overround.
 */
export function probsToOdds(p1: number, pX: number, p2: number, margin: number = 0): [number, number, number] {
  const factor = 1 + margin;
  return [1 / (p1 * factor), 1 / (pX * factor), 1 / (p2 * factor)];
}

/**
 * Calculates the probability of a specific scoreline (x, y) given lambdas (expected goals).
 */
export function poissonProb(k: number, lambda: number): number {
  if (lambda === 0) return k === 0 ? 1 : 0;
  // factorial(k) can be large, but k is usually small (0-10)
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/**
 * Derives 1X2 probabilities from team lambdas using Poisson distribution.
 */
export function lambdasToProbs(l1: number, l2: number, maxGoals: number = 10): [number, number, number] {
  let p1 = 0;
  let pX = 0;
  let p2 = 0;

  for (let i = 0; i <= maxGoals; i++) {
    const prob1 = poissonProb(i, l1);
    for (let j = 0; j <= maxGoals; j++) {
      const prob2 = poissonProb(j, l2);
      const prob = prob1 * prob2;
      if (i > j) p1 += prob;
      else if (i === j) pX += prob;
      else p2 += prob;
    }
  }

  // Normalize to 1.0 (handling truncated tail)
  const sum = p1 + pX + p2;
  if (sum === 0) return [1/3, 1/3, 1/3];
  return [p1 / sum, pX / sum, p2 / sum];
}

/**
 * Calculates the probability of Total Goals > line given total lambda.
 */
export function totalProb(totalLambda: number, line: number): number {
  let pUnder = 0;
  const floorLine = Math.floor(line);
  for (let k = 0; k <= floorLine; k++) {
    pUnder += poissonProb(k, totalLambda);
  }
  return 1 - pUnder; // P(Over)
}

/**
 * Numerically solves for the total lambda that matches a target Over probability.
 */
export function solveForTotalLambda(line: number, targetOverProb: number): number {
  let low = 0;
  let high = 15;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (totalProb(mid, line) < targetOverProb) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

/**
 * Estimates team lambdas (l1, l2) that best match both 1X2 and Total Goals markets.
 */
export function estimateLambdas(o1: number, oX: number, o2: number, line: number, overOdds: number, underOdds: number): [number, number] {
  // 1. Get fair 1X2 probabilities
  const [p1, pX, p2] = oddsToProbs(o1, oX, o2);

  // 2. Get fair Over probability
  const pOver = 1 / overOdds / (1 / overOdds + 1 / underOdds);

  // 3. Solve for total lambda
  const totalLambda = solveForTotalLambda(line, pOver);

  // 4. Find the ratio l1/l2 that best matches p1/p2
  // For Poisson, p1/p2 is roughly related to l1/l2.
  // We can refine this by searching for the split.
  let bestL1 = totalLambda / 2;
  let bestL2 = totalLambda / 2;
  let minDiff = Infinity;

  // Search for the split ratio
  for (let i = 0; i <= 100; i++) {
    const ratio = i / 100;
    const l1 = totalLambda * ratio;
    const l2 = totalLambda * (1 - ratio);
    const [tp1, tpX, tp2] = lambdasToProbs(l1, l2);
    
    // We want to match the 1/X/2 distribution
    const diff = Math.pow(tp1 - p1, 2) + Math.pow(tpX - pX, 2) + Math.pow(tp2 - p2, 2);
    if (diff < minDiff) {
      minDiff = diff;
      bestL1 = l1;
      bestL2 = l2;
    }
  }

  return [bestL1, bestL2];
}

/**
 * Calculates outright win probabilities for a 4-team round-robin.
 * Assumes 6 matches where every team plays every other team once.
 */
export function calculateOutrights(teams: Team[], matches: Match[], multipliers: Record<string, number>): Record<string, number> {
  const results: Record<string, number> = {};
  teams.forEach(t => results[t.id] = 0);

  // Normalize match probabilities with current multipliers
  const matchProbs = matches.map(m => {
    let baseProbs: [number, number, number];
    
    if (m.lambda1 !== undefined && m.lambda2 !== undefined && m.lambda1 >= 0 && m.lambda2 >= 0) {
      baseProbs = lambdasToProbs(m.lambda1, m.lambda2);
    } else {
      baseProbs = oddsToProbs(m.odds1, m.oddsX, m.odds2);
    }

    const [p1, pX, p2] = baseProbs;

    if (m.locked) {
      return [p1, pX, p2];
    }

    // Apply multipliers: Strength of team 1 vs team 2
    // We adjust win/loss relative to draw.
    const m1 = multipliers[m.team1Id] || 1;
    const m2 = multipliers[m.team2Id] || 1;

    let w1 = p1 * m1;
    let w2 = p2 * m2;
    let wX = pX; // Draw probability stays relatively stable but gets normalized

    const total = w1 + wX + w2;
    return [w1 / total, wX / total, w2 / total];
  });

  // There are 3^6 = 729 combinations
  // We can iterate them systematically.
  const outcomes = [0, 1, 2]; // 0: Win1, 1: Draw, 2: Win2

  // For N matches, we loop through all 3^N scenarios
  const numMatches = matches.length;
  const numScenarios = Math.pow(3, numMatches);

  for (let i = 0; i < numScenarios; i++) {
    let scenarioProb = 1;
    const points: Record<string, number> = {};
    teams.forEach(t => points[t.id] = 0);

    let temp = i;
    for (let mIdx = 0; mIdx < numMatches; mIdx++) {
      const outcome = temp % 3;
      temp = Math.floor(temp / 3);

      const m = matches[mIdx];
      const probs = matchProbs[mIdx];
      scenarioProb *= probs[outcome];

      if (outcome === 0) {
        points[m.team1Id] += 3;
      } else if (outcome === 1) {
        points[m.team1Id] += 1;
        points[m.team2Id] += 1;
      } else {
        points[m.team2Id] += 3;
      }
    }

    // Determine winner(s) of this scenario
    let maxPoints = -1;
    let winners: string[] = [];
    for (const tid in points) {
      if (points[tid] > maxPoints) {
        maxPoints = points[tid];
        winners = [tid];
      } else if (points[tid] === maxPoints) {
        winners.push(tid);
      }
    }

    // Distribute scenario probability among winners
    const share = scenarioProb / winners.length;
    winners.forEach(tid => {
      results[tid] += share;
    });
  }

  return results;
}

/**
 * The main alignment loop.
 * Nudges multipliers until calculated outrights match target outrights.
 */
export function alignOdds(teams: Team[], matches: Match[], outrights: Outright[], margin: number = 0): { results: Match[], multipliers: Record<string, number> } {
  const multipliers: Record<string, number> = {};
  teams.forEach(t => multipliers[t.id] = 1);

  // Target probabilities (implied from outright odds)
  const targetProbs: Record<string, number> = {};
  let totalTargetP = 0;
  outrights.forEach(o => {
    const p = 1 / o.odds;
    targetProbs[o.teamId] = p;
    totalTargetP += p;
  });
  // Normalize targets so they sum to 1
  for (const tid in targetProbs) {
    targetProbs[tid] /= totalTargetP;
  }

  const iterations = 50;
  const learningRate = 0.5;

  for (let step = 0; step < iterations; step++) {
    const currentProbs = calculateOutrights(teams, matches, multipliers);

    // Adjust multipliers
    let maxDiff = 0;
    for (const tid in targetProbs) {
      const target = targetProbs[tid];
      const actual = currentProbs[tid];
      const diff = Math.abs(target - actual);
      if (diff > maxDiff) maxDiff = diff;

      // If actual is too low, increase multiplier
      // We use ratio-based adjustment
      const ratio = target / actual;
      multipliers[tid] *= Math.pow(ratio, learningRate);
    }

    if (maxDiff < 0.0001) break;
  }

  // Calculate final adjusted odds for each match
  const results = matches.map(m => {
    let baseProbs: [number, number, number];
    
    if (m.lambda1 !== undefined && m.lambda2 !== undefined && m.lambda1 >= 0 && m.lambda2 >= 0) {
      baseProbs = lambdasToProbs(m.lambda1, m.lambda2);
    } else {
      baseProbs = oddsToProbs(m.odds1, m.oddsX, m.odds2);
    }

    const [p1, pX, p2] = baseProbs;
    
    if (m.locked) {
      return {
        ...m,
        fair1: Number((1/p1).toFixed(3)),
        fairX: Number((1/pX).toFixed(3)),
        fair2: Number((1/p2).toFixed(3)),
        adj1: Number(m.odds1.toFixed(3)),
        adjX: Number(m.oddsX.toFixed(3)),
        adj2: Number(m.odds2.toFixed(3)),
      };
    }

    const m1 = multipliers[m.team1Id] || 1;
    const m2 = multipliers[m.team2Id] || 1;

    const w1 = p1 * m1;
    const w2 = p2 * m2;
    const wX = pX;
    const total = w1 + wX + w2;

    const [f1, fX, f2] = probsToOdds(w1 / total, wX / total, w2 / total, 0);
    const [a1, aX, a2] = probsToOdds(w1 / total, wX / total, w2 / total, margin);

    return {
      ...m,
      adjLambda1: m.lambda1 !== undefined ? Number((m.lambda1 * m1).toFixed(2)) : undefined,
      adjLambda2: m.lambda2 !== undefined ? Number((m.lambda2 * m2).toFixed(2)) : undefined,
      fair1: Number(f1.toFixed(3)),
      fairX: Number(fX.toFixed(3)),
      fair2: Number(f2.toFixed(3)),
      adj1: Number(a1.toFixed(3)),
      adjX: Number(aX.toFixed(3)),
      adj2: Number(a2.toFixed(3)),
    };
  });

  return { results, multipliers };
}
