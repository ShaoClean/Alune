import { useEffect, useState } from 'react';
import type { DiffImageContent, DiffImageOptions, DiffImageSide } from '@remote-git/shared';
import { repositoryApi } from '../api';
import type { ImageDiffKind } from './diff-lines';

interface Props {
  repoId: string;
  path: string;
  kind: ImageDiffKind;
  request: Omit<DiffImageOptions, 'file' | 'side'>;
}

type PaneState =
  | { phase: 'loading' }
  | { phase: 'absent' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; image: DiffImageContent };

const sideLabels: Record<DiffImageSide, string> = { before: '变更前', after: '变更后' };
const sidesFor: Record<ImageDiffKind, DiffImageSide[]> = {
  added: ['after'],
  deleted: ['before'],
  modified: ['before', 'after'],
};

const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

const errorMessage = (error: any) =>
  error?.response?.data?.message || error?.message || '无法读取图片';

function ImagePane({ repoId, path, side, request }: Props & { side: DiffImageSide }) {
  const [state, setState] = useState<PaneState>({ phase: 'loading' });
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const requestKey = JSON.stringify([repoId, path, side, request]);

  useEffect(() => {
    const abort = new AbortController();
    setState({ phase: 'loading' });
    setDimensions(null);
    repositoryApi
      .diffImage(repoId, { ...request, file: path, side }, abort.signal)
      .then((image) => setState({ phase: 'ready', image }))
      .catch((error: any) => {
        if (abort.signal.aborted) return;
        // 404 means this side never had content, not a failure to report.
        if (error?.response?.status === 404) setState({ phase: 'absent' });
        else setState({ phase: 'error', message: errorMessage(error) });
      });
    return () => abort.abort();
  }, [requestKey]);

  return (
    <figure className="image-diff-pane">
      <figcaption className={`image-diff-pane__label image-diff-pane__label--${side}`}>
        <span>{sideLabels[side]}</span>
        {state.phase === 'ready' && (
          <small>
            {state.image.mediaType.replace('image/', '').toUpperCase()}
            {dimensions ? ` · ${dimensions.width}×${dimensions.height}` : ''} ·{' '}
            {formatBytes(state.image.byteLength)}
          </small>
        )}
      </figcaption>
      <div className="image-diff-pane__canvas">
        {state.phase === 'loading' && <p className="image-diff-pane__notice">正在读取图片…</p>}
        {state.phase === 'absent' && (
          <p className="image-diff-pane__notice">此版本不存在该图片。</p>
        )}
        {state.phase === 'error' && (
          <p className="image-diff-pane__notice image-diff-pane__notice--error" role="alert">
            {state.message}
          </p>
        )}
        {state.phase === 'ready' && (
          <img
            src={`data:${state.image.mediaType};base64,${state.image.content}`}
            alt={`${path} 的${sideLabels[side]}版本`}
            onLoad={(event) =>
              setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() =>
              setState({ phase: 'error', message: '图片无法解码，可能已损坏或格式不受支持。' })
            }
          />
        )}
      </div>
    </figure>
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
