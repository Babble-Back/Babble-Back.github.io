import { useEffect, useMemo, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { ToggleRecordButton } from '../../../components/ToggleRecordButton';
import { WaveformLoader } from '../../../components/WaveformLoader';
import { createRoundRecord } from '../../../lib/rounds';
import { difficultyMultiplier } from '../../../lib/rounds';
import type { Friend } from '../../social/types';
import type { Round } from '../types';
import { useResourceWallet } from '../../resources/ResourceProvider';
import {
  getDefaultPackId,
  getThreeOptions,
  getWordPackOptions,
  loadRoundWordPacks,
  rememberPresentedPhrase,
  type RoundSelectableWordPack,
  type WordOption,
} from '../wordPacks';
import {
  purchaseCampaignPackUnlock,
  type CampaignPackCurrency,
  type WordPack,
} from '../../../lib/wordPacks';

interface CreateRoundPanelProps {
  currentUserId: string;
  currentUserUsername: string;
  friend: Friend;
  onBack: () => void;
  onCreateRound: (round: Round) => void;
}

type CreateStage = 'phrase' | 'record';

const DEFAULT_PACK_UNLOCK_COSTS = {
  easy: 25,
  medium: 50,
  hard: 150,
} as const;

function getDifficultyEffectLabel(difficulty: WordOption['displayDifficulty']) {
  if (difficulty === 'easy') {
    return null;
  }

  return `${difficultyMultiplier[difficulty]}x`;
}

function getPackAccessLabel(pack: Pick<WordPack, 'isFree' | 'isUnlocked' | 'maxUnlockedDifficulty' | 'unlockTier'>) {
  if (pack.isFree) {
    return 'Free';
  }

  if (pack.isUnlocked === false) {
    return pack.unlockTier ? `Locked (${pack.unlockTier})` : 'Locked';
  }

  if (pack.maxUnlockedDifficulty === 'easy') {
    return 'Easy unlocked';
  }

  if (pack.maxUnlockedDifficulty === 'medium') {
    return 'Easy + Medium unlocked';
  }

  if (pack.maxUnlockedDifficulty === 'hard') {
    return 'Full pack unlocked';
  }

  return 'Unlocked';
}

function getNextPurchasableDifficulty(
  pack: Pick<WordPack, 'isFree' | 'maxUnlockedDifficulty'>,
) {
  if (pack.isFree) {
    return null;
  }

  if (!pack.maxUnlockedDifficulty) {
    return 'easy' as const;
  }

  if (pack.maxUnlockedDifficulty === 'easy') {
    return 'medium' as const;
  }

  if (pack.maxUnlockedDifficulty === 'medium') {
    return 'hard' as const;
  }

  return null;
}

function formatCampaignCurrencyLabel(currency: CampaignPackCurrency | null | undefined, amount: number) {
  if (!currency) {
    return 'currency';
  }

  return amount === 1 ? currency.singularName : currency.pluralName;
}

function formatDifficultyWordCounts(pack: RoundSelectableWordPack) {
  return `Easy ${pack.totalWordCounts.easy}, Medium ${pack.totalWordCounts.medium}, Hard ${pack.totalWordCounts.hard}`;
}

export function CreateRoundPanel({
  currentUserId,
  currentUserUsername,
  friend,
  onBack,
  onCreateRound,
}: CreateRoundPanelProps) {
  const recorder = useAudioRecorder({ preparedStreamIdleMs: 0 });
  const { setResourceBalance } = useResourceWallet();
  const [stage, setStage] = useState<CreateStage>('phrase');
  const [packs, setPacks] = useState<WordPack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string>('');
  const [selectedPack, setSelectedPack] = useState<RoundSelectableWordPack | null>(null);
  const [selectedOption, setSelectedOption] = useState<WordOption | null>(null);
  const [availableOptions, setAvailableOptions] = useState<WordOption[]>([]);
  const [packsError, setPacksError] = useState<string | null>(null);
  const [isLoadingPacks, setIsLoadingPacks] = useState(true);
  const [isPurchasingPack, setIsPurchasingPack] = useState(false);
  const [packRefreshToken, setPackRefreshToken] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadPackState = async () => {
      setIsLoadingPacks(true);
      const result = await loadRoundWordPacks(selectedPackId || null);

      if (cancelled) {
        return;
      }

      setPacks(result.packs);
      setSelectedPack(result.selectedPack);
      setSelectedPackId(result.selectedPackId);
      setPacksError(result.error);
      setIsLoadingPacks(false);
    };

    void loadPackState();

    return () => {
      cancelled = true;
    };
  }, [packRefreshToken, selectedPackId]);

  useEffect(() => {
    if (!selectedPack) {
      setAvailableOptions([]);
      setSelectedOption(null);
      return;
    }

    const nextOptions = getThreeOptions(selectedPack.accessibleWords);

    setAvailableOptions(nextOptions);
    setSelectedOption(null);
  }, [selectedPack]);

  useEffect(() => {
    setSaveError(null);
  }, [recorder.audioBlob, recorder.isRecording]);

  const canContinueToRecord = Boolean(selectedOption);
  const canCreateRound = useMemo(
    () =>
      Boolean(selectedOption && recorder.audioBlob) &&
      !isSaving &&
      !recorder.isRecording &&
      !recorder.isPreparing,
    [
      isSaving,
      recorder.audioBlob,
      recorder.isPreparing,
      recorder.isRecording,
      selectedOption,
    ],
  );
  const nextPurchasableDifficulty = selectedPack
    ? getNextPurchasableDifficulty(selectedPack)
    : null;
  const nextPurchasableCost =
    nextPurchasableDifficulty
      ? (selectedPack?.campaignCurrency?.packCosts[nextPurchasableDifficulty] ??
        DEFAULT_PACK_UNLOCK_COSTS[nextPurchasableDifficulty])
      : null;
  const selectedPackCurrency = selectedPack?.campaignCurrency ?? null;
  const selectedPackIsLocked = Boolean(selectedPack && !selectedPack.isFree && !selectedPack.isUnlocked);

  const resetRecording = () => {
    setSaveError(null);
    recorder.clearRecording();
  };

  const handleEnterRecordStage = async () => {
    if (!selectedOption) {
      return;
    }

    rememberPresentedPhrase(selectedOption.text);

    await recorder.prepareRecording();
    setStage('record');
  };

  const handleCreateRound = async () => {
    if (!recorder.audioBlob || !selectedOption) {
      return;
    }

    setSaveError(null);
    setIsSaving(true);

    try {
      const nextRound = await createRoundRecord({
        currentUserId,
        recipientId: friend.id,
        packId: selectedPack?.id ?? null,
        correctPhrase: selectedOption.text,
        difficulty: selectedOption.displayDifficulty,
        originalAudioBlob: recorder.audioBlob,
      });

      onCreateRound(nextRound);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to create the round.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePurchaseSelectedPack = async () => {
    if (!selectedPack || !nextPurchasableDifficulty) {
      return;
    }

    setPacksError(null);
    setIsPurchasingPack(true);

    try {
      const purchaseResult = await purchaseCampaignPackUnlock(selectedPack.id);
      setResourceBalance(purchaseResult.resourceType, purchaseResult.currentResourceBalance);
      setPackRefreshToken((currentValue) => currentValue + 1);
    } catch (error) {
      setPacksError(
        error instanceof Error ? error.message : 'Unable to unlock this campaign pack right now.',
      );
    } finally {
      setIsPurchasingPack(false);
    }
  };

  return (
    <section className="surface round-screen">
      <div className="round-screen-header">
        <button className="button ghost round-screen-back" onClick={onBack} type="button">
          Back
        </button>

        <div className="round-screen-copy">
          <div className="eyebrow">Your Send Turn</div>
          <h2>{stage === 'phrase' ? 'Pick a phrase' : 'Record the prompt'}</h2>
          <p>
            {stage === 'phrase'
              ? `Choose one of the generated options for ${friend.username}. The pack selector stays ready for future themed packs.`
              : 'Start recording when ready, stop to save the take, then send it when you are happy with your normal playback.'}
          </p>
        </div>

        <div className="pill-row round-screen-meta">
          <span className="badge primary">{friend.username}</span>
        </div>
      </div>

      <div className="round-screen-body">
        {stage === 'phrase' ? (
          <div className="round-screen-step">
            <div className="section-header compact-header">
              <div>
                <h3>Choose a generated prompt</h3>
                <p>
                  Choose from the difficulties you have unlocked in this pack. The pack can be
                  switched before you record.
                </p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="packSelect">Word pack</label>
              <select
                id="packSelect"
                onChange={(event) => {
                  setSelectedPackId(event.target.value);
                }}
                value={selectedPackId || getDefaultPackId(packs)}
              >
                {getWordPackOptions(packs).map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name}{' '}
                    ({getPackAccessLabel(pack)})
                  </option>
                ))}
              </select>
            </div>

            {selectedPack ? (
              <div className="result-box">
                <p>
                  <strong>Pack:</strong> {selectedPack.name}
                </p>
                <p>
                  <strong>Words:</strong> {formatDifficultyWordCounts(selectedPack)}
                </p>
                <p>
                  <strong>Usable now:</strong> {selectedPack.accessibleWords.length}
                </p>
                <p>
                  <strong>Access:</strong> {getPackAccessLabel(selectedPack)}
                </p>
                {nextPurchasableDifficulty && nextPurchasableCost ? (
                  <p>
                    <strong>Next unlock:</strong>{' '}
                    {nextPurchasableDifficulty} for {nextPurchasableCost}{' '}
                    {formatCampaignCurrencyLabel(selectedPackCurrency, nextPurchasableCost)}
                  </p>
                ) : null}
                {selectedPack.description ? <p>{selectedPack.description}</p> : null}
                {nextPurchasableDifficulty && nextPurchasableCost ? (
                  <div className="button-row">
                    <button
                      className="button secondary"
                      disabled={isPurchasingPack}
                      onClick={() => {
                        void handlePurchaseSelectedPack();
                      }}
                      type="button"
                    >
                      {isPurchasingPack
                        ? 'Unlocking...'
                        : `Unlock ${nextPurchasableDifficulty} for ${nextPurchasableCost} ${formatCampaignCurrencyLabel(selectedPackCurrency, nextPurchasableCost)}`}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!isLoadingPacks && !availableOptions.length ? (
              <div className="empty-state compact-empty">
                {selectedPackIsLocked
                  ? 'This campaign pack is locked. Purchase the next tier with campaign currency to use it in multiplayer.'
                  : 'No prompts are available in the difficulties you have unlocked for this pack yet.'}
              </div>
            ) : null}

            <div
              style={{
                display: 'grid',
                gap: '0.75rem',
              }}
            >
              {availableOptions.map((option) => {
                const isSelected = selectedOption?.text === option.text;
                const difficultyEffectLabel = getDifficultyEffectLabel(option.displayDifficulty);

                return (
                  <button
                    className={`button ${isSelected ? 'primary' : 'secondary'}`}
                    key={`${option.displayDifficulty}-${option.id}`}
                    onClick={() => {
                      setSelectedOption(option);
                    }}
                    type="button"
                  >
                    <span className="pill-row" style={{ justifyContent: 'space-between', width: '100%' }}>
                      <span className={`badge ${option.displayDifficulty}`}>
                        {option.displayDifficulty}
                        {difficultyEffectLabel ? (
                          <span
                            style={{
                              alignItems: 'center',
                              display: 'inline-flex',
                              gap: '0.15rem',
                              marginLeft: '0.35rem',
                            }}
                          >
                            {difficultyEffectLabel}
                            <img
                              alt="BB coin"
                              src={`${import.meta.env.BASE_URL}bbcoin.png`}
                              style={{ height: '0.95em', width: '0.95em' }}
                            />
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span style={{ display: 'block', marginTop: '0.5rem', textAlign: 'left' }}>
                      {option.text}
                    </span>
                  </button>
                );
              })}
            </div>

            {isLoadingPacks ? (
              <div className="round-loader-callout" aria-live="polite" role="status">
                <WaveformLoader
                  className="round-loader-callout-spinner"
                  size={92}
                  strokeWidth={3.6}
                />
                <div>
                  <strong>Loading packs...</strong>
                  <p>Fetching themed word packs and warming the local cache.</p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {stage === 'record' ? (
          <div className="round-screen-step">
            <div className="result-box round-screen-summary">
              <p>
                <strong>From:</strong> {currentUserUsername}
              </p>
              <p>
                <strong>To:</strong> {friend.username}
              </p>
              <p>
                <strong>Phrase:</strong> {selectedOption?.text || 'Choose a phrase first'}
              </p>
            </div>

            <div className="button-row round-record-actions">
              <ToggleRecordButton
                disabled={isSaving}
                isPreparing={recorder.isPreparing}
                isRecording={recorder.isRecording}
                liveStream={recorder.liveStream}
                onStart={recorder.startRecording}
                onStop={recorder.stopRecording}
              />
              <button
                className="button ghost"
                disabled={!recorder.audioBlob}
                onClick={resetRecording}
                type="button"
              >
                Clear take
              </button>
            </div>

            <AudioPlayerCard
              title="Latest take"
              description={
                recorder.audioBlob
                  ? 'Replay your normal recording before you send.'
                  : 'Record once and the preview will appear here.'
              }
              blob={recorder.audioBlob}
            />
          </div>
        ) : null}
      </div>

      <div className="round-screen-footer">
        {stage === 'phrase' ? (
          <div className="button-row">
            <button
              className="button primary"
              disabled={!canContinueToRecord}
              onClick={() => {
                void handleEnterRecordStage();
              }}
              type="button"
            >
              Record prompt
            </button>
          </div>
        ) : (
          <div className="button-row">
            <button
              className="button ghost"
              onClick={() => {
                setStage('phrase');
              }}
              type="button"
            >
              Edit phrase
            </button>
            <button
              className="button primary"
              disabled={!canCreateRound}
              onClick={() => {
                void handleCreateRound();
              }}
              type="button"
            >
              {isSaving ? 'Sending...' : `Send to ${friend.username}`}
            </button>
          </div>
        )}
      </div>

      <div className="stack">
        {packsError ? <div className="error-banner">{packsError}</div> : null}
        {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
        {saveError ? <div className="error-banner">{saveError}</div> : null}
      </div>
    </section>
  );
}
