import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function isStandaloneDisplayMode() {
  if (typeof window === 'undefined') {
    return false;
  }

  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  );
}

function isIosDevice() {
  if (typeof window === 'undefined') {
    return false;
  }

  const userAgent = window.navigator.userAgent;
  const platform = window.navigator.platform;

  return /iphone|ipad|ipod/i.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneDisplayMode());
  const [isIosManualInstall, setIsIosManualInstall] = useState(() => isIosDevice());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(display-mode: standalone)');

    const syncInstallState = () => {
      setIsInstalled(isStandaloneDisplayMode());
      setIsIosManualInstall(isIosDevice());
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      const installEvent = event as BeforeInstallPromptEvent;
      installEvent.preventDefault();
      setDeferredPrompt(installEvent);
      syncInstallState();
    };

    const handleInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    syncInstallState();
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncInstallState);
    } else {
      mediaQuery.addListener(syncInstallState);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);

      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', syncInstallState);
      } else {
        mediaQuery.removeListener(syncInstallState);
      }
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) {
      return 'unavailable' as const;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);

    return choice.outcome;
  };

  return {
    canPromptInstall: deferredPrompt !== null,
    isInstalled,
    isIosManualInstall: isIosManualInstall && !isStandaloneDisplayMode(),
    promptInstall,
  };
}
