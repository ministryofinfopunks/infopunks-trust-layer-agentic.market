const feed = document.querySelector("#event-feed");
const apiStatus = document.querySelector("#api-status");
const lastEvent = document.querySelector("#last-event");

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown time" : date.toLocaleString();
}

function renderEvent(event) {
  const item = document.createElement("div");
  item.className = "event-card";
  item.innerHTML = `
    <div class="event-card__top">
      <strong>${event.event_type ?? "paid_call.event"}</strong>
      <span>${formatTime(event.timestamp)}</span>
    </div>
    <div class="event-card__body">
      <span>subject ${event.subject_id ?? "n/a"}</span>
      <span>payer ${event.payer ?? "n/a"}</span>
      <span>score ${event.trust_score ?? "n/a"}</span>
      <span>status ${event.status ?? "n/a"}</span>
      <span>receipt ${event.receipt_id ?? "n/a"}</span>
    </div>
  `;
  return item;
}

async function refresh() {
  try {
    const response = await fetch("/api/war-room/events", { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`event feed returned ${response.status}`);
    }
    const payload = await response.json();
    const events = Array.isArray(payload.events) ? payload.events : [];
    feed.replaceChildren(...events.map(renderEvent));
    apiStatus.textContent = "Connected";
    lastEvent.textContent = events[0]?.event_type ?? "Waiting";
  } catch (error) {
    apiStatus.textContent = "Offline";
    lastEvent.textContent = "Feed unavailable";
    feed.replaceChildren(Object.assign(document.createElement("pre"), {
      className: "trace-output",
      textContent: error?.message ?? "Unable to load paid-call events."
    }));
  }
}

refresh();
setInterval(refresh, 5000);
