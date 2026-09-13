import { Controller, Get } from '@nestjs/common';
import { RuntimeInfrastructure } from '@satori/infrastructure';
import { Public } from '@satori/contracts';
@Controller('system-config')
export class SystemConfigController { constructor(private readonly runtime: RuntimeInfrastructure) {} @Public() @Get('page-labels') async pageLabels() { await this.runtime.pool.query(`create table if not exists operations_system_config(key text primary key,value jsonb not null,updated_by text,updated_at timestamptz not null default now())`); const result=await this.runtime.pool.query<{value:unknown;updated_at:Date}>(`select value,updated_at from operations_system_config where key='page_labels'`); const row=result.rows[0]; return {enabled:row?.value===true||row?.value==='true',updatedAt:row?.updated_at?.toISOString()??null}; } }
