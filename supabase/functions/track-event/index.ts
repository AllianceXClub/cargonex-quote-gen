// Supabase Edge Function: track-event
// Receives analytics events from quote pages → writes to quote_events table
// Sends admin email via Resend on quote_opened (first time) and quote_signed
// Deploy: supabase functions deploy track-event

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "";
const FROM_EMAIL = "CargoNex Alerts <hello@cargonex.io>"; // must be verified domain in Resend

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendAdminEmail(subject: string, html: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [ADMIN_EMAIL],
      subject,
      html,
    }),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { event, quote_id, timestamp, session_id, user_agent, metadata, replayed } = body;

    if (!event || !quote_id) {
      return new Response(JSON.stringify({ error: "Missing event or quote_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Bot detection BEFORE insert — so first-open count is accurate
    const ua = (user_agent || "").toLowerCase();
    const BOT_UA = ["whatsapp","telegram","twitterbot","facebookexternalhit","linkedinbot","slackbot","discordbot","googlebot","bingbot","yandex"];
    const isBot = event === "quote_opened" && BOT_UA.some(b => ua.includes(b));

    // Write event to DB
    const { error } = await supabase.from("quote_events").insert({
      event_type: event,
      quote_id,
      session_id: session_id || null,
      user_agent: user_agent || null,
      ip_address: req.headers.get("x-forwarded-for") || null,
      metadata: { ...(metadata || {}), ...(isBot ? { is_bot: true } : {}) },
      replayed: replayed || false,
      occurred_at: timestamp || new Date().toISOString(),
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin notifications — fire and forget, don't block response
    if (!replayed && !isBot) {
      if (event === "quote_opened") {
        // Only notify on the FIRST non-bot open of this quote
        const { count } = await supabase
          .from("quote_events")
          .select("*", { count: "exact", head: true })
          .eq("quote_id", quote_id)
          .eq("event_type", "quote_opened")
          .eq("replayed", false);

        if (count === 1) {
          // This is the first open — notify admin
          sendAdminEmail(
            `👀 הצעה נפתחה — ${quote_id}`,
            `<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;">
              <h2 style="color:#E74C3C;">הצעה נפתחה לראשונה</h2>
              <p><strong>מזהה הצעה:</strong> ${quote_id}</p>
              <p><strong>זמן:</strong> ${new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</p>
              <p style="color:#888;font-size:13px;">לקוח פתח את ההצעה — כדאי להתחיל follow-up תוך 24 שעות.</p>
            </div>`,
          ).catch(() => {});
        }
      }

      if (event === "quote_signed") {
        sendAdminEmail(
          `✅ הצעה נחתמה! — ${quote_id}`,
          `<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;">
            <h2 style="color:#27ae60;">הצעה נחתמה!</h2>
            <p><strong>מזהה הצעה:</strong> ${quote_id}</p>
            <p><strong>זמן חתימה:</strong> ${new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</p>
            <p style="color:#888;font-size:13px;">PDF חתום יישלח לאחר מספר שניות לכתובות שניהם.</p>
          </div>`,
        ).catch(() => {});
      }

      if (event === "client_comment") {
        const section = (metadata as any)?.section_label || (metadata as any)?.section || "לא ידוע";
        const commentText = ((metadata as any)?.comment || "").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        const isBot = (metadata as any)?.is_bot;
        if (!isBot && commentText) {
          sendAdminEmail(
            `💬 הערת לקוח — ${quote_id}`,
            `<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;">
              <h2 style="color:#3498db;">הערה חדשה מלקוח</h2>
              <p><strong>מזהה הצעה:</strong> ${quote_id}</p>
              <p><strong>סעיף:</strong> ${section}</p>
              <p><strong>זמן:</strong> ${new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</p>
              <div style="background:#f5f5f5;border-right:4px solid #3498db;padding:16px;margin-top:12px;border-radius:4px;direction:rtl;">
                <p style="margin:0;font-size:15px;color:#222;">${commentText}</p>
              </div>
              <p style="color:#888;font-size:12px;margin-top:12px;">מומלץ להגיב ללקוח תוך מספר שעות.</p>
            </div>`,
          ).catch(() => {});
        }
      }

      // Bot filter already applied before insert — no retroactive update needed
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (_err) {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
