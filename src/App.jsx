"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { toBlob } from "html-to-image";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  CornerDownLeft,
  Copy,
  Download,
  Flame,
  Loader2,
  Pin,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
   КОНФИГУРАЦИЯ
──────────────────────────────────────────────────────────────────────────── */

const MAX_STEPS = 4; // длина дуэли
const MIN_STEPS_TO_FINISH = 3; // с какого шага можно завершить досрочно

const LS_SESSION = "sdv.session.v1";
const LS_COUNTER = "sdv.counter.v1";
const LS_SOUND = "sdv.sound.v1";

const CARD_FORMATS = {
  story: { label: "9:16", hint: "Stories / Reels", width: 1080, height: 1920 },
  square: { label: "1:1", hint: "Квадратный постер", width: 1080, height: 1080 },
};
const EXPORT_PIXEL_RATIO = 2;
const EXPORT_PIXEL_RATIO_MOBILE = 1; // карточка уже 1080 px по ширине; 2× упирается в лимит памяти canvas на смартфонах
const EXPORT_TIMEOUT_MS = 30000;

const IS_TOUCH = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

function withTimeout(promise, ms, message) {
  let id;
  const timeout = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

// Ключ задаётся в файле .env.local:  VITE_API_KEY=gsk_...
const API_KEY = import.meta.env.VITE_API_KEY ?? "";
const API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = import.meta.env.VITE_MODEL || "qwen/qwen3.8-27b"; // llama-3.3-70b-versatile недоступна для этого ключа

// Newsreader / Instrument Serif не содержат кириллицы — для русских букв подхватывается Source Serif 4
const SERIF = { fontFamily: "'Newsreader', 'Source Serif 4', 'Times New Roman', serif" };
const SANS = { fontFamily: "'Geist', 'Helvetica Neue', Arial, sans-serif" };
const MONO = { fontFamily: "'Geist Mono', ui-monospace, Menlo, monospace" };
// дисплейный гротеск с кириллицей — только для заголовков и логотипа
const DISPLAY = { fontFamily: "'Onest', 'Geist', 'Helvetica Neue', Arial, sans-serif" };
// вертикальный градиент текста: белый → лёгкое серебро
const TITLE_GRADIENT = {
  backgroundImage: "linear-gradient(180deg, #ffffff 0%, #d4d4d8 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
  color: "transparent",
};

const BRASS = "#e2d7c3"; // светлая платина / холодное шампанское
const MILK = "#ececee"; // мягкий молочный вместо чистого белого

// моно-метка: 11px, uppercase, tracking-widest, приглушённый цвет
const LABEL = "text-[11px] uppercase tracking-widest text-zinc-500";
// матовое тёмное стекло с субпиксельной границей и мягким верхним бликом
const GLASS =
  "border border-white/[0.06] border-t-white/[0.12] bg-[#1a1d22]/70 backdrop-blur-xl shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.04)]";

const EXAMPLES = [
  "Я ещё не готов запускать проект",
  "Меня осудят",
  "Я боюсь, что у меня не получится",
  "Я просто самозванец в своей профессии",
];

const THINKING_PHRASES = [
  "ищу слабое звено",
  "взвешиваю иронию",
  "проверяю посылки на прочность",
  "подбираю один точный вопрос",
];

/* ────────────────────────────────────────────────────────────────────────────
   СИСТЕМНЫЙ ПРОМПТ
──────────────────────────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `Ты — «Сократический провокатор»: ироничный собеседник, адвокат дьявола для чужих ограничивающих убеждений.

Твоя задача — вскрыть скрытый абсурд, противоречие или неявную посылку в мысли человека и задать ОДИН обезоруживающий вопрос.

Правила:
— Отвечай по-русски, на «ты».
— Максимум 2–3 коротких предложения. Последнее — всегда один точный вопрос.
— Только один вопрос за ответ. Никаких списков, заголовков, markdown, эмодзи.
— Тон: сухая сократическая ирония, спокойное любопытство. Не злорадство и не издёвка над человеком — ирония направлена на мысль, а не на него.
— Никакого коучинга: не утешай, не мотивируй, не давай советов, не говори «я понимаю тебя», «это нормально», «ты молодец».
— Не ставь диагнозов и не упоминай терапию. Не выходи из роли.
— Цепляйся за конкретные слова человека, цитируй их. Каждый следующий вопрос должен углублять прошлый ответ, а не повторять его.
— Если человек уходит от ответа, мягко, но точно укажи на это.
— Если сообщение не содержит мысли, убеждения или страха, предложи назвать одну такую мысль.`;

function buildSystemPrompt(step) {
  const note =
    step >= MAX_STEPS
      ? `\n\nЭто финальный шаг (${step} из ${MAX_STEPS}). Подведи итог одной ироничной фразой и задай последний вопрос — такой, который человек унесёт с собой.`
      : `\n\nСейчас шаг ${step} из ${MAX_STEPS}.`;
  return SYSTEM_PROMPT + note;
}

/* ────────────────────────────────────────────────────────────────────────────
   LLM (Groq)
──────────────────────────────────────────────────────────────────────────── */

function httpErrorMessage(status, detail) {
  const base =
    status === 401 || status === 403
      ? "ключ отклонён"
      : status === 429
      ? "превышен лимит запросов, подожди немного"
      : status >= 500
      ? "сбой сервиса"
      : "запрос отклонён";
  return `${base} (${status})${detail ? ` — ${detail.slice(0, 140)}` : ""}`;
}

async function askLLM(history, step) {
  if (!API_KEY) throw new Error("API-ключ не задан (VITE_API_KEY)");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.85,
        max_tokens: 400,
        messages: [
          { role: "system", content: buildSystemPrompt(step) },
          ...history.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });

    if (!res.ok) {
      let detail = "";
      try {
        const j = await res.json();
        detail = j?.error?.message || "";
      } catch {
        /* тело не JSON */
      }
      throw new Error(httpErrorMessage(res.status, detail));
    }

    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/\*\*|__/g, "")
      .trim();
    if (!text) throw new Error("пустой ответ модели");
    return text;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("истекло время ожидания");
    if (e instanceof TypeError) throw new Error("нет соединения с сетью");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   УТИЛИТЫ
