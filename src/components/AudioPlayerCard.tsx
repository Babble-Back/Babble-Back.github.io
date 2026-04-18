import { useObjectUrl } from '../audio/hooks/useObjectUrl';
import { WaveformPlayButton, type WaveformPlayButtonProps } from './WaveformPlayButton';

interface AudioPlayerCardProps {
  title: string;
  description: string;
  blob?: Blob | null;
  emptyLabel?: string;
  isLoading?: boolean;
  loadingLabel?: string;
  remoteUrl?: string | null;
  playButtonDisabled?: boolean;
  onPlayRequest?: WaveformPlayButtonProps['onPlayRequest'];
}

export function AudioPlayerCard({
  title,
  description,
  blob,
  emptyLabel = 'No audio available yet.',
  isLoading = false,
  loadingLabel = 'Preparing audio...',
  remoteUrl,
  playButtonDisabled = false,
  onPlayRequest,
}: AudioPlayerCardProps) {
  const objectUrl = useObjectUrl(blob);
  const src = objectUrl ?? remoteUrl ?? null;

  return (
    <article className="audio-card">
      <div className="audio-card-head">
        <div>
          <h4>{title}</h4>
        </div>
      </div>
      <p>{description}</p>
      {src ? (
        <div className="audio-card-player-wrap">
          <WaveformPlayButton
            className="audio-card-player"
            disabled={playButtonDisabled}
            onPlayRequest={onPlayRequest}
            size={86}
            src={src}
          />
        </div>
      ) : (
        <div className="empty-state compact-empty">
          {isLoading ? loadingLabel : emptyLabel}
        </div>
      )}
    </article>
  );
}
