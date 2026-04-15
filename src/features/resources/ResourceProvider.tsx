import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getCoins } from './resourceApi';
import { RESOURCE_TYPES } from './resourceTypes';

interface ResourceWalletContextValue {
  coins: number;
  displayedCoins: number;
  isLoadingCoins: boolean;
  refreshCoins: () => Promise<number>;
  commitCoinDelta: (amount: number) => void;
  setCoinBalance: (amount: number) => void;
  setCoinPreview: (amount: number | null) => void;
}

const ResourceWalletContext = createContext<ResourceWalletContextValue | null>(null);

function clampAmount(amount: number) {
  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.max(0, Math.floor(amount));
}

export function ResourceProvider({
  currentUserId,
  children,
}: {
  currentUserId: string | null;
  children: ReactNode;
}) {
  const [coinCount, setCoinCount] = useState(0);
  const [coinPreview, setCoinPreview] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!currentUserId) {
      setCoinCount(0);
      setCoinPreview(null);
      setIsLoading(false);
      return;
    }

    let isActive = true;

    const loadCoins = async () => {
      setIsLoading(true);

      try {
        const nextCoinCount = await getCoins(currentUserId);

        if (isActive) {
          setCoinCount(nextCoinCount);
        }
      } catch (error) {
        if (isActive) {
          console.warn('Unable to load BB Coins.', error);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadCoins();

    return () => {
      isActive = false;
    };
  }, [currentUserId]);

  const refreshCoins = useCallback(async () => {
    if (!currentUserId) {
      setCoinCount(0);
      setCoinPreview(null);
      return 0;
    }

    const nextCoinCount = await getCoins(currentUserId);
    setCoinCount(nextCoinCount);
    return nextCoinCount;
  }, [currentUserId]);

  const commitCoinDelta = useCallback((amount: number) => {
    const safeAmount = clampAmount(amount);

    if (safeAmount === 0) {
      return;
    }

    setCoinCount((currentAmount) => currentAmount + safeAmount);
  }, []);

  const setCoinBalance = useCallback((amount: number) => {
    setCoinCount(clampAmount(amount));
  }, []);

  const updateCoinPreview = useCallback((amount: number | null) => {
    setCoinPreview(amount === null ? null : clampAmount(amount));
  }, []);

  const contextValue: ResourceWalletContextValue = useMemo(() => ({
    coins: coinCount,
    displayedCoins: coinPreview ?? coinCount,
    isLoadingCoins: isLoading,
    refreshCoins,
    commitCoinDelta,
    setCoinBalance,
    setCoinPreview: updateCoinPreview,
  }), [coinCount, coinPreview, commitCoinDelta, isLoading, refreshCoins, setCoinBalance, updateCoinPreview]);

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

export function CoinDisplay() {
  const { displayedCoins, isLoadingCoins } = useCoins();

  return (
    <div
      className="coin-display"
      data-coin-display="true"
      aria-label={`BB Coins: ${displayedCoins.toLocaleString()}`}
    >
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
    </div>
  );
}

export { RESOURCE_TYPES };
