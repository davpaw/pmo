// Adapted from scheduler/frontend/src/components/FlowDesigner/FlowEdge.tsx.
// Retains its Bezier connections, tone, selection styling and label renderer.
import React from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "reactflow";

type EdgeTone = "neutral" | "yes" | "no";
type PlaybackState = "idle" | "upcoming" | "done" | "active";

interface FlowEdgeData {
  displayLabel?: string;
  lane?: number;
  tone?: EdgeTone;
  playbackState?: PlaybackState;
}

export function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  data,
}: EdgeProps<FlowEdgeData>) {
  const edgeData = data ?? {};
  const tone = edgeData.tone ?? "neutral";
  const playbackState = edgeData.playbackState ?? "idle";
  const label = String(edgeData.displayLabel ?? "").trim();

  let stroke = "#5f6b7c";
  let strokeWidth = 1.7;
  let dashArray: string | undefined;

  if (tone === "yes") {
    stroke = "#2fb380";
    dashArray = "8 5";
  } else if (tone === "no") {
    stroke = "#d14a63";
    dashArray = "8 5";
  }

  if (playbackState === "upcoming") {
    strokeWidth = 2.2;
  }
  if (playbackState === "done") {
    strokeWidth = 2.5;
  }
  if (playbackState === "active") {
    strokeWidth = 3;
    dashArray = tone === "neutral" ? "10 4" : dashArray;
  }
  if (selected) {
    strokeWidth += 0.8;
  }

  let [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Separate simultaneous declared and observed relationships between the same nodes.
  if (edgeData.lane) {
    const bend = Math.max(80, Math.abs(targetX - sourceX) / 2);
    const offset = edgeData.lane * 70;
    edgePath = `M ${sourceX},${sourceY} C ${sourceX + bend},${sourceY + offset} ${targetX - bend},${targetY + offset} ${targetX},${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = (sourceY + targetY) / 2 + offset * 0.75;
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray: dashArray,
          opacity: playbackState === "idle" ? 0.75 : 1,
          filter: selected || playbackState === "active" ? "drop-shadow(0 0 6px rgba(111, 155, 255, 0.28))" : undefined,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`designer-edge-label designer-edge-label-${tone} designer-edge-label-${playbackState}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            {label.toUpperCase()}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
