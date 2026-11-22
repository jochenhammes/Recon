import { useEffect, useState } from "react";

import { t, tk } from "../i18n";
const SUGGESTIONS = ["Baseline", "Follow-up", tk("Prä-Therapie"), "Post-Therapie", "nativ", "KM", "Low-Dose-CT", "Basis", "Vorlage"];

/** Short user tag for a dataset (shown in chips and all dataset lists). */
export function TagInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const t = text.trim().slice(0, 40);
    if (t !== value) onChange(t);
  };
  return (
    <label className="field tag-field">
      {t("Schlagwort")}
      <input
        type="text"
        value={text}
        placeholder={t("z. B. Baseline, Follow-up, CT nativ")}
        list="dataset-tag-suggestions"
        maxLength={40}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setText(value);
        }}
      />
      <datalist id="dataset-tag-suggestions">
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </label>
  );
}
