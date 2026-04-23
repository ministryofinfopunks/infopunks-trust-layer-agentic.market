import { makeAdapterError } from "../schemas/error-schema.mjs";
import { MemoryRateLimitStrategy } from "./rate-limit-strategy.mjs";

export class AdapterRateLimiter {
  constructor(limitPerMinute, strategy = null) {
    this.limitPerMinute = limitPerMinute;
    this.strategy = strategy ?? new MemoryRateLimitStrategy();
  }

  async hit(key) {
    const count = await this.strategy.hit(key);

    if (count > this.limitPerMinute) {
      throw makeAdapterError("ENTITLEMENT_REQUIRED", "Rate limit exceeded.", { limit_per_minute: this.limitPerMinute }, true, 429);
    }
  }
}
