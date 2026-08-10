import { Injectable } from '@nestjs/common';
import type { LocationProvider, StandardLocation } from '@satori/application';

const locations: StandardLocation[] = [
  {
    locationId: 'loc_cn_330100',
    displayName: '中国 浙江省 杭州市',
    countryCode: 'CN',
    administrativePath: ['浙江省', '杭州市'],
    timezone: 'Asia/Shanghai',
    coordinates: { latitude: 30.2741, longitude: 120.1551 },
  },
  {
    locationId: 'loc_cn_310000',
    displayName: '中国 上海市',
    countryCode: 'CN',
    administrativePath: ['上海市'],
    timezone: 'Asia/Shanghai',
    coordinates: { latitude: 31.2304, longitude: 121.4737 },
  },
  {
    locationId: 'loc_cn_110000',
    displayName: '中国 北京市',
    countryCode: 'CN',
    administrativePath: ['北京市'],
    timezone: 'Asia/Shanghai',
    coordinates: { latitude: 39.9042, longitude: 116.4074 },
  },
  {
    locationId: 'loc_cn_440100',
    displayName: '中国 广东省 广州市',
    countryCode: 'CN',
    administrativePath: ['广东省', '广州市'],
    timezone: 'Asia/Shanghai',
    coordinates: { latitude: 23.1291, longitude: 113.2644 },
  },
  {
    locationId: 'loc_cn_440300',
    displayName: '中国 广东省 深圳市',
    countryCode: 'CN',
    administrativePath: ['广东省', '深圳市'],
    timezone: 'Asia/Shanghai',
    coordinates: { latitude: 22.5431, longitude: 114.0579 },
  },
  {
    locationId: 'loc_cn_510100',
    displayName: '中国 四川省 成都市',
    countryCode: 'CN',
    administrativePath: ['四川省', '成都市'],
    timezone: 'Asia/Shanghai',
    coordinates: { latitude: 30.5728, longitude: 104.0668 },
  },
];

@Injectable()
export class LocalLocationProvider implements LocationProvider {
  search(query: string, limit: number): Promise<StandardLocation[]> {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return Promise.resolve(
      locations
        .filter((location) => location.displayName.toLocaleLowerCase('zh-CN').includes(normalized))
        .slice(0, limit),
    );
  }

  get(locationId: string): Promise<StandardLocation | null> {
    return Promise.resolve(locations.find((location) => location.locationId === locationId) ?? null);
  }
}
