const levels = ["debug", "info", "warn", "error"];

export class Logger {
  constructor(level = "info") {
    this.level = levels.includes(level) ? level : "info";
  }

  shouldLog(level) {
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  log(level, payload) {
    if (!this.shouldLog(level)) {
      return;
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), level, service: "infopunks.mcp-adapter", ...payload });
    if (level === "error") {
      process.stderr.write(`${line}\n`);
      return;
    }
    process.stdout.write(`${line}\n`);
  }

  debug(payload) { this.log("debug", payload); }
  info(payload) { this.log("info", payload); }
  warn(payload) { this.log("warn", payload); }
  error(payload) { this.log("error", payload); }
}
