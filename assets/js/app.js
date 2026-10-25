const sb = supabase.createClient(new URL(CONFIG.url.trim()).origin, CONFIG.key.trim()); // nur Host, Pfad/Schrägstrich werden ignoriert
const BUCKET = "spot-photos", DAYS = ["Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","Sonntag"];
const $ = s => document.querySelector(s), main = $("#view");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let me = null, tab = "spots", planSpot = null;

const note = (t, err) => `<div class="msg ${err ? "err" : ""}">${esc(t)}</div>`;
const form = e => Object.fromEntries(new FormData(e.target));

async function init() {
  if (CONFIG.url.includes("DEIN-PROJEKT")) { main.innerHTML = note("Die Verbindung zu Supabase ist noch nicht eingerichtet: Trage URL und Key in assets/js/config.js ein.", 1); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return authView();
  const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
  me = data;
  if (!me?.approved) return pendingView();
  nav(); show();
}

function authView(mode = "login", msg = "") {
  const reg = mode === "register";
  main.innerHTML = `<div class="auth"><h1>${reg ? "Registrieren" : "Anmelden"}</h1>${msg}
  <p class="muted" style="margin-top:-.4rem">Der Mitgliederbereich ist nur für Mitglieder der Katzenfreunde Bad Bentheim / Schüttorf e.V.</p>
  <form class="f" id="auth">
    ${reg ? `<label>Vor- und Nachname<input name="name" required></label>` : ""}
    <label>E-Mail<input name="email" type="email" required autocomplete="email"></label>
    <label>Passwort<input name="password" type="password" minlength="8" required autocomplete="${reg ? "new-password" : "current-password"}"></label>
    ${reg ? `<label>Hinweis für die Mitgliedsprüfung (z. B. Mitgliedsnummer)<input name="note" required></label>
    <p class="muted" style="margin:0">Deine Angaben dienen der Prüfung der Mitgliedschaft. Mehr in der <a href="datenschutz.html">Datenschutzerklärung</a>.</p>` : ""}
    <div class="row"><button class="b">${reg ? "Registrieren" : "Anmelden"}</button>
    <button type="button" class="b alt" id="swap">${reg ? "Ich habe schon ein Konto" : "Neu registrieren"}</button></div>
  </form></div>`;
  $("#swap").onclick = () => authView(reg ? "login" : "register");
  $("#auth").onsubmit = async e => {
    e.preventDefault(); const f = form(e);
    if (reg) {
      const { error } = await sb.auth.signUp({ email: f.email, password: f.password, options: { data: { name: f.name, note: f.note } } });
      return error ? authView(mode, note(error.message, 1)) : authView("login", note("Registriert. Bitte bestätige zuerst deine E-Mail-Adresse. Danach schaltet der Vorstand dein Konto frei."));
    }
    const { error } = await sb.auth.signInWithPassword(f);
    error ? authView(mode, note("Anmeldung fehlgeschlagen: " + error.message, 1)) : init();
  };
}

function pendingView() {
  main.innerHTML = `<h1>Warte auf Freischaltung</h1>${note("Dein Konto ist angelegt, aber noch nicht vom Vorstand freigegeben.")}
  <button class="b alt" id="out">Abmelden</button>`;
  $("#out").onclick = logout;
}
async function logout() { await sb.auth.signOut(); location.reload(); }

function nav() {
  const items = [["map","🗺️","Karte"],["spots","📍","Futterstellen"],["plans","🗓️","Pläne"]];
  if (me.is_admin) items.push(["admin","✅","Freigeben"]);
  $("#nav").innerHTML = items.map(([k,i,l]) => `<a href="#" data-t="${k}" class="${k === tab ? "active" : ""}"><span>${i}</span>${l}</a>`).join("") +
    `<a href="#" id="out"><span>↩️</span>Abmelden</a>`;
  $("#out").onclick = e => { e.preventDefault(); logout(); };
  document.querySelectorAll("[data-t]").forEach(a => a.onclick = e => { e.preventDefault(); tab = a.dataset.t; nav(); show(); scrollTo(0, 0); });
}
const show = () => ({ map: mapView, spots: spotsView, plans: plansView, admin: adminView }[tab])();

// Fotos vor dem Upload auf max. 1600 px verkleinern (spart kostenlosen Speicher)
async function shrink(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(), "image/jpeg", 0.82));
  } catch { return file; }
}

