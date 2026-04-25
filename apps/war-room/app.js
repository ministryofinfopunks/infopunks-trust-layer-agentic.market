const apiKey = localStorage.getItem("INFOPUNKS_API_KEY") || "dev-infopunks-key";
const reconnectBaseMs = 1500;
const paidEventsPollMs = 4000;
let reconnectAttempt = 0;
let activeStream = null;
let paidEventPollHandle = null;

const nodes = {
  apiStatus: document.querySelector("#api-status"),
  lastEvent: document.querySelector("#last-event"),
  eventFeed: document.querySelector("#event-feed"),
  movers: document.querySelector("#movers"),
  quarantines: document.querySelector("#quarantines"),
  routing: document.querySelector("#routing"),
  clusters: document.querySelector("#clusters"),
  alerts: document.querySelector("#alerts"),
  replays: document.querySelector("#replays"),
  traceForm: document.querySelector("#trace-form"),
  traceId: document.querySelector("#trace-id"),
  traceOutput: document.querySelector("#trace-output")
};

function setStatus(text) {
  nodes.apiStatus.textContent = text;
}

function createItem(title, detail, badge = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "item";

  const content = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = title;
  const detailNode = document.createElement("p");
  detailNode.textContent = detail;
  content.append(strong, detailNode);
  wrapper.append(content);

  if (badge) {
    const badgeNode = document.createElement("span");
    badgeNode.className = "badge";
    badgeNode.textContent = badge;
    wrapper.append(badgeNode);
  }

  return wrapper;
}

function renderList(target, items, fallback) {
  target.replaceChildren();
  if (!items.length) {
    target.append(createItem("Waiting", fallback));
    return;
  }
  for (const entry of items) {
    target.append(entry);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  });
  if (response.status === 401) {
    throw new Error("unauthorized");
  }
  if (!response.ok) {
    throw new Error("offline");
  }
  return response.json();
}

async function loadState() {
  let hasPaidEvents = false;
  try {
    const paid = await fetchJson("/api/war-room/events");
    const paidEvents = Array.isArray(paid?.events) ? paid.events : [];
    if (paidEvents.length > 0) {
      hasPaidEvents = true;
      renderList(
        nodes.eventFeed,
        paidEvents.map((event) =>
          createItem(
            `${event.subject_id ?? "unknown_subject"} · ${event.status ?? "unknown"}`,
            [
              `payer ${event.payer ?? "unknown"}`,
              `score ${event.trust_score ?? "n/a"} (${event.trust_tier ?? "n/a"})`,
              `mode ${event.mode ?? "n/a"} · confidence ${event.confidence ?? "n/a"}`,
              `receipt ${event.receipt_id ?? "n/a"}`,
              event.reason ? `reason ${event.reason}` : null,
              event.error_code ? `error ${event.error_code}` : null
            ].filter(Boolean).join(" · "),
            event.mode ?? event.status ?? ""
          )
        ),
        "No trust calls yet."
      );
      nodes.lastEvent.textContent = `${paidEvents[0].event_type ?? "paid_call"} · ${paidEvents[0].subject_id ?? "unknown_subject"}`;
    }
  } catch {
    // Keep loading the existing war room state.
  }

  try {
    const state = await fetchJson("/v1/war-room/state");
    if (!hasPaidEvents) {
      renderList(
        nodes.eventFeed,
        state.live_trust_event_feed.map((event) =>
          createItem(`${event.event_type ?? event.type} · ${event.subject_id ?? event.subject}`, JSON.stringify(event.data ?? {}), event.severity ?? event.data?.severity ?? "")
        ),
        "No trust calls yet."
      );
    }
    renderList(
      nodes.movers,
      state.top_score_movers.map((entry) =>
        createItem(entry.subject_id, `score ${entry.current_score} · delta ${entry.delta}`, entry.band)
      ),
      "No score movement yet."
    );
    renderList(
      nodes.quarantines,
      state.current_quarantines.map((entry) =>
        createItem(entry.subject_id, `score ${entry.score} · ${entry.decision}`, entry.band)
      ),
      "No quarantines active."
    );
    renderList(
      nodes.routing,
      state.validator_routing_stream.map((entry) =>
        createItem(entry.task_id, `selected ${entry.selected.map((subject) => subject.subject_id).join(", ")}`, entry.route_type)
      ),
      "No routing activity yet."
    );
    renderList(
      nodes.clusters,
      state.trust_graph_cluster_map.map((entry) =>
        createItem(
          entry.subject_id,
          `collusion ${entry.collusion_risk} · cluster ${entry.closed_cluster_density} · diversity ${entry.validator_diversity_score}`
        )
      ),
      "No cluster metrics yet."
    );
    renderList(
      nodes.alerts,
      (state.recent_alerts ?? []).map((event) =>
        createItem(
          `${event.event_type ?? event.type} · ${event.subject_id ?? event.subject}`,
          JSON.stringify(event.data ?? {}),
          event.data?.severity ?? ""
        )
      ),
      "No active alerts yet."
    );
    renderList(
      nodes.replays,
      (state.recent_trace_replays ?? []).map((event) =>
        createItem(
          event.trace_id ?? event.data?.trace_id ?? "trace replay",
          `${event.event_type ?? event.type} · ${event.subject_id ?? event.subject}`,
          event.created_at ?? event.time ?? ""
        )
      ),
      "No replay activity yet."
    );
  } catch (error) {
    if (error.message === "unauthorized") {
      setStatus("Unauthorized");
      nodes.traceOutput.textContent = "Set INFOPUNKS_API_KEY in localStorage to access the War Room.";
      return;
    }
    setStatus("Offline");
  }
}

function scheduleReconnect() {
  reconnectAttempt += 1;
  const waitMs = Math.min(15000, reconnectBaseMs * reconnectAttempt);
  setStatus("Reconnecting");
  window.setTimeout(() => {
    connectEvents();
  }, waitMs);
}

async function connectEvents() {
  if (activeStream) {
    activeStream.abort();
  }

  const controller = new AbortController();
  activeStream = controller;
  setStatus("Connecting");

  try {
    const response = await fetch("/v1/events/stream?since=0", {
      headers: {
        authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    });
    if (response.status === 401) {
      setStatus("Unauthorized");
      return;
    }
    if (!response.ok || !response.body) {
      throw new Error("offline");
    }

    reconnectAttempt = 0;
    setStatus("Streaming");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
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
          if (payload.type || payload.event_type) {
            nodes.lastEvent.textContent = `${payload.event_type ?? payload.type} · ${payload.subject_id ?? payload.subject}`;
            await loadState();
          }
        } catch {
          // Ignore malformed event frames and continue streaming.
        }
      }
    }

    if (!controller.signal.aborted) {
      scheduleReconnect();
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      setStatus(error.message === "unauthorized" ? "Unauthorized" : "Offline");
      scheduleReconnect();
    }
  }
}

nodes.traceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const traceId = nodes.traceId.value.trim();
  if (!traceId) {
    return;
  }

  try {
    const payload = await fetchJson(`/v1/traces/${encodeURIComponent(traceId)}`);
    nodes.traceOutput.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    nodes.traceOutput.textContent =
      error.message === "unauthorized" ? "Unauthorized. Check the API key." : "Trace unavailable.";
  }
});

await loadState();
connectEvents();
if (paidEventPollHandle) {
  window.clearInterval(paidEventPollHandle);
}
paidEventPollHandle = window.setInterval(() => {
  loadState().catch(() => {
    // Keep current UI state on transient polling failures.
  });
}, paidEventsPollMs);
