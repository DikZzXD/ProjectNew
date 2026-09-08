import { ok, fail } from '../../lib/respond.js';
import { fetchJSON } from '../../lib/http.js';

/**
 * Current weather for a city, sourced from wttr.in.
 */
export default {
  name: 'Weather',
  desc: 'Cuaca terkini berdasarkan nama kota',
  category: 'Information',
  path: '/v1/info/weather',
  method: 'GET',
  params: [{ name: 'city', required: true, placeholder: 'Enter city (contoh: Jakarta)' }],

  async handler({ params }) {
    const { ok: fine, data } = await fetchJSON(`https://wttr.in/${encodeURIComponent(params.city)}?format=j1`);

    if (!fine || !data?.current_condition?.[0]) return fail('Kota tidak ditemukan atau sumber sedang sibuk', 502);

    const now = data.current_condition[0];
    const area = data.nearest_area?.[0] || {};

    return ok({
      location: [area.areaName?.[0]?.value, area.region?.[0]?.value, area.country?.[0]?.value]
        .filter(Boolean)
        .join(', '),
      condition: now.weatherDesc?.[0]?.value,
      temperature_c: Number(now.temp_C),
      feels_like_c: Number(now.FeelsLikeC),
      humidity: Number(now.humidity),
      wind_kmph: Number(now.windspeedKmph),
      wind_dir: now.winddir16Point,
      pressure_mb: Number(now.pressure),
      visibility_km: Number(now.visibility),
      uv_index: Number(now.uvIndex),
      observed_at: now.localObsDateTime,
    });
  },
};
