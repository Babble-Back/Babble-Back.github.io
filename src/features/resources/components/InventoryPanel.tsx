import { useEffect, useMemo, useState } from 'react';
import {
  listCampaignCatalog,
  type CampaignCatalogEntry,
} from '../../../lib/campaigns';
import { RESOURCE_TYPES } from '../../../lib/resourceTypes';
import { WaveformLoader } from '../../../components/WaveformLoader';
import { useResourceWallet } from '../ResourceProvider';

interface InventoryPanelProps {
  onBack: () => void;
}

interface InventoryCurrencyCard {
  resourceType: string;
  name: string;
  iconUrl: string | null;
  amount: number;
  isPrimary?: boolean;
}

function buildCampaignCurrencyCards(
  catalog: CampaignCatalogEntry[],
  balances: Partial<Record<string, number>>,
): InventoryCurrencyCard[] {
  const cardsByResourceType = new Map<string, InventoryCurrencyCard>();

  for (const entry of catalog) {
    const currency = entry.currency;

    if (!currency || cardsByResourceType.has(currency.resourceType)) {
      continue;
    }

    cardsByResourceType.set(currency.resourceType, {
      resourceType: currency.resourceType,
      name: currency.pluralName,
      iconUrl: entry.assets.challenge_icon ?? null,
      amount: balances[currency.resourceType] ?? 0,
    });
  }

  return Array.from(cardsByResourceType.values());
}

export function InventoryPanel({ onBack }: InventoryPanelProps) {
  const {
    isLoadingResources,
    refreshResources,
    resourceBalances,
  } = useResourceWallet();
  const [campaignCatalog, setCampaignCatalog] = useState<CampaignCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadInventoryContext = async () => {
      try {
        const [nextCatalog] = await Promise.all([
          listCampaignCatalog(),
          refreshResources(),
        ]);

        if (!cancelled) {
          setCampaignCatalog(nextCatalog);
        }
      } catch (error) {
        if (!cancelled) {
          setCatalogError(
            error instanceof Error ? error.message : 'Unable to load your inventory.',
          );
        }
      }
    };

    void loadInventoryContext();

    return () => {
      cancelled = true;
    };
  }, [refreshResources]);

  const currencyCards = useMemo<InventoryCurrencyCard[]>(() => {
    const cards: InventoryCurrencyCard[] = [
      {
        resourceType: RESOURCE_TYPES.BB_COIN,
        name: 'BB Coins',
        iconUrl: `${import.meta.env.BASE_URL}bbcoin.png`,
        amount: resourceBalances[RESOURCE_TYPES.BB_COIN] ?? 0,
        isPrimary: true,
      },
      ...buildCampaignCurrencyCards(campaignCatalog, resourceBalances),
    ];

    return cards;
  }, [campaignCatalog, resourceBalances]);

  return (
    <section className="surface round-screen inventory-screen">
      <div className="round-screen-header">
        <button className="button ghost round-screen-back" onClick={onBack} type="button">
          Back
        </button>

        <div className="round-screen-copy">
          <div className="eyebrow">Inventory</div>
          <h2>Your currencies</h2>
          <p>BB Coins stay here alongside campaign currencies like eggs as more events are added.</p>
        </div>
      </div>

      <div className="round-screen-body">
        {isLoadingResources && !currencyCards.length ? (
          <div className="round-loader-callout" aria-live="polite" role="status">
            <WaveformLoader className="round-loader-callout-spinner" size={92} strokeWidth={3.6} />
            <div>
              <strong>Loading inventory...</strong>
            </div>
          </div>
        ) : (
          <div className="inventory-grid">
            {currencyCards.map((card) => (
              <article
                className={`inventory-card${card.isPrimary ? ' inventory-card-primary' : ''}`}
                key={card.resourceType}
              >
                <div className="inventory-card-header">
                  <span className="inventory-card-icon">
                    {card.iconUrl ? <img alt="" aria-hidden="true" src={card.iconUrl} /> : null}
                  </span>
                  <div>
                    <div className="eyebrow">{card.isPrimary ? 'Main Wallet' : 'Campaign Currency'}</div>
                    <h3>{card.name}</h3>
                  </div>
                </div>

                <strong className="inventory-card-amount">{card.amount.toLocaleString()}</strong>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="stack">
        {catalogError ? <div className="error-banner">{catalogError}</div> : null}
      </div>
    </section>
  );
}