──────────────────────────────────────────────────────────────────────────── */

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим / переполнение */
  }
}

function loadInitialSession() {
  const s = readLS(LS_SESSION, null);
  const empty = { messages: [], insight: null, finished: false, draft: "" };
  if (!s || !Array.isArray(s.messages)) return empty;

  // сессия оборвалась на вопросе без ответа — возвращаем текст в поле ввода
  const messages = [...s.messages];
  let draft = "";
  if (messages.at(-1)?.role === "user") draft = messages.pop().content;
  return { messages, insight: s.insight ?? null, insightNo: s.insightNo ?? null, finished: !!s.finished, draft };
}

function nextSessionNo() {
  const n = (Number(readLS(LS_COUNTER, 0)) || 0) + 1;
  writeLS(LS_COUNTER, n);
  return n;
}

function formatDateRu(d = new Date()) {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
}

/* ────────────────────────────────────────────────────────────────────────────
   ЗВУК (Web Audio API, всё синтезируется процедурно)
──────────────────────────────────────────────────────────────────────────── */

const DEFAULT_SOUND = { muted: true, ui: true, ambient: true, volume: 0.6 };

function loadSoundSettings() {
  const s = readLS(LS_SOUND, null);
  if (!s || typeof s !== "object") return DEFAULT_SOUND;
  const volume = Number(s.volume);
  return {
    muted: s.muted !== false,
    ui: s.ui !== false,
    ambient: s.ambient !== false,
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_SOUND.volume,
  };
}

const audio = (() => {
  let ctx = null;
  let master = null;
  let uiGain = null;
  let whiteBuf = null;
  let crackleBuf = null;
  let ambient = null; // { gain, nodes[] } пока эмбиент звучит
  let ambientWanted = false;
  let stopTimer = null;
  let lastClick = 0;

  const supported = () =>
    typeof window !== "undefined" && !!(window.AudioContext || window.webkitAudioContext);

  function makeBuffer(seconds, fill) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    fill(buf.getChannelData(0), len);
    return buf;
  }

  // бесшовный цикл: хвост плавно перетекает в начало (equal-power кроссфейд)
  function makeBrownLoop(seconds) {
    const fade = Math.floor(ctx.sampleRate * 1.5);
    const len = Math.floor(ctx.sampleRate * seconds);
    const raw = new Float32Array(len + fade);
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      raw[i] = last * 3.5;
    }
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const out = buf.getChannelData(0);
    for (let i = 0; i < len; i++) out[i] = raw[i];
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      out[i] = raw[i] * Math.sin((t * Math.PI) / 2) + raw[len + i] * Math.cos((t * Math.PI) / 2);
    }
    return buf;
  }

  function ensure() {
    if (ctx) return ctx;
    if (!supported()) return null;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    uiGain = ctx.createGain();
    uiGain.connect(master);

    whiteBuf = makeBuffer(2, (d, len) => {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    });
    // редкие импульсы — виниловое потрескивание
    crackleBuf = makeBuffer(5, (d, len) => {
      for (let i = 0; i < len; i++) {
        if (Math.random() < 0.0006) d[i] = (Math.random() * 2 - 1) * (0.3 + Math.random() * 0.7);
        else if (Math.random() < 0.00005) d[i] = (Math.random() < 0.5 ? -1 : 1) * 0.9;
      }
    });
    return ctx;
  }

  function startAmbient() {
    if (!ctx) return;
    if (ambient) {
      // эмбиент ещё затухает после выключения — возвращаем громкость
      clearTimeout(stopTimer);
      ambient.gain.gain.cancelScheduledValues(ctx.currentTime);
      ambient.gain.gain.setTargetAtTime(0.5, ctx.currentTime, 0.6);
      return;
    }
    clearTimeout(stopTimer);
    const nodes = [];
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);

    // глубокий коричневый шум, «дышащий» от медленного LFO
    const brown = ctx.createBufferSource();
    brown.buffer = makeBrownLoop(10);
    brown.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    const breath = ctx.createGain();
    breath.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.3;
    lfo.connect(lfoDepth).connect(breath.gain);
    brown.connect(lp).connect(breath).connect(gain);

    // тихий дрон из двух слегка расстроенных синусов
    const drone = ctx.createGain();
    drone.gain.value = 0.05;
    drone.connect(gain);
    [55, 55.4, 82.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const lg = ctx.createGain();
      lg.gain.value = i === 2 ? 0.35 : 1;
      o.connect(lg).connect(drone);
      o.start();
      nodes.push(o);
    });
    const droneLfo = ctx.createOscillator();
    droneLfo.frequency.value = 0.05;
    const droneDepth = ctx.createGain();
    droneDepth.gain.value = 0.03;
    droneLfo.connect(droneDepth).connect(drone.gain);

    // потрескивание винила
    const crackle = ctx.createBufferSource();
    crackle.buffer = crackleBuf;
    crackle.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    const crackleGain = ctx.createGain();
    crackleGain.gain.value = 0.5;
    crackle.connect(hp).connect(crackleGain).connect(gain);

    [brown, lfo, droneLfo, crackle].forEach((n) => n.start());
    nodes.push(brown, lfo, droneLfo, crackle);

    ambient = { gain, nodes };
    gain.gain.setTargetAtTime(0.5, ctx.currentTime, 1.2);
  }

  function stopAmbient() {
    if (!ctx || !ambient) return;
    const cur = ambient;
    cur.gain.gain.cancelScheduledValues(ctx.currentTime);
    cur.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      cur.nodes.forEach((n) => {
        try {
          n.stop();
        } catch {
          /* уже остановлен */
        }
      });
      cur.gain.disconnect();
      if (ambient === cur) ambient = null;
    }, 2200);
  }

  function noiseSource(offsetRandom = true) {
    const src = ctx.createBufferSource();
    src.buffer = whiteBuf;
    src.loop = true;
    src.start(0, offsetRandom ? Math.random() * 1.5 : 0);
    return src;
  }

  return {
    supported,

    // вызывать синхронно из обработчика клика (политика автоплея)
    unlock() {
      const c = ensure();
      if (c && c.state !== "running") c.resume().catch(() => {});
      return !!c;
    },

    apply({ muted, ui, ambient: ambOn, volume }) {
      if (!ctx) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(muted ? 0 : volume, now, 0.08);
      uiGain.gain.setTargetAtTime(ui ? 1 : 0, now, 0.05);
      ambientWanted = !muted && ambOn;
      if (ambientWanted) startAmbient();
      else stopAmbient();
    },

    typeClick() {
      if (!ctx || ctx.state !== "running") return;
      const now = ctx.currentTime;
      if (now - lastClick < 0.045) return;
      lastClick = now;

      const dur = 0.012 + Math.random() * 0.008;
      const src = noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1100 + Math.random() * 700;
      bp.Q.value = 5;
      const g = ctx.createGain();
      const peak = 0.55 + Math.random() * 0.3;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(bp).connect(g).connect(uiGain);

      // глухой «стук» каретки под щелчком
      const thump = ctx.createOscillator();
      thump.type = "sine";
      thump.frequency.setValueAtTime(150 + Math.random() * 50, now);
      thump.frequency.exponentialRampToValueAtTime(70, now + dur);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, now);
      tg.gain.linearRampToValueAtTime(0.35, now + 0.001);
      tg.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.006);
      thump.connect(tg).connect(uiGain);

      src.stop(now + dur + 0.02);
      thump.start(now);
      thump.stop(now + dur + 0.02);
    },

    burn() {
      if (!ctx || ctx.state !== "running") return;
      const now = ctx.currentTime;
      const total = 1.5;

      // низкий плотный шум: lowpass плавно закрывается — «рассыпающийся пепел»
      const src = noiseSource();
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(2200, now);
      lp.frequency.exponentialRampToValueAtTime(90, now + 1.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.9, now + 0.12);
      g.gain.exponentialRampToValueAtTime(0.35, now + 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, now + total);
      src.connect(lp).connect(g).connect(uiGain);
      src.stop(now + total + 0.05);

      // шелест и искры
      const sparks = ctx.createBufferSource();
      sparks.buffer = crackleBuf;
      sparks.start(0, Math.random() * 3);
      const sbp = ctx.createBiquadFilter();
      sbp.type = "bandpass";
      sbp.frequency.value = 2600;
      sbp.Q.value = 0.8;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.9, now);
      sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      sparks.connect(sbp).connect(sg).connect(uiGain);
      sparks.stop(now + 1.3);
    },
  };
})();

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/* ────────────────────────────────────────────────────────────────────────────
   КАРТОЧКА ИНСАЙТА (рендерится вне экрана и экспортируется в PNG)
──────────────────────────────────────────────────────────────────────────── */

