import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const PDF_GENERATOR_URL = Deno.env.get("PDF_GENERATOR_URL")!;
const PDF_GENERATOR_SECRET = Deno.env.get("PDF_GENERATOR_SECRET")!;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const { html, quote_id } = await req.json();
        if (!html) return new Response(JSON.stringify({ error: "Missing html" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

        const baseUrl = PDF_GENERATOR_URL.replace('/generate-pdf', '');
        const r = await fetch(`${baseUrl}/preview-pdf`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${PDF_GENERATOR_SECRET}`,
            },
            body: JSON.stringify({ html, quote_id }),
        });

        if (!r.ok) {
            return new Response(JSON.stringify({ error: "PDF generation failed" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const pdfBuffer = await r.arrayBuffer();
        return new Response(pdfBuffer, {
            headers: {
                ...corsHeaders,
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${quote_id || 'preview'}-preview.pdf"`,
            },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
});