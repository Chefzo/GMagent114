// Tonight's weather for the pre-shift brief. Open-Meteo — no API key, no
// account, free for commercial use. Louisville coordinates are hardcoded; if
// One Fourteen ever runs a second room, lift these into gm_config.
//
// Returns null on any failure so the pre-shift brief still composes (weather is
// a nice-to-have, never a blocker).

const LOUISVILLE = { lat: 38.2527, lon: -85.7585, tz: 'America/Kentucky/Louisville' }

export interface TonightWeather {
  highF: number
  lowF: number
  precipChancePct: number
  summary: string
}

// Open-Meteo WMO weather codes → plain English. Abbreviated to the bands that
// actually change a bar night (rain/snow/storm vs. clear).
function describeCode(code: number): string {
  if (code === 0) return 'clear'
  if (code <= 3) return 'partly cloudy'
  if (code <= 48) return 'fog'
  if (code <= 67) return 'rain'
  if (code <= 77) return 'snow'
  if (code <= 82) return 'rain showers'
  if (code <= 86) return 'snow showers'
  return 'storms'
}

export async function getTonightWeather(): Promise<TonightWeather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LOUISVILLE.lat}&longitude=${LOUISVILLE.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(LOUISVILLE.tz)}&forecast_days=1`

  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as {
      daily?: {
        temperature_2m_max?: number[]
        temperature_2m_min?: number[]
        precipitation_probability_max?: number[]
        weather_code?: number[]
      }
    }
    const d = data.daily
    if (!d?.temperature_2m_max?.length) return null
    return {
      highF: Math.round(d.temperature_2m_max[0]),
      lowF: Math.round(d.temperature_2m_min?.[0] ?? d.temperature_2m_max[0]),
      precipChancePct: Math.round(d.precipitation_probability_max?.[0] ?? 0),
      summary: describeCode(d.weather_code?.[0] ?? 0),
    }
  } catch {
    return null
  }
}
