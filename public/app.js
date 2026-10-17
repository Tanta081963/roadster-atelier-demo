const cards = [...document.querySelectorAll(".card")];
const configuration = document.getElementById("configuration");
function choose(card) {
  cards.forEach(c => {
    const selected = c === card;
    c.classList.toggle("active", selected);
    c.setAttribute("aria-pressed", String(selected));
    c.querySelector(".pick").textContent = selected ? "Selected ✓" : "Select →";
  });
  configuration.value = card.dataset.config;
}
cards.forEach(card => {
  card.addEventListener("click", () => choose(card));
  card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(card); } });
});
configuration.addEventListener("change", () => {
  const card = cards.find(c => c.dataset.config === configuration.value);
  if (card) choose(card);
});
const form = document.getElementById("reservationForm");
const result = document.getElementById("reservationResult");
const submitBtn = document.getElementById("submitBtn");
form.addEventListener("submit", async e => {
  e.preventDefault();
  if (!form.reportValidity()) return;
  submitBtn.disabled = true; submitBtn.textContent = "Submitting…";
  result.style.display = "none";
  const data = Object.fromEntries(new FormData(form).entries());
  data.demoAcknowledged = document.getElementById("demoAcknowledged").checked;
  try {
    const response = await fetch("/api/reservations", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(data) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not submit your request.");
    result.innerHTML = `<strong>Demo request saved</strong><div class="ref"></div><div class="result-details"></div>`;
    result.querySelector(".ref").textContent = payload.reservation.reference;
    result.querySelector(".result-details").textContent = `Configuration: ${payload.reservation.configuration} · Status: ${payload.reservation.status}. Save this reference to check the demo status below. No real vehicle has been ordered.`;
    result.style.display = "block";
    document.getElementById("reference").value = payload.reservation.reference;
    result.scrollIntoView({behavior:"smooth",block:"nearest"});
  } catch (err) {
    result.textContent = err.message || "Network error. Make sure the backend server is running.";
    result.style.display = "block";
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = "Submit demo reservation";
  }
});
document.getElementById("lookupForm").addEventListener("submit", async e => {
  e.preventDefault();
  const ref = document.getElementById("reference").value.trim();
  const out = document.getElementById("lookupResult");
  out.textContent = "Checking…";
  try {
    const response = await fetch("/api/reservations/" + encodeURIComponent(ref));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Reference not found.");
    const r = payload.reservation;
    out.textContent = `Reference: ${r.reference} · Configuration: ${r.configuration} · Status: ${r.status} · Created: ${new Date(r.createdAt).toLocaleString()}. Demo record only.`;
  } catch (err) { out.textContent = err.message; }
});
