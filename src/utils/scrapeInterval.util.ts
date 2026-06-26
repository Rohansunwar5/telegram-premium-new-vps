// Pure scrape-scheduling math, extracted from the bookmark.service god-object
// (M13). No I/O, no state — safe to unit test directly.

// Floor: never scrape a channel more often than this, no matter how busy it is.
export const MIN_SCRAPE_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Pick the next scrape interval from how far apart the last batch's messages were.
export const calculateScrapeInterval = (timeDifference: number): number => {
  // Very busy channel: clamp to the 30-minute floor.
  if (timeDifference < MIN_SCRAPE_INTERVAL) {
    return MIN_SCRAPE_INTERVAL;
  }
  // If messages span 30 min – 6 hours, scrape at the channel's own pace.
  if (timeDifference <= 6 * 60 * 60 * 1000) {
    return timeDifference;
  }
  // If messages span 6-24 hours, scrape every 6 hours
  if (timeDifference <= 24 * 60 * 60 * 1000) {
    return 6 * 60 * 60 * 1000; // 6 hours
  }
  // Otherwise, scrape once a day
  return 24 * 60 * 60 * 1000; // 24 hours
};

// Human-readable interval, e.g. "6h 0m" / "45m".
export const formatInterval = (ms: number): string => {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};
