import { Module } from '@nestjs/common';
import { CardReadingController } from './card-reading.controller.js';
import { CardReadingService } from './card-reading.service.js';

/**
 * API 与 Worker 共享同一持久化问事服务；任务处理器由服务初始化时注册。
 */
@Module({
  controllers: [CardReadingController],
  providers: [CardReadingService],
  exports: [CardReadingService],
})
export class CardReadingModule {}
