import { useEffect, useState } from 'react';
import type { DiffImageContent, DiffImageOptions, DiffImageSide } from '@alune/shared';
import { repositoryApi } from '../api';
import type { ImageDiffKind } from './diff-lines';

interface Props {
  repoId: string;
  path: string;
  kind: ImageDiffKind;
  request: Omit<DiffImageOptions, 'file' | 'side'>;
}

export type ImagePreviewState =
  | { phase: 'loading' }
  | { phase: 'absent'; message: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; mediaType: string; byteLength: number; content: string };

const sideLabels: Record<DiffImageSide, string> = { before: '变更前', after: '变更后' };
const sidesFor: Record<ImageDiffKind, DiffImageSide[]> = {
  added: ['after'],
  deleted: ['before'],
  modified: ['before', 'after'],
};

export const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

const errorMessage = (error: any) =>
  error?.response?.data?.message || error?.message || '无法读取图片';

// One image on a checkerboard with its format, size and dimensions. Shared by
// the image diff and the read-only file preview.
export function ImagePreview({
  label,
  tone,
  state,
  alt,
}: {
  label: string;
  tone?: DiffImageSide;
  state: ImagePreviewState;
  alt: string;
}) {
  const src = state.phase === 'ready' ? `data:${state.mediaType};base64,${state.content}` : null;
  // Results are keyed by the image they came from, so a new image never shows the
  // previous size, even when a cached image loads before effects run.
  const [measured, setMeasured] = useState<{ src: string; width: number; height: number } | null>(
    null,
  );
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const dimensions = measured && measured.src === src ? measured : null;
  const decodeFailed = src !== null && failedSrc === src;

  return (
    <figure className="image-diff-pane">
      <figcaption
        className={`image-diff-pane__label${tone ? ` image-diff-pane__label--${tone}` : ''}`}
      >
        <span>{label}</span>
        {state.phase === 'ready' && (
          <small>
            {state.mediaType.replace('image/', '').toUpperCase()}
            {dimensions ? ` · ${dimensions.width}×${dimensions.height}` : ''} ·{' '}
            {formatBytes(state.byteLength)}
          </small>
        )}
      </figcaption>
      <div className="image-diff-pane__canvas">
        {state.phase === 'loading' && <p className="image-diff-pane__notice">正在读取图片…</p>}
        {state.phase === 'absent' && <p className="image-diff-pane__notice">{state.message}</p>}
        {(state.phase === 'error' || decodeFailed) && (
          <p className="image-diff-pane__notice image-diff-pane__notice--error" role="alert">
            {state.phase === 'error' ? state.message : '图片无法解码，可能已损坏或格式不受支持。'}
          </p>
        )}
        {src && !decodeFailed && (
          <img
            src={src}
            alt={alt}
            onLoad={(event) =>
              setMeasured({
                src,
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setFailedSrc(src)}
          />
        )}
      </div>
    </figure>
  );
}

function ImagePane({ repoId, path, side, request }: Props & { side: DiffImageSide }) {
  const [state, setState] = useState<ImagePreviewState>({ phase: 'loading' });
  const requestKey = JSON.stringify([repoId, path, side, request]);

  useEffect(() => {
    const abort = new AbortController();
    setState({ phase: 'loading' });
    repositoryApi
      .diffImage(repoId, { ...request, file: path, side }, abort.signal)
      .then((image: DiffImageContent) =>
        setState({
          phase: 'ready',
          mediaType: image.mediaType,
          byteLength: image.byteLength,
          content: image.content,
        }),
      )
      .catch((error: any) => {
        if (abort.signal.aborted) return;
        // 404 means this side never had content, not a failure to report.
        if (error?.response?.status === 404)
          setState({ phase: 'absent', message: '此版本不存在该图片。' });
        else setState({ phase: 'error', message: errorMessage(error) });
      });
    return () => abort.abort();
  }, [requestKey]);

  return (
    <ImagePreview
      label={sideLabels[side]}
      tone={side}
      state={state}
      alt={`${path} 的${sideLabels[side]}版本`}
    />
  );
}

export function ImageDiffView(props: Props) {
  return (
    <div className="image-diff" aria-label="图片差异">
      <div className="image-diff__header">
        <strong>{props.path.split('/').pop()}</strong>
        <span>
          {props.kind === 'added' ? '新增图片' : props.kind === 'deleted' ? '删除图片' : '修改图片'}
        </span>
      </div>
      <div className={`image-diff__panes image-diff__panes--${props.kind}`}>
        {sidesFor[props.kind].map((side) => (
          <ImagePane key={side} {...props} side={side} />
        ))}
      </div>
    </div>
  );
}
