// Supabase Edge Function: send-quote-links
// Creates signer + viewer tokens in quote_tokens table
// Sends personalized email links via Resend
// Deploy: supabase functions deploy send-quote-links

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = "CargoNex <hello@cargonex.io>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      quote_id,
      quote_filename,
      base_url,
      signer,      // { name, email }
      viewers = [] // [{ name, email }]
    } = body;

    if (!quote_id || !signer?.email) {
      return new Response(JSON.stringify({ error: "Missing quote_id or signer.email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const filename = quote_filename || `quote-${quote_id}.html`;
    const cleanBase = (base_url || "https://quotes.cargonex.io").replace(/\/$/, "");

    // Helper: create token record + return link
    async function createTokenLink(email: string, name: string, role: "signer" | "viewer"): Promise<string> {
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

      await supabase.from("quote_tokens").insert({
        id: crypto.randomUUID(),
        quote_id,
        token,
        email,
        name,
        role,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      });

      const encodedName = encodeURIComponent(name);
      return `${cleanBase}/${filename}?t=${token}&role=${role}&name=${encodedName}`;
    }

    // Create signer token + link
    const signerLink = await createTokenLink(signer.email, signer.name || signer.email, "signer");

    // Create viewer tokens + links
    const viewerLinks: string[] = [];
    for (const viewer of viewers) {
      if (viewer.email) {
        const link = await createTokenLink(viewer.email, viewer.name || viewer.email, "viewer");
        viewerLinks.push(link);
      }
    }

    // Send signer email
    await sendEmail(
      signer.email,
      `הצעת מחיר מ-CargoNex — ${quote_id}`,
      `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#0a0a0a;color:#f0f0f0;">
        <div style="font-size:26px;font-weight:700;color:#E74C3C;margin-bottom:24px;">CargoNex</div>
        <h2 style="font-size:20px;font-weight:700;margin-bottom:12px;">הצעת מחיר אישית</h2>
        <p style="font-size:15px;color:rgba(240,240,240,0.7);line-height:1.7;margin-bottom:24px;">
          שלום ${signer.name || ""},<br/>
          הצעת המחיר שלנו מוכנה לעיונך ולחתימתך.
        </p>
        <a href="${signerLink}" style="display:inline-block;background:#E74C3C;color:#fff;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;margin-bottom:24px;">
          לצפייה ולחתימה על ההצעה ←
        </a>
        <p style="font-size:13px;color:rgba(240,240,240,0.35);margin-top:24px;line-height:1.6;">
          קישור זה מיועד עבורך בלבד ותקף ל-30 יום.<br/>
          לשאלות: <a href="mailto:dror@alliancex.cloud" style="color:#E74C3C;">dror@alliancex.cloud</a>
        </p>
      </div>`
    );

    // Send viewer emails
    for (let i = 0; i < viewers.length; i++) {
      const viewer = viewers[i];
      if (!viewer.email) continue;
      await sendEmail(
        viewer.email,
        `הוזמנת לצפות בהצעת מחיר — CargoNex`,
        `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#0a0a0a;color:#f0f0f0;">
          <div style="font-size:26px;font-weight:700;color:#E74C3C;margin-bottom:24px;">CargoNex</div>
          <h2 style="font-size:20px;font-weight:700;margin-bottom:12px;">הוזמנת לצפות בהצעת מחיר</h2>
          <p style="font-size:15px;color:rgba(240,240,240,0.7);line-height:1.7;margin-bottom:24px;">
            שלום ${viewer.name || ""},<br/>
            הוזמנת לצפות בהצעת המחיר. קישור זה מאפשר צפייה בלבד.
          </p>
          <a href="${viewerLinks[i]}" style="display:inline-block;background:rgba(255,255,255,0.1);color:#f0f0f0;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;border:1px solid rgba(255,255,255,0.2);margin-bottom:24px;">
            לצפייה בהצעה ←
          </a>
          <p style="font-size:13px;color:rgba(240,240,240,0.35);margin-top:24px;line-height:1.6;">
            קישור זה מיועד עבורך בלבד (צפייה בלבד, ללא הרשאת חתימה).<br/>
            לשאלות: <a href="mailto:dror@alliancex.cloud" style="color:#E74C3C;">dror@alliancex.cloud</a>
          </p>
        </div>`
      );
    }

    return new Response(JSON.stringify({
      ok: true,
      signer_link: signerLink,
      viewer_links: viewerLinks,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
