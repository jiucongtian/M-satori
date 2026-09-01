"use client";

import { useEffect, useState } from "react";
import { api } from "@/src/api/client";

export function useWisdomSeedBalance() {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void api.seedAccount()
        .then((account) => { if (active) setBalance(account.available); })
        .catch(() => { if (active) setBalance(null); });
    };
    refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return balance;
}
