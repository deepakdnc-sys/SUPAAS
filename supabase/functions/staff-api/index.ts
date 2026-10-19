import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers:{...cors,"Content-Type":"application/json"} });
const env = (k:string) => Deno.env.get(k) || "";
const db = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth:{persistSession:false} });
const tokenId = () => `${crypto.randomUUID()}-${crypto.randomUUID()}`;
const bookingId = () => `SGM26-${crypto.randomUUID().replaceAll("-","").slice(0,10).toUpperCase()}`;
const publicTicket = (r:any) => ({ id:r.id, booking_id:r.booking_id, name:r.name, mobile:r.mobile, amount:r.amount, utr:r.utr, status:r.status, allowed_members:r.allowed_members, entered_members:r.entered_members, qr_token:r.qr_token, created_at:r.created_at });
async function validStaff(token:string, role:string) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const secret = env("STAFF_TOKEN_SECRET"); if (!secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(role + ":" + parts[0] + "." + parts[1]));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
  return expected === parts[2] && ["admin","scanner"].includes(role);
}
serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:cors});
  if (req.method !== "POST") return json({ok:false,error:"POST required."},405);
  try {
    const b = await req.json(), role = String(b.role||""), token = String(b.staffToken||"");
    if (!await validStaff(token,role)) return json({ok:false,error:"Staff session expired. Please log in again."},401);
    const adminActions = ["list_records","toggle_booking","approve","reject","delete","delete_all","create_manual_pass","get_screenshot_url","get_ticket"];
    const scannerActions = ["validate_ticket","record_entry"];
    if (adminActions.includes(b.action) && role !== "admin") return json({ok:false,error:"Admin permission required."},403);
    if (scannerActions.includes(b.action) && !["admin","scanner"].includes(role)) return json({ok:false,error:"Scanner permission required."},403);
    const sup = db();
    if (b.action === "list_records") {
      const [{data:records,error},{data:settings}] = await Promise.all([
        sup.from("event_passes").select("*").order("created_at",{ascending:false}).limit(1000),
        sup.from("event_settings").select("booking_enabled").eq("id",true).single()
      ]);
      if(error) throw error;
      return json({ok:true,bookingEnabled:!!settings?.booking_enabled,records:(records||[]).map((r:any)=>({...publicTicket(r),has_screenshot:!!r.screenshot_path}))});
    }
    if (b.action === "toggle_booking") {
      const {data:current,error:e} = await sup.from("event_settings").select("booking_enabled").eq("id",true).single(); if(e) throw e;
      const {data,error} = await sup.from("event_settings").update({booking_enabled:!current.booking_enabled,updated_at:new Date().toISOString()}).eq("id",true).select("booking_enabled").single(); if(error) throw error;
      return json({ok:true,bookingEnabled:data.booking_enabled});
    }
    if (b.action === "approve" || b.action === "reject" || b.action === "delete") {
      const {data:r,error:e} = await sup.from("event_passes").select("*").eq("id",b.id).single(); if(e||!r) return json({ok:false,error:"Record not found."},404);
      if (b.action === "delete") {
        const {error} = await sup.from("event_passes").delete().eq("id",b.id); if(error) throw error;
        if(r.screenshot_path) await sup.storage.from("payment-screenshots").remove([r.screenshot_path]);
        return json({ok:true});
      }
      const patch = b.action === "approve" ? {status:"APPROVED",approved_at:new Date().toISOString()} : {status:"REJECTED",approved_at:null};
      const {error} = await sup.from("event_passes").update(patch).eq("id",b.id); if(error) throw error;
      return json({ok:true});
    }
    if (b.action === "delete_all") {
      const {data:rows,error:e} = await sup.from("event_passes").select("screenshot_path"); if(e) throw e;
      const paths = (rows||[]).map((r:any)=>r.screenshot_path).filter(Boolean);
      const {error} = await sup.from("event_passes").delete().not("id","is",null); if(error) throw error;
      for(let i=0;i<paths.length;i+=100) await sup.storage.from("payment-screenshots").remove(paths.slice(i,i+100));
      return json({ok:true});
    }
    if (b.action === "create_manual_pass") {
      const name=String(b.name||"").trim(), mobile=String(b.mobile||"").trim(), allowed=Number(b.allowedMembers);
      if(!name||name.length>100) return json({ok:false,error:"Enter a valid pass holder name."},400);
      if(mobile && !/^\d{10}$/.test(mobile)) return json({ok:false,error:"Mobile must be 10 digits or blank."},400);
      if(!Number.isInteger(allowed)||allowed<1||allowed>4) return json({ok:false,error:"Allowed members must be 1 to 4."},400);
      const row={booking_id:bookingId(),name,mobile:mobile||null,amount:0,utr:null,screenshot_path:null,qr_token:tokenId(),status:"APPROVED",allowed_members:allowed,entered_members:0,is_manual:true,approved_at:new Date().toISOString(),admin_note:"Admin-created manual pass"};
      const {data,error}=await sup.from("event_passes").insert(row).select("*").single(); if(error) throw error;
      return json({ok:true,ticket:publicTicket(data)});
    }
    if (b.action === "get_screenshot_url") {
      const {data:r,error}=await sup.from("event_passes").select("screenshot_path").eq("id",b.id).single(); if(error||!r?.screenshot_path) return json({ok:false,error:"No screenshot is attached."},404);
      const {data,error:se}=await sup.storage.from("payment-screenshots").createSignedUrl(r.screenshot_path,120); if(se||!data?.signedUrl) throw se||new Error("Could not create screenshot link.");
      return json({ok:true,url:data.signedUrl});
    }
    if (b.action === "get_ticket") {
      const {data,error}=await sup.from("event_passes").select("*").eq("id",b.id).single(); if(error||!data) return json({ok:false,error:"Ticket not found."},404);
      return json({ok:true,ticket:publicTicket(data)});
    }
    if (b.action === "validate_ticket" || b.action === "record_entry") {
      const token=String(b.qrToken||"").trim();
      if(!token||token.length>200) return json({ok:false,error:"Invalid QR token."},400);
      // Serialize entry updates with a row lock via the database RPC for safe simultaneous scanning.
      if (b.action === "validate_ticket") {
        const {data:r,error}=await sup.from("event_passes").select("*").eq("qr_token",token).maybeSingle();
        if(error) throw error;
        if(!r) return json({ok:false,error:"Unknown QR code. Entry denied."},404);
        if(r.status!=="APPROVED") return json({ok:true,ticket:{valid:false,reason:r.status==="PENDING"?"Payment pending approval. Entry denied.":"Pass rejected. Entry denied."}});
        const remaining=r.allowed_members-r.entered_members;
        if(remaining<=0) return json({ok:true,ticket:{valid:false,reason:"All allowed members have already entered."}});
        return json({ok:true,ticket:{valid:true,...publicTicket(r),remaining}});
      }
      const members=Number(b.members);
      if(!Number.isInteger(members)||members<1||members>4) return json({ok:false,error:"Choose 1 to 4 members."},400);
      const {data,error}=await sup.rpc("record_pass_entry",{p_qr_token:token,p_members:members});
      if(error) return json({ok:false,error:error.message.includes("PASS_")?error.message.replace("PASS_","").replaceAll("_"," ").toLowerCase():"Could not record entry."},400);
      return json({ok:true,entered_members:data.entered_members,allowed_members:data.allowed_members});
    }
    return json({ok:false,error:"Unknown action."},400);
  } catch(e) {
    console.error(e); return json({ok:false,error:"Unexpected server error."},500);
  }
});
