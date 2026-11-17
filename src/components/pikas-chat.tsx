"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { PikasMark } from "./logo";
export { PikasMark };

interface Msg {
  role: string;
  content: string;
  meta?: string | null;
  created_at?: number;
}

export function PikasChat({ compact = false }: { compact?: boolean }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ configured: boolean }>("/api/pikas/status")
      .then((status) => {
        setConfigured(status.configured);
        if (status.configured) return api<{ messages: Msg[] }>("/api/pikas/messages");
        return { messages: [] as Msg[] };
      })
      .then((data) => setMessages(data.messages || []))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  async function send() {
    const content = text.trim();
    if (!content || busy || configured === false) return;
    setText("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", content }]);
    setStreaming("");
    try {
      const res = await fetch("/api/pikas/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.status === 409) {
        setConfigured(false);
        setMessages((current) => current.slice(0, -1));
        return;
      }
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError(data.error || "PIKAS AI no pudo responder", res.status, data.code);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((item) => item.startsWith("data:"));
          if (!line) continue;
          const payload = JSON.parse(line.slice(5)) as { delta?: string; error?: string; done?: boolean };
          if (payload.delta) {
            full += payload.delta;
            setStreaming(full);
          }
          if (payload.error) throw new Error(payload.error);
        }
      }
      setMessages((current) => [...current, { role: "assistant", content: full }]);
      setStreaming("");
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", content: error instanceof Error ? error.message : "Error", meta: "error" }]);
      setStreaming("");
    } finally {
      setBusy(false);
    }
  }

  if (configured === null) {
    return <div className="chat-shell"><div className="skeleton sk-chat" /></div>;
  }

  if (!configured) {
    return (
      <section className="chat-shell unconfigured">
        <header className="chat-id">
          <PikasMark variant="ai" />
          <div>
            <h2>PIKAS AI</h2>
            <p>Asistente educativo de la plataforma</p>
          </div>
        </header>
        <div className="unconfigured-body">
          <strong>PIKAS AI no configurado</strong>
          <p>Todavía no hay un motor conectado, así que no invento un análisis. Cuando un administrador lo active, hablarás solo con PIKAS AI: una voz, con memoria de lo que cuentes y con los datos de tu simulación.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`chat-shell ${compact ? "compact" : ""}`}>
      <header className="chat-id">
        <PikasMark variant="ai" live={busy} />
        <div>
          <h2>PIKAS AI</h2>
          <p>Educativo. No es asesoramiento financiero.</p>
        </div>
      </header>
      <div className="disclaimer">Las cifras salen de los módulos de PIKAS. Si un dato no está, el asistente debe decirlo. La simulación no usa dinero real.</div>
      <div className="chat-log" ref={scroller}>
        {messages.length === 0 && !streaming ? <p className="empty-chat">Pregúntame por tu cuenta simulada, por BTC o por qué se liquidó una posición.</p> : null}
        {messages.map((message, index) => (
          <article key={`${message.created_at || index}-${message.role}`} className={`bubble bubble-${message.role}`}>
            <p>{message.content}</p>
            {message.role === "assistant" ? <small>PIKAS AI</small> : null}
          </article>
        ))}
        {streaming ? <article className="bubble bubble-assistant streaming"><p>{streaming}<span className="caret" /></p></article> : null}
      </div>
      <div className="row">
        {["¿Cómo va mi simulación?", "Explícame la ronda unida", "¿Qué es el stop por volatilidad?"].map((prompt) => (
          <button key={prompt} className="btn btn-secondary" type="button" disabled={busy} onClick={() => { setText(prompt); }}>{prompt}</button>
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr" htmlFor="pikas-input">Mensaje para PIKAS AI</label>
        <textarea id="pikas-input" value={text} rows={compact ? 2 : 3} placeholder="¿Qué está pasando con mi simulación?" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
        <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()}>{busy ? "Pensando" : "Enviar"}</button>
      </form>
      <p className="fine">Una sola voz. Educativo, no es asesoramiento financiero.</p>
    </section>
  );
}
