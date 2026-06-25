// Supabase Edge Function: countersign-quote
// Validates signature, calls Cloud Run /countersign-pdf, returns result
// Deploy: supabase functions deploy countersign-quote

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PDF_GENERATOR_URL = Deno.env.get("PDF_GENERATOR_URL")!; // e.g. https://pdf.cargonex.io/generate-pdf
const PDF_GENERATOR_SECRET = Deno.env.get("PDF_GENERATOR_SECRET")!;

// Derive countersign-pdf URL from the generate-pdf URL
const CS_PDF_URL = PDF_GENERATOR_URL.replace("/generate-pdf", "/countersign-pdf");

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
    const {
      signature_id,
      countersigner_name = "דרור",
      countersigner_role = 'מנכ"ל CargoNex',
      countersign_sig_b64,
    } = body;

    if (!signature_id || !countersign_sig_b64) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Validate: signature must exist, have a pdf_url, and not be countersigned yet
    const { data: sigRow, error: sigErr } = await supabase
      .from("quote_signatures")
      .select("id, pdf_url, countersigned_at")
      .eq("id", signature_id)
      .single();

    if (sigErr || !sigRow) {
      return new Response(JSON.stringify({ error: "Signature not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!sigRow.pdf_url) {
      return new Response(JSON.stringify({ error: "Quote not yet signed by client" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (sigRow.countersigned_at) {
      return new Response(JSON.stringify({ error: "Already countersigned" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call Cloud Run /countersign-pdf
    const csRes = await fetch(CS_PDF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PDF_GENERATOR_SECRET}`,
      },
      body: JSON.stringify({
        signature_id,
        countersigner_name,
        countersigner_role,
        countersign_sig_b64,
      }),
    });

    if (!csRes.ok) {
      const errText = await csRes.text().catch(() => "unknown");
      console.error(`[countersign-quote] Cloud Run error: HTTP ${csRes.status} — ${errText}`);
      return new Response(JSON.stringify({ error: `PDF generation failed: ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await csRes.json();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[countersign-quote] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
