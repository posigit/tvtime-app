/**
 * Minimal ambient types for the Google Cast Web Sender SDK (loaded
 * dynamically from gstatic — no npm dependency). Only the surface the
 * player uses is declared; everything else stays untyped on purpose.
 */

export interface CastMediaInfo {
  contentId: string;
  contentType: string;
  streamType: string;
  metadata?: unknown;
  currentTime?: number;
}

export interface CastSessionLike {
  loadMedia: (request: unknown) => Promise<unknown>;
  endSession: (stopCasting: boolean) => void;
}

export interface CastRemotePlayerLike {
  currentTime: number;
  duration: number;
  playerState: string;
  isPaused: boolean;
  isMuted: boolean;
  volumeLevel: number;
}

export interface CastPlayerControllerLike {
  playOrPause: () => void;
  muteOrUnmute: () => void;
  seek: () => void;
}

interface CastFrameworkLike {
  CastContext: {
    getInstance: () => {
      setOptions: (opts: Record<string, unknown>) => void;
      requestSession: () => Promise<unknown>;
      getCurrentSession: () => CastSessionLike | null | undefined;
      addEventListener: (
        type: string,
        listener: (e: { sessionStatus?: string }) => void
      ) => void;
    };
  };
  RemotePlayer: new () => CastRemotePlayerLike;
  RemotePlayerController: new (
    player: CastRemotePlayerLike
  ) => CastPlayerControllerLike;
}

interface CastChromeLike {
  cast: {
    media: {
      DEFAULT_MEDIA_RECEIVER_APP_ID: string;
      MetadataType: { GENERIC: number };
      StreamType: { BUFFERED: string };
      GenericMediaMetadata: new () => {
        metadataType: number;
        title?: string;
      };
      MediaInfo: new (contentId: string, contentType: string) => CastMediaInfo;
      LoadRequest: new (media: CastMediaInfo) => {
        autoplay?: boolean;
        currentTime?: number;
      };
    };
    AutoJoinPolicy: { ORIGIN_SCOPED: string };
  };
  framework: CastFrameworkLike;
}

declare global {
  interface Window {
    chrome?: CastChromeLike & Record<string, unknown>;
    __onGCastApiAvailable?: (available: boolean) => void;
  }
}

export {};
