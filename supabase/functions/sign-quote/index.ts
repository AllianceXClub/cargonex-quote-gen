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
    const { quote_id, signer_name, signer_email, signature_b64, client_name, session_id, setup_fee, monthly_fee, owner_email, token } = body;

    // Basic validation
    if (!quote_id || !signer_name || !signer_email || !signature_b64) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Role validation — viewers cannot sign
    if (token) {
      const { data: tokenRow } = await supabase
        .from("quote_tokens")
        .select("role, expires_at")
        .eq("token", token)
        .eq("quote_id", quote_id)
        .single();

      if (tokenRow) {
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
      }
    }

    const sigId = crypto.randomUUID();
    const signedAt = new Date().toISOString();

    // Save signature record (INSERT ONLY — immutable per PRD)
    const { error: insertError } = await supabase.from("quote_signatures").insert({
      id: sigId,
      quote_id,
      signer_name,
      signer_email,
      signature_image: signature_b64,
      client_name: client_name || "",
      setup_fee: setup_fee || null,
      monthly_fee: monthly_fee || null,
      session_id: session_id || null,
      ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      user_agent: req.headers.get("user-agent") || null,
      signed_at: signedAt,
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

    // Fire PDF generation — async, no await (don't block the response)
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
      }),
    }).catch((e) => console.error("PDF generator call failed:", e));

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
