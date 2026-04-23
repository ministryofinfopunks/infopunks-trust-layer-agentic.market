"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { RevealGroup } from "@/components/motion/reveal";
import { fadeUp, feedEntry, quarantineSequence } from "@/lib/motion/variants";
import { motionDurations, motionEase } from "@/lib/motion/tokens";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";
import { useWarRoomState } from "./use-war-room-state";

function Panel({ children, className = "", wide = false, reducedMotion }) {
  return (
    <motion.article
      variants={fadeUp({ distance: 12, duration: 0.22, reducedMotion })}
      className={`surface-card overflow-hidden p-5 sm:p-6 ${wide ? "xl:col-span-8" : "xl:col-span-4"} ${className}`}
    >
      {children}
    </motion.article>
  );
}

function SectionHeader({ eyebrow, title, detail }) {
  return (
    <div className="panel-head mb-4 flex items-start justify-between gap-4">
      <div>
        <p className="mono-copy text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">{eyebrow}</p>
        <h2 className="mt-2 text-lg text-white">{title}</h2>
      </div>
      {detail ? <span className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{detail}</span> : null}
    </div>
  );
}

function formatDetailValue(value) {
  if (Array.isArray(value)) {
    return value.map(formatDetailValue).filter(Boolean).join(", ");
  }

  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function compactDetails(source, keys = [], limit = 3) {
  const preferred = keys
    .map((key) => [key, source?.[key]])
    .filter(([, value]) => value !== undefined && value !== null && value !== "");

  const fallback = Object.entries(source ?? {})
    .filter(([key, value]) => value !== undefined && value !== null && value !== "" && key !== "severity")
    .slice(0, limit);

  const merged = [...preferred];

  for (const entry of fallback) {
    if (!merged.some(([key]) => key === entry[0])) {
      merged.push(entry);
    }
  }

  return (merged.length ? merged : fallback)
    .slice(0, limit)
    .map(([key, value]) => `${key}=${formatDetailValue(value)}`);
}

function lockIconClassName(active) {
  return active ? "text-[var(--danger)]" : "text-[var(--text-secondary)]";
}

function LockGlyph({ active = false }) {
  return (
    <motion.svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${lockIconClassName(active)}`}
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: motionDurations.fast, ease: motionEase.standard }}
    >
      <path
        d="M7.5 11V8.6C7.5 6.1 9.5 4.1 12 4.1C14.5 4.1 16.5 6.1 16.5 8.6V11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="5.5"
        y="11"
        width="13"
        height="8"
        rx="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="15" r="0.9" fill="currentColor" />
    </motion.svg>
  );
}

function ArrowGlyph({ className = "" }) {
  return (
    <motion.svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12h12" />
      <path d="M12 6l6 6-6 6" />
    </motion.svg>
  );
}

function severityTone(eventType, severity) {
  if (eventType === "trust.collapse" || eventType === "quarantine.enforced" || severity === "critical") {
    return "critical";
  }
  if (eventType === "validator.reject" || severity === "watch") {
    return "watch";
  }
  if (eventType === "trust.spike") {
    return "positive";
  }
  return "neutral";
}

function toneClasses(tone) {
  if (tone === "critical") {
    return "border-[rgba(255,93,115,0.18)] bg-[rgba(255,93,115,0.08)] text-[var(--danger)]";
  }
  if (tone === "watch") {
    return "border-[rgba(255,200,87,0.18)] bg-[rgba(255,200,87,0.08)] text-[var(--warning)]";
  }
  if (tone === "positive") {
    return "border-[rgba(0,255,159,0.18)] bg-[rgba(0,255,159,0.08)] text-[var(--accent)]";
  }
  return "border-white/10 bg-white/[0.03] text-[var(--text-secondary)]";
}

function subjectPositions(subjectIds) {
  const positions = [
    { x: 18, y: 28 },
    { x: 46, y: 18 },
    { x: 76, y: 28 },
    { x: 28, y: 68 },
    { x: 58, y: 58 },
    { x: 82, y: 70 }
  ];

  return subjectIds.map((subjectId, index) => ({
    subjectId,
    ...positions[index % positions.length]
  }));
}

function EventFeedPanel({ events, reducedMotion }) {
  return (
    <>
      <SectionHeader eyebrow="Live Feed" title="Live Trust Event Feed" detail="top insert / SSE" />
      <motion.div layout className="flex max-h-[560px] min-h-[420px] flex-col gap-3 overflow-auto pr-1">
        <AnimatePresence initial={false} mode="popLayout">
          {events.map((event, index) => {
            const tone = severityTone(event.event_type, event.data?.severity);
            const isSevere = tone === "critical";
            const details = compactDetails(event.data, ["reason", "delta", "tasks_rerouted", "selected"], 3);

            return (
              <motion.div
                key={event.event_id}
                layout
                variants={feedEntry}
                initial="hidden"
                animate="show"
                exit="exit"
                className="relative overflow-hidden rounded-[12px] border border-white/6 bg-white/[0.02] px-4 py-4"
                style={{ opacity: index === 0 ? 1 : Math.max(0.62, 0.92 - index * 0.08) }}
              >
                {!reducedMotion && isSevere ? (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.12, 0] }}
                    transition={{ duration: motionDurations.standard, ease: motionEase.standard }}
                    style={{ background: "linear-gradient(90deg, rgba(255,93,115,0.12), transparent 68%)" }}
                  />
                ) : null}
                <div className={`absolute inset-y-0 left-0 w-px ${isSevere ? "bg-[rgba(255,93,115,0.26)]" : "bg-[rgba(0,255,159,0.16)]"}`} />
                <div className="relative flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <strong className="block text-sm text-white">{event.event_type}</strong>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{event.subject_id}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {details.length > 0 ? (
                        details.map((detail) => (
                          <span
                            key={detail}
                            className="inline-flex rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 mono-copy text-[11px] uppercase tracking-[0.16em] text-[var(--text-secondary)]"
                          >
                            {detail}
                          </span>
                        ))
                      ) : (
                        <span className="mono-copy text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">no payload details</span>
                      )}
                    </div>
                  </div>
                  <motion.span
                    initial={{ opacity: 0, x: reducedMotion ? 0 : 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.06, duration: motionDurations.fast, ease: motionEase.standard }}
                    className={`inline-flex rounded-full border px-3 py-1 mono-copy text-[11px] uppercase tracking-[0.18em] ${toneClasses(tone)}`}
                  >
                    {event.data?.severity ?? tone}
                  </motion.span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </>
  );
}

function MoversPanel({ movers, reducedMotion }) {
  return (
    <>
      <SectionHeader eyebrow="Trust Movement" title="Top Score Movers" detail="score delta / band" />
      <div className="flex min-h-[180px] flex-col gap-3">
        {movers.map((entry) => {
          const tone = entry.delta < 0 ? "critical" : "positive";
          const scoreTone = entry.delta < 0 ? "rgba(255,93,115,1)" : "rgba(0,255,159,1)";

          return (
            <motion.div
              key={entry.subject_id}
              layout
              className="relative overflow-hidden rounded-[12px] border border-white/6 bg-white/[0.02] px-4 py-4"
              animate={{
                borderColor: entry.delta < 0 ? "rgba(255,93,115,0.16)" : "rgba(0,255,159,0.14)"
              }}
              transition={{ duration: motionDurations.standard, ease: motionEase.standard }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{entry.subject_id}</p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <motion.p
                      animate={{ color: scoreTone }}
                      transition={{ duration: motionDurations.standard, ease: motionEase.standard }}
                      className="text-2xl font-medium tracking-[-0.04em] tabular-nums"
                    >
                      <AnimatedNumber value={entry.current_score} duration={0.52} />
                    </motion.p>
                    <span className="mono-copy text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">band {entry.band}</span>
                  </div>
                </div>
                <motion.span
                  initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: motionDurations.fast, ease: motionEase.standard }}
                  className={`inline-flex rounded-full border px-3 py-1 mono-copy text-[11px] uppercase tracking-[0.18em] ${toneClasses(tone)}`}
                >
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                </motion.span>
              </div>
              <p className="mt-3 text-sm text-[var(--text-secondary)]">trust band updated by the latest event.</p>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}

function QuarantinesPanel({ quarantines, reducedMotion }) {
  return (
    <>
      <SectionHeader eyebrow="Containment" title="Current Quarantines" detail="controlled reroute" />
      <div className="flex min-h-[180px] flex-col gap-3">
        {quarantines.length === 0 ? (
          <div className="rounded-[12px] border border-white/6 bg-white/[0.02] px-4 py-4 text-sm text-[var(--text-secondary)]">
            No quarantines active.
          </div>
        ) : (
          quarantines.map((entry, index) => {
            const isLead = index === 0;
            const validator = entry.recommended_validators?.[0]?.subject_id ?? "pending";

            return (
              <motion.div
                key={entry.resolution_id}
                initial="initial"
                animate={isLead ? "critical" : "initial"}
                variants={quarantineSequence}
                className="relative overflow-hidden rounded-[12px] border border-white/6 bg-white/[0.02] px-4 py-4"
              >
                {isLead && !reducedMotion ? (
                  <motion.div
                    aria-hidden="true"
                    className="absolute inset-0"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.08, 0] }}
                    transition={{ duration: motionDurations.standard, ease: motionEase.standard }}
                    style={{ background: "linear-gradient(90deg, rgba(255,93,115,0.1), transparent 72%)" }}
                  />
                ) : null}
                <div className="relative flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">quarantine</span>
                      <span className="text-sm text-white">{entry.subject_id}</span>
                    </div>
                    <p className="mt-2 text-sm text-white">
                      score {entry.score} · {entry.decision}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{entry.reason_codes.join(" · ")}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="inline-flex rounded-full border border-[rgba(255,93,115,0.16)] bg-[rgba(255,93,115,0.08)] px-3 py-1 mono-copy text-[11px] uppercase tracking-[0.16em] text-[var(--danger)]">
                        trace {entry.trace_id}
                      </span>
                      <span className="inline-flex rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 mono-copy text-[11px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                        validator {validator}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <LockGlyph active />
                    <motion.span
                      initial={{ opacity: 0, x: reducedMotion ? 0 : 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.12, duration: motionDurations.fast, ease: motionEase.standard }}
                      className="inline-flex rounded-full border border-[rgba(255,93,115,0.18)] bg-[rgba(255,93,115,0.08)] px-3 py-1 mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--danger)]"
                    >
                      quarantined
                    </motion.span>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </>
  );
}

function RoutingPanel({ routes, dimmedSubjectId, reducedMotion }) {
  return (
    <>
      <SectionHeader eyebrow="Routing" title="Validator Routing Stream" detail="work selection / validator choice" />
      <div className="flex min-h-[180px] flex-col gap-3">
        {routes.map((route) => {
          const isDimmed = dimmedSubjectId && route.subject_id === dimmedSubjectId;
          const selected = route.selected[0];
          const selectedCount = route.quorum?.selected_count ?? route.selected.length;
          const requiredCount = route.quorum?.required_count ?? route.selected.length;

          return (
            <motion.div
              key={route.routing_id}
              layout
              className="relative overflow-hidden rounded-[12px] border border-white/6 bg-white/[0.02] px-4 py-4"
              animate={{
                opacity: isDimmed ? 0.5 : 1,
                borderColor: route.rerouted ? "rgba(0,255,159,0.14)" : "rgba(255,255,255,0.06)"
              }}
              transition={{ duration: motionDurations.standard, ease: motionEase.standard }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{route.task_id}</p>
                  <div className="mt-2 flex items-center gap-2 text-sm text-white">
                    <span>{route.subject_id}</span>
                    <motion.span
                      aria-hidden="true"
                      animate={route.rerouted && !reducedMotion ? { x: [0, 6, 0] } : { x: 0 }}
                      transition={
                        route.rerouted && !reducedMotion
                          ? { duration: 0.72, ease: motionEase.standard }
                          : { duration: motionDurations.fast, ease: motionEase.standard }
                      }
                    >
                      <ArrowGlyph className={route.rerouted ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
                    </motion.span>
                    <span className="text-[var(--accent)]">{selected?.subject_id ?? "none"}</span>
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-secondary)]">
                    quorum {selectedCount}/{requiredCount} · {route.reroute_reason ?? "stable"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {route.selected.map((entry, selectedIndex) => (
                      <motion.span
                        key={entry.subject_id}
                        initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: selectedIndex * 0.04, duration: 0.18, ease: motionEase.standard }}
                        className="inline-flex rounded-full border border-[rgba(0,255,159,0.16)] bg-[rgba(0,255,159,0.08)] px-3 py-1 mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]"
                      >
                        {entry.subject_id}
                      </motion.span>
                    ))}
                    {route.rejected.map((entry, rejectedIndex) => (
                      <motion.span
                        key={entry.subject_id}
                        initial={{ opacity: 0, x: reducedMotion ? 0 : 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.18 + rejectedIndex * 0.04, duration: 0.18, ease: motionEase.standard }}
                        className="inline-flex rounded-full border border-[rgba(255,200,87,0.16)] bg-[rgba(255,200,87,0.08)] px-3 py-1 mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--warning)]"
                      >
                        rejected
                      </motion.span>
                    ))}
                  </div>
                </div>
                <span className={`inline-flex rounded-full border px-3 py-1 mono-copy text-[11px] uppercase tracking-[0.18em] ${toneClasses(route.rerouted ? "positive" : "neutral")}`}>
                  {route.route_type}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}

function TrustGraphPanel({ clusterMap, routes, latestSignal, reducedMotion }) {
  const nodes = useMemo(() => subjectPositions(clusterMap.map((entry) => entry.subject_id)), [clusterMap]);
  const metricsById = useMemo(
    () => new Map(clusterMap.map((entry) => [entry.subject_id, entry])),
    [clusterMap]
  );
  const routeEdges = useMemo(
    () =>
      routes.slice(0, 3).map((route, index) => ({
        id: `${route.routing_id}_${index}`,
        from: route.subject_id,
        to: route.selected[0]?.subject_id ?? route.subject_id
      })),
    [routes]
  );

  const activeSubjectId = latestSignal?.subject_id ?? clusterMap[0]?.subject_id;
  const activeNode = nodes.find((node) => node.subjectId === activeSubjectId) ?? nodes[0];
  const pan = activeNode ? { x: 50 - activeNode.x, y: 42 - activeNode.y } : { x: 0, y: 0 };

  return (
    <>
      <SectionHeader eyebrow="Graph" title="Trust Graph Cluster Map" detail="recentered on latest signal" />
      <div className="relative min-h-[260px] overflow-hidden rounded-[12px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))]">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 84" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <motion.g animate={{ x: pan.x, y: pan.y }} transition={{ duration: 0.32, ease: motionEase.standard }}>
            {routeEdges.map((edge) => {
              const from = nodes.find((node) => node.subjectId === edge.from);
              const to = nodes.find((node) => node.subjectId === edge.to);
              const fromMetrics = metricsById.get(edge.from);
              const isActiveEdge = latestSignal?.subject_id === edge.from;
              const collapseEdge = latestSignal?.event_type === "trust.collapse" && edge.from === latestSignal.subject_id;
              const suspiciousEdge = !collapseEdge && Boolean(fromMetrics && fromMetrics.collusion_risk > 0.72);
              if (!from || !to) {
                return null;
              }

              return (
                <motion.line
                  key={edge.id}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={collapseEdge ? "rgba(255,93,115,0.34)" : "rgba(0,255,159,0.24)"}
                  strokeWidth={collapseEdge ? 0.75 : 0.68}
                  animate={
                    reducedMotion
                      ? { opacity: collapseEdge ? 0.44 : isActiveEdge ? 0.56 : suspiciousEdge ? 0.28 : 0.24 }
                      : collapseEdge
                        ? { opacity: [0.24, 0.82, 0.32], pathLength: [1, 0.92, 1] }
                        : isActiveEdge
                          ? { opacity: [0.28, 0.78, 0.36] }
                          : suspiciousEdge
                            ? { opacity: [0.18, 0.28, 0.2] }
                            : { opacity: 0.24 }
                  }
                  transition={
                    reducedMotion
                      ? { duration: motionDurations.fast, ease: motionEase.standard }
                      : collapseEdge || isActiveEdge
                        ? { duration: 0.6, ease: motionEase.standard }
                        : suspiciousEdge
                          ? {
                              duration: 4.4,
                              ease: motionEase.standard,
                              repeat: Number.POSITIVE_INFINITY,
                              repeatType: "reverse"
                            }
                          : { duration: 0.24, ease: motionEase.standard }
                  }
                />
              );
            })}

            {nodes.map((node) => {
              const metrics = metricsById.get(node.subjectId);
              const isActive = latestSignal?.subject_id === node.subjectId;
              const isCollapsed = latestSignal?.event_type === "trust.collapse" && latestSignal.subject_id === node.subjectId;
              const radius = 4 + Math.round((metrics?.collusion_risk ?? 0.2) * 4);
              const weight = Math.round(((metrics?.closed_cluster_density ?? 0.25) + 0.6) * 4);

              return (
                <g key={node.subjectId}>
                  {!reducedMotion && isActive ? (
                    <motion.circle
                      cx={node.x}
                      cy={node.y}
                      r={radius + 1}
                      fill="transparent"
                      stroke={isCollapsed ? "rgba(255,93,115,0.4)" : "rgba(0,255,159,0.35)"}
                      strokeWidth="0.6"
                      animate={{ r: [radius + 1, radius + 6], opacity: [0.52, 0] }}
                      transition={{ duration: 0.56, ease: motionEase.standard }}
                    />
                  ) : null}
                  <motion.circle
                    cx={node.x}
                    cy={node.y}
                    r={radius}
                    fill={isCollapsed ? "rgba(255,93,115,0.9)" : isActive ? "rgba(0,255,159,0.92)" : "rgba(255,255,255,0.82)"}
                    animate={{ r: radius, opacity: isCollapsed ? 1 : isActive ? 1 : 0.92 }}
                    transition={{ duration: motionDurations.standard, ease: motionEase.standard }}
                  />
                  {!reducedMotion && (metrics?.collusion_risk ?? 0) > 0.74 ? (
                    <motion.circle
                      cx={node.x}
                      cy={node.y}
                      r={radius + 2}
                      fill="transparent"
                      stroke="rgba(255,200,87,0.18)"
                      strokeWidth="0.45"
                      animate={{ opacity: [0.18, 0.34, 0.18], r: [radius + 2, radius + 3, radius + 2] }}
                      transition={{
                        duration: 4.8,
                        ease: motionEase.standard,
                        repeat: Number.POSITIVE_INFINITY,
                        repeatType: "reverse"
                      }}
                    />
                  ) : null}
                  <text x={node.x} y={node.y + radius + 5} textAnchor="middle" fill="rgba(255,255,255,0.62)" fontSize="3.2" fontFamily="var(--font-mono)">
                    {node.subjectId}
                  </text>
                  <text x={node.x} y={node.y - radius - 3} textAnchor="middle" fill="rgba(255,255,255,0.34)" fontSize="2.5" fontFamily="var(--font-mono)">
                    w{weight}
                  </text>
                </g>
              );
            })}
          </motion.g>
        </svg>
      </div>
    </>
  );
}

function SimpleListPanel({ title, items, renderItem }) {
  return (
    <>
      <SectionHeader eyebrow="Observability" title={title} detail="operator view" />
      <div className="flex min-h-[180px] flex-col gap-3">
        {items.length === 0 ? (
          <div className="rounded-[12px] border border-white/6 bg-white/[0.02] px-4 py-4 text-sm text-[var(--text-secondary)]">No events yet.</div>
        ) : (
          items.map(renderItem)
        )}
      </div>
    </>
  );
}

export function WarRoomDashboard() {
  const reducedMotion = useReducedMotionSafe();
  const { warRoomState, connectionStatus, lastEvent, traceOutput, lookupTrace, latestSignal, sourceMode } = useWarRoomState();
  const [traceId, setTraceId] = useState("");

  const leadQuarantineSubject = warRoomState.current_quarantines[0]?.subject_id ?? null;
  const statusTone = connectionStatus === "Streaming" ? "positive" : connectionStatus === "Unauthorized" ? "watch" : "neutral";

  async function handleSubmit(event) {
    event.preventDefault();
    await lookupTrace(traceId.trim());
  }

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[var(--bg)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,255,159,0.08),_transparent_0,_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(255,255,255,0.03),_transparent_0,_transparent_24%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1280px] flex-col px-4 pb-16 pt-6 sm:px-6 lg:px-10">
        <motion.div variants={fadeUp({ distance: 12, duration: 0.24, reducedMotion })} initial="hidden" animate="show" className="mb-8 flex items-center justify-between gap-4">
          <Link href="/" className="mono-copy text-[13px] uppercase tracking-[0.28em] text-[var(--accent)]">
            ← Infopunks
          </Link>
          <span className={`inline-flex rounded-full border px-3 py-1 mono-copy text-[11px] uppercase tracking-[0.18em] ${toneClasses(statusTone)}`}>
            {connectionStatus} / {sourceMode}
          </span>
        </motion.div>

        <motion.section
          variants={fadeUp({ distance: 12, duration: 0.24, reducedMotion })}
          initial="hidden"
          animate="show"
          className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
        >
          <div>
            <p className="mono-copy text-[12px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Infopunks Trust Layer V1</p>
            <h1 className="mt-2 text-[44px] font-medium leading-[0.94] tracking-[-0.05em] text-white sm:text-[72px]">War Room</h1>
            <p className="mt-4 max-w-[700px] text-lg leading-8 text-[var(--text-secondary)]">
              Live trust movement, validator routing, quarantines, and replay-ready traces.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="surface-card min-w-[170px] px-4 py-4">
              <span className="block mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">API</span>
              <strong className="mt-2 block text-xl text-white">{connectionStatus}</strong>
            </div>
            <div className="surface-card min-w-[200px] px-4 py-4">
              <span className="block mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Last Event</span>
              <strong className="mt-2 block text-sm leading-6 text-white">{lastEvent}</strong>
            </div>
          </div>
        </motion.section>

        <RevealGroup as="section" className="grid grid-cols-1 gap-4 xl:grid-cols-12" staggerChildren={0.03}>
          <Panel reducedMotion={reducedMotion} className="xl:row-span-2">
            <EventFeedPanel events={warRoomState.live_trust_event_feed.slice(0, 10)} reducedMotion={reducedMotion} />
          </Panel>

          <Panel reducedMotion={reducedMotion}>
            <MoversPanel movers={warRoomState.top_score_movers.slice(0, 5)} reducedMotion={reducedMotion} />
          </Panel>

          <Panel reducedMotion={reducedMotion}>
            <QuarantinesPanel quarantines={warRoomState.current_quarantines.slice(0, 4)} reducedMotion={reducedMotion} />
          </Panel>

          <Panel reducedMotion={reducedMotion} wide>
            <RoutingPanel routes={warRoomState.validator_routing_stream.slice(0, 5)} dimmedSubjectId={leadQuarantineSubject} reducedMotion={reducedMotion} />
          </Panel>

          <Panel reducedMotion={reducedMotion}>
            <TrustGraphPanel
              clusterMap={warRoomState.trust_graph_cluster_map.slice(0, 5)}
              routes={warRoomState.validator_routing_stream.slice(0, 3)}
              latestSignal={latestSignal}
              reducedMotion={reducedMotion}
            />
          </Panel>

          <Panel reducedMotion={reducedMotion}>
            <SimpleListPanel
              title="Recent Alerts"
              items={warRoomState.recent_alerts.slice(0, 4)}
              renderItem={(event) => (
                <motion.div
                  key={event.event_id}
                  layout
                  className="rounded-[12px] border border-white/6 bg-white/[0.02] px-4 py-4"
                  animate={{ borderColor: event.data?.severity === "critical" ? "rgba(255,93,115,0.18)" : "rgba(255,255,255,0.06)" }}
                  transition={{ duration: motionDurations.standard, ease: motionEase.standard }}
                >
                  <p className="text-sm text-white">{event.event_type}</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                    {event.subject_id} · {event.data?.reason ?? "state change observed"}
                  </p>
                </motion.div>
              )}
            />
          </Panel>

          <Panel reducedMotion={reducedMotion}>
            <SimpleListPanel
              title="Replay Activity"
              items={warRoomState.recent_trace_replays.slice(0, 4)}
              renderItem={(event) => (
                <div key={event.event_id} className="rounded-[12px] border border-white/6 bg-white/[0.02] px-4 py-4">
                  <p className="text-sm text-white">{event.trace_id ?? event.data?.trace_id ?? "trace replay"}</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{event.event_type} · {event.subject_id}</p>
                </div>
              )}
            />
          </Panel>

          <Panel reducedMotion={reducedMotion}>
            <SectionHeader eyebrow="Trace" title="Trace Replay" detail="lookup by trace_id" />
            <form onSubmit={handleSubmit} className="mb-3 flex gap-3">
              <input
                value={traceId}
                onChange={(event) => setTraceId(event.target.value)}
                className="min-w-0 flex-1 rounded-[12px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-[var(--text-muted)]"
                placeholder="Paste trace_id"
                spellCheck="false"
              />
              <button type="submit" className="button-primary px-4 py-3 text-sm font-medium">
                Replay
              </button>
            </form>
            <pre className="mono-copy min-h-[260px] overflow-auto rounded-[12px] bg-[var(--surface-strong)] p-4 text-[12px] leading-6 text-[var(--text-secondary)]">
              {traceOutput}
            </pre>
          </Panel>
        </RevealGroup>
      </div>
    </main>
  );
}
