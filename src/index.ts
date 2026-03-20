#!/usr/bin/env node

/**
 * Weather MCP Server
 * Uses Open-Meteo API (free, no API key needed, works globally)
 *
 * Tools exposed to Claude:
 *   1. get_current_weather  — current conditions for any city
 *   2. get_forecast         — 1–7 day forecast for any city
 *   3. get_weather_by_coords — weather by latitude/longitude
 *
 * Resources exposed:
 *   weather://current/{city} — readable weather snapshot
 */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string; // state/province
}

interface CurrentWeather {
  temperature_2m: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
  weathercode: number;
  apparent_temperature: number;
  precipitation: number;
  is_day: number;
}

interface ForecastDay {
  date: string;
  temperature_max: number;
  temperature_min: number;
  precipitation_sum: number;
  wind_speed_max: number;
  weathercode: number;
}

// ─── Weather code → human readable ───────────────────────────────────────────

function describeWeatherCode(code: number): string {
  const codes: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Icy fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight showers",
    81: "Moderate showers",
    82: "Violent showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with heavy hail",
  };
  return codes[code] ?? `Unknown (code ${code})`;
}

function windDirection(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function geocode(city: string): Promise<GeoResult> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding request failed: ${res.statusText}`);

  const data = (await res.json()) as { results?: GeoResult[] };
  if (!data.results?.length) {
    throw new Error(`City not found: "${city}". Try a larger nearby city.`);
  }
  return data.results[0];
}

async function fetchCurrentWeather(
  lat: number,
  lon: number,
): Promise<CurrentWeather> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weathercode",
      "wind_speed_10m",
      "wind_direction_10m",
      "is_day",
    ].join(","),
    wind_speed_unit: "kmh",
    timezone: "auto",
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Weather API failed: ${res.statusText}`);

  const data = (await res.json()) as { current: CurrentWeather };
  return data.current;
}

async function fetchForecast(
  lat: number,
  lon: number,
  days: number,
): Promise<ForecastDay[]> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    daily: [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "wind_speed_10m_max",
      "weathercode",
    ].join(","),
    forecast_days: days.toString(),
    timezone: "auto",
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Forecast API failed: ${res.statusText}`);

  const data = (await res.json()) as {
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_sum: number[];
      wind_speed_10m_max: number[];
      weathercode: number[];
    };
  };

  return data.daily.time.map((date, i) => ({
    date,
    temperature_max: data.daily.temperature_2m_max[i],
    temperature_min: data.daily.temperature_2m_min[i],
    precipitation_sum: data.daily.precipitation_sum[i],
    wind_speed_max: data.daily.wind_speed_10m_max[i],
    weathercode: data.daily.weathercode[i],
  }));
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function formatCurrentWeather(location: GeoResult, w: CurrentWeather): string {
  const loc = [location.name, location.admin1, location.country]
    .filter(Boolean)
    .join(", ");

  return [
    `Weather in ${loc}`,
    `─────────────────────────────`,
    `Condition:    ${describeWeatherCode(w.weathercode)}`,
    `Temperature:  ${w.temperature_2m}°C (feels like ${w.apparent_temperature}°C)`,
    `Humidity:     ${w.relative_humidity_2m}%`,
    `Wind:         ${w.wind_speed_10m} km/h ${windDirection(w.wind_direction_10m)}`,
    `Precipitation:${w.precipitation} mm`,
    `Time of day:  ${w.is_day ? "Day" : "Night"}`,
  ].join("\n");
}

function formatForecast(location: GeoResult, days: ForecastDay[]): string {
  const loc = [location.name, location.admin1, location.country]
    .filter(Boolean)
    .join(", ");

  const header = `${days.length}-Day Forecast for ${loc}\n${"─".repeat(40)}`;
  const rows = days.map((d) =>
    [
      `${d.date}`,
      `  ${describeWeatherCode(d.weathercode)}`,
      `  High: ${d.temperature_max}°C  Low: ${d.temperature_min}°C`,
      `  Rain: ${d.precipitation_sum} mm  Wind: ${d.wind_speed_max} km/h`,
    ].join("\n"),
  );

  return [header, ...rows].join("\n\n");
}

// ─── MCP Server setup ─────────────────────────────────────────────────────────

const server = new McpServer({
  name: "weather-mcp-server",
  version: "1.0.0",
});

// Tool 1: Current weather by city name
server.tool(
  "get_current_weather",
  "Get the current weather conditions for any city in the world",
  {
    city: z
      .string()
      .describe("City name, e.g. 'Mumbai', 'Hyderabad', 'London'"),
  },
  async ({ city }) => {
    try {
      const location = await geocode(city);
      const weather = await fetchCurrentWeather(
        location.latitude,
        location.longitude,
      );
      const text = formatCurrentWeather(location, weather);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${msg}` }],
        isError: true,
      };
    }
  },
);

// Tool 2: Multi-day forecast by city name
server.tool(
  "get_forecast",
  "Get a weather forecast (1–7 days) for any city in the world",
  {
    city: z.string().describe("City name, e.g. 'Bangalore', 'Delhi', 'Tokyo'"),
    days: z
      .number()
      .int()
      .min(1)
      .max(7)
      .default(3)
      .describe("Number of days to forecast (1–7)"),
  },
  async ({ city, days }) => {
    try {
      const location = await geocode(city);
      const forecast = await fetchForecast(
        location.latitude,
        location.longitude,
        days,
      );
      const text = formatForecast(location, forecast);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${msg}` }],
        isError: true,
      };
    }
  },
);

// Tool 3: Weather by coordinates (useful for precise locations)
server.tool(
  "get_weather_by_coords",
  "Get current weather by latitude and longitude coordinates",
  {
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .describe("Latitude, e.g. 17.385 for Hyderabad"),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude, e.g. 78.4867 for Hyderabad"),
    label: z
      .string()
      .optional()
      .describe("Optional location label, e.g. 'My office'"),
  },
  async ({ latitude, longitude, label }) => {
    try {
      const weather = await fetchCurrentWeather(latitude, longitude);
      const fakeLocation: GeoResult = {
        name: label ?? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        latitude,
        longitude,
        country: "",
      };
      const text = formatCurrentWeather(fakeLocation, weather);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${msg}` }],
        isError: true,
      };
    }
  },
);

// Resource: weather://current/{city} — a readable snapshot
server.resource(
  "current-weather",
  new ResourceTemplate("weather://current/{city}", { list: undefined }),
  async (uri, { city }) => {
    const cityStr = Array.isArray(city) ? city[0] : city;
    const location = await geocode(cityStr);
    const weather = await fetchCurrentWeather(
      location.latitude,
      location.longitude,
    );
    const text = formatCurrentWeather(location, weather);
    return {
      contents: [{ uri: uri.href, text, mimeType: "text/plain" }],
    };
  },
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Use stderr — stdout is reserved for MCP JSON-RPC messages
  console.error("Weather MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
