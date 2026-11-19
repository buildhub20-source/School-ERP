"use client";
import { createContext, useContext } from "react";
import { translate, type DictKey } from "./dict";

const LangContext = createContext("en");

export function LangProvider({ lang, children }: { lang: string; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useT() {
  const lang = useContext(LangContext);
  return (k: DictKey) => translate(lang, k);
}
