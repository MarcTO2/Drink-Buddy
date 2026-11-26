import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import Constants from "expo-constants";

// Uses EXPO_PUBLIC_API_URL if set, otherwise the LAN IP of the machine running `expo start`.
const LAN_HOST = (Constants.expoConfig?.hostUri || "localhost:8081").split(":")[0];
const API = process.env.EXPO_PUBLIC_API_URL || `http://${LAN_HOST}:8000`;

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

const fmtTime = (iso) => {
  const d = new Date(iso);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pad = (n) => String(n).padStart(2, "0");
  return `${days[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtClock = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const C = {
  violet: "#7c3aed",
  violetDark: "#5b21b6",
  violetLight: "#ede9fe",
  green: "#16a34a",
  red: "#dc2626",
  slate: "#64748b",
  bg: "#f8fafc",
  border: "#e2e8f0",
};

/* ---------------------------------------------------------------- Shared UI */
function Btn({ title, onPress, color = C.violet, outline, disabled, style }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        outline ? { backgroundColor: "#fff", borderWidth: 1, borderColor: color } : { backgroundColor: color },
        (pressed || disabled) && { opacity: 0.6 },
        style,
      ]}
    >
      <Text style={[s.btnText, outline && { color }]}>{title}</Text>
    </Pressable>
  );
}

function Chip({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && s.chipActive]}>
      <Text style={[s.chipText, active && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

function Sheet({ visible, title, onClose, children }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.sheetWrap}>
        <View style={s.sheet}>
          <View style={s.rowBetween}>
            <Text style={s.h2}>{title}</Text>
            <Pressable onPress={onClose}>
              <Text style={{ fontSize: 28, color: C.slate }}>×</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Auth */
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      const data =
        mode === "signup"
          ? await api("/auth/signup", {
              method: "POST",
              body: { name, phone, password, is_18_plus: adult, odpc_consent: consent },
            })
          : await api("/auth/login", { method: "POST", body: { phone, password } });
      onAuth(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: C.violetDark }}>
      <ScrollView contentContainerStyle={s.authWrap} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={{ fontSize: 40, textAlign: "center" }}>🍻</Text>
          <Text style={[s.h1, { textAlign: "center" }]}>Drink Buddy</Text>
          <Text style={[s.muted, { textAlign: "center", marginBottom: 16 }]}>Group bar-hops in Westlands. Platonic, squad-only.</Text>
          <View style={s.segment}>
            {["signup", "login"].map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} style={[s.segBtn, mode === m && s.segActive]}>
                <Text style={{ fontWeight: "700", color: mode === m ? C.violet : C.slate }}>{m === "signup" ? "Sign up" : "Log in"}</Text>
              </Pressable>
            ))}
          </View>
          {mode === "signup" && <TextInput style={s.input} placeholder="First name" value={name} onChangeText={setName} />}
          <TextInput style={s.input} placeholder="Phone (07XX or 2547XX)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <TextInput style={s.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
          {mode === "signup" && (
            <>
              <View style={s.consentRow}>
                <Switch value={adult} onValueChange={setAdult} trackColor={{ true: C.violet }} />
                <Text style={s.consentText}>I confirm I am 18 years or older.</Text>
              </View>
              <View style={s.consentRow}>
                <Switch value={consent} onValueChange={setConsent} trackColor={{ true: C.violet }} />
                <Text style={s.consentText}>
                  I consent to processing of my phone number and venue check-in location under the Kenya Data Protection
                  Act, 2019 (ODPC). Check-ins auto-expire after 4 hours.
                </Text>
              </View>
            </>
          )}
          {!!err && <Text style={s.err}>{err}</Text>}
          <Btn title={busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"} onPress={submit} disabled={busy} style={{ marginTop: 8 }} />
          <Text style={[s.muted, { fontSize: 11, textAlign: "center", marginTop: 12 }]}>API: {API}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ---------------------------------------------------------------- Pay */
function PaySheet({ token, user, squad, onClose, onPaid }) {
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
        const st = await api(`/mpesa/status/${checkoutId}`, { token });
        if (st.status === "success") {
          clearInterval(pollRef.current);
          setStage("success");
          setMsg(`Payment confirmed${st.mpesa_receipt ? ` (receipt ${st.mpesa_receipt})` : ""}. Spot locked in!`);
          onPaid();
        } else if (st.status !== "pending") {
          clearInterval(pollRef.current);
          setStage("failed");
          setMsg(st.result_desc || "Payment was not completed.");
        } else if (tries >= 30) {
          clearInterval(pollRef.current);
          setStage("failed");
          setMsg("Timed out waiting for M-Pesa confirmation.");
        }
      } catch {
        /* keep polling */
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
    <Sheet visible title="Confirm your spot" onClose={onClose}>
      <View style={s.payBox}>
        <Text style={{ fontWeight: "700", fontSize: 16 }}>{squad.name}</Text>
        <Text style={s.muted}>{squad.venue?.name} · {fmtTime(squad.meet_at)}</Text>
        <Text style={{ fontSize: 26, fontWeight: "800", color: C.green, marginTop: 6 }}>KES {squad.ticket_kes}</Text>
      </View>
      <Text style={s.label}>M-Pesa phone number</Text>
      <TextInput style={s.input} keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="2547XXXXXXXX" />
      <Btn
        title={stage === "sending" ? "Sending STK push…" : stage === "waiting" ? "Waiting for PIN…" : "Pay via M-Pesa STK Push"}
        color={C.green}
        onPress={pay}
        disabled={stage === "sending" || stage === "waiting" || stage === "success"}
      />
      {stage === "waiting" && (
        <View style={[s.row, { marginTop: 12 }]}>
          <ActivityIndicator color={C.green} />
          <Text style={[s.muted, { marginLeft: 8, flex: 1 }]}>{msg}</Text>
        </View>
      )}
      {stage === "success" && <Text style={{ color: C.green, marginTop: 12, fontWeight: "600" }}>✅ {msg}</Text>}
      {stage === "failed" && <Text style={[s.err, { marginTop: 12 }]}>⚠️ {msg}</Text>}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- Create squad */
const START_OPTIONS = [1, 2, 3, 4, 6];

function CreateSheet({ token, venues, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [venueId, setVenueId] = useState(venues[0]?.id);
  const [startIn, setStartIn] = useState(2);
  const [size, setSize] = useState(6);
  const [price, setPrice] = useState("500");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      const meet = new Date(Date.now() + startIn * 3600 * 1000);
      meet.setMinutes(0, 0, 0);
      const squad = await api("/squads", {
        method: "POST",
        token,
        body: {
          name,
          venue_id: venueId,
          meet_at: meet.toISOString(),
          max_size: size,
          ticket_kes: Number(price) || 500,
          description: desc,
        },
      });
      onCreated(squad);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible title="Create a Squad" onClose={onClose}>
      <TextInput style={s.input} placeholder="Squad name" value={name} onChangeText={setName} />
      <Text style={s.label}>Starting venue (vetted)</Text>
      <View style={s.chipRow}>
        {venues.map((v) => (
          <Chip key={v.id} label={v.name} active={venueId === v.id} onPress={() => setVenueId(v.id)} />
        ))}
      </View>
      <Text style={s.label}>Meet in</Text>
      <View style={s.chipRow}>
        {START_OPTIONS.map((h) => (
          <Chip key={h} label={`~${h}h`} active={startIn === h} onPress={() => setStartIn(h)} />
        ))}
      </View>
      <Text style={s.label}>Squad size</Text>
      <View style={s.chipRow}>
        {[3, 4, 5, 6, 7, 8].map((n) => (
          <Chip key={n} label={String(n)} active={size === n} onPress={() => setSize(n)} />
        ))}
      </View>
      <Text style={s.label}>Buy-in (KES)</Text>
      <TextInput style={s.input} keyboardType="number-pad" value={price} onChangeText={setPrice} />
      <TextInput style={[s.input, { height: 70 }]} multiline placeholder="Vibe / plan (optional)" value={desc} onChangeText={setDesc} />
      {!!err && <Text style={s.err}>{err}</Text>}
      <Btn title={busy ? "Creating…" : "Create squad"} onPress={submit} disabled={busy} />
    </Sheet>
  );
}

/* ---------------------------------------------------------------- Squads */
function SquadsScreen({ token, user, openChat }) {
  const [squads, setSquads] = useState([]);
  const [venues, setVenues] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [paySquad, setPaySquad] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sq, v] = await Promise.all([api("/squads", { token }), api("/venues")]);
      setSquads(sq);
      setVenues(v);
    } catch (e) {
      Alert.alert("Error", e.message);
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
      Alert.alert("Couldn't join", e.message);
    }
  };

  const statusColor = { forming: "#f59e0b", confirmed: C.green, full: C.slate };

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.rowBetween, { padding: 16 }]}>
        <Text style={s.h2}>Active Westlands Squads</Text>
        <Btn title="+ New" onPress={() => setShowCreate(true)} style={{ paddingVertical: 8 }} />
      </View>
      <FlatList
        data={squads}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={{ padding: 16, paddingTop: 0 }}
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }}
        ListEmptyComponent={<Text style={[s.muted, { textAlign: "center", marginTop: 40 }]}>No squads yet. Start one! 🎉</Text>}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.rowBetween}>
              <Text style={[s.h3, { flex: 1 }]}>{item.name}</Text>
              <Text style={[s.badge, { backgroundColor: statusColor[item.status] }]}>{item.status}</Text>
            </View>
            <Text style={s.muted}>📍 {item.venue?.name} · 🕗 {fmtTime(item.meet_at)}</Text>
            {!!item.description && <Text style={{ marginTop: 6 }}>{item.description}</Text>}
            <View style={[s.rowBetween, { marginTop: 10 }]}>
              <Text style={s.small}>{item.approved_count}/{item.max_size} confirmed (min {item.min_size})</Text>
              <Text style={s.small}>KES {item.ticket_kes}</Text>
            </View>
            <View style={s.progress}>
              <View style={[s.progressFill, { width: `${(item.approved_count / item.max_size) * 100}%` }]} />
            </View>
            {item.my_status === "approved" ? (
              <Btn title="💬 Open Squad Chat" outline onPress={() => openChat(item.id)} />
            ) : item.my_status === "pending" ? (
              <Btn title={`Pay KES ${item.ticket_kes} via M-Pesa`} color={C.green} onPress={() => setPaySquad(item)} />
            ) : item.status === "full" ? (
              <Btn title="Squad full" outline disabled />
            ) : (
              <Btn title="Join & Pay" onPress={() => joinAndPay(item)} />
            )}
          </View>
        )}
      />
      {showCreate && (
        <CreateSheet
          token={token}
          venues={venues}
          onClose={() => setShowCreate(false)}
          onCreated={(sq) => {
            setShowCreate(false);
            setPaySquad(sq);
            load();
          }}
        />
      )}
      {paySquad && (
        <PaySheet
          token={token}
          user={user}
          squad={paySquad}
          onClose={() => {
            setPaySquad(null);
            load();
          }}
          onPaid={load}
        />
      )}
    </View>
  );
}

/* ---------------------------------------------------------------- Chat */
function ChatScreen({ token, squadId, setSquadId }) {
  const [mine, setMine] = useState([]);
  const [messages, setMessages] = useState([]);
  const [locked, setLocked] = useState("");
  const [text, setText] = useState("");
  const [detail, setDetail] = useState(null);
  const lastId = useRef(0);
  const listRef = useRef(null);

  useEffect(() => {
    api("/squads/mine", { token })
      .then((list) => {
        setMine(list);
        if (!squadId) {
          const first = list.find((x) => x.my_status === "approved");
          if (first) setSquadId(first.id);
        }
      })
      .catch(() => {});
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

  const send = async () => {
    if (!text.trim()) return;
    try {
      const m = await api(`/squads/${squadId}/messages`, { method: "POST", token, body: { body: text } });
      setText("");
      lastId.current = Math.max(lastId.current, m.id);
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    } catch (e) {
      setLocked(e.message);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 12, gap: 8 }}>
        {mine.length === 0 && <Text style={s.muted}>Join a squad to unlock chat.</Text>}
        {mine.map((sq) => (
          <Chip
            key={sq.id}
            label={`${sq.my_status === "approved" ? "✅" : "🔒"} ${sq.name}`}
            active={squadId === sq.id}
            onPress={() => setSquadId(sq.id)}
          />
        ))}
      </ScrollView>
      {!squadId ? (
        <Text style={[s.muted, { textAlign: "center", marginTop: 40 }]}>Pick a squad to chat.</Text>
      ) : (
        <>
          <View style={s.chatHeader}>
            <Text style={s.h3}>{detail?.name}</Text>
            <Text style={s.small}>
              📍 {detail?.venue?.name} · {detail ? fmtTime(detail.meet_at) : ""} ·{" "}
              {detail?.members?.map((m) => m.name).join(", ") || "members visible once confirmed"}
            </Text>
          </View>
          {locked ? (
            <View style={{ alignItems: "center", marginTop: 40, padding: 20 }}>
              <Text style={{ fontSize: 40 }}>🔒</Text>
              <Text style={[s.muted, { textAlign: "center" }]}>{locked}</Text>
            </View>
          ) : (
            <>
              <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={(m) => String(m.id)}
                contentContainerStyle={{ padding: 12 }}
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                renderItem={({ item: m }) =>
                  m.is_system ? (
                    <Text style={s.systemMsg}>{m.body}</Text>
                  ) : (
                    <View style={[s.bubble, m.mine ? s.bubbleMine : s.bubbleOther]}>
                      {!m.mine && <Text style={{ fontWeight: "700", color: C.violet, fontSize: 12 }}>{m.sender}</Text>}
                      <Text style={{ color: m.mine ? "#fff" : "#0f172a" }}>{m.body}</Text>
                      <Text style={{ fontSize: 10, marginTop: 2, color: m.mine ? "#ddd6fe" : "#94a3b8" }}>{fmtClock(m.created_at)}</Text>
                    </View>
                  )
                }
              />
              <View style={s.composer}>
                <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} placeholder="Message the squad…" value={text} onChangeText={setText} onSubmitEditing={send} />
                <Btn title="Send" onPress={send} style={{ marginLeft: 8 }} />
              </View>
            </>
          )}
        </>
      )}
    </KeyboardAvoidingView>
  );
}

/* ---------------------------------------------------------------- Venues */
function VenuesScreen({ token }) {
  const [venues, setVenues] = useState([]);
  const [current, setCurrent] = useState(null);

  const load = useCallback(async () => {
    try {
      const [v, c] = await Promise.all([api("/venues"), api("/checkins/me", { token })]);
      setVenues(v);
      setCurrent(c);
    } catch (e) {
      Alert.alert("Error", e.message);
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const checkIn = async (id) => {
    try {
      await api("/checkins", { method: "POST", token, body: { venue_id: id } });
      load();
    } catch (e) {
      Alert.alert("Check-in failed", e.message);
    }
  };
  const checkOut = async () => {
    await api("/checkins/me", { method: "DELETE", token });
    load();
  };

  return (
    <FlatList
      data={venues}
      keyExtractor={(v) => String(v.id)}
      contentContainerStyle={{ padding: 16 }}
      ListHeaderComponent={
        <View>
          <Text style={s.h2}>Vetted Westlands Venues</Text>
          <Text style={[s.muted, { marginBottom: 12 }]}>Anonymous counts. Check-ins expire after 4 hours.</Text>
          {current && (
            <View style={[s.card, { backgroundColor: C.violetLight }]}>
              <Text>📍 Checked in at <Text style={{ fontWeight: "700" }}>{current.venue.name}</Text> until {fmtClock(current.expires_at)}</Text>
              <Btn title="Check out" outline onPress={checkOut} style={{ marginTop: 8 }} />
            </View>
          )}
        </View>
      }
      renderItem={({ item: v }) => (
        <View style={s.card}>
          <View style={s.rowBetween}>
            <Text style={s.h3}>{v.name}</Text>
            <Text style={[s.badge, { backgroundColor: C.green }]}>✔ vetted</Text>
          </View>
          <Text style={s.muted}>{v.address}</Text>
          <Text style={{ marginTop: 6 }}>{v.description}</Text>
          <View style={[s.rowBetween, { marginTop: 10 }]}>
            <Text>👥 {v.active_checkins} here now</Text>
            <Btn
              title={current?.venue.id === v.id ? "You're here" : "Check in"}
              disabled={current?.venue.id === v.id}
              onPress={() => checkIn(v.id)}
              style={{ paddingVertical: 8 }}
            />
          </View>
        </View>
      )}
    />
  );
}

/* ---------------------------------------------------------------- Safety */
const REASONS = [
  ["harassment", "Harassment"],
  ["drink_spiking", "Drink spiking"],
  ["unsafe_behaviour", "Unsafe behaviour"],
  ["venue_issue", "Venue issue"],
  ["scam", "Payment / scam"],
  ["other", "Other"],
];

function SafetyScreen({ token }) {
  const [mine, setMine] = useState([]);
  const [members, setMembers] = useState([]);
  const [reason, setReason] = useState("harassment");
  const [squadId, setSquadId] = useState(null);
  const [reportedId, setReportedId] = useState(null);
  const [details, setDetails] = useState("");

  useEffect(() => {
    api("/squads/mine", { token }).then(setMine).catch(() => {});
  }, [token]);

  useEffect(() => {
    setReportedId(null);
    if (!squadId) {
      setMembers([]);
      return;
    }
    api(`/squads/${squadId}`, { token }).then((d) => setMembers(d.members || [])).catch(() => setMembers([]));
  }, [squadId, token]);

  const submit = async () => {
    try {
      const r = await api("/reports", {
        method: "POST",
        token,
        body: { reason, details, squad_id: squadId, reported_user_id: reportedId },
      });
      Alert.alert("Report sent", r.message);
      setDetails("");
      setSquadId(null);
    } catch (e) {
      Alert.alert("Error", e.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={[s.card, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
        <Text style={[s.h3, { color: "#991b1b" }]}>🚨 In danger right now?</Text>
        <Text style={{ color: "#7f1d1d", marginTop: 4 }}>Call 999 or 112 (Kenya emergency). Alert venue security and stay with your squad.</Text>
        <View style={[s.row, { marginTop: 10, gap: 8 }]}>
          <Btn title="Call 999" color={C.red} onPress={() => Linking.openURL("tel:999")} style={{ flex: 1 }} />
          <Btn title="Call 112" color={C.red} onPress={() => Linking.openURL("tel:112")} style={{ flex: 1 }} />
        </View>
      </View>
      <View style={s.card}>
        <Text style={s.h3}>Report a safety issue</Text>
        <Text style={s.label}>Reason</Text>
        <View style={s.chipRow}>
          {REASONS.map(([v, l]) => (
            <Chip key={v} label={l} active={reason === v} onPress={() => setReason(v)} />
          ))}
        </View>
        {mine.length > 0 && (
          <>
            <Text style={s.label}>Squad (optional)</Text>
            <View style={s.chipRow}>
              {mine.map((sq) => (
                <Chip key={sq.id} label={sq.name} active={squadId === sq.id} onPress={() => setSquadId(squadId === sq.id ? null : sq.id)} />
              ))}
            </View>
          </>
        )}
        {members.length > 0 && (
          <>
            <Text style={s.label}>Person (optional)</Text>
            <View style={s.chipRow}>
              {members.map((m) => (
                <Chip key={m.user_id} label={m.name} active={reportedId === m.user_id} onPress={() => setReportedId(reportedId === m.user_id ? null : m.user_id)} />
              ))}
            </View>
          </>
        )}
        <TextInput style={[s.input, { height: 90 }]} multiline placeholder="What happened?" value={details} onChangeText={setDetails} />
        <Btn title="Submit report" color={C.red} onPress={submit} />
      </View>
    </ScrollView>
  );
}

/* ---------------------------------------------------------------- Root */
const TABS = [
  ["squads", "🍻", "Squads"],
  ["chat", "💬", "Chat"],
  ["venues", "📍", "Venues"],
  ["safety", "🛡️", "Safety"],
];

export default function App() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("squads");
  const [chatSquadId, setChatSquadId] = useState(null);

  if (!token || !user) {
    return (
      <>
        <StatusBar barStyle="light-content" />
        <AuthScreen
          onAuth={(d) => {
            setToken(d.token);
            setUser(d.user);
          }}
        />
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>🍻 Drink Buddy</Text>
          <Text style={{ color: "#ddd6fe", fontSize: 12 }}>Westlands · platonic squads only</Text>
        </View>
        <Pressable
          onPress={() => {
            setToken("");
            setUser(null);
          }}
        >
          <Text style={{ color: "#fff", fontSize: 12 }}>Hi {user.name} · Log out</Text>
        </Pressable>
      </View>
      <View style={{ flex: 1 }}>
        {tab === "squads" && (
          <SquadsScreen
            token={token}
            user={user}
            openChat={(id) => {
              setChatSquadId(id);
              setTab("chat");
            }}
          />
        )}
        {tab === "chat" && <ChatScreen token={token} squadId={chatSquadId} setSquadId={setChatSquadId} />}
        {tab === "venues" && <VenuesScreen token={token} />}
        {tab === "safety" && <SafetyScreen token={token} />}
      </View>
      <View style={s.tabBar}>
        {TABS.map(([k, icon, label]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={s.tabBtn}>
            <Text style={{ fontSize: 20 }}>{icon}</Text>
            <Text style={{ fontSize: 11, fontWeight: "700", color: tab === k ? C.violet : C.slate }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  authWrap: { flexGrow: 1, justifyContent: "center", padding: 20 },
  header: {
    backgroundColor: C.violetDark,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 24) + 8 : 54,
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  h1: { fontSize: 28, fontWeight: "800", color: "#0f172a" },
  h2: { fontSize: 20, fontWeight: "800", color: "#0f172a" },
  h3: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  muted: { color: C.slate, fontSize: 13 },
  small: { color: C.slate, fontSize: 12 },
  label: { fontWeight: "600", color: C.slate, marginTop: 8, marginBottom: 6 },
  err: { color: C.red, marginVertical: 6 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, backgroundColor: "#fff", fontSize: 15 },
  btn: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  segment: { flexDirection: "row", backgroundColor: "#f1f5f9", borderRadius: 10, padding: 4, marginBottom: 12 },
  segBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  segActive: { backgroundColor: "#fff" },
  consentRow: { flexDirection: "row", alignItems: "center", marginVertical: 6 },
  consentText: { flex: 1, marginLeft: 8, fontSize: 13, color: "#334155" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: C.violet, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "#fff" },
  chipActive: { backgroundColor: C.violet },
  chipText: { color: C.violet, fontWeight: "600", fontSize: 13 },
  badge: { color: "#fff", fontSize: 11, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  progress: { height: 6, backgroundColor: "#f1f5f9", borderRadius: 3, marginTop: 4, marginBottom: 12, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: C.violet },
  sheetWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "90%" },
  payBox: { backgroundColor: "#ecfdf5", borderColor: "#a7f3d0", borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  chatHeader: { paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderColor: C.border },
  systemMsg: { textAlign: "center", color: C.slate, fontStyle: "italic", fontSize: 12, marginVertical: 6 },
  bubble: { maxWidth: "78%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 3 },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: C.violet },
  bubbleOther: { alignSelf: "flex-start", backgroundColor: "#f1f5f9" },
  composer: { flexDirection: "row", alignItems: "center", padding: 10, borderTopWidth: 1, borderColor: C.border, backgroundColor: "#fff" },
  tabBar: { flexDirection: "row", borderTopWidth: 1, borderColor: C.border, backgroundColor: "#fff", paddingBottom: Platform.OS === "ios" ? 24 : 8, paddingTop: 8 },
  tabBtn: { flex: 1, alignItems: "center" },
});
