import { describe, expect, it } from 'vitest';
import { SharePosterController } from './share-poster.controller.js';

describe('SharePosterController', () => {
  it('publishes a generated JPG through a stable HTTP response', () => {
    const controller = new SharePosterController();
    const created = controller.create({ image: `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}` });
    const headers = new Map<string, string>();
    let body: unknown;
    const reply = {
      header(name: string, value: string) { headers.set(name, value); return this; },
      send(value: unknown) { body = value; return this; },
      status() { return this; },
    };
    controller.get(created.data.posterId, reply as never);
    expect(headers.get('Content-Type')).toBe('image/jpeg');
    expect(Buffer.isBuffer(body)).toBe(true);
  });
});
