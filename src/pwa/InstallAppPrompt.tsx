import { useEffect, useState } from 'react';
import { useInstallPrompt } from './useInstallPrompt';

export function InstallAppPrompt() {
  const { canPromptInstall, isInstalled, isIosManualInstall, promptInstall } = useInstallPrompt();
  const [isDismissed, setIsDismissed] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (canPromptInstall || isIosManualInstall) {
      setIsDismissed(false);
    }
  }, [canPromptInstall, isIosManualInstall]);

  if (isInstalled || isDismissed || (!canPromptInstall && !isIosManualInstall)) {
    return null;
  }

  const handleInstall = async () => {
    setIsInstalling(true);
    setStatusMessage(null);

    try {
      const outcome = await promptInstall();

      if (outcome === 'accepted') {
        setStatusMessage('Install accepted. The app will finish installing shortly.');
      } else if (outcome === 'dismissed') {
        setStatusMessage('Install dismissed. You can reopen this prompt any time it becomes available again.');
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to open the install prompt.',
      );
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <section className="surface install-card" aria-live="polite">
      <div className="install-card-copy">
        <div className="eyebrow">App Install</div>
        <h2>Put BabbleBack on your home screen</h2>
        <p>
          {canPromptInstall
            ? 'Install the app for a full-screen launch, faster repeat visits, and a more native mobile feel.'
            : 'On iPhone or iPad, open Safari Share and choose Add to Home Screen to install the standalone app.'}
        </p>
        {isIosManualInstall ? (
          <p className="install-card-tip">Safari -&gt; Share -&gt; Add to Home Screen</p>
        ) : null}
        {statusMessage ? <p className="install-card-status">{statusMessage}</p> : null}
      </div>

      <div className="button-row install-card-actions">
        {canPromptInstall ? (
          <button
            className="button primary"
            disabled={isInstalling}
            onClick={() => {
              void handleInstall();
            }}
            type="button"
          >
            {isInstalling ? 'Opening install prompt...' : 'Install App'}
          </button>
        ) : null}
        <button
          className="button ghost"
          onClick={() => setIsDismissed(true)}
          type="button"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
