import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { Injectable } from '@nestjs/common';
import type { LocationProvider, StandardLocation } from '@satori/application';

type CatalogRecord = readonly [
  locationId: string,
  name: string,
  asciiName: string,
  hanNames: readonly string[],
  administrativeArea: string,
  countryCode: string,
  timezone: string,
  latitude: number,
  longitude: number,
  population: number,
];

interface CatalogPayload {
  metadata: {
    schemaVersion: string;
    catalogVersion: string;
    locationCount: number;
  };
  records: CatalogRecord[];
}

interface IndexedLocation {
  location: StandardLocation;
  citySearchNames: string[];
  pathSearchNames: string[];
  population: number;
}

const catalogPath = fileURLToPath(
  new URL('../../../../../assets/locations/world-cities.v1.json.gz', import.meta.url),
);
const catalog = parseCatalog(readFileSync(catalogPath));
const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const chineseAdministrativeAreas: Record<string, string> = {
  Anhui: '安徽省',
  Beijing: '北京市',
  Chongqing: '重庆市',
  Fujian: '福建省',
  Gansu: '甘肃省',
  'Guangdong Province': '广东省',
  Guangxi: '广西壮族自治区',
  Guizhou: '贵州省',
  'Hainan Province': '海南省',
  Hebei: '河北省',
  Heilongjiang: '黑龙江省',
  Henan: '河南省',
  Hubei: '湖北省',
  Hunan: '湖南省',
  'Inner Mongolia': '内蒙古自治区',
  Jiangsu: '江苏省',
  Jiangxi: '江西省',
  Jilin: '吉林省',
  Liaoning: '辽宁省',
  Ningxia: '宁夏回族自治区',
  Qinghai: '青海省',
  Shaanxi: '陕西省',
  Shandong: '山东省',
  Shanghai: '上海市',
  上海市: '上海市',
  Shanxi: '山西省',
  Sichuan: '四川省',
  Tianjin: '天津市',
  Tibet: '西藏自治区',
  Xinjiang: '新疆维吾尔自治区',
  Yunnan: '云南省',
  Zhejiang: '浙江省',
};
const legacyLocationIds: Record<string, string> = {
  loc_cn_110000: 'geonames:1816670',
  loc_cn_310000: 'geonames:1796236',
  loc_cn_330100: 'geonames:1808926',
  loc_cn_440100: 'geonames:1809858',
  loc_cn_440300: 'geonames:1795565',
  loc_cn_510100: 'geonames:1815286',
};
const indexedLocations = catalog.records.map(indexLocation);
const locationsById = new Map(indexedLocations.map((entry) => [entry.location.locationId, entry.location]));

export const WORLD_CITY_CATALOG_VERSION = catalog.metadata.catalogVersion;

@Injectable()
export class LocalLocationProvider implements LocationProvider {
  search(query: string, limit: number): Promise<StandardLocation[]> {
    const normalized = normalizeSearch(query);
    if (!normalized) return Promise.resolve([]);

    return Promise.resolve(
      indexedLocations
        .map((entry) => ({ entry, score: searchScore(entry, normalized) }))
        .filter((candidate) => candidate.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.entry.population - left.entry.population ||
            left.entry.location.displayName.localeCompare(right.entry.location.displayName, 'zh-CN'),
        )
        .slice(0, limit)
        .map((candidate) => candidate.entry.location),
    );
  }

  get(locationId: string): Promise<StandardLocation | null> {
    const canonicalId = legacyLocationIds[locationId] ?? locationId;
    return Promise.resolve(locationsById.get(canonicalId) ?? null);
  }
}

function parseCatalog(compressed: Buffer): CatalogPayload {
  const value: unknown = JSON.parse(gunzipSync(compressed).toString('utf8'));
  if (!isCatalogPayload(value)) throw new Error('World city catalog is invalid');
  if (value.metadata.locationCount !== value.records.length) {
    throw new Error('World city catalog count does not match metadata');
  }
  return value;
}

function isCatalogPayload(value: unknown): value is CatalogPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CatalogPayload>;
  return (
    candidate.metadata?.schemaVersion === '1.0.0' &&
    typeof candidate.metadata.catalogVersion === 'string' &&
    typeof candidate.metadata.locationCount === 'number' &&
    Array.isArray(candidate.records)
  );
}

function indexLocation(record: CatalogRecord): IndexedLocation {
  const [locationId, name, asciiName, hanNames, rawAdministrativeArea, countryCode, timezone] = record;
  const administrativeArea =
    countryCode === 'CN'
      ? (chineseAdministrativeAreas[rawAdministrativeArea] ?? rawAdministrativeArea)
      : rawAdministrativeArea;
  const cityName = hanNames[0] ?? name;
  const administrativePath = compactAdministrativePath(administrativeArea, cityName);
  const countryName = regionNames.of(countryCode) ?? countryCode;
  const displayName = [countryName, ...administrativePath].join(' ');
  const cityNames = unique([cityName, name, asciiName, ...hanNames]);
  return {
    location: {
      locationId,
      displayName,
      countryCode,
      administrativePath,
      timezone,
      coordinates: { latitude: record[7], longitude: record[8] },
    },
    citySearchNames: cityNames.map(normalizeSearch),
    pathSearchNames: unique([countryName, countryCode, administrativeArea, displayName]).map(normalizeSearch),
    population: record[9],
  };
}

function compactAdministrativePath(administrativeArea: string, cityName: string): string[] {
  if (!administrativeArea) return [cityName];
  const normalizedArea = normalizeSearch(administrativeArea).replace(/[省市]$/u, '');
  const normalizedCity = normalizeSearch(cityName).replace(/[省市]$/u, '');
  return normalizedArea === normalizedCity ? [administrativeArea] : [administrativeArea, cityName];
}

function searchScore(entry: IndexedLocation, query: string): number {
  if (entry.citySearchNames.includes(query)) return 400;
  if (entry.citySearchNames.some((name) => name.startsWith(query))) return 300;
  if (entry.pathSearchNames.some((name) => name.startsWith(query))) return 220;
  if (entry.citySearchNames.some((name) => name.includes(query))) return 200;
  if (entry.pathSearchNames.some((name) => name.includes(query))) return 100;
  return 0;
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s,，.·'’_-]+/gu, '');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
