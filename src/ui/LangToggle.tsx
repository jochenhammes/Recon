import { setLang, t, useLang } from "../i18n";

/** "DE|EN" switch in the title bar. */
export function LangToggle() {
  const lang = useLang();
  return (
    <div className="lang-toggle segmented-control" role="group" aria-label={t("Sprache / Language")} title={t("Sprache / Language")}>
      <button className={lang === "de" ? "active" : ""} aria-pressed={lang === "de"} title={t("Deutsch")} onClick={() => setLang("de")}>
        DE
      </button>
      <button className={lang === "en" ? "active" : ""} aria-pressed={lang === "en"} title={t("Englisch")} onClick={() => setLang("en")}>
        EN
      </button>
    </div>
  );
}
