const NWS_USER_AGENT = "ClearWeather/1.0 (https://clear-weather.rtsoliday123.chatgpt.site/)";
type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function textValue(value: unknown, length: number): string {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}

function apiResponse(payload: Record<string, unknown>, status = 200, cache = "no-store, max-age=0") {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": cache,
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const latitudeText = url.searchParams.get("latitude");
  const longitudeText = url.searchParams.get("longitude");
  const latitude = latitudeText?.trim() ? Number(latitudeText) : Number.NaN;
  const longitude = longitudeText?.trim() ? Number(longitudeText) : Number.NaN;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return apiResponse({ error: "Valid latitude and longitude are required." }, 400);
  }

  try {
    const point = latitude.toFixed(4) + "," + longitude.toFixed(4);
    const response = await fetch("https://api.weather.gov/alerts/active?point=" + point, {
      headers: {
        Accept: "application/geo+json",
        "User-Agent": NWS_USER_AGENT,
      },
      signal: AbortSignal.timeout(8_000),
    });
    // The point endpoint does not cover locations outside NWS service areas.
    if (response.status === 400 || response.status === 404) {
      return apiResponse({ alerts: [] }, 200, "public, max-age=120");
    }
    if (!response.ok) return apiResponse({ error: "NWS alerts are temporarily unavailable." }, 502);
    const payload = objectValue(await response.json());
    if (!payload || !Array.isArray(payload.features)) {
      return apiResponse({ error: "NWS returned an invalid alerts response." }, 502);
    }

    const now = Date.now();
    const alerts = payload.features.flatMap((raw, index) => {
      const feature = objectValue(raw);
      const properties = objectValue(feature?.properties);
      const event = textValue(properties?.event, 120);
      if (!/\b(warning|watch)$/i.test(event)) return [];
      if (typeof properties?.status === "string" && properties.status !== "Actual") return [];
      const expires = textValue(properties?.expires, 50);
      if (expires && Number.isFinite(Date.parse(expires)) && Date.parse(expires) <= now) return [];
      return [{
        id: textValue(feature?.id, 300) || textValue(properties?.id, 300) || event + "-" + index,
        event,
        headline: textValue(properties?.headline, 300) || event,
        description: textValue(properties?.description, 12000),
        instruction: textValue(properties?.instruction, 6000),
        severity: textValue(properties?.severity, 30),
        expires: expires || null,
      }];
    }).sort((a, b) => {
      const priority = (alert: { event: string; severity: string }) =>
        (/\bwarning$/i.test(alert.event) ? 0 : 2)
        + (alert.severity === "Extreme" ? 0 : alert.severity === "Severe" ? 0.25 : 0.5);
      return priority(a) - priority(b);
    });
    return apiResponse({ alerts }, 200, "public, max-age=60");
  } catch {
    return apiResponse({ error: "Could not reach NWS alerts." }, 502);
  }
}
