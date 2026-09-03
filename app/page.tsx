"use client";

import { FormEvent, useEffect, useState } from "react";
import RouteMap from "./RouteMap";

type Point = { name: string; lat: number; lon: number };
type RouteOption = {
  destination: string;
  selection: { profile: string; budgetShare: number; distanceKm: number };
  place: { mood: string; description: string; sights: string[] };
  route: { from: Point; to: Point };
  offer: { transport: string; price: { amount: number; currency: string }; durationMin: number; departureAt: string; arrivalAt: string; carrier: string; from: string; to: string; checkoutUrl: string; searchResultsUrl: string; quote?: { source: "tutu" | "demo"; fetchedAt: string } };
};
type EscapeResult = RouteOption & {
  reasonLabel: string;
  alibis: string[];
  llmSource: "openrouter" | "yandexgpt" | "fallback";
  protocol: string;
  source: "live" | "demo";
  alternatives: Array<RouteOption & { id: "economy" | "balanced" | "far" | "budget"; label: string }>;
  cache: { status: "hit" | "miss"; ceiling: number };
};

const reasons = [
  { value: "meeting", label: "созвона на 47 человек", mark: "01" },
  { value: "renovation", label: "ремонта у соседей", mark: "02" },
  { value: "adulting", label: "взрослой жизни", mark: "03" },
  { value: "relatives", label: "вопроса «ну когда дети?»", mark: "04" },
];
const transportNames: Record<string, string> = { railway: "ПОЕЗД", rail: "ПОЕЗД", avia: "САМОЛЁТ", bus: "АВТОБУС", etrain: "ЭЛЕКТРИЧКА" };
const budgetPresets = [7_000, 20_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const resultCacheKey = "pobeg-po-alibi:recent-results";
const resultCacheTtl = 6 * 60 * 60 * 1000;
const resultCacheVersion = 2;
type EscapeRequest = { origin: string; date: string; reason: string; budget: number; customAlibi: string };
type CachedResult = { key: string; savedAt: number; request?: EscapeRequest; result: EscapeResult };

function requestCacheKey(request: EscapeRequest) {
  return JSON.stringify({ ...request, origin: request.origin.toLocaleLowerCase("ru") });
}

function readCachedResults() {
  try {
    const stored = JSON.parse(localStorage.getItem(resultCacheKey) || "[]") as CachedResult[] | { version?: number; rows?: CachedResult[] };
    return Array.isArray(stored) ? stored : stored.version === resultCacheVersion && Array.isArray(stored.rows) ? stored.rows : [];
  }
  catch { return []; }
}

function writeCachedResults(rows: CachedResult[]) {
  try { localStorage.setItem(resultCacheKey, JSON.stringify({ version: resultCacheVersion, rows })); }
  catch { /* the live result still works when browser storage is unavailable */ }
}

function activeCachedResults() {
  const rows = readCachedResults().filter((row) => row.savedAt + resultCacheTtl > Date.now()).slice(0, 4);
  writeCachedResults(rows);
  return rows;
}

function requestFromCache(row: CachedResult): EscapeRequest | null {
  if (row.request) return row.request;
  try {
    const value = JSON.parse(row.key) as Partial<EscapeRequest>;
    if (!value.origin || !value.date || !value.reason || !Number.isFinite(value.budget)) return null;
    return { origin: value.origin, date: value.date, reason: value.reason, budget: Number(value.budget), customAlibi: value.customAlibi || "" };
  } catch { return null; }
}

function isoDate(daysAhead: number) { const d = new Date(); d.setDate(d.getDate() + daysAhead); return d.toISOString().slice(0, 10); }
function formatDate(value: string) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatSavedAt(value: number) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatQuote(value?: string) { return value ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "время неизвестно"; }
function quoteLabel(quote?: RouteOption["offer"]["quote"]) { return `${quote?.source === "tutu" ? "Tutu.ru MCP" : quote?.source === "demo" ? "учебная оценка" : "источник не указан"} · ${formatQuote(quote?.fetchedAt)}`; }
function formatDuration(minutes: number) { return `${Math.floor(minutes / 60)} ч ${(minutes % 60).toString().padStart(2, "0")} мин`; }
function compactRubles(value: number) { return value >= 1_000_000 ? "1М" : value >= 1_000 ? `${value / 1_000}К` : String(value); }

export default function Home() {
  const [origin, setOrigin] = useState("Москва");
  const [date, setDate] = useState(isoDate(2));
  const [reason, setReason] = useState("meeting");
  const [budget, setBudget] = useState("7000");
  const [customAlibi, setCustomAlibi] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<EscapeResult | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [history, setHistory] = useState<CachedResult[]>([]);
  const [activeRequest, setActiveRequest] = useState<EscapeRequest | null>(null);
  const [switchingProfile, setSwitchingProfile] = useState<string | null>(null);

  useEffect(() => {
    const hydrateHistory = window.setTimeout(() => setHistory(activeCachedResults()), 0);
    const syncHistory = (event: StorageEvent) => {
      if (event.key === resultCacheKey || event.key === null) setHistory(activeCachedResults());
    };
    window.addEventListener("storage", syncHistory);
    return () => { window.clearTimeout(hydrateHistory); window.removeEventListener("storage", syncHistory); };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setCopied(null); setResult(null);
    const escapeRequest = { origin: origin.trim(), date, reason, budget: Number(budget), customAlibi: customAlibi.trim() };
    const requestKey = requestCacheKey(escapeRequest);
    try {
      const cachedRows = activeCachedResults();
      const cached = cachedRows.find((row) => row.key === requestKey && row.savedAt + resultCacheTtl > Date.now());
      if (cached) {
        setResult({ ...cached.result, cache: { ...cached.result.cache, status: "hit" } });
        setActiveRequest(escapeRequest);
        setHistory(cachedRows);
        return;
      }
      const response = await fetch("/api/escape", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin, date, reason, budget: Number(budget), customAlibi }) });
      const data = (await response.json()) as EscapeResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "Маршрут сорвался с радара");
      setResult(data);
      setActiveRequest(escapeRequest);
      const freshRows = cachedRows.filter((row) => row.key !== requestKey && row.savedAt + resultCacheTtl > Date.now());
      const nextHistory = [{ key: requestKey, savedAt: Date.now(), request: escapeRequest, result: data }, ...freshRows].slice(0, 4);
      writeCachedResults(nextHistory);
      setHistory(nextHistory);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Неизвестная тревога"); }
    finally { setLoading(false); }
  }

  async function copyAlibi(index: number) {
    if (!result) return;
    await navigator.clipboard.writeText(result.alibis[index]); setCopied(index);
    window.setTimeout(() => setCopied(null), 1800);
  }

  function restoreOperation(row: CachedResult) {
    const request = requestFromCache(row);
    if (!request) return;
    setOrigin(request.origin); setDate(request.date); setReason(request.reason); setBudget(String(request.budget)); setCustomAlibi(request.customAlibi);
    setError(""); setCopied(null); setActiveRequest(request); setResult({ ...row.result, cache: { ...row.result.cache, status: "hit" } });
    window.requestAnimationFrame(() => document.querySelector(".result")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function clearHistory() {
    writeCachedResults([]); setHistory([]);
  }

  function removeHistoryItem(row: CachedResult) {
    const nextHistory = activeCachedResults().filter((item) => !(item.key === row.key && item.savedAt === row.savedAt));
    writeCachedResults(nextHistory); setHistory(nextHistory);
  }

  async function switchRoute(alternative: EscapeResult["alternatives"][number]) {
    if (!result || !activeRequest || alternative.destination === result.destination) return;
    setSwitchingProfile(alternative.id); setError(""); setCopied(null);
    try {
      const response = await fetch("/api/alibis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...activeRequest, destination: alternative.destination }),
      });
      const data = (await response.json()) as Pick<EscapeResult, "alibis" | "llmSource" | "reasonLabel"> & { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось обновить пакет прикрытия");
      const updated: EscapeResult = {
        ...result,
        destination: alternative.destination,
        selection: alternative.selection,
        place: alternative.place,
        route: alternative.route,
        offer: alternative.offer,
        source: alternative.offer.quote?.source === "tutu" ? "live" : "demo",
        alibis: data.alibis,
        llmSource: data.llmSource,
        reasonLabel: data.reasonLabel,
      };
      setResult(updated);
      const requestKey = requestCacheKey(activeRequest);
      const nextHistory = activeCachedResults().map((row) => row.key === requestKey ? { ...row, result: updated } : row);
      writeCachedResults(nextHistory); setHistory(nextHistory);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Неизвестная тревога");
    } finally {
      setSwitchingProfile(null);
    }
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Побег по алиби — наверх">ПОБЕГ <span>ПО АЛИБИ</span></a>
        <div className="status"><i /> TUTU MCP / НА СВЯЗИ</div>
        <div className="case">ДЕЛО № {new Date().getFullYear()}—0819</div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">НЕ ТУРИЗМ. ТАКТИЧЕСКОЕ ОТСУТСТВИЕ.</div>
        <h1>Вам срочно<br />нужно <em>отсюда.</em></h1>
        <p className="lead">Вы даёте вводные. Мы находим реальный билет, отмечаем путь на карте и выдаём пять алиби на выбор.</p>
        <div className="route-doodle" aria-hidden="true"><span className="dot start" /><span className="line one" /><span className="line two" /><span className="line three" /><span className="dot end" /></div>
      </section>

      <section className="workspace" aria-label="Конструктор побега">
        <form className="escape-form" onSubmit={submit}>
          <div className="form-head"><span>ФОРМА 13-Б</span><strong>ЗАПРОС НА ВНЕЗАПНОЕ ИСЧЕЗНОВЕНИЕ</strong></div>
          <label className="field wide"><span>ГДЕ ВАС ЗАСТАЛА РЕАЛЬНОСТЬ</span><input value={origin} onChange={(e) => setOrigin(e.target.value)} required maxLength={80} /></label>
          <label className="field"><span>ДАТА ЭВАКУАЦИИ</span><input type="date" value={date} min={isoDate(1)} onChange={(e) => setDate(e.target.value)} required /></label>
          <label className="field budget-field"><span>ПОТОЛОК СОВЕСТИ, ₽</span><input type="number" min="1000" max="1000000" step="500" value={budget} onChange={(e) => setBudget(e.target.value)} required /><span className="budget-presets" aria-label="Быстрый выбор бюджета">{budgetPresets.map((value) => <button type="button" key={value} className={Number(budget) === value ? "active" : ""} onClick={() => setBudget(String(value))}>{compactRubles(value)}</button>)}</span></label>
          <fieldset className="reason-field"><legend>ОТ ЧЕГО БЕЖИМ</legend><div className="reason-grid">
            {reasons.map((item) => <label key={item.value} className={reason === item.value ? "reason active" : "reason"}><input type="radio" name="reason" value={item.value} checked={reason === item.value} onChange={() => setReason(item.value)} /><small>{item.mark}</small><span>{item.label}</span></label>)}
          </div></fieldset>
          <label className="field wide alibi-draft"><span>ВАШ ЧЕРНОВИК АЛИБИ · НЕОБЯЗАТЕЛЬНО</span><textarea value={customAlibi} onChange={(e) => setCustomAlibi(e.target.value)} maxLength={600} placeholder="Например: скажи начальнику, что я уехал проверять региональные пирожки…" /><small>{customAlibi.length}/600</small></label>
          <button className="panic" disabled={loading}><span>{loading ? "TUTU И LLM СОВЕЩАЮТСЯ…" : "СФОРМИРОВАТЬ ПОБЕГ"}</span><b>→</b></button>
          <p className="fineprint">Нажимая кнопку, вы соглашаетесь ненадолго стать загадочным человеком.</p>
          {error && <div className="error" role="alert">⚠ {error}</div>}
        </form>

        <aside className="briefing">
          <div className="stamp">СЕКРЕТНО<br /><span>НО МОЖНО В СТОРИС</span></div><p className="brief-no">ПАМЯТКА / 005</p><h2>Как работает операция</h2>
          <ol><li><b>01</b><span>Вы задаёте причину<br />или пишете свою.</span></li><li><b>02</b><span>Tutu MCP проверяет<br />живые варианты транспорта.</span></li><li><b>03</b><span>Штаб выбирает необычный город<br />и собирает мини-гид.</span></li><li><b>04</b><span>LLM выдаёт пять алиби,<br />а карта — путь отхода.</span></li></ol>
          <p className="warning">Важно: билет настоящий.<br />Алиби — нравственно гибкое.</p>
        </aside>
      </section>

      <section className="history" aria-labelledby="history-title">
        <div className="history-head"><div><p>ЛОКАЛЬНЫЙ АРХИВ · 6 ЧАСОВ</p><h2 id="history-title">Последние операции</h2></div>{history.length > 0 && <button type="button" onClick={clearHistory}>ОЧИСТИТЬ АРХИВ</button>}</div>
        {history.length === 0 ? <p className="history-empty">Архив пока пуст. Четыре последних маршрута останутся только в этом браузере.</p> : <div className="history-list">
          {history.map((row) => {
            const request = requestFromCache(row);
            if (!request) return null;
            return <article className="history-item" key={`${row.key}:${row.savedAt}`}>
              <button type="button" className="history-restore" onClick={() => restoreOperation(row)} aria-label={`Восстановить маршрут ${request.origin} — ${row.result.destination}`}>
                <span>{formatSavedAt(row.savedAt)}</span><strong>{request.origin} → {row.result.destination}</strong><small>{row.result.offer.price.amount.toLocaleString("ru-RU")} {row.result.offer.price.currency} · {transportNames[row.result.offer.transport] || row.result.offer.transport}</small><b>ВОССТАНОВИТЬ →</b>
              </button>
              <button type="button" className="history-remove" onClick={() => removeHistoryItem(row)} aria-label={`Удалить маршрут ${request.origin} — ${row.result.destination} из архива`}>УДАЛИТЬ</button>
            </article>;
          })}
        </div>}
      </section>

      {result && <section className="result" aria-live="polite">
        <div className="result-label">МАРШРУТ УТВЕРЖДЁН · {result.source === "live" ? "ЖИВЫЕ ДАННЫЕ" : "УЧЕБНЫЙ РЕЖИМ"} · {result.cache.status === "hit" ? "ИЗ КЭША" : "СВЕЖАЯ РАЗВЕДКА"}</div>
        {result.alternatives?.length > 0 && <div className="route-profiles" aria-label="Четыре профиля маршрута">
          <div className="profiles-head"><p>ЧЕТЫРЕ СЦЕНАРИЯ ОТХОДА</p><h2>Сравните характер побега</h2></div>
          <div className="profiles-grid">{result.alternatives.map((alternative) => <article className={alternative.destination === result.destination ? "profile-card active" : "profile-card"} key={alternative.id}>
            <span>{alternative.label}</span><h3>{alternative.destination}</h3>
            <p>{transportNames[alternative.offer.transport] || alternative.offer.transport} · {formatDuration(alternative.offer.durationMin)}</p>
            <strong>{alternative.offer.price.amount.toLocaleString("ru-RU")} {alternative.offer.price.currency}</strong>
            <small>{alternative.selection.distanceKm.toLocaleString("ru-RU")} км · {alternative.selection.budgetShare}% бюджета</small>
            <small className="quote-source">ЦЕНА: {quoteLabel(alternative.offer.quote)}</small>
            <button type="button" onClick={() => switchRoute(alternative)} disabled={alternative.destination === result.destination || switchingProfile !== null}>{alternative.destination === result.destination ? "ВЫБРАНО ✓" : switchingProfile === alternative.id ? "ОБНОВЛЯЕМ АЛИБИ…" : "ВЫБРАТЬ МАРШРУТ"}</button>
            <a href={alternative.offer.checkoutUrl || alternative.offer.searchResultsUrl} target="_blank" rel="noreferrer">ПРОВЕРИТЬ БИЛЕТ ↗</a>
          </article>)}</div>
        </div>}
        <div className="ticket"><div className="ticket-main"><p>ВАШЕ НОВОЕ МЕСТОНАХОЖДЕНИЕ</p><h2>{result.destination}</h2><div className="journey">
          <div><small>ОТПРАВЛЕНИЕ</small><strong>{formatDate(result.offer.departureAt)}</strong><span>{result.offer.from}</span></div><div className="journey-line"><i /><span>{transportNames[result.offer.transport] || result.offer.transport}</span><i /></div><div><small>ПРИБЫТИЕ</small><strong>{formatDate(result.offer.arrivalAt)}</strong><span>{result.offer.to}</span></div>
        </div></div><div className="ticket-stub"><small>{result.selection.profile}</small><div className="budget-use"><b style={{ width: `${Math.min(result.selection.budgetShare, 100)}%` }} /><span>{result.selection.budgetShare}% бюджета · {result.selection.distanceKm.toLocaleString("ru-RU")} км</span></div><small>СТОИМОСТЬ<br />СВОБОДЫ</small><strong>{result.offer.price.amount.toLocaleString("ru-RU")} {result.offer.price.currency}</strong><span>{formatDuration(result.offer.durationMin)}</span><span>{result.offer.carrier}</span><small>ЦЕНА: {quoteLabel(result.offer.quote)}</small><a href={result.offer.checkoutUrl || result.offer.searchResultsUrl} target="_blank" rel="noreferrer">ВЗЯТЬ БИЛЕТ ↗</a></div></div>

        <div className="route-card"><div className="place-copy"><p>ПОЧЕМУ ИМЕННО ТУДА</p><h3>{result.place.mood}</h3><p className="place-description">{result.place.description}</p><strong>РАЗВЕДАТЬ НА МЕСТЕ</strong><ul>{result.place.sights.map((sight) => <li key={sight}>{sight}</li>)}</ul></div><RouteMap from={result.route.from} to={result.route.to} /></div>

        <div className="alibis-head"><p>ПАКЕТ ПРИКРЫТИЯ · {result.llmSource === "openrouter" ? "OPENROUTER LLM" : result.llmSource === "yandexgpt" ? "YANDEXGPT" : "РЕЗЕРВНЫЙ ШТАБ"}</p><h3>Пять алиби для: {result.reasonLabel}</h3></div>
        <div className="alibi-list">{result.alibis.map((alibi, index) => <article className="alibi-option" key={`${index}-${alibi.slice(0, 12)}`}><span>0{index + 1}</span><blockquote>«{alibi}»</blockquote><button onClick={() => copyAlibi(index)}>{copied === index ? "СКОПИРОВАНО ✓" : "КОПИРОВАТЬ"}</button></article>)}</div>
      </section>}

      <footer><span>ЭКСПЕРИМЕНТ НА TUTU.RU MCP + OPENROUTER</span><span>БРОНИРОВАНИЙ НЕ СОВЕРШАЕМ · ТОЛЬКО ПОМОГАЕМ ИСЧЕЗНУТЬ</span></footer>
    </main>
  );
}
