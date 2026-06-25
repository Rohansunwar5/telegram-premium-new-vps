// Pure scrape-scheduling math, extracted from the bookmark.service god-object
// (M13). No I/O, no state — safe to unit test directly.

// Pick the next scrape interval from how far apart the last batch's messages were.
export const calculateScrapeInterval = (timeDifference: number): number => {
  // If messages span less than 1 hour, scrape every hour
  if (timeDifference < 60 * 60 * 1000) {
    return 60 * 60 * 1000; // 1 hour
  }
  // If messages span 1-6 hours, use that interval
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
