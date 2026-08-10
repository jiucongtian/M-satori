import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import type { AuthenticatedRequest } from '../identity/auth/authenticated-request.js';
import {
  ConfirmProfileDto,
  PreviewProfileDto,
  RevisionListQuery,
  requireIdempotencyKey,
} from '../profile/self-profile.controller.js';
import { SelfProfileService } from '../profile/self-profile.service.js';
import { ProfileLibraryService } from './profile-library.service.js';

class ProfileListQuery extends RevisionListQuery {}

class CreateLifeProfileDto {
  @IsString() @MinLength(1) @MaxLength(40) displayName!: string;
  @IsIn(['FAMILY', 'FRIEND', 'COLLEAGUE', 'OTHER']) relationshipType!:
    'FAMILY' | 'FRIEND' | 'COLLEAGUE' | 'OTHER';
  @IsOptional() @IsString() groupId?: string | null;
}

class PatchLifeProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) displayName?: string;
  @IsOptional() @IsIn(['FAMILY', 'FRIEND', 'COLLEAGUE', 'OTHER']) relationshipType?:
    'FAMILY' | 'FRIEND' | 'COLLEAGUE' | 'OTHER';
  @IsOptional() @IsString() groupId?: string | null;
}

class UpsertGroupDto {
  @IsString() @MinLength(1) @MaxLength(30) name!: string;
  @Type(() => Number) @IsInt() @Min(0) sortOrder!: number;
}

@Controller('me/life-profiles')
export class ProfileLibraryController {
  constructor(
    private readonly library: ProfileLibraryService,
    private readonly revisions: SelfProfileService,
  ) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: ProfileListQuery) {
    return this.library.list(request.auth.userId, query);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateLifeProfileDto,
  ) {
    return this.library.create({
      userId: request.auth.userId,
      ...body,
      idempotencyKey: requireIdempotencyKey(key),
    });
  }

  @Get(':profileId')
  get(@Req() request: AuthenticatedRequest, @Param('profileId') profileId: string) {
    return this.library.get(request.auth.userId, profileId);
  }

  @Patch(':profileId')
  patch(
    @Req() request: AuthenticatedRequest,
    @Param('profileId') profileId: string,
    @Body() body: PatchLifeProfileDto,
  ) {
    return this.library.patch(request.auth.userId, profileId, body);
  }

  @Delete(':profileId')
  @HttpCode(202)
  delete(
    @Req() request: AuthenticatedRequest,
    @Param('profileId') profileId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.library.delete(request.auth.userId, profileId, requireIdempotencyKey(key));
  }

  @Get(':profileId/revisions')
  listRevisions(
    @Req() request: AuthenticatedRequest,
    @Param('profileId') profileId: string,
    @Query() query: RevisionListQuery,
  ) {
    return this.revisions.listRevisions(request.auth.userId, query, profileId);
  }

  @Post(':profileId/revisions/preview')
  preview(
    @Req() request: AuthenticatedRequest,
    @Param('profileId') profileId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: PreviewProfileDto,
  ) {
    return this.revisions.preview({
      userId: request.auth.userId,
      profileId,
      birthInput: body.birthInput,
      idempotencyKey: requireIdempotencyKey(key),
    });
  }

  @Post(':profileId/revisions/:revisionId/confirm')
  @HttpCode(200)
  confirm(
    @Req() request: AuthenticatedRequest,
    @Param('profileId') profileId: string,
    @Param('revisionId') revisionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: ConfirmProfileDto,
  ) {
    return this.revisions.confirm({
      userId: request.auth.userId,
      profileId,
      revisionId,
      ...body,
      idempotencyKey: requireIdempotencyKey(key),
    });
  }
}

@Controller('me/life-profile-groups')
export class ProfileGroupController {
  constructor(private readonly library: ProfileLibraryService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.library.listGroups(request.auth.userId);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: UpsertGroupDto,
  ) {
    return this.library.createGroup({
      userId: request.auth.userId,
      ...body,
      idempotencyKey: requireIdempotencyKey(key),
    });
  }

  @Patch(':groupId')
  patch(
    @Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string,
    @Body() body: UpsertGroupDto,
  ) {
    return this.library.patchGroup(request.auth.userId, groupId, body);
  }

  @Delete(':groupId')
  @HttpCode(204)
  delete(@Req() request: AuthenticatedRequest, @Param('groupId') groupId: string) {
    return this.library.deleteGroup(request.auth.userId, groupId);
  }
}
