import { useEffect, useRef, useState } from 'react';
import homeLogo from '../../../assets/backtalk-logo.png';
import { StarRating } from '../../../components/StarRating';
import { AuthPanel, type AuthMode } from '../../auth/components/AuthPanel';
import { getActiveCampaignHome } from '../../../lib/campaigns';
import { supabaseConfigError } from '../../../lib/supabase';

const PUBLIC_DEMO_WORDS = ['egg', 'nest', 'lamb', 'chick', 'bloom'] as const;
const PUBLIC_DEMO_SCORE = 2.7;

function scrollToSection(target: HTMLElement | null) {
  if (!target || typeof window === 'undefined') {
    return;
  }

  target.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
}

function DemoStep({
  description,
  index,
  state,
  title,
}: {
  description: string;
  index: number;
  state: 'active' | 'done';
  title: string;
}) {
  return (
    <article className={`step-card ${state}`}>
      <span className="step-number">{index}</span>
      <div>
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
    </article>
  );
}

export function PublicHomePage() {
  const [campaignBannerImage, setCampaignBannerImage] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authPanelKey, setAuthPanelKey] = useState(0);
  const demoSectionRef = useRef<HTMLElement | null>(null);
  const authSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (supabaseConfigError) {
      return;
    }

    let cancelled = false;

    const loadCampaignBanner = async () => {
      try {
        const campaignHome = await getActiveCampaignHome();

        if (!cancelled) {
          setCampaignBannerImage(campaignHome.bannerImage);
        }
      } catch {
        if (!cancelled) {
          setCampaignBannerImage(null);
        }
      }
    };

    void loadCampaignBanner();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenAuth = (nextMode: AuthMode) => {
    setAuthMode(nextMode);
    setAuthPanelKey((currentValue) => currentValue + 1);

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        scrollToSection(authSectionRef.current);
      });
    }
  };

  return (
    <div className="stack public-home-shell">
      <section className="surface public-home-hero">
        <div className="public-home-brand">
          <img alt="BabbleBack" className="public-home-logo" src={homeLogo} />
          <span className="eyebrow">Reverse. Repeat. Laugh.</span>
        </div>

        <div className="public-home-hero-grid">
          <div className="public-home-copy">
            <h1>Hear it backwards. Say it back. See how close you got.</h1>
            <p>
              BabbleBack is a playful voice game: listen to reversed words, imitate the sound,
              reverse your attempt back, and see how close you were.
            </p>

            <div className="button-row hero-actions public-home-actions">
              <button
                className="button primary"
                onClick={() => {
                  handleOpenAuth('login');
                }}
                type="button"
              >
                Log In
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
              <button
                className="button ghost"
                onClick={() => {
                  scrollToSection(demoSectionRef.current);
                }}
                type="button"
              >
                See Demo
              </button>
            </div>
          </div>

          <div className="public-home-side">
            <div className="meta-chip">
              <strong>Private by default</strong>
              <span>Real games stay between you and your friends.</span>
            </div>
            <div className="meta-chip">
              <strong>Fast party-game loop</strong>
              <span>Listen, imitate, reverse it back, then chase the stars.</span>
            </div>
            <div className="meta-chip">
              <strong>Mobile friendly</strong>
              <span>Built for quick rounds, goofy takes, and instant rematches.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="surface public-home-campaign">
        <div className="section-header compact-header">
          <div>
            <div className="eyebrow">Current Campaign</div>
            <h2>Easter Campaign</h2>
            <p>Jump into the live seasonal set, or preview a five-word public demo first.</p>
          </div>
        </div>

        <div className="campaign-banner-card public-home-banner-card">
          {campaignBannerImage ? (
            <img
              alt="Current BabbleBack campaign banner"
              className="campaign-banner-image"
              src={campaignBannerImage}
            />
          ) : (
            <div aria-hidden="true" className="campaign-banner-fallback public-home-banner-fallback" />
          )}

          <div className="public-home-banner-overlay">
            <span className="badge primary">Seasonal Event</span>
            <strong>Easter Campaign</strong>
            <span>100 challenges, egg rewards, and a fresh road to clear.</span>
          </div>
        </div>
      </section>

      <section className="surface public-demo-shell" ref={demoSectionRef}>
        <div className="section-header compact-header">
          <div>
            <div className="eyebrow">Public Demo</div>
            <h2>Try the single-player vibe</h2>
            <p>
              This is a lightweight public slice of campaign mode using the same style language as
              the app, with five fixed easy words from the current campaign.
            </p>
          </div>
        </div>

        <div className="public-demo-grid">
          <div className="public-demo-column">
            <div className="result-box campaign-phrase-card public-demo-word-focus">
              <span className="campaign-phrase-label">Demo word</span>
              <strong>{PUBLIC_DEMO_WORDS[0]}</strong>
              <p>Pick from the same five easy Easter words every time the homepage loads.</p>
            </div>

            <div className="phrase-chip-row public-demo-chip-row" role="list">
              {PUBLIC_DEMO_WORDS.map((word, index) => (
                <span
                  className={`phrase-chip ${index === 0 ? 'selected' : ''}`}
                  key={word}
                  role="listitem"
                >
                  {word}
                </span>
              ))}
            </div>

            <div className="guided-steps">
              <DemoStep
                description="Hear the reversed word the way the campaign would play it."
                index={1}
                state="done"
                title="Listen"
              />
              <DemoStep
                description="Imitate what you hear and try to make the backward sounds line up."
                index={2}
                state="done"
                title="Record"
              />
              <DemoStep
                description="Reverse your attempt back and score how close you got."
                index={3}
                state="active"
                title="Score"
              />
            </div>
          </div>

          <div className="public-demo-column">
            <div className="audio-grid">
              <article className="audio-card">
                <div className="audio-card-head">
                  <div>
                    <h4>Reversed Clip</h4>
                  </div>
                  <span className="badge attempted">Listen</span>
                </div>
                <p>Hear how the demo word sounds when the game flips it backwards.</p>
                <div className="public-demo-audio-shell">
                  <div aria-hidden="true" className="public-demo-waveform">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="button ghost public-demo-audio-button">Play Sample</span>
                </div>
              </article>

              <article className="audio-card">
                <div className="audio-card-head">
                  <div>
                    <h4>Your Attempt</h4>
                  </div>
                  <span className="badge complete">Mock Record</span>
                </div>
                <p>Public demo only, so this stays visual and lightweight with no mic required.</p>
                <div className="public-demo-audio-shell">
                  <div aria-hidden="true" className="public-demo-waveform public-demo-waveform-attempt">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="button secondary public-demo-audio-button">Record Feel</span>
                </div>
              </article>
            </div>

            <div className="campaign-result-card">
              <div className="campaign-result-hero">
                <div>
                  <h3>Sample result</h3>
                  <p>Flip the take back forward and BabbleBack scores how close you got.</p>
                </div>
                <div className="campaign-result-stars">
                  <strong>{PUBLIC_DEMO_SCORE.toFixed(1)} / 3 stars</strong>
                  <StarRating
                    label={`Sample score ${PUBLIC_DEMO_SCORE.toFixed(1)} out of 3 stars`}
                    value={PUBLIC_DEMO_SCORE}
                  />
                </div>
              </div>

              <div className="campaign-result-metrics">
                <div className="campaign-result-metric">
                  <span>Closest Word</span>
                  <strong>{PUBLIC_DEMO_WORDS[0]}</strong>
                </div>
                <div className="campaign-result-metric">
                  <span>Difficulty</span>
                  <strong>Easy warm-up</strong>
                </div>
                <div className="campaign-result-metric">
                  <span>Campaign Reward</span>
                  <strong>+1 egg</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="info-banner public-demo-note">
          Public demo only. No login, mic, or saved progress needed here.
        </div>
      </section>

      <section className="public-home-auth-section" ref={authSectionRef}>
        <div className="section-header compact-header public-home-auth-header">
          <div>
            <div className="eyebrow">Start Playing</div>
            <h2>Log in or make an account</h2>
            <p>Signed-in players skip this page and go straight into the normal app flow.</p>
          </div>
        </div>

        <AuthPanel initialMode={authMode} key={`public-auth-${authMode}-${authPanelKey}`} />
      </section>
    </div>
  );
}
