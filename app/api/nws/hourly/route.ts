const NWS_ORIGIN = "https://api.weather.gov";
const NWS_USER_AGENT = "ClearWeather/1.0 (https://clear-weather.rtsoliday123.chatgpt.site/)";
type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function apiResponse(payload: Record<string, unknown>, status = 200, extra: HeadersInit = {}) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

function temperatureC(value: number, unit: string) {
  if (unit === "F") return (value - 32) * 5 / 9;
  if (unit === "C") return value;
  return Number.NaN;
}

async function nwsJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json",
      "User-Agent": NWS_USER_AGENT,
    },
    signal: AbortSignal.timeout(8_000),
  });
  return { response, payload: response.ok ? objectValue(await response.json()) : null };
}

async function handleNwsHourlyRequest(request: Request, url: URL) {
  if (request.method !== "GET") {
    return apiResponse({ error: "Method not allowed." }, 405, { Allow: "GET" });
  }
  const latitudeText = url.searchParams.get("latitude");
  const longitudeText = url.searchParams.get("longitude");
  const latitude = latitudeText?.trim() ? Number(latitudeText) : Number.NaN;
  const longitude = longitudeText?.trim() ? Number(longitudeText) : Number.NaN;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return apiResponse({ error: "Valid latitude and longitude are required." }, 400);
  }
  try {
    const pointUrl = `${NWS_ORIGIN}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const point = await nwsJson(pointUrl);
    if (point.response.status === 404) {
      return apiResponse({ covered: false, periods: [] }, 200, {
        "Cache-Control": "public, max-age=900",
      });
    }
    if (!point.response.ok || !point.payload) {
      return apiResponse({ error: "NWS point lookup is temporarily unavailable." }, 502);
    }
    const pointProperties = objectValue(point.payload.properties);
    const hourlyUrl = typeof pointProperties?.forecastHourly === "string"
      ? pointProperties.forecastHourly
      : "";
    let parsedHourlyUrl: URL;
    try {
      parsedHourlyUrl = new URL(hourlyUrl);
    } catch {
      return apiResponse({ error: "NWS point lookup returned an invalid forecast URL." }, 502);
    }
    if (parsedHourlyUrl.origin !== NWS_ORIGIN
      || !/^\/gridpoints\/[A-Z]{3}\/[0-9]+,[0-9]+\/forecast\/hourly$/.test(parsedHourlyUrl.pathname)) {
      return apiResponse({ error: "NWS point lookup returned an invalid forecast URL." }, 502);
    }
    const hourly = await nwsJson(parsedHourlyUrl.toString());
    if (!hourly.response.ok || !hourly.payload) {
      return apiResponse({ error: "NWS hourly forecast is temporarily unavailable." }, 502);
    }
    const properties = objectValue(hourly.payload.properties);
    const rawPeriods = Array.isArray(properties?.periods) ? properties.periods : [];
    const periods = rawPeriods.flatMap((raw): Array<{ start: number; end: number; temperatureC: number }> => {
      const period = objectValue(raw);
      const start = typeof period?.startTime === "string" ? Date.parse(period.startTime) : Number.NaN;
      const end = typeof period?.endTime === "string" ? Date.parse(period.endTime) : Number.NaN;
      const value = typeof period?.temperature === "number" ? period.temperature : Number.NaN;
      const unit = typeof period?.temperatureUnit === "string" ? period.temperatureUnit : "";
      const converted = temperatureC(value, unit);
      return Number.isFinite(start) && Number.isFinite(end) && end > start
        && Number.isFinite(converted) && converted >= -90 && converted <= 70
        ? [{ start, end, temperatureC: converted }]
        : [];
    });
    if (!periods.length) {
      return apiResponse({ error: "NWS hourly forecast did not contain usable temperatures." }, 502);
    }
    return apiResponse({
      covered: true,
      updatedAt: typeof properties?.updateTime === "string" ? properties.updateTime : undefined,
      periods,
    }, 200, { "Cache-Control": "public, max-age=300" });
  } catch {
    return apiResponse({ error: "Could not reach the NWS hourly forecast." }, 502);
  }
}


export async function GET(request: Request) {
  return handleNwsHourlyRequest(request, new URL(request.url));
}
