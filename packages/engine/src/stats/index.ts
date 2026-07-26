/**
 * Statistics core — pure, deterministic, dependency-free building blocks for
 * quantifying uncertainty in balance reads. ADDITIVE: nothing here touches the
 * hashed simulation path; these are consumed only by reporting/summary code.
 */
export { wilsonInterval } from './wilson.js';
export type { WilsonResult } from './wilson.js';

export { studentTInterval, tCritical } from './tinterval.js';
export type { TIntervalResult, ConfidenceLevel } from './tinterval.js';

export { bootstrapCI, mulberry32 } from './bootstrap.js';
export type { BootstrapResult } from './bootstrap.js';

export { binomTest, twoProportionZ } from './binomTest.js';
export type { BinomTestResult, TwoPropResult } from './binomTest.js';

export { gTestUniform, chiSquareUniform } from './gtest.js';
export type { GoodnessOfFitResult } from './gtest.js';

export {
  normalCdf,
  normalSurvival,
  normalLogSurvival,
  normalTwoSidedP,
  chiSquareUpperP,
  lnGamma,
} from './normal.js';

export { pearson, spearman } from './correlation.js';
export type { CorrelationResult } from './correlation.js';
