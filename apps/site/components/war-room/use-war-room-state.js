"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { advanceMockWarRoomState, createMockWarRoomState, mockTraceReplay } from "./mock-state";

const DEFAULT_API_KEY = "dev-infopunks-read-key";
const PAID_EVENTS_POLL_MS = 4000;

function formatEventLabel(event) {
  return `${event.event_type ?? event.type} · ${event.subject_id ?? event.subject}`;
}

export function useWarRoomState() {
  const [warRoomState, setWarRoomState] = useState(() => createMockWarRoomState());
  const [connectionStatus, setConnectionStatus] = useState("Booting");
  const [lastEvent, setLastEvent] = useState("Waiting");
  const [traceOutput, setTraceOutput] = useState("Awaiting trace lookup.");
  const [sourceMode, setSourceMode] = useState("simulated");
  const [latestSignal, setLatestSignal] = useState(null);

  const streamAbortRef = useRef(null);
  const mockTimerRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const tickRef = useRef(0);
  const apiKeyRef = useRef(DEFAULT_API_KEY);

  const stopMockLoop = useCallback(() => {
    if (mockTimerRef.current) {
      window.clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }
  }, []);

  const stopPendingRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const fetchJson = useCallback(async (url) => {
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${apiKeyRef.current}`
      }
    });

    if (response.status === 401) {
      throw new Error("unauthorized");
    }

    if (!response.ok) {
      throw new Error("offline");
    }

    return response.json();
  }, []);

  const loadLiveState = useCallback(async () => {
    const state = await fetchJson("/v1/war-room/state");
    let paidEvents = [];
    try {
      const paidFeed = await fetchJson("/api/war-room/events");
      paidEvents = Array.isArray(paidFeed?.events)
        ? paidFeed.events.map((event) => ({
            event_type: event.event_type,
            subject_id: event.subject_id,
            severity: event.status ?? event.mode ?? "",
            data: event
          }))
        : [];
    } catch {
      paidEvents = [];
    }

    const nextState = paidEvents.length > 0
      ? {
          ...state,
          live_trust_event_feed: paidEvents
        }
      : state;
    setWarRoomState(nextState);
    setLatestSignal(nextState.live_trust_event_feed?.[0] ?? null);
    setLastEvent(nextState.live_trust_event_feed?.[0] ? formatEventLabel(nextState.live_trust_event_feed[0]) : "Waiting");
  }, [fetchJson]);

  const queueLiveRefresh = useCallback(() => {
    stopPendingRefresh();
    refreshTimerRef.current = window.setTimeout(() => {
      loadLiveState().catch(() => {
        // Keep the current live view if a state refresh blips.
      });
    }, 220);
  }, [loadLiveState, stopPendingRefresh]);

  const queueMockTick = useCallback(() => {
    stopMockLoop();

    const scheduleNextTick = () => {
      const delay = 1380 + (tickRef.current % 4) * 180;

      mockTimerRef.current = window.setTimeout(() => {
        setWarRoomState((current) => {
          const next = advanceMockWarRoomState(current, tickRef.current);
          tickRef.current += 1;
          setLatestSignal(next.event);
          setLastEvent(formatEventLabel(next.event));
          return next.state;
        });

        scheduleNextTick();
      }, delay);
    };

    scheduleNextTick();
  }, [stopMockLoop]);

  const startMockLoop = useCallback(() => {
    stopMockLoop();
    setSourceMode("simulated");
    setConnectionStatus("Simulated");
    queueMockTick();
  }, [queueMockTick, stopMockLoop]);

  useEffect(() => {
    try {
      apiKeyRef.current = window.localStorage.getItem("INFOPUNKS_API_KEY") || DEFAULT_API_KEY;
    } catch {
      apiKeyRef.current = DEFAULT_API_KEY;
    }

    let closed = false;

    async function connectStream() {
      stopMockLoop();
      stopPendingRefresh();
      setConnectionStatus("Connecting");

      try {
        await loadLiveState();

        const controller = new AbortController();
        streamAbortRef.current = controller;

        const response = await fetch("/v1/events/stream?since=0", {
          headers: {
            authorization: `Bearer ${apiKeyRef.current}`
          },
          signal: controller.signal
        });

        if (response.status === 401) {
          throw new Error("unauthorized");
        }

        if (!response.ok || !response.body) {
          throw new Error("offline");
        }

        if (closed) {
          return;
        }

        setSourceMode("live");
        setConnectionStatus("Streaming");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) {
            throw new Error("stream-ended");
          }

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";

          for (const frame of frames) {
            const dataLine = frame
              .split("\n")
              .find((line) => line.startsWith("data: "));

            if (!dataLine) {
              continue;
            }

            try {
              const payload = JSON.parse(dataLine.slice(6));
              if (!payload.event_type && !payload.type) {
                continue;
              }

              setLatestSignal(payload);
              setLastEvent(formatEventLabel(payload));
              queueLiveRefresh();
            } catch {
              // Ignore malformed stream frames and continue.
            }
          }
        }
      } catch (error) {
        if (closed) {
          return;
        }

        setConnectionStatus(error.message === "unauthorized" ? "Unauthorized" : "Simulated");
        startMockLoop();
      }
    }

    connectStream();
    const paidPoll = window.setInterval(() => {
      loadLiveState().catch(() => {
        // Keep prior state when paid feed polling fails.
      });
    }, PAID_EVENTS_POLL_MS);

    return () => {
      closed = true;
      window.clearInterval(paidPoll);
      stopMockLoop();
      stopPendingRefresh();
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }
    };
  }, [loadLiveState, queueLiveRefresh, startMockLoop, stopMockLoop, stopPendingRefresh]);

  const lookupTrace = useCallback(
    async (traceId) => {
      if (!traceId) {
        return;
      }

      setTraceOutput("Resolving trace...");

      try {
        const payload = await fetchJson(`/v1/traces/${encodeURIComponent(traceId)}`);
        setTraceOutput(JSON.stringify(payload, null, 2));
      } catch (error) {
        setTraceOutput(JSON.stringify(mockTraceReplay(traceId), null, 2));
      }
    },
    [fetchJson]
  );

  return useMemo(
    () => ({
      warRoomState,
      connectionStatus,
      lastEvent,
      traceOutput,
      latestSignal,
      sourceMode,
      lookupTrace
    }),
    [connectionStatus, lastEvent, latestSignal, lookupTrace, sourceMode, traceOutput, warRoomState]
  );
}
