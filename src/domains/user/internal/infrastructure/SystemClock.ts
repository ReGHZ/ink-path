import type { Clock } from "../application/ports/Clock.js";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export function createSystemClock(): Clock {
  return new SystemClock();
}
