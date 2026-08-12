import { Injectable, NotFoundException } from '@nestjs/common';
import { cardCatalog, cardDecks, RuntimeInfrastructure } from '@satori/infrastructure';
import { eq } from 'drizzle-orm';

export interface ResolvedCard {
  cardId: number;
  cardCode: string;
  ganzhi: string;
  zodiac: string;
  season: string;
  talentMark: string;
  abilityMark: string;
  journeyMark: string;
  deckCode: string;
  deckVersion: string;
  assetUrl: string;
  altText: string;
}

@Injectable()
export class CardCatalogService {
  private activeDeck: { expiresAt: number; cards: Map<string, ResolvedCard> } | null = null;

  constructor(private readonly infrastructure: RuntimeInfrastructure) {}

  async resolveGanzhi(ganzhi: string): Promise<ResolvedCard> {
    const card = (await this.loadActiveDeck()).get(ganzhi);
    if (!card) {
      throw new NotFoundException({ code: 'CARD_MAPPING_NOT_FOUND', message: 'Card mapping not found' });
    }
    return card;
  }

  private async loadActiveDeck(): Promise<Map<string, ResolvedCard>> {
    if (this.activeDeck && this.activeDeck.expiresAt > Date.now()) return this.activeDeck.cards;
    const rows = await this.infrastructure.database
      .select({ deck: cardDecks, card: cardCatalog })
      .from(cardDecks)
      .innerJoin(cardCatalog, eq(cardCatalog.deckId, cardDecks.id))
      .where(eq(cardDecks.status, 'ACTIVE'));
    if (rows.length !== 60) {
      throw new NotFoundException({
        code: 'ACTIVE_CARD_DECK_INCOMPLETE',
        message: 'The active card deck must contain exactly 60 cards',
      });
    }
    const cards = new Map(
      rows.map(({ deck, card }) => [
        card.ganzhi,
        {
          cardId: card.cardNumber,
          cardCode: card.cardCode,
          ganzhi: card.ganzhi,
          zodiac: card.zodiac,
          season: card.season,
          talentMark: card.talentMark,
          abilityMark: card.abilityMark,
          journeyMark: card.journeyMark,
          deckCode: deck.code,
          deckVersion: deck.version,
          assetUrl: `${deck.assetBaseUrl.replace(/\/$/, '')}/${card.assetPath}`,
          altText: card.altText,
        },
      ]),
    );
    this.activeDeck = { cards, expiresAt: Date.now() + 60_000 };
    return cards;
  }
}
