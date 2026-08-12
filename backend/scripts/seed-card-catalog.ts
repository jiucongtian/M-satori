import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateEnvironment } from '../packages/infrastructure/src/config/environment.js';
import { createDatabase } from '../packages/infrastructure/src/database/client.js';
import { newId } from '../packages/infrastructure/src/database/ids.js';
import { cardCatalog, cardDecks } from '../packages/infrastructure/src/database/schema.js';
import { and, eq } from 'drizzle-orm';

interface ManifestCard {
  cardId: number;
  cardCode: string;
  ganzhi: string;
  zodiac: string;
  season: string;
  talentMark: string;
  abilityMark: string;
  journeyMark: string;
  asset: string;
}

const manifestPath = fileURLToPath(new URL('../assets/card-manifest.json', import.meta.url));
const cards = JSON.parse(await readFile(manifestPath, 'utf8')) as ManifestCard[];
if (cards.length !== 60 || new Set(cards.map((card) => card.cardId)).size !== 60) {
  throw new Error('The default card manifest must contain 60 unique cards');
}

const { pool, database } = createDatabase(validateEnvironment(process.env));
try {
  await database.transaction(async (tx) => {
    let [deck] = await tx
      .select()
      .from(cardDecks)
      .where(and(eq(cardDecks.code, 'satori-default-v1'), eq(cardDecks.version, '1.0.0')))
      .limit(1);
    if (!deck) {
      [deck] = await tx.insert(cardDecks).values({
        id: newId(),
        code: 'satori-default-v1',
        version: '1.0.0',
        name: 'Satori 默认生命智慧卡牌',
        assetBaseUrl: '/cards/satori-default-v1',
        status: 'ACTIVE',
        publishedAt: new Date('2026-08-12T00:00:00.000Z'),
      }).returning();
    }
    if (!deck) throw new Error('Card deck creation failed');
    await tx.insert(cardCatalog).values(cards.map((card) => ({
      id: newId(),
      deckId: deck.id,
      cardNumber: card.cardId,
      cardCode: card.cardCode,
      ganzhi: card.ganzhi,
      zodiac: card.zodiac,
      season: card.season,
      talentMark: card.talentMark,
      abilityMark: card.abilityMark,
      journeyMark: card.journeyMark,
      assetPath: card.asset,
      altText: `${card.cardId}号${card.ganzhi}生命智慧卡牌`,
    }))).onConflictDoNothing();
    for (const card of cards) {
      await tx.update(cardCatalog)
        .set({
          assetPath: card.asset,
          altText: `${card.cardId}号${card.ganzhi}生命智慧卡牌`,
          updatedAt: new Date(),
        })
        .where(and(eq(cardCatalog.deckId, deck.id), eq(cardCatalog.cardNumber, card.cardId)));
    }
  });
} finally {
  await pool.end();
}
