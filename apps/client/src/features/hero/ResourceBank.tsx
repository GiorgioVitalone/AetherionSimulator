/**
 * ResourceBank — displays resource cards (mana/energy) with exhausted state.
 * Shows a summary like "3/5 Mana, 2/3 Energy" plus temporary resource indicators.
 */
import type { ReactNode } from 'react';
import type { ResourceCard, TemporaryResource } from '@aetherion-sim/engine';
import { Tooltip } from '@/features/shared/Tooltip';

interface ResourceBankProps {
  readonly resources: readonly ResourceCard[];
  readonly temporaryResources?: readonly TemporaryResource[];
}

export function ResourceBank({ resources, temporaryResources }: ResourceBankProps): ReactNode {
  const manaTotal = resources.filter((r) => r.resourceType === 'mana').length;
  const manaReady = resources.filter((r) => r.resourceType === 'mana' && !r.exhausted).length;
  const energyTotal = resources.filter((r) => r.resourceType === 'energy').length;
  const energyReady = resources.filter((r) => r.resourceType === 'energy' && !r.exhausted).length;

  const tempMana = temporaryResources
    ?.filter((t) => t.resourceType === 'mana')
    .reduce((sum, t) => sum + t.amount, 0) ?? 0;
  const tempEnergy = temporaryResources
    ?.filter((t) => t.resourceType === 'energy')
    .reduce((sum, t) => sum + t.amount, 0) ?? 0;

  const showMana = manaTotal > 0 || tempMana > 0;
  const showEnergy = energyTotal > 0 || tempEnergy > 0;

  return (
    <div className="flex items-center gap-3">
      {showMana && (
        <Tooltip content={`${manaReady} available of ${manaTotal} total Mana${tempMana > 0 ? ` (+${tempMana} temp)` : ''}`}>
          <div className="flex items-center gap-1.5">
            {manaTotal > 0 && (
              <div className="flex gap-0.5">
                {resources
                  .filter((r) => r.resourceType === 'mana')
                  .map((r) => (
                    <div
                      key={r.instanceId}
                      className="w-3 h-4 rounded-sm border"
                      style={{
                        backgroundColor: r.exhausted ? 'var(--color-surface-alt)' : 'rgba(90,154,207,0.3)',
                        borderColor: r.exhausted ? 'var(--color-border)' : 'rgba(90,154,207,0.5)',
                        opacity: r.exhausted ? 0.5 : 1,
                      }}
                    />
                  ))}
              </div>
            )}
            <span className="font-mono text-[10px] font-medium" style={{ color: '#5a9acf' }}>
              {manaTotal > 0 ? `${manaReady}/${manaTotal}` : ''}
            </span>
            {tempMana > 0 && (
              <span className="font-mono text-[10px] font-medium" style={{ color: '#5a9acf' }}>
                +{tempMana} temp
              </span>
            )}
          </div>
        </Tooltip>
      )}

      {showEnergy && (
        <Tooltip content={`${energyReady} available of ${energyTotal} total Energy${tempEnergy > 0 ? ` (+${tempEnergy} temp)` : ''}`}>
          <div className="flex items-center gap-1.5">
            {energyTotal > 0 && (
              <div className="flex gap-0.5">
                {resources
                  .filter((r) => r.resourceType === 'energy')
                  .map((r) => (
                    <div
                      key={r.instanceId}
                      className="w-3 h-4 rounded-sm border"
                      style={{
                        backgroundColor: r.exhausted ? 'var(--color-surface-alt)' : 'rgba(213,173,82,0.3)',
                        borderColor: r.exhausted ? 'var(--color-border)' : 'rgba(213,173,82,0.5)',
                        opacity: r.exhausted ? 0.5 : 1,
                      }}
                    />
                  ))}
              </div>
            )}
            <span className="font-mono text-[10px] font-medium" style={{ color: '#d5ad52' }}>
              {energyTotal > 0 ? `${energyReady}/${energyTotal}` : ''}
            </span>
            {tempEnergy > 0 && (
              <span className="font-mono text-[10px] font-medium" style={{ color: '#d5ad52' }}>
                +{tempEnergy} temp
              </span>
            )}
          </div>
        </Tooltip>
      )}

      {!showMana && !showEnergy && (
        <span className="text-[10px] text-[var(--color-text-faint)] font-body">No resources</span>
      )}
    </div>
  );
}
