import { ok, fail } from '../../lib/respond.js';
import { fetchJSON } from '../../lib/http.js';

/**
 * Geo/ASN lookup for an IP address. Leave "ip" empty to inspect the caller.
 */
export default {
  name: 'IP Lookup',
  desc: 'Info lokasi, ISP, dan ASN dari sebuah IP',
  category: 'Information',
  path: '/v1/info/ip',
  method: 'GET',
  params: [{ name: 'ip', required: false, placeholder: 'Enter IP (kosong = IP kamu)' }],

  async handler({ params, request }) {
    const target = params.ip || request.headers.get('cf-connecting-ip') || '';
    const fields = 'status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,query';
    const { ok: fine, data } = await fetchJSON(`http://ip-api.com/json/${encodeURIComponent(target)}?fields=${fields}`);

    if (!fine || !data || data.status !== 'success') {
      return fail(data?.message || 'Gagal melakukan lookup IP', 502);
    }

    return ok({
      ip: data.query,
      country: data.country,
      country_code: data.countryCode,
      region: data.regionName,
      city: data.city,
      zip: data.zip,
      latitude: data.lat,
      longitude: data.lon,
      timezone: data.timezone,
      isp: data.isp,
      org: data.org,
      asn: data.as,
    });
  },
};
