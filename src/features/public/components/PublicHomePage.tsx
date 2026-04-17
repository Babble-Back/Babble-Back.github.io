import { useEffect, useState } from 'react';
import homeLogo from '../../../assets/backtalk-logo.png';
import { AuthPanel } from '../../auth/components/AuthPanel';
import { CampaignPanel } from '../../campaign/components/CampaignPanel';
import {
  type CampaignState,
  getActiveCampaignHome,
  loadPublicCampaignDemoBase,
  type ActiveCampaignHome,
  type PublicCampaignDemoBase,
} from '../../../lib/campaigns';
import {
  createPublicCampaignDemoState,
  createPublicCampaignDemoStateFromBase,
  persistPublicCampaignDemoState,
  resetPublicCampaignDemoState,
  resetPublicCampaignDemoStateFromBase,
} from '../campaignDemo';
import { supabaseConfigError } from '../../../lib/supabase';
import type { AuthMode } from '../../auth/components/AuthPanel';

type PublicHomeMode = 'auth' | 'home';

const HOME_STEPS = [
  {
    description: 'Hear a word played in reverse.',
    title: 'Listen',
  },
  {
    description: 'Repeat what you think you heard.',
    title: 'Say It Back',
  },
  {
    description: 'We score how close your answer was.',
    title: 'Get Your Score',
  },
] as const;

const PLAY_MODES = [
  {
    description:
      'Work through themed levels, practice easy to hard words, and improve your score.',
    title: 'Solo Campaign',
  },
  {
    description:
      'Challenge friends, send attempts back and forth, and see who can match the words best.',
    title: 'Play With Friends',
  },
] as const;

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
  const [demoBase, setDemoBase] = useState<PublicCampaignDemoBase | null>(null);
  const [demoCampaignState, setDemoCampaignState] = useState<CampaignState | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
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
          setDemoBase(null);
          setCampaignHome(fallbackHome);
          setDemoCampaignState(createPublicCampaignDemoState(fallbackHome));
        }

        return;
      }

      try {
        const nextDemoBase = await loadPublicCampaignDemoBase();

        if (nextDemoBase?.challenges.length) {
          const nextCampaignHome: ActiveCampaignHome = {
            bannerImage: nextDemoBase.assets.banner_image ?? null,
            campaignId: nextDemoBase.campaign.id ?? null,
            challengeIcon: nextDemoBase.assets.challenge_icon ?? null,
            subtitle: nextDemoBase.assets.subtitle ?? null,
            title: nextDemoBase.assets.title ?? nextDemoBase.campaign.name ?? 'Current Campaign',
          };

          if (!cancelled) {
            setDemoBase(nextDemoBase);
            setCampaignHome(nextCampaignHome);
            setDemoCampaignState(createPublicCampaignDemoStateFromBase(nextDemoBase));
          }

          return;
        }

        const nextCampaignHome = await getActiveCampaignHome();

        if (!cancelled) {
          setDemoBase(null);
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
          setDemoBase(null);
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
    const nextState = demoBase
      ? resetPublicCampaignDemoStateFromBase(demoBase)
      : resetPublicCampaignDemoState(campaignHome);
    setDemoCampaignState(nextState);
  };

  const handleOpenAuth = (nextMode: AuthMode) => {
    setAuthMode(nextMode);
    onOpenAuth();
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

        <AuthPanel initialMode={authMode} />
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
            onClick={() => {
              handleOpenAuth('login');
            }}
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
      <div className="section-header compact-header public-home-header public-home-hero">
        <div>
          <img alt="BabbleBack" className="auth-brand-logo public-home-logo" src={homeLogo} />
          <h1 className="public-home-headline">Reverse it. Say it back.</h1>
          <p>
            A voice game where you listen to reversed words, copy what you hear, and see how
            close you get. Play by yourself or challenge your friends.
          </p>
        </div>

        <div className="button-row public-home-hero-actions">
          <button
            className="button primary"
            onClick={() => {
              handleOpenAuth('login');
            }}
            type="button"
          >
            Play Now
          </button>
          <button
            className="button secondary"
            onClick={() => {
              handleOpenAuth('register');
            }}
            type="button"
          >
            Sign Up
          </button>
        </div>
      </div>

      <section className="stack public-home-section">
        <div className="section-header compact-header">
          <div>
            <h2>How It Works</h2>
          </div>
        </div>

        <div className="public-home-steps">
          {HOME_STEPS.map((step, index) => (
            <article className="step-card public-home-step-card" key={step.title}>
              <span className="step-number">{index + 1}</span>
              <div>
                <h4>{step.title}</h4>
                <p>{step.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="stack public-home-section">
        <div className="section-header compact-header">
          <div>
            <h2>Play Your Way</h2>
          </div>
        </div>

        <div className="public-home-card-grid">
          {PLAY_MODES.map((modeCard) => (
            <article className="list-card public-home-play-card" key={modeCard.title}>
              <div>
                <h3>{modeCard.title}</h3>
                <p>{modeCard.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="stack public-home-section">
        <div className="section-header compact-header">
          <div>
            <h2>Current Campaign</h2>
            <p>Try the first 5 levels for free in our current themed campaign.</p>
          </div>
        </div>

        <div className="section-header compact-header public-home-demo-header">
          <div>
            <h3>Try a Quick Demo</h3>
            <p>
              Preview the first 5 campaign levels with a simple sample of the single-player
              experience.
            </p>
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
            <div
              aria-hidden="true"
              className="campaign-home-banner-image public-home-banner-fallback"
            />
          )}
          <span aria-hidden="true" className="campaign-home-banner-play-button">
            <span>Play Demo</span>
          </span>
        </button>
      </section>

      <div className="home-footer public-home-footer">
        <p className="public-home-about">
          BabbleBack is a fun voice game where reversed audio, speech, and scoring come together
          for solo play and friendly competition.
        </p>
      </div>
    </section>
  );
}
