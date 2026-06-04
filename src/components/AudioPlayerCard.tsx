import { useObjectUrl } from '../audio/hooks/useObjectUrl';
import { WaveformPlayButton, type WaveformPlayButtonProps } from './WaveformPlayButton';

interface AudioPlayerCardProps {
  title: string;
  description?: string;
  blob?: Blob | null;
  emptyLabel?: string;
  isLoading?: boolean;
  loadingLabel?: string;
  remoteUrl?: string | null;
  playButtonDisabled?: boolean;
  playbackKind?: WaveformPlayButtonProps['playbackKind'];
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
  playbackKind = 'normal',
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
      {description ? <p>{description}</p> : null}
      {src ? (
        <div className="audio-card-player-wrap">
          <WaveformPlayButton
            className="audio-card-player"
            disabled={playButtonDisabled}
            onPlayRequest={onPlayRequest}
            playbackKind={playbackKind}
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
