import { Controller, Get, Inject, Query } from '@nestjs/common';
import { LOCATION_PROVIDER, type LocationProvider, type StandardLocation } from '@satori/application';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { ApiListEnvelope } from '@satori/contracts';

class LocationQuery {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(({ value }) => {
    const raw: unknown = value;
    return typeof raw === 'string' ? raw.trim() : raw;
  })
  query!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;
}

@Controller('locations')
export class LocationController {
  constructor(@Inject(LOCATION_PROVIDER) private readonly provider: LocationProvider) {}

  @Get()
  async search(@Query() query: LocationQuery): Promise<ApiListEnvelope<StandardLocation>> {
    const data = await this.provider.search(query.query, query.limit);
    return { data, meta: { nextCursor: null, hasMore: false } };
  }
}
