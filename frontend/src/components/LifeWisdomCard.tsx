"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { components } from "@/src/api/contracts/generated";

type Card = components["schemas"]["RelationshipCard"];

export function LifeWisdomCard({card,size="medium",expandable=false}:{card:Card;size?:"small"|"medium"|"large";expandable?:boolean}) {
  const [failed,setFailed]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const available=Boolean(card.assetUrl)&&!failed;
  const canExpand=expandable&&available&&!card.uncertainty;
  return <article className={`life-wisdom-card ${size} ${available?"ready":"fallback"}`} data-card-code={card.cardCode} data-deck={`${card.deckCode}@${card.deckVersion}`}>
    <button className={`life-card-trigger ${canExpand?"expandable":""}`} type="button" disabled={!canExpand} aria-label={canExpand?`放大查看${card.title}`:undefined} onClick={()=>setExpanded(true)}><div className="life-card-visual">
      {available?<Image src={card.assetUrl!} width={768} height={1313} alt={card.altText} unoptimized onError={()=>setFailed(true)}/>:<div className="life-card-back"><i/><span>初见</span><small>{card.uncertainty||"卡牌加载中"}</small></div>}
      {card.uncertainty&&<span className="life-card-unknown-overlay">时间未知</span>}
    </div></button>
    <footer>{card.title}</footer>
    {expanded&&typeof document!=="undefined"&&createPortal(<div className="life-card-modal" role="dialog" aria-modal="true" aria-label={`放大查看${card.title}`} onClick={()=>setExpanded(false)}><button type="button" className="life-card-expanded" onClick={(event)=>{event.stopPropagation();setExpanded(false)}}><Image src={card.assetUrl!} width={768} height={1313} alt={card.altText} unoptimized/><span>点击卡牌收起</span></button></div>,document.body)}
  </article>;
}

export function LifeWisdomCardRow({cards,size="medium"}:{cards:Card[];size?:"small"|"medium"|"large"}) {
  const rowRef=useRef<HTMLDivElement>(null);
  const [expandable,setExpandable]=useState(false);
  useEffect(()=>setExpandable(Boolean(rowRef.current?.closest(".my-detail, .person-archive-detail"))),[]);
  return <div ref={rowRef} className={`life-wisdom-card-row ${size}`}>{cards.map(card=><LifeWisdomCard card={card} size={size} expandable={expandable} key={card.dimension}/>)}</div>;
}
