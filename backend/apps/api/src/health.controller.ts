import { Controller, Get } from '@nestjs/common';
import { Public } from '@satori/contracts';
import { checkDependencies, RuntimeInfrastructure } from '@satori/infrastructure';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    await checkDependencies(
      this.infrastructure.pool,
      this.infrastructure.redis,
      this.infrastructure.generationQueue,
    );
    return { status: 'ok' };
  }
}
