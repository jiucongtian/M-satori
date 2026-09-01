import { Module } from '@nestjs/common';
import { CardReadingController } from './card-reading.controller.js';
import { CardReadingService } from './card-reading.service.js';

/**
 * R1.1 先发布问事消费与抽卡端口基线；持久化问事实现接入时在此完成装配。
 */
@Module({
  controllers: [CardReadingController],
  providers: [CardReadingService],
  exports: [CardReadingService],
})
export class CardReadingModule {}
