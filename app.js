(() => {
  const cfg = window.SGM_CONFIG || {};
  const $ = id => document.getElementById(id);
  const money = n => `₹${Number(n || 0).toLocaleString("en-IN")}`;
  let supabase = null, staffSession = null, currentTicket = null, scanner = null, scanTicket = null;

  function apiReady() {
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR_PROJECT") || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) {
      throw new Error("Website setup incomplete: add your Supabase URL and anon key in config.js.");
    }
    if (!supabase) supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }
  async function callPublic(action, payload = {}) {
    apiReady();
    const { data, error } = await supabase.functions.invoke("public-api", { body: { action, ...payload } });
    if (error) throw new Error(await edgeError(error));
    if (!data || data.ok === false) throw new Error(data?.error || "Request failed.");
    return data;
  }
  async function callStaff(action, payload = {}) {
    apiReady();
    if (!staffSession?.token || !staffSession?.role) throw new Error("Please log in again.");
    const { data, error } = await supabase.functions.invoke("staff-api", {
      body: { action, ...payload, role: staffSession.role, staffToken: staffSession.token }
    });
    if (error) throw new Error(await edgeError(error));
    if (!data || data.ok === false) throw new Error(data?.error || "Request failed.");
    return data;
  }
  async function edgeError(error) {
    try { const ctx = error.context; if (ctx?.json) { const j = await ctx.json(); if (j.error) return j.error; } } catch {}
    return error.message || "Could not contact server.";
  }
  function setMessage(id, msg, bad = false) { const el = $(id); el.textContent = msg || ""; el.style.color = bad ? "#ff9aa9" : ""; }
  function safe(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
  function upiHref(amount, name) {
    const upiId = cfg.UPI_ID || "";
    if (!upiId) return "";
    return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent("Swarnkar Garba Mahotsav")}&am=${encodeURIComponent(amount)}&cu=INR&tn=${encodeURIComponent("SGM 2026 pass - " + name)}`;
  }
  function refreshAmount() {
    const amount = Number($("members").value) * Number(cfg.PASS_PRICE || 200);
    $("totalAmount").textContent = money(amount);
    const link = $("upiLink");
    const href = upiHref(amount, $("visitorName").value.trim());
    link.href = href || "#";
    link.onclick = e => {
      if (!href) { e.preventDefault(); alert("UPI ID is not configured yet. Please pay ₹" + amount + " to 8385963066 using your UPI app, then return here. The administrator must set the recipient's exact UPI ID in config.js to enable this button."); }
    };
  }
  $("members").addEventListener("change", refreshAmount);
  $("visitorName").addEventListener("input", refreshAmount);
  refreshAmount();

  async function drawTicket(container, ticket, compact = false) {
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "ticket-result";
    const approved = ticket.status === "APPROVED";
    const statusClass = approved ? "approved" : ticket.status === "REJECTED" ? "rejected" : "pending";
    const statusText = ticket.status === "APPROVED" ? "APPROVED / ACTIVE" : ticket.status === "REJECTED" ? "PAYMENT REJECTED" : "PENDING APPROVAL";
    wrap.innerHTML = `<div class="ticket-head"><span>SWARNKAR GARBA MAHOTSAV</span><strong class="status ${statusClass}">${statusText}</strong></div>
      <div class="ticket-body"><div><p class="tiny">PASS HOLDER</p><h3>${safe(ticket.name)}</h3><p class="muted">${Number(ticket.allowed_members)} member(s) · ${safe(ticket.booking_id)}</p><p class="tiny">Entry used: ${Number(ticket.entered_members || 0)} / ${Number(ticket.allowed_members)}</p></div><canvas></canvas></div>
      <p class="warning">${approved ? "Show this ticket at the gate. Entry is still verified live by the scanner." : "This ticket is inactive until admin approval. Do not travel based on a pending ticket."}</p>
      <div class="button-row"><button class="button button-gold download-one" type="button">Download ticket</button><button class="button button-outline share-one" type="button">Share / WhatsApp</button></div>`;
    container.appendChild(wrap);
    const canvas = wrap.querySelector("canvas");
    await QRCode.toCanvas(canvas, ticket.qr_token, { width: 220, margin: 1, errorCorrectionLevel: "H" });
    wrap.querySelector(".download-one").onclick = () => downloadTicket(ticket, canvas);
    wrap.querySelector(".share-one").onclick = () => shareTicket(ticket, canvas);
  }
  function showNewTicket(ticket) {
    currentTicket = ticket;
    $("ticketResult").classList.remove("hidden");
    $("ticketName").textContent = ticket.name;
    $("ticketInfo").textContent = `${ticket.allowed_members} member(s) · ${money(ticket.amount)} · Entry used ${ticket.entered_members || 0}/${ticket.allowed_members}`;
    $("ticketId").textContent = `Booking ID: ${ticket.booking_id}`;
    const status = $("ticketStatus");
    status.textContent = ticket.status === "APPROVED" ? "APPROVED / ACTIVE" : ticket.status === "REJECTED" ? "REJECTED" : "PENDING APPROVAL";
    status.className = "status " + (ticket.status === "APPROVED" ? "approved" : ticket.status === "REJECTED" ? "rejected" : "pending");
    QRCode.toCanvas($("ticketQr"), ticket.qr_token, { width: 220, margin: 1, errorCorrectionLevel: "H" });
    $("downloadTicket").onclick = () => downloadTicket(ticket, $("ticketQr"));
    $("shareTicket").onclick = () => shareTicket(ticket, $("ticketQr"));
    $("ticketResult").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function makeTicketImage(ticket, qrCanvas) {
    const c = document.createElement("canvas"); c.width = 1000; c.height = 620;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 1000, 620); g.addColorStop(0, "#230b17"); g.addColorStop(1, "#54172b");
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = "#e8bd65"; x.lineWidth = 5; x.strokeRect(18,18,964,584);
    x.fillStyle = "#e8bd65"; x.font = "bold 32px Georgia"; x.fillText("SWARNKAR GARBA MAHOTSAV 2K26", 48, 75);
    x.fillStyle = "#fff4dc"; x.font = "bold 44px Arial"; x.fillText(String(ticket.name).slice(0,24), 48, 160);
    x.font = "26px Arial"; x.fillText(`Booking ID: ${ticket.booking_id}`, 48, 215);
    x.fillText(`Members: ${ticket.allowed_members}  |  Entry used: ${ticket.entered_members || 0}/${ticket.allowed_members}`, 48, 270);
    x.fillStyle = ticket.status === "APPROVED" ? "#8ff0bd" : "#ffdf91";
    x.font = "bold 28px Arial"; x.fillText(ticket.status === "APPROVED" ? "APPROVED / ACTIVE" : ticket.status === "REJECTED" ? "PAYMENT REJECTED" : "PENDING ADMIN APPROVAL", 48, 335);
    x.fillStyle = "#e8bd65"; x.font = "22px Arial"; x.fillText("Entry is validated live at the gate. Do not alter the QR code.", 48, 390);
    x.fillStyle = "#ffffff"; x.fillRect(690, 115, 240, 240); x.drawImage(qrCanvas, 700, 125, 220, 220);
    x.fillStyle = "#fff4dc"; x.font = "20px Arial"; x.fillText("Help: Deepak Soni • 8385963066", 48, 545);
    return c;
  }
  function downloadTicket(ticket, qrCanvas) {
    const c = makeTicketImage(ticket, qrCanvas);
    const a = document.createElement("a"); a.download = `SGM2026-${ticket.booking_id}.png`; a.href = c.toDataURL("image/png"); a.click();
  }
  async function shareTicket(ticket, qrCanvas) {
    const canvas = makeTicketImage(ticket, qrCanvas);
    const message = `Swarnkar Garba Mahotsav 2026 Digital Pass\nName: ${ticket.name}\nBooking ID: ${ticket.booking_id}\nMembers: ${ticket.allowed_members}\nStatus: ${ticket.status}\n${ticket.status === "APPROVED" ? "Approved pass: show the attached QR at the gate." : "Pass is inactive until admin approval."}`;
    try {
      canvas.toBlob(async blob => {
        const file = new File([blob], `SGM2026-${ticket.booking_id}.png`, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) await navigator.share({ title: "SGM 2026 Digital Pass", text: message, files: [file] });
        else { window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener"); downloadTicket(ticket, qrCanvas); }
      });
    } catch { window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener"); downloadTicket(ticket, qrCanvas); }
  }

  $("bookingForm").addEventListener("submit", async e => {
    e.preventDefault(); setMessage("bookingMessage", "Submitting booking securely…");
    const btn = e.submitter; btn.disabled = true;
    try {
      const file = $("screenshot").files[0];
      if (!file) throw new Error("Please upload payment screenshot.");
      if (file.size > 7 * 1024 * 1024) throw new Error("Screenshot must be smaller than 7 MB.");
      if (!/^([0-9]{10})$/.test($("visitorMobile").value.trim())) throw new Error("Enter a valid 10-digit mobile number.");
      const payload = { name: $("visitorName").value.trim(), mobile: $("visitorMobile").value.trim(), allowedMembers: Number($("members").value), utr: $("utr").value.trim(), fileName: file.name, fileType: file.type || "application/octet-stream", fileBase64: await toBase64(file) };
      const res = await callPublic("create_booking", payload);
      showNewTicket(res.ticket);
      setMessage("bookingMessage", "Ticket created. It will remain inactive until payment is approved.");
      $("bookingForm").reset(); refreshAmount();
    } catch (err) { setMessage("bookingMessage", err.message, true); }
    finally { btn.disabled = false; }
  });
  function toBase64(file) { return new Promise((resolve,reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1]); r.onerror = reject; r.readAsDataURL(file); }); }

  $("retrieveForm").addEventListener("submit", async e => {
    e.preventDefault(); setMessage("retrieveMessage", "Searching securely…");
    try {
      const res = await callPublic("retrieve_ticket", { utr: $("retrieveUtr").value.trim(), mobile: $("retrieveMobile").value.trim() });
      await drawTicket($("retrievedTicket"), res.ticket); $("retrievedTicket").classList.remove("hidden");
      setMessage("retrieveMessage", "Ticket found. Current approval status is shown below.");
    } catch (err) { setMessage("retrieveMessage", err.message, true); }
  });

  $("staffLogin").addEventListener("click", async () => {
    const role = $("staffRole").value, password = $("staffPassword").value;
    setMessage("staffMessage", "Checking credentials…");
    try {
      const res = await callPublic("staff_login", { role, password });
      staffSession = { role, token: res.staffToken };
      $("adminPanel").classList.toggle("hidden", role !== "admin");
      $("scannerPanel").classList.toggle("hidden", role !== "scanner");
      $("staffPassword").value = "";
      setMessage("staffMessage", `${role === "admin" ? "Admin" : "Gate scanner"} login successful.`);
      if (role === "admin") await refreshRecords();
      if (role === "scanner") startScanner();
    } catch (err) { setMessage("staffMessage", err.message, true); }
  });
  document.querySelectorAll("[data-logout]").forEach(b => b.addEventListener("click", async () => {
    const role = b.dataset.logout;
    if (role === "scanner") await stopScanner();
    staffSession = null; $("adminPanel").classList.add("hidden"); $("scannerPanel").classList.add("hidden");
    setMessage("staffMessage", "Logged out.");
  }));

  async function refreshRecords() {
    setMessage("staffMessage", "Loading records…");
    try {
      const res = await callStaff("list_records");
      $("toggleBooking").textContent = res.bookingEnabled ? "Booking: ENABLED (click to disable)" : "Booking: DISABLED (click to enable)";
      const body = $("recordsBody"); body.innerHTML = "";
      if (!res.records.length) { body.innerHTML = '<tr><td colspan="9">No bookings yet.</td></tr>'; }
      for (const r of res.records) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${safe(r.name)}</td><td>${safe(r.mobile || "—")}</td><td>${money(r.amount)}</td><td>${safe(r.utr || "Manual pass")}</td><td>${r.entered_members}/${r.allowed_members}</td><td>${r.entered_members}/${r.allowed_members}</td><td><span class="status ${r.status==="APPROVED"?"approved":r.status==="REJECTED"?"rejected":"pending"}">${safe(r.status)}</span></td><td>${r.has_screenshot ? `<button class="button button-outline proof" data-id="${safe(r.id)}">View proof</button>` : "—"}</td><td>${r.status==="PENDING" ? `<button class="button button-gold action" data-action="approve" data-id="${safe(r.id)}">Approve</button><button class="button button-outline action" data-action="reject" data-id="${safe(r.id)}">Reject</button>` : ""}<button class="button button-outline action" data-action="download" data-id="${safe(r.id)}">Ticket</button><button class="button button-danger action" data-action="delete" data-id="${safe(r.id)}">Delete</button></td>`;
        body.appendChild(tr);
      }
      body.querySelectorAll(".action").forEach(b => b.addEventListener("click", () => recordAction(b.dataset.action, b.dataset.id)));
      body.querySelectorAll(".proof").forEach(b => b.addEventListener("click", () => viewProof(b.dataset.id)));
      setMessage("staffMessage", `${res.records.length} record(s) loaded.`);
    } catch (err) { setMessage("staffMessage", err.message, true); }
  }
  $("refreshRecords").addEventListener("click", refreshRecords);
  $("toggleBooking").addEventListener("click", async () => {
    try { const r = await callStaff("toggle_booking"); $("toggleBooking").textContent = r.bookingEnabled ? "Booking: ENABLED (click to disable)" : "Booking: DISABLED (click to enable)"; }
    catch (e) { setMessage("staffMessage", e.message, true); }
  });
  async function recordAction(action, id) {
    try {
      if (action === "delete" && !confirm("Permanently delete this pass record?")) return;
      if (action === "approve" && !confirm("Confirm you verified the payment screenshot and UTR?")) return;
      const res = await callStaff(action === "download" ? "get_ticket" : action, { id });
      if (action === "download") { await drawTicket($("retrievedTicket"), res.ticket); $("retrievedTicket").classList.remove("hidden"); $("retrievedTicket").scrollIntoView({behavior:"smooth"}); }
      await refreshRecords();
    } catch (e) { setMessage("staffMessage", e.message, true); }
  }
  async function viewProof(id) {
    try { const res = await callStaff("get_screenshot_url", { id }); window.open(res.url, "_blank", "noopener"); }
    catch (e) { setMessage("staffMessage", e.message, true); }
  }
  $("manualPassForm").addEventListener("submit", async e => {
    e.preventDefault(); setMessage("manualMessage", "Creating pass…");
    try {
      const res = await callStaff("create_manual_pass", { name: $("manualName").value.trim(), mobile: $("manualMobile").value.trim(), allowedMembers: Number($("manualMembers").value) });
      await drawTicket($("retrievedTicket"), res.ticket); $("retrievedTicket").classList.remove("hidden");
      setMessage("manualMessage", "Approved manual pass created. Download or share it below.");
      $("manualPassForm").reset(); await refreshRecords();
    } catch (err) { setMessage("manualMessage", err.message, true); }
  });
  $("deleteAll").addEventListener("click", async () => {
    if (!confirm("DANGER: permanently delete ALL pass records and associated payment screenshots? This cannot be undone.")) return;
    if (prompt('Type DELETE ALL to confirm') !== "DELETE ALL") return;
    try { await callStaff("delete_all"); await refreshRecords(); setMessage("staffMessage", "All records deleted."); }
    catch (e) { setMessage("staffMessage", e.message, true); }
  });

  async function startScanner() {
    try {
      if (!window.Html5Qrcode) throw new Error("Scanner library did not load. Check internet connection.");
      if (scanner) return;
      scanner = new Html5Qrcode("reader");
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras.length) throw new Error("No camera found. Allow camera permission in your browser.");
      const camera = cameras.find(c => /back|rear|environment/i.test(c.label)) || cameras[0];
      await scanner.start(camera.id, { fps: 10, qrbox: { width: 230, height: 230 } }, decoded => {
        $("manualToken").value = decoded.trim(); validateToken();
      }, () => {});
    } catch (e) { setMessage("staffMessage", `${e.message} Camera scanning requires HTTPS (or localhost).`, true); }
  }
  async function stopScanner() { try { if (scanner) { await scanner.stop(); await scanner.clear(); } } catch {} scanner = null; }
  $("validateToken").addEventListener("click", validateToken);
  async function validateToken() {
    const token = $("manualToken").value.trim();
    if (!token) { setMessage("staffMessage", "Scan a QR code or paste its token.", true); return; }
    $("scanResult").classList.remove("hidden"); $("scanResult").className = "scan-result"; $("scanResult").textContent = "Validating with server…";
    try {
      const res = await callStaff("validate_ticket", { qrToken: token });
      scanTicket = res.ticket;
      renderScanResult(res.ticket);
    } catch (e) {
      $("scanResult").className = "scan-result bad"; $("scanResult").textContent = e.message;
    }
  }
  function renderScanResult(t) {
    const el = $("scanResult"); el.className = "scan-result " + (t.valid ? "good" : "bad");
    if (!t.valid) { el.innerHTML = `<h3>ENTRY NOT ALLOWED</h3><p>${safe(t.reason)}</p>`; return; }
    el.innerHTML = `<h3>APPROVED PASS</h3><p><strong>${safe(t.name)}</strong></p><p>Booking ID: ${safe(t.booking_id)}</p><p>Allowed: ${t.allowed_members} · Already entered: ${t.entered_members} · Remaining: ${t.remaining}</p><label>Number of members entering<select id="entryCount">${Array.from({length:t.remaining},(_,i)=>`<option value="${i+1}">${i+1} member(s)</option>`).join("")}</select></label><div class="scan-actions"><button id="confirmEntry" class="button button-gold">Confirm Entry</button><button id="scanNext" class="button button-outline">Next QR</button></div><p id="entryMessage" class="message"></p>`;
    $("confirmEntry").addEventListener("click", async () => {
      const count = Number($("entryCount").value); $("confirmEntry").disabled = true;
      try {
        const r = await callStaff("record_entry", { qrToken: t.qr_token, members: count });
        $("entryMessage").textContent = `Entry recorded. Total entered: ${r.entered_members}/${r.allowed_members}.`;
        scanTicket = null; $("manualToken").value = "";
      } catch (e) { $("entryMessage").textContent = e.message; $("entryMessage").style.color = "#ff9aa9"; }
      finally { $("confirmEntry").disabled = false; }
    });
    $("scanNext").addEventListener("click", () => { $("manualToken").value = ""; el.classList.add("hidden"); });
  }
})();
