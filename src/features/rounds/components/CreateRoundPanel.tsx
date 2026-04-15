import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { ToggleRecordButton } from '../../../components/ToggleRecordButton';
import { WaveformLoader } from '../../../components/WaveformLoader';
import { createRoundRecord } from '../../../lib/rounds';
import { difficultyMultiplier } from '../../../lib/rounds';
import type { Friend } from '../../social/types';
import type { Round } from '../types';
import {
  getDefaultPackId,
  getThreeOptions,
  getWordPackOptions,
  loadRoundWordPacks,
  rememberPresentedPhrase,
  type WordOption,
} from '../wordPacks';
import type { WordPack, WordPackWithWords } from '../../../lib/wordPacks';

interface CreateRoundPanelProps {
  currentUserId: string;
  currentUserUsername: string;
  friend: Friend;
  onBack: () => void;
  onCreateRound: (round: Round) => void;
}

type CreateStage = 'phrase' | 'record';

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

export function CreateRoundPanel({
  currentUserId,
  currentUserUsername,
  friend,
  onBack,
  onCreateRound,
}: CreateRoundPanelProps) {
  const recorder = useAudioRecorder({ preparedStreamIdleMs: 0 });
  const [stage, setStage] = useState<CreateStage>('phrase');
  const [packs, setPacks] = useState<WordPack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string>('');
  const [selectedPack, setSelectedPack] = useState<WordPackWithWords | null>(null);
  const [selectedOption, setSelectedOption] = useState<WordOption | null>(null);
  const [availableOptions, setAvailableOptions] = useState<WordOption[]>([]);
  const [packsError, setPacksError] = useState<string | null>(null);
  const [isLoadingPacks, setIsLoadingPacks] = useState(true);
  const [reversedAudioBlob, setReversedAudioBlob] = useState<Blob | null>(null);
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isReversing, setIsReversing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const lastAutoReversedBlobRef = useRef<Blob | null>(null);

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
  }, [selectedPackId]);

  useEffect(() => {
    if (!selectedPack) {
      setAvailableOptions([]);
      setSelectedOption(null);
      return;
    }

    const nextOptions = getThreeOptions(selectedPack.words);

    setAvailableOptions(nextOptions);
    setSelectedOption(null);
  }, [selectedPack]);

  useEffect(() => {
    setReversedAudioBlob(null);
    setReverseError(null);
    setSaveError(null);
    lastAutoReversedBlobRef.current = null;
  }, [recorder.audioBlob, recorder.isRecording]);

  useEffect(() => {
    if (!recorder.audioBlob || recorder.isRecording) {
      return;
    }

    const originalBlob = recorder.audioBlob;

    if (lastAutoReversedBlobRef.current === originalBlob) {
      return;
    }

    let cancelled = false;

    const autoReverseOriginal = async () => {
      setReverseError(null);
      setIsReversing(true);

      try {
        const nextReversedAudio = await reverseAudioBlob(originalBlob);
        if (cancelled) {
          return;
        }

        setReversedAudioBlob(nextReversedAudio);
        lastAutoReversedBlobRef.current = originalBlob;
      } catch (error) {
        if (!cancelled) {
          setReverseError(
            error instanceof Error ? error.message : 'Unable to reverse the original audio.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsReversing(false);
        }
      }
    };

    void autoReverseOriginal();

    return () => {
      cancelled = true;
    };
  }, [recorder.audioBlob, recorder.isRecording]);

  const canContinueToRecord = Boolean(selectedOption);
  const canCreateRound = useMemo(
    () =>
      Boolean(selectedOption && recorder.audioBlob && reversedAudioBlob) &&
      !isReversing &&
      !isSaving &&
      !recorder.isRecording &&
      !recorder.isPreparing,
    [
      isReversing,
      isSaving,
      recorder.audioBlob,
      recorder.isPreparing,
      recorder.isRecording,
      reversedAudioBlob,
      selectedOption,
    ],
  );

  const resetRecording = () => {
    setReversedAudioBlob(null);
    setReverseError(null);
    setSaveError(null);
    lastAutoReversedBlobRef.current = null;
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
    if (!recorder.audioBlob || !reversedAudioBlob || !selectedOption) {
      return;
    }

    setSaveError(null);
    setIsSaving(true);

    try {
      const nextRound = await createRoundRecord({
        currentUserId,
        recipientId: friend.id,
        correctPhrase: selectedOption.text,
        difficulty: selectedOption.displayDifficulty,
        originalAudioBlob: recorder.audioBlob,
        reversedAudioBlob,
      });

      onCreateRound(nextRound);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to create the round.');
    } finally {
      setIsSaving(false);
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
                  <option
                    disabled={!pack.isFree && !pack.isUnlocked}
                    key={pack.id}
                    value={pack.id}
                  >
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
                  <strong>Words:</strong> {selectedPack.words.length}
                </p>
                <p>
                  <strong>Access:</strong> {getPackAccessLabel(selectedPack)}
                </p>
                {selectedPack.description ? <p>{selectedPack.description}</p> : null}
              </div>
            ) : null}

            {!isLoadingPacks && !availableOptions.length ? (
              <div className="empty-state compact-empty">
                No prompts are available in this pack yet. Unlock more of the campaign to open the
                next difficulty tier.
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
                disabled={!recorder.audioBlob && !reversedAudioBlob}
                onClick={resetRecording}
                type="button"
              >
                Clear take
              </button>
            </div>

            {isReversing ? (
              <div className="round-loader-callout" aria-live="polite" role="status">
                <WaveformLoader
                  className="round-loader-callout-spinner"
                  size={92}
                  strokeWidth={3.6}
                />
                <div>
                  <strong>Reversing audio...</strong>
                  <p>Building the flipped clip your friend will hear in the round.</p>
                </div>
              </div>
            ) : null}

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
        {reverseError ? <div className="error-banner">{reverseError}</div> : null}
        {saveError ? <div className="error-banner">{saveError}</div> : null}
      </div>
    </section>
  );
}
