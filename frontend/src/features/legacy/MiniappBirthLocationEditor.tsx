"use client";

import { useRef, useState } from "react";
import { api, type Location } from "@/src/api/client";

export function MiniappBirthLocationEditor({ locationId, busy, onSelect }: {
  locationId: string;
  busy: boolean;
  onSelect: (location: Location) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const currentLabel = selectedLocation?.locationId === locationId
    ? selectedLocation.displayName
    : locationId === "loc_cn_110000" || locationId === "geonames:1816670"
      ? "北京"
      : "已保存的出生城市";

  async function search() {
    if (!query.trim() || busy || loading) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError("");
    setResults([]);
    setSearched(false);
    try {
      const locations = await api.searchLocations(query.trim());
      if (request === requestRef.current) { setResults(locations); setSearched(true); }
    } catch {
      if (request === requestRef.current) setError("出生城市暂时加载失败，请重新搜索。");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  return <section className="miniapp-location-editor" aria-label="修改出生地">
    <h2>出生地</h2>
    <p className="miniapp-location-current" role="status">当前：{currentLabel}</p>
    <p>小程序未记录出生地，导入时统一使用北京。可以搜索并选择实际出生城市，再保存修改。</p>
    <label htmlFor="miniapp-birth-location">搜索出生城市</label>
    <div className="miniapp-location-search"><input id="miniapp-birth-location" type="search" value={query} disabled={busy} placeholder="输入城市名称" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} onChange={(event) => {
      ++requestRef.current;
      setQuery(event.target.value);
      setResults([]);
      setSearched(false);
      setLoading(false);
      setError("");
    }} /><button type="button" disabled={busy || loading || !query.trim()} onClick={() => void search()}>{loading ? "搜索中…" : "搜索城市"}</button></div>
    {error && <p role="alert">{error}</p>}
    {searched && results.length === 0 && <p role="status">没有找到匹配城市，请尝试城市全称。</p>}
    {results.length > 0 && <ul className="miniapp-location-results">{results.map((location) => <li key={location.locationId}><button type="button" disabled={busy} onClick={() => {
      setSelectedLocation(location);
      setResults([]);
      setSearched(false);
      onSelect(location);
    }}>{location.displayName}<small>{location.administrativePath.join(" · ")}</small></button></li>)}</ul>}
  </section>;
}
