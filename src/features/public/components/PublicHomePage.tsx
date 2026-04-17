import { useEffect, useState } from 'react';
import homeLogo from '../../../assets/backtalk-logo.png';
import { AuthPanel } from '../../auth/components/AuthPanel';
import { CampaignPanel } from '../../campaign/components/CampaignPanel';
import { type CampaignState, getActiveCampaignHome, type ActiveCampaignHome } from '../../../lib/campaigns';
import {
  createPublicCampaignDemoState,
  persistPublicCampaignDemoState,
  resetPublicCampaignDemoState,
} from '../campaignDemo';
import { supabaseConfigError } from '../../../lib/supabase';

type PublicHomeMode = 'auth' | 'home';

interface PublicHomePageProps {
  mode: PublicHomeMode;
  onOpenAuth: () => void;
  onOpenHome: () => void;
}

function updateBannerImageStyle(imageUrl: string | null) {
  return imageUrl ? { backgroundImage: `url("${imageUrl}")` } : undefined;
}

export function PublicHomePage({
  mode,
  onOpenAuth,
  onOpenHome,
}: PublicHomePageProps) {
  const [campaignHome, setCampaignHome] = useState<ActiveCampaignHome | null>(null);
  const [demoCampaignState, setDemoCampaignState] = useState<CampaignState | null>(null);
  const [isDemoOpen, setIsDemoOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadCampaignHome = async () => {
      if (supabaseConfigError) {
        const fallbackHome: ActiveCampaignHome = {
          bannerImage: null,
          campaignId: null,
          challengeIcon: null,
          subtitle: null,
          title: 'Current Campaign',
        };

        if (!cancelled) {
          setCampaignHome(fallbackHome);
          setDemoCampaignState(createPublicCampaignDemoState(fallbackHome));
        }

        return;
      }

      try {
        const nextCampaignHome = await getActiveCampaignHome();

        if (!cancelled) {
          setCampaignHome(nextCampaignHome);
          setDemoCampaignState(createPublicCampaignDemoState(nextCampaignHome));
        }
      } catch {
        const fallbackHome: ActiveCampaignHome = {
          bannerImage: null,
          campaignId: null,
          challengeIcon: null,
          subtitle: null,
          title: 'Current Campaign',
        };

        if (!cancelled) {
          setCampaignHome(fallbackHome);
          setDemoCampaignState(createPublicCampaignDemoState(fallbackHome));
        }
      }
    };

    void loadCampaignHome();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode === 'auth') {
      setIsDemoOpen(false);
    }
  }, [mode]);

  const handleDemoStateChange = (nextState: CampaignState) => {
    persistPublicCampaignDemoState(nextState);
    setDemoCampaignState(nextState);
  };

  const handleResetDemo = () => {
    const nextState = resetPublicCampaignDemoState(campaignHome);
    setDemoCampaignState(nextState);
  };

  if (mode === 'auth') {
    return (
      <div className="stack public-home-shell">
        <div className="button-row public-home-top-actions">
          <button
            className="button ghost"
            onClick={onOpenHome}
            type="button"
          >
            Back
          </button>
        </div>

        <AuthPanel />
      </div>
    );
  }

  if (isDemoOpen && demoCampaignState) {
    return (
      <div className="stack public-home-shell">
        <div className="button-row public-home-top-actions">
          <button
            className="button ghost"
            onClick={() => {
              setIsDemoOpen(false);
            }}
            type="button"
          >
            Back
          </button>
          <button
            className="button secondary"
            onClick={handleResetDemo}
            type="button"
          >
            Restart Demo
          </button>
          <button
            className="button primary"
            onClick={onOpenAuth}
            type="button"
          >
            Play Now
          </button>
        </div>

        <CampaignPanel
          demoState={demoCampaignState}
          hideLeaderboard
          mode="demo"
          onDemoStateChange={handleDemoStateChange}
        />
      </div>
    );
  }

  return (
    <section className="surface home-shell public-home-panel">
      <div className="section-header compact-header public-home-header">
        <div>
          <img alt="BabbleBack" className="auth-brand-logo public-home-logo" src={homeLogo} />
          <h2>Reverse it. Say it back.</h2>
          <p>Try the first 5 campaign levels, or jump in for real.</p>
        </div>
      </div>

      <button
        className="campaign-home-banner public-home-banner-button"
        disabled={!demoCampaignState}
        onClick={() => {
          setIsDemoOpen(true);
        }}
        type="button"
      >
        {campaignHome?.bannerImage ? (
          <div
            aria-hidden="true"
            className="campaign-home-banner-image"
            style={updateBannerImageStyle(campaignHome.bannerImage)}
          />
        ) : (
          <div aria-hidden="true" className="campaign-home-banner-image public-home-banner-fallback" />
        )}
        <span aria-hidden="true" className="campaign-home-banner-play-button">
          <span>Try Now</span>
        </span>
      </button>

      <div className="empty-state home-empty public-home-note">
        <h3>{campaignHome?.title ?? 'Current Campaign'}</h3>
        <p>{campaignHome?.subtitle ?? 'Try the first 5 levels for free.'}</p>
      </div>

      <div className="home-footer public-home-footer">
        <div className="button-row">
          <button
            className="button primary"
            onClick={onOpenAuth}
            type="button"
          >
            Play Now
          </button>
        </div>
      </div>
    </section>
  );
}