const InsightCard = React.forwardRef(function InsightCard({ format, original, insight, no, date }, ref) {
  const { width, height } = CARD_FORMATS[format];
  const story = format === "story";
  const len = insight.length;
  const base = len <= 60 ? 112 : len <= 110 ? 92 : len <= 180 ? 76 : len <= 280 ? 62 : 50;
  const insightSize = story ? base : Math.round(base * 0.82);
  const origText = original.length > 150 ? `${original.slice(0, 147).trimEnd()}…` : original;
  const pad = story ? 100 : 88;

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        width,
        height,
        boxSizing: "border-box",
        padding: pad,
        overflow: "hidden",
        background: "linear-gradient(180deg, #181b20 0%, #14161a 55%, #121418 100%)",
        color: "#ececee",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        ...SANS,
      }}
    >
      {/* свечение */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(75% 48% at 50% 0%, rgba(201,208,216,0.16) 0%, rgba(201,208,216,0.04) 50%, rgba(201,208,216,0) 75%), radial-gradient(40% 24% at 62% 0%, rgba(226,215,195,0.08) 0%, rgba(226,215,195,0) 100%), radial-gradient(60% 40% at 100% 100%, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 70%)",
        }}
      />
      {/* зерно */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, backgroundSize: "320px 320px", opacity: 0.07 }} />
      {/* рамка */}
      <div
        style={{
          position: "absolute",
          inset: 36,
          border: "1px solid rgba(226,215,195,0.28)",
          borderRadius: 6,
        }}
      />

      {/* верх */}
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ width: 56, height: 1, background: "#e2d7c3", display: "block" }} />
          <span style={{ ...DISPLAY, fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: "#f4f4f5" }}>
            Сократический провокатор
          </span>
          <span style={{ ...MONO, fontSize: 20, letterSpacing: "0.22em", color: "#e2d7c3", textTransform: "uppercase", opacity: 0.8 }}>
            Артефакт мысли
          </span>
        </div>
        <p
          style={{
            margin: `${story ? 64 : 44}px 0 0`,
            maxWidth: width - pad * 2 - 40,
            fontSize: story ? 38 : 34,
            lineHeight: 1.35,
            fontWeight: 300,
            color: "#8d9097",
            textDecoration: "line-through",
            textDecorationColor: "#e2d7c3",
            textDecorationThickness: "2px",
          }}
        >
          «{origText}»
        </p>
      </div>

      {/* центр */}
      <div style={{ position: "relative" }}>
        <span
          style={{
            ...SERIF,
            display: "block",
            fontSize: insightSize * 1.1,
            lineHeight: 0.8,
            color: "#e2d7c3",
            marginBottom: 12,
            fontStyle: "italic",
          }}
        >
          «
        </span>
        <p
          style={{
            ...SERIF,
            margin: 0,
            fontSize: insightSize,
            lineHeight: 1.16,
            fontWeight: 300,
            letterSpacing: "-0.018em",
            color: "#ececee",
            overflowWrap: "break-word",
          }}
        >
          {insight}
        </p>
      </div>

      {/* низ */}
      <div style={{ position: "relative" }}>
        <div style={{ height: 1, background: "rgba(226,215,195,0.22)", marginBottom: 28 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
          <div>
            <p style={{ ...SERIF, margin: 0, fontSize: 34, fontStyle: "italic", fontWeight: 300, color: "#c9c9cf" }}>
              Иллюзия препарирована.
            </p>
            <p style={{ ...MONO, margin: "14px 0 0", fontSize: 20, letterSpacing: "0.16em", color: "#6f6f75", textTransform: "uppercase" }}>
              {date}
            </p>
          </div>
          <p style={{ ...MONO, margin: 0, fontSize: 20, letterSpacing: "0.16em", color: "#6f6f75" }}>
            № {String(no ?? 1).padStart(4, "0")}
          </p>
        </div>
      </div>
    </div>
  );
});

