"use client";

import Image from "next/image";
import { useState } from "react";
import type { components } from "@/src/api/contracts/generated";

type Card = components["schemas"]["RelationshipCard"];

export function LifeWisdomCard({card,size="medium"}:{card:Card;size?:"small"|"medium"|"large"}) {
  const [failed,setFailed]=useState(false);
  const available=Boolean(card.assetUrl)&&!failed;
  return <article className={`life-wisdom-card ${size} ${available?"ready":"fallback"}`} data-card-code={card.cardCode} data-deck={`${card.deckCode}@${card.deckVersion}`}>
    {available?<Image src={card.assetUrl!} width={768} height={1228} alt={card.altText} unoptimized onError={()=>setFailed(true)}/>:<div className="life-card-back"><i/><span>身心游</span><small>{card.uncertainty||"卡牌加载中"}</small></div>}
    <footer><small>{card.title}</small><strong>{card.ganzhi||"待确定"}</strong></footer>
  </article>;
}

export function LifeWisdomCardRow({cards,size="medium"}:{cards:Card[];size?:"small"|"medium"|"large"}) {
  return <div className={`life-wisdom-card-row ${size}`}>{cards.map(card=><LifeWisdomCard card={card} size={size} key={card.dimension}/>)}</div>;
}
