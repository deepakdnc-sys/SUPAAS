import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const supabase = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const randomToken = () => `${crypto.randomUUID()}-${crypto.randomUUID()}`;
const bookingId = () => `SGM26-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
const safeTicket = (r: any) => ({
  booking_id: r.booking_id, name: r.name, mobile: r.mobile, amount: r.amount,
  status: r.status, allowed_members: r.allowed_members, entered_members: r.entered_members,
  qr_token: r.qr_token, id: r.id, created_at: r.created_at
});
function base64Bytes(s: string) { const raw = atob(s); const arr = new Uint8Array(raw.length); for (let i=0;i<raw.length;i++) arr[i] = raw.charCodeAt(i); return arr; }

serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok:false, error:"POST required." }, 405);
  try {
    const body = await req.json();
    const db = supabase();
    if (body.action === "staff_login") {
      const role = body.role, password = String(body.password || "");
      const expected = role === "admin" ? env("ADMIN_PASSWORD") : role === "scanner" ? env("SCANNER_PASSWORD") : "";
      if (!expected || password.length > 200 || password !== expected) return json({ ok:false, error:"Invalid login credentials." }, 401);
      const secret = env("STAFF_TOKEN_SECRET");
      if (!secret) return json({ ok:false, error:"Server setup missing STAFF_TOKEN_SECRET." }, 500);
      const token = crypto.randomUUID() + "." + crypto.randomUUID();
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
      const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(role + ":" + token));
      const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
      return json({ ok:true, staffToken: token + "." + sig, role });
    }
    if (body.action === "create_booking") {
      const name = String(body.name || "").trim(), mobile = String(body.mobile || "").trim();
      const allowed = Number(body.allowedMembers), utr = String(body.utr || "").trim();
      if (!name || name.length > 100) return json({ ok:false, error:"Enter a valid name." }, 400);
      if (!/^\d{10}$/.test(mobile)) return json({ ok:false, error:"Enter a valid 10-digit mobile number." }, 400);
      if (!Number.isInteger(allowed) || allowed < 1 || allowed > 4) return json({ ok:false, error:"Choose 1 to 4 members." }, 400);
      if (utr.length < 6 || utr.length > 80) return json({ ok:false, error:"Enter a valid UTR/reference number." }, 400);
      if (!/^[a-zA-Z0-9\-\/ ]+$/.test(utr)) return json({ ok:false, error:"UTR contains unsupported characters." }, 400);
      if (!body.fileBase64 || String(body.fileBase64).length > 10_000_000) return json({ ok:false, error:"Upload a payment screenshot smaller than 7 MB." }, 400);
      const { data: settings } = await db.from("event_settings").select("booking_enabled").eq("id", true).single();
      if (!settings?.booking_enabled) return json({ ok:false, error:"Bookings are temporarily closed by the event admin." }, 403);
      const { data: existing } = await db.from("event_passes").select("id").ilike("utr", utr).maybeSingle();
      if (existing) return json({ ok:false, error:"This UTR has already been submitted. Use Retrieve My Pass or contact support." }, 409);
      const bytes = base64Bytes(String(body.fileBase64));
      const contentType = String(body.fileType || "application/octet-stream");
      if (!["image/jpeg","image/png","image/webp","image/heic","application/pdf"].includes(contentType)) return json({ ok:false, error:"Upload a JPG, PNG, WebP, HEIC image or PDF." }, 400);
      if (bytes.byteLength > 7 * 1024 * 1024) return json({ ok:false, error:"Screenshot must be smaller than 7 MB." }, 400);
      const ext = contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : contentType === "image/heic" ? "heic" : "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await db.storage.from("payment-screenshots").upload(path, bytes, { contentType, upsert:false });
      if (uploadError) return json({ ok:false, error:"Could not save screenshot. Check that the private payment-screenshots bucket exists." }, 500);
      const amount = allowed * 200;
      const row = { booking_id:bookingId(), name, mobile, amount, utr, screenshot_path:path, qr_token:randomToken(), status:"PENDING", allowed_members:allowed, entered_members:0 };
      const { data, error } = await db.from("event_passes").insert(row).select("*").single();
      if (error) { await db.storage.from("payment-screenshots").remove([path]); return json({ ok:false, error:error.code === "23505" ? "This UTR has already been submitted." : "Could not create pass. Please retry or contact support." }, 500); }
      return json({ ok:true, ticket:safeTicket(data) });
    }
    if (body.action === "retrieve_ticket") {
      const utr = String(body.utr || "").trim(), mobile = String(body.mobile || "").trim();
      if (!utr || !/^\d{10}$/.test(mobile)) return json({ ok:false, error:"Enter UTR and the same 10-digit mobile number used for booking." }, 400);
      const { data, error } = await db.from("event_passes").select("*").ilike("utr", utr).eq("mobile", mobile).maybeSingle();
      if (error || !data) return json({ ok:false, error:"No matching ticket found. Check the UTR and mobile number." }, 404);
      return json({ ok:true, ticket:safeTicket(data) });
    }
    return json({ ok:false, error:"Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json({ ok:false, error:"Unexpected server error. Please try again." }, 500);
  }
});