// ---------- Karte (Leaflet + OpenStreetMap) ----------
function baseMap(el, center = [52.3045, 7.1595], zoom = 12) {
  const m = L.map(el).setView(center, zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap-Mitwirkende" }).addTo(m);
  return m;
}
const pin = ll => L.circleMarker(ll, { radius: 11, color: "#fff", weight: 3, fillColor: "#289208", fillOpacity: 1 });
const route = s => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;

async function mapView() {
  const { data: spots = [] } = await sb.from("spots").select("id,name,address,lat,lng");
  const geo = spots.filter(s => s.lat != null);
  main.innerHTML = `<h1>Karte</h1><div id="map" class="map"></div>
  <p class="muted">${geo.length} von ${spots.length} Futterstellen haben einen Standort. Fehlende Standorte trägst du unter „Futterstellen“ ein.</p>`;
  const m = baseMap("map");
  const pts = geo.map(s => {
    pin([s.lat, s.lng]).addTo(m).bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.address)}<br><a href="${route(s)}" target="_blank" rel="noopener">Route planen</a>`);
    return [s.lat, s.lng];
  });
  if (pts.length) m.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
}

// ---------- Futterstellen ----------
async function spotsView(editId) {
  const { data: spots = [], error } = await sb.from("spots").select("*").order("name");
  const ed = spots.find(s => s.id === editId) || {};
  const cards = await Promise.all(spots.map(async s => {
    const { data: files = [] } = await sb.storage.from(BUCKET).list(s.id);
    const paths = (files || []).filter(f => f.name).map(f => `${s.id}/${f.name}`);
    const { data: urls = [] } = paths.length ? await sb.storage.from(BUCKET).createSignedUrls(paths, 3600) : {};
    return `<div class="card"><h3>${esc(s.name)}</h3><div class="muted">${esc(s.address)}</div>${s.lat != null ? `<a href="${route(s)}" target="_blank" rel="noopener">Route planen</a>` : ""}<p>${esc(s.notes)}</p>
      <div class="photos">${(urls || []).map(u => `<a href="${u.signedUrl}" target="_blank" rel="noopener"><img src="${u.signedUrl}" alt="Foto ${esc(s.name)}" loading="lazy"></a>`).join("")}</div>
      <div class="row"><button class="b alt" data-edit="${s.id}">Bearbeiten</button>
      <label class="b alt">Foto hinzufügen<input type="file" accept="image/*" hidden data-photo="${s.id}"></label>
      <button class="b del" data-del="${s.id}">Löschen</button></div></div>`;
  }));
  main.innerHTML = `<h1>Futterstellen</h1>${error ? note(error.message, 1) : ""}
  <form class="f wide" id="spotf">
    <label>Name<input name="name" required value="${esc(ed.name)}"></label>
    <label>Standort / Adresse<input name="address" value="${esc(ed.address)}"></label>
    <label class="full">Hinweise (Zugang, Katzen, Besonderheiten)<textarea name="notes" rows="3">${esc(ed.notes)}</textarea></label>
    <div class="full"><b>Standort</b> <span class="muted">(auf die Karte tippen, um die Futterstelle zu setzen)</span>
      <div id="pick" class="map small"></div>
      <input type="hidden" name="lat" value="${ed.lat ?? ""}"><input type="hidden" name="lng" value="${ed.lng ?? ""}">
      <div class="row" style="margin-top:.5rem"><button type="button" class="b alt s" id="here">Meinen Standort verwenden</button><button type="button" class="b alt s" id="clr">Standort entfernen</button></div></div>
    <div class="row full"><button class="b">${ed.id ? "Änderungen speichern" : "Futterstelle anlegen"}</button>
    ${ed.id ? `<button type="button" class="b alt" id="cancel">Abbrechen</button>` : ""}</div>
  </form><br>${cards.join("") || `<p class="muted">Noch keine Futterstelle eingetragen.</p>`}`;
  $("#cancel")?.addEventListener("click", () => spotsView());
  const has = ed.lat != null, pm = baseMap("pick", has ? [ed.lat, ed.lng] : undefined, has ? 16 : 12);
  let mk = null;
  const setPt = (lat, lng, center) => {
    $("[name=lat]").value = lat; $("[name=lng]").value = lng;
    mk ? mk.setLatLng([lat, lng]) : (mk = pin([lat, lng]).addTo(pm));
    if (center) pm.setView([lat, lng], 17);
  };
  if (has) setPt(ed.lat, ed.lng);
  pm.on("click", e => setPt(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)));
  $("#here").onclick = () => navigator.geolocation?.getCurrentPosition(
    p => setPt(+p.coords.latitude.toFixed(6), +p.coords.longitude.toFixed(6), true),
    () => alert("Standort nicht verfügbar. Bitte den Zugriff erlauben oder auf die Karte tippen."));
  $("#clr").onclick = () => { $("[name=lat]").value = ""; $("[name=lng]").value = ""; mk?.remove(); mk = null; };
  $("#spotf").onsubmit = async e => {
    e.preventDefault(); const f = form(e);
    f.lat = f.lat === "" ? null : +f.lat; f.lng = f.lng === "" ? null : +f.lng;
    const { error } = ed.id ? await sb.from("spots").update(f).eq("id", ed.id) : await sb.from("spots").insert(f);
    error ? alert(error.message) : spotsView();
  };
  main.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { spotsView(b.dataset.edit); scrollTo(0, 0); });
  main.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("Futterstelle samt Futterplan wirklich löschen?")) return;
    const { error } = await sb.from("spots").delete().eq("id", b.dataset.del);
    error ? alert(error.message) : spotsView();
  });
  main.querySelectorAll("[data-photo]").forEach(i => i.onchange = async () => {
    const orig = i.files[0]; if (!orig) return;
    const file = await shrink(orig);
    const path = `${i.dataset.photo}/${Date.now()}-${orig.name.replace(/\.[^.]*$/, "").replace(/[^\w-]/g, "_")}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: "image/jpeg" });
    error ? alert(error.message) : spotsView();
  });
}

