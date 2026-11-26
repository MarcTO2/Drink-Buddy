import { useCallback, useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join(", ") : `HTTP ${res.status}`);
  }
  return data;
}

const fmtTime = (iso) =>
  new Date(iso).toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const fmtClock = (iso) =>
  new Date(iso).toLocaleTimeString("en-KE", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit" });

const STATUS_STYLE = {
  forming: "bg-amber-100 text-amber-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  full: "bg-slate-200 text-slate-700",
};

/* ---------------------------------------------------------------- Auth */
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("signup");
  const [form, setForm] = useState({ name: "", phone: "", password: "", is_18_plus: false, odpc_consent: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const data =
        mode === "signup"
          ? await api("/auth/signup", { method: "POST", body: form })
          : await api("/auth/login", { method: "POST", body: { phone: form.phone, password: form.password } });
      onAuth(data);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-700 via-fuchsia-600 to-orange-500 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-4">
        <div className="text-center">
          <div className="text-4xl">🍻</div>
          <h1 className="text-3xl font-extrabold text-slate-900">Drink Buddy</h1>
          <p className="text-slate-500 text-sm">Group bar-hops in Westlands. Strictly platonic, squad-only.</p>
        </div>
        <div className="flex bg-slate-100 rounded-lg p-1">
          {["signup", "login"].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-md text-sm font-semibold ${mode === m ? "bg-white shadow text-violet-700" : "text-slate-500"}`}
            >
              {m === "signup" ? "Sign up" : "Log in"}
            </button>
          ))}
        </div>
        {mode === "signup" && (
          <input className="input" placeholder="First name" value={form.name} onChange={set("name")} required />
        )}
        <input className="input" placeholder="Phone (07XX or 2547XX)" value={form.phone} onChange={set("phone")} required />
        <input className="input" type="password" placeholder="Password" value={form.password} onChange={set("password")} required />
        {mode === "signup" && (
          <div className="space-y-2 text-sm text-slate-700">
            <label className="flex gap-2 items-start">
              <input type="checkbox" className="mt-1" checked={form.is_18_plus} onChange={set("is_18_plus")} />
              <span>I confirm I am <b>18 years or older</b>.</span>
            </label>
            <label className="flex gap-2 items-start">
              <input type="checkbox" className="mt-1" checked={form.odpc_consent} onChange={set("odpc_consent")} />
              <span>
                I consent to Drink Buddy processing my phone number and venue check-in location under the Kenya Data
                Protection Act, 2019 (ODPC). Check-ins auto-expire after 4 hours.
              </span>
            </label>
          </div>
        )}
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <button disabled={busy} className="btn-primary w-full">
          {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
        </button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- Modals */
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function defaultMeetAt() {
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CreateSquadModal({ token, venues, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    venue_id: venues[0]?.id || 1,
    meet_at: defaultMeetAt(),
    max_size: 6,
    ticket_kes: 500,
    description: "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const squad = await api("/squads", {
        method: "POST",
        token,
        body: {
          ...form,
          venue_id: Number(form.venue_id),
          max_size: Number(form.max_size),
          ticket_kes: Number(form.ticket_kes),
          meet_at: new Date(form.meet_at).toISOString(),
        },
      });
      onCreated(squad);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Create a Bar-Hop Squad" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input className="input" placeholder="Squad name (e.g. Friday Afterwork Crawl)" value={form.name} onChange={set("name")} required />
        <label className="block text-sm font-medium text-slate-600">
          Starting venue (vetted)
          <select className="input mt-1" value={form.venue_id} onChange={set("venue_id")}>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>{v.name} — {v.address}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-600">
          Meet time
          <input type="datetime-local" className="input mt-1" value={form.meet_at} onChange={set("meet_at")} required />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-600">
            Squad size
            <select className="input mt-1" value={form.max_size} onChange={set("max_size")}>
              {[3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n} people</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-600">
            Buy-in (KES)
            <input type="number" min="1" className="input mt-1" value={form.ticket_kes} onChange={set("ticket_kes")} />
          </label>
        </div>
        <textarea className="input" rows="2" placeholder="Vibe / plan (optional)" value={form.description} onChange={set("description")} />
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <button disabled={busy} className="btn-primary w-full">{busy ? "Creating…" : "Create squad"}</button>
      </form>
    </Modal>
  );
}

function PayModal({ token, user, squad, onClose, onPaid }) {
  const [phone, setPhone] = useState(user.phone);
  const [stage, setStage] = useState("idle");
  const [msg, setMsg] = useState("");
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const poll = (checkoutId) => {
    let tries = 0;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      tries += 1;
      try {
        const s = await api(`/mpesa/status/${checkoutId}`, { token });
        if (s.status === "success") {
          clearInterval(pollRef.current);
          setStage("success");
          setMsg(`Payment confirmed${s.mpesa_receipt ? ` (receipt ${s.mpesa_receipt})` : ""}. Your spot is locked in!`);
          onPaid(squad);
        } else if (s.status !== "pending") {
          clearInterval(pollRef.current);
          setStage("failed");
          setMsg(s.result_desc || "Payment was not completed.");
        } else if (tries >= 30) {
          clearInterval(pollRef.current);
          setStage("failed");
          setMsg("Timed out waiting for M-Pesa confirmation. Try again.");
        }
      } catch {
        /* network blip: keep polling */
      }
    }, 4000);
  };

  const pay = async () => {
    setStage("sending");
    setMsg("");
    try {
      const r = await api("/mpesa/stkpush", { method: "POST", token, body: { squad_id: squad.id, phone } });
      setStage("waiting");
      setMsg(r.customer_message || "Check your phone and enter your M-Pesa PIN.");
      poll(r.checkout_request_id);
    } catch (e) {
      setStage("failed");
      setMsg(e.message);
    }
  };

  return (
    <Modal title="Confirm your spot" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
          <p className="font-semibold text-slate-800">{squad.name}</p>
          <p className="text-sm text-slate-600">{squad.venue?.name} · {fmtTime(squad.meet_at)}</p>
          <p className="text-2xl font-extrabold text-emerald-700 mt-2">KES {squad.ticket_kes}</p>
        </div>
        <label className="block text-sm font-medium text-slate-600">
          M-Pesa phone number
          <input className="input mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="2547XXXXXXXX" />
        </label>
        <button
          onClick={pay}
          disabled={stage === "sending" || stage === "waiting" || stage === "success"}
          className="w-full py-3 rounded-xl font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60"
        >
          {stage === "sending" ? "Sending STK push…" : stage === "waiting" ? "Waiting for PIN…" : "Pay via M-Pesa STK Push"}
        </button>
        {stage === "waiting" && <p className="text-sm text-slate-600 animate-pulse">📱 {msg}</p>}
        {stage === "success" && <p className="text-sm text-emerald-700 font-medium">✅ {msg}</p>}
        {stage === "failed" && <p className="text-sm text-red-600">⚠️ {msg}</p>}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Squads */
function SquadsTab({ token, user, openChat }) {
  const [squads, setSquads] = useState([]);
  const [venues, setVenues] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [paySquad, setPaySquad] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, v] = await Promise.all([api("/squads", { token }), api("/venues")]);
      setSquads(s);
      setVenues(v);
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const joinAndPay = async (squad) => {
    try {
      const r = await api(`/squads/${squad.id}/join`, { method: "POST", token });
      setPaySquad(r.squad);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Active Westlands Squads</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ Create Squad</button>
      </div>
      {err && <p className="text-red-600 mb-3">{err}</p>}
      {squads.length === 0 && (
        <div className="text-center py-16 text-slate-500 bg-white rounded-2xl border border-dashed">
          No squads yet tonight. Be the first to start one! 🎉
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {squads.map((s) => (
          <div key={s.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex justify-between items-start gap-2">
              <div>
                <h3 className="font-bold text-lg">{s.name}</h3>
                <p className="text-sm text-slate-500">📍 {s.venue?.name} · 🕗 {fmtTime(s.meet_at)}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_STYLE[s.status]}`}>{s.status}</span>
            </div>
            {s.description && <p className="text-sm text-slate-600 mt-2">{s.description}</p>}
            <div className="mt-3">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>{s.approved_count}/{s.max_size} confirmed (min {s.min_size})</span>
                <span>KES {s.ticket_kes}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-violet-600" style={{ width: `${(s.approved_count / s.max_size) * 100}%` }} />
              </div>
            </div>
            <div className="mt-4">
              {s.my_status === "approved" ? (
                <button className="btn-secondary w-full" onClick={() => openChat(s.id)}>💬 Open Squad Chat</button>
              ) : s.my_status === "pending" ? (
                <button className="w-full py-2 rounded-xl font-semibold text-white bg-green-600 hover:bg-green-700" onClick={() => setPaySquad(s)}>
                  Pay KES {s.ticket_kes} via M-Pesa
                </button>
              ) : s.status === "full" ? (
                <button className="btn-secondary w-full opacity-50" disabled>Squad full</button>
              ) : (
                <button className="btn-primary w-full" onClick={() => joinAndPay(s)}>Join & Pay</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {showCreate && (
        <CreateSquadModal
          token={token}
          venues={venues}
          onClose={() => setShowCreate(false)}
          onCreated={(squad) => {
            setShowCreate(false);
            setPaySquad(squad);
            load();
          }}
        />
      )}
      {paySquad && (
        <PayModal
          token={token}
          user={user}
          squad={paySquad}
          onClose={() => {
            setPaySquad(null);
            load();
          }}
          onPaid={() => load()}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Chat */
function ChatTab({ token, squadId, setSquadId }) {
  const [mine, setMine] = useState([]);
  const [messages, setMessages] = useState([]);
  const [locked, setLocked] = useState("");
  const [text, setText] = useState("");
  const [detail, setDetail] = useState(null);
  const lastId = useRef(0);
  const bottomRef = useRef(null);

  useEffect(() => {
    api("/squads/mine", { token }).then((list) => {
      setMine(list);
      if (!squadId) {
        const first = list.find((s) => s.my_status === "approved");
        if (first) setSquadId(first.id);
      }
    }).catch(() => {});
  }, [token, squadId, setSquadId]);

  useEffect(() => {
    if (!squadId) return undefined;
    let alive = true;
    setMessages([]);
    setLocked("");
    lastId.current = 0;
    api(`/squads/${squadId}`, { token }).then((d) => alive && setDetail(d)).catch(() => {});
    const tick = async () => {
      try {
        const m = await api(`/squads/${squadId}/messages?after_id=${lastId.current}`, { token });
        if (!alive || m.length === 0) return;
        lastId.current = m[m.length - 1].id;
        setMessages((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...m.filter((x) => !seen.has(x.id))];
        });
      } catch (e) {
        if (alive) setLocked(e.message);
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [squadId, token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const m = await api(`/squads/${squadId}/messages`, { method: "POST", token, body: { body: text } });
      setText("");
      lastId.current = Math.max(lastId.current, m.id);
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    } catch (e2) {
      setLocked(e2.message);
    }
  };

  return (
    <div className="grid md:grid-cols-[240px_1fr] gap-4">
      <aside className="bg-white rounded-2xl p-3 border border-slate-100 h-fit">
        <h3 className="font-semibold text-slate-500 text-xs uppercase mb-2 px-2">My Squads</h3>
        {mine.length === 0 && <p className="text-sm text-slate-500 px-2">Join a squad to unlock chat.</p>}
        {mine.map((s) => (
          <button
            key={s.id}
            onClick={() => setSquadId(s.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 ${squadId === s.id ? "bg-violet-100 text-violet-800" : "hover:bg-slate-50"}`}
          >
            <div className="font-semibold">{s.name}</div>
            <div className="text-xs text-slate-500">
              {s.venue?.name} · {s.my_status === "approved" ? "✅ confirmed" : "🔒 unpaid"}
            </div>
          </button>
        ))}
      </aside>
      <section className="bg-white rounded-2xl border border-slate-100 flex flex-col h-[70vh]">
        {!squadId ? (
          <div className="m-auto text-slate-500">Pick a squad to chat.</div>
        ) : (
          <>
            <header className="p-4 border-b">
              <h3 className="font-bold">{detail?.name}</h3>
              <p className="text-xs text-slate-500">
                📍 {detail?.venue?.name} · {detail && fmtTime(detail.meet_at)} ·{" "}
                {detail?.members?.map((m) => m.name).join(", ") || "members visible once confirmed"}
              </p>
            </header>
            {locked ? (
              <div className="m-auto text-center p-6">
                <div className="text-4xl mb-2">🔒</div>
                <p className="text-slate-600">{locked}</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m) =>
                  m.is_system ? (
                    <p key={m.id} className="text-center text-xs text-slate-500 italic">{m.body}</p>
                  ) : (
                    <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${m.mine ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                        {!m.mine && <div className="text-xs font-semibold text-violet-700">{m.sender}</div>}
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div className={`text-[10px] mt-1 ${m.mine ? "text-violet-200" : "text-slate-400"}`}>{fmtClock(m.created_at)}</div>
                      </div>
                    </div>
                  )
                )}
                <div ref={bottomRef} />
              </div>
            )}
            {!locked && (
              <form onSubmit={send} className="p-3 border-t flex gap-2">
                <input className="input flex-1" placeholder="Message the squad…" value={text} onChange={(e) => setText(e.target.value)} />
                <button className="btn-primary">Send</button>
              </form>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Venues / check-in */
function VenuesTab({ token }) {
  const [venues, setVenues] = useState([]);
  const [current, setCurrent] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [v, c] = await Promise.all([api("/venues"), api("/checkins/me", { token })]);
      setVenues(v);
      setCurrent(c);
    } catch (e) {
      setErr(e.message);
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const checkIn = async (venueId) => {
    try {
      await api("/checkins", { method: "POST", token, body: { venue_id: venueId } });
      load();
    } catch (e) {
      setErr(e.message);
    }
  };
  const checkOut = async () => {
    await api("/checkins/me", { method: "DELETE", token });
    load();
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">Vetted Westlands Venues</h2>
      <p className="text-slate-500 text-sm mb-4">Check-ins are anonymous counts and auto-expire after 4 hours.</p>
      {err && <p className="text-red-600 mb-3">{err}</p>}
      {current && (
        <div className="mb-4 p-4 rounded-xl bg-violet-50 border border-violet-200 flex justify-between items-center">
          <span>📍 Checked in at <b>{current.venue.name}</b> until {fmtClock(current.expires_at)}</span>
          <button className="btn-secondary" onClick={checkOut}>Check out</button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {venues.map((v) => (
          <div key={v.id} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <div className="flex justify-between">
              <h3 className="font-bold text-lg">{v.name}</h3>
              <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full h-fit">✔ vetted</span>
            </div>
            <p className="text-sm text-slate-500">{v.address}</p>
            <p className="text-sm text-slate-600 mt-2">{v.description}</p>
            <div className="flex justify-between items-center mt-4">
              <span className="text-sm">👥 {v.active_checkins} here now</span>
              <button className="btn-primary" disabled={current?.venue.id === v.id} onClick={() => checkIn(v.id)}>
                {current?.venue.id === v.id ? "You're here" : "Check in"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Safety */
const REASONS = [
  ["harassment", "Harassment / unwanted advances"],
  ["drink_spiking", "Suspected drink spiking"],
  ["unsafe_behaviour", "Aggressive or unsafe behaviour"],
  ["venue_issue", "Venue safety issue"],
  ["scam", "Payment / scam concern"],
  ["other", "Other"],
];

function SafetyTab({ token }) {
  const [mine, setMine] = useState([]);
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState({ reason: "harassment", squad_id: "", reported_user_id: "", details: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => {
    api("/squads/mine", { token }).then(setMine).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!form.squad_id) {
      setMembers([]);
      return;
    }
    api(`/squads/${form.squad_id}`, { token }).then((d) => setMembers(d.members || [])).catch(() => setMembers([]));
  }, [form.squad_id, token]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setMsg("");
    try {
      const r = await api("/reports", {
        method: "POST",
        token,
        body: {
          reason: form.reason,
          details: form.details,
          squad_id: form.squad_id ? Number(form.squad_id) : null,
          reported_user_id: form.reported_user_id ? Number(form.reported_user_id) : null,
        },
      });
      setMsg(r.message);
      setForm({ reason: "harassment", squad_id: "", reported_user_id: "", details: "" });
    } catch (e2) {
      setErr(e2.message);
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
        <h2 className="text-xl font-bold text-red-800">🚨 In danger right now?</h2>
        <p className="mt-2 text-red-900">Call <b>999</b> or <b>112</b> (Kenya emergency). Tell venue security and stay with your squad.</p>
        <ul className="mt-4 text-sm text-red-900 list-disc pl-5 space-y-1">
          <li>Squads only — no 1-on-1 DMs on Drink Buddy.</li>
          <li>Only meet at the vetted venue listed on your squad.</li>
          <li>Never leave a drink unattended; leave together.</li>
          <li>Check-ins auto-delete from the live view after 4 hours.</li>
        </ul>
      </div>
      <form onSubmit={submit} className="bg-white rounded-2xl p-6 border border-slate-100 space-y-3">
        <h2 className="text-xl font-bold">Report a safety issue</h2>
        <select className="input" value={form.reason} onChange={set("reason")}>
          {REASONS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select className="input" value={form.squad_id} onChange={(e) => setForm({ ...form, squad_id: e.target.value, reported_user_id: "" })}>
          <option value="">Squad (optional)</option>
          {mine.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {members.length > 0 && (
          <select className="input" value={form.reported_user_id} onChange={set("reported_user_id")}>
            <option value="">Person (optional)</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.name}</option>
            ))}
          </select>
        )}
        <textarea className="input" rows="4" placeholder="What happened?" value={form.details} onChange={set("details")} />
        {msg && <p className="text-emerald-700 text-sm">{msg}</p>}
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <button className="w-full py-2 rounded-xl font-semibold text-white bg-red-600 hover:bg-red-700">Submit report</button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- Root */
const TABS = [
  ["squads", "🍻 Squads"],
  ["chat", "💬 Squad Chat"],
  ["venues", "📍 Venues"],
  ["safety", "🛡️ Safety"],
];

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("db_token") || "");
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("squads");
  const [chatSquadId, setChatSquadId] = useState(null);

  useEffect(() => {
    if (!token) return;
    api("/me", { token })
      .then(setUser)
      .catch(() => {
        localStorage.removeItem("db_token");
        setToken("");
      });
  }, [token]);

  const onAuth = (data) => {
    localStorage.setItem("db_token", data.token);
    setToken(data.token);
    setUser(data.user);
  };

  const logout = () => {
    localStorage.removeItem("db_token");
    setToken("");
    setUser(null);
  };

  if (!token) return <AuthScreen onAuth={onAuth} />;
  if (!user) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-r from-violet-700 to-fuchsia-600 text-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-extrabold">🍻 Drink Buddy</h1>
            <p className="text-xs text-violet-100">Westlands, Nairobi · platonic squads only</p>
          </div>
          <div className="text-right text-sm">
            <div>Hi, <b>{user.name}</b></div>
            <button onClick={logout} className="text-violet-100 underline text-xs">Log out</button>
          </div>
        </div>
        <nav className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {TABS.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2 rounded-t-lg text-sm font-semibold whitespace-nowrap ${tab === k ? "bg-slate-50 text-violet-700" : "text-violet-100 hover:bg-white/10"}`}
            >
              {l}
            </button>
          ))}
        </nav>
      </header>
      <main className="max-w-5xl mx-auto p-4">
        {tab === "squads" && (
          <SquadsTab
            token={token}
            user={user}
            openChat={(id) => {
              setChatSquadId(id);
              setTab("chat");
            }}
          />
        )}
        {tab === "chat" && <ChatTab token={token} squadId={chatSquadId} setSquadId={setChatSquadId} />}
        {tab === "venues" && <VenuesTab token={token} />}
        {tab === "safety" && <SafetyTab token={token} />}
      </main>
    </div>
  );
}
