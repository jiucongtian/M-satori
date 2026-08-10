import { Module } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service.js';
import { AccountDeletionController, FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';

@Module({
  controllers: [FeedbackController, AccountDeletionController],
  providers: [FeedbackService, AccountDeletionService],
  exports: [AccountDeletionService],
})
export class FeedbackModule {}