/* ────────────────────────────────────────────────────────────────────────────
   КОМПОНЕНТЫ
──────────────────────────────────────────────────────────────────────────── */

function GlobalStyles() {
  return (
    <style>{`
      @keyframes sdv-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
      @keyframes sdv-pulse { 0%, 100% { opacity: .25 } 50% { opacity: 1 } }
      .sdv-caret { display:inline-block; width:.5ch; height:1.05em; margin-left:2px; vertical-align:-.15em; background:#e2d7c3; animation: sdv-blink 1s steps(1) infinite; }
      .sdv-scroll::-webkit-scrollbar { width: 6px }
      .sdv-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 6px }
      .sdv-root ::selection { background: #e2d7c3; color: #131518 }
      .sdv-root textarea::placeholder { color: #5b5f68 }
    `}</style>
  );
}

function Typewriter({ text, animate, onDone, onTick, onType }) {
  const reduce = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    []
  );
  const instant = !animate || reduce;
  const [n, setN] = useState(instant ? text.length : 0);
  const nRef = useRef(instant ? text.length : 0);
  const cbRef = useRef({ onDone, onTick, onType });
  cbRef.current = { onDone, onTick, onType };

  useEffect(() => {
    if (instant) {
      if (animate) cbRef.current.onDone?.();
      return;
    }
    const id = setInterval(() => {
      const prev = nRef.current;
      nRef.current = Math.min(prev + 2, text.length);
      setN(nRef.current);
      cbRef.current.onTick?.();
      // щелчок только если среди новых символов есть буква/цифра (без пробелов и пунктуации)
      if (/[\p{L}\p{N}]/u.test(text.slice(prev, nRef.current))) cbRef.current.onType?.();
      if (nRef.current >= text.length) {
        clearInterval(id);
        cbRef.current.onDone?.();
      }
    }, 22);
    return () => clearInterval(id);
  }, [text, instant, animate]);

  const skip = () => {
    nRef.current = text.length;
    setN(text.length);
  };

  return (
    <span onClick={n < text.length ? skip : undefined} className={n < text.length ? "cursor-pointer" : ""}>
      {text.slice(0, n)}
      {n < text.length && <span className="sdv-caret" />}
    </span>
  );
}

function SoundControl({ sound, onToggleMuted, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const Icon = sound.muted ? VolumeX : Volume2;

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = ({ label, checked, field }) => (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-[13px] text-zinc-400 transition-colors hover:text-zinc-200">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange({ [field]: e.target.checked })}
        className="h-4 w-4 cursor-pointer accent-[#e2d7c3]"
      />
    </label>
  );

  const btn =
    "flex h-9 items-center justify-center rounded-full transition-colors duration-300 [@media(pointer:coarse)]:h-11";

  return (
    <div ref={rootRef} className="relative ml-auto flex shrink-0 items-center sm:ml-0">
      <div className="flex items-center rounded-full border border-white/[0.08] border-t-white/[0.14] bg-white/[0.04] p-0.5 shadow-[0_4px_16px_-6px_rgba(0,0,0,0.6)] backdrop-blur-md">
        <motion.button
          type="button"
          onClick={onToggleMuted}
          whileTap={{ scale: 0.94 }}
          aria-label={sound.muted ? "Включить звук" : "Выключить звук"}
          aria-pressed={!sound.muted}
          title={sound.muted ? "Включить звук" : "Выключить звук"}
          className={`${btn} w-9 hover:bg-white/[0.06] [@media(pointer:coarse)]:w-11 ${
            sound.muted ? "text-zinc-500 hover:text-zinc-200" : "text-[#e2d7c3]"
          }`}
        >
          <Icon className="h-4 w-4" />
        </motion.button>
        <span aria-hidden className="h-4 w-px bg-white/[0.08]" />
        <motion.button
          type="button"
          onClick={() => setOpen((o) => !o)}
          whileTap={{ scale: 0.94 }}
          aria-label="Настройки звука"
          aria-expanded={open}
          className={`${btn} w-8 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 [@media(pointer:coarse)]:w-10`}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        </motion.button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-full z-40 mt-2 w-60 max-w-[calc(100vw-2.5rem)] rounded-2xl border border-white/[0.06] border-t-white/[0.12] bg-[#1a1d22]/90 p-3.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:left-0 sm:right-auto"
          >
            <p className={`mb-1 ${LABEL}`} style={MONO}>
              Звук
            </p>
            {toggle({ label: "Звуки интерфейса", checked: sound.ui, field: "ui" })}
            {toggle({ label: "Эмбиент-фон", checked: sound.ambient, field: "ambient" })}
            <div className="mt-1 flex min-h-11 items-center gap-3 border-t border-white/[0.06] pt-2">
              <Volume2 className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sound.volume}
                onChange={(e) => onChange({ volume: Number(e.target.value) })}
                aria-label="Громкость"
                className="sdv-range h-6 w-full cursor-pointer"
              />
            </div>
            {sound.muted && <p className="mt-2 text-[11px] text-zinc-500">Звук выключен — нажми на динамик.</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Thinking() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % THINKING_PHRASES.length), 1500);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      className={`inline-flex max-w-full items-center gap-3 rounded-full px-4 py-2.5 text-[12px] text-zinc-400 ${GLASS}`}
      style={MONO}
    >
      <span className="flex shrink-0 gap-1" aria-hidden>
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="h-1 w-1 rounded-full bg-[#e2d7c3]"
            style={{ animation: `sdv-pulse 1.2s ease-in-out ${d * 0.2}s infinite` }}
          />
        ))}
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
          className="min-w-0"
        >
          провокатор размышляет — {THINKING_PHRASES[i]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function AutoTextarea({ value, onChange, onKeyDown, placeholder, minRows = 3, maxHeight = 320, className = "", style, disabled, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // замеряем целевую высоту и возвращаем текущую, чтобы CSS-transition плавно доехал до новой
    const prev = el.style.height;
    el.style.height = "auto";
    const next = `${el.scrollHeight}px`; // потолок задаёт CSS max-height
    el.style.height = prev || next;
    void el.offsetHeight;
    el.style.height = next;
  }, [value, maxHeight]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus && !IS_TOUCH} // на смартфоне автофокус сразу выдвигает клавиатуру и закрывает диалог
      spellCheck={false}
      enterKeyHint="send"
      className={`sdv-scroll sdv-autosize w-full resize-none bg-transparent outline-none ${className}`}
      style={{ ...style, maxHeight: `min(${maxHeight}px, 40dvh)` }}
    />
  );
}

