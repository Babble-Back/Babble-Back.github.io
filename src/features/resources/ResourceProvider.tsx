import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getCoins, listResourceBalances } from './resourceApi';
import { RESOURCE_TYPES, type ResourceType } from './resourceTypes';

type ResourceBalanceMap = Partial<Record<ResourceType, number>>;

interface ResourceWalletContextValue {
  coins: number;
  displayedCoins: number;
  isLoadingCoins: boolean;
  isLoadingResources: boolean;
  resourceBalances: ResourceBalanceMap;
  refreshCoins: () => Promise<number>;
  refreshResources: () => Promise<ResourceBalanceMap>;
  getResourceBalance: (resourceType: ResourceType) => number;
  commitCoinDelta: (amount: number) => void;
  setCoinBalance: (amount: number) => void;
  setCoinPreview: (amount: number | null) => void;
  commitResourceDelta: (resourceType: ResourceType, amount: number) => void;
  setResourceBalance: (resourceType: ResourceType, amount: number) => void;
  setResourceBalances: (nextBalances: ResourceBalanceMap) => void;
}

const ResourceWalletContext = createContext<ResourceWalletContextValue | null>(null);

function clampAmount(amount: number) {
  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.max(0, Math.floor(amount));
}

function toBalanceMap(entries: Array<{ resourceType: ResourceType; amount: number }>) {
  return entries.reduce<ResourceBalanceMap>((balances, entry) => {
    balances[entry.resourceType] = clampAmount(entry.amount);
    return balances;
  }, {});
}

export function ResourceProvider({
  currentUserId,
  children,
}: {
  currentUserId: string | null;
  children: ReactNode;
}) {
  const [resourceBalances, setResourceBalancesState] = useState<ResourceBalanceMap>({});
  const [coinPreview, setCoinPreview] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!currentUserId) {
      setResourceBalancesState({});
      setCoinPreview(null);
      setIsLoading(false);
      return;
    }

    let isActive = true;

    const loadResources = async () => {
      setIsLoading(true);

      try {
        const nextBalances = toBalanceMap(await listResourceBalances(currentUserId));

        if (isActive) {
          setResourceBalancesState(nextBalances);
        }
      } catch (error) {
        if (isActive) {
          console.warn('Unable to load resource balances.', error);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadResources();

    return () => {
      isActive = false;
    };
  }, [currentUserId]);

  const getResourceBalance = useCallback(
    (resourceType: ResourceType) => clampAmount(resourceBalances[resourceType] ?? 0),
    [resourceBalances],
  );

  const refreshCoins = useCallback(async () => {
    if (!currentUserId) {
      setResourceBalancesState({});
      setCoinPreview(null);
      return 0;
    }

    const nextCoinCount = await getCoins(currentUserId);
    setResourceBalancesState((currentBalances) => ({
      ...currentBalances,
      [RESOURCE_TYPES.BB_COIN]: clampAmount(nextCoinCount),
    }));
    return clampAmount(nextCoinCount);
  }, [currentUserId]);

  const refreshResources = useCallback(async () => {
    if (!currentUserId) {
      setResourceBalancesState({});
      setCoinPreview(null);
      return {};
    }

    const nextBalances = toBalanceMap(await listResourceBalances(currentUserId));
    setResourceBalancesState(nextBalances);
    return nextBalances;
  }, [currentUserId]);

  const commitResourceDelta = useCallback((resourceType: ResourceType, amount: number) => {
    const safeAmount = clampAmount(amount);

    if (safeAmount === 0) {
      return;
    }

    setResourceBalancesState((currentBalances) => ({
      ...currentBalances,
      [resourceType]: clampAmount((currentBalances[resourceType] ?? 0) + safeAmount),
    }));
  }, []);

  const setResourceBalance = useCallback((resourceType: ResourceType, amount: number) => {
    setResourceBalancesState((currentBalances) => ({
      ...currentBalances,
      [resourceType]: clampAmount(amount),
    }));
  }, []);

  const mergeResourceBalances = useCallback((nextBalances: ResourceBalanceMap) => {
    setResourceBalancesState((currentBalances) => {
      const mergedBalances = { ...currentBalances };

      for (const [resourceType, amount] of Object.entries(nextBalances)) {
        mergedBalances[resourceType as ResourceType] = clampAmount(amount ?? 0);
      }

      return mergedBalances;
    });
  }, []);

  const commitCoinDelta = useCallback(
    (amount: number) => {
      commitResourceDelta(RESOURCE_TYPES.BB_COIN, amount);
    },
    [commitResourceDelta],
  );

  const setCoinBalance = useCallback(
    (amount: number) => {
      setResourceBalance(RESOURCE_TYPES.BB_COIN, amount);
    },
    [setResourceBalance],
  );

  const updateCoinPreview = useCallback((amount: number | null) => {
    setCoinPreview(amount === null ? null : clampAmount(amount));
  }, []);

  const coinCount = getResourceBalance(RESOURCE_TYPES.BB_COIN);

  const contextValue: ResourceWalletContextValue = useMemo(
    () => ({
      coins: coinCount,
      displayedCoins: coinPreview ?? coinCount,
      isLoadingCoins: isLoading,
      isLoadingResources: isLoading,
      resourceBalances,
      refreshCoins,
      refreshResources,
      getResourceBalance,
      commitCoinDelta,
      setCoinBalance,
      setCoinPreview: updateCoinPreview,
      commitResourceDelta,
      setResourceBalance,
      setResourceBalances: mergeResourceBalances,
    }),
    [
      coinCount,
      coinPreview,
      resourceBalances,
      isLoading,
      refreshCoins,
      refreshResources,
      getResourceBalance,
      commitCoinDelta,
      setCoinBalance,
      updateCoinPreview,
      commitResourceDelta,
      setResourceBalance,
      mergeResourceBalances,
    ],
  );

  return (
    <ResourceWalletContext.Provider value={contextValue}>
      {children}
    </ResourceWalletContext.Provider>
  );
}

export function useCoins() {
  const context = useContext(ResourceWalletContext);

  if (!context) {
    throw new Error('useCoins must be used inside a ResourceProvider.');
  }

  return context;
}

export function useResourceWallet() {
  return useCoins();
}

export function CoinDisplay({
  onClick,
}: {
  onClick?: () => void;
}) {
  const { displayedCoins, isLoadingCoins } = useCoins();
  const content = (
    <>
      <span className="coin-icon-anchor" data-coin-display-target="true">
        <img
          alt=""
          aria-hidden="true"
          className="coin-icon"
          src={`${import.meta.env.BASE_URL}bbcoin.png`}
        />
      </span>
      <strong className={`coin-display-value${isLoadingCoins ? ' is-loading' : ''}`}>
        {displayedCoins.toLocaleString()}
      </strong>
    </>
  );

  const ariaLabel = `BB Coins: ${displayedCoins.toLocaleString()}${
    onClick ? '. Open inventory.' : ''
  }`;

  if (onClick) {
    return (
      <button
        aria-label={ariaLabel}
        className="coin-display coin-display-button"
        data-coin-display="true"
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div aria-label={ariaLabel} className="coin-display" data-coin-display="true">
      {content}
    </div>
  );
}

export { RESOURCE_TYPES };
