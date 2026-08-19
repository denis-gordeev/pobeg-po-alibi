"use client";

import { FormEvent, useMemo, useState } from "react";

type EscapeResult = {
  destination: string;
  reasonLabel: string;
  alibi: string;
  protocol: string;
  source: "live" | "demo";
  offer: {
    transport: string;
    price: { amount: number; currency: string };
    durationMin: number;
    departureAt: string;
    arrivalAt: string;
    carrier: string;
    from: string;
    to: string;
    checkoutUrl: string;
    searchResultsUrl: string;
  };
};

const reasons = [
  { value: "meeting", label: "созвона на 47 человек", mark: "01" },
  { value: "renovation", label: "ремонта у соседей", mark: "02" },
  { value: "adulting", label: "взрослой жизни", mark: "03" },
  { value: "relatives", label: "вопроса «ну когда дети?»", mark: "04" },
];

const transportNames: Record<string, string> = {
  railway: "ПОЕЗД",
  rail: "ПОЕЗД",
  avia: "САМОЛЁТ",
  bus: "АВТОБУС",
  etrain: "ЭЛЕКТРИЧКА",
};

function isoDate(daysAhead: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours} ч ${mins.toString().padStart(2, "0")} мин`;
}

export default function Home() {
  const [origin, setOrigin] = useState("Москва");
  const [date, setDate] = useState(isoDate(2));
  const [reason, setReason] = useState("meeting");
  const [budget, setBudget] = useState("7000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<EscapeResult | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedReason = useMemo(
    () => reasons.find((item) => item.value === reason) ?? reasons[0],
    [reason],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setCopied(false);
    setResult(null);

    try {
      const response = await fetch("/api/escape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin, date, reason, budget: Number(budget) }),
      });
      const data = (await response.json()) as EscapeResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "Маршрут сорвался с радара");
      setResult(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Неизвестная тревога");
    } finally {
      setLoading(false);
    }
  }

  async function copyAlibi() {
    if (!result) return;
    await navigator.clipboard.writeText(result.alibi);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Побег по алиби — наверх">
          ПОБЕГ <span>ПО АЛИБИ</span>
        </a>
        <div className="status"><i /> TUTU MCP / НА СВЯЗИ</div>
        <div className="case">ДЕЛО № {new Date().getFullYear()}—0819</div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">НЕ ТУРИЗМ. ТАКТИЧЕСКОЕ ОТСУТСТВИЕ.</div>
        <h1>Вам срочно<br />нужно <em>отсюда.</em></h1>
        <p className="lead">
          Вы называете причину. Мы находим реальный билет и составляем алиби,
          которому поверит даже календарь в Outlook.
        </p>
        <div className="route-doodle" aria-hidden="true">
          <span className="dot start" /><span className="line one" />
          <span className="line two" /><span className="line three" />
          <span className="dot end" />
        </div>
      </section>

      <section className="workspace" aria-label="Конструктор побега">
        <form className="escape-form" onSubmit={submit}>
          <div className="form-head">
            <span>ФОРМА 13-Б</span>
            <strong>ЗАПРОС НА ВНЕЗАПНОЕ ИСЧЕЗНОВЕНИЕ</strong>
          </div>

          <label className="field wide">
            <span>ГДЕ ВАС ЗАСТАЛА РЕАЛЬНОСТЬ</span>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} required maxLength={80} />
          </label>

          <label className="field">
            <span>ДАТА ЭВАКУАЦИИ</span>
            <input type="date" value={date} min={isoDate(1)} onChange={(e) => setDate(e.target.value)} required />
          </label>

          <label className="field">
            <span>ПОТОЛОК СОВЕСТИ, ₽</span>
            <input type="number" min="1000" max="200000" step="500" value={budget} onChange={(e) => setBudget(e.target.value)} required />
          </label>

          <fieldset className="reason-field">
            <legend>ОТ ЧЕГО БЕЖИМ</legend>
            <div className="reason-grid">
              {reasons.map((item) => (
                <label key={item.value} className={reason === item.value ? "reason active" : "reason"}>
                  <input type="radio" name="reason" value={item.value} checked={reason === item.value} onChange={() => setReason(item.value)} />
                  <small>{item.mark}</small><span>{item.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button className="panic" disabled={loading}>
            <span>{loading ? "ПРОВЕРЯЕМ ПУТИ ОТХОДА…" : "СФОРМИРОВАТЬ ПОБЕГ"}</span>
            <b>→</b>
          </button>
          <p className="fineprint">Нажимая кнопку, вы соглашаетесь ненадолго стать загадочным человеком.</p>
          {error && <div className="error" role="alert">⚠ {error}</div>}
        </form>

        <aside className="briefing">
          <div className="stamp">СЕКРЕТНО<br /><span>НО МОЖНО В СТОРИС</span></div>
          <p className="brief-no">ПАМЯТКА / 004</p>
          <h2>Как работает операция</h2>
          <ol>
            <li><b>01</b><span>Вы честно признаётесь,<br />от чего бежите.</span></li>
            <li><b>02</b><span>Tutu MCP проверяет<br />живые варианты транспорта.</span></li>
            <li><b>03</b><span>Алгоритм выбирает место,<br />где вас не станут искать.</span></li>
            <li><b>04</b><span>Вы получаете билет<br />и официальное алиби.</span></li>
          </ol>
          <p className="warning">Важно: билет настоящий.<br />Алиби — нравственно гибкое.</p>
        </aside>
      </section>

      {result && (
        <section className="result" aria-live="polite">
          <div className="result-label">МАРШРУТ УТВЕРЖДЁН · {result.source === "live" ? "ЖИВЫЕ ДАННЫЕ" : "УЧЕБНЫЙ РЕЖИМ"}</div>
          <div className="ticket">
            <div className="ticket-main">
              <p>ВАШЕ НОВОЕ МЕСТОНАХОЖДЕНИЕ</p>
              <h2>{result.destination}</h2>
              <div className="journey">
                <div><small>ОТПРАВЛЕНИЕ</small><strong>{formatDate(result.offer.departureAt)}</strong><span>{result.offer.from}</span></div>
                <div className="journey-line"><i /><span>{transportNames[result.offer.transport] || result.offer.transport}</span><i /></div>
                <div><small>ПРИБЫТИЕ</small><strong>{formatDate(result.offer.arrivalAt)}</strong><span>{result.offer.to}</span></div>
              </div>
            </div>
            <div className="ticket-stub">
              <small>СТОИМОСТЬ<br />СВОБОДЫ</small>
              <strong>{result.offer.price.amount.toLocaleString("ru-RU")} {result.offer.price.currency}</strong>
              <span>{formatDuration(result.offer.durationMin)}</span>
              <span>{result.offer.carrier}</span>
              <a href={result.offer.checkoutUrl || result.offer.searchResultsUrl} target="_blank" rel="noreferrer">ВЗЯТЬ БИЛЕТ ↗</a>
            </div>
          </div>

          <div className="alibi">
            <div>
              <p>СОПРОВОДИТЕЛЬНАЯ ЗАПИСКА</p>
              <h3>Алиби для: {selectedReason.label}</h3>
            </div>
            <blockquote>«{result.alibi}»</blockquote>
            <button onClick={copyAlibi}>{copied ? "СКОПИРОВАНО ✓" : "СКОПИРОВАТЬ АЛИБИ"}</button>
          </div>
        </section>
      )}

      <footer>
        <span>ЭКСПЕРИМЕНТ НА TUTU.RU MCP</span>
        <span>БРОНИРОВАНИЙ НЕ СОВЕРШАЕМ · ТОЛЬКО ПОМОГАЕМ ИСЧЕЗНУТЬ</span>
      </footer>
    </main>
  );
}
