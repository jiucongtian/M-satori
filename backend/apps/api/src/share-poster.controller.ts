import { BadRequestException, Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { Public } from '@satori/contracts';
import type { FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { IsString, MaxLength } from 'class-validator';

const MAX_POSTER_BYTES = 900_000;
const POSTER_TTL_MS = 24 * 60 * 60 * 1_000;
const posters = new Map<string, { bytes: Buffer; expiresAt: number }>();

class CreateSharePosterDto {
  @IsString()
  @MaxLength(1_200_000)
  image!: string;
}

function cleanupExpiredPosters(now = Date.now()): void {
  for (const [id, poster] of posters) if (poster.expiresAt <= now) posters.delete(id);
}

@Controller('share-posters')
export class SharePosterController {
  @Post()
  create(@Body() body: CreateSharePosterDto): { data: { posterId: string; expiresAt: string } } {
    if (!body.image.startsWith('data:image/jpeg;base64,')) {
      throw new BadRequestException({ code: 'INVALID_POSTER_IMAGE', message: '请上传 JPG 分享海报' });
    }
    const bytes = Buffer.from(body.image.slice('data:image/jpeg;base64,'.length), 'base64');
    if (!bytes.length || bytes.length > MAX_POSTER_BYTES) {
      throw new BadRequestException({ code: 'POSTER_IMAGE_TOO_LARGE', message: '分享海报大小超出限制' });
    }
    cleanupExpiredPosters();
    const posterId = randomUUID();
    const expiresAt = Date.now() + POSTER_TTL_MS;
    posters.set(posterId, { bytes, expiresAt });
    return { data: { posterId, expiresAt: new Date(expiresAt).toISOString() } };
  }

  @Public()
  @Get(':posterId.jpg')
  get(@Param('posterId') posterId: string, @Res() reply: FastifyReply): void {
    cleanupExpiredPosters();
    const poster = posters.get(posterId);
    if (!poster) {
      void reply.status(404).send({ error: { code: 'POSTER_NOT_FOUND', message: '分享海报已失效' } });
      return;
    }
    void reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'public, max-age=86400, immutable').send(poster.bytes);
  }
}