/* Парящая карточка ввода: мягкий фокус, латунная кнопка с иконкой стрелки */
function Composer({
  value,
  onChange,
  onKeyDown,
  onSubmit,
  placeholder,
  submitLabel,
  canSubmit,
  loading,
  footerLeft,
  minRows = 2,
  maxHeight = 220,
  autoFocus,
  large,
}) {
  const off = !canSubmit || loading;
  return (
    <div
      className={`group/composer rounded-2xl p-3 transition-[border-color,box-shadow,background-color] duration-500 focus-within:border-[#e2d7c3]/30 focus-within:border-t-[#e2d7c3]/50 focus-within:bg-[#1e2127]/80 focus-within:shadow-[0_0_0_4px_rgba(226,215,195,0.05),0_24px_64px_-16px_rgba(0,0,0,0.55),0_0_48px_-12px_rgba(226,215,195,0.14)] sm:p-4 ${GLASS}`}
    >
      <AutoTextarea
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        minRows={minRows}
        maxHeight={maxHeight}
        autoFocus={autoFocus}
        className={`px-1 leading-relaxed ${large ? "text-base sm:text-xl" : "text-base sm:text-lg"}`}
        style={{ ...SERIF, fontWeight: 300, color: MILK }}
      />
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
        <div className="min-w-0">
          {footerLeft ?? (
            <span className={`hidden items-center gap-1.5 sm:inline-flex ${LABEL} normal-case`} style={MONO}>
              <kbd className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-zinc-400">
                Ctrl <CornerDownLeft className="h-3 w-3" />
              </kbd>
              отправить
            </span>
          )}
        </div>
        <motion.button
          type="button"
          onClick={onSubmit}
          disabled={off}
          whileHover={off ? undefined : { y: -1 }}
          whileTap={off ? undefined : { scale: 0.98 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          aria-label={submitLabel}
          className={`group ml-auto inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full pl-5 pr-3 text-[13px] font-medium tracking-tight transition-[background,box-shadow,color] duration-300 ${
            off
              ? "cursor-not-allowed bg-white/[0.05] text-zinc-600"
              : "bg-gradient-to-b from-[#f0e8d8] to-[#d4c5a9] text-[#1a1710] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5),inset_0_-1px_0_0_rgba(0,0,0,0.12),0_8px_24px_-8px_rgba(226,215,195,0.4)] hover:from-[#f6efe1] hover:to-[#dccfb5]"
          }`}
          style={SANS}
        >
          {loading ? "Размышляю…" : submitLabel}
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full ${
              off ? "bg-white/[0.05]" : "bg-[#1a1710]/10"
            }`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5" />
            )}
          </span>
        </motion.button>
      </div>
    </div>
  );
}

function GhostButton({ children, onClick, icon: Icon, danger, disabled }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-[13px] transition-[border-color,background-color,color] duration-300 ${
        disabled
          ? "cursor-wait border-white/[0.06] text-zinc-500"
          : danger
          ? "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-red-400/40 hover:bg-red-400/[0.06] hover:text-red-300"
          : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-white/25 hover:bg-white/[0.06] hover:text-zinc-100"
      }`}
      style={SANS}
    >
      {Icon && <Icon className={`h-3.5 w-3.5 ${Icon === Loader2 ? "animate-spin" : ""}`} />}
      {children}
    </motion.button>
  );
}

/* 4 сегмента: заполняются латунью по мере прохождения сессии */
function StepBar({ done, total }) {
  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-label={`Раунд ${done} из ${total}`}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="relative h-1 w-7 overflow-hidden rounded-full bg-white/[0.08] sm:w-10">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#cfc3a8] to-[#ece3d2] shadow-[0_0_10px_rgba(226,215,195,0.5)]"
            initial={false}
            animate={{ width: i < done ? "100%" : "0%" }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      ))}
    </div>
  );
}

function ErrorBlock({ message, onRetry }) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border border-red-400/15 border-t-red-400/30 bg-red-500/[0.04] p-5 backdrop-blur-xl sm:p-6"
    >
      <p className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-widest text-red-300/80" style={MONO}>
        <CircleAlert className="h-3.5 w-3.5" />
        Нет связи
      </p>
      <p className="text-lg leading-relaxed text-zinc-300 sm:text-xl" style={{ ...SERIF, fontWeight: 300 }}>
        Эфир заблокирован. Ошибка связи с разумом:{" "}
        <span className="text-red-200/90">{message}</span>
      </p>
      <div className="mt-5">
        <GhostButton onClick={onRetry} icon={RotateCcw}>
          Попробовать снова
        </GhostButton>
      </div>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   ПРИЛОЖЕНИЕ
──────────────────────────────────────────────────────────────────────────── */