// ---------- Futterpläne ----------
async function plansView() {
  const { data: spots = [] } = await sb.from("spots").select("id,name").order("name");
  if (!spots.length) { main.innerHTML = `<h1>Futterpläne</h1><p class="muted">Lege zuerst eine Futterstelle an.</p>`; return; }
  if (!spots.find(s => s.id === planSpot)) planSpot = spots[0].id;
  const { data: plans = [] } = await sb.from("plans").select("*").eq("spot_id", planSpot).order("weekday").order("time");
  const listHtml = DAYS.map((d, i) => [d, plans.filter(p => p.weekday === i)]).filter(x => x[1].length).map(([d, l]) =>
    `<h3 class="day">${d}</h3>` + l.map(p => `<div class="card pi"><div><b>${esc(p.time)}</b> <span>${esc(p.person) || "–"}</span><div class="muted">${esc(p.food)}</div></div>
    <div class="row"><button class="b alt s" data-e="${p.id}">Bearbeiten</button><button class="b del s" data-d="${p.id}">Löschen</button></div></div>`).join("")).join("") || `<p class="muted">Noch keine Einträge.</p>`;
  main.innerHTML = `<h1>Futterpläne</h1>
  <label>Futterstelle<select id="sel">${spots.map(s => `<option value="${s.id}" ${s.id === planSpot ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label><br>
  ${listHtml}
  <h2>Eintrag hinzufügen</h2>
  <form class="f wide" id="planf">
    <label>Tag<select name="weekday">${DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join("")}</select></label>
    <label>Uhrzeit<input name="time" type="time" required></label>
    <label>Wer füttert<input name="person"></label>
    <label>Futter<input name="food" placeholder="z. B. Nassfutter + Trockenfutter"></label>
    <div class="full"><button class="b">Eintrag speichern</button></div>
  </form>`;
  $("#sel").onchange = e => { planSpot = e.target.value; plansView(); };
  $("#planf").onsubmit = async e => {
    e.preventDefault(); const f = form(e);
    const { error } = await sb.from("plans").insert({ ...f, weekday: +f.weekday, spot_id: planSpot });
    error ? alert(error.message) : plansView();
  };
  main.querySelectorAll("[data-d]").forEach(b => b.onclick = async () => {
    if (!confirm("Eintrag löschen?")) return;
    await sb.from("plans").delete().eq("id", b.dataset.d); plansView();
  });
  main.querySelectorAll("[data-e]").forEach(b => b.onclick = async () => {
    const p = plans.find(x => x.id === b.dataset.e);
    const time = prompt("Uhrzeit (HH:MM)", p.time); if (time === null) return;
    const person = prompt("Wer füttert?", p.person ?? ""); if (person === null) return;
    const food = prompt("Futter", p.food ?? ""); if (food === null) return;
    const { error } = await sb.from("plans").update({ time, person, food }).eq("id", p.id);
    error ? alert(error.message) : plansView();
  });
}

// ---------- Admin ----------
async function adminView() {
  const { data: list = [] } = await sb.from("profiles").select("*").order("created_at", { ascending: false });
  const row = p => `<div class="card"><h3>${esc(p.name)}</h3><div class="muted">Hinweis: ${esc(p.note)}</div>
    <div class="row"><button class="b" data-ok="${p.id}">Freischalten</button><button class="b del" data-no="${p.id}">Ablehnen</button></div></div>`;
  const open = list.filter(p => !p.approved);
  main.innerHTML = `<h1>Mitglieder freigeben</h1>${open.map(row).join("") || `<p class="muted">Keine offenen Anfragen.</p>`}
  <h2>Freigeschaltet</h2><p>${list.filter(p => p.approved).map(p => esc(p.name)).join(", ")}</p>`;
  main.querySelectorAll("[data-ok]").forEach(b => b.onclick = async () => { await sb.from("profiles").update({ approved: true }).eq("id", b.dataset.ok); adminView(); });
  main.querySelectorAll("[data-no]").forEach(b => b.onclick = async () => { await sb.from("profiles").delete().eq("id", b.dataset.no); adminView(); });
}

init();
