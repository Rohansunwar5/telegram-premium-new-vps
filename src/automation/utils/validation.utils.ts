/**
 * Utility functions for validating Bot search query results via Playwright.
 */

/**
 * Normalizes a lookup value by trimming whitespace, removing leading '@' characters, and converting to lowercase.
 * This readies the user's frontend query to be strictly matched against scraping results.
 * @param value The raw search string (query we sent).
 * @returns The normalized search string.
 */
export function normalizeLookupValue(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

/**
 * Checks if a bot message text corresponds STRICTLY to the query requested by the user.
 * Ensures that username and title matches are exact to prevent false positives from partial overlaps.
 * Crucially handles 'no results' outputs from the bot so it falls-back securely.
 * This runs natively at the server level (not within evaluate()). 
 * @param text The raw message text parsed from the DOM.
 * @param normalizedQuery The formatted lookup string we are comparing it with.
 * @param queryIsNumeric Whether the search was strictly an ID query.
 * @returns boolean true if the message strictly relates to the requested query.
 */
export function messageMatchesQuery(text: string, normalizedQuery: string, queryIsNumeric: boolean): boolean {
  if (!normalizedQuery) return true;

  const normalizedText = String(text || '').toLowerCase();
  
  // IMMEDIATELY ABORT validation if bot returned "there are no results for this search"
  // This explicitly prevents it from validating random older outputs below it in the chat DOM.
  if (normalizedText.includes('there are no results for this search') || normalizedText.includes('no results found')) {
    return false;
  }

  // Strict numeric id regex matching (since names can't purely be digits natively)
  if (queryIsNumeric) {
    return new RegExp(`id\\s*:\\s*${normalizedQuery}\\b`, 'i').test(normalizedText);
  }

  // Exact matching against specific @ handles via MatchAll
  const handleMatches = Array.from(normalizedText.matchAll(/@([a-z0-9_]{3,})/g)).map((match) => match[1]);
  if (handleMatches.includes(normalizedQuery)) {
    return true;
  }

  // Parses username explicitly checking line content
  const usernameLine = normalizedText.match(/username\s*:\s*([^\n]+)/i)?.[1]?.trim() || '';
  // Force exactly-equal comparisons to circumvent `foo` substring-matching `foobar` incorrectly
  if (usernameLine === normalizedQuery || usernameLine.replace(/^@/, '') === normalizedQuery) {
    return true;
  }

  // Parses title explicitly checking line content
  const titleLine = normalizedText.match(/title\s*:\s*([^\n]+)/i)?.[1]?.trim() || '';
  return titleLine === normalizedQuery;
}
