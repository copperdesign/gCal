/*! gCal — v0.1.1 - 2026-06-15
 * https://copperdesign.github.io/
 *
 * Copyright (c) 2026 Christian Fillies;
 * Licensed under the MIT license */

/**
 * @docs ../docs/fetch.md
 *
 * Thin wrapper around the Google Calendar v3 events endpoint.
 *
 * No retry, no caching — the rendering loop is "fetch → render once",
 * driven by the host page's consent flow. If a consumer needs polling
 * or revalidation, they can call `fetchEvents()` themselves and feed
 * the result into `GCal#render(items)`.
 */

const ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars';

/**
 * Build the Calendar API URL from a config object. Broken out so
 * tests can assert URL shape without making a real request.
 */
export function buildEventsUrl({
  calendarId,
  apiKey,
  maxResults = 100,
  orderBy    = 'startTime',
  singleEvents = true,
  timeMin    = new Date().toISOString(),
  timeMax,
  q,
}) {
  if (!calendarId) throw new Error('gCal: calendarId is required');
  if (!apiKey)     throw new Error('gCal: apiKey is required');

  // orderBy=startTime only works with singleEvents=true (Google's API
  // contract). Surface that constraint loudly so misconfigurations
  // don't silently produce empty result sets.
  if (orderBy === 'startTime' && !singleEvents) {
    throw new Error('gCal: orderBy=startTime requires singleEvents=true');
  }

  const params = new URLSearchParams({
    key: apiKey,
    maxResults: String(maxResults),
    orderBy,
    singleEvents: String(singleEvents),
    timeMin,
  });
  if (timeMax) params.set('timeMax', timeMax);
  if (q)       params.set('q', q);

  return `${ENDPOINT}/${encodeURIComponent(calendarId)}/events?${params}`;
}

/**
 * Fetch events, returning the items array (possibly empty).
 * Throws on network failure or non-2xx response — callers decide
 * whether to surface the error to the user.
 */
export async function fetchEvents(config, { signal } = {}) {
  const url = buildEventsUrl(config);
  const res = await fetch(url, { signal });
  if (!res.ok) {
    // Google returns structured JSON errors; prefer the `error.message`
    // when available because it's typically more actionable than the
    // HTTP status text (e.g. "API key not valid" vs "Bad Request").
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error?.message) detail = body.error.message;
    } catch { /* keep statusText */ }
    throw new Error(`gCal: ${detail}`);
  }
  const data = await res.json();
  return data.items ?? [];
}
