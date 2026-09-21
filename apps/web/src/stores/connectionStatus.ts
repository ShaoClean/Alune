import type { ConnectionActivityStatus, ConnectionStatusInfo } from '@alune/shared';

const LABELS: Record<ConnectionActivityStatus, string> = {
  connected: '在线',
  connecting: '连接中',
  disconnected: '已断开',
  error: '连接失败',
  unknown: '未测试',
};

export function connectionStatus(info?: ConnectionStatusInfo): ConnectionActivityStatus {
  return info?.status ?? 'unknown';
}

export function connectionStatusLabel(info?: ConnectionStatusInfo): string {
  return LABELS[connectionStatus(info)];
}