export default function App() {
  const initial = useRef(null);
  if (initial.current === null) initial.current = loadInitialSession();

  const [messages, setMessages] = useState(initial.current.messages);
  const [insight, setInsight] = useState(initial.current.insight);
  const [insightNo, setInsightNo] = useState(initial.current.insightNo);
  const [manualFinish, setManualFinish] = useState(initial.current.finished);
  const [draft, setDraft] = useState(initial.current.draft);
  const [insightDraft, setInsightDraft] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [typingId, setTypingId] = useState(null);
  const [burning, setBurning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cardFormat, setCardFormat] = useState("story");
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState(null);

  const reqRef = useRef(0);
  const endRef = useRef(null);
  const cardRef = useRef(null);
  const toastTimer = useRef(null);

  const [sound, setSound] = useState(loadSoundSettings);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => {
    writeLS(LS_SOUND, sound);
    audio.apply(sound);
    if (sound.muted) return;
    // после перезагрузки AudioContext разблокируется первым жестом пользователя
    const unlock = () => {
      audio.unlock();
      audio.apply(soundRef.current);
    };
    audio.unlock();
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [sound]);

  const toggleMuted = () => {
    if (sound.muted && !audio.unlock()) return; // Web Audio недоступен — остаёмся без звука
    setSound((s) => ({ ...s, muted: !s.muted }));
  };
  const changeSound = (patch) => setSound((s) => ({ ...s, ...patch }));
  const typeClick = useCallback(() => {
    if (!soundRef.current.muted && soundRef.current.ui) audio.typeClick();
  }, []);
  const userCount = messages.filter((m) => m.role === "user").length;
  const assistantCount = messages.filter((m) => m.role === "assistant").length;
  const finished = assistantCount >= MAX_STEPS || manualFinish;
  const settled = !loading && typingId === null;

  useEffect(() => {
    if (messages.length === 0) writeLS(LS_SESSION, null);
    else writeLS(LS_SESSION, { messages, insight, insightNo, finished: manualFinish });
  }, [messages, insight, insightNo, manualFinish]);

  const scrollDown = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  useEffect(() => {
    if (messages.length) scrollDown();
  }, [messages.length, loading, error, finished, settled, insight, scrollDown]);

  useEffect(() => {
    // при появлении/скрытии виртуальной клавиатуры держим поле ответа в зоне видимости
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (document.activeElement?.tagName === "TEXTAREA") scrollDown();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [scrollDown]);

  const requestReply = async (history) => {
    const step = history.filter((m) => m.role === "user").length;
    const rid = ++reqRef.current;

    setError(null);
    setLoading(true);

    try {
      const content = await askLLM(history, step);
      if (rid !== reqRef.current) return; // диалог сожжён, пока шёл запрос
      const reply = { id: uid(), role: "assistant", content };
      setMessages((m) => [...m, reply]);
      setTypingId(reply.id);
      setLoading(false);
    } catch (e) {
      if (rid !== reqRef.current) return;
      setError(e.message || "неизвестный сбой");
      setLoading(false);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || loading || typingId !== null || finished || error) return;

    const history = [...messages, { id: uid(), role: "user", content: text }];
    setMessages(history);
    setDraft("");
    requestReply(history);
  };

  const retry = () => {
    if (loading) return;
    requestReply(messages);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  };

  const burn = () => {
    if (burning) return;
    reqRef.current++;
    setBurning(true);
    if (!sound.muted && sound.ui) audio.burn();
    setTimeout(() => {
      setMessages([]);
      setInsight(null);
      setInsightNo(null);
      setManualFinish(false);
      setDraft("");
      setInsightDraft("");
      setLoading(false);
      setError(null);
      setTypingId(null);
      setBurning(false);
      window.scrollTo({ top: 0 });
    }, 900);
  };

  const saveInsight = () => {
    const t = insightDraft.trim();
    if (!t) return;
    setInsight(t);
    if (insightNo == null) setInsightNo(nextSessionNo());
  };

  const showToast = (text) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  const exportCard = async () => {
    if (exporting || !cardRef.current) return;
    setExporting(true);
    try {
      // шрифты должны быть загружены до снимка, иначе текст уйдёт запасным шрифтом
      // (с таймаутом: на плохой сети Google Fonts не должен вешать экспорт)
      await withTimeout(
        Promise.all([
          document.fonts.load("300 40px 'Newsreader'"),
          document.fonts.load("italic 300 40px 'Newsreader'"),
          document.fonts.load("300 40px 'Source Serif 4'"),
          document.fonts.load("italic 300 40px 'Source Serif 4'"),
          document.fonts.load("300 40px 'Geist'"),
          document.fonts.load("700 30px 'Onest'"),
          document.fonts.load("400 20px 'Geist Mono'"),
        ]).then(() => document.fonts.ready),
        6000,
        "fonts"
      ).catch(() => {});

      const { width, height } = CARD_FORMATS[cardFormat];
      const options = {
        pixelRatio: IS_TOUCH ? EXPORT_PIXEL_RATIO_MOBILE : EXPORT_PIXEL_RATIO,
        width,
        height,
        backgroundColor: "#14161a",
      };
      const render = async () => {
        // Safari iOS первым вызовом часто отдаёт пустой/без шрифтов снимок — прогреваем рендер
        if (IS_IOS) await toBlob(cardRef.current, options).catch(() => null);
        const b = await toBlob(cardRef.current, options);
        if (!b) throw new Error("пустой снимок");
        return b;
      };
      const blob = await withTimeout(render(), EXPORT_TIMEOUT_MS, "превышено время ожидания");

      const filename = `socratic-insight-${new Date().toISOString().slice(0, 10)}-${cardFormat === "story" ? "9x16" : "1x1"}.png`;

      // iOS (особенно с домашнего экрана) не умеет надёжно скачивать файлы — отдаём в системное меню «Поделиться / Сохранить»
      if (IS_IOS && navigator.canShare) {
        const file = new File([blob], filename, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file] });
            return;
          } catch (e) {
            if (e?.name === "AbortError") return; // пользователь закрыл меню
          }
        }
      }

      // blob-URL вместо огромного data-URL: не подвешивает вкладку
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      showToast(`Не удалось создать карточку${e?.message ? `: ${String(e.message).slice(0, 100)}` : ""}`);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const copyInsight = async () => {
    try {
      await navigator.clipboard.writeText(insight);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard недоступен */
    }
  };

  const hasSession = messages.length > 0;
  const canSubmit = draft.trim().length > 0;

  return (
    <MotionConfig reducedMotion="user">
      <GlobalStyles />
      <div
        className="sdv-root relative min-h-[100dvh] overflow-x-clip bg-[#131518] text-zinc-300 antialiased"
        style={SANS}
      >
        {/* фон: верхний рассеянный свет — утренняя дымка / холодная лунная амбра + тонкие направляющие */}
        <div aria-hidden className="pointer-events-none fixed inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_-8%,rgba(196,204,214,0.17),rgba(196,204,214,0.05)_45%,transparent_75%),radial-gradient(ellipse_40%_28%_at_62%_-4%,rgba(226,215,195,0.08),transparent_80%)]" />
          <div className="absolute inset-y-0 left-[max(1.5rem,calc(50%-26rem))] w-px bg-gradient-to-b from-transparent via-white/[0.05] to-transparent" />
          <div className="absolute inset-y-0 right-[max(1.5rem,calc(50%-26rem))] w-px bg-gradient-to-b from-transparent via-white/[0.05] to-transparent" />
        </div>

        {/* аналоговое зерно поверх всего интерфейса */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[100] opacity-[0.035]"
          style={{ backgroundImage: GRAIN, backgroundSize: "320px 320px" }}
        />

        {/* шапка */}
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#131518]/60 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl items-center py-2 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]">
            <div className="flex min-w-0 flex-1 items-center gap-3 sm:flex-none">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.06] border-t-white/[0.12] bg-white/[0.04] text-[13px] text-[#e2d7c3]"
                style={SERIF}
              >
                Σ
              </span>
              <span
                className="truncate text-[15px] font-semibold tracking-[-0.03em] sm:text-base"
                style={{ ...DISPLAY, ...TITLE_GRADIENT }}
              >
                Сократический провокатор
              </span>
              {audio.supported() && (
                <SoundControl sound={sound} onToggleMuted={toggleMuted} onChange={changeSound} />
              )}
            </div>
          </div>
        </header>

        <main className="relative z-10 mx-auto max-w-3xl pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-[calc(6rem+env(safe-area-inset-bottom))]">
          <motion.div
            animate={burning ? { opacity: 0, filter: "blur(14px)", y: -10, scale: 0.985 } : { opacity: 1, filter: "blur(0px)", y: 0, scale: 1 }}
            transition={{ duration: 0.85, ease: [0.4, 0, 0.2, 1] }}
          >
            <AnimatePresence mode="wait" initial={false}>
              {!hasSession ? (
                /* ───────── ГЛАВНЫЙ ЭКРАН ───────── */
                <motion.section
                  key="hero"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="pt-[8dvh] sm:pt-[12dvh]"
                >
                  <p className={`mb-6 ${LABEL}`} style={MONO}>
                    Приватная сессия · {MAX_STEPS} шага
                  </p>
                  <h1
                    className="text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] min-[390px]:text-5xl sm:text-7xl"
                    style={{ ...DISPLAY, ...TITLE_GRADIENT }}
                  >
                    Вскрой свои
                    <br />
                    <em className="not-italic" style={{ WebkitTextFillColor: "#e2d7c3", color: "#e2d7c3" }}>
                      ментальные
                    </em>{" "}
                    тупики.
                  </h1>
                  <p className="mt-6 max-w-lg text-base leading-relaxed text-zinc-400">
                    Напиши мысль, которая тебя тормозит. Я не буду утешать — я найду в ней скрытый абсурд и задам один
                    вопрос, на который трудно ответить уклончиво.
                  </p>

                  <div className="mt-10 sm:mt-12">
                    <Composer
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onKeyDown}
                      onSubmit={send}
                      placeholder="Какая мысль или страх держит тебя прямо сейчас?"
                      submitLabel="Вскрыть"
                      canSubmit={canSubmit}
                      loading={loading}
                      minRows={4}
                      maxHeight={320}
                      autoFocus
                      large
                    />
                  </div>

                  <div className="mt-6 flex flex-wrap gap-2">
                    {EXAMPLES.map((ex) => (
                      <motion.button
                        key={ex}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setDraft(ex)}
                        className="inline-flex min-h-11 items-center rounded-full border border-white/[0.08] bg-white/[0.02] px-4 py-1.5 text-left text-[13px] text-zinc-400 transition-[border-color,background-color,color] duration-300 hover:border-[#e2d7c3]/40 hover:bg-[#e2d7c3]/[0.06] hover:text-zinc-100"
                      >
                        {ex}
                      </motion.button>
                    ))}
                  </div>
                </motion.section>
              ) : (
                /* ───────── ДУЭЛЬ ───────── */
                <motion.section
                  key="session"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="pt-10"
                >
                  <div className="mb-8 flex items-center justify-between gap-3 sm:mb-10">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                      <span className={`whitespace-nowrap ${LABEL}`} style={MONO}>
                        Шаг {String(Math.min(Math.max(userCount, 1), MAX_STEPS)).padStart(2, "0")} //{" "}
                        {String(MAX_STEPS).padStart(2, "0")}
                      </span>
                      <StepBar done={assistantCount} total={MAX_STEPS} />
                    </div>
                    {!finished && (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={burn}
                        className="-mr-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[11px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-red-300"
                        style={MONO}
                      >
                        <Flame className="h-3.5 w-3.5" />
                        Сжечь
                      </motion.button>
                    )}
                  </div>

                  <div className="space-y-6 sm:space-y-8">
                    {messages.map((m, idx) =>
                      m.role === "user" ? (
                        <motion.div
                          key={m.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.4 }}
                          className="sm:pl-16"
                        >
                          <p className={`mb-2 px-1 ${LABEL}`} style={MONO}>
                            Ты · {String(Math.ceil((idx + 1) / 2)).padStart(2, "0")}
                          </p>
                          <p className="whitespace-pre-wrap break-words rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-base leading-relaxed text-zinc-300 sm:px-5 sm:text-[17px]">
                            {m.content}
                          </p>
                        </motion.div>
                      ) : (
                        <motion.div
                          key={m.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.4 }}
                          className={`relative overflow-hidden rounded-2xl p-5 sm:p-7 ${GLASS}`}
                        >
                          <div
                            aria-hidden
                            className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent                             via-[#e2d7c3]/50 to-transparent"
                          />
                                                      <p className={`mb-3 flex items-center gap-2 ${LABEL} text-[#e2d7c3]/80`} style={MONO}>
                                                        <span className="h-1 w-1 rounded-full bg-[#e2d7c3] shadow-[0_0_8px_rgba(226,215,195,0.7)]" />
                            Провокатор
                          </p>
                          <p
                            className="whitespace-pre-wrap break-words text-xl leading-relaxed sm:text-[28px]"
                            style={{ ...SERIF, fontWeight: 300, color: MILK }}
                          >
                            <Typewriter
                              text={m.content}
                              animate={m.id === typingId}
                              onTick={scrollDown}
                              onType={typeClick}
                              onDone={() => setTypingId((id) => (id === m.id ? null : id))}
                            />
                          </p>
                        </motion.div>
                      )
                    )}

                    <AnimatePresence>
                      {loading && (
                        <motion.div
                          key="thinking"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          <Thinking />
                        </motion.div>
                      )}
                      {error && !loading && <ErrorBlock key="error" message={error} onRetry={retry} />}
                    </AnimatePresence>
                  </div>

                  {/* ввод следующего шага */}
                  <AnimatePresence>
                    {!finished && settled && !error && (
                      <motion.div
                        key="reply"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4 }}
                        className="mt-8 sm:mt-12"
                      >
                        <Composer
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={onKeyDown}
                          onSubmit={send}
                          placeholder="Ответь честно — не красиво."
                          submitLabel="Ответить"
                          canSubmit={canSubmit}
                          loading={loading}
                          minRows={2}
                          maxHeight={220}
                          autoFocus
                          footerLeft={
                            userCount >= MIN_STEPS_TO_FINISH ? (
                              <button
                                onClick={() => setManualFinish(true)}
                                className="min-h-11 text-[12px] text-zinc-500 underline decoration-white/15 underline-offset-4 transition-colors hover:text-zinc-200 hover:decoration-white/40"
                              >
                                Завершить сейчас
                              </button>
                            ) : undefined
                          }
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* финал */}
                  <AnimatePresence>
                    {finished && settled && (
                      <motion.div
                        key="finish"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                        className="mt-14 border-t border-white/[0.08] pt-10"
                      >
                        <p className={`mb-4 ${LABEL}`} style={MONO}>
                          Дуэль окончена
                        </p>

                        {insight ? (
                          <div className="rounded-2xl border border-[#e2d7c3]/20 border-t-[#e2d7c3]/40 bg-[#e2d7c3]/[0.04] p-5 shadow-[0_24px_64px_-24px_rgba(226,215,195,0.18)] backdrop-blur-xl sm:p-7">
                            <div className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-widest text-[#e2d7c3]" style={MONO}>
                              <Pin className="h-3.5 w-3.5" />
                              Зафиксированный инсайт
                            </div>
                            <p className="text-xl leading-relaxed sm:text-2xl" style={{ ...SERIF, fontWeight: 300, color: MILK }}>
                              «{insight}»
                            </p>
                            <div className="mt-5 flex flex-wrap gap-2">
                              <GhostButton onClick={copyInsight} icon={copied ? Check : Copy}>
                                {copied ? "Скопировано" : "Копировать"}
                              </GhostButton>
                              <GhostButton onClick={() => setInsight(null)}>Изменить</GhostButton>
                            </div>

                            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[#e2d7c3]/15 pt-5">
                              <div
                                role="radiogroup"
                                aria-label="Формат карточки"
                                className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-1"
                              >
                                {Object.entries(CARD_FORMATS).map(([id, f]) => (
                                  <button
                                    key={id}
                                    role="radio"
                                    aria-checked={cardFormat === id}
                                    title={f.hint}
                                    onClick={() => setCardFormat(id)}
                                    className={`min-h-11 min-w-11 rounded-full px-3.5 py-1.5 text-[12px] transition-[background-color,color,box-shadow] duration-300 ${
                                      cardFormat === id
                                        ? "bg-white/[0.1] text-zinc-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]"
                                        : "text-zinc-500 hover:text-zinc-200"
                                    }`}
                                    style={MONO}
                                  >
                                    {f.label}
                                  </button>
                                ))}
                              </div>
                              <GhostButton
                                onClick={exportCard}
                                disabled={exporting}
                                icon={exporting ? Loader2 : Download}
                              >
                                {exporting ? "Генерация..." : "Сохранить карточку"}
                              </GhostButton>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <h2 className="text-2xl leading-snug sm:text-3xl" style={{ ...SERIF, fontWeight: 300, color: MILK }}>
                              Что ты теперь видишь иначе?
                            </h2>
                            <div className="mt-5">
                              <Composer
                                value={insightDraft}
                                onChange={(e) => setInsightDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                    e.preventDefault();
                                    saveInsight();
                                  }
                                }}
                                onSubmit={saveInsight}
                                placeholder="Сформулируй главный инсайт одной фразой…"
                                submitLabel="Зафиксировать"
                                canSubmit={insightDraft.trim().length > 0}
                                minRows={2}
                                maxHeight={160}
                              />
                            </div>
                          </div>
                        )}

                        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
                          <span className="text-[12px] text-zinc-500">
                            Всё это останется только в твоём браузере — пока ты не сожжёшь.
                          </span>
                          <GhostButton onClick={burn} icon={Flame} danger>
                            Сжечь диалог
                          </GhostButton>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div ref={endRef} className="h-px" />
                </motion.section>
              )}
            </AnimatePresence>
          </motion.div>
        </main>

        <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-20 hidden bg-gradient-to-t from-[#131518] to-transparent pb-4 pt-10 text-center sm:block">
          <p className="text-[11px] uppercase tracking-widest text-zinc-600" style={MONO}>
            Вопрос ценнее ответа
          </p>
        </footer>

        {insight && (
          <div aria-hidden style={{ position: "fixed", left: -20000, top: 0, pointerEvents: "none" }}>
            <InsightCard
              ref={cardRef}
              format={cardFormat}
              original={messages.find((m) => m.role === "user")?.content ?? ""}
              insight={insight}
              no={insightNo}
              date={formatDateRu()}
            />
          </div>
        )}

        <AnimatePresence>
          {toast && (
            <motion.div
              role="status"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-full border border-red-400/20 border-t-red-400/35 bg-[#1a1d22]/85 py-1 pl-5 pr-1 text-[13px] text-red-200 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
              style={SANS}
            >
              <CircleAlert className="h-4 w-4 shrink-0" />
              <span>{toast}</span>
              <button onClick={() => setToast(null)} className="flex h-11 w-11 shrink-0 items-center justify-center text-zinc-500 transition hover:text-zinc-100" aria-label="Закрыть">
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
