import { Controller, Get } from '@nestjs/common';
import { Public } from '@satori/contracts';
import { BootstrapService, type Bootstrap } from './bootstrap.service.js';

@Public()
@Controller('app')
export class BootstrapController {
  constructor(private readonly bootstrap: BootstrapService) {}

  @Get('bootstrap')
  get(): Promise<Bootstrap> {
    return this.bootstrap.get();
  }
}
