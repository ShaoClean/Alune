import type { GraphCommit } from '@alune/shared';

export const GRAPH_ROW_HEIGHT = 36;
export const GRAPH_LANE_WIDTH = 18;
export interface GraphEdge {
  from: number;
  to: number;
  color: number;
  half: 'top' | 'bottom' | 'full';
  target: string;
}
export interface GraphRow {
  hash: string;
  lane: number;
  color: number;
  edges: GraphEdge[];
}
type Lane = { target: string; color: number } | null;
export interface GraphLayout {
  rows: GraphRow[];
  lanes: Lane[];
  width: number;
  nextColor: number;
}
export const emptyGraph = (): GraphLayout => ({ rows: [], lanes: [], width: 1, nextColor: 0 });

// Rows depend only on their parents and the frontier above, never later rows.
// Appending a page cannot move or recolor anything already displayed.
export function appendGraph(previous: GraphLayout, commits: GraphCommit[]): GraphLayout {
  const lanes = [...previous.lanes];
  const rows = [...previous.rows];
  let width = previous.width;
  let nextColor = previous.nextColor;
  const allocate = () => {
    const free = lanes.indexOf(null);
    if (free >= 0) return free;
    lanes.push(null);
    return lanes.length - 1;
  };
  for (const commit of commits) {
    const incoming = [...lanes];
    let lane = lanes.findIndex((item) => item?.target === commit.hash);
    if (lane < 0) {
      lane = allocate();
      lanes[lane] = { target: commit.hash, color: nextColor++ };
    }
    const color = lanes[lane]!.color;
    const edges: GraphEdge[] = [];
    incoming.forEach((item, i) => {
      if (!item) return;
      edges.push({
        from: i,
        to: item.target === commit.hash ? lane : i,
        color: item.color,
        half: item.target === commit.hash ? 'top' : 'full',
        target: item.target,
      });
    });
    lanes[lane] = null;
    for (const [index, parent] of [...new Set(commit.parents)].entries()) {
      let targetLane = lanes.findIndex((item) => item?.target === parent);
      if (targetLane < 0) {
        targetLane = index === 0 ? lane : allocate();
        lanes[targetLane] = { target: parent, color: index === 0 ? color : nextColor++ };
      }
      edges.push({
        from: lane,
        to: targetLane,
        color: lanes[targetLane]!.color,
        half: 'bottom',
        target: parent,
      });
    }
    rows.push({ hash: commit.hash, lane, color, edges });
    width = Math.max(width, lanes.length, lane + 1);
  }
  return { rows, lanes, width, nextColor };
}
