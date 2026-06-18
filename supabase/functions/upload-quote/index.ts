import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEND_QUOTE_LINKS_URL = Deno.env.get("SEND_QUOTE_LINKS_URL")!;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const body = await req.json();
        const { quote_id, filename, html_content, client_name, setup_fee, monthly_fee, signer, viewers = [], base_url, owner_email = "" } = body;

        if (!quote_id || !filename || !html_content || !signer?.email) {
            return new Response(JSON.stringify({ error: "Missing required fields" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        // 1. Upload to Storage
        const { error: storageError } = await supabase.storage
            .from("quotes-html")
            .upload(filename, html_content, {
                contentType: "text/html; charset=utf-8",
                upsert: true,
            });

        if (storageError) throw new Error(`Storage: ${storageError.message}`);

        // 2. Upsert metadata + HTML to quotes table
        const { error: dbError } = await supabase.from("quotes").upsert({
            quote_id,
            filename,
            html_content,
            client_name: client_name || null,
            signer_email: signer.email,
            setup_fee: setup_fee || null,
            monthly_fee: monthly_fee || null,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'quote_id' });

        if (dbError) throw new Error(`DB: ${dbError.message}`);

        // 3. Trigger send-quote-links (async)
        await fetch(SEND_QUOTE_LINKS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quote_id, quote_filename: filename, base_url, signer, viewers, owner_email }),
        }).catch(e => console.error("send-quote-links failed:", e));

        return new Response(JSON.stringify({ ok: true, url: `${base_url}/${filename}` }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (err) {
        console.error("upload-quote error:", err);
        return new Response(JSON.stringify({ error: err.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
});