// Supabase Edge Function: sign-quote
// Receives signature payload → saves to DB → triggers PDF generator
// Deploy: supabase functions deploy sign-quote

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PDF_GENERATOR_URL = Deno.env.get("PDF_GENERATOR_URL")!;   // e.g. https://pdf.cargonex.io/generate-pdf
const PDF_GENERATOR_SECRET = Deno.env.get("PDF_GENERATOR_SECRET")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { quote_id, signer_name, signer_email, signer_phone, signature_b64, stamp_image_b64, signature_type = 'drawn', client_name, session_id, setup_fee, monthly_fee, owner_email, token } = body;

    // Basic validation
    if (!quote_id || !signer_name || !signer_email || !signature_b64) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Token is required — no anonymous signing
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Role + expiry validation
    const { data: tokenRow } = await supabase
      .from("quote_tokens")
      .select("role, expires_at")
      .eq("token", token)
      .eq("quote_id", quote_id)
      .single();

    if (!tokenRow) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (tokenRow.role === "viewer") {
      return new Response(JSON.stringify({ error: "Viewer tokens cannot sign" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (new Date(tokenRow.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Token expired" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sigId = crypto.randomUUID();
    const signedAt = new Date().toISOString();

    // Upload stamp to Storage FIRST (if provided) — stampUrl needed for INSERT
    let stampUrl = null;
    if (stamp_image_b64) {
      try {
        const base64Data = stamp_image_b64.split(',')[1];
        const stampBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        const stampFilename = `${sigId}-stamp.png`;
        const { error: stampErr } = await supabase.storage
          .from("signature-stamps")
          .upload(stampFilename, stampBytes, { contentType: "image/png" });
        if (!stampErr) {
          const { data: stampUrlData } = await supabase.storage
            .from("signature-stamps")
            .createSignedUrl(stampFilename, 60 * 60 * 24 * 365 * 7);
          stampUrl = stampUrlData?.signedUrl || null;
        }
      } catch (e) {
        console.error("Stamp upload failed:", e);
      }
    }

    // Save signature record (INSERT ONLY — immutable per PRD)
    const { error: insertError } = await supabase.from("quote_signatures").insert({
      id: sigId,
      quote_id,
      signer_name,
      signer_email,
      signer_phone: signer_phone || null,
      signature_image: signature_b64,
      client_name: client_name || "",
      setup_fee: setup_fee || null,
      monthly_fee: monthly_fee || null,
      session_id: session_id || null,
      ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      user_agent: req.headers.get("user-agent") || null,
      signed_at: signedAt,
      signature_type,
      stamp_image_url: stampUrl,
      pdf_url: null,  // will be updated by pdf-generator after upload
    });

    if (insertError) {
      console.error("DB insert error:", insertError);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Fetch viewer emails for this quote (to CC on PDF email)
    const { data: viewerRows } = await supabase
      .from("quote_tokens")
      .select("email")
      .eq("quote_id", quote_id)
      .eq("role", "viewer");
    const viewerEmails = (viewerRows || []).map((r: any) => r.email).filter(Boolean);

    // Fetch full HTML from quotes table (for full PDF render)
    const { data: quoteRow } = await supabase
      .from("quotes")
      .select("html_content")
      .eq("quote_id", quote_id)
      .single();

    const quote_html = quoteRow?.html_content || null;

    // Fire PDF generation — tracked (admin alert on failure)
    const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "";
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

    fetch(PDF_GENERATOR_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PDF_GENERATOR_SECRET}`,
      },
      body: JSON.stringify({
        signature_id: sigId,
        quote_id,
        signer_name,
        signer_email,
        client_name: client_name || "",
        signed_at: signedAt,
        setup_fee,
        monthly_fee,
        signature_b64,
        owner_email: owner_email || "",
        viewer_emails: viewerEmails,
        quote_html,
        stamp_image_url: stampUrl,
      }),
    }).then(async (r) => {
      if (!r.ok) {
        const errText = await r.text().catch(() => "unknown");
        console.error(`[PDF FAIL] ${quote_id}: HTTP ${r.status} — ${errText}`);
        if (ADMIN_EMAIL && RESEND_API_KEY) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "CargoNex Alerts <hello@cargonex.io>",
              to: [ADMIN_EMAIL],
              subject: `🚨 PDF נכשל — ${quote_id}`,
              html: `<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;">
                <h2 style="color:#E74C3C;">⚠️ PDF Generation Failed</h2>
                <p><strong>Quote ID:</strong> ${quote_id}</p>
                <p><strong>Signer:</strong> ${signer_name} &lt;${signer_email}&gt;</p>
                <p><strong>HTTP Status:</strong> ${r.status}</p>
                <p><strong>Error:</strong> ${errText}</p>
                <p style="color:#888;font-size:13px;">הלקוח לא קיבל את ה-PDF. יש לשלוח ידנית.</p>
              </div>`,
            }),
          }).catch(() => { });
        }
      }
    }).catch((e) => {
      console.error(`[PDF CALL FAIL] ${quote_id}:`, e.message);
    });

    return new Response(JSON.stringify({ ok: true, signature_id: sigId }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
