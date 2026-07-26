import { describe, expect, it } from 'vitest';
import {
  buildCriticalSummaryLedger,
  auditFindingLedger,
  buildFindingLedger,
  renderClosureReport,
} from '../../audit-findings.mjs';

describe('machine-readable finding evidence', () => {
  it('maps all 167 review findings exactly once with valid retained paths', () => {
    const report = auditFindingLedger();
    expect(report.errors).toEqual([]);
    expect(report.total).toBe(167);
    expect(report.criticalSummaryTotal).toBe(12);
    expect(new Set(report.records.map((record) => record.id)).size).toBe(167);
    expect(
      new Set(report.criticalSummaries.map((record) => record.id)).size,
    ).toBe(12);
  });

  it('does not permit release closure while findings or critical summaries await review', () => {
    const report = auditFindingLedger({ requireClosed: true });
    expect(report.ok).toBe(false);
    expect(report.counts.planned).toBe(0);
    expect(report.counts['rules/quant review']).toBe(4);
    expect(report.criticalSummaryCounts['rules/quant review']).toBe(12);
    expect(report.errors.some((error) => error.endsWith('not closed'))).toBe(true);
  });

  it('materializes complete records from the plan plus evidence overrides', () => {
    const play03 = buildFindingLedger().records.find(
      (record) => record.id === 'PLAY-03',
    );
    expect(play03).toMatchObject({
      status: 'evidence-green',
      workPackage: 'WP-14',
      tests: ['packages/engine/tests/bot/reactive-policy.test.ts'],
    });
    expect(buildCriticalSummaryLedger().records[0]).toMatchObject({
      id: 'C-01',
      status: 'rules/quant review',
      requiredPackages: ['WP-01', 'WP-02', 'WP-11', 'WP-17'],
    });
  });

  it('renders a complete human-readable closure report for approval', () => {
    const report = auditFindingLedger();
    const markdown = renderClosureReport(report);
    expect(markdown).toContain('# Simulation engine closure report');
    expect(markdown).toContain('| MATH-01 | evidence-green |');
    expect(markdown).toContain('| C-12 | rules/quant review |');
    expect(
      report.records.every((record) => markdown.includes(`| ${record.id} |`)),
    ).toBe(true);
  });
});
